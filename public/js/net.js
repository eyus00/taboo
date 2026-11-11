// An online match as seen by one browser.
//
// The server is in charge, but waiting for it before moving your own
// character would feel laggy, so:
//   * your player is simulated locally the instant you press a key
//     (prediction), using the same physics code the server runs;
//   * every snapshot from the server is the truth - we rewind to it, replay
//     the inputs it has not seen yet, and blend away any difference;
//   * everyone else is drawn slightly in the past, gliding between the last
//     few snapshots, so 30 updates a second looks smooth at 60+ fps.

import { TICK_MS, TICK_RATE } from '/shared/config.js';
import { stepPlayer, unpackState, PF_GROUND, PF_FACE, PF_STUN, PF_FROZEN, PF_DASH, PF_SPEED, PF_JUMP, PF_SHIELD, PF_DEAD } from '/shared/physics.js';

const INTERP_TICKS = 6; // draw other players ~100 ms behind the newest snapshot
const MAX_EXTRAPOLATE = 4;

export class NetGame {
  constructor(socket, input, onEvent) {
    this.socket = socket;
    this.input = input;
    this.onEvent = onEvent || (() => {});
    this.round = null;
    this.mySlot = -1;
    this.code = null;
    this.ping = null;
    this.reset();
  }

  reset() {
    this.phase = 'idle'; // idle | countdown | playing | over
    this.names = [];
    this.hist = [[], [], [], []];
    this.cur = null; // newest snapshot
    this.lastTick = -1;
    this.offset = null; // server tick minus local clock (in ticks)
    this.it = -1;
    this.pickups = [];
    this.countdownEnd = 0;
    this.goTime = null;
    this.lastCount = 4;
    this.lastSecond = -1;
    // prediction
    this.predicting = false;
    this.pred = null;
    this.prevX = 0;
    this.prevY = 0;
    this.offX = 0;
    this.offY = 0;
    this.pending = [];
    this.seq = 0;
    this.acc = 0;
    this.lastNow = null;
  }

  // 'round' from the server: a new round is starting (or we joined mid-round).
  onRound(msg, arena, mySlot) {
    this.reset();
    this.round = msg;
    this.arena = arena;
    this.mySlot = mySlot;
    for (const p of msg.players) this.names[p.slot] = p.name;
    this.phase = msg.playing ? 'playing' : 'countdown';
    this.countdownEnd = performance.now() + msg.countdown;
  }

  onGo(it) {
    this.it = it;
    this.startPlaying();
    this.onEvent('go', it);
  }

  onEnd() {
    this.phase = 'over';
    this.predicting = false;
  }

  startPlaying() {
    if (this.phase === 'playing' && this.goTime != null) return;
    this.phase = 'playing';
    this.goTime = performance.now();
  }

