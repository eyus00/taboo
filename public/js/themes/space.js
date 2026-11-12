// ORBIT - outer space. Little astronauts play tag on and around a space
// station: hull modules for solid ground, lit catwalks for ledges, and the
// glowing horizon of a planet far below.
//
// Everything that glows (the red aura of whoever is it, beacon flares, thruster
// puffs, star sparkles) is baked into small sprites in build() and only stamped
// per frame. The astronauts' helmets and suits are sprites too, so they can be
// shaded properly and still cost next to nothing to draw.

import { ART_W as W, ART_H as H } from '/shared/config.js';
import { rgba, mix, lighten, darken, clamp, mulberry32, squashAt, rr, drawIcon, KIND_COLORS, PORTAL_COLORS } from '../util.js';

const TAU = Math.PI * 2;
const OUT = '#060918'; // outlines and the deepest shadow
const CYAN = '#63dcff'; // station lighting: "you can stand here"
const AMBER = '#ffb62e'; // jump pads and hazard paint
const ALERT = '#ff4a3d'; // whoever is it
const SPACE = '#070a1d';
const LIFT = '#8fe9ff'; // ion stream in the updraft columns
const COLORS = ['#ff5747', '#3f9dff', '#3fd97f', '#ffd23f']; // red, blue, green, yellow

// the planet whose horizon fills the bottom of the picture
const PX = 300;
const PY = 1245;
const PR = 900;
const limbY = (x) => PY - Math.sqrt(PR * PR - (x - PX) * (x - PX));
const SUN_X = 610; // the sun is just about to rise here

// the far-off station (art-board position and tilt)
const ST = { x: 612, y: 150, rot: -0.2, s: 0.6 };
const MOON = { x: 116, y: 96, r: 25 };

// ---------------------------------------------------------------------------
// Backdrop pieces (painted once)
// ---------------------------------------------------------------------------

// a soft round glow
function glowDot(g, x, y, r, col, a) {
  const rg = g.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, rgba(col, a));
  rg.addColorStop(0.45, rgba(col, a * 0.4));
  rg.addColorStop(1, rgba(col, 0));
  g.fillStyle = rg;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

// 2-D value noise and a few octaves of it, for painting gas and clouds
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, seed, octaves = 5) {
  let v = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += amp * noise2(x, y, seed + o * 17);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return v / norm;
}
const smooth = (lo, hi, v) => {
  const k = clamp((v - lo) / (hi - lo), 0, 1);
  return k * k * (3 - 2 * k);
};

// centre line of the river of gas that crosses the sky
const riverY = (s) => 108 + s * 150 + Math.sin(s * 7) * 26;

// The nebula. Worked out pixel by pixel on a small canvas and scaled up, which
// keeps it soft (stacking hundreds of faint gradients leaves a dither pattern).
function nebula(g, rnd, layer) {
  const seed = (rnd() * 1e5) | 0;
  const TINTS = [[84, 54, 190], [150, 56, 150], [40, 92, 190], [22, 128, 146]]; // violet, magenta, blue, teal
  const tex = layer((t) => {
    const cw = t.canvas.width;
    const ch = t.canvas.height;
    const sc = cw / W;
    const img = t.createImageData(cw, ch);
    const px = img.data;
    for (let y = 0, o = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++, o += 4) {
        const ax = (x + 0.5) / sc;
        const ay = (y + 0.5) / sc;
        const s = (ax + 60) / 920;
        // swirl the sampling point about so the gas looks wispy
        const wx = ax / 96 + 1.8 * fbm(ax / 150, ay / 150, seed + 1, 3);
        const wy = ay / 96 + 1.8 * fbm(ax / 150 + 5.2, ay / 150 + 1.3, seed + 2, 3);
        const n = fbm(wx, wy, seed + 3);
        // the main river, and a fainter wisp low on the right
        const spread = 44 + 58 * Math.sin(clamp(s, 0, 1) * Math.PI);
        const d1 = (ay - riverY(s)) / spread;
        const d2 = (ay - (338 - (ax - 420) * 0.17)) / 58;
        const river = Math.exp(-d1 * d1);
        const wisp = Math.exp(-d2 * d2) * smooth(360, 600, ax) * 0.45;
        let dens = smooth(0.34, 0.74, n) * Math.max(river, wisp);
        dens += 0.07 * smooth(0.4, 0.7, fbm(ax / 240 + 3, ay / 240, seed + 9, 3)); // a breath of haze everywhere
        // bright filaments along the folds of the gas
        const fold = 1 - Math.abs(2 * fbm(wx * 1.7 + 3, wy * 1.7, seed + 7, 4) - 1);
        const glow = dens * (0.38 + 0.36 * fold ** 5);
        // colour drifts from violet on the left to teal on the right
        const hue = clamp((fbm(ax / 200 + 9, ay / 200, seed + 5, 3) - 0.5) * 2.4 + s * 1.5 + (1.4 * wisp) / (wisp + river + 0.02), 0, 2.999);
        const c0 = TINTS[hue | 0];
        const c1 = TINTS[(hue | 0) + 1];
        const f = hue - (hue | 0);
        const grain = hash2(x, y, seed) - 0.5; // hides banding in the darkest parts
        px[o] = (c0[0] + (c1[0] - c0[0]) * f) * glow + grain;
        px[o + 1] = (c0[1] + (c1[1] - c0[1]) * f) * glow + grain;
        px[o + 2] = (c0[2] + (c1[2] - c0[2]) * f) * glow + grain;
        px[o + 3] = 255;
      }
    }
    t.putImageData(img, 0, 0);
  }, 0.4);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.drawImage(tex, 0, 0, W, H);
  g.restore();
}

const starTint = (k) => (k < 0.6 ? '#e2eaff' : k < 0.8 ? '#a9c6ff' : k < 0.93 ? '#ffe3b8' : '#ffb9a0');

// a star bright enough to have a halo and diffraction spikes
function brightStar(g, x, y, r, col) {
  glowDot(g, x, y, r * 5, col, 0.55);
  for (const vert of [0, 1]) {
    const len = r * 9;
    const lg = vert ? g.createLinearGradient(0, y - len, 0, y + len) : g.createLinearGradient(x - len, 0, x + len, 0);
    lg.addColorStop(0, rgba(col, 0));
    lg.addColorStop(0.5, rgba(col, 0.75));
    lg.addColorStop(1, rgba(col, 0));
    g.fillStyle = lg;
    if (vert) g.fillRect(x - 0.3, y - len, 0.6, len * 2);
    else g.fillRect(x - len, y - 0.3, len * 2, 0.6);
  }
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x, y, r * 0.6, 0, TAU);
  g.fill();
}

function starfield(g, rnd) {
  for (let i = 0; i < 950; i++) {
    const m = rnd() ** 3; // most are faint
    const s = 0.45 + m * 0.95;
    g.fillStyle = rgba(starTint(rnd()), 0.22 + m * 0.7);
    g.fillRect(rnd() * W, rnd() * H, s, s);
  }
  // star dust thickens along the nebula
  for (let i = 0; i < 420; i++) {
    const s = rnd();
    g.fillStyle = rgba(starTint(rnd()), 0.12 + rnd() * 0.3);
    g.fillRect(-60 + s * 920, riverY(s) + (rnd() + rnd() - 1) * 70, 0.55, 0.55);
  }
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const col = starTint(rnd());
    glowDot(g, x, y, 2.2 + rnd() * 2.2, col, 0.5);
    g.fillStyle = '#ffffff';
    g.fillRect(x - 0.5, y - 0.5, 1, 1);
  }
  const big = [[236, 58, 1.5, '#cfe0ff'], [704, 66, 1.25, '#ffe9c8'], [452, 34, 1.1, '#cfe0ff'], [372, 236, 1.2, '#e6dcff'], [748, 268, 1.0, '#cfe0ff'], [54, 250, 1.15, '#ffe0c0'], [520, 300, 0.9, '#cfe0ff']];
  for (const [x, y, r, col] of big) brightStar(g, x, y, r, col);
}

// a small ringed moon, lit from the lower right like everything else
function ringedMoon(g, rnd) {
  const { x, y, r } = MOON;
  const ring = (a0, a1) => {
    g.save();
    g.translate(x, y);
    g.rotate(-0.36);
    g.strokeStyle = 'rgba(190,176,222,.5)';
    g.lineWidth = r * 0.2;
    g.beginPath();
    g.ellipse(0, 0, r * 2.0, r * 0.44, 0, a0, a1);
    g.stroke();
    g.strokeStyle = 'rgba(130,142,212,.4)';
    g.lineWidth = r * 0.1;
    g.beginPath();
    g.ellipse(0, 0, r * 1.58, r * 0.33, 0, a0, a1);
    g.stroke();
    g.restore();
  };
  ring(Math.PI, TAU); // far half of the ring, behind the moon
  const rg = g.createRadialGradient(x + r * 0.5, y + r * 0.45, r * 0.1, x + r * 0.1, y + r * 0.1, r * 1.3);
  rg.addColorStop(0, '#b9abc9');
  rg.addColorStop(0.45, '#75698f');
  rg.addColorStop(0.8, '#2a2848');
  rg.addColorStop(1, '#10122a');
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.clip();
  g.fillStyle = rg;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  // soft bands and a few craters
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `rgba(20,16,50,${0.06 + rnd() * 0.08})`;
    g.fillRect(x - r, y - r + rnd() * r * 2, r * 2, 1.5 + rnd() * 4);
  }
  for (let i = 0; i < 7; i++) {
    const a = rnd() * TAU;
    const d = rnd() * r * 0.8;
    g.fillStyle = 'rgba(20,16,50,.22)';
    g.beginPath();
    g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rnd() * 2.6, 0.8 + rnd() * 1.8, rnd(), 0, TAU);
    g.fill();
  }
  g.restore();
  ring(0, Math.PI); // near half
  // a second, tiny moon further out
  const m2 = g.createRadialGradient(498, 79, 0.5, 496, 77, 6);
  m2.addColorStop(0, '#9fb0c8');
  m2.addColorStop(1, '#151a34');
  g.fillStyle = m2;
  g.beginPath();
  g.arc(496, 77, 4.2, 0, TAU);
  g.fill();
}

