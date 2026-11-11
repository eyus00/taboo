// SKETCHBOOK - everything is a doodle on lined paper. Lines are redrawn a few
// times a second with a slightly different wobble, so the whole page "boils"
// like a flip-book.

import { W, H, PW } from '/shared/config.js';
import { mulberry32, hash1, lighten, squashAt } from '../util.js';

const INK = '#2b2b30';
const PAPER = '#fbf7e9';
const PENCILS = ['#f29d38', '#4a9be8', '#e2607a', '#58b368', '#9b6fd6'];
const BOIL = 3; // number of pre-drawn wobble variants

// One hand-drawn stroke: never perfectly straight, never ending exactly on target.
function wline(g, rnd, x1, y1, x2, y2, amp = 1.4) {
  const j = () => (rnd() - 0.5) * amp * 2;
  g.moveTo(x1 + j(), y1 + j());
  g.quadraticCurveTo((x1 + x2) / 2 + j() * 1.5, (y1 + y2) / 2 + j() * 1.5, x2 + j(), y2 + j());
}

function wrect(g, rnd, x, y, w, h, amp) {
  g.beginPath();
  wline(g, rnd, x - 2, y, x + w + 2, y, amp);
  wline(g, rnd, x + w, y - 2, x + w, y + h + 2, amp);
  wline(g, rnd, x + w + 2, y + h, x - 2, y + h, amp);
  wline(g, rnd, x, y + h + 2, x, y - 2, amp);
  g.stroke();
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

function hatch(g, rnd, x, y, w, h, gap, color, width, slope = 1) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  for (let d = -h; d < w + h; d += gap * (0.75 + rnd() * 0.5)) {
    wline(g, rnd, x + d, y + h + 2, x + d + h * slope, y - 2, 1.2);
  }
  g.stroke();
  g.restore();
}

function drawPlatform(g, rnd, p, i) {
  // soft pencil shadow so shapes lift off the page
  hatch(g, rnd, p.x + 5, p.y + 6, p.w, p.h, 5, 'rgba(40,40,60,.13)', 1.4, -1);
  g.fillStyle = '#fffdf5';
  g.fillRect(p.x, p.y, p.w, p.h);
  if (p.ground) {
    g.fillStyle = '#f5e8c9';
    g.fillRect(p.x, p.y, p.w, p.h);
    hatch(g, rnd, p.x, p.y + 10, p.w, p.h - 10, 11, 'rgba(160,110,60,.5)', 1.3, 1);
    hatch(g, rnd, p.x, p.y + 10, p.w, p.h - 10, 17, 'rgba(160,110,60,.32)', 1.2, -1);
    // crayon grass along the top
    g.fillStyle = '#8fd694';
    g.fillRect(p.x, p.y, p.w, 10);
    g.strokeStyle = '#3f9d4e';
    g.lineWidth = 1.7;
    g.lineCap = 'round';
    g.beginPath();
    for (let x = p.x + 2; x < p.x + p.w - 2; x += 5 + rnd() * 3) {
      g.moveTo(x, p.y + 10 + rnd() * 2);
      g.lineTo(x + 2.5 + (rnd() - 0.5) * 3, p.y + 1 + rnd() * 3);
    }
    g.stroke();
    // a few tufts poking above the edge
    g.beginPath();
    for (let x = p.x + 8 + rnd() * 20; x < p.x + p.w - 8; x += 24 + rnd() * 40) {
      for (let k = -1; k <= 1; k++) {
        g.moveTo(x, p.y + 1);
        g.lineTo(x + k * 4 + (rnd() - 0.5) * 2, p.y - 6 - rnd() * 4);
      }
    }
    g.stroke();
  } else {
    const col = PENCILS[i % PENCILS.length];
    g.globalAlpha = 0.28;
    g.fillStyle = col;
    g.fillRect(p.x, p.y, p.w, p.h);
    g.globalAlpha = 1;
    hatch(g, rnd, p.x, p.y, p.w, p.h, 5.5, col, 1.8, 1);
  }
  // pencil outline, drawn twice like a kid going over their lines
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.lineWidth = 2.3;
  wrect(g, rnd, p.x, p.y, p.w, p.h, 1.1);
  g.lineWidth = 1;
  g.globalAlpha = 0.6;
  wrect(g, rnd, p.x, p.y, p.w, p.h, 2);
  g.globalAlpha = 1;
  // thick marker line on the surface you stand on
  g.lineWidth = 3.4;
  g.beginPath();
  wline(g, rnd, p.x - 1, p.y, p.x + p.w + 1, p.y, 0.7);
  g.stroke();
}

function doodles(g, rnd) {
  g.strokeStyle = 'rgba(70,70,85,.55)';
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
  // birds
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const bx = 250 + rnd() * 380;
    const by = 110 + rnd() * 90;
    g.moveTo(bx - 8, by - 4);
    g.quadraticCurveTo(bx - 4, by - 7, bx, by);
    g.quadraticCurveTo(bx + 4, by - 7, bx + 8, by - 4);
  }
  g.stroke();

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

