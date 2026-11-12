// NEON DISTRICT - cyberpunk. Rain-slick night city, glowing rails, little
// visor-bots leaving light trails.
//
// The city, the rails and all of their glow are painted once. Each frame only
// adds rain, a few blinking lights and pulses running along the rails; whatever
// has to glow while it moves stamps a pre-rendered sprite.

import { ART_W as W, ART_H as H, PW } from '/shared/config.js';
import { rr, rgba, lighten, hash1, vnoise, squashAt, drawIcon, KIND_COLORS, PORTAL_COLORS } from '../util.js';

const CYAN = '#22e6ff';
const PINK = '#ff2bd6';
const AMBER = '#ffb347';
const VIOLET = '#9d6bff';
const HOT = '#ff2b6a'; // whoever is "it" burns this colour
const SHELL = '#0c0a1f';
const AIR = '#7df9ff'; // updraft columns
const OFF = new Set((new URLSearchParams(location.search).get('off') || '').split(',')); // DEBUG
const SIGN_COLORS = [CYAN, PINK, AMBER, '#7dff6b'];
const COLORS = ['#ff4d5e', '#3da8ff', '#3dff9a', '#ffe14d'];
const SLAB = 14; // how thick ledges and slopes are
const LIP = 16; // flat bit at a loose end of a slope (a player's centre rides the slope, so half of them hangs over)

// Canvas pixels per unit: glow is sized with this so it looks the same on every screen.
const unit = (g) => g.getTransform().a;

function skyline(g, rnd, o) {
  let x = -20;
  while (x < W + 20) {
    const w = o.minW + rnd() * (o.maxW - o.minW);
    const h = o.minH + rnd() * (o.maxH - o.minH);
    const top = H - h;
    g.fillStyle = o.color;
    g.fillRect(x, top, w, h);
    if (rnd() < 0.45) g.fillRect(x + w * 0.2, top - 8 - rnd() * 14, w * 0.6, 30); // stepped roof
    if (rnd() < 0.35) {
      const ax = x + w * (0.3 + rnd() * 0.4);
      const ah = 14 + rnd() * 30;
      g.fillRect(ax, top - ah, 1.5, ah);
      if (o.beacons && rnd() < 0.7) o.beacons.push({ x: ax + 0.75, y: top - ah, ph: rnd() * 6 });
    }
    // windows
    const cols = Math.floor((w - 8) / 7);
    const rows = Math.floor((h - 12) / 9);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() > o.density) continue;
        const col = rnd() < 0.5 ? CYAN : rnd() < 0.5 ? PINK : rnd() < 0.6 ? AMBER : '#ffffff';
        g.fillStyle = rgba(col, o.winAlpha * (0.4 + rnd() * 0.6));
        g.fillRect(x + 5 + c * 7, top + 8 + r * 9, 3.5, 5);
      }
    }
    // a vertical neon sign hung on the side
    if (o.signs && w > 44 && h > 120 && rnd() < 0.5) {
      const col = SIGN_COLORS[Math.floor(rnd() * SIGN_COLORS.length)];
      const sw = 11;
      const sh = 38 + rnd() * 40;
      const sx = x + 6 + rnd() * (w - 24);
      const sy = top + 16 + rnd() * 30;
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 8 * unit(g);
      g.strokeStyle = col;
      g.lineWidth = 1.6;
      g.strokeRect(sx, sy, sw, sh);
      g.shadowBlur = 3.5 * unit(g);
      g.fillStyle = col;
      // abstract glyph blocks instead of real lettering
      for (let gy = sy + 5; gy < sy + sh - 6; gy += 9) {
        const k = rnd();
        if (k < 0.33) g.fillRect(sx + 3, gy, 5, 5);
        else if (k < 0.66) {
          g.fillRect(sx + 3, gy, 5, 1.6);
          g.fillRect(sx + 3, gy + 3.4, 5, 1.6);
        } else {
          g.beginPath();
          g.arc(sx + 5.5, gy + 2.5, 2.6, 0, 6.283);
          g.fill();
        }
      }
      g.restore();
      o.signs.push({ x: sx - 2, y: sy - 2, w: sw + 4, h: sh + 4, ph: rnd() * 50 });
    }
    x += w + (rnd() < 0.3 ? rnd() * 10 : 0);
  }
}

// Every platform gets a rail colour that only depends on where it is. Amber is
// kept for the bounce pads, so they never blend into the ledge they sit on.
const LEDGE_COLORS = [PINK, CYAN, VIOLET];
const accentOf = (p) => (p.ground ? [CYAN, PINK][(p.x / 40) & 1] : LEDGE_COLORS[Math.floor(p.x / 40 + p.y / 40) % 3]);

