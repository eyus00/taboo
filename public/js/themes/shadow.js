// SHADOW - a moonless-black night in ink and white steel. A moon built out of
// blocks hangs over stepped hills, pagodas and bamboo; everything you can stand
// on is a dark block with one crisp white edge, and the players are blocks too:
// a ninja's hooded head and nothing under it - black, a white slit to see
// through, a headband and two ribbons in their own colour. They glide along the
// ground and turn over and over in the air. Colour is kept for the
// things the game needs you to read: who is who, who is the oni (red), which
// portal leads where.

import { ART_W as W, ART_H as H, FLAG_HALF } from '/shared/config.js';
import { rgba, vnoise, hash1, clamp, squashAt, PORTAL_COLORS } from '../util.js';

const WHITE = '#f4f4f6'; // moonlit steel: every edge you can stand on, every toy
const STEEL = '#b4b5bf'; // its shaded side
const IRON = '#5c5d68'; // outlines of things that are solid but not the top of anything
const ASH = '#26262d'; // the moonlit face of stone
const COAL = '#09090b'; // stone in shadow
const BODY = '#060607'; // a ninja
const ONI = '#ff2b3c'; // the one colour of danger: whoever is it
// red, blue, green, yellow, purple, pink, orange, teal, brown, silver - all bright enough to carry on black
const COLORS = ['#ff4b4b', '#4a9dff', '#43e07a', '#ffdc3a', '#b47dff', '#ff7fca', '#ff9436', '#2fe0d2', '#c9925f', '#e3e8f0'];
const SLAB = 14; // how thick ledges and slopes are
const LIP = 16; // flat bit at a loose end of a slope (a player's centre rides the slope, so half of them hangs over)
const MOON = [556, 168, 66]; // centre and radius on the art board
const CELL = 4; // the moon and its clouds are built from blocks this big
const CLOUDS = [[40, 70, 190], [300, 44, 150], [150, 180, 170], [640, 250, 150], [330, 250, 120], [-30, 270, 130], [690, 90, 130]]; // [x, y, length] of the bars of cloud away from the moon

const snap = (v, s) => Math.round(v / s) * s;

// --- the players are blocks -------------------------------------------------------------
const BLOCK = 32; // a side of one, in the 32 x 40 box a style draws a player in (it stands on the feet)
const TURN = Math.PI * 2;
const SPIN = TURN * 0.55; // how fast a block turns over in the air: unhurried - an ordinary jump is a little over half a turn, finished as it lands
// How far each block has turned, remembered per screen (the scene a renderer built is
// the key: the match, every demo and every menu portrait have their own).
const turns = new WeakMap();
const loose = new Map(); // (for a block drawn without a scene)
function turnOf(sc, pv, t) {
  let m = loose;
  if (sc && typeof sc === 'object') {
    m = turns.get(sc);
    if (!m) turns.set(sc, (m = new Map()));
  }
  const key = pv.id ?? pv.slot;
  let st = m.get(key);
  // (a new picture, or one that had stopped for a while: upright)
  if (!st || t < st.t || t - st.t > 0.3) m.set(key, (st = { a: 0, t, dir: pv.face }));
  const dt = t - st.t;
  st.t = t;
  if (!pv.ground && !pv.frozen) {
    if (!pv.dashing) {
      // over and over, the way it is going (or was, if it is going straight up)
      if (pv.vx > 40) st.dir = 1;
      else if (pv.vx < -40) st.dir = -1;
      st.a += st.dir * SPIN * dt;
    }
  } else if (st.a) {
    // on the ground: finish the turn it is nearest to, quickly, and lie flat
    const to = Math.round(st.a / TURN) * TURN;
    st.a += (to - st.a) * (1 - Math.exp(-dt * 13));
    if (Math.abs(to - st.a) < 0.012) st.a = 0;
  }
  return st.a;
}

// ---------------------------------------------------------------------------
// backdrop (art-board coordinates, painted once)
// ---------------------------------------------------------------------------

// A long flat cloud with stepped ends, the way woodblock prints draw them.
function cloudBar(g, x, y, w, h, fill, edge) {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
  g.fillRect(x + h * 2, y - h, w * 0.45, h);
  g.fillRect(x + w * 0.4, y + h, w * 0.5, h);
  if (edge) {
    g.fillStyle = edge;
    g.fillRect(x, y, h * 2, 0.8);
    g.fillRect(x + h * 2, y - h, w * 0.45, 0.8);
    g.fillRect(x + h * 2 + w * 0.45, y, w - h * 2 - w * 0.45, 0.8);
  }
}

// Hills as a staircase of columns.
function hills(g, base, amp, colW, step, seed, fill, edge) {
  for (let x = -colW; x < W + colW; x += colW) {
    const n = 0.62 * vnoise(x / 150, seed) + 0.38 * vnoise(x / 47, seed + 3);
    const top = snap(base - amp * n, step);
    g.fillStyle = fill;
    g.fillRect(x, top, colW + 0.5, H - top);
    g.fillStyle = edge;
    g.fillRect(x, top, colW + 0.5, 0.9);
  }
}

// A tiered tower: every storey a little narrower, every roof a slab with its corners turned up.
function pagoda(g, cx, base, tiers, w0, fill, edge, lamps) {
  let y = base;
  let w = w0;
  const roof = (yy, half, t) => {
    g.fillStyle = fill;
    g.fillRect(cx - half, yy - t, half * 2, t);
    g.fillRect(cx - half * 0.72, yy - t * 2, half * 1.44, t);
    for (const s of [-1, 1]) {
      g.fillRect(cx + s * half - (s > 0 ? 0 : t * 1.6), yy - t * 1.5, t * 1.6, t * 0.9);
      g.fillRect(cx + s * (half + t * 1.6) - (s > 0 ? 0 : t), yy - t * 2.3, t, t * 0.9);
    }
    g.fillStyle = edge;
    g.fillRect(cx - half * 0.72, yy - t * 2, half * 1.44, 0.8);
    g.fillRect(cx - half, yy - t, half * 0.28, 0.8);
    g.fillRect(cx + half * 0.72, yy - t, half * 0.28, 0.8);
  };
  for (let i = 0; i < tiers; i++) {
    const bh = (i === 0 ? 0.62 : 0.44) * w0;
    g.fillStyle = fill;
    g.fillRect(cx - w / 2, y - bh, w, bh);
    if (lamps && i < tiers - 1) {
      // a lit window or two
      g.fillStyle = 'rgba(244,244,246,.55)';
      const n = i === 0 ? 3 : 2;
      for (let k = 0; k < n; k++) if (hash1(k + i * 7, Math.round(cx)) < 0.6) g.fillRect(cx - w / 2 + (w * (k + 0.5)) / n - 1, y - bh * 0.62, 2, 2.6);
    }
    y -= bh;
    roof(y, w / 2 + w0 * 0.26, w0 * 0.085);
    y -= w0 * 0.17;
    w *= 0.8;
  }
  // the spire
  g.fillStyle = fill;
  g.fillRect(cx - w0 * 0.025, y - w0 * 0.62, w0 * 0.05, w0 * 0.62);
  for (let k = 0; k < 3; k++) g.fillRect(cx - w0 * 0.07, y - w0 * (0.2 + k * 0.13), w0 * 0.14, w0 * 0.04);
}

