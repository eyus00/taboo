// SKETCHBOOK - everything is a doodle on lined notebook paper: pencil outlines,
// felt-tip colour, lines that never quite meet. The page is drawn once. The
// characters, the springs and the few things that fly are redrawn with a new
// wobble several times a second, so they "boil" like a flip-book.

import { ART_W as W, ART_H as H, PW } from '/shared/config.js';
import { hash1, lighten, rgba, squashAt, drawIcon, KIND_COLORS, PORTAL_COLORS } from '../util.js';

const INK = '#2b2b30';
const PAPER = '#fbf7e9';
const CARD = '#fffdf5'; // a touch whiter than the page, so shapes lift off it
const RED = '#e23b3b';
const PEN = '#3a6fd8'; // ball-point blue
const GRAPHITE = 'rgba(70,70,85,.55)';
const LEVELS = ['#4a9be8', '#e2607a', '#58b368', '#9b6fd6']; // ledge colours, one per storey
const SLOPE = '#f29d38';
const THICK = 14; // how thick ledges and slopes are
const LIP = 16; // slopes carry on flat this far past each end
const BURST_W = 150; // the "TAG!" burst sprite
const BURST_H = 104;
const COLORS = ['#ee4b4b', '#3f8cf0', '#43b85c', '#f7c531', '#9b6fd6', '#f07ab0']; // red, blue, green, yellow, purple, pink
const BODY_W = 36; // a character's pre-drawn body: the 28 x 29 blob with room for its outline
const BODY_H = 37;
const BODY_PAD = 4;

// One hand-drawn stroke: never perfectly straight, never ending exactly on
// target. Long strokes wander a little instead of looking ruled.
function wline(g, rnd, x1, y1, x2, y2, amp = 1.4) {
  const j = () => (rnd() - 0.5) * amp * 2;
  const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 120));
  g.moveTo(x1 + j(), y1 + j());
  for (let i = 1; i <= n; i++) {
    const a = (i - 0.5) / n;
    const b = i / n;
    g.quadraticCurveTo(x1 + (x2 - x1) * a + j() * 1.5, y1 + (y2 - y1) * a + j() * 1.5, x1 + (x2 - x1) * b + j(), y1 + (y2 - y1) * b + j());
  }
}

function wcircle(g, rnd, cx, cy, r, amp = 1.2) {
  g.beginPath();
  const n = 14;
  const start = rnd() * 6.283;
  for (let i = 0; i <= n + 1; i++) {
    const a = start + (i / n) * 6.283;
    const rr2 = r + (rnd() - 0.5) * amp * 2;
    const x = cx + Math.cos(a) * rr2;
    const y = cy + Math.sin(a) * rr2;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

// Slanted pencil strokes across a box. The caller clips to the real shape.
function strokes(g, rnd, x, y, w, h, gap, color, width, slope = 1) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  for (let d = -h; d < w + h; d += gap * (0.75 + rnd() * 0.5)) wline(g, rnd, x + d, y + h + 2, x + d + h * slope, y - 2, 1.2);
  g.stroke();
}

function hatch(g, rnd, x, y, w, h, gap, color, width, slope) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  strokes(g, rnd, x, y, w, h, gap, color, width, slope);
  g.restore();
}

