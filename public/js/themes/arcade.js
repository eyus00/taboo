// ARCADE - an 8-bit sunset. Everything sits on one grid of chunky pixels (one
// art pixel = 2 world units): a banded sky, blocky mountains, brick-and-grass
// platforms, staircase slopes and little block people.

import { ART_W as W, ART_H as H } from '/shared/config.js';
import { vnoise, hash1, lighten, darken, rgba, KIND_COLORS, PORTAL_COLORS } from '../util.js';

const U = 2; // one art pixel, in world units
const OUT = '#1a1040'; // outline colour
const HOT = '#ff2d55'; // the colour of being "it"
const AIR = '#b8f0ff'; // updraft columns
const THICK = 14; // how thick ledges and slopes are
const LIP = 16; // slopes carry on flat this far past each end
const snap = (v) => Math.round(v / U) * U;

const SKY = ['#0d1033', '#1a1650', '#32206e', '#5b2a86', '#8f3a8f', '#c9517f', '#f0756b', '#ffa95e', '#ffd27a'];

// stone bricks get darker the deeper they are: [face, top edge] for a normal and a worn brick
const MORTAR = '#3c3f6e';
const BRICK = [
  [['#6a6fa8', '#8c91c9'], ['#565b92', '#6a6fa8']],
  [['#595e98', '#7378b3'], ['#4b4f85', '#595e98']],
  [['#4a4e86', '#5d629d'], ['#404478', '#4a4e86']],
];

// Power-up icons as pixel art (the same four symbols as the shared vector icons).
const ICONS = {
  speed: ['.....##.', '....##..', '...##...', '..##....', '.######.', '....##..', '...##...', '..##....', '.##.....', '##......'],
  jump: ['....#....', '...###...', '..##.##..', '.##...##.', '....#....', '...###...', '..##.##..', '.##...##.'],
  shield: ['#########', '#########', '#########', '#########', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  freeze: ['....#....', '#...#...#', '.#..#..#.', '..#.#.#..', '...###...', '..#.#.#..', '.#..#..#.', '#...#...#', '....#....'],
};

// Stamp rows of '#' as art pixels, centred on (cx, cy).
function stamp(g, rows, cx, cy, color) {
  const x0 = cx - Math.floor(rows[0].length / 2) * U;
  const y0 = cy - Math.floor(rows.length / 2) * U;
  g.fillStyle = color;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') g.fillRect(x0 + c * U, y0 + r * U, U, U);
  });
}

// The parts of [from, to] that none of the [a, b] intervals cover.
function gaps(from, to, covers) {
  let out = [[from, to]];
  for (const [a, b] of covers) {
    out = out.flatMap(([s, e]) =>
      b <= s || a >= e
        ? [[s, e]]
        : [
            [s, Math.min(e, a)],
            [Math.max(s, b), e],
          ].filter(([u, v]) => v - u > 1),
    );
  }
  return out;
}

// Grass cap with pixel "teeth" hanging off it, along the top of [x0, x1).
function grass(g, x0, x1, y) {
  g.fillStyle = '#3fbf6b';
  g.fillRect(x0, y, x1 - x0, 6);
  for (let tx = x0 + 2; tx < x1 - 2; tx += 8) g.fillRect(tx, y + 6, 4, 2);
  g.fillStyle = '#a7f5c0';
  g.fillRect(x0, y, x1 - x0, 2);
  g.fillStyle = '#2a8a4a';
  for (let tx = x0 + 6; tx < x1 - 2; tx += 8) g.fillRect(tx, y + 4, 2, 2);
}

