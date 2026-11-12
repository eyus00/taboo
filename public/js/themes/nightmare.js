// NIGHTMARE - horror. A graveyard under a sick moon. Fog, lightning, things
// with eyes in the dark, and the players are restless spirits.
//
// The graveyard and its darkness are painted once. Each frame only adds a few
// small things that move: eyes, bats, wisps of mist, now and then a bolt of
// lightning. Every spirit carries a pre-rendered pool of light.

import { ART_W as W, ART_H as H, PW } from '/shared/config.js';
import { rgba, lighten, vnoise, hash1, clamp, squashAt, drawIcon, KIND_COLORS, PORTAL_COLORS } from '../util.js';

const BONE = '#d9d4c4';
const BLOOD = '#b3121d';
const EMBER = '#ff2a1f'; // whoever is "it" burns this colour
const VOID = '#050607';
const AIR = '#b4f2d6'; // updraft columns: cold breath from below
const COLORS = ['#ff5d52', '#62adff', '#72f08f', '#ffe066', '#c59bff', '#ff9bd0'];
const MOON = [598, 122];
const SLAB = 14; // how thick ledges and slopes are
const LIP = 16; // flat bit at a loose end of a slope (a player's centre rides the slope, so half of them hangs over)
const COURSE = 40 / 3; // one row of bricks: three rows to a tile, so rows line up from block to block

// Canvas pixels per unit: glow is sized with this so it looks the same on every screen.
const unit = (g) => g.getTransform().a;

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

// A soft blob of colour fading out to nothing (mist, cloud, light).
function puff(g, x, y, rx, ry, color, alpha) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  rg.addColorStop(0, rgba(color, alpha));
  rg.addColorStop(0.6, rgba(color, alpha * 0.45));
  rg.addColorStop(1, rgba(color, 0));
  g.fillStyle = rg;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

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

// Rows of bricks filling a box; rows and joints sit on a grid shared by all stonework.
function bricks(g, x, y, w, h) {
  g.strokeStyle = 'rgba(5,7,8,.75)';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let row = Math.floor(y / COURSE + 0.01) + 1; row * COURSE < y + h + 0.5; row++) {
    const ly = row * COURSE;
    g.moveTo(x, ly);
    g.lineTo(x + w, ly);
    const shift = row % 2 ? 14 : 0;
    for (let bx = Math.floor((x - shift) / 28) * 28 + shift + 28; bx < x + w; bx += 28) {
      g.moveTo(bx, ly - COURSE);
      g.lineTo(bx, ly);
    }
  }
  g.stroke();
}

// Moonlit edge and dead grass along a top surface, so you can always read where the ground is.
function turf(g, x0, x1, y, rnd) {
  g.fillStyle = '#c6dad4';
  g.fillRect(x0, y, x1 - x0, 2.5);
  g.fillStyle = 'rgba(198,218,212,.28)';
  g.fillRect(x0, y + 2.5, x1 - x0, 2.5);
  g.strokeStyle = '#7d9474';
  g.lineWidth = 1.3;
  g.lineCap = 'round';
  g.beginPath();
  for (let x = x0 + 3; x < x1 - 3; x += 4 + rnd() * 9) {
    const hgt = 3 + rnd() * 7;
    g.moveTo(x, y + 1);
    g.lineTo(x + (rnd() - 0.5) * 6, y - hgt);
  }
  g.stroke();
}

// Blood running down from a top edge.
function drips(g, bx, y, reach, rnd) {
  g.fillStyle = '#9c1019';
  for (let i = 0; i < 3; i++) {
    const w = 2 + rnd() * 2.5;
    const len = 6 + rnd() * reach;
    const x = bx + (i - 1) * 5;
    g.fillRect(x, y + 1, w, len);
    g.beginPath();
    g.arc(x + w / 2, y + 1 + len, w / 2 + 0.4, 0, 6.283);
    g.fill();
  }
}

