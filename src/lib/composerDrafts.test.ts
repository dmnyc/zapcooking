import { describe, it, expect, beforeEach } from 'vitest';
import * as nostrTools from 'nostr-tools';
import {
  writeDraft,
  removeDraft,
  needsPush,
  contentSum,
  liveWraps,
  mergeRemote,
  buildInner,
  parseInner,
  createDraftSync,
  loadDrafts,
  loadBlanks,
  storeDrafts,
  newDraftId,
  useDraftScope,
  type CoreHelpers,
  type DraftFields,
  type DraftMap,
  type SyncIO
} from './composerDrafts';

/**
 * The composer's drafts. The rule under test above all: one draft, one
 * id, for its whole life — the store is keyed by the d-tag, so nothing
 * here can make a second copy of a draft. Sidecar's real composer core
 * builds and reads the note shape, so drafts round-trip with Sidecar.
 */

// The core reads window.SidecarI18n and window.NostrTools at load.
(globalThis as any).window = globalThis;
await import('./sidecar/sidecar-globals');
// The vendored core sets window.SidecarCore (composer-core.d.ts types it as a bare module).
await import('./vendor/sidecar/composer-core.js');
const core: CoreHelpers = (globalThis as any).SidecarCore;

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k)
  };
});

const note = (text: string): DraftFields => ({ kind: 'note', text, media: [], poll: null });
let seq = 0;
const ids = () => `zapcooking-1-${String(++seq).padStart(6, '0')}`;

describe('one draft, one id', () => {
  it('allocates no id for an empty draft', () => {
    const r = writeDraft({}, {}, null, note('  '), 1000, ids);
    expect(r.id).toBeNull();
    expect(r.all).toEqual({});
  });

  it('allocates one id at first content and keeps it through every edit', () => {
    let r = writeDraft({}, {}, null, note('S'), 1000, ids);
    const id = r.id!;
    for (const t of ['So', 'Sou', 'Soup', 'Soup weather']) r = writeDraft(r.all, r.blanks, r.id, note(t), 2000, ids);
    expect(r.id).toBe(id);
    expect(Object.keys(r.all)).toEqual([id]);
    expect(r.all[id].text).toBe('Soup weather');
  });

  it('emptying removes the local copy, queues a blank, and retyping reuses the id', () => {
    let r = writeDraft({}, {}, null, note('Soup'), 1000, ids);
    const id = r.id!;
    r.all[id].relay = { d: id, k: 1, at: 5, sum: contentSum(r.all[id]) };
    r = writeDraft(r.all, r.blanks, id, note(''), 2000, ids);
    expect(r.all).toEqual({});
    expect(r.blanks[id]).toEqual({ k: 1, at: 5 });
    expect(r.id).toBe(id);

    r = writeDraft(r.all, r.blanks, r.id, note('Stew'), 3000, ids);
    expect(Object.keys(r.all)).toEqual([id]);
    // Written again: the pending blank would have erased it.
    expect(r.blanks[id]).toBeUndefined();
  });

  it('posting removes the draft and queues its relay copy for blanking', () => {
    const r = writeDraft({}, {}, null, note('Soup'), 1000, ids);
    r.all[r.id!].relay = { d: r.id!, k: 1, at: 7, sum: 'x' };
    const after = removeDraft(r.all, r.blanks, r.id!);
    expect(after.all).toEqual({});
    expect(after.blanks).toEqual({ [r.id!]: { k: 1, at: 7 } });
  });

  it('a draft that never reached the relays leaves nothing to blank', () => {
    const r = writeDraft({}, {}, null, note('Soup'), 1000, ids);
    expect(removeDraft(r.all, r.blanks, r.id!).blanks).toEqual({});
  });

  it('allocates ids of the form zapcooking-<secs>-<hex>', () => {
    expect(newDraftId(1_792_000_000_123, () => 0.5)).toBe('zapcooking-1792000000-7fffff');
  });
});

describe('the push gate', () => {
  it('pushes a draft never pushed, and again only after it changes', () => {
    const r = writeDraft({}, {}, null, note('Soup'), 1000, ids);
    const d = r.all[r.id!];
    expect(needsPush(d)).toBe(true);
    d.relay = { d: d.id, k: 1, at: 1, sum: contentSum(d) };
    expect(needsPush(d)).toBe(false);
    expect(needsPush({ ...d, text: 'Soup!' })).toBe(true);
    expect(needsPush({ ...d, text: '  Soup  ' })).toBe(false); // whitespace only
  });
});