// The big station in the distance: a wheel on a long truss with solar wings.
// Kept dark and low in contrast so it never competes with the platforms.
function farStation(g, rnd, beacons) {
  const BODY = '#111a36';
  const EDGE = '#2c3b68';
  const cosr = Math.cos(ST.rot);
  const sinr = Math.sin(ST.rot);
  const toArt = (lx, ly) => ({ x: ST.x + (lx * cosr - ly * sinr) * ST.s, y: ST.y + (lx * sinr + ly * cosr) * ST.s });
  g.save();
  g.translate(ST.x, ST.y);
  g.rotate(ST.rot);
  g.scale(ST.s, ST.s);
  g.lineJoin = 'round';

  const wheel = (a0, a1) => {
    g.strokeStyle = BODY;
    g.lineWidth = 10;
    g.beginPath();
    g.ellipse(0, 0, 24, 64, 0, a0, a1);
    g.stroke();
    g.strokeStyle = EDGE;
    g.lineWidth = 0.9;
    g.beginPath();
    g.ellipse(0, 0, 29, 69, 0, a0, a1);
    g.stroke();
    g.strokeStyle = rgba(EDGE, 0.6);
    g.beginPath();
    g.ellipse(0, 0, 19, 59, 0, a0, a1);
    g.stroke();
  };
  wheel(Math.PI / 2, Math.PI * 1.5); // the half of the wheel behind the truss

  // spokes
  g.strokeStyle = EDGE;
  g.lineWidth = 1.2;
  g.beginPath();
  for (const a of [-1.57, -0.5, 0.5, 1.57, 2.64, 3.64]) {
    g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    g.lineTo(Math.cos(a) * 24, Math.sin(a) * 64);
  }
  g.stroke();

  // truss: two chords and a zigzag between them
  g.strokeStyle = EDGE;
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(-160, -3.2);
  g.lineTo(160, -3.2);
  g.moveTo(-160, 3.2);
  g.lineTo(160, 3.2);
  for (let x = -160; x < 160; x += 8) {
    g.moveTo(x, -3.2);
    g.lineTo(x + 4, 3.2);
    g.lineTo(x + 8, -3.2);
  }
  g.stroke();

  // solar wings in pairs at both ends
  for (const s of [-1, 1]) {
    for (const off of [112, 138]) {
      for (const v of [-1, 1]) {
        const wx = s * off - 10;
        const wy = v > 0 ? 7 : -7 - 46;
        const lg = g.createLinearGradient(wx, wy, wx + 20, wy + 46);
        lg.addColorStop(0, '#18265c');
        lg.addColorStop(1, '#0d1536');
        g.fillStyle = lg;
        g.fillRect(wx, wy, 20, 46);
        g.strokeStyle = 'rgba(86,118,210,.32)';
        g.lineWidth = 0.5;
        g.beginPath();
        for (let k = 1; k < 8; k++) {
          g.moveTo(wx, wy + k * 5.75);
          g.lineTo(wx + 20, wy + k * 5.75);
        }
        g.moveTo(wx + 10, wy);
        g.lineTo(wx + 10, wy + 46);
        g.stroke();
        g.strokeStyle = rgba(EDGE, 0.9);
        g.lineWidth = 0.7;
        g.strokeRect(wx, wy, 20, 46);
        g.fillStyle = EDGE;
        g.fillRect(s * off - 0.6, v > 0 ? 3 : -7, 1.2, 4);
      }
    }
  }
  // radiator fins nearer the hub
  g.fillStyle = '#1a2446';
  for (const s of [-1, 1]) {
    g.fillRect(s * 66 - 4, -30, 8, 26);
    g.fillRect(s * 66 - 4, 4, 8, 20);
  }
  // modules strung along the truss
  g.fillStyle = BODY;
  g.strokeStyle = EDGE;
  g.lineWidth = 0.8;
  for (const [mx, mw, mh] of [[-52, 26, 12], [-88, 18, 9], [44, 30, 13], [84, 16, 9]]) {
    rr(g, mx - mw / 2, -mh / 2, mw, mh, 3);
    g.fill();
    g.stroke();
  }
  // hub
  rr(g, -15, -9.5, 30, 19, 5);
  g.fill();
  g.stroke();
  g.fillRect(-4, -17, 8, 8);
  g.strokeRect(-4, -17, 8, 8);

  wheel(-Math.PI / 2, Math.PI / 2); // the near half of the wheel

  // lit windows
  for (let i = 0; i < 26; i++) {
    const a = -1.35 + (i / 25) * 2.7;
    if (rnd() < 0.3) continue;
    g.fillStyle = rnd() < 0.8 ? `rgba(255,214,140,${0.45 + rnd() * 0.45})` : 'rgba(150,225,255,.8)';
    g.fillRect(Math.cos(a) * 24 - 0.6, Math.sin(a) * 64 - 0.6, 1.3, 1.3);
  }
  for (const [mx, n] of [[-52, 5], [44, 6], [0, 5]]) {
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.35) continue;
      g.fillStyle = `rgba(255,214,140,${0.4 + rnd() * 0.45})`;
      g.fillRect(mx - n * 2 + i * 4, -1 + (rnd() < 0.5 ? -2.5 : 1.5), 1.2, 1.2);
    }
  }
  g.restore();

  // where the red beacons blink (art-board positions, for live())
  beacons.push({ ...toArt(-161, 0), ph: 0 }, { ...toArt(161, 0), ph: 0.5 }, { ...toArt(0, -70), ph: 0.25 });
}

// The planet: night side on the left with city lights, day breaking on the right.
function planet(g, rnd, layer) {
  // glow of the air outside the limb, brightest near the hidden sun
  const halo = layer((h) => {
    const rg = h.createRadialGradient(PX, PY, PR - 2, PX, PY, PR + 46);
    rg.addColorStop(0, 'rgba(150,230,255,.9)');
    rg.addColorStop(0.09, 'rgba(84,172,255,.5)');
    rg.addColorStop(0.4, 'rgba(50,110,235,.15)');
    rg.addColorStop(1, 'rgba(40,80,200,0)');
    h.fillStyle = rg;
    h.fillRect(0, 280, W, 220);
    // sunrise colours where the sun is about to come up
    h.globalCompositeOperation = 'source-atop';
    glowDot(h, SUN_X, limbY(SUN_X) + 4, 170, '#ffb070', 0.8);
    h.globalCompositeOperation = 'destination-in';
    const m = h.createLinearGradient(0, 0, W, 0);
    m.addColorStop(0, 'rgba(0,0,0,.2)');
    m.addColorStop(0.45, 'rgba(0,0,0,.55)');
    m.addColorStop(0.78, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,.8)');
    h.fillStyle = m;
    h.fillRect(0, 0, W, H);
  }, 0.5);
  g.drawImage(halo, 0, 0, W, H);
  // the first sliver of sun (the planet hides its lower half)
  {
    const sy = limbY(SUN_X) + 1.5;
    glowDot(g, SUN_X, sy, 62, '#ffc98e', 0.4);
    glowDot(g, SUN_X, sy, 22, '#fff0d8', 0.85);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(SUN_X, sy, 3.2, 0, TAU);
    g.fill();
  }

  g.save();
  g.beginPath();
  g.arc(PX, PY, PR, 0, TAU);
  g.clip();
  const day = g.createLinearGradient(0, 0, W, 0);
  day.addColorStop(0, '#050a1a');
  day.addColorStop(0.4, '#081c34');
  day.addColorStop(0.75, '#0f3d5e');
  day.addColorStop(1, '#17587a');
  g.fillStyle = day;
  g.fillRect(0, 320, W, 180);
  // Land and cloud, worked out pixel by pixel on a small canvas. Distances are
  // measured as they would be on a globe, so everything flattens towards the limb.
  const seed = (rnd() * 1e5) | 0;
  const landAt = (u, v) => fbm(u / 250 + 40, v / 170, seed, 4);
  const tex = layer((t) => {
    const cw = t.canvas.width;
    const ch = t.canvas.height;
    const sc = cw / W;
    const img = t.createImageData(cw, ch);
    const px = img.data;
    for (let y = Math.floor(330 * sc); y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const ax = (x + 0.5) / sc;
        const dx = ax - PX;
        const dy = (y + 0.5) / sc - PY;
        const d = PR - Math.hypot(dx, dy);
        if (d < 0) continue;
        const u = Math.atan2(dx, -dy) * PR; // along the limb
        const v = Math.sqrt(d * (2 * PR - d)); // into the globe
        const lit = clamp((ax + 40) / 560, 0.16, 1);
        const edge = smooth(1, 16, d); // detail fades into the haze at the limb
        const land = smooth(0.54, 0.61, landAt(u, v)) * 0.5 * (0.35 + 0.65 * lit) * edge;
        const swirl = fbm(u / 120, v / 90, seed + 3, 3);
        const cloud = smooth(0.46, 0.78, fbm(u / 170 + swirl * 1.6, v / 54 + swirl * 0.8, seed + 7)) * 0.6 * lit * edge;
        // cloud (pale blue-white) over land (dull green)
        const al = land * (1 - cloud);
        const a = al + cloud;
        if (a < 0.004) continue;
        const o = (y * cw + x) * 4;
        px[o] = (52 * al + 196 * cloud) / a;
        px[o + 1] = (100 * al + 226 * cloud) / a;
        px[o + 2] = (96 * al + 255 * cloud) / a;
        px[o + 3] = a * 255;
      }
    }
    t.putImageData(img, 0, 0);
  }, 0.5);
  g.drawImage(tex, 0, 0, W, H);
  // city lights on the night side, where there is land
  for (let c = 0; c < 40; c++) {
    const cx = 6 + rnd() * 380;
    const cy = limbY(cx) + 10 + rnd() * 90;
    const dx = cx - PX;
    const dy = cy - PY;
    const d = PR - Math.hypot(dx, dy);
    if (landAt(Math.atan2(dx, -dy) * PR, Math.sqrt(d * (2 * PR - d))) < 0.57) continue;
    const dim = clamp(1 - (cx - 220) / 200, 0.2, 1);
    const size = 4 + rnd() * 10; // hamlet or metropolis
    for (let k = 0; k < size * 1.6; k++) {
      g.fillStyle = `rgba(255,${196 + Math.round(rnd() * 40)},130,${(0.25 + rnd() * 0.5) * dim})`;
      g.fillRect(cx + (rnd() + rnd() - 1) * size, cy + (rnd() + rnd() - 1) * size * 0.22, 0.75, 0.6);
    }
  }
  // air: a blue band hugging the inside of the limb
  const air = g.createRadialGradient(PX, PY, PR - 34, PX, PY, PR);
  air.addColorStop(0, 'rgba(80,170,255,0)');
  air.addColorStop(0.75, 'rgba(80,170,255,.16)');
  air.addColorStop(1, 'rgba(120,205,255,.5)');
  g.fillStyle = air;
  g.fillRect(0, 320, W, 180);
  // night falls towards the left
  const night = g.createLinearGradient(0, 0, W, 0);
  night.addColorStop(0, 'rgba(4,6,18,.6)');
  night.addColorStop(0.5, 'rgba(4,6,18,.22)');
  night.addColorStop(0.8, 'rgba(4,6,18,0)');
  g.fillStyle = night;
  g.fillRect(0, 320, W, 180);
  g.restore();

  // the bright hairline of the limb itself
  const line = g.createLinearGradient(0, 0, W, 0);
  line.addColorStop(0, 'rgba(150,215,255,.25)');
  line.addColorStop(0.5, 'rgba(180,232,255,.6)');
  line.addColorStop(0.76, 'rgba(255,244,226,1)');
  line.addColorStop(1, 'rgba(200,238,255,.7)');
  g.strokeStyle = line;
  g.lineWidth = 1.1;
  g.beginPath();
  g.arc(PX, PY, PR - 0.4, -Math.PI / 2 - 0.36, -Math.PI / 2 + 0.6);
  g.stroke();
}