// A thin ledge: packed dirt under a grass cap.
function drawLedge(g, rnd, p) {
  const { x, y, w, h } = p;
  g.fillStyle = '#9a5a3c';
  g.fillRect(x, y, w, h);
  for (let i = 0; i < (w * h) / 50; i++) {
    g.fillStyle = rnd() < 0.5 ? '#6e3b24' : '#b8734e';
    g.fillRect(snap(x + 2 + rnd() * (w - 6)), snap(y + 8 + rnd() * (h - 12)), 2, 2);
  }
  g.fillStyle = '#4a2616';
  g.fillRect(x, y + h - 2, w, 2);
  grass(g, x, x + w, y);
  g.fillStyle = OUT;
  g.fillRect(x, y - 2, w, 2);
  g.fillRect(x - 2, y, 2, h);
  g.fillRect(x + w, y, 2, h);
  g.fillRect(x, y + h, w, 2);
}

// A solid block of stone bricks, any height. The bricks sit on one lattice for
// the whole arena, so blocks stacked on each other join without a seam.
function drawBlock(g, p, arena) {
  const { x, y, w, h } = p;
  const near = (a, b) => Math.abs(a - b) < 1;
  const others = arena.platforms.filter((q) => q.ground && !(q.x === x && q.y === y));
  // edges that touch another block stay open
  const top = gaps(x, x + w, others.filter((q) => near(q.y + q.h, y)).map((q) => [q.x, q.x + q.w]));
  const bottom = gaps(x, x + w, others.filter((q) => near(q.y, y + h)).map((q) => [q.x, q.x + q.w]));
  // the open-air surface above a brick (this block's top, or the top of one stacked on it)
  const surface = (bx) => others.reduce((s, q) => (bx >= q.x && bx < q.x + q.w && q.y < s ? q.y : s), y);

  g.fillStyle = MORTAR;
  g.fillRect(x, y, w, h);
  const y1 = y + h;
  for (let n = Math.floor((y + 2) / 10); n * 10 - 2 < y1; n++) {
    const by = n * 10 - 2; // a brick is 8 tall with 2 of mortar under it
    const shift = n & 1 ? 10 : 0;
    for (let m = Math.floor((x - shift) / 20); m * 20 + shift < x + w; m++) {
      const bx = m * 20 + shift; // and 18 wide with 2 of mortar beside it
      const xa = Math.max(x, bx);
      const xb = Math.min(x + w, bx + 18);
      if (xb <= xa) continue;
      const depth = by - surface(bx + 9);
      const [face, edge] = BRICK[depth < 56 ? 0 : depth < 136 ? 1 : 2][hash1(m * 131 + n * 17, 5) < 0.18 ? 1 : 0];
      const ya = Math.max(y, by);
      g.fillStyle = face;
      g.fillRect(xa, ya, xb - xa, Math.min(y1, by + 8) - ya);
      if (by >= y) {
        g.fillStyle = edge;
        g.fillRect(xa, by, xb - xa, Math.min(2, y1 - by));
      }
    }
  }
  for (const [a, b] of top) {
    grass(g, a, b, y);
    g.fillStyle = OUT;
    g.fillRect(a, y - 2, b - a, 2);
  }
  g.fillStyle = OUT;
  g.fillRect(x - 2, y, 2, h);
  g.fillRect(x + w, y, 2, h);
  for (const [a, b] of bottom) g.fillRect(a, y1, b - a, 2);
}

