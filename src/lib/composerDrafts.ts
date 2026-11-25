/**
 * The composer's note and poll drafts: kept on the device as you type,
 * pushed to the account's draft relays (NIP-37, kind 31234) when the
 * composer closes, caught up when it next opens, and on "Sync now".
 * See docs/handoffs/composer-feature-parity.md, slice C5.
 *
 * ONE DRAFT, ONE ID, FOR ITS WHOLE LIFE. A draft's id IS its d-tag, and
 * the local store is keyed by it, so there is never more than one copy of
 * a draft here and a push always replaces the relay copy rather than
 * adding one:
 * - an id is allocated when a draft first has content (never on open,
 *   never for an empty draft);
 * - editing, switching tabs, restoring and every push reuse it;
 * - a draft read from the relays keeps the d-tag it came with;
 * - posting or emptying a draft removes it here and queues a blank of its
 *   relay copy (the same d, newer, with nothing in it), so it cannot come
 *   back from a relay that still holds it.
 *
 * Notes go to the relays in Sidecar's shape (k=1, the inner event is the
 * note that would be published), so the same draft opens in either app.
 * Polls go as k=1068 with their options; the duration is not resolved
 * until the poll is posted.
 *
 * Pushing is gated on a fingerprint of the content: a draft whose content
 * has not changed since its last push is never sent again, so opening and
 * closing the composer sends nothing.
 */

/** Keyed per account: one account's drafts are never pushed, or shown, as
 *  another's on a shared device. */
export const COMPOSER_DRAFTS_KEY = 'zapcooking_composer_drafts_v1';
/** Relay copies waiting to be blanked: d -> { k, at }. Survives a reload. */
export const COMPOSER_BLANKS_KEY = 'zapcooking_composer_draft_blanks_v1';

export const DRAFT_WRAP_KIND = 31234;
export const NOTE_KIND = 1;
export const POLL_KIND = 1068;
const TTL_SECS = 90 * 86400; // NIP-40 expiration, as Sidecar sets it
const NIP44_MAX_PLAINTEXT = 65535;

export type DraftKind = 'note' | 'poll';

export interface DraftMedia {
  url?: string;
  quote?: string;
  isVideo?: boolean;
  alt?: string;
  [key: string]: unknown;
}

export interface PollDraft {
  options: string[];
  multiple: boolean;
  ends?: { kind: string; secs?: number; at?: number };
}

/** Where the relay copy is: its d-tag, kind, when it was sent, and what. */
export interface RelayPointer {
  d: string;
  k: number;
  at: number;
  sum: string;
}

export interface ComposerDraft {
  id: string;
  kind: DraftKind;
  text: string;
  media: DraftMedia[];
  poll: PollDraft | null;
  createdAt: number;
  updatedAt: number;
  relay?: RelayPointer;
}

export type DraftMap = Record<string, ComposerDraft>;
export type BlankMap = Record<string, { k: number; at: number }>;

// ── content ────────────────────────────────────────────────────────

const trimmed = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

export function draftHasContent(d: Pick<ComposerDraft, 'text' | 'media' | 'poll'>): boolean {
  if (trimmed(d.text)) return true;
  if ((d.media || []).some((m) => m && (m.url || m.quote))) return true;
  return !!d.poll && d.poll.options.some((o) => trimmed(o));
}

