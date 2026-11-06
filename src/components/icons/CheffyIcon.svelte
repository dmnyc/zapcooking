<script lang="ts" context="module">
  // Canonical types live in $lib/cheffy; re-exported here so existing
  // consumers that import them from the icon keep working.
  //  - CheffyExpression: the small, typed set of moods (each has
  //    hand-tuned eyes/brows/mouth/mustache below).
  //  - CheffyVariant: compact (head only — toque, face, neckerchief; the
  //    default for 16–32px nav/buttons/cards) vs character (adds a
  //    double-breasted chef jacket and arms, for larger surfaces).
  import type { CheffyExpression, CheffyVariant } from '$lib/cheffy';
  export type { CheffyExpression, CheffyVariant };

  type EyeStyle = 'open' | 'wide' | 'small' | 'up' | 'happy' | 'content';

  interface FaceGeometry {
    eyes: EyeStyle;
    browLeft: string;
    browRight: string;
    mouth: string;
    /** Filled (open) mouth vs a single stroke. */
    mouthOpen: boolean;
    tongue: boolean;
    /** Mustache tip lift in degrees, [left, right]; negative droops. */
    lift: [number, number];
  }

  // Eyes sit around y≈37, the mustache at y≈45 and the mouth just below
  // it at y≈49–51. Each mood tunes eye shape, both brows, the mouth, and
  // how far the mustache tips curl up (or droop).
  const FACES: Record<CheffyExpression, FaceGeometry> = {
    neutral: {
      eyes: 'open',
      browLeft: 'M22.9 32.3 Q25.9 30.8 28.9 32.1',
      browRight: 'M35.1 32.1 Q38.1 30.8 41.1 32.3',
      mouth: 'M29.6 49.3 Q32 51.3 34.4 49.3',
      mouthOpen: false,
      tongue: false,
      lift: [0, 0]
    },
    happy: {
      eyes: 'happy',
      browLeft: 'M22.9 31.3 Q25.9 29.6 28.9 31.0',
      browRight: 'M35.1 31.0 Q38.1 29.6 41.1 31.3',
      mouth: 'M28.8 48.7 Q32 53.4 35.2 48.7 Z',
      mouthOpen: true,
      tongue: false,
      lift: [7, 7]
    },
    thinking: {
      eyes: 'up',
      browLeft: 'M23.0 32.6 Q26.0 32.0 29.0 32.3',
      browRight: 'M35.0 30.4 Q38.0 28.2 41.0 30.0',
      mouth: 'M30.4 50.2 Q32.6 49.2 34.8 50.0',
      mouthOpen: false,
      tongue: false,
      lift: [0, 6]
    },
    excited: {
      eyes: 'wide',
      browLeft: 'M22.7 30.6 Q25.9 28.6 29.1 30.3',
      browRight: 'M34.9 30.3 Q38.1 28.6 41.3 30.6',
      mouth: 'M28.2 48.5 Q32 55.4 35.8 48.5 Z',
      mouthOpen: true,
      tongue: true,
      lift: [10, 10]
    },
    concerned: {
      eyes: 'small',
      browLeft: 'M22.9 32.4 Q26.0 32.2 28.9 30.5',
      browRight: 'M35.1 30.5 Q38.0 32.2 41.1 32.4',
      mouth: 'M29.4 50.9 Q32 48.9 34.6 50.9',
      mouthOpen: false,
      tongue: false,
      lift: [-7, -7]
    },
    cooking: {
      eyes: 'content',
      browLeft: 'M22.9 32.0 Q25.9 30.9 28.9 31.9',
      browRight: 'M35.1 31.9 Q38.1 30.9 41.1 32.0',
      mouth: 'M29.2 49.0 Q32 51.8 34.8 49.0',
      mouthOpen: false,
      tongue: false,
      lift: [4, 4]
    }
  };

  // Right half of the curled mustache; the left half is its mirror.
  // Tips are rotated about the philtrum (32,45) per mood.
  const MUSTACHE =
    'M32 44.2 C34.6 42.5 38.4 42.6 40.6 44.7 C41.4 45.5 42.7 45.6 43.5 44.7 ' +
    'C43.5 47.7 40.3 48.9 36.9 48.0 C35 47.5 33.4 46.7 32 45.9 Z';

  // Toque crown: three overlapping lobes as one exact outline (left
  // r7.4 @ 19.8,15.4 · centre r8.9 @ 32,11.2 · right r7.4 @ 44.2,15.4),
  // so the stroke is a single clean contour with a notch at each gather.
  const TOQUE_CROWN =
    'M15.61 21.5 A7.4 7.4 0 0 1 23.39 8.93 A8.9 8.9 0 0 1 40.61 8.93 ' +
    'A7.4 7.4 0 0 1 48.39 21.5 Z';

  // The Zap Cooking bolt, verbatim from the brand mark (382×382 space),
  // placed on the toque band as an embroidered emblem.
  const BRAND_BOLT =
    'M256.47 170.22C255.44 168.04 253.31 166.69 250.9 166.69H208.99L208.79 166.43L225.04 103.91' +
    'C225.78 101.04 224.51 98.2101 221.87 96.8701C219.23 95.5301 216.2 96.1601 214.32 98.4501' +
    'L125.94 206.16C124.41 208.02 124.1 210.53 125.13 212.7C126.16 214.88 128.29 216.23 130.7 216.23' +
    'H172.61L172.81 216.49L156.56 279.01C155.82 281.88 157.09 284.71 159.73 286.05' +
    'C160.65 286.52 161.62 286.75 162.57 286.75C164.34 286.75 166.06 285.96 167.28 284.47' +
    'L255.66 176.76C257.19 174.9 257.5 172.39 256.47 170.22Z';
  // Centre (32, 23.9), 7 units tall.
  const BOLT_TRANSFORM = 'translate(32 23.9) scale(0.0367) translate(-190.8 -191.4)';

  // Mono glyph geometry — drawn at a 4-unit stroke (1px at 16px) so it
  // sits with Phosphor's regular-weight icons in menus.
  const MONO_CROWN =
    'M15.1 22 A7 7 0 0 1 23.52 10.95 A8.5 8.5 0 0 1 40.48 10.95 A7 7 0 0 1 48.9 22 Z';
  const MONO_MUSTACHE =
    'M32 43.6 C34.8 41.6 39.4 41.8 41.8 44.4 C42.6 45.3 43.9 45.4 44.8 44.4 ' +
    'C44.8 48 41 49.4 37.2 48.3 C35.2 47.7 33.4 46.8 32 46 Z';

  const LEFT_EYE = 26;
  const RIGHT_EYE = 38;
  const EYE_Y = 37.2;
  const LINE = 2.4;