// The parts of a solid block's top edge with nothing built on them.
function openTop(p, arena) {
  let spans = [[p.x, p.x + p.w]];
  for (const o of arena.platforms) {
    if (!o.ground || Math.abs(o.y + o.h - p.y) > 1) continue;
    spans = spans.flatMap(([a, b]) => {
      const l = Math.max(a, o.x);
      const r = Math.min(b, o.x + o.w);
      return l >= r ? [[a, b]] : [[a, l], [r, b]].filter(([s, e]) => e - s > 1);
    });
  }
  return spans;
}

// Is there a platform whose top runs along y from xa to xb?
const meets = (arena, xa, xb, y) => arena.platforms.some((p) => Math.abs(p.y - y) < 1 && p.x <= xa + 1 && p.x + p.w >= xb - 1);

// A solid block of the city's machinery, any height.
function block(g, p, rnd, arena) {
  const accent = accentOf(p);
  const open = openTop(p, arena);
  g.fillStyle = '#100b29';
  g.fillRect(p.x, p.y, p.w, p.h);
  // lighter towards the open top
  const depth = Math.min(p.h, 130);
  const lit = g.createLinearGradient(0, p.y, 0, p.y + depth);
  lit.addColorStop(0, '#2a2158');
  lit.addColorStop(1, 'rgba(42,33,88,0)');
  g.fillStyle = lit;
  for (const [a, b] of open) g.fillRect(a, p.y, b - a, depth);

  g.save();
  g.beginPath();
  g.rect(p.x, p.y, p.w, p.h);
  g.clip();
  // panel seams, on a grid shared by every block so neighbours line up
  g.strokeStyle = 'rgba(150,140,255,.16)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = Math.floor(p.x / 40) * 40 + 20; x < p.x + p.w; x += 40) {
    g.moveTo(x + 0.5, p.y + 4);
    g.lineTo(x + 0.5, p.y + p.h);
  }
  for (let y = Math.floor(p.y / 40) * 40 + 26; y < p.y + p.h; y += 40) {
    g.moveTo(p.x, y + 0.5);
    g.lineTo(p.x + p.w, y + 0.5);
  }
  g.stroke();
  // circuit traces and the odd lit vent
  const n = Math.floor((p.w * p.h) / 4200) + 1;
  for (let k = 0; k < n; k++) {
    const x0 = p.x + 10 + rnd() * (p.w - 20);
    const y0 = p.y + 14 + rnd() * (p.h - 24);
    const dx = (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 40);
    const dy = 10 + rnd() * 40;
    g.strokeStyle = rgba(accent, 0.3);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + dx, y0);
    g.lineTo(x0 + dx, y0 + dy);
    g.stroke();
    g.fillStyle = rgba(accent, 0.7);
    g.fillRect(x0 - 1.5, y0 - 1.5, 3, 3);
    g.fillRect(x0 + dx - 1.5, y0 + dy - 1.5, 3, 3);
  }
  for (let k = 0; k < n; k++) {
    g.fillStyle = rgba(AMBER, 0.25 + rnd() * 0.3);
    g.fillRect(p.x + 8 + rnd() * (p.w - 30), p.y + 16 + rnd() * (p.h - 30), 12, 3);
  }
  g.restore();

  // side rails
  g.fillStyle = rgba(accent, 0.35);
  g.fillRect(p.x, p.y, 1.5, p.h);
  g.fillRect(p.x + p.w - 1.5, p.y, 1.5, p.h);
  // glowing top rail: the part you actually stand on
  g.save();
  g.shadowColor = accent;
  g.shadowBlur = 23 * unit(g);
  g.fillStyle = accent;
  for (const [a, b] of open) {
    g.fillRect(a, p.y, b - a, 3);
    g.fillRect(a, p.y, b - a, 3);
  }
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.7)';
  for (const [a, b] of open) g.fillRect(a + 1, p.y + 0.5, b - a - 2, 1);
}

