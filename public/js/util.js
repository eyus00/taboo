// Small drawing/maths helpers shared by the renderer and the art styles.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

// Seeded random numbers, so every player sees the same skyline / trees / doodles.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Cheap repeatable noise in [0, 1) for an integer index.
export function hash1(i, seed = 0) {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth 1-D value noise.
export function vnoise(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i, seed), hash1(i + 1, seed), u);
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], t)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export const lighten = (hex, t) => mix(hex, '#ffffff', t);
export const darken = (hex, t) => mix(hex, '#000000', t);

// Rounded rectangle path.
export function rr(ctx, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.lineTo(x + w - q, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + q);
  ctx.lineTo(x + w, y + h - q);
  ctx.quadraticCurveTo(x + w, y + h, x + w - q, y + h);
  ctx.lineTo(x + q, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - q);
  ctx.lineTo(x, y + q);
  ctx.quadraticCurveTo(x, y, x + q, y);
  ctx.closePath();
}

// Squash & stretch around the feet. Call inside save()/restore().
export function squashAt(ctx, cx, feetY, squash) {
  if (!squash) return;
  ctx.translate(cx, feetY);
  ctx.scale(1 + squash, 1 - squash);
  ctx.translate(-cx, -feetY);
}

export function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

// ---------------------------------------------------------------------------
// Power-up icons, shared by every art style so they are always recognisable.
// ---------------------------------------------------------------------------
export const KIND_COLORS = { speed: '#ffb020', jump: '#3ecf6e', shield: '#4aa3ff', freeze: '#8fe6ff', blast: '#ff6b3d', swap: '#c77dff', storm: '#ffe14d', goo: '#7ed957', box: '#ffc83d' };

// Draws the icon for a power-up centred on (cx, cy), fitting a circle of radius r.
export function drawIcon(g, kind, cx, cy, r, color) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (kind === 'speed') {
    // lightning bolt
    g.beginPath();
    g.moveTo(r * 0.25, -r);
    g.lineTo(-r * 0.6, r * 0.12);
    g.lineTo(-r * 0.05, r * 0.12);
    g.lineTo(-r * 0.3, r);
    g.lineTo(r * 0.6, -r * 0.18);
    g.lineTo(r * 0.05, -r * 0.18);
    g.closePath();
    g.fill();
  } else if (kind === 'jump') {
    // two chevrons pointing up
    g.lineWidth = r * 0.36;
    g.beginPath();
    g.moveTo(-r * 0.7, -r * 0.05);
    g.lineTo(0, -r * 0.75);
    g.lineTo(r * 0.7, -r * 0.05);
    g.moveTo(-r * 0.7, r * 0.7);
    g.lineTo(0, 0);
    g.lineTo(r * 0.7, r * 0.7);
    g.stroke();
  } else if (kind === 'shield') {
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.82, -r * 0.62);
    g.lineTo(r * 0.82, r * 0.05);
    g.quadraticCurveTo(r * 0.7, r * 0.75, 0, r);
    g.quadraticCurveTo(-r * 0.7, r * 0.75, -r * 0.82, r * 0.05);
    g.lineTo(-r * 0.82, -r * 0.62);
    g.closePath();
    g.fill();
  } else if (kind === 'freeze') {
    // snowflake
    g.lineWidth = r * 0.26;
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 2;
      g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      g.lineTo(-Math.cos(a) * r, -Math.sin(a) * r);
    }
    g.stroke();
  } else if (kind === 'blast') {
    // starburst
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const q = i % 2 ? r * 0.5 : r;
      g.lineTo(Math.cos(a) * q, Math.sin(a) * q);
    }
    g.closePath();
    g.fill();
  } else if (kind === 'swap') {
    // two arrows passing each other
    g.lineWidth = r * 0.3;
    g.beginPath();
    g.moveTo(-r * 0.8, -r * 0.35);
    g.lineTo(r * 0.8, -r * 0.35);
    g.lineTo(r * 0.35, -r * 0.8);
    g.moveTo(r * 0.8, r * 0.35);
    g.lineTo(-r * 0.8, r * 0.35);
    g.lineTo(-r * 0.35, r * 0.8);
    g.stroke();
  } else if (kind === 'storm') {
    // cloud with a bolt
    g.beginPath();
    g.arc(-r * 0.35, -r * 0.25, r * 0.42, 0, 6.283);
    g.arc(r * 0.25, -r * 0.4, r * 0.5, 0, 6.283);
    g.arc(r * 0.6, -r * 0.1, r * 0.32, 0, 6.283);
    g.fill();
    g.lineWidth = r * 0.26;
    g.beginPath();
    g.moveTo(r * 0.1, r * 0.1);
    g.lineTo(-r * 0.3, r * 0.55);
    g.lineTo(r * 0.15, r * 0.55);
    g.lineTo(-r * 0.15, r);
    g.stroke();
  } else if (kind === 'goo') {
    // a drop
    g.beginPath();
    g.moveTo(0, -r);
    g.quadraticCurveTo(r * 0.9, r * 0.1, r * 0.62, r * 0.5);
    g.arc(0, r * 0.38, r * 0.63, 0.19, Math.PI - 0.19);
    g.quadraticCurveTo(-r * 0.9, r * 0.1, 0, -r);
    g.fill();
  } else {
    // a lucky box: a question mark
    g.lineWidth = r * 0.34;
    g.beginPath();
    g.arc(0, -r * 0.4, r * 0.48, Math.PI * 1.05, Math.PI * 0.42);
    g.lineTo(0, r * 0.32);
    g.stroke();
    g.beginPath();
    g.arc(0, r * 0.8, r * 0.2, 0, 6.283);
    g.fill();
  }
  g.restore();
}

// Colours for portal pairs (same in every style, so partners are easy to match).
export const PORTAL_COLORS = ['#4aa3ff', '#ff7a45', '#b06cff'];
