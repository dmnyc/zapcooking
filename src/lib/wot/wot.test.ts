import { describe, expect, it } from 'vitest';
import { build, followsFromEvents, inNetwork, KEY_LEN, partition, short, THRESHOLD } from './wot';

// The web-of-trust set behind spam hiding — ported from Sidecar's wot.test.js.
//
// zap.cooking's notification and reply filtering is a DENYLIST in every branch — muted
// pubkeys, threads, words, hellthreads, nspam verdicts — and a denylist cannot win against
// key rotation: fresh keys arrive faster than anyone can mute them. This is the allowlist.
//
// Almost everything below pins the FAIL-OPEN direction. The dangerous failure here is not
// letting a stranger through; it is hiding someone real because a relay was slow, and
// doing it invisibly.

const hex = (c: string) => String(c).repeat(64).slice(0, 64);
const ME = hex('a');

describe('the web-of-trust set', () => {
  it('one vote is not enough, ten is', async () => {
    // THE WHOLE DESIGN. Taking anyone your follows follow is a weak signal — one careless
    // follow launders a stranger in. On a real 1,066-follow list the raw two-hop set runs
    // to about 48.9k people and only ~9.3k clear the bar.
    const follows = Array.from(
      { length: 12 },
      (_, i) => hex('0').slice(0, 62) + String(i).padStart(2, '0')
    );
    const popular = hex('d');
    const obscure = hex('e');
    const r = await build({
      me: ME,
      follows,
      chunkSize: 4,
      fetchFollowsOf: async (chunk) => {
        const out = chunk.map(() => popular); // every seed follows this one
        if (chunk.includes(follows[0])) out.push(obscure); // exactly one follows this one
        return out;
      }
    });
    expect(inNetwork(r.set, popular)).toBe(true);
    expect(inNetwork(r.set, obscure)).toBe(false);
    expect(r.seen).toBe(2);
    expect(r.qualified).toBe(1);
  });

  it('you and your own follows are in unconditionally', async () => {
    // A follow is a louder vote than ten strangers' follows; no threshold should overrule
    // the people you chose yourself.
    const r = await build({ me: ME, follows: [hex('b')], fetchFollowsOf: async () => [] });
    expect(inNetwork(r.set, ME)).toBe(true);
    expect(inNetwork(r.set, hex('b'))).toBe(true);
  });

  it('muted people do not get in through the back door', async () => {
    const follows = Array.from(
      { length: 12 },
      (_, i) => hex('0').slice(0, 62) + String(i).padStart(2, '0')
    );
    const creep = hex('c');
    const r = await build({
      me: ME,
      follows,
      chunkSize: 4,
      muted: new Set([short(creep)]),
      fetchFollowsOf: async (chunk) => chunk.map(() => creep)
    });
    // The denylist and the allowlist compose rather than sitting side by side.
    expect(inNetwork(r.set, creep)).toBe(false);
    expect(r.qualified).toBe(0);
  });

  it('EVERY follow is expanded, not the first N', async () => {
    // An earlier Sidecar version capped seeds at 300 and quietly covered 28% of a real
    // 1,066-follow list while reporting a confident total. The cap that matters is per
    // REQUEST.
    const follows = Array.from(
      { length: 400 },
      (_, i) => hex('0').slice(0, 61) + String(i).padStart(3, '0')
    );
    let touched = 0;
    const r = await build({
      me: ME,
      follows,
      chunkSize: 50,
      fetchFollowsOf: async (chunk) => {
        touched += chunk.length;
        return [];
      }
    });
    expect(touched).toBe(400);
    expect(r.expanded).toBe(400);
    expect(r.follows).toBe(400);
  });

  it('AN EMPTY SET LETS EVERYONE THROUGH', () => {
    // The fail-open contract. No follow list, a failed fetch, a fresh account — none of
    // those are evidence about anybody, and treating them as such hides real replies.
    expect(inNetwork(new Set(), hex('9'))).toBe(true);
    expect(inNetwork(null, hex('9'))).toBe(true);
    expect(inNetwork(undefined, hex('9'))).toBe(true);
  });

  it('an account with no follows filters nothing', async () => {
    const r = await build({ me: ME, follows: [], fetchFollowsOf: async () => [hex('d')] });
    expect(r.set.size).toBe(0);
    expect(inNetwork(r.set, hex('9'))).toBe(true);
  });

  it('a chunk that fails narrows the set, it does not empty it', async () => {
    // One relay timing out must not turn the app into a wall of hidden replies.
    let call = 0;
    const follows = Array.from({ length: 4 }, (_, i) => hex('0').slice(0, 63) + String(i));
    const r = await build({
      me: ME,
      follows,
      chunkSize: 1,
      fetchFollowsOf: async () => {
        call++;
        if (call === 1) throw new Error('relay timeout');
        return [];
      }
    });
    expect(inNetwork(r.set, follows[0])).toBe(true);
    expect(r.expanded).toBeLessThan(follows.length);
  });

  it('keys are stored truncated, and that only ever fails open', () => {
    // A collision lets a stranger through as in-network, which is the safe direction; the
    // reverse cannot happen, since a real member always matches its own prefix.
    expect(KEY_LEN).toBe(16);
    expect(short(hex('b')).length).toBe(16);
    expect(THRESHOLD).toBe(10);
  });

  it('junk never narrows the set', async () => {
    const r = await build({
      me: 'not-a-key',
      follows: [hex('b'), 'nope', ''],
      fetchFollowsOf: async () => ['garbage']
    });
    expect(inNetwork(r.set, hex('b'))).toBe(true);
    expect(inNetwork(r.set, 'not-a-key')).toBe(true);
  });

  it('one vote per person, not per copy of their list', async () => {
    // A kind:3 is replaceable and a pool query spans relays: the same author's list
    // arrives once per relay that holds it. Newest wins, and duplicate p tags inside one
    // list are one endorsement, not two.
    const listAuthor = hex('1');
    const events = [
      {
        pubkey: listAuthor,
        created_at: 100,
        tags: [
          ['p', hex('2')],
          ['p', hex('3')]
        ]
      },
      {
        pubkey: listAuthor,
        created_at: 200,
        tags: [
          ['p', hex('2')],
          ['p', hex('2')],
          ['p', 'nope']
        ]
      }
    ];
    expect(followsFromEvents(events)).toEqual([hex('2')]);
  });

  it('partition keeps everything, and judges the right person', () => {
    // A zap receipt is authored by the LNURL service, so filtering on ev.pubkey would
    // judge the wrong party entirely — the caller passes a sender for exactly this reason.
    const set = new Set([short(hex('b'))]);
    const events = [
      { id: '1', pubkey: hex('b') },
      { id: '2', pubkey: hex('9') },
      { id: '3', pubkey: hex('f'), zapper: hex('b') }
    ];
    const { inn, out } = partition(set, events, (e) => e.zapper || e.pubkey);
    expect(inn.map((e) => e.id)).toEqual(['1', '3']);
    expect(out.map((e) => e.id)).toEqual(['2']);
    expect(inn.length + out.length).toBe(events.length);
  });
});