// A slope, as a staircase of one-pixel steps: the same dirt and grass as a
// ledge, column by column, following the line the players ride (flat for a
// short lip past each end).
function drawRamp(g, rnd, r, arena) {
  const solid = arena.platforms.filter((p) => p.ground);
  const xa = r.x0 - LIP;
  const xb = r.x1 + LIP;
  const top = (x) => {
    const f = Math.min(1, Math.max(0, (x + U / 2 - r.x0) / (r.x1 - r.x0)));
    return snap(r.y0 + (r.y1 - r.y0) * f);
  };
  // solid ground a column would sink into: the slope stops at its surface
  const ground = (x, t) => solid.reduce((f, p) => (x >= p.x && x < p.x + p.w && p.y + p.h > t && p.y < f ? p.y : f), Infinity);
  // an end that runs into a platform at the same height needs no end cap
  const joined = (x, y) => arena.platforms.some((p) => Math.abs(p.y - y) < 1 && x >= p.x - 1 && x <= p.x + p.w + 1);

  for (let x = xa; x < xb; x += U) {
    const t = top(x);
    const lim = ground(x, t);
    if (t >= lim) continue;
    const b = Math.min(t + THICK, lim);
    const open = b === t + THICK; // nothing underneath: it needs an underside
    const col = Math.round(x / U);
    g.fillStyle = '#9a5a3c';
    g.fillRect(x, t, U, b - t);
    if (rnd() < 0.4 && t + 12 <= b) {
      g.fillStyle = rnd() < 0.5 ? '#6e3b24' : '#b8734e';
      g.fillRect(x, t + 8 + (rnd() < 0.5 ? 2 : 0), U, U);
    }
    if (open) {
      g.fillStyle = '#4a2616';
      g.fillRect(x, b - 2, U, 2);
    }
    g.fillStyle = '#3fbf6b';
    g.fillRect(x, t, U, Math.min(col % 4 === 1 || col % 4 === 2 ? 8 : 6, b - t));
    g.fillStyle = '#a7f5c0';
    g.fillRect(x, t, U, 2);
    if (col % 4 === 3 && t + 6 <= b) {
      g.fillStyle = '#2a8a4a';
      g.fillRect(x, t + 4, U, 2);
    }
    // outline: along the top (closing any taller step), and underneath where it hangs in the air
    g.fillStyle = OUT;
    const up = Math.min(t - 2, top(Math.max(xa, x - U)), top(Math.min(xb - U, x + U)));
    g.fillRect(x, up, U, t - up);
    if (open) g.fillRect(x, b, U, 2);
  }
  g.fillStyle = OUT;
  if (!joined(xa, r.y0) && top(xa) < ground(xa, top(xa))) g.fillRect(xa - 2, top(xa), 2, THICK);
  if (!joined(xb, r.y1) && top(xb - U) < ground(xb - U, top(xb - U))) g.fillRect(xb, top(xb - U), 2, THICK);
}

// A doorway with a stepped, rounded top.
function arch(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y + 6, w, h - 6);
  g.fillRect(x + 2, y + 2, w - 4, 4);
  g.fillRect(x + 6, y, w - 12, 2);
}

// A pine tree silhouette, from the tip down: each tier flares out, the next
// one starts a little narrower.
function pine(g, x, base, tiers) {
  let y = base - 2 - tiers * 3;
  let half = 0;
  for (let k = 0; k < tiers; k++) {
    for (let r = 0; r < 3; r++, y++, half++) g.fillRect(x - half, y, half * 2 + 1, 1);
    half -= 2;
  }
  g.fillRect(x, y, 1, 2);
}

