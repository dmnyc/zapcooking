# Monocomposer: staging test map

What to test on the fork's Vercel preview before any of the monocomposer
reaches upstream, slice by slice. The feature-by-feature comparison is
`monocomposer-vs-sidecar.md`; this is the order to try it in and what each
step should show. Results go in the log at the end, so nothing found on
staging lives only in a chat.

## The stack

Four branches, each based on the one below it, each a pull request on the
fork against the one below, all merged with `upstream/main` at a902ce4f.
The preview of the top branch is the full composer.

| # | Branch | What it brings |
|---|---|---|
| 1 | `fix/drafts-foreign-kinds` | Other apps' drafts under kind 31234 are left alone, not read as untitled recipes |
| 2 | `fix/composer-editor-matrix` | The old composers' paste, drop, copy and undo fixes; the monocomposer as a modal; the + menu |
| 3 | `feat/composer-drafts` | Drafts (device as you type, relays on close), tags from the text, quotes in the strip, pictures with descriptions, separate note and poll drafts, two-tap delete, picker and preview fixes |
| 4 | `feat/composer-pow` | Proof of work |

A fix found on staging lands on the slice it belongs to, then merges up the
stack. One push per round.

## Before testing

- **This publishes for real.** Preview builds post to real relays, and
  drafts go to the account's real draft relays. Use a throwaway account
  for the first pass, and your own only for the checks that need your
  follows, your relays or your signer.
- **Signers.** Run the draft and posting checks once with a key signed in
  directly, then again with a remote signer (Amber, Primal). The draft
  sync was written to ask the signer as little as possible, and only a
  real remote signer shows whether it does.
- **Sizes.** Phone (390), tablet (1024) and desktop (1280). Reload after
  resizing.
- **Sidecar.** For the round-trip checks, Sidecar signed in with the same
  account.

✱ marks a check that has only ever been run as a dry run, against no real
relay or signer. Those are the ones staging exists for.

## 1. Other apps' drafts (`fix/drafts-foreign-kinds`)

- [ ] ✱ With Sidecar note drafts on the account, the profile's Drafts tab
  shows no "Untitled Draft" cards for them.
- [ ] ✱ A recipe draft saved here still syncs: save one, open the app in
  another browser, it is there.
