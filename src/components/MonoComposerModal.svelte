<script lang="ts">
  /**
   * The monocomposer over the page: the app's Modal (the dark, translucent
   * backdrop and its close button; full screen on phones) with the
   * composer mounted inside. The modal is the sheet — the composer drops
   * its own card. Drafts save as you type, so closing loses nothing.
   */
  import Modal from './Modal.svelte';
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { monoComposerTab, closeMonoComposer } from '$lib/monoComposerStore';
  import type { MonoTab } from '$lib/sidecar/mount';

  type Handle = { destroy(): void; setTab(tab: MonoTab): void };

  let open = false;
  let container: HTMLDivElement | null = null;
  let handle: Handle | null = null;
  let mounting = false;
  let mountError = '';

  $: open = $monoComposerTab !== null;
  // `?dry=1` keeps a post off the relays, as on /compose.
  $: live = !$page.url.searchParams.has('dry');

  $: if (open && container && !handle && !mounting) void mount();
  $: if (!open) unmount();
  $: if (handle && $monoComposerTab) handle.setTab($monoComposerTab);

  async function mount() {
    mounting = true;
    mountError = '';
    try {
      const { mountMonoComposer } = await import('$lib/sidecar/mount');
      if (!container || !$monoComposerTab) return;
      handle = await mountMonoComposer(container, {
        tab: $monoComposerTab,
        live,
        inModal: true,
        // Switching tabs inside the composer keeps the store in step, so
        // reopening lands where you left it.
        onTabChange: (tab) => {
          if ($monoComposerTab !== null && $monoComposerTab !== tab) monoComposerTab.set(tab);
        }
      });
    } catch (e) {
      mountError = String((e as Error)?.message || e);
      console.error('[compose] mount failed', e);
    } finally {
      mounting = false;
    }
  }

  function unmount() {
    handle?.destroy();
    handle = null;
  }

  onDestroy(unmount);
</script>

<Modal bind:open cleanup={closeMonoComposer} noHeader floatingClose wide fullScreenMobile>
  {#if mountError}
    <p class="mount-error" role="alert">The composer failed to load: {mountError}</p>
  {/if}
  <div bind:this={container} class="mono-modal-mount"></div>
</Modal>

<style>
  .mono-modal-mount {
    min-height: 420px;
  }
  .mount-error {
    color: var(--color-danger, #f66);
    font-size: 13px;
  }
</style>
