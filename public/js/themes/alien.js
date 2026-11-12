// XENO - dusk on a glowing alien planet. Two moons hang over rock arches and
// giant mushroom-trees; everything you can stand on is edged with shining
// moss, and the players are one-eyed critters with bobbing antennae.

import { ART_W as W, ART_H as H } from '/shared/config.js';
import { rgba, lighten, darken, vnoise, hash1, clamp, squashAt, drawIcon, KIND_COLORS, PORTAL_COLORS } from '../util.js';

const TAU = Math.PI * 2;
const INK = '#160d30'; // dark plum, used for outlines
const MOSS = '#58f0d0'; // glowing moss: "you can stand here"
const MOSS_HI = '#e6fff8';
const MOSS_LO = '#15808a';
const PINK = '#ff74d6'; // spore wind and bouncy things
const HOT = '#ff5340'; // the colour of being "it"
const RIM = '#8f7fe6'; // cool light that catches the edges of rock
const GLOWS = ['#6ff5df', '#ff8fe0', '#b6ff7a', '#9fb4ff']; // plant lights

// ---------------------------------------------------------------------------
// Backdrop pieces (all painted once)
// ---------------------------------------------------------------------------

// a soft round light
function halo(g, x, y, r, col, a) {
  const rg = g.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, rgba(col, a));
  rg.addColorStop(0.4, rgba(col, a * 0.42));
  rg.addColorStop(1, rgba(col, 0));
  g.fillStyle = rg;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

function paintSky(g, rnd) {
  const s = g.createLinearGradient(0, 0, 0, H);
  s.addColorStop(0, '#1e1449');
  s.addColorStop(0.26, '#3a2572');
  s.addColorStop(0.5, '#55398c');
  s.addColorStop(0.68, '#3f6c98');
  s.addColorStop(0.84, '#3f9e9b');
  s.addColorStop(1, '#2b7480');
  g.fillStyle = s;
  g.fillRect(0, 0, W, H);
  // clouds of colour
  halo(g, 170, 170, 270, '#b050d8', 0.2);
  halo(g, 430, 30, 250, '#5a55e6', 0.22);
  halo(g, 660, 330, 280, '#35d6c4', 0.13);
  // stars, thinning out towards the horizon
  for (let i = 0; i < 190; i++) {
    const x = rnd() * W;
    const y = rnd() ** 1.6 * 330;
    const r = 0.3 + rnd() * 0.75;
    g.fillStyle = `rgba(${225 + rnd() * 30},${228 + rnd() * 27},255,${(0.25 + rnd() * 0.6) * (1 - y / 400)})`;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    if (r > 0.95) {
      g.fillRect(x - r * 3, y - 0.2, r * 6, 0.4);
      g.fillRect(x - 0.2, y - r * 3, 0.4, r * 6);
    }
  }
}

// curtains of light: brightest along the lower edge, fading upwards
function aurora(g, base, amp, seed, col, alpha) {
  // wide strips that overlap three deep, so no seams show
  for (let x = -4; x < W; x += 2) {
    const y = base + amp * (2 * vnoise(x / 140, seed) - 1) + 9 * Math.sin(x / 41 + seed);
    const len = 44 + 64 * vnoise(x / 26, seed + 4);
    const edge = clamp(Math.min(x / 90, (W - x) / 90), 0, 1);
    const a = (alpha / 3) * (0.4 + 0.6 * vnoise(x / 23, seed + 8)) * (0.7 + 0.3 * vnoise(x / 8.7, seed + 12)) * edge;
    const gr = g.createLinearGradient(0, y - len, 0, y + 10);
    gr.addColorStop(0, rgba(col, 0));
    gr.addColorStop(0.82, rgba(col, a));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(x, y - len, 6, len + 10);
  }
}

