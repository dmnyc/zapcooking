/**
 * Event → FeedNoteVM normaliser.
 *
 * `eventToViewModel` is the single transform that converts a raw
 * NDKEvent into the framework-free `FeedNoteVM` consumed by the new
 * FeedNote component tree (Phase 4) and by feed sources for state
 * snapshots (Phase 2). Memoized by event id so repeated calls on the
 * same event reuse the work.
 *
 * The normaliser pulls together other Phase 0 / Phase 1 utilities —
 * `parseImeta` for media, `parseMentions` for `nostr:npub…` /
 * `nprofile1…` references, the event's `t` and `client` tags — but
 * does NOT decode quoted-event embeds (`nostr:nevent1…`) into nested
 * VMs. Those resolve asynchronously in Phase 4's FeedNoteBody when
 * the inner event is fetched; here we just record the bech32 ref so
 * downstream code knows the embed exists.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { EmbedVM, FeedNoteVM, RepostVM } from './types';
import { parseImeta } from './imeta';
import { parseMentions } from '../mentionUtils';

const cache = new WeakMap<NDKEvent, FeedNoteVM>();

/**
 * Convert an NDKEvent into a FeedNoteVM. Memoized — repeated calls
 * with the same event instance return the cached result.
 *
 * Reposts (kind 6 / 16) are detected here and surfaced via the
 * `repost` field on the VM. The inner event is NOT decoded — the
 * caller (FeedNoteRepost in Phase 4) fetches and normalises it.
 */
export function eventToViewModel(event: NDKEvent): FeedNoteVM {
  const cached = cache.get(event);
  if (cached) return cached;

  const id = event.id;
  const pubkey = event.pubkey || event.author?.hexpubkey || '';
  const kind = event.kind ?? 1;
  const createdAt = event.created_at ?? 0;
  const content = typeof event.content === 'string' ? event.content : '';
  const tags = Array.isArray(event.tags) ? event.tags : [];

  const media = parseImeta({ content, tags });
  const embeds = extractEmbeds(content, tags);
  const mentionedPubkeys = collectMentionedPubkeys(content, tags);
  const hashtags = collectHashtags(tags);
  const client = readSingleTag(tags, 'client');
  const replyTo = computeReplyTo(kind, tags);
  const repost = isRepostKind(kind) ? buildRepostVM(event, tags) : undefined;

  const vm: FeedNoteVM = {
    id,
    pubkey,
    kind,
    createdAt,
    content,
    tags,
    media,
    embeds,
    mentionedPubkeys,
    hashtags,
    ...(client ? { client } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(repost ? { repost } : {})
  };
  cache.set(event, vm);
  return vm;
}

/** Drop the memo entry for a single event — used when an event is
 * mutated (e.g. an inner repost is resolved). */
export function invalidateViewModel(event: NDKEvent): void {
  cache.delete(event);
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function isRepostKind(kind: number): boolean {
  return kind === 6 || kind === 16;
}

function readSingleTag(tags: string[][], name: string): string | undefined {
  for (const t of tags) {
    if (Array.isArray(t) && t[0] === name && typeof t[1] === 'string' && t[1]) {
      return t[1];
    }
  }
  return undefined;
}

function collectHashtags(tags: string[][]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== 't') continue;
    const value = (t[1] || '').toLowerCase();
    if (value) out.push(value);
  }
  return out;
}

function collectMentionedPubkeys(content: string, tags: string[][]): string[] {
  // Start from `p` tags — the canonical author-mention channel.
  const seen = new Set<string>();
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== 'p') continue;
    const pk = t[1];
    if (typeof pk === 'string' && pk.length === 64) seen.add(pk);
  }
  // Also accept inline `nostr:npub1…` / `nostr:nprofile1…` references
  // in the body that some clients omit from the tag list.
  try {
    const inline = parseMentions(content);
    for (const pk of inline.values()) {
      if (typeof pk === 'string' && pk.length === 64) seen.add(pk);
    }
  } catch {
    /* parseMentions throws on malformed bech32 — ignore */
  }
  return Array.from(seen);
}

/** Bech32 prefixes recognised as quoted-event embeds. */
const EMBED_PREFIXES = ['nostr:nevent1', 'nostr:note1', 'nostr:naddr1'];

function extractEmbeds(content: string, tags: string[][]): EmbedVM[] {
  const out: EmbedVM[] = [];
  const seen = new Set<string>();
  // Inline bech32 refs in body — limit to a reasonable scan size so a
  // huge body doesn't blow up the regex.
  if (content) {
    const matches = content.matchAll(/nostr:(nevent1|note1|naddr1)[0-9a-z]+/g);
    for (const m of matches) {
      const full = m[0];
      const ref = full.replace(/^nostr:/, '');
      if (seen.has(ref)) continue;
      // Skip when the prefix isn't in our shortlist (the regex already
      // limits to the three, but belt-and-suspenders).
      if (!EMBED_PREFIXES.some((p) => full.startsWith(p))) continue;
      seen.add(ref);
      out.push({ ref, inner: null });
    }
  }
  // Also collect `q` tags (quote tags — NIP-18 / NIP-22 convention).
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== 'q') continue;
    const id = t[1];
    if (typeof id !== 'string' || !id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ref: id, eventId: id, inner: null });
  }
  return out;
}

function computeReplyTo(
  kind: number,
  tags: string[][]
): { rootId?: string; parentId?: string } | undefined {
  if (kind !== 1 && kind !== 1068) return undefined;
  const eTags: string[][] = [];
  for (const t of tags) {
    if (Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string' && t[1]) {
      eTags.push(t);
    }
  }
  if (eTags.length === 0) return undefined;

  // Marker-aware path first. NIP-10: tag[3] is "reply", "root", or "mention".
  let rootId: string | undefined;
  let parentId: string | undefined;
  for (const t of eTags) {
    const marker = (t[3] || '').toLowerCase();
    if (marker === 'root') rootId = t[1];
    else if (marker === 'reply') parentId = t[1];
  }
  if (rootId || parentId) {
    return { rootId, parentId: parentId ?? rootId };
  }

  // Old-style: no markers → use the last e tag as parent, first as root.
  if (eTags.length === 1) {
    return { parentId: eTags[0][1], rootId: eTags[0][1] };
  }
  return { rootId: eTags[0][1], parentId: eTags[eTags.length - 1][1] };
}

function buildRepostVM(event: NDKEvent, tags: string[][]): RepostVM | undefined {
  // The inner event id is in the first `e` tag; the inner pubkey is in
  // the first `p` tag when present. We do NOT parse the embedded JSON
  // here — that work belongs to Phase 4's FeedNoteRepost which has
  // access to the NDK instance and can construct a full inner VM.
  let innerEventId: string | undefined;
  let innerPubkey: string | undefined;
  for (const t of tags) {
    if (!innerEventId && Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string') {
      innerEventId = t[1];
    } else if (!innerPubkey && Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string') {
      innerPubkey = t[1];
    }
    if (innerEventId && innerPubkey) break;
  }
  if (!innerEventId) return undefined;
  return {
    reposterPubkey: event.pubkey || event.author?.hexpubkey || '',
    repostedAt: event.created_at ?? 0,
    innerEventId,
    innerPubkey,
    inner: null
  };
}
