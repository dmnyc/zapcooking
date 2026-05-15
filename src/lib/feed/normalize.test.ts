/**
 * Tests for the event → FeedNoteVM normaliser.
 *
 * NDKEvent is a class but for these tests we cast plain objects to
 * NDKEvent — the normaliser only reads `id`, `pubkey`, `kind`,
 * `created_at`, `content`, and `tags`, all of which are public
 * fields on the underlying type.
 */

import { describe, it, expect } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { eventToViewModel, invalidateViewModel } from './normalize';

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

describe('eventToViewModel — basic shape', () => {
  it('copies id, pubkey, kind, createdAt, content, tags through', () => {
    const event = mockEvent({
      id: 'aaa',
      pubkey: 'b'.repeat(64),
      kind: 1,
      created_at: 1_700_000_100,
      content: 'hello world',
      tags: [['t', 'foodstr']]
    });
    const vm = eventToViewModel(event);
    expect(vm.id).toBe('aaa');
    expect(vm.pubkey).toBe('b'.repeat(64));
    expect(vm.kind).toBe(1);
    expect(vm.createdAt).toBe(1_700_000_100);
    expect(vm.content).toBe('hello world');
    expect(vm.tags).toEqual([['t', 'foodstr']]);
  });

  it('memoizes — same event instance → same VM', () => {
    const event = mockEvent({ id: 'mem' });
    const a = eventToViewModel(event);
    const b = eventToViewModel(event);
    expect(a).toBe(b);
  });

  it('invalidateViewModel drops the memo entry', () => {
    const event = mockEvent({ id: 'inv' });
    const a = eventToViewModel(event);
    invalidateViewModel(event);
    const b = eventToViewModel(event);
    expect(a).not.toBe(b);
    expect(a.id).toBe(b.id);
  });

  it('defaults missing fields safely', () => {
    const event = {
      // No id, no kind, no created_at, no content, no tags.
      pubkey: ''
    } as unknown as NDKEvent;
    const vm = eventToViewModel(event);
    expect(vm.kind).toBe(1);
    expect(vm.createdAt).toBe(0);
    expect(vm.content).toBe('');
    expect(vm.tags).toEqual([]);
    expect(vm.media).toEqual([]);
    expect(vm.embeds).toEqual([]);
    expect(vm.hashtags).toEqual([]);
    expect(vm.mentionedPubkeys).toEqual([]);
  });
});

describe('eventToViewModel — hashtags', () => {
  it('collects t tags lowercased and de-duplicated within the array', () => {
    const event = mockEvent({
      tags: [
        ['t', 'FoodStr'],
        ['t', 'cooking'],
        ['t', ''],
        ['e', 'parent'] // ignored
      ]
    });
    const vm = eventToViewModel(event);
    expect(vm.hashtags).toEqual(['foodstr', 'cooking']);
  });
});

describe('eventToViewModel — mentions', () => {
  it('collects pubkeys from p tags', () => {
    const event = mockEvent({
      tags: [
        ['p', 'a'.repeat(64)],
        ['p', 'b'.repeat(64)],
        ['p', 'too-short'] // ignored
      ]
    });
    const vm = eventToViewModel(event);
    expect(vm.mentionedPubkeys).toContain('a'.repeat(64));
    expect(vm.mentionedPubkeys).toContain('b'.repeat(64));
    expect(vm.mentionedPubkeys).toHaveLength(2);
  });
});

