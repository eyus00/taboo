// Art styles. Every style draws the same arena and the same 32x40 players in
// its own way (the contract is in README.md). Only the house style is loaded
// up front; the others are fetched the first time they are needed.

import { THEME_IDS } from '/shared/config.js';
import ink from './ink.js';

export const THEME_MAP = { ink };
const loading = new Map();

// Resolves once the style can be used (falling back to ink if it cannot be loaded).
export function loadTheme(id) {
  if (!THEME_IDS.includes(id)) id = 'ink';
  if (THEME_MAP[id]) return Promise.resolve(THEME_MAP[id]);
  if (!loading.has(id)) {
    loading.set(
      id,
      import(`./${id}.js`)
        .then((m) => (THEME_MAP[id] = m.default))
        .catch(() => {
          loading.delete(id);
          return THEME_MAP.ink;
        }),
    );
  }
  return loading.get(id);
}
