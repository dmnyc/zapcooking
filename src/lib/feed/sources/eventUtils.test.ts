/**
 * Tests for the shared event helpers — port from
 * FoodstrFeedOptimized.svelte, must behave identically.
 */

import { describe, it, expect } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import {
  calculateTimeWindow,
  isReply,
  expandRepostEvent,
  getEventSortTime,
  createMutedUsersReader,
  ONE_DAY_SECONDS,
  THREE_DAYS_SECONDS,
  SEVEN_DAYS_SECONDS,
  THIRTY_DAYS_SECONDS
} from './eventUtils';

/** Stable "now" for all timestamp tests — avoids needing fake timers
 * (which require vitest's `vi`, and the project's tsc resolution
 * doesn't import those helpers globally). */
const NOW = 1_700_000_000;

function mockEvent(partial: Partial<NDKEvent>): NDKEvent {
  return {
    id: 'abc',
    pubkey: 'a'.repeat(64),
    kind: 1,
    created_at: 1_700_000_000,
    content: '',
    tags: [] as string[][],
    ...partial
  } as unknown as NDKEvent;
}

describe('calculateTimeWindow', () => {
  it('initial mode for global → 7 days back', () => {
    const w = calculateTimeWindow(
      'initial',
      { filterMode: 'global', lastEventTime: 0, oldestEventSortTime: 0 },
      NOW
    );
    expect(w.since).toBe(NOW - SEVEN_DAYS_SECONDS);
    expect(w.until).toBeUndefined();
  });

  it('initial mode for following / replies → 3 days back', () => {
    expect(
      calculateTimeWindow(
        'initial',
        { filterMode: 'following', lastEventTime: 0, oldestEventSortTime: 0 },
        NOW
      ).since
    ).toBe(NOW - THREE_DAYS_SECONDS);
    expect(
      calculateTimeWindow(
        'initial',
        { filterMode: 'replies', lastEventTime: 0, oldestEventSortTime: 0 },
        NOW
      ).since
    ).toBe(NOW - THREE_DAYS_SECONDS);
  });

  it('initial mode for garden / members → 7 days back', () => {
    expect(
      calculateTimeWindow(
        'initial',
        { filterMode: 'garden', lastEventTime: 0, oldestEventSortTime: 0 },
        NOW
      ).since
    ).toBe(NOW - SEVEN_DAYS_SECONDS);
    expect(
      calculateTimeWindow(
        'initial',
        { filterMode: 'members', lastEventTime: 0, oldestEventSortTime: 0 },
        NOW
      ).since
    ).toBe(NOW - SEVEN_DAYS_SECONDS);
  });

  it('pagination mode extends back from oldest, clamped to 30 days', () => {
    const oldest = NOW - 5 * 24 * 60 * 60; // 5 days ago
    const w = calculateTimeWindow(
      'pagination',
      { filterMode: 'global', lastEventTime: 0, oldestEventSortTime: oldest },
      NOW
    );
    expect(w.since).toBe(oldest - SEVEN_DAYS_SECONDS);
    expect(w.until).toBe(oldest - 1);
  });

  it('pagination mode hits the 30-day floor for very old anchors', () => {
    const oldest = NOW - 60 * 24 * 60 * 60; // 60 days ago
    const w = calculateTimeWindow(
      'pagination',
      { filterMode: 'global', lastEventTime: 0, oldestEventSortTime: oldest },
      NOW
    );
    expect(w.since).toBe(NOW - THIRTY_DAYS_SECONDS);
  });

  it('realtime mode uses lastEventTime + 1 when known', () => {
    const w = calculateTimeWindow(
      'realtime',
      { filterMode: 'global', lastEventTime: NOW - 100, oldestEventSortTime: 0 },
      NOW
    );
    expect(w.since).toBe(NOW - 99);
  });

  it('realtime mode falls back to last hour when lastEventTime is 0', () => {
    const w = calculateTimeWindow(
      'realtime',
      { filterMode: 'global', lastEventTime: 0, oldestEventSortTime: 0 },
      NOW
    );
    expect(w.since).toBe(NOW - 3600);
  });
});

describe('isReply', () => {
  it('returns false for kinds other than 1 / 1068', () => {
    expect(isReply(mockEvent({ kind: 6, tags: [['e', 'x']] }))).toBe(false);
    expect(isReply(mockEvent({ kind: 30023, tags: [['e', 'x']] }))).toBe(false);
  });

  it('returns false when there are no e tags', () => {
    expect(isReply(mockEvent({ kind: 1, tags: [['t', 'foodstr']] }))).toBe(false);
  });

  it('returns true when an e tag has the "reply" marker', () => {
    expect(
      isReply(mockEvent({ tags: [['e', 'parent', '', 'reply']] }))
    ).toBe(true);
  });

  it('returns true when an e tag has the "root" marker', () => {
    expect(isReply(mockEvent({ tags: [['e', 'root', '', 'root']] }))).toBe(true);
  });

  it('returns false when the only e tag is a mention', () => {
    expect(isReply(mockEvent({ tags: [['e', 'mentioned', '', 'mention']] }))).toBe(false);
  });

  it('returns true for unmarked e tags (old-style replies)', () => {
    expect(isReply(mockEvent({ tags: [['e', 'parent']] }))).toBe(true);
  });

  it('returns true for unknown markers (safe default)', () => {
    expect(isReply(mockEvent({ tags: [['e', 'parent', '', 'someOtherMarker']] }))).toBe(true);
  });

  it('accepts kind 1068 as repliable', () => {
    expect(isReply(mockEvent({ kind: 1068, tags: [['e', 'parent']] }))).toBe(true);
  });
});