// Pencil outline along a list of [x1, y1, x2, y2] edges, gone over twice like
// a kid tracing their own lines.
function outline(g, rnd, edges) {
  g.strokeStyle = INK;
  g.lineCap = 'round';
  for (const [width, alpha, amp] of [
    [2.3, 1, 1.1],
    [1, 0.6, 2],
  ]) {
    g.lineWidth = width;
    g.globalAlpha = alpha;
    g.beginPath();
    for (const [x1, y1, x2, y2] of edges) wline(g, rnd, x1, y1, x2, y2, amp);
    g.stroke();
  }
  g.globalAlpha = 1;
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

// A thin ledge: a strip coloured in with a felt-tip.
function drawLedge(g, rnd, p, col) {
  const { x, y, w, h } = p;
  hatch(g, rnd, x + 5, y + 6, w, h, 5, 'rgba(40,40,60,.13)', 1.4, -1); // pencil shadow
  g.fillStyle = CARD;
  g.fillRect(x, y, w, h);
  g.fillStyle = rgba(col, 0.28);
  g.fillRect(x, y, w, h);
  hatch(g, rnd, x, y, w, h, 5.5, col, 1.8, 1);
  outline(g, rnd, [
    [x - 2, y, x + w + 2, y],
    [x + w, y - 2, x + w, y + h + 2],
    [x + w + 2, y + h, x - 2, y + h],
    [x, y + h + 2, x, y - 2],
  ]);
  // thick marker line on the surface you stand on
  g.lineWidth = 3.4;
  g.beginPath();
  wline(g, rnd, x - 1, y, x + w + 1, y, 0.7);
  g.stroke();
}

// A solid block of earth, any height: cross-hatched, a few pebbles, and crayon
// grass along whatever part of the top is open.
function drawBlock(g, rnd, p, arena) {
  const { x, y, w, h } = p;
  const near = (a, b) => Math.abs(a - b) < 1;
  const others = arena.platforms.filter((q) => q.ground && !(q.x === x && q.y === y));
  // edges that touch another block stay open, so stacked blocks read as one shape
  const top = gaps(x, x + w, others.filter((q) => near(q.y + q.h, y)).map((q) => [q.x, q.x + q.w]));
  const bottom = gaps(x, x + w, others.filter((q) => near(q.y, y + h)).map((q) => [q.x, q.x + q.w]));

  hatch(g, rnd, x + 5, y + 6, w, h, 5, 'rgba(40,40,60,.13)', 1.4, -1); // pencil shadow
  g.fillStyle = '#f5e8c9';
  g.fillRect(x, y, w, h);
  hatch(g, rnd, x, y, w, h, 11, 'rgba(160,110,60,.5)', 1.3, 1);
  hatch(g, rnd, x, y, w, h, 17, 'rgba(160,110,60,.32)', 1.2, -1);
  // pebbles, and the odd fossil in the deep parts
  g.lineWidth = 1.4;
  g.strokeStyle = 'rgba(120,80,40,.75)';
  for (let n = Math.floor((w * Math.min(h, 400)) / 16000); n > 0; n--) {
    const px = x + 14 + rnd() * (w - 28);
    const py = y + 26 + rnd() * (Math.min(h, 400) - 40);
    const r = 3.5 + rnd() * 4;
    if (py > y + h - 8) continue;
    if (rnd() < 0.2 && py > y + 60) {
      g.beginPath();
      for (let a = 0; a < 11; a += 0.4) {
        const sx = px + Math.cos(a) * a * 0.8;
        const sy = py + Math.sin(a) * a * 0.8;
        if (a === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
    } else {
      g.fillStyle = '#fbf1d8';
      g.beginPath();
      g.ellipse(px, py, r * 1.3, r, rnd() * 3, 0, 6.283);
      g.fill();
      g.stroke();
    }
  }
  // crayon grass
  for (const [a, b] of top) {
    g.fillStyle = '#8fd694';
    g.fillRect(a, y, b - a, 10);
    g.strokeStyle = '#3f9d4e';
    g.lineWidth = 1.7;
    g.lineCap = 'round';
    g.beginPath();
    for (let bx = a + 2; bx < b - 2; bx += 5 + rnd() * 3) {
      g.moveTo(bx, y + 10 + rnd() * 2);
      g.lineTo(bx + 2.5 + (rnd() - 0.5) * 3, y + 1 + rnd() * 3);
    }
    // a few tufts poking above the edge
    for (let bx = a + 8 + rnd() * 20; bx < b - 8; bx += 24 + rnd() * 40) {
      for (let k = -1; k <= 1; k++) {
        g.moveTo(bx, y + 1);
        g.lineTo(bx + k * 4 + (rnd() - 0.5) * 2, y - 6 - rnd() * 4);
      }
    }
    g.stroke();
  }
  outline(g, rnd, [
    ...top.map(([a, b]) => [a - 2, y, b + 2, y]),
    ...bottom.map(([a, b]) => [b + 2, y + h, a - 2, y + h]),
    [x + w, y - 2, x + w, y + h + 2],
    [x, y + h + 2, x, y - 2],
  ]);
  g.lineWidth = 3.4;
  g.beginPath();
  for (const [a, b] of top) wline(g, rnd, a - 1, y, b + 1, y, 0.7);
  g.stroke();
}

// A slope: a coloured-in strip like the ledges, but flat only for a short lip
// at each end - exactly the line the players ride.
function drawRamp(g, rnd, r, arena) {
  const solid = arena.platforms.filter((p) => p.ground);
  const rests = (x, y) => solid.some((p) => Math.abs(p.y - y) < 1 && x >= p.x && x <= p.x + p.w);
  // an end that sits on solid ground needs no lip
  const xa = rests(r.x0, r.y0) ? r.x0 : r.x0 - LIP;
  const xb = rests(r.x1, r.y1) ? r.x1 : r.x1 + LIP;
  const line = [
    [xa, r.y0],
    [r.x0, r.y0],
    [r.x1, r.y1],
    [xb, r.y1],
  ].filter(([px], i, all) => i === 0 || px > all[i - 1][0]);
  const shape = (dx, dy) => {
    g.beginPath();
    line.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
    for (let i = line.length - 1; i >= 0; i--) g.lineTo(line[i][0] + dx, line[i][1] + THICK + dy);
    g.closePath();
  };
  const x = xa;
  const y = Math.min(r.y0, r.y1);
  const w = xb - xa;
  const h = Math.abs(r.y1 - r.y0) + THICK;
  const lean = r.y1 < r.y0 ? 1 : -1; // the colouring-in leans uphill

  // never draw over solid ground: the slope stops at the grass
  g.beginPath();
  g.rect(-200, -200, arena.w + 400, arena.h + 400);
  for (const p of solid) g.rect(p.x, p.y, p.w, p.h);
  g.clip('evenodd');

  g.save();
  shape(5, 6);
  g.clip();
  strokes(g, rnd, x + 5, y + 6, w, h, 5, 'rgba(40,40,60,.13)', 1.4, -lean); // pencil shadow
  g.restore();
  shape(0, 0);
  g.fillStyle = CARD;
  g.fill();
  g.fillStyle = rgba(SLOPE, 0.3);
  g.fill();
  g.save();
  g.clip();
  strokes(g, rnd, x, y, w, h, 5.5, SLOPE, 1.8, lean);
  g.restore();

  const edges = [];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    edges.push([ax, ay, bx, by], [bx, by + THICK, ax, ay + THICK]);
  }
  edges.push([xa, r.y0 - 2, xa, r.y0 + THICK + 2], [xb, r.y1 - 2, xb, r.y1 + THICK + 2]);
  outline(g, rnd, edges);
  g.lineWidth = 3.4;
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 1; i < line.length; i++) wline(g, rnd, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1], 0.7);
  g.stroke();
}

