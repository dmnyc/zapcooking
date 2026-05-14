<script lang="ts">
  import type { MediaItem } from '$lib/feed/types';
  import MediaTile from './MediaTile.svelte';
  import { openLightbox } from '$lib/feed/media/lightboxStore';

  /** Media items to render, in source order. */
  export let items: MediaItem[];
  /** Cap on the gallery's height in the single-image layout. Defaults
   * to 70vh so a tall portrait note doesn't take over the viewport. */
  export let maxHeight = '70vh';

  $: count = items.length;
  /** Layout key — drives the CSS grid template. The 5+ case shows the
   * first 3 images normally and a "+N more" overlay on the 4th tile. */
  $: layout = count === 1 ? 'one' : count === 2 ? 'two' : count === 3 ? 'three' : 'four-plus';
  /** Items that actually render. For the 5+ case we slice to 4. */
  $: visibleItems = count <= 4 ? items : items.slice(0, 4);
  /** "+N" overlay count for the 4th tile in the 5+ case. */
  $: overflowCount = count > 4 ? count - 4 : 0;
  /** Hero (single-image) aspect ratio. We clamp the image's natural
   * aspect into a "fits gracefully" range so the gallery always fills
   * the feed column width:
   *   - Wide cap: 1.78  (16:9 landscape — anything wider gets cropped
   *     on the sides via object-fit: cover).
   *   - Tall cap: 0.8   (4:5 portrait — anything taller gets cropped
   *     on top/bottom).
   * Without this clamp, tall portraits collapsed the container width
   * under the max-height: 70vh cap, leaving empty space on either
   * side of the gallery inside the feed column.
   * When there's no imeta.dim we default to 1:1 (square) so the
   * hero still fills the column. */
  const HERO_MIN_RATIO = 0.8;
  const HERO_MAX_RATIO = 1.78;
  $: heroAspect = (() => {
    if (count !== 1) return undefined;
    const dim = items[0]?.dim;
    if (!dim) return 1;
    const natural = dim.w / dim.h;
    return Math.max(HERO_MIN_RATIO, Math.min(HERO_MAX_RATIO, natural));
  })();

  function open(index: number) {
    // Open the full media set (not visibleItems) so the user can swipe
    // through the hidden ones from the overflow tile.
    openLightbox(items, index);
  }
</script>

{#if count > 0}
  <div class="gallery layout-{layout}" style="--gallery-max-h: {maxHeight}">
    {#if layout === 'one'}
      <!-- Single image: full width, aspect from imeta, capped at maxHeight.
           object-fit: contain (set in the one-layout block below) so tall
           portraits don't crop. -->
      <MediaTile
        item={visibleItems[0]}
        aspectRatio={heroAspect}
        loading="eager"
        corner="none"
        on:open={() => open(0)}
      />
    {:else if layout === 'two'}
      <!-- Side by side, each 1:1. Overall 2:1. -->
      {#each visibleItems as item, i (item.url + i)}
        <MediaTile {item} aspectRatio={1} corner="none" on:open={() => open(i)} />
      {/each}
    {:else if layout === 'three'}
      <!-- One large left, two stacked right. The three named grid areas
           let each tile fill its slot regardless of source aspect. -->
      <div class="tile-a">
        <MediaTile item={visibleItems[0]} corner="none" on:open={() => open(0)} />
      </div>
      <div class="tile-b">
        <MediaTile item={visibleItems[1]} corner="none" on:open={() => open(1)} />
      </div>
      <div class="tile-c">
        <MediaTile item={visibleItems[2]} corner="none" on:open={() => open(2)} />
      </div>
    {:else}
      <!-- Four or more: 2x2. Tile 3 (0-indexed) carries the overflow
           scrim when there are more than 4. -->
      {#each visibleItems as item, i (item.url + i)}
        <MediaTile
          {item}
          aspectRatio={1}
          corner="none"
          overflowCount={i === 3 && overflowCount > 0 ? overflowCount : null}
          on:open={() => open(i)}
        />
      {/each}
    {/if}
  </div>
{/if}

<style>
  .gallery {
    display: grid;
    gap: 2px;
    width: 100%;
    /* Outer rounding lives on the container so per-tile corner logic
       isn't needed — gap of 2px shows through as a thin border-color
       line between adjacent tiles. */
    border-radius: 0.75rem;
    overflow: hidden;
    background-color: var(--color-input-border);
    isolation: isolate;
  }

  /* ──────────────────────────────────────────────────────────────────
     ONE — full-width hero. Aspect is clamped to [0.8, 1.78] (see
     heroAspect in the script) so the container always fills the feed
     column. object-fit: cover crops the extremes (very tall portraits
     trim top/bottom; very wide panoramas trim left/right) — the user
     can tap into the Lightbox to see the full uncropped frame.
     ────────────────────────────────────────────────────────────────── */
  .gallery.layout-one {
    grid-template-columns: 1fr;
    max-height: var(--gallery-max-h);
  }
  .gallery.layout-one :global(.media-tile) {
    max-height: var(--gallery-max-h);
  }

  /* ──────────────────────────────────────────────────────────────────
     TWO — two square tiles side by side, overall 2:1.
     ────────────────────────────────────────────────────────────────── */
  .gallery.layout-two {
    grid-template-columns: 1fr 1fr;
  }

  /* ──────────────────────────────────────────────────────────────────
     THREE — one large left, two stacked right.
     Each named area stretches its tile to fill the slot. Mobile (<420px)
     collapses to a single row of three squares for tappability.
     ────────────────────────────────────────────────────────────────── */
  .gallery.layout-three {
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 1fr 1fr;
    grid-template-areas:
      'a b'
      'a c';
    aspect-ratio: 4 / 3;
  }
  .gallery.layout-three .tile-a {
    grid-area: a;
  }
  .gallery.layout-three .tile-b {
    grid-area: b;
  }
  .gallery.layout-three .tile-c {
    grid-area: c;
  }
  .gallery.layout-three .tile-a,
  .gallery.layout-three .tile-b,
  .gallery.layout-three .tile-c {
    display: flex;
    width: 100%;
    height: 100%;
  }
  /* Strip the inner MediaTile aspect-ratio so each cell stretches to
     fill its named area instead of imposing its own 1:1 / dim ratio. */
  .gallery.layout-three :global(.tile-a .media-tile),
  .gallery.layout-three :global(.tile-b .media-tile),
  .gallery.layout-three :global(.tile-c .media-tile) {
    aspect-ratio: auto !important;
    height: 100%;
  }

  @media (max-width: 420px) {
    .gallery.layout-three {
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: 1fr;
      grid-template-areas: 'a b c';
      aspect-ratio: 3 / 1;
    }
  }

  /* ──────────────────────────────────────────────────────────────────
     FOUR+ — 2x2 grid, each cell 1:1, overall 1:1.
     ────────────────────────────────────────────────────────────────── */
  .gallery.layout-four-plus {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    aspect-ratio: 1;
  }
</style>
