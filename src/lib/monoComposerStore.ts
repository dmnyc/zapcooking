import { writable } from 'svelte/store';
import type { MonoTab } from '$lib/sidecar/mount';

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

/** Where the composer keeps its saved drafts, one entry per tab. */
export const MONO_DRAFTS_LIST_KEY = 'zapcooking_mono_drafts_v1';

/** How many saved drafts there are, read without loading the composer. */
export function monoDraftCount(): number {
  try {
    const list = JSON.parse(localStorage.getItem(MONO_DRAFTS_LIST_KEY) || '{}') as Record<
      string,
      { text?: string }
    >;
    return Object.values(list).filter((d) => d?.text?.trim()).length;
  } catch {
    return 0;
  }
}