export default {
  id: 'sketch',
  colors: ['#ee4b4b', '#3f8cf0', '#43b85c', '#f7c531'],
  letterbox: '#e4dcc4',
  label: {
    font: '16px "Patrick Hand", cursive',
    size: 13,
    color: '#26262b',
    stroke: 'rgba(251,247,233,.95)',
    strokeWidth: 4,
    you: '#e23b3b',
    youFont: '15px "Permanent Marker", cursive',
    stun: '#e23b3b',
  },
  labelGap: 8,
  hud: {
    font: '"Permanent Marker", cursive',
    weight: 400,
    labelFont: '"Patrick Hand", cursive',
    labelWeight: 400,
    labelScale: 1.2,
    scale: 0.95,
    text: '#26262b',
    dim: 'rgba(60,60,75,.7)',
    warn: '#e23b3b',
    outline: 'rgba(251,247,233,.9)',
    outlineWidth: 5,
    chip: 'rgba(255,253,245,.93)',
    chipLine: '#2b2b30',
    chipIt: '#ffe45e',
    big: '#26262b',
    bigStroke: 'rgba(251,247,233,.95)',
    radius: 4,
    swatchLine: '#2b2b30',
  },

  build(env) {
    const { rnd, arena, layer } = env;
    const bg = layer((g) => {
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
      doodles(g, rnd);
    });

    const seed = Math.floor(rnd() * 1e9);
    const plats = [];
    for (let v = 0; v < BOIL; v++) {
      plats.push(
        layer((g) => {
          arena.platforms.forEach((p, i) => {
            // same seed for the hatching layout of each variant family, different wobble
            drawPlatform(g, mulberry32(seed + v * 977 + i * 31), p, i);
          });
        }),
      );
    }

    const shade = layer((g) => {
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, H);
      v.addColorStop(0, 'rgba(120,95,50,0)');
      v.addColorStop(1, 'rgba(120,95,50,.22)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }, 0.5);

    return { bg, plats, shade, dash: [0, 0, 0, 0] };
  },

  back(g, sc, t) {
    g.drawImage(sc.bg, 0, 0, W, H);
    // paper plane looping across the page
    const span = W + 300;
    const x = ((t * 55) % span) - 150;
    const y = 150 + Math.sin(t * 0.9) * 46;
    const ang = Math.atan2(Math.cos(t * 0.9) * 46 * 0.9, 55);
    g.strokeStyle = 'rgba(70,70,85,.5)';
    g.lineWidth = 1.3;
    g.setLineDash([5, 6]);
    g.beginPath();
    for (let k = 1; k <= 14; k++) {
      const tt = t - k * 0.12;
      const px = ((tt * 55) % span) - 150;
      if (px > x) break;
      const py = 150 + Math.sin(tt * 0.9) * 46;
      if (k === 1) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.setLineDash([]);
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = '#fffdf5';
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(16, 0);
    g.lineTo(-12, -9);
    g.lineTo(-6, 0);
    g.lineTo(-12, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(16, 0);
    g.lineTo(-6, 0);
    g.stroke();
    g.restore();
  },

  platforms(g, sc, t) {
    g.drawImage(sc.plats[Math.floor(t * 6) % BOIL], 0, 0, W, H);
  },

  player(g, pv, t) {
    const { x, y, cx, feet, color } = pv;
    const frame = Math.floor(t * 8);
    const j = (i) => (hash1(frame * 31 + i, pv.seed) - 0.5) * 1.8;
    squashAt(g, cx, feet, pv.squash);
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const sw = moving ? Math.sin(pv.run) : 0;
    const bob = moving ? Math.abs(Math.cos(pv.run)) * 1.6 : 0;
    const by = y + 1 - bob;
    const bh = 29;
    const air = !pv.ground;

    g.strokeStyle = INK;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 2.6;
    // stick legs with little feet
    g.beginPath();
    const hip = by + bh - 1;
    if (air) {
      const k = pv.vy < 0 ? 1 : -1;
      g.moveTo(cx - 6, hip);
      g.lineTo(cx - 9 - pv.face * 2, feet - 5 + k * 2);
      g.lineTo(cx - 9 + pv.face * 3, feet - 3 + k * 2);
      g.moveTo(cx + 6, hip);
      g.lineTo(cx + 9 - pv.face * 2, feet - 2 - k);
      g.lineTo(cx + 9 + pv.face * 3, feet - k);
    } else {
      const fx1 = cx - 6 + sw * 8;
      const fy1 = feet - 1.5 - Math.max(0, sw) * 5;
      const fx2 = cx + 6 - sw * 8;
      const fy2 = feet - 1.5 - Math.max(0, -sw) * 5;
      g.moveTo(cx - 6, hip);
      g.lineTo(fx1, fy1);
      g.lineTo(fx1 + pv.face * 5, fy1);
      g.moveTo(cx + 6, hip);
      g.lineTo(fx2, fy2);
      g.lineTo(fx2 + pv.face * 5, fy2);
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

    // marker-coloured body
    blobPath(g, x + 2, by, PW - 4, bh, 9, j);
    g.fillStyle = color;
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = lighten(color, 0.45);
    g.lineWidth = 2.2;
    g.beginPath();
    for (let k = 0; k < 5; k++) {
      const d = k * 9 - 6 + j(50 + k);
      g.moveTo(x + d, by + bh + 2);
      g.lineTo(x + d + 22, by - 2);
    }
    g.stroke();
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 2.6;
    blobPath(g, x + 2, by, PW - 4, bh, 9, j);
    g.stroke();

    // googly face
    const ex = cx + pv.face * 3;
    const ey = by + 11;
    const open = pv.blink < 0.5;
    g.lineWidth = 1.6;
    for (const s of [-1, 1]) {
      if (open) {
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(ex + s * 5.5, ey, 4.8, 0, 6.283);
        g.fill();
        g.stroke();
        g.fillStyle = INK;
        g.beginPath();
        g.arc(ex + s * 5.5 + pv.face * 1.8, ey + (air ? (pv.vy < 0 ? -1.2 : 1.4) : 0.4), 2.1, 0, 6.283);
        g.fill();
      } else {
        g.beginPath();
        g.moveTo(ex + s * 5.5 - 4, ey);
        g.lineTo(ex + s * 5.5 + 4, ey);
        g.stroke();
      }
    }
    g.lineWidth = 1.8;
    g.beginPath();
    if (pv.isIt) {
      // angry eyebrows and a big toothy grin
      g.moveTo(ex - 11, ey - 8);
      g.lineTo(ex - 2, ey - 4);
      g.moveTo(ex + 11, ey - 8);
      g.lineTo(ex + 2, ey - 4);
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(ex - 8, ey + 8);
      g.lineTo(ex + 8, ey + 8);
      g.quadraticCurveTo(ex + 7, ey + 15, ex, ey + 15);
      g.quadraticCurveTo(ex - 7, ey + 15, ex - 8, ey + 8);
      g.fill();
      g.stroke();
      g.lineWidth = 1.2;
      g.beginPath();
      for (let k = -1; k <= 1; k++) {
        g.moveTo(ex + k * 4, ey + 8);
        g.lineTo(ex + k * 4, ey + 14.5);
      }
      g.stroke();
    } else if (air) {
      g.arc(ex, ey + 11, 2.6, 0, 6.283);
      g.stroke();
    } else {
      g.arc(ex, ey + 7, 6, 0.3, Math.PI - 0.3);
      g.stroke();
    }
  },

  marker(g, cx, cy, t) {
    const frame = Math.floor(t * 8);
    const j = (i) => (hash1(frame * 17 + i, 5) - 0.5) * 1.6;
    g.save();
    g.translate(cx + j(1), cy + j(2));
    g.rotate(-0.1);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '22px "Permanent Marker", cursive';
    g.lineWidth = 5;
    g.strokeStyle = PAPER;
    g.strokeText('IT!', 0, -4);
    g.fillStyle = '#e23b3b';
    g.fillText('IT!', 0, -4);
    g.strokeStyle = '#e23b3b';
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(20, -8);
    g.quadraticCurveTo(28 + j(3), 4, 12, 11 + j(4));
    g.moveTo(18, 5);
    g.lineTo(12, 11);
    g.lineTo(20, 13);
    g.stroke();
    g.restore();
  },

  front(g, sc) {
    g.drawImage(sc.shade, 0, 0, W, H);
  },

  fx: {
    trail(R, pv, dt, t) {
      const sc = R.scene;
      if (Math.abs(pv.vx) < 200 || t - sc.dash[pv.slot] < 0.07) return;
      sc.dash[pv.slot] = t;
      // speed lines
      R.emit({
        x: pv.cx - pv.face * 20,
        y: pv.y + 6 + Math.random() * 26,
        life: 0.22,
        size: 8 + Math.random() * 10,
        face: pv.face,
        back: true,
        draw(g, p, k) {
          g.globalAlpha = k * 0.7;
          g.strokeStyle = INK;
          g.lineWidth = 1.6;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.face * p.size, p.y);
          g.stroke();
        },
      });
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
      for (let i = 0; i < 4; i++) puff(R, pv.cx + (Math.random() - 0.5) * 30, 14 + Math.random() * 20, (Math.random() - 0.5) * 60, 20, 6);
    },
    tag(R, to) {
      R.shake(8);
      const seed = Math.random() * 100;
      R.emit({
        x: to.cx,
        y: to.y + 12,
        life: 0.6,
        fade: false,
        draw(g, p, k) {
          const a = 1 - k;
          const sc = a < 0.25 ? 0.4 + a * 2.8 : 1.1 - (a - 0.25) * 0.15;
          const frame = Math.floor(p.age * 12);
          g.save();
          g.translate(p.x, p.y);
          g.scale(sc, sc);
          g.rotate(-0.12);
          g.globalAlpha = k < 0.25 ? k * 4 : 1;
          // comic burst
          g.beginPath();
          const n = 13;
          for (let i = 0; i < n * 2; i++) {
            const ang = (i / (n * 2)) * 6.283;
            const r = (i % 2 ? 26 : 46) + (hash1(i + frame * 7, seed) - 0.5) * 8;
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
          g.fillStyle = '#e23b3b';
          g.fillText('TAG!', 0, 1);
          g.restore();
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
