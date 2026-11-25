import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';

/**
 * Kind 31234 is shared: other clients keep their own drafts under it.
 * Sidecar keeps notes (k=1) and comments (k=1111) there, and this app used
 * to read every wrap not marked draft-type=article as a recipe, so each
 * Sidecar note draft became an "Untitled Draft" card. Real
 * nip37DraftService and encryption; a NIP-07 signer backed by a test key.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { fakeNdk, USER_PK_HOLDER, decryptCalls } = vi.hoisted(() => ({
  fakeNdk: { signer: {} as unknown, fetchEvents: null as unknown },
  USER_PK_HOLDER: { value: '' },
  decryptCalls: [] as string[]
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable(fakeNdk),
    ndkReady: Promise.resolve(),
    userPublickey: writable(USER_PK_HOLDER.value),
    getNdkInstance: () => fakeNdk
  };
});

vi.mock('$lib/authManager', () => ({
  getAuthManager: () => ({ getState: () => ({ authMethod: 'nip07' }) })
}));

vi.mock('$lib/relayListCache', () => ({ getOutboxRelays: async () => [] }));

// The article parser renders markdown to editor HTML through DOMPurify,
// which needs a DOM; what it renders is not under test here.
vi.mock('$lib/parser', () => ({ parseMarkdownToEditorHtml: (md: string) => md }));

vi.mock('@nostr-dev-kit/ndk', async () => {
  const actual = (await vi.importActual(
    '@nostr-dev-kit/ndk'
  )) as typeof import('@nostr-dev-kit/ndk');
  return { ...actual, NDKRelaySet: { fromRelayUrls: () => ({}) } };
});

const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const USER_SK = '66'.repeat(32);
const USER_PK = getPublicKey(bytes(USER_SK));
USER_PK_HOLDER.value = USER_PK;
const convKey = () => nip44.v2.utils.getConversationKey(bytes(USER_SK), USER_PK);
const seal = (inner: object) => nip44.v2.encrypt(JSON.stringify(inner), convKey());

const future = () => String(Math.floor(Date.now() / 1000) + 86400);
let n = 0;
function wrap(d: string, tags: string[][], content: string, created_at = 100) {
  return { id: 'evt' + ++n, pubkey: USER_PK, kind: 31234, content, created_at, tags: [['d', d], ...tags] };
}

const recipeWrap = () =>
  wrap(
    'draft_1700000000000_abc1234',
    [['k', '30023'], ['draft-type', 'recipe'], ['expiration', future()]],
    seal({ kind: 30023, content: '## Ingredients\n\n- water', tags: [['title', 'Soup']], created_at: 100 })
  );
// Sidecar's note draft, as composer-core's relayDraftWrap writes it.
const sidecarNoteWrap = (content = seal({ kind: 1, content: 'Soup weather at last', tags: [], created_at: 100 })) =>
  wrap('sidecar-1792000000-a1b2c3', [['k', '1'], ['expiration', future()]], content);

function relaysHold(...events: object[]) {
  fakeNdk.fetchEvents = vi.fn(async (filter: { kinds: number[] }) =>
    filter.kinds.includes(31234) ? new Set(events) : new Set()
  );
}

beforeEach(() => {
  vi.resetModules();
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  decryptCalls.length = 0;
  (globalThis as any).window = {
    nostr: {
      nip44: {
        decrypt: async (pk: string, ct: string) => {
          decryptCalls.push(ct);
          return nip44.v2.decrypt(ct, nip44.v2.utils.getConversationKey(bytes(USER_SK), pk));
        },
        encrypt: async (pk: string, pt: string) =>
          nip44.v2.encrypt(pt, nip44.v2.utils.getConversationKey(bytes(USER_SK), pk))
      }
    }
  };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe("other apps' drafts under kind 31234", () => {
  it('a Sidecar note draft (k=1) is not read as an untitled recipe', async () => {
    relaysHold(recipeWrap(), sidecarNoteWrap());
    const { fetchRemoteDrafts, fetchRemoteDraftSet } = await import('./nip37DraftService');

    const drafts = await fetchRemoteDrafts();
    expect(drafts.map((d) => d.id)).toEqual(['draft_1700000000000_abc1234']);
    expect(drafts.map((d) => d.draftType)).toEqual(['recipe']);

    const set = await fetchRemoteDraftSet();
    expect(set.foreignIds).toEqual(['sidecar-1792000000-a1b2c3']);
  });

  it('is judged by its k tag alone: never decrypted', async () => {
    const recipe = recipeWrap();
    relaysHold(recipe, sidecarNoteWrap());
    const { fetchRemoteDraftSet } = await import('./nip37DraftService');

    await fetchRemoteDraftSet();
    expect(decryptCalls).toEqual([recipe.content]);
  });

  it('a wrap with no k tag is judged by the event inside', async () => {
    relaysHold(
      wrap('legacy-note', [['expiration', future()]], seal({ kind: 1, content: 'hi', tags: [], created_at: 1 })),
      wrap('legacy-recipe', [['expiration', future()]], seal({ kind: 30023, content: 'x', tags: [['title', 'Bread']], created_at: 1 }))
    );
    const { fetchRemoteDraftSet } = await import('./nip37DraftService');

    const set = await fetchRemoteDraftSet();
    expect(set.drafts.map((d) => d.id)).toEqual(['legacy-recipe']);
    expect(set.foreignIds).toEqual(['legacy-note']);
  });

  it("a deleted (blanked) Sidecar draft is still reported as another app's", async () => {
    // So a stale local copy of it is dropped rather than republished.
    relaysHold(sidecarNoteWrap(''));
    const { fetchRemoteDraftSet } = await import('./nip37DraftService');

    const set = await fetchRemoteDraftSet();
    expect(set.drafts).toEqual([]);
    expect(set.foreignIds).toEqual(['sidecar-1792000000-a1b2c3']);
  });

  it("this app's own article drafts (k=30023, draft-type=article) are kept", async () => {
    relaysHold(
      wrap(
        'draft_1700000000001_art0001',
        [['k', '30023'], ['draft-type', 'article'], ['expiration', future()]],
        seal({ kind: 30023, content: '<p>Hello</p>', tags: [['title', 'Essay']], created_at: 100 })
      )
    );
    const { fetchRemoteDraftSet } = await import('./nip37DraftService');

    const set = await fetchRemoteDraftSet();
    expect(set.drafts.map((d) => [d.id, d.draftType])).toEqual([['draft_1700000000001_art0001', 'article']]);
    expect(set.foreignIds).toEqual([]);
  });
});
