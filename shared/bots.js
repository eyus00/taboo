// Computer players for practice mode and the matches behind the menus.
//
// A bot knows the arena as a route map (see nav.js). Each one decides where it
// wants to be - chasing someone, running away, wandering, grabbing a power-up -
// and then follows the route there one hop at a time, pressing the same
// buttons a person would.

import { PW, PH, IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN, IN_USE, ITEM_KINDS } from './config.js';
import { buildNav, surfaceAt, surfaceNear } from './nav.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeBot(seed = 1) {
  return {
    rnd: rng(seed * 7919 + 13),
    think: 0, // ticks until the next decision
    goal: -1, // surface id we are heading for
    goalX: null, // where to stand once there
    direct: null, // { slot } when simply running at / away from someone nearby
    plan: null, // the hop currently being executed
    surf: -1, // surface we last stood on
    target: -1, // who we are chasing
    chase: 0, // ticks spent chasing them
    snub: -1, // someone we gave up on for a while
    snubT: 0,
    rest: 0, // ticks of standing around
    roaming: false,
    stuck: 0,
    lastX: 0,
    rejump: 0, // countdown to a second jump press
    airT: 0, // ticks since we last stood on something
    escape: 0, // ticks left of steering out of an updraft we did not mean to ride
    escDir: 1,
    pressed: 0, // bits sent last tick
  };
}

const navOf = (arena) => (arena.nav ||= buildNav(arena));
const dirBits = (d) => (d < 0 ? IN_LEFT : d > 0 ? IN_RIGHT : 0);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const NEAR = 13; // close enough to a take-off point

// Returns input bits for this tick.
export function botThink(sim, slot, mem) {
  const me = sim.players[slot];
  if (!me) return 0;
  const s = me.s;
  if (s.dead > 0 || s.stun > 0 || s.frz > 0 || s.orb > 0) {
    mem.plan = null;
    mem.pressed = 0;
    return 0;
  }
  const nav = navOf(sim.arena);
  const rnd = mem.rnd;
  const cx = s.x + PW / 2;
  const feet = s.y + PH;

  // where am I?
  if (s.ground) {
    const cur = surfaceAt(nav, cx, feet, s.gk === 1);
    const id = cur ? cur.id : -1;
    if (id !== mem.surf) {
      mem.surf = id;
      mem.plan = null; // landed somewhere: whatever hop we were on is over
    }
    if (Math.abs(s.x - mem.lastX) < 0.4) mem.stuck++;
    else mem.stuck = 0;
    mem.airT = 0;
  } else {
    mem.stuck = 0;
    mem.airT++;
  }
  mem.lastX = s.x;

  if (--mem.think <= 0) {
    mem.think = 5 + Math.floor(rnd() * 5);
    decide(sim, me, mem, nav);
  }
  if (mem.snubT > 0 && --mem.snubT === 0) mem.snub = -1;

  let bits = mem.direct ? pursue(sim, me, mem, nav) : travel(sim, me, mem, nav);

  // Floating in an updraft we never meant to ride (or hanging in the air for
  // ages): steer out sideways.
  if (!s.ground) {
    const z = nav.liftAt(cx, feet);
    const riding = mem.plan && mem.plan.e.type === 'lift' && !mem.direct;
    if (mem.escape === 0 && ((z && !riding && mem.airT > 45) || mem.airT > 240)) {
      mem.escape = 50;
      mem.plan = null;
      const g = mem.goal >= 0 ? nav.surfaces[mem.goal] : null;
      const want = g ? (g.x0 + g.x1) / 2 - cx : 0;
      mem.escDir = Math.abs(want) > 60 ? Math.sign(want) : rnd() < 0.5 ? -1 : 1;
    }
    if (mem.escape > 0) {
      mem.escape--;
      bits = dirBits(mem.escDir);
    }
  } else mem.escape = 0;

  // standing still against something for too long: shake loose
  if (mem.stuck > 50 && bits & (IN_LEFT | IN_RIGHT)) {
    mem.plan = null;
    mem.stuck = 0;
    bits |= IN_JUMP;
    mem.think = 0;
  }
  // holding an item: set it off when it would do some good
  if (me.item && me.arm === 0 && !sim.locked() && !(mem.pressed & IN_USE) && wantsToUse(sim, me, mem)) bits |= IN_USE;
  // a jump only counts when the button goes down, so never hold it across a landing
  if (s.ground && mem.pressed & IN_JUMP) bits &= ~IN_JUMP;
  mem.pressed = bits;
  return bits;
}

