# Monocomposer vs Sidecar: the gaps

The monocomposer (`src/lib/sidecar/mount.ts`, branch `feat/composer-drafts`)
side by side with Sidecar's full-size composer (`compose.js`, `longform.js`,
`composer-core.js` at cf29ba5f). `composer-feature-parity.md` compares Sidecar
with this app's *old* composers; this compares it with the new one, and calls
out where the new one is behind the old.

✅ matches · ◐ partial · ❌ missing · ➖ different on purpose

## Blockers: behind what the app ships today

The + menu on this branch opens the monocomposer for Post, Recipe and
Article, so each of these is a regression until it closes.

| # | Gap | Today's app | Monocomposer |
|---|---|---|---|
| B1 | **Tags from the text**: `p` per mention, `q` per quote, `t` per hashtag | ✅ | ✅ fixed: `noteBodyTags(proseWithQuotes(text, media))`, after the client tag, as Sidecar orders them. Signing now skips NDK's own content tagging, which doubled the t tags |
| B2 | **Recipes publish** | ✅ /create | ❌ "lands with the longform port"; the cover can't be uploaded, and the form requires one |
| B3 | **Articles publish** | ✅ LongformEditorModal | ❌ same; cover placeholder, no Preview |
| B4 | **Proof of work** | ✅ | ✅ fixed: the hammer cycles Off/16/18/20/22 from the Settings default; mined in the background on the app's miner and indicator, signed as mined, draft kept until it is out |
| B5 | **Pasted quote is invisible** | ✅ | ✅ fixed: shown as the quoted note in the strip, moves above or below the pictures, two taps to remove. A note no relay has goes back into the text after what was written (it used to replace the whole text) |

## Notes editor

| Feature | Sidecar | Mono | Note |
|---|---|---|---|
| Mention pills, follows first, global search | ✅ | ✅ | real profiles via followListCache/profileSearchService |
| Emoji picker | ✅ | ✅ | |
| GIF search | ✅ | ◐ | a picked GIF gets no starting ALT from its title |
| Paste/drop files → upload | ✅ | ✅ | |
| Image URL alone on a line → "Attach this image" | ✅ | ✅ | |
| Tracking-tag cleanup | ✅ | ✅ | the core editor's own row (not hand-tested here) |
| **http → https offer**, and Post held once over http links | ✅ | ❌ | core:2944–3073 |
| Bare npub/nevent → `nostr:` on publish | ✅ | ✅ | `linkBareRefs`, with B1 |
| Character count | ✅ | ✅ | in the Write/Preview row |
| Placeholder per mode (reply / poll / note) | ✅ | ◐ | one placeholder for notes and polls |

## Attachments

| Feature | Sidecar | Mono | Note |
|---|---|---|---|
| Blossom first, nostr.build fallback, NIP-98 | ✅ | ✅ | the core's uploader; not tried against real servers |
| EXIF/GPS strip, HEIC refusal, PNG→JPEG, 100MB cap | ✅ | ✅ | inside the core's uploadMedia; untested here |
| "Went to nostr.build instead" / HDR notices | ✅ toast | ✅ | toasts; the fallback one only for an account whose own Blossom servers refused |
| Upload in progress | ✅ stripes | ✅ | stripes plus a placeholder cell per file |
| Strip: drag, ←/→, remove | ✅ | ✅ | |
| ALT editor, imeta (video type/size) | ✅ | ✅ | |
| **Links drawer** ("N attachments, added to the end"; copy links) | ✅ | ❌ | `buildMediaDrawer` |
| Quote card in the strip, move above/below the pictures | ✅ | ✅ | B5 |
| Strip hidden in Preview | ❌ | ➖ | asked for here |

## Replies and quotes

| Feature | Sidecar | Mono | Note |
|---|---|---|---|
| Reply target block, NIP-10 / NIP-22 tags | ✅ | ❌ | replies still go through the app's reply composer; not a regression until the monocomposer takes them |
| Reply drafts kept apart | ✅ | ❌ | |
| Pasted reference → quote; falls back to text when not found | ✅ | ✅ | with a toast, as Sidecar |
| "Move the quote into the attachments" offer | ✅ | ❌ | |

## Polls