// ---------------------------------------------------------------------------
// Platforms (painted once)
// ---------------------------------------------------------------------------

// The stretches of a block's top that are open to the sky (another block may stand on it).
function topSpans(p, arena) {
  let spans = [[p.x, p.x + p.w]];
  for (const q of arena.platforms) {
    if (!q.ground || q === p || Math.abs(q.y + q.h - p.y) > 1) continue;
    const next = [];
    for (const [a, b] of spans) {
      if (q.x >= b || q.x + q.w <= a) next.push([a, b]);
      else {
        if (q.x > a) next.push([a, q.x]);
        if (q.x + q.w < b) next.push([q.x + q.w, b]);
      }
    }
    spans = next;
  }
  return spans;
}

// yellow and black warning paint
function hazard(g, x, y, w, h) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#f2b431';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#1a2038';
  for (let sx = x - h; sx < x + w; sx += 8) {
    g.beginPath();
    g.moveTo(sx, y + h);
    g.lineTo(sx + 4, y + h);
    g.lineTo(sx + 4 + h, y);
    g.lineTo(sx + h, y);
    g.fill();
  }
  g.restore();
  g.strokeStyle = rgba(OUT, 0.7);
  g.lineWidth = 0.8;
  g.strokeRect(x, y, w, h);
}

function porthole(g, x, y, r, lit) {
  if (lit) glowDot(g, x, y, r * 3, '#ffc878', 0.42);
  g.fillStyle = '#c6d0e2';
  g.strokeStyle = rgba(OUT, 0.75);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(x, y, r + 2.4, 0, TAU);
  g.fill();
  g.stroke();
  const glass = g.createRadialGradient(x - r * 0.3, y - r * 0.35, 0.5, x, y, r);
  if (lit) {
    glass.addColorStop(0, '#fff6d6');
    glass.addColorStop(0.55, '#ffc963');
    glass.addColorStop(1, '#c47a2a');
  } else {
    glass.addColorStop(0, '#2b3a66');
    glass.addColorStop(1, '#0a1026');
  }
  g.fillStyle = glass;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.6)';
  g.lineWidth = 1.1;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, r - 2, -2.6, -1.7);
  g.stroke();
}

const STENCILS = ['A1', 'B4', 'C7', 'EVA', 'O2', 'H2O', '07', '12', 'DOCK', 'M3'];

// A hull module: panelled metal with a bright deck on top. Works at any height:
// the plating simply carries on down, getting darker.
function drawHull(g, p, i, rnd, arena) {
  const { x, y, w, h } = p;
  const src = arena.platforms[i] || p;
  const spans = topSpans(src, arena);

  const body = g.createLinearGradient(0, y, 0, y + 280);
  body.addColorStop(0, '#93a0ba');
  body.addColorStop(0.25, '#707d9b');
  body.addColorStop(1, '#283150');
  g.fillStyle = body;
  g.fillRect(x, y, w, h);

  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  // plating, laid like bricks so the seams never line up
  const rowH = 44;
  let windows = 0;
  for (let py = y + 16, row = 0; py < y + h; py += rowH, row++) {
    let px = x - rnd() * 50;
    let lastWindow = false; // never two windows side by side
    while (px < x + w) {
      const pw = 58 + rnd() * 64;
      const tone = rnd();
      g.fillStyle = tone < 0.5 ? `rgba(255,255,255,${(0.5 - tone) * 0.13})` : `rgba(6,10,30,${(tone - 0.5) * 0.24})`;
      g.fillRect(px, py, pw, rowH);
      g.fillStyle = 'rgba(6,9,26,.4)';
      g.fillRect(px + pw - 1.2, py, 1.3, rowH);
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.fillRect(px + pw + 0.1, py, 0.9, rowH);
      // rivets in the corners
      g.fillStyle = 'rgba(6,9,26,.5)';
      for (const [rx, ry] of [[4.5, 5], [pw - 6, 5], [4.5, rowH - 5], [pw - 6, rowH - 5]]) g.fillRect(px + rx - 0.8, py + ry - 0.8, 1.6, 1.6);
      g.fillStyle = 'rgba(255,255,255,.3)';
      for (const [rx, ry] of [[4.5, 5], [pw - 6, 5], [4.5, rowH - 5], [pw - 6, rowH - 5]]) g.fillRect(px + rx - 0.8, py + ry - 1.3, 1.2, 0.7);

      // something on the panel: a window, a vent, a hatch, a stencilled number
      const cx = px + pw / 2;
      const cy = py + rowH / 2;
      // (fewer of them deep down, where a tall block is only there to fill the screen)
      const fits = cx > x + 16 && cx < x + w - 16 && py + rowH <= y + h + 8 && (row < 2 || rnd() < 0.4);
      const roll = rnd();
      const pick = rnd();
      const wasWindow = lastWindow;
      lastWindow = false;
      if (fits && !wasWindow && (roll < 0.17 || (row === 0 && windows === 0 && px + pw * 2 > x + w))) {
        porthole(g, cx, cy + 1, 7.5, true);
        windows++;
        lastWindow = true;
      } else if (fits && !wasWindow && roll < 0.24) {
        porthole(g, cx, cy + 1, 7.5, false);
        lastWindow = true;
      } else if (fits && roll < 0.38) {
        for (let k = 0; k < 4; k++) {
          rr(g, cx - 12, cy - 9 + k * 5.2, 24, 2.8, 1.4);
          g.fillStyle = 'rgba(6,9,26,.55)';
          g.fill();
          g.fillStyle = 'rgba(255,255,255,.16)';
          g.fillRect(cx - 11, cy - 9 + k * 5.2 + 3, 22, 0.8);
        }
      } else if (fits && roll < 0.46) {
        rr(g, cx - 15, cy - 13, 30, 27, 5);
        g.strokeStyle = 'rgba(6,9,26,.5)';
        g.lineWidth = 1.4;
        g.stroke();
        rr(g, cx - 13.6, cy - 11.6, 30, 27, 5);
        g.strokeStyle = 'rgba(255,255,255,.12)';
        g.lineWidth = 0.9;
        g.stroke();
        g.fillStyle = 'rgba(6,9,26,.55)';
        g.fillRect(cx - 6, cy - 0.5, 12, 2.2);
      } else if (fits && roll < 0.58) {
        g.font = '800 9px Orbitron, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = 'rgba(10,16,44,.42)';
        g.fillText(STENCILS[(pick * STENCILS.length) | 0], cx, cy + 1);
      }
      px += pw;
    }
    g.fillStyle = 'rgba(6,9,26,.4)';
    g.fillRect(x, py - 0.7, w, 1.3);
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.fillRect(x, py + 0.6, w, 0.9);
  }
  // shadow under the deck, and under any block standing on this one
  const sh = g.createLinearGradient(0, y + 5, 0, y + 18);
  sh.addColorStop(0, 'rgba(6,9,26,.5)');
  sh.addColorStop(1, 'rgba(6,9,26,0)');
  g.fillStyle = sh;
  g.fillRect(x, y + 5, w, 13);
  const covered = g.createLinearGradient(0, y, 0, y + 24);
  covered.addColorStop(0, 'rgba(6,9,26,.45)');
  covered.addColorStop(1, 'rgba(6,9,26,0)');
  g.fillStyle = covered;
  let at = x;
  for (const [a, b] of [...spans, [x + w, x + w]]) {
    if (a > at) g.fillRect(at, y, a - at, 24);
    at = b;
  }
  // light catches the left edge, the right one falls into shadow
  g.fillStyle = 'rgba(225,236,255,.4)';
  g.fillRect(x, y, 1.8, h);
  g.fillStyle = 'rgba(4,6,20,.5)';
  g.fillRect(x + w - 2.2, y, 2.2, h);
  g.restore();

  g.strokeStyle = rgba(OUT, 0.85);
  g.lineWidth = 1.2;
  g.strokeRect(x, y, w, h);

  // the deck: a white plate with station lighting under its lip
  for (const [a, b] of spans) {
    // warning paint at drop-offs and under jump pads
    const marks = [];
    if (a > 1 && b - a > 90) marks.push([a + 3, 30]);
    if (b < arena.w - 1 && b - a > 90) marks.push([b - 33, 30]);
    for (const tr of arena.tramps) {
      if (Math.abs(tr.y + tr.h - src.y) < 2 && tr.x > a - 1 && tr.x + tr.w < b + 1) marks.push([tr.x - 8, tr.w + 16]);
    }
    for (const [mx, mw] of marks) hazard(g, mx, y + 7.6, mw, 5.6);
    g.save();
    g.shadowColor = CYAN;
    g.shadowBlur = 9;
    g.fillStyle = CYAN;
    g.fillRect(a + 2, y + 4.6, b - a - 4, 2.1);
    g.restore();
    g.fillStyle = '#d5deed';
    g.fillRect(a, y, b - a, 5);
    g.fillStyle = '#ffffff';
    g.fillRect(a, y, b - a, 1.7);
    g.fillStyle = 'rgba(6,9,26,.22)';
    for (let tx = a + 40 - (a % 40); tx < b - 2; tx += 40) g.fillRect(tx - 0.5, y + 1.7, 1, 3.3);
    g.strokeStyle = rgba(OUT, 0.8);
    g.lineWidth = 1;
    g.strokeRect(a, y, b - a, 5);
  }
}

