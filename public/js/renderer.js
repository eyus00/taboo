// Draws a match. Everything that depends on the art style is delegated to a
// theme (see ./themes); this file owns the camera, layout, animation state,
// particles, labels, the minimap and the HUD.
//
// Three coordinate systems are used while drawing a frame:
//   world  - arena pixels; moves and zooms with the camera
//   art    - the theme's 800x500 backdrop board, scaled to cover the screen
//   screen - 540 units tall, as wide as the window; HUD and labels live here

import { VIEW_H, ZOOM_MIN, ZOOM_MAX, ART_W, ART_H, PW, PH, TICK_RATE, PICKUP_TYPES, PICKUP_INFO, DASH_COOLDOWN, DASH_TICKS, SPEED_BUFF_TICKS, JUMP_BUFF_TICKS, SHIELD_TICKS } from '/shared/config.js';
import { THEME_MAP } from './themes/index.js';
import { clamp, mulberry32, hashStr, rr, fitText, drawIcon, KIND_COLORS } from './util.js';

const MIN_ASPECT = 1.25;
const MAX_ASPECT = 2.4;
const SOLO_ZOOM = 0.78; // nobody else nearby

export class Renderer {
  // opts.size = [w, h] renders into an off-screen canvas of that many pixels (thumbnails)
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.fixed = opts.size || null;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.theme = null;
    this.arena = null;
    this.scene = null;
    this.sprites = [];
    this.gen = 0; // bumped whenever the scene changes, to reset per-player animation
    this.anim = [null, null, null, null];
    this.last = [null, null, null, null]; // last drawn view-model per slot
    this.parts = [];
    this.shakeAmt = 0;
    this.flashA = 0;
    this.flashColor = '#fff';
    this.lastT = 0;
    this.cam = { x: 0, y: 0, z: SOLO_ZOOM, ready: false, paired: false };
    this.trampT = [];
    this.onEvent = null; // (type, pv) -> used for sound
    this.lo = document.createElement('canvas'); // low-res buffer for pixel-art themes
    this.loCtx = this.lo.getContext('2d');
    this.resize();
  }

  resize() {
    let cw;
    let ch;
    if (this.fixed) [cw, ch] = this.fixed;
    else {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cw = Math.round(Math.max(1, this.canvas.clientWidth) * dpr);
      ch = Math.round(Math.max(1, this.canvas.clientHeight) * dpr);
    }
    this.canvas.width = cw;
    this.canvas.height = ch;
    const aspect = clamp(cw / ch, MIN_ASPECT, MAX_ASPECT);
    this.vw = Math.round(Math.min(cw, ch * aspect));
    this.vh = Math.round(Math.min(ch, cw / aspect));
    this.vx = Math.round((cw - this.vw) / 2);
    this.vy = Math.round((ch - this.vh) / 2);
    this.sK = this.vh / VIEW_H; // device pixels per screen unit
    this.SW = this.vw / this.sK;
    this.SH = VIEW_H;
    this.aK = Math.max(this.SW / ART_W, this.SH / ART_H) * 1.07; // backdrop slightly oversized, for parallax
    this.rebuild();
  }

  setScene(arena, themeId) {
    const theme = THEME_MAP[themeId] || THEME_MAP.ink;
    if (this.arena === arena && this.theme === theme) return;
    this.arena = arena;
    this.theme = theme;
    this.parts.length = 0;
    this.shakeAmt = 0;
    this.flashA = 0;
    this.cam.ready = false;
    this.trampT = arena.tramps.map(() => -10);
    this.rebuild();
  }

  rebuild() {
    if (!this.theme || !this.arena) return;
    const theme = this.theme;
    const artScale = clamp(this.sK * this.aK, 0.4, 2.5);
    const seed = hashStr(`${this.arena.id}/${theme.id}`);
    const env = {
      arena: this.arena,
      scale: artScale,
      rnd: mulberry32(seed),
      // Pre-render something static once; themes blit it every frame.
      layer: (draw, s = theme.pixel ? 1 / theme.pixel : artScale) => {
        const c = document.createElement('canvas');
        c.width = Math.ceil(ART_W * s);
        c.height = Math.ceil(ART_H * s);
        const g = c.getContext('2d');
        g.scale(s, s);
        draw(g);
        return c;
      },
    };
    this.scene = theme.build(env);

    // Every platform is painted once into its own little canvas.
    const pad = theme.platPad || { x: 8, top: 8, bottom: 8 };
    const ps = theme.pixel ? 1 / theme.pixel : clamp(this.sK * ZOOM_MAX, 0.5, 2);
    const variants = theme.platVariants || 1;
    this.sprites = this.arena.platforms.map((p, i) => {
      const wx = p.x - pad.x;
      const wy = p.y - pad.top;
      const ww = p.w + pad.x * 2;
      const wh = p.h + pad.top + pad.bottom;
      const frames = [];
      for (let v = 0; v < variants; v++) {
        const c = document.createElement('canvas');
        c.width = Math.ceil(ww * ps);
        c.height = Math.ceil(wh * ps);
        const g = c.getContext('2d');
        g.scale(ps, ps);
        g.translate(-wx, -wy);
        theme.platform(g, p, i, mulberry32(seed + i * 131 + v * 977), this.arena);
        frames.push(c);
      }
      return { p, wx, wy, ww, wh, frames };
    });

    if (theme.pixel) {
      this.lo.width = Math.ceil(this.SW / ZOOM_MIN / theme.pixel) + 4;
      this.lo.height = Math.ceil(this.SH / ZOOM_MIN / theme.pixel) + 4;
    }
    this.gen++;
  }

  // --- effects API used by themes -------------------------------------------------
  emit(p) {
    if (this.parts.length > 460) return;
    this.parts.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0.5, size: 3, grow: 0, color: '#fff', shape: 'circle', rot: 0, vr: 0, alpha: 1, back: false, ...p, age: 0 });
  }

  shake(amount) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  flash(color, alpha) {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, alpha);
  }

  // Called by the game when the server reports things.
  tagFx(fromSlot, toSlot) {
    const to = this.last[toSlot];
    const from = this.last[fromSlot];
    if (!to || !this.theme) return;
    this.shake(to.local || (from && from.local) ? 11 : 6);
    this.theme.fx?.tag?.(this, to, from || to);
  }

  blockFx(fromSlot, toSlot) {
    const to = this.last[toSlot];
    if (!to) return;
    this.shake(6);
    const col = KIND_COLORS.shield;
    this.emit({ x: to.cx, y: to.y + 20, life: 0.4, size: 20, grow: 160, shape: 'ring', width: 4, color: col });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * 6.283;
      this.emit({ x: to.cx + Math.cos(a) * 24, y: to.y + 20 + Math.sin(a) * 26, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, drag: 4, life: 0.4, size: 3, color: i % 2 ? col : '#ffffff' });
    }
  }

  pickFx(slot, kind) {
    const pv = this.last[slot];
    if (!pv) return;
    const col = KIND_COLORS[PICKUP_TYPES[kind]];
    this.emit({ x: pv.cx, y: pv.y + 20, life: 0.45, size: 10, grow: 120, shape: 'ring', width: 3, color: col });
    for (let i = 0; i < 12; i++) {
      this.emit({ x: pv.cx + (Math.random() - 0.5) * 30, y: pv.y + 30 - Math.random() * 30, vx: (Math.random() - 0.5) * 80, vy: -90 - Math.random() * 120, g: 120, life: 0.6, size: 2.5, color: i % 3 ? col : '#ffffff' });
    }
    // say what it was
    if (!this.theme.pixel) {
      const lab = this.theme.label;
      const word = `${PICKUP_INFO[PICKUP_TYPES[kind]].name}!`;
      this.emit({
        x: pv.cx,
        y: pv.y - 30,
        vy: -46,
        life: 1.1,
        draw(g, p, k) {
          g.globalAlpha = Math.min(1, k * 2.5);
          g.font = lab.youFont || lab.font;
          g.textAlign = 'center';
          g.lineJoin = 'round';
          g.lineWidth = 4;
          g.strokeStyle = lab.stroke || 'rgba(0,0,0,.6)';
          g.strokeText(word, p.x, p.y);
          g.fillStyle = col;
          g.fillText(word, p.x, p.y);
        },
      });
    }
  }

  // --- frame ----------------------------------------------------------------------
  draw(view, nowMs) {
    const ctx = this.ctx;
    const th = this.theme;
    const t = nowMs / 1000;
    const dt = clamp(t - this.lastT, 0, 0.1);
    this.lastT = t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (!th || !this.scene) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    const { vx, vy, vw, vh, sK, SW, SH } = this;
    const pvs = this.updatePlayers(view, t, dt);
    this.updateCamera(view, pvs, dt);
    const cam = this.cam;
    const z = cam.z;
    const wK = sK * z;

    this.shakeAmt *= Math.exp(-dt * 10);
    if (this.shakeAmt < 0.2) this.shakeAmt = 0;
    let shx = (Math.random() * 2 - 1) * this.shakeAmt * sK;
    let shy = (Math.random() * 2 - 1) * this.shakeAmt * sK;

    // where each player is on screen / on the backdrop board (themes use this for lighting)
    const artK = sK * this.aK;
    const mX = (ART_W * this.aK - SW) / 2;
    const mY = (ART_H * this.aK - SH) / 2;
    const parX = clamp((cam.x / this.arena.w - 0.5) * 2, -1, 1);
    const parY = clamp((cam.y / this.arena.h - 0.5) * 2, -1, 1);
    const artOX = -mX - parX * mX * 0.9; // in screen units
    const artOY = -mY - parY * mY * 0.9;
    for (const pv of pvs) {
      pv.sx = (pv.cx - cam.x) * z + SW / 2;
      pv.sy = (pv.y - cam.y) * z + SH / 2;
      pv.ax = (pv.sx - artOX) / this.aK;
      pv.ay = (pv.sy + 20 * z - artOY) / this.aK;
      pv.ak = z / this.aK;
    }
    const setArt = () => ctx.setTransform(artK, 0, 0, artK, vx + artOX * sK, vy + artOY * sK);

    ctx.fillStyle = th.letterbox;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx, vy, vw, vh);
    ctx.clip();

    // 1. backdrop
    setArt();
    if (th.pixel) ctx.imageSmoothingEnabled = false;
    th.back(ctx, this.scene, t, view, pvs);
    ctx.imageSmoothingEnabled = true;

    // 2. the world
    const halfW = SW / z / 2;
    const halfH = SH / z / 2;
    const vis = { x0: cam.x - halfW - 40, x1: cam.x + halfW + 40, y0: cam.y - halfH - 40, y1: cam.y + halfH + 40 };
    let g = ctx;
    let left = 0;
    let top = 0;
    let bw = 0;
    let bh = 0;
    if (th.pixel) {
      const U = th.pixel;
      g = this.loCtx;
      left = Math.floor((cam.x - halfW) / U) * U;
      top = Math.floor((cam.y - halfH) / U) * U;
      bw = Math.min(this.lo.width, Math.ceil((halfW * 2) / U) + 2);
      bh = Math.min(this.lo.height, Math.ceil((halfH * 2) / U) + 2);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, bw, bh);
      g.setTransform(1 / U, 0, 0, 1 / U, -left / U, -top / U);
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 1;
    } else {
      ctx.setTransform(wK, 0, 0, wK, vx + vw / 2 - cam.x * wK + shx, vy + vh / 2 - cam.y * wK + shy);
    }
    this.drawWorld(g, view, pvs, t, dt, vis);
    if (th.pixel) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const U = th.pixel;
      ctx.drawImage(this.lo, 0, 0, bw, bh, vx + vw / 2 + (left - cam.x) * wK + shx, vy + vh / 2 + (top - cam.y) * wK + shy, bw * U * wK, bh * U * wK);
      ctx.imageSmoothingEnabled = true;
    }

    // 3. weather, lighting, screen effects
    setArt();
    th.front(ctx, this.scene, t, view, pvs);

    // 4. screen space
    ctx.setTransform(sK, 0, 0, sK, vx, vy);
    if (this.flashA > 0.01) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, SW, SH);
      ctx.globalAlpha = 1;
      this.flashA *= Math.exp(-dt * 9);
    }
    const me = pvs.find((p) => p.local);
    if (view.hud && me && me.isIt && view.phase === 'playing') this.drawItVignette(ctx, t);
    ctx.setTransform(sK, 0, 0, sK, vx + shx, vy + shy);
    this.drawLabels(ctx, view, pvs, t);
    ctx.setTransform(sK, 0, 0, sK, vx, vy);
    if (view.hud) {
      this.drawArrows(ctx, view, pvs, t);
      this.drawHud(ctx, view, t, pvs);
    }
    this.drawOverlay(ctx, view, t);
    ctx.restore();
  }

  // Platforms, gadgets, players and particles - everything that lives in the arena.
  drawWorld(g, view, pvs, t, dt, vis) {
    const th = this.theme;
    const arena = this.arena;
    const frame = (th.platVariants || 1) > 1 ? Math.floor(t * 6) % th.platVariants : 0;
    const shown = [];
    for (const s of this.sprites) {
      if (s.wx > vis.x1 || s.wx + s.ww < vis.x0 || s.wy > vis.y1 || s.wy + s.wh < vis.y0) continue;
      g.drawImage(s.frames[frame], s.wx, s.wy, s.ww, s.wh);
      shown.push(s.p);
    }
    th.platformFx?.(g, this.scene, t, shown, arena);

    for (let i = 0; i < arena.portals.length; i++) {
      const p = arena.portals[i];
      if (p.x > vis.x1 || p.x + p.w < vis.x0 || p.y > vis.y1 || p.y + p.h < vis.y0) continue;
      g.save();
      th.portal(g, p, t, i);
      g.restore();
    }
    for (let i = 0; i < arena.tramps.length; i++) {
      const tr = arena.tramps[i];
      if (tr.x > vis.x1 || tr.x + tr.w < vis.x0 || tr.y > vis.y1 || tr.y + tr.h < vis.y0) continue;
      const k = clamp(1 - (t - this.trampT[i]) / 0.35, 0, 1);
      g.save();
      th.trampoline(g, tr, t, k * k);
      g.restore();
    }
    for (const pk of view.pickups || []) {
      const pt = arena.pickups[pk.point];
      if (!pt || pt.x < vis.x0 || pt.x > vis.x1 || pt.y < vis.y0 || pt.y > vis.y1) continue;
      g.save();
      th.pickup(g, PICKUP_TYPES[pk.type], pt.x, pt.y + Math.sin(t * 3 + pk.point) * 3, t);
      g.restore();
    }

    this.drawParticles(g, dt, true);
    for (const pv of pvs) this.drawPlayer(g, pv, t);
    this.drawParticles(g, 0, false);
  }

  // Follow the local player; when "it" (or, if you are it, your nearest target)
  // is close enough, frame both and zoom to fit. Otherwise stay on the local
  // player and let the edge arrows point the way.
  updateCamera(view, pvs, dt) {
    const a = this.arena;
    const cam = this.cam;
    const { SW, SH } = this;
    const me = pvs.find((p) => p.local) || null;
    const itp = pvs.find((p) => p.isIt) || null;
    const focus = me || itp || pvs[0] || null;
    let tx = cam.x;
    let ty = cam.y;
    let tz = cam.z;
    if (focus) {
      let other = null;
      if (!focus.isIt) other = itp;
      else {
        let best = Infinity;
        for (const p of pvs) {
          if (p === focus) continue;
          const d = Math.hypot(p.cx - focus.cx, p.y - focus.y);
          if (d < best) {
            best = d;
            other = p;
          }
        }
      }
      let paired = false;
      if (other) {
        const x0 = Math.min(focus.cx, other.cx) - 210;
        const x1 = Math.max(focus.cx, other.cx) + 210;
        const y0 = Math.min(focus.y, other.y) - 150;
        const y1 = Math.max(focus.feet, other.feet) + 130;
        const need = Math.min(SW / (x1 - x0), SH / (y1 - y0));
        // a little hysteresis so the camera does not flip-flop at the edge of range
        paired = need >= ZOOM_MIN * (cam.paired ? 0.9 : 1.04);
        if (paired) {
          tz = clamp(need, ZOOM_MIN, ZOOM_MAX);
          tx = (x0 + x1) / 2;
          ty = (y0 + y1) / 2;
        }
      }
      cam.paired = paired;
      if (!paired) {
        tz = SOLO_ZOOM;
        tx = focus.cx + clamp(focus.vx, -400, 400) * 0.25;
        ty = focus.y - 10;
        // dead zone: small moves and ordinary jumps do not drag the camera around
        if (cam.ready) {
          if (Math.abs(tx - cam.x) < 46 / tz) tx = cam.x;
          if (Math.abs(ty - cam.y) < 74 / tz) ty = cam.y;
        }
      }
      // whatever happens, the focus player stays comfortably on screen
      const mx = (SW / tz) * 0.34;
      const my = (SH / tz) * 0.3;
      tx = clamp(tx, focus.cx - mx, focus.cx + mx);
      ty = clamp(ty, focus.y + 20 - my, focus.y + 20 + my);
    } else if (!cam.ready) {
      tx = a.w / 2;
      ty = a.h / 2;
      tz = ZOOM_MIN;
    }
    if (!cam.ready) {
      cam.x = tx;
      cam.y = ty;
      cam.z = tz;
      cam.ready = true;
    } else {
      const far = Math.hypot(tx - cam.x, ty - cam.y) > 520;
      const kp = 1 - Math.exp(-dt * (far ? 11 : 5.5));
      cam.x += (tx - cam.x) * kp;
      cam.y += (ty - cam.y) * kp;
      cam.z += (tz - cam.z) * (1 - Math.exp(-dt * 3));
    }
    // stay inside the arena
    const hw = SW / cam.z / 2;
    const hh = SH / cam.z / 2;
    cam.x = a.w <= hw * 2 ? a.w / 2 : clamp(cam.x, hw, a.w - hw);
    cam.y = a.h + 90 <= hh * 2 ? a.h / 2 : clamp(cam.y, hh - 70, a.h - hh + 20);
    if (this.theme.pixel) {
      // keep the pixel grid steady
      cam.z = Math.round(cam.z * 50) / 50;
    }
  }

  // Turn raw player states into view-models, advance animation and spot
  // jump / land / bounce / dash / portal moments for effects and sound.
  updatePlayers(view, t, dt) {
    const th = this.theme;
    const out = [];
    const seen = [false, false, false, false];
    for (const p of view.players) {
      seen[p.slot] = true;
      let a = this.anim[p.slot];
      if (!a || a.gen !== this.gen) {
        a = this.anim[p.slot] = { gen: this.gen, run: 0, squash: 0, ground: p.ground, vy: p.vy, x: p.x, y: p.y, dead: p.dead > 0, dash: false, step: 0, blink: 0, nextBlink: t + 1 + Math.random() * 3, streak: 0 };
      }
      const pv = {
        slot: p.slot,
        name: p.name,
        color: th.colors[p.slot],
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
        dash: !!p.dash,
        speedy: !!p.spd,
        springy: !!p.jmp,
        shield: !!p.shd,
        local: !!p.local,
        itTicks: p.itTicks,
        run: a.run,
        squash: a.squash,
        blink: a.blink,
        seed: p.slot * 17 + 3,
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
      const moved = Math.hypot(p.x - a.x, p.y - a.y);
      if (a.dead) {
        a.dead = false;
        a.ground = false;
        th.fx?.respawn?.(this, pv);
        this.onEvent?.('respawn', pv);
      } else if (moved > 150) {
        // stepped through a portal
        this.portalFx(a.x + PW / 2, a.y + PH / 2, pv);
        this.onEvent?.('portal', pv);
      } else if (!p.ground && p.vy < -1150 && a.vy > -1000) {
        // launched by a trampoline
        this.bounceFx(pv, t);
        this.onEvent?.('bounce', pv);
      } else if (a.ground && !p.ground && p.vy < -300) {
        a.squash = -0.2;
        th.fx?.jump?.(this, pv);
        this.onEvent?.('jump', pv);
      } else if (!a.ground && !p.ground && p.vy < -500 && p.vy - a.vy < -260) {
        // double jump
        a.squash = -0.16;
        this.emit({ x: pv.cx, y: pv.feet, life: 0.3, size: 6, grow: 70, shape: 'ring', width: 2.5, color: pv.color, back: true });
        th.fx?.jump?.(this, pv);
        this.onEvent?.('airjump', pv);
      } else if (!a.ground && p.ground) {
        const impact = clamp(a.vy / 900, 0.1, 1);
        a.squash = 0.1 + 0.2 * impact;
        th.fx?.land?.(this, pv, impact);
        this.onEvent?.('land', pv);
      }
      if (pv.dash && !a.dash) this.onEvent?.('dash', pv);
      a.dash = pv.dash;
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
          th.fx?.step?.(this, pv);
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
      // speed lines behind anyone dashing or running on Swift
      if ((pv.dash || (pv.speedy && speed > 200)) && t - a.streak > (pv.dash ? 0.012 : 0.045)) {
        a.streak = t;
        this.emit({ x: pv.cx - pv.face * 10, y: pv.y + 6 + Math.random() * 28, vx: -pv.vx * 0.15, life: pv.dash ? 0.22 : 0.16, size: pv.dash ? 2.2 : 1.6, shape: 'line', width: pv.dash ? 3 : 2, color: pv.dash ? '#ffffff' : KIND_COLORS.speed, back: true, lx: -pv.face * (pv.dash ? 34 : 18) });
      }
      if (pv.springy && p.ground && Math.random() < dt * 8) {
        this.emit({ x: pv.cx + (Math.random() - 0.5) * 24, y: pv.feet - 2, vy: -70, life: 0.4, size: 2, color: KIND_COLORS.jump, back: true });
      }
      th.fx?.trail?.(this, pv, dt, t);
      this.last[p.slot] = pv;
      out.push(pv);
    }
    for (let i = 0; i < 4; i++) if (!seen[i]) this.last[i] = null;
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
    for (let i = 0; i < 8; i++) this.emit({ x: pv.cx + (Math.random() - 0.5) * 40, y, vx: (Math.random() - 0.5) * 200, vy: -100 - Math.random() * 200, g: 500, life: 0.4, size: 2.4, color: i % 2 ? pv.color : '#ffffff' });
  }

  portalFx(fromX, fromY, pv) {
    for (const [x, y] of [
      [fromX, fromY],
      [pv.cx, pv.y + PH / 2],
    ]) {
      this.emit({ x, y, life: 0.4, size: 30, grow: -60, shape: 'ring', width: 3, color: pv.color });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 6.283;
        this.emit({ x: x + Math.cos(a) * 34, y: y + Math.sin(a) * 38, vx: -Math.cos(a) * 110, vy: -Math.sin(a) * 110, life: 0.32, size: 2.4, color: i % 2 ? pv.color : '#ffffff' });
      }
    }
  }

  drawPlayer(g, pv, t) {
    g.save();
    // tag protection: flash between solid and see-through
    if (pv.immune) g.globalAlpha = Math.floor(t * 14) % 2 ? 0.3 : 0.9;
    this.theme.player(g, pv, t, this.scene);
    g.restore();
    const px = this.theme.pixel;
    if (pv.frozen) {
      // block of ice
      g.fillStyle = 'rgba(170,235,255,.55)';
      g.strokeStyle = 'rgba(235,252,255,.95)';
      g.lineWidth = 2;
      if (px) {
        g.fillRect(pv.x - 4, pv.y - 4, PW + 8, PH + 6);
        g.fillStyle = '#ffffff';
        g.fillRect(pv.x - 2, pv.y - 2, 6, 2);
        g.fillRect(pv.x - 2, pv.y, 2, 6);
      } else {
        rr(g, pv.x - 5, pv.y - 6, PW + 10, PH + 8, 7);
        g.fill();
        g.stroke();
        g.beginPath();
        g.moveTo(pv.x + 2, pv.y + 6);
        g.lineTo(pv.x + 10, pv.y - 1);
        g.moveTo(pv.x + 22, pv.y + 30);
        g.lineTo(pv.x + 31, pv.y + 20);
        g.stroke();
      }
    }
    if (pv.shield) {
      const pulse = 1 + 0.05 * Math.sin(t * 7);
      g.strokeStyle = KIND_COLORS.shield;
      g.fillStyle = 'rgba(74,163,255,.14)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.ellipse(pv.cx, pv.y + 19, 27 * pulse, 30 * pulse, 0, 0, 6.283);
      g.fill();
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.8)';
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
      } else {
        g.beginPath();
        g.arc(p.x, p.y, size, 0, 6.283);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // Names, the IT marker, "YOU" pointer, stun stars - drawn at a constant size
  // on screen however far the camera has pulled back.
  drawLabels(ctx, view, pvs, t) {
    const th = this.theme;
    const lab = th.label;
    const z = this.cam.z;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    for (const pv of pvs) {
      const cx = pv.sx;
      let y = pv.sy - (th.labelGap ?? 7) * z;
      if (cx < -40 || cx > this.SW + 40 || y < -60 || y > this.SH + 80) continue;
      if (view.hud && cx < 176 && y < 150) continue; // would sit under the minimap
      if (view.names !== false) {
        ctx.font = lab.font;
        ctx.lineWidth = lab.strokeWidth ?? 3;
        ctx.strokeStyle = lab.stroke;
        ctx.fillStyle = pv.local ? lab.localColor || lab.color : lab.color;
        if (lab.stroke) ctx.strokeText(pv.name, cx, y);
        ctx.fillText(pv.name, cx, y);
        y -= lab.size + 4;
      }
      if (pv.stunned) {
        for (let i = 0; i < 3; i++) {
          const a = t * 9 + i * 2.094;
          ctx.fillStyle = lab.stun || lab.color;
          ctx.fillRect(cx + Math.cos(a) * 12 - 1.5, y - 2 + Math.sin(a) * 3.5 - 1.5, 3, 3);
        }
        y -= 8;
      }
      if (pv.isIt) {
        th.marker(ctx, cx, y - 11 + Math.sin(t * 6) * 2, t, pv);
        y -= 28;
      }
      if (pv.local && view.pointYou) {
        const bob = Math.abs(Math.sin(t * 5)) * 5;
        ctx.font = lab.youFont || lab.font;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = lab.stroke || 'rgba(0,0,0,.6)';
        ctx.fillStyle = lab.you || lab.color;
        ctx.strokeText('YOU', cx, y - 9 - bob);
        ctx.fillText('YOU', cx, y - 9 - bob);
        ctx.beginPath();
        ctx.moveTo(cx - 6, y - 6 - bob);
        ctx.lineTo(cx + 6, y - 6 - bob);
        ctx.lineTo(cx, y + 1 - bob);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }
    }
  }

  // Arrows on the edge of the screen pointing at anyone the camera cannot see.
  drawArrows(ctx, view, pvs, t) {
    const h = this.theme.hud;
    const { SW, SH } = this;
    const z = this.cam.z;
    const m = 26;
    for (const pv of pvs) {
      const x = pv.sx;
      const y = pv.sy + 20 * z;
      if (x > -10 && x < SW + 10 && y > -10 && y < SH + 10) continue;
      const cx = clamp(x, m, SW - m);
      const cy = clamp(y, m + 70, SH - m - 8);
      const ang = Math.atan2(y - cy, x - cx);
      const big = pv.isIt;
      const r = big ? 13 + Math.sin(t * 8) * 1.5 : 9;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = pv.color;
      ctx.strokeStyle = h.outline || 'rgba(0,0,0,.65)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 6.283);
      ctx.stroke();
      ctx.fill();
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(r + 9, 0);
      ctx.lineTo(r + 1, -6);
      ctx.lineTo(r + 1, 6);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
      if (big) {
        ctx.font = `800 10px ${h.labelFont || h.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.lineWidth = 2.5;
        ctx.strokeText('IT', cx, cy + 0.5);
        ctx.fillText('IT', cx, cy + 0.5);
      }
    }
  }

  // A red pulse around the screen while you are "it".
  drawItVignette(ctx, t) {
    const { SW, SH } = this;
    const a = 0.2 + 0.08 * Math.sin(t * 5);
    const col = this.theme.hud.warn || '#ff3030';
    const gr = ctx.createRadialGradient(SW / 2, SH / 2, SH * 0.48, SW / 2, SH / 2, SH * 0.98);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, col);
    ctx.globalAlpha = a;
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, SW, SH);
    ctx.globalAlpha = 1;
  }

  drawHud(ctx, view, t, pvs) {
    const h = this.theme.hud;
    const k = h.scale || 1;
    const { SW, SH } = this;
    const labelFont = (px, w = h.labelWeight || 600) => `${w} ${Math.round(px * (h.labelScale || 1))}px ${h.labelFont || h.font}`;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const setGlow = (on) => {
      ctx.shadowColor = on && h.glow ? h.glow : 'transparent';
      ctx.shadowBlur = on && h.glow ? h.glowBlur || 10 : 0;
    };
    const text = (str, x, y, color) => {
      if (h.outline) {
        ctx.strokeStyle = h.outline;
        ctx.lineWidth = h.outlineWidth || 4;
        ctx.strokeText(str, x, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    };

    // round timer
    const secs = Math.max(0, view.timeLeft);
    const urgent = view.phase === 'playing' && secs <= 10;
    const timerText = urgent ? secs.toFixed(1) : String(Math.ceil(secs));
    const pulse = urgent ? 1 + 0.07 * Math.abs(Math.sin(t * 6.283)) : 1;
    ctx.textAlign = 'center';
    ctx.font = `${h.weight} ${Math.round(36 * k * pulse)}px ${h.font}`;
    setGlow(true);
    text(timerText, SW / 2, 27 + (h.timerDy || 0), urgent ? h.warn : h.text);
    setGlow(false);

    // one chip per player: colour, name, time spent as "it"
    const list = view.players.slice().sort((a, b) => a.slot - b.slot);
    const n = list.length;
    const cw = Math.min(n > 3 ? 150 : 164, (SW - 40 - (n - 1) * 8) / n);
    const gap = 8;
    const ch = 24;
    const rowW = n * cw + (n - 1) * gap;
    let x = SW / 2 - rowW / 2;
    const y = 50;
    for (const p of list) {
      const color = this.theme.colors[p.slot];
      const isIt = view.it === p.slot;
      rr(ctx, x, y, cw, ch, h.radius ?? 6);
      ctx.fillStyle = isIt ? h.chipIt : h.chip;
      ctx.fill();
      ctx.lineWidth = isIt ? 2 : 1;
      ctx.strokeStyle = isIt ? color : h.chipLine;
      ctx.stroke();
      ctx.fillStyle = color;
      rr(ctx, x + 6, y + 6, 12, 12, h.swatchRadius ?? 3);
      ctx.fill();
      if (h.swatchLine) {
        ctx.strokeStyle = h.swatchLine;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.font = `${h.weight} ${Math.round(13 * k)}px ${h.font}`;
      // hot potato: what matters is who is it right now; least-time: the running totals
      const stat = view.mode === 'potato' ? (isIt ? 'IT' : '') : `${(p.itTicks / TICK_RATE).toFixed(1)}s`;
      const tw = stat ? ctx.measureText(stat).width : 0;
      ctx.fillStyle = isIt ? h.chipItText || h.text : h.text;
      if (stat) ctx.fillText(stat, x + cw - 7, y + ch / 2 + 1);
      ctx.textAlign = 'left';
      ctx.font = labelFont(13);
      ctx.fillText(fitText(ctx, p.name + (p.local ? ' (you)' : ''), cw - tw - 36), x + 24, y + ch / 2 + 1);
      x += cw + gap;
    }

    // "you are it" call-out
    const me = pvs.find((p) => p.local);
    if (me && view.phase === 'playing') {
      ctx.textAlign = 'center';
      ctx.font = `${h.weight} ${Math.round(15 * k)}px ${h.font}`;
      if (me.isIt) text(view.mode === 'potato' ? "YOU'RE IT - TAG SOMEONE!" : "YOU'RE IT!", SW / 2, 92, h.warn);
    }

    // room code + ping, tucked into the corners
    ctx.font = labelFont(12);
    if (view.code) {
      ctx.textAlign = 'left';
      text(`ROOM ${view.code}`, 10, 14, h.dim);
    }
    if (view.ping != null) {
      ctx.textAlign = 'right';
      text(`${Math.round(view.ping)} ms`, SW - 10, SH - 12, h.dim);
    }

    this.drawMinimap(ctx, view, pvs, t, SW / 2 - rowW / 2 < 176 ? 86 : view.code ? 30 : 12);
    if (view.me) this.drawStatus(ctx, view, t, labelFont);
    ctx.restore();
  }

  // The whole arena in a corner: platforms, gadgets, everyone's position.
  drawMinimap(ctx, view, pvs, t, top) {
    const h = this.theme.hud;
    const a = this.arena;
    const s = Math.min(150 / a.w, 104 / a.h);
    const w = a.w * s;
    const hgt = a.h * s;
    const x = 10;
    const y = top;
    ctx.save();
    rr(ctx, x - 3, y - 3, w + 6, hgt + 6, 4);
    ctx.fillStyle = h.chip;
    ctx.fill();
    ctx.strokeStyle = h.chipLine;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(x, y, w, hgt);
    ctx.clip();
    ctx.fillStyle = h.dim;
    for (const p of a.platforms) ctx.fillRect(x + p.x * s, y + p.y * s, Math.max(1.5, p.w * s), Math.max(1.2, p.oneway ? 1.2 : p.h * s));
    for (const tr of a.tramps) {
      ctx.fillStyle = h.warn;
      ctx.fillRect(x + tr.x * s, y + tr.y * s - 1, Math.max(2, tr.w * s), 2);
    }
    for (const pk of view.pickups || []) {
      const pt = a.pickups[pk.point];
      ctx.fillStyle = KIND_COLORS[PICKUP_TYPES[pk.type]];
      ctx.fillRect(x + pt.x * s - 1.5, y + pt.y * s - 1.5, 3, 3);
    }
    // what the camera currently shows
    const cam = this.cam;
    ctx.strokeStyle = h.text;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + (cam.x - this.SW / cam.z / 2) * s, y + (cam.y - this.SH / cam.z / 2) * s, (this.SW / cam.z) * s, (this.SH / cam.z) * s);
    ctx.globalAlpha = 1;
    for (const pv of pvs) {
      const px = x + pv.cx * s;
      const py = y + (pv.y + 20) * s;
      if (pv.isIt) {
        ctx.strokeStyle = h.warn;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 5 + Math.sin(t * 8) * 1.2, 0, 6.283);
        ctx.stroke();
      }
      ctx.fillStyle = pv.color;
      ctx.beginPath();
      ctx.arc(px, py, pv.local ? 3.2 : 2.5, 0, 6.283);
      ctx.fill();
      if (pv.local) {
        ctx.strokeStyle = h.text;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Bottom centre: dash cooldown and whatever power-ups you are carrying.
  drawStatus(ctx, view, t, labelFont) {
    const h = this.theme.hud;
    const me = view.me;
    const items = [];
    const ready = me.dashCd <= 0;
    items.push({ label: 'DASH', frac: ready ? 1 : 1 - me.dashCd / (DASH_COOLDOWN + DASH_TICKS), color: ready ? h.text : h.dim, kind: null });
    if (me.spd > 0) items.push({ label: 'SWIFT', frac: me.spd / SPEED_BUFF_TICKS, color: KIND_COLORS.speed, kind: 'speed' });
    if (me.jmp > 0) items.push({ label: 'SPRING', frac: me.jmp / JUMP_BUFF_TICKS, color: KIND_COLORS.jump, kind: 'jump' });
    if (me.shd > 0) items.push({ label: 'WARD', frac: me.shd / SHIELD_TICKS, color: KIND_COLORS.shield, kind: 'shield' });
    const w = 74;
    const gap = 8;
    let x = this.SW / 2 - (items.length * w + (items.length - 1) * gap) / 2;
    const y = this.SH - 30;
    ctx.textBaseline = 'middle';
    for (const it of items) {
      rr(ctx, x, y, w, 20, h.radius ?? 6);
      ctx.fillStyle = h.chip;
      ctx.fill();
      ctx.strokeStyle = h.chipLine;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      rr(ctx, x + 2, y + 2, w - 4, 16, Math.max(0, (h.radius ?? 6) - 2));
      ctx.clip();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = it.color;
      ctx.fillRect(x + 2, y + 2, (w - 4) * clamp(it.frac, 0, 1), 16);
      ctx.restore();
      ctx.fillStyle = it.kind ? it.color : h.text;
      if (it.kind) drawIcon(ctx, it.kind, x + 11, y + 10, 5.5, it.color);
      ctx.font = labelFont(10.5);
      ctx.textAlign = 'left';
      ctx.fillStyle = h.text;
      ctx.fillText(it.label, x + (it.kind ? 21 : 9), y + 11);
      x += w + gap;
    }
  }

  // Countdown numbers, GO!, spectator banner.
  drawOverlay(ctx, view, t) {
    const h = this.theme.hud;
    const k = h.scale || 1;
    const { SW, SH } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    let big = null;
    let f = 0;
    if (view.phase === 'countdown' && view.countdownMs != null) {
      const ms = view.countdownMs;
      const n = Math.ceil(ms / 1000);
      if (n >= 1 && n <= 3) {
        big = String(n);
        f = 1 - (ms / 1000 - (n - 1));
      }
    } else if (view.goAge != null && view.goAge < 0.8) {
      big = 'GO!';
      f = view.goAge / 0.8;
    }
    if (big) {
      const sc = 1.5 - 0.5 * Math.min(1, f * 4);
      ctx.globalAlpha = f > 0.75 ? (1 - f) * 4 : 1;
      ctx.font = `${h.weight} ${Math.round(130 * k * sc)}px ${h.font}`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = h.bigStroke || 'rgba(0,0,0,.55)';
      ctx.strokeText(big, SW / 2, SH / 2);
      if (h.glow) {
        ctx.shadowColor = h.glow;
        ctx.shadowBlur = 30;
      }
      ctx.fillStyle = h.big || h.text;
      ctx.fillText(big, SW / 2, SH / 2);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    if (view.banner) {
      ctx.font = `${h.labelWeight || 600} ${Math.round(14 * (h.labelScale || 1))}px ${h.labelFont || h.font}`;
      const w = ctx.measureText(view.banner).width + 28;
      rr(ctx, SW / 2 - w / 2, SH - 66, w, 26, 13);
      ctx.fillStyle = h.chip;
      ctx.fill();
      ctx.strokeStyle = h.chipLine;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = h.text;
      ctx.fillText(view.banner, SW / 2, SH - 52);
    }
    ctx.restore();
  }
}