</script>

<script lang="ts">
  /**
   * Cheffy — Zap Cooking's kitchen-companion character.
   *
   * A classic chef read first: a white pleated toque with a band, a
   * curled mustache, and a neckerchief knotted under the chin. The brand
   * lives in the details — the Zap Cooking bolt is embroidered on the
   * toque band and the neckerchief is brand orange.
   *
   * Built from a small set of outlined SVG shapes with one consistent
   * line weight, so it stays crisp from a 16px nav glyph up to a 140px
   * feature-page portrait, and holds on light and dark backgrounds (the
   * outline defines the white toque on light; the toque pops on dark).
   *
   * Silhouette priorities at the smallest size: toque → mustache →
   * orange neckerchief. No thin detail that disappears at 20px.
   *
   * Two render modes:
   *  - color (default): the full character. Colours are CSS custom
   *    properties (`--cheffy-*`) layered over the app theme so consumers
   *    can re-tint without a new palette; the accent follows
   *    `--color-primary`.
   *  - mono: single-`currentColor` line glyph (toque, face, eyes,
   *    mustache) at icon-set stroke weight, for places where the icon
   *    should inherit text color.
   *
   * Accessibility: pass `title` for an accessible name (role="img" +
   * <title>); omit it and the SVG is aria-hidden (decorative).
   */
  export let size: number = 24;
  export let expression: CheffyExpression = 'neutral';
  /** compact (head only, default) or character (adds jacket + arms). */
  export let variant: CheffyVariant = 'compact';
  /** Accessible label. When empty the icon is treated as decorative. */
  export let title: string = '';
  /** Monochrome line glyph that inherits `currentColor`. */
  export let mono: boolean = false;
  let className = '';
  export { className as class };

  $: decorative = title.trim().length === 0;
  $: face = FACES[expression] ?? FACES.neutral;

  // In the character variant the head is shrunk and lifted so the chef
  // jacket fits below; compact draws the head at full size.
  $: headTransform = variant === 'character' ? 'translate(10.6 -0.6) scale(0.668)' : undefined;

  $: eyeRx = face.eyes === 'wide' ? 2.6 : face.eyes === 'small' ? 1.9 : 2.2;
  $: eyeRy = face.eyes === 'wide' ? 3.2 : face.eyes === 'small' ? 2.4 : 2.8;
  $: eyeDx = face.eyes === 'up' ? 0.7 : 0;
  $: eyeDy = face.eyes === 'up' ? -0.9 : 0;
  $: catchlight = face.eyes === 'wide' ? 1.05 : 0.8;
  $: closedEyes = face.eyes === 'happy' || face.eyes === 'content';

  // Closed-eye arcs: "happy" curves up (^ ^), "content" curves down.
  function closedEye(cx: number, style: EyeStyle): string {
    return style === 'happy'
      ? `M${cx - 2.4} 38.2 Q${cx} 35 ${cx + 2.4} 38.2`
      : `M${cx - 2.4} 36.8 Q${cx} 39.4 ${cx + 2.4} 36.8`;
  }
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 64 64"
  width={size}
  height={size}
  class={`cheffy-icon ${className}`}
  class:is-mono={mono}
  role={decorative ? undefined : 'img'}
  aria-hidden={decorative ? 'true' : undefined}
  aria-label={decorative ? undefined : title}
