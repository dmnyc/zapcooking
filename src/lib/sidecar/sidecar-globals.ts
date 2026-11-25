// Sidecar's composer expects two window globals from its host pages, the
// way compose.html loads them: i18n.js (its string table — the keys ARE the
// English text, so identity is the English build) and nostr-tools.js. Both
// must exist before composer-core.js is imported. This module is imported
// for its side effects, first, exactly once.
import * as nostrTools from 'nostr-tools';

if (typeof window !== 'undefined') {
  const w = window as unknown as {
    SidecarI18n?: unknown;
    NostrTools?: unknown;
  };
  if (!w.SidecarI18n) w.SidecarI18n = englishI18n();
  if (!w.NostrTools) w.NostrTools = nostrTools;
}

// The English build of Sidecar's i18n.js API — every function the core
// reaches for, with the keys as the text and {{slot}} substitution done the
// same way. No string table: this app is English-only.
function englishI18n() {
  const substitute = (s: string, params?: Record<string, unknown>) =>
    params ? s.replace(/\{\{(\w+)\}\}/g, (m, k) => (params[k] == null ? m : String(params[k]))) : s;
  const plural = new Intl.PluralRules('en');
  const fmtNum = (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat('en', opts).format(n);
  return {
    t: (key: string, params?: Record<string, unknown>) => substitute(key, params),
    tn: (one: string, other: string, count: number, params?: Record<string, unknown>) =>
      substitute(plural.select(Number(count)) === 'one' ? one : other, {
        count: fmtNum(Number(count)),
        ...params
      }),
    fmtNum,
    fmtDate: (d: Date | number | string, opts?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', opts).format(d instanceof Date ? d : new Date(d)),
    fmtRelative: (value: number, unit: Intl.RelativeTimeFormatUnit, opts?: Intl.RelativeTimeFormatOptions) =>
      new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow', ...opts }).format(value, unit),
    fill: (text: string, nodes?: Record<string, Node>) =>
      String(text)
        .split(/(\{\{\w+\}\})/)
        .filter((part) => part !== '')
        .map((part) => {
          const m = /^\{\{(\w+)\}\}$/.exec(part);
          return m && nodes && nodes[m[1]] ? nodes[m[1]] : part;
        })
  };
}
