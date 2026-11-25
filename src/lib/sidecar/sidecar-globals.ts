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
  if (!w.SidecarI18n) w.SidecarI18n = { t: (k: string) => k, tn: (k: string) => k };
  if (!w.NostrTools) w.NostrTools = nostrTools;
}