function ringedMoon(g, rnd, x, y, r) {
  halo(g, x, y, r * 2.7, '#c9b6ff', 0.3);
  const ring = (front) => {
    const alphas = [0.5, 0.28, 0.55, 0.2, 0.42, 0.22, 0.14];
    g.save();
    g.translate(x, y);
    g.rotate(-0.3);
    g.lineWidth = r * 0.055;
    for (let i = 0; i < alphas.length; i++) {
      const k = 1.42 + i * 0.085;
      g.strokeStyle = rgba(i % 3 === 1 ? '#9ff5e2' : '#eadcff', alphas[i]);
      g.beginPath();
      g.ellipse(0, 0, r * k, r * k * 0.21, 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
      g.stroke();
    }
    g.restore();
  };
  ring(false); // the half that passes behind
  const d = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  d.addColorStop(0, '#e9defb');
  d.addColorStop(0.55, '#bfaae8');
  d.addColorStop(1, '#836cc4');
  g.fillStyle = d;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.save();
  g.clip();
  // craters: a dim bowl with a lit rim
  for (let i = 0; i < 15; i++) {
    const a = rnd() * TAU;
    const q = Math.sqrt(rnd()) * r * 0.86;
    const cx = x + Math.cos(a) * q;
    const cy = y + Math.sin(a) * q;
    const cr = r * (0.05 + rnd() * 0.13);
    g.fillStyle = 'rgba(96,70,160,.3)';
    g.beginPath();
    g.ellipse(cx, cy, cr, cr * 0.8, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,250,255,.4)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.ellipse(cx, cy, cr, cr * 0.8, 0, 0.2, 2.3);
    g.stroke();
  }
  // the night side
  const sh = g.createRadialGradient(x - r * 0.5, y - r * 0.55, r * 0.7, x - r * 0.5, y - r * 0.55, r * 1.95);
  sh.addColorStop(0, 'rgba(44,22,96,0)');
  sh.addColorStop(1, 'rgba(44,22,96,.8)');
  g.fillStyle = sh;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
  ring(true); // the half in front
}

function smallMoon(g, x, y, r) {
  halo(g, x, y, r * 3, '#8ff5e0', 0.22);
  const d = g.createRadialGradient(x + r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  d.addColorStop(0, '#effff9');
  d.addColorStop(0.6, '#9fe9d6');
  d.addColorStop(1, '#4fae9f');
  g.fillStyle = d;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = 'rgba(40,30,100,.62)'; // shadow leaves a crescent
  g.beginPath();
  g.arc(x - r * 0.55, y + r * 0.2, r * 1.05, 0, TAU);
  g.fill();
  g.restore();
}

// a far-off glider: two swept wings and a whip of a tail
function glider(g, x, y, s, tilt) {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(-7, 0);
  g.quadraticCurveTo(-3, -3.4, 0, -0.6);
  g.quadraticCurveTo(3, -3.4, 7, 0);
  g.quadraticCurveTo(3, -0.8, 0.8, 1);
  g.lineTo(0, 5);
  g.lineTo(-0.8, 1);
  g.quadraticCurveTo(-3, -0.8, -7, 0);
  g.fill();
  g.restore();
}

// rolling ground for one layer of silhouettes; returns its height function
function ridge(g, fill, base, amp, scale, seed) {
  const yAt = (x) => base - amp * (0.65 * vnoise(x / scale, seed) + 0.35 * vnoise(x / (scale * 0.31), seed + 7));
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(-10, H + 10);
  for (let x = -10; x <= W + 10; x += 5) g.lineTo(x, yAt(x));
  g.lineTo(W + 10, H + 10);
  g.fill();
  return yAt;
}

// a needle of rock
function spire(g, x, base, h, w, lean) {
  g.beginPath();
  g.moveTo(x - w / 2, base + 8);
  g.quadraticCurveTo(x - w * 0.14 + lean * 0.4, base - h * 0.5, x + lean, base - h);
  g.quadraticCurveTo(x + w * 0.2 + lean * 0.4, base - h * 0.42, x + w / 2, base + 8);
  g.fill();
}

// a natural rock arch, t = thickness of its legs
function arch(g, x, base, w, h, t) {
  g.beginPath();
  g.moveTo(x - w / 2 - t * 0.4, base + 8);
  g.bezierCurveTo(x - w * 0.52, base - h * 1.05, x + w * 0.3, base - h * 1.25, x + w / 2 + t * 0.2, base + 8);
  g.lineTo(x + w / 2 - t, base + 8); // back along the inside, which leaves the hole
  g.bezierCurveTo(x + w * 0.2, base - h * 0.95 + t * 1.1, x - w * 0.36, base - h * 0.8 + t, x - w / 2 + t * 0.8, base + 8);
  g.closePath();
  g.fill();
}

// a giant mushroom-tree; glow = colour of the light under its cap (or null)
function shroomTree(g, rnd, fill, x, base, h, capW, glow) {
  const lean = (rnd() - 0.5) * h * 0.22;
  const tx = x + lean;
  const ty = base - h;
  const wb = capW * 0.1 + 2;
  const wt = capW * 0.05 + 1;
  const ry = capW * (0.26 + rnd() * 0.12);
  const droop = ry * 0.38;
  if (glow) halo(g, tx, ty + droop, capW * 0.62, glow, 0.26);
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(x - wb, base + 8);
  g.quadraticCurveTo(x - wb * 0.3 + lean * 0.2, base - h * 0.5, tx - wt, ty);
  g.lineTo(tx + wt, ty);
  g.quadraticCurveTo(x + wb * 0.5 + lean * 0.2, base - h * 0.5, x + wb, base + 8);
  g.fill();
  g.beginPath();
  g.moveTo(tx - capW / 2, ty + droop);
  g.bezierCurveTo(tx - capW * 0.52, ty - ry * 1.25, tx + capW * 0.52, ty - ry * 1.25, tx + capW / 2, ty + droop);
  g.quadraticCurveTo(tx, ty - droop * 0.5, tx - capW / 2, ty + droop);
  g.fill();
  if (!glow) return;
  // moonlight along the top of the cap
  g.strokeStyle = 'rgba(214,200,255,.3)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(tx - capW * 0.42, ty - ry * 0.35);
  g.bezierCurveTo(tx - capW * 0.3, ty - ry * 0.98, tx + capW * 0.3, ty - ry * 0.98, tx + capW * 0.42, ty - ry * 0.35);
  g.stroke();
  // glowing gills under the rim, and spots on the cap
  g.strokeStyle = rgba(glow, 0.34);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(tx - capW * 0.46, ty + droop * 0.9);
  g.quadraticCurveTo(tx, ty - droop * 0.42, tx + capW * 0.46, ty + droop * 0.9);
  g.stroke();
  g.fillStyle = rgba(glow, 0.75);
  for (let i = 0; i < 4 + capW / 14; i++) {
    const u = (rnd() * 2 - 1) * 0.8;
    const v = 0.25 + rnd() * 0.6;
    g.beginPath();
    g.arc(tx + (u * capW) / 2, ty + droop - (1 - u * u) * (ry * 0.95 + droop) * v, 0.6 + rnd() * 1.1, 0, TAU);
    g.fill();
  }
}

// a stalk that ends in a curl, with a light at its heart
function fern(g, rnd, fill, x, base, h, glow) {
  const dir = rnd() < 0.5 ? -1 : 1;
  const R = h * 0.2;
  const n = 64;
  let px = x;
  let py = base + 6;
  g.strokeStyle = fill;
  g.lineCap = 'round';
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    let nx;
    let ny;
    if (k < 0.55) {
      const u = k / 0.55;
      nx = x + dir * Math.sin(u * 2.4) * h * 0.05;
      ny = base - h * u;
    } else {
      const u = (k - 0.55) / 0.45;
      const a = Math.PI + u * 3.3 * Math.PI;
      const r = R * (1 - 0.82 * u);
      nx = x + dir * Math.sin(2.4) * h * 0.05 + dir * (R + Math.cos(a) * r);
      ny = base - h + Math.sin(a) * r;
    }
    g.lineWidth = (h * 0.045 + 1.2) * (1 - k * 0.75);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(nx, ny);
    g.stroke();
    px = nx;
    py = ny;
  }
  if (glow) {
    halo(g, px, py, 9, glow, 0.5);
    g.fillStyle = lighten(glow, 0.5);
    g.beginPath();
    g.arc(px, py, 1.5, 0, TAU);
    g.fill();
  }
}

// an arching stem hung with glowing pods; the pods are remembered so live() can pulse them
function lantern(g, rnd, fill, x, base, h, glow, lights) {
  const dir = rnd() < 0.5 ? -1 : 1;
  const ex = x + dir * h * 0.55;
  const ey = base - h * 0.78;
  const cx = x + dir * h * 0.05;
  const cy = base - h * 1.25;
  g.strokeStyle = fill;
  g.lineCap = 'round';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(x, base + 6);
  g.quadraticCurveTo(cx, cy, ex, ey);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const u = 0.55 + i * 0.2;
    const sx = (1 - u) * (1 - u) * x + 2 * u * (1 - u) * cx + u * u * ex;
    const sy = (1 - u) * (1 - u) * base + 2 * u * (1 - u) * cy + u * u * ey;
    const drop = 6 + rnd() * 9;
    const r = 1.3 + rnd() * 0.8;
    g.strokeStyle = fill;
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx, sy + drop);
    g.stroke();
    halo(g, sx, sy + drop + r, r * 5, glow, 0.36);
    g.fillStyle = rgba(lighten(glow, 0.3), 0.85);
    g.beginPath();
    g.moveTo(sx, sy + drop - 1);
    g.bezierCurveTo(sx + r * 1.3, sy + drop + r, sx + r, sy + drop + r * 2.4, sx, sy + drop + r * 2.4);
    g.bezierCurveTo(sx - r, sy + drop + r * 2.4, sx - r * 1.3, sy + drop + r, sx, sy + drop - 1);
    g.fill();
    lights.push({ x: sx, y: sy + drop + r, r: r * 6, col: glow });
  }
}

// a band of mist lying between two layers
function mist(g, y, a) {
  const m = g.createLinearGradient(0, y - 34, 0, y + 34);
  m.addColorStop(0, 'rgba(150,235,225,0)');
  m.addColorStop(0.5, `rgba(150,235,225,${a})`);
  m.addColorStop(1, 'rgba(150,235,225,0)');
  g.fillStyle = m;
  g.fillRect(0, y - 34, W, 68);
}