// Is now a good moment for the item in hand?
function wantsToUse(sim, me, mem) {
  if (mem.rnd() > 0.06) return false; // a human-ish delay, not the very first tick
  const kind = ITEM_KINDS[me.item - 1];
  const s = me.s;
  let nearest = Infinity;
  for (const o of sim.targets(me)) nearest = Math.min(nearest, Math.hypot(o.s.x - s.x, o.s.y - s.y));
  if (me.slot === sim.it) {
    // chasing: anything that slows them down or speeds us up, once someone is in reach
    if (kind === 'swap') return nearest > 500;
    if (kind === 'goo') return nearest < 200;
    return nearest < (kind === 'blast' ? 600 : 480);
  }
  const it = sim.players[sim.it];
  const danger = it && sim.enemies(me, it) ? Math.hypot(it.s.x - s.x, it.s.y - s.y) : Infinity;
  if (kind === 'swap') return danger < 200; // let someone else stand here
  if (kind === 'goo') return danger < 260;
  return danger < (kind === 'storm' || kind === 'blast' ? 420 : 300);
}

// ----------------------------------------------------------------------------
// Deciding what to do
// ----------------------------------------------------------------------------
function decide(sim, me, mem, nav) {
  const s = me.s;
  const rnd = mem.rnd;
  const cx = s.x + PW / 2;
  const feet = s.y + PH;
  const isIt = sim.it === me.slot;
  mem.direct = null;

  if (isIt) {
    // Pick someone to chase: the nearest, with a bit of loyalty so we do not
    // flip-flop, and a grudge timer so nobody gets hounded forever.
    let best = null;
    let bestD = Infinity;
    for (const o of sim.players) {
      if (!o || o === me || o.s.dead > 0) continue;
      let d = Math.hypot(o.s.x - s.x, (o.s.y - s.y) * 1.3);
      if (o.immune > 25) d += 900;
      if (o.s.shd > 0) d += 250;
      if (o.slot === mem.target) d -= 140;
      if (o.slot === mem.snub) d += 700;
      d += rnd() * 60;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return wander(sim, me, mem, nav);
    if (best.slot === mem.target) {
      mem.chase += 8;
      if (mem.chase > 60 * 7) {
        // this is going nowhere: try someone else for a while
        mem.snub = best.slot;
        mem.snubT = 60 * 4;
        mem.chase = 0;
      }
    } else {
      mem.target = best.slot;
      mem.chase = 0;
    }
    mem.roaming = false;
    const tcx = best.s.x + PW / 2;
    const tfeet = best.s.y + PH;
    const mine = s.ground && mem.surf >= 0 ? nav.surfaces[mem.surf] : null;
    const theirs = surfaceNear(nav, tcx, tfeet);
    const close = Math.abs(tcx - cx) < 200 && Math.abs(tfeet - feet) < 150;
    const sameRun = mine && theirs && (mine.id === theirs.id || (mine.ramp && mine.ramp === theirs.ramp));
    if (close || sameRun) {
      mem.direct = { slot: best.slot, flee: false };
    } else if (theirs) {
      mem.goal = theirs.id;
      mem.goalX = clamp(tcx, theirs.x0 + 8, theirs.x1 - 8);
    }
    return;
  }

  // not "it"
  mem.target = -1;
  const it = sim.players[sim.it];
  const dist = it && it.s.dead === 0 ? Math.hypot(it.s.x - s.x, (it.s.y - s.y) * 1.2) : Infinity;
  const calm = !it || it.s.stun > 0 || it.s.frz > 0 || it.s.orb > 0 || me.immune > 30;
  if (dist > 600 || (calm && dist > 170)) return wander(sim, me, mem, nav);
  mem.roaming = false;

  if (dist < 130 && !calm) {
    mem.direct = { slot: it.slot, flee: true };
    return;
  }
  if (!s.ground || mem.surf < 0) return; // decide again once we land
  // Run: weigh every way off this surface (and simply running to its far end)
  // by how far from "it" it gets us.
  const here = nav.surfaces[mem.surf];
  const ix = it.s.x + PW / 2;
  const iy = it.s.y + PH;
  const away = (x, y) => Math.hypot(x - ix, (y - iy) * 1.2);
  let bestScore = -Infinity;
  let pick = null;
  const consider = (score, goal, goalX) => {
    score += rnd() * 70;
    if (score > bestScore) {
      bestScore = score;
      pick = { goal, goalX };
    }
  };
  const farEnd = Math.abs(here.x0 - ix) > Math.abs(here.x1 - ix) ? here.x0 + 10 : here.x1 - 10;
  consider(away(farEnd, here.y) - (Math.abs(farEnd - cx) < 40 ? 160 : 0), here.id, farEnd);
  for (const e of here.edges) {
    const b = nav.surfaces[e.to];
    const takeoff = e.x ?? (e.xs ? nearest(e.xs, cx) : cx);
    const land = clamp(takeoff, b.x0 + 10, b.x1 - 10);
    let score = away(land, b.y);
    // do not run towards "it" to reach an exit
    if (Math.abs(takeoff - ix) < Math.abs(cx - ix) - 20 && Math.abs(iy - feet) < 120) score -= 260;
    score += Math.min(4, b.edges.length) * 14; // prefer places with ways out
    if (e.type === 'portal' || e.type === 'tramp' || e.type === 'lift') score += 70;
    consider(score, b.id, null);
  }
  if (pick) {
    mem.goal = pick.goal;
    mem.goalX = pick.goalX;
    mem.think += 10; // commit for a moment
  }
}

// Nothing urgent: go somewhere interesting instead of standing in a corner.
function wander(sim, me, mem, nav) {
  const s = me.s;
  const rnd = mem.rnd;
  if (mem.rest > 0) {
    mem.rest -= 8;
    mem.goal = -1;
    return;
  }
  const arrived = mem.goal >= 0 && s.ground && mem.surf === mem.goal && (mem.goalX == null || Math.abs(s.x + PW / 2 - mem.goalX) < 18);
  if (mem.goal >= 0 && !arrived && mem.roaming) return; // still on our way
  if (arrived && rnd() < 0.5) {
    mem.rest = 20 + rnd() * 50; // take a breather
    mem.goal = -1;
    return;
  }
  mem.roaming = true;
  const it = sim.players[sim.it];
  // a power-up lying around is worth the trip
  if (sim.boxes.length && !me.item && rnd() < 0.75) {
    let best = null;
    let bestD = Infinity;
    for (const point of sim.boxes) {
      const pt = sim.arena.pickups[point];
      const d = Math.hypot(pt.x - s.x, pt.y - s.y);
      const danger = it && it.slot !== me.slot ? Math.hypot(pt.x - it.s.x, pt.y - it.s.y) : 9999;
      if (d < bestD && danger > 260) {
        bestD = d;
        best = pt;
      }
    }
    const surf = best && surfaceNear(nav, best.x, best.y + 22);
    if (surf) {
      mem.goal = surf.id;
      mem.goalX = clamp(best.x, surf.x0 + 6, surf.x1 - 6);
      return;
    }
  }
  // otherwise any surface that is not next to "it"
  for (let tries = 0; tries < 6; tries++) {
    const surf = nav.surfaces[Math.floor(rnd() * nav.surfaces.length)];
    const x = surf.x0 + rnd() * (surf.x1 - surf.x0);
    if (it && it.slot !== me.slot && Math.hypot(x - it.s.x, surf.y - it.s.y) < 380) continue;
    mem.goal = surf.id;
    mem.goalX = x;
    return;
  }
}

function nearest(xs, x) {
  let best = xs[0];
  for (const v of xs) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
  return best;
}

// ----------------------------------------------------------------------------
// Getting there
// ----------------------------------------------------------------------------
function travel(sim, me, mem, nav) {
  const s = me.s;
  const cx = s.x + PW / 2;
  const feet = s.y + PH;
  if (mem.goal < 0) return 0;

  if (s.ground) {
    mem.rejump = 0;
    const here = mem.surf >= 0 ? nav.surfaces[mem.surf] : null;
    if (mem.surf === mem.goal) {
      mem.plan = null;
      if (mem.goalX == null || Math.abs(cx - mem.goalX) < NEAR) return 0;
      return walk(here, cx, mem.goalX);
    }
    if (mem.surf < 0) return dirBits(sim.arena.w / 2 - cx); // standing somewhere unmapped: head inwards
    if (!mem.plan || mem.plan.from !== mem.surf || mem.plan.goal !== mem.goal) {
      const e = nav.hop[mem.surf][mem.goal];
      if (!e) {
        mem.goal = -1;
        return 0;
      }
      mem.plan = { from: mem.surf, goal: mem.goal, e, tx: e.xs ? nearest(e.xs, cx) : e.x };
    }
    const { e, tx } = mem.plan;
    switch (e.type) {
      case 'walk':
        if (e.foot) {
          // up a slope from flat ground: you have to walk into its low end from outside
          if ((cx - tx) * e.dir > -6) return dirBits(-e.dir);
          return dirBits(e.dir);
        }
        return dirBits(e.dir); // along a slope, or off the end of a ledge onto one
      case 'fall':
        return walk(here, cx, tx + e.dir * 60);
      case 'hop': {
        // run to the lip and jump off it
        const atLip = e.dir > 0 ? cx >= tx - 12 : cx <= tx + 12;
        return atLip ? dirBits(e.dir) | IN_JUMP : walk(here, cx, tx + e.dir * 60);
      }
      case 'up':
        if (Math.abs(cx - tx) > NEAR) return walk(here, cx, tx);
        return IN_JUMP;
      case 'drop':
        if (Math.abs(cx - tx) > NEAR) return walk(here, cx, tx);
        return IN_DOWN;
      case 'portal':
        // a portal we just came out of will not take us until we step right out of it
        if (s.tp > 0) return dirBits(here.x1 - tx > tx - here.x0 ? 1 : -1);
        return walk(here, cx, tx) || IN_RIGHT;
      default: // trampoline, updraft: just walk into it
        return Math.abs(tx - cx) > 4 ? walk(here, cx, tx) : IN_RIGHT;
    }
  }

  // in the air
  if (!mem.plan) {
    // no plan (knocked, teleported...): drift towards the goal
    const g = nav.surfaces[mem.goal];
    return dirBits(clamp(cx, g.x0 + 12, g.x1 - 12) - cx);
  }
  const { e } = mem.plan;
  const b = nav.surfaces[e.to];
  const short = feet > b.y + 2; // still below where we are going
  if (e.type === 'lift' && short) {
    // stay in the column until it has carried us high enough
    return Math.abs(e.x - cx) > 8 ? dirBits(e.x - cx) : 0;
  }
  const aim = clamp(cx, b.x0 + 14, b.x1 - 14);
  let bits = Math.abs(aim - cx) > 5 ? dirBits(aim - cx) : 0;
  if (e.type === 'drop' || e.type === 'fall' || e.type === 'lift') return bits;
  // going up: hold jump for full height, and use the second jump if we are
  // about to come up short
  if (s.vy < 0 && mem.pressed & IN_JUMP) bits |= IN_JUMP; // keep holding, never a fresh press
  if (mem.rejump > 0) {
    if (--mem.rejump === 0) bits |= IN_JUMP;
    else bits &= ~IN_JUMP;
  } else if (short && s.air > 0 && s.vy > -90 && e.type !== 'portal' && e.type !== 'tramp') {
    mem.rejump = 2;
    bits &= ~IN_JUMP;
  }
  // hopping onto a solid block from the side: do not press into its wall too early
  if (!b.oneway && short && e.dir && s.vy < -200) {
    const lip = e.dir > 0 ? b.x0 - PW / 2 - 6 : b.x1 + PW / 2 + 6;
    if ((e.dir > 0 && cx > lip - 4) || (e.dir < 0 && cx < lip + 4)) bits &= ~(IN_LEFT | IN_RIGHT);
  }
  return bits;
}

// Walk along a surface to x, hopping over any trampoline in the way.
function walk(surf, cx, x) {
  const dir = x > cx ? 1 : -1;
  let bits = dirBits(dir);
  if (surf && surf.pads) {
    for (const t of surf.pads) {
      const near = dir > 0 ? t.x - cx : cx - (t.x + t.w);
      const beyond = dir > 0 ? x > t.x + t.w : x < t.x;
      if (beyond && near > -t.w && near < 50) bits |= IN_JUMP;
    }
  }
  // the low end of a slope in the way: hold down to pass underneath it
  if (surf && surf.feet) {
    for (const f of surf.feet) {
      const ahead = (f.x - cx) * dir; // > 0: still in front of us
      if (f.up === dir && ahead > -30 && ahead < 60 && (x - f.x) * dir > 0) bits |= IN_DOWN;
    }
  }
  return bits;
}

// Up close: run straight at them (or straight away from them).
function pursue(sim, me, mem, nav) {
  const o = sim.players[mem.direct.slot];
  if (!o || o.s.dead > 0 || o.s.orb > 0) {
    mem.direct = null;
    return 0;
  }
  const s = me.s;
  const rnd = mem.rnd;
  const cx = s.x + PW / 2;
  const feet = s.y + PH;
  const dx = o.s.x + PW / 2 - cx;
  const dy = o.s.y + PH - feet; // < 0: they are higher
  const flee = mem.direct.flee;
  let dir = flee ? (dx > 0 ? -1 : 1) : dx > 6 ? 1 : dx < -6 ? -1 : 0;
  let bits = 0;
  const here = s.ground && mem.surf >= 0 ? nav.surfaces[mem.surf] : null;
  // about to run off into a pit: jump for it
  if (here && dir && !nav.below(cx + dir * 44, feet + 2, null)) bits |= IN_JUMP;

  if (flee) {
    // cornered against a wall: go over or under instead
    if (here && ((dir < 0 && cx - here.x0 < 26 && !here.openL) || (dir > 0 && here.x1 - cx < 26 && !here.openR))) {
      if (here.oneway && rnd() < 0.5) bits |= IN_DOWN;
      else {
        dir = -dir;
        bits |= IN_JUMP;
      }
    }
    if (s.ground && Math.abs(dx) < 110 && Math.abs(dy) < 60 && rnd() < 0.3) bits |= IN_JUMP;
    else if (!s.ground && s.air > 0 && s.vy > 60 && Math.abs(dx) < 100 && rnd() < 0.2) bits |= IN_JUMP;
    if (s.vy < 0 && !s.ground && mem.pressed & IN_JUMP) bits |= IN_JUMP;
    return bits | dirBits(dir);
  }

  // chasing
  if (s.ground) {
    mem.rejump = 0;
    if (dy < -44 && Math.abs(dx) < 190) bits |= IN_JUMP;
    else if (dy > 70 && Math.abs(dx) < 60 && here && here.oneway) bits |= IN_DOWN;
  } else {
    if (s.vy < 0 && mem.pressed & IN_JUMP) bits |= IN_JUMP;
    if (mem.rejump > 0) {
      if (--mem.rejump === 0) bits |= IN_JUMP;
      else bits &= ~IN_JUMP;
    } else if (s.air > 0 && s.vy > -60 && dy < -30 && Math.abs(dx) < 170) {
      mem.rejump = 2;
      bits &= ~IN_JUMP;
    }
    if (dy > 120 && Math.abs(dx) < 80) bits |= IN_DOWN; // dive
  }
  return bits | dirBits(dir);
}
