/**
 * Passkey-based wallet protection for Breez Spark SDK.
 *
 * Uses WebAuthn PRF extension to derive an encryption key from a passkey.
 * The existing mnemonic is encrypted with this key and stored on Nostr (kind 30078),
 * allowing cross-device restore with the same passkey.
 */

import { browser } from '$app/environment';
import { logger } from '$lib/logger';
import { initWasm, initializeSdkWithSeed } from './index';

const PASSKEY_SALT = 'zapcooking-passkey-encrypt';
const PASSKEY_BACKUP_D_TAG = 'spark-wallet-passkey';

/**
 * Get a PRF-derived encryption key from a passkey.
 * Creates a new passkey if none exists.
 */
async function getPrfKey(): Promise<Uint8Array> {
  const saltBytes = new TextEncoder().encode(PASSKEY_SALT);

  // Try to authenticate with existing passkey
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        allowCredentials: [],
        extensions: {
          prf: { eval: { first: saltBytes } }
        } as any
      }
    }) as any;

    if (credential) {
      const results = credential.getClientExtensionResults();
      if (results?.prf?.results?.first) {
        return new Uint8Array(results.prf.results.first);
      }
    }
  } catch (e) {
    logger.debug('[Passkey] No existing passkey, will create one');
  }

  // Create a new passkey with PRF
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Zap Cooking', id: window.location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'Zap Cooking Wallet',
        displayName: 'Zap Cooking Wallet'
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' }
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required'
      },
      extensions: {
        prf: { eval: { first: saltBytes } }
      } as any
    }
  }) as any;

  if (!credential) throw new Error('Passkey creation was cancelled');

  const results = credential.getClientExtensionResults();
  if (results?.prf?.results?.first) {
    return new Uint8Array(results.prf.results.first);
  }

  // PRF may not return on create — re-authenticate
  const authCredential = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: [{ id: credential.rawId, type: 'public-key' }],
      extensions: {
        prf: { eval: { first: saltBytes } }
      } as any
    }
  }) as any;

  const authResults = authCredential?.getClientExtensionResults();
  if (authResults?.prf?.results?.first) {
    return new Uint8Array(authResults.prf.results.first);
  }

  throw new Error('PRF extension not supported by this passkey');
}

/**
 * Encrypt mnemonic with AES-GCM using passkey PRF key.
 */
