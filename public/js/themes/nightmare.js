// NIGHTMARE - horror. A graveyard under a sick moon. Fog, lightning, things
// with eyes in the dark, and the players are restless spirits.

import { W, H, PW } from '/shared/config.js';
import { rgba, lighten, darken, vnoise, hash1, clamp, squashAt } from '../util.js';

const BONE = '#d9d4c4';
const BLOOD = '#b3121d';

function tree(g, rnd, x, y, len, ang, width, depth, nodes) {
  const x2 = x + Math.cos(ang) * len;
  const y2 = y + Math.sin(ang) * len;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo((x + x2) / 2 + (rnd() - 0.5) * len * 0.3, (y + y2) / 2 + (rnd() - 0.5) * len * 0.2, x2, y2);
  g.stroke();
  if (depth <= 0 || width < 0.9) return;
  if (depth === 2 && nodes && rnd() < 0.5) nodes.push({ x: x2, y: y2 });
  const kids = depth > 3 ? 2 : 2 + (rnd() < 0.4 ? 1 : 0);
  for (let i = 0; i < kids; i++) {
    const spread = (i - (kids - 1) / 2) * 0.75 + (rnd() - 0.5) * 0.5;
    tree(g, rnd, x2, y2, len * (0.62 + rnd() * 0.2), ang + spread, width * 0.62, depth - 1, nodes);
  }
}

function tombstone(g, x, y, w, h, cross) {
  if (cross) {
    g.fillRect(x - w * 0.12, y - h, w * 0.24, h);
    g.fillRect(x - w * 0.5, y - h * 0.72, w, w * 0.22);
  } else {
    g.beginPath();
    g.moveTo(x - w / 2, y);
    g.lineTo(x - w / 2, y - h * 0.6);
    g.quadraticCurveTo(x - w / 2, y - h, x, y - h);
    g.quadraticCurveTo(x + w / 2, y - h, x + w / 2, y - h * 0.6);
    g.lineTo(x + w / 2, y);
    g.fill();
  }
}

