// A match that runs entirely in the browser: practice vs bots, and the little
// bot matches that play behind the menus. Same rules code as the server.

import { TICK_MS, TICK_RATE, COUNTDOWN_MS } from '/shared/config.js';
import { Sim, standings } from '/shared/sim.js';
import { makeBot, botThink } from '/shared/bots.js';

const BOT_NAMES = ['Zap', 'Mox', 'Juno', 'Blip', 'Rook', 'Fizz', 'Dash', 'Pip'];

export class LocalGame {
  // opts: { arena, themeId, mode, duration, human (name or null), bots, backdrop, input, onEvent }
  constructor(opts) {
    this.arena = opts.arena;
    this.themeId = opts.themeId;
    this.mode = opts.mode || 'potato';
    this.duration = opts.duration || 90;
    this.backdrop = !!opts.backdrop; // endless, no HUD, no countdown
    this.input = opts.input;
    this.onEvent = opts.onEvent || (() => {});
    this.sim = new Sim(this.arena);
    this.names = [];
    this.bots = [null, null, null, null];
    this.human = -1;

    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    let slot = 0;
    if (opts.human != null) {
      this.human = 0;
      this.names[0] = opts.human;
      this.sim.add(0, order[0]);
      slot = 1;
    }
    const pool = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < opts.bots && slot < 4; i++, slot++) {
      this.names[slot] = pool[i];
      this.sim.add(slot, order[slot]);
      this.bots[slot] = makeBot(Math.floor(Math.random() * 1e6) + slot);
    }

    this.phase = this.backdrop ? 'playing' : 'countdown';
    this.countdownMs = COUNTDOWN_MS;
    this.goTime = null;
    this.endTick = this.backdrop ? Infinity : 0;
    this.acc = 0;
    this.lastNow = null;
    this.lastCount = 4;
    this.lastSecond = -1;
    this.prev = [null, null, null, null];
    if (this.backdrop) this.sim.start();
  }

  update(now) {
    const dt = this.lastNow == null ? 0 : Math.min(now - this.lastNow, 100);
    this.lastNow = now;
    const sim = this.sim;

    if (this.phase === 'countdown') {
      this.countdownMs -= dt;
      const n = Math.ceil(this.countdownMs / 1000);
      if (n !== this.lastCount && n >= 1) {
        this.lastCount = n;
        this.onEvent('count', n);
      }
      if (this.countdownMs <= 0) {
        this.phase = 'playing';
        this.goTime = now;
        sim.start();
        this.endTick = sim.tick + this.duration * TICK_RATE;
        this.onEvent('go', sim.it);
      }
    }

    if (this.phase !== 'over') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 5) {
        this.acc -= TICK_MS;
        steps++;
        for (const p of sim.players) if (p) this.prev[p.slot] = { x: p.s.x, y: p.s.y, dead: p.s.dead };
        const inputs = [0, 0, 0, 0];
        if (this.phase === 'playing') {
          for (let s = 0; s < 4; s++) {
            if (s === this.human) inputs[s] = this.input ? this.input.bits() : 0;
            else if (this.bots[s]) inputs[s] = botThink(sim, s, this.bots[s]);
          }
        }
        sim.step(inputs);
        for (const e of sim.events) {
          if (e.type === 'tag') this.onEvent('tag', e.from, e.to);
          else if (e.type === 'block') this.onEvent('block', e.from, e.to);
          else if (e.type === 'pick') this.onEvent('pick', e.slot, e.kind);
        }
        sim.events.length = 0;
        if (this.phase === 'playing' && sim.tick >= this.endTick) {
          this.phase = 'over';
          const { rows, winners, loser } = standings(sim, this.names, this.mode);
          this.onEvent('end', {
            reason: 'time',
            mode: this.mode,
            winners,
            loser,
            rows: rows.map((r) => ({ slot: r.slot, name: r.name, ms: Math.round((r.ticks * 1000) / TICK_RATE), tags: r.tags })),
          });
          break;
        }
      }
      if (this.acc >= TICK_MS) this.acc = 0;
    }

    const a = this.phase === 'over' ? 1 : this.acc / TICK_MS;
    const players = [];
    for (const p of sim.players) {
      if (!p) continue;
      const s = p.s;
      const pr = this.prev[p.slot];
      const smooth = pr && pr.dead === 0 && s.dead === 0 && Math.abs(pr.y - s.y) + Math.abs(pr.x - s.x) < 80;
      players.push({
        slot: p.slot,
        name: this.names[p.slot],
        x: smooth ? pr.x + (s.x - pr.x) * a : s.x,
        y: smooth ? pr.y + (s.y - pr.y) * a : s.y,
        vx: s.vx,
        vy: s.vy,
        ground: s.ground,
        face: s.face,
        immune: p.immune,
        stun: s.stun,
        frz: s.frz,
        dash: s.dashT > 0,
        spd: s.spd,
        jmp: s.jmp,
        shd: s.shd,
        dead: s.dead,
        itTicks: p.itTicks,
        local: p.slot === this.human,
      });
    }
    const goAge = this.goTime != null ? (now - this.goTime) / 1000 : null;
    const timeLeft = this.phase === 'countdown' ? this.duration : Math.max(0, (this.endTick - sim.tick) / TICK_RATE);
    if (this.phase === 'playing' && !this.backdrop) {
      const sec = Math.ceil(timeLeft);
      if (sec !== this.lastSecond) {
        if (sec <= 5 && sec >= 1 && this.lastSecond !== -1) this.onEvent('tick', sec);
        this.lastSecond = sec;
      }
    }
    const me = this.human >= 0 ? sim.players[this.human].s : null;
    return {
      phase: this.phase,
      mode: this.mode,
      countdownMs: this.phase === 'countdown' ? this.countdownMs : null,
      goAge,
      timeLeft,
      duration: this.duration,
      it: sim.it,
      players,
      pickups: sim.pickups,
      me: me && this.phase !== 'countdown' ? { dashCd: me.dashCd, spd: me.spd, jmp: me.jmp, shd: me.shd } : null,
      hud: !this.backdrop,
      names: !this.backdrop,
      code: null,
      ping: null,
      banner: null,
      pointYou: this.human >= 0 && (this.phase === 'countdown' || (goAge != null && goAge < 2.5)),
    };
  }
}
