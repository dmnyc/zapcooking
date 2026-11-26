/**
 * The web-of-trust set behind spam hiding — a port of Sidecar's wot.js (MIT).
 *
 * WHY AN ALLOWLIST. zap.cooking's notification and reply filtering is thorough — muted
 * pubkeys, threads, words, hellthreads, and now the nspam verdicts — but every branch of it
 * is a DENYLIST, and a denylist cannot win against key rotation. Fresh keys arrive faster
 * than anyone can mute them. The only filter rotation cannot route around is "people I
 * already have a reason to trust".
 *
 * WHAT THE SET IS: you, everyone you follow, and everyone that AT LEAST TEN of your follows
 * follow. That last clause is the whole design. Taking anyone your follows follow is a weak
 * signal — one careless follow launders a stranger in — and on a real 1,066-follow list it
 * produces about 48.9k people, four fifths of them noise. Counting how many of your circle
 * vouch for someone cuts that to roughly 9.3k.
 *
 * HERE IT FILTERS, WHERE SIDECAR DEMOTED. Sidecar renders out-of-network notifications in a
 * collapsed group and hides nothing; zap.cooking has no such group, so the nspam verdicts
 * apply only OUTSIDE this set — inside it, nothing is ever hidden. The set itself never
 * hides anyone on its own.
 *
 * FAIL OPEN. An empty or failed set means everything is in-network (see inNetwork). The
 * follow-list code already carries this scar: a race that discarded results the moment it
 * lost "could wipe the entire follow list down to zero". A trust filter that fails CLOSED
 * hides your real correspondents whenever a relay is slow, and does it invisibly.
 *
 * The relay-pool code lives in wotStore.ts; keeping it out of here is what makes the
 * set-building testable at all.
 */

// 16 hex chars = 8 bytes of the pubkey. A full set can run to six figures of keys, and
// at 64 characters each that is megabytes of strings held for the life of the session;
// this cuts it to a quarter without changing any answer that matters. Collisions are
// ~n²/2^65, which at 100k keys is about one in four billion — and a collision lets a
// stranger through as in-network, which is the fail-open direction anyway.
export const KEY_LEN = 16;

// HOW MANY OF YOUR FOLLOWS HAVE TO VOUCH for someone before they count as in-network.
//
// Membership on a single mention is a weak signal, and weakest where it matters: one
// careless follow launders a stranger into your network. Counting votes instead is what
// separates "somebody you follow follows them" from "your circle knows them". Measured
// against a real 1,066-follow list, the difference is 48.9k people seen versus about
// 9.3k qualified — the raw two-hop set is four fifths noise.
//
// 10 is Wisp's tuned figure and a better starting point than one invented here.
export const THRESHOLD = 10;

// Relays cap authors per filter, and a 300-author REQ is refused outright by some.
export const CHUNK = 50;

// Chunks run in parallel, but gently. A 1,000-follow list is ~20 requests, and
// sequentially that is minutes for something nothing waits on. Four at a time turned out
// to crowd the relay pool hard enough that concurrent profile lookups failed and every
// name fell back to an npub. Two still finishes in a fraction of the sequential time and
// leaves room for the things the user is actually reading.
export const CONCURRENCY = 2;

export const short = (pk: string) => String(pk || '').slice(0, KEY_LEN);
export const isHexKey = (pk: unknown): pk is string =>
  typeof pk === 'string' && /^[0-9a-f]{64}$/i.test(pk);

export interface FollowListEvent {
  pubkey?: string;
  created_at?: number;
  tags?: string[][];
}

// ONE VOTE PER PERSON, NOT PER COPY OF THEIR LIST.
//
// A kind:3 is replaceable, and a pool query spans several relays, so the same person's
// follow list comes back once per relay that holds it. Counting every copy multiplies
// each vote by however many relays answered — with four relays, one follow could cast
// four votes, and roughly twice as many people cleared a threshold of 10 as should
// have. Newest created_at per author wins, which is the rule the store applies to every
// other replaceable event.
//
// Duplicate p tags inside one list are collapsed too: following someone twice is not
// two endorsements.
export function followsFromEvents(evs: FollowListEvent[]): string[] {
  const newest = new Map<string, FollowListEvent>();
  (evs || []).forEach((ev) => {
    if (!ev || !isHexKey(ev.pubkey)) return;
    const cur = newest.get(ev.pubkey);
    if (!cur || (ev.created_at || 0) > (cur.created_at || 0)) newest.set(ev.pubkey, ev);
  });
  const out: string[] = [];
  newest.forEach((ev) => {
    const seen = new Set<string>();
    (ev.tags || []).forEach((t) => {
      if (!t || t[0] !== 'p' || !isHexKey(t[1]) || seen.has(t[1])) return;
      seen.add(t[1]);
      out.push(t[1]);
    });
  });
  return out;
}

