<script lang="ts">
  /**
   * Dev-only demo route for the new MediaGallery + Lightbox.
   *
   * Lists every gallery layout (1, 2, 3, 4, 5+) against fixture data
   * so we can eyeball CLS, blurhash placeholders, and swipe-driven
   * Lightbox behavior at 320 / 768 / 1280 widths. Phase 7's cleanup
   * will remove this route once the new feed has shipped.
   */
  import MediaGallery from '../../../components/feed/media/MediaGallery.svelte';
  import Lightbox from '../../../components/feed/media/Lightbox.svelte';
  import type { MediaItem } from '$lib/feed/types';

  /** A real blurhash from the woltapp/blurhash README, encoding a
   * photograph with some chrominance variation so the placeholder
   * actually shows color instead of a flat grey. */
  const REF_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

  /** Picsum is stable + dimensionally addressable, so each fixture has
   * predictable dimensions for `imeta.dim` and the gallery can prove
   * its aspect-ratio reservation. */
  function pic(w: number, h: number, seed: number): MediaItem {
    return {
      url: `https://picsum.photos/seed/zc-${seed}/${w}/${h}`,
      mime: 'image/jpeg',
      dim: { w, h },
      blurhash: REF_BLURHASH,
      alt: `Demo image ${seed} (${w}x${h})`
    };
  }

  /** Vary by count. The hero (1-image case) uses a portrait ratio so
   * the maxHeight cap is exercised. */
  const fixtures: { label: string; items: MediaItem[] }[] = [
    { label: '1 image (portrait, hero)', items: [pic(900, 1400, 1)] },
    { label: '1 image (landscape, hero)', items: [pic(1600, 900, 2)] },
    {
      label: '2 images',
      items: [pic(1200, 1200, 3), pic(1200, 1200, 4)]
    },
    {
      label: '3 images',
      items: [pic(1200, 1200, 5), pic(1200, 1200, 6), pic(1200, 1200, 7)]
    },
    {
      label: '4 images',
      items: [pic(1200, 1200, 8), pic(1200, 1200, 9), pic(1200, 1200, 10), pic(1200, 1200, 11)]
    },
    {
      label: '7 images (4 visible + "+3" overlay)',
      items: Array.from({ length: 7 }, (_, i) => pic(1200, 1200, 100 + i))
    },
    {
      label: 'No imeta — URL fallback (no blurhash, no dim reservation)',
      items: [
        { url: 'https://picsum.photos/seed/no-meta-a/1600/900', mime: 'image/*' },
        { url: 'https://picsum.photos/seed/no-meta-b/1600/900', mime: 'image/*' }
      ]
    }
  ];
</script>

<svelte:head>
  <title>Dev — Media Gallery Demo</title>
</svelte:head>

<div class="page">
  <header>
    <h1>Media Gallery / Lightbox — dev demo</h1>
    <p class="note">
      Phase 1 of the feed overhaul. Each section renders the same
      <code>MediaGallery</code> against a different fixture set. Tap any tile
      to open the <code>Lightbox</code>. Use ← / → / Esc on keyboard, or
      swipe horizontally / down on touch.
    </p>
    <p class="note">
      Resize the viewport to 320 px, 768 px, and 1280 px to verify
      layout breakpoints. Open DevTools → Performance to confirm CLS
      stays at 0 even as images load.
    </p>
  </header>

  {#each fixtures as fixture}
    <section>
      <h2>{fixture.label}</h2>
      <MediaGallery items={fixture.items} />
    </section>
  {/each}
</div>

<Lightbox />

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1rem 6rem;
    color: var(--color-text-primary);
  }
  header {
    margin-bottom: 2rem;
  }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    font-weight: 600;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  .note {
    margin: 0 0 0.5rem;
    color: var(--color-caption);
    font-size: 0.875rem;
    line-height: 1.5;
  }
  code {
    background-color: var(--color-input-bg);
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.8125rem;
  }
  section {
    margin-bottom: 2.5rem;
  }
</style>
