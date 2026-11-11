// The rules of tag, independent of networking. The server owns one Sim per
// room; the browser uses the same class for practice mode and menu backdrops.

import { PW, PH, TOUCH, IMMUNE_TICKS, STUN_TICKS, IT_SPEED_MUL } from './config.js';
import { makeState, stepPlayer } from './physics.js';

export class Sim {
  constructor(arena) {
    this.arena = arena;
    this.players = [null, null, null, null]; // indexed by slot (0-3)
    this.it = -1;
    this.tick = 0;
    this.events = []; // filled during a tick, drained by the owner
  }

  add(slot, spawnIndex = slot) {
    const sp = this.arena.spawns[spawnIndex % this.arena.spawns.length];
    this.players[slot] = { slot, s: makeState(sp[0], sp[1], slot), immune: 0, itTicks: 0 };
    return this.players[slot];
  }

  // Remove a player (disconnect). If they were "it", someone else gets it.
  remove(slot, rnd = Math.random) {
    if (!this.players[slot]) return;
    this.players[slot] = null;
    if (this.it === slot) {
      this.it = -1;
      this.pickIt(rnd);
      if (this.it >= 0) this.events.push({ type: 'it', to: this.it });
    }
  }

  active() {
    return this.players.filter(Boolean);
  }

  pickIt(rnd = Math.random) {
    const a = this.active();
    this.it = a.length ? a[Math.floor(rnd() * a.length)].slot : -1;
    return this.it;
  }

  // Everything this player can bump into: platforms + other living players.
  solidsFor(slot) {
    const out = this.arena.platforms.slice();
    for (const o of this.players) {
      if (o && o.slot !== slot && o.s.dead === 0) out.push(o.s);
    }
    return out;
  }

  stepOne(slot, bits) {
    const pl = this.players[slot];
    if (!pl) return;
    stepPlayer(pl.s, bits, this.solidsFor(slot), slot === this.it ? IT_SPEED_MUL : 1);
  }

  // Call once per tick after every player has been stepped.
  endTick() {
    const it = this.players[this.it];
    if (it) {
      if (it.s.dead === 0 && it.s.stun === 0) {
        let best = null;
        let bestD = Infinity;
        for (const o of this.players) {
          if (!o || o === it || o.s.dead > 0 || o.immune > 0) continue;
          if (!touching(it.s, o.s)) continue;
          const dx = it.s.x - o.s.x;
          const dy = it.s.y - o.s.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = o;
          }
        }
        if (best) {
          it.immune = IMMUNE_TICKS; // no tag-backs
          best.s.stun = STUN_TICKS; // brief freeze so the old "it" can get away
          this.it = best.slot;
          this.events.push({ type: 'tag', from: it.slot, to: best.slot });
        }
      }
      const cur = this.players[this.it];
      if (cur) cur.itTicks++;
    }
    for (const o of this.players) if (o && o.immune > 0) o.immune--;
    this.tick++;
  }

  // Convenience: one input per slot, in rotating order so nobody gets a
  // permanent first-mover advantage in collisions.
  step(inputs) {
    for (let i = 0; i < 4; i++) {
      const slot = (i + this.tick) & 3;
      if (this.players[slot]) this.stepOne(slot, inputs[slot] | 0);
    }
    this.endTick();
  }
}

// "It" tags anyone whose body is touching theirs (players are solid, so
// touching rather than overlapping is the normal case).
export function touching(a, b) {
  return (
    a.x - TOUCH < b.x + PW && a.x + PW + TOUCH > b.x && a.y - TOUCH < b.y + PH && a.y + PH + TOUCH > b.y
  );
}

// Final standings: least time as "it" wins; exact ties share the win.
export function standings(sim, names = []) {
  const rows = sim.active().map((p) => ({
    slot: p.slot,
    name: names[p.slot] || `Player ${p.slot + 1}`,
    ticks: p.itTicks,
  }));
  rows.sort((a, b) => a.ticks - b.ticks || a.slot - b.slot);
  const best = rows.length ? rows[0].ticks : 0;
  const winners = rows.filter((r) => r.ticks === best).map((r) => r.slot);
  return { rows, winners };
}