function paintBackdrop(g, rnd, lights) {
  const grad = (y0, y1, top, bottom) => {
    const f = g.createLinearGradient(0, y0, 0, y1);
    f.addColorStop(0, top);
    f.addColorStop(1, bottom);
    return f;
  };
  paintSky(g, rnd);
  aurora(g, 118, 30, 3, '#6ff5c8', 0.34);
  aurora(g, 178, 24, 9, '#ff7ad9', 0.17);
  smallMoon(g, 150, 92, 17);
  ringedMoon(g, rnd, 600, 136, 58);
  // a shooting star, and a flock of gliders crossing the sky
  const trail = g.createLinearGradient(292, 44, 352, 62);
  trail.addColorStop(0, 'rgba(255,255,255,0)');
  trail.addColorStop(1, 'rgba(235,245,255,.75)');
  g.strokeStyle = trail;
  g.lineWidth = 1;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(292, 44);
  g.lineTo(352, 62);
  g.stroke();
  g.fillStyle = 'rgba(30,18,72,.5)';
  for (const [x, y, sz] of [[226, 164, 1], [248, 151, 0.8], [255, 176, 0.7], [278, 161, 0.6], [206, 182, 0.55]]) glider(g, x, y, sz, -0.25 + (rnd() - 0.5) * 0.3);

  // far: arches and needles, washed out by the haze
  let fill = grad(170, 400, '#514e9e', '#44839d');
  let yAt = ridge(g, fill, 338, 40, 150, 11);
  arch(g, 222, yAt(222), 132, 128, 17);
  spire(g, 322, yAt(322), 176, 34, 9);
  spire(g, 352, yAt(352), 104, 26, -4);
  spire(g, 64, yAt(64), 132, 30, -6);
  spire(g, 100, yAt(100), 78, 22, 3);
  spire(g, 468, yAt(468), 96, 28, 5);
  arch(g, 694, yAt(694), 96, 92, 13);
  spire(g, 752, yAt(752), 150, 30, -8);
  mist(g, 346, 0.2);

  // middle: mushroom-trees and curled ferns
  fill = grad(230, 440, '#3e3c86', '#34718c');
  yAt = ridge(g, fill, 384, 36, 120, 23);
  shroomTree(g, rnd, fill, 128, yAt(128), 150, 112, GLOWS[1]);
  shroomTree(g, rnd, fill, 520, yAt(520), 128, 96, GLOWS[2]);
  shroomTree(g, rnd, fill, 408, yAt(408), 76, 54, GLOWS[3]);
  g.fillStyle = fill;
  arch(g, 318, yAt(318), 78, 70, 11);
  spire(g, 646, yAt(646), 104, 26, 6);
  fern(g, rnd, fill, 246, yAt(246), 92, GLOWS[2]);
  fern(g, rnd, fill, 706, yAt(706), 112, GLOWS[0]);
  mist(g, 392, 0.17);

  // near: big trees framing the scene, lantern plants with lights
  fill = grad(200, 470, '#343274', '#2c6382');
  yAt = ridge(g, fill, 428, 30, 90, 37);
  shroomTree(g, rnd, fill, 40, yAt(40), 236, 176, GLOWS[3]);
  shroomTree(g, rnd, fill, 768, yAt(768), 200, 150, GLOWS[1]);
  shroomTree(g, rnd, fill, 300, yAt(300), 84, 62, GLOWS[2]);
  shroomTree(g, rnd, fill, 652, yAt(652), 98, 74, GLOWS[3]);
  fern(g, rnd, fill, 384, yAt(384), 70, GLOWS[1]);
  fern(g, rnd, fill, 724, yAt(724), 60, GLOWS[2]);
  lantern(g, rnd, fill, 186, yAt(186), 72, GLOWS[0], lights);
  lantern(g, rnd, fill, 470, yAt(470), 84, GLOWS[1], lights);
  lantern(g, rnd, fill, 582, yAt(582), 62, GLOWS[2], lights);
  // little lights in the undergrowth
  for (let i = 0; i < 36; i++) {
    const x = rnd() * W;
    const y = yAt(x) + 2 + rnd() * 34;
    const col = GLOWS[Math.floor(rnd() * 3)];
    halo(g, x, y, 4 + rnd() * 4, col, 0.26);
    g.fillStyle = rgba(lighten(col, 0.3), 0.7);
    g.beginPath();
    g.arc(x, y, 0.5 + rnd() * 0.7, 0, TAU);
    g.fill();
  }
  mist(g, 440, 0.14);

  // front: dark tufts along the very bottom
  fill = '#17123c';
  yAt = ridge(g, fill, 478, 14, 60, 51);
  g.strokeStyle = fill;
  g.lineCap = 'round';
  g.lineWidth = 1.6;
  for (let x = 4; x < W; x += 6 + rnd() * 16) {
    const by = yAt(x);
    g.beginPath();
    g.moveTo(x, by + 2);
    g.quadraticCurveTo(x + (rnd() - 0.5) * 6, by - 8, x + (rnd() - 0.5) * 12, by - 9 - rnd() * 12);
    g.stroke();
  }

  // spores hanging in the air
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W;
    const y = 90 + rnd() * 380;
    const col = GLOWS[Math.floor(rnd() * GLOWS.length)];
    if (rnd() < 0.3) halo(g, x, y, 5 + rnd() * 5, col, 0.16);
    g.fillStyle = rgba(lighten(col, 0.3), 0.18 + rnd() * 0.3);
    g.beginPath();
    g.arc(x, y, 0.4 + rnd() * 0.9, 0, TAU);
    g.fill();
  }
}

// ---------------------------------------------------------------------------
// Platforms (painted once, world coordinates)
// ---------------------------------------------------------------------------

// Light spilling off a strip of moss. Shadows ignore the canvas transform, so
// the blur is scaled by hand. Paint this BEHIND anything that should stay dark.
function mossGlow(g, x0, x1, y) {
  const m = g.getTransform();
  const k = Math.hypot(m.a, m.b); // canvas pixels per world unit
  g.save();
  g.shadowColor = MOSS;
  g.fillStyle = MOSS;
  for (const blur of [26, 12]) {
    g.shadowBlur = blur * k;
    g.fillRect(x0, y - 1, x1 - x0, 4);
  }
  g.restore();
}

// The glowing moss that marks every surface you can stand on: flat and bright
// on top, lumpy drips underneath.
function moss(g, rnd, x0, x1, y, thick, drip) {
  g.beginPath();
  g.moveTo(x0 - 3, y + thick * 0.55);
  g.quadraticCurveTo(x0 - 3, y - 1.5, x0 + 4, y - 1.5);
  g.lineTo(x1 - 4, y - 1.5);
  g.quadraticCurveTo(x1 + 3, y - 1.5, x1 + 3, y + thick * 0.55);
  let x = x1 + 3;
  while (x > x0 - 2) {
    const nx = Math.max(x0 - 3, x - 9 - rnd() * 13);
    const d = thick + (rnd() < 0.2 ? drip * (0.45 + rnd() * 0.55) : rnd() * thick * 0.5);
    g.quadraticCurveTo((x + nx) / 2, y + d * 1.5, nx, y + thick * 0.7);
    x = nx;
  }
  g.closePath();
  const fill = g.createLinearGradient(0, y - 2, 0, y + thick + drip * 0.8);
  fill.addColorStop(0, MOSS_HI);
  fill.addColorStop(0.22, MOSS);
  fill.addColorStop(1, MOSS_LO);
  g.fillStyle = fill;
  g.fill();
  // the surface itself: one crisp bright line
  g.strokeStyle = '#f4fffc';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0 + 1, y - 0.6);
  g.lineTo(x1 - 1, y - 0.6);
  g.stroke();
}

// small glowing things growing out of the moss
function sprouts(g, rnd, x0, x1, y) {
  g.lineCap = 'round';
  for (let x = x0 + 16 + rnd() * 50; x < x1 - 16; x += 50 + rnd() * 130) {
    if (rnd() < 0.55) {
      // tuft of three blades
      g.strokeStyle = MOSS;
      g.lineWidth = 1.8;
      g.beginPath();
      for (let k = -1; k <= 1; k++) {
        g.moveTo(x + k * 2.5, y - 1);
        g.quadraticCurveTo(x + k * 4, y - 7, x + k * 8 + (rnd() - 0.5) * 3, y - 9 - rnd() * 6);
      }
      g.stroke();
    } else {
      // a bulb on a bent stalk
      const h = 9 + rnd() * 7;
      const bx = x + (rnd() - 0.5) * 8;
      g.strokeStyle = MOSS_LO;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(x, y - 1);
      g.quadraticCurveTo(x, y - h * 0.7, bx, y - h);
      g.stroke();
      halo(g, bx, y - h, 9, MOSS, 0.5);
      g.fillStyle = MOSS_HI;
      g.beginPath();
      g.arc(bx, y - h, 2.6, 0, TAU);
      g.fill();
    }
  }
}

// a cluster of glowing crystal shards
function crystals(g, rnd, x, y, size, col) {
  halo(g, x, y - size * 0.3, size * 2.2, col, 0.4);
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.62 + (rnd() - 0.5) * 0.3;
    const len = size * (0.65 + rnd() * 0.5);
    const wd = len * 0.22;
    const tx = x + Math.cos(a) * len;
    const ty = y + Math.sin(a) * len;
    const nx = -Math.sin(a) * wd;
    const ny = Math.cos(a) * wd;
    const mx = x + Math.cos(a) * len * 0.3;
    const my = y + Math.sin(a) * len * 0.3;
    const f = g.createLinearGradient(x, y, tx, ty);
    f.addColorStop(0, darken(col, 0.35));
    f.addColorStop(0.6, col);
    f.addColorStop(1, lighten(col, 0.7));
    g.fillStyle = f;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(mx + nx, my + ny);
    g.lineTo(tx, ty);
    g.lineTo(mx - nx, my - ny);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(lighten(col, 0.8), 0.8);
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(tx, ty);
    g.stroke();
  }
}

// a thread of light with a bead at the end
function tendril(g, rnd, x, y, len, col) {
  const sway = (rnd() - 0.5) * len * 0.5;
  const f = g.createLinearGradient(0, y, 0, y + len);
  f.addColorStop(0, rgba(col, 0.75));
  f.addColorStop(1, rgba(col, 0.25));
  g.strokeStyle = f;
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  g.bezierCurveTo(x + sway, y + len * 0.4, x - sway, y + len * 0.7, x + sway * 0.4, y + len);
  g.stroke();
  halo(g, x + sway * 0.4, y + len, 7, col, 0.55);
  g.fillStyle = lighten(col, 0.55);
  g.beginPath();
  g.arc(x + sway * 0.4, y + len, 2, 0, TAU);
  g.fill();
}