// A catwalk: bright deck plate on a light truss. Also used, tilted, for slopes.
function drawCatwalk(g, p) {
  const { x, y, w } = p;
  // dark backing so the stars do not sparkle through the lattice
  g.fillStyle = 'rgba(8,12,30,.6)';
  g.fillRect(x + 4, y + 4, w - 8, 9);
  // lattice
  const n = Math.max(2, Math.round((w - 12) / 11) | 1) + 1;
  const step = (w - 12) / n;
  g.strokeStyle = '#8492b0';
  g.lineWidth = 1.5;
  g.lineJoin = 'round';
  g.beginPath();
  for (let k = 0; k <= n; k++) {
    const px = x + 6 + k * step;
    const py = k % 2 ? y + 12 : y + 6.2;
    if (k) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.stroke();
  // bottom chord
  g.fillStyle = '#65728f';
  g.fillRect(x + 4, y + 11.2, w - 8, 2.3);
  g.fillStyle = rgba(OUT, 0.7);
  g.fillRect(x + 4, y + 13.3, w - 8, 0.8);
  // station lighting under the lip of the deck
  g.save();
  g.shadowColor = CYAN;
  g.shadowBlur = 9;
  g.fillStyle = CYAN;
  g.fillRect(x + 4, y + 4.3, w - 8, 2);
  g.restore();
  // end caps (hinges on a slope)
  g.fillStyle = '#b3bfd4';
  g.strokeStyle = rgba(OUT, 0.85);
  g.lineWidth = 1;
  if (p.ramp) {
    for (const hx of [x + 16, x + w - 16]) {
      g.beginPath();
      g.arc(hx, y + 8, 5, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = '#4c5876';
      g.fillRect(hx - 1.3, y + 6.7, 2.6, 2.6);
      g.fillStyle = '#b3bfd4';
    }
  } else {
    for (const ex of [x, x + w - 6.5]) {
      rr(g, ex, y + 2, 6.5, 12, 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = CYAN;
    g.fillRect(x + 2, y + 8.5, 2.5, 2.5);
    g.fillRect(x + w - 4.5, y + 8.5, 2.5, 2.5);
  }
  // the deck plate itself
  rr(g, x, y, w, 4.8, 1.6);
  g.fillStyle = '#dbe3f1';
  g.fill();
  g.strokeStyle = rgba(OUT, 0.8);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(x + 1, y + 0.3, w - 2, 1.5);
}

// ---------------------------------------------------------------------------
// Astronaut parts (baked into sprites, one set per colour)
// ---------------------------------------------------------------------------

// Backpack and torso. Origin = the middle of the feet, facing right.
function paintBody(g, color) {
  g.lineJoin = 'round';
  // backpack
  const pack = g.createLinearGradient(0, -21, 0, -6);
  pack.addColorStop(0, '#ffffff');
  pack.addColorStop(1, '#aab5cc');
  rr(g, -16, -20.5, 9.5, 14.5, 3);
  g.fillStyle = pack;
  g.fill();
  g.strokeStyle = OUT;
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = 'rgba(6,9,24,.5)';
  g.fillRect(-14.2, -17.4, 4.6, 1.4);
  g.fillStyle = CYAN;
  g.fillRect(-14.2, -14.4, 2, 2);
  g.fillStyle = '#4b5674'; // thruster nozzle
  g.fillRect(-14.6, -6.6, 5.4, 2.2);
  // torso
  const suit = g.createLinearGradient(0, -18, 0, -4);
  suit.addColorStop(0, lighten(color, 0.22));
  suit.addColorStop(0.45, color);
  suit.addColorStop(1, darken(color, 0.24));
  rr(g, -9.5, -18, 19, 14, 6);
  g.fillStyle = suit;
  g.fill();
  g.strokeStyle = OUT;
  g.lineWidth = 1.6;
  g.stroke();
  // belt and chest panel
  g.fillStyle = darken(color, 0.42);
  g.fillRect(-8.6, -8.4, 17.2, 1.6);
  rr(g, 3.4, -14.4, 4.6, 3.6, 1);
  g.fillStyle = darken(color, 0.5);
  g.fill();
  g.fillStyle = CYAN;
  g.fillRect(4.3, -13.5, 1.3, 1.6);
  g.fillStyle = AMBER;
  g.fillRect(6, -13.5, 1.3, 1.6);
}

// The helmet. Origin = its centre, facing right.
function paintHelmet(g, color) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // antenna with a lamp on the tip
  g.beginPath();
  g.moveTo(-7, -10);
  g.lineTo(-10.2, -14.2);
  g.strokeStyle = OUT;
  g.lineWidth = 3.4;
  g.stroke();
  g.strokeStyle = '#c9d2e4';
  g.lineWidth = 1.5;
  g.stroke();
  g.beginPath();
  g.arc(-10.6, -14.7, 2, 0, TAU);
  g.fillStyle = '#ffffff';
  g.fill();
  g.strokeStyle = OUT;
  g.lineWidth = 1.2;
  g.stroke();
  // shell
  const shell = g.createRadialGradient(-4.5, -6.5, 1.5, 0, 0, 15);
  shell.addColorStop(0, lighten(color, 0.42));
  shell.addColorStop(0.5, color);
  shell.addColorStop(1, darken(color, 0.3));
  g.beginPath();
  g.ellipse(0, 0, 13.5, 13, 0, 0, TAU);
  g.fillStyle = shell;
  g.fill();
  g.strokeStyle = OUT;
  g.lineWidth = 1.7;
  g.stroke();
  // radio bump over the ear
  g.beginPath();
  g.arc(-9.6, 3.4, 3, 0, TAU);
  g.fillStyle = '#e4eaf5';
  g.fill();
  g.strokeStyle = OUT;
  g.lineWidth = 1.2;
  g.stroke();
  // visor: dark glass in a white rim
  const glass = g.createLinearGradient(0, -6.5, 0, 9);
  glass.addColorStop(0, '#34477a');
  glass.addColorStop(0.5, '#131b3a');
  glass.addColorStop(1, '#070a1b');
  g.beginPath();
  g.ellipse(3.6, 1.1, 9.3, 7.7, 0, 0, TAU);
  g.fillStyle = glass;
  g.fill();
  g.strokeStyle = '#f4f7fc';
  g.lineWidth = 1.5;
  g.stroke();
  // reflections
  g.strokeStyle = 'rgba(170,205,255,.4)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(3.6, 1.1, 7.2, 5.6, 0, -2.75, -1.5);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.beginPath();
  g.ellipse(9.6, -2.8, 1.1, 2.1, 0.55, 0, TAU);
  g.fill();
  // shine on the shell
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.beginPath();
  g.ellipse(-5.6, -8.4, 3.2, 1.5, -0.6, 0, TAU);
  g.fill();
}

function boot(g, x, y) {
  g.moveTo(x - 3.2, y - 3.8);
  g.lineTo(x + 2.6, y - 3.8);
  g.lineTo(x + 4.8, y - 1.5);
  g.lineTo(x + 4.8, y);
  g.lineTo(x - 3.2, y);
  g.closePath();
}

// Is there a deck just under these feet? (a jump from the ground, not in mid-air)
function overDeck(arena, x, feet) {
  for (const p of arena.platforms) if (x > p.x - 8 && x < p.x + p.w + 8 && p.y - feet > -4 && p.y - feet < 40) return true;
  for (const r of arena.ramps) {
    const dy = r.y0 + (r.y1 - r.y0) * clamp((x - r.x0) / (r.x1 - r.x0), 0, 1) - feet;
    if (x > r.x0 - 16 && x < r.x1 + 16 && dy > -4 && dy < 40) return true;
  }
  return false;
}

// particle that stamps a baked glow (p.img) instead of drawing a shape
function stamp(g, p) {
  const s = Math.max(1, p.size);
  g.drawImage(p.img, p.x - s, p.y - s, s * 2, s * 2);
}

export default {
  id: 'space',
  colors: COLORS,
  letterbox: '#03040c',
  lift: LIFT,
  label: {
    font: '600 13px Rajdhani, sans-serif',
    size: 12,
    color: '#e6f0ff',
    stroke: 'rgba(4,6,20,.9)',
    strokeWidth: 3.5,
    you: '#8fe9ff',
    youFont: '800 11px Orbitron, sans-serif',
    stun: AMBER,
    gap: 9,
  },
  hud: {
    font: 'Orbitron, sans-serif',
    weight: 800,
    scale: 0.9,
    labelFont: 'Rajdhani, sans-serif',
    labelWeight: 600,
    labelScale: 1.08,
    text: '#e6f0ff',
    dim: 'rgba(170,195,235,.65)',
    warn: ALERT,
    outline: 'rgba(4,6,20,.85)',
    outlineWidth: 4,
    chip: 'rgba(10,15,36,.78)',
    chipLine: 'rgba(99,220,255,.4)',
    chipIt: 'rgba(255,74,61,.32)',
    chipItText: '#ffffff',
    big: '#ffffff',
    bigStroke: 'rgba(40,110,220,.65)',
    radius: 4,
    swatchRadius: 4,
    swatchLine: 'rgba(255,255,255,.85)',
  },

  build(env) {
    const { layer, sprite, arena } = env;
    // Separate random streams: how many twinkling stars fit depends on the shape
    // of the screen, and that must not change the rest of the scenery.
    const seed = (env.rnd() * 4294967296) >>> 0;
    const rnd = mulberry32(seed); // the painted backdrop
    const rndLive = mulberry32(seed + 1); // things that move
    const rndMast = mulberry32(seed + 2);

    // Screen pixels per world unit, read off a throw-away sprite. Sprites are
    // stamped at whole pixels and at their own size, so they stay sharp.
    let k = 0;
    const probe = sprite(500, 1, (g) => {
      if (g.getTransform) k = g.getTransform().a;
    });
    if (!k) k = probe.width / 500; // old browsers: near enough
    const snap = (v) => Math.round(v * k) / k;
    const mk = (x0, y0, w, h, draw) => {
      const c = sprite(w, h, (g) => {
        g.translate(-x0, -y0);
        draw(g);
      });
      return { c, x: snap(x0), y: snap(y0), w: c.width / k, h: c.height / k };
    };

    // Art board <-> world. Both are centred on the screen, so this only needs the two scales.
    const u = env.scale / k; // world units per art unit
    const toWorldX = (ax) => arena.w / 2 + (ax - W / 2) * u;
    const toWorldY = (ay) => arena.h / 2 + (ay - H / 2) * u;
    const toArtX = (wx) => W / 2 + (wx - arena.w / 2) / u;
    const toArtY = (wy) => H / 2 + (wy - arena.h / 2) / u;
    // Is this spot of the backdrop hidden behind a platform or slope? (live() draws
    // over the platforms, so nothing there may twinkle.)
    const covered = (ax, ay, pad = 12) => {
      const wx = toWorldX(ax);
      const wy = toWorldY(ay);
      for (const p of arena.platforms) {
        const bottom = p.ground && p.y + p.h >= arena.h - 1 ? Infinity : p.y + p.h;
        if (wx > p.x - pad && wx < p.x + p.w + pad && wy > p.y - pad - (p.ground ? 34 : 0) && wy < bottom + pad) return true;
      }
      for (const r of arena.ramps) {
        if (wx < r.x0 - 20 - pad || wx > r.x1 + 20 + pad) continue;
        const ry = r.y0 + ((r.y1 - r.y0) * (wx - r.x0)) / (r.x1 - r.x0);
        if (wy > ry - pad - 4 && wy < ry + 20 + pad) return true;
      }
      return false;
    };
    // ... or behind the planet, the moon or the far station?
    const cosr = Math.cos(-ST.rot);
    const sinr = Math.sin(-ST.rot);
    const scenery = (ax, ay) => {
      if (ay > limbY(clamp(ax, 0, W)) - 14) return true;
      if (Math.hypot(ax - MOON.x, ay - MOON.y) < MOON.r * 2.3) return true;
      const dx = ax - ST.x;
      const dy = ay - ST.y;
      return Math.abs(dx * cosr - dy * sinr) < 168 * ST.s && Math.abs(dx * sinr + dy * cosr) < 76 * ST.s;
    };

    // stars that twinkle: picked where nothing hides them, and painted into the sky as well
    const twinkles = [];
    for (let tries = 0; tries < 400 && twinkles.length < 16; tries++) {
      const x = 20 + rndLive() * (W - 40);
      const y = 30 + rndLive() * (H - 120);
      if (covered(x, y) || scenery(x, y)) continue;
      if (twinkles.some((s) => Math.hypot(s.x - x, s.y - y) < 60)) continue;
      twinkles.push({ x, y, r: 3.2 + rndLive() * 2.6, f: 1.1 + rndLive() * 2.2, ph: rndLive() * TAU, col: starTint(rndLive()) });
    }
    // shooting stars: short paths across open sky
    const meteors = [];
    for (let tries = 0; tries < 200 && meteors.length < 5; tries++) {
      const x = 80 + rndLive() * (W - 160);
      const y = 30 + rndLive() * 240;
      const dir = rndLive() < 0.5 ? -1 : 1;
      const dx = dir * (70 + rndLive() * 40);
      const dy = 24 + rndLive() * 26;
      let clear = true;
      for (let s = -0.3; s <= 1.01 && clear; s += 0.1) clear = !covered(x + dx * s, y + dy * s, 20) && !scenery(x + dx * s, y + dy * s);
      if (clear) meteors.push({ x, y, dx, dy });
    }
    // a satellite crossing high above the arena; note where platforms would hide it
    const satY = (ax) => toArtY(46) + (ax / W) * 14;
    const satMask = [];
    for (let ax = 0; ax <= W; ax += 8) satMask.push(!covered(ax, satY(ax), 16));

    const beacons = [];
    const bg = layer((g) => {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#03040c');
      sky.addColorStop(0.55, SPACE);
      sky.addColorStop(1, '#0a1230');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      nebula(g, rnd, layer);
      starfield(g, rnd);
      for (const s of twinkles) {
        glowDot(g, s.x, s.y, s.r * 0.9, s.col, 0.5);
        g.fillStyle = '#ffffff';
        g.fillRect(s.x - 0.45, s.y - 0.45, 0.9, 0.9);
      }
      ringedMoon(g, rnd);
      farStation(g, rnd, beacons);
      planet(g, rnd, layer);
    });

    const shade = layer((g) => {
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, H * 1.02);
      v.addColorStop(0, 'rgba(2,3,10,0)');
      v.addColorStop(1, 'rgba(2,3,10,.55)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }, 0.5);

    // antenna masts on open stretches of hull, away from anything you play with
    const masts = [];
    const busy = (x, y) => {
      for (const tr of arena.tramps) if (Math.abs(tr.cx - x) < tr.w / 2 + 40 && Math.abs(tr.y + tr.h - y) < 70) return true;
      for (const po of arena.portals) if (Math.abs(po.cx - x) < 60 && Math.abs(po.y + po.h - y) < 70) return true;
      for (const s of [...arena.spawns, ...arena.respawns]) if (Math.abs(s[0] + 16 - x) < 46 && Math.abs(s[1] + 40 - y) < 70) return true;
      for (const pk of arena.pickups) if (Math.abs(pk.x - x) < 40 && pk.y < y && pk.y > y - 110) return true;
      for (const z of arena.lifts) if (x > z.x - 24 && x < z.x + z.w + 24 && z.y < y && z.y + z.h > y - 120) return true;
      for (const r of arena.ramps) {
        if (x < r.x0 - 40 || x > r.x1 + 40) continue;
        const ry = r.y0 + (r.y1 - r.y0) * clamp((x - r.x0) / (r.x1 - r.x0), 0, 1);
        if (ry > y - 110 && ry < y + 2) return true;
      }
      for (const p of arena.platforms) if (x > p.x - 14 && x < p.x + p.w + 14 && p.y < y - 1 && p.y + p.h > y - 80) return true;
      return false;
    };
    for (const p of arena.platforms) {
      if (!p.ground) continue;
      for (const [a, b] of topSpans(p, arena)) {
        for (let x = a + 70 + rndMast() * 160; x < b - 70; x += 380 + rndMast() * 260) {
          if (!busy(x, p.y)) masts.push({ x: Math.round(x), y: p.y, h: 26 + rndMast() * 10, ax: 0, ay: 0, ph: rndMast() });
        }
      }
    }
    for (const m of masts) {
      m.ax = toArtX(m.x);
      m.ay = toArtY(m.y - m.h - 1);
    }

    // baked glows
    const radial = (size, stops) =>
      sprite(size, size, (g) => {
        const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        for (const [at, col] of stops) rg.addColorStop(at, col);
        g.fillStyle = rg;
        g.fillRect(0, 0, size, size);
      });
    const itGlow = radial(80, [[0, 'rgba(255,74,61,.66)'], [0.45, 'rgba(255,60,50,.36)'], [1, 'rgba(255,50,40,0)']]);
    const flare = radial(26, [[0, 'rgba(255,240,230,1)'], [0.22, 'rgba(255,96,74,.9)'], [1, 'rgba(255,60,40,0)']]);
    const puff = radial(24, [[0, 'rgba(255,255,255,.95)'], [0.4, 'rgba(214,240,255,.5)'], [1, 'rgba(200,230,255,0)']]);
    const dust = radial(24, [[0, 'rgba(190,202,226,.8)'], [0.5, 'rgba(160,176,206,.35)'], [1, 'rgba(150,166,200,0)']]);
    const padGlow = sprite(70, 36, (g) => {
      g.translate(35, 36);
      g.scale(1, 1.05);
      const rg = g.createRadialGradient(0, 0, 2, 0, 0, 34);
      rg.addColorStop(0, 'rgba(255,190,70,.5)');
      rg.addColorStop(1, 'rgba(255,170,40,0)');
      g.fillStyle = rg;
      g.fillRect(-35, -36, 70, 36);
    });
    // a four-pointed sparkle for twinkling stars and strobes
    const spark = sprite(24, 24, (g) => {
      g.translate(12, 12);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 7);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.3, 'rgba(220,235,255,.5)');
      rg.addColorStop(1, 'rgba(200,225,255,0)');
      g.fillStyle = rg;
      g.fillRect(-7, -7, 14, 14);
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * TAU) / 4;
        g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
        g.lineTo(Math.cos(a + TAU / 8) * 1.3, Math.sin(a + TAU / 8) * 1.3);
      }
      g.fill();
    });

    // one suit per colour
    const suits = COLORS.map((color) => ({
      body: mk(-18, -22, 30, 20, (g) => paintBody(g, color)),
      helm: mk(-15, -47.5, 32, 36, (g) => {
        g.translate(1, -26.5);
        paintHelmet(g, color);
      }),
      limb: darken(color, 0.14),
    }));

    return { bg, shade, k, snap, suits, itGlow, flare, puff, dust, padGlow, spark, twinkles, meteors, satY, satMask, beacons, masts, u, trail: [0, 0, 0, 0] };
  },

  back(g, sc) {
    g.drawImage(sc.bg, 0, 0, W, H);
  },

  platform(g, p, i, rnd, arena) {
    if (p.ground) drawHull(g, p, i, rnd, arena);
    else drawCatwalk(g, p);
  },

  // A slope is a gangway: the catwalk, tilted and hinged at both ends. It is
  // trimmed level with what it joins so nothing pokes through a deck.
  ramp(g, r, i, rnd, arena) {
    const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
    const hiY = Math.min(r.y0, r.y1);
    const loY = Math.max(r.y0, r.y1);
    const loX = r.y0 > r.y1 ? r.x0 : r.x1;
    const hiX = r.y0 > r.y1 ? r.x1 : r.x0;
    const joins = (x, y, ground) => arena.platforms.some((p) => p.ground === ground && Math.abs(p.y - y) < 2 && x > p.x - 20 && x < p.x + p.w + 20);
    const top = joins(hiX, hiY, true) || joins(hiX, hiY, false) ? hiY - 0.6 : hiY - 40;
    const bottom = joins(loX, loY, true) ? loY + 0.6 : joins(loX, loY, false) ? loY + 16 : loY + 40;
    g.beginPath();
    g.rect(r.x0 - 40, top, r.x1 - r.x0 + 80, bottom - top);
    g.clip();
    g.translate(r.x0, r.y0);
    g.rotate(Math.atan2(r.y1 - r.y0, r.x1 - r.x0));
    drawCatwalk(g, { x: -16, y: 0, w: len + 32, ramp: true });
  },

  // extras over the platforms: ion emitters under the updrafts, antenna masts
  decor(g, sc, arena) {
    const col = LIFT;
    for (const z of arena.lifts) {
      const by = z.y + z.h;
      const up = g.createLinearGradient(0, by, 0, by - 150);
      up.addColorStop(0, rgba(col, 0.34));
      up.addColorStop(1, rgba(col, 0));
      g.fillStyle = up;
      g.fillRect(z.x + 3, by - 150, z.w - 6, 150);
      rr(g, z.x - 3, by - 5.5, z.w + 6, 6.5, 2.5);
      g.fillStyle = '#39445f';
      g.fill();
      g.strokeStyle = rgba(OUT, 0.9);
      g.lineWidth = 1;
      g.stroke();
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 10;
      g.fillStyle = '#e4fbff';
      for (let sx = z.x + 4; sx < z.x + z.w - 8; sx += 12) g.fillRect(sx, by - 4, 8, 2.2);
      g.restore();
    }
    for (const m of sc.masts) {
      const top = m.y - m.h;
      rr(g, m.x - 5.5, m.y - 4.5, 11, 4.5, 1.4);
      g.fillStyle = '#6d7a97';
      g.fill();
      g.strokeStyle = rgba(OUT, 0.85);
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = rgba(OUT, 0.8);
      g.fillRect(m.x - 1.7, top, 3.4, m.h - 4);
      g.fillRect(m.x - 7.5, top + 6.2, 15, 2.6);
      g.fillRect(m.x - 5, top + 11.7, 10, 2.4);
      g.fillStyle = '#c6d0e2';
      g.fillRect(m.x - 0.9, top, 1.8, m.h - 4);
      g.fillRect(m.x - 6.8, top + 6.9, 13.6, 1.2);
      g.fillRect(m.x - 4.3, top + 12.4, 8.6, 1);
      glowDot(g, m.x, top - 1, 7, '#bfeaff', 0.5);
      g.fillStyle = '#ffffff';
      g.fillRect(m.x - 1.2, top - 2.2, 2.4, 2.4);
    }
  },

  // static: the corners fall away into the dark
  front(g, sc) {
    g.drawImage(sc.shade, 0, 0, W, H);
  },

  // every frame: a few stars twinkle, lights blink, now and then something flies past
  live(g, sc, t) {
    const sp = sc.spark;
    for (let i = 0; i < sc.twinkles.length; i++) {
      const s = sc.twinkles[i];
      const a = 0.5 + 0.5 * Math.sin(t * s.f + s.ph);
      if (a < 0.12) continue;
      const r = s.r * (0.55 + 0.45 * a);
      g.globalAlpha = a;
      g.drawImage(sp, s.x - r, s.y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    // red beacons on the far station
    for (let i = 0; i < sc.beacons.length; i++) {
      const b = sc.beacons[i];
      if ((t * 0.55 + b.ph) % 1 > 0.16) continue;
      g.fillStyle = 'rgba(255,80,64,.3)';
      g.fillRect(b.x - 2.2, b.y - 2.2, 4.4, 4.4);
      g.fillStyle = '#ff9a86';
      g.fillRect(b.x - 0.8, b.y - 0.8, 1.6, 1.6);
    }
    // white strobes on the antenna masts: two quick flashes, then a pause
    for (let i = 0; i < sc.masts.length; i++) {
      const m = sc.masts[i];
      const ph = (t * 0.6 + m.ph) % 1;
      if (ph > 0.07 && (ph < 0.14 || ph > 0.21)) continue;
      g.drawImage(sp, m.ax - 5, m.ay - 5, 10, 10);
    }
    // a satellite gliding over
    {
      const x = ((t * 5 + 300) % (W + 80)) - 40;
      if (sc.satMask[clamp(Math.round(x / 8), 0, sc.satMask.length - 1)]) {
        const y = sc.satY(x);
        g.fillStyle = '#4f74d8';
        g.fillRect(x - 5.2, y - 0.9, 3.6, 1.8);
        g.fillRect(x + 1.6, y - 0.9, 3.6, 1.8);
        g.fillStyle = '#dfe7f5';
        g.fillRect(x - 1.5, y - 1.2, 3, 2.4);
        if ((t * 1.2) % 1 < 0.2) {
          g.fillStyle = '#ffffff';
          g.fillRect(x - 0.6, y - 2.4, 1.2, 1.2);
        }
      }
    }
    // a shooting star every few seconds
    if (sc.meteors.length) {
      const period = 6.5;
      const f = (t % period) / 0.55;
      if (f < 1) {
        const m = sc.meteors[Math.floor(t / period) % sc.meteors.length];
        const hx = m.x + m.dx * f;
        const hy = m.y + m.dy * f;
        const fade = Math.sin(f * Math.PI);
        g.lineCap = 'round';
        for (let n = 0; n < 3; n++) {
          g.strokeStyle = `rgba(215,235,255,${(0.75 - n * 0.24) * fade})`;
          g.lineWidth = 1.3 - n * 0.35;
          g.beginPath();
          g.moveTo(hx - m.dx * 0.09 * n, hy - m.dy * 0.09 * n);
          g.lineTo(hx - m.dx * 0.09 * (n + 1), hy - m.dy * 0.09 * (n + 1));
          g.stroke();
        }
      }
    }
  },

  // a jump pad: an amber plate on pistons, with chevrons hovering over it
  trampoline(g, tr, t, k, sc) {
    const { x, w } = tr;
    const y = tr.y + k * 5.5;
    const bottom = tr.y + tr.h;
    const mid = x + w / 2;
    g.drawImage(sc.padGlow, mid - 35, tr.y - 32, 70, 36);
    // pistons
    g.fillStyle = '#aab5cc';
    g.fillRect(x + 8, y + 4, 4.5, bottom - y - 8);
    g.fillRect(x + w - 12.5, y + 4, 4.5, bottom - y - 8);
    g.fillRect(mid - 2.2, y + 4, 4.5, bottom - y - 8);
    // base
    rr(g, x + 1, bottom - 6.5, w - 2, 6.5, 2);
    g.fillStyle = '#39445f';
    g.fill();
    g.strokeStyle = OUT;
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = AMBER;
    g.fillRect(x + 6, bottom - 4.2, 5, 1.8);
    g.fillRect(x + w - 11, bottom - 4.2, 5, 1.8);
    // plate
    rr(g, x - 2, y, w + 4, 5.6, 2.6);
    g.fillStyle = AMBER;
    g.fill();
    g.stroke();
    g.fillStyle = '#ffe6a6';
    g.fillRect(x + 1, y + 1, w - 2, 1.3);
    // chevrons: "this throws you up"
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 2.8;
    for (let n = 0; n < 2; n++) {
      const cy = tr.y - 8 - n * 8.5 - k * (10 + n * 8);
      g.strokeStyle = n ? 'rgba(255,196,84,.5)' : '#ffc454';
      g.beginPath();
      g.moveTo(mid - 9, cy + 3);
      g.lineTo(mid, cy - 2.5);
      g.lineTo(mid + 9, cy + 3);
      g.stroke();
    }
  },

  // an airlock ring holding a wormhole open
  portal(g, po, t, i) {
    const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
    const cx = po.cx;
    const cy = po.cy;
    const rx = 16.5;
    const ry = 31.5;
    g.save();
    g.translate(cx, cy);
    g.scale(0.66, 1);
    glowDot(g, 0, 0, 55, col, 0.6);
    g.restore();
    // the throat: dark in the middle, light spiralling in
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.clip();
    g.translate(cx, cy);
    g.scale(rx / ry, 1);
    const hole = g.createRadialGradient(0, 0, 2, 0, 0, ry);
    hole.addColorStop(0, '#01020a');
    hole.addColorStop(0.42, darken(col, 0.74));
    hole.addColorStop(0.8, darken(col, 0.2));
    hole.addColorStop(1, lighten(col, 0.4));
    g.fillStyle = hole;
    g.fillRect(-ry, -ry, ry * 2, ry * 2);
    g.lineCap = 'round';
    for (let arm = 0; arm < 3; arm++) {
      g.beginPath();
      for (let s = 0; s <= 1.001; s += 0.05) {
        const a = (arm * TAU) / 3 + s * 4.4 + i * 1.3 - t * 3;
        const r = 2.5 + s * (ry - 2);
        if (s) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.strokeStyle = rgba(lighten(col, 0.6), 0.8);
      g.lineWidth = 2.4;
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    for (let s = 0; s < 7; s++) {
      const a = s * 2.4 + i;
      const r = 5 + ((s * 7) % 19);
      g.fillRect(Math.cos(a) * r - 0.7, Math.sin(a) * r - 0.7, 1.6, 1.4);
    }
    g.restore();
    // glowing inner lip
    g.save();
    g.shadowColor = col;
    g.shadowBlur = 8;
    g.strokeStyle = lighten(col, 0.65);
    g.lineWidth = 2.2;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.stroke();
    g.restore();
    // foot of the frame
    rr(g, cx - 12, cy + 34.5, 24, 4, 1.5);
    g.fillStyle = '#8795b2';
    g.fill();
    g.strokeStyle = OUT;
    g.lineWidth = 1.1;
    g.stroke();
    // the frame: a ring of hull segments
    g.strokeStyle = OUT;
    g.lineWidth = 7.4;
    g.beginPath();
    g.ellipse(cx, cy, rx + 3.6, ry + 3.6, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = '#cdd6e6';
    g.lineWidth = 4.8;
    g.setLineDash([13.6, 1.9]);
    g.beginPath();
    g.ellipse(cx, cy, rx + 3.6, ry + 3.6, 0, 0.26, TAU + 0.26);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(cx, cy, rx + 5.2, ry + 5.2, 0, 3.5, 5.2);
    g.stroke();
    // pair-coloured lamps round the frame
    g.fillStyle = col;
    for (const [lx, ly] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      g.beginPath();
      g.arc(cx + lx * (rx + 3.6), cy + ly * (ry + 3.6), 1.9, 0, TAU);
      g.fill();
    }
  },

  // a supply capsule with the power showing through its glass
  pickup(g, kind, x, y) {
    const col = KIND_COLORS[kind];
    glowDot(g, x, y, 33, col, 0.6);
    g.translate(x, y);
    g.rotate(-0.16);
    g.lineJoin = 'round';
    // handle
    g.strokeStyle = OUT;
    g.lineWidth = 4.2;
    g.beginPath();
    g.arc(0, -17.5, 4, Math.PI, TAU);
    g.stroke();
    g.strokeStyle = '#cdd6e6';
    g.lineWidth = 1.8;
    g.stroke();
    // body
    rr(g, -12, -17, 24, 34, 9);
    g.save();
    g.clip();
    const glass = g.createLinearGradient(-12, 0, 12, 0);
    glass.addColorStop(0, mix(col, '#0a1026', 0.62));
    glass.addColorStop(0.5, mix(col, '#0a1026', 0.82));
    glass.addColorStop(1, mix(col, '#0a1026', 0.7));
    g.fillStyle = glass;
    g.fillRect(-12, -17, 24, 34);
    const cap = g.createLinearGradient(-12, 0, 12, 0);
    cap.addColorStop(0, '#f6f9ff');
    cap.addColorStop(0.6, '#c3cde0');
    cap.addColorStop(1, '#8e9bb6');
    g.fillStyle = cap;
    g.fillRect(-12, -17, 24, 7);
    g.fillRect(-12, 10, 24, 7);
    g.fillStyle = col;
    g.fillRect(-12, -10.6, 24, 1.6);
    g.fillRect(-12, 9, 24, 1.6);
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.fillRect(-9.5, -9, 3, 18);
    g.restore();
    rr(g, -12, -17, 24, 34, 9);
    g.strokeStyle = OUT;
    g.lineWidth = 1.8;
    g.stroke();
    g.save();
    g.shadowColor = col;
    g.shadowBlur = 6;
    drawIcon(g, kind, 0.5, 0, 7.6, lighten(col, 0.35));
    g.restore();
  },

  player(g, pv, t, sc) {
    const suit = sc.suits[pv.slot];
    const air = !pv.ground;
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const sw = moving ? Math.sin(pv.run) : 0;
    const bob = moving ? Math.abs(Math.cos(pv.run)) * 1.5 : 0;

    squashAt(g, pv.cx, pv.feet, pv.squash);
    g.translate(sc.snap(pv.cx), sc.snap(pv.feet));

    if (pv.isIt) {
      // red alert: a restless glow behind whoever is it
      const s = 74 + 6 * Math.sin(t * 9);
      g.drawImage(sc.itGlow, -s / 2, -21 - s / 2, s, s);
    }
    g.scale(pv.face, 1); // from here on the astronaut faces right
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // how the limbs hang: 0 = shooting up, 1 = drifting down
    const fall = air ? clamp(pv.vy / 520, -1, 1) * 0.5 + 0.5 : 0;
    const drift = air ? -clamp((pv.vx * pv.face) / 310, -1, 1) * 2.5 : 0; // legs trail behind

    // safety tether floating behind the backpack
    {
      const flow = clamp(Math.abs(pv.vx) / 260, 0.15, 1);
      const rise = clamp(pv.vy / 700, -1, 1) * -7;
      const w1 = Math.sin(t * 3.1 + pv.seed);
      const w2 = Math.sin(t * 3.1 + pv.seed + 1.9);
      const x0 = -14;
      const y0 = -10 - bob;
      const x1 = x0 - 5 - 9 * flow;
      const y1 = y0 + 3 + w2 * 2.5 + rise;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(x0 - 3 - 4 * flow, y0 + 5 + w1 * 2 + rise * 0.3, x1, y1);
      g.strokeStyle = '#d5deed';
      g.lineWidth = 1.8;
      g.stroke();
      g.fillStyle = AMBER;
      g.fillRect(x1 - 1.7, y1 - 1.7, 3.4, 3.4);
    }

    // far arm: only seen in the air, flung out behind
    const handY = -17 - fall * 4.5 + (air ? Math.sin(t * 13 + pv.seed) * fall * 1.3 : 0);
    if (air) {
      g.beginPath();
      g.moveTo(-6, -14);
      g.lineTo(-18.5, handY - 1);
      g.strokeStyle = OUT;
      g.lineWidth = 7.4;
      g.stroke();
      g.strokeStyle = suit.limb;
      g.lineWidth = 4.6;
      g.stroke();
      g.fillStyle = '#f4f7fc';
      g.beginPath();
      g.arc(-18.5, handY - 1, 2.7, 0, TAU);
      g.fill();
    }

    // legs
    let ax;
    let ay;
    let bx;
    let by;
    if (air) {
      ax = -5.5 - fall * 2.5 + drift;
      ay = 1.5 - fall * 5;
      bx = 3.5 + fall * 3.5 + drift;
      by = 1.5 - fall * 3.5;
    } else {
      ax = -4.5 + sw * 5.5;
      ay = -Math.max(0, sw) * 3.5;
      bx = 4.5 - sw * 5.5;
      by = -Math.max(0, -sw) * 3.5;
    }
    g.beginPath();
    g.moveTo(-4.5, -7 - bob);
    g.lineTo(ax, ay - 3);
    g.moveTo(4.5, -7 - bob);
    g.lineTo(bx, by - 3);
    g.strokeStyle = OUT;
    g.lineWidth = 8.6;
    g.stroke();
    g.strokeStyle = suit.limb;
    g.lineWidth = 5.6;
    g.stroke();
    g.beginPath();
    boot(g, ax, ay);
    boot(g, bx, by);
    g.fillStyle = '#f4f7fc';
    g.fill();
    g.strokeStyle = OUT;
    g.lineWidth = 1.4;
    g.stroke();

    // backpack and torso
    g.drawImage(suit.body.c, suit.body.x, suit.body.y - bob, suit.body.w, suit.body.h);

    // near arm: swings while running, flung out in the air
    {
      let sx = 0.5;
      let hx = 3;
      let hy = -7.4;
      if (air) {
        sx = 6;
        hx = 16.5;
        hy = handY;
      } else if (moving) {
        hx = 1.5 - sw * 6.5;
        hy = -8.5 - Math.abs(sw) * 1.6;
      }
      g.beginPath();
      g.moveTo(sx, -14 - bob);
      g.lineTo(hx, hy - bob);
      g.strokeStyle = OUT;
      g.lineWidth = 7.4;
      g.stroke();
      g.strokeStyle = suit.limb;
      g.lineWidth = 4.6;
      g.stroke();
      g.fillStyle = '#f4f7fc';
      g.beginPath();
      g.arc(hx, hy - bob, 2.7, 0, TAU);
      g.fill();
    }

    // helmet
    g.drawImage(suit.helm.c, suit.helm.x, suit.helm.y - bob, suit.helm.w, suit.helm.h);

    // eyes glowing on the visor
    const ex = 5.2;
    const ey = -25.6 - bob;
    if (pv.isIt) {
      g.fillStyle = '#ff5a48';
      g.beginPath();
      g.moveTo(ex - 4.6, ey - 3.2);
      g.lineTo(ex - 0.9, ey - 0.9);
      g.lineTo(ex - 0.9, ey + 2.4);
      g.lineTo(ex - 4.6, ey + 2.4);
      g.moveTo(ex + 4.6, ey - 3.2);
      g.lineTo(ex + 0.9, ey - 0.9);
      g.lineTo(ex + 0.9, ey + 2.4);
      g.lineTo(ex + 4.6, ey + 2.4);
      g.fill();
      // the lamp on the antenna flashes red
      const tx = -9.6;
      const ty = -41.2 - bob;
      if ((t * 3.2 + pv.seed) % 1 < 0.6) {
        g.drawImage(sc.flare, tx - 12, ty - 12, 24, 24);
      } else {
        g.fillStyle = '#8c1d18';
        g.fillRect(tx - 1.5, ty - 1.5, 3, 3);
      }
    } else {
      const open = pv.stunned ? 0.18 : 1 - pv.blink * 0.85;
      g.fillStyle = '#c8f6ff';
      g.beginPath();
      g.ellipse(ex - 2.9, ey, 1.55, 2.8 * open, 0, 0, TAU);
      g.ellipse(ex + 2.9, ey, 1.55, 2.8 * open, 0, 0, TAU);
      g.fill();
    }
  },

  // a red alert tag
  marker(g, cx, cy) {
    g.save();
    g.translate(cx, cy);
    glowDot(g, 0, -13, 34, ALERT, 0.55);
    g.lineJoin = 'round';
    // badge with a pointer underneath
    const badge = () => {
      g.beginPath();
      g.moveTo(-13, -27);
      g.lineTo(13, -27);
      g.quadraticCurveTo(18, -27, 18, -22);
      g.lineTo(18, -10);
      g.quadraticCurveTo(18, -5, 13, -5);
      g.lineTo(6, -5);
      g.lineTo(0, 2.5);
      g.lineTo(-6, -5);
      g.lineTo(-13, -5);
      g.quadraticCurveTo(-18, -5, -18, -10);
      g.lineTo(-18, -22);
      g.quadraticCurveTo(-18, -27, -13, -27);
      g.closePath();
    };
    badge();
    g.strokeStyle = OUT;
    g.lineWidth = 5.4;
    g.stroke();
    const red = g.createLinearGradient(0, -27, 0, -5);
    red.addColorStop(0, '#ff6a55');
    red.addColorStop(1, '#de2530');
    g.fillStyle = red;
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.stroke();
    g.font = '800 15px Orbitron, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(90,0,10,.55)';
    g.fillText('IT', 0.6, -14.4);
    g.fillStyle = '#ffffff';
    g.fillText('IT', 0, -15.2);
    g.restore();
  },

  fx: {
    // cold-gas thrusters: the puffs wash out along the deck, or shoot straight down in mid-air
    jump(R, pv) {
      const sc = R.scene;
      const deck = overDeck(R.arena, pv.cx, pv.feet);
      for (let i = 0; i < 5; i++) {
        const d = i % 2 ? 1 : -1;
        const vx = deck ? d * (50 + Math.random() * 120) : (Math.random() - 0.5) * 90;
        const vy = deck ? -8 - Math.random() * 30 : 130 + Math.random() * 150;
        R.emit({ x: pv.cx + (deck ? d * 6 : (Math.random() - 0.5) * 14), y: pv.feet - 4, vx, vy, drag: 5, life: 0.34 + Math.random() * 0.2, size: 5 + Math.random() * 3, grow: 24, alpha: 0.8, img: sc.puff, draw: stamp, back: true });
      }
      if (!deck) for (let i = -1; i <= 1; i++) R.emit({ x: pv.cx + i * 5, y: pv.feet - 1, vx: i * 50, vy: 280 + Math.random() * 120, drag: 6, life: 0.22, size: 1.2, shape: 'line', width: 2, color: '#b5f1ff' });
    },
    // dust that hangs about in the low gravity
    land(R, pv, impact) {
      const sc = R.scene;
      for (const d of [-1, 1]) R.emit({ x: pv.cx + d * 9, y: pv.feet - 4, vx: d * (50 + impact * 70), vy: -8, drag: 3.5, life: 0.6, size: 5, grow: 14 + impact * 10, alpha: 0.6, img: sc.dust, draw: stamp });
      for (let i = 0; i < 3 + impact * 4; i++) {
        const d = i % 2 ? 1 : -1;
        R.emit({ x: pv.cx + d * 8, y: pv.feet - 2, vx: d * (30 + Math.random() * 130), vy: -30 - Math.random() * 80, g: 160, drag: 1.2, life: 0.6 + Math.random() * 0.3, size: 1 + Math.random() * 1.2, color: '#c9d4e8' });
      }
    },
    step(R, pv) {
      if (Math.random() < 0.5) R.emit({ x: pv.cx - pv.face * 9, y: pv.feet - 2, vx: -pv.face * 30, vy: -26, g: 90, life: 0.36, size: 1 + Math.random(), color: '#c9d4e8' });
    },
    // the backpack thruster sputters while you rise
    trail(R, pv, dt, t) {
      const sc = R.scene;
      if (pv.ground || pv.vy > -260 || t - sc.trail[pv.slot] < 0.06) return;
      sc.trail[pv.slot] = t;
      R.emit({ x: pv.cx - pv.face * 12, y: pv.y + 35, vx: -pv.face * 20 + (Math.random() - 0.5) * 30, vy: 130, drag: 3, life: 0.26, size: 2.4, grow: -6, color: '#b5f1ff', back: true });
    },
    // beamed back aboard
    respawn(R, pv) {
      R.emit({ x: pv.cx, y: pv.y + 20, life: 0.4, size: 44, grow: -90, shape: 'ring', width: 2.5, color: '#b5f1ff' });
      for (let i = 0; i < 10; i++) {
        R.emit({ x: pv.cx + (Math.random() - 0.5) * 30, y: pv.y + 40 - Math.random() * 44, vy: -60 - Math.random() * 90, life: 0.5 + Math.random() * 0.3, size: 1.2, shape: 'line', width: 2, color: i % 2 ? pv.color : '#ffffff' });
      }
    },
    // tagged: alarm flash, shock rings, sparks in both players' colours, bits of debris
    tag(R, to, from) {
      const sc = R.scene;
      R.flash(ALERT, 0.16);
      const x = to.cx;
      const y = to.y + 20;
      R.emit({ x, y, life: 0.28, size: 24, grow: 55, alpha: 0.95, img: sc.itGlow, draw: stamp });
      R.emit({ x, y, life: 0.4, size: 10, grow: 310, shape: 'ring', width: 3.5, color: '#ffffff' });
      R.emit({ x, y, life: 0.6, size: 6, grow: 190, shape: 'ring', width: 2.5, color: ALERT });
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU + Math.random() * 0.3;
        const v = 220 + Math.random() * 380;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3.2, life: 0.35 + Math.random() * 0.35, size: 1.3, shape: 'line', width: 2.4, color: i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? to.color : from.color });
      }
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * TAU;
        const v = 60 + Math.random() * 160;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 70, drag: 1.2, vr: (Math.random() - 0.5) * 14, life: 0.8 + Math.random() * 0.5, size: 3 + Math.random() * 3, shape: 'square', color: i % 2 ? '#c6d0e2' : '#8492b0' });
      }
    },
  },
};