// The backdrop, painted straight onto the pixel grid (one unit here = one art
// pixel), so the sun and the mountains have pixels the same size as the rest.
function backdrop(g, sc) {
  const { s, x: ox, y: oy } = sc.grid;
  const cw = g.canvas.width;
  const ch = g.canvas.height;
  const rnd = sc.rnd;
  const X = (ax) => Math.round(ox + ax * s); // art board -> art pixel
  const Y = (ay) => Math.round(oy + ay * s);
  // one pixel in four, in a staggered pattern
  const sparse = (x, y) => !(x & 1) && !(((x >> 1) + y) & 1);

  // banded sunset; every join is dithered over six rows
  for (let i = 0; i < SKY.length; i++) {
    const y0 = i ? Y(i * 46) : 0;
    g.fillStyle = SKY[i];
    g.fillRect(0, y0, cw, ch - y0);
    for (let row = 1; i && row <= 6; row++) {
      const y = y0 - row;
      for (let x = 0; x < cw; x++) {
        if (row <= 2 ? !sparse(x, y) : row <= 4 ? (x + y) & 1 : sparse(x + 1, y)) g.fillRect(x, y, 1, 1);
      }
    }
  }

  // stars; the first few are kept so they can twinkle
  for (let i = 0; i < 70; i++) {
    const x = X(rnd() * W);
    const y = Y(rnd() * 172);
    if (i < 18) sc.stars.push({ x, y });
    g.fillStyle = i < 18 ? '#9d95e6' : rnd() < 0.3 ? '#ffd27a' : '#e8e4ff';
    g.fillRect(x, y, 1, 1);
  }

  // pixel sun in three tones
  const cx = X(566);
  const cy = Y(318);
  const R = Math.round(72 * s);
  const tone = (dy) => (dy < -R * 0.3 ? '#fff6cf' : dy < R * 0.3 ? '#ffe9a1' : '#ffd27a');
  for (let dy = -R; dy <= R; dy++) {
    const half = Math.round(Math.sqrt(R * R - dy * dy));
    g.fillStyle = tone(dy);
    g.fillRect(cx - half, cy + dy, half * 2, 1);
    if (tone(dy + 2) !== tone(dy)) {
      g.fillStyle = tone(dy + 2);
      for (let x = cx - half + ((cx - half + dy) & 1); x < cx + half; x += 2) g.fillRect(x, cy + dy, 1, 1);
    }
  }

  // chunky clouds
  for (const c of sc.clouds) {
    const x = X(c.x);
    const y = Y(c.y);
    const u = c.u;
    g.fillStyle = '#ffb59a';
    g.fillRect(x, y + u, u * 9, u * 2);
    g.fillStyle = '#ffe3d1';
    g.fillRect(x + u, y, u * 7, u * 2);
    g.fillRect(x + u * 2, y - u, u * 3, u);
    g.fillRect(x + u * 5, y - u, u * 2, u);
    g.fillRect(x, y + u, u * 9, u);
  }

  // two ranges of blocky mountains, in columns two pixels wide
  for (let x = 0; x < cw; x += 2) {
    const ax = (x - ox) / s;
    const hh = 150 + 90 * vnoise(ax / 95, 3) + 26 * vnoise(ax / 21, 5);
    const top = Y(H - hh) & ~1;
    g.fillStyle = '#4b2a7b';
    g.fillRect(x, top, 2, ch - top);
    if (hh > 216) {
      // snow on the high peaks, deeper towards the summit
      const snow = 2 + Math.round((hh - 216) * s * 0.3);
      g.fillStyle = '#f3e3ff';
      g.fillRect(x, top, 2, snow);
      g.fillStyle = '#b79be0';
      g.fillRect(x + ((x >> 1) & 1), top + snow, 1, 1);
    } else {
      g.fillStyle = '#6a3fa0';
      g.fillRect(x, top, 2, 1);
    }
  }
  for (let x = 0; x < cw; x += 2) {
    const ax = (x - ox) / s;
    const hh = 70 + 80 * vnoise(ax / 70 + 40, 9) + 16 * vnoise(ax / 17, 11);
    const top = Y(H - hh) & ~1;
    g.fillStyle = '#2c1a57';
    g.fillRect(x, top, 2, ch - top);
    g.fillStyle = '#3d2670';
    g.fillRect(x, top, 2, 1);
  }

  // a dark pine wood standing just behind the floor
  const fy = Y(sc.floorY);
  g.fillStyle = '#21144a';
  for (let x = 0; x < cw; x += 2) g.fillRect(x, fy - 2 - Math.round(3 * vnoise(x / 23, 21)), 2, ch);
  for (let i = 0; i < 46; i++) pine(g, X(rnd() * W), fy + Math.floor(rnd() * 3), 3 + Math.floor(rnd() * 4));
}

// each player colour's light and dark shade, worked out once
const shades = new Map();
function shadesOf(color) {
  if (!shades.has(color)) shades.set(color, [lighten(color, 0.45), darken(color, 0.3)]);
  return shades.get(color);
}

// Draw sprite rects on a 16x20 grid, mirrored when facing left.
function cell(g, ox, oy, face, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(ox + (face > 0 ? x : 16 - x - w) * U, oy + y * U, w * U, h * U);
}

