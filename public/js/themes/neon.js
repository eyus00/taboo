// NEON DISTRICT - cyberpunk. Rain-slick night city, glowing rails, little
// visor-bots leaving light trails.

import { W, H, PW } from '/shared/config.js';
import { rr, rgba, vnoise, squashAt } from '../util.js';

const CYAN = '#22e6ff';
const PINK = '#ff2bd6';
const AMBER = '#ffb347';
const VIOLET = '#9d6bff';
const SIGN_COLORS = [CYAN, PINK, AMBER, '#7dff6b'];

function skyline(g, rnd, o) {
  let x = -20;
  while (x < W + 20) {
    const w = o.minW + rnd() * (o.maxW - o.minW);
    const h = o.minH + rnd() * (o.maxH - o.minH);
    const top = H - h;
    g.fillStyle = o.color;
    g.fillRect(x, top, w, h);
    if (rnd() < 0.45) g.fillRect(x + w * 0.2, top - 8 - rnd() * 14, w * 0.6, 30); // stepped roof
    if (rnd() < 0.35) {
      const ax = x + w * (0.3 + rnd() * 0.4);
      const ah = 14 + rnd() * 30;
      g.fillRect(ax, top - ah, 1.5, ah);
      if (o.beacons && rnd() < 0.7) o.beacons.push({ x: ax + 0.75, y: top - ah, ph: rnd() * 6 });
    }
    // windows
    const cols = Math.floor((w - 8) / 7);
    const rows = Math.floor((h - 12) / 9);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() > o.density) continue;
        const col = rnd() < 0.5 ? CYAN : rnd() < 0.5 ? PINK : rnd() < 0.6 ? AMBER : '#ffffff';
        g.fillStyle = rgba(col, o.winAlpha * (0.4 + rnd() * 0.6));
        g.fillRect(x + 5 + c * 7, top + 8 + r * 9, 3.5, 5);
      }
    }
    // a vertical neon sign hung on the side
    if (o.signs && w > 44 && h > 120 && rnd() < 0.5) {
      const col = SIGN_COLORS[Math.floor(rnd() * SIGN_COLORS.length)];
      const sw = 11;
      const sh = 38 + rnd() * 40;
      const sx = x + 6 + rnd() * (w - 24);
      const sy = top + 16 + rnd() * 30;
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 14;
      g.strokeStyle = col;
      g.lineWidth = 1.6;
      g.strokeRect(sx, sy, sw, sh);
      g.shadowBlur = 6;
      g.fillStyle = col;
      // abstract glyph blocks instead of real lettering
      for (let gy = sy + 5; gy < sy + sh - 6; gy += 9) {
        const k = rnd();
        if (k < 0.33) g.fillRect(sx + 3, gy, 5, 5);
        else if (k < 0.66) {
          g.fillRect(sx + 3, gy, 5, 1.6);
          g.fillRect(sx + 3, gy + 3.4, 5, 1.6);
        } else {
          g.beginPath();
          g.arc(sx + 5.5, gy + 2.5, 2.6, 0, 6.283);
          g.fill();
        }
      }
      g.restore();
      o.signs.push({ x: sx - 2, y: sy - 2, w: sw + 4, h: sh + 4, ph: rnd() * 50 });
    }
    x += w + (rnd() < 0.3 ? rnd() * 10 : 0);
  }
}

