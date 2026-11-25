/**
 * The web-of-trust builder for zap.cooking — Sidecar's getWotSet pattern on NDK.
 *
 * Hop one is the kind:3 list the app already holds (followListCache); hop two is a chunked
 * kind:3 fetch over the pool, run gently in the background. The built set is what the
 * nspam judge hides outside of: verdicts never touch anyone in-network, and until the set
 * is ready nothing is hidden at all (fail open — see wot.ts).
 *
 * V1 keeps the set in memory only, one per account, rebuilt per session: a six-figure key
 * set would sit uncomfortably close to localStorage quota, and the build costs a few
 * seconds in the background once per login. Sidecar persists its set for a day; that is
 * an optimization to revisit if rebuilds are ever noticeable.
 */

import NDK from '@nostr-dev-kit/ndk';
import { get, writable, type Writable } from 'svelte/store';
import { getFollowedPubkeys, loadFollowListProfiles } from '$lib/followListCache';
import { mutedPubkeys } from '$lib/muteListStore';
import { build, followsFromEvents, type WotResult } from './wot';

export type WotState = 'idle' | 'building' | 'ready';

/** The built set (16-char key prefixes). Empty and unbuilt read the same: fail open. */
export const wotSet: Writable<ReadonlySet<string>> = writable(new Set());

export const wotState: Writable<WotState> = writable('idle');

/** Re-exported for the spam gate: unknown always means in-network. */
export { inNetwork } from './wot';

// The account the published set belongs to and the result behind it — the ready-cache
// for buildWot's single-flight logic. The stores above are what everyone else reads.
let builtForPubkey = '';
let lastResult: WotResult | null = null;
let inflight: Promise<WotResult | null> | null = null;

// Relays that never send EOSE must not leave the status stuck on "building" forever;
// a timed-out chunk throws, which `build` reads as "narrowed" rather than "empty".
const CHUNK_TIMEOUT_MS = 8000;

/**
 * Build (or reuse) the set for `pubkey`. Single-flight: overlapping calls share the run
 * in flight, and a set for the same account never rebuilds mid-session — pass
 * `{ force: true }` to discard the cached set and crawl again. A failed or partial build
 * still publishes what it gathered — the set narrows rather than vanishing, and
 * `inNetwork`'s fail-open reads a vanished set as "everyone".
 */
export async function buildWot(
  ndk: NDK,
  pubkey: string,
  opts: { force?: boolean } = {}
): Promise<WotResult | null> {
  if (opts.force && inflight) {
    // A rebuild asked for while a build runs: let it finish, then fall through and
    // start again — force must not be swallowed by the ready-cache on the way back.
    try {
      await inflight;
    } catch {
      /* the rebuild below starts clean */
    }
  }
  if (!opts.force) {
    if (inflight) return inflight;
    if (builtForPubkey === pubkey && lastResult) return lastResult;
  }

  // Hop one rides on the app's kind:3 cache; loading it is idempotent and shared.
  await loadFollowListProfiles().catch(() => {});
  const follows = [...getFollowedPubkeys()];
  if (!follows.length) {
    console.warn('[Wot] no follow list loaded — nothing to build from');
    return null;
  }

  wotState.set('building');
  inflight = (async () => {
    try {
      const muted = new Set<string>();
      get(mutedPubkeys).forEach((pk) => muted.add(pk.slice(0, 16)));
      console.info(`[Wot] building from ${follows.length} follows…`);
      const result = await build({
        me: pubkey,
        follows,
        // One REQ per chunk of seeds, collecting their p-tags through the same
        // newest-wins, deduped rule every other reader of replaceable events uses.
        fetchFollowsOf: async (chunk) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const events = await Promise.race([
              ndk.fetchEvents(
                { kinds: [3], authors: chunk },
                { closeOnEose: true, groupable: false }
              ),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('wot chunk timeout')), CHUNK_TIMEOUT_MS);
              })
            ]);
            return followsFromEvents(
              [...events].map((ev) => ({
                pubkey: ev.pubkey,
                created_at: ev.created_at,
                tags: ev.tags
              }))
            );
          } finally {
            clearTimeout(timer);
          }
        }
      });
      lastResult = result;
      builtForPubkey = pubkey;
      wotSet.set(result.set);
      wotState.set(result.follows > 0 ? 'ready' : 'idle');
      console.info(
        `[Wot] built: ${result.set.size} in network (${result.qualified} qualified of ` +
          `${result.seen} seen; ${result.expanded}/${result.follows} follows expanded)`
      );
      return result;
    } catch (e) {
      console.warn('[Wot] build failed:', e);
      wotState.set('idle');
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
