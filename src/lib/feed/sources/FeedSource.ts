/**
 * The FeedSource interface — one implementation per feed tab.
 *
 * A FeedSource owns:
 *   - Its own NDK subscription lifecycle (initial fetch + optional
 *     live sub + pagination).
 *   - The per-instance state surface (events, loading flags, error)
 *     exposed via `state` as a Svelte-readable store.
 *   - Memoization caches (food filter, repost expansion) scoped to
 *     this instance so the source can be cleanly garbage-collected
 *     when the user switches tabs.
 *
 * Sources are created by `getSource(tab, opts)` in `index.ts`; the
 * monolith and Phase 5's FeedContainer both go through that factory
 * so the construction path stays uniform.
 */

import type { Readable } from 'svelte/store';
import type NDK from '@nostr-dev-kit/ndk';
import type { FeedSourceState, FeedTab } from '../types';

/** Options every source accepts. Tab-specific extras (e.g. profile
 * authorPubkey, replies vs top-level scope) are added in each source's
 * own factory call. */
export interface FeedSourceOpts {
  ndk: NDK;
  /** Honored by the global source (and the others via inheritance) —
   * when true, the source applies the food-content filter; when false,
   * it returns all events from its tab's relay set. Defaults to true
   * (false only for profile views, set by the caller). */
  foodFilterEnabled?: boolean;
  /** Profile view: restrict to a single author. When set, the global
   * source uses the user's outbox relays for this author. */
  authorPubkey?: string;
  /** Profile view: restrict to top-level notes or replies only. */
  authorScope?: 'all' | 'top-level' | 'replies';
  /** When true (default), the source reads the IndexedDB cache first
   * and displays warm-cache events while a fresh fetch runs in the
   * background. Set to false for a forced relay fetch (refresh
   * button, pull-to-refresh). */
  useCache?: boolean;
}

/** Minimum surface any FeedSource exposes. */
export interface FeedSource {
  /** Tag identifying which tab this source serves. */
  readonly tab: FeedTab;
  /** Reactive state — subscribe in components to render. */
  readonly state: Readable<FeedSourceState>;
  /** Kick off the initial load and open the realtime sub. Idempotent —
   * calling more than once is a no-op while the first call is in
   * flight; safe to invoke from onMount. */
  start(): Promise<void>;
  /** Pagination — fetch the next page of older events. Resolves when
   * the in-flight fetch settles. No-op while a previous loadMore is
   * still running. */
  loadMore(): Promise<void>;
  /** Re-run the initial load (no cache) and reset state. Used by
   * pull-to-refresh and the "Refresh Feed" button. */
  refresh(): Promise<void>;
  /** Stop the source: closes the realtime sub, cancels in-flight
   * fetches via abort signals where possible, and prevents further
   * state writes. Once stopped, the source must be discarded — call
   * `getSource()` again for a fresh instance. */
  stop(): void;
}
