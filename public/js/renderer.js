// Draws a match. Everything that depends on the art style is delegated to a
// theme (see ./themes); this file owns layout, animation state, particles,
// labels and the HUD.

import { W, H, PW, PH, TICK_RATE } from '/shared/config.js';
import { THEME_MAP } from './themes/index.js';
import { clamp, mulberry32, hashStr, rr, fitText } from './util.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.theme = null;
    this.arena = null;
    this.scene = null;
    this.gen = 0; // bumped whenever the scene changes, to reset per-player animation
    this.anim = [null, null, null, null];
    this.last = [null, null, null, null]; // last drawn view-model per slot
    this.parts = [];
    this.shakeAmt = 0;
    this.flashA = 0;
    this.flashColor = '#fff';
    this.lastT = 0;
    this.onEvent = null; // (type, pv) -> used for sound
    this.lo = document.createElement('canvas'); // low-res buffer for pixel-art themes
    this.loCtx = this.lo.getContext('2d');
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, this.canvas.clientWidth);
    const ch = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.scale = Math.min(this.canvas.width / W, this.canvas.height / H);
    this.ox = Math.round((this.canvas.width - W * this.scale) / 2);
    this.oy = Math.round((this.canvas.height - H * this.scale) / 2);
    this.rebuild();
  }

  // Where the arena sits inside the canvas, in CSS pixels (for HTML overlays).
  arenaRect() {
    const k = this.canvas.clientWidth / this.canvas.width;
    return { x: this.ox * k, y: this.oy * k, w: W * this.scale * k, h: H * this.scale * k };
  }

  setScene(arena, themeId) {
    const theme = THEME_MAP[themeId] || THEME_MAP.neon;
    if (this.arena === arena && this.theme === theme) return;
    this.arena = arena;
    this.theme = theme;
    this.parts.length = 0;
    this.shakeAmt = 0;
    this.flashA = 0;
    this.rebuild();
  }

  rebuild() {
    if (!this.theme || !this.arena) return;
    const theme = this.theme;
    const scale = Math.min(this.scale, 2.5);
    const env = {
      arena: this.arena,
      W,
      H,
      scale,
      rnd: mulberry32(hashStr(`${this.arena.id}/${theme.id}`)),
      // Pre-render something static once; themes blit it every frame.
      layer: (draw, s = theme.pixel ? 1 / theme.pixel : scale) => {
        const c = document.createElement('canvas');
        c.width = Math.ceil(W * s);
        c.height = Math.ceil(H * s);
        const g = c.getContext('2d');
        g.scale(s, s);
        draw(g);
        return c;
      },
    };
    this.scene = theme.build(env);
    if (theme.pixel) {
      this.lo.width = W / theme.pixel;
      this.lo.height = H / theme.pixel;
    }
    this.gen++;
  }

  // --- effects API used by themes -------------------------------------------------
  emit(p) {
    if (this.parts.length > 420) return;
    this.parts.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      g: 0,
      drag: 0,
      life: 0.5,
      size: 3,
      grow: 0,
      color: '#fff',
      shape: 'circle',
      rot: 0,
      vr: 0,
      alpha: 1,
      back: false,
      ...p,
      age: 0,
    });
  }

  shake(amount) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  flash(color, alpha) {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, alpha);
  }

  // Called by the game when the server reports a tag.
  tagFx(fromSlot, toSlot) {
    const to = this.last[toSlot];
    const from = this.last[fromSlot];
    if (!to || !this.theme) return;
    this.shake(9);
    this.theme.fx?.tag?.(this, to, from || to);
  }

  // --- frame ----------------------------------------------------------------------
  draw(view, nowMs) {
    const ctx = this.ctx;
    const th = this.theme;
    const t = nowMs / 1000;
    const dt = clamp(t - this.lastT, 0, 0.1);
    this.lastT = t;
    if (!th || !this.scene) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    const s = this.scale;
    const pvs = this.updatePlayers(view, t, dt);

    this.shakeAmt *= Math.exp(-dt * 10);
    if (this.shakeAmt < 0.2) this.shakeAmt = 0;
    let sx = (Math.random() * 2 - 1) * this.shakeAmt;
    let sy = (Math.random() * 2 - 1) * this.shakeAmt;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.letterbox;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, this.ox, this.oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    if (th.pixel) {
      // Pixel-art styles render the world small and get scaled up with hard edges.
      const g = this.loCtx;
      const k = 1 / th.pixel;
      g.setTransform(k, 0, 0, k, 0, 0);
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 1;
      th.back(g, this.scene, t, view, pvs);
      th.platforms(g, this.scene, t, view, pvs);
      this.drawParticles(g, dt, true);
      for (const pv of pvs) this.drawPlayer(g, pv, t);
      this.drawParticles(g, 0, false);
      sx = Math.round(sx / th.pixel) * th.pixel;
      sy = Math.round(sy / th.pixel) * th.pixel;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.lo, sx, sy, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.translate(sx, sy);
    } else {
      ctx.translate(sx, sy);
      th.back(ctx, this.scene, t, view, pvs);
      th.platforms(ctx, this.scene, t, view, pvs);
      this.drawParticles(ctx, dt, true);
      for (const pv of pvs) this.drawPlayer(ctx, pv, t);
      this.drawParticles(ctx, 0, false);
    }
    th.front(ctx, this.scene, t, view, pvs);
    this.drawLabels(ctx, view, pvs, t);

    if (this.flashA > 0.01) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.globalAlpha = 1;
      this.flashA *= Math.exp(-dt * 9);
    }
    ctx.restore();

    if (view.hud) this.drawHud(ctx, view, t);
    this.drawOverlay(ctx, view, t);
  }

  // Turn raw player states into view-models, advance animation and spot
  // jump / land / step / respawn moments.
  updatePlayers(view, t, dt) {
    const th = this.theme;
    const out = [];
    const seen = [false, false, false, false];
    for (const p of view.players) {
      seen[p.slot] = true;
      let a = this.anim[p.slot];
      if (!a || a.gen !== this.gen) {
        a = this.anim[p.slot] = {
          gen: this.gen,
          run: 0,
          squash: 0,
          ground: p.ground,
          vy: 0,
          dead: p.dead > 0,
          step: 0,
          blink: 0,
          nextBlink: t + 1 + Math.random() * 3,
        };
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
          if (lastPv) {
            th.fx?.fall?.(this, lastPv);
            this.onEvent?.('fall', lastPv);
          }
        }
        this.last[p.slot] = null;
        continue;
      }
      if (a.dead) {
        a.dead = false;
        a.ground = false;
        th.fx?.respawn?.(this, pv);
        this.onEvent?.('respawn', pv);
      }
      if (a.ground && !p.ground && p.vy < -300) {
        a.squash = -0.2;
        th.fx?.jump?.(this, pv);
        this.onEvent?.('jump', pv);
      } else if (!a.ground && p.ground) {
        const impact = clamp(a.vy / 900, 0.1, 1);
        a.squash = 0.1 + 0.2 * impact;
        th.fx?.land?.(this, pv, impact);
        this.onEvent?.('land', pv);
      }
      a.ground = p.ground;
      a.vy = p.vy;
      a.squash *= Math.exp(-dt * 12);
      if (Math.abs(a.squash) < 0.004) a.squash = 0;
      const speed = Math.abs(p.vx);
      if (p.ground && speed > 30) {
        a.run += speed * dt * 0.085;
        a.step += speed * dt;
        if (a.step > 37) {
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
      th.fx?.trail?.(this, pv, dt, t);
      this.last[p.slot] = pv;
      out.push(pv);
    }
    for (let i = 0; i < 4; i++) if (!seen[i]) this.last[i] = null;
    // local player on top, whoever is "it" just below that
    out.sort((a, b) => (a.local ? 2 : a.isIt ? 1 : 0) - (b.local ? 2 : b.isIt ? 1 : 0));
    return out;
  }

  drawPlayer(g, pv, t) {
    g.save();
    // tag protection: flash between solid and see-through
    if (pv.immune) g.globalAlpha = Math.floor(t * 14) % 2 ? 0.3 : 0.9;
    this.theme.player(g, pv, t, this.scene);
    g.restore();
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
      if (px) {
        const q = Math.max(px, Math.round(size / px) * px);
        g.fillRect(Math.round(p.x / px) * px, Math.round(p.y / px) * px, q, q);
      } else if (p.shape === 'square') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillRect(-size / 2, -size / 2, size, size);
        g.restore();
      } else if (p.shape === 'line') {
        g.lineWidth = p.width || 1.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.03 * size, p.y - p.vy * 0.03 * size);
        g.stroke();
      } else if (p.shape === 'ring') {
        g.lineWidth = p.width || 2;
        g.beginPath();
        g.arc(p.x, p.y, size, 0, 6.283);
        g.stroke();
      } else {
        g.beginPath();
        g.arc(p.x, p.y, size, 0, 6.283);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // Names, the IT marker, "YOU" pointer, stun stars, off-screen arrows.
  drawLabels(ctx, view, pvs, t) {
    const th = this.theme;
    const lab = th.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    for (const pv of pvs) {
      const cx = pv.cx;
      if (pv.y + PH < -2) {
        // jumped above the top of the screen: point at them
        const bob = Math.sin(t * 8) * 2;
        ctx.fillStyle = pv.color;
        ctx.strokeStyle = lab.stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, 4 + bob);
        ctx.lineTo(cx - 9, 16 + bob);
        ctx.lineTo(cx + 9, 16 + bob);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        continue;
      }
      let y = pv.y - (th.labelGap ?? 7);
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

  drawHud(ctx, view, t) {
    const h = this.theme.hud;
    const k = h.scale || 1;
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
    text(timerText, W / 2, 27 + (h.timerDy || 0), urgent ? h.warn : h.text);
    setGlow(false);

    // one chip per player: colour, name, time spent as "it"
    const list = view.players.slice().sort((a, b) => a.slot - b.slot);
    const n = list.length;
    const cw = n > 3 ? 150 : 164;
    const gap = 8;
    const ch = 24;
    let x = W / 2 - (n * cw + (n - 1) * gap) / 2;
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
      const time = `${(p.itTicks / TICK_RATE).toFixed(1)}s`;
      const tw = ctx.measureText(time).width;
      ctx.fillStyle = isIt ? h.chipItText || h.text : h.text;
      ctx.fillText(time, x + cw - 7, y + ch / 2 + 1);
      ctx.textAlign = 'left';
      ctx.font = `${h.labelWeight || 600} ${Math.round(13 * (h.labelScale || 1))}px ${h.labelFont || h.font}`;
      ctx.fillStyle = isIt ? h.chipItText || h.text : h.text;
      ctx.fillText(fitText(ctx, p.name + (p.local ? ' (you)' : ''), cw - tw - 36), x + 24, y + ch / 2 + 1);
      x += cw + gap;
    }

    // room code + ping, tucked into the corners
    ctx.font = `${h.labelWeight || 600} ${Math.round(12 * (h.labelScale || 1))}px ${h.labelFont || h.font}`;
    if (view.code) {
      ctx.textAlign = 'left';
      text(`ROOM ${view.code}`, 10, 14, h.dim);
    }
    if (view.ping != null) {
      ctx.textAlign = 'right';
      text(`${Math.round(view.ping)} ms`, W - 10, H - 12, h.dim);
    }
    ctx.restore();
  }

  // Countdown numbers, GO!, spectator banner.
  drawOverlay(ctx, view, t) {
    const h = this.theme.hud;
    const k = h.scale || 1;
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
      ctx.strokeText(big, W / 2, H / 2);
      if (h.glow) {
        ctx.shadowColor = h.glow;
        ctx.shadowBlur = 30;
      }
      ctx.fillStyle = h.big || h.text;
      ctx.fillText(big, W / 2, H / 2);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    if (view.banner) {
      ctx.font = `${h.labelWeight || 600} ${Math.round(14 * (h.labelScale || 1))}px ${h.labelFont || h.font}`;
      const w = ctx.measureText(view.banner).width + 28;
      rr(ctx, W / 2 - w / 2, H - 40, w, 26, 13);
      ctx.fillStyle = h.chip;
      ctx.fill();
      ctx.strokeStyle = h.chipLine;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = h.text;
      ctx.fillText(view.banner, W / 2, H - 26);
    }
    ctx.restore();
  }
}