// A floating slab that follows a line of points, left to right. A ledge is
// two points; a slope adds a short flat lip wherever an end hangs loose.
function slab(g, pts, accent) {
  const end = pts.length - 1;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[end];
  const trace = (line, dy, back) => {
    if (back) for (let i = line.length - 1; i >= 0; i--) g.lineTo(line[i][0], line[i][1] + dy);
    else line.forEach(([x, y], i) => (i ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)));
  };
  const yAt = (x) => {
    for (let i = 0; i < end; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return by;
  };

  // light spilling out underneath: faint wedges stacked into a soft falloff
  g.fillStyle = rgba(accent, 0.055);
  for (let s = 1; s <= 4; s++) {
    const top = pts.map((q) => [...q]);
    const low = pts.map((q) => [...q]);
    top[0][0] += 10;
    top[end][0] -= 10;
    low[0][0] -= 3.5 * s;
    low[end][0] += 3.5 * s;
    g.beginPath();
    trace(top, SLAB);
    trace(low, SLAB + 13.5 * s, true);
    g.closePath();
    g.fill();
  }

  // the slab: lighter on top
  g.beginPath();
  trace(pts, 0);
  trace(pts, SLAB, true);
  g.closePath();
  g.fillStyle = '#130e30';
  g.fill();
  g.beginPath();
  trace(pts, 0);
  trace(pts, SLAB * 0.55, true);
  g.closePath();
  g.fillStyle = '#2a2158';
  g.fill();
  g.strokeStyle = 'rgba(150,140,255,.16)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = Math.floor(ax / 40) * 40 + 20; x < bx - 3; x += 40) {
    if (x < ax + 3) continue;
    g.moveTo(x + 0.5, yAt(x) + 4);
    g.lineTo(x + 0.5, yAt(x) + SLAB);
  }
  g.stroke();

  // thin lit edges
  g.lineJoin = 'round';
  g.strokeStyle = rgba(accent, 0.55);
  g.lineWidth = 1.5;
  g.beginPath();
  trace(pts, SLAB - 0.75);
  g.stroke();
  g.fillStyle = rgba(accent, 0.35);
  g.fillRect(ax, ay, 1.5, SLAB);
  g.fillRect(bx - 1.5, by, 1.5, SLAB);
  // glowing top rail: the part you actually stand on
  g.save();
  g.shadowColor = accent;
  g.shadowBlur = 23 * unit(g);
  g.strokeStyle = accent;
  g.lineWidth = 3;
  g.beginPath();
  trace(pts, 1.5);
  g.stroke();
  g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,.7)';
  g.lineWidth = 1;
  g.beginPath();
  trace(pts, 1);
  g.stroke();
}

