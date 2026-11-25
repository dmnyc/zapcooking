/**
 * The Zap Cooking monocomposer: one composer, four tabs — Notes, Polls,
 * Recipes, Reads — Sidecar's structure in this app's order.
 *
 * Sidecar's composer core (vendor/sidecar/composer-core.js) is mounted
 * inside a shadow root: sidecar-styles.css is 7.5k lines with global
 * selectors (:root, html, body, *), so it is adopted into the shadow and
 * cannot leak into the app, while CSS variables — the palette — still
 * inherit from the page. zapcooking-theme.css maps the app's palette onto
 * Sidecar's var names, which is how the palette stays Zap Cooking's.
 *
 * Spike v0: the Notes pane is wired (editor, paste-quote, media upload,
 * sign → countdown → dry-run publish, relay toggle). Polls, Recipes and
 * Reads are panes with their editors landing next.
 */
import styles from '$lib/vendor/sidecar/sidecar-styles.css?raw';
import theme from '$lib/vendor/sidecar/zapcooking-theme.css?raw';
import { getCurrentRelays } from '$lib/nostr';
// Host services first (they set window.SidecarI18n and window.NostrTools),
// then the core — the same order compose.html loads them in. The core is a
// dynamic, client-only import: it reads window at its top level, and the
// route never renders on the server.
import { buildSidecarDeps, composerPool } from './host';

export const MONO_TABS = [
  { id: 'notes', label: 'Notes' },
  { id: 'polls', label: 'Polls' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'reads', label: 'Reads' }
] as const;

export type MonoTab = (typeof MONO_TABS)[number]['id'];

type SidecarEvent = Record<string, unknown>;
type PublishReport = { accepted: string[]; failed: { url: string }[]; total: number };

interface EditorApi {
  wrap: HTMLElement;
  editor: HTMLElement;
  sync(): void;
  setText(t: string): void;
  focus(): void;
  getText(): string;
}

interface ComposerController {
  createMentionEditor(o: Record<string, unknown>): EditorApi;
  serializeEditor(el: HTMLElement): string;
  uploadMedia(file: File, pubkey: string): Promise<string>;
  checkPastedQuote(q: unknown, revert: () => void): void;
  showPostCountdown(o: Record<string, unknown>): { stop(): void };
  publishToRelays(o: Record<string, unknown>): Promise<PublishReport>;
  renderNotePreview(el: HTMLElement, content: string): void;
}

interface MountOptions {
  tab?: MonoTab;
  live?: boolean;
  onTabChange?: (tab: MonoTab) => void;
}

