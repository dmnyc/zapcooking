/**
 * The Zap Cooking monocomposer: one composer, four tabs — Notes, Polls,
 * Recipes, Reads — Sidecar's full-size composer, this app's order and
 * palette. The layout follows Sidecar's own composer tab for tab: kind
 * tabs with icons over a Write / Preview row, the tall note editor with
 * the segment row (camera, GIF, emoji, proof of work, and this app's
 * relay toggle and schedule), the poll block with its options and runs-
 * for, the recipe form with cover, times, ingredients, directions,
 * categories and Review, and the article form with title, cover,
 * summary, topics and a markdown toolbar.
 *
 * Sidecar's composer core (vendor/sidecar/composer-core.js) is mounted
 * inside a shadow root: sidecar-styles.css is 7.5k lines with global
 * selectors (:root, html, body, *), so it is adopted into the shadow and
 * cannot leak into the app, while CSS variables — the palette — still
 * inherit from the page. zapcooking-theme.css maps the app's palette onto
 * Sidecar's var names, which is how the palette stays Zap Cooking's.
 *
 * Spike v1: Notes and Polls publish (sign → countdown → the chosen
 * relays, dry-run on ?dry=1). Recipes and Reads are laid out with their
 * forms and drafts; their publish lands with the longform port.
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
  { id: 'notes', label: 'Note', icon: '💬' },
  { id: 'polls', label: 'Poll', icon: '📊' },
  { id: 'recipes', label: 'Recipe', icon: '👩‍🍳' },
  { id: 'reads', label: 'Reads', icon: '📄' }
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
  insertText(t: string): void;
}

interface ComposerController {
  createMentionEditor(o: Record<string, unknown>): EditorApi;
  serializeEditor(el: HTMLElement): string;
  uploadMedia(file: File, pubkey: string): Promise<string>;
  checkPastedQuote(q: unknown, revert: () => void): void;
  showPostCountdown(o: Record<string, unknown>): { stop(): void };
  publishToRelays(o: Record<string, unknown>): Promise<PublishReport>;
  renderNotePreview(el: HTMLElement, content: string): void;
  buildPollEditor(o: Record<string, unknown>): { wrap: HTMLElement; addBtn: HTMLButtonElement };
  buildEmojiPicker(o: Record<string, unknown>): { wrap: HTMLElement; addBtn: HTMLElement; close(): void };
  buildGifPicker(o: Record<string, unknown>): { wrap: HTMLElement; addBtn: HTMLElement };
  newPollDraft(): unknown;
  pollDraftIsPostable(p: unknown): boolean;
  buildPollTags(p: unknown, nowSecs: number, relays: string[]): unknown[];
  POLL_KIND: number;
}

interface MountOptions {
  tab?: MonoTab;
  live?: boolean;
  onTabChange?: (tab: MonoTab) => void;
}

const RECIPE_CATEGORY_CHIPS: [string, string][] = [
  ['🦃', 'Turkey'],
  ['🍖', 'Roast'],
  ['🥧', 'Pie'],
  ['🎃', 'Squash'],
  ['🥔', 'Potato'],
  ['🍞', 'Bread'],
  ['🍲', 'Soup']
];

const COUNTDOWN_SECS = 5;

export async function mountMonoComposer(container: HTMLElement, opts: MountOptions = {}) {
  const live = !!opts.live;
  // The core reads window at its own top level, so it loads here, in the
  // browser, after its globals shim has run.
  await import('$lib/vendor/sidecar/composer-core.js');
  let currentTab: MonoTab = opts.tab || 'notes';
  let posting = false;
  let countdown: { stop(): void } | null = null;
  const allRelays = getCurrentRelays();
  const chosenRelays = new Set<string>(allRelays);

  const deps = buildSidecarDeps(live);
  const SidecarCore = (window as unknown as {
    SidecarCore: {
      installComposer: (d: Record<string, unknown>) => ComposerController & Record<string, unknown>;
      removeUrlFromEditor: (el: HTMLElement, url: string) => void;
      quoteEntriesFromPaste: (plain: string, media: unknown[]) => unknown[];
      composeNoteContent: (text: string, media: unknown[]) => string;
      buildPollEditor(o: Record<string, unknown>): { wrap: HTMLElement; addBtn: HTMLButtonElement };
      buildEmojiPicker(o: Record<string, unknown>): { wrap: HTMLElement; addBtn: HTMLButtonElement; close(): void };
      buildGifPicker(o: Record<string, unknown>): { wrap: HTMLElement; addBtn: HTMLButtonElement };
      newPollDraft(): unknown;
      pollDraftIsPostable(p: unknown): boolean;
      buildPollTags(p: unknown, nowSecs: number, relays: string[]): unknown[];
      POLL_KIND: number;
    };
  }).SidecarCore;
  const composer = SidecarCore.installComposer(deps) as ComposerController;

  // ── skeleton ─────────────────────────────────────────────────
  const shadow = container.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  // The mono layer styles only what this shell adds on top of Sidecar's
  // own classes: the segment row, the Write/Preview subtabs, the drafts
  // pane chrome and the footer toggle.
  const monoStyles = `
    .tool-btn {
      background: var(--bg-2, #191a1c); color: var(--text, #fff);
      border: 1px solid var(--border, #333); border-radius: 10px;
      padding: 7px 12px; font: inherit; font-size: 13px; cursor: pointer;
    }
    .tool-btn:disabled { opacity: 0.45; cursor: default; }
    .tool-btn:not(:disabled):hover { border-color: var(--border-strong, var(--orange, #ec4700)); }
    .mono-seg { flex: 1 1 0; text-align: center; padding: 9px 6px; }
    .mono-tab-icon { margin-right: 6px; }
    .mono-subtabs { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--border, #333); margin: 6px 0 10px; }
    .mono-subtab {
      background: transparent; border: none; color: var(--muted, #999);
      font: inherit; font-size: 14px; padding: 8px 2px; cursor: pointer;
      border-bottom: 2px solid transparent;
    }
    .mono-subtab.active { color: var(--text, #fff); border-bottom-color: var(--orange, #ec4700); }
    .mono-need { font-size: 12px; color: var(--muted, #999); text-align: right; padding: 2px 4px; }
    .mono-count { font-size: 12px; color: var(--muted, #999); }
    .mono-fullsize { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted, #999); cursor: pointer; }
    .mono-fullsize input { accent-color: var(--orange, #ec4700); }
    .compose-editor { min-height: 260px; }
    .compose-sheet:has(.poll-editor:not(.hidden)) .compose-editor { min-height: 120px; }
  `;
  styleEl.textContent = styles + '\n' + theme + '\n' + monoStyles;
  shadow.appendChild(styleEl);

  const page = document.createElement('div');
  page.className = 'compose-page';
  page.setAttribute('data-theme', 'zapcooking');
  shadow.appendChild(page);

  const kindTabsHtml = MONO_TABS.map(
    (t) =>
      `<button type="button" class="compose-tab${t.id === currentTab ? ' active' : ''}" data-tab="${t.id}" title="${t.label}"><span class="mono-tab-icon">${t.icon}</span><span>${t.label}</span></button>`
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
          <span style="flex:1"></span>
          <button type="button" class="tool-btn" data-mono="drafts" title="Drafts">drafts</button>
        </header>

        <div class="compose-tabs">
          ${kindTabsHtml}
          <span class="compose-saved" role="status" aria-live="polite"></span>
        </div>

        <div class="mono-subtabs">
          <button type="button" class="mono-subtab active" data-mono="subtab-write">Write</button>
          <button type="button" class="mono-subtab" data-mono="subtab-preview">Preview</button>
        </div>

        <div data-mono="reply-slot"></div>
        <div data-mono="slot"></div>
        <div class="compose-countdown hidden" data-mono="countdown"></div>
        <div class="compose-thumbs" data-mono="thumbs"></div>

        <div class="compose-actions" data-mono="actions"></div>
        <div data-mono="relay-popover" hidden></div>
        <p class="error" data-mono="err"></p>
        <div class="mono-need" data-mono="need" hidden></div>

        <footer class="compose-foot">
          <label class="mono-fullsize">
            <input type="checkbox" data-mono="fullsize" checked />
            <span>Always use the full-size composer</span>
          </label>
          <span class="compose-status" data-mono="status"></span>
          <span class="mono-count" data-mono="count"></span>
          <button type="button" class="primary compose-post" data-mono="post" disabled>Post</button>
        </footer>
      </main>
    </div>`;

  const el = <T extends Element = HTMLElement>(name: string) =>
    page.querySelector(`[data-mono="${name}"]`) as T;
  const slotEl = el('slot');
  const errEl = el<HTMLParagraphElement>('err');
  const statusEl = el('status');
  const postBtn = el<HTMLButtonElement>('post');
  const savedEl = page.querySelector('.compose-saved') as HTMLElement;
  const countdownEl = el('countdown');
  const thumbsEl = el('thumbs');
  const relayPopover = el('relay-popover');
  const actionsEl = el('actions');
  const needEl = el('need');
  const countEl = el('count');
  const subtabPreview = el<HTMLButtonElement>('subtab-preview');
  const subtabWrite = el<HTMLButtonElement>('subtab-write');

  // ── state ────────────────────────────────────────────────────
  let pollDraft: unknown = null;
  let showPreview = false;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  const media: { url: string; isVideo?: boolean }[] = [];
  const recipeForm: {
    name: string; cover: string; summary: string; prep: string; cook: string; servings: string;
    ingredients: string[]; directions: string[]; notes: string; categories: string[]; source: string;
  } = { name: '', cover: '', summary: '', prep: '', cook: '', servings: '', ingredients: [], directions: [], notes: '', categories: [], source: '' };
  const articleForm: { title: string; cover: string; summary: string; topics: string[]; body: string } = {
    title: '', cover: '', summary: '', topics: [], body: ''
  };

  // ── drafts ───────────────────────────────────────────────────
  const DRAFT_KEY = 'zapcooking_mono_draft';
  const DRAFTS_LIST_KEY = 'zapcooking_mono_drafts_v1';
  type DraftEntry = { text: string; at: number };

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

  function draftHasContent(): boolean {
    if (currentTab === 'notes' || currentTab === 'polls')
      return !!editorApi.getText().trim() || media.length > 0 || !!pollDraft;
    if (currentTab === 'recipes')
      return !!(recipeForm.name || recipeForm.summary || recipeForm.ingredients.length || recipeForm.directions.length);
    return !!(articleForm.title || articleForm.body || articleForm.summary);
  }

  function draftSaveSoon() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        if (currentTab === 'notes' || currentTab === 'polls') {
          localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({ text: editorApi.getText(), media, poll: pollDraft, at: Date.now() })
          );
        } else if (currentTab === 'recipes') {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ recipe: recipeForm, at: Date.now() }));
        } else {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ article: articleForm, at: Date.now() }));
        }
        savedEl.textContent = '✓ Saved';
      } catch (_) {
        /* storage blocked: the note still posts */
      }
      const list = readDraftList();
      if (draftHasContent()) list[currentTab] = { text: draftSummary(), at: Date.now() };
      else delete list[currentTab];
      writeDraftList(list);
      paintDraftsCount();
    }, 600);
  }

  function draftSummary(): string {
    if (currentTab === 'notes' || currentTab === 'polls') return editorApi.getText();
    if (currentTab === 'recipes') return recipeForm.name || recipeForm.summary;
    return articleForm.title || articleForm.summary || articleForm.body.slice(0, 60);
  }

  function paintDraftsCount() {
    const list = readDraftList();
    const count = Object.values(list).filter((d) => d.text && d.text.trim()).length;
    draftsBtn.textContent = count ? `drafts (${count})` : 'drafts';
  }

  function renderDraftsPane() {
    const existing = page.querySelector('.compose-drafts-pane');
    if (existing) {
      existing.remove();
      return;
    }
    const pane = document.createElement('div');
    pane.className = 'compose-drafts-pane';
    pane.style.cssText = 'padding:8px 4px';
    const list = readDraftList();
    const entries = MONO_TABS.filter((t) => list[t.id]?.text?.trim());
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'color:var(--muted,#999);font-size:12px;padding:6px 2px';
      empty.textContent = 'No saved drafts yet — what you type is saved here as you go.';
      pane.appendChild(empty);
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
      preview.style.cssText =
        'flex:1;color:var(--muted,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      preview.textContent = d.text.trim().slice(0, 60);
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'tool-btn';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', () => {
        setPane(tab.id);
        restoreSavedDraft();
        pane.remove();
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
      pane.appendChild(row);
    }
    tabsRow.after(pane);
  }

  function restoreSavedDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!saved) return;
      if (saved.text) editorApi.setText(saved.text);
      if (Array.isArray(saved.media)) media.push(...saved.media);
      if (saved.poll) pollDraft = saved.poll;
      if (saved.recipe) Object.assign(recipeForm, saved.recipe);
      if (saved.article) Object.assign(articleForm, saved.article);
      renderThumbs();
      refreshPostState();
    } catch (_) {
      /* unreadable draft: start clean */
    }
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
    if (posting) return;
    if (currentTab !== 'notes' && currentTab !== 'polls') {
      showToast('error', 'Recipes and Reads go out through Review — that lands with the longform port.');
      return;
    }
    const asPoll = currentTab === 'polls' && !!pollDraft;
    if (asPoll && !SidecarCore.pollDraftIsPostable(pollDraft)) {
      errEl.textContent = 'A poll needs its question and two filled options.';
      return;
    }
    posting = true;
    refreshPostState();
    errEl.textContent = '';
    const text = composer.serializeEditor(editorApi.editor);
    const template = {
      kind: asPoll ? SidecarCore.POLL_KIND : 1,
      content: text,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['client', 'zapcooking'],
        ...(asPoll
          ? SidecarCore.buildPollTags(pollDraft, Math.floor(Date.now() / 1000), [
              ...chosenRelays
            ])
          : [])
      ]
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
        secs: COUNTDOWN_SECS,
        title: asPoll ? 'Posting your poll' : 'Posting your note',
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
        delete list.polls;
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

  function showToast(_variant: string, message: string) {
    errEl.textContent = message;
  }

  // ── the editor (Notes and Polls share it) ────────────────────
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

  // ── polls: the same draft, raised on the Polls tab ──────────
  let pollEditor: { wrap: HTMLElement; addBtn: HTMLButtonElement };
  pollEditor = SidecarCore.buildPollEditor({
    poll: () => pollDraft,
    setPoll: (p: unknown) => {
      pollDraft = p;
    },
    changed: () => {
      draftSaveSoon();
      refreshPostState();
    },
    isReply: () => false,
    hasMedia: () => media.length > 0,
    mediaBtn: () => actionsEl.querySelector('[data-seg="camera"]') as HTMLButtonElement,
    gif: () => null
  });

  // ── emoji and GIF pickers (the core's own) ───────────────────
  const emojiPicker = SidecarCore.buildEmojiPicker({
    onPick: (ch: string) => editorApi.insertText(ch),
    onClose: () => editorApi.focus()
  });
  const gifPicker = SidecarCore.buildGifPicker({
    onPick: (gif: { url: string; title?: string }) => {
      if (!media.some((m) => m.url === gif.url)) media.push({ url: gif.url, isVideo: false });
      renderThumbs();
      draftSaveSoon();
    }
  });

  // ── the segment row (the kept icons) ─────────────────────────
  function segment(label: string, title: string, onclick: () => void, disabled = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool-btn mono-seg';
    b.textContent = label;
    b.title = title;
    b.disabled = disabled;
    b.addEventListener('click', onclick);
    return b;
  }

  function paintSegments() {
    actionsEl.innerHTML = '';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length) void uploadFiles(Array.from(fileInput.files));
      fileInput.value = '';
    });
    actionsEl.appendChild(fileInput);
    if (currentTab === 'notes') {
      actionsEl.append(
        segment('📷', 'Add a picture', () => fileInput.click()),
        segment('GIF', 'GIF search', () => {
          actionsEl.appendChild(gifPicker.wrap);
          gifPicker.addBtn.click();
        }),
        segment('☺', 'Emoji', () => {
          actionsEl.appendChild(emojiPicker.wrap);
          emojiPicker.addBtn.click();
        }),
        segment('↗', 'Proof of work lands next', () => {}, true),
        segment('relays', 'Where this posts', () => {
          if (relayPopover.hidden) renderRelayPopover();
          else relayPopover.hidden = true;
        }),
        segment('🕒', 'Schedule lands with the scheduler port', () => {}, true)
      );
    } else if (currentTab === 'polls') {
      actionsEl.append(
        segment('☺', 'Emoji', () => {
          actionsEl.appendChild(emojiPicker.wrap);
          emojiPicker.addBtn.click();
        }),
        segment('↗', 'Proof of work lands next', () => {}, true),
        segment('relays', 'Where this posts', () => {
          if (relayPopover.hidden) renderRelayPopover();
          else relayPopover.hidden = true;
        }),
        segment('🕒', 'Schedule lands with the scheduler port', () => {}, true)
      );
    }
  }

  // ── recipes and reads: the forms ─────────────────────────────
  function field(labelText: string, input: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:10px 0';
    const label = document.createElement('div');
    label.textContent = labelText;
    label.style.cssText = 'font-size:12px;font-weight:600;color:var(--muted,#999);margin-bottom:4px';
    wrap.append(label, input);
    return wrap;
  }

  function textInput(placeholder: string, value: string, oninput: (v: string) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value;
    input.style.cssText =
      'width:100%;box-sizing:border-box;background:var(--bg-2,#191a1c);border:1px solid var(--border,#333);border-radius:10px;padding:10px 12px;color:var(--text,#fff);font:inherit';
    input.addEventListener('input', () => {
      oninput(input.value);
      draftSaveSoon();
    });
    return input;
  }

  function areaInput(placeholder: string, value: string, oninput: (v: string) => void, rows = 3): HTMLTextAreaElement {
    const area = document.createElement('textarea');
    area.placeholder = placeholder;
    area.rows = rows;
    area.value = value;
    area.style.cssText =
      'width:100%;box-sizing:border-box;background:var(--bg-2,#191a1c);border:1px solid var(--border,#333);border-radius:10px;padding:10px 12px;color:var(--text,#fff);font:inherit;resize:vertical';
    area.addEventListener('input', () => {
      oninput(area.value);
      draftSaveSoon();
    });
    return area;
  }

  function coverDrop(kind: string): HTMLElement {
    const box = document.createElement('div');
    box.style.cssText =
      'border:1px dashed var(--border,#444);border-radius:12px;padding:18px;text-align:center;color:var(--muted,#999);font-size:13px;margin:10px 0';
    box.textContent = `Add a cover ${kind} — shown at the top and in link previews (upload lands with the media port)`;
    return box;
  }

  function buildRecipePane(): HTMLElement {
    const pane = document.createElement('div');
    const title = document.createElement('input');
    title.type = 'text';
    title.placeholder = 'Recipe name';
    title.value = recipeForm.name;
    title.style.cssText =
      'width:100%;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid var(--border,#333);color:var(--text,#fff);font-family:var(--font-display,Georgia,serif);font-size:32px;padding:4px 0;margin:4px 0 12px';
    title.addEventListener('input', () => {
      recipeForm.name = title.value;
      draftSaveSoon();
      paintNeed();
    });
    pane.appendChild(title);
    pane.appendChild(coverDrop('photo'));
    pane.appendChild(field('Summary', areaInput('What makes this one worth making', recipeForm.summary, (v) => (recipeForm.summary = v))));
    const times = document.createElement('div');
    times.style.cssText = 'display:flex;gap:10px';
    times.append(
      field('Prep time', textInput('20 min', recipeForm.prep, (v) => (recipeForm.prep = v))),
      field('Cook time', textInput('1 hr', recipeForm.cook, (v) => (recipeForm.cook = v))),
      field('Servings', textInput('6', recipeForm.servings, (v) => (recipeForm.servings = v)))
    );
    times.querySelectorAll(':scope > div').forEach((d) => ((d as HTMLElement).style.flex = '1'));
    pane.appendChild(times);
    const listField = (
      labelText: string, placeholder: string, items: string[],
      set: (v: string[]) => void, itemHint: string
    ) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin:10px 0';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px';
      const input = textInput(placeholder, '', () => {});
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'tool-btn';
      add.textContent = 'Add';
      add.addEventListener('click', () => {
        const v = input.value.trim();
        if (!v) return;
        items.push(v);
        set(items);
        input.value = '';
        paintItems();
        draftSaveSoon();
        paintNeed();
      });
      row.append(input, add);
      const listEl = document.createElement('div');
      const paintItems = () => {
        listEl.innerHTML = '';
        items.forEach((item, i) => {
          const line = document.createElement('div');
          line.style.cssText = 'display:flex;gap:8px;align-items:center;padding:3px 0;font-size:13px';
          const num = document.createElement('span');
          num.textContent = labelText === 'Ingredients' ? `${i + 1}.` : `${i + 1}.`;
          num.style.cssText = 'color:var(--muted,#999);min-width:20px';
          const body = document.createElement('span');
          body.style.cssText = 'flex:1';
          body.textContent = item;
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'tool-btn';
          x.textContent = '✕';
          x.addEventListener('click', () => {
            items.splice(i, 1);
            set(items);
            paintItems();
            draftSaveSoon();
            paintNeed();
          });
          line.append(num, body, x);
          listEl.appendChild(line);
        });
      };
      paintItems();
      wrap.append(field(labelText, row), listEl);
      void itemHint;
      return wrap;
    };
    pane.appendChild(listField('Ingredients', '2 cups flour', recipeForm.ingredients, (v) => (recipeForm.ingredients = v), ''));
    pane.appendChild(listField('Directions', 'Describe the next step', recipeForm.directions, (v) => (recipeForm.directions = v), ''));
    pane.appendChild(field('Chef’s notes', areaInput('Tips, substitutions, the story behind it', recipeForm.notes, (v) => (recipeForm.notes = v), 4)));
    const catWrap = document.createElement('div');
    catWrap.style.cssText = 'margin:10px 0';
    const catInput = textInput('Add a category', '', () => {});
    catInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && catInput.value.trim()) {
        recipeForm.categories.push(catInput.value.trim());
        catInput.value = '';
        draftSaveSoon();
        paintNeed();
      }
    });
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
    for (const [emoji, name] of RECIPE_CATEGORY_CHIPS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tool-btn';
      chip.textContent = `${emoji} ${name}`;
      chip.addEventListener('click', () => {
        if (!recipeForm.categories.includes(name)) recipeForm.categories.push(name);
        draftSaveSoon();
        paintNeed();
      });
      chips.appendChild(chip);
    }
    catWrap.append(field('Categories', catInput), chips);
    pane.appendChild(catWrap);
    return pane;
  }

  function buildReadsPane(): HTMLElement {
    const pane = document.createElement('div');
    const title = document.createElement('input');
    title.type = 'text';
    title.placeholder = 'Title';
    title.value = articleForm.title;
    title.style.cssText =
      'width:100%;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid var(--border,#333);color:var(--text,#fff);font-family:var(--font-display,Georgia,serif);font-size:32px;padding:4px 0;margin:4px 0 12px';
    title.addEventListener('input', () => {
      articleForm.title = title.value;
      draftSaveSoon();
      refreshPostState();
    });
    pane.appendChild(title);
    pane.appendChild(coverDrop('image'));
    pane.appendChild(field('Summary', areaInput('A sentence or two that readers see before they open it', articleForm.summary, (v) => (articleForm.summary = v))));
    pane.appendChild(field('Topics', textInput('Add a topic', '', (v) => {
      if (v.endsWith(' ') && v.trim()) {
        articleForm.topics.push(v.trim().replace(/^#/, ''));
        articleForm.topics = [...new Set(articleForm.topics)];
        v = '';
      }
      articleForm.body ||= articleForm.body;
    })));
    const toolbar = document.createElement('div');
    toolbar.style.cssText =
      'display:flex;gap:4px;border:1px solid var(--border,#333);border-radius:10px;padding:6px;margin-bottom:6px';
    const body = areaInput('Write your article. Markdown works: **bold**, ## headings, > quotes.', articleForm.body, (v) => {
      articleForm.body = v;
      paintCount();
      draftSaveSoon();
    }, 14);
    body.style.minHeight = '280px';
    const wrapSelection = (before: string, after = before) => {
      const at = body.selectionStart ?? body.value.length;
      const end = body.selectionEnd ?? at;
      body.value = body.value.slice(0, at) + before + body.value.slice(at, end) + after + body.value.slice(end);
      body.focus();
      articleForm.body = body.value;
      draftSaveSoon();
    };
    for (const [label, before, after] of [
      ['B', '**', '**'], ['I', '_', '_'], ['H', '## ', ''], ['>', '> ', ''],
      ['- ', '', ''], ['1. ', '', ''], ['<>', '`', '`'], ['🖼', '![](', ')']
    ] as [string, string, string][]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool-btn';
      b.textContent = label;
      b.addEventListener('click', () => wrapSelection(before, after));
      toolbar.appendChild(b);
    }
    pane.append(toolbar, body);
    return pane;
  }

  // ── paint per-tab extras (need hint, count) ──────────────────
  function paintNeed() {
    if (currentTab === 'recipes') {
      const missing: string[] = [];
      if (!recipeForm.name.trim()) missing.push('a name');
      if (!recipeForm.cover) missing.push('a photo');
      if (!recipeForm.ingredients.length) missing.push('ingredients');
      if (!recipeForm.directions.length) missing.push('directions');
      if (!recipeForm.categories.length) missing.push('a category');
      needEl.hidden = false;
      needEl.textContent = missing.length ? `Still needed: ${missing.join(', ')}` : '';
    } else if (currentTab === 'reads') {
      const missing: string[] = [];
      if (!articleForm.title.trim()) missing.push('a title');
      if (!articleForm.body.trim()) missing.push('the article itself');
      needEl.hidden = false;
      needEl.textContent = missing.length ? `Still needed: ${missing.join(' and ')}` : '';
    } else {
      needEl.hidden = true;
      needEl.textContent = '';
    }
  }

  function paintCount() {
    if (currentTab === 'reads') {
      const words = (articleForm.body.match(/\S+/g) || []).length;
      countEl.textContent = `${words} words · ${Math.max(1, Math.ceil(words / 220))} min read`;
    } else if (currentTab === 'notes' || currentTab === 'polls') {
      countEl.textContent = `${editorApi.getText().length}`;
    } else {
      countEl.textContent = '';
    }
  }

  // ── tabs and panes ───────────────────────────────────────────
  const tabsRow = page.querySelector('.compose-tabs') as HTMLElement;

  function setPreview(which: 'write' | 'preview') {
    showPreview = which === 'preview';
    subtabWrite.classList.toggle('active', !showPreview);
    subtabPreview.classList.toggle('active', showPreview);
    slotEl.innerHTML = '';
    slotEl.classList.remove('hidden');
    if (showPreview) {
      const preview = document.createElement('div');
      preview.className = 'compose-preview compose-preview-lg';
      preview.style.cssText = 'min-height:240px';
      if (currentTab === 'notes' || currentTab === 'polls') {
        composer.renderNotePreview(preview, SidecarCore.composeNoteContent(editorApi.getText(), media));
      } else {
        const note = document.createElement('p');
        note.style.cssText = 'color:var(--muted,#999);font-size:13px;padding:12px 4px';
        note.textContent = 'Preview lands with the longform port.';
        preview.appendChild(note);
      }
      slotEl.appendChild(preview);
      return;
    }
    setPane(currentTab, true);
  }

  function setPane(tab: MonoTab, keepPreview = false) {
    currentTab = tab;
    opts.onTabChange?.(tab);
    page.querySelectorAll<HTMLButtonElement>('.compose-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    countdownEl.classList.add('hidden');
    relayPopover.hidden = true;
    errEl.textContent = '';
    postBtn.textContent = currentTab === 'recipes' || currentTab === 'reads' ? 'Review' : 'Post';
    paintSegments();
    paintNeed();
    paintCount();
    if (showPreview && !keepPreview) {
      setPreview('preview');
      return;
    }
    slotEl.innerHTML = '';
    slotEl.classList.remove('hidden');
    if (tab === 'notes' || tab === 'polls') {
      slotEl.appendChild(editorApi.wrap);
      if (tab === 'polls') {
        if (!pollDraft) pollEditor.addBtn.click(); // Sidecar's own raise-the-poll path
        slotEl.appendChild(pollEditor.wrap);
        pollEditor.wrap.classList.remove('hidden');
      }
      editorApi.focus();
      refreshPostState();
      return;
    }
    if (tab === 'recipes') {
      slotEl.appendChild(buildRecipePane());
      postBtn.disabled = false;
      return;
    }
    if (tab === 'reads') {
      slotEl.appendChild(buildReadsPane());
      postBtn.disabled = false;
      return;
    }
  }

  subtabWrite.addEventListener('click', () => setPreview('write'));
  subtabPreview.addEventListener('click', () => setPreview('preview'));
  page.querySelectorAll<HTMLButtonElement>('.compose-tab').forEach((b) => {
    b.addEventListener('click', () => {
      showPreview = false;
      subtabWrite.classList.add('active');
      subtabPreview.classList.remove('active');
      setPane((b.dataset.tab || 'notes') as MonoTab);
    });
  });

  // ── post button state ────────────────────────────────────────
  function refreshPostState() {
    if (currentTab === 'recipes' || currentTab === 'reads') {
      postBtn.disabled = posting;
      return;
    }
    const hasBody = !!editorApi.getText().trim() || media.length > 0;
    const pollOk = currentTab !== 'polls' || !pollDraft || SidecarCore.pollDraftIsPostable(pollDraft);
    postBtn.disabled = posting || !hasBody || !pollOk;
  }

  postBtn.addEventListener('click', () => void onPost());

  // ── drafts button + pane ─────────────────────────────────────
  const draftsBtn = el<HTMLButtonElement>('drafts');
  draftsBtn.addEventListener('click', () => renderDraftsPane());

  // ── who is writing ───────────────────────────────────────────
  (async () => {
    const pubkey = deps.activePubkey() as string;
    if (!pubkey) return;
    const av = el('avatar');
    av.textContent = pubkey.slice(0, 4);
    const nameEl = el('name');
    nameEl.textContent = pubkey.slice(0, 10) + '…';
  })();

  // ── boot ─────────────────────────────────────────────────────
  restoreSavedDraft();
  setPane(currentTab);
  paintDraftsCount();

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