/** A short fingerprint of what a person wrote; the push gate. */
export function contentSum(d: Pick<ComposerDraft, 'kind' | 'text' | 'media' | 'poll'>): string {
  const src = JSON.stringify([
    d.kind,
    trimmed(d.text),
    (d.media || []).map((m) => `${(m && (m.url || m.quote)) || ''}|${(m && m.alt) || ''}`),
    d.poll ? [d.poll.options.map(trimmed), !!d.poll.multiple, d.poll.ends || null] : null
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Changed since its last push (or never pushed), and worth pushing. */
export function needsPush(d: ComposerDraft): boolean {
  return draftHasContent(d) && (!d.relay || d.relay.sum !== contentSum(d));
}

export function newDraftId(nowMs: number, random: () => number = Math.random): string {
  const tail = Math.floor(random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `zapcooking-${Math.floor(nowMs / 1000)}-${tail}`;
}

// ── the local store (pure: maps in, maps out) ──────────────────────

export interface DraftFields {
  kind: DraftKind;
  text: string;
  media: DraftMedia[];
  poll: PollDraft | null;
}

/**
 * Write what is in the editor to the store.
 * - With content and no id: allocates the draft's one id.
 * - With content and an id: updates that draft (the id never changes).
 * - Emptied: removes the local copy and queues a blank of its relay copy.
 *   The id is still returned, so the open editor keeps working on the same
 *   draft: typing again re-creates it under the same id, not a new one.
 */
export function writeDraft(
  all: DraftMap,
  blanks: BlankMap,
  id: string | null,
  fields: DraftFields,
  nowMs: number,
  allocate: (nowMs: number) => string = newDraftId
): { all: DraftMap; blanks: BlankMap; id: string | null } {
  const nextAll = { ...all };
  const nextBlanks = { ...blanks };
  if (!draftHasContent(fields)) {
    if (id && nextAll[id]) {
      const gone = nextAll[id];
      delete nextAll[id];
      if (gone.relay) nextBlanks[id] = { k: gone.relay.k, at: gone.relay.at };
    }
    return { all: nextAll, blanks: nextBlanks, id };
  }
  const draftId = id || allocate(nowMs);
  const prev = nextAll[draftId];
  nextAll[draftId] = {
    id: draftId,
    ...fields,
    createdAt: prev ? prev.createdAt : nowMs,
    updatedAt: nowMs,
    ...(prev && prev.relay ? { relay: prev.relay } : {})
  };
  // Written again after it was emptied: the queued blank would erase it.
  delete nextBlanks[draftId];
  return { all: nextAll, blanks: nextBlanks, id: draftId };
}

/** A draft posted or deleted: gone here, its relay copy queued to blank. */
export function removeDraft(
  all: DraftMap,
  blanks: BlankMap,
  id: string
): { all: DraftMap; blanks: BlankMap } {
  const nextAll = { ...all };
  const nextBlanks = { ...blanks };
  const gone = nextAll[id];
  if (gone) {
    delete nextAll[id];
    if (gone.relay) nextBlanks[id] = { k: gone.relay.k, at: gone.relay.at };
  }
  return { all: nextAll, blanks: nextBlanks };
}

/** Newest first. */
export function listDrafts(all: DraftMap): ComposerDraft[] {
  return Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── relay shapes ───────────────────────────────────────────────────

export interface CoreHelpers {
  /** SidecarCore.draftToEvent: the note a draft would publish, or null. */
  draftToEvent(draft: unknown, o: Record<string, unknown>): Record<string, unknown> | null;
  /** SidecarCore.draftFromEvent: { text, media, replyTo? } or null. */
  draftFromEvent(ev: unknown, selfPubkey: string): { text: string; media: DraftMedia[]; replyTo?: unknown } | null;
}

/** The inner event: what Post would publish from this draft, unsigned. */
export function buildInner(
  d: ComposerDraft,
  o: { core: CoreHelpers; selfPubkey: string; NT: unknown; nowSecs: number }
): Record<string, unknown> | null {
  const client = ['client', 'zapcooking'];
  if (d.kind === 'poll' && d.poll) {
    const tags: string[][] = [client];
    d.poll.options.forEach((label, i) => {
      if (trimmed(label)) tags.push(['option', `o${i + 1}`, label.trim()]);
    });
    tags.push(['polltype', d.poll.multiple ? 'multiplechoice' : 'singlechoice']);
    // The duration as chosen; resolved to endsAt only when it is posted.
    if (d.poll.ends) tags.push(['zc-ends', JSON.stringify(d.poll.ends)]);
    return { kind: POLL_KIND, created_at: o.nowSecs, tags, content: trimmed(d.text) };
  }
  const inner = o.core.draftToEvent(
    { text: d.text, media: d.media },
    { selfPubkey: o.selfPubkey, NT: o.NT, now: o.nowSecs, clientTag: false }
  );
  if (!inner) return null;
  return { ...inner, tags: [client, ...((inner.tags as string[][]) || [])] };
}

/** The inner event back into a draft's fields; null when it is not one
 *  this composer can continue (a reply, or something else). */
export function parseInner(
  inner: unknown,
  k: number,
  o: { core: CoreHelpers; selfPubkey: string }
): DraftFields | null {
  if (!inner || typeof inner !== 'object') return null;
  const ev = inner as { kind?: unknown; content?: unknown; tags?: unknown };
  if (Number(ev.kind) !== k || typeof ev.content !== 'string' || !Array.isArray(ev.tags)) return null;
  const tags = (ev.tags as unknown[]).filter(
    (t): t is string[] => Array.isArray(t) && t.every((x) => typeof x === 'string')
  );
  if (k === POLL_KIND) {
    const options = tags.filter((t) => t[0] === 'option' && t[2]).map((t) => t[2]);
    while (options.length < 2) options.push('');
    const type = tags.find((t) => t[0] === 'polltype')?.[1];
    let ends: PollDraft['ends'];
    try {
      const raw = tags.find((t) => t[0] === 'zc-ends')?.[1];
      if (raw) ends = JSON.parse(raw);
    } catch {
      ends = undefined;
    }
    return {
      kind: 'poll',
      text: ev.content,
      media: [],
      poll: { options, multiple: type === 'multiplechoice', ...(ends ? { ends } : {}) }
    };
  }
  if (k !== NOTE_KIND) return null;
  const note = o.core.draftFromEvent(ev, o.selfPubkey);
  // A reply is continued from the note it answers, not from here.
  if (!note || note.replyTo) return null;
  return { kind: 'note', text: note.text, media: note.media || [], poll: null };
}

export function wrapTags(d: string, k: number, nowSecs: number): string[][] {
  return [
    ['d', d],
    ['k', String(k)],
    ['expiration', String(nowSecs + TTL_SECS)]
  ];
}

interface WrapEvent {
  id?: string;
  pubkey?: string;
  kind?: number;
  created_at: number;
  content: string;
  tags: string[][];
}

/**
 * The wraps that came back, down to the live drafts this composer writes:
 * the newest copy of each d (judged before anything is dropped, so an
 * older copy on a slow relay cannot bring back a deleted draft), then
 * the blanked and the expired dropped, and only k=1 and k=1068 kept.
 */
export function liveWraps(events: WrapEvent[], selfPubkey: string, nowSecs: number): WrapEvent[] {
  const byD = new Map<string, WrapEvent>();
  for (const ev of events || []) {
    if (!ev || ev.kind !== DRAFT_WRAP_KIND || ev.pubkey !== selfPubkey || !Array.isArray(ev.tags)) continue;
    const d = ev.tags.find((t) => t[0] === 'd')?.[1];
    if (typeof d !== 'string') continue;
    const cur = byD.get(d);
    if (!cur || ev.created_at > cur.created_at || (ev.created_at === cur.created_at && (ev.id || '') > (cur.id || ''))) {
      byD.set(d, ev);
    }
  }
  const live: WrapEvent[] = [];
  for (const ev of byD.values()) {
    if (!ev.content) continue;
    const exp = Number(ev.tags.find((t) => t[0] === 'expiration')?.[1]);
    if (exp && exp <= nowSecs) continue;
    const k = Number(ev.tags.find((t) => t[0] === 'k')?.[1]);
    if (k !== NOTE_KIND && k !== POLL_KIND) continue;
    live.push(ev);
  }
  return live.sort((a, b) => b.created_at - a.created_at);
}

/**
 * Relay drafts into the local store, keyed by d — so a draft is never
 * here twice. A local copy edited since its last push keeps the local
 * edit (it goes up on the next push); otherwise the newer relay copy
 * wins. A d queued for blanking is not brought back.
 */
export function mergeRemote(
  all: DraftMap,
  blanks: BlankMap,
  items: { d: string; k: number; at: number; fields: DraftFields }[]
): DraftMap {
  const next = { ...all };
  for (const it of items) {
    if (blanks[it.d]) continue;
    const local = next[it.d];
    const sum = contentSum(it.fields);
    if (local) {
      if (needsPush(local)) continue; // local edits win until they are pushed
      if (local.relay && local.relay.at >= it.at) continue;
    }
    next[it.d] = {
      id: it.d,
      ...it.fields,
      createdAt: local ? local.createdAt : it.at * 1000,
      updatedAt: local && local.updatedAt > it.at * 1000 ? local.updatedAt : it.at * 1000,
      relay: { d: it.d, k: it.k, at: it.at, sum }
    };
  }
  return next;
}

// ── persistence ────────────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// The account whose drafts the store holds; '' is signed out (kept on the
// device, never synced).
let scope = '';
export function useDraftScope(pubkey: string): void {
  scope = pubkey || '';
}
export const draftScope = () => scope;
const scoped = (key: string, who = scope) => `${key}:${who || 'anon'}`;

export const loadDrafts = (who = scope): DraftMap => readJson<DraftMap>(scoped(COMPOSER_DRAFTS_KEY, who), {});
export const loadBlanks = (who = scope): BlankMap => readJson<BlankMap>(scoped(COMPOSER_BLANKS_KEY, who), {});

export function storeDrafts(all: DraftMap, blanks: BlankMap, who = scope): void {
  try {
    localStorage.setItem(scoped(COMPOSER_DRAFTS_KEY, who), JSON.stringify(all));
    localStorage.setItem(scoped(COMPOSER_BLANKS_KEY, who), JSON.stringify(blanks));
  } catch {
    /* storage blocked: the draft is still in the editor */
  }
}

/** How many saved drafts an account has, read without loading the composer. */
export function composerDraftCount(pubkey: string): number {
  return Object.values(loadDrafts(pubkey)).filter((d) => d && draftHasContent(d)).length;
}

// ── sync ───────────────────────────────────────────────────────────

export interface SyncIO {
  core: CoreHelpers;
  NT: unknown;
  selfPubkey(): string;
  /** NIP-44 to self. */
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
  /** The relays drafts are sent to (the private list). */
  writeRelays(): Promise<string[]>;
  /** The relays drafts are read from (private list and write relays). */
  readRelays(): Promise<string[]>;
  /** Sign and publish; resolves when at least one relay took it. */
  publish(relays: string[], event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<void>;
  query(relays: string[], filter: Record<string, unknown>): Promise<WrapEvent[]>;
  now(): number;
}

export interface SyncReport {
  pushed: number;
  blanked: number;
  pulled: number;
  failed: number;
}

/**
 * One sync: blank what was posted or emptied, push what changed, then
 * read the relays and merge. Callers share an in-flight sync. Reads and
 * writes the store itself, so a sync that outlives the composer (one
 * started as it closed) still lands.
 */
export function createDraftSync(io: SyncIO) {
  let running: Promise<SyncReport> | null = null;

  async function pushOne(d: ComposerDraft): Promise<RelayPointer> {
    const nowSecs = Math.max(Math.floor(io.now() / 1000), d.relay ? d.relay.at + 1 : 0);
    const inner = buildInner(d, { core: io.core, selfPubkey: io.selfPubkey(), NT: io.NT, nowSecs });
    if (!inner) throw new Error('nothing to save');
    const plaintext = JSON.stringify(inner);
    if (new TextEncoder().encode(plaintext).length > NIP44_MAX_PLAINTEXT) throw new Error('too long for a relay draft');
    const k = Number(inner.kind);
    await io.publish(await io.writeRelays(), {
      kind: DRAFT_WRAP_KIND,
      created_at: nowSecs,
      tags: wrapTags(d.id, k, nowSecs),
      content: await io.encrypt(plaintext)
    });
    return { d: d.id, k, at: nowSecs, sum: contentSum(d) };
  }

  async function blankOne(d: string, prior: { k: number; at: number }): Promise<void> {
    const nowSecs = Math.max(Math.floor(io.now() / 1000), prior.at + 1);
    // Blanked wherever drafts are read from: another client may hold it there.
    await io.publish(await io.readRelays(), {
      kind: DRAFT_WRAP_KIND,
      created_at: nowSecs,
      tags: wrapTags(d, prior.k, nowSecs),
      content: ''
    });
  }

  async function run(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, blanked: 0, pulled: 0, failed: 0 };
    // The store and the signer must be the same account, for the whole run.
    const who = io.selfPubkey();
    if (!who || who !== scope) return report;
    const sameAccount = () => io.selfPubkey() === who;
    const loadDrafts_ = () => loadDrafts(who);
    const loadBlanks_ = () => loadBlanks(who);
    const store_ = (all: DraftMap, blanks: BlankMap) => storeDrafts(all, blanks, who);

    for (const [d, prior] of Object.entries(loadBlanks_())) {
      try {
        await blankOne(d, prior);
        if (!sameAccount()) return report;
        const blanks = loadBlanks_();
        delete blanks[d];
        store_(loadDrafts_(), blanks);
        report.blanked++;
      } catch {
        report.failed++;
      }
    }

    for (const d of listDrafts(loadDrafts_()).filter(needsPush)) {
      try {
        const ptr = await pushOne(d);
        if (!sameAccount()) return report;
        const all = loadDrafts_();
        // Only if it was not edited while it was going up.
        if (all[d.id] && contentSum(all[d.id]) === ptr.sum) {
          all[d.id] = { ...all[d.id], relay: ptr };
          store_(all, loadBlanks_());
        }
        report.pushed++;
      } catch {
        report.failed++;
      }
    }

    try {
      const me = who;
      const events = await io.query(await io.readRelays(), {
        kinds: [DRAFT_WRAP_KIND],
        authors: [me],
        '#k': [String(NOTE_KIND), String(POLL_KIND)],
        limit: 200
      });
      const items: { d: string; k: number; at: number; fields: DraftFields }[] = [];
      for (const ev of liveWraps(events, me, Math.floor(io.now() / 1000))) {
        const d = ev.tags.find((t) => t[0] === 'd')![1];
        const k = Number(ev.tags.find((t) => t[0] === 'k')![1]);
        try {
          const plain = await io.decrypt(ev.content);
          if (!plain.trim()) continue; // another client's way of deleting
          const fields = parseInner(JSON.parse(plain), k, { core: io.core, selfPubkey: me });
          if (fields && draftHasContent(fields)) items.push({ d, k, at: ev.created_at, fields });
        } catch {
          /* unopenable: left alone, never overwritten */
        }
      }
      if (!sameAccount()) return report;
      const blanks = loadBlanks_();
      const before = loadDrafts_();
      const merged = mergeRemote(before, blanks, items);
      report.pulled = Object.keys(merged).filter((id) => merged[id] !== before[id]).length;
      store_(merged, blanks);
    } catch {
      report.failed++;
    }
    return report;
  }

  return {
    sync(): Promise<SyncReport> {
      if (!running) running = run().finally(() => (running = null));
      return running;
    }
  };
}