// The parts of a block's top edge that are open to the sky (not under another block).
function openTop(p, A) {
  let spans = [[p.x, p.x + p.w]];
  for (const q of A.platforms) {
    if (!q.ground || Math.abs(q.y + q.h - p.y) > 2) continue;
    const a = q.x;
    const b = q.x + q.w;
    spans = spans.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [[s, Math.min(e, a)], [Math.max(s, b), e]].filter(([u, v]) => v - u > 6)));
  }
  return spans;
}

// solid block: dark faceted rock with crystals in it and moss on top
function rock(g, rnd, p, A) {
  const { x, y, w, h } = p;
  const bottom = y + h;
  const body = g.createLinearGradient(0, y, 0, y + Math.max(120, Math.min(h, 320)));
  body.addColorStop(0, '#35275f');
  body.addColorStop(0.35, '#211645');
  body.addColorStop(1, '#130b2a');
  g.fillStyle = body;
  g.fillRect(x, y, w, h);

  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  // facets: big flat planes, some catching the light, some in shadow
  const planes = clamp(Math.round((w * h) / 5200), 3, 90);
  for (let i = 0; i < planes; i++) {
    const cx = x + rnd() * w;
    const cy = y + rnd() * h;
    const s = 22 + rnd() * 52;
    g.fillStyle = rnd() < 0.5 ? 'rgba(126,108,220,.09)' : 'rgba(6,2,20,.2)';
    g.beginPath();
    g.moveTo(cx - s, cy + (rnd() - 0.5) * s * 0.6);
    g.lineTo(cx - s * 0.2, cy - s * (0.4 + rnd() * 0.4));
    g.lineTo(cx + s, cy - (rnd() - 0.5) * s * 0.6);
    g.lineTo(cx + s * 0.3, cy + s * (0.4 + rnd() * 0.4));
    g.closePath();
    g.fill();
  }
  // cracks
  g.lineWidth = 1.4;
  for (let i = 0; i < planes * 0.6; i++) {
    let cx = x + rnd() * w;
    let cy = y + 10 + rnd() * h;
    g.strokeStyle = rnd() < 0.5 ? 'rgba(150,132,236,.22)' : 'rgba(5,2,16,.4)';
    g.beginPath();
    g.moveTo(cx, cy);
    for (let k = 0; k < 3; k++) {
      cx += (rnd() - 0.5) * 34;
      cy += 8 + rnd() * 18;
      g.lineTo(cx, cy);
    }
    g.stroke();
  }
  g.restore();

  // where another block stands on this one, carry its darkness down so no seam shows
  for (const q of A.platforms) {
    if (!q.ground || Math.abs(q.y + q.h - y) > 2) continue;
    const a = Math.max(x, q.x);
    const b = Math.min(x + w, q.x + q.w);
    if (b - a < 4) continue;
    const seam = g.createLinearGradient(0, y, 0, y + Math.min(h, 70));
    seam.addColorStop(0, '#130b2a');
    seam.addColorStop(1, 'rgba(19,11,42,0)');
    g.fillStyle = seam;
    g.fillRect(a, y, b - a, Math.min(h, 70));
  }

  // cool light catching the two sides, strongest near the top
  const edge = g.createLinearGradient(0, y, 0, y + Math.min(h, 260));
  edge.addColorStop(0, rgba(RIM, 0.75));
  edge.addColorStop(1, rgba(RIM, 0.22));
  g.fillStyle = edge;
  if (x > 1) g.fillRect(x, y + 3, 2.5, h - 3);
  if (x + w < A.w - 1) g.fillRect(x + w - 2.5, y + 3, 2.5, h - 3);
  const hangs = bottom < A.h - 1 && !A.platforms.some((q) => q.ground && Math.abs(q.y - bottom) < 2 && q.x < x + w && q.x + q.w > x);
  if (hangs) g.fillRect(x, bottom - 2.5, w, 2.5); // underside, if it floats in the air

  for (const [a, b] of openTop(p, A)) {
    // threads of light hanging down the face
    for (let tx = a + 12 + rnd() * 40; tx < b - 12; tx += 40 + rnd() * 110) {
      const len = Math.min(h - 16, 16 + rnd() * 46);
      if (len > 12) tendril(g, rnd, tx, y + 6, len, MOSS);
    }
    // crystals bedded in the rock
    if (h >= 60) {
      for (let cx = a + 30 + rnd() * 90; cx < b - 30; cx += 110 + rnd() * 220) {
        const cy = y + 34 + rnd() * Math.min(h - 50, 150);
        crystals(g, rnd, cx, cy, 11 + rnd() * 9, rnd() < 0.6 ? '#c77dff' : '#6ff5df');
      }
    }
    mossGlow(g, a, b, y);
    moss(g, rnd, a, b, y, 7, 13);
    sprouts(g, rnd, a, b, y);
  }
}

// thin ledge: a row of dark bracket fungi with moss on top and lights underneath
function shelf(g, rnd, p) {
  const { x, y, w } = p;
  const n = Math.max(1, Math.round(w / 104));
  const lw = (w + 4) / n;
  const joints = [];
  mossGlow(g, x, x + w, y);
  g.beginPath();
  g.moveTo(x - 2, y + 1);
  g.lineTo(x + w + 2, y + 1);
  for (let i = n - 1; i >= 0; i--) {
    const xr = x - 2 + (i + 1) * lw;
    const xl = x - 2 + i * lw;
    const d = 17 + rnd() * 7;
    g.bezierCurveTo(xr - lw * 0.12, y + d * 1.25, xl + lw * 0.3, y + d * 1.3, xl, y + (i ? 6 : 1));
    if (i) joints.push(xl);
  }
  g.closePath();
  const body = g.createLinearGradient(0, y, 0, y + 22);
  body.addColorStop(0, '#32235f');
  body.addColorStop(1, '#130a2b');
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = rgba(RIM, 0.6);
  g.lineWidth = 1.6;
  g.stroke();
  // gills: faint glowing ribs under each lobe
  g.strokeStyle = rgba(MOSS, 0.3);
  g.lineWidth = 1.3;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const c = x - 2 + (i + 0.5) * lw;
    for (let k = -2; k <= 2; k++) {
      g.moveTo(c + k * lw * 0.13, y + 6);
      g.lineTo(c + k * lw * 0.17, y + 14 - Math.abs(k) * 1.5);
    }
  }
  g.stroke();
  // lights hanging from where the lobes meet, and now and then from the middle
  for (const jx of joints) if (rnd() < 0.75) tendril(g, rnd, jx, y + 7, 10 + rnd() * 16, rnd() < 0.7 ? MOSS : GLOWS[1]);
  if (rnd() < 0.6) tendril(g, rnd, x + w * (0.2 + rnd() * 0.6), y + 15, 8 + rnd() * 12, GLOWS[1]);
  moss(g, rnd, x, x + w, y, 4.5, 4);
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

// Things drawn every frame get their outlines without stroking: a fat dark
// copy of the shape is filled, then a thinner coloured copy on top. That costs
// about half as much as fill + stroke.

const TINTS = new Map(); // shades of each player colour, worked out once
function tints(color) {
  let t = TINTS.get(color);
  if (!t) {
    t = { dark: darken(color, 0.42), shade: darken(color, 0.2), light: lighten(color, 0.55) };
    TINTS.set(color, t);
  }
  return t;
}

