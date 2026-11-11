// ARCADE - 8-bit. The world is drawn at half resolution on a 2px grid and
// scaled up with hard edges, then a CRT scanline pass goes on top.

import { ART_W as W, ART_H as H } from '/shared/config.js';
import { vnoise, hash1, lighten, darken, drawIcon, KIND_COLORS, PORTAL_COLORS } from '../util.js';

const U = 2; // one "pixel" in arena units
const OUT = '#1a1040';
const snap = (v) => Math.round(v / U) * U;

const SKY = ['#0d1033', '#1a1650', '#32206e', '#5b2a86', '#8f3a8f', '#c9517f', '#f0756b', '#ffa95e', '#ffd27a'];

function drawPlatform(g, rnd, p) {
  const x = p.x;
  const y = p.y;
  const w = p.w;
  const h = p.h;
  if (p.ground) {
    // stone bricks
    g.fillStyle = '#3c3f6e';
    g.fillRect(x, y, w, h);
    let row = 0;
    for (let by = y + 8; by < y + h; by += 10, row++) {
      for (let bx = x - (row % 2 ? 10 : 0); bx < x + w; bx += 20) {
        const x0 = Math.max(x, bx);
        const x1 = Math.min(x + w, bx + 18);
        if (x1 <= x0) continue;
        const dark = rnd() < 0.18;
        g.fillStyle = dark ? '#565b92' : '#6a6fa8';
        g.fillRect(x0, by, x1 - x0, 8);
        g.fillStyle = dark ? '#6a6fa8' : '#8c91c9';
        g.fillRect(x0, by, x1 - x0, 2);
      }
    }
  } else {
    // packed dirt
    g.fillStyle = '#9a5a3c';
    g.fillRect(x, y, w, h);
    for (let i = 0; i < (w * h) / 50; i++) {
      g.fillStyle = rnd() < 0.5 ? '#6e3b24' : '#b8734e';
      g.fillRect(snap(x + 2 + rnd() * (w - 6)), snap(y + 8 + rnd() * (h - 12)), 2, 2);
    }
    g.fillStyle = '#4a2616';
    g.fillRect(x, y + h - 2, w, 2);
  }
  // grass cap with pixel "teeth"
  g.fillStyle = '#3fbf6b';
  g.fillRect(x, y, w, 6);
  g.fillStyle = '#a7f5c0';
  g.fillRect(x, y, w, 2);
  g.fillStyle = '#3fbf6b';
  for (let tx = x + 2; tx < x + w - 2; tx += 8) g.fillRect(tx, y + 6, 4, 2);
  g.fillStyle = '#2a8a4a';
  for (let tx = x + 6; tx < x + w - 2; tx += 8) g.fillRect(tx, y + 4, 2, 2);
  // chunky outline
  g.fillStyle = OUT;
  g.fillRect(x, y - 2, w, 2);
  g.fillRect(x - 2, y, 2, h);
  g.fillRect(x + w, y, 2, h);
  if (!p.ground) g.fillRect(x, y + h, w, 2);
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
  label: {
    font: '8px "Press Start 2P", monospace',
    size: 8,
    color: '#ffffff',
    stroke: OUT,
    strokeWidth: 3,
    you: '#ffd84d',
    youFont: '8px "Press Start 2P", monospace',
    stun: '#ffd84d',
  },
  labelGap: 10,
  hud: {
    font: '"Press Start 2P", monospace',
    weight: 400,
    scale: 0.62,
    labelFont: '"Press Start 2P", monospace',
    labelWeight: 400,
    labelScale: 0.62,
    text: '#ffffff',
    dim: 'rgba(255,255,255,.7)',
    warn: '#ff5964',
    outline: OUT,
    outlineWidth: 4,
    chip: 'rgba(26,16,64,.88)',
    chipLine: '#ffffff',
    chipIt: '#d6336c',
    big: '#ffd84d',
    bigStroke: OUT,
    radius: 0,
    swatchRadius: 0,
    timerDy: 2,
  },

  build(env) {
    const { rnd, layer } = env;
    const stars = [];
    const bg = layer((g) => {
      // banded sunset with dithered joins
      const bandH = 46;
      for (let i = 0; i < SKY.length; i++) {
        g.fillStyle = SKY[i];
        g.fillRect(0, i * bandH, W, bandH + 2);
        if (i > 0) {
          g.fillStyle = SKY[i];
          for (let x = 0; x < W; x += 4) {
            g.fillRect(x, i * bandH - 2, 2, 2);
            g.fillRect(x + 2, i * bandH - 4, 2, 2);
            if ((x / 4) % 2) g.fillRect(x, i * bandH - 8, 2, 2);
          }
        }
      }
      for (let i = 0; i < 60; i++) {
        const sx = snap(rnd() * W);
        const sy = snap(rnd() * 170);
        if (i < 22) stars.push({ x: sx, y: sy });
        else {
          g.fillStyle = rnd() < 0.3 ? '#ffd27a' : '#e8e4ff';
          g.fillRect(sx, sy, 2, 2);
        }
      }
      // pixel sun
      const cx = 566;
      const cy = 318;
      for (let y = -72; y <= 72; y += 2) {
        const half = snap(Math.sqrt(72 * 72 - y * y));
        g.fillStyle = y < -20 ? '#fff6cf' : y < 24 ? '#ffe9a1' : '#ffd27a';
        g.fillRect(cx - half, cy + y, half * 2, 2);
      }
      // two ranges of blocky mountains
      for (let x = 0; x < W; x += 4) {
        const hh = snap(150 + 90 * vnoise(x / 95, 3) + 26 * vnoise(x / 21, 5));
        g.fillStyle = '#4b2a7b';
        g.fillRect(x, H - hh, 4, hh);
        g.fillStyle = hh > 218 ? '#f3e3ff' : '#6a3fa0';
        g.fillRect(x, H - hh, 4, hh > 218 ? 6 : 2);
      }
      for (let x = 0; x < W; x += 4) {
        const hh = snap(70 + 80 * vnoise(x / 70 + 40, 9) + 16 * vnoise(x / 17, 11));
        g.fillStyle = '#2c1a57';
        g.fillRect(x, H - hh, 4, hh);
        g.fillStyle = '#3d2670';
        g.fillRect(x, H - hh, 4, 2);
      }
      // pines
      for (let i = 0; i < 26; i++) {
        const tx = snap(rnd() * W);
        const base = H - snap(rnd() * 30);
        const tiers = 3 + Math.floor(rnd() * 3);
        g.fillStyle = '#1b1040';
        g.fillRect(tx - 2, base - 8, 4, 8);
        for (let k = 0; k < tiers; k++) {
          const tw = 4 + (tiers - k) * 4;
          g.fillRect(tx - tw / 2, base - 8 - (k + 1) * 6, tw, 6);
        }
      }
    });

    // CRT pass, drawn at full resolution over the upscaled pixels
    const crt = layer((g) => {
      g.fillStyle = 'rgba(8,4,30,.16)';
      for (let y = 0; y < H; y += 2) g.fillRect(0, y + 1, W, 1);
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, H * 1.02);
      v.addColorStop(0, 'rgba(8,4,30,0)');
      v.addColorStop(1, 'rgba(8,4,30,.6)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }, env.scale);

    const clouds = [];
    for (let i = 0; i < 5; i++) clouds.push({ x: rnd() * W, y: snap(40 + rnd() * 130), v: 5 + rnd() * 9, s: 1 + Math.floor(rnd() * 2) });

    return { bg, crt, stars, clouds };
  },

  back(g, sc, t) {
    g.drawImage(sc.bg, 0, 0, W, H);
    // twinkling stars
    for (let i = 0; i < sc.stars.length; i++) {
      const s = sc.stars[i];
      const k = hash1(Math.floor(t * 2.5) + i * 7, i);
      if (k < 0.3) continue;
      g.fillStyle = k > 0.8 ? '#ffffff' : '#bdb6ff';
      g.fillRect(s.x, s.y, 2, 2);
      if (k > 0.9) {
        g.fillRect(s.x - 2, s.y, 2, 2);
        g.fillRect(s.x + 2, s.y, 2, 2);
        g.fillRect(s.x, s.y - 2, 2, 2);
        g.fillRect(s.x, s.y + 2, 2, 2);
      }
    }
    // chunky clouds drifting by
    for (const c of sc.clouds) {
      const span = W + 160;
      const x = snap(((c.x + t * c.v) % span) - 80);
      const u = 4 * c.s;
      g.fillStyle = '#ffb59a';
      g.fillRect(x, c.y + u, u * 9, u * 2);
      g.fillStyle = '#ffe3d1';
      g.fillRect(x + u, c.y, u * 7, u * 2);
      g.fillRect(x + u * 2, c.y - u, u * 3, u);
      g.fillRect(x + u * 5, c.y - u, u * 2, u);
      g.fillRect(x, c.y + u, u * 9, u);
    }
  },

  platPad: { x: 2, top: 2, bottom: 2 },
  platform(g, p, i, rnd) {
    drawPlatform(g, rnd, p);
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
  portal(g, po, t) {
    const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
    const x = snap(po.x + 4);
    const y = snap(po.y + 4);
    const w = 36;
    const h = 72;
    g.fillStyle = OUT;
    g.fillRect(x - 2, y - 2, w + 4, h + 2);
    g.fillRect(x + 4, y - 6, w - 8, 4);
    g.fillStyle = darken(col, 0.55);
    g.fillRect(x + 2, y + 2, w - 4, h - 2);
    g.fillRect(x + 6, y - 4, w - 12, 6);
    const f = Math.floor(t * 9);
    for (let cy = 0; cy < 17; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        const d = Math.hypot(cx - 3.5, (cy - 8) * 0.55);
        const v = (d * 1.7 - f * 0.6 + Math.atan2(cy - 8, cx - 3.5) * 1.3) % 4;
        const n = ((v % 4) + 4) % 4;
        if (n < 1.3) {
          g.fillStyle = n < 0.5 ? '#ffffff' : lighten(col, 0.35);
          g.fillRect(x + 2 + cx * 4, y + 2 + cy * 4, 4, 4);
        } else if (n < 2.4) {
          g.fillStyle = col;
          g.fillRect(x + 2 + cx * 4, y + 2 + cy * 4, 4, 4);
        }
      }
    }
  },

  // an item box
  pickup(g, kind, x, y, t) {
    const col = KIND_COLORS[kind];
    const cx = snap(x);
    const cy = snap(y);
    g.fillStyle = OUT;
    g.fillRect(cx - 14, cy - 14, 28, 28);
    g.fillStyle = col;
    g.fillRect(cx - 12, cy - 12, 24, 24);
    g.fillStyle = lighten(col, 0.5);
    g.fillRect(cx - 12, cy - 12, 24, 2);
    g.fillRect(cx - 12, cy - 12, 2, 24);
    g.fillStyle = darken(col, 0.35);
    g.fillRect(cx - 12, cy + 10, 24, 2);
    g.fillRect(cx + 10, cy - 12, 2, 24);
    drawIcon(g, kind, cx, cy, 8, OUT);
    if (Math.floor(t * 4 + x) % 4 === 0) {
      g.fillStyle = '#ffffff';
      g.fillRect(cx - 10, cy - 10, 4, 2);
      g.fillRect(cx - 10, cy - 8, 2, 2);
    }
  },

  player(g, pv, t) {
    const ox = snap(pv.x);
    const oy = snap(pv.y);
    const f = pv.face;
    const c = pv.color;
    const lt = lighten(c, 0.45);
    const dk = darken(c, 0.3);
    const air = !pv.ground;
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const step = moving ? Math.floor(pv.run / (Math.PI / 2)) % 2 : 0;
    const out = pv.isIt && Math.floor(t * 8) % 2 ? '#ff2d55' : OUT;
    const P = (x, y, w, h, color) => cell(g, ox, oy, f, x, y, w, h, color);
    const lift = moving && step ? 1 : 0; // one-pixel body bounce while running

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
    const by = air ? -1 : -lift;
    // body: rounded block
    P(3, 1 + by, 10, 16, out);
    P(2, 2 + by, 12, 14, out);
    P(1, 3 + by, 14, 12, out);
    P(3, 2 + by, 10, 14, c);
    P(2, 3 + by, 12, 12, c);
    P(3, 3 + by, 2, 7, lt);
    P(5, 2 + by, 4, 1, lt);
    P(12, 5 + by, 2, 9, dk);
    P(4, 14 + by, 9, 2, dk);
    // little sprout on top
    P(7, -1 + by, 2, 2, out);
    P(9, -2 + by, 3, 2, '#3fbf6b');
    P(9, -2 + by, 2, 1, '#a7f5c0');
    // arms
    if (air) {
      P(0, 4 + by, 2, 4, out);
      P(14, 4 + by, 2, 4, out);
    }
    // face (looks the way it is heading)
    if (pv.blink > 0.5) {
      P(6, 8 + by, 3, 1, OUT);
      P(10, 8 + by, 3, 1, OUT);
    } else {
      P(6, 6 + by, 3, 4, '#ffffff');
      P(10, 6 + by, 3, 4, '#ffffff');
      P(8, 7 + by, 1, 2, OUT);
      P(12, 7 + by, 1, 2, OUT);
    }
    if (pv.isIt) {
      P(5, 5 + by, 2, 1, OUT);
      P(6, 6 + by, 2, 1, OUT);
      P(12, 5 + by, 2, 1, OUT);
      P(11, 6 + by, 2, 1, OUT);
      P(6, 11 + by, 7, 2, OUT);
      P(7, 11 + by, 1, 1, '#ffffff');
      P(9, 11 + by, 1, 1, '#ffffff');
      P(11, 11 + by, 1, 1, '#ffffff');
    } else if (air) {
      P(8, 11 + by, 2, 2, OUT);
    } else {
      P(8, 12 + by, 3, 1, OUT);
    }
  },

  marker(g, cx, cy, t) {
    const x = Math.round(cx);
    const y = Math.round(cy);
    const blink = Math.floor(t * 6) % 2;
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '10px "Press Start 2P", monospace';
    g.lineWidth = 4;
    g.lineJoin = 'miter';
    g.strokeStyle = OUT;
    g.strokeText('IT', x + 1, y - 5);
    g.fillStyle = blink ? '#ffd84d' : '#ffffff';
    g.fillText('IT', x + 1, y - 5);
    // stepped arrow
    g.fillStyle = OUT;
    g.fillRect(x - 8, y + 2, 16, 5);
    g.fillRect(x - 5, y + 7, 10, 4);
    g.fillRect(x - 2, y + 11, 4, 3);
    g.fillStyle = blink ? '#ffd84d' : '#ffffff';
    g.fillRect(x - 6, y + 4, 12, 2);
    g.fillRect(x - 4, y + 6, 8, 2);
    g.fillRect(x - 2, y + 8, 4, 2);
    g.restore();
  },

  front(g, sc) {
    g.drawImage(sc.crt, 0, 0, W, H);
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
      R.flash('#ffffff', 0.5);
      const cols = ['#ffffff', '#ffd84d', to.color, from.color];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * 6.283;
        const v = 120 + (i % 3) * 90;
        R.emit({ x: to.cx, y: to.y + 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 2.5, life: 0.5 + (i % 4) * 0.08, size: i % 2 ? 4 : 2, color: cols[i % 4], fade: false });
      }
    },
  },
};
