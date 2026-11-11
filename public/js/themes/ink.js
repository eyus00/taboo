// INK & SAKURA - sumi-e brush painting on rice paper. Misty mountains, a red
// sun, drifting petals; platforms are single bold brush strokes and the
// players are little wanderers in straw hats.

import { W, H, PW } from '/shared/config.js';
import { rgba, darken, vnoise, hash1, clamp, squashAt } from '../util.js';

const INK = '#1c1b1f';
const PAPER = '#efe6d2';
const RED = '#c8372d';

// ridged noise -> pointy, layered peaks
const ridge = (x, seed) => 1 - Math.abs(2 * vnoise(x, seed) - 1);

function mountain(g, rnd, base, amp, scale, seed, alpha) {
  const yAt = (x) => base - amp * (0.65 * ridge(x / scale, seed) + 0.35 * ridge(x / (scale * 0.37), seed + 5)) ** 1.3;
  let top = base;
  for (let x = 0; x <= W; x += 8) top = Math.min(top, yAt(x));
  const wash = g.createLinearGradient(0, top, 0, base + 70);
  wash.addColorStop(0, rgba('#23232b', alpha));
  wash.addColorStop(0.55, rgba('#23232b', alpha * 0.45));
  wash.addColorStop(1, rgba('#23232b', 0));
  g.fillStyle = wash;
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) g.lineTo(x, yAt(x));
  g.lineTo(W, H);
  g.fill();
  // darker, uneven brush line along the ridge
  g.strokeStyle = rgba(INK, Math.min(0.85, alpha * 1.5));
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  for (let x = 0; x < W; x += 4) {
    const wv = vnoise(x / 60, seed + 9);
    if (wv < 0.28) continue; // dry brush: the line breaks up
    g.lineWidth = 0.5 + (wv - 0.28) * 4;
    g.beginPath();
    g.moveTo(x - 0.5, yAt(x - 0.5));
    g.lineTo(x + 2, yAt(x + 2));
    g.lineTo(x + 4.5, yAt(x + 4.5));
    g.stroke();
  }
  // texture strokes down the slopes
  g.strokeStyle = rgba(INK, alpha * 0.22);
  g.lineWidth = 1;
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W;
    const y = yAt(x) + 5 + rnd() * 26;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 2 + rnd() * 4, y + 6 + rnd() * 12);
    g.stroke();
  }
  return yAt;
}

function blossom(g, x, y, r, rnd) {
  const rot = rnd() * 6.283;
  g.fillStyle = rnd() < 0.5 ? '#f7bccb' : '#ee93ab';
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * 6.283;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.58, r * 0.42, a, 0, 6.283);
    g.fill();
  }
  g.fillStyle = RED;
  g.beginPath();
  g.arc(x, y, r * 0.22, 0, 6.283);
  g.fill();
}

function branch(g, rnd, x, y, ang, len, width, depth) {
  const steps = 5;
  let px = x;
  let py = y;
  let a = ang;
  for (let i = 0; i < steps; i++) {
    a += (rnd() - 0.5) * 0.5;
    const nx = px + Math.cos(a) * (len / steps);
    const ny = py + Math.sin(a) * (len / steps);
    g.strokeStyle = INK;
    g.lineWidth = width * (1 - (i / steps) * 0.5);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(nx, ny);
    g.stroke();
    if (depth > 0 && i > 0 && rnd() < 0.6) {
      branch(g, rnd, nx, ny, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), len * 0.5, width * 0.5, depth - 1);
    }
    if (depth < 2 && rnd() < 0.8) blossom(g, nx + (rnd() - 0.5) * 10, ny + (rnd() - 0.5) * 10, 4 + rnd() * 3, rnd);
    px = nx;
    py = ny;
  }
  blossom(g, px, py, 5 + rnd() * 2, rnd);
}

