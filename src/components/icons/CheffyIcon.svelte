<script lang="ts" context="module">
  // Canonical types live in $lib/cheffy; re-exported here so existing
  // consumers that import them from the icon keep working.
  //  - CheffyExpression: the small, typed set of moods.
  //  - CheffyVariant: compact (head + toque only — the default for
  //    16–32px nav/buttons/cards) vs character (adds a minifig-style
  //    chef-jacket torso and arms, for larger surfaces).
  import type { CheffyExpression, CheffyVariant } from '$lib/cheffy';
  export type { CheffyExpression, CheffyVariant };

  type EyeStyle = 'open' | 'wide' | 'small' | 'up' | 'happy' | 'content';

  interface Face {
    eyes: EyeStyle;
    /** Mouth under the mustache (detailed sizes only). */
    mouth: string;
    /** Filled (open) mouth vs a single stroke. */
    open?: boolean;
    tongue?: boolean;
    /** Brows, only where the mood needs them (detailed sizes only). */
    browLeft?: string;
    browRight?: string;
    /** Mustache tip lift in degrees, [left, right]; negative droops. */
    lift: [number, number];
  }

  // At small sizes a mood is carried by the eyes and the mustache tilt
  // alone; mouth and brows only appear once there's room for them.
  const FACES: Record<CheffyExpression, Face> = {
    neutral: { eyes: 'open', mouth: 'M29.6 55 Q32 56.8 34.4 55', lift: [4, 4] },
    happy: { eyes: 'happy', mouth: 'M29 54.6 Q32 58.6 35 54.6 Z', open: true, lift: [9, 9] },
    thinking: {
      eyes: 'up',
      mouth: 'M30.4 55.6 Q32.6 54.8 34.6 55.4',
      browRight: 'M36.2 37.4 Q39.2 35.4 42.2 37',
      lift: [2, 9]
    },
    excited: {
      eyes: 'wide',
      mouth: 'M28.6 54.4 Q32 59.6 35.4 54.4 Z',
      open: true,
      tongue: true,
      lift: [12, 12]
    },
    concerned: {
      eyes: 'small',
      mouth: 'M29.8 56.4 Q32 54.8 34.2 56.4',
      browLeft: 'M21.6 39 Q24.4 39 27.4 37.2',
      browRight: 'M36.6 37.2 Q39.6 39 42.4 39',
      lift: [-9, -9]
    },
    cooking: { eyes: 'content', mouth: 'M29.4 54.8 Q32 57.2 34.6 54.8', lift: [7, 7] }
  };

  // ── Geometry (64×64) ─────────────────────────────────────────
  // Soft, wider-than-tall minifig head.
  const HEAD =
    'M14 45.3 C14 37.84 20.04 31.8 27.5 31.8 H36.5 C43.96 31.8 50 37.84 50 45.3 V46.3 ' +
    'C50 53.76 43.96 59.8 36.5 59.8 H27.5 C20.04 59.8 14 53.76 14 46.3 Z';
  // Toque band (brand accent) and three-lobed crown that overhangs it.
  const BAND = 'M17 25.8 H47 V32.6 H17 Z';
  const CROWN =
    'M15.63 26.6 A8.4 8.4 0 0 1 22.43 11.29 A10 10 0 0 1 41.57 11.29 ' +
    'A8.4 8.4 0 0 1 48.37 26.6 Z';
  // Right half of a handlebar mustache; the left half is its mirror.
  // Tips rotate about (32,51) per mood.
  const MUSTACHE =
    'M32 50.2 C33.2 48.6 36 48.4 38.2 49.4 C39.4 49.9 40.4 49.5 41 48.2 ' +
    'C41.6 50.8 39.8 52.8 37 52.8 C35 52.8 33.2 52 32 51.2 Z';

  // Character torso: minifig-style jacket with arms angled out.
  const TORSO =
    'M24.4 37 H39.6 Q41.6 37 42 39 L44.6 58.4 Q45 61.4 42 61.4 H22 ' +
    'Q19 61.4 19.4 58.4 L22 39 Q22.4 37 24.4 37 Z';
  const ARM_LEFT = 'M23 40.8 L16.4 50.8';
  const ARM_RIGHT = 'M41 40.8 L47.6 50.8';

  // The Zap Cooking bolt, verbatim from the brand mark (382×382 space),
  // shown on the toque band at detailed sizes.
  const BRAND_BOLT =
    'M256.47 170.22C255.44 168.04 253.31 166.69 250.9 166.69H208.99L208.79 166.43L225.04 103.91' +
    'C225.78 101.04 224.51 98.2101 221.87 96.8701C219.23 95.5301 216.2 96.1601 214.32 98.4501' +
    'L125.94 206.16C124.41 208.02 124.1 210.53 125.13 212.7C126.16 214.88 128.29 216.23 130.7 216.23' +
    'H172.61L172.81 216.49L156.56 279.01C155.82 281.88 157.09 284.71 159.73 286.05' +
    'C160.65 286.52 161.62 286.75 162.57 286.75C164.34 286.75 166.06 285.96 167.28 284.47' +
    'L255.66 176.76C257.19 174.9 257.5 172.39 256.47 170.22Z';
  const BOLT_TRANSFORM = 'translate(32 29.2) scale(0.0294) translate(-190.8 -191.4)';

  // Mono glyph — the same build as line art, at a 4-unit stroke (1px at
  // 16px) so it sits with Phosphor's regular-weight icons in menus.
  const MONO_CROWN =
    'M16.26 26 A7.5 7.5 0 0 1 23.18 12.71 A9 9 0 0 1 40.82 12.71 A7.5 7.5 0 0 1 47.74 26 Z';
  const MONO_HEAD =
    'M18.2 31.5 C16.6 34 15.6 37.4 15.6 41.6 V45 C15.6 52.6 21.4 58.2 28.6 58.2 H35.4 ' +
    'C42.6 58.2 48.4 52.6 48.4 45 V41.6 C48.4 37.4 47.4 34 45.8 31.5';
  const MONO_MUSTACHE =
    'M32 49.2 C33.4 47.4 36.6 47.2 39 48.3 C40.4 48.9 41.5 48.4 42.2 47 ' +
    'C42.9 49.9 40.8 52.2 37.6 52.2 C35.3 52.2 33.4 51.3 32 50.4 Z';

  const LEFT_EYE = 24.8;
  const RIGHT_EYE = 39.2;
  const EYE_Y = 44;
  /** Outline weight; drawn as a 2× stroke behind the fills. */
  const LINE = 2.2;
  /** Head scale inside the character variant. */
  const CHARACTER_HEAD_SCALE = 0.6;
  /** Rendered head size (px) from which mouth, brows and bolt appear. */
  const DETAIL_MIN_PX = 32;

  const INK = 'var(--cheffy-ink, #3A2415)';
  const SKIN = 'var(--cheffy-skin, #F8CDA6)';
  const HAT = 'var(--cheffy-hat, #FFFFFF)';
  const ACCENT = 'var(--cheffy-accent, var(--color-primary, #ec4700))';
