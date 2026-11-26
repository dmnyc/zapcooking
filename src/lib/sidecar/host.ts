/**
 * The Zap Cooking host for Sidecar's composer core
 * (src/lib/vendor/sidecar/composer-core.js).
 *
 * The core is engine-only: it never opens a socket, signs, stores, or
 * fetches. Everything that touches keys, relays, storage or the network
 * arrives here as injected services (installComposer(deps) and the
 * SIDECAR_* call messages). Each one below is backed by what the app
 * already has: NDK for signing and reads, the app's relay set for targets,
 * localStorage for settings, nostr.build through the core's own uploader.
 *
 * Publishing is live; `?dry=1` on the compose route makes composerPool
 * log the signed event and report it accepted without touching a relay.
 */
import { get } from 'svelte/store';
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
import { getEventHash } from 'nostr-tools';
import { ndk, userPublickey, getCurrentRelays } from '$lib/nostr';
import {
  getProfileCache,
  getFollowedPubkeys,
  isCacheLoaded,
  loadFollowListProfiles
} from '$lib/followListCache';
import { searchProfiles, getCachedProfile } from '$lib/profileSearchService';
import { resolveProfileByPubkey } from '$lib/profileResolver';
import { showToast } from '$lib/toast';
import './sidecar-globals.js';

type SignedEvent = Record<string, unknown>;
type CallMsg = { type: string; [key: string]: unknown };

const SETTINGS_KEY = 'zapcooking_composer_settings';