describe('getEventSortTime', () => {
  it('returns created_at for a regular event', () => {
    expect(getEventSortTime(mockEvent({ created_at: 12345 }))).toBe(12345);
  });

  it('prefers _repostCreatedAt when present', () => {
    const event = mockEvent({ created_at: 100 });
    (event as any)._repostCreatedAt = 999;
    expect(getEventSortTime(event)).toBe(999);
  });

  it('returns 0 for null / undefined', () => {
    expect(getEventSortTime(null)).toBe(0);
    expect(getEventSortTime(undefined)).toBe(0);
  });
});

describe('expandRepostEvent', () => {
  // NDKEvent construction needs a real NDK instance; we use a mock.
  const mockNdk = {} as any;

  it('returns the event unchanged for non-kind-6', () => {
    const e = mockEvent({ kind: 1 });
    expect(expandRepostEvent(mockNdk, e)).toBe(e);
  });

  it('expands the embedded-JSON form into a synthetic inner event', () => {
    const inner = {
      id: 'inner-id',
      pubkey: 'd'.repeat(64),
      kind: 1,
      content: 'reposted content',
      tags: [['t', 'foodstr']],
      created_at: 1_699_990_000,
      sig: 'sig'
    };
    const event = mockEvent({
      id: 'repost-id',
      pubkey: 'r'.repeat(64),
      kind: 6,
      created_at: 1_700_000_000,
      content: JSON.stringify(inner)
    });
    const expanded = expandRepostEvent(mockNdk, event);
    expect(expanded).not.toBeNull();
    expect(expanded!.id).toBe('inner-id');
    expect(expanded!.kind).toBe(1);
    expect(expanded!.content).toBe('reposted content');
    expect((expanded as any)._repostedBy).toBe('r'.repeat(64));
    expect((expanded as any)._repostCreatedAt).toBe(1_700_000_000);
  });

  it('falls back to tag-only when content is not valid JSON', () => {
    const event = mockEvent({
      id: 'repost-id',
      pubkey: 'r'.repeat(64),
      kind: 6,
      created_at: 1_700_000_000,
      content: 'not-json',
      tags: [
        ['e', 'inner-id'],
        ['k', '1'],
        ['p', 'p'.repeat(64)]
      ]
    });
    const expanded = expandRepostEvent(mockNdk, event);
    expect(expanded).not.toBeNull();
    expect(expanded!.id).toBe('inner-id');
    expect(expanded!.pubkey).toBe('p'.repeat(64));
    expect((expanded as any)._repostId).toBe('repost-id');
  });

  it('returns null when neither embedded JSON nor an e tag exists', () => {
    const event = mockEvent({ kind: 6, content: '', tags: [['p', 'x']] });
    expect(expandRepostEvent(mockNdk, event)).toBeNull();
  });

  it('rejects embedded inner with unsupported kind', () => {
    const inner = { id: 'x', pubkey: 'y', kind: 30023, content: '', tags: [] };
    const event = mockEvent({ kind: 6, content: JSON.stringify(inner) });
    // Falls through to tag-only, which has no e tag → null.
    expect(expandRepostEvent(mockNdk, event)).toBeNull();
  });
});

describe('createMutedUsersReader', () => {
  // localStorage is not a global in jsdom-less vitest configs; treat
  // its absence as "skip these scenarios". For the cases that exercise
  // it, each test clears the key itself rather than via beforeEach
  // (project tsc resolution doesn't pull in beforeEach types).

  it('returns [] when there is no user pubkey', () => {
    const read = createMutedUsersReader(() => '');
    expect(read()).toEqual([]);
  });

  it('returns parsed pubkeys from localStorage', () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem('mutedUsers');
    localStorage.setItem(
      'mutedUsers',
      JSON.stringify(['a'.repeat(64), 'b'.repeat(64), 123])
    );
    const read = createMutedUsersReader(() => 'me');
    const list = read();
    expect(list).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });

  it('caches across calls with the same pubkey', () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem('mutedUsers');
    localStorage.setItem('mutedUsers', JSON.stringify(['x']));
    const read = createMutedUsersReader(() => 'me');
    const a = read();
    localStorage.setItem('mutedUsers', JSON.stringify(['y']));
    const b = read();
    expect(a).toBe(b);
  });

  it('handles missing / malformed localStorage gracefully', () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem('mutedUsers');
    localStorage.setItem('mutedUsers', 'not-json');
    const read = createMutedUsersReader(() => 'me');
    expect(read()).toEqual([]);
  });
});

describe('time-window constants', () => {
  it('match the monolith', () => {
    expect(ONE_DAY_SECONDS).toBe(86_400);
    expect(THREE_DAYS_SECONDS).toBe(3 * 86_400);
    expect(SEVEN_DAYS_SECONDS).toBe(7 * 86_400);
    expect(THIRTY_DAYS_SECONDS).toBe(30 * 86_400);
  });
});