describe('eventToViewModel — embeds', () => {
  it('extracts nostr:nevent1… / note1… / naddr1… refs from content', () => {
    const event = mockEvent({
      content:
        'check out nostr:nevent1abcde and nostr:note1xyz and also nostr:naddr1foo end.'
    });
    const vm = eventToViewModel(event);
    const refs = vm.embeds.map((e) => e.ref);
    expect(refs.some((r) => r.startsWith('nevent1'))).toBe(true);
    expect(refs.some((r) => r.startsWith('note1'))).toBe(true);
    expect(refs.some((r) => r.startsWith('naddr1'))).toBe(true);
  });

  it('captures q tags as embeds with their eventId set', () => {
    const event = mockEvent({
      tags: [['q', 'event-id-deadbeef']]
    });
    const vm = eventToViewModel(event);
    expect(vm.embeds).toHaveLength(1);
    expect(vm.embeds[0].ref).toBe('event-id-deadbeef');
    expect(vm.embeds[0].eventId).toBe('event-id-deadbeef');
  });

  it('dedupes inline refs that appear twice', () => {
    const event = mockEvent({
      content: 'one nostr:note1abc and another nostr:note1abc again'
    });
    const vm = eventToViewModel(event);
    expect(vm.embeds.filter((e) => e.ref === 'note1abc')).toHaveLength(1);
  });
});

describe('eventToViewModel — replies', () => {
  it('marks a kind-1 with no e tags as not a reply', () => {
    const vm = eventToViewModel(mockEvent({ tags: [['t', 'foodstr']] }));
    expect(vm.replyTo).toBeUndefined();
  });

  it('uses NIP-10 markers for rootId / parentId', () => {
    const vm = eventToViewModel(
      mockEvent({
        tags: [
          ['e', 'rootid', '', 'root'],
          ['e', 'parentid', '', 'reply']
        ]
      })
    );
    expect(vm.replyTo).toEqual({ rootId: 'rootid', parentId: 'parentid' });
  });

  it('falls back to old-style first/last when no markers', () => {
    const vm = eventToViewModel(
      mockEvent({
        tags: [
          ['e', 'rootid'],
          ['e', 'midid'],
          ['e', 'parentid']
        ]
      })
    );
    expect(vm.replyTo).toEqual({ rootId: 'rootid', parentId: 'parentid' });
  });

  it('treats single e tag as both root and parent', () => {
    const vm = eventToViewModel(mockEvent({ tags: [['e', 'only']] }));
    expect(vm.replyTo).toEqual({ rootId: 'only', parentId: 'only' });
  });
});

describe('eventToViewModel — reposts', () => {
  it('builds a RepostVM for kind 6', () => {
    const event = mockEvent({
      id: 'repost-id',
      pubkey: 'c'.repeat(64),
      kind: 6,
      created_at: 1_700_001_000,
      tags: [
        ['e', 'inner-event-id'],
        ['p', 'd'.repeat(64)]
      ]
    });
    const vm = eventToViewModel(event);
    expect(vm.repost).toBeDefined();
    expect(vm.repost!.reposterPubkey).toBe('c'.repeat(64));
    expect(vm.repost!.repostedAt).toBe(1_700_001_000);
    expect(vm.repost!.innerEventId).toBe('inner-event-id');
    expect(vm.repost!.innerPubkey).toBe('d'.repeat(64));
    expect(vm.repost!.inner).toBeNull();
  });

  it('builds a RepostVM for kind 16 (generic repost)', () => {
    const event = mockEvent({
      kind: 16,
      tags: [['e', 'inner-id']]
    });
    const vm = eventToViewModel(event);
    expect(vm.repost).toBeDefined();
    expect(vm.repost!.innerEventId).toBe('inner-id');
  });

  it('returns no repost for a kind-1 event', () => {
    expect(eventToViewModel(mockEvent({ kind: 1 })).repost).toBeUndefined();
  });

  it('returns no repost for a kind 6 without an e tag', () => {
    const vm = eventToViewModel(mockEvent({ kind: 6, tags: [] }));
    expect(vm.repost).toBeUndefined();
  });
});

describe('eventToViewModel — client', () => {
  it('captures the client tag when present', () => {
    const vm = eventToViewModel(mockEvent({ tags: [['client', 'zap.cooking']] }));
    expect(vm.client).toBe('zap.cooking');
  });

  it('leaves client undefined when missing', () => {
    expect(eventToViewModel(mockEvent({})).client).toBeUndefined();
  });
});
