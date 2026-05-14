<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { portal } from '../../Modal.svelte';
  import {
    lightbox,
    closeLightbox,
    lightboxNext,
    lightboxPrev
  } from '$lib/feed/media/lightboxStore';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';

  let portalTarget: HTMLElement | null = null;
  let scrollLockY = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchActive = false;
  let touchDeltaX = 0;
  /** Horizontal threshold (px) to trigger prev/next on touchend. */
  const SWIPE_THRESHOLD = 60;
  /** Vertical threshold (px) to trigger close-on-swipe-down. */
  const DISMISS_THRESHOLD = 100;

  $: state = $lightbox;
  $: currentItem = state.items[state.index];
  $: isVideo = currentItem?.mime?.startsWith('video/') ?? false;
  $: hasPrev = state.index > 0;
  $: hasNext = state.index < state.items.length - 1;

  onMount(() => {
    portalTarget = document.body;
  });

  onDestroy(() => {
    unlockScroll();
  });

  // Body scroll lock when open, unlock when closed. Tracks the prior
  // scrollY so unlocking restores the exact position; matters on iOS
  // where document.body position:fixed otherwise scrolls to top.
  $: if (typeof document !== 'undefined') {
    if (state.open) lockScroll();
    else unlockScroll();
  }

  function lockScroll() {
    if (document.body.dataset.lightboxLocked === '1') return;
    scrollLockY = window.scrollY;
    document.body.dataset.lightboxLocked = '1';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollLockY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
  }

  function unlockScroll() {
    if (document.body.dataset.lightboxLocked !== '1') return;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    delete document.body.dataset.lightboxLocked;
    window.scrollTo(0, scrollLockY);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!state.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      lightboxPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      lightboxNext();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    // Only close if the click was on the backdrop itself, not on the
    // image / controls. event.target === currentTarget means the
    // click landed on the backdrop element, not propagated.
    if (e.target === e.currentTarget) closeLightbox();
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchActive = true;
    touchDeltaX = 0;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!touchActive || e.touches.length !== 1) return;
    touchDeltaX = e.touches[0].clientX - touchStartX;
  }

  function handleTouchEnd(e: TouchEvent) {
    if (!touchActive) return;
    touchActive = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    // Prioritise vertical swipe-down to dismiss only if vertical motion
    // dominates and is large enough.
    if (Math.abs(dy) > Math.abs(dx) && dy > DISMISS_THRESHOLD) {
      closeLightbox();
    } else if (dx > SWIPE_THRESHOLD && hasPrev) {
      lightboxPrev();
    } else if (dx < -SWIPE_THRESHOLD && hasNext) {
      lightboxNext();
    }
    touchDeltaX = 0;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if state.open && portalTarget && currentItem}
  <div use:portal={portalTarget}>
    <!-- The backdrop is a role="dialog" container with a global Esc
         handler on svelte:window. The lint warnings about click /
         touch on a non-button element are intentional here: the
         backdrop's click closes the lightbox (a well-known pattern
         that doesn't have a button equivalent), and touch handlers
         power swipe gestures. -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      on:click={handleBackdropClick}
      on:touchstart={handleTouchStart}
      on:touchmove={handleTouchMove}
      on:touchend={handleTouchEnd}
      transition:fade={{ duration: 150 }}
    >
      <!-- Top bar: counter on the left, close on the right. -->
      <div class="lightbox-topbar">
        <div class="counter">
          {#if state.items.length > 1}
            <span aria-live="polite">{state.index + 1} / {state.items.length}</span>
          {/if}
        </div>
        <button
          type="button"
          class="icon-btn"
          aria-label="Close media viewer"
          on:click={closeLightbox}
        >
          <CloseIcon size={28} weight="bold" />
        </button>
      </div>

      <!-- Stage: image / video, object-fit: contain, follows finger on
           horizontal swipe via translate. -->
      <div
        class="lightbox-stage"
        style:transform={touchActive ? `translateX(${touchDeltaX}px)` : 'translateX(0)'}
      >
        {#if isVideo}
          <!-- svelte-ignore a11y-media-has-caption -->
          <video
            class="lightbox-media"
            src={currentItem.url}
            controls
            autoplay
            playsinline
          ></video>
        {:else}
          <img class="lightbox-media" src={currentItem.url} alt={currentItem.alt ?? ''} />
        {/if}
      </div>

      <!-- Prev / next: hidden on touch-only contexts via @media hover. -->
      {#if hasPrev}
        <button
          type="button"
          class="nav-btn nav-prev"
          aria-label="Previous"
          on:click={lightboxPrev}
        >
          <CaretLeftIcon size={32} weight="bold" />
        </button>
      {/if}
      {#if hasNext}
        <button
          type="button"
          class="nav-btn nav-next"
          aria-label="Next"
          on:click={lightboxNext}
        >
          <CaretRightIcon size={32} weight="bold" />
        </button>
      {/if}

      {#if currentItem.alt}
        <div class="caption" aria-hidden="true">{currentItem.alt}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background-color: rgba(0, 0, 0, 0.94);
    display: flex;
    align-items: center;
    justify-content: center;
    /* No overflow so swipe-translate doesn't shift adjacent layout. */
    overflow: hidden;
    /* iOS rubber-band would scroll the page beneath even with our
       body-fixed lock when fingers pull at the edges; contain it. */
    overscroll-behavior: contain;
    touch-action: none;
  }
  .lightbox-topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: max(0.5rem, env(safe-area-inset-top, 0)) 0.75rem 0.5rem;
    z-index: 2;
  }
  .counter {
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    background-color: rgba(0, 0, 0, 0.4);
    min-height: 1.75rem;
    display: flex;
    align-items: center;
  }
  .icon-btn {
    background: rgba(0, 0, 0, 0.4);
    border: none;
    color: rgba(255, 255, 255, 0.95);
    cursor: pointer;
    border-radius: 9999px;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s;
  }
  .icon-btn:hover,
  .icon-btn:focus-visible {
    background-color: rgba(255, 255, 255, 0.12);
  }
  .icon-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .lightbox-stage {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Transitions for snap-back when a swipe doesn't cross the
       threshold. Disabled during touchActive (Svelte applies the
       inline transform without transition there). */
    transition: transform 0.18s ease-out;
    will-change: transform;
  }
  .lightbox-media {
    max-width: 100vw;
    max-height: 100vh;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
    /* The body-fix lock above takes care of preventing scroll; allow
       native pinch zoom within the image only. */
    touch-action: pinch-zoom;
  }
  .nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.4);
    border: none;
    color: rgba(255, 255, 255, 0.95);
    cursor: pointer;
    border-radius: 9999px;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s;
  }
  .nav-btn:hover,
  .nav-btn:focus-visible {
    background-color: rgba(255, 255, 255, 0.12);
  }
  .nav-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .nav-prev {
    left: 0.75rem;
  }
  .nav-next {
    right: 0.75rem;
  }
  .caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 0.75rem 1rem max(0.75rem, env(safe-area-inset-bottom, 0));
    color: rgba(255, 255, 255, 0.92);
    font-size: 0.875rem;
    text-align: center;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0));
    pointer-events: none;
  }
  /* Hide the prev/next chevrons on coarse-pointer devices (phones,
     tablets) where swipe is the primary navigation. They stay on
     hover-capable devices (desktop, trackpad-paired tablets). */
  @media (hover: none) {
    .nav-btn {
      display: none;
    }
  }
</style>
