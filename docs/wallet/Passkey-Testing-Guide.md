# Passkey Wallet Testing Guide

Test matrix for WebAuthn passkey integration with Breez Spark wallets.

## Prerequisites

- Chrome 116+ or Edge (Firefox/Safari do not support PRF extension yet)
- Device with platform authenticator (Touch ID, Windows Hello, etc.)
- Logged into zap.cooking with a Nostr identity

## Test Scenarios

### 1. Create wallet with passkey (seedless)

1. Navigate to Wallet page
2. Click **+ Add Wallet** → select **Breez Spark**
3. Click **Create with Passkey**
4. Authenticate with your device passkey (Touch ID / biometric prompt)
5. Wait for wallet initialization

**Expected:** Wallet created, balance shows 0, no recovery phrase prompt shown.

**Verify:** The wallet is functional — try generating a receive invoice.

### 2. Create wallet with mnemonic, then protect with passkey

1. Navigate to Wallet page
2. Click **+ Add Wallet** → select **Breez Spark**
3. Click **Create New Wallet**
4. Dismiss or complete the backup reminder
5. Expand wallet settings (gear icon)
6. In **Backup & Recovery**, click **Passkey**
7. Authenticate with your device passkey

**Expected:** Toast shows "Wallet protected with passkey!" Button changes to "Passkey Active" with green border.

### 3. Restore mnemonic wallet from passkey

Requires: Test 2 completed (mnemonic wallet protected with passkey).

1. Remove the wallet (gear icon → **Remove Wallet** → confirm)
2. Click **+ Add Wallet** → select **Breez Spark**
3. Under **Restore Existing Wallet**, click **Restore from Passkey**
4. Authenticate with the same passkey used during backup

**Expected:** Wallet restored with original balance and transaction history.

### 4. Restore seedless wallet from passkey

Requires: Test 1 completed (wallet created with passkey).

1. Remove the wallet
2. Click **+ Add Wallet** → select **Breez Spark**
3. Under **Restore Existing Wallet**, click **Restore from Passkey**
4. Authenticate with the same passkey

**Expected:** Same wallet restored (same passkey + same name = same deterministic seed). Note: seedless restore fetches the encrypted backup from Nostr; if none exists, it will fail.

### 5. Passkey unavailable gracefully hidden

1. Test in Firefox or Safari (no PRF support), or a device without platform authenticator

**Expected:** "Create with Passkey" button not shown. "Restore from Passkey" button not shown. "Passkey" button not shown in Backup & Recovery settings.

### 6. Wrong passkey shows error

Requires: Test 2 completed with one passkey.

1. Remove the wallet
2. Try to restore from passkey using a *different* passkey (e.g., created on another device or profile)

**Expected:** Error: "Decryption failed — wrong passkey or corrupted backup"

### 7. Delete confirmation with passkey active

Requires: Passkey backup active (Test 2).

1. Expand wallet settings → click **Remove Wallet**

**Expected:** Green banner shows "Passkey active — you can restore this wallet anytime." instead of the "Save a backup first" warning.

### 8. Backup reminder after mnemonic wallet creation

1. Create a new mnemonic wallet (not passkey)

**Expected:** Non-blocking backup reminder banner appears below the balance with three options:
- Write down recovery phrase (reveals mnemonic inline)
- Backup to Nostr
- Protect with passkey (if available)

Dismissing the reminder persists the dismissal across page loads.

## Browser Compatibility

| Browser | Passkey PRF | Status |
|---------|------------|--------|
| Chrome 116+ | Yes | Supported |
| Edge 116+ | Yes | Supported |
| Firefox | No | Buttons hidden |
| Safari | No | Buttons hidden |

## Architecture Notes

- **Mnemonic wallet + passkey backup:** Passkey PRF derives a 32-byte AES-GCM key. The existing mnemonic is encrypted with this key and stored as a Nostr kind 30078 event (d-tag: `spark-wallet-passkey`). Restore fetches the event and decrypts with the same passkey.
- **Seedless wallet (Create with Passkey):** Uses the Breez SDK `Passkey` class which derives a wallet seed deterministically from the passkey PRF. Same passkey + same wallet name = same wallet. The wallet name is stored on Nostr via the SDK.
- **Passkey availability check:** Uses `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` — no SDK WASM needed.