  // 's' from the server: [tick, playing, it, left, players, pickups, mine]
  onSnap(m) {
    if (!this.round || this.phase === 'over') return;
    const tick = m[0];
    if (tick <= this.lastTick) return;
    this.lastTick = tick;

    const nowTicks = performance.now() / TICK_MS;
    const sample = tick - nowTicks;
    if (this.offset == null || Math.abs(sample - this.offset) > 15) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.1;

    const players = [null, null, null, null];
    for (const e of m[4]) {
      const f = e[5];
      const p = {
        t: tick,
        x: e[1],
        y: e[2],
        vx: e[3],
        vy: e[4],
        ground: (f & PF_GROUND) !== 0,
        face: f & PF_FACE ? 1 : -1,
        stun: f & PF_STUN ? 1 : 0,
        frz: f & PF_FROZEN ? 1 : 0,
        dash: (f & PF_DASH) !== 0,
        spd: f & PF_SPEED ? 1 : 0,
        jmp: f & PF_JUMP ? 1 : 0,
        shd: f & PF_SHIELD ? 1 : 0,
        dead: f & PF_DEAD ? 1 : 0,
        immune: e[6],
        itTicks: e[7],
        tags: e[8],
      };
      players[e[0]] = p;
      const h = this.hist[e[0]];
      h.push(p);
      if (h.length > 16) h.shift();
    }
    this.cur = { tick, playing: m[1] === 1, it: m[2], left: m[3], players };
    this.it = m[2];
    this.pickups = m[5].map((v) => ({ point: v >> 2, type: v & 3 }));
    if (this.cur.playing && this.phase === 'countdown') this.startPlaying();
    if (!this.cur.playing && this.phase === 'countdown') this.countdownEnd = performance.now() + m[3];

    const mine = m[6];
    if (!mine || this.mySlot < 0 || this.phase !== 'playing') return;
    const ack = mine[0];
    const s = unpackState(mine.slice(1));

    if (!this.predicting) {
      // first snapshot of the round for us: start predicting from it
      this.pred = s;
      this.prevX = s.x;
      this.prevY = s.y;
      this.pending = [];
      this.seq = ack;
      this.acc = 0;
      this.offX = this.offY = 0;
      this.predicting = true;
      return;
    }

    // Reconcile: start from the server's version of me and replay every input
    // it has not processed yet. With no surprises this lands exactly where the
    // prediction already was.
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    if (ack > this.seq) this.seq = ack; // we stalled (hidden tab) and the server moved on
    const isIt = this.it === this.mySlot;
    for (const inp of this.pending) stepPlayer(s, inp.bits, this.arena, isIt);
    const ex = this.pred.x - s.x;
    const ey = this.pred.y - s.y;
    if (ex !== 0 || ey !== 0) {
      if (s.dead > 0 || this.pred.dead > 0 || Math.abs(ex) + Math.abs(ey) > 110) {
        // respawn, portal or a big disagreement: just snap
        this.offX = this.offY = 0;
        this.prevX = s.x;
        this.prevY = s.y;
      } else {
        // small disagreement: keep drawing where we were and ease over
        this.offX += ex;
        this.offY += ey;
        this.prevX -= ex;
        this.prevY -= ey;
      }
    }
    this.pred = s;
  }

