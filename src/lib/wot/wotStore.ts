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

const state = writable<{ status: WotState; pubkey: string; result: WotResult | null }>({
  status: 'idle',
  pubkey: '',
  result: null
});

/** The built set (16-char key prefixes), per the account it belongs to. */
export const wotSet: Writable<ReadonlySet<string>> = writable(new Set());

export const wotState: Writable<WotState> = writable('idle');

/** Re-exported for the spam gate: unknown always means in-network. */
export { inNetwork } from './wot';

let inflight: Promise<WotResult | null> | null = null;

/**
 * Build (or reuse) the set for `pubkey`. Single-flight: overlapping calls share the run
 * in flight, and a set for the same account never rebuilds mid-session. A failed or
 * partial build still publishes what it gathered — the set narrows rather than
 * vanishing, and `inNetwork`'s fail-open reads a vanished set as "everyone".
 */
export async function buildWot(
  ndk: NDK,
  pubkey: string,
  opts: { force?: boolean } = {}
): Promise<WotResult | null> {
  const current = get(state);
  if (opts.force && inflight) {
    // A rebuild asked for while a build runs: let it finish, then go again.
    try {
      await inflight;
    } catch {
      /* the retry below starts clean */
    }
    return buildWot(ndk, pubkey);
  }
  if (inflight && current.pubkey === pubkey) return inflight;
  if (!opts.force && current.status === 'ready' && current.pubkey === pubkey && current.result) {
    return current.result;
  }
  // Hop one rides on the app's kind:3 cache; loading it is idempotent and shared.
  await loadFollowListProfiles().catch(() => {});
  const follows = [...getFollowedPubkeys()];
  if (!follows.length) return null;

  state.set({ status: 'building', pubkey, result: current.result });
  inflight = (async () => {
    let result: WotResult | null = null;
    try {
      const muted = new Set<string>();
      get(mutedPubkeys).forEach((pk) => muted.add(pk.slice(0, 16)));
      result = await build({
        me: pubkey,
        follows,
        // One REQ per chunk of seeds, collecting their p-tags through the same
        // newest-wins, deduped rule every other reader of replaceable events uses.
        // A chunk the pool cannot answer throws, which `build` reads as "narrowed"
        // rather than "empty".
        fetchFollowsOf: async (chunk) => {
          const events = await ndk.fetchEvents(
            { kinds: [3], authors: chunk },
            { closeOnEose: true, groupable: false }
          );
          return followsFromEvents(
            [...events].map((ev) => ({
              pubkey: ev.pubkey,
              created_at: ev.created_at,
              tags: ev.tags
            }))
          );
        }
      });
    } catch {
      result = null;
    } finally {
      inflight = null;
    }
    state.set({ status: result && result.follows > 0 ? 'ready' : 'idle', pubkey, result });
    return result;
  })();
  return inflight;
}