function composerSettings(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Sign a template with the signed-in account: the SIDECAR_OWNER_SIGN
 * answer. Returns the full signed event (id/pubkey/sig/tags/content), which
 * is what NIP-98 auth headers and publishToRelays both carry. */
async function ownerSign(msg: { event: Record<string, unknown>; expectedPubkey?: string }): Promise<SignedEvent> {
  const $ndk = get(ndk);
  if (!$ndk?.signer) throw new Error('Not signed in');
  // Signed as built, through the signer directly. NDKEvent.sign() runs its
  // own content tagging first, which adds a second set of p/t tags (a t
  // per "#1", hashtags in their written case) on top of the ones the core
  // already derived from the text.
  const user = await $ndk.signer.user();
  const e = msg.event as {
    kind: number;
    content: string;
    tags: string[][];
    created_at?: number;
  };
  const unsigned = {
    kind: e.kind,
    content: e.content || '',
    tags: e.tags || [],
    created_at: e.created_at || Math.floor(Date.now() / 1000),
    pubkey: user.pubkey
  };
  const id = getEventHash(unsigned);
  const sig = await $ndk.signer.sign({ ...unsigned, id } as never);
  if (msg.expectedPubkey && unsigned.pubkey !== msg.expectedPubkey) {
    throw new Error('Signed as the wrong account');
  }
  return { ...unsigned, id, sig } as SignedEvent;
}

/** The SIDECAR_* messages the core sends, answered from the app. */
export async function hostCall(msg: CallMsg): Promise<unknown> {
  switch (msg.type) {
    case 'SIDECAR_OWNER_SIGN':
      return ownerSign(msg as unknown as { event: Record<string, unknown>; expectedPubkey?: string });
    case 'SIDECAR_GET_SETTINGS':
      return composerSettings();
    case 'SIDECAR_GET_RELAYS':
    case 'SIDECAR_GET_ACCOUNT_RELAYS':
      return Object.fromEntries(getCurrentRelays().map((url) => [url, { read: true, write: true }]));
    case 'SIDECAR_FETCH_OG':
      return null; // link cards are off in the spike
    case 'SIDECAR_SECRET_GET':
    case 'SIDECAR_SECRET_SET':
    case 'SIDECAR_OWNER_ENCRYPT':
    case 'SIDECAR_OWNER_DECRYPT':
      return Promise.reject(new Error('Not available in the Zap Cooking spike'));
    default:
      return Promise.reject(new Error('Unknown host call: ' + msg.type));
  }
}

/**
 * The relay pool the core publishes and reads through. DRY-RUN unless
 * `live`: publish logs the signed event and reports every relay accepted,
 * so the spike never sends until someone turns it on.
 */
/** A dry run asked for: `?dry=1` in the address, or the
 * `zapcooking_compose_dry` flag in localStorage (for test runs, where the
 * address can change under the page). Read when a post goes out, not at
 * mount, so it cannot go stale. */
export function dryRunRequested(): boolean {
  try {
    if (new URL(location.href).searchParams.has('dry')) return true;
    return localStorage.getItem('zapcooking_compose_dry') === '1';
  } catch {
    return false;
  }
}

export function composerPool(live: boolean) {
  return {
    publish: (targets: string[], signed: SignedEvent, _params?: unknown) =>
      targets.map((url) =>
        (async () => {
          if (!live || dryRunRequested()) {
            console.log('[composer-spike dry-run]', url, 'would publish', signed.id);
            return;
          }
          // One relay set per URL, so each relay answers on its own and the
          // core's report can say which took it. NDK connects as needed and
          // throws when the relay refuses or never answers — a rejection is
          // what publishToRelays counts as failed.
          const $ndk = get(ndk);
          const ev = new NDKEvent($ndk, signed as never);
          await ev.publish(NDKRelaySet.fromRelayUrls([url], $ndk), 10_000, 1);
        })()
      ),
    close: () => {},
    get: async (relays: string[], filter: Record<string, unknown>) => {
      void relays;
      const $ndk = get(ndk);
      const events = await $ndk.fetchEvents(filter as never);
      const first = [...events][0];
      return first ? [first] : [];
    },
    querySync: () => []
  };
}

/** A profile as the core reads one: a display name and a picture. */
type CoreProfile = { pubkey?: string; name: string; picture?: string };

function cachedCoreProfile(pubkey: string): CoreProfile | null {
  const followed = getProfileCache().get(pubkey);
  if (followed?.name) return { pubkey, name: followed.name, picture: followed.picture };
  const searched = getCachedProfile(pubkey);
  const name = searched?.displayName || searched?.name;
  return name ? { pubkey, name, picture: searched?.picture } : null;
}

async function fetchCoreProfile(pubkey: string): Promise<CoreProfile | null> {
  const cached = cachedCoreProfile(pubkey);
  if (cached) return cached;
  try {
    const p = await resolveProfileByPubkey(pubkey, get(ndk));
    const name = p?.display_name || p?.name;
    return name ? { pubkey, name, picture: p?.picture } : null;
  } catch {
    return null;
  }
}

/** The people someone follows, as mention candidates. */
function followCandidates(): CoreProfile[] {
  const cache = getProfileCache();
  const out: CoreProfile[] = [];
  for (const pk of getFollowedPubkeys()) {
    const p = cache.get(pk);
    if (p?.name) out.push({ pubkey: pk, name: p.name, picture: p.picture });
  }
  return out;
}

/** Sidecar's avatar painter: an <img> in the round box, the box's own
 * gradient when there is no picture. */
export function applyAvatar(box: HTMLElement, a?: { picture?: string }) {
  box.replaceChildren();
  if (!a?.picture) return;
  const img = document.createElement('img');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.src = a.picture;
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
  img.onerror = () => img.remove();
  box.append(img);
}

/** Build the installComposer(deps) object. Mentions search the follow list
 * first and then the app's profile search (the same Primal + NDK search the
 * old composers used); profiles come from the app's caches and resolver. */
export interface SidecarDeps extends Record<string, unknown> {
  NT: unknown;
  call: (msg: CallMsg) => Promise<unknown>;
  relayUrls: (writableOnly?: boolean) => string[];
  activePubkey: () => string;
  pool: unknown;
}

export function buildSidecarDeps(live: boolean): SidecarDeps {
  const NT = (window as unknown as { NostrTools: unknown }).NostrTools;
  const pool = composerPool(live);
  return {
    NT,
    // Said on screen, as Sidecar does: the core calls this only for an
    // account whose own Blossom servers all refused the file, so the link
    // in the note is not where its owner expects it.
    onUploadFallback: (message: string) => showToast('info', message, 7000),
    devLog: (level: string, msg: string, data?: unknown) =>
      console.log('[composer devlog]', level, msg, data ?? ''),
    applyAvatar,
    cachedProfile: (pubkey: string) => cachedCoreProfile(pubkey),
    cacheProfile: () => {},
    fetchPreviewProfile: (pubkey: string) => fetchCoreProfile(pubkey),
    // null, not [], until the follows are loaded: the core reads an empty
    // list as "loaded, follows nobody" and never asks again.
    getFollowList: async () => {
      await loadFollowListProfiles();
      return followCandidates();
    },
    cachedFollowList: () => (isCacheLoaded() ? followCandidates() : null),
    call: hostCall,
    poolGet: async (relays: string[], filter: Record<string, unknown>) => {
      const result = (composerPool(live) as unknown as {
        get: (r: string[], f: Record<string, unknown>) => Promise<unknown[]>;
      }).get(relays, filter);
      const events = (await result) as unknown[];
      return events[0] ?? null;
    },
    poolQuerySync: () => [],
    relayUrls: (writableOnly?: boolean) => {
      void writableOnly;
      return getCurrentRelays();
    },
    activePubkey: (): string => (get(userPublickey) as unknown as string) || '',
    onUploadNotice: (message: string) => showToast('info', message, 7000),
    reduceBalanceMotion: () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    // Name search across Nostr is always on here, as it was in the old
    // composers: true skips Sidecar's one-time ask (naAskEl), which this
    // app has no setting for.
    naSetting: async () => true,
    naAvailable: () => true,
    naDecide: async () => true,
    naAskEl: () => null,
    naSuggest: async (query: string) => {
      const found = await searchProfiles(query, 8);
      return found
        .map((p) => ({ pubkey: p.pubkey, name: p.displayName || p.name || '', picture: p.picture }))
        .filter((p) => p.name);
    },
    naAsk: async () => [],
    noteActivity: () => {},
    shortNpub: (npub: string) => npub.slice(0, 12) + '…',
    pool
  };
}