| Feature | Sidecar | Mono | Note |
|---|---|---|---|
| Options, multiple choice, runs-for, relay tags | ✅ | ✅ | the core's poll editor |
| Poll or media, not both | ✅ | ✅ | |
| Notes and Polls keep separate drafts | ❌ one draft, the poll attached to it | ✅ | each tab brings back its own; written up for Sidecar in editor-matrix |
| Options in Preview / review | ❌ | ❌ | a gap in both |

## Posting

| Feature | Sidecar | Mono | Note |
|---|---|---|---|
| Review countdown | ✅ preview of the note, Post now / Cancel | ◐ | this app's wide fill bar; no preview of the note during the countdown |
| **Repeat-post guard** ("You posted this X ago") | ✅ | ❌ | core:6577 |
| Relay choice | ✅ write relays | ◐ | popover works; unstyled |
| **Relay report**: which took it, which refused, why | ✅ expandable | ❌ | only "Sent to N of M" |
| After posting | receipt card: Open in…, Write another | ➖ | closes, with a toast |
| Post button stages | Signing… / Publishing… in the status line | ➖ | on the button |
| Scheduling | ❌ | ❌ | disabled button here ("lands with the scheduler port") |
| Client tag | Sidecar | ✅ | `Zap Cooking` + NIP-89 handler |

## Preview

| Feature | Sidecar | Mono | Note |
|---|---|---|---|
| Notes: mentions, media, link cards, embeds, lightbox | ✅ | ✅ | the core's renderer |
| **Articles and recipes** (safe markdown) | ✅ | ❌ | "lands with the longform port" |

## Drafts

| Feature | Sidecar | Mono | Note |
|---|---|---|---|
| Autosave while typing | ✅ 400ms | ✅ | |
| Saved on tab hide / unload | ✅ | ◐ | saved on close and on each pause; not on page hide (decided) |
| NIP-37 relay copies | ✅ explicit Save/Check | ➖ | pushed on close, read on open, Sync now; decrypt once per version |
| Drafts pane: list, open, new | ✅ | ✅ | |
| **Delete needs a second tap** | ✅ | ❌ | one tap deletes |
| **Article/recipe drafts in the list**, dot on their tab | ✅ | ❌ | kept per tab, not listed |
| **Account switch mid-draft** ("Now writing as X") | ✅ | ❌ | the account is read once, at open |

## Articles tab

| Feature | Sidecar | Mono |
|---|---|---|
| Title, summary, topics | ✅ | ✅ |
| Cover: upload, drop, by link, with ALT | ✅ | ❌ placeholder |
| Body toolbar (B, I, H, link, quote, lists, code, image) | ✅ | ◐ row present; check each |
| Word-processor keys, HTML paste → markdown | ✅ | ❌ plain textarea |
| Images in the body (`![Uploading…]`, then ALT) | ✅ | ❌ |
| Word count / reading time | ✅ | ❌ |
| Slug, address clash (Replace / New / Cancel) | ✅ | ❌ |
| Review → Publish (kind 30023) | ✅ | ❌ B3 |

## Recipes tab

| Feature | Sidecar | Mono |
|---|---|---|
| Name, summary, prep, cook, servings, notes, source | ✅ | ✅ |
| Up to 10 photos, choose the cover | ✅ | ❌ placeholder |
| Ingredient/direction lists: edit in place, drag, keys, paste splits lines | ✅ | ◐ add rows only |
| Categories: 150+, seasonal suggestions, spelling normalized | ✅ | ◐ seven fixed chips |
| "Still needed" | ✅ | ✅ |
| Zap Cooking markdown + tags, publish | ✅ | ❌ B2 |

## Elsewhere

| Feature | Sidecar | Mono | Note |
|---|---|---|---|
| Locked store / Unlock to post | ✅ | ➖ | no such state here |
| Cmd+Enter to post | ❌ | ❌ | neither |
| Light themes | ✅ | ❌ | theme mapping assumes dark |

## Ahead of Sidecar

Written up for Sidecar in editor-matrix's `docs/composer-findings.md`:

- Each relay draft version is decrypted once (Sidecar decrypts every draft on each read).
- A placeholder cell per uploading file in the strip.
- The client tag carries the NIP-89 handler (Sidecar publishes no handler).

Not sent, because Sidecar already has them or chose otherwise: one `d` per draft and
the unchanged-draft push gate (Sidecar has both); the strip hidden in Preview (Sidecar
keeps it up on purpose, so the strip can be edited there); the fill-bar timer and the
modal (design, not a gap).