describe('relay copies', () => {
  const me = 'a'.repeat(64);
  const ev = (d: string, at: number, content = 'x', k = '1', extra: string[][] = []) => ({
    id: `${d}-${at}`,
    pubkey: me,
    kind: 31234,
    created_at: at,
    content,
    tags: [['d', d], ['k', k], ...extra]
  });

  it('keeps the newest copy of each d, so an older copy cannot undo a delete', () => {
    const live = liveWraps([ev('a', 1, 'old'), ev('a', 2, '')], me, 100);
    expect(live).toEqual([]);
  });

  it('drops the expired, other kinds, and other authors', () => {
    const live = liveWraps(
      [
        ev('exp', 1, 'x', '1', [['expiration', '50']]),
        ev('recipe', 1, 'x', '30023'),
        { ...ev('them', 1), pubkey: 'b'.repeat(64) },
        ev('poll', 2, 'x', '1068'),
        ev('note', 3)
      ],
      me,
      100
    );
    expect(live.map((e) => e.tags[0][1])).toEqual(['note', 'poll']);
  });

  it('merges by d: a draft from the relays is never added twice', () => {
    const items = [{ d: 'sidecar-1-abc', k: 1, at: 10, fields: note('From Sidecar') }];
    let all: DraftMap = mergeRemote({}, {}, items);
    all = mergeRemote(all, {}, items);
    expect(Object.keys(all)).toEqual(['sidecar-1-abc']);
    expect(all['sidecar-1-abc'].relay).toMatchObject({ d: 'sidecar-1-abc', at: 10 });
  });

  it('a local edit not yet pushed wins over the relay copy', () => {
    let all = mergeRemote({}, {}, [{ d: 'x', k: 1, at: 10, fields: note('v1') }]);
    all = { ...all, x: { ...all.x, text: 'v1 edited here' } };
    all = mergeRemote(all, {}, [{ d: 'x', k: 1, at: 20, fields: note('v2 from elsewhere') }]);
    expect(all.x.text).toBe('v1 edited here');
  });

  it('a draft queued for blanking is not brought back', () => {
    const all = mergeRemote({}, { x: { k: 1, at: 9 } }, [{ d: 'x', k: 1, at: 10, fields: note('gone') }]);
    expect(all).toEqual({});
  });

  it('a note round-trips through Sidecar’s shape, with this app’s client tag', () => {
    const r = writeDraft({}, {}, null, { kind: 'note', text: 'Soup weather', media: [{ url: 'https://x.test/a.jpg' }], poll: null }, 1000, ids);
    const inner = buildInner(r.all[r.id!], { core, selfPubkey: me, NT: nostrTools, nowSecs: 50 })!;
    expect(inner.kind).toBe(1);
    expect(inner.tags).toContainEqual(['client', 'zapcooking']);
    expect((inner.tags as string[][]).some((t) => t[0] === 'client' && t[1] === 'Sidecar')).toBe(false);
    const back = parseInner(JSON.parse(JSON.stringify(inner)), 1, { core, selfPubkey: me });
    expect(back).toMatchObject({ kind: 'note', text: 'Soup weather' });
    expect(back!.media.map((m) => m.url)).toEqual(['https://x.test/a.jpg']);
  });

  it('a poll round-trips with its options and choice type, its end unresolved', () => {
    const fields: DraftFields = {
      kind: 'poll',
      text: 'Best soup?',
      media: [],
      poll: { options: ['Pho', 'Ramen'], multiple: true, ends: { kind: 'in', secs: 86400 } }
    };
    const r = writeDraft({}, {}, null, fields, 1000, ids);
    const inner = buildInner(r.all[r.id!], { core, selfPubkey: me, NT: nostrTools, nowSecs: 50 })!;
    expect(inner.kind).toBe(1068);
    expect((inner.tags as string[][]).some((t) => t[0] === 'endsAt')).toBe(false);
    expect(parseInner(inner, 1068, { core, selfPubkey: me })).toEqual(fields);
  });

  it('a reply draft (another app’s) is not taken in as a note', () => {
    const reply = { kind: 1, content: 'agreed', tags: [['e', 'f'.repeat(64), '', 'root'], ['p', 'b'.repeat(64)]] };
    expect(parseInner(reply, 1, { core, selfPubkey: me })).toBeNull();
  });
});

