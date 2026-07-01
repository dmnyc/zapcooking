# Proposal: Stablecoin Sending via Spark Wallet

## Overview

Add stablecoin (token) send/receive support to the existing Spark wallet integration. The Breez SDK (v0.11.0) already ships full token infrastructure — this is a wiring task, not a protocol task.

The initial scope is **send and receive of a single token** (e.g. USDT) via Spark addresses and Spark invoices. Auto-conversion (BTC ↔ token) and token issuance are out of scope for this pass.

---

## What the SDK already provides

All of this exists in `@breeztech/breez-sdk-spark` today:

| API | Description |
|-----|-------------|
| `getInfo().tokenBalances` | `Map<string, TokenBalance>` — token balance per identifier |
| `prepareSendPayment({ paymentRequest, tokenIdentifier })` | Prepare a token send to a Spark address or invoice |
| `sendPayment({ prepareResponse })` | Executes the prepared token send |
| `getTokensMetadata({ tokenIdentifiers })` | Fetch name, ticker, decimals for any token |
| `Payment.details.type === "token"` | Token payments appear in history with `metadata`, `txHash`, `txType` |
| `PaymentMethod === "token"` | Token payments flagged separately in the method field |
| `listPayments({ assetFilter: { type: "token" } })` | Filter history to token payments only |

Token sends use the exact same `prepareSendPayment` / `sendPayment` flow as BTC sends — the only difference is passing `tokenIdentifier` alongside the payment request.

---

## Token identifier

The token identifier must be known at runtime. Two options:

1. **Hardcode** a known Spark-supported stablecoin identifier (e.g. USDT on Spark) if Breez publishes one
2. **Discover** at init time: call `getInfo()` — if `tokenBalances` is non-empty, extract identifiers and call `getTokensMetadata()` to get name/ticker/decimals

Option 2 is preferred — it works regardless of which stablecoin Breez supports and doesn't require code changes when new tokens are added.

---

## Changes required

### 1. `src/lib/spark/index.ts`

**Balance fetch (`getBalance` / `refreshBalanceInternal`)**
- After reading `info.balanceSats`, also read `info.tokenBalances`
- Expose token balances via a new `tokenBalances` writable store: `Map<string, { balance: bigint, ticker: string, decimals: number }>`
- On first non-empty token balance, call `getTokensMetadata` once to populate display names and cache them

**Send (`sendPayment` / new `sendTokenPayment`)**
- Add optional `tokenIdentifier?: string` parameter to `sendPayment`
- When present, include in `prepareSendPayment` request: `{ paymentRequest: destination, tokenIdentifier, amount: BigInt(amount) }`
- Amount unit changes: token amounts use the token's `decimals` (e.g. 6 for USDT), not sats

**Transaction history (`mapSparkPayment`)**
- Add handling for `p.method === "token"` and `p.details?.type === "token"`
- Extract `details.metadata.ticker` and `details.metadata.decimals` to display correct unit
- Set `isOnchain: false`, populate `txid` from `details.txHash` if present

**Transaction interface (`walletManager.ts`)**
- Add optional fields to `Transaction`:
  ```typescript
  tokenIdentifier?: string;  // non-null = token payment
  tokenTicker?: string;       // e.g. "USDT"
  tokenDecimals?: number;     // for amount display
  tokenAmount?: bigint;       // raw token units
  ```

### 2. `src/components/wallet/WalletPanel.svelte`

**Balance display**
- Below the BTC balance pill, add token balance row(s) from `$tokenBalances`
- Format: `1,234.56 USDT` (apply `decimals` scaling to the raw `bigint`)
- Respect `$balanceVisible` toggle

**Send modal — asset selection**
- When `$tokenBalances` is non-empty, add an asset picker before the amount field:
  - "Bitcoin (sats)" — default, existing flow
  - "{Ticker}" per available token
- Selecting a token asset:
  - Changes amount label to show token ticker (e.g. "USDT")
  - Passes `tokenIdentifier` through to `sendPayment`
  - Fee display shows token fee (from `prepareResponse.fees`, in token units)

**Transaction history rows**
- For `tx.tokenTicker` present: show ticker instead of "sats" in amount column
- Drawer: Type shows "Token" or ticker, Amount in token units
- No mempool link (token txHash is a Spark internal ID, not a Bitcoin txid)

### 3. No new routes or major components needed

The asset picker is a small addition to the existing send modal, not a separate screen.

---

## Out of scope (future)

| Feature | Reason deferred |
|---------|-----------------|
| Auto-conversion (BTC ↔ token via `StableBalanceConfig`) | Requires UX for slippage settings and refund flows |
| Token issuance (`TokenIssuer` class) | Not relevant to end users |
| Fiat rate display via `listFiatRates()` | App already has a currency store; not blocking |
| Receive via token-tagged Spark invoice | Low priority until send is validated |

---

## Open questions

1. **Which token identifier?** Breez needs to publish the canonical USDT token identifier for Spark mainnet. This determines whether we can hardcode or must discover.
2. **Amount entry UX:** Token amounts use decimals (e.g. enter "12.50" USDT, send as `12500000n` with 6 decimals). Need a decimal-aware amount input, or convert from a sats-equivalent entry.
3. **Fee currency:** Token send fees — are they denominated in BTC (sats) or in the token itself? The SDK returns `prepareResponse.fees` as `bigint` — need to confirm unit from Breez docs.
4. **Spark invoice format:** Does a Spark invoice encode the expected token? If so, the `parse()` call needs to surface this so the UI can pre-select the correct asset.

---

## Suggested implementation order

1. Wire up `tokenBalances` store from `getInfo()` and display in balance section — no send changes, low risk, validates the data path
2. Add `tokenIdentifier` param to send flow and validate against a test token on testnet
3. Add asset picker to send modal
4. Handle token payments in transaction history mapper and drawer
