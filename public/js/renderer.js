// Draws a match. Built to hold a steady frame rate on modest laptops:
//
//  * Everything that never moves - backdrop, platforms, slopes - is painted
//    ONCE into a background canvas. The browser keeps that as a finished
//    picture; showing it again costs nothing.
//  * A transparent foreground canvas sits on top. Each frame it is cleared and
//    only the few moving things are drawn: players, items, sparks.
//  * Anything fancy (glows, gradients, text) is pre-rendered into small sprites.
//  * If frames still take too long, the foreground drops its resolution.
//
// The view is close in on your own player and follows them. While a round is
// being introduced, and when it is over, it pulls back to show the whole arena.

import { ART_W, ART_H, PW, PH, MAX_PLAYERS, TEAM_COLORS, BLAST_RADIUS } from '/shared/config.js';
import { LEDGE_H } from '/shared/arenas.js';
import { THEME_MAP } from './themes/index.js';
import { clamp, mulberry32, hashStr, hash1, rgba, rr, KIND_COLORS, PORTAL_COLORS } from './util.js';

const VIEW_H = 660; // world units of height on screen during play: close enough to feel fast
const VIEW_W_MIN = 760; // ...but never narrower than this (phones held upright)
const MAX_BG_PIXELS = 6.5e6; // cap on the background canvas (keeps 4K / retina screens fast)
const MAX_BG_SIDE = 4096;
const CAP = 16; // slopes are drawn this much longer at each end (a player's centre rides them)
const LABEL_PX = 12;