>
  {#if !decorative}<title>{title}</title>{/if}

  {#if mono}
    <!-- Monochrome glyph — toque, face, eyes, mustache in currentColor. -->
    <g
      fill="none"
      stroke="currentColor"
      stroke-width="4"
      stroke-linejoin="round"
      stroke-linecap="round"
    >
      <path d={MONO_CROWN} />
      <path d="M18 22 V28.5 H46 V22" />
      <path
        d="M19.4 28.5 C18.8 31.5 18.6 34.4 18.6 37.6 C18.6 46.8 24.8 53 32 53 C39.2 53 45.4 46.8 45.4 37.6 C45.4 34.4 45.2 31.5 44.6 28.5"
      />
      {#if closedEyes}
        <path
          d={face.eyes === 'happy'
            ? 'M23.5 37.6 Q26.5 34 29.5 37.6 M34.5 37.6 Q37.5 34 40.5 37.6'
            : 'M23.5 35.6 Q26.5 38.8 29.5 35.6 M34.5 35.6 Q37.5 38.8 40.5 35.6'}
          stroke-width="3"
        />
      {/if}
    </g>
    <g fill="currentColor">
      {#if !closedEyes}
        <circle cx="26.5" cy="36.4" r="2.6" />
        <circle cx="37.5" cy="36.4" r="2.6" />
      {/if}
      <path d={MONO_MUSTACHE} />
      <path d={MONO_MUSTACHE} transform="translate(64 0) scale(-1 1)" />
    </g>
  {:else}
    <!-- ── Character-only body: a double-breasted chef jacket with
         sleeves and hands. Drawn first so the head (and neckerchief)
         overlaps the collar. -->
    {#if variant === 'character'}
      <g stroke-linecap="round" stroke-linejoin="round">
        <!-- Sleeves: an ink pass then a white pass gives outlined arms -->
        <g fill="none" stroke="var(--cheffy-ink, #3A2415)" stroke-width="10">
          <path d="M21.8 46 Q16.6 48.4 15.8 54.2" />
          <path d="M42.2 46 Q47.4 48.4 48.2 54.2" />
        </g>
        <!-- Jacket: tapered with a softly rounded hem -->
        <path
          d="M21 62.4 Q20.2 55 20.6 50.6 Q21.2 43.4 28 41.6 H36 Q42.8 43.4 43.4 50.6 Q43.8 55 43 62.4 Q32 63.6 21 62.4 Z"
          fill="var(--cheffy-hat, #FFFFFF)"
          stroke="var(--cheffy-ink, #3A2415)"
          stroke-width={LINE}
        />
        <g fill="none" stroke="var(--cheffy-hat, #FFFFFF)" stroke-width="5.2">
          <path d="M21.8 46 Q16.6 48.4 15.8 54.2" />
          <path d="M42.2 46 Q47.4 48.4 48.2 54.2" />
        </g>
        <!-- Double-breasted flap edge + two columns of buttons -->
        <path
          d="M37.6 44.6 Q39.4 52 38.8 61.6"
          fill="none"
          stroke="var(--cheffy-ink, #3A2415)"
          stroke-width="1.3"
        />
        <g fill="var(--cheffy-ink, #3A2415)">
          <circle cx="28.6" cy="50.4" r="1.1" />
          <circle cx="35" cy="50.4" r="1.1" />
          <circle cx="28.6" cy="56.2" r="1.1" />
          <circle cx="35" cy="56.2" r="1.1" />
        </g>
        <!-- Hands -->
        <g
          fill="var(--cheffy-skin, #F7CBA4)"
          stroke="var(--cheffy-ink, #3A2415)"
          stroke-width={LINE}
        >
          <circle cx="15.8" cy="55.2" r="2.5" />
          <circle cx="48.2" cy="55.2" r="2.5" />
        </g>
      </g>
    {/if}

    <!-- ── Head group (shared geometry; scaled for the character) ── -->
    <g transform={headTransform} stroke-linecap="round" stroke-linejoin="round">
      <!-- Neckerchief, knotted under the chin — the brand-orange accent -->
      <path
        d="M20.6 50.4 Q32 56.6 43.4 50.4 L41.2 55 Q36.6 58.8 33.5 62 Q32 63.1 30.5 62 Q27.4 58.8 22.8 55 Z"
        fill="var(--cheffy-accent, var(--color-primary, #ec4700))"
        stroke="var(--cheffy-ink, #3A2415)"
        stroke-width={LINE}
      />
      <path
        d="M25.4 55.8 Q32 59.2 38.6 55.8"
        fill="none"
        stroke="var(--cheffy-accent-shade, #B83600)"
        stroke-width="1.2"
        opacity="0.8"
      />

      <!-- Ears -->
      <g fill="var(--cheffy-skin, #F7CBA4)" stroke="var(--cheffy-ink, #3A2415)" stroke-width={LINE}>
        <circle cx="16.4" cy="38.4" r="3.8" />
        <circle cx="47.6" cy="38.4" r="3.8" />
      </g>
      <g fill="var(--cheffy-skin-shade, #E8A27C)">
        <circle cx="15.9" cy="38.5" r="1.5" />
        <circle cx="48.1" cy="38.5" r="1.5" />
      </g>

      <!-- Face: narrower at the temples, full in the cheeks -->
      <path
        d="M18.2 25 C17.2 30 16.6 34.5 16.6 39.6 C16.6 48.6 23.4 54.2 32 54.2 C40.6 54.2 47.4 48.6 47.4 39.6 C47.4 34.5 46.8 30 45.8 25 Z"
        fill="var(--cheffy-skin, #F7CBA4)"
        stroke="var(--cheffy-ink, #3A2415)"
        stroke-width={LINE}
      />
      <!-- Warm kitchen-flushed cheeks -->
      <g fill="var(--cheffy-blush, #F08A6C)" opacity="0.42">
        <ellipse cx="22.2" cy="44.4" rx="2.9" ry="1.9" />
        <ellipse cx="41.8" cy="44.4" rx="2.9" ry="1.9" />
      </g>

      <!-- Eyes -->
      {#if closedEyes}
        <g fill="none" stroke="var(--cheffy-ink, #3A2415)" stroke-width="2.2">
          <path d={closedEye(LEFT_EYE, face.eyes)} />
          <path d={closedEye(RIGHT_EYE, face.eyes)} />
        </g>
      {:else}
        <g fill="var(--cheffy-ink, #3A2415)">
          <ellipse cx={LEFT_EYE + eyeDx} cy={EYE_Y + eyeDy} rx={eyeRx} ry={eyeRy} />
          <ellipse cx={RIGHT_EYE + eyeDx} cy={EYE_Y + eyeDy} rx={eyeRx} ry={eyeRy} />
        </g>
        <g fill="#fff">
          <circle cx={LEFT_EYE + eyeDx + 0.8} cy={EYE_Y + eyeDy - 1} r={catchlight} />
          <circle cx={RIGHT_EYE + eyeDx + 0.8} cy={EYE_Y + eyeDy - 1} r={catchlight} />
        </g>
      {/if}

      <!-- Brows -->
      <g fill="none" stroke="var(--cheffy-ink, #3A2415)" stroke-width="1.9">
        <path d={face.browLeft} />
        <path d={face.browRight} />
      </g>

      <!-- Nose -->
      <ellipse cx="32" cy="41.3" rx="2.5" ry="2" fill="var(--cheffy-skin-shade, #E8A27C)" />

      <!-- Mouth, tucked under the mustache -->
      <path
        d={face.mouth}
        fill={face.mouthOpen ? 'var(--cheffy-ink, #3A2415)' : 'none'}
        stroke="var(--cheffy-ink, #3A2415)"
        stroke-width="1.8"
      />
      {#if face.tongue}
        <ellipse cx="32" cy="51.1" rx="1.7" ry="0.85" fill="var(--cheffy-tongue, #F0806A)" />
      {/if}

      <!-- Curled mustache — the tips lift or droop with the mood -->
      <g fill="var(--cheffy-ink, #3A2415)">
        <path d={MUSTACHE} transform={`rotate(${-face.lift[1]} 32 45)`} />
        <path
          d={MUSTACHE}
          transform={`translate(64 0) scale(-1 1) rotate(${-face.lift[0]} 32 45)`}
        />
      </g>

      <!-- ── Toque ── -->
      <path
        d={TOQUE_CROWN}
        fill="var(--cheffy-hat, #FFFFFF)"
        stroke="var(--cheffy-ink, #3A2415)"
        stroke-width={LINE}
      />
      <!-- Soft shadow where the crown billows over the band -->
      <path
        d="M16.4 21.5 Q16.6 18.8 19.4 18.5 Q24.4 21 32 19.7 Q39.6 21 44.6 18.5 Q47.4 18.8 47.6 21.5 Z"
        fill="var(--cheffy-hat-shade, #ECE2D5)"
      />
      <!-- Gathers, falling from the notches between the lobes -->
      <g fill="none" stroke="var(--cheffy-ink, #3A2415)" stroke-width="1.6">
        <path d="M23.6 10.8 Q22.9 15.6 24.7 19.6" />
        <path d="M40.4 10.8 Q41.1 15.6 39.3 19.6" />
      </g>
      <!-- Band, curving with the forehead -->
      <path
        d="M17 19.5 H47 V27.4 Q32 30 17 27.4 Z"
        fill="var(--cheffy-hat, #FFFFFF)"
        stroke="var(--cheffy-ink, #3A2415)"
        stroke-width={LINE}
      />
      <path
        d="M18.2 25.8 Q32 28.5 45.8 25.8 V26.6 Q32 29.1 18.2 26.6 Z"
        fill="var(--cheffy-hat-shade, #ECE2D5)"
      />
      <!-- Zap bolt emblem on the band — the signature brand detail -->
      <path
        d={BRAND_BOLT}
        transform={BOLT_TRANSFORM}
        fill="var(--cheffy-accent, var(--color-primary, #ec4700))"
      />
    </g>
  {/if}
</svg>

<style>
  .cheffy-icon {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
  }
</style>