// A thin slab of old stonework with a ragged underside.
function ledge(g, x, y, w, rnd, plain) {
  const body = g.createLinearGradient(0, y, 0, y + SLAB);
  body.addColorStop(0, '#566669');
  body.addColorStop(1, '#1f282b');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  let px = x + w;
  g.lineTo(px, y + SLAB - 3);
  while (px > x + 6) {
    const nx = Math.max(x, px - 6 - rnd() * 10);
    g.lineTo((px + nx) / 2, y + SLAB + 3 + rnd() * (rnd() < 0.25 ? 20 : 8));
    g.lineTo(nx, y + SLAB - 2 - rnd() * 2);
    px = nx;
  }
  g.lineTo(x, y + SLAB - 3);
  g.closePath();
  g.fill();

  g.save();
  g.beginPath();
  g.rect(x, y, w, SLAB);
  g.clip();
  bricks(g, x, y, w, SLAB);
  if (!plain) {
    g.strokeStyle = 'rgba(0,0,0,.8)';
    g.lineWidth = 1.4;
    for (let i = 0; i < Math.max(1, Math.floor(w / 90)); i++) {
      let cx = x + 10 + rnd() * (w - 20);
      let cy = y + 2;
      g.beginPath();
      g.moveTo(cx, cy);
      for (let k = 0; k < 2; k++) {
        cx += (rnd() - 0.5) * 16;
        cy += 6 + rnd() * 12;
        g.lineTo(cx, cy);
      }
      g.stroke();
    }
  }
  g.restore();

  turf(g, x, x + w, y, rnd);
  if (plain) return;
  if (rnd() < 0.7) drips(g, rnd() < 0.5 ? x + 3 + rnd() * 14 : x + w - 6 - rnd() * 14, y, 22, rnd);
  // roots dangling underneath
  g.strokeStyle = 'rgba(31,40,43,.95)';
  g.lineWidth = 1.2;
  for (let i = 0; i < Math.floor(w / 30); i++) {
    const rx = x + 8 + rnd() * (w - 16);
    const len = 10 + rnd() * 26;
    g.beginPath();
    g.moveTo(rx, y + SLAB);
    g.quadraticCurveTo(rx + (rnd() - 0.5) * 14, y + SLAB + len * 0.6, rx + (rnd() - 0.5) * 10, y + SLAB + len);
    g.stroke();
  }
}