export interface BuildOptions {
  /** hex pubkey of the account (always in its own network) */
  me: string;
  /** hex pubkeys the account follows — hop one, already known */
  follows: string[];
  /**
   * hex pubkeys those people follow — hop two. Injected rather than imported: the relay
   * pool lives in wotStore.ts, and keeping it out of here is what makes this testable.
   * Called once per chunk and may reject; a chunk that fails is skipped rather than
   * failing the build, because a partial set still filters and an absent one filters
   * nothing.
   */
  fetchFollowsOf: (chunk: string[]) => Promise<string[]>;
  chunkSize?: number;
  threshold?: number;
  muted?: Set<string>;
  onProgress?: (expanded: number, total: number) => void;
}

export interface WotResult {
  set: Set<string>;
  seen: number;
  qualified: number;
  follows: number;
  expanded: number;
  threshold: number;
}

// Build the set.
export async function build(opts: BuildOptions): Promise<WotResult> {
  const o = opts;
  const me = isHexKey(o.me) ? o.me : '';
  const follows = (o.follows || []).filter(isHexKey);
  const chunkSize = o.chunkSize || CHUNK;
  const threshold = o.threshold == null ? THRESHOLD : o.threshold;
  const muted = o.muted instanceof Set ? o.muted : new Set<string>();

  // NOTHING TO STAND ON MEANS NO FILTER, and the set has to be genuinely EMPTY to say
  // so — inNetwork reads an empty set as "everyone". Seeding it with `me` first would
  // leave a one-entry set that is not empty and therefore filters, so a fresh account
  // with no follow list would see every notification it ever gets buried as
  // out-of-network. That is the exact inversion this is supposed to prevent.
  if (!follows.length || typeof o.fetchFollowsOf !== 'function') {
    return {
      set: new Set(),
      seen: 0,
      qualified: 0,
      follows: follows.length,
      expanded: 0,
      threshold
    };
  }

  // EVERY follow is expanded, not the first N of them. An earlier version capped the
  // seeds and quietly covered 28% of a real list while reporting a confident total.
  // The cap that genuinely matters is per REQUEST, which is what chunking is for.
  const chunks: string[][] = [];
  for (let i = 0; i < follows.length; i += chunkSize) chunks.push(follows.slice(i, i + chunkSize));

  // pubkey -> how many of your follows follow them.
  const votes = new Map<string, number>();
  let expanded = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        let got: string[];
        try {
          got = await o.fetchFollowsOf(chunk);
        } catch {
          continue; // a chunk that fails narrows the set; it must not empty it
        }
        expanded += chunk.length;
        // Reported per chunk rather than per person: the caller may be drawing a bar,
        // and a build on a large follow list is the one place where something takes
        // long enough that silence reads as broken.
        if (typeof o.onProgress === 'function') {
          try {
            o.onProgress(expanded, follows.length);
          } catch {
            /* a progress callback must never break the build */
          }
        }
        (got || []).forEach((pk) => {
          if (!isHexKey(pk)) return;
          const k = short(pk);
          votes.set(k, (votes.get(k) || 0) + 1);
        });
      }
    })
  );

  const set = new Set<string>();
  // You and the people you chose yourself are in unconditionally — a follow is a louder
  // vote than ten strangers' follows, and no threshold should be able to overrule it.
  if (me) set.add(short(me));
  follows.forEach((pk) => set.add(short(pk)));

  let qualified = 0;
  votes.forEach((n, k) => {
    if (n < threshold) return;
    // Muted people do not get in through the back door. The denylist and the allowlist
    // compose rather than sitting side by side.
    if (muted.has(k)) return;
    set.add(k);
    qualified++;
  });

  return { set, seen: votes.size, qualified, follows: follows.length, expanded, threshold };
}

// Is this person in the network? UNKNOWN MEANS YES — an absent or empty set is not
// evidence about anybody, and treating it as such would hide real correspondents the
// first time a relay was slow.
export function inNetwork(
  set: ReadonlySet<string> | null | undefined,
  pubkey: string | undefined
): boolean {
  if (!set || !set.size) return true;
  if (!isHexKey(pubkey)) return true;
  return set.has(short(pubkey));
}

// Split events without discarding any. `senderOf` is passed in because the interesting
// party is not always ev.pubkey — a zap receipt is authored by the LNURL service, and
// filtering on that would judge the wrong person entirely.
export function partition<T>(
  set: ReadonlySet<string> | null | undefined,
  events: T[],
  senderOf?: (ev: T) => string | undefined
): { inn: T[]; out: T[] } {
  const inn: T[] = [];
  const out: T[] = [];
  const who =
    typeof senderOf === 'function' ? senderOf : (e: T) => (e as { pubkey?: string })?.pubkey;
  (events || []).forEach((ev) => {
    (inNetwork(set, who(ev)) ? inn : out).push(ev);
  });
  return { inn, out };
}
