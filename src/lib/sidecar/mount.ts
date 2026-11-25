/**
 * The Zap Cooking monocomposer: one composer, four tabs — Notes, Polls,
 * Recipes, Reads — Sidecar's composer structure, this app's order,
 * palette and icons (the phosphor set the old PostComposer used, single
 * color, never emoji). The kind tabs and the Write / Preview row are
 * button tabs — Sidecar's segmented switch — and under them the note editor with
 * the segment row (camera, GIF, emoji, proof of work, and this app's
 * relay toggle and schedule), the poll block with its options and runs-
 * for, the recipe form with cover, times, ingredients, directions,
 * categories and Review, and the article form with title, cover,
 * summary, topics and a markdown toolbar.
 *
 * Sidecar's composer core (vendor/sidecar/composer-core.js) is mounted
 * in a plain element, with sidecar-styles.css (7.5k lines written for a
 * page of its own: :root, *, element rules) fenced to it by CSS @scope —
 * see scopeCss.ts. It is not a shadow root: Chrome hides a shadow root's
 * caret from window.getSelection(), which the core reads for mentions,
 * emoji and pill navigation. zapcooking-theme.css maps the app's palette
 * onto Sidecar's var names, which is how the palette stays Zap Cooking's.
 *
 * Spike v1: Notes and Polls publish (countdown → sign → the chosen
 * relays, dry-run on ?dry=1). Recipes and Reads are laid out with their
 * forms and drafts; their publish lands with the longform port.
 */
import styles from '$lib/vendor/sidecar/sidecar-styles.css?raw';
import theme from '$lib/vendor/sidecar/zapcooking-theme.css?raw';
import { getCurrentRelays } from '$lib/nostr';
import { get } from 'svelte/store';
import { timerSettings, loadTimerSettings, saveTimerSettings } from '$lib/timerSettings';
// Host services first (they set window.SidecarI18n and window.NostrTools),
// then the core — the same order compose.html loads them in. The core is a
// dynamic, client-only import: it reads window at its top level, and the
// route never renders on the server.
import { applyAvatar, buildSidecarDeps, composerPool } from './host';
import { isScrollbarStyling, scopeStylesheet } from './scopeCss';
import { MONO_DRAFTS_LIST_KEY } from '$lib/monoComposerStore';
import {
  contentSum,
  listDrafts,
  loadBlanks,
  loadDrafts,
  removeDraft,
  storeDrafts,
  useDraftScope,
  writeDraft,
  type ComposerDraft,
  type CoreHelpers,
  type DraftFields,
  type DraftMedia,
  type PollDraft
} from '$lib/composerDrafts';
import { composerDraftSync } from '$lib/composerDraftsIO';
import type { ComponentType, SvelteComponent } from 'svelte';
import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
import ChartBarHorizontalIcon from 'phosphor-svelte/lib/ChartBarHorizontal';
import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
import NewspaperIcon from 'phosphor-svelte/lib/Newspaper';
import ImageIcon from 'phosphor-svelte/lib/Image';
import GifIcon from 'phosphor-svelte/lib/Gif';
import SmileyIcon from 'phosphor-svelte/lib/Smiley';
import HammerIcon from 'phosphor-svelte/lib/Hammer';
import GlobeIcon from 'phosphor-svelte/lib/Globe';
import ClockIcon from 'phosphor-svelte/lib/Clock';
import CalendarBlankIcon from 'phosphor-svelte/lib/CalendarBlank';
import FolderSimpleIcon from 'phosphor-svelte/lib/FolderSimple';
import CloudCheckIcon from 'phosphor-svelte/lib/CloudCheck';
import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
import DeviceMobileIcon from 'phosphor-svelte/lib/DeviceMobile';
import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
import TrashIcon from 'phosphor-svelte/lib/Trash';
import XCircleIcon from 'phosphor-svelte/lib/XCircle';
import CheckIcon from 'phosphor-svelte/lib/Check';
import XIcon from 'phosphor-svelte/lib/X';
import PlusIcon from 'phosphor-svelte/lib/Plus';
import TextBIcon from 'phosphor-svelte/lib/TextB';
import TextItalicIcon from 'phosphor-svelte/lib/TextItalic';
import TextHTwoIcon from 'phosphor-svelte/lib/TextHTwo';
import QuotesIcon from 'phosphor-svelte/lib/Quotes';
import ListBulletsIcon from 'phosphor-svelte/lib/ListBullets';
import ListNumbersIcon from 'phosphor-svelte/lib/ListNumbers';
import CodeIcon from 'phosphor-svelte/lib/Code';

export const MONO_TABS = [
  { id: 'notes', label: 'Notes', icon: PencilSimpleIcon },
  { id: 'polls', label: 'Polls', icon: ChartBarHorizontalIcon },
  { id: 'recipes', label: 'Recipes', icon: ForkKnifeIcon },
  { id: 'reads', label: 'Reads', icon: NewspaperIcon }
] as const;

export type MonoTab = (typeof MONO_TABS)[number]['id'];

// Every icon is a phosphor component rendered into the composer, so the
// composer wears the same single-color set as the rest of the app. Kept for
// destroy().
const mountedIcons: SvelteComponent[] = [];
function ph(Icon: ComponentType, size = 18): HTMLElement {
  const span = document.createElement('span');
  span.className = 'mono-ico';
  mountedIcons.push(new Icon({ target: span, props: { size } }));
  return span;
}
function iconButton(Icon: ComponentType, title: string, cls = 'tool-btn mono-icon-btn'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(ph(Icon));
  return b;
}

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
  renderNotePreview(el: HTMLElement, content: string): void;
  buildPollEditor(o: Record<string, unknown>): { wrap: HTMLElement; addBtn: HTMLButtonElement; paint(): void };
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
  /** Inside a modal: the modal is the sheet, so the composer drops its own
   * card (border, background, padding) and leaves the top-right corner to
   * the modal's close button. */
  inModal?: boolean;
  /** Draw a close button at the end of the head row (the modal's own X is
   * off, so there is one close button and it sits in the content column). */
  onClose?: () => void;
  onTabChange?: (tab: MonoTab) => void;
}