</script>

<script lang="ts">
  /**
   * Cheffy — Zap Cooking's kitchen-companion character.
   *
   * A cartoon, minifig-style chef: a soft wide head under a white
   * three-lobed toque with a brand-orange band, dot eyes, and a
   * handlebar mustache. Flat fills inside a single outer outline, so
   * there are no inner lines to clutter small sizes.
   *
   * Optical sizing: below 32px of rendered head the face is just eyes +
   * mustache (the mood shows in the eye shape and mustache tilt). From
   * 32px up, the mouth, any mood brows, eye catchlights, and the Zap
   * bolt on the band are added.
   *
   * Two render modes:
   *  - color (default): colours are CSS custom properties (`--cheffy-*`)
   *    layered over the app theme; the band and neckerchief follow
   *    `--color-primary`.
   *  - mono: single-`currentColor` line glyph at icon-set stroke weight
   *    for places where the icon should inherit text colour. It's a
   *    fixed glyph (expression doesn't apply).
   *
   * Accessibility: pass `title` for an accessible name (role="img" +
   * <title>); omit it and the SVG is aria-hidden (decorative).
   */
  export let size: number = 24;
  export let expression: CheffyExpression = 'neutral';
  /** compact (head only, default) or character (adds torso + arms). */
  export let variant: CheffyVariant = 'compact';
  /** Accessible label. When empty the icon is treated as decorative. */
  export let title: string = '';
  /** Monochrome line glyph that inherits `currentColor`. */
  export let mono: boolean = false;
  let className = '';
  export { className as class };

  $: decorative = title.trim().length === 0;
  $: face = FACES[expression] ?? FACES.neutral;
  $: isCharacter = variant === 'character';
  $: detailed = (isCharacter ? size * CHARACTER_HEAD_SCALE : size) >= DETAIL_MIN_PX;

  // In the character variant the head is shrunk and lifted so the torso
  // fits below; compact draws the head at full size.
  $: headTransform = isCharacter
    ? `translate(12.8 -0.2) scale(${CHARACTER_HEAD_SCALE})`
    : undefined;

  $: closedEyes = face.eyes === 'happy' || face.eyes === 'content';
  $: eyeR = face.eyes === 'wide' ? 3.2 : face.eyes === 'small' ? 2.3 : 2.7;
  $: eyeDx = face.eyes === 'up' ? 0.8 : 0;
  $: eyeDy = face.eyes === 'up' ? -1 : 0;

  // Closed-eye arcs: "happy" curves up (^ ^), "content" curves down.
  function closedEye(cx: number, style: EyeStyle): string {
    return style === 'happy'
      ? `M${cx - 2.6} 45 Q${cx} 41.8 ${cx + 2.6} 45`
      : `M${cx - 2.6} 43.4 Q${cx} 46.2 ${cx + 2.6} 43.4`;
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
    <g
      fill="none"
      stroke="currentColor"
      stroke-width="4"
      stroke-linejoin="round"
      stroke-linecap="round"
    >
      <path d={MONO_CROWN} />
      <path d="M18 26 V31.5 H46 V26" />
      <path d={MONO_HEAD} />
    </g>
    <g fill="currentColor">
      <circle cx="25" cy="42.6" r="2.8" />
      <circle cx="39" cy="42.6" r="2.8" />
      <path d={MONO_MUSTACHE} />
      <path d={MONO_MUSTACHE} transform="translate(64 0) scale(-1 1)" />
    </g>
  {:else}
    {#if isCharacter}
      <!-- Torso: outline pass (2× stroke behind), then fills -->
      <g stroke={INK} stroke-linecap="round" stroke-linejoin="round">
        <path d={TORSO} fill={INK} stroke-width={LINE * 2} />
        <path d={ARM_LEFT} stroke-width={6 + LINE * 2} />
        <path d={ARM_RIGHT} stroke-width={6 + LINE * 2} />
        <circle cx="15.4" cy="53.2" r="3" fill={INK} stroke-width={LINE * 2} />
        <circle cx="48.6" cy="53.2" r="3" fill={INK} stroke-width={LINE * 2} />
      </g>
      <path d={TORSO} fill={HAT} />
      <g stroke={HAT} stroke-width="6" stroke-linecap="round">
        <path d={ARM_LEFT} />
        <path d={ARM_RIGHT} />
      </g>
      <g fill={SKIN}>
        <circle cx="15.4" cy="53.2" r="3" />
        <circle cx="48.6" cy="53.2" r="3" />
      </g>
      <!-- Neckerchief + double-breasted buttons -->
      <path d="M26.6 37 H37.4 L32 44.4 Z" fill={ACCENT} />
      <g fill={INK}>
        <circle cx="28.8" cy="49.6" r="1.2" />
        <circle cx="35.2" cy="49.6" r="1.2" />
        <circle cx="28.8" cy="55.4" r="1.2" />
        <circle cx="35.2" cy="55.4" r="1.2" />
      </g>
    {/if}

    <g transform={headTransform}>
      <!-- One outer outline around head + toque, then flat fills -->
      <g fill={INK} stroke={INK} stroke-width={LINE * 2} stroke-linejoin="round">
        <path d={HEAD} />
        <path d={BAND} />
        <path d={CROWN} />
      </g>
      <path d={HEAD} fill={SKIN} />
      <path d={CROWN} fill={HAT} />
      <path d={BAND} fill={ACCENT} />
      {#if detailed}
        <path d={BRAND_BOLT} transform={BOLT_TRANSFORM} fill={HAT} />
      {/if}

      <!-- Eyes -->
      {#if closedEyes}
        <g fill="none" stroke={INK} stroke-width="2.4" stroke-linecap="round">
          <path d={closedEye(LEFT_EYE, face.eyes)} />
          <path d={closedEye(RIGHT_EYE, face.eyes)} />
        </g>
      {:else}
        <g fill={INK}>
          <circle cx={LEFT_EYE + eyeDx} cy={EYE_Y + eyeDy} r={eyeR} />
          <circle cx={RIGHT_EYE + eyeDx} cy={EYE_Y + eyeDy} r={eyeR} />
        </g>
        {#if detailed}
          <g fill="#fff">
            <circle
              cx={LEFT_EYE + eyeDx + 0.9}
              cy={EYE_Y + eyeDy - 0.9}
              r={face.eyes === 'wide' ? 1.1 : 0.85}
            />
            <circle
              cx={RIGHT_EYE + eyeDx + 0.9}
              cy={EYE_Y + eyeDy - 0.9}
              r={face.eyes === 'wide' ? 1.1 : 0.85}
            />
          </g>
        {/if}
      {/if}

      {#if detailed}
        {#if face.browLeft || face.browRight}
          <g fill="none" stroke={INK} stroke-width="2" stroke-linecap="round">
            {#if face.browLeft}<path d={face.browLeft} />{/if}
            {#if face.browRight}<path d={face.browRight} />{/if}
          </g>
        {/if}
        <path
          d={face.mouth}
          fill={face.open ? INK : 'none'}
          stroke={INK}
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        {#if face.tongue}
          <ellipse cx="32" cy="56.7" rx="1.5" ry="0.7" fill="var(--cheffy-tongue, #F0806A)" />
        {/if}
      {/if}

      <!-- Handlebar mustache — tips lift or droop with the mood -->
      <g fill={INK}>
        <path d={MUSTACHE} transform={`rotate(${-face.lift[1]} 32 51)`} />
        <path
          d={MUSTACHE}
          transform={`translate(64 0) scale(-1 1) rotate(${-face.lift[0]} 32 51)`}
        />
      </g>
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