function drawPlatform(g, p, i, rnd) {
  const accent = p.ground ? [CYAN, PINK][i % 2] : [PINK, CYAN, VIOLET, AMBER][i % 4];
  if (!p.ground) {
    // light cone under floating slabs
    const cone = g.createLinearGradient(0, p.y + p.h, 0, p.y + p.h + 54);
    cone.addColorStop(0, rgba(accent, 0.2));
    cone.addColorStop(1, rgba(accent, 0));
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(p.x + 10, p.y + p.h);
    g.lineTo(p.x + p.w - 10, p.y + p.h);
    g.lineTo(p.x + p.w + 14, p.y + p.h + 54);
    g.lineTo(p.x - 14, p.y + p.h + 54);
    g.closePath();
    g.fill();
  }
  const body = g.createLinearGradient(0, p.y, 0, p.y + Math.min(p.h, 140));
  body.addColorStop(0, '#2a2158');
  body.addColorStop(1, '#0e0a24');
  g.fillStyle = body;
  g.fillRect(p.x, p.y, p.w, p.h);

  g.save();
  g.beginPath();
  g.rect(p.x, p.y, p.w, p.h);
  g.clip();
  g.strokeStyle = 'rgba(150,140,255,.16)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = p.x + 30; x < p.x + p.w; x += 34) {
    g.moveTo(x + 0.5, p.y + 4);
    g.lineTo(x + 0.5, p.y + p.h);
  }
  if (p.ground) {
    for (let y = p.y + 30; y < p.y + p.h; y += 30) {
      g.moveTo(p.x, y + 0.5);
      g.lineTo(p.x + p.w, y + 0.5);
    }
  }
  g.stroke();
  if (p.ground && p.h > 40) {
    // circuit traces and the odd lit vent
    const n = Math.floor((p.w * p.h) / 4200) + 1;
    for (let k = 0; k < n; k++) {
      const x0 = p.x + 10 + rnd() * (p.w - 20);
      const y0 = p.y + 14 + rnd() * (p.h - 24);
      const dx = (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 40);
      const dy = 10 + rnd() * 40;
      g.strokeStyle = rgba(accent, 0.3);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + dx, y0);
      g.lineTo(x0 + dx, y0 + dy);
      g.stroke();
      g.fillStyle = rgba(accent, 0.7);
      g.fillRect(x0 - 1.5, y0 - 1.5, 3, 3);
      g.fillRect(x0 + dx - 1.5, y0 + dy - 1.5, 3, 3);
    }
    for (let k = 0; k < n; k++) {
      g.fillStyle = rgba(AMBER, 0.25 + rnd() * 0.3);
      g.fillRect(p.x + 8 + rnd() * (p.w - 30), p.y + 16 + rnd() * (p.h - 30), 12, 3);
    }
  }
  g.restore();

  // side rails
  g.fillStyle = rgba(accent, 0.35);
  g.fillRect(p.x, p.y, 1.5, p.h);
  g.fillRect(p.x + p.w - 1.5, p.y, 1.5, p.h);
  if (!p.ground) {
    g.fillStyle = rgba(accent, 0.55);
    g.fillRect(p.x, p.y + p.h - 1.5, p.w, 1.5);
  }
  // glowing top rail: the part you actually stand on
  g.save();
  g.shadowColor = accent;
  g.shadowBlur = 16;
  g.fillStyle = accent;
  g.fillRect(p.x, p.y, p.w, 3);
  g.fillRect(p.x, p.y, p.w, 3);
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.7)';
  g.fillRect(p.x + 1, p.y + 0.5, p.w - 2, 1);
  return accent;
}

