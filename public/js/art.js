// Pictures for the menus, all painted by the game's own renderer: the ink
// landscape behind the menus, a card for every arena and every art style,
// portraits of the players, and the paper the scrolls are made of.
//
//   scenePreview(arenaId, themeId, w?, h?)  -> data URL: a whole arena in a style
//   styleStill(themeId, w?, h?)             -> data URL: a corner of a match in a style
//   playerPortrait(themeId, colourIndex, opts?) -> data URL (PNG), or null
//       One character standing still, in that art style and colour, exactly as
//       the game draws it. Cached, so asking again costs nothing.
//         themeId      'ink' | 'space' | ... The style must be loaded already
//                      (it always is for the round on screen; otherwise
//                      `await loadTheme(themeId)` first) - if not, null.
//         colourIndex  0-9: which of the style's ten player colours. For a
//                      player in a match that is `cols ? cols[slot] : slot`
//                      (play.portraitOf(slot) works it out for you).
//         opts.size    the picture is size x size CSS px; default 96. It is
//                      painted at the screen's devicePixelRatio (2 at most).
//         opts.bg      false (default): transparent around the character;
//                      true: the style's own backdrop and floor behind.
//         opts.it      true: drawn as whoever is it (the style's angry look).
//         opts.face    1 (default, looks right) or -1.
//         opts.peek    true: only if it has been painted before (else null);
//                      never paints, so it can never take time.
//       The feet stand 86% of the way down, in the middle; the first portrait
//       in a style takes a few tens of ms (one small scene is painted), the
//       rest a couple each.
//   portraitBackdrop(themeId, size?, peek?) -> data URL: the 16:9 backdrop a portrait stands in front of on a card
//   sceneThumb / arenaThumb / styleThumb    -> pictures already painted, for the draw before a round

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
    const url = shoot(arena, themeId, w, h, { phase: 'playing', it: 0, names: false, boxes: [], players });
    if (!THEME_MAP[themeId]) return url; // not loaded: this came out in the house style, so it is not kept under that name
    cache.set(key, url);
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
    const url = shoot(SHOWCASE, themeId, w, h, { phase: 'playing', it: 0, names: false, boxes: [0, 1], players });
    if (!THEME_MAP[themeId]) return url;
    cache.set(key, url);
  }
  return cache.get(key);
}

// Small pictures for the draw before a round. None of these paint anything:
// they hand back what is already there (the menus paint some, the draw paints
// the rest a moment later with scenePreview / styleStill, between frames).

// This arena in this style - the picture the arena card has to end up with -
// or null if it has not been painted yet.
export function sceneThumb(arenaId, themeId) {
  return cache.get(`${arenaId}/${themeId}/240`) || null;
}

// Any picture of this arena, for cells that only roll past: in one of the
// preferred styles if there is one. Never for the cell a reel stops on - that
// one must be in the round's own style (sceneThumb), not whatever the menus
// happened to paint last.
export function arenaThumb(arenaId, prefer = []) {
  for (const themeId of prefer) {
    const hit = cache.get(`${arenaId}/${themeId}/240`);
    if (hit) return hit;
  }
  for (const [key, url] of cache) if (key.startsWith(`${arenaId}/`) && key.endsWith('/240')) return url;
  return null;
}

export function styleThumb(themeId) {
  return cache.get(`still/${themeId}/240`) || null;
}

// Can this style be painted right now? (Painting one that has not been loaded
// would quietly come out in the house style.)
export const styleReady = (themeId) => !!THEME_MAP[themeId];

// --- one character, standing ---------------------------------------------------------
// A tiny scene, 16:9 and 64 world units high (a player is 32 x 40): a floor
// right across, and one player in the middle of it. Painted by a renderer that
// keeps scenery and players on separate layers, so the backdrop is baked once
// per style and every colour after that is just one small character.
const POSE_H = 64;
const POSE_W = (POSE_H * 16) / 9;
const POSE_FEET = 55;
const POSE = {
  id: 'pose',
  w: POSE_W,
  h: POSE_H,
  platforms: [{ x: -60, y: POSE_FEET, w: POSE_W + 120, h: 80, oneway: false, ground: true }],
  ramps: [],
  tramps: [],
  lifts: [],
  spikes: [],
  bases: [],
  portals: [],
  pickups: [],
  spawns: [],
  respawns: [],
};
const posers = new Map();

function poser(size, themeId) {
  let p = posers.get(size);
  if (!p) {
    p = new Renderer(null, { size: [Math.round((size * 16) / 9), size], dpr: dpr(), zoom: size / POSE_H, focus: { x: POSE_W / 2, y: POSE_H / 2 }, plain: true });
    posers.set(size, p);
  }
  if (p.posed !== themeId) {
    p.setScene(POSE, themeId);
    p.level = 2; // no drifting petals, no dust behind the feet: only the character
    p.posed = themeId;
  }
  return p;
}

export function playerPortrait(themeId, colourIndex = 0, opts = {}) {
  if (!THEME_MAP[themeId]) return null;
  const size = Math.max(16, Math.round(opts.size || 96));
  const col = ((Math.round(colourIndex) % 10) + 10) % 10;
  const face = opts.face === -1 ? -1 : 1;
  const key = `portrait/${themeId}/${col}/${size}/${opts.bg ? 1 : 0}${opts.it ? 1 : 0}${face}`;
  if (opts.peek) return cache.get(key) || null;
  if (!cache.has(key)) {
    const p = poser(size, themeId);
    p.parts.length = 0;
    const view = { phase: 'countdown', it: opts.it ? 0 : -1, names: false, boxes: [], players: [{ ...still(0, POSE_W / 2 - 16, POSE_FEET - 40, { face }), col }] };
    p.draw(view, 1000);
    p.draw(view, 1016);
    // the middle square of the picture
    const c = document.createElement('canvas');
    c.width = c.height = p.fg.height;
    const g = c.getContext('2d');
    const x = -Math.round((p.fg.width - c.width) / 2);
    if (opts.bg) g.drawImage(p.bg, 0, 0, p.bg.width, p.bg.height, x, 0, p.fg.width, p.fg.height);
    g.drawImage(p.fg, x, 0);
    cache.set(key, opts.bg ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png'));
  }
  return cache.get(key);
}

// What a portrait of this size stands in front of on a 16:9 card: the style's
// backdrop with a floor under the feet (which are in the middle, 86% down).
export function portraitBackdrop(themeId, size = 96, peek = false) {
  if (!THEME_MAP[themeId]) return null;
  size = Math.max(16, Math.round(size));
  const key = `pose/${themeId}/${size}`;
  if (peek) return cache.get(key) || null;
  if (!cache.has(key)) cache.set(key, poser(size, themeId).bg.toDataURL('image/jpeg', 0.88));
  return cache.get(key);
}

// Fonts arrived after a picture was painted: start over.
export function clearPictures() {
  cache.clear();
  for (const p of posers.values()) p.posed = null;
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
