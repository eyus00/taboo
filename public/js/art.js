// Small pictures for the menus.

import { arenaById } from '/shared/arenas.js';
import { Renderer } from './renderer.js';

const cache = new Map();
let painter = null;

// Stands in for "random arena": just the style's backdrop.
const EMPTY = { id: 'none', w: 2000, h: 1120, platforms: [], ramps: [], tramps: [], lifts: [], portals: [], pickups: [], spawns: [], respawns: [] };

// What a match will look like: the chosen arena painted in the chosen style,
// seen whole, exactly as it is in the game. Returns an image URL.
export function scenePreview(arenaId, themeId, w = 480, h = 270) {
  const key = `${arenaId}/${themeId}/${w}`;
  if (cache.has(key)) return cache.get(key);
  painter ||= new Renderer(null, { size: [w, h], whole: true });
  const arena = arenaId === 'random' ? EMPTY : arenaById(arenaId);
  painter.setScene(arena, themeId);
  const view = {
    phase: 'playing',
    it: 0,
    names: false,
    pickups: [],
    players: arena.spawns.map(([x, y], slot) => ({ slot, name: '', x, y, vx: 0, vy: 0, ground: true, face: x < arena.w / 2 ? 1 : -1, immune: 0, stun: 0, frz: 0, dead: 0, orb: 0, spd: 0, jmp: 0, shd: 0, itTicks: 0, local: false })),
  };
  painter.draw(view, 1000);
  painter.draw(view, 1016);
  const url = painter.snapshot().toDataURL('image/jpeg', 0.86);
  cache.set(key, url);
  return url;
}

// Fonts arrived after a preview was painted: start over.
export function clearPreviews() {
  cache.clear();
}