function drawPlatform(g, p, rnd) {
  // cold stone body
  const body = g.createLinearGradient(0, p.y, 0, p.y + Math.min(p.h, 160));
  body.addColorStop(0, '#566669');
  body.addColorStop(1, '#1f282b');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(p.x, p.y);
  g.lineTo(p.x + p.w, p.y);
  if (p.ground) {
    g.lineTo(p.x + p.w, p.y + p.h);
    g.lineTo(p.x, p.y + p.h);
  } else {
    // ragged underside
    let x = p.x + p.w;
    g.lineTo(x, p.y + p.h - 3);
    while (x > p.x + 6) {
      const step = 6 + rnd() * 10;
      const nx = Math.max(p.x, x - step);
      g.lineTo((x + nx) / 2, p.y + p.h + 3 + rnd() * (rnd() < 0.25 ? 20 : 8));
      g.lineTo(nx, p.y + p.h - 2 - rnd() * 2);
      x = nx;
    }
    g.lineTo(p.x, p.y + p.h - 3);
  }
  g.closePath();
  g.fill();

  g.save();
  g.beginPath();
  g.rect(p.x, p.y, p.w, p.h);
  g.clip();
  // brickwork
  g.strokeStyle = 'rgba(5,7,8,.75)';
  g.lineWidth = 1.2;
  g.beginPath();
  let row = 0;
  for (let y = p.y + 13; y < p.y + p.h + 14; y += 14, row++) {
    g.moveTo(p.x, y);
    g.lineTo(p.x + p.w, y);
    for (let x = p.x + (row % 2 ? 14 : 28); x < p.x + p.w; x += 28) {
      g.moveTo(x, y - 14);
      g.lineTo(x, y);
    }
  }
  g.stroke();
  // cracks
  g.strokeStyle = 'rgba(0,0,0,.8)';
  g.lineWidth = 1.4;
  const cracks = Math.max(1, Math.floor(p.w / 90));
  for (let i = 0; i < cracks; i++) {
    let x = p.x + 10 + rnd() * (p.w - 20);
    let y = p.y + 2;
    g.beginPath();
    g.moveTo(x, y);
    const n = p.ground ? 4 + Math.floor(rnd() * 4) : 2;
    for (let k = 0; k < n; k++) {
      x += (rnd() - 0.5) * 16;
      y += 6 + rnd() * 12;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  if (p.ground && p.h > 70) {
    // something buried in the wall
    const n = Math.max(1, Math.floor((p.w * p.h) / 26000));
    for (let i = 0; i < n; i++) {
      const sx = p.x + 24 + rnd() * (p.w - 48);
      const sy = p.y + 40 + rnd() * (p.h - 60);
      g.fillStyle = 'rgba(190,185,165,.22)';
      g.beginPath();
      g.arc(sx, sy, 8, 0, 6.283);
      g.fill();
      g.fillRect(sx - 5, sy + 4, 10, 7);
      g.fillStyle = 'rgba(0,0,0,.75)';
      g.beginPath();
      g.arc(sx - 3, sy - 1, 2.3, 0, 6.283);
      g.arc(sx + 3, sy - 1, 2.3, 0, 6.283);
      g.fill();
      g.fillRect(sx - 0.7, sy + 3, 1.4, 3);
    }
    // darkness creeping up from below
    const dk = g.createLinearGradient(0, p.y + p.h - 90, 0, p.y + p.h);
    dk.addColorStop(0, 'rgba(0,0,0,0)');
    dk.addColorStop(1, 'rgba(0,0,0,.75)');
    g.fillStyle = dk;
    g.fillRect(p.x, p.y + p.h - 90, p.w, 90);
  }
  g.restore();

  // moonlit top edge so you can always read where the ground is
  g.fillStyle = '#c6dad4';
  g.fillRect(p.x, p.y, p.w, 2.5);
  g.fillStyle = 'rgba(198,218,212,.28)';
  g.fillRect(p.x, p.y + 2.5, p.w, 2.5);
  // dead grass
  g.strokeStyle = '#7d9474';
  g.lineWidth = 1.3;
  g.lineCap = 'round';
  g.beginPath();
  for (let x = p.x + 3; x < p.x + p.w - 3; x += 4 + rnd() * 9) {
    const hgt = 3 + rnd() * 7;
    g.moveTo(x, p.y + 1);
    g.lineTo(x + (rnd() - 0.5) * 6, p.y - hgt);
  }
  g.stroke();
  // blood running down an edge
  if (rnd() < 0.7) {
    const bx = rnd() < 0.5 ? p.x + 3 + rnd() * 14 : p.x + p.w - 6 - rnd() * 14;
    g.fillStyle = '#9c1019';
    for (let i = 0; i < 3; i++) {
      const w = 2 + rnd() * 2.5;
      const len = 6 + rnd() * Math.min(26, p.h + 8);
      const x = bx + (i - 1) * 5;
      g.fillRect(x, p.y + 1, w, len);
      g.beginPath();
      g.arc(x + w / 2, p.y + 1 + len, w / 2 + 0.4, 0, 6.283);
      g.fill();
    }
  }
  // roots dangling under floating slabs
  if (!p.ground) {
    g.strokeStyle = 'rgba(31,40,43,.95)';
    g.lineWidth = 1.2;
    for (let i = 0; i < Math.floor(p.w / 30); i++) {
      const x = p.x + 8 + rnd() * (p.w - 16);
      const len = 10 + rnd() * 26;
      g.beginPath();
      g.moveTo(x, p.y + p.h);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 14, p.y + p.h + len * 0.6, x + (rnd() - 0.5) * 10, p.y + p.h + len);
      g.stroke();
    }
  }
}

function bolt(rnd) {
  const pts = [];
  let x = 80 + rnd() * (W - 160);
  let y = -10;
  while (y < 330) {
    pts.push([x, y]);
    x += (rnd() - 0.5) * 60;
    y += 18 + rnd() * 34;
  }
  return pts;
}

export default {
  id: 'nightmare',
  colors: ['#ff5d52', '#62adff', '#72f08f', '#ffe066'],
  letterbox: '#020303',
  label: {
    font: '13px "Special Elite", monospace',
    size: 12,
    color: BONE,
    stroke: 'rgba(0,0,0,.92)',
    strokeWidth: 3.5,
    you: '#ffffff',
    youFont: '20px Creepster, fantasy',
    stun: '#ffe066',
  },
  labelGap: 9,
  hud: {
    font: 'Creepster, fantasy',
    weight: 400,
    scale: 1.18,
    labelFont: '"Special Elite", monospace',
    labelWeight: 400,
    labelScale: 0.95,
    text: '#e9e2cf',
    dim: 'rgba(205,198,180,.55)',
    warn: '#ff2a2a',
    glow: 'rgba(190,10,22,.95)',
    glowBlur: 14,
    chip: 'rgba(6,7,8,.8)',
    chipLine: 'rgba(150,140,120,.32)',
    chipIt: 'rgba(130,8,16,.6)',
    big: '#e9e2cf',
    bigStroke: 'rgba(110,0,0,.75)',
    radius: 2,
    timerDy: 2,
  },

  build(env) {
    const { rnd, arena, layer } = env;
    const eyes = [];
    const nodes = [];
    const windows = [];

    const ridge = (x) => 372 + 34 * vnoise(x / 130, 7) + 12 * vnoise(x / 37, 9);

    const bg = layer((g) => {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#060a10');
      sky.addColorStop(0.5, '#122430');
      sky.addColorStop(1, '#2a4347');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = rgba('#cfd8d5', 0.08 + rnd() * 0.25);
        g.fillRect(rnd() * W, rnd() * 240, 1.2, 1.2);
      }
      // the moon, with a blood-tinged halo
      const mx = 598;
      const my = 122;
      let rg = g.createRadialGradient(mx, my, 40, mx, my, 260);
      rg.addColorStop(0, 'rgba(200,50,45,.42)');
      rg.addColorStop(0.45, 'rgba(120,150,150,.16)');
      rg.addColorStop(1, 'rgba(120,150,150,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#e6dfc6';
      g.beginPath();
      g.arc(mx, my, 62, 0, 6.283);
      g.fill();
      g.save();
      g.clip();
      for (let i = 0; i < 9; i++) {
        g.fillStyle = `rgba(90,84,70,${0.12 + rnd() * 0.16})`;
        g.beginPath();
        g.arc(mx - 55 + rnd() * 110, my - 55 + rnd() * 110, 5 + rnd() * 15, 0, 6.283);
        g.fill();
      }
      rg = g.createRadialGradient(mx - 20, my - 20, 20, mx, my, 70);
      rg.addColorStop(0, 'rgba(255,255,255,.12)');
      rg.addColorStop(1, 'rgba(40,10,10,.45)');
      g.fillStyle = rg;
      g.fillRect(mx - 70, my - 70, 140, 140);
      g.restore();

      // far hills with graves
      g.fillStyle = '#0b171d';
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, ridge(x));
      g.lineTo(W, H);
      g.fill();
      for (let i = 0; i < 16; i++) {
        const x = 20 + rnd() * (W - 40);
        tombstone(g, x, ridge(x) + 3, 9 + rnd() * 7, 14 + rnd() * 12, rnd() < 0.4);
      }
      // a house nobody lives in
      const hx = 150;
      const hy = ridge(hx) + 4;
      g.beginPath();
      g.moveTo(hx - 38, hy);
      g.lineTo(hx - 38, hy - 52);
      g.lineTo(hx - 46, hy - 52);
      g.lineTo(hx - 8, hy - 96);
      g.lineTo(hx + 4, hy - 82);
      g.lineTo(hx + 4, hy - 104);
      g.lineTo(hx + 14, hy - 104);
      g.lineTo(hx + 14, hy - 70);
      g.lineTo(hx + 34, hy - 48);
      g.lineTo(hx + 28, hy - 48);
      g.lineTo(hx + 28, hy);
      g.fill();
      g.beginPath();
      g.moveTo(hx + 28, hy);
      g.lineTo(hx + 28, hy - 76);
      g.lineTo(hx + 41, hy - 110);
      g.lineTo(hx + 54, hy - 76);
      g.lineTo(hx + 54, hy);
      g.fill();
      windows.push({ x: hx - 24, y: hy - 42, w: 9, h: 13 }, { x: hx + 37, y: hy - 70, w: 8, h: 12 });

      // dead trees
      g.strokeStyle = '#04080b';
      g.lineCap = 'round';
      for (const tx of [48, 318, 505, 742]) {
        const base = Math.min(H, ridge(tx) + 60);
        tree(g, rnd, tx + (rnd() - 0.5) * 30, base, 70 + rnd() * 40, -Math.PI / 2 + (rnd() - 0.5) * 0.3, 11 + rnd() * 5, 5, nodes);
      }
      // iron fence
      g.fillStyle = '#040607';
      g.fillRect(0, H - 44, W, 2.5);
      g.fillRect(0, H - 20, W, 2.5);
      for (let x = 4; x < W; x += 13) {
        const hgt = 54 + 4 * Math.sin(x * 0.07);
        g.fillRect(x, H - hgt, 2.4, hgt);
        g.beginPath();
        g.moveTo(x - 2, H - hgt);
        g.lineTo(x + 1.2, H - hgt - 8);
        g.lineTo(x + 4.4, H - hgt);
        g.fill();
      }
      const fog = g.createLinearGradient(0, H - 170, 0, H);
      fog.addColorStop(0, 'rgba(150,180,175,0)');
      fog.addColorStop(1, 'rgba(150,180,175,.3)');
      g.fillStyle = fog;
      g.fillRect(0, H - 170, W, 170);
    });

    // where the eyes can be
    for (const n of nodes.slice(0, 5)) eyes.push({ x: n.x, y: n.y, s: 2.6 + rnd() * 1.4, red: rnd() < 0.3, ph: rnd() * 40 });
    for (const p of arena.platforms) {
      if (!p.ground && rnd() < 0.75) eyes.push({ x: p.x + 20 + rnd() * (p.w - 40), y: p.y + p.h + 16 + rnd() * 10, s: 2.4 + rnd(), red: rnd() < 0.4, ph: rnd() * 40 });
    }
    for (let i = 0; i < 3; i++) {
      const x = 60 + rnd() * (W - 120);
      eyes.push({ x, y: ridge(x) + 30 + rnd() * 40, s: 2.2 + rnd() * 1.6, red: rnd() < 0.3, ph: rnd() * 40 });
    }

    const plats = layer((g) => {
      for (const p of arena.platforms) drawPlatform(g, p, rnd);
    });

    const vignette = layer((g) => {
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.98);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,.8)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }, 0.5);

    // soft fog puff, reused for every wisp
    const puff = document.createElement('canvas');
    puff.width = 256;
    puff.height = 96;
    {
      const g = puff.getContext('2d');
      g.translate(128, 48);
      g.scale(1, 0.375);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 128);
      rg.addColorStop(0, 'rgba(170,190,185,.55)');
      rg.addColorStop(1, 'rgba(170,190,185,0)');
      g.fillStyle = rg;
      g.fillRect(-128, -128, 256, 256);
    }
    const cloud = document.createElement('canvas');
    cloud.width = 256;
    cloud.height = 96;
    {
      const g = cloud.getContext('2d');
      g.translate(128, 48);
      g.scale(1, 0.375);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 128);
      rg.addColorStop(0, 'rgba(4,7,10,.85)');
      rg.addColorStop(0.6, 'rgba(4,7,10,.5)');
      rg.addColorStop(1, 'rgba(4,7,10,0)');
      g.fillStyle = rg;
      g.fillRect(-128, -128, 256, 256);
    }
    const wisps = [];
    for (let i = 0; i < 7; i++) wisps.push({ x: rnd() * W, y: 250 + rnd() * 230, w: 300 + rnd() * 320, h: 70 + rnd() * 80, v: (rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 14), a: 0.1 + rnd() * 0.12 });
    const clouds = [];
    for (let i = 0; i < 4; i++) clouds.push({ x: rnd() * W, y: 60 + rnd() * 120, w: 220 + rnd() * 200, h: 40 + rnd() * 40, v: 5 + rnd() * 8 });

    // film grain tile
    const grain = document.createElement('canvas');
    grain.width = grain.height = 128;
    {
      const g = grain.getContext('2d');
      const img = g.createImageData(128, 128);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = rnd() < 0.5 ? 0 : 255; // black and white specks cancel out: texture without haze
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = Math.floor(rnd() * 15);
      }
      g.putImageData(img, 0, 0);
    }

    // low-res darkness buffer; players punch holes of light into it
    const dark = document.createElement('canvas');
    dark.width = W / 4;
    dark.height = H / 4;

    return {
      bg,
      plats,
      vignette,
      puff,
      cloud,
      wisps,
      clouds,
      grain,
      dark,
      darkCtx: dark.getContext('2d'),
      eyes,
      windows,
      rnd,
      nextBolt: 4 + rnd() * 6,
      boltAt: -10,
      bolt: null,
      wispT: [0, 0, 0, 0],
    };
  },

  back(g, sc, t, view, pvs) {
    g.drawImage(sc.bg, 0, 0, W, H);

    // lightning
    if (sc.t0 == null) sc.t0 = t;
    const lt = t - sc.t0;
    if (lt > sc.nextBolt) {
      sc.boltAt = lt;
      sc.bolt = bolt(Math.random);
      sc.nextBolt = lt + 7 + Math.random() * 12;
    }
    const since = lt - sc.boltAt;
    sc.flash = since < 0.5 ? Math.max(0, 1 - since / 0.1) + (since > 0.16 ? Math.max(0, 1 - (since - 0.16) / 0.3) * 0.7 : 0) : 0;
    if (sc.flash > 0.05 && sc.bolt) {
      g.strokeStyle = `rgba(225,235,255,${Math.min(1, sc.flash)})`;
      g.lineWidth = 2.2;
      g.lineJoin = 'round';
      g.beginPath();
      sc.bolt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }

    // clouds sliding across the moon
    for (const c of sc.clouds) {
      const x = ((c.x + t * c.v) % (W + c.w * 1.4)) - c.w * 1.2;
      g.drawImage(sc.cloud, x, c.y - c.h / 2, c.w, c.h);
      g.drawImage(sc.cloud, x + c.w * 0.35, c.y - c.h * 0.2, c.w * 0.8, c.h * 0.8);
      g.drawImage(sc.cloud, x - c.w * 0.2, c.y - c.h * 0.1, c.w * 0.7, c.h * 0.7);
    }

    // a light left on in the house
    for (let i = 0; i < sc.windows.length; i++) {
      const w = sc.windows[i];
      const a = 0.35 + 0.5 * vnoise(t * 6 + i * 20, 3);
      g.fillStyle = `rgba(255,150,50,${a})`;
      g.fillRect(w.x, w.y, w.w, w.h);
      g.fillStyle = '#05080a';
      g.fillRect(w.x + w.w / 2 - 0.6, w.y, 1.2, w.h);
      g.fillRect(w.x, w.y + w.h / 2 - 0.6, w.w, 1.2);
    }

    // eyes in the dark: they open, look at whoever is nearest, and close again
    for (let i = 0; i < sc.eyes.length; i++) {
      const e = sc.eyes[i];
      const cyc = Math.sin(t * 0.45 + e.ph);
      const vis = clamp((cyc - 0.15) * 3, 0, 1);
      if (vis <= 0) continue;
      const blink = hash1(Math.floor(t * 2.5 + e.ph * 3), i) < 0.1 ? 0.15 : 1;
      let lx = 0;
      let best = 1e9;
      for (const p of pvs) {
        const d = Math.abs(p.cx - e.x) + Math.abs(p.y - e.y);
        if (d < best) {
          best = d;
          lx = clamp((p.cx - e.x) / 120, -1, 1);
        }
      }
      const col = e.red ? '255,50,40' : '240,226,150';
      const gap = e.s * 2.1;
      for (const sx of [-gap, gap]) {
        g.fillStyle = `rgba(${col},${0.18 * vis})`;
        g.beginPath();
        g.ellipse(e.x + sx, e.y, e.s * 2.3, e.s * 1.9, 0, 0, 6.283);
        g.fill();
        g.fillStyle = `rgba(${col},${vis})`;
        g.beginPath();
        g.ellipse(e.x + sx, e.y, e.s, Math.max(0.4, e.s * 0.62 * blink * vis), 0, 0, 6.283);
        g.fill();
        if (blink > 0.5 && vis > 0.6) {
          g.fillStyle = '#000';
          g.fillRect(e.x + sx + lx * e.s * 0.5 - 0.5, e.y - e.s * 0.55, 1, e.s * 1.1);
        }
      }
    }
  },

  platforms(g, sc) {
    g.drawImage(sc.plats, 0, 0, W, H);
  },

  player(g, pv, t) {
    const { x, y, cx, feet, color } = pv;
    squashAt(g, cx, feet, pv.squash);
    const hover = pv.ground ? Math.sin(t * 4 + pv.seed) * 1.2 : 0;
    const lean = clamp(pv.vx / 260, -1, 1) * 5;
    const left = x + 1;
    const right = x + PW - 1;
    const hem = feet - 3 + hover;
    const top = y + hover;

    g.beginPath();
    g.moveTo(left, top + 17);
    g.bezierCurveTo(left, top - 6, right, top - 6, right, top + 17);
    g.lineTo(right - lean * 0.4, hem - 5);
    const n = 4;
    const w = (right - left) / n;
    for (let i = 0; i < n; i++) {
      const x0 = right - i * w - lean;
      const ph = t * 8 + i * 1.9 + pv.seed;
      g.quadraticCurveTo(x0 - w / 2, hem + 3 + 3 * Math.sin(ph), x0 - w, hem - 5 + 2 * Math.sin(ph + 1.3));
    }
    g.lineTo(left, top + 17);
    g.closePath();
    const grad = g.createLinearGradient(0, top, 0, feet);
    grad.addColorStop(0, lighten(color, 0.35));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, rgba(darken(color, 0.55), 0.5));
    g.shadowColor = pv.isIt ? '#ff1414' : color;
    g.shadowBlur = pv.isIt ? 20 + 6 * Math.sin(t * 9) : 12;
    g.fillStyle = grad;
    g.fill();
    g.shadowBlur = 0;

    // face: hollow sockets
    const ex = cx + pv.face * 4;
    const ey = top + 15;
    const open = 1 - pv.blink;
    g.fillStyle = '#050607';
    if (pv.isIt) {
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(ex + s * 10, ey - 5);
        g.lineTo(ex + s * 2, ey - 0.5);
        g.lineTo(ex + s * 3, ey + 4);
        g.lineTo(ex + s * 9.5, ey + 2.5);
        g.closePath();
        g.fill();
      }
      // jagged grin
      g.beginPath();
      g.moveTo(ex - 8, ey + 8);
      for (let i = 0; i <= 8; i++) g.lineTo(ex - 8 + i * 2, ey + 8 + (i % 2 ? 3.2 : 0));
      for (let i = 8; i >= 0; i--) g.lineTo(ex - 8 + i * 2, ey + 12 + (i % 2 ? 0 : 2.6));
      g.closePath();
      g.fill();
      g.fillStyle = '#ff2a1f';
      g.shadowColor = '#ff2a1f';
      g.shadowBlur = 6;
      g.fillRect(ex - 6.5 + pv.face, ey - 0.5, 2.2, 2.2);
      g.fillRect(ex + 4.3 + pv.face, ey - 0.5, 2.2, 2.2);
      g.shadowBlur = 0;
    } else {
      g.beginPath();
      g.ellipse(ex - 5.5, ey, 3.7, 0.7 + 4.6 * open, 0, 0, 6.283);
      g.ellipse(ex + 5.5, ey, 3.7, 0.7 + 4.6 * open, 0, 0, 6.283);
      g.fill();
      g.beginPath();
      g.ellipse(ex, ey + 10.5, 2.3, pv.ground ? 2.6 : 4, 0, 0, 6.283);
      g.fill();
      if (open > 0.5) {
        g.fillStyle = '#ffffff';
        g.fillRect(ex - 6.3 + pv.face * 1.3, ey - 2, 1.7, 1.7);
        g.fillRect(ex + 4.7 + pv.face * 1.3, ey - 2, 1.7, 1.7);
      }
    }
  },

  marker(g, cx, cy, t) {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '26px Creepster, fantasy';
    g.lineWidth = 5;
    g.strokeStyle = '#000';
    g.strokeText('IT', cx, cy);
    g.shadowColor = '#ff0000';
    g.shadowBlur = 12;
    g.fillStyle = '#d3131f';
    g.fillText('IT', cx, cy);
    g.shadowBlur = 0;
    // it drips
    for (let i = 0; i < 2; i++) {
      const ph = (t * 0.9 + i * 0.5) % 1;
      const x = cx - 5 + i * 9;
      g.fillRect(x, cy + 8, 2, 2 + ph * 5);
      g.globalAlpha = 1 - ph;
      g.beginPath();
      g.arc(x + 1, cy + 11 + ph * 16, 1.5, 0, 6.283);
      g.fill();
      g.globalAlpha = 1;
    }
    g.restore();
  },

  front(g, sc, t, view, pvs) {
    // drifting fog
    for (const w of sc.wisps) {
      const span = W + w.w;
      const x = ((((w.x + t * w.v) % span) + span) % span) - w.w;
      g.globalAlpha = w.a * (0.7 + 0.3 * Math.sin(t * 0.5 + w.y));
      g.drawImage(sc.puff, x, w.y - w.h / 2, w.w, w.h);
    }
    g.globalAlpha = 1;

    // darkness, with a pool of light around every spirit
    const d = sc.darkCtx;
    const flash = sc.flash || 0;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W / 4, H / 4);
    d.fillStyle = `rgba(0,2,5,${0.66 * (1 - Math.min(1, flash) * 0.85)})`;
    d.fillRect(0, 0, W / 4, H / 4);
    d.globalCompositeOperation = 'destination-out';
    for (const p of pvs) {
      const r = (p.local ? 200 : 150) / 4;
      const px = p.cx / 4;
      const py = (p.y + 18) / 4;
      const rg = d.createRadialGradient(px, py, 2, px, py, r);
      rg.addColorStop(0, 'rgba(0,0,0,1)');
      rg.addColorStop(0.5, 'rgba(0,0,0,.6)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = rg;
      d.fillRect(px - r, py - r, r * 2, r * 2);
    }
    {
      const rg = d.createRadialGradient(598 / 4, 122 / 4, 4, 598 / 4, 122 / 4, 46);
      rg.addColorStop(0, 'rgba(0,0,0,.8)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = rg;
      d.fillRect(598 / 4 - 46, 122 / 4 - 46, 92, 92);
    }
    g.drawImage(sc.dark, 0, 0, W, H);

    // each spirit throws a little light of its own colour
    g.globalCompositeOperation = 'lighter';
    for (const p of pvs) {
      const r = 95;
      const py = p.y + 18;
      const rg = g.createRadialGradient(p.cx, py, 4, p.cx, py, r);
      rg.addColorStop(0, rgba(p.isIt ? '#ff2a1f' : p.color, 0.2));
      rg.addColorStop(1, rgba(p.isIt ? '#ff2a1f' : p.color, 0));
      g.fillStyle = rg;
      g.fillRect(p.cx - r, py - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';

    if (flash > 0.02) {
      g.fillStyle = `rgba(200,215,255,${0.22 * Math.min(1, flash)})`;
      g.fillRect(0, 0, W, H);
    }
    g.drawImage(sc.vignette, 0, 0, W, H);
    // grain
    const ox = Math.floor(Math.random() * 128);
    const oy = Math.floor(Math.random() * 128);
    for (let y = -oy; y < H; y += 128) for (let x = -ox; x < W; x += 128) g.drawImage(sc.grain, x, y);
  },

  fx: {
    trail(R, pv, dt, t) {
      const sc = R.scene;
      if (t - sc.wispT[pv.slot] < (Math.abs(pv.vx) > 60 || !pv.ground ? 0.05 : 0.22)) return;
      sc.wispT[pv.slot] = t;
      R.emit({
        x: pv.cx + (Math.random() - 0.5) * 16,
        y: pv.feet - 6 - Math.random() * 16,
        vx: -pv.vx * 0.08 + (Math.random() - 0.5) * 14,
        vy: -12 - Math.random() * 18,
        life: 0.5 + Math.random() * 0.3,
        size: 5 + Math.random() * 4,
        grow: -6,
        alpha: 0.28,
        color: pv.isIt ? '#ff3b30' : pv.color,
        back: true,
      });
    },
    jump(R, pv) {
      for (let i = 0; i < 5; i++) R.emit({ x: pv.cx + (Math.random() - 0.5) * 22, y: pv.feet - 2, vx: (Math.random() - 0.5) * 70, vy: -8 - Math.random() * 20, life: 0.5, size: 5, grow: 14, alpha: 0.22, color: '#aebfba', back: true });
    },
    land(R, pv, impact) {
      for (let i = 0; i < 6 + impact * 6; i++) {
        const dir = i % 2 ? 1 : -1;
        R.emit({ x: pv.cx + dir * 6, y: pv.feet - 2, vx: dir * (40 + Math.random() * 110), vy: -6 - Math.random() * 14, drag: 3, life: 0.55, size: 4, grow: 16, alpha: 0.22, color: '#aebfba' });
      }
    },
    respawn(R, pv) {
      for (let i = 0; i < 14; i++) R.emit({ x: pv.cx + (Math.random() - 0.5) * 30, y: Math.random() * 60, vy: 30 + Math.random() * 60, life: 0.7, size: 6, grow: 10, alpha: 0.25, color: pv.color });
    },
    tag(R, to, from) {
      R.flash('#a00010', 0.42);
      R.shake(14);
      const x = to.cx;
      const y = to.y + 18;
      // blood
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * 6.283;
        const v = 80 + Math.random() * 300;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, g: 900, life: 0.5 + Math.random() * 0.5, size: 1.5 + Math.random() * 2.5, color: i % 3 ? BLOOD : '#5e0a10' });
      }
      // a burst of bats
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const v = 140 + Math.random() * 160;
        R.emit({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          drag: 0.6,
          life: 1 + Math.random() * 0.6,
          size: 5 + Math.random() * 4,
          rot: Math.random() * 6,
          fade: false,
          draw(g, p, k) {
            const flap = Math.sin(p.age * 34 + p.rot) * p.size * 0.7;
            g.globalAlpha = Math.min(1, k * 3);
            g.fillStyle = '#020303';
            g.beginPath();
            g.moveTo(p.x, p.y + 1.5);
            g.quadraticCurveTo(p.x - p.size * 0.6, p.y - flap * 0.3, p.x - p.size * 1.4, p.y - flap);
            g.lineTo(p.x - p.size * 0.6, p.y + 2);
            g.lineTo(p.x, p.y + 3.5);
            g.lineTo(p.x + p.size * 0.6, p.y + 2);
            g.lineTo(p.x + p.size * 1.4, p.y - flap);
            g.quadraticCurveTo(p.x + p.size * 0.6, p.y - flap * 0.3, p.x, p.y + 1.5);
            g.fill();
          },
        });
      }
      R.emit({ x, y, life: 0.5, size: 6, grow: 260, shape: 'ring', width: 3, color: from.color, alpha: 0.6 });
    },
  },
};