// One confident stroke of a loaded brush.
function stroke(g, rnd, x, y, w, thick) {
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(x - 2, y + thick * 0.5);
  // top edge: nearly straight (this is the line you stand on)
  g.quadraticCurveTo(x - 1, y - 1, x + 6, y);
  for (let px = x + 12; px < x + w - 6; px += 12) g.lineTo(px, y + (rnd() - 0.5) * 0.9);
  g.lineTo(x + w + 1, y + 0.5);
  // tapered tail
  g.quadraticCurveTo(x + w + 3, y + thick * 0.4, x + w - 2, y + thick * (0.72 + rnd() * 0.2));
  // ragged underside
  for (let px = x + w - 10; px > x + 4; px -= 7 + rnd() * 9) g.lineTo(px, y + thick + (rnd() - 0.5) * 3.2);
  g.quadraticCurveTo(x - 3, y + thick + 1, x - 2, y + thick * 0.5);
  g.fill();
  // dry-brush streaks where the bristles ran out of ink
  g.strokeStyle = rgba(PAPER, 0.5);
  g.lineWidth = 0.9;
  for (let i = 0; i < Math.floor(w / 26); i++) {
    const sx = x + w * (0.35 + rnd() * 0.6);
    const sy = y + 3 + rnd() * (thick - 5);
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(Math.min(x + w - 2, sx + 10 + rnd() * 26), sy + (rnd() - 0.5));
    g.stroke();
  }
}

function drawPlatform(g, rnd, p) {
  if (p.ground) {
    // rock face: ink wash that thins out towards the bottom
    const wash = g.createLinearGradient(0, p.y, 0, p.y + p.h);
    wash.addColorStop(0, rgba('#26262e', 0.86));
    wash.addColorStop(Math.min(0.9, 90 / p.h), rgba('#26262e', 0.5));
    wash.addColorStop(1, rgba('#26262e', 0.22));
    g.fillStyle = wash;
    g.beginPath();
    g.moveTo(p.x, p.y + 4);
    g.lineTo(p.x + p.w, p.y + 4);
    for (let y = p.y + 14; y < p.y + p.h; y += 12) g.lineTo(p.x + p.w + (rnd() - 0.5) * 2, y);
    g.lineTo(p.x + p.w, p.y + p.h);
    g.lineTo(p.x, p.y + p.h);
    for (let y = p.y + p.h - 10; y > p.y + 6; y -= 12) g.lineTo(p.x + (rnd() - 0.5) * 2, y);
    g.closePath();
    g.fill();
    g.save();
    g.clip();
    // vertical brush drag
    for (let i = 0; i < p.w / 5; i++) {
      const x = p.x + rnd() * p.w;
      const len = 20 + rnd() * Math.min(p.h, 150);
      g.strokeStyle = rnd() < 0.3 ? rgba(PAPER, 0.1) : rgba(INK, 0.16);
      g.lineWidth = 1 + rnd() * 2.5;
      g.beginPath();
      g.moveTo(x, p.y + 8 + rnd() * 20);
      g.lineTo(x + (rnd() - 0.5) * 4, p.y + 8 + len);
      g.stroke();
    }
    g.restore();
    // edges
    g.strokeStyle = rgba(INK, 0.75);
    g.lineCap = 'round';
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(p.x + 1, p.y + 6);
    g.lineTo(p.x + 1, p.y + Math.min(p.h, 70));
    g.moveTo(p.x + p.w - 1, p.y + 6);
    g.lineTo(p.x + p.w - 1, p.y + Math.min(p.h, 70));
    g.stroke();
    stroke(g, rnd, p.x, p.y, p.w, 11);
    // grass flicks
    g.strokeStyle = INK;
    g.lineWidth = 1.3;
    for (let x = p.x + 10 + rnd() * 30; x < p.x + p.w - 10; x += 30 + rnd() * 70) {
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(x + k * 2, p.y + 1);
        g.quadraticCurveTo(x + k * 3 - 2, p.y - 6, x + (k - 1) * 6 + (rnd() - 0.5) * 3, p.y - 8 - rnd() * 5);
        g.stroke();
      }
    }
  } else {
    // wet wash bleeding out underneath, then the stroke itself
    const wash = g.createLinearGradient(0, p.y + p.h - 4, 0, p.y + p.h + 22);
    wash.addColorStop(0, rgba('#26262e', 0.32));
    wash.addColorStop(1, rgba('#26262e', 0));
    g.fillStyle = wash;
    g.beginPath();
    g.ellipse(p.x + p.w / 2, p.y + p.h - 2, p.w / 2 - 4, 24, 0, 0, Math.PI);
    g.fill();
    stroke(g, rnd, p.x, p.y, p.w, p.h - 1);
  }
}