// The notebook page and everything doodled on it.
function page(g, rnd) {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  // paper fibre
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(120,95,60,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1);
  }
  // coffee ring
  g.strokeStyle = 'rgba(140,90,40,.1)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(214, 404, 44, 0.4, 5.6);
  g.stroke();
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(214, 404, 49, 1, 5);
  g.stroke();
  // ruled lines + margin
  g.strokeStyle = 'rgba(86,140,220,.36)';
  g.lineWidth = 1;
  g.beginPath();
  for (let y = 36; y < H; y += 25) {
    g.moveTo(0, y + 0.5);
    g.lineTo(W, y + 0.5);
  }
  g.stroke();
  g.strokeStyle = 'rgba(226,80,80,.5)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(58.5, 0);
  g.lineTo(58.5, H);
  g.stroke();
  // punched holes
  for (const y of [88, 250, 412]) {
    g.fillStyle = '#d9d2bd';
    g.beginPath();
    g.arc(26, y, 9, 0, 6.283);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.22)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(26, y, 9, 2.6, 5.4);
    g.stroke();
  }

  g.strokeStyle = GRAPHITE;
  g.fillStyle = 'rgba(70,70,85,.6)';
  g.lineWidth = 1.5;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // sun with a face
  const sx = 704;
  const sy = 92;
  wcircle(g, rnd, sx, sy, 30);
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 6.283;
    wline(g, rnd, sx + Math.cos(a) * 38, sy + Math.sin(a) * 38, sx + Math.cos(a) * (50 + (i % 2) * 8), sy + Math.sin(a) * (50 + (i % 2) * 8), 1);
  }
  g.stroke();
  g.beginPath();
  g.arc(sx - 10, sy - 6, 2.2, 0, 6.283);
  g.arc(sx + 10, sy - 6, 2.2, 0, 6.283);
  g.fill();
  g.beginPath();
  g.arc(sx, sy + 3, 14, 0.25, Math.PI - 0.25);
  g.stroke();

  // clouds
  for (const [cx, cy, s] of [
    [150, 96, 1],
    [430, 62, 0.8],
    [560, 180, 0.65],
  ]) {
    g.beginPath();
    const bumps = [
      [-34, 6, 16],
      [-16, -8, 20],
      [10, -12, 22],
      [34, 2, 17],
    ];
    for (const [bx, by, br] of bumps) {
      g.moveTo(cx + (bx + br) * s, cy + by * s);
      g.arc(cx + bx * s, cy + by * s, br * s, 0, -Math.PI, true);
    }
    wline(g, rnd, cx - 50 * s, cy + 8 * s, cx + 52 * s, cy + 8 * s, 1);
    g.stroke();
  }

  // a kid's house and tree, way in the back
  g.globalAlpha = 0.75;
  const hx = 96;
  const hy = 470;
  g.beginPath();
  wline(g, rnd, hx, hy, hx, hy - 44);
  wline(g, rnd, hx, hy - 44, hx + 52, hy - 44);
  wline(g, rnd, hx + 52, hy - 44, hx + 52, hy);
  wline(g, rnd, hx - 8, hy - 42, hx + 26, hy - 76);
  wline(g, rnd, hx + 26, hy - 76, hx + 60, hy - 42);
  wline(g, rnd, hx + 20, hy, hx + 20, hy - 22);
  wline(g, rnd, hx + 20, hy - 22, hx + 34, hy - 22);
  wline(g, rnd, hx + 34, hy - 22, hx + 34, hy);
  g.stroke();
  g.strokeRect(hx + 6, hy - 38, 10, 10);
  const tx = 690;
  g.beginPath();
  wline(g, rnd, tx, 480, tx, 420);
  wline(g, rnd, tx + 8, 480, tx + 8, 420);
  g.stroke();
  for (let i = 0; i < 5; i++) wcircle(g, rnd, tx + 4 + (rnd() - 0.5) * 30, 400 + (rnd() - 0.5) * 26, 16 + rnd() * 8, 2);
  g.globalAlpha = 1;

  // margin notes
  g.save();
  g.font = '20px "Patrick Hand", cursive';
  g.fillStyle = 'rgba(70,70,85,.6)';
  g.translate(300, 268);
  g.rotate(-0.08);
  g.fillText('2 + 2 = 5 ?', 0, 0);
  g.restore();
  g.save();
  g.font = '22px "Patrick Hand", cursive';
  g.fillStyle = 'rgba(226,59,59,.55)';
  g.translate(478, 118);
  g.rotate(0.1);
  g.fillText("you're it!", 0, 0);
  g.restore();
  // tic-tac-toe
  const gx = 610;
  const gy = 296;
  g.beginPath();
  wline(g, rnd, gx + 14, gy, gx + 14, gy + 42);
  wline(g, rnd, gx + 28, gy, gx + 28, gy + 42);
  wline(g, rnd, gx, gy + 14, gx + 42, gy + 14);
  wline(g, rnd, gx, gy + 28, gx + 42, gy + 28);
  wline(g, rnd, gx + 2, gy + 2, gx + 12, gy + 12);
  wline(g, rnd, gx + 12, gy + 2, gx + 2, gy + 12);
  wline(g, rnd, gx + 30, gy + 30, gx + 40, gy + 40);
  wline(g, rnd, gx + 40, gy + 30, gx + 30, gy + 40);
  g.stroke();
  wcircle(g, rnd, gx + 21, gy + 21, 5, 0.8);
  wcircle(g, rnd, gx + 35, gy + 7, 5, 0.8);
  // star, heart, spiral
  g.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + i * ((Math.PI * 4) / 5);
    const x = 232 + Math.cos(a) * 16;
    const y = 150 + Math.sin(a) * 16;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.strokeStyle = 'rgba(226,59,59,.5)';
  g.beginPath();
  g.moveTo(404, 212);
  g.bezierCurveTo(388, 196, 390, 184, 404, 194);
  g.bezierCurveTo(418, 184, 420, 196, 404, 212);
  g.stroke();
  g.strokeStyle = 'rgba(47,111,222,.45)';
  g.beginPath();
  for (let a = 0; a < 16; a += 0.3) {
    const x = 120 + Math.cos(a) * a * 1.3;
    const y = 250 + Math.sin(a) * a * 1.3;
    if (a === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

// Comic "TAG!" burst, centred in a BURST_W x BURST_H box.
function burst(g, rnd) {
  g.translate(BURST_W / 2, BURST_H / 2);
  g.rotate(-0.12);
  g.beginPath();
  const n = 13;
  for (let i = 0; i < n * 2; i++) {
    const ang = (i / (n * 2)) * 6.283;
    const r = (i % 2 ? 26 : 44) + (rnd() - 0.5) * 8;
    const px = Math.cos(ang) * r * 1.25;
    const py = Math.sin(ang) * r * 0.85;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = '#ffe45e';
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 2.6;
  g.lineJoin = 'round';
  g.stroke();
  g.font = '26px "Permanent Marker", cursive';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = RED;
  g.fillText('TAG!', 0, 1);
}

// jittered rounded box used for the characters
function blobPath(g, x, y, w, h, r, j) {
  g.beginPath();
  g.moveTo(x + r + j(0), y + j(1));
  g.lineTo(x + w - r + j(2), y + j(3));
  g.quadraticCurveTo(x + w + j(4), y + j(5), x + w + j(6), y + r + j(7));
  g.lineTo(x + w + j(8), y + h - r + j(9));
  g.quadraticCurveTo(x + w + j(10), y + h + j(11), x + w - r + j(12), y + h + j(13));
  g.lineTo(x + r + j(14), y + h + j(15));
  g.quadraticCurveTo(x + j(16), y + h + j(17), x + j(18), y + h - r + j(19));
  g.lineTo(x + j(20), y + r + j(21));
  g.quadraticCurveTo(x + j(22), y + j(23), x + r + j(0), y + j(1));
  g.closePath();
}

// A character's body as a still picture: coloured in with a felt-tip, outlined,
// and (when the eyes are open) the whites of its googly eyes, looking right.
// Stamping this costs far less than stroking it again every frame.
function body(g, color, wobble, eyes) {
  const j = (i) => (hash1(wobble * 31 + i, 7) - 0.5) * 1.8;
  g.translate(BODY_PAD, BODY_PAD);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  blobPath(g, 0, 0, PW - 4, 29, 9, j);
  g.fillStyle = color;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 2.8;
  g.stroke();
  g.strokeStyle = lighten(color, 0.45);
  g.lineWidth = 2.4;
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const d = 5 + k * 7 + j(50 + k);
    g.moveTo(d, 24);
    g.lineTo(d + 5, 5);
  }
  g.stroke();
  if (!eyes) return;
  g.strokeStyle = INK;
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(11.5, 11, 4.8, 0, 6.283);
  g.moveTo(27.3, 11);
  g.arc(22.5, 11, 4.8, 0, 6.283);
  g.fillStyle = '#fff';
  g.fill();
  g.stroke();
}

export default {
  id: 'sketch',
  colors: COLORS,
  letterbox: '#e4dcc4',
  lift: PEN,
  label: {
    font: '16px "Patrick Hand", cursive',
    color: '#26262b',
    stroke: 'rgba(251,247,233,.95)',
    strokeWidth: 4,
    you: '#2450c4',
    gap: 8,
  },

  build(env) {
    const { rnd, sprite } = env;
    // the "TAG!" burst, drawn twice so it can boil
    const bursts = [0, 1].map(() => sprite(BURST_W, BURST_H, (g) => burst(g, rnd)));
    const birds = [];
    for (let i = 0; i < 5; i++) birds.push({ x: rnd() * W, y: 96 + rnd() * 110, v: 9 + rnd() * 9, ph: rnd() * 6.283 });
    // bodies[slot][wobble][eyes open ? 1 : 0]; px = sprite pixels per world unit
    let px = 1;
    const bodies = COLORS.map((color) =>
      [0, 1].map((wobble) =>
        [false, true].map((eyes) =>
          sprite(BODY_W, BODY_H, (g) => {
            px = g.getTransform().a;
            body(g, color, wobble, eyes);
          }),
        ),
      ),
    );
    return { rnd, bursts, birds, bodies, px, dash: COLORS.map(() => 0) };
  },

  back(g, sc) {
    page(g, sc.rnd);
  },

  platform(g, p, i, rnd, arena) {
    if (p.ground) drawBlock(g, rnd, p, arena);
    else drawLedge(g, rnd, p, LEVELS[Math.floor(p.y / 160) % LEVELS.length]);
  },

  ramp(g, r, i, rnd, arena) {
    drawRamp(g, rnd, r, arena);
  },

  // updrafts: pen arrows pointing up the column
  decor(g, sc, arena) {
    const rnd = sc.rnd;
    g.strokeStyle = rgba(PEN, 0.5);
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.beginPath();
    for (const z of arena.lifts) {
      const cx = z.x + z.w / 2;
      let side = 1;
      for (let y = z.y + z.h - 36; y > z.y + 56; y -= 112) {
        const x = cx + side * z.w * 0.2;
        side = -side;
        wline(g, rnd, x, y, x, y - 46, 1.5);
        wline(g, rnd, x - 10, y - 33, x, y - 47, 1);
        wline(g, rnd, x + 10, y - 33, x, y - 47, 1);
      }
    }
    g.stroke();
  },

  // soft darkening towards the corners of the page
  front(g) {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, H);
    v.addColorStop(0, 'rgba(120,95,50,0)');
    v.addColorStop(1, 'rgba(120,95,50,.22)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  },

  // every frame: a few birds, a butterfly and a paper plane cross the page.
  // The plane is one fill; everything else shares a single pencil stroke.
  live(g, sc, t) {
    const span = W + 300;
    const px = ((t * 55) % span) - 150;
    const py = 150 + Math.sin(t * 0.9) * 46;
    const ang = Math.atan2(Math.cos(t * 0.9) * 46 * 0.9, 55);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const at = (x, y, move) => (move ? g.moveTo(px + x * c - y * s, py + x * s + y * c) : g.lineTo(px + x * c - y * s, py + x * s + y * c));
    const plane = () => {
      at(16, 0, true);
      at(-12, -9);
      at(-6, 0);
      at(-12, 8);
      at(16, 0);
    };
    g.fillStyle = CARD;
    g.beginPath();
    plane();
    g.fill();

    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgb(96,96,110)';
    g.lineWidth = 1.5;
    g.beginPath();
    plane();
    at(-6, 0);
    // its dotted trail
    for (let k = 1; k < 13; k += 2) {
      const ta = t - k * 0.12;
      const ax = ((ta * 55) % span) - 150;
      if (ax > px) break; // the plane has just wrapped round to the left edge
      g.moveTo(ax, 150 + Math.sin(ta * 0.9) * 46);
      g.lineTo(ax - 3.9, 150 + Math.sin((ta - 0.07) * 0.9) * 46);
    }
    for (let i = 0; i < sc.birds.length; i++) {
      const b = sc.birds[i];
      const x = ((b.x + t * b.v) % (W + 40)) - 20;
      const y = b.y + Math.sin(t * 0.7 + b.ph) * 7;
      const flap = Math.sin(t * 7 + b.ph);
      g.moveTo(x - 8, y - 2 - flap * 4);
      g.quadraticCurveTo(x - 4, y - 5 - flap, x, y);
      g.quadraticCurveTo(x + 4, y - 5 - flap, x + 8, y - 2 - flap * 4);
    }
    // butterfly: two wings that open and close
    const bx = 170 + Math.sin(t * 0.43) * 90 + Math.sin(t * 2.1) * 12;
    const by = 300 + Math.sin(t * 0.31 + 1) * 60 + Math.sin(t * 2.9) * 8;
    const open = 0.25 + 0.75 * Math.abs(Math.sin(t * 9));
    g.moveTo(bx, by + 3);
    g.quadraticCurveTo(bx - 9 * open, by + 2, bx - 6 * open, by - 6);
    g.quadraticCurveTo(bx - 2 * open, by - 5, bx, by + 3);
    g.quadraticCurveTo(bx + 2 * open, by - 5, bx + 6 * open, by - 6);
    g.quadraticCurveTo(bx + 9 * open, by + 2, bx, by + 3);
    g.stroke();
  },

  // a doodled spring with a plank on top
  trampoline(g, tr, t, k) {
    const frame = Math.floor(t * 8);
    const j = (n) => (hash1(frame * 13 + n, tr.x) - 0.5) * 1.6;
    const top = tr.y - 5 + k * 9;
    const base = tr.y + tr.h;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = RED;
    g.lineWidth = 2.6;
    g.beginPath();
    const coils = 5;
    for (const sx of [tr.x + 14, tr.x + tr.w - 14]) {
      g.moveTo(sx, top + 5);
      for (let c = 1; c <= coils; c++) g.lineTo(sx + (c % 2 ? 8 : -8) + j(c), top + 5 + ((base - top - 5) * c) / coils);
    }
    g.stroke();
    // the plank
    g.beginPath();
    g.moveTo(tr.x - 2 + j(20), top + j(21));
    g.lineTo(tr.x + tr.w + 2 + j(22), top + j(23));
    g.lineTo(tr.x + tr.w + 1 + j(24), top + 6 + j(25));
    g.lineTo(tr.x - 1 + j(26), top + 6 + j(27));
    g.closePath();
    g.fillStyle = '#ff9c8f';
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.2;
    g.stroke();
    if (k > 0.05) {
      g.globalAlpha = k;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let n = -1; n <= 1; n++) {
        g.moveTo(tr.cx + n * 16, top - 6);
        g.lineTo(tr.cx + n * 20, top - 16 - k * 8);
      }
      g.stroke();
      g.globalAlpha = 1;
    }
  },

  // a scribbled whirlpool
  portal(g, po) {
    const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
    const j = (n) => (hash1(n, po.pair + 3) - 0.5) * 2.4;
    const cx = po.cx;
    const cy = po.cy + 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.ellipse(cx, cy, 20, 34, 0, 0, 6.283);
    g.fillStyle = CARD;
    g.fill();
    g.fillStyle = rgba(col, 0.22);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    for (let a = 0; a < 14.6; a += 0.32) {
      const r = a * 1.2;
      const px = cx + Math.cos(a) * r + j(a * 10) * 0.6;
      const py = cy + Math.sin(a) * r * 1.7 + j(a * 10 + 5) * 0.6;
      if (a === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    // little dashes flying off it
    g.lineWidth = 2.2;
    g.beginPath();
    for (let n = 0; n < 8; n++) {
      const a = (n / 8) * 6.283 + 0.4;
      g.moveTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 40);
      g.lineTo(cx + Math.cos(a) * 31, cy + Math.sin(a) * 46);
    }
    g.stroke();
    g.strokeStyle = INK;
    g.lineWidth = 2.8;
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (let n = 0; n <= 16; n++) {
        const a = (n / 16) * 6.283;
        const px = cx + Math.cos(a) * (20 + j(n + pass * 40));
        const py = cy + Math.sin(a) * (34 + j(n + 20 + pass * 40));
        if (n === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
      g.lineWidth = 1;
    }
  },

  // a sticker
  pickup(g, kind, x, y) {
    const col = KIND_COLORS[kind];
    const j = (n) => (hash1(n, kind.length) - 0.5) * 1.8;
    g.translate(x, y);
    g.rotate(-0.1);
    g.beginPath();
    for (let n = 0; n < 16; n++) {
      const a = (n / 16) * 6.283;
      const r = (n % 2 ? 15.5 : 20) + j(n);
      if (n === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = CARD;
    g.fill();
    g.fillStyle = rgba(col, 0.6);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.4;
    g.lineJoin = 'round';
    g.stroke();
    drawIcon(g, kind, 0, 0, 9, INK);
  },

  // Drawn facing right; mirrored when heading left. The body is a stamp, the
  // limbs, pupils and mouth are drawn fresh so they can move and boil.
  player(g, pv, t, sc) {
    const { x, y, cx, feet } = pv;
    const frame = Math.floor(t * 8);
    const j = (i) => (hash1(frame * 31 + i, pv.seed) - 0.5) * 1.8;
    squashAt(g, cx, feet, pv.squash);
    if (pv.face < 0) {
      g.translate(cx * 2, 0);
      g.scale(-1, 1);
    }
    const air = !pv.ground;
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const sw = moving ? Math.sin(pv.run) : 0;
    const bob = moving ? Math.abs(Math.cos(pv.run)) * 1.6 : 0;
    const by = y + 1 - bob;
    const bh = 29;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    if (pv.isIt) {
      // whoever is it gets an angry red scribble crackling around them
      g.strokeStyle = RED;
      g.lineWidth = 2.6;
      g.beginPath();
      const n = 18;
      for (let i = 0; i <= n; i++) {
        const a = ((i + (frame % 2) * 0.5) / n) * 6.283;
        const r = i % 2 ? 1 : 1.26;
        const px = cx + Math.cos(a) * 24 * r + j(60 + (i % n));
        const py = by + 19 + Math.sin(a) * 27 * r + j(80 + (i % n));
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }

    g.strokeStyle = INK;
    g.lineWidth = 2.8;
    // stick legs with little feet
    g.beginPath();
    const hip = by + bh - 1;
    if (air) {
      const k = pv.vy < 0 ? 1 : -1;
      g.moveTo(cx - 6, hip);
      g.lineTo(cx - 11, feet - 5 + k * 2);
      g.lineTo(cx - 6, feet - 3 + k * 2);
      g.moveTo(cx + 6, hip);
      g.lineTo(cx + 7, feet - 2 - k);
      g.lineTo(cx + 12, feet - k);
    } else {
      const fx1 = cx - 6 + sw * 8;
      const fy1 = feet - 1.5 - Math.max(0, sw) * 5;
      const fx2 = cx + 6 - sw * 8;
      const fy2 = feet - 1.5 - Math.max(0, -sw) * 5;
      g.moveTo(cx - 6, hip);
      g.lineTo(fx1, fy1);
      g.lineTo(fx1 + 5, fy1);
      g.moveTo(cx + 6, hip);
      g.lineTo(fx2, fy2);
      g.lineTo(fx2 + 5, fy2);
    }
    // stick arms
    const ay = by + 17;
    if (air) {
      g.moveTo(x + 2, ay);
      g.lineTo(x - 6 + j(40), ay - 12 + j(41));
      g.moveTo(x + PW - 2, ay);
      g.lineTo(x + PW + 6 + j(42), ay - 12 + j(43));
    } else {
      g.moveTo(x + 2, ay);
      g.lineTo(x - 5 - sw * 4, ay + 8 + sw * 3);
      g.moveTo(x + PW - 2, ay);
      g.lineTo(x + PW + 5 - sw * 4, ay + 8 - sw * 3);
    }
    g.stroke();

    // body (and the whites of the eyes), stamped on whole pixels while it is not squashing
    const open = !pv.stunned && pv.blink < 0.5;
    let bx = x + 2 - BODY_PAD;
    let top = by - BODY_PAD;
    if (!pv.squash) {
      const k = sc.px;
      const left = pv.face < 0 ? cx * 2 - bx - BODY_W : bx; // where its left edge shows on screen
      const snapped = Math.round(left * k) / k;
      bx = pv.face < 0 ? cx * 2 - snapped - BODY_W : snapped;
      top = Math.round(top * k) / k;
    }
    g.drawImage(sc.bodies[pv.slot][frame & 1][open ? 1 : 0], bx, top, BODY_W, BODY_H);

    // the rest of the googly face
    const ex = cx + 3;
    const ey = by + 11;
    g.lineWidth = 1.6;
    g.beginPath();
    if (open) {
      const py = air ? (pv.vy < 0 ? -1.2 : 1.4) : 0.4;
      g.fillStyle = INK;
      g.arc(ex - 3.7, ey + py, 2.2, 0, 6.283);
      g.arc(ex + 7.3, ey + py, 2.2, 0, 6.283);
      g.fill();
    } else if (pv.stunned) {
      // seeing stars
      for (const ox of [ex - 5.5, ex + 5.5]) {
        g.moveTo(ox - 3, ey - 3);
        g.lineTo(ox + 3, ey + 3);
        g.moveTo(ox + 3, ey - 3);
        g.lineTo(ox - 3, ey + 3);
      }
      g.stroke();
    } else {
      g.moveTo(ex - 9.5, ey);
      g.lineTo(ex - 1.5, ey);
      g.moveTo(ex + 1.5, ey);
      g.lineTo(ex + 9.5, ey);
      g.stroke();
    }
    g.beginPath();
    if (pv.isIt) {
      // a big grin, then angry eyebrows and the teeth in one go
      g.moveTo(ex - 8, ey + 8);
      g.lineTo(ex + 8, ey + 8);
      g.quadraticCurveTo(ex + 7, ey + 15, ex, ey + 15);
      g.quadraticCurveTo(ex - 7, ey + 15, ex - 8, ey + 8);
      g.fillStyle = '#fff';
      g.fill();
      g.stroke();
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(ex - 11, ey - 8);
      g.lineTo(ex - 2, ey - 4);
      g.moveTo(ex + 11, ey - 8);
      g.lineTo(ex + 2, ey - 4);
      for (let k = -1; k <= 1; k++) {
        g.moveTo(ex + k * 4, ey + 9);
        g.lineTo(ex + k * 4, ey + 14);
      }
      g.stroke();
    } else {
      g.lineWidth = 1.8;
      if (air) g.arc(ex, ey + 11, 2.6, 0, 6.283);
      else g.arc(ex, ey + 7, 6, 0.3, Math.PI - 0.3);
      g.stroke();
    }
  },

  // "IT!" in red marker over a swipe of highlighter, with an arrow down to the player
  marker(g, cx, cy) {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.save();
    g.translate(cx, cy - 21);
    g.rotate(-0.09);
    g.strokeStyle = '#ffe45e';
    g.lineWidth = 19;
    g.beginPath();
    g.moveTo(-21, 2);
    g.lineTo(22, -1);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '27px "Permanent Marker", cursive';
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.strokeText('IT!', 0, 1);
    g.fillStyle = RED;
    g.fillText('IT!', 0, 1);
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 5.5;
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      g.moveTo(cx - 1, cy - 5);
      g.lineTo(cx, cy + 9);
      g.moveTo(cx - 7, cy + 2);
      g.lineTo(cx, cy + 10);
      g.lineTo(cx + 7, cy + 2);
      g.stroke();
      g.strokeStyle = RED;
      g.lineWidth = 2.8;
    }
  },

  fx: {
    trail(R, pv, dt, t) {
      const sc = R.scene;
      if (Math.abs(pv.vx) < 200 || t - sc.dash[pv.slot] < 0.11) return;
      sc.dash[pv.slot] = t;
      // speed lines
      R.emit({ x: pv.cx - pv.face * 20, y: pv.y + 6 + Math.random() * 26, life: 0.2, shape: 'line', width: 1.6, lx: -pv.face * (8 + Math.random() * 10), color: INK, alpha: 0.7, back: true });
    },
    jump(R, pv) {
      for (let i = 0; i < 3; i++) puff(R, pv.cx + (i - 1) * 9, pv.feet - 2, (i - 1) * 30, -10);
    },
    land(R, pv, impact) {
      puff(R, pv.cx - 10, pv.feet - 3, -60 - impact * 60, -12);
      puff(R, pv.cx + 10, pv.feet - 3, 60 + impact * 60, -12);
    },
    step(R, pv) {
      if (Math.random() < 0.5) puff(R, pv.cx - pv.face * 10, pv.feet - 2, -pv.face * 25, -6, 3);
    },
    respawn(R, pv) {
      for (let i = 0; i < 4; i++) puff(R, pv.cx + (Math.random() - 0.5) * 30, pv.y - 10 + Math.random() * 30, (Math.random() - 0.5) * 60, 20, 6);
    },
    tag(R, to) {
      const sc = R.scene;
      // comic burst: pops out, then holds while it boils
      R.emit({
        x: to.cx,
        y: to.y + 12,
        life: 0.6,
        fade: false,
        draw(g, p, k) {
          const a = 1 - k;
          const s = a < 0.25 ? 0.4 + a * 2.8 : 1.1 - (a - 0.25) * 0.15;
          g.globalAlpha = k < 0.25 ? k * 4 : 1;
          g.drawImage(sc.bursts[Math.floor(p.age * 12) % 2], p.x - (BURST_W / 2) * s, p.y - (BURST_H / 2) * s, BURST_W * s, BURST_H * s);
        },
      });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 6.283;
        R.emit({ x: to.cx + Math.cos(a) * 50, y: to.y + 12 + Math.sin(a) * 36, vx: Math.cos(a) * 240, vy: Math.sin(a) * 170, drag: 5, life: 0.35, size: 1.4, shape: 'line', width: 2.2, color: INK });
      }
    },
  },
};

// scribbly dust cloud
function puff(R, x, y, vx, vy, size = 4.5) {
  const seed = Math.random() * 1000;
  R.emit({
    x,
    y,
    vx,
    vy,
    drag: 3,
    life: 0.38,
    size,
    grow: 16,
    draw(g, p, k) {
      g.globalAlpha = k;
      g.strokeStyle = 'rgba(60,60,75,.8)';
      g.lineWidth = 1.4;
      g.beginPath();
      const frame = Math.floor(p.age * 14);
      for (let i = 0; i <= 9; i++) {
        const a = (i / 9) * 6.283 * 1.15;
        const r = p.size * (0.8 + hash1(i + frame * 5, seed) * 0.4);
        const px = p.x + Math.cos(a) * r;
        const py = p.y + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    },
  });
}
