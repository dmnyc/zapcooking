/**
 * Dev-only demo for the new media gallery + lightbox. The components
 * are client-only (blurhash decoder needs canvas, Lightbox portals to
 * document.body, MediaTile uses IntersectionObserver) so SSR is
 * disabled. Without this, vite-plugin-svelte's SSR pass attempts to
 * render the page on the server and fails inside SvelteKit's error
 * formatter (`process.cwd is not a function`) when the components hit
 * an undefined browser global.
 */
export const ssr = false;
