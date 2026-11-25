<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { mountMonoComposer, type MonoTab } from '$lib/sidecar/mount';

  export const ssr = false;
  export const prerender = false;

  const TABS: MonoTab[] = ['notes', 'polls', 'recipes', 'reads'];

  let container: HTMLDivElement;
  let mountError = '';
  let handle: { destroy(): void; setTab(tab: MonoTab): void } | null = null;

  // Publishing is live here — this is the composer. `?dry=1` is for the
  // runner: the signed event is logged and every relay reported accepted
  // without a socket opened.
  $: live = !$page.url.searchParams.has('dry');
  $: tabParam = $page.url.searchParams.get('tab');
  $: tab = (TABS.includes(tabParam as MonoTab) ? tabParam : 'notes') as MonoTab;

  onMount(async () => {
    try {
      handle = await mountMonoComposer(container, { tab, live });
    } catch (e) {
      // Shown beside the mount, not in it: the mount is a shadow host, and
      // its light DOM never renders — a failure there looks like a blank page.
      mountError = String((e as Error)?.message || e);
      console.error('[compose] mount failed', e);
    }
  });

  $: if (handle && tab) handle.setTab(tab);

  onDestroy(() => {
    handle?.destroy();
    handle = null;
  });
</script>

<svelte:head>
  <title>Compose — zap.cooking</title>
</svelte:head>

<div class="composer-spike">
  <div class="spike-note">
    the monocomposer — one composer for notes, polls, recipes and reads.
    Add <code>?dry=1</code> to the address to keep a post off the relays.
  </div>
  {#if mountError}
    <p class="mount-error" role="alert">The composer failed to load: {mountError}</p>
  {/if}
  <div bind:this={container} class="composer-mount"></div>
</div>

<style>
  .composer-spike {
    max-width: 720px;
    margin: 0 auto;
    padding: 1rem;
  }
  .spike-note {
    font-size: 12px;
    color: var(--color-text-secondary);
    padding: 0 4px 8px;
  }
  .spike-note code {
    font-family: var(--font-mono, monospace);
    color: var(--color-primary);
  }
  /* One sheet: Sidecar's compose-sheet draws the border, so the mount
     draws none of its own. */
  .composer-mount {
    min-height: 420px;
  }
  .mount-error {
    color: var(--color-danger, #f66);
    font-size: 13px;
    padding: 8px 4px;
  }
</style>
