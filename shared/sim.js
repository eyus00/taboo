// The rules of tag, independent of networking. The server owns one Sim per
// room; the browser uses the same class for practice mode and the how-to-play
// demos.

import {
  MAX_PLAYERS,
  PW,
  PH,
  TOUCH,
  IMMUNE_TICKS,
  STUN_TICKS,
  BLOCK_STUN_TICKS,
  IN_USE,
  ITEM_KINDS,
  PICKUP_R,
  BOX_FIRST_TICKS,
  BOX_EVERY_TICKS,
  BOX_MAX,
  ITEM_ARM_TICKS,
  ITEM_LOCK_TICKS,
  SPEED_BUFF_TICKS,
  JUMP_BUFF_TICKS,
  SHIELD_TICKS,
  FREEZE_IT_TICKS,
  FREEZE_RUNNERS_TICKS,
  BLAST_RADIUS,
  BLAST_STUN_TICKS,
  BLAST_KICK,
  STORM_TICKS,
  GOO_TICKS,
  GOO_MAX,
  GOO_STUN_TICKS,
  BOMB_FUSE_TICKS,
  BOMB_MIN_FUSE,
  BOMB_REST_TICKS,
  BOMB_STUN_TICKS,
  BOMB_POINTS,
  FLAG_POINTS,
  FLAG_R,
  SAFE_BONUS,
} from './config.js';
import { makeState, stepPlayer } from './physics.js';

const HIST = 64; // ticks of position history kept for lag compensation
const kindId = (name) => ITEM_KINDS.indexOf(name) + 1;

export class Sim {
  constructor(arena, rnd = Math.random) {
    this.arena = arena;
    this.rnd = rnd;
    this.players = new Array(MAX_PLAYERS).fill(null); // indexed by slot
    this.it = -1; // who is it - in a team battle, who carries the bomb (-1: nobody right now)
    this.tick = 0;
    this.events = []; // filled during a tick, drained by the owner
    this.twist = { grav: 1, speed: 1, items: 1 }; // round modifier (see TWISTS in config.js)
    // lucky boxes and items
    this.powerups = true;
    this.boxes = []; // indices into arena.pickups where a box is waiting
    this.nextBox = Infinity; // set by start()
    this.goo = []; // puddles: { x, y, owner, until }
    this.endsAt = Infinity; // the tick the round ends on (items lock shortly before)
    // team battle (null teams = everyone for themselves)
    this.teams = null; // team (0 or 1) of each slot
    this.score = [0, 0];
    this.fuse = 0; // ticks until the bomb goes off
    this.rest = 0; // ticks until the next bomb appears
    this.nextTeam = 0; // which team the next bomb goes to
    this.flags = null; // flags[t] belongs to team t: { home: [x, y], x, y, carrier }
    // Lag compensation: how many ticks in the past each player sees the others.
    // 0 everywhere for local play; the server fills it in from measured latency.
    this.rewind = new Array(MAX_PLAYERS).fill(0);
    this.hx = this.rewind.map(() => new Float32Array(HIST));
    this.hy = this.rewind.map(() => new Float32Array(HIST));
  }

  add(slot, spawnIndex = slot) {
    const sp = this.arena.spawns[spawnIndex % this.arena.spawns.length];
    // item: 0 or 1 + index into ITEM_KINDS; arm: ticks until it can be used; ub: was USE held last tick
    this.players[slot] = { slot, s: makeState(sp[0], sp[1]), immune: 0, itTicks: 0, tags: 0, item: 0, arm: 0, ub: 0, team: -1 };
    this.hx[slot].fill(sp[0]);
    this.hy[slot].fill(sp[1]);
    return this.players[slot];
  }

  // Team battle: teams[slot] = 0 or 1. Call after every player has been added.
  setTeams(teams) {
    this.teams = teams;
    for (const p of this.players) if (p) p.team = teams[p.slot] ?? 0;
    this.flags = this.arena.bases.map(([x, y]) => ({ home: [x, y], x, y: y - PH, carrier: -1 }));
  }

