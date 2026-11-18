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
  SPEED_BUFF_TICKS,
  JUMP_BUFF_TICKS,
  SHIELD_TICKS,
  FREEZE_IT_TICKS,
  FREEZE_RUNNERS_TICKS,
  BLAST_RADIUS,
  BLAST_STUN_TICKS,
  BLAST_KICK,
  STORM_TICKS,
  QUAKE_STUN_TICKS,
  QUAKE_POP,
  WARP_GAP,
  WARP_DROP,
  ECLIPSE_TICKS,
  DASH_TICKS,
  GHOST_TICKS,
  STAR_TICKS,
  IN_LEFT,
  IN_RIGHT,
  BOMB_STUN_TICKS,
  BOMB_POINTS,
  FLAG_HALF,
  FLAG_UP,
  FLAG_CAP_TICKS,
  FLAG_CROWD,
  FLAG_POINTS,
  FLAG_END_POINTS,
  BOMB_COST,
  BEAT_TICKS,
  SAFE_BONUS,
} from './config.js';
import { makeState, stepPlayer, isFree, portalAt } from './physics.js';

const HIST = 64; // ticks of position history kept for lag compensation
const kindId = (name) => ITEM_KINDS.indexOf(name) + 1;

export class Sim {
  constructor(arena, rnd = Math.random) {
    this.arena = arena;
    this.rnd = rnd;
    this.players = new Array(MAX_PLAYERS).fill(null); // indexed by slot
    this.it = -1; // who is it (always -1 in a team battle: there, players carry bombs - see `bomb` on each player)
    this.tick = 0;
    this.live = false; // true from GO: before that nobody is it and nothing happens
    this.events = []; // filled during a tick, drained by the owner
    this.twist = { grav: 1, speed: 1, items: 1 }; // round modifier (see TWISTS in config.js)
    // lucky boxes and items
    this.powerups = true;
    this.itemPool = null; // which kinds come out of the boxes: an array of ITEM_KINDS names (empty or null: all of them)
    this.boxes = []; // indices into arena.pickups where a box is waiting
    this.nextBox = Infinity; // set by start()
    // team battle (null teams = everyone for themselves)
    this.teams = null; // team (0 or 1) of each slot
    this.score = [0, 0];
    this.beat = 0; // ticks since the last beat (see payBeat)
    // flags: spots on the map. m is how far the flag is filled, from -FLAG_CAP_TICKS
    // (all team 0) to +FLAG_CAP_TICKS (all team 1); owner is -1 until one side has filled it
    this.flags = null; // [{ x, y, owner, m, pay }]
    this.bombPlan = null; // who gets a bomb at GO (drawn when the teams are set, so it can be shown beforehand)
    this.over = false; // the buzzer has gone and the bombs have blown: nothing counts any more
    // Lag compensation: how many ticks in the past each player sees the others.
    // 0 everywhere for local play; the server fills it in from measured latency.
    this.rewind = new Array(MAX_PLAYERS).fill(0);
    this.hx = this.rewind.map(() => new Float32Array(HIST));
    this.hy = this.rewind.map(() => new Float32Array(HIST));
  }

  add(slot, spawnIndex = slot) {
    const sp = this.arena.spawns[spawnIndex % this.arena.spawns.length];
    // item: 0 or 1 + index into ITEM_KINDS; arm: ticks until it can be used; ub: was USE held last tick
    // bomb: carrying one (team battle); boom: it went off on them; caps: flags they helped to take
    this.players[slot] = { slot, s: makeState(sp[0], sp[1]), immune: 0, itTicks: 0, tags: 0, item: 0, arm: 0, ub: 0, team: -1, bomb: false, boom: false, caps: 0 };
    this.hx[slot].fill(sp[0]);
    this.hy[slot].fill(sp[1]);
    return this.players[slot];
  }

  // Team battle: teams[slot] = 0 or 1. Call after every player has been added.
  setTeams(teams) {
    this.teams = teams;
    for (const p of this.players) if (p) p.team = teams[p.slot] ?? 0;
    this.flags = this.arena.bases.map(([x, y]) => ({ x, y, owner: -1, m: 0, pay: 0 }));
    this.bombPlan = this.pickBombs();
  }