// The critter's body: an egg, a little wider at the bottom, with a pointed tail
// curling out behind. o pushes the edge out (+) or in (-). Like every piece of
// the dark silhouette it runs "up the back, down the front", so the pieces can
// overlap in one fill without punching holes in each other.
function bodyPath(g, cx, by, f, wag, o) {
  const rx = 13.5 + o;
  const top = by - 15 - o;
  const bot = by + 14 + o;
  g.moveTo(cx - f * rx, by + 3);
  g.bezierCurveTo(cx - f * rx, by - 8 - o * 0.6, cx - f * (8 + o * 0.6), top, cx + f, top); // up the back to the crown
  g.bezierCurveTo(cx + f * (9 + o * 0.6), top, cx + f * rx, by - 8 - o * 0.6, cx + f * rx, by + 3); // down the face
  g.bezierCurveTo(cx + f * rx, by + 11 + o * 0.7, cx + f * (7 + o * 0.5), bot, cx, bot); // under the chin
  g.bezierCurveTo(cx - f * 4, bot, cx - f * 7, bot - 0.4, cx - f * (8.5 - o * 0.3), by + 12.2 + o * 0.9);
  g.quadraticCurveTo(cx - f * (17.5 + o * 0.5), by + 13.5 + o * 1.3, cx - f * (19.5 + o * 0.7), by + 1 - wag - o * 1.3); // out to the tip of the tail
  g.quadraticCurveTo(cx - f * (15 - o * 0.9), by + 8 - o * 1.1, cx - f * (12.9 + o * 0.9), by + 6.8 - o * 1.1); // and back
  g.closePath();
}

// The cap of a bounce pod, squashed by k; o as above.
function capPath(g, x, w, base, k, o) {
  const top = base - 21 + k * 9 - o;
  const side = 3 + k * 5 + o;
  const lip = base - 6 + k * 2 + o * 0.7;
  g.moveTo(x - side, lip);
  g.bezierCurveTo(x - side, top - 3, x + w * 0.3, top, x + w / 2, top);
  g.bezierCurveTo(x + w * 0.7, top, x + w + side, top - 3, x + w + side, lip);
  g.quadraticCurveTo(x + w / 2, base - 1 + k + o * 1.6, x - side, lip);
  g.closePath();
}

