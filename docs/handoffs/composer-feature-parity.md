# Composer feature parity with Sidecar

Captured 2026-11-24 from `dmnyc/sidecar` main (through PR #679), editor-matrix main
(a0ec1d5, PR #5) and `docs/composer-component.md` — the composer-component feature
list is the specification; Sidecar turns every option on, this app turns on what
fits. PRs reviewed: Sidecar #664 (articles + recipes in the full-size composer),
#669 (blank lines, line-break undo, RTL), #673 (reply kind selection), #679 (recipe
grip drag), zapcooking/frontend #1017–#1024 (matrix plan + scheduler).

Status: ✅ has it · ◐ partial · ❌ missing · — not this app's shape.

## Text

| Feature (component option) | Sidecar | Zap Cooking | Gap → slice |
|---|---|---|---|
| `mentions` — pills, suggestions, p tags | ✅ | ✅ | — |
| `bareRefs` — pasted `npub1…` becomes a reference | ✅ | ◐ | npub mentions ✓; `nevent1…`/`note1…` now offered as a quote (`941de3ca`) |
| `codeBlocks` — fenced code in preview | ✅ | ❌ | render fenced code in the note preview → slice C3 |
| `emoji` — searchable picker, skin tones | ✅ | ❌ | composer picker missing (reactions have one) → slice C2 |
| `gif` — GIF search | ✅ | ✅ | GifPicker in note + reply |
| `counter` — length meter | ✅ | ✅ | — |
| `trackingTags` — offer to strip tracking tails | ✅ | ✅ | trackingOffers |

## Media

| Feature | Sidecar | Zap Cooking | Gap → slice |
|---|---|---|---|
| `media` — files, paste, drop | ✅ | ✅ | — |
| `mediaPipeline` — EXIF/location strip, HEIC refusal, HDR, recompress | ✅ | ❌ | raw upload to nostr.build → slice C4 |
| `upload` — Blossom first, fallback, timeouts | ✅ | ◐ | nostr.build + NIP-98, no fallback list |
| `imeta` — NIP-92 tags | ✅ | ✅ | imetaTagsForMedia |
| `altText` — per-attachment editor | ✅ | ✅ | AltTextEditorModal |
| `strip` — ordered strip, drag to reorder | ✅ | ◐ | steppers + drawer (`moveMedia`); no drag → fold into C4 |
| `urlDrawer` — links under the strip | ✅ | ✅ | MediaDrawer |
| `attachOffer` — bare-URL paste offers | ✅ | ✅ | attachableUrlCandidates |
| `lightbox` | ✅ | ✅ | NoteContent/Modal |

## Notes inside notes

| Feature | Sidecar | Zap Cooking | Gap → slice |
|---|---|---|---|
| `quotes` — pasted reference becomes the quoted note | ✅ | ✅ | paste a reference and it quotes — no offer (`941de3ca`, `residue of the pill removed after hand test`); q tags at publish |
| quote block shows the note rendered | ✅ | ◐ | preview includes the quote; verify rendered body |
| `linkCards` — previews of pasted links | ✅ | ❌ | optional per spec (off sends nothing) → slice C8, last |

## Kinds and modes

| Feature | Sidecar | Zap Cooking | Gap → slice |
|---|---|---|---|
| `replies` — NIP-10 | ✅ | ✅ | — |
| comments — kind 1111, NIP-22, K tag names the root | ✅ | ✅ | postComment.ts (Sidecar #673 parity) |
| `polls` — editor and tags | ✅ | ✅ | — |
| `longform` — Write/Preview, formatted paste → markdown | ✅ | ✅ | TiptapEditor + matrix 133/145 |
| inline pictures in article bodies (GitHub `![Uploading…]` flow) | ✅ | ❌ | toolbar-URL only → slice C6 |
| per-picture alt from Preview | ✅ | ◐ | coverAlts only → fold into C6 |
| `recipes` — form + markdown sections | ✅ | ✅ | create page; grip drag adopted by Sidecar (#679) from this app |
| RTL empty fields (Arabic/Hebrew/Persian/Urdu) | ✅ (#669) | ❌ | slice C7 |

## Before and after sending

| Feature | Sidecar | Zap Cooking | Gap → slice |
|---|---|---|---|
| `drafts` — autosave, reopen, saved list | ✅ | ✅ | — |
| `relayDrafts` — NIP-37 private drafts | ✅ | ◐ | `nip37DraftService.ts` exists, unwired → slice C5 |
| `pow` — cancellable | ✅ | ✅ | powActive |
| `sendDelay` — review countdown | ✅ | ✅ | countdown |
| `duplicateGuard` — same note twice caught | ✅ | ❌ | slice C1 |
| `relayReport` — which relays took it, which refused, why | ✅ | ❌ | slice C1 |
| `clientTag` — the app's own tag | ✅ | ✅ | nip89 |

## Editing conformance (editor-matrix, 145 cases)

| Surface | Pass | Residue |
|---|---|---|
| note | 145/145 | — |
| reply | 145/145 | — |
| article | 133/145 | 8 undo cases need the runner's real-keypress typing; 2 blank-doc cases + rich-`<p>` blank-line pair are expectation adjudications; `paste-trailing-newline` trailing-edge fix pending |

## Slices, in order

- **C1 — publish integrity**: duplicateGuard + relayReport (which relays took it, which refused, why, in words).
- **C2 — composer emoji picker**: searchable, skin tones (reactions picker is the seed).
- **C3 — fenced code in notes**: preview + NoteContent rendering.
- **C4 — media pipeline + strip drag**: EXIF/location strip, HEIC refusal with a reason, recompress when large; drag-to-reorder the strip.
- **C5 — relay drafts wired**: nip37DraftService into the note composer, explicit never automatic.
- **C6 — article inline pictures**: paste/drop/pick into the body where it lands, `![Uploading…]()`
  → `![](url)`, per-picture alt from Preview.
- **C7 — RTL empty fields**: direction from content, placeholder and caret both (Sidecar #669).
- **C8 — link cards**: optional fetch-preview, off sends nothing to the link's site.
