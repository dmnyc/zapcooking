# Harden Wallet Seed Storage with NIP-44 Encrypt-to-Self

## Problem

The wallet mnemonic is stored in localStorage encrypted with AES-GCM, but the encryption key is derived from `SHA-256(pubkey)`. Since the pubkey is public (and embedded in the localStorage key name itself), this is effectively unencrypted. Anyone with access to the browser's localStorage can trivially decrypt the mnemonic.

## Solution

Replace pubkey-derived AES encryption with **NIP-44 encrypt-to-self**. This uses the user's Nostr **private key** (held by the browser extension or NDKPrivateKeySigner) to encrypt. The encrypted blob stays in localStorage but can only be decrypted with the nsec — no additional password needed.

### Why NIP-44 encrypt-to-self?

- The nsec is the only secret the user already manages — no new credentials
- NIP-44 is already implemented in the codebase (browser extensions support it natively)
- The mnemonic is only needed once at SDK init, so one decrypt call per session
- Consistent with how Nostr apps handle sensitive data

## Prerequisites

Existing encryption utilities that wrap NIP-44:

```typescript
// encryption.ts — these should already exist in your codebase
export async function encryptToSelf<T>(data: T): Promise<string>
export async function decryptFromSelf<T>(encryptedContent: string): Promise<T>
```

These use `getEncryptionProvider()` which prefers the NIP-07 browser extension, falling back to NDKPrivateKeySigner with nostr-tools nip44.

## Implementation

### Storage Format

**V1 (legacy)**: Raw hex string of `iv(12 bytes) || aes_gcm_ciphertext`
- Detected by failing `JSON.parse()`

**V2 (new)**:
```json
{ "version": 2, "ciphertext": "<nip44_encrypted_string>" }
```

### Changes to `storage.ts`

1. **Keep** the old `deriveKey` function, renamed to `deriveKeyLegacy` — needed for V1 migration only.

2. **`saveMnemonic(pubkey, mnemonic)`**:
   - Call `encryptToSelf(mnemonic)` to get NIP-44 ciphertext
   - Store as JSON `{ version: 2, ciphertext }` at `spark_wallet_{pubkey}`

3. **`loadMnemonic(pubkey)`**:
   - Read from localStorage
   - Try `JSON.parse()`:
     - If JSON with `version: 2` → call `decryptFromSelf(ciphertext)` to recover mnemonic
     - If parse fails (raw hex = V1 legacy) → decrypt with `deriveKeyLegacy(pubkey)`, then **re-encrypt as V2** and save back (silent one-time migration)

4. **Unchanged**: `hasMnemonic()`, `deleteMnemonic()`, `clearAllWallets()` — they don't touch mnemonic content.

### Reference Implementation

```typescript
import { encryptToSelf, decryptFromSelf } from "../../nostr/encryption";

const LOCAL_STORAGE_KEY_PREFIX = "spark_wallet_";

interface StoredMnemonicV2 {
  version: 2;
  ciphertext: string;
}

// --- Legacy V1 support (for migration only) ---

async function deriveKeyLegacy(pubkey: string): Promise<CryptoKey> {
  const pubkeyBytes = hexToBytes(pubkey);
  const keyMaterial = sha256(pubkeyBytes);
  const keyBuffer = new Uint8Array(keyMaterial).buffer as ArrayBuffer;
  return crypto.subtle.importKey("raw", keyBuffer, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function decryptV1(pubkey: string, storedDataHex: string): Promise<string> {
  const storedData = hexToBytes(storedDataHex);
  const iv = storedData.slice(0, 12);
  const ciphertext = storedData.slice(12);
  const key = await deriveKeyLegacy(pubkey);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

// --- V2 (NIP-44 encrypt-to-self) ---

export async function saveMnemonic(
  pubkey: string,
  mnemonic: string,
): Promise<void> {
  const ciphertext = await encryptToSelf(mnemonic);
  const stored: StoredMnemonicV2 = { version: 2, ciphertext };
  localStorage.setItem(
    `${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`,
    JSON.stringify(stored),
  );
}

export async function loadMnemonic(pubkey: string): Promise<string | null> {
  const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`);
  if (!raw) return null;

  try {
    // Try V2 JSON format first
    const parsed = JSON.parse(raw) as StoredMnemonicV2;
    if (parsed.version === 2 && parsed.ciphertext) {
      return await decryptFromSelf<string>(parsed.ciphertext);
    }
  } catch {
    // JSON parse failed — this is a V1 legacy hex string
  }

  // V1 legacy: decrypt with old method, then migrate to V2
  try {
    const mnemonic = await decryptV1(pubkey, raw);
    // Silent migration: re-encrypt as V2
    await saveMnemonic(pubkey, mnemonic);
    return mnemonic;
  } catch (error) {
    console.error("[Wallet Storage] Failed to decrypt mnemonic:", error);
    return null;
  }
}

// hasMnemonic, deleteMnemonic, clearAll — unchanged
```

### Call Site Changes

None required. `saveMnemonic` and `loadMnemonic` are already async and called with `await` throughout the wallet connection code.

## Verification Checklist

- [ ] `npm run build` passes
- [ ] Create new wallet → localStorage value is JSON with `version: 2`, not raw hex
- [ ] App restart → wallet reconnects (one NIP-44 decrypt via extension)
- [ ] Existing V1 wallet → silently migrated to V2 on first load
- [ ] View mnemonic → still works
- [ ] Backup/restore → still works
- [ ] Send payment → wallet functions normally after decrypt
- [ ] Log out → localStorage blob is unreadable without nsec
- [ ] Log back in → wallet reconnects
- [ ] Delete wallet → localStorage entry removed cleanly
