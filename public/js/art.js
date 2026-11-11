// Small pictures for the menus: player avatars, arena maps, art-style previews.

import { PW, PH } from '/shared/config.js';
import { THEME_MAP } from './themes/index.js';
import { Renderer } from './renderer.js';
import { PORTAL_COLORS } from './util.js';

const ink = THEME_MAP.ink;

// Draw one player's character (in the house ink style) into a canvas.
// opts: { t, scale, vx, face, isIt, run }
export function drawAvatar(canvas, slot, opts = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
  if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const k = (opts.scale || cssH / 54) * dpr;
  // the character is 32x40 with a hat that sticks out a little; scarf trails behind
  g.setTransform(k, 0, 0, k, canvas.width / 2 - (PW / 2 - (opts.shift || 0)) * k, canvas.height - (PH + 5) * k);
  const t = opts.t || 0;
  const pv = {
    slot,
    color: ink.colors[slot % 4],
    x: 0,
    y: 0,
    cx: PW / 2,
    feet: PH,
    vx: opts.vx || 0,
    vy: 0,
    ground: true,
    face: opts.face || 1,
    isIt: !!opts.isIt,
    run: opts.run || 0,
    squash: 0,
    blink: opts.blink || 0,
    seed: slot * 17 + 3,
  };
  ink.player(g, pv, t);
}

// A little map of an arena: ink on paper.
export function arenaThumb(arena, w = 240, h = 135) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#efe6d2';
  g.fillRect(0, 0, w, h);
  const s = Math.min(w / arena.w, h / arena.h) * 0.9;
  const ox = (w - arena.w * s) / 2;
  const oy = (h - arena.h * s) / 2;
  g.fillStyle = '#1c1b1f';
  for (const p of arena.platforms) {
    if (p.oneway) g.fillRect(ox + p.x * s, oy + p.y * s, p.w * s, 2.2);
    else {
      g.globalAlpha = 0.82;
      g.fillRect(ox + p.x * s, oy + p.y * s, p.w * s, p.h * s);
      g.globalAlpha = 1;
    }
  }
  g.fillStyle = '#c4342b';
  for (const t of arena.tramps) g.fillRect(ox + t.x * s, oy + t.y * s - 1.5, Math.max(4, t.w * s), 3);
  for (const p of arena.portals) {
    g.fillStyle = PORTAL_COLORS[p.pair % PORTAL_COLORS.length];
    g.beginPath();
    g.ellipse(ox + p.cx * s, oy + p.cy * s, 2.6, 4.4, 0, 0, 6.283);
    g.fill();
  }
  return c.toDataURL('image/png');
}

// A still from a match in the given art style.
export function styleThumb(themeId, arena, w = 320, h = 180) {
  const c = document.createElement('canvas');
  const R = new Renderer(c, { size: [w, h] });
  R.setScene(arena, themeId);
  // stage a little scene on a ledge that has a power-up spot above it
  const spot = arena.pickups.reduce((a, b) => (Math.abs(b.x - arena.w * 0.32) + Math.abs(b.y - arena.h * 0.76) < Math.abs(a.x - arena.w * 0.32) + Math.abs(a.y - arena.h * 0.76) ? b : a));
  const floor = spot.y + 22;
  const mk = (slot, dx, o = {}) => ({ slot, name: '', x: spot.x + dx - PW / 2, y: floor - PH + (o.dy || 0), vx: o.vx ?? 260, vy: o.vy || 0, ground: !o.dy, face: o.face || 1, immune: 0, stun: 0, dead: 0, itTicks: 0, local: false });
  const view = {
    phase: 'playing',
    mode: 'potato',
    it: 0,
    players: [mk(0, -86), mk(1, 62), mk(2, 150, { dy: -74, vy: -300 })],
    pickups: [{ point: arena.pickups.indexOf(spot), type: 0 }],
    hud: false,
    names: false,
    timeLeft: 60,
    duration: 60,
  };
  R.draw(view, 5000);
  R.draw(view, 5016);
  return c.toDataURL('image/jpeg', 0.84);
}
