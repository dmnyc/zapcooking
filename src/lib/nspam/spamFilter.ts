/**
 * The nspam judge — Sidecar's judgeStrangers method, applied as hiding.
 *
 * THE WEB OF TRUST KNOWS YOUR CIRCLE AND SOMETHING ABOUT A STRANGER; nspam knows nothing
 * about your circle and something about the stranger, from how their replies read. An author
 * whose newest scorable replies (a bundle of up to ten, newest first — that is how the model
 * reads them) score >= SPAM_THRESHOLD goes into the verdict set, and everything of theirs —
 * replies and notifications — is hidden while they are in it AND outside your web of trust
 * (see $lib/wot): inside the network nothing is ever hidden, whatever it scores. A model's
 * false positive must not be able to silence your circle.
 *
 * FAIL OPEN. With no model loaded nothing is judged and nothing is hidden; a reply that is not
 * scorable (not a kind-1 reply, or not mostly Latin — see nspam.ts scorable) leaves its author
 * unscored; and until the web-of-trust set has been built, no one is a stranger yet. A failed
 * model fetch or a slow relay only costs the feature, never a reply.
 */

import { derived, get, writable } from 'svelte/store';
import { browser } from '$app/environment';
import { userPublickey } from '$lib/nostr';
import { load, score, scorable, type NspamModel, type ScorableNote } from './nspam';
import { inNetwork, wotSet, wotState } from '$lib/wot/wotStore';

/** A note with the fields the judge keys and scores on. NDKEvent satisfies this. */
export interface JudgeableEvent extends ScorableNote {
  id?: string;
  kind?: number;
  pubkey?: string;
}

/**
 * Calibrated score at or above which an author is treated as a known spammer. Sidecar marks
 * rows with NSPAM_LABEL = 0.9; the calibration is nearly a step, so almost every score is 0
 * or 1 and the line is far from anything in between.
 */
export const SPAM_THRESHOLD = 0.9;

// Per author, the newest scorable replies seen (newest first, at most the model's ten) and the
// identity of the bundle last scored, so an arrival that changes nothing re-scores nothing.
const bundles = new Map<string, JudgeableEvent[]>();
const scoredAs = new Map<string, string>();
const verdicts = new Map<string, number>();

// Authors outlive any one thread or notification batch, but not indefinitely: past this many
// authors the oldest bundles are dropped (Map keeps insertion order), the model re-reads them
// if the author shows up again.
const MAX_AUTHORS = 500;

/** Pubkeys whose reply bundle scored >= SPAM_THRESHOLD. */
export const nspamSpammers = writable<ReadonlySet<string>>(new Set());

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Verdicts with the web of trust subtracted: the set of authors to hide — the people the
 * nspam model has condemned AND your network cannot vouch for. The set is you, your
 * follows, and everyone at least ten of your follows follow (Sidecar's wot — see
 * $lib/wot): inside it nothing is ever hidden, whatever it scores, because a model's
 * false positive must not be able to silence your circle, and a two-hop vouch is the
 * louder signal. Fail-open while the set is unbuilt — unknown means in-network, so a
 * slow relay costs the feature, never a reply.
 */
export const nspamHiddenAuthors = derived(
  [nspamSpammers, wotSet, wotState],
  ([$spammers, $set, $state]) => {
    if ($spammers.size === 0) return EMPTY;
    if ($state !== 'ready') return EMPTY;
    const hidden = new Set<string>();
    for (const pk of $spammers) if (!inNetwork($set, pk)) hidden.add(pk);
    return hidden;
  }
);

let model: NspamModel | null = null;
let modelLoading: Promise<void> | null = null;

/**
 * Load the model in the background. Safe to call anywhere, any number of times: one
 * fetch, and a failed model fetch leaves the judge inert (nothing hidden).
 */
export function warmNspam(): void {
  if (!browser) return;
  if (model || modelLoading) return;
  modelLoading = (async () => {
    try {
      const res = await fetch('/models/nspam.bin');
      if (!res.ok) throw new Error('nspam model: ' + res.status);
      model = load(await res.arrayBuffer());
      // Bundles remembered before the model landed are scored now, not forgotten.
      for (const pk of [...bundles.keys()]) scoreAuthor(pk);
    } catch {
      // No model: the lists read as they always did.
    } finally {
      modelLoading = null;
    }
  })();
}

/**
 * Remember the scorable kind-1 replies among `events` per author and re-score each touched
 * author's bundle, updating the verdict set. Batches may arrive in any order: the bundle is
 * sorted newest-first before scoring, as Sidecar sorts before its model reads it. Events that
 * are not scorable (reactions, zaps, mentions without an e tag, non-Latin text) are ignored —
 * they say nothing the model was trained to read.
 */
export function judgeReplies(events: JudgeableEvent[]): void {
  if (!browser || !events.length) return;
  const own = get(userPublickey);
  const touched = new Set<string>();
  for (const ev of events) {
    const pk = ev?.pubkey;
    // Your own replies are never judged: the model reads strangers, and a bundle
    // it misread must not be able to hide your replies from your own threads.
    if (!pk || pk === own || !scorable(ev)) continue;
    let bundle = bundles.get(pk);
    if (!bundle) {
      if (bundles.size >= MAX_AUTHORS) {
        const oldest = bundles.keys().next().value;
        if (oldest !== undefined) {
          bundles.delete(oldest);
          scoredAs.delete(oldest);
        }
      }
      bundle = [];
      bundles.set(pk, bundle);
    }
    if (ev.id && bundle.some((n) => n.id === ev.id)) continue;
    bundle.unshift(ev);
    if (bundle.length > 10) bundle.length = 10;
    touched.add(pk);
  }
  if (!touched.size) return;
  warmNspam();
  if (!model) return; // bundles are remembered; scores land when the model does
  for (const pk of touched) scoreAuthor(pk);
}

function scoreAuthor(pk: string): void {
  if (!model) return;
  const bundle = bundles.get(pk);
  if (!bundle?.length) return;
  const key = bundle.map((n) => n.id || '').join(',');
  if (scoredAs.get(pk) === key) return;
  scoredAs.set(pk, key);
  const newestFirst = [...bundle].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const r = score(model, newestFirst);
  if (!r) return;
  verdicts.set(pk, r.score);
  publish();
}

function publish(): void {
  const s = new Set<string>();
  for (const [pk, v] of verdicts) if (v >= SPAM_THRESHOLD) s.add(pk);
  nspamSpammers.set(s);
}

/** The author's verdict, or undefined when never scored (fail-open direction). */
export function spamVerdict(pubkey: string): number | undefined {
  return verdicts.get(pubkey);
}