export async function mountMonoComposer(container: HTMLElement, opts: MountOptions = {}) {
  const live = !!opts.live;
  // The core reads window at its own top level, so it loads here, in the
  // browser, after its globals shim has run.
  await import('$lib/vendor/sidecar/composer-core.js');
  let currentTab: MonoTab = opts.tab || 'notes';
  let posting = false;
  const media: { url: string; isVideo?: boolean }[] = [];
  const DRAFT_KEY = 'zapcooking_mono_draft';
  const allRelays = getCurrentRelays();
  const chosenRelays = new Set<string>(allRelays);

  const SidecarCore = (window as unknown as { SidecarCore: {
    installComposer: (d: Record<string, unknown>) => ComposerController & Record<string, unknown>;
    removeUrlFromEditor: (el: HTMLElement, url: string) => void;
    quoteEntriesFromPaste: (plain: string, media: unknown[]) => unknown[];
    composeNoteContent: (text: string, media: unknown[]) => string;
  } }).SidecarCore;

  const deps = buildSidecarDeps(live);
  const composer = SidecarCore.installComposer(deps) as ComposerController;

  // ── skeleton ─────────────────────────────────────────────────
  const shadow = container.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = styles + '\n' + theme;
  shadow.appendChild(styleEl);

  const page = document.createElement('div');
  page.className = 'compose-page';
  page.setAttribute('data-theme', 'zapcooking');
  shadow.appendChild(page);

  const tabsHtml = MONO_TABS.map(
    (t) =>
      `<button type="button" class="compose-tab${t.id === currentTab ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');

  page.innerHTML = `
    <div class="compose-body">
      <main class="compose-sheet">
        <header class="compose-head">
          <div class="compose-who">
            <span class="avatar compose-av" data-mono="avatar"></span>
            <span class="compose-who-text">
              <span class="compose-name" data-mono="name">Loading…</span>
              <span class="compose-sub">Writing as this account</span>
            </span>
          </div>
        </header>

        <div class="compose-tabs">
          ${tabsHtml}
          <span class="compose-saved" role="status" aria-live="polite"></span>
        </div>

        <div data-mono="reply-slot"></div>
        <div data-mono="slot"></div>
        <div class="compose-countdown hidden" data-mono="countdown"></div>
        <div class="compose-thumbs" data-mono="thumbs"></div>

        <div class="compose-actions">
          <button type="button" class="tool-btn" data-mono="image" title="Add a picture">pic</button>
          <button type="button" class="tool-btn" data-mono="gif" title="GIF search lands next" disabled>gif</button>
          <button type="button" class="tool-btn" data-mono="poll" title="Polls land next" disabled>poll</button>
          <button type="button" class="tool-btn" data-mono="drafts" title="Drafts">drafts</button>
          <span style="flex:1"></span>
          <button type="button" class="tool-btn" data-mono="relays" title="Where this posts">relays</button>
        </div>
        <div data-mono="relay-popover" hidden></div>
        <p class="error" data-mono="err"></p>

        <footer class="compose-foot">
          <span class="compose-status" data-mono="status"></span>
          <button type="button" class="primary compose-post" data-mono="post" disabled>Post</button>
        </footer>
      </main>
    </div>`;

  const el = <T extends Element = HTMLElement>(name: string) =>
    page.querySelector(`[data-mono="${name}"]`) as T;
  const slotEl = el('slot');
  const replySlot = el('reply-slot');
  const errEl = el<HTMLParagraphElement>('err');
  const statusEl = el('status');
  const postBtn = el<HTMLButtonElement>('post');
  const savedEl = page.querySelector('.compose-saved') as HTMLElement;
  const countdownEl = el('countdown');
  const thumbsEl = el('thumbs');
  const relayPopover = el('relay-popover');

  // ── state ────────────────────────────────────────────────────
  let draftTimer: ReturnType<typeof setTimeout> | null = null;

  // ── drafts: autosave per tab, a pane to restore and discard ──
  // The draft being written lives in DRAFT_KEY; the pane lists every tab's
  // saved draft, newest first, with restore and discard. Publishing a tab
  // clears its entry — a published note is not a draft.
  const DRAFTS_LIST_KEY = 'zapcooking_mono_drafts_v1';
  type DraftEntry = { text: string; at: number };
  let draftsPane: HTMLElement | null = null;

  function readDraftList(): Record<string, DraftEntry> {
    try {
      return JSON.parse(localStorage.getItem(DRAFTS_LIST_KEY) || '{}') as Record<string, DraftEntry>;
    } catch (_) {
      return {};
    }
  }

  function writeDraftList(list: Record<string, DraftEntry>) {
    try {
      localStorage.setItem(DRAFTS_LIST_KEY, JSON.stringify(list));
    } catch (_) {
      /* storage blocked: the draft still exists in the editor */
    }
  }

  function draftSaveSoon() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ text: editorApi.getText(), media, at: Date.now() })
        );
        savedEl.textContent = '✓ Saved';
      } catch (_) {
        /* storage blocked: the note still posts */
      }
      const list = readDraftList();
      const text = editorApi.getText();
      if (currentTab === 'notes') {
        if (text.trim() || media.length) list[currentTab] = { text, at: Date.now() };
        else delete list[currentTab];
        writeDraftList(list);
        paintDraftsCount();
      }
    }, 600);
  }

  function paintDraftsCount() {
    const list = readDraftList();
    const count = Object.values(list).filter((d) => d.text && d.text.trim()).length;
    draftsBtn.textContent = count ? `drafts (${count})` : 'drafts';
  }

  function renderDraftsPane() {
    if (draftsPane) {
      draftsPane.remove();
      draftsPane = null;
      return;
    }
    draftsPane = document.createElement('div');
    draftsPane.className = 'compose-drafts-pane';
    draftsPane.style.cssText = 'padding:8px 4px';
    const list = readDraftList();
    const entries = MONO_TABS.filter((t) => list[t.id]?.text?.trim());
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'color:var(--muted,#999);font-size:12px;padding:6px 2px';
      empty.textContent = 'No saved drafts yet — what you type is saved here as you go.';
      draftsPane.appendChild(empty);
    }
    for (const tab of entries) {
      const d = list[tab.id];
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border,#333);padding:6px 2px;font-size:12px';
      const label = document.createElement('span');
      label.style.cssText = 'font-weight:600;min-width:52px';
      label.textContent = tab.label;
      const preview = document.createElement('span');
      preview.style.cssText = 'flex:1;color:var(--muted,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      preview.textContent = d.text.trim().slice(0, 60);
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'tool-btn';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', () => {
        setPane(tab.id);
        if (tab.id === 'notes') {
          editorApi.setText(d.text);
          editorApi.sync();
          editorApi.focus();
          refreshPostState();
        }
        if (draftsPane) {
          draftsPane.remove();
          draftsPane = null;
        }
      });
      const discardBtn = document.createElement('button');
      discardBtn.type = 'button';
      discardBtn.className = 'tool-btn';
      discardBtn.textContent = '✕';
      discardBtn.title = 'Discard this draft';
      discardBtn.addEventListener('click', () => {
        const next = readDraftList();
        delete next[tab.id];
        writeDraftList(next);
        paintDraftsCount();
        renderDraftsPane();
      });
      row.append(label, preview, restoreBtn, discardBtn);
      draftsPane.appendChild(row);
    }
    slotEl.before(draftsPane);
  }

  function refreshPostState() {
    if (currentTab !== 'notes') return;
    postBtn.disabled =
      posting || (!editorApi.getText().trim() && media.length === 0);
  }

  // ── media strip ──────────────────────────────────────────────
  function renderThumbs() {
    thumbsEl.innerHTML = '';
    media.forEach((m) => {
      const img = document.createElement('img');
      img.src = m.url;
      img.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:8px';
      thumbsEl.appendChild(img);
    });
  }

  async function uploadFiles(files: File[]) {
    const pubkey = deps.activePubkey() as string;
    statusEl.textContent = 'Uploading…';
    try {
      for (const file of files) {
        const url = await composer.uploadMedia(file, pubkey);
        media.push({ url, isVideo: file.type.startsWith('video/') });
        renderThumbs();
      }
      errEl.textContent = '';
      draftSaveSoon();
    } catch (e) {
      errEl.textContent = String((e as Error).message || e);
    } finally {
      statusEl.textContent = '';
    }
  }

  // ── relays: the toggle in the bottom row ─────────────────────
  function renderRelayPopover() {
    relayPopover.innerHTML = '';
    relayPopover.hidden = false;
    relayPopover.style.cssText =
      'position:absolute;bottom:52px;right:12px;z-index:30;background:var(--bg-2,#191a1c);border:1px solid var(--border,#333);border-radius:10px;padding:10px 12px;max-width:280px';
    const title = document.createElement('div');
    title.textContent = 'Post to';
    title.style.cssText = 'font-size:12px;color:var(--muted,#999);margin-bottom:6px';
    relayPopover.appendChild(title);
    for (const url of allRelays) {
      const label = document.createElement('label');
      label.style.cssText =
        'display:flex;gap:6px;align-items:center;font-size:12px;padding:2px 0;cursor:pointer';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = chosenRelays.has(url);
      box.onchange = () => {
        if (box.checked) chosenRelays.add(url);
        else chosenRelays.delete(url);
      };
      label.appendChild(box);
      label.appendChild(document.createTextNode(url));
      relayPopover.appendChild(label);
    }
  }
  el<HTMLButtonElement>('relays').addEventListener('click', () => {
    if (relayPopover.hidden) renderRelayPopover();
    else relayPopover.hidden = true;
  });

  // ── publish: sign → countdown bar → relays ───────────────────
  const signAuth = (template: Record<string, unknown>) =>
    deps.call({
      type: 'SIDECAR_OWNER_SIGN',
      event: template,
      expectedPubkey: deps.activePubkey()
    });

  function doPublish(signed: SidecarEvent) {
    const NT = deps.NT as { utils: { normalizeURL: (u: string) => string } };
    const relays = chosenRelays.size ? [...chosenRelays] : allRelays;
    return composer.publishToRelays({
      pool: composerPool(live),
      relays,
      signed,
      params: { onauth: signAuth },
      normalize: (u: string) => NT.utils.normalizeURL(u)
    });
  }

  async function onPost() {
    if (posting || currentTab !== 'notes') return;
    posting = true;
    refreshPostState();
    errEl.textContent = '';
    const text = composer.serializeEditor(editorApi.editor);
    const template = {
      kind: 1,
      content: text,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['client', 'zapcooking']]
    };
    try {
      statusEl.textContent = 'Signing…';
      const signed = (await signAuth(template)) as SidecarEvent;

      // The kept countdown bar: review with the ring, then it goes.
      const preview = document.createElement('div');
      preview.className = 'countdown-preview';
      const body = document.createElement('div');
      body.className = 'preview-body';
      composer.renderNotePreview(body, SidecarCore.composeNoteContent(text, media));
      preview.appendChild(body);

      const restore = () => {
        countdownEl.innerHTML = '';
        countdownEl.classList.add('hidden');
        slotEl.classList.remove('hidden');
        statusEl.textContent = '';
        posting = false;
        refreshPostState();
      };
      slotEl.classList.add('hidden');
      countdownEl.classList.remove('hidden');
      countdown = composer.showPostCountdown({
        modal: countdownEl,
        secs: 5,
        title: 'Posting your note',
        preview,
        confirmLabel: 'Post now',
        onFire: () => {
          restore();
          void actuallyPublish(signed);
        },
        onCancel: restore
      });
    } catch (e) {
      errEl.textContent = String((e as Error).message || e);
      posting = false;
      refreshPostState();
    }
  }

  let countdown: { stop(): void } | null = null;

  async function actuallyPublish(signed: SidecarEvent) {
    statusEl.textContent = 'Publishing…';
    try {
      const report = await doPublish(signed);
      if (!report.accepted.length) {
        errEl.textContent = 'No relay accepted it. It is still saved as a draft.';
        return;
      }
      editorApi.setText('');
      media.length = 0;
      renderThumbs();
      try {
        localStorage.removeItem(DRAFT_KEY);
        const list = readDraftList();
        delete list.notes;
        writeDraftList(list);
        paintDraftsCount();
      } catch (_) {}
      savedEl.textContent = '';
      errEl.textContent = `Sent to ${report.accepted.length}/${report.total} relays.`;
    } catch (e) {
      errEl.textContent = String((e as Error).message || e);
    } finally {
      statusEl.textContent = '';
      posting = false;
      refreshPostState();
    }
  }

  postBtn.addEventListener('click', () => void onPost());

  // ── the editor (Notes pane) ─────────────────────────────────
  const editorApi = composer.createMentionEditor({
    placeholder: 'What are you eating, cooking, or loving?',
    onChange: () => {
      draftSaveSoon();
      refreshPostState();
    },
    onAttachUrl: (url: string) => {
      SidecarCore.removeUrlFromEditor(editorApi.editor, url);
      if (!media.some((m) => m && m.url === url)) media.push({ url, isVideo: false });
      editorApi.sync();
      renderThumbs();
      draftSaveSoon();
    },
    onFiles: (files: File[]) => {
      const uploadable = files.filter(
        (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
      );
      if (!uploadable.length) return;
      void uploadFiles(uploadable);
    },
    onPasteText: (plain: string) => {
      const quotes = SidecarCore.quoteEntriesFromPaste(plain, media);
      if (!quotes.length) return false;
      media.push(...(quotes as { url: string }[]));
      renderThumbs();
      composer.checkPastedQuote(quotes[0], () => {
        const at = media.indexOf(quotes[0] as { url: string });
        if (at >= 0) media.splice(at, 1);
        editorApi.setText(String((quotes[0] as { quote?: string })?.quote || plain));
        editorApi.sync();
        renderThumbs();
      });
      return true;
    }
  });

  // ── tabs and panes ──────────────────────────────────────────
  function setPane(tab: MonoTab) {
    currentTab = tab;
    opts.onTabChange?.(tab);
    page.querySelectorAll<HTMLButtonElement>('.compose-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    countdownEl.classList.add('hidden');
    slotEl.innerHTML = '';
    slotEl.classList.remove('hidden');
    if (tab === 'notes') {
      slotEl.appendChild(editorApi.wrap);
      editorApi.focus();
      refreshPostState();
      return;
    }
    postBtn.disabled = true;
    const soon = document.createElement('p');
    soon.style.cssText = 'padding:24px 4px;color:var(--muted,#999);font-size:13px';
    soon.textContent = `The ${tab.charAt(0).toUpperCase()}${tab.slice(1)} pane lands next — the engine above is the same one, the pane is the next slice.`;
    slotEl.appendChild(soon);
  }

  page.querySelectorAll<HTMLButtonElement>('.compose-tab').forEach((b) => {
    b.addEventListener('click', () => setPane((b.dataset.tab || 'notes') as MonoTab));
  });

  // ── image button ────────────────────────────────────────────
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,video/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) void uploadFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });
  el<HTMLButtonElement>('image').addEventListener('click', () => fileInput.click());

  // ── drafts: autosave, restore, the saved-drafts pane ────────
  function restoreDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (saved?.text) editorApi.setText(saved.text);
      if (Array.isArray(saved?.media)) media.push(...saved.media);
      renderThumbs();
      refreshPostState();
    } catch (_) {
      /* unreadable draft: start clean */
    }
  }

  const draftsBtn = el<HTMLButtonElement>('drafts');
  draftsBtn.addEventListener('click', () => renderDraftsPane());

  // ── who is writing ──────────────────────────────────────────
  (async () => {
    const pubkey = deps.activePubkey() as string;
    if (!pubkey) return;
    const av = el('avatar');
    av.textContent = pubkey.slice(0, 4);
    const nameEl = el('name');
    nameEl.textContent = pubkey.slice(0, 10) + '…';
  })();

  // ── boot ────────────────────────────────────────────────────
  restoreDraft();
  setPane(currentTab);

  return {
    destroy() {
      page.remove();
      styleEl.remove();
      shadow.innerHTML = '';
    },
    setTab(tab: MonoTab) {
      setPane(tab);
    }
  };
}
