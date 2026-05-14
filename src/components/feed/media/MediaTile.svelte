<script lang="ts" context="module">
  import { blurhashToDataUrl } from '$lib/feed/blurhash';

  /** Memoize blurhash → data URL across all tile instances. The decode
   * is sync and ~3ms on a 32x32 canvas, but repeating it for every
   * remount when a tile scrolls back into view is wasteful. */
  const blurhashCache = new Map<string, string | null>();

  function getBlurhashUrl(hash: string | undefined | null): string | null {
    if (!hash) return null;
    if (blurhashCache.has(hash)) return blurhashCache.get(hash) ?? null;
    const url = blurhashToDataUrl(hash);
    blurhashCache.set(hash, url);
    return url;
  }
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MediaItem } from '$lib/feed/types';

  export let item: MediaItem;
  /** Override the tile's aspect ratio. Galleries with fixed layouts
   * (2x2, 1 large + 2 small) pass `1` or another constant so all tiles
   * line up regardless of source image dimensions. When omitted we
   * fall back to `item.dim` (kills CLS) and finally `1` (square). */
  export let aspectRatio: number | undefined = undefined;
  /** `eager` only for the very first tile of a hero (single-image)
   * gallery. Everything else uses `lazy`. */
  export let loading: 'eager' | 'lazy' = 'lazy';
  /** Show a "+N more" overlay on top of the image. Used by 5+ image
   * galleries on the 4th tile. */
  export let overflowCount: number | null = null;
  /** Border-radius variant. The MediaGallery passes "tl", "tr", "bl",
   * "br", "all", or "none" so the outer corners of the grid stay
   * rounded but inner edges are flush. */
  export let corner: 'all' | 'tl' | 'tr' | 'bl' | 'br' | 'none' = 'all';

  const dispatch = createEventDispatcher<{ open: void }>();

  $: ratio = aspectRatio ?? (item.dim ? item.dim.w / item.dim.h : 1);
  $: blurhashUrl = getBlurhashUrl(item.blurhash);
  $: isVideo = item.mime.startsWith('video/');

  let mediaLoaded = false;
  let mediaErrored = false;
  let fallbackIndex = -1;

  $: currentUrl = (() => {
    if (fallbackIndex < 0) return item.url;
    return item.fallback?.[fallbackIndex] ?? item.url;
  })();

  function handleLoaded() {
    mediaLoaded = true;
    mediaErrored = false;
  }

  function handleError() {
    const next = fallbackIndex + 1;
    if (item.fallback && next < item.fallback.length) {
      fallbackIndex = next;
      mediaLoaded = false;
      return;
    }
    mediaErrored = true;
    mediaLoaded = true; // stop showing the blurhash skeleton
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    dispatch('open');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    dispatch('open');
  }
</script>

<!-- The tile is a button-styled div so screen readers announce the
     activation, but we don't use a real <button> because galleries
     nest these inside note cards that may themselves be clickable —
     a button inside a button breaks HTML semantics. -->
<div
  class="media-tile corner-{corner}"
  class:is-video={isVideo}
  class:has-overflow={overflowCount !== null}
  style="aspect-ratio: {ratio};{blurhashUrl
    ? ` background-image: url('${blurhashUrl}');`
    : ''}"
  role="button"
  tabindex="0"
  aria-label={item.alt || (isVideo ? 'Open video' : 'Open image')}
  on:click={handleClick}
  on:keydown={handleKeydown}
>
  {#if isVideo}
    <!-- svelte-ignore a11y-media-has-caption -->
    <video
      class="media-element"
      class:is-loaded={mediaLoaded}
      src={currentUrl}
      preload="metadata"
      muted
      playsinline
      on:loadeddata={handleLoaded}
      on:error={handleError}
    ></video>
    <div class="play-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
  {:else}
    <img
      class="media-element"
      class:is-loaded={mediaLoaded}
      src={currentUrl}
      alt={item.alt ?? ''}
      {loading}
      decoding="async"
      on:load={handleLoaded}
      on:error={handleError}
    />
  {/if}

  {#if mediaErrored}
    <div class="error-state" aria-hidden="true">⚠</div>
  {/if}

  {#if overflowCount !== null && overflowCount > 0}
    <div class="overflow-scrim" aria-hidden="true">
      <span class="overflow-count">+{overflowCount}</span>
    </div>
  {/if}
</div>

<style>
  .media-tile {
    position: relative;
    width: 100%;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
    background-size: cover;
    background-position: center;
    cursor: pointer;
    /* The blurhash data URL is tiny (32x32) and looks chunky if not
       smoothed. Filter it slightly for a softer placeholder; the real
       image crossfades over the top. */
    isolation: isolate;
  }
  .media-tile.corner-all {
    border-radius: 0.75rem;
  }
  .media-tile.corner-tl {
    border-top-left-radius: 0.75rem;
  }
  .media-tile.corner-tr {
    border-top-right-radius: 0.75rem;
  }
  .media-tile.corner-bl {
    border-bottom-left-radius: 0.75rem;
  }
  .media-tile.corner-br {
    border-bottom-right-radius: 0.75rem;
  }
  .media-tile:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .media-element {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.25s ease-out;
  }
  .media-element.is-loaded {
    opacity: 1;
  }
  .play-icon {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.92);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
    pointer-events: none;
    /* Slightly larger hit target via the wrapper; the icon itself is
       48x48 above. The drop-shadow makes it readable over any image. */
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.45));
  }
  .error-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-caption);
    font-size: 2rem;
    background-color: var(--color-bg-secondary);
  }
  .overflow-scrim {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
  .overflow-count {
    font-size: 1.75rem;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
  }
  /* Reduce-motion users skip the crossfade. The image still snaps in
     when loaded; no animation. */
  @media (prefers-reduced-motion: reduce) {
    .media-element {
      transition: none;
    }
  }
</style>
