<script lang="ts">
  import Modal from '../Modal.svelte';
  import WalletPanel from './WalletPanel.svelte';
  import { walletModalOpen, closeWallet } from '$lib/wallet/walletModalStore';
</script>

<Modal bind:open={$walletModalOpen} cleanup={closeWallet} compact>
  <span slot="title" />
  <div class="wallet-modal-body">
    {#if $walletModalOpen}
      <WalletPanel />
    {/if}
  </div>
</Modal>

<style>
  .wallet-modal-body {
    /* The body itself doesn't scroll — it just provides a flex column
       for WalletPanel which has its own static balance header and an
       inner .wallet-scroll that handles the bouncy scroll. */
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
  }
  /* Neutralise the panel's original full-width container styling. */
  .wallet-modal-body :global(.max-w-2xl) {
    max-width: 100%;
  }
  .wallet-modal-body :global(.py-8) {
    padding-top: 0;
    padding-bottom: 0;
  }
  /* Strip user-agent button defaults for any inline-styled button that
     doesn't carry an explicit Tailwind background utility. */
  .wallet-modal-body :global(button:not([class*='bg-'])) {
    background-color: transparent;
  }
  /* Toast notifications spawned by WalletPanel match the wallet
     modal's width at each breakpoint so they read as part of the
     same surface rather than as a viewport-wide banner. */
  :global(.wallet-toast) {
    max-width: 480px !important;
  }
  @media (min-width: 768px) {
    :global(.wallet-toast) {
      max-width: 640px !important;
    }
  }
  @media (min-width: 1024px) {
    :global(.wallet-toast) {
      max-width: 720px !important;
    }
  }
  /* Pin the wallet modal to a fixed size, kill the dialog's padding so
     the body can sit flush with the dialog's edges, and disable the
     dialog's own scrolling — the body handles scroll instead. */
  :global(dialog:has(.wallet-modal-body)) {
    width: 480px !important;
    max-width: calc(100% - 2rem) !important;
    height: 560px !important;
    max-height: calc(100vh - 6rem) !important;
    min-height: 0 !important;
    overflow: hidden !important;
    padding: 0 !important;
  }
  /* Move the title-bar padding from the dialog onto the inner flex
     wrapper, since the dialog itself is now padding-free. Paint the
     inner wrapper with the modal bg so the title-bar row is opaque
     even where the body's negative margins don't reach. */
  :global(dialog:has(.wallet-modal-body) > div) {
    padding: 1rem 1rem 0 1rem !important;
    gap: 0 !important;
    background-color: var(--color-bg-secondary);
  }
  @media (min-width: 768px) {
    :global(dialog:has(.wallet-modal-body)) {
      width: 640px !important;
      height: 720px !important;
      max-height: 84vh !important;
    }
    :global(dialog:has(.wallet-modal-body) > div) {
      padding-left: 1.5rem !important;
      padding-right: 1.5rem !important;
    }
  }
  @media (min-width: 1024px) {
    :global(dialog:has(.wallet-modal-body)) {
      width: 720px !important;
      height: 780px !important;
      max-height: min(840px, 86vh) !important;
    }
  }
  /* Body extends horizontally past the inner wrapper's padding so it
     reaches the dialog's edges. Vertical padding is only on top
     (for the title bar), so no negative bottom margin is needed. */
  .wallet-modal-body {
    margin-left: -1rem;
    margin-right: -1rem;
    margin-top: 0.5rem;
    margin-bottom: 0;
  }
  @media (min-width: 768px) {
    .wallet-modal-body {
      margin-left: -1.5rem;
      margin-right: -1.5rem;
    }
  }
</style>