export default {
  id: 'ink',
  colors: ['#c8372d', '#2f62b0', '#3c8f57', '#d79a12'],
  letterbox: '#ddd2b8',
  label: {
    font: '600 15px "Cormorant Garamond", Georgia, serif',
    size: 13,
    color: INK,
    stroke: 'rgba(239,230,210,.92)',
    strokeWidth: 4,
    you: RED,
    youFont: '16px "Kaushan Script", cursive',
    stun: RED,
  },
  labelGap: 9,
  hud: {
    font: '"Kaushan Script", cursive',
    weight: 400,
    scale: 1.02,
    labelFont: '"Cormorant Garamond", Georgia, serif',
    labelWeight: 600,
    labelScale: 1.18,
    text: INK,
    dim: 'rgba(60,50,40,.7)',
    warn: RED,
    outline: 'rgba(239,230,210,.88)',
    outlineWidth: 5,
    chip: 'rgba(246,239,223,.92)',
    chipLine: 'rgba(28,27,31,.5)',
    chipIt: RED,
    chipItText: '#fff6e8',
    big: INK,
    bigStroke: 'rgba(239,230,210,.92)',
    radius: 2,
    swatchRadius: 6,
    swatchLine: 'rgba(255,246,232,.85)',
  },

  build(env) {
    const { rnd, arena, layer } = env;
    const bg = layer((g) => {
      g.fillStyle = PAPER;
      g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W * 0.45, H * 0.4, 40, W * 0.45, H * 0.4, 520);
      glow.addColorStop(0, 'rgba(255,250,236,.75)');
      glow.addColorStop(1, 'rgba(255,250,236,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      // paper fibres
      for (let i = 0; i < 1100; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const a = rnd() * 6.283;
        const l = 3 + rnd() * 11;
        g.strokeStyle = `rgba(120,90,50,${0.04 + rnd() * 0.06})`;
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      // the sun: layered so the edge looks like pigment soaking in
      const sx = 626;
      const sy = 120;
      for (let i = 0; i < 6; i++) {
        g.fillStyle = rgba(RED, 0.2);
        g.beginPath();
        g.arc(sx + (rnd() - 0.5) * 3, sy + (rnd() - 0.5) * 3, 54 + (rnd() - 0.5) * 5, 0, 6.283);
        g.fill();
      }
      g.fillStyle = rgba(RED, 0.5);
      g.beginPath();
      g.arc(sx, sy, 51, 0, 6.283);
      g.fill();

      const far = mountain(g, rnd, 345, 190, 210, 11, 0.2);
      // mist between the ranges
      const mist = (y, a) => {
        const m = g.createLinearGradient(0, y - 40, 0, y + 40);
        m.addColorStop(0, rgba(PAPER, 0));
        m.addColorStop(0.5, rgba('#f7f0de', a));
        m.addColorStop(1, rgba(PAPER, 0));
        g.fillStyle = m;
        g.fillRect(0, y - 40, W, 80);
      };
      mist(330, 0.7);
      const mid = mountain(g, rnd, 410, 170, 160, 23, 0.34);
      // a gate on a far-off peak
      {
        const gx = 236;
        const gy = mid(gx) + 3;
        g.fillStyle = rgba(INK, 0.7);
        g.fillRect(gx - 9, gy - 20, 2.4, 20);
        g.fillRect(gx + 7, gy - 20, 2.4, 20);
        g.fillRect(gx - 14, gy - 22, 28.5, 3);
        g.fillRect(gx - 11, gy - 16, 22.5, 2);
      }
      mist(408, 0.65);
      mountain(g, rnd, 480, 130, 120, 37, 0.5);
      mist(486, 0.75);
      void far;

      // birds
      g.strokeStyle = rgba(INK, 0.75);
      g.lineWidth = 1.4;
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const bx = 470 + rnd() * 170;
        const by = 150 + rnd() * 70;
        const s = 4 + rnd() * 4;
        g.beginPath();
        g.moveTo(bx - s, by - s * 0.5);
        g.quadraticCurveTo(bx - s * 0.4, by - s * 0.8, bx, by);
        g.quadraticCurveTo(bx + s * 0.4, by - s * 0.8, bx + s, by - s * 0.5);
        g.stroke();
      }
      // blossom branch reaching in from the corner
      branch(g, rnd, -8, 44, 0.16, 250, 9, 2);
      branch(g, rnd, 30, -6, 0.9, 110, 5, 1);
      // artist's seal
      g.save();
      g.translate(752, 446);
      g.rotate(0.04);
      g.fillStyle = rgba(RED, 0.88);
      g.fillRect(-15, -15, 30, 30);
      g.strokeStyle = PAPER;
      g.lineWidth = 2;
      g.lineCap = 'square';
      g.beginPath();
      g.moveTo(-9, -9);
      g.lineTo(9, -9);
      g.moveTo(0, -9);
      g.lineTo(0, 9);
      g.moveTo(-9, 0);
      g.lineTo(-3, 0);
      g.moveTo(3, 1);
      g.lineTo(9, 1);
      g.moveTo(-9, 9);
      g.lineTo(-3, 6);
      g.moveTo(4, 9);
      g.lineTo(9, 6);
      g.stroke();
      g.restore();
    });

    const plats = layer((g) => {
      for (const p of arena.platforms) drawPlatform(g, rnd, p);
    });

    const shade = layer((g) => {
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.48, W / 2, H / 2, H);
      v.addColorStop(0, 'rgba(110,80,40,0)');
      v.addColorStop(1, 'rgba(110,80,40,.3)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }, 0.5);

    const petals = [];
    for (let i = 0; i < 30; i++) {
      petals.push({ x: rnd() * W, y: rnd() * H, vy: 22 + rnd() * 30, vx: -(10 + rnd() * 26), amp: 10 + rnd() * 22, f: 0.6 + rnd() * 1.2, ph: rnd() * 6.283, s: 2.6 + rnd() * 2.6, light: rnd() < 0.5 });
    }
    return { bg, plats, shade, petals };
  },

  back(g, sc) {
    g.drawImage(sc.bg, 0, 0, W, H);
  },

  platforms(g, sc) {
    g.drawImage(sc.plats, 0, 0, W, H);
  },

  player(g, pv, t) {
    const { x, y, cx, feet, color } = pv;
    squashAt(g, cx, feet, pv.squash);
    const air = !pv.ground;
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const sw = moving ? Math.sin(pv.run) : 0;
    const bob = moving ? Math.abs(Math.cos(pv.run)) * 1.5 : 0;
    const top = y - bob;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    if (pv.isIt) {
      // a restless red smudge behind whoever is "it"
      g.fillStyle = rgba(RED, 0.16 + 0.06 * Math.sin(t * 9));
      g.beginPath();
      g.arc(cx, top + 20, 30 + 2 * Math.sin(t * 7), 0, 6.283);
      g.fill();
    }

    // scarf streaming out behind
    const dir = -pv.face;
    const flow = clamp(Math.abs(pv.vx) / 260, 0.2, 1);
    const lift = clamp(pv.vy / 900, -1, 1) * -9;
    const nx = cx + dir * 7;
    const ny = top + 17;
    const wave = Math.sin(t * 10 + pv.seed);
    const wave2 = Math.sin(t * 10 + pv.seed + 1.7);
    g.strokeStyle = color;
    g.lineWidth = 4.5;
    g.beginPath();
    g.moveTo(nx, ny);
    g.quadraticCurveTo(nx + dir * (10 + 8 * flow), ny - 3 + wave * 3 + lift * 0.4, nx + dir * (16 + 16 * flow), ny + wave2 * 5 + lift);
    g.stroke();
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(nx, ny + 2);
    g.quadraticCurveTo(nx + dir * (8 + 6 * flow), ny + 5 + wave2 * 3 + lift * 0.4, nx + dir * (12 + 12 * flow), ny + 9 + wave * 5 + lift);
    g.stroke();

    // feet: two quick flicks of the brush
    g.strokeStyle = INK;
    g.lineWidth = 3.4;
    g.beginPath();
    if (air) {
      const k = pv.vy < 0 ? 4 : -2;
      g.moveTo(cx - 5, top + 32);
      g.lineTo(cx - 6 - pv.face * k, feet - 4);
      g.moveTo(cx + 5, top + 32);
      g.lineTo(cx + 6 - pv.face * k, feet - 1);
    } else {
      g.moveTo(cx - 5, top + 32);
      g.lineTo(cx - 5 + sw * 7, feet - 1.5 - Math.max(0, sw) * 4);
      g.moveTo(cx + 5, top + 32);
      g.lineTo(cx + 5 - sw * 7, feet - 1.5 - Math.max(0, -sw) * 4);
    }
    g.stroke();

    // robe
    const robe = () => {
      g.beginPath();
      g.moveTo(x + 7, top + 14);
      g.lineTo(x + PW - 7, top + 14);
      g.quadraticCurveTo(x + PW - 1, top + 24, x + PW - 1, top + 35);
      g.quadraticCurveTo(cx, top + 37.5, x + 1, top + 35);
      g.quadraticCurveTo(x + 1, top + 24, x + 7, top + 14);
      g.closePath();
    };
    robe();
    g.fillStyle = color;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = rgba(darken(color, 0.45), 0.55);
    g.beginPath();
    g.moveTo(cx - pv.face * 3, top + 14);
    g.lineTo(cx + pv.face * 14, top + 37);
    g.lineTo(cx + pv.face * 20, top + 37);
    g.lineTo(cx + pv.face * 16, top + 14);
    g.fill();
    g.fillStyle = INK;
    g.fillRect(x, top + 25, PW, 3.6); // sash
    g.restore();
    robe();
    g.strokeStyle = INK;
    g.lineWidth = 1.8;
    g.stroke();

    // face in the shadow of the hat
    g.fillStyle = '#f6eedb';
    g.beginPath();
    g.ellipse(cx + pv.face * 1.5, top + 12.5, 8, 6, 0, 0, 6.283);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.4;
    g.stroke();
    const ex = cx + pv.face * 4;
    const ey = top + 13.5;
    if (pv.isIt) {
      g.strokeStyle = RED;
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(ex - 5.5, ey - 1.5);
      g.lineTo(ex - 1.5, ey + 0.5);
      g.moveTo(ex + 5.5, ey - 1.5);
      g.lineTo(ex + 1.5, ey + 0.5);
      g.stroke();
    } else if (pv.blink < 0.5) {
      g.fillStyle = INK;
      g.beginPath();
      g.arc(ex - 3.3, ey, 1.5, 0, 6.283);
      g.arc(ex + 3.3, ey, 1.5, 0, 6.283);
      g.fill();
    } else {
      g.strokeStyle = INK;
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(ex - 5, ey);
      g.lineTo(ex - 1.5, ey);
      g.moveTo(ex + 1.5, ey);
      g.lineTo(ex + 5, ey);
      g.stroke();
    }

    // straw hat
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(x - 5, top + 9.5);
    g.quadraticCurveTo(cx - 6, top + 2, cx, top - 4);
    g.quadraticCurveTo(cx + 6, top + 2, x + PW + 5, top + 9.5);
    g.quadraticCurveTo(cx, top + 12.5, x - 5, top + 9.5);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(239,230,210,.3)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - 9, top + 6.5);
    g.lineTo(cx - 2, top - 0.5);
    g.moveTo(cx - 14, top + 8.5);
    g.lineTo(cx + 13, top + 8.5);
    g.stroke();
  },

  marker(g, cx, cy, t) {
    // a red seal stamp
    g.save();
    g.translate(cx, cy - 1);
    g.rotate(-0.09 + Math.sin(t * 3) * 0.04);
    g.fillStyle = RED;
    g.fillRect(-12, -12, 24, 22);
    g.strokeStyle = 'rgba(255,246,232,.9)';
    g.lineWidth = 1.2;
    g.strokeRect(-9.5, -9.5, 19, 17);
    g.fillStyle = '#fff6e8';
    g.font = '700 14px "Cormorant Garamond", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('IT', 0, -0.5);
    g.fillStyle = RED;
    g.beginPath();
    g.moveTo(-5, 10);
    g.lineTo(5, 10);
    g.lineTo(0, 15.5);
    g.closePath();
    g.fill();
    g.restore();
  },

  front(g, sc, t) {
    // petals on the wind
    for (let i = 0; i < sc.petals.length; i++) {
      const p = sc.petals[i];
      const y = ((p.y + t * p.vy) % (H + 30)) - 15;
      const x = ((((p.x + t * p.vx + Math.sin(t * p.f + p.ph) * p.amp) % (W + 40)) + W + 40) % (W + 40)) - 20;
      g.save();
      g.translate(x, y);
      g.rotate(t * p.f * 1.4 + p.ph);
      g.fillStyle = p.light ? 'rgba(248,196,210,.9)' : 'rgba(236,140,166,.9)';
      g.beginPath();
      g.ellipse(0, 0, p.s, p.s * (0.35 + 0.3 * Math.abs(Math.sin(t * p.f * 2 + p.ph))), 0, 0, 6.283);
      g.fill();
      g.restore();
    }
    g.drawImage(sc.shade, 0, 0, W, H);
  },

  fx: {
    jump(R, pv) {
      R.emit({ x: pv.cx, y: pv.feet - 3, life: 0.4, size: 6, grow: 26, alpha: 0.2, color: '#26262e', back: true });
      for (let i = 0; i < 4; i++) R.emit({ x: pv.cx + (Math.random() - 0.5) * 16, y: pv.feet - 2, vx: (Math.random() - 0.5) * 120, vy: -30 - Math.random() * 60, g: 700, life: 0.4, size: 1 + Math.random() * 1.6, color: INK });
    },
    land(R, pv, impact) {
      for (const d of [-1, 1]) R.emit({ x: pv.cx + d * 8, y: pv.feet - 3, vx: d * (50 + impact * 60), life: 0.45, size: 5, grow: 22, drag: 4, alpha: 0.22, color: '#26262e' });
      for (let i = 0; i < 4 + impact * 5; i++) {
        const d = i % 2 ? 1 : -1;
        R.emit({ x: pv.cx + d * 8, y: pv.feet - 2, vx: d * (40 + Math.random() * 150), vy: -40 - Math.random() * 90, g: 800, life: 0.45, size: 1 + Math.random() * 2, color: INK });
      }
    },
    step(R, pv) {
      if (Math.random() < 0.6) R.emit({ x: pv.cx - pv.face * 9, y: pv.feet - 2, vx: -pv.face * 40, vy: -40, g: 500, life: 0.3, size: 1 + Math.random(), color: INK });
    },
    respawn(R, pv) {
      for (let i = 0; i < 12; i++) R.emit({ x: pv.cx + (Math.random() - 0.5) * 40, y: Math.random() * 30, vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 80, life: 0.9, size: 2 + Math.random() * 2, color: i % 2 ? '#f7bccb' : '#ee93ab' });
    },
    tag(R, to) {
      R.flash(RED, 0.14);
      const x = to.cx;
      const y = to.y + 18;
      const rot = Math.random() * 6.283;
      // an enso - one sweeping circle of the brush
      R.emit({
        x,
        y,
        life: 0.65,
        fade: false,
        draw(g, p, k) {
          const a = 1 - k;
          const r = 22 + a * 46;
          const sweep = Math.min(1, a * 3) * 5.4;
          g.globalAlpha = k < 0.4 ? k * 2.5 : 1;
          g.strokeStyle = INK;
          g.lineCap = 'round';
          const n = 26;
          for (let i = 0; i < n; i++) {
            const a0 = rot + (i / n) * sweep;
            const a1 = rot + ((i + 1.15) / n) * sweep;
            g.lineWidth = 2 + 7 * Math.sin((i / n) * Math.PI) * (0.7 + 0.3 * hash1(i, 3));
            g.beginPath();
            g.arc(p.x, p.y, r, a0, a1);
            g.stroke();
          }
        },
      });
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * 6.283;
        const v = 90 + Math.random() * 380;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, g: 900, drag: 1.5, life: 0.5 + Math.random() * 0.5, size: 1 + Math.random() * 3.4, color: i % 4 === 0 ? RED : INK });
      }
    },
  },
};