describe('sync', () => {
  const me = 'c'.repeat(64);
  beforeEach(() => useDraftScope(me));
  function fakeRelays() {
    const held: any[] = [];
    const published: any[] = [];
    let clock = 1_800_000_000_000;
    const io: SyncIO = {
      core: null as unknown as CoreHelpers,
      NT: nostrTools,
      selfPubkey: () => me,
      encrypt: async (p) => 'enc:' + p,
      decrypt: async (c) => (c.startsWith('enc:') ? c.slice(4) : c),
      writeRelays: async () => ['wss://private.test'],
      readRelays: async () => ['wss://private.test', 'wss://write.test'],
      publish: async (_relays, e) => {
        const signed = { ...e, id: `ev${published.length}`, pubkey: me };
        published.push(signed);
        held.push(signed);
      },
      query: async () => held.slice(),
      now: () => (clock += 1000)
    };
    return { io, held, published };
  }

  it('pushes a changed draft once, and opening and closing again sends nothing', async () => {
    const { io, published } = fakeRelays();
    io.core = core;
    const r = writeDraft({}, {}, null, note('Soup'), 1000, ids);
    storeDrafts(r.all, r.blanks);
    const sync = createDraftSync(io);

    expect(await sync.sync()).toMatchObject({ pushed: 1, failed: 0 });
    expect(published).toHaveLength(1);
    expect(published[0].tags).toContainEqual(['d', r.id]);
    expect(published[0].tags).toContainEqual(['k', '1']);

    await sync.sync();
    await sync.sync();
    expect(published).toHaveLength(1); // unchanged: never sent again
    expect(Object.keys(loadDrafts())).toEqual([r.id]); // and never duplicated by the read-back
  });

  it('an edit pushes again under the same d, replacing the relay copy', async () => {
    const { io, published } = fakeRelays();
    io.core = core;
    let r = writeDraft({}, {}, null, note('Soup'), 1000, ids);
    storeDrafts(r.all, r.blanks);
    const sync = createDraftSync(io);
    await sync.sync();

    r = writeDraft(loadDrafts(), loadBlanks(), r.id, note('Soup weather'), 2000, ids);
    storeDrafts(r.all, r.blanks);
    await sync.sync();

    expect(published.map((e) => e.tags.find((t: string[]) => t[0] === 'd')[1])).toEqual([r.id, r.id]);
    expect(published[1].created_at).toBeGreaterThan(published[0].created_at);
  });

  it('a posted draft is blanked on the relays and does not come back', async () => {
    const { io, published } = fakeRelays();
    io.core = core;
    const r = writeDraft({}, {}, null, note('Soup'), 1000, ids);
    storeDrafts(r.all, r.blanks);
    const sync = createDraftSync(io);
    await sync.sync();

    const gone = removeDraft(loadDrafts(), loadBlanks(), r.id!);
    storeDrafts(gone.all, gone.blanks);
    expect(await sync.sync()).toMatchObject({ blanked: 1 });

    const blank = published[published.length - 1];
    expect(blank.content).toBe('');
    expect(blank.tags).toContainEqual(['d', r.id]);
    expect(loadDrafts()).toEqual({});
    expect(loadBlanks()).toEqual({});
  });

  it("never pushes one account's drafts as another's", async () => {
    const { io, published } = fakeRelays();
    io.core = core;
    useDraftScope('d'.repeat(64)); // the store holds another account's drafts
    const r = writeDraft({}, {}, null, note('Not yours'), 1000, ids);
    storeDrafts(r.all, r.blanks);
    expect(await createDraftSync(io).sync()).toEqual({ pushed: 0, blanked: 0, pulled: 0, failed: 0 });
    expect(published).toEqual([]);
  });

  it('takes in a Sidecar note draft under its own d, once', async () => {
    const { io, held } = fakeRelays();
    io.core = core;
    held.push({
      id: 'side1',
      pubkey: me,
      kind: 31234,
      created_at: 1_790_000_000,
      content: 'enc:' + JSON.stringify({ kind: 1, content: 'From Sidecar', tags: [], created_at: 1 }),
      tags: [['d', 'sidecar-1790000000-a1b2c3'], ['k', '1']]
    });
    const sync = createDraftSync(io);
    await sync.sync();
    await sync.sync();
    const all = loadDrafts();
    expect(Object.keys(all)).toEqual(['sidecar-1790000000-a1b2c3']);
    expect(all['sidecar-1790000000-a1b2c3'].text).toBe('From Sidecar');
  });
});