export default {
  id: 'alien',
  colors: ['#ff5a66', '#4b93ff', '#76e04a', '#ffd43d'],
  letterbox: '#0e0822',
  lift: PINK,
  label: {
    font: '700 15px "Rajdhani", sans-serif',
    color: '#eefff9',
    stroke: 'rgba(18,9,42,.88)',
    strokeWidth: 4,
    you: '#ffe27a',
    gap: 9,
  },

  build(env) {
    const { rnd, layer, sprite } = env;
    const lights = [];
    const bg = layer((g) => paintBackdrop(g, rnd, lights));

    // static: the corners fall away into the dark
    const shade = layer((g) => {
      const v = g.createRadialGradient(W / 2, H * 0.46, H * 0.5, W / 2, H * 0.46, H * 1.05);
      v.addColorStop(0, 'rgba(12,5,36,0)');
      v.addColorStop(1, 'rgba(12,5,36,.5)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }, 0.5);

    // glows are baked here and only stamped later; only the biggest pods breathe
    const blooms = new Map();
    lights.sort((a, b) => b.r - a.r);
    lights.length = Math.min(lights.length, 5);
    for (const l of lights) {
      if (!blooms.has(l.col)) blooms.set(l.col, sprite(48, 48, (g) => halo(g, 24, 24, 24, lighten(l.col, 0.2), 0.75)));
      l.spr = blooms.get(l.col);
      l.f = 0.8 + rnd() * 1.4;
      l.ph = rnd() * TAU;
    }

    // fireflies, in three swarms by colour
    const swarms = GLOWS.slice(0, 3).map((col) => ({ halo: col, core: lighten(col, 0.6), flies: [] }));
    for (let i = 0; i < 15; i++) {
      swarms[i % 3].flies.push({ x: rnd() * W, y: rnd() * H, vx: (rnd() - 0.5) * 9, vy: 3 + rnd() * 8, amp: 6 + rnd() * 16, f: 0.3 + rnd() * 0.8, tw: 1 + rnd() * 2.4, ph: rnd() * TAU, s: 1.8 + rnd() * 2, px: 0, py: 0, pr: 0 });
    }

    // the angry aura behind whoever is "it": six frames, each turned a little
    // further, so it can spin without ever being rotated or scaled at draw time
    const aura = [];
    for (let n = 0; n < 6; n++) {
      aura.push(
        sprite(96, 96, (g) => {
          const rg = g.createRadialGradient(48, 48, 8, 48, 48, 47);
          rg.addColorStop(0, rgba(HOT, 0.85));
          rg.addColorStop(0.5, rgba(HOT, 0.4));
          rg.addColorStop(1, rgba(HOT, 0));
          g.fillStyle = rg;
          g.fillRect(0, 0, 96, 96);
          g.fillStyle = 'rgba(255,196,110,.5)';
          g.beginPath();
          for (let i = 0; i < 12; i++) {
            const a = ((i + n / 3) / 12) * TAU; // rays alternate long and short, so the pattern repeats every two
            const len = (i % 2 ? 37 : 45) + (n % 2) * 1.5;
            g.moveTo(48 + Math.cos(a - 0.15) * 22, 48 + Math.sin(a - 0.15) * 22);
            g.lineTo(48 + Math.cos(a) * len, 48 + Math.sin(a) * len);
            g.lineTo(48 + Math.cos(a + 0.15) * 22, 48 + Math.sin(a + 0.15) * 22);
          }
          g.fill();
        }),
      );
    }

    // light under a bounce pod
    const padGlow = sprite(88, 52, (g) => {
      g.translate(44, 28);
      g.scale(1, 0.55);
      halo(g, 0, 0, 43, PINK, 0.65);
    });

    return { bg, shade, lights, swarms, aura, padGlow };
  },

  back(g, sc) {
    g.drawImage(sc.bg, 0, 0, W, H);
  },

  platform(g, p, i, rnd, arena) {
    if (p.ground) rock(g, rnd, p, arena);
    else shelf(g, rnd, p);
  },

  // a slope is a great leaning root, woven from two strands
  ramp(g, r, i, rnd, A) {
    // Like the default, it runs 16 past each end (a player's centre rides the
    // slope) - except where an end sits right on a surface, which it just meets.
    const meets = (x, y) => A.platforms.some((p) => Math.abs(p.y - y) < 2 && x >= p.x - 2 && x <= p.x + p.w + 2);
    const capA = meets(r.x0, r.y0) ? 3 : 16;
    const capB = meets(r.x1, r.y1) ? 3 : 16;
    const ang = Math.atan2(r.y1 - r.y0, r.x1 - r.x0);
    const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0) + capA + capB;
    g.translate(r.x0, r.y0);
    g.rotate(ang);
    g.translate(-capA, 0);
    const T = 13; // thickness
    mossGlow(g, 0, len, 0);
    // body: flat on top, tapering to a point at both ends
    g.beginPath();
    g.moveTo(-4, 1);
    g.lineTo(len + 4, 1);
    g.quadraticCurveTo(len - 6, T * 0.9, len - 26, T);
    for (let x = len - 44; x > 30; x -= 18 + rnd() * 10) g.quadraticCurveTo(x + 10, T + 3.5 + rnd() * 2, x, T + rnd() * 1.5);
    g.quadraticCurveTo(8, T * 0.9, -4, 1);
    g.closePath();
    const body = g.createLinearGradient(0, 0, 0, T + 4);
    body.addColorStop(0, '#32235f');
    body.addColorStop(1, '#130a2b');
    g.fillStyle = body;
    g.fill();
    g.strokeStyle = rgba(RIM, 0.6);
    g.lineWidth = 1.6;
    g.stroke();
    // the weave
    g.lineWidth = 1.5;
    for (let s = 0; s < 2; s++) {
      g.strokeStyle = s ? 'rgba(8,3,24,.55)' : rgba(RIM, 0.4);
      g.beginPath();
      for (let x = 8; x <= len - 8; x += 6) {
        const y = T * 0.55 + Math.sin(x / 13 + s * Math.PI) * T * 0.28;
        if (x === 8) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // lights hanging straight down (the picture is tilted, so "down" is too)
    const dx = Math.sin(ang);
    const dy = Math.cos(ang);
    for (let x = 40 + rnd() * 50; x < len - 40; x += 70 + rnd() * 90) {
      const l = 10 + rnd() * 16;
      const col = rnd() < 0.6 ? MOSS : GLOWS[1];
      g.strokeStyle = rgba(col, 0.6);
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, T);
      g.lineTo(x + dx * l, T + dy * l);
      g.stroke();
      halo(g, x + dx * l, T + dy * l, 7, col, 0.55);
      g.fillStyle = lighten(col, 0.55);
      g.beginPath();
      g.arc(x + dx * l, T + dy * l, 2, 0, TAU);
      g.fill();
    }
    moss(g, rnd, 0, len, 0, 4.5, 3);
  },

  // updrafts are spore wind: a soft stream with motes in it, and vents at the
  // foot of any column that stands on something
  decor(g, sc, A) {
    A.lifts.forEach((z, zi) => {
      const by = z.y + z.h;
      const cx = z.x + z.w / 2;
      // brighter down the middle
      const across = g.createLinearGradient(z.x, 0, z.x + z.w, 0);
      across.addColorStop(0, rgba(PINK, 0));
      across.addColorStop(0.5, rgba(PINK, 0.15));
      across.addColorStop(1, rgba(PINK, 0));
      g.fillStyle = across;
      g.fillRect(z.x, z.y, z.w, z.h);
      // and thickest near its source
      const rise = Math.min(z.h, 220);
      const up = g.createLinearGradient(0, by - rise, 0, by);
      up.addColorStop(0, rgba(PINK, 0));
      up.addColorStop(1, rgba(PINK, 0.2));
      g.fillStyle = up;
      g.fillRect(z.x, by - rise, z.w, rise);
      // motes caught in the stream
      const motes = Math.round(z.h / 24);
      for (let n = 0; n < motes; n++) {
        const mx = z.x + 9 + (z.w - 18) * hash1(n * 7 + 1, zi + 11);
        const my = z.y + ((n + hash1(n * 5 + 2, zi + 23)) / motes) * z.h; // spread evenly up the column
        const r = 1.1 + 1.5 * hash1(n * 3 + 4, zi + 37);
        halo(g, mx, my, r * 4.5, PINK, 0.32);
        g.fillStyle = rgba(lighten(PINK, 0.6), 0.75);
        g.beginPath();
        g.arc(mx, my, r, 0, TAU);
        g.fill();
      }
      if (!A.platforms.some((p) => Math.abs(p.y - by) < 3 && p.x < z.x + z.w && p.x + p.w > z.x)) return;
      halo(g, cx, by - 4, 46, PINK, 0.45);
      for (let k = -1; k <= 1; k++) {
        const vx = cx + k * 22;
        const vh = 9 - Math.abs(k) * 2;
        g.fillStyle = '#b8409a';
        g.strokeStyle = INK;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(vx - 5, by - 1);
        g.quadraticCurveTo(vx - 4, by - vh, vx - 8, by - vh - 3);
        g.lineTo(vx + 8, by - vh - 3);
        g.quadraticCurveTo(vx + 4, by - vh, vx + 5, by - 1);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = lighten(PINK, 0.5);
        g.beginPath();
        g.ellipse(vx, by - vh - 3, 7, 2.2, 0, 0, TAU);
        g.fill();
      }
    });
  },

  front(g, sc) {
    g.drawImage(sc.shade, 0, 0, W, H);
  },

  // a jelly-capped bounce pod that squashes flat when someone lands on it
  trampoline(g, tr, t, k, sc) {
    const x = tr.x;
    const w = tr.w;
    const base = tr.y + tr.h;
    const top = tr.y - 5 + k * 9;
    g.drawImage(sc.padGlow, x - 10, tr.y - 30, w + 20, 52);
    // dark outline of the cap, and the stubby foot under it
    g.beginPath();
    capPath(g, x, w, base, k, 1);
    g.moveTo(x + w * 0.3, base - 9 + k * 3);
    g.lineTo(x + w * 0.7, base - 9 + k * 3);
    g.lineTo(x + w * 0.76, base);
    g.lineTo(x + w * 0.24, base);
    g.closePath();
    g.fillStyle = INK;
    g.fill();
    g.beginPath();
    capPath(g, x, w, base, k, -0.9);
    g.fillStyle = '#ff62c6';
    g.fill();
    // shine and spots
    g.fillStyle = '#ffd0f1';
    g.beginPath();
    g.ellipse(x + w * 0.3, top + 5.5, w * 0.13, 2.2, -0.12, 0, TAU);
    g.ellipse(x + w * 0.62, top + 6.5, 3.4, 2.4, 0, 0, TAU);
    g.ellipse(x + w * 0.8, top + 8.5, 2.4, 1.8, 0, 0, TAU);
    g.fill();
    if (k > 0.05) {
      // spores knocked loose
      g.globalAlpha = Math.min(1, k * 1.5);
      for (let n = 0; n < 4; n++) {
        const px = x + w * (0.14 + 0.24 * n);
        g.fillRect(px - 1.5, top - 8 - k * 16 - (n % 2) * 6, 3, 3);
      }
    }
  },

  // a ring of thorny vine around a pool of light, set with crystals in the pair colour
  portal(g, po, t, i) {
    const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
    const cx = po.cx;
    const cy = po.cy;
    const rx = 19;
    const ry = 33;
    halo(g, cx, cy, 46, col, 0.5);
    // pool
    const pool = g.createRadialGradient(cx, cy, 1, cx, cy, ry);
    pool.addColorStop(0, '#ffffff');
    pool.addColorStop(0.25, lighten(col, 0.55));
    pool.addColorStop(0.6, col);
    pool.addColorStop(1, darken(col, 0.55));
    g.fillStyle = pool;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.fill();
    // a slow swirl in it
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.beginPath();
    for (let a = 0.5; a < 7.4; a += 0.25) {
      const r = a * 2.1;
      const px = cx + Math.cos(a * 1.5 + i) * r * 0.58;
      const py = cy + Math.sin(a * 1.5 + i) * r;
      if (a === 0.5) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    // roots gripping the ground
    g.strokeStyle = INK;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - 8, cy + ry + 1);
    g.quadraticCurveTo(cx - 16, cy + ry + 1, cx - 24, cy + ry + 5);
    g.moveTo(cx + 8, cy + ry + 1);
    g.quadraticCurveTo(cx + 16, cy + ry + 1, cx + 24, cy + ry + 5);
    g.stroke();
    // crystals pointing outwards
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + ((k - 4) / 4) * 2.25;
      const bx = cx + Math.cos(a) * (rx + 1);
      const by = cy + Math.sin(a) * (ry + 1);
      const len = k % 2 ? 7 : 11;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      g.fillStyle = k % 2 ? col : lighten(col, 0.45);
      g.strokeStyle = INK;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(bx - ny * 3.6, by + nx * 3.6);
      g.lineTo(bx + nx * len, by + ny * len);
      g.lineTo(bx + ny * 3.6, by - nx * 3.6);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // the vine ring, with a bright inner lip
    g.strokeStyle = INK;
    g.lineWidth = 6.5;
    g.beginPath();
    g.ellipse(cx, cy, rx + 1, ry + 1, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = '#4a3690';
    g.lineWidth = 2.6;
    g.beginPath();
    g.ellipse(cx, cy, rx + 1.5, ry + 1.5, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = lighten(col, 0.6);
    g.lineWidth = 1.6;
    g.beginPath();
    g.ellipse(cx, cy, rx - 2.4, ry - 2.4, 0, 0, TAU);
    g.stroke();
  },

  // a glowing egg in a leafy cup, with the power marked on its shell
  pickup(g, kind, x, y) {
    const col = KIND_COLORS[kind];
    halo(g, x, y, 32, col, 0.6);
    const egg = () => {
      g.beginPath();
      g.moveTo(x, y - 16);
      g.bezierCurveTo(x + 9, y - 16, x + 13, y - 3, x + 13, y + 3);
      g.bezierCurveTo(x + 13, y + 11, x + 7, y + 15, x, y + 15);
      g.bezierCurveTo(x - 7, y + 15, x - 13, y + 11, x - 13, y + 3);
      g.bezierCurveTo(x - 13, y - 3, x - 9, y - 16, x, y - 16);
      g.closePath();
    };
    const shell = g.createRadialGradient(x - 4, y - 6, 1, x, y, 18);
    shell.addColorStop(0, lighten(col, 0.75));
    shell.addColorStop(0.55, col);
    shell.addColorStop(1, darken(col, 0.3));
    egg();
    g.fillStyle = shell;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.stroke();
    // cup of three leaves
    g.fillStyle = '#3a2a6c';
    g.beginPath();
    g.moveTo(x - 12, y + 7);
    g.quadraticCurveTo(x - 8, y + 12, x - 4, y + 11);
    g.quadraticCurveTo(x, y + 15, x + 4, y + 11);
    g.quadraticCurveTo(x + 8, y + 12, x + 12, y + 7);
    g.quadraticCurveTo(x + 11, y + 17, x, y + 18);
    g.quadraticCurveTo(x - 11, y + 17, x - 12, y + 7);
    g.closePath();
    g.fill();
    g.stroke();
    drawIcon(g, kind, x, y - 2.5, 7.5, INK);
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.beginPath();
    g.ellipse(x - 6.5, y - 9.5, 2.2, 3.4, 0.5, 0, TAU);
    g.fill();
  },

  player(g, pv, t, sc) {
    const { cx, feet, color } = pv;
    const tint = tints(color);
    const f = pv.face;
    const air = !pv.ground;
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const bob = moving ? Math.abs(Math.cos(pv.run)) * 1.8 : air ? 0 : 0.5 + 0.5 * Math.sin(t * 3 + pv.seed);
    const it = pv.isIt;

    if (it) {
      // baked glow: pick the frame for this moment and stamp it 1:1 on whole pixels
      const spr = sc.aura[Math.floor(t * 11) % 6];
      const m = g.getTransform();
      const w = spr.width / m.a;
      g.drawImage(spr, (Math.round((cx - 48) * m.a + m.e) - m.e) / m.a, (Math.round((pv.y - 27) * m.d + m.f) - m.f) / m.d, w, w);
    }

    squashAt(g, cx, feet, pv.squash);
    const by = pv.y + 23 - bob; // middle of the body

    // feet - and, on whoever is it, spines down the back. Dark copy, then coloured copy.
    let ax = cx - 6; // where the two feet are, and how they are tilted
    let ay = feet - 3.2;
    let bx = cx + 6;
    let b2 = feet - 3.2;
    let tilt = 0;
    if (air) {
      const up = pv.vy < 0; // tucked back on the way up, spread wide on the way down
      ax = cx - (up ? 4.5 + f * 3 : 9);
      bx = cx + (up ? 4.5 - f * 3 : 9);
      ay = feet - (up ? 2 : 5.5);
      b2 = ay + (up ? 1 : 0);
      tilt = up ? f * 0.5 : 0.4;
    } else if (moving) {
      const sw = Math.sin(pv.run) * 5.5;
      const c = Math.cos(pv.run) * 3.5;
      ax += sw;
      bx -= sw;
      ay -= Math.max(0, c);
      b2 -= Math.max(0, -c);
    }
    for (let pass = 0; pass < 2; pass++) {
      const o = pass ? -0.9 : 0.9;
      g.beginPath();
      g.ellipse(ax, ay, 5 + o, 3.2 + o, air && pv.vy >= 0 ? -tilt : tilt, 0, TAU);
      g.ellipse(bx, b2, 5 + o, 3.2 + o, tilt, 0, TAU);
      if (it) {
        for (let n = 0; n < 3; n++) {
          const px = cx - f * (6 + n * 4.2);
          const py = by - 13 + n * n * 2.6;
          g.moveTo(px + f * (2.8 + o * 0.8), py + 3.2 + o);
          g.lineTo(px - f * (5 + o * 1.5), py - 5 + n * 2 - o * 1.5);
          g.lineTo(px - f * (1.1 + o * 0.5), py + 6 + o * 1.3);
        }
      }
      g.fillStyle = pass ? tint.dark : INK;
      g.fill();
    }

    // antennae: they trail behind when it runs and fly up when it falls
    const sway = clamp(pv.vx / 55, -5, 5) + Math.sin(t * 5 + pv.seed) * 1.1;
    const hx = cx + f; // crown of the head
    const lx = hx - (it ? 10 : 9) - sway; // the two tips
    const rx = hx + (it ? 10 : 9) - sway;
    const ty = by - (it ? 28 : 24) - clamp(pv.vy / 150, -4, 4.5);

    // the whole dark silhouette in one fill: body and tail, antenna stalks, tips
    const wag = air ? clamp(pv.vy / 90, -6, 6) : Math.sin(moving ? pv.run * 2 : t * 4 + pv.seed) * 2;
    g.beginPath();
    bodyPath(g, cx, by, f, wag, 1);
    if (it) {
      // barbed tips (their jagged stalks are drawn further down)
      for (let n = 0; n < 2; n++) {
        const x = n ? rx : lx;
        g.moveTo(x, ty - 6);
        g.lineTo(x + f * 4.7, ty);
        g.lineTo(x, ty + 4.5);
        g.lineTo(x - f * 4.7, ty);
        g.closePath();
      }
    } else {
      // bulb tips on thin curved stalks
      for (let n = 0; n < 2; n++) {
        const x = n ? rx : lx;
        const root = hx + (n ? 5 : -5);
        const bend = hx + (n ? 6 : -6) - sway * 0.3;
        g.moveTo(root - f * 1.1, by - 13.5);
        g.quadraticCurveTo(bend - f * 1.1, by - 20, x - f, ty);
        g.lineTo(x + f, ty);
        g.quadraticCurveTo(bend + f * 1.1, by - 20, root + f * 1.1, by - 13.5);
        g.closePath();
        g.moveTo(x + 3.7, ty);
        g.arc(x, ty, 3.7, 0, TAU, f < 0);
      }
    }
    g.fillStyle = INK;
    g.fill();

    // the body in its own colour, and freckles on its back
    g.beginPath();
    bodyPath(g, cx, by, f, wag, -1);
    g.fillStyle = color;
    g.fill();
    g.fillStyle = tint.shade;
    g.beginPath();
    g.arc(cx - f * 8, by + 4, 2.3, 0, TAU);
    g.arc(cx - f * 5, by + 9.5, 1.6, 0, TAU);
    g.fill();

    // antenna tips, lit up
    g.beginPath();
    if (it) {
      g.moveTo(lx, ty - 4);
      g.lineTo(lx + 3, ty);
      g.lineTo(lx, ty + 2.8);
      g.lineTo(lx - 3, ty);
      g.moveTo(rx, ty - 4);
      g.lineTo(rx + 3, ty);
      g.lineTo(rx, ty + 2.8);
      g.lineTo(rx - 3, ty);
      g.fillStyle = '#ffe27a';
      g.fill();
      // jagged stalks, like little lightning bolts
      g.beginPath();
      g.moveTo(hx - 5, by - 14);
      g.lineTo(hx - 9, by - 19);
      g.lineTo(hx - 5 - sway * 0.5, by - 21);
      g.lineTo(lx, ty + 3.5);
      g.moveTo(hx + 5, by - 14);
      g.lineTo(hx + 9, by - 19);
      g.lineTo(hx + 5 - sway * 0.5, by - 21);
      g.lineTo(rx, ty + 3.5);
      g.strokeStyle = INK;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.stroke();
    } else {
      g.arc(lx, ty, 2.3, 0, TAU);
      g.moveTo(rx + 2.3, ty);
      g.arc(rx, ty, 2.3, 0, TAU);
      g.fillStyle = tint.light;
      g.fill();
    }

    // one big eye
    const ex = cx + f * 4.5;
    const ey = by - 3.5;
    const shut = pv.blink > 0.5 && !it;
    g.fillStyle = INK;
    g.beginPath();
    g.arc(ex, ey, 7.6, 0, TAU);
    g.fill();
    g.fillStyle = shut ? tint.shade : '#ffffff';
    g.beginPath();
    g.arc(ex, ey, 6, 0, TAU);
    g.fill();
    g.strokeStyle = INK;
    g.lineCap = 'round';
    if (shut) {
      // just the lid and a lash line
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(ex - 5.5, ey + 0.5);
      g.quadraticCurveTo(ex, ey + 3.5, ex + 5.5, ey + 0.5);
      g.stroke();
    } else if (pv.stunned) {
      // dazed: a cross
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(ex - 3.2, ey - 3.2);
      g.lineTo(ex + 3.2, ey + 3.2);
      g.moveTo(ex + 3.2, ey - 3.2);
      g.lineTo(ex - 3.2, ey + 3.2);
      g.stroke();
    } else {
      // the pupil looks where it is going: ahead, and up or down with its flight
      const px = ex + f * 2;
      const py = ey + clamp(pv.vy / 320, -1.6, 1.6) + (it ? 1 : 0);
      if (it) {
        g.fillStyle = HOT;
        g.beginPath();
        g.arc(px, py, 3.9, 0, TAU);
        g.fill();
      }
      g.fillStyle = INK;
      g.beginPath();
      g.arc(px, py, it ? 2.1 : 3.4, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillRect(px - 2.2, py - 2.6, 1.7, 1.7);
    }
    if (it) {
      // heavy slanted lid: the top slice of the eye, cut along a brow
      g.beginPath();
      if (f > 0) g.arc(ex, ey, 6.4, Math.PI + 0.55, 0.12);
      else g.arc(ex, ey, 6.4, Math.PI - 0.12, -0.55);
      g.fillStyle = tint.dark;
      g.fill();
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(ex - f * 7.4, ey - 4.9);
      g.lineTo(ex + f * 8, ey + 1.2);
      g.stroke();
    }

    // mouth: a smile, a gasp in mid-air, or gritted teeth
    const mx = cx + f * 5.5;
    const my = by + 7.5;
    g.beginPath();
    if (air && !it) {
      g.fillStyle = INK;
      g.arc(mx, my, 2, 0, TAU);
      g.fill();
    } else {
      if (it) {
        g.moveTo(mx - 4.5, my + 1);
        g.lineTo(mx - 2.2, my - 1.2);
        g.lineTo(mx, my + 1);
        g.lineTo(mx + 2.2, my - 1.2);
        g.lineTo(mx + 4.5, my + 1);
      } else g.arc(mx, my - 1.5, 3.2, 0.5, Math.PI - 0.5);
      g.lineWidth = 1.6;
      g.stroke();
    }
  },

  // a hot thorn-pod that hangs over whoever is "it"
  marker(g, cx, cy) {
    g.save();
    g.translate(cx, cy - 11);
    halo(g, 0, -2, 30, HOT, 0.65);
    // pointer
    g.fillStyle = HOT;
    g.strokeStyle = INK;
    g.lineWidth = 2.2;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-7, 11);
    g.lineTo(0, 22);
    g.lineTo(7, 11);
    g.closePath();
    g.fill();
    g.stroke();
    // spiky body
    g.beginPath();
    const n = 14;
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * TAU - Math.PI / 2;
      const k = i % 2 ? 0.8 : 1.08;
      const px = Math.cos(a) * 20 * k;
      const py = Math.sin(a) * 15 * k;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
    const body = g.createLinearGradient(0, -15, 0, 15);
    body.addColorStop(0, '#ffe76e');
    body.addColorStop(0.55, '#ff9a3c');
    body.addColorStop(1, HOT);
    g.fillStyle = body;
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.font = '900 17px "Orbitron", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('IT', 0, 1);
    g.restore();
  },

  // every frame: plant lights breathing, fireflies drifting up
  live(g, sc, t) {
    // lights: a baked bloom stamped 1:1 on whole pixels (the cheapest way to draw a sprite)
    const m = g.getTransform();
    for (let i = 0; i < sc.lights.length; i++) {
      const l = sc.lights[i];
      const d = l.spr.width / m.a;
      g.globalAlpha = 0.34 + 0.3 * Math.sin(t * l.f + l.ph);
      g.drawImage(l.spr, (Math.round((l.x - d / 2) * m.a + m.e) - m.e) / m.a, (Math.round((l.y - d / 2) * m.d + m.f) - m.f) / m.d, d, d);
    }
    // fireflies: a faint disc with a bright core. Each is its own tiny path -
    // one big path scattered across the screen is far slower to fill.
    for (let k = 0; k < sc.swarms.length; k++) {
      const swarm = sc.swarms[k];
      for (let pass = 0; pass < 2; pass++) {
        g.globalAlpha = pass ? 0.95 : 0.2;
        g.fillStyle = pass ? swarm.core : swarm.halo;
        for (let i = 0; i < swarm.flies.length; i++) {
          const p = swarm.flies[i];
          if (!pass) {
            p.px = ((((p.x + t * p.vx + Math.sin(t * p.f + p.ph) * p.amp) % (W + 20)) + W + 20) % (W + 20)) - 10;
            // Up and down they stay inside the band of the board that is always on screen
            // (30 from each edge), shrinking to nothing where they wrap round.
            p.py = 30 + ((((p.y - t * p.vy + Math.cos(t * p.f * 0.8 + p.ph) * p.amp * 0.6) % (H - 60)) + H - 60) % (H - 60));
            const edge = Math.min(1, (p.py - 30) / 14, (H - 30 - p.py) / 14);
            p.pr = p.s * (0.55 + 0.45 * Math.sin(t * p.tw + p.ph)) * edge; // they twinkle by swelling and shrinking
          }
          if (p.pr < 0.15) continue;
          g.beginPath();
          g.arc(p.px, p.py, pass ? p.pr * 0.36 : p.pr, 0, TAU);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
  },

  fx: {
    // spores puff out of the moss
    jump(R, pv) {
      R.emit({ x: pv.cx, y: pv.feet - 2, life: 0.32, size: 5, grow: 46, alpha: 0.5, shape: 'ring', width: 2, color: MOSS, back: true });
      for (let i = 0; i < 6; i++) {
        R.emit({ x: pv.cx + (Math.random() - 0.5) * 20, y: pv.feet - 2, vx: (Math.random() - 0.5) * 110, vy: -30 - Math.random() * 60, g: -50, drag: 2.5, life: 0.5 + Math.random() * 0.3, size: 1.4 + Math.random() * 1.6, color: i % 3 ? MOSS : MOSS_HI, back: true });
      }
    },
    land(R, pv, impact) {
      for (const d of [-1, 1]) R.emit({ x: pv.cx + d * 9, y: pv.feet - 3, vx: d * (50 + impact * 70), life: 0.4, size: 4, grow: 20, drag: 4, alpha: 0.28, color: MOSS });
      for (let i = 0; i < 4 + impact * 5; i++) {
        const d = i % 2 ? 1 : -1;
        R.emit({ x: pv.cx + d * 8, y: pv.feet - 2, vx: d * (30 + Math.random() * 130), vy: -50 - Math.random() * 90, g: 160, drag: 2, life: 0.5 + Math.random() * 0.3, size: 1.3 + Math.random() * 1.7, color: i % 3 ? MOSS : MOSS_HI });
      }
    },
    step(R, pv) {
      if (Math.random() < 0.55) R.emit({ x: pv.cx - pv.face * 9, y: pv.feet - 2, vx: -pv.face * 30, vy: -45, g: -30, drag: 2, life: 0.4, size: 1.2 + Math.random(), color: MOSS, back: true });
    },
    // embers shed by whoever is "it"
    trail(R, pv, dt) {
      if (pv.isIt && Math.random() < dt * 12) R.emit({ x: pv.cx + (Math.random() - 0.5) * 22, y: pv.y + 8 + Math.random() * 26, vx: -pv.vx * 0.1, vy: -40 - Math.random() * 40, life: 0.5, size: 1.6 + Math.random() * 1.2, color: Math.random() < 0.5 ? HOT : '#ffc46e', back: true });
    },
    respawn(R, pv) {
      R.emit({ x: pv.cx, y: pv.y + 20, life: 0.45, size: 44, grow: -80, shape: 'ring', width: 3, color: MOSS });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        R.emit({ x: pv.cx + Math.cos(a) * 36, y: pv.y + 20 + Math.sin(a) * 36, vx: -Math.cos(a) * 70, vy: -Math.sin(a) * 70, life: 0.5, size: 2.2, color: i % 2 ? MOSS_HI : pv.color });
      }
    },
    // a splash of hot goo
    tag(R, to) {
      R.flash(HOT, 0.16);
      const x = to.cx;
      const y = to.y + 20;
      R.emit({ x, y, life: 0.45, size: 14, grow: 190, shape: 'ring', width: 5, color: HOT });
      R.emit({ x, y, life: 0.6, size: 8, grow: 120, shape: 'ring', width: 2.5, color: '#ffe27a' });
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * TAU;
        const v = 110 + Math.random() * 360;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 90, g: 950, drag: 1.4, life: 0.5 + Math.random() * 0.45, size: 1.8 + Math.random() * 3.6, color: i % 4 === 0 ? '#ffe27a' : i % 4 === 1 ? to.color : HOT });
      }
    },
  },
};
