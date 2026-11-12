// Pictures for the menus, all painted by the game's own renderer: the ink
// landscape behind the menus, a card for every arena and every art style, and
// the paper the scrolls are made of.

import { arenaById } from '/shared/arenas.js';
import { Renderer } from './renderer.js';
import { THEME_MAP } from './themes/index.js';

const cache = new Map();
const painters = new Map();
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

function painter(w, h) {
  const key = `${w}x${h}`;
  if (!painters.has(key)) painters.set(key, new Renderer(null, { size: [w, h], dpr: dpr(), whole: true, plain: true }));
  return painters.get(key);
}

const still = (slot, x, y, o = {}) => ({ slot, name: '', x, y, vx: o.vx || 0, vy: o.vy || 0, ground: o.ground !== false, face: o.face || 1, immune: 0, stun: 0, frz: 0, dead: 0, orb: 0, spd: 0, jmp: 0, shd: 0, itTicks: 0, local: false });

function shoot(arena, themeId, w, h, view) {
  const p = painter(w, h);
  p.setScene(arena, themeId);
  p.draw(view, 1000);
  p.draw(view, 1016);
  return p.snapshot().toDataURL('image/jpeg', 0.88);
}

// Stands in for "random arena": just the style's backdrop.
const EMPTY = { id: 'none', w: 2000, h: 1120, platforms: [], ramps: [], tramps: [], spikes: [], bases: [], lifts: [], portals: [], pickups: [], spawns: [], respawns: [] };

// A whole arena painted in a style, exactly as it looks in the game.
export function scenePreview(arenaId, themeId, w = 480, h = 270) {
  const key = `${arenaId}/${themeId}/${w}`;
  if (!cache.has(key)) {
    const arena = arenaId === 'random' ? EMPTY : arenaById(arenaId);
    const players = arena.spawns.map(([x, y], slot) => still(slot, x, y, { face: x < arena.w / 2 ? 1 : -1 }));
    cache.set(key, shoot(arena, themeId, w, h, { phase: 'playing', it: 0, names: false, boxes: [], players }));
  }
  return cache.get(key);
}

// A little corner of a match that shows off what a style looks like up close:
// floor, ledge, slope, trampoline, portal, a power-up and all four players.
const SHOWCASE = {
  id: 'showcase',
  w: 480,
  h: 270,
  platforms: [
    { x: 0, y: 230, w: 480, h: 40, oneway: false, ground: true },
    { x: 16, y: 122, w: 150, h: 14, oneway: true, ground: false },
    { x: 372, y: 140, w: 108, h: 14, oneway: true, ground: false },
  ],
  ramps: [{ x0: 252, y0: 230, x1: 372, y1: 140 }],
  tramps: [{ x: 176, y: 214, w: 68, h: 16, cx: 210 }],
  lifts: [],
  spikes: [],
  bases: [],
  portals: [
    { x: 30, y: 46, w: 44, h: 76, cx: 52, cy: 84, to: 1, pair: 0 },
    { x: 420, y: 64, w: 44, h: 76, cx: 442, cy: 102, to: 0, pair: 0 },
  ],
  pickups: [{ x: 128, y: 98 }, { x: 300, y: 70 }],
  spawns: [],
  respawns: [],
};

export function styleStill(themeId, w = 240, h = 135) {
  const key = `still/${themeId}/${w}`;
  if (!cache.has(key)) {
    const players = [
      still(0, 84, 190, { vx: 280 }),
      still(1, 196, 112, { vy: -420, ground: false }),
      still(2, 296, 157, { vx: 250 }),
      still(3, 398, 100, { face: -1 }),
    ];
    cache.set(key, shoot(SHOWCASE, themeId, w, h, { phase: 'playing', it: 0, names: false, boxes: [0, 1], players }));
  }
  return cache.get(key);
}

// Small pictures for the draw before a round. These hand back what the menus
// have already painted; with `make` they paint one that is missing - an arena
// in the house style, or a style that has been loaded (never a guess).
export function arenaThumb(arenaId, prefer = [], make = false) {
  for (const themeId of prefer) {
    const hit = cache.get(`${arenaId}/${themeId}/240`);
    if (hit) return hit;
  }
  for (const [key, url] of cache) if (key.startsWith(`${arenaId}/`) && key.endsWith('/240')) return url;
  return make ? scenePreview(arenaId, 'ink', 240, 135) : null;
}

export function styleThumb(themeId, make = false) {
  return cache.get(`still/${themeId}/240`) || (make && THEME_MAP[themeId] ? styleStill(themeId) : null);
}

// Fonts arrived after a picture was painted: start over.
export function clearPictures() {
  cache.clear();
}

// The ink landscape behind the menus, painted to fit the window.
export function paintBackdrop(canvas) {
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  const r = new Renderer(null, { size: [w, h], dpr: Math.min(window.devicePixelRatio || 1, 1.5), whole: true, plain: true });
  r.setScene(EMPTY, 'ink');
  canvas.width = r.bg.width;
  canvas.height = r.bg.height;
  canvas.getContext('2d').drawImage(r.bg, 0, 0);
}

// Handmade paper for the scrolls: a tile of faint fibres and specks.
export function paperTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 260;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const x = rnd() * 260;
    const y = rnd() * 260;
    const a = rnd() * 6.283;
    const l = 3 + rnd() * 12;
    g.strokeStyle = rnd() < 0.5 ? `rgba(120,90,50,${0.05 + rnd() * 0.07})` : `rgba(255,252,240,${0.2 + rnd() * 0.25})`;
    g.lineWidth = 0.6 + rnd() * 0.6;
    // draw each fibre wrapped round the edges so the tile repeats without seams
    for (const ox of [-260, 0, 260]) {
      for (const oy of [-260, 0, 260]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        g.stroke();
      }
    }
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(90,70,40,${0.05 + rnd() * 0.08})`;
    g.fillRect(rnd() * 260, rnd() * 260, 1.2, 1.2);
  }
  return c.toDataURL('image/png');
}
