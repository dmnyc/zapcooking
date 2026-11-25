/**
 * Fence a stylesheet inside one element with CSS `@scope`.
 *
 * Sidecar's stylesheet is written for a page of its own — `:root`
 * variables, `*`, element rules — so dropped into this app as-is it would
 * restyle everything. A shadow root used to fence it, but a contenteditable
 * inside a shadow root is invisible to `window.getSelection()` in Chrome
 * (the selection is retargeted to the host), and the composer core reads
 * the caret that way for mentions, emoji and pill navigation. `@scope`
 * fences the rules without hiding the DOM.
 *
 * - Every style rule and conditional group (@media, @supports, …) goes
 *   inside `@scope (<scope>) { … }`.
 * - Rules that cannot be scoped — @keyframes, @font-face, @import,
 *   @charset, @property, @layer statements — are hoisted out unchanged.
 * - `:root` becomes `:scope`, so the sheet's defaults land on the scope
 *   element and inherit from there.
 * - Comments are dropped (they may hold braces).
 */
const HOISTED = /^@(?:-webkit-)?(?:keyframes|font-face|import|charset|property|namespace|layer\s+[^{]*;)/i;

/** Split a stylesheet into its top-level statements, brace- and string-aware. */
export function topLevelStatements(css: string): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        out.push(src.slice(start, i + 1).trim());
        start = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      out.push(src.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = src.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

export function scopeStylesheet(css: string, scope: string): string {
  const hoisted: string[] = [];
  const scoped: string[] = [];
  for (const stmt of topLevelStatements(css)) {
    if (HOISTED.test(stmt)) hoisted.push(stmt);
    else scoped.push(stmt.replace(/:root\b/g, ':scope'));
  }
  return `${hoisted.join('\n')}\n@scope (${scope}) {\n${scoped.join('\n')}\n}\n`;
}