  // Remove a player (disconnect). If they were "it", someone else gets it.
  remove(slot) {
    const gone = this.players[slot];
    if (!gone) return;
    this.players[slot] = null;
    if (this.flags) for (const f of this.flags) if (f.carrier === slot) this.sendHome(f);
    if (this.it === slot) {
      this.it = -1;
      if (this.teams) this.rest = 30;
      else {
        this.pickIt();
        if (this.it >= 0) this.events.push({ type: 'it', to: this.it });
      }
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

  // GO: choose who is "it" (or use the one given) and start the box clock.
  start(itSlot = -1) {
    if (itSlot >= 0 && this.players[itSlot]) this.it = itSlot;
    else this.pickIt();
    if (this.teams && this.it >= 0) {
      this.fuse = BOMB_FUSE_TICKS;
      this.nextTeam = 1 - this.players[this.it].team;
    }
    this.nextBox = this.tick + Math.round(BOX_FIRST_TICKS / this.twist.items);
  }

  // true once the round is nearly over: no more boxes, and items stop working
  locked() {
    return this.tick > this.endsAt - ITEM_LOCK_TICKS;
  }

  stepOne(slot, bits) {
    const pl = this.players[slot];
    if (!pl) return;
    const use = bits & IN_USE;
    if (use && !pl.ub) this.useItem(pl);
    pl.ub = use;
    stepPlayer(pl.s, bits, this.arena, slot === this.it, this.twist);
  }

  // Call once per tick after every player has been stepped.
  endTick() {
    this.updateBoxes();
    this.updateGoo();
    this.checkTag();
    if (this.teams) this.updateTeams();
    const cur = this.players[this.it];
    if (cur) cur.itTicks++;
    const i = this.tick % HIST;
    for (const o of this.players) {
      if (!o) continue;
      if (o.immune > 0) o.immune--;
      if (o.arm > 0) o.arm--;
      this.hx[o.slot][i] = o.s.x;
      this.hy[o.slot][i] = o.s.y;
    }
    this.tick++;
  }

  // are a and b on opposite sides? (always true when it is everyone for themselves)
  enemies(a, b) {
    return !this.teams || a.team !== b.team;
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
      if (!this.enemies(it, o)) continue; // the bomb only sticks to the other team
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
    if (this.teams) {
      this.fuse = Math.max(this.fuse, BOMB_MIN_FUSE);
      this.dropFlag(best.slot); // hands full
    }
    this.events.push({ type: 'tag', from: it.slot, to: best.slot });
  }

  // --- lucky boxes ----------------------------------------------------------------
  updateBoxes() {
    const pts = this.arena.pickups;
    for (let k = this.boxes.length - 1; k >= 0; k--) {
      const pt = pts[this.boxes[k]];
      for (const o of this.players) {
        if (!o || o.item || o.s.dead > 0 || o.s.orb > 0) continue; // one item at a time
        const cx = Math.max(o.s.x, Math.min(pt.x, o.s.x + PW));
        const cy = Math.max(o.s.y, Math.min(pt.y, o.s.y + PH));
        if ((cx - pt.x) ** 2 + (cy - pt.y) ** 2 > PICKUP_R * PICKUP_R) continue;
        o.item = this.rollItem(o);
        o.arm = ITEM_ARM_TICKS;
        this.events.push({ type: 'pick', slot: o.slot, kind: o.item - 1, point: this.boxes[k] });
        this.boxes.splice(k, 1);
        break;
      }
    }
    if (!this.powerups || this.tick < this.nextBox || !pts.length || this.locked()) return;
    this.nextBox = this.tick + Math.round(BOX_EVERY_TICKS / this.twist.items);
    if (this.boxes.length >= BOX_MAX + (this.twist.items > 1 ? 2 : 0) + (this.active().length > 4 ? 1 : 0)) return;
    const free = [];
    for (let p = 0; p < pts.length; p++) {
      if (this.boxes.includes(p)) continue;
      // not right on top of somebody
      const near = this.players.some((o) => o && Math.abs(o.s.x + PW / 2 - pts[p].x) < 140 && Math.abs(o.s.y + PH / 2 - pts[p].y) < 140);
      if (!near) free.push(p);
    }
    if (!free.length) return;
    const point = free[Math.floor(this.rnd() * free.length)];
    this.boxes.push(point);
    this.events.push({ type: 'spawn', point });
  }

  // What comes out of a box. Whoever is it has no use for a shield.
  rollItem(o) {
    const pool = ITEM_KINDS.filter((k) => !(k === 'shield' && o.slot === this.it));
    return kindId(pool[Math.floor(this.rnd() * pool.length)]);
  }

  // Everyone the item should hit: the other side.
  //   everyone for themselves: all other players
  //   team battle: the enemy team
  targets(o) {
    return this.players.filter((t) => t && t !== o && t.s.dead === 0 && this.enemies(o, t));
  }

  useItem(o) {
    const s = o.s;
    if (!o.item || o.arm > 0 || this.locked() || s.dead > 0 || s.stun > 0 || s.frz > 0 || s.orb > 0) return false;
    const kind = ITEM_KINDS[o.item - 1];
    o.item = 0;
    const cx = s.x + PW / 2;
    const cy = s.y + PH / 2;
    const ev = { type: 'use', slot: o.slot, kind: ITEM_KINDS.indexOf(kind), x: cx, y: cy, to: -1 };
    if (kind === 'speed') s.spd = SPEED_BUFF_TICKS;
    else if (kind === 'jump') s.jmp = JUMP_BUFF_TICKS;
    else if (kind === 'shield') {
      if (o.slot === this.it) s.spd = SPEED_BUFF_TICKS; // no use to "it": becomes a burst of speed
      else s.shd = SHIELD_TICKS;
    } else if (kind === 'freeze') {
      // a runner stops "it"; "it" stops every runner; in a team battle, the whole enemy team
      for (const t of this.targets(o)) {
        if (this.teams || o.slot === this.it) t.s.frz = Math.max(t.s.frz, FREEZE_RUNNERS_TICKS);
        else if (t.slot === this.it) t.s.frz = Math.max(t.s.frz, FREEZE_IT_TICKS);
      }
    } else if (kind === 'blast') {
      // a shockwave: hurled away, stunned, and anything carried is dropped
      for (const t of this.targets(o)) {
        if (t.s.orb > 0) continue;
        const dx = t.s.x + PW / 2 - cx;
        const dy = t.s.y + PH / 2 - cy;
        const d = Math.hypot(dx, dy);
        if (d > BLAST_RADIUS) continue;
        const k = 1 - (d / BLAST_RADIUS) * 0.5;
        t.s.vx = (d > 1 ? dx / d : 1) * BLAST_KICK * k;
        t.s.vy = -420 - 300 * k;
        t.s.ground = false;
        t.s.stun = Math.max(t.s.stun, BLAST_STUN_TICKS);
        this.dropFlag(t.slot);
      }
    } else if (kind === 'swap') {
      // trade places with someone on the other side (nothing happens if there is nobody)
      const pool = this.targets(o).filter((t) => t.s.orb === 0);
      const t = pool[Math.floor(this.rnd() * pool.length)];
      if (t) {
        const a = { x: s.x, y: s.y };
        s.x = t.s.x;
        s.y = t.s.y;
        t.s.x = a.x;
        t.s.y = a.y;
        s.vx = s.vy = t.s.vx = t.s.vy = 0;
        s.ground = t.s.ground = false;
        s.tp = t.s.tp = 1; // if either lands in a portal, it leaves them be
        o.immune = Math.max(o.immune, 30); // a beat to find your feet
        t.immune = Math.max(t.immune, 30);
        ev.to = t.slot;
      }
    } else if (kind === 'storm') {
      for (const t of this.targets(o)) t.s.slw = STORM_TICKS;
    } else if (kind === 'goo') {
      this.goo.push({ x: cx, y: s.y + PH, owner: o.slot, until: this.tick + GOO_TICKS });
      if (this.goo.length > GOO_MAX) this.goo.shift();
    }
    this.events.push(ev);
    return true;
  }

  updateGoo() {
    for (let k = this.goo.length - 1; k >= 0; k--) {
      const g = this.goo[k];
      if (this.tick >= g.until) {
        this.goo.splice(k, 1);
        continue;
      }
      for (const o of this.players) {
        // whoever dropped it knows where it is; so do their team mates
        if (!o || o.slot === g.owner || o.s.dead > 0 || o.s.orb > 0 || o.s.stun > 0) continue;
        const owner = this.players[g.owner];
        if (owner && !this.enemies(owner, o)) continue;
        if (Math.abs(o.s.x + PW / 2 - g.x) > 30 || Math.abs(o.s.y + PH - g.y) > 16) continue;
        o.s.stun = GOO_STUN_TICKS; // feet go from under you
        o.s.vy = -300;
        o.s.vx *= 0.4;
        o.s.ground = false;
        this.dropFlag(o.slot);
        this.events.push({ type: 'slip', slot: o.slot, x: g.x, y: g.y });
        this.goo.splice(k, 1);
        break;
      }
    }
  }

  // --- team battle -----------------------------------------------------------------
  updateTeams() {
    if (this.it >= 0) {
      if (--this.fuse <= 0) this.explode();
    } else if (--this.rest <= 0) this.giveBomb();
    this.updateFlags();
  }

  // The fuse ran out: the carrier's team loses, the other team scores.
  explode() {
    const p = this.players[this.it];
    if (!p) return;
    const scorer = 1 - p.team;
    this.score[scorer] += BOMB_POINTS;
    p.s.stun = BOMB_STUN_TICKS;
    p.s.vy = -640;
    p.s.ground = false;
    p.immune = BOMB_STUN_TICKS + 30;
    this.events.push({ type: 'boom', slot: p.slot, team: scorer, x: p.s.x + PW / 2, y: p.s.y + PH / 2 });
    this.it = -1;
    this.rest = BOMB_REST_TICKS;
    this.nextTeam = scorer; // the side that just scored carries the next one
  }

  giveBomb() {
    let pool = this.active().filter((p) => p.team === this.nextTeam && p.s.dead === 0);
    if (!pool.length) pool = this.active();
    if (!pool.length) return;
    const p = pool[Math.floor(this.rnd() * pool.length)];
    this.it = p.slot;
    this.fuse = BOMB_FUSE_TICKS;
    p.immune = 0;
    this.dropFlag(p.slot);
    this.events.push({ type: 'it', to: p.slot });
  }

  sendHome(f) {
    f.carrier = -1;
    f.x = f.home[0];
    f.y = f.home[1] - PH;
  }

  // If this player is carrying a flag, it goes back to its base.
  dropFlag(slot) {
    if (!this.flags) return;
    this.flags.forEach((f, team) => {
      if (f.carrier !== slot) return;
      this.sendHome(f);
      this.events.push({ type: 'flag', what: 'back', team, slot });
    });
  }

  updateFlags() {
    this.flags.forEach((f, team) => {
      const near = (o, x, y) => Math.abs(o.s.x + PW / 2 - x) < FLAG_R && Math.abs(o.s.y + PH - y) < FLAG_R + 14;
      if (f.carrier < 0) {
        // at home: an enemy with free hands (not the bomb carrier) takes it
        for (const o of this.players) {
          if (!o || o.team === team || o.slot === this.it || o.s.dead > 0 || o.s.orb > 0 || o.s.stun > 0) continue;
          if (this.flags.some((g) => g.carrier === o.slot) || !near(o, f.home[0], f.home[1])) continue;
          f.carrier = o.slot;
          this.events.push({ type: 'flag', what: 'take', team, slot: o.slot });
          break;
        }
        return;
      }
      const c = this.players[f.carrier];
      if (!c || c.s.dead > 0) return this.sendHome(f);
      f.x = c.s.x + PW / 2;
      f.y = c.s.y;
      if (c.s.orb > 0) return; // safe while flying through a portal
      // any defender who touches the carrier sends the flag home
      for (const o of this.players) {
        if (!o || o.team !== team || o.s.dead > 0 || o.s.orb > 0 || o.s.stun > 0 || o.s.frz > 0) continue;
        if (!touching(o.s.x, o.s.y, c.s.x, c.s.y)) continue;
        this.sendHome(f);
        this.events.push({ type: 'flag', what: 'save', team, slot: o.slot });
        return;
      }
      // carried all the way to the carrier's own base: points
      const base = this.flags[1 - team].home;
      if (near(c, base[0], base[1])) {
        this.score[c.team] += FLAG_POINTS;
        this.sendHome(f);
        this.events.push({ type: 'flag', what: 'capture', team: c.team, slot: c.slot });
      }
    });
  }

  // Convenience for local play: one input per slot.
  step(inputs) {
    for (let slot = 0; slot < MAX_PLAYERS; slot++) if (this.players[slot]) this.stepOne(slot, inputs[slot] | 0);
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
//   team:   the team with more points wins (a draw is shared)
export function standings(sim, names = [], mode = 'potato') {
  const rows = sim.active().map((p) => ({
    slot: p.slot,
    name: names[p.slot] || `Player ${p.slot + 1}`,
    ticks: p.itTicks,
    tags: p.tags,
    team: p.team,
  }));
  if (mode === 'team') {
    const [a, b] = sim.score;
    const win = a === b ? -1 : a > b ? 0 : 1;
    rows.sort((x, y) => x.team - y.team || x.ticks - y.ticks || x.slot - y.slot);
    return { rows, winners: rows.filter((r) => win < 0 || r.team === win).map((r) => r.slot), loser: -1, score: [a, b], win };
  }
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

// Split players into two teams as evenly as possible: [slots of team 0, slots of team 1].
export function makeTeams(slots, rnd = Math.random) {
  const order = slots.slice().sort(() => rnd() - 0.5);
  const teams = [[], []];
  order.forEach((slot, i) => teams[i % 2].push(slot));
  return teams;
}