export class Renderer {
  // stage: an element to put the canvases in, or null to draw off screen (opts.size = [w, h]).
  // opts.whole: always show the whole arena. opts.zoom / opts.focus: fixed zoom and centre.
  // opts.padBottom: CSS px the following view may scroll below the arena (room for touch buttons).
  // opts.plain: do not dim the area outside the arena (menu pictures).
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.opts = opts;
    this.bg = document.createElement('canvas');
    this.fg = document.createElement('canvas');
    this.bg.className = 'layer bg';
    this.fg.className = 'layer fg';
    this.bgx = this.bg.getContext('2d', { alpha: false });
    this.fgx = this.fg.getContext('2d');
    if (stage) {
      this.flashEl = document.createElement('div');
      this.flashEl.className = 'flash';
      stage.append(this.bg, this.fg, this.flashEl);
    }
    this.lo = document.createElement('canvas'); // low-res buffer for pixel-art styles
    this.scratch = document.createElement('canvas');
    this.scratch.width = 48;
    this.scratch.height = 60;
    this.sx = this.scratch.getContext('2d');
    this.theme = null;
    this.arena = null;
    this.scene = null;
    this.key = '';
    this.q = 1; // foreground resolution factor (lowered by the frame-rate governor)
    this.level = 0; // 0 full detail, 1 no ambient animation, 2 half-resolution foreground
    this.cam = { x: 0, y: 0, set: false };
    this.parts = [];
    this.anim = [];
    this.last = new Array(MAX_PLAYERS).fill(null);
    this.labels = new Map();
    this.spr = null;
    this.trampT = [];
    this.gen = 0;
    this.lastT = 0;
    this.frameMs = 16;
    this.slow = 0;
    this.shakeAmt = 0;
    this.onEvent = null; // (name, pv) => void, for sound
  }

  // cols: which of the style's player colours each slot uses (teams hand out
  // warm and cool colours); leave out for slot 0 = colour 0 and so on.
  setScene(arena, themeId, cols = null) {
    this.cols = cols;
    this.arena = arena;
    this.theme = THEME_MAP[themeId] || THEME_MAP.ink;
    this.parts.length = 0;
    this.anim = [];
    this.last = new Array(MAX_PLAYERS).fill(null);
    this.trampT = arena.tramps.map(() => -10);
    this.cam.set = false;
    this.gen++;
    this.layout(true);
  }

  resize() {
    this.layout(false);
  }

  // Work out sizes, then repaint the background if anything changed.
  layout(force) {
    const A = this.arena;
    if (!A || !this.theme) return;
    let cssW;
    let cssH;
    let dpr;
    if (this.opts.size) {
      [cssW, cssH] = this.opts.size;
      dpr = this.opts.dpr || 1;
    } else {
      cssW = Math.max(1, this.stage.clientWidth);
      cssH = Math.max(1, this.stage.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
    }
    const fit = Math.min(cssW / A.w, cssH / A.h);
    const follow = !this.opts.whole;
    const kCss = this.opts.zoom || (follow ? Math.min(clamp(cssH / VIEW_H, 0.5, 2.4), cssW / VIEW_W_MIN) : fit);
    const pad = follow ? this.opts.padBottom || 0 : 0;
    this.padB = pad / kCss; // the same, in world units
    this.zFit = Math.min(1, fit / kCss); // how far the view pulls back to show everything
    const bwCss = follow ? A.w * kCss : cssW;
    const bhCss = follow ? A.h * kCss + pad : cssH;
    const s = Math.min(dpr, Math.sqrt(MAX_BG_PIXELS / (bwCss * bhCss)), MAX_BG_SIDE / bwCss, MAX_BG_SIDE / bhCss);
    const key = [cssW, cssH, s.toFixed(3), follow, this.q, this.theme.id, A.id].join();
    if (!force && key === this.key) return;
    this.key = key;
    this.cssW = cssW;
    this.cssH = cssH;
    this.follow = follow;
    this.kCss = kCss;
    this.s = s;
    this.kDev = kCss * s; // background pixels per world unit
    this.kf = this.kDev * this.q; // foreground pixels per world unit
    // pixel-art styles: how many whole screen pixels one art pixel is blown up to before the final fit
    this.pxN = this.theme.pixel ? Math.max(1, Math.ceil(this.kf * this.theme.pixel - 0.001)) : 1;
    this.viewW = cssW / kCss; // world units across the screen
    this.viewH = cssH / kCss;

    this.bg.width = Math.round(bwCss * s);
    this.bg.height = Math.round(bhCss * s);
    this.fg.width = Math.max(1, Math.round(cssW * s * this.q));
    this.fg.height = Math.max(1, Math.round(cssH * s * this.q));
    if (this.stage) {
      this.bg.style.width = `${bwCss}px`;
      this.bg.style.height = `${bhCss}px`;
      this.bg.style.transformOrigin = '0 0';
      this.bg.style.transform = '';
    }
    // where the arena's top-left corner sits on the background canvas
    this.ox = follow ? 0 : Math.round((this.bg.width - A.w * this.kDev) / 2);
    this.oy = follow ? 0 : Math.round((this.bg.height - A.h * this.kDev) / 2);
    this.bake();
    if (!follow) {
      this.cam.x = -this.ox / this.kDev;
      this.cam.y = -this.oy / this.kDev;
    }
  }

  // --- the static picture ----------------------------------------------------------
  bake() {
    const th = this.theme;
    const A = this.arena;
    const bw = this.bg.width;
    const bh = this.bg.height;
    const U = th.pixel || 0;
    const seed = hashStr(`${A.id}/${th.id}`);

    // pixel-art styles are painted small and blown up without smoothing
    let g = this.bgx;
    let unit = 1; // background pixels per pixel of the canvas we paint on
    if (U) {
      unit = this.kDev * U;
      this.lo.width = Math.ceil(bw / unit);
      this.lo.height = Math.ceil(bh / unit);
      g = this.lo.getContext('2d', { alpha: false });
      // keep the arena on the coarse pixel grid
      this.ox = Math.round(this.ox / unit) * unit;
      this.oy = Math.round(this.oy / unit) * unit;
    }
    const cw = bw / unit;
    const ch = bh / unit;
    const aS = Math.max(cw / ART_W, ch / ART_H); // the 800x500 art board covers the canvas
    const art = { s: aS, x: (cw - ART_W * aS) / 2, y: (ch - ART_H * aS) / 2 };
    this.art = { s: aS * unit, x: art.x * unit, y: art.y * unit }; // same, in background pixels
    const kw = this.kDev / unit; // painted pixels per world unit
    const wx = this.ox / unit;
    const wy = this.oy / unit;

    const env = {
      arena: A,
      scale: aS,
      rnd: mulberry32(seed),
      // Pre-render something on the art board; returns a canvas to drawImage(c, 0, 0, 800, 500).
      layer: (draw, sc = U ? 1 / U : aS) => {
        const c = document.createElement('canvas');
        c.width = Math.ceil(ART_W * sc);
        c.height = Math.ceil(ART_H * sc);
        const lg = c.getContext('2d');
        lg.scale(sc, sc);
        draw(lg);
        return c;
      },
      // Pre-render a small picture w x h world units big; draw it with g.drawImage(c, x, y, w, h).
      sprite: (w, h, draw) => this.makeSprite(0, 0, w, h, draw).c,
    };
    this.scene = th.build(env);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = !U;
    g.fillStyle = th.letterbox;
    g.fillRect(0, 0, cw, ch);
    g.setTransform(art.s, 0, 0, art.s, art.x, art.y);
    g.save();
    th.back(g, this.scene, 0, null, []);
    g.restore();

    // out of bounds: dim whatever lies outside the arena
    g.setTransform(1, 0, 0, 1, 0, 0);
    const aw = A.w * kw;
    const ah = A.h * kw;
    if ((wx > 1 || wy > 1) && !this.opts.plain) {
      g.fillStyle = rgba(th.letterbox, 0.55);
      g.fillRect(0, 0, cw, wy);
      g.fillRect(0, wy + ah, cw, ch - wy - ah);
      g.fillRect(0, wy, wx, ah);
      g.fillRect(wx + aw, wy, cw - wx - aw, ah);
    }

    // the arena itself
    g.setTransform(kw, 0, 0, kw, wx, wy);
    const below = (ch - wy - ah) / kw; // world units of screen under the arena
    this.paintLifts(g);
    A.platforms.forEach((p, i) => {
      // the floor carries on down to the bottom of the screen
      const q = p.ground && p.y + p.h >= A.h - 1 && below > 1 ? { ...p, h: p.h + below + 2 } : p;
      g.save();
      th.platform(g, q, i, mulberry32(seed + i * 131), A);
      g.restore();
    });
    A.ramps.forEach((r, i) => {
      const rnd = mulberry32(seed + 9001 + i * 197);
      g.save();
      if (th.ramp) th.ramp(g, r, i, rnd, A);
      else {
        // By default a slope is the style's thin ledge, tilted. A loose end runs a
        // little past the slope; an end that rests on a platform just meets it.
        const rests = (x, y) => A.platforms.some((p) => Math.abs(p.y - y) < 3 && x > p.x - 24 && x < p.x + p.w + 24);
        const capL = rests(r.x0, r.y0) ? 5 : CAP;
        const capR = rests(r.x1, r.y1) ? 5 : CAP;
        const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
        g.translate(r.x0, r.y0);
        g.rotate(Math.atan2(r.y1 - r.y0, r.x1 - r.x0));
        th.platform(g, { x: -capL, y: 0, w: len + capL + capR, h: LEDGE_H, oneway: true, ground: false, ramp: true }, 100 + i, rnd, A);
      }
      g.restore();
    });
    g.save();
    th.decor?.(g, this.scene, A); // optional extras painted over the platforms
    g.restore();
    this.paintExtras(g);

    g.setTransform(art.s, 0, 0, art.s, art.x, art.y);
    g.save();
    th.front?.(g, this.scene, 0, null, []);
    g.restore();

    if (U) {
      // Blow the small picture up by a whole number first (crisp, every art pixel
      // the same size), then fit that to the screen smoothly. Going straight to a
      // fractional size would make some art pixels wider than others.
      const n = Math.ceil(unit - 0.001);
      let src = this.lo;
      if (n > 1) {
        src = this.crisp(this.lo, n);
      }
      this.bgx.setTransform(1, 0, 0, 1, 0, 0);
      this.bgx.imageSmoothingEnabled = n > 1 ? Math.abs(n - unit) > 0.01 : unit < 1;
      this.bgx.drawImage(src, 0, 0, this.lo.width * unit, this.lo.height * unit);
    }
    this.buildSprites();
  }

  // Updraft columns: a faint band of colour with brighter edges, so the column
  // reads even in a still picture. The moving streaks are drawn live.
  paintLifts(g) {
    const col = this.theme.lift || '#ffffff';
    for (const z of this.arena.lifts) {
      g.fillStyle = rgba(col, 0.1);
      g.fillRect(z.x, z.y, z.w, z.h);
      g.fillStyle = rgba(col, 0.16);
      g.fillRect(z.x, z.y, 3, z.h);
      g.fillRect(z.x + z.w - 3, z.y, 3, z.h);
    }
  }

  // Things every style shares, so they always read the same: thorns, the
  // arrows on launchers, and the mark on portals you can drop out of.
  paintExtras(g) {
    const A = this.arena;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const z of A.spikes) {
      const n = Math.max(2, Math.round(z.w / 11));
      const w = z.w / n;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        g.moveTo(z.x + i * w, z.y + z.h);
        g.lineTo(z.x + (i + 0.5) * w, z.y - 2);
        g.lineTo(z.x + (i + 1) * w, z.y + z.h);
      }
      g.closePath();
      g.fillStyle = '#e0392b';
      g.fill();
      g.strokeStyle = '#3d0d09';
      g.lineWidth = 1.6;
      g.stroke();
    }
    for (const t of A.tramps) {
      if (!t.vx) continue;
      // two chevrons pointing the way you will fly
      g.save();
      g.translate(t.cx, t.y - 20);
      g.rotate(Math.atan2(-t.vy, t.vx));
      for (const [col, lw] of [['#201408', 6], ['#ffd23f', 3]]) {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        for (const x of [-7, 4]) {
          g.moveTo(x - 6, -8);
          g.lineTo(x + 2, 0);
          g.lineTo(x - 6, 8);
        }
        g.stroke();
      }
      g.restore();
    }
    for (const po of A.portals) {
      if (!po.drop) continue;
      // a small "you may let go" badge
      const x = po.cx + 22;
      const y = po.y + 4;
      g.fillStyle = '#201408';
      g.beginPath();
      g.arc(x, y, 10, 0, 6.283);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(x, y - 5);
      g.lineTo(x, y + 4);
      g.moveTo(x - 4, y);
      g.lineTo(x, y + 5);
      g.lineTo(x + 4, y);
      g.stroke();
    }
  }

  // A copy of a small canvas, n times bigger, with hard pixel edges.
  crisp(small, n, into) {
    const c = into || document.createElement('canvas');
    if (c.width !== small.width * n) c.width = small.width * n;
    if (c.height !== small.height * n) c.height = small.height * n;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(small, 0, 0, c.width, c.height);
    return c;
  }

  // A picture pre-rendered at screen resolution. The box is in world units
  // around the sprite's own origin; blit() puts that origin at a world position.
  makeSprite(x0, y0, w, h, draw, mul = 1) {
    const U = this.theme.pixel || 0;
    const k = U ? 1 / U : this.kf * mul;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * k));
    c.height = Math.max(1, Math.ceil(h * k));
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    draw(g);
    return { c: U && this.pxN > 1 ? this.crisp(c, this.pxN) : c, x0, y0, w, h };
  }

  blit(g, s, x, y, scale = 1) {
    const U = this.theme.pixel;
    if (U) {
      // pixel art stays on its own grid, and never changes size
      g.drawImage(s.c, Math.round((x + s.x0) / U) * U, Math.round((y + s.y0) / U) * U, s.w, s.h);
      return;
    }
    // snap to whole pixels, and at natural size draw the sprite pixel for pixel:
    // then the browser can simply copy it instead of resampling
    const k = this.kf;
    const px = Math.round((x + s.x0 * scale) * k) / k;
    const py = Math.round((y + s.y0 * scale) * k) / k;
    if (scale === 1) g.drawImage(s.c, px, py, s.c.width / k, s.c.height / k);
    else g.drawImage(s.c, px, py, s.w * scale, s.h * scale);
  }

  buildSprites() {
    const th = this.theme;
    const A = this.arena;
    const sc = this.scene;
    const spr = (this.spr = { portals: [], box: null, tramps: [], marker: null });
    this.labels.clear();
    A.portals.forEach((po, i) => {
      spr.portals.push(
        this.makeSprite(-46, -56, 92, 112, (g) => th.portal(g, { ...po, x: -po.w / 2, y: -po.h / 2, cx: 0, cy: 0 }, 0, i, sc)),
      );
    });
    spr.box = this.makeSprite(-34, -34, 68, 68, (g) => th.pickup(g, 'box', 0, 0, 0, sc));
    A.tramps.forEach((tr) => {
      spr.tramps.push(this.makeSprite(-10, -34, tr.w + 20, tr.h + 42, (g) => th.trampoline(g, { ...tr, x: 0, y: 0, cx: tr.w / 2 }, 0, 0, sc)));
    });
    // the IT sign keeps a readable size however far the view is pulled back
    this.markK = this.theme.pixel ? 1 : clamp(0.8 / this.kCss, 1, 1.5);
    spr.marker = this.makeSprite(-44, -60, 88, 78, (g) => th.marker(g, 0, 0, 0, { color: th.colors[0], slot: 0 }, sc), this.markK);
  }

  // --- effects API (used by the art styles and by the game) ------------------------
  emit(p) {
    if (this.parts.length > (this.level ? 160 : 320)) return;
    this.parts.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0.5, size: 3, grow: 0, color: '#fff', shape: 'circle', rot: 0, vr: 0, alpha: 1, back: false, ...p, age: 0 });
  }

  shake(amount) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  flash(color, alpha) {
    const el = this.flashEl;
    if (!el) return;
    el.style.background = color;
    el.style.setProperty('--a', String(Math.min(0.5, alpha * 1.6)));
    el.classList.remove('go');
    void el.offsetWidth; // restart the fade
    el.classList.add('go');
  }

  tagFx(fromSlot, toSlot) {
    const to = this.last[toSlot];
    const from = this.last[fromSlot];
    if (!to || !this.theme) return;
    this.shake(to.local || (from && from.local) ? 9 : 5);
    this.theme.fx?.tag?.(this, to, from || to);
  }

  blockFx(fromSlot, toSlot) {
    const to = this.last[toSlot];
    if (!to) return;
    this.shake(5);
    const col = KIND_COLORS.shield;
    this.emit({ x: to.cx, y: to.y + 20, life: 0.4, size: 20, grow: 160, shape: 'ring', width: 4, color: col });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.283;
      this.emit({ x: to.cx + Math.cos(a) * 24, y: to.y + 20 + Math.sin(a) * 26, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, drag: 4, life: 0.4, size: 3, color: i % 2 ? col : '#ffffff' });
    }
  }

  // someone opened a lucky box
  pickFx(slot) {
    const pv = this.last[slot];
    if (!pv) return;
    const col = KIND_COLORS.box;
    this.emit({ x: pv.cx, y: pv.y + 20, life: 0.45, size: 10, grow: 120, shape: 'ring', width: 3, color: col });
    for (let i = 0; i < 8; i++) {
      this.emit({ x: pv.cx + (Math.random() - 0.5) * 30, y: pv.y + 30 - Math.random() * 30, vx: (Math.random() - 0.5) * 80, vy: -90 - Math.random() * 120, g: 120, life: 0.6, size: 2.5, color: i % 3 ? col : '#ffffff' });
    }
  }

  // an item going off: e = { slot, x, y, to }
  itemFx(e, kind) {
    const col = KIND_COLORS[kind] || '#ffffff';
    const pv = this.last[e.slot];
    if (kind === 'blast') {
      // a shockwave across the whole screen
      this.flash(col, 0.3);
      this.shake(13);
      for (let i = 0; i < 3; i++) this.emit({ x: e.x, y: e.y, life: 0.55 + i * 0.12, size: 20, grow: BLAST_RADIUS * (1.9 - i * 0.35), shape: 'ring', width: 9 - i * 2.5, color: i ? '#ffffff' : col });
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * 6.283;
        this.emit({ x: e.x, y: e.y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, drag: 2.2, life: 0.6, size: 4, color: i % 2 ? col : '#ffe9a8' });
      }
    } else if (kind === 'storm') {
      this.flash('#3a2360', 0.34);
      this.shake(5);
      // a bolt down onto everyone it slows
      for (const o of this.last) {
        if (!o || o.id === e.slot) continue;
        this.emit({ x: o.cx, y: o.y - 6, life: 0.35, fade: false, draw: (g, p, k) => {
          g.globalAlpha = k;
          g.strokeStyle = col;
          g.lineWidth = 4;
          g.lineJoin = 'miter';
          g.beginPath();
          g.moveTo(p.x - 14, p.y - 150);
          g.lineTo(p.x + 8, p.y - 90);
          g.lineTo(p.x - 8, p.y - 70);
          g.lineTo(p.x, p.y);
          g.stroke();
        } });
      }
    } else if (kind === 'freeze') {
      this.flash('#c8f1ff', 0.26);
      if (pv) this.emit({ x: pv.cx, y: pv.y + 20, life: 0.5, size: 20, grow: 700, shape: 'ring', width: 5, color: col });
    } else if (kind === 'swap') {
      const o = this.last[e.to];
      if (pv) this.portalFx(pv.cx, pv.y + PH / 2, pv);
      if (o) this.portalFx(o.cx, o.y + PH / 2, o);
    } else {
      this.emit({ x: e.x, y: e.y, life: 0.4, size: 12, grow: 150, shape: 'ring', width: 4, color: col });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.283;
        this.emit({ x: e.x, y: e.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200 - 60, g: 400, drag: 2, life: 0.4, size: 3, color: i % 2 ? col : '#ffffff' });
      }
    }
  }

  // someone stepped in goo
  slipFx(e) {
    for (let i = 0; i < 12; i++) this.emit({ x: e.x + (Math.random() - 0.5) * 30, y: e.y - 4, vx: (Math.random() - 0.5) * 260, vy: -120 - Math.random() * 200, g: 900, life: 0.5, size: 2.5 + Math.random() * 2.5, color: KIND_COLORS.goo });
  }

  // the bomb went off
  boomFx(e) {
    this.flash('#ff6a2b', 0.34);
    this.shake(14);
    for (let i = 0; i < 3; i++) this.emit({ x: e.x, y: e.y, life: 0.5 + i * 0.1, size: 16, grow: 620 - i * 150, shape: 'ring', width: 10 - i * 3, color: i === 1 ? '#ffffff' : '#ff7a2b' });
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * 6.283;
      const v = 200 + Math.random() * 600;
      this.emit({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 700, drag: 1.6, life: 0.5 + Math.random() * 0.4, size: 3 + Math.random() * 4, color: i % 3 === 0 ? '#3a2a22' : i % 3 === 1 ? '#ffb347' : '#ff5a2b' });
    }
  }

  // Text is drawn once into a small canvas and reused.
  label(text, color, font) {
    const key = `${text}|${color}|${font || ''}`;
    let hit = this.labels.get(key);
    if (hit) return hit;
    const lab = this.theme.label;
    const px = Math.round((this.theme.pixel ? 8 : LABEL_PX) * this.s * this.q * (font ? 1.1 : 1));
    const f = (font || lab.font).replace(/\d+(\.\d+)?px/, `${px}px`);
    const m = this.sx;
    m.font = f;
    const w = Math.ceil(m.measureText(text).width) + 10;
    const h = Math.ceil(px * 1.5) + 4;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.font = f;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, (lab.strokeWidth || 3) * this.s * this.q * 0.8);
    g.strokeStyle = lab.stroke || 'rgba(0,0,0,.6)';
    g.strokeText(text, w / 2, h - 5 - px * 0.2);
    g.fillStyle = color;
    g.fillText(text, w / 2, h - 5 - px * 0.2);
    hit = { c, w, h };
    this.labels.set(key, hit);
    return hit;
  }

  // --- one frame ---------------------------------------------------------------------
  draw(view, nowMs) {
    const g = this.fgx;
    const th = this.theme;
    const t = nowMs / 1000;
    const raw = t - this.lastT;
    const dt = clamp(raw, 0, 0.1);
    this.lastT = t;
    if (!th || !this.scene) return;
    this.govern(raw);

    const pvs = this.updatePlayers(view, t, dt);
    this.updateCamera(view, pvs, dt);
    const cam = this.cam;
    const z = this.follow ? cam.z : 1; // how far the view is pulled back right now (1 = play zoom)
    const kf = (this.kz = this.kf * z);
    const tx = -cam.x * kf;
    const ty = -cam.y * kf;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.fg.width, this.fg.height);
    g.imageSmoothingEnabled = true;

    // ambient animation (petals, rain, twinkling stars...) on the art board
    if (th.live && this.level === 0) {
      const a = this.art;
      g.setTransform(a.s * this.q * z, 0, 0, a.s * this.q * z, (a.x - this.ox) * this.q * z + tx, (a.y - this.oy) * this.q * z + ty);
      g.save();
      th.live(g, this.scene, t, view, pvs);
      g.restore();
      g.globalAlpha = 1;
    }

    g.setTransform(kf, 0, 0, kf, tx, ty);
    this.drawWorld(g, view, pvs, t, dt);

    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawLabels(g, view, pvs, t);

    // screen shake moves the whole stage; the browser does that without repainting
    if (this.stage) {
      this.shakeAmt *= Math.exp(-dt * 10);
      if (this.shakeAmt > 0.4) {
        const sx = (Math.random() * 2 - 1) * this.shakeAmt;
        const sy = (Math.random() * 2 - 1) * this.shakeAmt;
        this.stage.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
        this.shaking = true;
      } else if (this.shaking) {
        this.stage.style.transform = '';
        this.shaking = false;
        this.shakeAmt = 0;
      }
    }
  }

  // Frame-rate governor: if frames keep taking too long, give up detail.
  govern(raw) {
    if (!this.stage || raw <= 0 || raw > 0.25) return; // tab was hidden, or first frame
    this.frameMs += (raw * 1000 - this.frameMs) * 0.05;
    if (this.frameMs > 24 && this.level < 2) {
      if (++this.slow > 90) {
        this.slow = 0;
        this.level++;
        this.frameMs = 16;
        if (this.level === 2) {
          this.q = 0.6;
          this.layout(true);
        }
      }
    } else if (this.slow > 0) this.slow--;
  }

  updateCamera(view, pvs, dt) {
    if (!this.follow) return;
    const A = this.arena;
    const cam = this.cam;
    // Zoom: the whole arena while a round is being introduced and once it is
    // over; close in on you for the match itself.
    let zt = 1;
    if (!this.opts.zoom && (view.phase === 'over' || (view.phase === 'countdown' && (view.countdownMs ?? 0) > 1800))) zt = this.zFit;
    if (!cam.set) cam.z = zt;
    else {
      cam.z += (zt - cam.z) * (1 - Math.exp(-dt * (zt > cam.z ? 3.4 : 2)));
      if (Math.abs(cam.z - zt) < 0.002) cam.z = zt;
    }
    const z = cam.z;
    const vw = this.cssW / (this.kCss * z); // world units on screen right now
    const vh = this.cssH / (this.kCss * z);
    let cx = A.w / 2;
    let cy = A.h / 2;
    if (this.opts.focus) {
      cx = this.opts.focus.x;
      cy = this.opts.focus.y;
    } else {
      const me = pvs.find((p) => p.local) || pvs.find((p) => p.isIt) || pvs[0];
      if (me) {
        cx = me.cx + clamp(me.vx * 0.3, -110, 110); // look a little ahead
        cy = me.y + PH / 2 - vh * 0.04;
        // lean towards whoever is it, without ever losing sight of yourself
        const it = pvs.find((p) => p.isIt);
        if (it && it !== me) {
          cx += clamp((it.cx - me.cx) * 0.35, -vw * 0.2, vw * 0.2);
          cy += clamp((it.y - me.y) * 0.35, -vh * 0.18, vh * 0.18);
        }
      }
    }
    const tx = vw >= A.w ? (A.w - vw) / 2 : clamp(cx - vw / 2, 0, A.w - vw);
    const ty = vh >= A.h + this.padB ? (A.h - vh) / 2 : clamp(cy - vh / 2, 0, A.h + this.padB - vh);
    if (!cam.set) {
      cam.fx = tx;
      cam.fy = ty;
      cam.set = true;
    } else {
      const k = 1 - Math.exp(-dt * (z === 1 ? 6 : 9));
      cam.fx += (tx - cam.fx) * k;
      cam.fy += (ty - cam.fy) * k;
    }
    // whole background pixels (once the zoom has settled), so the two layers never shimmer against each other
    cam.x = z === 1 ? Math.round(cam.fx * this.kDev) / this.kDev : cam.fx;
    cam.y = z === 1 ? Math.round(cam.fy * this.kDev) / this.kDev : cam.fy;
    if (this.stage) this.bg.style.transform = `translate3d(${(-cam.x * this.kCss * z).toFixed(2)}px,${(-cam.y * this.kCss * z).toFixed(2)}px,0) scale(${z.toFixed(4)})`;
  }

  // What the view is showing, in world units (for the minimap).
  viewRect() {
    if (!this.follow || !this.cam.set) return null;
    const z = this.cam.z;
    return { x: this.cam.x, y: this.cam.y, w: this.cssW / (this.kCss * z), h: this.cssH / (this.kCss * z) };
  }

  drawWorld(g, view, pvs, t, dt) {
    const th = this.theme;
    const A = this.arena;
    const spr = this.spr;

    // updrafts: streaks of air rushing up the column
    const U = th.pixel;
    if (A.lifts.length) {
      g.strokeStyle = g.fillStyle = rgba(th.lift || '#ffffff', 0.55);
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      A.lifts.forEach((z, zi) => {
        const n = Math.max(4, Math.round(z.h / 60));
        if (!U) g.beginPath();
        for (let i = 0; i < n; i++) {
          const f = (t * (0.45 + 0.25 * hash1(i, zi + 7)) + hash1(i, zi)) % 1;
          const x = z.x + 8 + (z.w - 16) * hash1(i, zi + 3);
          const y = z.y + z.h * (1 - f);
          const len = 14 + 22 * Math.sin(f * Math.PI);
          if (U) g.fillRect(Math.round(x / U) * U, Math.round((y - len) / U) * U, U, Math.round(len / U) * U);
          else {
            g.moveTo(x, y);
            g.lineTo(x, y - len);
          }
        }
        if (!U) g.stroke();
      });
    }

    // portals: the pre-rendered ring, breathing a little, with sparks circling it
    A.portals.forEach((po, i) => {
      const col = PORTAL_COLORS[po.pair % PORTAL_COLORS.length];
      this.blit(g, spr.portals[i], po.cx, po.cy, 1 + 0.035 * Math.sin(t * 3 + i));
      g.fillStyle = col;
      for (let k = 0; k < 3; k++) {
        const a = t * 2.4 + i * 1.3 + (k * 6.283) / 3;
        const r = U ? U : 2.2 + 0.8 * Math.sin(t * 5 + k);
        const sx = po.cx + Math.cos(a) * 21 - r / 2;
        const sy = po.cy + Math.sin(a) * 35 - r / 2;
        if (U) g.fillRect(Math.round(sx / U) * U, Math.round(sy / U) * U, r, r);
        else g.fillRect(sx, sy, r, r);
      }
    });

    // trampolines: a sprite at rest, drawn live only while they wobble
    A.tramps.forEach((tr, i) => {
      const age = t - this.trampT[i];
      if (age < 0.5) {
        const k = Math.exp(-age * 9) * Math.cos(age * 30);
        g.save();
        th.trampoline(g, tr, t, k * k, this.scene);
        g.restore();
      } else this.blit(g, spr.tramps[i], tr.x, tr.y);
    });

    // lucky boxes
    for (const point of view.boxes || []) {
      const pt = A.pickups[point];
      if (pt) this.blit(g, spr.box, pt.x, pt.y + Math.sin(t * 3 + point) * 3);
    }
    // puddles of goo
    if (view.goo && view.goo.length) {
      for (const [x, y] of view.goo) {
        g.fillStyle = '#4fae36';
        g.beginPath();
        g.ellipse(x, y - 3, 26, 6.5, 0, 0, 6.283);
        g.fill();
        g.fillStyle = '#9be26f';
        g.beginPath();
        g.ellipse(x - 6, y - 5, 9, 2.4, 0, 0, 6.283);
        g.fill();
      }
    }
    // team battle: each side's base, and its flag (at home, or on the back of whoever took it)
    if (view.team) {
      view.team.flags.forEach((f, team) => {
        const home = A.bases[team];
        const col = TEAM_COLORS[team];
        g.fillStyle = '#201408';
        g.fillRect(home[0] - 22, home[1] - 5, 44, 5);
        g.fillStyle = col;
        g.fillRect(home[0] - 19, home[1] - 4, 38, 3);
        let x = home[0];
        let y = home[1];
        const c = f.carrier >= 0 ? pvs.find((p) => p.id === f.carrier) : null;
        if (c) {
          x = c.cx - c.face * 12;
          y = c.y + 6;
        }
        const wave = Math.sin(t * 6 + team) * 3;
        g.strokeStyle = '#201408';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y - 46);
        g.stroke();
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(x + 1, y - 46);
        g.lineTo(x + 27, y - 39 + wave);
        g.lineTo(x + 1, y - 29);
        g.closePath();
        g.fill();
        g.lineWidth = 1.6;
        g.stroke();
      });
    }

    this.drawParticles(g, dt, true);
    for (const pv of pvs) {
      if (pv.orb) this.drawOrb(g, pv, t);
      else this.drawPlayer(g, pv, t);
    }
    this.drawParticles(g, 0, false);
    g.globalAlpha = 1;
  }

  // --- players -------------------------------------------------------------------------
  updatePlayers(view, t, dt) {
    const th = this.theme;
    const out = [];
    const seen = new Array(MAX_PLAYERS).fill(false);
    for (const p of view.players) {
      seen[p.slot] = true;
      let a = this.anim[p.slot];
      if (!a || a.gen !== this.gen) {
        a = this.anim[p.slot] = { gen: this.gen, run: 0, squash: 0, ground: p.ground, vy: p.vy, x: p.x, y: p.y, dead: p.dead > 0, orb: false, step: 0, blink: 0, nextBlink: t + 1 + Math.random() * 3, streak: 0 };
      }
      // Which of the style's player colours this player wears. Styles keep
      // per-colour sprites, so to them the colour IS the slot; `id` is the real one.
      const col = (p.col ?? (this.cols ? this.cols[p.slot] : p.slot)) % th.colors.length;
      const pv = {
        slot: col,
        id: p.slot,
        name: p.name,
        color: th.colors[col],
        x: p.x,
        y: p.y,
        cx: p.x + PW / 2,
        feet: p.y + PH,
        vx: p.vx,
        vy: p.vy,
        ground: p.ground,
        face: p.face,
        isIt: view.it === p.slot,
        immune: p.immune > 0,
        stunned: p.stun > 0,
        frozen: !!p.frz,
        orb: !!p.orb,
        canDrop: !!p.canDrop,
        speedy: !!p.spd,
        springy: !!p.jmp,
        shield: !!p.shd,
        slow: !!p.slw,
        team: p.team ?? -1,
        local: !!p.local,
        itTicks: p.itTicks,
        run: a.run,
        squash: a.squash,
        blink: a.blink,
        seed: col * 17 + 3,
      };
      if (p.dead > 0) {
        if (!a.dead) {
          a.dead = true;
          const lastPv = this.last[p.slot];
          if (lastPv) this.onEvent?.('fall', lastPv);
        }
        this.last[p.slot] = null;
        continue;
      }
      if (a.dead) {
        a.dead = false;
        a.ground = false;
        th.fx?.respawn?.(this, pv);
        this.onEvent?.('respawn', pv);
      } else if (pv.orb !== a.orb) {
        // into a portal, or out of one
        this.portalFx(pv.cx, pv.y + PH / 2, pv);
        if (pv.orb) this.onEvent?.('portal', pv);
      } else if (pv.orb) {
        // a trail of sparks behind the orb
        if (this.level < 2 || Math.random() < 0.5) {
          this.emit({ x: pv.cx + (Math.random() - 0.5) * 10, y: pv.y + PH / 2 + (Math.random() - 0.5) * 10, life: 0.32, size: 2.4 + Math.random() * 2, grow: -6, color: Math.random() < 0.4 ? '#ffffff' : pv.color, back: true });
        }
      } else if (!p.ground && p.vy < -1150 && a.vy > -1000) {
        this.bounceFx(pv, t); // launched by a trampoline
        this.onEvent?.('bounce', pv);
      } else if (a.ground && !p.ground && p.vy < -300) {
        a.squash = -0.2;
        th.fx?.jump?.(this, pv);
        this.onEvent?.('jump', pv);
      } else if (!a.ground && !p.ground && p.vy < -500 && p.vy - a.vy < -260) {
        a.squash = -0.16; // double jump
        this.emit({ x: pv.cx, y: pv.feet, life: 0.3, size: 6, grow: 70, shape: 'ring', width: 2.5, color: pv.color, back: true });
        th.fx?.jump?.(this, pv);
        this.onEvent?.('airjump', pv);
      } else if (!a.ground && p.ground) {
        const impact = clamp(a.vy / 800, 0.1, 1);
        a.squash = 0.1 + 0.2 * impact;
        if (a.vy > 120) {
          th.fx?.land?.(this, pv, impact);
          this.onEvent?.('land', pv);
        }
      }
      a.orb = pv.orb;
      a.ground = p.ground;
      a.vy = p.vy;
      a.x = p.x;
      a.y = p.y;
      a.squash *= Math.exp(-dt * 12);
      if (Math.abs(a.squash) < 0.004) a.squash = 0;
      const speed = Math.abs(p.vx);
      if (p.ground && speed > 30) {
        a.run += speed * dt * 0.08;
        a.step += speed * dt;
        if (a.step > 40) {
          a.step = 0;
          if (this.level < 2) th.fx?.step?.(this, pv);
        }
      }
      if (t > a.nextBlink) {
        a.blink = 1;
        a.nextBlink = t + 1.5 + Math.random() * 4;
      }
      a.blink = Math.max(0, a.blink - dt * 7);
      pv.run = a.run;
      pv.squash = a.squash;
      pv.blink = a.blink;
      if (!pv.orb) {
        // speed lines behind anyone running on Swift, sparkles under Spring
        if (pv.speedy && speed > 200 && t - a.streak > 0.05) {
          a.streak = t;
          this.emit({ x: pv.cx - pv.face * 10, y: pv.y + 6 + Math.random() * 28, vx: -pv.vx * 0.15, life: 0.16, size: 1.6, shape: 'line', width: 2, color: KIND_COLORS.speed, back: true, lx: -pv.face * 18 });
        }
        if (pv.springy && p.ground && Math.random() < dt * 8) {
          this.emit({ x: pv.cx + (Math.random() - 0.5) * 24, y: pv.feet - 2, vy: -70, life: 0.4, size: 2, color: KIND_COLORS.jump, back: true });
        }
        if (this.level < 2) th.fx?.trail?.(this, pv, dt, t);
      }
      this.last[p.slot] = pv;
      out.push(pv);
    }
    for (let i = 0; i < MAX_PLAYERS; i++) if (!seen[i]) this.last[i] = null;
    // local player on top, whoever is "it" just below that
    out.sort((a, b) => (a.local ? 2 : a.isIt ? 1 : 0) - (b.local ? 2 : b.isIt ? 1 : 0));
    return out;
  }

  bounceFx(pv, t) {
    let best = -1;
    let bestD = 120;
    this.arena.tramps.forEach((tr, i) => {
      const d = Math.abs(tr.cx - pv.cx) + Math.abs(tr.y - pv.feet) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) this.trampT[best] = t;
    const y = best >= 0 ? this.arena.tramps[best].y : pv.feet;
    this.emit({ x: pv.cx, y, life: 0.35, size: 8, grow: 150, shape: 'ring', width: 3, color: '#ffffff' });
    for (let i = 0; i < 6; i++) this.emit({ x: pv.cx + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 200, vy: -100 - Math.random() * 200, g: 500, life: 0.4, size: 2.4, color: i % 2 ? pv.color : '#ffffff' });
  }

  portalFx(x, y, pv) {
    this.emit({ x, y, life: 0.4, size: 30, grow: -60, shape: 'ring', width: 3, color: pv.color });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.283;
      this.emit({ x: x + Math.cos(a) * 12, y: y + Math.sin(a) * 12, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, drag: 3, life: 0.35, size: 2.4, color: i % 2 ? pv.color : '#ffffff' });
    }
  }

  // Travelling between portals: a bright ball of light with sparks circling it.
  drawOrb(g, pv, t) {
    const x = pv.cx;
    const y = pv.y + PH / 2;
    g.globalAlpha = 0.35;
    g.fillStyle = pv.color;
    g.beginPath();
    g.arc(x, y, 15, 0, 6.283);
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(x, y, 10, 0, 6.283);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x, y, 5.5, 0, 6.283);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = t * 9 + (i * 6.283) / 4;
      const r = 17 + 3 * Math.sin(t * 13 + i * 2);
      const sx = x + Math.cos(a) * r;
      const sy = y + Math.sin(a) * r;
      g.moveTo(sx - 3, sy);
      g.lineTo(sx + 3, sy);
      g.moveTo(sx, sy - 3);
      g.lineTo(sx, sy + 3);
    }
    g.stroke();
  }

  drawPlayer(g, pv, t) {
    const th = this.theme;
    const U = th.pixel;
    // tag protection: flash between solid and see-through
    const a = pv.immune ? (Math.floor(t * 14) % 2 ? 0.45 : 0.95) : 1;
    if (U) {
      // pixel-art styles: draw at one canvas pixel per art pixel, then blow it up
      const sg = this.sx;
      const bx = Math.floor((pv.x - 30) / U) * U;
      const by = Math.floor((pv.y - 34) / U) * U;
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, this.scratch.width, this.scratch.height);
      sg.setTransform(1 / U, 0, 0, 1 / U, -bx / U, -by / U);
      sg.save();
      th.player(sg, pv, t, this.scene);
      sg.restore();
      g.globalAlpha = a;
      const big = this.pxN > 1 ? (this.scratch2 = this.crisp(this.scratch, this.pxN, this.scratch2)) : this.scratch;
      g.drawImage(big, bx, by, this.scratch.width * U, this.scratch.height * U);
      g.globalAlpha = 1;
    } else {
      g.save();
      g.globalAlpha = a;
      th.player(g, pv, t, this.scene);
      g.restore();
    }
    if (pv.frozen) {
      // block of ice
      g.fillStyle = 'rgba(170,235,255,.55)';
      g.strokeStyle = 'rgba(235,252,255,.95)';
      g.lineWidth = 2;
      if (U) g.fillRect(pv.x - 4, pv.y - 4, PW + 8, PH + 6);
      else {
        rr(g, pv.x - 5, pv.y - 6, PW + 10, PH + 8, 7);
        g.fill();
        g.stroke();
      }
    }
    if (pv.slow) {
      // caught in a storm: a little cloud that rains on you
      const cx = pv.cx;
      const y = pv.y - 16;
      g.fillStyle = '#5b3d8a';
      g.beginPath();
      g.arc(cx - 8, y, 7, 0, 6.283);
      g.arc(cx + 1, y - 3, 9, 0, 6.283);
      g.arc(cx + 10, y, 6, 0, 6.283);
      g.fill();
      g.fillStyle = '#ffe14d';
      for (let i = 0; i < 3; i++) g.fillRect(cx - 9 + i * 8, y + 6 + ((t * 40 + i * 5) % 10), 2, 4);
    }
    if (pv.shield) {
      const pulse = 1 + 0.05 * Math.sin(t * 7);
      g.strokeStyle = KIND_COLORS.shield;
      g.lineWidth = 2.5;
      g.beginPath();
      g.ellipse(pv.cx, pv.y + 19, 27 * pulse, 30 * pulse, 0, 0, 6.283);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(pv.cx, pv.y + 19, 27 * pulse, 30 * pulse, 0, -2.4 + t * 2, -1.5 + t * 2);
      g.stroke();
    }
  }

  drawParticles(g, dt, back) {
    const parts = this.parts;
    if (dt > 0) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) {
          parts[i] = parts[parts.length - 1];
          parts.pop();
          continue;
        }
        p.vy += p.g * dt;
        if (p.drag) {
          const d = Math.exp(-p.drag * dt);
          p.vx *= d;
          p.vy *= d;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.size += p.grow * dt;
      }
    }
    const px = this.theme.pixel;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.back !== back) continue;
      const k = 1 - p.age / p.life;
      const size = Math.max(0.1, p.size);
      g.globalAlpha = clamp(p.alpha * (p.fade === false ? 1 : k), 0, 1);
      if (p.draw) {
        p.draw(g, p, k);
        continue;
      }
      g.fillStyle = p.color;
      g.strokeStyle = p.color;
      if (p.shape === 'line') {
        g.lineWidth = p.width || 1.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x, p.y);
        if (p.lx != null) g.lineTo(p.x + p.lx, p.y);
        else g.lineTo(p.x - p.vx * 0.03 * size, p.y - p.vy * 0.03 * size);
        g.stroke();
      } else if (p.shape === 'ring') {
        g.lineWidth = p.width || 2;
        g.beginPath();
        g.arc(p.x, p.y, size, 0, 6.283);
        g.stroke();
      } else if (px) {
        const q = Math.max(px, Math.round(size / px) * px);
        g.fillRect(Math.round(p.x / px) * px, Math.round(p.y / px) * px, q, q);
      } else if (p.shape === 'square') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillRect(-size / 2, -size / 2, size, size);
        g.restore();
      } else if (size < 2.2) {
        g.fillRect(p.x - size, p.y - size, size * 2, size * 2); // too small to tell from a dot
      } else {
        g.beginPath();
        g.arc(p.x, p.y, size, 0, 6.283);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // Names and the IT sign, at a fixed size on screen. Also the pointer to "it"
  // when the view follows you and they are out of sight.
  drawLabels(g, view, pvs, t) {
    const th = this.theme;
    const lab = th.label;
    const kf = this.kz || this.kf;
    const cam = this.cam;
    const px = this.s * this.q; // canvas pixels per CSS pixel
    // "this one is you": while the round is introduced and for its first seconds
    const pointYou = view.phase === 'countdown' || (view.goAge != null && view.goAge < 3);
    for (const pv of pvs) {
      const sx = Math.round((pv.cx - cam.x) * kf);
      if (sx < -20 * px || sx > this.fg.width + 20 * px) continue; // out of sight
      let top = Math.round((pv.y - cam.y) * kf - (pv.orb ? 6 : (lab.gap || 7)) * px);
      if (view.names !== false && pv.name) {
        const l = this.label(pv.name, pv.local ? lab.you || lab.color : lab.color);
        g.drawImage(l.c, clamp(sx - (l.w >> 1), 0, this.fg.width - l.w), top - l.h + 4); // names stay on screen at the edges
        top -= l.h - 6;
      }
      if (pv.isIt && view.phase !== 'countdown') {
        const bob = Math.round(Math.sin(t * 5) * 2 * px);
        if (view.team) {
          // the bomb: its spark flickers faster as the fuse runs down
          const y = top - 14 * px + bob;
          const hot = view.team.fuse < 240;
          g.fillStyle = hot && Math.floor(t * 10) % 2 ? '#ff4d3d' : '#16110d';
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2 * px;
          g.beginPath();
          g.arc(sx, y, 10 * px, 0, 6.283);
          g.fill();
          g.stroke();
          g.strokeStyle = '#16110d';
          g.lineWidth = 3 * px;
          g.beginPath();
          g.moveTo(sx + 6 * px, y - 8 * px);
          g.lineTo(sx + 11 * px, y - 14 * px);
          g.stroke();
          g.fillStyle = Math.floor(t * (hot ? 16 : 8)) % 2 ? '#ffd23f' : '#ff7a2b';
          g.beginPath();
          g.arc(sx + 12 * px, y - 15 * px, 3.5 * px, 0, 6.283);
          g.fill();
          top -= 26 * px;
        } else {
          const m = this.spr.marker;
          const k = this.markK * this.kf;
          g.drawImage(m.c, Math.round(sx + m.x0 * k), Math.round(top - 14 * px + bob + m.y0 * k), m.w * k, m.h * k);
          top -= 34 * px * this.markK;
        }
      }
      if (pv.local && pv.orb && pv.canDrop) {
        // flying through a portal that lets you go early
        const l = this.label(this.opts.padBottom ? 'JUMP: let go' : 'SPACE: let go', '#ffffff', lab.font);
        g.drawImage(l.c, clamp(sx - (l.w >> 1), 0, this.fg.width - l.w), top - l.h - 18 * px);
      }
      if (pv.local && pointYou) {
        // a bouncing pointer and a ring, so you can find yourself at a glance
        const y = top - (16 + Math.abs(Math.sin(t * 5)) * 12) * px;
        const l = this.label('YOU', '#ffffff', lab.font);
        g.drawImage(l.c, sx - (l.w >> 1), y - l.h - 10 * px);
        g.fillStyle = '#ffffff';
        g.strokeStyle = 'rgba(0,0,0,.7)';
        g.lineWidth = 2.5 * px;
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(sx - 11 * px, y - 12 * px);
        g.lineTo(sx + 11 * px, y - 12 * px);
        g.lineTo(sx, y + 2 * px);
        g.closePath();
        g.stroke();
        g.fill();
        const cy = (pv.y + PH / 2 - cam.y) * kf;
        g.strokeStyle = `rgba(255,255,255,${0.9 - ((t * 1.2) % 1) * 0.9})`;
        g.lineWidth = 3 * px;
        g.beginPath();
        g.arc(sx, cy, (26 + ((t * 1.2) % 1) * 34) * px, 0, 6.283);
        g.stroke();
      }
    }
    if (!this.follow) return;
    const it = pvs.find((p) => p.isIt);
    const w = this.fg.width;
    const h = this.fg.height;
    if (!it || it.local) return;
    const ix = (it.cx - cam.x) * kf;
    const iy = (it.y + PH / 2 - cam.y) * kf;
    if (ix > 0 && ix < w && iy > 0 && iy < h) return;
    const m = 26 * px;
    const ax = clamp(ix, m, w - m);
    const ay = clamp(iy, m, h - m);
    const ang = Math.atan2(iy - ay, ix - ax);
    g.save();
    g.translate(ax, ay);
    g.rotate(ang);
    g.fillStyle = it.color;
    g.strokeStyle = lab.stroke || 'rgba(0,0,0,.6)';
    g.lineWidth = 3 * px;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(13 * px, 0);
    g.lineTo(-8 * px, -10 * px);
    g.lineTo(-8 * px, 10 * px);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }

  // Both layers flattened into one picture (for menu previews).
  snapshot() {
    const c = document.createElement('canvas');
    c.width = this.fg.width;
    c.height = this.fg.height;
    const g = c.getContext('2d');
    const k = this.q;
    g.fillStyle = this.theme.letterbox;
    g.fillRect(0, 0, c.width, c.height);
    const bx = this.follow ? -this.cam.x * this.kDev * k : 0;
    const by = this.follow ? -this.cam.y * this.kDev * k : 0;
    g.drawImage(this.bg, bx, by, this.bg.width * k, this.bg.height * k);
    g.drawImage(this.fg, 0, 0);
    return c;
  }
}