async function encryptWithPrf(prfKey: Uint8Array, plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', prfKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  // Concatenate iv + ciphertext and base64 encode
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt mnemonic with AES-GCM using passkey PRF key.
 */
async function decryptWithPrf(prfKey: Uint8Array, encoded: string): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const key = await crypto.subtle.importKey('raw', prfKey, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/**
 * Check if passkey PRF is available on this device.
 */
export async function isPasskeyAvailable(): Promise<boolean> {
  if (!browser) return false;
  try {
    if (!window.PublicKeyCredential) return false;
    return (
      (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()) ?? false
    );
  } catch {
    return false;
  }
}

/**
 * Protect an existing wallet with a passkey.
 * Encrypts the mnemonic with passkey PRF and stores it on Nostr.
 */
export async function backupToPasskey(pubkey: string): Promise<void> {
  const { loadMnemonic } = await import('./storage');
  const mnemonic = await loadMnemonic(pubkey);
  if (!mnemonic) throw new Error('No wallet found to protect');

  // Get encryption key from passkey
  const prfKey = await getPrfKey();
  const encrypted = await encryptWithPrf(prfKey, mnemonic);

  // Store encrypted mnemonic on Nostr (kind 30078)
  const { ndk, ndkReady } = await import('$lib/nostr');
  const { NDKEvent } = await import('@nostr-dev-kit/ndk');
  const { get } = await import('svelte/store');

  await ndkReady;
  const ndkInstance = get(ndk);

  const ndkEvent = new NDKEvent(ndkInstance);
  ndkEvent.kind = 30078;
  ndkEvent.content = encrypted;
  ndkEvent.tags = [
    ['d', PASSKEY_BACKUP_D_TAG],
    ['client', 'zap.cooking'],
    ['encryption', 'passkey-aes-gcm']
  ];

  await ndkEvent.sign();
  await ndkEvent.publish();

  logger.info('[Passkey] Mnemonic encrypted and stored on Nostr');
}

/**
 * Check if a passkey backup exists on Nostr for this user.
 */
export async function hasPasskeyBackup(pubkey: string): Promise<boolean> {
  if (!browser) return false;
  try {
    const { ndk, ndkReady } = await import('$lib/nostr');
    const { get } = await import('svelte/store');

    await ndkReady;
    const ndkInstance = get(ndk);

    const events = await ndkInstance.fetchEvents(
      {
        kinds: [30078],
        authors: [pubkey],
        '#d': [PASSKEY_BACKUP_D_TAG]
      },
      { closeOnEose: true }
    );

    return events.size > 0;
  } catch {
    return false;
  }
}

/**
 * Restore a wallet from passkey.
 * Fetches encrypted mnemonic from Nostr and decrypts with passkey PRF.
 */
export async function restoreFromPasskey(pubkey: string): Promise<string> {
  const { ndk, ndkReady } = await import('$lib/nostr');
  const { get } = await import('svelte/store');

  await ndkReady;
  const ndkInstance = get(ndk);

  const events = await ndkInstance.fetchEvents(
    {
      kinds: [30078 as number],
      authors: [pubkey],
      '#d': [PASSKEY_BACKUP_D_TAG]
    },
    { closeOnEose: true }
  );

  if (events.size === 0) {
    throw new Error('No passkey backup found on Nostr');
  }

  // Get the latest event
  const event = [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  if (!event.content) throw new Error('Passkey backup event has no content');

  // Decrypt with passkey PRF
  const prfKey = await getPrfKey();
  const mnemonic = await decryptWithPrf(prfKey, event.content);

  if (!mnemonic || mnemonic.split(/\s+/).length < 12) {
    throw new Error('Decryption failed — wrong passkey or corrupted backup');
  }

  logger.info('[Passkey] Mnemonic restored from Nostr');
  return mnemonic;
}

/**
 * Create a new wallet using passkey PRF-derived seed (seedless).
 * The passkey deterministically derives the wallet — same passkey = same wallet.
 * Stores the wallet name on Nostr for discovery during restore.
 */
export async function createWithPasskey(
  pubkey: string,
  apiKey: string
): Promise<boolean> {
  await initWasm();
  const { Passkey } = await import('@breeztech/breez-sdk-spark/web');

  const provider = new BrowserPrfProvider();
  const walletName = `zapcooking-${pubkey.slice(0, 8)}`;
  const passkey = new Passkey(provider as any, { breezApiKey: apiKey });

  const wallet = await passkey.getWallet(walletName);
  await passkey.storeWalletName(walletName);

  const success = await initializeSdkWithSeed(pubkey, wallet.seed, apiKey);
  if (!success) throw new Error('Failed to initialize wallet from passkey');

  logger.info('[Passkey] Seedless wallet created with name:', walletName);
  return true;
}

/**
 * Minimal PRF provider for SDK Passkey class (used only for seedless creation).
 */
class BrowserPrfProvider {
  async derivePrfSeed(salt: string): Promise<Uint8Array> {
    const saltBytes = new TextEncoder().encode(salt);

    // Try existing passkey
    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: window.location.hostname,
          allowCredentials: [],
          extensions: { prf: { eval: { first: saltBytes } } } as any
        }
      }) as any;

      if (credential) {
        const results = credential.getClientExtensionResults();
        if (results?.prf?.results?.first) {
          return new Uint8Array(results.prf.results.first);
        }
      }
    } catch {
      // Fall through to create
    }

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Zap Cooking', id: window.location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'Zap Cooking Wallet',
          displayName: 'Zap Cooking Wallet'
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required'
        },
        extensions: { prf: { eval: { first: saltBytes } } } as any
      }
    }) as any;

    if (!credential) throw new Error('Passkey creation was cancelled');

    const results = credential.getClientExtensionResults();
    if (results?.prf?.results?.first) {
      return new Uint8Array(results.prf.results.first);
    }

    // Re-authenticate for PRF
    const auth = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        allowCredentials: [{ id: credential.rawId, type: 'public-key' }],
        extensions: { prf: { eval: { first: saltBytes } } } as any
      }
    }) as any;

    const authResults = auth?.getClientExtensionResults();
    if (authResults?.prf?.results?.first) {
      return new Uint8Array(authResults.prf.results.first);
    }

    throw new Error('PRF extension not supported');
  }

  async isPrfAvailable(): Promise<boolean> {
    try {
      if (typeof window === 'undefined') return false;
      if (!window.PublicKeyCredential) return false;
      return (
        (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()) ??
        false
      );
    } catch {
      return false;
    }
  }
}