const RECIPE_CATEGORY_CHIPS = ['Turkey', 'Roast', 'Pie', 'Squash', 'Potato', 'Bread', 'Soup'];


export async function mountMonoComposer(container: HTMLElement, opts: MountOptions = {}) {
  const live = !!opts.live;
  // The core reads window at its own top level, so it loads here, in the
  // browser, after its globals shim has run.
  // The Emoji button's table (self.SidecarEmoji) first: the core reads it
  // when the picker is built, and without it the picker never opens.
  await import('$lib/vendor/sidecar/emoji-data.js');
  await import('$lib/vendor/sidecar/composer-core.js');
  let currentTab: MonoTab = opts.tab || 'notes';
  let posting = false;
  const allRelays = getCurrentRelays();
  const chosenRelays = new Set<string>(allRelays);

  const deps = buildSidecarDeps(live);
  const SidecarCore = (window as unknown as {
    SidecarCore: {
      installComposer: (d: Record<string, unknown>) => ComposerController & Record<string, unknown>;
      removeUrlFromEditor: (el: HTMLElement, url: string) => void;
      quoteEntriesFromPaste: (plain: string, media: unknown[]) => unknown[];
      composeNoteContent: (text: string, media: unknown[]) => string;
      // On the core itself, not the installed controller: it takes its pool
      // as an argument rather than reading deps.
      publishToRelays(o: Record<string, unknown>): Promise<PublishReport>;
      buildPollEditor(o: Record<string, unknown>): { wrap: HTMLElement; addBtn: HTMLButtonElement; paint(): void };
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
    .mono-ico { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
    .mono-icon-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; color: var(--muted); }
    .mono-icon-btn:not(:disabled):hover, .mono-icon-btn.on { color: var(--orange); }
    .mono-seg { flex: 1 1 0; padding: 9px 6px; }
    .mono-seg.hidden { display: none; }
    /* Button tabs: the kind row is Sidecar's segmented switch at full
       width, the Write / Preview row the same switch, compact. */
    .compose-modes.mono-kinds { display: flex; align-self: stretch; }
    .mono-kinds .compose-mode { flex: 1 1 0; justify-content: center; }
    .compose-mode .mono-ico { color: inherit; }
    /* Write / Preview: underline tabs, Sidecar's own .compose-tabs. */
    .mono-subrow { display: flex; align-items: flex-end; gap: 10px; border-bottom: 1px solid var(--border); }
    .mono-subrow .compose-tabs { border-bottom: none; margin: 0 0 -1px; }
    .mono-timer-pop { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
      border: 1px solid var(--border); border-radius: 10px; background: var(--bg-2); font-size: 13px; }
    .mono-timer-pop[hidden] { display: none; }
    .mono-timer-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
    .mono-timer-row input { accent-color: var(--orange); width: 16px; height: 16px; }
    .mono-timer-secs { display: flex; gap: 6px; }
    .mono-timer-secs .tool-btn { flex: 1; }
    .mono-timer-secs .tool-btn.on { border-color: var(--orange); color: var(--orange); }
    /* The footer and the old composer's wide Post bar: Post fills the row;
       while the send countdown runs, the bar fills left to right and a
       red Cancel pill sits beside it. */
    .mono-foot { display: flex; flex-direction: column; gap: 8px; }
    .mono-foot-meta { display: flex; align-items: center; gap: 10px; }
    .mono-foot-meta:has(.compose-status:empty) { display: none; }
    .mono-action-row { display: flex; align-items: center; gap: 8px; }
    .mono-cancel { flex-shrink: 0; padding: 10px 18px; border-radius: 9999px; border: none;
      font: inherit; font-size: 14px; font-weight: 500; background: #ef4444; color: #fff; cursor: pointer; }
    .mono-cancel[hidden] { display: none; }
    .mono-post { flex: 1; position: relative; overflow: hidden; border: none; border-radius: 9999px;
      padding: 11px 20px; font: inherit; font-size: 15px; font-weight: 600; color: #fff; white-space: nowrap;
      background: var(--color-action, var(--orange)); cursor: pointer; transition: opacity 0.15s; }
    .mono-post:not(:disabled):not(.mono-post--counting):hover { background: var(--color-action-hover, var(--orange)); }
    .mono-post:disabled { opacity: 0.5; cursor: not-allowed; }
    .mono-post-fill { position: absolute; inset: 0; width: 0; border-radius: inherit; pointer-events: none;
      background: var(--color-action, var(--orange)); }
    .mono-post--counting { background: var(--color-action-hover, var(--orange)); }
    .mono-post--counting .mono-post-fill { width: var(--fill, 0%); }
    .mono-post-label { position: relative; }
    .mono-need { font-size: 12px; color: var(--muted, #999); text-align: right; padding: 2px 4px; }
    /* The count sits at the right of the Write / Preview bar, on the tabs'
       baseline. */
    .mono-count { margin-inline-start: auto; padding-bottom: 7px; font-size: 12px; color: var(--muted, #999);
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mono-saved { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
    .mono-saved-check { color: var(--success); }
    /* Saved drafts: Sidecar's list — a row is the draft (opens it), with a
       trash icon beside it; the time and the relay state on one line. */
    .mono-drafts-pane { display: flex; flex-direction: column; gap: 8px; }
    /* While the list is open it is the sheet: everything below the tabs that
       belongs to writing steps aside, untouched. */
    .compose-sheet.mono-drafts-open > :not(.compose-head):not(.mono-kinds):not(.compose-drafts-pane) { display: none !important; }
    .mono-drafts-back { width: 100%; justify-content: center; margin-top: 4px; color: var(--text); }
    .mono-drafts-head { display: flex; align-items: center; gap: 8px; }
    .mono-drafts-title { flex: 1; font-weight: 600; font-size: 14px; }
    .mono-drafts-head .tool-btn { padding: 6px 10px; font-size: 12.5px; }
    .mono-drafts-status { margin: 0; font-size: 12px; color: var(--muted); min-height: 0; }
    .mono-drafts-status:empty { display: none; }
    .mono-drafts-empty { margin: 4px 0; font-size: 13px; color: var(--muted); }
    .mono-drafts-list { display: flex; flex-direction: column; gap: 8px; }
    .mono-draft { display: flex; align-items: stretch; min-width: 0; border-radius: 10px;
      background: var(--hover-soft); border: 1px solid var(--border); }
    .mono-draft:hover, .mono-draft.is-current { border-color: var(--gold-soft); }
    .mono-draft-open { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; text-align: start;
      padding: 10px 12px; background: none; border: none; cursor: pointer; color: var(--text); font: inherit; }
    .mono-draft-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .mono-draft-kind { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mono-draft-meta { margin-inline-start: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px;
      font-size: 12px; color: var(--muted); }
    .mono-draft-cloud.is-synced { color: var(--success); }
    .mono-draft-snip { font-size: 13px; color: var(--text-2); line-height: 1.45;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .mono-draft-del { border: none; background: none; flex-shrink: 0; padding: 0 12px; }
    .mono-toolbar { display: flex; gap: 4px; border: 1px solid var(--border); border-radius: 10px; padding: 6px; margin-bottom: 6px; }
    .mono-toolbar .tool-btn { padding: 6px 9px; }
    /* Sidecar's compose page owns a whole browser tab and centers the
       card in the viewport; here it is a block in the app's column, so
       it flows from the top. */
    .compose-page, .compose-body { min-height: 0; }
    .compose-body { padding: 0; }
    .compose-sheet { margin: 0; }
    /* Sidecar reserves the head's right edge for its full-size and close
       controls; neither exists here. */
    .compose-head { padding-inline-end: 0; }
    /* Saved drafts and close: one kind of object (44px, borderless, a 24px
       outline icon in the text color, the app modals' hover) — Sidecar's
       folder beside its close box — with the draft count in a capsule on
       the folder's corner. */
    .mono-drafts, .mono-close { position: relative; flex: none; width: 44px; height: 44px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; border-radius: 9999px; color: var(--text); cursor: pointer;
      transition: background-color 0.15s ease-out; }
    .mono-drafts:hover, .mono-close:hover { background-color: rgba(255, 255, 255, 0.06); }
    .mono-drafts-count { position: absolute; top: 5px; inset-inline-end: 3px; min-width: 15px; height: 15px; padding: 0 4px;
      box-sizing: border-box; border-radius: 999px; font-size: 10px; font-weight: 700; line-height: 15px;
      text-align: center; color: #fff; background: var(--orange); }
    .mono-drafts-count:empty { display: none; }
    .mono-kinds .compose-mode { min-width: 0; }
    @media (max-width: 520px) {
      .compose-sheet { padding: 14px; border-radius: 14px; }
      .mono-kinds .compose-mode { padding: 7px 4px; gap: 5px; font-size: 12.5px; }
    }
    /* In the modal, the modal is the sheet. */
    /* :scope — inside @scope a selector is matched among the root's
       descendants unless it names the root itself. */
    :scope.mono-in-modal .compose-sheet { padding: 0; border: none; background: none; box-shadow: none; border-radius: 0; max-width: none; }
    /* The folder and, in the modal, the close button end the head row,
       inside the content column as in Sidecar: the close button's icon
       lines up with the content's right edge (the buttons are 44px around
       24px icons, so the row pulls 10px into the padding), the folder in
       the slot beside it. The row keeps the avatar's height: the 44px
       targets overhang it above and below. */
    .compose-head { margin-block: -9px; }
    .compose-head > .mono-drafts:last-child, .compose-head > .mono-close { margin-inline-end: -10px; }
    .mono-drafts + .mono-close { margin-inline-start: -6px; }
    /* Who is posting: a small avatar and name in the top strip, no caption
       (Sidecar's "Writing as this account" is for its account switcher). */
    .compose-head { gap: 10px; }
    .compose-who { gap: 8px; }
    .compose-av { width: 26px; height: 26px; }
    .compose-name { font-size: 13.5px; }
    .compose-editor { min-height: 260px; }
    .compose-sheet:has(.poll-editor:not(.hidden)) .compose-editor { min-height: 120px; }
  `;
  // Sidecar's defaults (its :root, now :scope) land on the root element;
  // the theme on the page element inside it overrides them with this
  // app's palette.
  styleEl.textContent = scopeStylesheet(
    styles + '\n' + theme + '\n' + monoStyles,
    '.mono-root',
    isScrollbarStyling
  );
  const root = document.createElement('div');
  root.className = 'mono-root' + (opts.inModal ? ' mono-in-modal' : '');
  container.append(styleEl, root);

  const page = document.createElement('div');
  page.className = 'compose-page';
  page.setAttribute('data-theme', 'zapcooking');
  root.appendChild(page);

  page.innerHTML = `
    <div class="compose-body">
      <main class="compose-sheet">
        <header class="compose-head">
          <div class="compose-who">
            <span class="avatar compose-av" data-mono="avatar"></span>
            <span class="compose-who-text">
              <span class="compose-name" data-mono="name">Loading…</span>
            </span>
          </div>
          <span class="mono-saved compose-saved" role="status" aria-live="polite"></span>
          <button type="button" class="mono-drafts" data-mono="drafts" title="Saved drafts" aria-label="Saved drafts"></button>
          ${opts.onClose ? '<button type="button" class="mono-close" data-mono="close" title="Close" aria-label="Close"></button>' : ''}
        </header>

        <div class="compose-modes mono-kinds" role="tablist" data-mono="kinds"></div>

        <div class="mono-subrow">
          <div class="compose-tabs" role="tablist">
            <button type="button" class="compose-tab active" data-mono="subtab-write">Write</button>
            <button type="button" class="compose-tab" data-mono="subtab-preview">Preview</button>
          </div>
          <span class="mono-count" data-mono="count" aria-live="polite"></span>
        </div>

        <div data-mono="reply-slot"></div>
        <div data-mono="slot"></div>
        <div class="compose-thumbs" data-mono="thumbs"></div>

        <div class="compose-actions" data-mono="actions"></div>
        <div data-mono="relay-popover" hidden></div>
        <p class="error" data-mono="err"></p>
        <div class="mono-need" data-mono="need" hidden></div>

        <footer class="mono-foot">
          <div class="mono-foot-meta">
            <span class="compose-status" data-mono="status"></span>
          </div>
          <div class="mono-action-row">
            <button type="button" class="mono-cancel" data-mono="cancel" hidden>Cancel</button>
            <button type="button" class="mono-post" data-mono="post" disabled>
              <span class="mono-post-fill" aria-hidden="true"></span>
              <span class="mono-post-label" data-mono="post-label">Post</span>
            </button>
          </div>
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
  const cancelBtn = el<HTMLButtonElement>('cancel');
  const postLabel = el('post-label');
  const postLabelText = () => (currentTab === 'recipes' || currentTab === 'reads' ? 'Review' : 'Post');
  const thumbsEl = el('thumbs');
  const relayPopover = el('relay-popover');
  const actionsEl = el('actions');
  const needEl = el('need');
  const countEl = el('count');
  const subtabPreview = el<HTMLButtonElement>('subtab-preview');
  const subtabWrite = el<HTMLButtonElement>('subtab-write');

  const kindsEl = el('kinds');
  for (const t of MONO_TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'compose-mode' + (t.id === currentTab ? ' active' : '');
    b.dataset.tab = t.id;
    b.setAttribute('role', 'tab');
    b.append(ph(t.icon, 16), document.createTextNode(t.label));
    kindsEl.appendChild(b);
  }

  const draftsIcon = ph(FolderSimpleIcon, 24);
  const draftsCountEl = document.createElement('span');
  draftsCountEl.className = 'mono-drafts-count';
  draftsCountEl.setAttribute('aria-hidden', 'true');

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
  // Notes and polls: composerDrafts.ts — one id per draft for its whole
  // life, kept on the device as you type, pushed to the account's draft
  // relays when the composer closes (only what changed), caught up when it
  // opens, and on Sync now. Recipes and reads keep one draft each on the
  // device until those tabs publish; they move to the recipe and article
  // draft stores then.
  const RECIPE_DRAFT_KEY = 'zapcooking_mono_recipe_draft';
  const ARTICLE_DRAFT_KEY = 'zapcooking_mono_article_draft';
  const LEGACY_DRAFT_KEY = 'zapcooking_mono_draft';
  // The note or poll being written: its draft id, or null before it has
  // content. Kept while the editor is emptied, so typing again continues the
  // same draft rather than starting another.
  let activeId: string | null = null;
  const me = () => (deps.activePubkey() as string) || '';
  useDraftScope(me());
  const draftSync = composerDraftSync(SidecarCore as unknown as CoreHelpers, deps.NT);

  function noteFields(): DraftFields {
    return {
      kind: pollDraft ? 'poll' : 'note',
      text: editorApi.getText(),
      media: media.slice() as DraftMedia[],
      poll: (pollDraft as PollDraft | null) || null
    };
  }

  const recipeHasContent = () =>
    !!(recipeForm.name.trim() || recipeForm.summary.trim() || recipeForm.ingredients.length ||
      recipeForm.directions.length || recipeForm.notes.trim());
  const articleHasContent = () =>
    !!(articleForm.title.trim() || articleForm.body.trim() || articleForm.summary.trim());

  function writeLocal(key: string, value: unknown) {
    try {
      if (value) localStorage.setItem(key, JSON.stringify({ ...(value as object), at: Date.now() }));
      else localStorage.removeItem(key);
    } catch (_) {
      /* storage blocked: the draft is still on screen */
    }
  }
  function readLocal<T>(key: string): (T & { at: number }) | null {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (_) {
      return null;
    }
  }

  /** Write what is on screen to the device, now. */
  function saveNow() {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }
    if (currentTab === 'recipes') writeLocal(RECIPE_DRAFT_KEY, recipeHasContent() ? recipeForm : null);
    else if (currentTab === 'reads') writeLocal(ARTICLE_DRAFT_KEY, articleHasContent() ? articleForm : null);
    else {
      const r = writeDraft(loadDrafts(), loadBlanks(), activeId, noteFields(), Date.now());
      activeId = r.id;
      storeDrafts(r.all, r.blanks);
    }
    // A green check, not the drafts folder: "saved" is a state, the folder
    // is the place drafts are kept.
    const check = ph(CheckIcon, 13);
    check.classList.add('mono-saved-check');
    savedEl.replaceChildren(check, document.createTextNode('Saved'));
    paintDraftsCount();
    if (page.querySelector('.compose-drafts-pane')) paintDraftsPane();
  }

  function draftSaveSoon() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveNow, 600);
  }

  /** Drafts pushed and pulled: blanks first, then what changed, then a read. */
  function syncDrafts() {
    return draftSync.sync().then((report) => {
      paintDraftsCount();
      if (page.querySelector('.compose-drafts-pane')) paintDraftsPane();
      return report;
    });
  }

  function localRows(): { tab: MonoTab; label: string; snippet: string; at: number }[] {
    const rows: { tab: MonoTab; label: string; snippet: string; at: number }[] = [];
    const recipe = readLocal<typeof recipeForm>(RECIPE_DRAFT_KEY);
    if (recipe) rows.push({ tab: 'recipes', label: 'Recipe', snippet: recipe.name || recipe.summary || '', at: recipe.at });
    const article = readLocal<typeof articleForm>(ARTICLE_DRAFT_KEY);
    if (article)
      rows.push({ tab: 'reads', label: 'Article', snippet: article.title || article.summary || article.body.slice(0, 60), at: article.at });
    return rows;
  }

  function paintDraftsCount() {
    const count = listDrafts(loadDrafts()).length + localRows().length;
    draftsCountEl.textContent = count ? String(count) : '';
  }

  /** Put a saved note or poll in the editor, as the draft being written. */
  function openDraft(d: ComposerDraft) {
    saveNow(); // the one on screen stays saved, as its own draft
    activeId = d.id;
    editorApi.setText(d.text);
    media.length = 0;
    media.push(...(d.media as { url: string; isVideo?: boolean }[]));
    pollDraft = d.poll ? JSON.parse(JSON.stringify(d.poll)) : null;
    renderThumbs();
    setPane(d.kind === 'poll' ? 'polls' : 'notes');
    if (d.kind === 'poll') pollEditor.paint();
    refreshPostState();
  }

  /** A fresh note: the one on screen is kept as a draft. */
  function startNewDraft() {
    saveNow();
    activeId = null;
    editorApi.setText('');
    media.length = 0;
    pollDraft = null;
    renderThumbs();
    setPane('notes');
    savedEl.replaceChildren();
  }

  function relTime(ms: number) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return new Date(ms).toLocaleDateString();
  }

  // The list takes the writing area's place while it is open, as in
  // Sidecar: the folder toggles it, and opening a draft, New note or Back
  // to writing return to the editor.
  function closeDraftsPane() {
    page.querySelector('.compose-drafts-pane')?.remove();
    page.querySelector('.compose-sheet')?.classList.remove('mono-drafts-open');
  }

  function renderDraftsPane() {
    if (page.querySelector('.compose-drafts-pane')) {
      closeDraftsPane();
      return;
    }
    paintDraftsPane();
  }

  function paintDraftsPane() {
    let pane = page.querySelector('.compose-drafts-pane') as HTMLElement | null;
    if (!pane) {
      pane = document.createElement('div');
      pane.className = 'compose-drafts-pane mono-drafts-pane';
      kindsEl.after(pane);
    }
    page.querySelector('.compose-sheet')?.classList.add('mono-drafts-open');
    pane.replaceChildren();

    const head = document.createElement('div');
    head.className = 'mono-drafts-head';
    const title = document.createElement('span');
    title.className = 'mono-drafts-title';
    title.textContent = 'Saved drafts';
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'tool-btn mono-icon-btn';
    newBtn.append(ph(PlusIcon, 16), document.createTextNode('New note'));
    newBtn.addEventListener('click', () => {
      startNewDraft();
      closeDraftsPane();
    });
    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'tool-btn mono-icon-btn';
    syncBtn.append(ph(ArrowsClockwiseIcon, 16), document.createTextNode('Sync now'));
    syncBtn.disabled = !me();
    syncBtn.title = me() ? 'Send changed drafts to your relays and read theirs' : 'Sign in to sync drafts';
    syncBtn.addEventListener('click', async () => {
      saveNow();
      syncBtn.disabled = true;
      syncStatus.textContent = 'Syncing…';
      const report = await syncDrafts();
      syncStatus.textContent = report.failed
        ? 'Some drafts could not reach your relays.'
        : 'Up to date with your relays.';
      syncBtn.disabled = false;
    });
    head.append(title, newBtn, syncBtn);
    const syncStatus = document.createElement('p');
    syncStatus.className = 'mono-drafts-status';
    syncStatus.setAttribute('role', 'status');
    pane.append(head, syncStatus);

    const notes = listDrafts(loadDrafts());
    const locals = localRows();
    if (!notes.length && !locals.length) {
      const empty = document.createElement('p');
      empty.className = 'mono-drafts-empty';
      empty.textContent = 'No saved drafts yet. What you write is saved as you go.';
      pane.append(empty, backButton());
      return;
    }

    const list = document.createElement('div');
    list.className = 'mono-drafts-list';
    const row = (
      label: string, snippet: string, at: number, state: 'synced' | 'pending' | 'device',
      onOpen: () => void, onDelete: () => void, current: boolean
    ) => {
      const item = document.createElement('div');
      item.className = 'mono-draft' + (current ? ' is-current' : '');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'mono-draft-open';
      const top = document.createElement('span');
      top.className = 'mono-draft-top';
      const kind = document.createElement('span');
      kind.className = 'mono-draft-kind';
      kind.textContent = current ? `${label} · writing now` : label;
      const meta = document.createElement('span');
      meta.className = 'mono-draft-meta';
      const cloud =
        state === 'synced' ? ph(CloudCheckIcon, 14) : state === 'pending' ? ph(CloudArrowUpIcon, 14) : ph(DeviceMobileIcon, 14);
      cloud.classList.add('mono-draft-cloud', `is-${state}`);
      cloud.title =
        state === 'synced' ? 'On your relays' : state === 'pending' ? 'Goes to your relays when the composer closes' : 'On this device only';
      meta.append(document.createTextNode(relTime(at)), cloud);
      top.append(kind, meta);
      const snip = document.createElement('span');
      snip.className = 'mono-draft-snip';
      snip.textContent = snippet.trim() || 'Pictures only';
      open.append(top, snip);
      open.addEventListener('click', onOpen);
      const del = iconButton(TrashIcon, 'Delete this draft');
      del.classList.add('mono-draft-del');
      del.addEventListener('click', onDelete);
      item.append(open, del);
      list.appendChild(item);
    };

    for (const d of notes) {
      const state = !me() ? 'device' : d.relay && d.relay.sum === contentSum(d) ? 'synced' : 'pending';
      row(
        d.kind === 'poll' ? 'Poll' : 'Note', d.text || (d.poll ? d.poll.options.filter(Boolean).join(' / ') : ''),
        d.updatedAt, state,
        () => { openDraft(d); closeDraftsPane(); },
        () => {
          const r = removeDraft(loadDrafts(), loadBlanks(), d.id);
          storeDrafts(r.all, r.blanks);
          if (activeId === d.id) {
            activeId = null;
            editorApi.setText('');
            media.length = 0;
            pollDraft = null;
            renderThumbs();
            refreshPostState();
          }
          paintDraftsCount();
          paintDraftsPane();
          if (me()) void syncDrafts(); // the relay copy goes now, not at close
        },
        d.id === activeId
      );
    }
    for (const l of locals) {
      row(l.label, l.snippet, l.at, 'device',
        () => { setPane(l.tab); closeDraftsPane(); },
        () => {
          writeLocal(l.tab === 'recipes' ? RECIPE_DRAFT_KEY : ARTICLE_DRAFT_KEY, null);
          paintDraftsCount();
          paintDraftsPane();
        },
        false
      );
    }
    pane.append(list, backButton());
  }

  function backButton() {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'tool-btn mono-icon-btn mono-drafts-back';
    back.append(ph(PencilSimpleIcon, 16), document.createTextNode('Back to writing'));
    back.addEventListener('click', () => {
      closeDraftsPane();
      editorApi.focus();
    });
    return back;
  }

  /** The note and poll draft from before drafts had ids, and the recipe or
   *  article that shared its one slot, moved to where they live now. */
  function migrateLegacyDraft() {
    const old = readLocal<{ text?: string; media?: DraftMedia[]; poll?: PollDraft; recipe?: unknown; article?: unknown }>(
      LEGACY_DRAFT_KEY
    );
    if (!old) return;
    if (old.recipe) writeLocal(RECIPE_DRAFT_KEY, old.recipe);
    else if (old.article) writeLocal(ARTICLE_DRAFT_KEY, old.article);
    else {
      const r = writeDraft(loadDrafts(), loadBlanks(), null, {
        kind: old.poll ? 'poll' : 'note', text: old.text || '', media: old.media || [], poll: old.poll || null
      }, old.at || Date.now());
      storeDrafts(r.all, r.blanks);
    }
    try {
      localStorage.removeItem(LEGACY_DRAFT_KEY);
      localStorage.removeItem(MONO_DRAFTS_LIST_KEY);
    } catch (_) {}
  }

  /** On open: the most recent note or poll draft back in the editor, and
   *  the recipe and article drafts back in their forms. */
  function restoreSavedDraft() {
    migrateLegacyDraft();
    const recipe = readLocal<typeof recipeForm>(RECIPE_DRAFT_KEY);
    if (recipe) Object.assign(recipeForm, recipe);
    const article = readLocal<typeof articleForm>(ARTICLE_DRAFT_KEY);
    if (article) Object.assign(articleForm, article);
    const latest = listDrafts(loadDrafts())[0];
    if (latest) {
      activeId = latest.id;
      editorApi.setText(latest.text);
      media.push(...(latest.media as { url: string; isVideo?: boolean }[]));
      pollDraft = latest.poll ? JSON.parse(JSON.stringify(latest.poll)) : null;
    }
    renderThumbs();
    refreshPostState();
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

  // ── publish: countdown bar → sign → relays ───────────────────
  const signAuth = (template: Record<string, unknown>) =>
    deps.call({
      type: 'SIDECAR_OWNER_SIGN',
      event: template,
      expectedPubkey: deps.activePubkey()
    });

  function doPublish(signed: SidecarEvent) {
    const NT = deps.NT as { utils: { normalizeURL: (u: string) => string } };
    const relays = chosenRelays.size ? [...chosenRelays] : allRelays;
    return SidecarCore.publishToRelays({
      pool: composerPool(live),
      relays,
      signed,
      params: { onauth: signAuth },
      normalize: (u: string) => NT.utils.normalizeURL(u)
    });
  }

  // The send countdown is the old composer's: the Post button becomes a
  // wide bar that fills as it counts ("Post now (Ns)" — press it to skip
  // the wait), a Cancel pill beside it. Its on/off and length are the same
  // timerSettings the old composer kept, so the choice carries over.
  // Nothing is signed until the count runs out: a canceled post never
  // reaches the signer.
  let countdownRaf: number | null = null;

  function postValidation(): string | null {
    if (currentTab !== 'notes' && currentTab !== 'polls')
      return 'Recipes and Reads go out through Review — that lands with the longform port.';
    if (currentTab === 'polls' && pollDraft && !SidecarCore.pollDraftIsPostable(pollDraft))
      return 'A poll needs its question and two filled options.';
    return null;
  }

  function onPost() {
    if (posting) return;
    if (countdownRaf !== null) {
      // Pressing the filling bar is "Post now".
      stopCountdown();
      void publishNow();
      return;
    }
    const problem = postValidation();
    if (problem) {
      errEl.textContent = problem;
      return;
    }
    errEl.textContent = '';
    const settings = get(timerSettings);
    if (settings.postCountdownEnabled && settings.postCountdownSecs > 0) startCountdown(settings.postCountdownSecs);
    else void publishNow();
  }

  function startCountdown(secs: number) {
    const started = performance.now();
    cancelBtn.hidden = false;
    postBtn.classList.add('mono-post--counting');
    const tick = () => {
      const remaining = Math.max(0, secs - (performance.now() - started) / 1000);
      postBtn.style.setProperty('--fill', `${(1 - remaining / secs) * 100}%`);
      postLabel.textContent = `Post now (${Math.ceil(remaining)}s)`;
      if (remaining <= 0) {
        stopCountdown();
        void publishNow();
        return;
      }
      countdownRaf = requestAnimationFrame(tick);
    };
    countdownRaf = requestAnimationFrame(tick);
    refreshPostState();
  }

  function stopCountdown() {
    if (countdownRaf !== null) cancelAnimationFrame(countdownRaf);
    countdownRaf = null;
    cancelBtn.hidden = true;
    postBtn.classList.remove('mono-post--counting');
    postBtn.style.removeProperty('--fill');
    postLabel.textContent = postLabelText();
    refreshPostState();
  }

  async function publishNow() {
    const problem = postValidation();
    if (problem) {
      errEl.textContent = problem;
      return;
    }
    const asPoll = currentTab === 'polls' && !!pollDraft;
    posting = true;
    postLabel.textContent = 'Posting…';
    refreshPostState();
    errEl.textContent = '';
    const nowSecs = Math.floor(Date.now() / 1000);
    const text = composer.serializeEditor(editorApi.editor);
    const template = {
      kind: asPoll ? SidecarCore.POLL_KIND : 1,
      // A poll carries no attachments (the core keeps the two apart); a
      // note's pictures ride in its content, as the preview shows them.
      content: asPoll ? text : SidecarCore.composeNoteContent(text, media),
      created_at: nowSecs,
      tags: [
        ['client', 'zapcooking'],
        ...(asPoll ? SidecarCore.buildPollTags(pollDraft, nowSecs, [...chosenRelays]) : [])
      ]
    };
    try {
      statusEl.textContent = 'Signing…';
      const signed = (await signAuth(template)) as SidecarEvent;
      await actuallyPublish(signed);
    } catch (e) {
      errEl.textContent = String((e as Error).message || e);
      statusEl.textContent = '';
      posting = false;
      postLabel.textContent = postLabelText();
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
      // Posted: the draft is done. Removed here and its relay copy blanked
      // now, before the editor is cleared, so the clearing writes nothing.
      if (draftTimer) {
        clearTimeout(draftTimer);
        draftTimer = null;
      }
      if (activeId) {
        const r = removeDraft(loadDrafts(), loadBlanks(), activeId);
        storeDrafts(r.all, r.blanks);
        activeId = null;
        if (me()) void syncDrafts();
      }
      editorApi.setText('');
      media.length = 0;
      renderThumbs();
      paintDraftsCount();
      savedEl.textContent = '';
      if (pollDraft) {
        pollDraft = null;
        if (currentTab === 'polls') setPane('polls');
      }
      errEl.textContent = `Sent to ${report.accepted.length}/${report.total} relays.`;
    } catch (e) {
      errEl.textContent = String((e as Error).message || e);
    } finally {
      statusEl.textContent = '';
      posting = false;
      postLabel.textContent = postLabelText();
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
      paintCount();
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

  // ── the segment row (the kept icons) ─────────────────────────
  // Built once, before the poll editor: the core's poll editor paints at
  // construction and reaches for the media button (a poll and attachments
  // are one or the other), so that button has to exist already. Each tab
  // shows its own subset; nothing is rebuilt on a tab switch.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,video/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) void uploadFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  function segment(Icon: ComponentType, title: string, onclick: () => void, disabled = false) {
    const b = iconButton(Icon, title, 'tool-btn mono-icon-btn mono-seg');
    b.disabled = disabled;
    b.addEventListener('click', onclick);
    return b;
  }
  const toggleRelays = () => {
    if (relayPopover.hidden) renderRelayPopover();
    else relayPopover.hidden = true;
  };
  const segs = {
    camera: segment(ImageIcon, 'Add a picture or video', () => fileInput.click()),
    gif: segment(GifIcon, 'GIF search', () => {
      actionsEl.appendChild(gifPicker.wrap);
      gifPicker.addBtn.click();
    }),
    emoji: segment(SmileyIcon, 'Emoji', () => {
      actionsEl.appendChild(emojiPicker.wrap);
      emojiPicker.addBtn.click();
    }),
    pow: segment(HammerIcon, 'Proof of work lands next', () => {}, true),
    relays: segment(GlobeIcon, 'Where this posts', toggleRelays),
    timer: segment(ClockIcon, 'Send countdown', () => toggleTimerPopover()),
    schedule: segment(CalendarBlankIcon, 'Schedule lands with the scheduler port', () => {}, true)
  };
  const SEGS_BY_TAB: Record<MonoTab, (keyof typeof segs)[]> = {
    notes: ['camera', 'gif', 'emoji', 'pow', 'relays', 'timer', 'schedule'],
    polls: ['emoji', 'pow', 'relays', 'timer', 'schedule'],
    recipes: [],
    reads: []
  };
  actionsEl.append(fileInput, ...Object.values(segs));

  // The send countdown's settings, as the old composer's clock button had
  // them: on/off and 5/10/15/30 seconds, saved to the same timerSettings.
  void loadTimerSettings();
  const timerPopover = document.createElement('div');
  timerPopover.className = 'mono-timer-pop';
  timerPopover.hidden = true;
  actionsEl.after(timerPopover);
  function paintTimerPopover() {
    const settings = get(timerSettings);
    timerPopover.replaceChildren();
    const row = document.createElement('label');
    row.className = 'mono-timer-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = settings.postCountdownEnabled;
    box.addEventListener('change', () => {
      void saveTimerSettings({ ...get(timerSettings), postCountdownEnabled: box.checked });
      paintTimerPopover();
    });
    row.append(document.createTextNode('Send countdown'), box);
    timerPopover.appendChild(row);
    if (settings.postCountdownEnabled) {
      const secsRow = document.createElement('div');
      secsRow.className = 'mono-timer-secs';
      for (const secs of [5, 10, 15, 30]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tool-btn' + (settings.postCountdownSecs === secs ? ' on' : '');
        b.textContent = `${secs}s`;
        b.addEventListener('click', () => {
          void saveTimerSettings({ ...get(timerSettings), postCountdownSecs: secs });
          paintTimerPopover();
        });
        secsRow.appendChild(b);
      }
      timerPopover.appendChild(secsRow);
    }
    segs.timer.classList.toggle('on', settings.postCountdownEnabled);
  }
  function toggleTimerPopover() {
    timerPopover.hidden = !timerPopover.hidden;
    if (!timerPopover.hidden) paintTimerPopover();
  }
  const unsubTimer = timerSettings.subscribe((t) => segs.timer.classList.toggle('on', t.postCountdownEnabled));

  function paintSegments() {
    const shown = SEGS_BY_TAB[currentTab];
    for (const [name, b] of Object.entries(segs)) {
      b.style.display = shown.includes(name as keyof typeof segs) ? '' : 'none';
    }
    actionsEl.style.display = shown.length ? '' : 'none';
    timerPopover.hidden = true;
  }

  // ── polls: the same draft, raised on the Polls tab ──────────
  const pollEditor = SidecarCore.buildPollEditor({
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
    mediaBtn: () => segs.camera,
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
      const add = iconButton(PlusIcon, 'Add');
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
          const x = iconButton(XIcon, 'Remove');
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
    for (const name of RECIPE_CATEGORY_CHIPS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tool-btn';
      chip.textContent = name;
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
    toolbar.className = 'mono-toolbar';
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
    for (const [Icon, title, before, after] of [
      [TextBIcon, 'Bold', '**', '**'],
      [TextItalicIcon, 'Italic', '_', '_'],
      [TextHTwoIcon, 'Heading', '## ', ''],
      [QuotesIcon, 'Quote', '> ', ''],
      [ListBulletsIcon, 'Bulleted list', '- ', ''],
      [ListNumbersIcon, 'Numbered list', '1. ', ''],
      [CodeIcon, 'Code', '`', '`'],
      [ImageIcon, 'Picture by address', '![](', ')']
    ] as [ComponentType, string, string, string][]) {
      const b = iconButton(Icon, title);
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

  // Sidecar's stylesheet keys the note-only parts (the poll block among
  // them) off the sheet's data-mode, so the sheet carries Sidecar's name
  // for the tab's kind.
  const SHEET_MODE: Record<MonoTab, string> = { notes: 'note', polls: 'note', recipes: 'recipe', reads: 'article' };
  const sheetEl = page.querySelector('.compose-sheet') as HTMLElement;

  // The tab change is reported at the END, after the pane is built. A
  // listener may answer by calling setTab, and building a pane can run
  // Svelte's flush synchronously (each icon is a component, and creating
  // one flushes pending updates) — reported first, that answer ran in the
  // middle of the build and the recipe form was drawn twice.
  function setPane(tab: MonoTab, keepPreview = false) {
    // A save still waiting belongs to the tab being left: write it first.
    if (draftTimer) saveNow();
    paintPane(tab, keepPreview);
    opts.onTabChange?.(tab);
  }

  function paintPane(tab: MonoTab, keepPreview: boolean) {
    currentTab = tab;
    sheetEl.dataset.mode = SHEET_MODE[tab];
    kindsEl.querySelectorAll<HTMLButtonElement>('.compose-mode').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    if (countdownRaf !== null) stopCountdown();
    relayPopover.hidden = true;
    errEl.textContent = '';
    postLabel.textContent = postLabelText();
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
  kindsEl.querySelectorAll<HTMLButtonElement>('.compose-mode').forEach((b) => {
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

  postBtn.addEventListener('click', () => onPost());
  cancelBtn.addEventListener('click', () => stopCountdown());

  // ── drafts button + pane ─────────────────────────────────────
  const draftsBtn = el<HTMLButtonElement>('drafts');
  draftsBtn.append(draftsIcon, draftsCountEl);
  draftsBtn.addEventListener('click', () => renderDraftsPane());
  const closeBtn = page.querySelector<HTMLButtonElement>('[data-mono="close"]');
  if (closeBtn && opts.onClose) {
    closeBtn.appendChild(ph(XCircleIcon, 24));
    closeBtn.addEventListener('click', () => opts.onClose?.());
  }

  // ── who is writing ───────────────────────────────────────────
  (async () => {
    const pubkey = deps.activePubkey() as string;
    if (!pubkey) {
      el('name').textContent = 'Not signed in';
      return;
    }
    const nameEl = el('name');
    nameEl.textContent = pubkey.slice(0, 10) + '…';
    const profile = (await (deps.fetchPreviewProfile as (pk: string) => Promise<{ name: string; picture?: string } | null>)(pubkey));
    if (!profile) return;
    nameEl.textContent = profile.name;
    applyAvatar(el('avatar'), profile);
  })();

  // ── boot ─────────────────────────────────────────────────────
  restoreSavedDraft();
  setPane(currentTab);
  // Catch-up: a draft changed since its last push (the tab was killed, the
  // phone backgrounded it) goes up now, and the relays' drafts come in.
  if (me()) void syncDrafts();
  paintDraftsCount();

  return {
    destroy() {
      // Closing is the push: what is on screen is saved, then what changed
      // goes to the relays (the sync outlives the composer).
      saveNow();
      if (me()) void draftSync.sync();
      if (countdownRaf !== null) cancelAnimationFrame(countdownRaf);
      unsubTimer();
      mountedIcons.splice(0).forEach((c) => c.$destroy());
      root.remove();
      styleEl.remove();
    },
    /** Open the saved drafts list (opens, never toggles it shut). */
    showDrafts() {
      if (!page.querySelector('.compose-drafts-pane')) renderDraftsPane();
    },
    setTab(tab: MonoTab) {
      // Already there: nothing to rebuild (the modal echoes back the tab
      // the composer just reported).
      if (tab === currentTab) return;
      setPane(tab);
    }
  };
}
