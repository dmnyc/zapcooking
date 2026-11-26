/**
 * The browser side of composer draft sync (composerDrafts.ts): this app's
 * signer for NIP-44 to self and for signing, its private relay list for
 * where drafts go, and NDK to publish and read.
 *
 * Sent to the private relays (NIP-37); read from them AND the account's
 * write relays, since other clients keep drafts there too. A dry run
 * (dryRunRequested, read at the moment of publishing) logs the event and
 * sends nothing.
 */
import { get } from 'svelte/store';
import { NDKEvent, NDKRelaySet, type NDKFilter } from '@nostr-dev-kit/ndk';
import { ndk, userPublickey } from '$lib/nostr';
import { encrypt, decryptWithSource, detectEncryptionMethod } from '$lib/encryptionService';
import { getPrivateRelays } from '$lib/nip37DraftService';
import { getOutboxRelays } from '$lib/relayListCache';
import { dryRunRequested } from '$lib/sidecar/host';
import { createDraftSync, type CoreHelpers, type SyncIO } from '$lib/composerDrafts';

const QUERY_TIMEOUT_MS = 8000;
const PUBLISH_TIMEOUT_MS = 10000;

const dedupe = (urls: string[]) => {
  const seen = new Set<string>();
  return urls.filter((u) => {
    const key = u.replace(/\/+$/, '').toLowerCase();
    if (!/^wss?:\/\//i.test(u) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function browserDraftIO(core: CoreHelpers, NT: unknown): SyncIO {
  const me = () => (get(userPublickey) as unknown as string) || '';
  return {
    core,
    NT,
    selfPubkey: me,
    encrypt: async (plaintext) => (await encrypt(me(), plaintext, 'nip44')).ciphertext,
    decrypt: async (ciphertext) =>
      (await decryptWithSource(me(), ciphertext, detectEncryptionMethod(ciphertext))).plaintext,
    writeRelays: async () => dedupe(await getPrivateRelays(me())),
    readRelays: async () => {
      const [priv, writes] = await Promise.all([
        getPrivateRelays(me()).catch(() => [] as string[]),
        getOutboxRelays(me()).catch(() => [] as string[])
      ]);
      return dedupe([...priv, ...writes]);
    },
    publish: async (relays, template) => {
      const $ndk = get(ndk);
      const event = new NDKEvent($ndk, template as never);
      await event.sign();
      if (dryRunRequested()) {
        console.log('[composer drafts dry-run] would publish', template.kind, template.tags, 'to', relays);
        return;
      }
      if (!relays.length) throw new Error('no draft relays');
      // Throws unless at least one relay took it.
      await event.publish(NDKRelaySet.fromRelayUrls(relays, $ndk), PUBLISH_TIMEOUT_MS, 1);
    },
    query: async (relays, filter) => {
      if (!relays.length) return [];
      const $ndk = get(ndk);
      const events = await Promise.race([
        $ndk.fetchEvents(filter as NDKFilter, { closeOnEose: true }, NDKRelaySet.fromRelayUrls(relays, $ndk)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), QUERY_TIMEOUT_MS))
      ]);
      return [...events].map((e) => e.rawEvent() as never);
    },
    now: () => Date.now()
  };
}

let shared: ReturnType<typeof createDraftSync> | null = null;

/** One sync for the page: the composer and "Sync now" share it, and a sync
 *  started as the composer closes finishes after it is gone. */
export function composerDraftSync(core: CoreHelpers, NT: unknown) {
  if (!shared) shared = createDraftSync(browserDraftIO(core, NT));
  return shared;
}
