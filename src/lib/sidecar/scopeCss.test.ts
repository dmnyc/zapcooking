import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { scopeStylesheet, topLevelStatements } from './scopeCss';

const sidecarCss = readFileSync(
  new URL('../vendor/sidecar/sidecar-styles.css', import.meta.url),
  'utf8'
);

describe('scopeStylesheet', () => {
  it('fences rules and media queries inside @scope and turns :root into :scope', () => {
    const out = scopeStylesheet(
      ':root { --a: 1; }\n* { box-sizing: border-box; }\n@media (max-width: 10px) { .x { color: red; } }',
      '.mono-root'
    );
    const body = out.slice(out.indexOf('@scope (.mono-root) {'));
    expect(body).toContain(':scope { --a: 1; }');
    expect(body).toContain('* { box-sizing: border-box; }');
    expect(body).toContain('@media (max-width: 10px) { .x { color: red; } }');
    expect(out).not.toContain(':root');
  });

  it('hoists keyframes and font-face out of the scope block', () => {
    const out = scopeStylesheet(
      '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }\n.a { animation: spin 1s; }',
      '.s'
    );
    expect(out.indexOf('@keyframes spin')).toBeLessThan(out.indexOf('@scope (.s)'));
    expect(out.slice(out.indexOf('@scope'))).not.toContain('@keyframes');
  });

  it('is not fooled by braces in strings or comments', () => {
    const stmts = topLevelStatements('/* { */ .a::before { content: "}"; } .b { color: red; }');
    expect(stmts).toEqual(['.a::before { content: "}"; }', '.b { color: red; }']);
  });

  it('keeps every rule of the real Sidecar stylesheet, balanced', () => {
    const out = scopeStylesheet(sidecarCss, '.mono-root');
    const opens = (out.match(/{/g) || []).length;
    const closes = (out.match(/}/g) || []).length;
    expect(opens).toBe(closes);
    const keyframes = (sidecarCss.match(/@keyframes\s/g) || []).length;
    const head = out.slice(0, out.indexOf('@scope (.mono-root)'));
    expect((head.match(/@keyframes\s/g) || []).length).toBe(keyframes);
    expect(out).not.toMatch(/:root\b/);
    // The compose rules the monocomposer depends on survived the move.
    expect(out).toContain('.compose-modes');
    expect(out).toContain('.poll-editor');
  });
});
