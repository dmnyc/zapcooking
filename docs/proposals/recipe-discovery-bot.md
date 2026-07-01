# Feature Proposal: Recipe Discovery Bot — Auto-Detect and Convert Kind 1 Recipes

## Problem

Many recipes shared on Nostr are posted as kind 1 (short text) notes — informal posts describing what someone cooked, ingredient lists, step-by-step instructions in plain text. These never make it to Zap Cooking because they aren't structured as kind 30023 long-form recipe events.

Zap Cooking already has AI-powered recipe extraction (from images and URLs), but it requires the user to actively visit the site and use it. The recipes are already out there on Nostr — we should be finding them.

## Proposed Solution

A recipe discovery service that monitors Nostr relays for kind 1 notes that look like recipes, extracts structured recipe data using AI, and offers the original author an easy path to publish it as a proper Zap Cooking recipe (kind 30023).

### How It Works

1. **Monitor**: Service subscribes to kind 1 notes across relays, filtering for recipe-like content (ingredient lists, cooking instructions, food-related keywords)
2. **Detect**: A lightweight classifier (could be regex heuristics first, AI second) scores notes for recipe likelihood
3. **Extract**: High-confidence matches are sent through the existing OpenAI extraction pipeline to produce structured recipe data (title, ingredients, directions, times, servings, tags)
4. **Notify**: The service sends the original author a DM (kind 4 or NIP-17 gift wrap) with a link or unsigned event, inviting them to claim and publish the recipe on Zap Cooking
5. **Publish**: Author clicks through to Zap Cooking where the recipe editor is pre-populated. They review, edit, and publish as their own kind 30023 event.

### Claim Flow Options

- **Option A — Link-based**: DM contains a link to `zap.cooking/create?import=<draft-id>` with the pre-populated draft stored server-side or in a NIP-37 encrypted draft
- **Option B — Unsigned event**: DM contains the unsigned kind 30023 event JSON. User's client signs and publishes it. More decentralized but requires client support.
- **Option C — Bot publishes with attribution**: Bot publishes the kind 30023 itself, tagging the original author as creator. Author can later claim/republish under their own key. Least friction but weaker ownership.

## Existing Infrastructure

- **`/src/routes/api/extract-recipe/+server.ts`** — OpenAI GPT-4o-mini extraction endpoint already converts unstructured content to the `RecipeDraft` structure (title, ingredients, directions, times, tags). Can be reused directly.
- **`/src/lib/draftStore.ts`** / **`/src/lib/nip37DraftService.ts`** — Draft storage and encrypted sync. Could store bot-generated drafts for the claim flow.
- **`/src/routes/create/+page.svelte`** — Recipe editor already supports loading pre-populated drafts.
- **NDK / relay infrastructure** — Already in place for subscribing to events and publishing.

## Architecture Considerations

The bot/scanner would be a **separate service** (not part of the SvelteKit frontend):

- Runs continuously, subscribing to relays
- Has its own Nostr keypair for sending DMs
- Calls the existing extract-recipe API or runs the OpenAI pipeline directly
- Could be a simple Node.js process, a Cloudflare Worker on a cron, or a dedicated service

## Open Questions

- **Consent**: Should the bot only process notes from users who opt in? Or notify anyone and let them ignore it?
- **Spam risk**: How to avoid the bot being perceived as spam? Rate limiting per user? Only notify once per recipe?
- **Detection accuracy**: What's the minimum confidence threshold before bothering a user? False positives waste goodwill.
- **Cost**: Continuous relay monitoring + AI extraction per candidate note. How to manage API costs at scale?
- **Monetization**: Free growth tool? Member-only claim flow? Zap-to-publish?
- **Duplicate detection**: How to avoid re-processing recipes that are already on Zap Cooking or have already been offered to the user?
- **Attribution**: When the bot identifies a recipe from a reshared/quoted note, who gets credited?
- **Bot identity**: Should the bot have a public Zap Cooking identity so users recognize it?

## Scope Phases

### Phase 1 — Manual trigger (low effort)
Add a "Import from Nostr" button on the create page where a user can paste a `note1`/`nevent1` reference to a kind 1 note, and the system fetches + extracts it. No bot needed — user-initiated.

### Phase 2 — Bot prototype
Standalone script that monitors a few relays, detects recipe-like notes, and sends DMs to authors with a claim link. Limited to English, high-confidence matches only.

### Phase 3 — Full service
Production bot with duplicate detection, opt-in/opt-out, multi-language support, and integration with the Zap Cooking draft system.

## References

- Community discussion: seth's note on recipe discoverability (2026-04-06)
- Existing extract API: `src/routes/api/extract-recipe/+server.ts`
- Recipe data model: `src/lib/draftStore.ts` (`RecipeDraft` interface)
- NIP-17 (Gift Wrap DMs): for private notifications to users