export default {
  id: 'neon',
  colors: ['#ff4d5e', '#3da8ff', '#3dff9a', '#ffe14d'],
  letterbox: '#05030f',
  label: {
    font: '600 13px Rajdhani, sans-serif',
    size: 12,
    color: '#e9faff',
    stroke: 'rgba(5,3,20,.9)',
    strokeWidth: 3,
    you: '#ffffff',
    youFont: '800 11px Orbitron, sans-serif',
    stun: '#ffe14d',
  },
  hud: {
    font: 'Orbitron, sans-serif',
    weight: 800,
    labelFont: 'Rajdhani, sans-serif',
    labelWeight: 600,
    labelScale: 1.08,
    scale: 0.9,
    text: '#e9faff',
    dim: 'rgba(190,225,255,.62)',
    warn: '#ff4d6d',
    glow: 'rgba(34,230,255,.9)',
    glowBlur: 12,
    chip: 'rgba(10,7,30,.74)',
    chipLine: 'rgba(34,230,255,.35)',
    chipIt: 'rgba(255,43,214,.24)',
    big: '#ffffff',
    bigStroke: 'rgba(255,43,214,.6)',
    radius: 4,
  },

  build(env) {
    const { rnd, arena, layer } = env;
    const signs = [];
    const beacons = [];
    const bg = layer((g) => {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#070318');
      sky.addColorStop(0.45, '#170a3d');
      sky.addColorStop(0.82, '#42115c');
      sky.addColorStop(1, '#1a0a2e');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = rgba('#b9c8ff', 0.12 + rnd() * 0.35);
        g.fillRect(rnd() * W, rnd() * 230, 1.3, 1.3);
      }
      // hologram moon
      const mx = 612;
      const my = 118;
      let rg = g.createRadialGradient(mx, my, 10, mx, my, 200);
      rg.addColorStop(0, 'rgba(120,220,255,.34)');
      rg.addColorStop(1, 'rgba(120,220,255,0)');
      g.fillStyle = rg;
      g.fillRect(mx - 200, my - 200, 400, 400);
      g.save();
      g.beginPath();
      g.arc(mx, my, 48, 0, 6.283);
      g.clip();
      const mg = g.createLinearGradient(0, my - 48, 0, my + 48);
      mg.addColorStop(0, '#e6fbff');
      mg.addColorStop(1, '#ff8ae6');
      g.fillStyle = mg;
      g.fillRect(mx - 50, my - 50, 100, 100);
      g.fillStyle = '#170a3d';
      for (let i = 0; i < 6; i++) g.fillRect(mx - 50, my + 4 + i * 8, 100, 1.5 + i * 0.9);
      g.restore();
      // magenta smog on the horizon
      rg = g.createRadialGradient(W / 2, H * 0.9, 20, W / 2, H * 0.9, 520);
      rg.addColorStop(0, 'rgba(255,43,214,.42)');
      rg.addColorStop(1, 'rgba(255,43,214,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);

      skyline(g, rnd, { minW: 34, maxW: 80, minH: 170, maxH: 340, color: '#1d1250', density: 0.22, winAlpha: 0.35 });
      g.fillStyle = 'rgba(66,17,92,.35)';
      g.fillRect(0, 0, W, H);
      skyline(g, rnd, { minW: 40, maxW: 96, minH: 90, maxH: 260, color: '#130a36', density: 0.36, winAlpha: 0.85, signs, beacons });
      skyline(g, rnd, { minW: 50, maxW: 130, minH: 26, maxH: 110, color: '#090520', density: 0.06, winAlpha: 0.5 });
      const fog = g.createLinearGradient(0, H - 150, 0, H);
      fog.addColorStop(0, 'rgba(255,43,214,0)');
      fog.addColorStop(1, 'rgba(255,43,214,.2)');
      g.fillStyle = fog;
      g.fillRect(0, H - 150, W, 150);
    });

    const accents = [];
    const plats = layer((g) => {
      arena.platforms.forEach((p, i) => accents.push(drawPlatform(g, p, i, rnd)));
    });

    const overlay = layer((g) => {
      g.fillStyle = 'rgba(0,0,10,.11)';
      for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
      v.addColorStop(0, 'rgba(5,0,20,0)');
      v.addColorStop(1, 'rgba(5,0,20,.62)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    });

    const rain = [];
    for (let i = 0; i < 120; i++) rain.push({ x: rnd() * (W + 120), y: rnd() * (H + 60), v: 520 + rnd() * 380, l: 9 + rnd() * 12 });
    const cars = [];
    for (let i = 0; i < 4; i++) cars.push({ y: 60 + rnd() * 170, v: (rnd() < 0.5 ? -1 : 1) * (50 + rnd() * 80), off: rnd() * 900, col: rnd() < 0.5 ? CYAN : AMBER });

    return { bg, plats, overlay, signs, beacons, accents, rain, cars, arena, trail: [0, 0, 0, 0] };
  },

  back(g, sc, t) {
    g.drawImage(sc.bg, 0, 0, W, H);
    // flickering signs: briefly cut the power
    g.fillStyle = 'rgba(19,10,54,.72)';
    for (let i = 0; i < sc.signs.length; i++) {
      const s = sc.signs[i];
      if (vnoise(t * 7 + s.ph, i) > 0.8) g.fillRect(s.x, s.y, s.w, s.h);
    }
    // rooftop beacons
    for (const b of sc.beacons) {
      const a = 0.5 + 0.5 * Math.sin(t * 2.4 + b.ph);
      if (a < 0.3) continue;
      g.fillStyle = `rgba(255,60,80,${0.22 * a})`;
      g.beginPath();
      g.arc(b.x, b.y, 6, 0, 6.283);
      g.fill();
      g.fillStyle = `rgba(255,120,120,${a})`;
      g.fillRect(b.x - 1.2, b.y - 1.2, 2.4, 2.4);
    }
    // traffic in the sky
    for (const c of sc.cars) {
      const span = W + 240;
      let x = (((t * c.v + c.off) % span) + span) % span - 120;
      const dir = Math.sign(c.v);
      g.fillStyle = rgba(c.col, 0.22);
      g.fillRect(dir > 0 ? x - 34 : x, c.y, 34, 1.4);
      g.fillStyle = '#ffffff';
      g.fillRect(x - 1.5, c.y - 0.6, 3, 2.4);
    }
  },

  platforms(g, sc, t) {
    g.drawImage(sc.plats, 0, 0, W, H);
    // a pulse of light racing along every rail
    const ps = sc.arena.platforms;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const x = p.x - 30 + ((t * 110 + i * 83) % (p.w + 60));
      const x0 = Math.max(p.x, x);
      const x1 = Math.min(p.x + p.w, x + 30);
      if (x1 <= x0) continue;
      g.fillStyle = rgba(sc.accents[i], 0.28);
      g.fillRect(x0, p.y - 3, x1 - x0, 9);
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.fillRect(x0, p.y - 0.5, x1 - x0, 3.5);
    }
  },

  player(g, pv, t) {
    const { cx, feet, color } = pv;
    const air = !pv.ground;
    squashAt(g, cx, feet, pv.squash);
    const moving = pv.ground && Math.abs(pv.vx) > 30;
    const sw = moving ? Math.sin(pv.run) : 0;
    const bob = moving ? Math.abs(Math.cos(pv.run)) * 1.5 : 0;
    const by = pv.y + 1 - bob;
    const bh = 31;
    const hip = by + bh - 2;

    // legs: two light sticks
    g.lineCap = 'round';
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.beginPath();
    if (air) {
      const k = pv.vy < 0 ? 5 : -3;
      g.moveTo(cx - 7, hip);
      g.lineTo(cx - 7 - pv.face * k, feet - 4);
      g.moveTo(cx + 7, hip);
      g.lineTo(cx + 7 - pv.face * k, feet - 1);
    } else {
      g.moveTo(cx - 7, hip);
      g.lineTo(cx - 7 + sw * 7, feet - 2 - Math.max(0, sw) * 4);
      g.moveTo(cx + 7, hip);
      g.lineTo(cx + 7 - sw * 7, feet - 2 - Math.max(0, -sw) * 4);
    }
    g.stroke();

    // body shell
    g.shadowColor = pv.isIt ? '#ff2b6a' : color;
    g.shadowBlur = pv.isIt ? 18 + 6 * Math.sin(t * 11) : 10;
    rr(g, pv.x + 2, by, PW - 4, bh, 8);
    g.fillStyle = '#0c0a1f';
    g.fill();
    g.lineWidth = 2.6;
    g.strokeStyle = color;
    g.stroke();
    g.shadowBlur = 0;
    const sheen = g.createLinearGradient(0, by, 0, by + bh);
    sheen.addColorStop(0, rgba(color, 0.5));
    sheen.addColorStop(0.7, rgba(color, 0.06));
    rr(g, pv.x + 4, by + 2, PW - 8, bh - 4, 6);
    g.fillStyle = sheen;
    g.fill();

    // visor
    const open = 1 - pv.blink * 0.85;
    const vh = Math.max(1.5, 9 * open);
    rr(g, cx - 10 + pv.face * 3, by + 7 + (9 - vh) / 2, 20, vh, 3);
    g.shadowColor = pv.isIt ? '#ff2b55' : '#ffffff';
    g.shadowBlur = 7;
    g.fillStyle = pv.isIt ? '#ff4d6d' : '#eaffff';
    g.fill();
    g.shadowBlur = 0;
    if (open > 0.4) {
      g.fillStyle = '#0c0a1f';
      if (pv.isIt) {
        // angry slanted eyes
        g.beginPath();
        g.moveTo(cx - 6 + pv.face * 4, by + 9);
        g.lineTo(cx - 1 + pv.face * 4, by + 11.5);
        g.lineTo(cx - 6 + pv.face * 4, by + 14);
        g.moveTo(cx + 6 + pv.face * 4, by + 9);
        g.lineTo(cx + 1 + pv.face * 4, by + 11.5);
        g.lineTo(cx + 6 + pv.face * 4, by + 14);
        g.fill();
      } else {
        g.fillRect(cx - 5.5 + pv.face * 5, by + 9.5, 3, 4.5);
        g.fillRect(cx + 2.5 + pv.face * 5, by + 9.5, 3, 4.5);
      }
    }
    // core light + antenna
    g.fillStyle = color;
    g.beginPath();
    g.arc(cx, by + 23, 3, 0, 6.283);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect(cx - 1, by + 22, 2, 2);
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cx - pv.face * 6, by + 1);
    g.lineTo(cx - pv.face * 9, by - 6);
    g.stroke();
    g.fillStyle = '#fff';
    g.fillRect(cx - pv.face * 9 - 1.5, by - 8, 3, 3);
  },

  marker(g, cx, cy, t) {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = PINK;
    g.shadowBlur = 12;
    g.font = '800 16px Orbitron, sans-serif';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(20,0,30,.85)';
    g.strokeText('IT', cx, cy - 4);
    g.fillStyle = '#ffffff';
    g.fillText('IT', cx, cy - 4);
    g.fillStyle = PINK;
    g.beginPath();
    g.moveTo(cx - 6, cy + 6);
    g.lineTo(cx + 6, cy + 6);
    g.lineTo(cx, cy + 12.5);
    g.closePath();
    g.fill();
    g.restore();
  },

  front(g, sc, t) {
    // rain, falling at a slant
    g.strokeStyle = 'rgba(160,215,255,.3)';
    g.lineWidth = 1;
    g.beginPath();
    for (const d of sc.rain) {
      const y = ((d.y + t * d.v) % (H + 60)) - 30;
      const x = ((d.x - y * 0.22 + 2000) % (W + 120)) - 60;
      g.moveTo(x, y);
      g.lineTo(x - d.l * 0.22, y + d.l);
    }
    g.stroke();
    g.drawImage(sc.overlay, 0, 0, W, H);
  },

  fx: {
    trail(R, pv, dt, t) {
      const sc = R.scene;
      if (Math.abs(pv.vx) < 150 && pv.ground) return;
      if (t - sc.trail[pv.slot] < 0.035) return;
      sc.trail[pv.slot] = t;
      R.emit({
        x: pv.x,
        y: pv.y,
        life: 0.24,
        back: true,
        color: pv.color,
        draw(g, p, k) {
          g.globalAlpha = k * 0.3;
          rr(g, p.x + 2, p.y + 1, PW - 4, 31, 8);
          g.fillStyle = p.color;
          g.fill();
        },
      });
    },
    jump(R, pv) {
      for (let i = 0; i < 7; i++) {
        R.emit({ x: pv.cx + (Math.random() - 0.5) * 20, y: pv.feet, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 60, life: 0.28, size: 1, shape: 'line', width: 2, color: pv.color, drag: 4 });
      }
    },
    land(R, pv, impact) {
      R.emit({ x: pv.cx, y: pv.feet - 1, life: 0.3, size: 4, grow: 90 + impact * 90, shape: 'ring', width: 2, color: pv.color });
      for (let i = 0; i < 4 + impact * 6; i++) {
        R.emit({ x: pv.cx + (Math.random() - 0.5) * 24, y: pv.feet - 1, vx: (Math.random() - 0.5) * 320, vy: -40 - Math.random() * 120, g: 600, life: 0.35, size: 1, shape: 'line', width: 2, color: '#ffffff' });
      }
    },
    step(R, pv) {
      R.emit({ x: pv.cx - pv.face * 8, y: pv.feet - 1, vx: -pv.face * 60, vy: -50, g: 300, life: 0.22, size: 1.6, color: pv.color });
    },
    respawn(R, pv) {
      R.emit({
        x: pv.cx,
        y: 0,
        life: 0.45,
        color: pv.color,
        draw(g, p, k) {
          g.globalAlpha = k * 0.6;
          g.fillStyle = p.color;
          g.fillRect(p.x - 16 * k, 0, 32 * k, H);
          g.globalAlpha = k;
          g.fillStyle = '#fff';
          g.fillRect(p.x - 2 * k, 0, 4 * k, H);
        },
      });
    },
    tag(R, to, from) {
      R.flash(PINK, 0.22);
      const x = to.cx;
      const y = to.y + 20;
      R.emit({ x, y, life: 0.45, size: 8, grow: 320, shape: 'ring', width: 3, color: '#ffffff' });
      R.emit({ x, y, life: 0.6, size: 4, grow: 220, shape: 'ring', width: 2, color: PINK });
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * 6.283;
        const v = 180 + Math.random() * 420;
        R.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, life: 0.35 + Math.random() * 0.35, size: 1.2, shape: 'line', width: 2.2, color: i % 2 ? to.color : from.color });
      }
      // glitch slices
      for (let i = 0; i < 6; i++) {
        R.emit({
          x: 0,
          y: Math.random() * H,
          life: 0.1 + Math.random() * 0.12,
          size: 3 + Math.random() * 14,
          color: i % 2 ? CYAN : PINK,
          draw(g, p, k) {
            g.globalAlpha = 0.28 * k;
            g.fillStyle = p.color;
            g.fillRect(0, p.y, W, p.size);
          },
        });
      }
    },
  },
};