// A solid block of the crypt wall, any height.
function block(g, p, rnd, arena) {
  const open = openTop(p, arena);
  g.fillStyle = '#222c2f';
  g.fillRect(p.x, p.y, p.w, p.h);
  // moonlight soaks a little way down from the open top
  const depth = Math.min(p.h, 150);
  const lit = g.createLinearGradient(0, p.y, 0, p.y + depth);
  lit.addColorStop(0, '#566669');
  lit.addColorStop(1, 'rgba(86,102,105,0)');
  g.fillStyle = lit;
  for (const [a, b] of open) g.fillRect(a, p.y, b - a, depth);

  g.save();
  g.beginPath();
  g.rect(p.x, p.y, p.w, p.h);
  g.clip();
  bricks(g, p.x, p.y, p.w, p.h);
  // cracks running down from the surface
  g.strokeStyle = 'rgba(0,0,0,.8)';
  g.lineWidth = 1.4;
  for (const [a, b] of open) {
    for (let i = 0; i < Math.max(1, Math.floor((b - a) / 90)); i++) {
      let cx = a + 10 + rnd() * (b - a - 20);
      let cy = p.y + 2;
      g.beginPath();
      g.moveTo(cx, cy);
      for (let k = 4 + Math.floor(rnd() * 4); k > 0; k--) {
        cx += (rnd() - 0.5) * 16;
        cy += 6 + rnd() * 12;
        g.lineTo(cx, cy);
      }
      g.stroke();
    }
  }
  if (p.h > 70) {
    // something buried in the wall
    for (let i = Math.max(1, Math.floor((p.w * p.h) / 26000)); i > 0; i--) {
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
  }
  if (p.y + p.h >= arena.h - 1) {
    // darkness creeping up from below
    const rise = Math.min(140, p.h * 0.75);
    const dk = g.createLinearGradient(0, p.y + p.h - rise, 0, p.y + p.h);
    dk.addColorStop(0, 'rgba(0,0,0,0)');
    dk.addColorStop(1, 'rgba(0,0,0,.75)');
    g.fillStyle = dk;
    g.fillRect(p.x, p.y + p.h - rise, p.w, rise);
  }
  g.restore();

  for (const [a, b] of open) {
    turf(g, a, b, p.y, rnd);
    if (rnd() < 0.7) drips(g, rnd() < 0.5 ? a + 3 + rnd() * 14 : b - 6 - rnd() * 14, p.y, 26, rnd);
  }
}

// A soft round light filling a box of the given size.
function light(g, size, color, alpha) {
  const r = size / 2;
  const rg = g.createRadialGradient(r, r, 0, r, r, r);
  rg.addColorStop(0, rgba(color, alpha));
  rg.addColorStop(0.4, rgba(color, alpha * 0.45));
  rg.addColorStop(1, rgba(color, 0));
  g.fillStyle = rg;
  g.fillRect(0, 0, size, size);
}

// How a wisp left behind by a spirit is drawn: its baked blob of light, on whole pixels.
function stampWisp(g, p) {
  const s = p.wisp;
  g.drawImage(s.c, Math.round((p.x - s.w / 2) * p.k) / p.k, Math.round((p.y - s.h / 2) * p.k) / p.k, s.w, s.h);
}

// Everything in the arena as boxes [x0, y0, x1, y1], with a little room around each.
function boxes(arena) {
  const out = [];
  for (const p of arena.platforms) out.push([p.x - 6, p.y - 12, p.x + p.w + 6, p.y + p.h + (p.ground ? 0 : 30)]);
  for (const r of arena.ramps) out.push([r.x0 - LIP - 6, Math.min(r.y0, r.y1) - 12, r.x1 + LIP + 6, Math.max(r.y0, r.y1) + SLAB + 30]);
  for (const po of arena.portals) out.push([po.cx - 46, po.cy - 56, po.cx + 46, po.cy + 56]);
  for (const tr of arena.tramps) out.push([tr.x - 10, tr.y - 34, tr.x + tr.w + 10, tr.y + tr.h]);
  for (const z of arena.lifts) out.push([z.x, z.y, z.x + z.w, z.y + z.h]);
  return out;
}

export default {
  id: 'nightmare',
  colors: COLORS,
  letterbox: '#020303',
  lift: AIR,
  label: {
    font: '13px "Special Elite", monospace',
    color: BONE,
    stroke: 'rgba(0,0,0,.92)',
    strokeWidth: 3.5,
    you: '#ffffff',
    gap: 9,
  },

  build(env) {
    const { rnd, layer, sprite, arena } = env;
    const nodes = [];
    const windows = [];
    const [mx, my] = MOON;

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
      // rags of cloud dragged across the sky
      for (const [cx, cy, cw] of [[mx - 30, my + 34, 150], [mx + 90, my - 30, 120], [250, 90, 170], [90, 170, 130], [430, 200, 110]]) {
        puff(g, cx, cy, cw, cw * 0.16, '#04070a', 0.8);
        puff(g, cx + cw * 0.4, cy + 9, cw * 0.7, cw * 0.12, '#04070a', 0.7);
        puff(g, cx - cw * 0.45, cy - 6, cw * 0.6, cw * 0.1, '#04070a', 0.6);
      }

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
      // a light left on
      for (const w of [{ x: hx - 24, y: hy - 42, w: 9, h: 13 }, { x: hx + 37, y: hy - 70, w: 8, h: 12 }]) {
        windows.push(w);
        g.fillStyle = 'rgba(255,150,50,.5)';
        g.fillRect(w.x, w.y, w.w, w.h);
        g.fillStyle = '#05080a';
        g.fillRect(w.x + w.w / 2 - 0.6, w.y, 1.2, w.h);
        g.fillRect(w.x, w.y + w.h / 2 - 0.6, w.w, 1.2);
      }

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

      // the dark: everything away from the moon sinks into it
      const dk = g.createRadialGradient(mx, my, 70, mx, my, 560);
      dk.addColorStop(0, 'rgba(0,2,5,0)');
      dk.addColorStop(0.5, 'rgba(0,2,5,.42)');
      dk.addColorStop(1, 'rgba(0,2,5,.6)');
      g.fillStyle = dk;
      g.fillRect(0, 0, W, H);
    });

    // laid over the stonework too: banks of fog, dark corners, film grain
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
    const shade = layer((g) => {
      for (let i = 0; i < 7; i++) {
        const w = 150 + rnd() * 160;
        puff(g, rnd() * W, 270 + rnd() * 210, w, 18 + rnd() * 20, '#aabeb9', 0.1 + rnd() * 0.1);
      }
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.98);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,.8)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 128) for (let x = 0; x < W; x += 128) g.drawImage(grain, x, y);
    });

    // where eyes could open: up in the trees and down among the graves
    const eyes = [];
    for (const n of nodes) eyes.push({ x: n.x, y: n.y, s: 1.7 + rnd() * 0.9, red: rnd() < 0.3, ph: rnd() * 40 });
    for (let i = 0; i < 10; i++) {
      const x = 40 + rnd() * (W - 80);
      eyes.push({ x, y: ridge(x) + 30 + rnd() * 40, s: 1.5 + rnd() * 0.9, red: rnd() < 0.3, ph: rnd() * 40 });
    }

    const bats = [];
    for (let i = 0; i < 3; i++) bats.push({ x: rnd() * W, y: my - 50 + i * 45, v: (i % 2 ? -1 : 1) * (26 + rnd() * 22), f: 0.8 + rnd(), ph: rnd() * 6, s: 4.5 + rnd() * 2 });

    // Sprites are stamped pixel for pixel on whole pixels, which costs next to nothing.
    // k = sprite pixels per world unit; sizes are trimmed to a whole number of pixels.
    let k = 1;
    sprite(1, 1, (g) => (k = unit(g)));
    const whole = (size) => (Math.ceil(size * k) - 0.5) / k;
    const bake = (w, h, draw) => {
      const c = sprite(whole(w), whole(h), draw);
      return { c, w: c.width / k, h: c.height / k };
    };
    const wisps = [140, 170].map((w) => bake(w, w * 0.29, (g) => puff(g, w / 2, w * 0.145, w / 2, w * 0.145, '#aabeb9', 0.3)));

    // wisps of mist that creep back and forth along open ground (world positions)
    const beds = [];
    for (const p of arena.platforms) {
      if (p.ground) for (const [a, b] of openTop(p, arena)) if (b - a > 280) beds.push([a, b, p.y]);
    }
    const mist = [];
    for (let i = 0; i < 6 && beds.length; i++) {
      const [a, b, y] = beds[i % beds.length];
      mist.push({ a: a + 70, len: b - a - 140, y: y - 34 + rnd() * 12, wisp: wisps[i % 2], v: 9 + rnd() * 14, ph: rnd() * 2 });
    }

    return {
      bg,
      shade,
      eyes,
      windows,
      bats,
      mist,
      arena,
      solid: boxes(arena),
      k,
      // light sprites: every spirit's own pool of light (a wider one for you) and the wisps it leaves behind,
      // two sizes of red for whoever is "it", one for the toadstools
      pal: COLORS.map((c) => ({
        glow: bake(96, 96, (g) => light(g, 96, c, 0.42)),
        mine: bake(116, 116, (g) => light(g, 116, c, 0.42)),
        wisp: bake(22, 22, (g) => light(g, 22, c, 0.5)),
        hi: lighten(c, 0.45),
      })),
      itGlow: [124, 138].map((d) => bake(d, d, (g) => light(g, d, EMBER, 0.7))),
      itWisp: bake(22, 22, (g) => light(g, 22, '#ff3b30', 0.55)),
      capGlow: sprite(64, 64, (g) => light(g, 64, '#ff2a2a', 0.5)),
      seen: COLORS.map(() => ({ x: 0, y: 0, t: -9 })), // where each spirit was last drawn
      wispT: COLORS.map(() => 0),
      nextBolt: null,
      boltAt: -9,
      flashed: -9,
      bolt: [],
    };
  },

  back(g, sc) {
    sc.art = g.getTransform(); // remembered so decor() can work out where the world sits on the art board
    g.drawImage(sc.bg, 0, 0, W, H);
  },

  platform(g, p, i, rnd, arena) {
    if (p.ground) block(g, p, rnd, arena);
    else ledge(g, p.x, p.y, p.w, rnd);
  },

  // A slope is a ledge sheared along the incline, so its roots and drips still hang straight down.
  ramp(g, r, i, rnd, arena) {
    // where the low end lands on a solid block, the slab tapers into it instead of sinking in
    const [lx, ly] = r.y0 > r.y1 ? [r.x0, r.y0] : [r.x1, r.y1];
    const floor = arena.platforms.find((p) => p.ground && Math.abs(p.y - ly) < 1 && p.x <= lx && p.x + p.w >= lx);
    if (floor) {
      g.beginPath();
      g.rect(r.x0 - 80, floor.y - 4000, r.x1 - r.x0 + 160, 4000);
      g.clip();
    }
    // a short flat lip wherever an end hangs loose
    if (!meets(arena, r.x0 - LIP, r.x0, r.y0)) ledge(g, r.x0 - LIP, r.y0, LIP + 3, rnd, true);
    if (!meets(arena, r.x1, r.x1 + LIP, r.y1)) ledge(g, r.x1 - 3, r.y1, LIP + 3, rnd, true);
    g.translate(r.x0, r.y0);
    g.transform(1, (r.y1 - r.y0) / (r.x1 - r.x0), 0, 1, 0, 0);
    ledge(g, 0, 0, r.x1 - r.x0, rnd);
  },

  // Cold light under the updrafts. Also works out what the animated things may use.
  decor(g, sc, arena) {
    // world (x, y) sits at art-board (wx + x * k, wy + y * k)
    const m = g.getTransform();
    const k = m.a / sc.art.a;
    const wx = (m.e - sc.art.e) / sc.art.a;
    const wy = (m.f - sc.art.f) / sc.art.d;
    sc.world = { k, x: wx, y: wy };

    // eyes and the lit windows are drawn on top of the picture, so only keep those nothing stands in front of
    const clear = (x0, y0, x1, y1) => {
      const a = (x0 - wx) / k;
      const b = (y0 - wy) / k;
      const c = (x1 - wx) / k;
      const d = (y1 - wy) / k;
      return !sc.solid.some((s) => c > s[0] && a < s[2] && d > s[1] && b < s[3]);
    };
    sc.eyes = sc.eyes.filter((e) => clear(e.x - e.s * 5, e.y - e.s * 2, e.x + e.s * 5, e.y + e.s * 2)).slice(0, 7);
    sc.windows = sc.windows.filter((w) => clear(w.x, w.y, w.x + w.w, w.y + w.h));

    for (const z of arena.lifts) {
      const by = z.y + z.h;
      const up = g.createLinearGradient(0, by - 110, 0, by);
      up.addColorStop(0, rgba(AIR, 0));
      up.addColorStop(1, rgba(AIR, 0.34));
      g.fillStyle = up;
      g.fillRect(z.x, by - 110, z.w, 110);
      // an iron grate the cold comes up through
      g.fillStyle = '#0a0d0e';
      g.fillRect(z.x - 3, by - 6, z.w + 6, 6);
      g.fillStyle = AIR;
      for (let x = z.x + 3; x < z.x + z.w - 4; x += 9) g.fillRect(x, by - 4.5, 5, 2.5);
    }
  },

  // static: fog, dark corners and film grain over everything
  front(g, sc) {
    g.drawImage(sc.shade, 0, 0, W, H);
  },

  // every frame: a few small things that move in the dark
  live(g, sc, t) {
    const w = sc.world;

    // the light in the house gutters
    for (let i = 0; i < sc.windows.length; i++) {
      const r = sc.windows[i];
      g.fillStyle = `rgba(255,170,70,${(0.08 + 0.45 * vnoise(t * 6 + i * 20, 3)).toFixed(2)})`;
      g.fillRect(r.x, r.y, r.w, r.h);
    }

    // eyes in the dark: they open, look at whoever is nearest, and close again
    for (let i = 0; i < sc.eyes.length; i++) {
      const e = sc.eyes[i];
      const vis = clamp((Math.sin(t * 0.45 + e.ph) - 0.15) * 3, 0, 1);
      if (vis <= 0) continue;
      const blink = hash1(Math.floor(t * 2.5 + e.ph * 3), i) < 0.1 ? 0.15 : 1;
      let look = 0;
      let best = 1e9;
      for (const p of sc.seen) {
        if (t - p.t > 0.5) continue;
        const dx = w.x + p.x * w.k - e.x;
        const d = Math.abs(dx) + Math.abs(w.y + p.y * w.k - e.y);
        if (d < best) {
          best = d;
          look = clamp(dx / 120, -1, 1);
        }
      }
      const col = e.red ? '255,50,40' : '240,226,150';
      const gap = e.s * 2.1;
      g.fillStyle = `rgba(${col},${(0.18 * vis).toFixed(2)})`;
      g.beginPath();
      g.ellipse(e.x - gap, e.y, e.s * 2.3, e.s * 1.9, 0, 0, 6.283);
      g.ellipse(e.x + gap, e.y, e.s * 2.3, e.s * 1.9, 0, 0, 6.283);
      g.fill();
      g.fillStyle = `rgba(${col},${vis.toFixed(2)})`;
      g.beginPath();
      g.ellipse(e.x - gap, e.y, e.s, Math.max(0.4, e.s * 0.62 * blink * vis), 0, 0, 6.283);
      g.ellipse(e.x + gap, e.y, e.s, Math.max(0.4, e.s * 0.62 * blink * vis), 0, 0, 6.283);
      g.fill();
      if (blink > 0.5 && vis > 0.6) {
        g.fillStyle = '#000000';
        g.fillRect(e.x - gap + look * e.s * 0.5 - 0.5, e.y - e.s * 0.55, 1, e.s * 1.1);
        g.fillRect(e.x + gap + look * e.s * 0.5 - 0.5, e.y - e.s * 0.55, 1, e.s * 1.1);
      }
    }

    // bats crossing the moon
    g.fillStyle = '#04070a';
    g.beginPath();
    for (const b of sc.bats) {
      const span = W + 120;
      const x = ((((b.x + t * b.v) % span) + span) % span) - 60;
      const y = b.y + Math.sin(t * b.f + b.ph) * 16;
      const flap = Math.sin(t * 13 + b.ph) * b.s * 0.9;
      g.moveTo(x, y + 1);
      g.quadraticCurveTo(x - b.s * 0.6, y - flap * 0.3, x - b.s * 1.6, y - flap);
      g.lineTo(x - b.s * 0.6, y + 1.6);
      g.lineTo(x, y + 2.8);
      g.lineTo(x + b.s * 0.6, y + 1.6);
      g.lineTo(x + b.s * 1.6, y - flap);
      g.quadraticCurveTo(x + b.s * 0.6, y - flap * 0.3, x, y + 1);
    }
    g.fill();

    // lightning: rare and brief; the bolt stops at whatever it strikes
    if (sc.nextBolt === null) sc.nextBolt = t + 6 + Math.random() * 8;
    if (t > sc.nextBolt) {
      sc.nextBolt = t + 14 + Math.random() * 16;
      sc.boltAt = t;
      const pts = (sc.bolt = []);
      let x = 80 + Math.random() * (W - 160);
      let y = -10;
      while (y < 340) {
        pts.push(x, y);
        // stop where it strikes a platform
        const px = (x - w.x) / w.k;
        const py = (y - w.y) / w.k;
        if (sc.solid.some((s) => px > s[0] && px < s[2] && py > s[1] && py < s[3])) break;
        x += (Math.random() - 0.5) * 60;
        y += 14 + Math.random() * 26;
      }
    }
    const since = t - sc.boltAt;
    if (since < 0.3 && (since < 0.09 || since > 0.15)) {
      const pts = sc.bolt;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.strokeStyle = 'rgba(190,210,255,.3)';
      g.lineWidth = 6;
      g.stroke();
      g.strokeStyle = '#eef3ff';
      g.lineWidth = since < 0.09 ? 2.2 : 1.3;
      g.stroke();
    }

    // mist creeping along the ground: sprites stamped straight onto whole pixels
    const art = g.getTransform();
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const m of sc.mist) {
      const f = ((t * m.v) / m.len + m.ph) % 2;
      const x = m.a + (f < 1 ? f : 2 - f) * m.len - m.wisp.w / 2;
      g.drawImage(m.wisp.c, Math.round(art.a * (w.x + x * w.k) + art.e), Math.round(art.d * (w.y + m.y * w.k) + art.f));
    }
  },

  // a fat pale toadstool
  trampoline(g, tr, t, k, sc) {
    const cx = tr.x + tr.w / 2;
    const base = tr.y + tr.h;
    const top = tr.y - 6 + k * 9;
    g.drawImage(sc.capGlow, tr.x - 10, top - 14, tr.w + 20, 38);
    g.fillStyle = '#b8b39d';
    g.fillRect(cx - 7, top + 8, 14, base - top - 8);
    g.fillStyle = '#8a8674';
    g.fillRect(cx + 2, top + 8, 5, base - top - 8);
    g.beginPath();
    g.moveTo(tr.x - 3, top + 12);
    g.quadraticCurveTo(tr.x + 2, top - 6 + k * 4, cx, top - 6 + k * 4);
    g.quadraticCurveTo(tr.x + tr.w - 2, top - 6 + k * 4, tr.x + tr.w + 3, top + 12);
    g.quadraticCurveTo(cx, top + 16, tr.x - 3, top + 12);
    g.closePath();
    g.fillStyle = k > 0.3 ? '#d02a35' : '#a51a25';
    g.fill();
    g.fillStyle = '#e6dfc6';
    g.beginPath();
    for (const [dx, dy, r] of [[-18, 4, 4], [-4, -1, 5], [12, 3, 4.2], [24, 7, 2.6]]) {
      g.moveTo(cx + dx + r, top + dy + k * 3);
      g.ellipse(cx + dx, top + dy + k * 3, r, r * 0.7, 0, 0, 6.283);
    }
    g.fill();
  },

  // a stone arch with something burning inside
  portal(g, po) {
    const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
    const { cx, cy, x, y, w, h } = po;
    const arch = (inset) => {
      g.beginPath();
      g.moveTo(x + inset, y + h);
      g.lineTo(x + inset, y + 24);
      g.quadraticCurveTo(x + inset, y + inset, cx, y + inset);
      g.quadraticCurveTo(x + w - inset, y + inset, x + w - inset, y + 24);
      g.lineTo(x + w - inset, y + h);
      g.closePath();
    };
    // light spilling out around it
    puff(g, cx, cy + 4, 44, 52, col, 0.5);
    arch(-3);
    g.fillStyle = '#48565a';
    g.fill();
    g.strokeStyle = '#0b0e0f';
    g.lineWidth = 1.5;
    g.stroke();
    // joints between the stones
    g.beginPath();
    for (const jy of [h - 14, h - 30, h - 46]) {
      g.moveTo(x - 3, y + jy);
      g.lineTo(x + 4, y + jy);
      g.moveTo(x + w - 4, y + jy);
      g.lineTo(x + w + 3, y + jy);
    }
    for (const a of [-2.5, -2.05, -1.57, -1.09, -0.64]) {
      g.moveTo(cx + Math.cos(a) * 17, y + 22 + Math.sin(a) * 17);
      g.lineTo(cx + Math.cos(a) * 26, y + 22 + Math.sin(a) * 26);
    }
    g.stroke();
    arch(4);
    g.fillStyle = VOID;
    g.fill();
    g.save();
    g.clip();
    // the fire: a hot bed, then tongues climbing out of it
    const bed = g.createLinearGradient(0, y + h, 0, y + 6);
    bed.addColorStop(0, rgba(lighten(col, 0.6), 0.95));
    bed.addColorStop(0.3, rgba(col, 0.75));
    bed.addColorStop(1, rgba(col, 0.12));
    g.fillStyle = bed;
    g.fillRect(x, y, w, h);
    for (const [fx, fh, fw] of [[-7, 44, 9], [6, 56, 10], [0, 30, 12]]) {
      const tongue = g.createLinearGradient(0, y + h, 0, y + h - fh);
      tongue.addColorStop(0, rgba('#ffffff', 0.85));
      tongue.addColorStop(1, rgba(lighten(col, 0.5), 0));
      g.fillStyle = tongue;
      g.beginPath();
      g.moveTo(cx + fx - fw, y + h);
      g.quadraticCurveTo(cx + fx - fw * 0.9, y + h - fh * 0.5, cx + fx + fw * 0.2, y + h - fh);
      g.quadraticCurveTo(cx + fx + fw * 0.6, y + h - fh * 0.4, cx + fx + fw, y + h);
      g.fill();
    }
    g.restore();
    // moonlight on the top of the arch
    g.strokeStyle = 'rgba(198,218,212,.8)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x - 2, y + 20);
    g.quadraticCurveTo(x - 2, y - 2, cx, y - 2);
    g.quadraticCurveTo(x + w + 2, y - 2, x + w + 2, y + 20);
    g.stroke();
  },

  // a will-o'-the-wisp with the power inside it
  pickup(g, kind, x, y) {
    const col = KIND_COLORS[kind];
    puff(g, x, y, 34, 34, col, 0.7);
    // a wisp of flame on top
    g.fillStyle = rgba(col, 0.95);
    g.beginPath();
    g.moveTo(x - 7, y - 12);
    g.quadraticCurveTo(x - 3, y - 22, x + 2, y - 30);
    g.quadraticCurveTo(x + 5, y - 20, x + 7, y - 12);
    g.fill();
    g.fillStyle = '#07090a';
    g.beginPath();
    g.arc(x, y + 1, 16, 0, 6.283);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 2.8;
    g.stroke();
    drawIcon(g, kind, x, y + 1, 9.5, lighten(col, 0.35));
  },

  player(g, pv, t, sc) {
    const { x, y, cx, feet, color } = pv;
    const pal = sc.pal[pv.slot];
    const seen = sc.seen[pv.slot];
    seen.x = cx;
    seen.y = y + 18;
    seen.t = t;

    // every spirit carries its own light; whoever is "it" burns red
    const k = sc.k;
    const glow = pv.isIt ? sc.itGlow[Math.sin(t * 9) > 0 ? 1 : 0] : pv.local ? pal.mine : pal.glow;
    g.drawImage(glow.c, Math.round((cx - glow.w / 2) * k) / k, Math.round((y + 18 - glow.h / 2) * k) / k, glow.w, glow.h);
    squashAt(g, cx, feet, pv.squash);
    const hover = pv.ground ? Math.sin(t * 4 + pv.seed) * 1.2 : 0;
    const lean = clamp(pv.vx / 260, -1, 1) * 5;
    const left = x + 1;
    const right = x + PW - 1;
    const hem = feet - 3 + hover;
    const top = y + hover;

    if (pv.isIt) {
      // horns
      g.fillStyle = EMBER;
      g.beginPath();
      g.moveTo(cx - 13, top + 6);
      g.lineTo(cx - 15, top - 7);
      g.lineTo(cx - 5, top + 1);
      g.moveTo(cx + 13, top + 6);
      g.lineTo(cx + 15, top - 7);
      g.lineTo(cx + 5, top + 1);
      g.fill();
    }

    // sheet with a fluttering hem
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
    g.fillStyle = color;
    g.fill();
    // pale crown
    g.fillStyle = pal.hi;
    g.beginPath();
    g.ellipse(cx - pv.face * 2, top + 5.5, 8.5, 3.6, 0, 0, 6.283);
    g.fill();

    // face: hollow sockets
    const ex = cx + pv.face * 4;
    const ey = top + 15;
    const open = 1 - pv.blink;
    g.fillStyle = VOID;
    if (pv.isIt) {
      g.beginPath();
      for (const s of [-1, 1]) {
        g.moveTo(ex + s * 10, ey - 5);
        g.lineTo(ex + s * 2, ey - 0.5);
        g.lineTo(ex + s * 3, ey + 4);
        g.lineTo(ex + s * 9.5, ey + 2.5);
        g.closePath();
      }
      // jagged grin
      g.moveTo(ex - 8, ey + 8);
      for (let i = 0; i <= 8; i++) g.lineTo(ex - 8 + i * 2, ey + 8 + (i % 2 ? 3.2 : 0));
      for (let i = 8; i >= 0; i--) g.lineTo(ex - 8 + i * 2, ey + 12 + (i % 2 ? 0 : 2.6));
      g.closePath();
      g.fill();
      g.fillStyle = EMBER;
      g.fillRect(ex - 7 + pv.face, ey - 0.8, 2.8, 2.8);
      g.fillRect(ex + 4.2 + pv.face, ey - 0.8, 2.8, 2.8);
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

  // written in blood, and it drips
  marker(g, cx, cy) {
    const u = unit(g);
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = '46px Creepster, fantasy';
    g.lineJoin = 'round';
    g.shadowColor = '#ff0000';
    g.shadowBlur = 10 * u;
    g.lineWidth = 7;
    g.strokeStyle = '#120000';
    g.strokeText('IT', cx, cy);
    g.shadowBlur = 0;
    g.fillStyle = '#ff3a34';
    g.fillText('IT', cx, cy);
    for (const [dx, len] of [[-10, 5], [7, 8]]) {
      g.fillRect(cx + dx, cy - 2, 3, len);
      g.beginPath();
      g.arc(cx + dx + 1.5, cy - 2 + len, 2.3, 0, 6.283);
      g.fill();
    }
    g.beginPath();
    g.arc(cx + 8.5, cy + 14, 2, 0, 6.283);
    g.fill();
    g.restore();
  },

  fx: {
    trail(R, pv, dt, t) {
      const sc = R.scene;
      // the flash that goes with a bolt of lightning
      if (sc.boltAt > sc.flashed) {
        sc.flashed = sc.boltAt;
        R.flash('#c8d7ff', 0.11);
      }
      // wisps of the spirit left hanging in the air
      if (t - sc.wispT[pv.slot] < (Math.abs(pv.vx) > 60 || !pv.ground ? 0.08 : 0.3)) return;
      sc.wispT[pv.slot] = t;
      R.emit({
        x: pv.cx + (Math.random() - 0.5) * 16,
        y: pv.feet - 6 - Math.random() * 16,
        vx: -pv.vx * 0.08 + (Math.random() - 0.5) * 14,
        vy: -12 - Math.random() * 18,
        life: 0.45 + Math.random() * 0.25,
        alpha: 0.7,
        back: true,
        k: sc.k,
        wisp: pv.isIt ? sc.itWisp : sc.pal[pv.slot].wisp,
        draw: stampWisp,
      });
    },
    jump(R, pv) {
      for (let i = 0; i < 4; i++) R.emit({ x: pv.cx + (Math.random() - 0.5) * 22, y: pv.feet - 2, vx: (Math.random() - 0.5) * 70, vy: -8 - Math.random() * 20, life: 0.5, size: 5, grow: 14, alpha: 0.22, color: '#aebfba', back: true });
    },
    land(R, pv, impact) {
      for (let i = 0; i < 4 + impact * 4; i++) {
        const dir = i % 2 ? 1 : -1;
        R.emit({ x: pv.cx + dir * 6, y: pv.feet - 2, vx: dir * (40 + Math.random() * 110), vy: -6 - Math.random() * 14, drag: 3, life: 0.55, size: 4, grow: 16, alpha: 0.22, color: '#aebfba' });
      }
    },
    respawn(R, pv) {
      for (let i = 0; i < 10; i++) R.emit({ x: pv.cx + (Math.random() - 0.5) * 30, y: pv.y - 40 + Math.random() * 70, vy: 30 + Math.random() * 60, life: 0.7, size: 6, grow: 10, alpha: 0.25, color: pv.color });
    },
    tag(R, to, from) {
      R.flash('#a00010', 0.28);
      R.shake(14);
      const x = to.cx;
      const y = to.y + 18;
      // blood
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * 6.283;
        const v = 80 + Math.random() * 300;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, g: 900, life: 0.5 + Math.random() * 0.5, size: 1.5 + Math.random() * 2.5, color: i % 3 ? BLOOD : '#e0202c' });
      }
      // a burst of bats
      for (let i = 0; i < 7; i++) {
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