// A house: walls, and a roof of slabs that get narrower.
function house(g, x, base, w, h, fill, edge, lamp) {
  g.fillStyle = fill;
  g.fillRect(x, base - h, w, h + 60);
  const t = 3;
  g.fillRect(x - 7, base - h - t, w + 14, t);
  g.fillRect(x - 3, base - h - t * 2, w + 6, t);
  g.fillRect(x + w * 0.16, base - h - t * 3, w * 0.68, t);
  g.fillRect(x - 10, base - h - t - 1.6, 4, 1.6);
  g.fillRect(x + w + 6, base - h - t - 1.6, 4, 1.6);
  g.fillStyle = edge;
  g.fillRect(x + w * 0.16, base - h - t * 3, w * 0.68, 0.8);
  g.fillRect(x - 3, base - h - t * 2, w * 0.16 + 3, 0.8);
  g.fillRect(x + w * 0.84, base - h - t * 2, w * 0.16 + 3, 0.8);
  if (lamp) {
    g.fillStyle = 'rgba(244,244,246,.6)';
    g.fillRect(x + w * 0.3, base - h * 0.62, 2.2, 3);
    if (w > 60) g.fillRect(x + w * 0.62, base - h * 0.62, 2.2, 3);
  }
}

// A bamboo cane: stacked segments, with a few leaves near the top.
function bamboo(g, rnd, x, base, height, lean, fill, edge) {
  let y = base;
  let cx = x;
  const wd = 3.4;
  while (y > base - height) {
    const seg = 20 + rnd() * 14;
    g.fillStyle = fill;
    g.fillRect(cx - wd / 2, y - seg + 1, wd, seg - 1);
    g.fillRect(cx - wd / 2 - 0.6, y - seg, wd + 1.2, 1.2);
    g.fillStyle = edge;
    g.fillRect(cx + (lean > 0 ? wd / 2 - 0.7 : -wd / 2), y - seg + 1, 0.7, seg - 1);
    if (y < base - height * 0.45 && rnd() < 0.75) {
      // leaves: thin blades, pointing down and away
      const s = rnd() < 0.5 ? -1 : 1;
      g.fillStyle = fill;
      for (let k = 0; k < 3; k++) {
        g.save();
        g.translate(cx + s * wd * 0.5, y - seg + 2);
        g.rotate(s * (0.35 + k * 0.34));
        g.fillRect(0, -1, s * (13 + rnd() * 9), 2.2);
        g.restore();
      }
    }
    y -= seg;
    cx += lean * seg * 0.02;
  }
}

function backdrop(g, rnd, stars) {
  let grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#000000');
  grad.addColorStop(0.45, '#020203');
  grad.addColorStop(0.8, '#08080b');
  grad.addColorStop(1, '#0f0f13');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const [mx, my, mr] = MOON;
  const clouds = [[mx - 118, my + 26, 150], [mx + 6, my - 30, 128], ...CLOUDS];
  // stars: small squares. The bright ones in open sky are remembered, so they can twinkle.
  const open = (x, y) => y < 200 && x > 100 && x < 700 && Math.hypot(x - mx, y - my) > mr + 12 && !clouds.some(([cx, cy, cw]) => x > cx - 4 && x < cx + cw + 4 && y > cy - CELL - 4 && y < cy + CELL * 2 + 4);
  for (let i = 0; i < 180; i++) {
    const x = Math.round(rnd() * W);
    const y = Math.round(rnd() ** 1.35 * 350);
    const big = i < 44;
    const s = big ? 1.5 : 0.8 + rnd() * 0.4;
    g.fillStyle = `rgba(255,255,255,${(big ? 0.5 : 0.18) + rnd() * 0.4})`;
    g.fillRect(x, y, s, s);
    if (big && open(x, y)) stars.push({ x, y, s });
  }

  // the moon: a soft halo, then a disc stacked from rows of blocks
  grad = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.6);
  grad.addColorStop(0, 'rgba(214,218,240,.2)');
  grad.addColorStop(0.3, 'rgba(214,218,240,.07)');
  grad.addColorStop(1, 'rgba(214,218,240,0)');
  g.fillStyle = grad;
  g.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  const half = (dy) => snap(Math.sqrt(Math.max(0, mr * mr - dy * dy)), CELL);
  // (the whole disc as one shape first, then everything on it clipped to that: no seams between the rows)
  g.save();
  g.beginPath();
  for (let dy = -mr; dy < mr; dy += CELL) {
    const h = half(dy + CELL / 2);
    if (h > 0) g.rect(mx - h, my + dy, h * 2, CELL);
  }
  g.fillStyle = '#d8d8dd';
  g.fill();
  g.clip();
  for (let dy = -mr; dy < mr; dy += CELL) {
    const h = half(dy + CELL / 2);
    if (h <= 0) continue;
    // lit from above: each row a shade darker than the one over it
    const k = (dy + mr) / (2 * mr);
    const v = Math.round(238 - k * 44);
    g.fillStyle = `rgb(${v},${v},${v + 5})`;
    g.fillRect(mx - h, my + dy, h * 2, CELL * 2);
    // and the right-hand rim in shade
    const v2 = Math.round(v * 0.8);
    g.fillStyle = `rgb(${v2},${v2},${v2 + 5})`;
    g.fillRect(mx + h - CELL * 2, my + dy, CELL * 2, CELL * 2);
  }
  // seas: clusters of darker blocks
  g.fillStyle = 'rgba(60,62,84,.2)';
  for (const [sx, sy, sw, sh] of [[-40, -36, 28, 16], [-32, -20, 16, 12], [-48, -24, 12, 12], [4, -48, 20, 12], [12, -36, 28, 20], [20, -16, 12, 8], [-20, 12, 36, 20], [-28, 32, 20, 12], [24, 20, 16, 16], [-52, 8, 12, 8], [4, 44, 12, 8]]) g.fillRect(mx + sx, my + sy, sw, sh);
  g.fillStyle = 'rgba(60,62,84,.16)';
  for (const [sx, sy, sw, sh] of [[-36, -32, 16, 8], [16, -32, 16, 12], [-12, 16, 20, 12]]) g.fillRect(mx + sx, my + sy, sw, sh);
  g.restore();

  // clouds: bars of night across the sky, two of them across the moon
  cloudBar(g, mx - 118, my + 26, 150, CELL, '#040405', '#24242b');
  cloudBar(g, mx + 6, my - 30, 128, CELL, '#040405', '#24242b');
  for (const [x, y, w] of CLOUDS) cloudBar(g, x, y, w, CELL, '#070709', '#121216');

  const mist = (y, hgt, a) => {
    const m = g.createLinearGradient(0, y - hgt, 0, y + hgt);
    m.addColorStop(0, 'rgba(170,176,200,0)');
    m.addColorStop(0.5, `rgba(170,176,200,${a})`);
    m.addColorStop(1, 'rgba(170,176,200,0)');
    g.fillStyle = m;
    g.fillRect(0, y - hgt, W, hgt * 2);
  };

  // far hills, with a keep on one of them
  hills(g, 420, 150, 16, 8, 11, '#0b0b0e', '#1d1d23');
  pagoda(g, 148, 352, 3, 40, '#0b0b0e', '#1d1d23', false);
  mist(400, 70, 0.06);
  // nearer hills and the towers of the town
  hills(g, 452, 96, 12, 6, 29, '#070709', '#19191f');
  pagoda(g, 646, 430, 5, 58, '#050506', '#1b1b21', true);
  pagoda(g, 330, 436, 4, 44, '#050506', '#1b1b21', true);
  pagoda(g, 30, 440, 3, 50, '#050506', '#1b1b21', true);
  mist(440, 46, 0.055);
  // rooftops, just behind the wall the match is played on
  for (let x = -30; x < W + 20; ) {
    const w = 46 + rnd() * 52;
    house(g, x, 452, w, 16 + rnd() * 30, '#030304', '#17171c', rnd() < 0.7);
    x += w + 10 + rnd() * 16;
  }
  mist(478, 44, 0.05);
  // bamboo leaning in from both sides
  for (let i = 0; i < 9; i++) {
    const left = i % 2 === 0;
    const x = left ? 6 + rnd() * 84 : W - 6 - rnd() * 84;
    bamboo(g, rnd, x, H + 10, 300 + rnd() * 190, left ? 1 : -1, '#020203', '#1a1a20');
  }
}

