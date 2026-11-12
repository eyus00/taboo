// The rules of tag, independent of networking. The server owns one Sim per
// room; the browser uses the same class for practice mode and menu backdrops.

import {
  PW,
  PH,
  TOUCH,
  IMMUNE_TICKS,
  STUN_TICKS,
  BLOCK_STUN_TICKS,
  PICKUP_TYPES,
  PICKUP_R,
  PICKUP_FIRST_TICKS,
  PICKUP_EVERY_TICKS,
  PICKUP_MAX,
  SPEED_BUFF_TICKS,
  JUMP_BUFF_TICKS,
  SHIELD_TICKS,
  FREEZE_IT_TICKS,
  FREEZE_RUNNERS_TICKS,
  SAFE_BONUS,
} from './config.js';
import { makeState, stepPlayer } from './physics.js';

const HIST = 64; // ticks of position history kept for lag compensation

export class Sim {
  constructor(arena, rnd = Math.random) {
    this.arena = arena;
    this.rnd = rnd;
    this.players = [null, null, null, null]; // indexed by slot (0-3)
    this.it = -1;
    this.tick = 0;
    this.events = []; // filled during a tick, drained by the owner
    this.pickups = []; // { point, type } lying on the map
    this.nextPickup = Infinity; // set by start()
    this.powerups = true;
    this.twist = { grav: 1, speed: 1, items: 1 }; // round modifier (see TWISTS in config.js)
    // Lag compensation: how many ticks in the past each player sees the others.
    // 0 everywhere for local play; the server fills it in from measured latency.
    this.rewind = [0, 0, 0, 0];
    this.hx = [0, 1, 2, 3].map(() => new Float32Array(HIST));
    this.hy = [0, 1, 2, 3].map(() => new Float32Array(HIST));
  }

  add(slot, spawnIndex = slot) {
    const sp = this.arena.spawns[spawnIndex % this.arena.spawns.length];
    this.players[slot] = { slot, s: makeState(sp[0], sp[1]), immune: 0, itTicks: 0, tags: 0 };
    this.hx[slot].fill(sp[0]);
    this.hy[slot].fill(sp[1]);
    return this.players[slot];
  }

  // Remove a player (disconnect). If they were "it", someone else gets it.
  remove(slot) {
    if (!this.players[slot]) return;
    this.players[slot] = null;
    if (this.it === slot) {
      this.it = -1;
      this.pickIt();
      if (this.it >= 0) this.events.push({ type: 'it', to: this.it });
    }
  }

  active() {
    return this.players.filter(Boolean);
  }

  pickIt() {
    const a = this.active();
    this.it = a.length ? a[Math.floor(this.rnd() * a.length)].slot : -1;
    return this.it;
  }

  // GO: choose who is "it" (or use the one given) and start the power-up clock.
  start(itSlot = -1) {
    if (itSlot >= 0 && this.players[itSlot]) this.it = itSlot;
    else this.pickIt();
    this.nextPickup = this.tick + Math.round(PICKUP_FIRST_TICKS / this.twist.items);
  }

  stepOne(slot, bits) {
    const pl = this.players[slot];
    if (pl) stepPlayer(pl.s, bits, this.arena, slot === this.it, this.twist);
  }

  // Call once per tick after every player has been stepped.
  endTick() {
    this.updatePickups();
    this.checkTag();
    const cur = this.players[this.it];
    if (cur) cur.itTicks++;
    const i = this.tick % HIST;
    for (const o of this.players) {
      if (!o) continue;
      if (o.immune > 0) o.immune--;
      this.hx[o.slot][i] = o.s.x;
      this.hy[o.slot][i] = o.s.y;
    }
    this.tick++;
  }

