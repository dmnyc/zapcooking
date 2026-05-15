/**
 * Event helpers shared by every FeedSource — extracted verbatim from
 * FoodstrFeedOptimized.svelte so parity is preserved.
 *
 * Pure functions where possible; `expandRepostEvent` and the tag-only
 * variant need an NDK instance to construct synthetic NDKEvents, so
 * those take ndk as a parameter rather than reaching into a store.
 */

import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

// ────────────────────────────────────────────────────────────────────
// Time window
// ────────────────────────────────────────────────────────────────────

export const ONE_DAY_SECONDS = 24 * 60 * 60;
export const THREE_DAYS_SECONDS = 3 * 24 * 60 * 60;
export const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
export const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export type TimeWindowMode = 'initial' | 'pagination' | 'realtime';

export interface TimeWindow {
  since: number;
  until?: number;
}

export interface TimeWindowOpts {
  /** Tab mode — `following` / `replies` use a shorter initial window
   * since the relay set is narrower. */
  filterMode: 'global' | 'following' | 'replies' | 'members' | 'garden';
  /** Newest event already loaded (for `realtime` mode). 0 means none. */
  lastEventTime: number;
  /** Oldest event already loaded (for `pagination` mode). 0 means none. */
  oldestEventSortTime: number;
}

/**
 * Compute the relay subscription window. Matches the monolith's
 * `calculateTimeWindow` line-for-line.
 *
 *   - `initial`: 3 days for following / replies, 7 days for everything else.
 *   - `pagination`: extends back from the oldest event's sort time,
 *     clamped to a 30-day floor.
 *   - `realtime`: 1 second past the newest event we've seen, or the
 *     last hour if we have none.
 *
 * The `now` parameter is exposed for testability — production callers
 * leave it at the default (current wall clock in unix seconds).
 */
export function calculateTimeWindow(
  mode: TimeWindowMode,
  opts: TimeWindowOpts,
  now: number = Math.floor(Date.now() / 1000)
): TimeWindow {
  switch (mode) {
    case 'initial':
      if (opts.filterMode === 'following' || opts.filterMode === 'replies') {
        return { since: now - THREE_DAYS_SECONDS };
      }
      return { since: now - SEVEN_DAYS_SECONDS };
    case 'pagination': {
      const oldest = opts.oldestEventSortTime || now;
      return {
        since: Math.max(oldest - SEVEN_DAYS_SECONDS, now - THIRTY_DAYS_SECONDS),
        until: oldest - 1
      };
    }
    case 'realtime':
      return { since: opts.lastEventTime > 0 ? opts.lastEventTime + 1 : now - 3600 };
    default:
      return { since: now - ONE_DAY_SECONDS };
  }
}

// ────────────────────────────────────────────────────────────────────
// Event reply / repost helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Return the timestamp to sort the event by. For NIP-18 reposts the
 * monolith attaches `_repostCreatedAt` on the expanded inner event so
 * a repost of an old note surfaces with the repost's recency, not the
 * inner's creation time. We keep the same convention.
 */
export function getEventSortTime(event: NDKEvent | null | undefined): number {
  if (!event) return 0;
  return (event as any)._repostCreatedAt || event.created_at || 0;
}

/**
 * Classify a kind-1 / kind-1068 event as a reply or top-level note.
 *
 * - No `e` tags → top-level.
 * - Any `e` tag with marker `reply` / `root` / unmarked → reply.
 * - Only `mention` markers → not a reply.
 * - Unknown markers → reply (safe default).
 */
export function isReply(event: NDKEvent): boolean {
  if (event.kind !== 1 && event.kind !== 1068) return false;
  const eTags = event.tags.filter((t) => Array.isArray(t) && t[0] === 'e' && t[1]);
  if (eTags.length === 0) return false;
  return eTags.some((tag) => {
    const marker = (tag[3] || '').toLowerCase();
    if (marker === 'reply') return true;
    if (marker === 'root') return true;
    if (!marker) return true;
    if (marker === 'mention') return false;
    return true;
  });
}