// A soft round glow, baked once and stamped wherever something has to shine.
function glowSprite(sprite, color, alpha) {
  return sprite(64, 64, (g) => {
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, rgba(color, alpha));
    rg.addColorStop(0.45, rgba(color, alpha * 0.4));
    rg.addColorStop(1, rgba(color, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
  });
}

// Everything in the arena as boxes [x0, y0, x1, y1], with room for its glow.
function boxes(arena, lifts) {
  const out = [];
  for (const p of arena.platforms) out.push([p.x - 16, p.y - 12, p.x + p.w + 16, p.y + p.h + (p.ground ? 0 : 54)]);
  for (const r of arena.ramps) out.push([r.x0 - LIP - 16, Math.min(r.y0, r.y1) - 12, r.x1 + LIP + 16, Math.max(r.y0, r.y1) + SLAB + 54]);
  for (const po of arena.portals) out.push([po.cx - 46, po.cy - 56, po.cx + 46, po.cy + 56]);
  for (const tr of arena.tramps) out.push([tr.x - 10, tr.y - 34, tr.x + tr.w + 10, tr.y + tr.h]);
  if (lifts) for (const z of arena.lifts) out.push([z.x, z.y, z.x + z.w, z.y + z.h]);
  return out;
}

export default {
  id: 'neon',
  colors: COLORS,
  letterbox: '#05030f',
  lift: AIR,
  label: {
    font: '600 13px Rajdhani, sans-serif',
    color: '#e9faff',
    stroke: 'rgba(5,3,20,.9)',
    strokeWidth: 3,
    you: '#ffffff',
    gap: 8,
  },

  build(env) {
    const { rnd, layer, sprite, arena } = env;
    const signs = [];
    const beacons = [];
    const bg = layer((g) => {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#070318');
      sky.addColorStop(0.45, '#170a3d');
      sky.addColorStop(0.82, '#42115c');
      sky.addColorStop(1, '#1a0a2e');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = rgba('#b9c8ff', 0.12 + rnd() * 0.35);
        g.fillRect(rnd() * W, rnd() * 230, 1.3, 1.3);
      }
      // hologram moon
      const mx = 612;
      const my = 118;
      let rg = g.createRadialGradient(mx, my, 10, mx, my, 200);
      rg.addColorStop(0, 'rgba(120,220,255,.34)');
      rg.addColorStop(1, 'rgba(120,220,255,0)');
      g.fillStyle = rg;
      g.fillRect(mx - 200, my - 200, 400, 400);
      g.save();
      g.beginPath();
      g.arc(mx, my, 48, 0, 6.283);
      g.clip();
      const mg = g.createLinearGradient(0, my - 48, 0, my + 48);
      mg.addColorStop(0, '#e6fbff');
      mg.addColorStop(1, '#ff8ae6');
      g.fillStyle = mg;
      g.fillRect(mx - 50, my - 50, 100, 100);
      g.fillStyle = '#170a3d';
      for (let i = 0; i < 6; i++) g.fillRect(mx - 50, my + 4 + i * 8, 100, 1.5 + i * 0.9);
      g.restore();
      // magenta smog on the horizon
      rg = g.createRadialGradient(W / 2, H * 0.9, 20, W / 2, H * 0.9, 520);
      rg.addColorStop(0, 'rgba(255,43,214,.42)');
      rg.addColorStop(1, 'rgba(255,43,214,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);

      skyline(g, rnd, { minW: 34, maxW: 80, minH: 170, maxH: 340, color: '#1d1250', density: 0.22, winAlpha: 0.35 });
      g.fillStyle = 'rgba(66,17,92,.35)';
      g.fillRect(0, 0, W, H);
      skyline(g, rnd, { minW: 40, maxW: 96, minH: 90, maxH: 260, color: '#130a36', density: 0.36, winAlpha: 0.85, signs, beacons });
      skyline(g, rnd, { minW: 50, maxW: 130, minH: 26, maxH: 110, color: '#090520', density: 0.06, winAlpha: 0.5 });
      const fog = g.createLinearGradient(0, H - 150, 0, H);
      fog.addColorStop(0, 'rgba(255,43,214,0)');
      fog.addColorStop(1, 'rgba(255,43,214,.2)');
      g.fillStyle = fog;
      g.fillRect(0, H - 150, W, 150);
    });

    // scanlines and dark corners
    const overlay = layer((g) => {
      g.fillStyle = 'rgba(0,0,10,.11)';
      for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
      v.addColorStop(0, 'rgba(5,0,20,0)');
      v.addColorStop(1, 'rgba(5,0,20,.62)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    });

    const rain = [];
    for (let i = 0; i < 80; i++) rain.push({ x: rnd() * (W + 120), y: rnd() * (H + 60), v: 520 + rnd() * 380, l: 9 + rnd() * 12 });

    // every rail a pulse of light can run along: ledges, open block tops, slopes
    const rails = [];
    const rail = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      rails.push({ x0, y0, ux: (x1 - x0) / len, uy: (y1 - y0) / len, len, n: Math.ceil(len / 700), ph: hash1(rails.length, 5) * 600 });
    };
    for (const p of arena.platforms) {
      if (p.ground) for (const [a, b] of openTop(p, arena)) rail(a, p.y, b, p.y);
      else rail(p.x, p.y, p.x + p.w, p.y);
    }
    for (const r of arena.ramps) rail(r.x0, r.y0, r.x1, r.y1);

    return {
      bg,
      overlay,
      signs,
      beacons,
      rain,
      rails,
      cars: [],
      arena,
      // glow sprites: one per player colour, one for whoever is "it", one for bounce pads
      pal: COLORS.map((c) => ({ glow: glowSprite(sprite, c, 0.5), rim: lighten(c, 0.45), hi: lighten(c, 0.7) })),
      itGlow: glowSprite(sprite, HOT, 0.9),
      padGlow: glowSprite(sprite, AMBER, 0.75),
      trail: [0, 0, 0, 0],
    };
  },

  back(g, sc) {
    sc.art = g.getTransform(); // remembered so decor() can work out where the world sits on the art board
    g.drawImage(sc.bg, 0, 0, W, H);
  },

  platform(g, p, i, rnd, arena) {
    if (p.ground) block(g, p, rnd, arena);
    else slab(g, [[p.x, p.y], [p.x + p.w, p.y]], accentOf(p));
  },

  // A slope is a tilted ledge that keeps its sides and its light pointing straight down.
  ramp(g, r, i, rnd, arena) {
    const pts = [[r.x0, r.y0], [r.x1, r.y1]];
    if (!meets(arena, r.x0 - LIP, r.x0, r.y0)) pts.unshift([r.x0 - LIP, r.y0]);
    if (!meets(arena, r.x1, r.x1 + LIP, r.y1)) pts.push([r.x1 + LIP, r.y1]);
    // where the low end lands on a solid block, the slab tapers into it instead of sinking in
    const [lx, ly] = r.y0 > r.y1 ? [r.x0, r.y0] : [r.x1, r.y1];
    const floor = arena.platforms.find((p) => p.ground && Math.abs(p.y - ly) < 1 && p.x <= lx && p.x + p.w >= lx);
    if (floor) {
      g.beginPath();
      g.rect(r.x0 - 80, floor.y - 4000, r.x1 - r.x0 + 160, 4000);
      g.clip();
    }
    slab(g, pts, PINK);
  },

  // Emitters under the updrafts. Also works out what the animated lights may use.
  decor(g, sc, arena) {
    // world (x, y) sits at art-board (wx + x * k, wy + y * k)
    const m = g.getTransform();
    const k = m.a / sc.art.a;
    const wx = (m.e - sc.art.e) / sc.art.a;
    const wy = (m.f - sc.art.f) / sc.art.d;
    sc.world = { k, x: wx, y: wy };

    // blinking signs and beacons are drawn on top of the picture, so only keep those nothing stands in front of
    const solid = boxes(arena, true);
    const clear = (x0, y0, x1, y1) => {
      const a = (x0 - wx) / k;
      const b = (y0 - wy) / k;
      const c = (x1 - wx) / k;
      const d = (y1 - wy) / k;
      return !solid.some((s) => c > s[0] && a < s[2] && d > s[1] && b < s[3]);
    };
    sc.signs = sc.signs.filter((s) => clear(s.x, s.y, s.x + s.w, s.y + s.h)).slice(0, 3);
    sc.beacons = sc.beacons.filter((b) => clear(b.x - 6, b.y - 6, b.x + 6, b.y + 6)).slice(0, 6);

    // sky traffic flies along lanes that cross no platform, so it never passes in front of one
    const lanes = [];
    const things = boxes(arena, false);
    let run = 0;
    for (let y = 30; y <= arena.h - 100; y += 10) {
      const free = y < arena.h - 100 && !things.some((s) => y + 10 > s[1] && y - 10 < s[3]);
      if (free) run++;
      else {
        if (run >= 3) lanes.push(y - 5 - run * 5);
        run = 0;
      }
    }
    sc.cars = lanes.slice(0, 5).map((y, i) => ({
      y,
      v: (i % 2 ? -1 : 1) * (130 + hash1(i, 11) * 200),
      off: hash1(i, 12) * 2400,
      tail: rgba(i % 2 ? AMBER : CYAN, 0.3),
    }));

    // updraft emitters
    const u = unit(g);
    for (const z of arena.lifts) {
      const by = z.y + z.h;
      const up = g.createLinearGradient(0, by - 100, 0, by);
      up.addColorStop(0, rgba(AIR, 0));
      up.addColorStop(1, rgba(AIR, 0.38));
      g.fillStyle = up;
      g.fillRect(z.x, by - 100, z.w, 100);
      g.fillStyle = '#120d2e';
      g.fillRect(z.x - 4, by - 7, z.w + 8, 7);
      g.fillStyle = 'rgba(150,140,255,.5)';
      for (let x = z.x + 6; x < z.x + z.w - 4; x += 10) g.fillRect(x, by - 4, 5, 1.5);
      g.save();
      g.shadowColor = AIR;
      g.shadowBlur = 14 * u;
      g.fillStyle = AIR;
      g.fillRect(z.x - 2, by - 9, z.w + 4, 2.5);
      g.fillRect(z.x - 2, by - 9, z.w + 4, 2.5);
      g.restore();
    }
  },

  // static: scanlines and dark corners
  front(g, sc) {
    g.drawImage(sc.overlay, 0, 0, W, H);
  },

  // every frame: a handful of small lights and one stroke of rain
  live(g, sc, t) {
    if (OFF.has('live')) return; // DEBUG
    // flickering signs: briefly cut the power
    g.fillStyle = 'rgba(19,10,54,.72)';
    for (let i = 0; i < sc.signs.length; i++) {
      const s = sc.signs[i];
      if (vnoise(t * 7 + s.ph, i) > 0.8) g.fillRect(s.x, s.y, s.w, s.h);
    }
    // rooftop beacons
    g.fillStyle = '#ff6a78';
    for (const b of sc.beacons) {
      if (Math.sin(t * 2.4 + b.ph) > 0.2) g.fillRect(b.x - 1.6, b.y - 1.6, 3.2, 3.2);
    }
    // rain, falling at a slant
    g.strokeStyle = 'rgba(160,215,255,.3)';
    g.lineWidth = 1;
    g.beginPath();
    if (!OFF.has('rain')) // DEBUG
    for (const d of sc.rain) {
      const y = ((d.y + t * d.v) % (H + 60)) - 30;
      const x = ((d.x - y * 0.22 + 2000) % (W + 120)) - 60;
      g.moveTo(x, y);
      g.lineTo(x - d.l * 0.22, y + d.l);
    }
    g.stroke();

    // the rest is drawn at world positions
    const w = sc.world;
    g.translate(w.x, w.y);
    g.scale(w.k, w.k);

    // traffic in the sky
    const span = sc.arena.w + 300;
    for (const c of sc.cars) {
      const x = ((((t * c.v + c.off) % span) + span) % span) - 150;
      g.fillStyle = c.tail;
      g.fillRect(c.v > 0 ? x - 90 : x, c.y, 90, 3);
      g.fillStyle = '#ffffff';
      g.fillRect(x - 3.5, c.y - 1.5, 7, 6);
    }

    // a pulse of light racing along every rail
    g.beginPath();
    if (!OFF.has('pulse')) // DEBUG
    for (const r of sc.rails) {
      const loop = r.len + 60;
      for (let j = 0; j < r.n; j++) {
        const s = ((t * 110 + r.ph + (j * loop) / r.n) % loop) - 30;
        const a = s < 0 ? 0 : s;
        const b = s + 30 > r.len ? r.len : s + 30;
        if (b <= a) continue;
        g.moveTo(r.x0 + r.ux * a, r.y0 + r.uy * a + 1.5);
        g.lineTo(r.x0 + r.ux * b, r.y0 + r.uy * b + 1.5);
      }
    }
    g.lineCap = 'butt';
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.stroke();
    g.lineWidth = 3.5;
    g.strokeStyle = 'rgba(255,255,255,.92)';
    g.stroke();

    // chevrons rising off the bounce pads (they shrink as they go, which reads as fading)
    g.beginPath();
    if (!OFF.has('chev')) // DEBUG
    for (const tr of sc.arena.tramps) {
      for (let n = 0; n < 3; n++) {
        const ph = (t * 1.6 + n / 3) % 1;
        const cy = tr.y - 5 - ph * 24;
        const hw = 10 * (1 - ph * 0.6);
        g.moveTo(tr.cx - hw, cy + hw * 0.5);
        g.lineTo(tr.cx, cy - hw * 0.2);
        g.lineTo(tr.cx + hw, cy + hw * 0.5);
      }
    }
    g.lineJoin = 'round';
    g.lineWidth = 2.4;
    g.strokeStyle = '#ffc56e';
    g.stroke();
  },

  // a repulsor pad
  trampoline(g, tr, t, k, sc) {
    const { x, y, w, h } = tr;
    const dip = k * 4;
    g.drawImage(sc.padGlow, x - 8, y - 14 + dip, w + 16, 30 + k * 8);
    g.fillStyle = '#120d2e';
    g.fillRect(x, y + 7, w, h - 7);
    g.fillStyle = '#8a5a2a';
    g.fillRect(x, y + h - 2, w, 2);
    g.fillStyle = AMBER;
    g.fillRect(x + 2, y + 2 + dip, w - 4, 5);
    g.fillStyle = '#fff3d6';
    g.fillRect(x + 4, y + 3 + dip, w - 8, 1.6 + k * 2);
  },

  // a hard-light gate
  portal(g, po) {
    const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
    const u = unit(g);
    const cx = po.cx;
    const cy = po.cy + 2;
    const rx = 18;
    const ry = 34;
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, 6.283);
    g.clip();
    g.fillStyle = 'rgba(8,5,26,.8)';
    g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    const rg = g.createRadialGradient(cx, cy, 2, cx, cy, ry);
    rg.addColorStop(0, rgba(lighten(col, 0.6), 0.8));
    rg.addColorStop(0.55, rgba(col, 0.4));
    rg.addColorStop(1, rgba(col, 0.2));
    g.fillStyle = rg;
    g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    g.fillStyle = rgba(col, 0.6);
    for (let ly = -ry + 3; ly < ry; ly += 8) g.fillRect(cx - rx, cy + ly, rx * 2, 2);
    g.restore();
    g.shadowColor = col;
    g.shadowBlur = 12 * u;
    g.strokeStyle = col;
    g.lineWidth = 3.5;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, 6.283);
    g.stroke();
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,.9)';
    g.lineWidth = 1.3;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, -2.5, -1.1);
    g.stroke();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0.7, 1.8);
    g.stroke();
  },

  // a hologram
  pickup(g, kind, x, y) {
    const col = KIND_COLORS[kind];
    const u = unit(g);
    g.shadowColor = col;
    g.shadowBlur = 12 * u;
    g.strokeStyle = col;
    g.lineWidth = 2.6;
    g.lineJoin = 'round';
    g.fillStyle = 'rgba(10,7,30,.88)';
    g.beginPath();
    g.moveTo(x, y - 20);
    g.lineTo(x + 17, y);
    g.lineTo(x, y + 20);
    g.lineTo(x - 17, y);
    g.closePath();
    g.fill();
    g.stroke();
    g.stroke();
    g.shadowBlur = 5 * u;
    drawIcon(g, kind, x, y, 8, lighten(col, 0.55));
    g.shadowBlur = 0;
  },

  player(g, pv, t, sc) {
    if (OFF.has('player')) return; // DEBUG
    const { cx, feet, color } = pv;
    const pal = sc.pal[pv.slot];
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const sw = moving ? Math.sin(pv.run) : 0;
    const bob = moving ? Math.abs(Math.cos(pv.run)) * 1.5 : 0;
    const by = pv.y + 1 - bob;
    const bh = 31;
    const hip = by + bh - 2;

    // halo: their own colour, or a big angry pulse around whoever is "it"
    if (OFF.has('glow')) ; else // DEBUG
    if (pv.isIt) {
      const r = 54 + 6 * Math.sin(t * 11);
      g.drawImage(sc.itGlow, cx - r, by + 16 - r, r * 2, r * 2);
      // a ring that keeps pinging outwards
      const ping = (t * 1.3) % 1;
      g.strokeStyle = HOT;
      g.lineWidth = 3.2 * (1 - ping);
      g.beginPath();
      g.arc(cx, by + 16, 24 + ping * 26, 0, 6.283);
      g.stroke();
    } else g.drawImage(pal.glow, cx - 36, by - 20, 72, 72);
    squashAt(g, cx, feet, pv.squash);

    // legs: two light sticks
    g.lineCap = 'round';
    g.strokeStyle = pal.rim;
    g.lineWidth = 4;
    g.beginPath();
    if (!pv.ground) {
      const k = pv.vy < 0 ? 5 : -3;
      g.moveTo(cx - 7, hip);
      g.lineTo(cx - 7 - pv.face * k, feet - 4);
      g.moveTo(cx + 7, hip);
      g.lineTo(cx + 7 - pv.face * k, feet - 1);
    } else {
      g.moveTo(cx - 7, hip);
      g.lineTo(cx - 7 + sw * 7, feet - 2 - Math.max(0, sw) * 4);
      g.moveTo(cx + 7, hip);
      g.lineTo(cx + 7 - sw * 7, feet - 2 - Math.max(0, -sw) * 4);
    }
    g.stroke();

    // body shell in the player's colour, with a bright tube around the edge
    rr(g, pv.x + 2, by, PW - 4, bh, 8);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = pv.isIt ? '#ffffff' : pal.rim;
    g.stroke();
    g.fillStyle = pal.hi;
    g.fillRect(pv.x + 8, by + 2.5, PW - 16, 2.5);

    // dark visor with lit eyes
    const vx = cx - 10 + pv.face * 3;
    const ey = by + 12;
    rr(g, vx, by + 7, 20, 10, 3.5);
    g.fillStyle = SHELL;
    g.fill();
    if (pv.isIt) {
      // angry slanted eyes
      const ex = vx + 10 + pv.face * 1.5;
      g.fillStyle = '#ff5c80';
      g.beginPath();
      g.moveTo(ex - 7.5, ey - 3.5);
      g.lineTo(ex - 1.5, ey - 0.5);
      g.lineTo(ex - 2, ey + 3);
      g.lineTo(ex - 7.5, ey + 3);
      g.moveTo(ex + 7.5, ey - 3.5);
      g.lineTo(ex + 1.5, ey - 0.5);
      g.lineTo(ex + 2, ey + 3);
      g.lineTo(ex + 7.5, ey + 3);
      g.fill();
    } else {
      const eh = 6 * (1 - pv.blink * 0.85);
      g.fillStyle = '#d2fbff';
      g.fillRect(vx + 4 + pv.face * 2, ey - eh / 2, 3.6, eh);
      g.fillRect(vx + 12.4 + pv.face * 2, ey - eh / 2, 3.6, eh);
    }
    // core light + antenna
    g.fillStyle = '#ffffff';
    g.fillRect(cx - 2, by + 21.5, 4, 4);
    g.fillRect(cx - pv.face * 9 - 1.75, by - 8.5, 3.5, 3.5);
    g.strokeStyle = pal.rim;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(cx - pv.face * 6, by + 1);
    g.lineTo(cx - pv.face * 9, by - 5.5);
    g.stroke();
  },

  // a small neon sign with an arrow pointing at the head
  marker(g, cx, cy) {
    const u = unit(g);
    g.save();
    g.lineJoin = 'round';
    g.shadowColor = PINK;
    g.shadowBlur = 9 * u;
    rr(g, cx - 19, cy - 28, 38, 25, 5);
    g.fillStyle = 'rgba(24,2,34,.9)';
    g.fill();
    g.strokeStyle = PINK;
    g.lineWidth = 2.6;
    g.stroke();
    g.fillStyle = PINK;
    g.beginPath();
    g.moveTo(cx - 7, cy - 0.5);
    g.lineTo(cx + 7, cy - 0.5);
    g.lineTo(cx, cy + 8.5);
    g.closePath();
    g.fill();
    g.shadowBlur = 5 * u;
    g.fillStyle = '#ffffff';
    g.font = '800 17px Orbitron, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('IT', cx, cy - 15);
    g.restore();
  },

  fx: {
    // afterimages
    trail(R, pv, dt, t) {
      const sc = R.scene;
      if (OFF.has('trail')) return; // DEBUG
      if (Math.abs(pv.vx) < 150 && pv.ground) return;
      if (t - sc.trail[pv.slot] < 0.05) return;
      sc.trail[pv.slot] = t;
      R.emit({
        x: pv.x,
        y: pv.y,
        life: 0.22,
        alpha: 0.32,
        back: true,
        color: pv.color,
        draw(g, p) {
          g.fillStyle = p.color;
          g.fillRect(p.x + 3, p.y + 2, PW - 6, 29);
        },
      });
    },
    jump(R, pv) {
      for (let i = 0; i < 5; i++) {
        R.emit({ x: pv.cx + (Math.random() - 0.5) * 20, y: pv.feet, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 60, life: 0.28, size: 1, shape: 'line', width: 2, color: pv.color, drag: 4 });
      }
    },
    land(R, pv, impact) {
      R.emit({ x: pv.cx, y: pv.feet - 1, life: 0.3, size: 4, grow: 90 + impact * 90, shape: 'ring', width: 2, color: pv.color });
      for (let i = 0; i < 3 + impact * 4; i++) {
        R.emit({ x: pv.cx + (Math.random() - 0.5) * 24, y: pv.feet - 1, vx: (Math.random() - 0.5) * 320, vy: -40 - Math.random() * 120, g: 600, life: 0.35, size: 1, shape: 'line', width: 2, color: '#ffffff' });
      }
    },
    step(R, pv) {
      R.emit({ x: pv.cx - pv.face * 8, y: pv.feet - 1, vx: -pv.face * 60, vy: -50, g: 300, life: 0.22, size: 1.6, color: pv.color });
    },
    // beamed back in
    respawn(R, pv) {
      R.emit({
        x: pv.cx,
        y: pv.y + 40,
        life: 0.45,
        color: pv.color,
        draw(g, p, k) {
          g.fillStyle = p.color;
          g.fillRect(p.x - 6 * k, p.y - 420, 12 * k, 420);
          g.fillStyle = '#ffffff';
          g.fillRect(p.x - 2 * k, p.y - 420, 4 * k, 420);
        },
      });
    },
    tag(R, to, from) {
      R.flash(PINK, 0.22);
      const x = to.cx;
      const y = to.y + 20;
      R.emit({ x, y, life: 0.45, size: 8, grow: 320, shape: 'ring', width: 3, color: '#ffffff' });
      R.emit({ x, y, life: 0.6, size: 4, grow: 220, shape: 'ring', width: 2, color: PINK });
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * 6.283;
        const v = 180 + Math.random() * 420;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, life: 0.35 + Math.random() * 0.35, size: 1.2, shape: 'line', width: 2.2, color: i % 2 ? to.color : from.color });
      }
      // glitch slices
      for (let i = 0; i < 4; i++) {
        R.emit({
          x: x - 260 + (Math.random() - 0.5) * 120,
          y: y - 150 + Math.random() * 300,
          life: 0.1 + Math.random() * 0.12,
          size: 3 + Math.random() * 7,
          alpha: 0.4,
          color: i % 2 ? CYAN : PINK,
          draw(g, p) {
            g.fillStyle = p.color;
            g.fillRect(p.x, p.y, 520, p.size);
          },
        });
      }
    },
  },
};
