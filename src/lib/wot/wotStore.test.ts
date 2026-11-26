import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// Shared state for the module mocks, which are hoisted above these imports.
const h = vi.hoisted(() => ({
  follows: [
    'aa'.repeat(32),
    'ab'.repeat(32),
    'ac'.repeat(32),
    'ad'.repeat(32),
    'ae'.repeat(32),
    'af'.repeat(32),
    'ba'.repeat(32),
    'bb'.repeat(32),
    'bc'.repeat(32),
    'bd'.repeat(32),
    'be'.repeat(32),
    'bf'.repeat(32)
  ]
}));

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/followListCache', async () => {
  const { writable } = await import('svelte/store');
  return {
    followListReady: writable(false),
    followPubkeysReady: writable(false),
    followListSize: writable(0),
    getFollowedPubkeys: vi.fn(() => new Set(h.follows)),
    loadFollowListProfiles: vi.fn(async () => new Map())
  };
});
vi.mock('$lib/muteListStore', async () => {
  const { writable } = await import('svelte/store');
  return {
    mutedPubkeys: writable(new Set<string>()),
    muteListStore: { subscribe: writable({ muteList: null }).subscribe, load: vi.fn() }
  };
});

import { getFollowedPubkeys } from '$lib/followListCache';
import { buildWot, setWotEnabled, wotSet, wotState, wotEnabled } from './wotStore';
import { short, THRESHOLD } from './wot';

// A fake NDK whose fetchEvents answers each chunk with one kind:3 per author, all
// following the same popular key — with 12 follows it clears the threshold of 10.
const POPULAR = 'ee'.repeat(32);
function fakeNdk() {
  return {
    fetchEvents: vi.fn(async (filter: { authors?: string[] }) => {
      const events = (filter.authors || []).map((author) => ({
        pubkey: author,
        created_at: 100,
        tags: [['p', POPULAR]]
      }));
      return new Set(events);
    })
  } as unknown as import('@nostr-dev-kit/ndk').default;
}

// The runner caches one set per account for the session; tests use distinct accounts
// so a cached build from an earlier test cannot answer for a later one.
const ME1 = 'dd'.repeat(32);
const ME2 = 'd1'.repeat(32);
const ME3 = 'd2'.repeat(32);

beforeEach(() => {
  setWotEnabled(true);
  wotSet.set(new Set());
  wotState.set('idle');
});

describe('the wot store runner', () => {
  it('with the web of trust disabled buildWot never builds', async () => {
    setWotEnabled(false);
    const r = await buildWot(fakeNdk(), ME1);
    expect(r).toBeNull();
    expect(get(wotState)).toBe('idle');
    expect(get(wotSet).size).toBe(0);
  });

  it('publishes the built set and the ready state', async () => {
    const r = await buildWot(fakeNdk(), ME1);
    expect(r).not.toBeNull();
    expect(get(wotState)).toBe('ready');
    const set = get(wotSet);
    expect(set.has(short(ME1))).toBe(true);
    for (const f of h.follows) expect(set.has(short(f))).toBe(true);
    expect(set.has(short(POPULAR))).toBe(true);
    expect(set.size).toBe(h.follows.length + 2);
    expect(r!.seen).toBe(1);
    expect(r!.qualified).toBe(1);
    expect(THRESHOLD).toBe(10);
  });

  it('reuses the cached set for the same account until forced', async () => {
    const ndk = fakeNdk();
    const first = await buildWot(ndk, ME2);
    const again = await buildWot(ndk, ME2);
    expect(again).toBe(first);
    expect(ndk.fetchEvents).toHaveBeenCalledTimes(1);
    const forced = await buildWot(ndk, ME2, { force: true });
    expect(forced).not.toBeNull();
    expect(ndk.fetchEvents).toHaveBeenCalledTimes(2);
  });

  it('stays idle and returns null when there is no follow list', async () => {
    vi.mocked(getFollowedPubkeys).mockReturnValueOnce(new Set());
    const r = await buildWot(fakeNdk(), ME3);
    expect(r).toBeNull();
    expect(get(wotState)).toBe('idle');
    expect(get(wotSet).size).toBe(0);
  });

  it('a failed chunk fetch narrows the build instead of failing it', async () => {
    const ndk = {
      fetchEvents: vi.fn(async () => {
        throw new Error('relay timeout');
      })
    } as unknown as import('@nostr-dev-kit/ndk').default;
    const r = await buildWot(ndk, 'd3'.repeat(32));
    expect(get(wotState)).toBe('ready');
    expect(r!.expanded).toBe(0);
    // Hop one still stands: the account and its follows are in-network.
    expect(get(wotSet).has(short('d3'.repeat(32)))).toBe(true);
    expect(get(wotSet).has(short(h.follows[0]))).toBe(true);
    expect(get(wotSet).size).toBe(h.follows.length + 1);
  });
});