// ---------------------------------------------------------------------------
// platforms (world coordinates, painted once)
// ---------------------------------------------------------------------------

// The parts of a solid block's top (or bottom) edge that no other block is stacked on.
function openSpans(p, arena, top) {
  let spans = [[p.x, p.x + p.w]];
  const y = top ? p.y : p.y + p.h;
  for (const o of arena.platforms) {
    if (!o.ground || Math.abs((top ? o.y + o.h : o.y) - y) > 1) continue;
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

// A solid block of dressed stone, any height: moonlit near an open top, black further down.
function block(g, p, arena) {
  const { x, y, w, h } = p;
  const open = openSpans(p, arena, true);
  g.fillStyle = COAL;
  g.fillRect(x, y, w, h);
  const depth = Math.min(h, 130);
  const lit = g.createLinearGradient(0, y, 0, y + depth);
  lit.addColorStop(0, '#2e2e37');
  lit.addColorStop(0.45, 'rgba(46,46,55,.4)');
  lit.addColorStop(1, 'rgba(46,46,55,0)');
  g.fillStyle = lit;
  for (const [a, b] of open) g.fillRect(a, y, b - a, depth);

  // courses of big stones, on a lattice shared by every block so neighbours line up
  const y1 = y + h;
  g.fillStyle = 'rgba(0,0,0,.5)';
  for (let n = Math.floor(y / 20); n * 20 < y1; n++) {
    const cy = n * 20;
    if (cy > y + 5) g.fillRect(x, cy - 0.6, w, 1.2);
    const ya = Math.max(y + 3, cy);
    const yb = Math.min(y1, cy + 20);
    if (yb <= ya) continue;
    for (let jx = Math.floor(x / 40) * 40 + (n & 1 ? 20 : 0); jx < x + w - 2; jx += 40) if (jx > x + 2) g.fillRect(jx - 0.6, ya, 1.2, yb - ya);
  }

  // the sides and the underside in iron; the top - the part you stand on - in white
  g.fillStyle = IRON;
  g.fillRect(x, y, 1.4, h);
  g.fillRect(x + w - 1.4, y, 1.4, h);
  for (const [a, b] of openSpans(p, arena, false)) g.fillRect(a, y1 - 1.4, b - a, 1.4);
  for (const [a, b] of open) {
    g.fillStyle = '#000000';
    g.fillRect(a, y + 3, b - a, 1.2);
    g.fillStyle = WHITE;
    g.fillRect(a, y, b - a, 3);
  }
}

// A thin roof-edge that follows a line of points, left to right: a ledge is two
// points; a slope adds a short flat lip wherever an end hangs loose. Its sides
// point straight down, and a row of square tile-ends runs along under the edge.
function slab(g, pts, capA = true, capB = true) {
  const end = pts.length - 1;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[end];
  const trace = (dy, back) => {
    if (back) for (let i = end; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1] + dy);
    else pts.forEach(([px, py], i) => (i ? g.lineTo(px, py + dy) : g.moveTo(px, py + dy)));
  };
  const yAt = (x) => {
    for (let i = 0; i < end; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return by;
  };
  g.lineJoin = 'miter';
  g.lineCap = 'butt';
  g.beginPath();
  trace(0);
  trace(SLAB, true);
  g.closePath();
  g.fillStyle = COAL;
  g.fill();
  g.beginPath();
  trace(0);
  trace(8, true);
  g.closePath();
  g.fillStyle = ASH;
  g.fill();
  g.fillStyle = IRON;
  for (let tx = Math.ceil((ax + 4) / 10) * 10; tx < bx - 7; tx += 10) g.fillRect(tx, yAt(tx + 2) + 6.4, 4, 4);
  g.strokeStyle = IRON;
  g.lineWidth = 1.4;
  g.beginPath();
  trace(SLAB - 0.7);
  g.stroke();
  g.strokeStyle = WHITE;
  g.lineWidth = 3;
  g.beginPath();
  trace(1.5);
  g.stroke();
  // a loose end is capped by a short white bracket (an end that runs into something else is left open)
  if (capA) {
    g.fillStyle = WHITE;
    g.fillRect(ax, ay, 2.6, 8);
    g.fillStyle = IRON;
    g.fillRect(ax, ay + 8, 1.4, SLAB - 8);
  }
  if (capB) {
    g.fillStyle = WHITE;
    g.fillRect(bx - 2.6, by, 2.6, 8);
    g.fillStyle = IRON;
    g.fillRect(bx - 1.4, by + 8, 1.4, SLAB - 8);
  }
}

// Does a slope start or stop at this point (the end of a ledge)?
const slopeAt = (arena, x, y) => arena.ramps.some((r) => (Math.abs(r.x0 - x) < 24 && Math.abs(r.y0 - y) < 2) || (Math.abs(r.x1 - x) < 24 && Math.abs(r.y1 - y) < 2));
// Is this point on the side of a solid block?
const wallAt = (arena, x, y) => arena.platforms.some((p) => p.ground && (Math.abs(p.x - x) < 2 || Math.abs(p.x + p.w - x) < 2) && y > p.y - 1 && y < p.y + p.h);

// ---------------------------------------------------------------------------
// The things every style shares - thorns, the arrows on launchers, the badge on
// portals you can let go of - are painted by the renderer in its own colours,
// after decor(). Here they are painted again in steel, a little larger, so the
// originals are covered. (Same shapes as renderer.paintExtras: keep in step.)
// ---------------------------------------------------------------------------
function dropBadge(g, x, y) {
  g.fillStyle = WHITE;
  g.fillRect(x - 11, y - 11, 22, 22);
  g.fillStyle = '#000000';
  g.fillRect(x - 8.8, y - 8.8, 17.6, 17.6);
  g.fillStyle = WHITE;
  g.fillRect(x - 1.3, y - 6, 2.6, 8);
  g.fillRect(x - 5.2, y - 0.4, 10.4, 2.6);
  g.fillRect(x - 3.2, y + 2.2, 6.4, 2.4);
  g.fillRect(x - 1.3, y + 4.6, 2.6, 2);
}

function steelExtras(g, arena) {
  for (const z of arena.spikes) {
    const n = Math.max(2, Math.round(z.w / 11));
    const w = z.w / n;
    const base = z.y + z.h;
    const tip = z.y - 7;
    g.fillStyle = '#000000';
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const mx = z.x + (i + 0.5) * w;
      g.moveTo(mx - w / 2 - 3.2, base);
      g.lineTo(mx, tip - 5);
      g.lineTo(mx + w / 2 + 3.2, base);
    }
    g.fill();
    // blades: the left face catches the moon, the right is in shade
    for (const [color, side] of [[WHITE, -1], [STEEL, 1]]) {
      g.fillStyle = color;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const mx = z.x + (i + 0.5) * w;
        g.moveTo(mx + side * (w / 2 + 1.5), base);
        g.lineTo(mx, tip);
        g.lineTo(mx - side * 0.4, base);
      }
      g.fill();
    }
    g.fillStyle = WHITE;
    g.fillRect(z.x - 1.6, base, z.w + 3.2, 1);
  }
  g.lineJoin = 'miter';
  g.lineCap = 'square';
  for (const t of arena.tramps) {
    if (!t.vx) continue;
    g.save();
    g.translate(t.cx, t.y - 20);
    g.rotate(Math.atan2(-t.vy, t.vx));
    for (const [color, lw] of [['#000000', 8], [WHITE, 4]]) {
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.beginPath();
      for (const x of [-7, 4]) {
        g.moveTo(x - 6, -8);
        g.lineTo(x + 2, 0);
        g.lineTo(x - 6, 8);
      }
      g.stroke();
    }
    g.restore();
  }
  for (const po of arena.portals) if (po.drop) dropBadge(g, po.cx + 22, po.y + 4);
}