  checkTag() {
    const it = this.players[this.it];
    if (!it || it.s.dead > 0 || it.s.stun > 0 || it.s.frz > 0 || it.s.orb > 0) return;
    // "It" sees everyone else slightly in the past (network delay + smoothing),
    // so also accept a touch against where the target was on the tagger's screen.
    const back = Math.min(HIST - 2, this.rewind[it.slot] | 0);
    const i = back > 0 && this.tick > back ? (this.tick - back) % HIST : -1;
    let best = null;
    let bestD = Infinity;
    for (const o of this.players) {
      if (!o || o === it || o.s.dead > 0 || o.immune > 0 || o.s.orb > 0) continue; // nobody is tagged mid-portal
      let hit = touching(it.s.x, it.s.y, o.s.x, o.s.y);
      if (!hit && i >= 0) hit = touching(it.s.x, it.s.y, this.hx[o.slot][i], this.hy[o.slot][i]);
      if (!hit) continue;
      const dx = it.s.x - o.s.x;
      const dy = it.s.y - o.s.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return;
    if (best.s.shd > 0) {
      // Ward: the tag bounces off and "it" is knocked back for a moment
      best.s.shd = 0;
      best.immune = IMMUNE_TICKS;
      it.s.stun = BLOCK_STUN_TICKS;
      it.s.vx = it.s.x < best.s.x ? -420 : 420;
      it.s.vy = -380;
      this.events.push({ type: 'block', from: it.slot, to: best.slot });
      return;
    }
    it.immune = IMMUNE_TICKS; // no tag-backs
    it.tags++;
    best.s.stun = STUN_TICKS; // brief freeze so the old "it" can get away
    this.it = best.slot;
    this.events.push({ type: 'tag', from: it.slot, to: best.slot });
  }

  updatePickups() {
    const pts = this.arena.pickups;
    // collect
    for (let k = this.pickups.length - 1; k >= 0; k--) {
      const pk = this.pickups[k];
      const pt = pts[pk.point];
      for (const o of this.players) {
        if (!o || o.s.dead > 0 || o.s.orb > 0) continue;
        const cx = Math.max(o.s.x, Math.min(pt.x, o.s.x + PW));
        const cy = Math.max(o.s.y, Math.min(pt.y, o.s.y + PH));
        if ((cx - pt.x) ** 2 + (cy - pt.y) ** 2 > PICKUP_R * PICKUP_R) continue;
        this.pickups.splice(k, 1);
        this.applyPickup(o, pk.type);
        this.events.push({ type: 'pick', slot: o.slot, kind: pk.type, point: pk.point });
        break;
      }
    }
    // spawn
    if (!this.powerups || this.tick < this.nextPickup || !pts.length) return;
    this.nextPickup = this.tick + Math.round(PICKUP_EVERY_TICKS / this.twist.items);
    if (this.pickups.length >= PICKUP_MAX + (this.twist.items > 1 ? 2 : 0)) return;
    const free = [];
    for (let p = 0; p < pts.length; p++) {
      if (this.pickups.some((k) => k.point === p)) continue;
      // not right on top of somebody
      const near = this.players.some((o) => o && Math.abs(o.s.x + PW / 2 - pts[p].x) < 140 && Math.abs(o.s.y + PH / 2 - pts[p].y) < 140);
      if (!near) free.push(p);
    }
    if (!free.length) return;
    const point = free[Math.floor(this.rnd() * free.length)];
    const type = Math.floor(this.rnd() * PICKUP_TYPES.length);
    this.pickups.push({ point, type });
    this.events.push({ type: 'spawn', point, kind: type });
  }

  applyPickup(o, type) {
    const kind = PICKUP_TYPES[type];
    const isIt = o.slot === this.it;
    if (kind === 'speed') o.s.spd = SPEED_BUFF_TICKS;
    else if (kind === 'jump') o.s.jmp = JUMP_BUFF_TICKS;
    else if (kind === 'shield') {
      if (!isIt) o.s.shd = SHIELD_TICKS; // "it" just smashes it so nobody else gets one
    } else if (kind === 'freeze') {
      // freezes the other side: a runner stops "it", "it" stops every runner
      for (const t of this.players) {
        if (!t || t === o || t.s.dead > 0) continue;
        if (isIt) t.s.frz = Math.max(t.s.frz, FREEZE_RUNNERS_TICKS);
        else if (t.slot === this.it) t.s.frz = Math.max(t.s.frz, FREEZE_IT_TICKS);
      }
    }
  }

  // Convenience for local play: one input per slot.
  step(inputs) {
    for (let slot = 0; slot < 4; slot++) if (this.players[slot]) this.stepOne(slot, inputs[slot] | 0);
    this.endTick();
  }
}

// "It" tags anyone it so much as grazes: the hitboxes only need to come
// within TOUCH pixels of each other.
export function touching(ax, ay, bx, by) {
  return ax - TOUCH < bx + PW && ax + PW + TOUCH > bx && ay - TOUCH < by + PH && ay + PH + TOUCH > by;
}

// Final standings.
//   potato: whoever is "it" at the end loses, everyone else wins
//   time:   least time as "it" wins; exact ties share the win
export function standings(sim, names = [], mode = 'potato') {
  const rows = sim.active().map((p) => ({
    slot: p.slot,
    name: names[p.slot] || `Player ${p.slot + 1}`,
    ticks: p.itTicks,
    tags: p.tags,
  }));
  if (mode === 'potato') {
    const loser = sim.it;
    rows.sort((a, b) => (a.slot === loser) - (b.slot === loser) || a.ticks - b.ticks || a.slot - b.slot);
    return { rows, winners: rows.filter((r) => r.slot !== loser).map((r) => r.slot), loser };
  }
  rows.sort((a, b) => a.ticks - b.ticks || a.slot - b.slot);
  const best = rows.length ? rows[0].ticks : 0;
  return { rows, winners: rows.filter((r) => r.ticks === best).map((r) => r.slot), loser: -1 };
}

// Tournament points for one round (rules in config.js): place points for least
// time as it, plus a bonus for everyone who is not it at the buzzer.
export function cupPoints(sim, double = false) {
  const rows = sim
    .active()
    .map((p) => ({ slot: p.slot, ticks: p.itTicks }))
    .sort((a, b) => a.ticks - b.ticks);
  const out = {};
  for (const r of rows) {
    const place = rows.findIndex((o) => o.ticks === r.ticks); // equal times share the better place
    out[r.slot] = (rows.length - 1 - place + (r.slot === sim.it ? 0 : SAFE_BONUS)) * (double ? 2 : 1);
  }
  return out;
}