  // Who starts with a bomb: one bomb for every two players, handed out to the
  // two teams in turn (a random one first), to a random player each time.
  pickBombs() {
    const all = this.active();
    const sides = [0, 1].map((t) => {
      const list = all.filter((p) => p.team === t).map((p) => p.slot);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(this.rnd() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    });
    const want = Math.max(1, Math.floor(all.length / 2));
    const out = [];
    let t = this.rnd() < 0.5 ? 0 : 1;
    while (out.length < want && (sides[0].length || sides[1].length)) {
      if (sides[t].length) out.push(sides[t].shift());
      t = 1 - t;
    }
    return out;
  }

  // is this player it (or, in a team battle, carrying a bomb)?
  isIt(p) {
    return !!p && (p.slot === this.it || p.bomb);
  }

  // slots of everyone carrying a bomb
  bombs() {
    return this.players.filter((p) => p && p.bomb).map((p) => p.slot);
  }

  // Remove a player (disconnect). If they were "it", someone else gets it; a
  // bomb they were carrying goes to one of their own team.
  remove(slot) {
    const gone = this.players[slot];
    if (!gone) return;
    this.players[slot] = null;
    if (gone.bomb && !this.over) {
      const pool = this.players.filter((p) => p && p.team === gone.team && !p.bomb);
      const heir = pool[Math.floor(this.rnd() * pool.length)];
      if (heir) {
        heir.bomb = true;
        this.events.push({ type: 'it', to: heir.slot });
      }
    }
    if (this.it === slot) {
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

  // GO: choose who is "it" (or use the one given) and start the box clock.
  start(itSlot = -1) {
    this.live = true;
    if (this.teams) {
      // the bombs go out as drawn - or are drawn again if somebody left meanwhile
      this.it = -1;
      let plan = (this.bombPlan || []).filter((slot) => this.players[slot]);
      if (plan.length !== Math.max(1, Math.floor(this.active().length / 2))) plan = this.pickBombs();
      this.bombPlan = plan;
      for (const slot of plan) this.players[slot].bomb = true;
    } else if (itSlot >= 0 && this.players[itSlot]) this.it = itSlot;
    else this.pickIt();
    this.nextBox = this.tick + Math.round(BOX_FIRST_TICKS / this.twist.items);
  }

  stepOne(slot, bits) {
    const pl = this.players[slot];
    if (!pl) return;
    const use = bits & IN_USE;
    if (use && !pl.ub) this.useItem(pl, bits);
    pl.ub = use;
    stepPlayer(pl.s, bits, this.arena, slot === this.it || pl.bomb, this.twist);
  }

  // Call once per tick after every player has been stepped.
  endTick() {
    this.updateBoxes();
    if (!this.over) {
      this.checkTag();
      if (this.teams && this.live) {
        // nothing counts before GO
        this.updateFlags();
        if (++this.beat >= BEAT_TICKS) this.payBeat();
      }
    }
    const i = this.tick % HIST;
    for (const o of this.players) {
      if (!o) continue;
      if (this.isIt(o) && !this.over) o.itTicks++; // time as it, or with a bomb in hand
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

  // Everyone who is it (one player) or carries a bomb (several) gets a chance to pass it on.
  checkTag() {
    if (!this.teams) return this.tagFrom(this.players[this.it]);
    for (const o of this.players) if (o && o.bomb) this.tagFrom(o);
  }

  tagFrom(it) {
    if (!it || it.s.dead > 0 || it.s.stun > 0 || it.s.frz > 0 || it.s.orb > 0) return;
    // "It" sees everyone else slightly in the past (network delay + smoothing),
    // so also accept a touch against where the target was on the tagger's screen.
    const back = Math.min(HIST - 2, this.rewind[it.slot] | 0);
    const i = back > 0 && this.tick > back ? (this.tick - back) % HIST : -1;
    let best = null;
    let bestD = Infinity;
    for (const o of this.players) {
      if (!o || o === it || o.s.dead > 0 || o.immune > 0 || o.s.orb > 0 || o.s.inv > 0) continue; // nobody is tagged mid-portal, and nothing touches a Titan
      if (!this.enemies(it, o) || o.bomb) continue; // a bomb only sticks to the other team, and nobody carries two
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
    if (this.teams) {
      it.bomb = false;
      best.bomb = true;
    } else this.it = best.slot;
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
    if (!this.powerups || this.tick < this.nextBox || !pts.length || this.over) return; // (boxes keep coming right up to the buzzer)
    this.nextBox = this.tick + Math.round(BOX_EVERY_TICKS / this.twist.items);
    // (a crowd gets more boxes: one more for every two players beyond four)
    if (this.boxes.length >= BOX_MAX + (this.twist.items > 1 ? 2 : 0) + Math.floor(Math.max(0, this.active().length - 4) / 2)) return;
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
  // Only kinds from the host's pool (sim.itemPool), if there is one. (A pool of
  // Wards alone: whoever is it gets one all the same - it turns into a burst of speed.)
  rollItem(o) {
    const chosen = this.itemPool && this.itemPool.length ? ITEM_KINDS.filter((k) => this.itemPool.includes(k)) : ITEM_KINDS;
    const all = chosen.length ? chosen : ITEM_KINDS;
    const fit = all.filter((k) => !(k === 'shield' && this.isIt(o)));
    const pool = fit.length ? fit : all;
    return kindId(pool[Math.floor(this.rnd() * pool.length)]);
  }

  // Everyone the item should hit: the other side.
  //   everyone for themselves: all other players
  //   team battle: the enemy team
  // (not a Titan: nothing lands on one)
  targets(o) {
    return this.players.filter((t) => t && t !== o && t.s.dead === 0 && t.s.inv === 0 && this.enemies(o, t));
  }

  // Everyone on the other side who is in play, Titans included.
  foes(o) {
    return this.players.filter((t) => t && t !== o && t.s.dead === 0 && this.enemies(o, t));
  }

  // bits: what the player is holding this tick (a Dash goes the way they are steering)
  useItem(o, bits = 0) {
    const s = o.s;
    if (!o.item || o.arm > 0 || this.over || s.dead > 0 || s.stun > 0 || s.frz > 0 || s.orb > 0) return false; // (any time up to the buzzer)
    const kind = ITEM_KINDS[o.item - 1];
    o.item = 0;
    const cx = s.x + PW / 2;
    const cy = s.y + PH / 2;
    const ev = { type: 'use', slot: o.slot, kind: ITEM_KINDS.indexOf(kind), x: cx, y: cy, to: -1 };
    if (kind === 'speed') s.spd = SPEED_BUFF_TICKS;
    else if (kind === 'jump') s.jmp = JUMP_BUFF_TICKS;
    else if (kind === 'shield') {
      if (this.isIt(o)) s.spd = SPEED_BUFF_TICKS; // no use to "it": becomes a burst of speed
      else s.shd = SHIELD_TICKS;
    } else if (kind === 'freeze') {
      // a runner stops "it"; "it" stops every runner; in a team battle, the whole enemy team
      for (const t of this.targets(o)) {
        if (this.teams || o.slot === this.it) t.s.frz = Math.max(t.s.frz, FREEZE_RUNNERS_TICKS);
        else if (t.slot === this.it) t.s.frz = Math.max(t.s.frz, FREEZE_IT_TICKS);
      }
    } else if (kind === 'blast') {
      // a shockwave: hurled away and stunned (which also clears them off a flag)
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
    } else if (kind === 'quake') {
      // the ground jumps under everyone else, wherever they are: straight up, and out of it for a moment
      for (const t of this.targets(o)) {
        if (t.s.orb > 0) continue; // (a spark between portals has no ground under it)
        t.s.vy = Math.min(t.s.vy, -QUAKE_POP);
        t.s.vx = Math.round(t.s.vx * 30) / 100; // up, not away: nobody is thrown off their ledge
        t.s.ground = false;
        t.s.coyote = 0;
        t.s.nc = true; // (the same flag a trampoline sets: the throw is not cut short)
        t.s.stun = Math.max(t.s.stun, QUAKE_STUN_TICKS);
      }
    } else if (kind === 'warp') {
      const hop = this.warpFor(o);
      if (hop) {
        s.x = hop.x;
        s.y = hop.y;
        s.vx = s.vy = 0;
        s.ground = false;
        s.coyote = 0;
        s.drop = 0;
        s.tp = 1; // (a portal we land in leaves us be)
        if (hop.to) s.face = hop.to.s.x + PW / 2 < s.x + PW / 2 ? -1 : 1;
        ev.to = hop.to ? hop.to.slot : -1;
        ev.tx = s.x + PW / 2; // where we came out (x, y is where we went in)
        ev.ty = s.y + PH / 2;
      }
    } else if (kind === 'eclipse') {
      for (const t of this.targets(o)) t.s.ecl = ECLIPSE_TICKS;
    } else if (kind === 'ghost') {
      // nobody else is shown where we are (the browsers see to that: see PF_GHOST); a touch still counts
      s.gho = GHOST_TICKS;
    } else if (kind === 'star') {
      // nothing touches us: no tag, no bomb, no item (see targets() and tagFrom()), no thorns (physics) -
      // and whatever was already on us is shaken off
      s.inv = STAR_TICKS;
      s.slw = 0;
      s.ecl = 0;
    } else if (kind === 'dash') {
      // straight ahead: the way they are steering right now, else the way they face
      const dir = (bits & IN_RIGHT ? 1 : 0) - (bits & IN_LEFT ? 1 : 0);
      if (dir) s.face = dir;
      s.dsh = DASH_TICKS;
      s.drop = 0;
      ev.dir = s.face;
    }
    this.events.push(ev);
    return true;
  }

  // Warp. Where does this player come out?
  //   whoever is it (or carries a bomb): right beside the nearest player they could tag
  //   anyone else: on the standing spot furthest from whoever is after them
  // Always somewhere a player can stand: see standsAt() and warpSpots().
  // Returns { x, y, to: the player warped to, if any } or null (nobody to warp to or from).
  warpFor(o) {
    const arena = this.arena;
    const s = o.s;
    const foes = this.foes(o);
    const far = (a, x, y) => Math.hypot(a.s.x - x, a.s.y - y);
    if (this.isIt(o)) {
      // (someone still protected after a tag only if there is nobody else; never a spark between portals)
      const prey = foes.filter((t) => !t.bomb && t.s.orb === 0);
      let best = null;
      let bestD = Infinity;
      for (const t of prey) {
        const d = far(t, s.x, s.y) + (t.immune > 0 || t.s.inv > 0 ? 1e6 : 0);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (!best) return null;
      const t = best.s;
      // On the side they are running towards (standing still: the side we came from), else the
      // other side, else right where they are. Level with them if they are on the ground; under
      // them if they are in the air.
      const ahead = t.vx > 40 ? 1 : t.vx < -40 ? -1 : s.x < t.x ? -1 : 1;
      const step = PW + WARP_GAP;
      let pick = null;
      let least = Infinity;
      for (const [dx, cost] of [[ahead * step, 0], [-ahead * step, 1], [0, t.ground ? WARP_DROP + 2 : 2]]) {
        const at = t.ground ? standsAt(arena, t.x + dx, t.y, WARP_DROP, 28, 24) : standsAt(arena, t.x + dx, t.y, 420, 90);
        if (!at) continue;
        const score = Math.abs(at[1] - t.y) + cost;
        if (score < least) {
          least = score;
          pick = at;
        }
      }
      if (!pick) {
        // they are over a pit, in thorns, on a trampoline...: the standing spot nearest to them
        let d0 = Infinity;
        for (const sp of warpSpots(arena)) {
          const d = far(best, sp[0], sp[1]);
          if (d < d0) {
            d0 = d;
            pick = sp;
          }
        }
      }
      return pick ? { x: pick[0], y: pick[1], to: best } : null;
    }
    // running away: from every enemy who could tag us (failing that - a team game with all the bombs on our side - from every enemy)
    let threats = foes.filter((t) => this.isIt(t));
    if (!threats.length) threats = foes;
    if (!threats.length) return null;
    let pick = null;
    let most = -1;
    for (const sp of warpSpots(arena)) {
      let d = Infinity;
      for (const t of threats) d = Math.min(d, far(t, sp[0], sp[1]));
      if (d > most) {
        most = d;
        pick = sp;
      }
    }
    return pick ? { x: pick[0], y: pick[1], to: null } : null;
  }

  // --- team battle -----------------------------------------------------------------
  // Flags: whichever side has more players standing in a flag's ring fills it
  // with its colour (equal numbers: nothing moves). Full, the flag is theirs
  // and is worth points to them if they still hold it at the buzzer. Emptied back to nothing by the
  // other side, it is nobody's again.
  updateFlags() {
    const CAP = FLAG_CAP_TICKS;
    this.flags.forEach((f, i) => {
      const n = [0, 0];
      const there = [];
      for (const o of this.players) {
        if (!o || o.s.dead > 0 || o.s.orb > 0) continue;
        const feet = o.s.y + PH;
        if (Math.abs(o.s.x + PW / 2 - f.x) > FLAG_HALF || feet > f.y + 6 || feet < f.y - FLAG_UP) continue;
        n[o.team]++;
        there.push(o);
      }
      const d = n[1] - n[0];
      if (d !== 0) f.m = Math.max(-CAP, Math.min(CAP, f.m + Math.sign(d) * Math.min(FLAG_CROWD, Math.abs(d))));
      else if (!n[0]) {
        // nobody there: a flag settles back to where it belongs (its owner's colour, or nothing)
        const rest = f.owner < 0 ? 0 : f.owner === 0 ? -CAP : CAP;
        if (f.m !== rest) f.m += Math.sign(rest - f.m);
      }
      const full = f.m <= -CAP ? 0 : f.m >= CAP ? 1 : -1;
      if (full >= 0 && full !== f.owner) {
        f.owner = full;
        for (const o of there) if (o.team === full) o.caps++;
        this.events.push({ type: 'flag', what: 'take', team: full, i });
      } else if (f.owner >= 0 && (f.owner === 0 ? f.m >= 0 : f.m <= 0)) {
        this.events.push({ type: 'flag', what: 'lose', team: f.owner, i });
        f.owner = -1;
      }
    });
  }

  // The beat: every flag gives the team whose colour it is a point, then every bomb
  // takes one off the team holding it (never below nothing).
  payBeat() {
    this.beat = 0;
    this.flags.forEach((f, i) => {
      if (f.owner < 0) return;
      this.score[f.owner] += FLAG_POINTS;
      this.events.push({ type: 'flag', what: 'pay', team: f.owner, i, n: FLAG_POINTS });
    });
    for (const p of this.players) {
      if (!p || !p.bomb) continue;
      const n = Math.min(BOMB_COST, this.score[p.team]);
      this.score[p.team] -= n;
      this.events.push({ type: 'cost', slot: p.slot, team: p.team, n });
    }
  }

  // The buzzer, and what the round is really about: every flag pays the team whose
  // colour it is, and every bomb goes off on whoever holds it and scores for the OTHER
  // team. After this nothing counts: no tags, no flags.
  finish() {
    if (this.over) return;
    this.over = true;
    if (!this.teams) return;
    this.flags.forEach((f, i) => {
      if (f.owner < 0) return;
      this.score[f.owner] += FLAG_END_POINTS;
      this.events.push({ type: 'flag', what: 'end', team: f.owner, i, n: FLAG_END_POINTS });
    });
    for (const p of this.players) {
      if (!p || !p.bomb) continue;
      const to = 1 - p.team;
      this.score[to] += BOMB_POINTS;
      p.bomb = false;
      p.boom = true;
      p.s.stun = BOMB_STUN_TICKS;
      p.s.vy = -640;
      p.s.ground = false;
      // team: whose bomb it was; to: the side that scores; n: how much
      this.events.push({ type: 'boom', slot: p.slot, team: p.team, to, n: BOMB_POINTS, x: p.s.x + PW / 2, y: p.s.y + PH / 2 });
    }
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

// Would a player put down at (x, y) simply stand there? Tried with the real
// physics rather than worked out: a body is put there and has to come to rest
// unhurt - not in a wall, not over a pit, not in thorns, a portal, an updraft or
// on a trampoline - having dropped no more than `drop` px. `lift` starts it a
// little higher (ground that rises to one side of somebody).
// Returns where it stands, [x, y], or null.
export function standsAt(arena, x, y, drop = 4, ticks = 20, lift = 0) {
  const p = makeState(x, y);
  if (lift && isFree({ x, y: y - lift }, arena)) p.y = y - lift;
  if (!isFree(p, arena)) return null;
  let still = 0;
  for (let i = 0; i < ticks; i++) {
    stepPlayer(p, 0, arena);
    if (p.dead > 0 || p.stun > 0 || p.orb > 0 || p.vy < 0 || Math.abs(p.x - x) > 0.5) return null;
    if (!p.ground) still = 0;
    else if (++still >= 3) return p.y - y <= drop && portalAt(arena, p.x, p.y) < 0 ? [p.x, p.y] : null;
  }
  return null;
}

// Places in an arena where a player is known to stand: the starts, the respawn
// points, the flag stands and the ground under every lucky-box spot - each one
// tried out (see above), since thorns differ from match to match.
export function warpSpots(arena) {
  if (arena.warp && arena.warp.spawns === arena.spawns) return arena.warp.spots;
  const spots = [];
  const add = (x, y, drop) => {
    const at = standsAt(arena, x, y, drop, 40);
    if (at && !spots.some((q) => Math.abs(q[0] - at[0]) < 8 && Math.abs(q[1] - at[1]) < 8)) spots.push(at);
  };
  for (const [x, y] of arena.spawns) add(x, y, 4);
  for (const [x, y] of arena.respawns) add(x, y, 4);
  for (const [x, y] of arena.bases) add(x - PW / 2, y - PH, 4);
  for (const pt of arena.pickups) add(pt.x - PW / 2, pt.y - PH, 80); // (a box floats a little above the ground)
  arena.warp = { spawns: arena.spawns, spots };
  return spots;
}

// Final standings.
//   potato: whoever is "it" at the end loses, everyone else wins
//   time:   least time as "it" wins; exact ties share the win
//   team:   the team with more points wins (a draw is shared). Call sim.finish() first: the bombs score at the buzzer.
export function standings(sim, names = [], mode = 'potato') {
  const rows = sim.active().map((p) => ({
    slot: p.slot,
    name: names[p.slot] || `Player ${p.slot + 1}`,
    ticks: p.itTicks,
    tags: p.tags,
    team: p.team,
    boom: p.boom, // team battle: a bomb went off on them
    caps: p.caps, // and how many flags they helped to take
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

// Team battle with uneven sides: how many bots each side gets, so that both
// have as many players as the bigger one (as far as there is room for them).
//   sizes: [players on side 0, players on side 1]; room: free places
export function botFill(sizes, room) {
  const fill = [0, 0];
  const small = sizes[0] <= sizes[1] ? 0 : 1;
  fill[small] = Math.max(0, Math.min(room, Math.abs(sizes[0] - sizes[1])));
  return fill;
}

// Split players into two teams as evenly as possible: [slots of team 0, slots of team 1].
export function makeTeams(slots, rnd = Math.random) {
  const order = slots.slice().sort(() => rnd() - 0.5);
  const teams = [[], []];
  order.forEach((slot, i) => teams[i % 2].push(slot));
  return teams;
}
