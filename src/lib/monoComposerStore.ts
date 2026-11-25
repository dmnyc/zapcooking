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