/** Attach repost metadata onto an expanded inner event. */
function applyRepostMetadata(source: NDKEvent, inner: NDKEvent): NDKEvent {
  (inner as any)._repostedBy = source.pubkey;
  (inner as any)._repostId = source.id;
  (inner as any)._repostCreatedAt = source.created_at;
  return inner;
}

/** Build an NDKEvent from the JSON body of a kind-6 repost. */
function buildFromEmbeddedJson(
  ndk: NDK,
  event: NDKEvent,
  inner: any
): NDKEvent | null {
  if (!inner || typeof inner !== 'object' || !inner.id) return null;
  if (inner.kind !== 1 && inner.kind !== 1068) return null;
  const innerEvent = new NDKEvent(ndk, inner);
  innerEvent.id = inner.id;
  innerEvent.pubkey = inner.pubkey;
  innerEvent.kind = inner.kind;
  innerEvent.content = inner.content || '';
  innerEvent.tags = Array.isArray(inner.tags) ? inner.tags : [];
  innerEvent.created_at = inner.created_at;
  innerEvent.sig = inner.sig;
  return applyRepostMetadata(event, innerEvent);
}

/** Build a placeholder NDKEvent for a tag-only kind-6 repost. */
function buildFromTags(ndk: NDK, event: NDKEvent): NDKEvent | null {
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const eventTag = tags.find(
    (t) => Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string' && t[1]
  );
  const kindTag = tags.find(
    (t) => Array.isArray(t) && t[0] === 'k' && typeof t[1] === 'string' && t[1]
  );
  const pubkeyTag = tags.find(
    (t) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string' && t[1]
  );
  const id = eventTag?.[1];
  if (!id) return null;
  const parsedKind = kindTag ? Number.parseInt(kindTag[1] as string, 10) : NaN;
  const kind = Number.isFinite(parsedKind) ? parsedKind : 1;
  if (kind !== 1 && kind !== 1068) return null;
  const innerEvent = new NDKEvent(ndk);
  innerEvent.id = id;
  innerEvent.pubkey = pubkeyTag?.[1] || '';
  innerEvent.kind = kind;
  innerEvent.content = '';
  innerEvent.tags = [];
  return applyRepostMetadata(event, innerEvent);
}

/**
 * Expand a NIP-18 kind-6 repost into its underlying kind-1/1068
 * event, carrying repost metadata so the feed can render a "Reposted
 * by" header. Tries the embedded-JSON path first (most clients) and
 * falls back to tag-only parsing.
 *
 * Returns the event unchanged if it's not a kind-6 repost.
 * Returns null only when neither path identifies a supported inner.
 */
export function expandRepostEvent(ndk: NDK, event: NDKEvent): NDKEvent | null {
  if (event.kind !== 6) return event;
  const raw = typeof event.content === 'string' ? event.content.trim() : '';
  if (raw) {
    try {
      const inner = JSON.parse(raw);
      const expanded = buildFromEmbeddedJson(ndk, event, inner);
      if (expanded) return expanded;
    } catch {
      // fall through to tag-based path
    }
  }
  return buildFromTags(ndk, event);
}

// ────────────────────────────────────────────────────────────────────
// Mute list — localStorage-cached
// ────────────────────────────────────────────────────────────────────

/**
 * Read the muted pubkeys list from localStorage. Cached against a
 * key derived from the input so repeated calls within a single render
 * pass don't re-parse JSON.
 */
export function createMutedUsersReader(getUserPubkey: () => string) {
  let cachedKey: string | null = null;
  let cachedList: string[] = [];
  return function getMutedUsers(): string[] {
    const pubkey = getUserPubkey();
    if (!pubkey) return [];
    const key = `mutedUsers:${pubkey}`;
    if (cachedKey === key) return cachedList;
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem('mutedUsers');
      const parsed = raw ? JSON.parse(raw) : [];
      cachedList = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      cachedList = [];
    }
    cachedKey = key;
    return cachedList;
  };
}