  // Called every animation frame. Returns what to draw.
  update(now) {
    if (!this.round) return null;
    const dt = this.lastNow == null ? 0 : now - this.lastNow;
    this.lastNow = now;

    if (this.phase === 'countdown') {
      const n = Math.ceil((this.countdownEnd - now) / 1000);
      if (n !== this.lastCount && n >= 1 && n <= 3) {
        this.lastCount = n;
        this.onEvent('count', n);
      }
    }

    if (this.predicting) {
      this.acc += Math.min(dt, 250);
      const out = [];
      const isIt = this.it === this.mySlot;
      while (this.acc >= TICK_MS && out.length < 6) {
        this.acc -= TICK_MS;
        const bits = this.input.bits();
        this.pending.push({ seq: ++this.seq, bits });
        this.prevX = this.pred.x;
        this.prevY = this.pred.y;
        stepPlayer(this.pred, bits, this.arena, isIt);
        out.push(bits);
      }
      if (this.acc >= TICK_MS) this.acc = 0; // tab was in the background: skip the backlog
      if (out.length) this.socket.emit('in', this.seq - out.length + 1, out);
      if (this.pending.length > 180) this.pending.splice(0, this.pending.length - 180);
      const k = Math.exp(-dt * 0.014);
      this.offX *= k;
      this.offY *= k;
      if (Math.abs(this.offX) < 0.05) this.offX = 0;
      if (Math.abs(this.offY) < 0.05) this.offY = 0;
    }

    const players = [];
    const cur = this.cur;
    let me = null;
    if (cur) {
      const rt = now / TICK_MS + this.offset - INTERP_TICKS;
      for (let slot = 0; slot < 4; slot++) {
        const latest = cur.players[slot];
        if (!latest) continue;
        const base = {
          slot,
          name: this.names[slot] || `Player ${slot + 1}`,
          immune: latest.immune,
          itTicks: latest.itTicks,
          local: slot === this.mySlot,
        };
        if (slot === this.mySlot && this.predicting) {
          const p = this.pred;
          const a = Math.min(1, this.acc / TICK_MS);
          // do not smear a portal hop or a respawn across the screen
          const jumpy = Math.abs(p.y - this.prevY) + Math.abs(p.x - this.prevX) > 70 || p.dead > 0;
          players.push({
            ...base,
            x: (jumpy ? p.x : this.prevX + (p.x - this.prevX) * a) + this.offX,
            y: (jumpy ? p.y : this.prevY + (p.y - this.prevY) * a) + this.offY,
            vx: p.vx,
            vy: p.vy,
            ground: p.ground,
            face: p.face,
            stun: p.stun,
            frz: p.frz,
            dash: p.dashT > 0,
            spd: p.spd,
            jmp: p.jmp,
            shd: p.shd,
            dead: p.dead,
          });
          me = { dashCd: p.dashCd, spd: p.spd, jmp: p.jmp, shd: p.shd };
        } else {
          players.push({ ...base, ...sample(this.hist[slot], rt, this.phase === 'over') });
        }
      }
    }

    let timeLeft = this.round.duration;
    if (cur && cur.playing) {
      const serverTick = this.phase === 'over' ? cur.tick : now / TICK_MS + this.offset;
      timeLeft = Math.max(0, (cur.left - (serverTick - cur.tick)) / TICK_RATE);
      const sec = Math.ceil(timeLeft);
      if (this.phase === 'playing' && sec !== this.lastSecond) {
        if (sec <= 5 && sec >= 1 && this.lastSecond !== -1) this.onEvent('tick', sec);
        this.lastSecond = sec;
      }
    }
    const goAge = this.goTime != null ? (now - this.goTime) / 1000 : null;
    return {
      phase: this.phase === 'idle' ? 'countdown' : this.phase,
      mode: this.round.mode,
      countdownMs: this.phase === 'countdown' ? Math.max(0, this.countdownEnd - now) : null,
      goAge,
      timeLeft,
      duration: this.round.duration,
      it: this.phase === 'countdown' ? -1 : this.it,
      players,
      pickups: this.pickups,
      me: this.phase === 'playing' ? me : null,
      hud: true,
      code: this.code,
      ping: this.ping,
      banner: this.mySlot < 0 && this.phase !== 'over' ? "Spectating - you're in the next round" : null,
      pointYou: this.mySlot >= 0 && (this.phase === 'countdown' || (goAge != null && goAge < 2.5)),
    };
  }
}

const pose = (p) => ({ vx: p.vx, vy: p.vy, ground: p.ground, face: p.face, stun: p.stun, frz: p.frz, dash: p.dash, spd: p.spd, jmp: p.jmp, shd: p.shd });

// Position of a remote player at render time `rt` (in server ticks).
function sample(h, rt, freeze) {
  const last = h[h.length - 1];
  if (freeze || h.length === 1 || rt >= last.t) {
    // ran out of snapshots: coast on the last known velocity for a moment
    const ahead = freeze ? 0 : Math.min(rt - last.t, MAX_EXTRAPOLATE);
    const k = last.dead > 0 || ahead <= 0 ? 0 : ahead / TICK_RATE;
    return { ...pose(last), x: last.x + last.vx * k, y: last.y + (last.ground ? 0 : last.vy * k), dead: last.dead };
  }
  let i = h.length - 2;
  while (i > 0 && h[i].t > rt) i--;
  const a = h[i];
  const b = h[i + 1];
  if (rt <= a.t) return { ...pose(a), x: a.x, y: a.y, dead: a.dead };
  // portals and respawns are jumps, not glides
  const teleport = a.dead > 0 || b.dead > 0 || Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 130;
  const f = teleport ? 1 : (rt - a.t) / (b.t - a.t);
  return {
    ...pose(b),
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    ground: f > 0.5 ? b.ground : a.ground,
    dead: teleport ? b.dead : a.dead,
  };
}