// Everything in the arena as boxes [x0, y0, x1, y1] (a star behind one of them must not twinkle).
function boxes(arena) {
  const out = [];
  for (const p of arena.platforms) out.push([p.x - 6, p.y - 6, p.x + p.w + 6, p.y + p.h + 6]);
  for (const r of arena.ramps) out.push([r.x0 - LIP - 6, Math.min(r.y0, r.y1) - 6, r.x1 + LIP + 6, Math.max(r.y0, r.y1) + SLAB + 6]);
  for (const po of arena.portals) out.push([po.cx - 46, po.cy - 56, po.cx + 46, po.cy + 56]);
  for (const tr of arena.tramps) out.push([tr.x - 10, tr.y - 44, tr.x + tr.w + 10, tr.y + tr.h]);
  for (const z of arena.spikes) out.push([z.x - 6, z.y - 16, z.x + z.w + 6, z.y + z.h]);
  return out;
}

// a "?" out of blocks, for the lucky box
const QUERY = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];

export default {
  id: 'shadow',
  colors: COLORS,
  letterbox: '#000000',
  lift: '#d5d8e2',
  label: {
    font: '600 14px Rajdhani, sans-serif',
    color: '#c9cad2',
    stroke: 'rgba(0,0,0,.92)',
    strokeWidth: 4,
    you: '#ffffff',
    gap: 8,
  },

  build(env) {
    const { rnd, layer, sprite, arena } = env;
    const stars = [];
    const bg = layer((g) => backdrop(g, rnd, stars));
    const shade = layer((g) => {
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, H * 1.02);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,.6)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }, 0.5);
    // the red that hangs about whoever is it: baked once, stamped every frame
    const aura = sprite(96, 96, (g) => {
      const rg = g.createRadialGradient(48, 48, 6, 48, 48, 48);
      rg.addColorStop(0, rgba(ONI, 0.55));
      rg.addColorStop(0.5, rgba(ONI, 0.2));
      rg.addColorStop(1, rgba(ONI, 0));
      g.fillStyle = rg;
      g.fillRect(0, 0, 96, 96);
    });
    // ash on the night air
    const motes = [];
    for (let i = 0; i < 20; i++) motes.push({ x: rnd() * W, y: rnd() * H, vy: 5 + rnd() * 9, vx: -(3 + rnd() * 8), amp: 4 + rnd() * 9, f: 0.4 + rnd() * 0.8, ph: rnd() * 6.283, s: 0.7 + rnd() * 0.7, c: `rgba(255,255,255,${(0.22 + rnd() * 0.4).toFixed(2)})` });
    return { bg, shade, aura, motes, stars, twinkle: [], arena, art: null, world: null, wm: null };
  },

  back(g, sc) {
    sc.art = g.getTransform(); // remembered so decor() can work out where the world sits on the art board
    g.drawImage(sc.bg, 0, 0, W, H);
  },

  platform(g, p, i, rnd, arena) {
    if (p.ground) block(g, p, arena);
    else slab(g, [[p.x, p.y], [p.x + p.w, p.y]], !slopeAt(arena, p.x, p.y), !slopeAt(arena, p.x + p.w, p.y));
  },

  // A slope is a tilted roof-edge that keeps its sides pointing straight down.
  ramp(g, r, i, rnd, arena) {
    const pts = [[r.x0, r.y0], [r.x1, r.y1]];
    const looseA = !meets(arena, r.x0 - LIP, r.x0, r.y0);
    const looseB = !meets(arena, r.x1, r.x1 + LIP, r.y1);
    if (looseA) pts.unshift([r.x0 - LIP, r.y0]);
    if (looseB) pts.push([r.x1 + LIP, r.y1]);
    // where the low end lands on a solid block, the slab runs into it instead of sinking in
    const [lx, ly] = r.y0 > r.y1 ? [r.x0, r.y0] : [r.x1, r.y1];
    const floor = arena.platforms.find((p) => p.ground && Math.abs(p.y - ly) < 1 && p.x <= lx && p.x + p.w >= lx);
    if (floor) {
      g.beginPath();
      g.rect(r.x0 - 80, floor.y - 4000, r.x1 - r.x0 + 160, 4000);
      g.clip();
    }
    slab(g, pts, looseA && !wallAt(arena, r.x0 - LIP, r.y0 + 4), looseB && !wallAt(arena, r.x1 + LIP, r.y1 + 4));
  },

  // Vents under the updrafts. Also remembers where the world sits, for front() and live().
  decor(g, sc, arena) {
    const m = g.getTransform();
    sc.wm = m;
    // world (x, y) sits at art-board (wx + x * k, wy + y * k)
    const k = m.a / sc.art.a;
    const wx = (m.e - sc.art.e) / sc.art.a;
    const wy = (m.f - sc.art.f) / sc.art.d;
    sc.world = { k, x: wx, y: wy };
    // twinkling stars are drawn on top of the picture, so only those nothing stands in front of
    const solid = boxes(arena);
    sc.twinkle = sc.stars.filter((st) => {
      const x = (st.x - wx) / k;
      const y = (st.y - wy) / k;
      return !solid.some((b) => x > b[0] && x < b[2] && y > b[1] && y < b[3]) && !arena.lifts.some((z) => x > z.x - 6 && x < z.x + z.w + 6 && y > z.y && y < z.y + z.h);
    });

    for (const z of arena.lifts) {
      const by = z.y + z.h;
      const cx = z.x + z.w / 2;
      // chevrons up the column, so it reads as "up" in a still picture too
      g.fillStyle = 'rgba(255,255,255,.14)';
      for (let y = by - 62; y > z.y + 26; y -= 72) {
        for (let s = 0; s < 5; s++) {
          g.fillRect(cx - 3 - s * 3, y + s * 3, 3, 5);
          g.fillRect(cx + s * 3, y + s * 3, 3, 5);
        }
      }
      // the vent: a black grate with a white lip
      g.fillStyle = '#000000';
      g.fillRect(z.x - 3, by - 9, z.w + 6, 9);
      g.fillStyle = IRON;
      for (let x = z.x + 4; x < z.x + z.w - 6; x += 9) g.fillRect(x, by - 5, 5, 2.2);
      g.fillStyle = WHITE;
      g.fillRect(z.x - 3, by - 10.5, z.w + 6, 2.4);
    }
  },

  // static: the shared extras again in steel, then darkness towards the corners
  front(g, sc) {
    if (sc.wm) {
      g.save();
      g.setTransform(sc.wm);
      steelExtras(g, sc.arena);
      g.restore();
    }
    g.drawImage(sc.shade, 0, 0, W, H);
  },

  // every frame: a few stars twinkle, ash drifts down, and (team battles) the flags get a steel pole
  live(g, sc, t, view) {
    const tw = sc.twinkle;
    for (let i = 0; i < tw.length; i++) {
      const st = tw[i];
      const a = Math.sin(t * (0.9 + (i % 5) * 0.23) + i * 2.4);
      if (a < 0.2) continue;
      g.fillStyle = a > 0.8 ? '#ffffff' : 'rgba(255,255,255,.55)';
      g.fillRect(st.x - 0.3, st.y - 0.3, st.s + 0.6, st.s + 0.6);
      if (a > 0.86) {
        g.fillRect(st.x - 1.6, st.y + st.s / 2 - 0.3, st.s + 3.2, 0.6);
        g.fillRect(st.x + st.s / 2 - 0.3, st.y - 1.6, 0.6, st.s + 3.2);
      }
    }
    for (let i = 0; i < sc.motes.length; i++) {
      const p = sc.motes[i];
      const y = ((p.y + t * p.vy) % (H + 20)) - 10;
      const x = ((((p.x + t * p.vx + Math.sin(t * p.f + p.ph) * p.amp) % (W + 20)) + W + 20) % (W + 20)) - 10;
      g.fillStyle = p.c;
      g.fillRect(x, y, p.s, p.s);
    }
    const w = sc.world;
    if (view && view.team && view.team.flags && w) {
      // The renderer draws the flags itself (a dark pole, a dark strip along the
      // ground) - invisible on this night. A white frame behind each makes them steel.
      g.translate(w.x, w.y);
      g.scale(w.k, w.k);
      for (const f of view.team.flags) {
        g.fillStyle = WHITE;
        g.fillRect(f.x - 3.6, f.y - 81, 7.2, 75);
        g.fillRect(f.x - 5.5, f.y - 84, 11, 4);
        g.fillRect(f.x - FLAG_HALF - 1.6, f.y - 8.8, FLAG_HALF * 2 + 3.2, 8.8);
        g.fillStyle = '#000000';
        g.fillRect(f.x - FLAG_HALF, f.y - 7.2, FLAG_HALF * 2, 7.2);
      }
    }
  },

  // a spring-board: a white plate on a coil
  trampoline(g, tr, t, k) {
    const x = tr.x;
    const w = tr.w;
    const base = tr.y + tr.h;
    const top = tr.y - 3 + k * 8;
    // the coil
    g.fillStyle = '#000000';
    g.fillRect(x + 5, top + 4, w - 10, base - top - 4);
    g.fillStyle = STEEL;
    const gap = (base - 5 - (top + 6)) / 3;
    for (let i = 0; i < 3; i++) g.fillRect(x + 7.5, top + 6.5 + i * gap, w - 15, Math.max(1, gap * 0.45));
    // its foot
    g.fillStyle = '#000000';
    g.fillRect(x, base - 5.5, w, 5.5);
    g.fillStyle = IRON;
    g.fillRect(x + 1.4, base - 4.1, w - 2.8, 2.7);
    // the plate, cut into segments
    g.fillStyle = '#000000';
    g.fillRect(x - 3.5, top - 1.4, w + 7, 7.8);
    g.fillStyle = WHITE;
    g.fillRect(x - 2.1, top, w + 4.2, 5);
    g.fillStyle = STEEL;
    g.fillRect(x - 2.1, top + 3.5, w + 4.2, 1.5);
    g.fillStyle = '#000000';
    const n = Math.max(2, Math.round(w / 11));
    for (let i = 1; i < n; i++) g.fillRect(x - 2.1 + ((w + 4.2) * i) / n - 0.7, top, 1.4, 5);
    if (k > 0.05) {
      g.fillStyle = `rgba(255,255,255,${Math.min(1, k).toFixed(2)})`;
      for (let i = 0; i < 3; i++) g.fillRect(x + w * (0.25 + 0.25 * i) - 1.2, top - 8 - k * 12 - (i === 1 ? 4 : 0), 2.4, 5 + k * 6);
    }
  },

  // a torii: step through the gate and you are somewhere else. The light between
  // the posts and the plaque on the beam are in the pair's colour.
  portal(g, po) {
    const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
    const { cx, cy } = po;
    const base = cy + 38;
    const rg = g.createRadialGradient(cx, cy + 8, 4, cx, cy + 8, 46);
    rg.addColorStop(0, rgba(col, 0.42));
    rg.addColorStop(1, rgba(col, 0));
    g.fillStyle = rg;
    g.fillRect(cx - 46, cy - 56, 92, 112);
    // the veil between the posts
    g.fillStyle = '#000000';
    g.fillRect(cx - 16, cy - 22, 32, 60);
    const veil = g.createLinearGradient(0, cy - 22, 0, base);
    veil.addColorStop(0, rgba(col, 0.2));
    veil.addColorStop(1, rgba(col, 0.8));
    g.fillStyle = veil;
    g.fillRect(cx - 16, cy - 22, 32, 60);
    // squares falling away into it
    g.lineJoin = 'miter';
    for (let k = 0; k < 4; k++) {
      const inx = 3.5 + k * 3.3;
      const iny = 5 + k * 6.2;
      g.strokeStyle = k === 3 ? '#ffffff' : rgba('#ffffff', 0.25 + k * 0.17);
      g.lineWidth = 1.5;
      g.strokeRect(cx - 16 + inx, cy - 22 + iny, 32 - inx * 2, 60 - iny * 2);
    }
    // the gate: black behind, then white steel
    const frame = (grow, a, b) => {
      g.fillStyle = a;
      for (const s of [-1, 1]) {
        g.fillRect(cx + s * 18.5 - 2.6 - grow, cy - 31 - grow, 5.2 + grow * 2, 69 + grow); // post
        g.fillRect(cx + s * 18.5 - 4.6 - grow, base - 4.5 - grow, 9.2 + grow * 2, 4.5 + grow); // its foot
        g.fillRect(cx + s * 31 - 3.5 - grow, cy - 45 - grow, 7 + grow * 2, 5 + grow * 2); // upturned end of the top beam
      }
      g.fillRect(cx - 31 - grow, cy - 41.5 - grow, 62 + grow * 2, 6 + grow * 2); // top beam
      g.fillRect(cx - 25.5 - grow, cy - 26 - grow, 51 + grow * 2, 4 + grow * 2); // tie beam
      g.fillStyle = b;
      g.fillRect(cx - 27 - grow, cy - 35.5 - grow, 54 + grow * 2, 3 + grow * 2); // under the top beam
    };
    frame(1.5, '#000000', '#000000');
    frame(0, WHITE, STEEL);
    g.fillStyle = STEEL;
    for (const s of [-1, 1]) g.fillRect(cx + s * 18.5 + 0.8, cy - 22, 1.8, 55.5);
    // the plaque
    g.fillStyle = '#000000';
    g.fillRect(cx - 5, cy - 34, 10, 9.5);
    g.fillStyle = col;
    g.fillRect(cx - 3.5, cy - 32.5, 7, 6.5);
    if (po.drop) dropBadge(g, cx + 22, cy - 34);
  },

  // a lucky box: a steel-bound crate with a question on it
  pickup(g, kind, x, y) {
    const rg = g.createRadialGradient(x, y, 6, x, y, 33);
    rg.addColorStop(0, 'rgba(255,255,255,.4)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(x - 34, y - 34, 68, 68);
    g.fillStyle = '#000000';
    g.fillRect(x - 17.5, y - 17.5, 35, 35);
    g.fillStyle = WHITE;
    g.fillRect(x - 16, y - 16, 32, 32);
    g.fillStyle = BODY;
    g.fillRect(x - 13, y - 13, 26, 26);
    g.fillStyle = STEEL;
    g.fillRect(x - 16, y + 13, 32, 3);
    // studs in the corners
    g.fillStyle = '#000000';
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.fillRect(x + sx * 14.5 - 0.9, y + sy * 14.5 - 0.9, 1.8, 1.8);
    g.fillStyle = WHITE;
    const u = 2.6;
    QUERY.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === '#') g.fillRect(x - u * 2.5 + c * u, y - u * 3.5 + r * u, u + 0.05, u + 0.05);
    });
  },

  // A block and nothing else: a ninja's hooded head, as wide as it is tall, with no
  // body under it. On the ground it glides - no steps, a lean into the run and a
  // wake of little squares; in the air it turns over and over, and comes down flat.
  player(g, pv, t, sc) {
    const { cx, feet, color } = pv;
    const f = pv.face;
    const oni = pv.isIt;
    const speed = Math.abs(pv.vx);
    const rim = oni ? ONI : WHITE;
    const top = feet - BLOCK;
    const my = feet - BLOCK / 2;
    const ang = turnOf(sc, pv, t);
    // (sad: the block bows its head - tips forward on its leading edge)
    const lean = pv.sad ? f * 0.13 : pv.ground ? clamp(pv.vx / 350, -1, 1) * (pv.dashing ? 0.26 : 0.1) : 0;

    if (oni) {
      // red hangs in the air around whoever is it
      const a = g.globalAlpha;
      g.globalAlpha = a * (0.8 + 0.2 * Math.sin(t * 8));
      g.drawImage(sc.aura, cx - 48, my - 48, 96, 96);
      g.globalAlpha = a;
    }

    // The ribbons of the headband: two chains of squares from the knot (which turns
    // with the block), streaming out behind - the way we came, whichever way up we are.
    const kdx = -f * (BLOCK / 2 + 2.5);
    const kdy = -BLOCK / 2 + 7.5;
    const kx = cx + Math.cos(ang) * kdx - Math.sin(ang) * kdy;
    const ky = my + Math.sin(ang) * kdx + Math.cos(ang) * kdy;
    const back = pv.vx > 30 ? -1 : pv.vx < -30 ? 1 : -f;
    const flow = clamp(speed / 260, 0, 1);
    const lift = clamp(pv.vy / 900, -1, 1) * -9;
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass ? color : '#000000';
      const grow = pass ? 0 : 1.1;
      for (let j = 0; j < 2; j++) {
        for (let i = 1; i <= 6; i++) {
          const sz = 5.6 - i * 0.5 - j * 0.6 + grow * 2;
          const out = i * (2.6 + 1.7 * flow) + j * 1.2;
          const wave = Math.sin(t * 9 + pv.seed + i * 0.9 + j * 1.4) * (0.5 + i * 0.5 * (0.4 + flow));
          const hang = (1 - flow) * i * (2 + j * 0.9);
          g.fillRect(kx + back * out - sz / 2, ky + j * 2.4 + wave + hang + lift * (i / 6) - sz / 2, sz, sz);
        }
      }
    }

    squashAt(g, cx, feet, pv.squash);
    if (lean) {
      // (about the edge it slides on)
      g.translate(cx, feet);
      g.rotate(lean);
      g.translate(-cx, -feet);
    }
    if (ang) {
      g.translate(cx, my);
      g.rotate(ang);
      g.translate(-cx, -my);
    }
    // a rect given from the middle of the block towards the front (mirrored when facing left)
    const R = (dx, y, w, h) => g.fillRect(f > 0 ? cx + dx : cx - dx - w, y, w, h);
    const h2 = BLOCK / 2;

    // the outline first (a little bigger, in white - red on the oni), then the black
    for (let pass = 0; pass < 2; pass++) {
      const o = pass ? 0 : 1.6;
      g.fillStyle = pass ? BODY : rim;
      R(-h2 - o, top - o, BLOCK + o * 2, BLOCK + o * 2);
      R(-h2 - 5 - o, top + 3.4 - o, 5.5 + o * 2, 8 + o * 2); // the knot at the back
      if (oni) {
        // horns
        R(-12 - o, top - 5.5 - o, 5 + o * 2, 7 + o * 2);
        R(-14 - o, top - 10 - o, 3.6 + o * 2, 5.5 + o * 2);
        R(7 - o, top - 5.5 - o, 5 + o * 2, 7 + o * 2);
        R(10.4 - o, top - 10 - o, 3.6 + o * 2, 5.5 + o * 2);
      }
    }
    // (a block, not a cut-out: light catches the top of it and the face it leads with)
    g.fillStyle = '#1d1d24';
    R(-h2, top, BLOCK, 2.2);
    R(h2 - 2.2, top, 2.2, BLOCK);
    if (oni) {
      g.fillStyle = WHITE;
      R(-12, top - 5.5, 5, 5);
      R(-14, top - 10, 3.6, 5.5);
      R(7, top - 5.5, 5, 5);
      R(10.4, top - 10, 3.6, 5.5);
    }

    // their colour: the headband with its knot, and a band along the foot of the block
    g.fillStyle = color;
    R(-h2, top + 5, BLOCK, 5);
    R(-h2 - 5, top + 3.4, 5.5, 8);
    R(-h2, feet - 6.6, BLOCK, 3.4);

    // the slit they see through
    const ey = top + 14.5;
    if (pv.sad) {
      // Lost: the slit sags at both ends, the eyes look at the ground, and what falls
      // from them is what everything here is made of - small squares of steel.
      g.fillStyle = WHITE;
      R(-6, ey, 19, 7);
      g.fillStyle = BODY;
      // (the lids, in steps: low at the outer ends, open in the middle)
      R(-6, ey, 3.2, 3.6);
      R(-2.8, ey, 3.2, 2.4);
      R(0.4, ey, 3.1, 1.2);
      R(3.5, ey, 3.1, 1.2);
      R(6.6, ey, 3.2, 2.4);
      R(9.8, ey, 3.2, 3.6);
      R(-0.6, ey + 3.4, 3.2, 3.6); // eyes, cast down
      R(7.4, ey + 3.4, 3.2, 3.6);
      // (a chain of squares from the outer corner of each eye, smaller as they fall)
      g.fillStyle = WHITE;
      R(-5.4, ey + 8.4, 2.6, 2.6);
      R(10.4, ey + 8.4, 2.6, 2.6);
      R(-5.1, ey + 12.2, 2, 2);
      g.fillStyle = STEEL;
      R(10.7, ey + 12.2, 2, 2);
      R(-4.9, ey + 15.4, 1.6, 1.6);
    } else if (pv.stunned) {
      g.fillStyle = STEEL;
      R(-6, ey, 19, 7);
      g.fillStyle = BODY;
      R(-2.5, ey + 1.6, 5, 1.6);
      R(5.5, ey + 3.6, 5, 1.6);
    } else if (pv.blink > 0.5 && !oni) {
      g.fillStyle = WHITE;
      R(-6, ey + 2.6, 19, 1.8);
    } else {
      g.fillStyle = oni ? ONI : WHITE;
      R(-6, ey, 19, 7);
      if (oni) {
        // a scowl: the brow comes down in the middle, and the eyes burn white
        g.fillStyle = BODY;
        R(-0.5, ey, 8, 2.6);
        g.fillStyle = '#ffffff';
        R(-3, ey + 3.2, 3.6, 2.6);
        R(6.4, ey + 3.2, 3.6, 2.6);
      } else {
        g.fillStyle = BODY;
        R(-0.6, ey + 1.4, 3.2, 4.4);
        R(7.4, ey + 1.4, 3.2, 4.4);
      }
    }
  },

  // the oni's tag: a red plate with horns, "IT" in white, and an arrow down to the head
  marker(g, cx, cy) {
    const y = cy - 3;
    const R = (dx, dy, w, h) => g.fillRect(cx + dx, y + dy, w, h);
    for (let pass = 0; pass < 2; pass++) {
      const o = pass ? 0 : 2;
      g.fillStyle = pass ? ONI : '#ffffff';
      R(-16 - o, -26 - o, 32 + o * 2, 22 + o * 2);
      R(-6 - o, -4, 12 + o * 2, 3 + o);
      R(-4 - o, -1, 8 + o * 2, 3 + o);
      R(-2 - o, 2, 4 + o * 2, 3 + o);
    }
    // horns
    g.fillStyle = '#ffffff';
    for (const s of [-1, 1]) {
      R(s * 13 - 3, -33, 6, 6);
      R(s * 16.5 - 2.5, -38, 5, 6);
    }
    // I
    R(-10.5, -22, 8, 3);
    R(-8, -22, 3, 14);
    R(-10.5, -11, 8, 3);
    // T
    R(0.5, -22, 10, 3);
    R(4, -22, 3, 14);
  },

  fx: {
    // dust kicked up in little blocks
    jump(R, pv) {
      for (let i = 0; i < 5; i++) R.emit({ x: pv.cx + (i - 2) * 5, y: pv.feet - 2, vx: (i - 2) * 36 + (Math.random() - 0.5) * 20, vy: -20 - Math.random() * 50, g: 260, life: 0.34, size: 2.5 + Math.random() * 2.5, shape: 'square', rot: Math.random() * 3, vr: 5, color: i % 2 ? '#ffffff' : '#8b8c97', back: true });
    },
    land(R, pv, impact) {
      for (let i = 0; i < 5 + impact * 5; i++) {
        const d = i % 2 ? 1 : -1;
        R.emit({ x: pv.cx + d * 8, y: pv.feet - 2, vx: d * (40 + Math.random() * 130 * (0.5 + impact)), vy: -30 - Math.random() * 70, g: 500, life: 0.36, size: 2.5 + Math.random() * 3, shape: 'square', rot: Math.random() * 3, vr: d * 6, color: i % 3 ? '#8b8c97' : '#ffffff' });
      }
    },
    // (no footsteps: a block glides - see trail)
    // A wake of little squares behind a block that is gliding, a few in its own colour;
    // a thinner one behind a block turning through the air. And embers drift up off the oni.
    trail(R, pv, dt) {
      const speed = Math.abs(pv.vx);
      if (speed > 110) {
        const dir = pv.vx > 0 ? 1 : -1;
        if (pv.ground) {
          if (Math.random() < dt * 30 * Math.min(1, speed / 350)) R.emit({ x: pv.cx - dir * 19, y: pv.feet - 3 - Math.random() * 7, vx: -dir * (20 + Math.random() * 50), vy: -6 - Math.random() * 22, life: 0.32, size: 3 + Math.random() * 3, grow: -8, shape: 'square', color: Math.random() < 0.35 ? pv.color : '#ffffff', alpha: 0.75, back: true });
        } else if (Math.random() < dt * 12) R.emit({ x: pv.cx - dir * 12 + (Math.random() - 0.5) * 12, y: pv.feet - 20 + (Math.random() - 0.5) * 18, vx: -pv.vx * 0.12, vy: -pv.vy * 0.08, life: 0.3, size: 3.5, grow: -9, shape: 'square', rot: Math.random() * 3, vr: 4, color: Math.random() < 0.5 ? pv.color : '#ffffff', alpha: 0.6, back: true });
      }
      if (pv.isIt && Math.random() < dt * 7) R.emit({ x: pv.cx + (Math.random() - 0.5) * 26, y: pv.y + 10 + Math.random() * 28, vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 40, life: 0.6, size: 2 + Math.random() * 2, shape: 'square', rot: Math.random() * 3, vr: 3, color: ONI, back: true });
    },
    // out of a puff of smoke
    respawn(R, pv) {
      R.emit({ x: pv.cx, y: pv.y + 20, life: 0.4, size: 8, grow: 110, shape: 'ring', width: 3, color: '#ffffff' });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * 6.283;
        R.emit({ x: pv.cx + Math.cos(a) * 8, y: pv.y + 20 + Math.sin(a) * 10, vx: Math.cos(a) * 70, vy: Math.sin(a) * 60 - 30, drag: 3, life: 0.55 + Math.random() * 0.25, size: 7 + Math.random() * 5, grow: 14, alpha: 0.5, color: i % 2 ? '#8b8c97' : '#d5d6de' });
      }
    },
    // a tag is a cut: two strokes of a blade, and the pieces fly
    tag(R, to, from) {
      R.flash('#ffffff', 0.16);
      const x = to.cx;
      const y = to.y + 18;
      const tilt = (Math.random() - 0.5) * 0.5;
      R.emit({
        x,
        y,
        life: 0.42,
        fade: false,
        draw(g, p, k) {
          const a = 1 - k;
          const len = 26 + Math.min(1, a * 4) * 62;
          g.lineCap = 'butt';
          for (const [ang, col, lw] of [[-0.62 + tilt, '#ffffff', 7], [0.72 + tilt, ONI, 5]]) {
            const c = Math.cos(ang) * len;
            const s = Math.sin(ang) * len;
            g.globalAlpha = Math.min(1, k * 2.2);
            g.strokeStyle = col;
            g.lineWidth = Math.max(0.6, lw * k);
            g.beginPath();
            g.moveTo(p.x - c, p.y - s);
            g.lineTo(p.x + c, p.y + s);
            g.stroke();
          }
        },
      });
      const cols = ['#ffffff', '#8b8c97', ONI, from.color || '#ffffff'];
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * 6.283;
        const v = 110 + Math.random() * 360;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 70, g: 800, drag: 1.6, life: 0.45 + Math.random() * 0.4, size: 2.5 + Math.random() * 4, shape: 'square', rot: a, vr: (Math.random() - 0.5) * 16, color: cols[i % 4] });
      }
    },
  },
};
