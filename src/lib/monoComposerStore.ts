import { writable } from 'svelte/store';
import type { MonoTab } from '$lib/sidecar/mount';
import { composerDraftCount } from '$lib/composerDrafts';

/**
 * The monocomposer's modal: the tab it is open on, or null when closed.
 * One composer for notes, polls, recipes and reads, opened over whatever
 * page you are on (the + button, and later replies and quotes).
 */
export const monoComposerTab = writable<MonoTab | null>(null);

export function openMonoComposer(tab: MonoTab = 'notes') {
  monoComposerTab.set(tab);
}

export function closeMonoComposer() {
  monoComposerTab.set(null);
}

/**
 * Open the composer on its saved drafts. A counter, not a flag: each ask
 * is a new value, so asking again while the composer is open still opens
 * the list.
 */
export const monoComposerDraftsRequest = writable(0);

export function openMonoComposerDrafts() {
  monoComposerTab.update((tab) => tab ?? 'notes');
  monoComposerDraftsRequest.update((n) => n + 1);
}

/** The single-slot draft list from before drafts had ids; the composer
 *  moves what it held and removes it on its next open. */
export const MONO_DRAFTS_LIST_KEY = 'zapcooking_mono_drafts_v1';

/** How many saved drafts an account has (notes and polls, plus the recipe
 *  and article kept on this device), read without loading the composer. */
export function monoDraftCount(pubkey: string): number {
  let n = composerDraftCount(pubkey);
  try {
    if (localStorage.getItem('zapcooking_mono_recipe_draft')) n++;
    if (localStorage.getItem('zapcooking_mono_article_draft')) n++;
  } catch {
    /* storage blocked */
  }
  return n;
}