export default {
  id: 'arcade',
  pixel: U,
  colors: ['#ff5964', '#4da6ff', '#5fe08a', '#ffd84d'],
  letterbox: '#0b1030',
  lift: AIR,
  label: {
    font: '8px "Press Start 2P", monospace',
    color: '#ffffff',
    stroke: OUT,
    strokeWidth: 3,
    you: '#ffd84d',
    gap: 10,
  },

  build(env) {
    const { rnd, arena } = env;
    const clouds = [];
    for (let i = 0; i < 5; i++) clouds.push({ x: rnd() * W, y: 40 + rnd() * 130, u: 4 + Math.floor(rnd() * 2) * 2 });
    // roughly where the floor's surface falls on the art board (both are centred on the screen)
    const floor = arena.platforms.reduce((y, p) => (p.ground && p.y + p.h >= arena.h - 1 ? Math.min(y, p.y) : y), arena.h);
    const floorY = H / 2 + (floor - arena.h / 2) / (U * env.scale);
    // grid, world and stars are filled in while the scene is painted
    return { rnd, clouds, floorY, grid: null, world: null, stars: [] };
  },

  back(g, sc) {
    const m = g.getTransform(); // art board -> art pixels
    sc.grid = { s: m.a, x: m.e, y: m.f };
    g.setTransform(1, 0, 0, 1, 0, 0);
    backdrop(g, sc);
  },

  platform(g, p, i, rnd, arena) {
    if (p.ground) drawBlock(g, p, arena);
    else drawLedge(g, rnd, p);
  },

  ramp(g, r, i, rnd, arena) {
    drawRamp(g, rnd, r, arena);
  },

  decor(g, sc, arena) {
    // updrafts: pixel chevrons pointing up the column
    g.fillStyle = rgba(AIR, 0.42);
    for (const z of arena.lifts) {
      const cx = snap(z.x + z.w / 2);
      for (let y = z.y + z.h - 30; y > z.y + 20; y -= 56) {
        for (let k = 0; k < 4; k++) {
          g.fillRect(cx - 2 - k * 2, snap(y) + k * 2, 2, 4);
          g.fillRect(cx + k * 2, snap(y) + k * 2, 2, 4);
        }
      }
    }
    // remember where the world sits on the pixel grid, and drop any twinkling
    // star that has ended up behind a platform or a slope
    const m = g.getTransform(); // world -> art pixels
    sc.world = { k: m.a, x: m.e, y: m.f };
    sc.stars = sc.stars.filter((st) => {
      const x = (st.x - m.e) / m.a;
      const y = (st.y - m.f) / m.d;
      const hidden = (x0, y0, x1, y1) => x > x0 - 6 && x < x1 + 6 && y > y0 - 6 && y < y1 + 6;
      return !arena.platforms.some((p) => hidden(p.x, p.y, p.x + p.w, p.y + p.h)) && !arena.ramps.some((r) => hidden(r.x0 - LIP, Math.min(r.y0, r.y1), r.x1 + LIP, Math.max(r.y0, r.y1) + THICK));
    });
  },

  // darker towards the corners, like an old tube screen
  front(g) {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, H * 1.02);
    v.addColorStop(0, 'rgba(8,4,30,0)');
    v.addColorStop(1, 'rgba(8,4,30,.5)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  },

  // every frame: stars twinkle, and now and then a comet crosses the top of the sky
  live(g, sc, t) {
    const v = sc.grid;
    const m = g.getTransform(); // art board -> screen
    const k = m.a / v.s; // screen pixels per art pixel
    const ox = m.e - v.x * k;
    const oy = m.f - v.y * k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // fill whole art pixels, landing on the same screen pixels as the backdrop's
    const px = (x, y, w, h) => {
      const x0 = Math.ceil(ox + x * k - 0.5);
      const y0 = Math.ceil(oy + y * k - 0.5);
      g.fillRect(x0, y0, Math.ceil(ox + (x + w) * k - 0.5) - x0, Math.ceil(oy + (y + h) * k - 0.5) - y0);
    };
    const beat = Math.floor(t * 2.5);
    for (let i = 0; i < sc.stars.length; i++) {
      const st = sc.stars[i];
      const tw = hash1(beat + i * 7, i);
      if (tw < 0.4) continue;
      g.fillStyle = tw > 0.75 ? '#ffffff' : '#d9d4ff';
      px(st.x, st.y, 1, 1);
      if (tw > 0.9) {
        px(st.x - 1, st.y, 3, 1);
        px(st.x, st.y - 1, 1, 3);
      }
    }
    const w = sc.world;
    const age = t % 9;
    if (w && age < 1.3) {
      const n = Math.floor(t / 9);
      const dir = hash1(n, 5) < 0.5 ? 1 : -1;
      const f = age / 1.3;
      const cx = Math.round(w.x + (300 + hash1(n, 3) * 1400 + dir * f * 560) * w.k);
      const cy = Math.round(w.y + (12 + f * 44) * w.k);
      const tail = ['#ffffff', '#fff6cf', '#ffe9a1', '#ffd27a', '#ffa95e', '#f0756b', '#c9517f', '#8f3a8f'];
      for (let i = tail.length - 1; i >= 0; i--) {
        g.fillStyle = tail[i];
        px(cx - dir * i * 3 - 1, cy - (i >> 1), 3, i ? 1 : 2);
      }
    }
  },

  // the classic red spring
  trampoline(g, tr, t, k) {
    const x = snap(tr.x);
    const w = snap(tr.w);
    const base = tr.y + tr.h;
    const top = snap(tr.y - 4 + k * 8);
    g.fillStyle = OUT;
    g.fillRect(x + 8, top + 4, w - 16, base - top - 4);
    g.fillStyle = '#c8c8e0';
    for (let y = top + 6; y < base - 1; y += 4) g.fillRect(x + 10, y, w - 20, 2);
    g.fillStyle = OUT;
    g.fillRect(x - 2, top - 2, w + 4, 8);
    g.fillStyle = '#ff5964';
    g.fillRect(x, top, w, 4);
    g.fillStyle = '#ffb3b8';
    g.fillRect(x, top, w, 2);
  },

  // a doorway full of swirling pixels
  portal(g, po) {
    const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
    const x = snap(po.cx) - 18;
    const y = snap(po.cy) - 38;
    arch(g, x - 2, y - 2, 40, 78, OUT);
    arch(g, x, y, 36, 76, lighten(col, 0.4));
    arch(g, x + 2, y + 2, 32, 74, col);
    arch(g, x + 4, y + 4, 28, 72, darken(col, 0.62));
    for (let cy = 0; cy < 17; cy++) {
      for (let cx = 0; cx < 7; cx++) {
        if (cy === 0 && (cx === 0 || cx === 6)) continue; // the rounded corners
        const d = Math.hypot(cx - 3, (cy - 8) * 0.55);
        const n = (((d * 1.7 + Math.atan2(cy - 8, cx - 3) * 1.3) % 4) + 4) % 4;
        if (n >= 2.4) continue;
        g.fillStyle = n < 0.5 ? '#ffffff' : n < 1.3 ? lighten(col, 0.35) : col;
        g.fillRect(x + 4 + cx * 4, y + 6 + cy * 4, 4, 4);
      }
    }
  },

  // an item box
  pickup(g, kind, x, y) {
    const col = KIND_COLORS[kind];
    const cx = snap(x);
    const cy = snap(y);
    g.fillStyle = OUT;
    g.fillRect(cx - 16, cy - 18, 32, 36);
    g.fillRect(cx - 18, cy - 16, 36, 32);
    g.fillStyle = col;
    g.fillRect(cx - 16, cy - 16, 32, 32);
    g.fillStyle = lighten(col, 0.55);
    g.fillRect(cx - 16, cy - 16, 32, 2);
    g.fillRect(cx - 16, cy - 16, 2, 32);
    g.fillStyle = darken(col, 0.35);
    g.fillRect(cx - 16, cy + 14, 32, 2);
    g.fillRect(cx + 14, cy - 16, 2, 32);
    stamp(g, ICONS[kind], cx + 2, cy + 2, darken(col, 0.35));
    stamp(g, ICONS[kind], cx, cy, OUT);
    g.fillStyle = '#ffffff';
    g.fillRect(cx - 12, cy - 12, 4, 2);
    g.fillRect(cx - 12, cy - 10, 2, 2);
  },

  player(g, pv, t) {
    const ox = snap(pv.x);
    const oy = snap(pv.y);
    const c = pv.color;
    const [lt, dk] = shadesOf(c);
    const air = !pv.ground;
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const step = moving ? Math.floor(pv.run / (Math.PI / 2)) % 2 : 0;
    const flash = Math.floor(t * 8) % 2;
    const out = pv.isIt ? (flash ? HOT : '#ffffff') : OUT;
    const P = (x, y, w, h, color) => cell(g, ox, oy, pv.face, x, y, w, h, color);
    const flat = pv.squash > 0.07; // just landed: one pixel shorter and wider

    if (pv.isIt) {
      // whoever is it: a flashing outline and a target bracket snapping in and out
      const d = flash ? 3 : 2;
      const col = flash ? '#ffffff' : HOT;
      for (const [bx, sx] of [
        [-d, 1],
        [15 + d, -1],
      ]) {
        for (const [by, sy] of [
          [-2 - d, 1],
          [19 + d, -1],
        ]) {
          P(sx > 0 ? bx : bx - 3, by, 4, 1, col);
          P(bx, sy > 0 ? by : by - 3, 1, 4, col);
        }
      }
    }

    // feet
    if (air) {
      P(3, 16, 4, 3, out);
      P(9, 15, 4, 3, out);
      P(4, 16, 3, 2, dk);
      P(10, 15, 3, 2, dk);
    } else if (moving) {
      const a = step ? 1 : -1;
      P(3 + a, 17 - (a > 0 ? 1 : 0), 4, 3, out);
      P(9 - a, 17 - (a < 0 ? 1 : 0), 4, 3, out);
      P(4 + a, 17 - (a > 0 ? 1 : 0), 3, 2, dk);
      P(10 - a, 17 - (a < 0 ? 1 : 0), 3, 2, dk);
    } else {
      P(3, 17, 4, 3, out);
      P(9, 17, 4, 3, out);
      P(4, 17, 3, 2, dk);
      P(10, 17, 3, 2, dk);
    }
    const by = flat ? 1 : air ? -1 : -step; // the body bounces a pixel while running
    // body: a rounded block
    P(3, 1 + by, 10, 16 - (flat ? 1 : 0), out);
    P(2, 2 + by, 12, 14 - (flat ? 1 : 0), out);
    P(1, 3 + by, 14, 12 - (flat ? 1 : 0), out);
    P(3, 2 + by, 10, 14 - (flat ? 1 : 0), c);
    P(2, 3 + by, 12, 12 - (flat ? 1 : 0), c);
    if (flat) {
      P(0, 6 + by, 16, 7, out);
      P(1, 6 + by, 14, 7, c);
    }
    P(3, 3 + by, 2, 7, lt);
    P(5, 2 + by, 4, 1, lt);
    P(12, 5 + by, 2, 9 - (flat ? 1 : 0), dk);
    P(4, 14 + by - (flat ? 1 : 0), 9, 2, dk);
    // little sprout on top
    P(7, -1 + by, 2, 2, out);
    P(9, -2 + by, 3, 2, '#3fbf6b');
    P(9, -2 + by, 2, 1, '#a7f5c0');
    // arms go up in the air
    if (air) {
      P(0, 4 + by, 2, 4, out);
      P(14, 4 + by, 2, 4, out);
    }
    // face (looks the way it is heading)
    if (pv.blink > 0.5 || pv.stunned) {
      P(6, 8 + by, 3, 1, OUT);
      P(10, 8 + by, 3, 1, OUT);
    } else {
      P(6, 6 + by, 3, 4, '#ffffff');
      P(10, 6 + by, 3, 4, '#ffffff');
      P(8, 7 + by, 1, 2, OUT);
      P(12, 7 + by, 1, 2, OUT);
    }
    if (pv.isIt) {
      // angry brows and bared teeth
      P(5, 5 + by, 2, 1, OUT);
      P(6, 6 + by, 2, 1, OUT);
      P(12, 5 + by, 2, 1, OUT);
      P(11, 6 + by, 2, 1, OUT);
      P(6, 11 + by, 7, 2, OUT);
      P(7, 11 + by, 1, 1, '#ffffff');
      P(9, 11 + by, 1, 1, '#ffffff');
      P(11, 11 + by, 1, 1, '#ffffff');
    } else if (air || pv.stunned) {
      P(8, 11 + by, 2, 2, OUT);
    } else {
      P(8, 12 + by, 3, 1, OUT);
    }
  },

  // a red tag with "IT" on it and an arrow down to the player
  marker(g, cx, cy) {
    const x = snap(cx);
    const y = snap(cy) + 8;
    const R = (px, py, w, h, color) => {
      g.fillStyle = color;
      g.fillRect(x + px * U, y + py * U, w * U, h * U);
    };
    R(-10, -18, 20, 14, OUT);
    R(-11, -17, 22, 12, OUT);
    R(-4, -4, 8, 1, OUT);
    R(-3, -3, 6, 1, OUT);
    R(-2, -2, 4, 1, OUT);
    R(-1, -1, 2, 1, OUT);
    R(-10, -17, 20, 12, HOT);
    R(-10, -17, 20, 1, '#ff8ea3');
    R(-3, -5, 6, 2, HOT);
    R(-2, -3, 4, 1, HOT);
    R(-1, -2, 2, 1, HOT);
    for (const [dx, dy, color] of [
      [1, 1, '#a30f37'],
      [0, 0, '#ffffff'],
    ]) {
      // I
      R(-7 + dx, -15 + dy, 6, 2, color);
      R(-5 + dx, -13 + dy, 2, 4, color);
      R(-7 + dx, -9 + dy, 6, 2, color);
      // T
      R(1 + dx, -15 + dy, 6, 2, color);
      R(3 + dx, -13 + dy, 2, 6, color);
    }
  },

  fx: {
    jump(R, pv) {
      for (let i = 0; i < 5; i++) R.emit({ x: pv.cx + (i - 2) * 6, y: pv.feet - 2, vx: (i - 2) * 30, vy: -20 - Math.random() * 30, g: 200, life: 0.3, size: 2, color: '#f3e3ff', fade: false });
    },
    land(R, pv, impact) {
      for (let i = 0; i < 6; i++) {
        const dir = i % 2 ? 1 : -1;
        R.emit({ x: pv.cx + dir * 8, y: pv.feet - 2, vx: dir * (40 + Math.random() * 90 * (0.5 + impact)), vy: -30 - Math.random() * 50, g: 400, life: 0.32, size: 2, color: '#f3e3ff', fade: false });
      }
    },
    step(R, pv) {
      R.emit({ x: pv.cx - pv.face * 10, y: pv.feet - 2, vx: -pv.face * 30, vy: -30, g: 300, life: 0.2, size: 2, color: '#a7f5c0', fade: false });
    },
    respawn(R, pv) {
      for (let i = 0; i < 10; i++) R.emit({ x: pv.cx + (Math.random() - 0.5) * 24, y: pv.y - 30 + Math.random() * 40, vy: 60 + Math.random() * 120, life: 0.4, size: 2, color: i % 2 ? pv.color : '#ffffff', fade: false });
    },
    tag(R, to, from) {
      R.flash('#ffffff', 0.22);
      const cols = ['#ffffff', '#ffd84d', to.color, from.color];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * 6.283;
        const v = 120 + (i % 3) * 90;
        R.emit({ x: to.cx, y: to.y + 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2.5, life: 0.5 + (i % 4) * 0.08, size: i % 2 ? 4 : 2, color: cols[i % 4], fade: false });
      }
    },
  },
};
