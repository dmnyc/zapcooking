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
 * Publishing is DRY-RUN by default: composerPool(false) logs the signed
 * event and reports it accepted without touching a relay. `?live=1` on the
 * compose route is the switch that actually sends.
 */
import { get } from 'svelte/store';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { ndk, userPublickey, getCurrentRelays } from '$lib/nostr';
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
  const event = new NDKEvent($ndk, msg.event as never);
  await event.sign();
  if (msg.expectedPubkey && event.pubkey !== msg.expectedPubkey) {
    throw new Error('Signed as the wrong account');
  }
  return event.rawEvent() as SignedEvent;
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
export function composerPool(live: boolean) {
  return {
    publish: (targets: string[], signed: SignedEvent, _params?: unknown) =>
      targets.map((url) =>
        (async () => {
          if (!live) {
            console.log('[composer-spike dry-run]', url, 'would publish', signed.id);
            return;
          }
          const $ndk = get(ndk);
          const ev = new NDKEvent($ndk, signed as never);
          const relay = $ndk.pool.getRelay(url, true);
          await relay.connect();
          await relay.publish(ev);
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

/** Build the installComposer(deps) object. `naAsk`/`naDecide` (the mention
 * suggestion engine) come from the app's profile search in a later pass;
 * the spike stubs them and the mention dropdown stays empty. */
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
    onUploadFallback: (message: string) => console.log('[upload fallback]', message),
    devLog: (level: string, msg: string, data?: unknown) =>
      console.log('[composer devlog]', level, msg, data ?? ''),
    applyAvatar: (el: HTMLElement) => {
      el.textContent = (el.textContent || '?').slice(0, 2);
    },
    cachedProfile: () => null,
    cacheProfile: () => {},
    fetchPreviewProfile: async () => null,
    getFollowList: async () => [],
    cachedFollowList: () => [],
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
    onUploadNotice: (message: string) => console.log('[upload notice]', message),
    reduceBalanceMotion: () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    naAsk: async () => [],
    naAvailable: () => false,
    naDecide: async () => false,
    naSetting: () => 'all',
    noteActivity: () => {},
    shortNpub: (npub: string) => npub.slice(0, 12) + '…',
    pool
  };
}