- [ ] ✱ Sidecar's note drafts are untouched afterward: open Sidecar, they
  are all still there with their text. (The danger this branch closes was
  a stale local copy being republished as a recipe over Sidecar's draft.)
- [ ] Article drafts still list and open.

## 2. The old composers, and the monocomposer arriving

The old composers still write replies, quote reposts, and everything the
Scheduled page opens, so their fixes are tested where they are used.

- [ ] Reply: paste a paragraph from another app, undo, redo. Text and
  caret where expected.
- [ ] Reply: copy and paste within the box; cut and undo.
- [ ] Reply: drag a picture in.
- [ ] Article editor (old Reads modal, if still reachable): paste
  paragraphs, a table, text with pictures (pictures dropped); Cmd-A then
  an arrow key.
- [ ] Pasting a note reference into a reply quotes it right away.
- [ ] The + menu reads Create, then Post, Recipe, Article, Drafts.
- [ ] Post, Recipe and Article open the monocomposer on that tab, as a
  modal, at every size. Escape and the close button close it; Escape in
  an open picker closes only the picker.
- [ ] Drafts opens the monocomposer on its drafts list.
- [ ] Recipes and Reads tabs: forms show; publishing is not expected to
  work yet (B2, B3).

## 3. Notes, polls and drafts (`feat/composer-drafts`)

### Writing a note

- [ ] Type a mention: follows come first, then search. The pill reads as
  a name.
- [ ] Preview: mentions in the accent, with names, for a new note and for
  one opened from the drafts list.
- [ ] Hashtags, a pasted npub and a pasted nevent.
- [ ] ✱ Post. In another client, the note has a `p` tag per mention, a
  `q` per quote, a `t` per hashtag (no duplicates), and
  `["client", "Zap Cooking", "31990:…"]`. A bare npub/nevent was posted
  as `nostr:…`.
- [ ] Emoji picker and GIF picker: full width, scrolled into view above
  the footer, at every size.
- [ ] ✱ GIF search returns results (through the app's own proxy and key).
- [ ] Character count.

### Pictures and quotes

- [ ] ✱ Attach two pictures: each shows grayed with "Uploading…" until it
  lands; the Media button stripes; Post waits.
- [ ] ✱ An upload that falls back or is HDR says so in a toast.
- [ ] Select a picture: its ALT editor opens. Write a description.
- [ ] Reorder by drag and by the arrow keys; remove one.
- [ ] ✱ Post: each picture's `imeta` carries its description, type and
  size.
- [ ] Paste a note link: it shows in the strip as the quoted note. Move it
  above and below the pictures. Remove it: two taps.
- [ ] Paste a link to a note no relay has: it goes back into the text
  after what was written, with a toast. Nothing written is lost.

### Polls

- [ ] Polls tab: options, "Allow multiple choices" (the box shows when it
  is on), runs-for. No Remove poll.
- [ ] The "some clients cannot show polls" note is a quiet footnote.
- [ ] Media is off on Polls.
- [ ] ✱ Post a multiple-choice poll: kind 1068 with
  `["polltype", "multiplechoice"]` and `endsAt`. Vote on it in another
  client.

### Separate note and poll drafts

- [ ] Write a note, switch to Polls, write a question and two options,
  switch back and forth: each tab shows only its own.
- [ ] The drafts list shows a note and a poll. Opening the poll opens it
  on Polls; the note is still on Notes.
- [ ] Close, reopen on Notes: the note, no poll. "New poll" on the Polls
  tab's list starts a fresh poll.

### Drafts across devices

- [ ] Type, wait a moment, reload: the text is back (device save).
- [ ] ✱ Close the composer: the draft's cloud turns to the check (on your
  relays). Open the app in a second browser on the same account: the
  draft is there, once.
- [ ] ✱ Edit it on the second browser, close; open on the first: the
  edit is there, and still one draft, not two.
- [ ] ✱ Kill the tab mid-draft (close the browser window without closing
  the composer); reopen the app and the composer: the draft catches up
  to the relays on open.
- [ ] ✱ Sync now: the list refreshes, states correct.
- [ ] ✱ Remote signer: count the prompts. Opening the composer with
  nothing new should not ask to decrypt every draft again; a draft
  already opened on this device is not decrypted a second time.
- [ ] ✱ Post a draft: it leaves the list, and from the second browser
  too (its relay copy is blanked).
- [ ] Delete: one tap asks ("Delete this draft?" or "Delete it from your
  relays?"), it settles back after 4 seconds; a second tap on the trash
  or the row deletes it. ✱ From the second browser, it is gone too.
- [ ] ✱ Sidecar round trip: a note drafted here opens in Sidecar's Saved
  drafts, and one drafted in Sidecar opens here.

### Posting

- [ ] Send countdown on: the fill bar runs; Cancel stops it; the note is
  signed only after it ends.
- [ ] ✱ Relay choice: post to a subset; it lands only there. The toast
  says "Sent to N of M".
- [ ] The button carries the stage: Signing…, Posting…. The composer
  closes after posting, with a toast.

## 4. Proof of work (`feat/composer-pow`)

- [ ] The hammer starts at the Settings default; tapping cycles Off, 16,
  18, 20, 22. Changing Settings re-seeds it.
- [ ] ✱ Post at 16: the composer closes, the mining indicator runs on the
  + button, and the toast says the bits and the relays when it lands. The
  note has a `nonce` tag with 16 or more leading zero bits.
- [ ] ✱ Stop mid-mine: "Mining stopped. Your draft is saved." The draft is
  in the list.
- [ ] A second post while one is mining is refused.
- [ ] ✱ Remote signer: one signing prompt, after mining, not before.

## Not expected to work yet

These are gaps, listed so they are not logged as bugs. Each is in
`monocomposer-vs-sidecar.md`.

- Recipes and articles don't publish (B2, B3).
- Scheduling (B6). The Scheduled page's New post, Reschedule and calendar
  times open the old composer, which should still schedule as it does on
  upstream; test that it still does.
- Replies, quote reposts and live-stream sharing open the old composer.
- No relay report beyond "Sent to N of M"; no repeat-post guard; no
  http→https offer; no links drawer.
- Light themes.

## Log

One line per finding: date, size, signer, slice, what happened, what
was expected. Fixed findings keep their line, with the commit.

| Date | Size | Signer | Slice | Found | Expected | Fixed in |
|---|---|---|---|---|---|---|
