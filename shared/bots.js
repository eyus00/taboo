// Computer players for practice mode and the matches behind the menus.
//
// A bot knows the arena as a route map (see nav.js). Each one decides where it
// wants to be - chasing someone, running away, wandering, grabbing a lucky box,
// stealing a flag - and then follows the route there one move at a time,
// pressing the same buttons a person would.

import { PW, PH, IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN, IN_USE, ITEM_KINDS } from './config.js';
import { buildNav, surfaceAt, surfaceNear, drive, walk } from './nav.js';

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
    direct: null, // { slot, flee } when simply running at / away from someone nearby
    plan: null, // the move currently being made
    surf: -1, // surface we last stood on
    target: -1, // who we are chasing
    chase: 0, // ticks spent chasing them
    snub: -1, // someone we gave up on for a while
    snubT: 0,
    fear: 0, // how long we have been run ragged: nobody keeps their guard up for ever
    nerve: 1, // 1 = wide awake; lower = slower to notice and to react
    itWho: -1, // who was it when we last looked, and since when
    itSince: 0,
    hadFlag: false, // team battle: were we carrying their flag last tick?
    flagWait: 0, // ticks to keep clear of their flag after having it taken back off us
    awayUntil: 0, // their flag is guarded: no point trying again before this tick
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
const NEAR = 13; // close enough to where we wanted to stand
const gap = (a, b) => Math.hypot(a.s.x - b.s.x, a.s.y - b.s.y);

// Returns input bits for this tick.
export function botThink(sim, slot, mem) {
  const me = sim.players[slot];
  if (!me) return 0;
  const s = me.s;
  if (s.dead > 0 || s.stun > 0 || s.frz > 0 || s.orb > 0) {
    mem.plan = null;
    mem.pressed = 0;
    mem.rejump = 0;
    return 0;
  }
  const nav = navOf(sim.arena);
  const rnd = mem.rnd;
  const cx = s.x + PW / 2;
  const feet = s.y + PH;

  // where am I? (Where two pieces of ground meet, stay with the one we were on
  // for a step or two: flipping between them means flipping between their plans.)
  if (s.ground) {
    const was = mem.surf >= 0 ? nav.surfaces[mem.surf] : null;
    const cur = was && stillOn(nav, was, cx, feet, s.gk) ? was : surfaceAt(nav, cx, feet, s.gk);
    const id = cur ? cur.id : -1;
    if (id !== mem.surf) {
      mem.surf = id;
      mem.plan = null; // landed somewhere: whatever move we were making is over
    }
    if (Math.abs(s.x - mem.lastX) < 0.4) mem.stuck++;
    else mem.stuck = 0;
    mem.airT = 0;
  } else {
    mem.stuck = 0;
    mem.airT++;
  }
  mem.lastX = s.x;

  // Team battle: a defender just took their flag back off us. Standing there
  // only gets it taken back again and again: jump clear and stay away a moment.
  let hop = false;
  if (sim.flags) {
    const theirs = sim.flags[1 - me.team];
    const home = sim.flags[me.team].home;
    const has = theirs.carrier === slot;
    if (mem.hadFlag && !has && Math.hypot(cx - home[0], feet - home[1]) > 80) {
      mem.flagWait = 150;
      mem.think = 0;
      hop = s.ground;
    }
    mem.hadFlag = has;
    if (mem.flagWait > 0) mem.flagWait--;
  }

  // decide what to do next (but never half way through a jump we planned)
  if (--mem.think <= 0 && (s.ground || !mem.plan || mem.airT > 150)) {
    mem.think = Math.round((5 + rnd() * 5) / (slot === sim.it ? 1 : mem.nerve));
    decide(sim, me, mem, nav);
  }
  if (mem.snubT > 0 && --mem.snubT === 0) mem.snub = -1;

  let bits = mem.direct ? pursue(sim, me, mem, nav) : travel(sim, me, mem, nav);
  if (hop) bits |= IN_JUMP;
  if (sim.flags && !mem.hadFlag && sim.it !== slot && s.ground) {
    // about to step onto their flag stand with one of them close enough to touch us: don't
    const [hx, hy] = sim.flags[1 - me.team].home;
    if (sim.flags[1 - me.team].carrier < 0 && Math.abs(cx - hx) < 80 && Math.abs(feet - hy) < 60) {
      for (const o of sim.players) {
        if (!o || o.team === me.team || o.s.dead > 0 || o.s.stun > 0 || o.s.frz > 0) continue;
        if (Math.abs(o.s.x - s.x) < 110 && Math.abs(o.s.y - s.y) < 90) {
          bits = dirBits(cx - hx || 1);
          mem.flagWait = Math.max(mem.flagWait, 90);
          mem.awayUntil = Math.max(mem.awayUntil, sim.tick + 200);
          mem.think = 0;
          break;
        }
      }
    }
  }

  // Floating in an updraft we never meant to ride (or hanging in the air for
  // ages): steer out sideways.
  if (!s.ground) {
    const z = nav.liftAt(cx, feet);
    const riding = mem.plan && mem.plan.e.type === 'lift' && !mem.direct;
    if (mem.escape === 0 && ((z && !riding && mem.airT > 45) || mem.airT > 300)) {
      mem.escape = 50;
      mem.plan = null;
      const g = mem.goal >= 0 ? nav.surfaces[mem.goal] : null;
      const want = g ? (g.x0 + g.x1) / 2 - cx : 0;
      mem.escDir = Math.abs(want) > 60 ? Math.sign(want) : rnd() < 0.5 ? -1 : 1;
      if (z && z.x - PW < 4) mem.escDir = 1; // against a wall: the only way out is the other way
      else if (z && z.x + z.w + PW > sim.arena.w - 4) mem.escDir = -1;
    }
    if (mem.escape > 0) {
      mem.escape--;
      bits = dirBits(mem.escDir);
      // bobbing at the top of a walled-in column: the jump the updraft gives back gets us out
      if (z && s.vy > -100 && s.air > 0 && !(mem.pressed & IN_JUMP)) bits |= IN_JUMP;
      else if (s.vy < 0 && mem.pressed & IN_JUMP) bits |= IN_JUMP;
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

// Could a player standing at (cx, feet) still be said to be on this surface?
function stillOn(nav, sf, cx, feet, gk) {
  if (sf.ramp) return gk !== 1 && cx > sf.lo - 20 && cx < sf.hi + 20 && Math.abs(nav.heightAt(sf, cx) - feet) <= 16;
  return Math.abs(sf.y - feet) <= 1 && cx > sf.x0 - 20 && cx < sf.x1 + 20 && !(gk === 1 && sf.oneway) && !(gk === 2 && !sf.oneway);
}

// Is now a good moment for the item in hand?
function wantsToUse(sim, me, mem) {
  if (mem.rnd() > 0.06) return false; // a human-ish delay, not the very first tick
  const kind = ITEM_KINDS[me.item - 1];
  let nearest = Infinity;
  for (const o of sim.targets(me)) nearest = Math.min(nearest, gap(o, me));
  if (me.slot === sim.it) {
    // chasing: anything that slows them down or speeds us up, once someone is in reach
    if (kind === 'swap') return nearest > 500;
    if (kind === 'goo') return nearest < 200;
    return nearest < (kind === 'blast' ? 600 : 480);
  }
  const it = sim.players[sim.it];
  let danger = it && sim.enemies(me, it) ? gap(it, me) : Infinity;
  if (sim.flags) {
    const mine = sim.flags[me.team];
    const theirs = sim.flags[1 - me.team];
    if (theirs.carrier === me.slot) danger = Math.min(danger, nearest); // carrying their flag: any of them will do
    // their flag is guarded and we are close: knock the guard out of the way
    if (theirs.carrier < 0 && Math.hypot(theirs.home[0] - me.s.x, theirs.home[1] - me.s.y) < 320 && (kind === 'freeze' || kind === 'blast' || kind === 'storm')) {
      if (sim.targets(me).some((o) => Math.hypot(o.s.x - theirs.home[0], o.s.y + PH - theirs.home[1]) < 110)) return true;
    }
    const thief = sim.players[mine.carrier];
    if (thief) {
      // someone is running off with ours: stop them
      const d = gap(thief, me);
      if (kind === 'blast') return d < 700; // makes them drop it
      if (kind === 'freeze' || kind === 'storm') return d < 900;
      if (kind === 'speed') return d < 900;
    }
  }
  if (kind === 'swap') return danger < 200; // let someone else stand here
  if (kind === 'goo') return danger < 260;
  return danger < (kind === 'storm' || kind === 'blast' ? 420 : 300);
}

// ----------------------------------------------------------------------------
// Deciding what to do
// ----------------------------------------------------------------------------
function decide(sim, me, mem, nav) {
  mem.direct = null;
  if (sim.it === me.slot && mem.itWho !== me.slot) {
    // just been tagged: go after somebody else for a while, not straight back at whoever did it
    if (mem.itWho >= 0) {
      mem.snub = mem.itWho;
      mem.snubT = 60 * 5;
    }
    mem.itWho = me.slot;
    mem.itSince = sim.tick;
  }
  if (sim.teams && sim.flags) return decideTeam(sim, me, mem, nav);
  if (sim.it === me.slot) {
    const prey = sim.players.filter((o) => o && o !== me && o.s.dead === 0);
    if (!hunt(sim, me, mem, nav, prey)) wander(sim, me, mem, nav, null);
    return;
  }
  mem.target = -1;
  const it = sim.players[sim.it];
  if (!evade(sim, me, mem, nav, it)) wander(sim, me, mem, nav, it);
}

// Team battle: the bomb to get rid of, their flag to steal, ours to keep.
function decideTeam(sim, me, mem, nav) {
  const bomber = sim.players[sim.it] || null;
  const mine = sim.flags[me.team];
  const theirs = sim.flags[1 - me.team];
  const foes = sim.players.filter((o) => o && o.team !== me.team && o.s.dead === 0);
  if (bomber === me) {
    // stick it on an enemy: the nearest, or better still the one running off with our flag
    if (!hunt(sim, me, mem, nav, foes, (o) => (mine.carrier === o.slot ? -450 : 0))) wander(sim, me, mem, nav, null);
    return;
  }
  mem.target = -1;
  const threat = bomber && bomber.team !== me.team ? bomber : null;
  // an enemy with the bomb close by: get away first, whatever else is going on
  // (but there is work to do, so not from as far off as in a plain game of tag -
  // and with their flag in hand, only when they are nearly on top of us)
  if (threat && evade(sim, me, mem, nav, threat, theirs.carrier === me.slot ? 300 : 420)) return;
  // their flag in our hands: take it home
  if (theirs.carrier === me.slot) return headFor(mem, nav, mine.home);
  // Jobs are shared out among those without the bomb, and swap round every so
  // often: one (two in a team of three) goes for their flag, the last one minds ours.
  const crew = sim.players.filter((o) => o && o.team === me.team && o !== bomber).sort((a, b) => a.slot - b.slot);
  const turn = (crew.indexOf(me) + Math.floor(sim.tick / 1500)) % crew.length;
  const around = (o, [x, y], r) => Math.hypot(o.s.x + PW / 2 - x, o.s.y + PH - y) < r;
  // (someone on their own goes for the flag, unless one of them is already near ours and we are the nearer to it)
  const lone = crew.length === 1;
  const attacker = lone
    ? !(foes.some((o) => o !== bomber && around(o, mine.home, 700)) && Math.hypot(me.s.x - mine.home[0], me.s.y - mine.home[1]) < Math.hypot(me.s.x - theirs.home[0], me.s.y - theirs.home[1]))
    : turn === 0 || (crew.length > 2 && turn === 1);
  // somebody is running off with our flag: run into them (the keeper always, the others if they are close)
  const thief = mine.carrier >= 0 ? sim.players[mine.carrier] : null;
  if (thief && thief.s.dead === 0 && (!attacker || lone || gap(thief, me) < 520) && hunt(sim, me, mem, nav, [thief])) return;
  if (attacker && theirs.carrier < 0) {
    // go and take it - unless one of them is standing right on it, or right
    // beside us as we get there (they would only take it straight back): then
    // go and do something else for a few seconds and try again
    if (sim.tick < mem.awayUntil) return wander(sim, me, mem, nav, threat);
    const guarded = mem.flagWait > 0 || foes.some((o) => o.s.stun === 0 && o.s.frz === 0 && (around(o, theirs.home, 150) || (gap(o, me) < 210 && around(o, theirs.home, 430))));
    if (!guarded || !around(me, theirs.home, 330)) return headFor(mem, nav, theirs.home);
    mem.awayUntil = sim.tick + 240 + Math.floor(mem.rnd() * 240);
    return wander(sim, me, mem, nav, threat);
  }
  // the keeper: when one of them comes sniffing round our flag, go and pace up and down beside it
  if (!attacker && mine.carrier < 0 && foes.some((o) => o !== bomber && around(o, mine.home, 600))) {
    if (mem.goalX == null || Math.abs(mem.goalX - mine.home[0]) > 140 || Math.abs(s0(me) - mem.goalX) < 16) headFor(mem, nav, [mine.home[0] + (mem.rnd() - 0.5) * 260, mine.home[1]]);
    return;
  }
  // nothing pressing: boxes, and a wander - the keeper stays on our side of the arena
  wander(sim, me, mem, nav, threat, attacker ? null : mine.home);
}

const s0 = (o) => o.s.x + PW / 2;

// Go and stand on a spot (a flag stand).
function headFor(mem, nav, [x, y]) {
  const surf = surfaceNear(nav, x, y);
  if (!surf) return;
  mem.roaming = false;
  mem.rest = 0;
  mem.goal = surf.id;
  mem.goalX = clamp(x, surf.x0 + 4, surf.x1 - 4);
}

// Is there a solid block between two points?
function walled(arena, x0, y0, x1, y1) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 24));
  for (const p of arena.platforms) {
    if (p.oneway) continue;
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h) return true;
    }
  }
  return false;
}

// Pick someone to chase: the nearest, with a bit of loyalty so we do not
// flip-flop, and a grudge timer so nobody gets hounded forever.
function hunt(sim, me, mem, nav, prey, bonus) {
  const s = me.s;
  const rnd = mem.rnd;
  const cx = s.x + PW / 2;
  const feet = s.y + PH;
  let best = null;
  let bestD = Infinity;
  for (const o of prey) {
    let d = Math.hypot(o.s.x - s.x, (o.s.y - s.y) * 1.3);
    if (o.immune > 25) d += 900;
    if (o.s.shd > 0) d += 250;
    if (o.slot === mem.target) d -= 140;
    if (o.slot === mem.snub) d += 700;
    if (bonus) d += bonus(o);
    d += rnd() * 60;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  if (!best) return false;
  if (best.slot === mem.target) {
    mem.chase += 8;
    if (mem.chase > 60 * 8 && prey.length > 1) {
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
  mem.rest = 0;
  const tcx = best.s.x + PW / 2;
  const tfeet = best.s.y + PH;
  const mine = s.ground && mem.surf >= 0 ? nav.surfaces[mem.surf] : null;
  const theirs = surfaceNear(nav, tcx, tfeet);
  const close = Math.abs(tcx - cx) < 200 && Math.abs(tfeet - feet) < 150 && !walled(sim.arena, cx, feet - 20, tcx, tfeet - 20);
  const sameRun = mine && theirs && mine.run === theirs.run && Math.abs(tfeet - feet) < 60;
  if (close || sameRun) {
    mem.direct = { slot: best.slot, flee: false };
  } else if (theirs) {
    mem.goal = theirs.id;
    mem.goalX = clamp(tcx, theirs.x0 + 8, theirs.x1 - 8);
  }
  return true;
}

// Keep away from someone dangerous. Returns false if they are no bother right now.
//   reach - how far off we start to care
function evade(sim, me, mem, nav, it, reach = 540) {
  const s = me.s;
  const rnd = mem.rnd;
  const cx = s.x + PW / 2;
  const feet = s.y + PH;
  const dist = it && it.s.dead === 0 ? Math.hypot(it.s.x - s.x, (it.s.y - s.y) * 1.2) : Infinity;
  const calm = !it || it.s.stun > 0 || it.s.frz > 0 || it.s.orb > 0 || me.immune > 30;
  // Nobody stays sharp for ever: the longer we have been hounded, and the longer
  // the same player has been it, the later we notice them coming and the slower
  // we react - so chases end.
  if (sim.it !== mem.itWho) {
    mem.itWho = sim.it;
    mem.itSince = sim.tick;
  }
  const bored = (sim.tick - mem.itSince) / 60;
  const nerve = (mem.nerve = clamp(1.2 - mem.fear / 600, 0.38, 1) * clamp(1.6 - bored / 30, 0.4, 1));
  if (dist > reach * nerve || (calm && dist > 170)) {
    mem.fear = Math.max(0, mem.fear - 4);
    return false;
  }
  mem.fear = Math.min(900, mem.fear + 8 * Math.min(1, 1 / (nerve * 3)));
  mem.roaming = false;
  mem.rest = 0;
  const ix = it.s.x + PW / 2;
  const iy = it.s.y + PH;
  if (dist < 130 && !calm && !walled(sim.arena, cx, feet - 20, ix, iy - 20)) {
    mem.direct = { slot: it.slot, flee: true };
    return true;
  }
  if (!s.ground || mem.surf < 0) return true; // decide again once we land
  // Run: weigh every way off this piece of ground (and simply running to its
  // far end) by how far from them it gets us.
  const here = nav.surfaces[mem.surf];
  const itAt = surfaceNear(nav, ix, iy);
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
    const takeoff = e.x ?? (e.xs ? nearest(e.xs, cx) : e.dir > 0 ? here.x1 : here.x0);
    const land = e.land ?? clamp(takeoff, b.x0 + 10, b.x1 - 10);
    let score = away(land, b.y);
    // do not run towards them to reach an exit
    if (Math.abs(takeoff - ix) < Math.abs(cx - ix) - 20 && Math.abs(iy - feet) < 120) score -= 260;
    score += Math.min(4, b.edges.length) * 14; // prefer places with ways out
    if (e.type === 'portal' || e.type === 'pad' || e.type === 'lift') score += 70;
    // somewhere they would take a while to follow us to is worth a lot
    if (itAt) score += Math.min(240, nav.dist[itAt.id][b.id]) * 0.5;
    consider(score, b.id, null);
  }
  if (pick) {
    mem.goal = pick.goal;
    mem.goalX = pick.goalX;
    mem.think += 10; // commit for a moment
  }
  return true;
}

// Nothing urgent: go somewhere interesting instead of standing in a corner.
//   threat - someone to keep clear of (or null)
//   home   - stay within reach of this spot (a keeper minding the flag), or null
function wander(sim, me, mem, nav, threat, home = null) {
  const s = me.s;
  const rnd = mem.rnd;
  if (mem.rest > 0) {
    mem.rest -= 8;
    mem.goal = -1;
    return;
  }
  const arrived = mem.goal >= 0 && s.ground && mem.surf === mem.goal && (mem.goalX == null || Math.abs(s.x + PW / 2 - mem.goalX) < 18);
  if (mem.goal >= 0 && !arrived && mem.roaming) return; // still on our way
  if (arrived && !sim.teams && rnd() < 0.55) {
    mem.rest = 30 + rnd() * 90; // take a breather and look around
    mem.goal = -1;
    return;
  }
  mem.roaming = true;
  const near = (x, y) => !home || (Math.abs(x - home[0]) < 520 && Math.abs(y - home[1]) < 400);
  // a lucky box lying around is worth the trip
  if (sim.boxes.length && !me.item && rnd() < 0.8) {
    let best = null;
    let bestD = Infinity;
    for (const point of sim.boxes) {
      const pt = sim.arena.pickups[point];
      const d = Math.hypot(pt.x - s.x, pt.y - s.y);
      const danger = threat ? Math.hypot(pt.x - threat.s.x, pt.y - threat.s.y) : 9999;
      if (d < bestD && danger > 260 && near(pt.x, pt.y)) {
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
  // otherwise any piece of ground that is not next to the threat
  for (let tries = 0; tries < 12; tries++) {
    const surf = nav.surfaces[Math.floor(rnd() * nav.surfaces.length)];
    const x = surf.x0 + rnd() * (surf.x1 - surf.x0);
    if (!near(x, surf.y)) continue;
    if (threat && Math.hypot(x - threat.s.x, surf.y - threat.s.y) < 380) continue;
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
  if (s.ground) {
    mem.rejump = 0;
    if (mem.goal < 0) return 0;
    const here = mem.surf >= 0 ? nav.surfaces[mem.surf] : null;
    if (!here) {
      // standing on a scrap of ground that is not on the map (between thorns
      // and a wall, say): hop to the nearest piece that is
      const feet = s.y + PH;
      let to = null;
      let bestD = Infinity;
      for (const b of nav.surfaces) {
        const d = Math.abs(clamp(cx, b.x0, b.x1) - cx) + Math.abs(b.y - feet) * 2;
        if (d < bestD) {
          bestD = d;
          to = b;
        }
      }
      const dir = to && Math.abs(clamp(cx, to.x0 + 8, to.x1 - 8) - cx) > 4 ? Math.sign(clamp(cx, to.x0 + 8, to.x1 - 8) - cx) : sim.arena.w / 2 > cx ? 1 : -1;
      return dirBits(dir) | (nav.hazard(cx, cx + dir * 70, feet) || mem.stuck > 6 ? IN_JUMP : 0);
    }
    const goal = nav.surfaces[mem.goal];
    if (here === goal) {
      mem.plan = null;
      if (mem.goalX == null || Math.abs(cx - mem.goalX) < NEAR) return 0;
      return walk(here, cx, mem.goalX);
    }
    if (!mem.plan || mem.plan.from !== mem.surf || mem.plan.goal !== mem.goal) {
      const e = nav.hop[mem.surf][mem.goal];
      if (!e) {
        mem.goal = -1;
        return 0;
      }
      mem.plan = { from: mem.surf, goal: mem.goal, e, tx: e.xs ? nearest(e.xs, cx) : e.x };
    }
    return drive(nav, mem.plan.e, s, mem, mem.plan.tx);
  }
  // in the air
  if (mem.plan) return drive(nav, mem.plan.e, s, mem, mem.plan.tx);
  return glide(nav, s, mem, mem.goal >= 0 ? nav.surfaces[mem.goal] : null);
}

// In the air with no move planned (knocked, thrown, teleported, respawned):
// come down on something - where we were heading if that is underneath us,
// otherwise the nearest ground that is.
function glide(nav, s, mem, want) {
  const cx = s.x + PW / 2;
  const feet = s.y + PH;
  let to = null;
  if (want && nav.heightAt(want, clamp(cx, want.x0, want.x1)) > feet - 10 && Math.abs(clamp(cx, want.x0, want.x1) - cx) < 80 + (want.y - feet) * 0.4) to = want;
  if (!to) to = nav.below(cx, feet - 6, null);
  if (!to) {
    let bestD = Infinity;
    for (const b of nav.surfaces) {
      const dy = nav.heightAt(b, clamp(cx, b.x0, b.x1)) - feet;
      if (dy < -30) continue;
      const d = Math.abs(clamp(cx, b.x0 + 14, b.x1 - 14) - cx) + dy * 0.3;
      if (d < bestD) {
        bestD = d;
        to = b;
      }
    }
  }
  if (!to) return 0;
  return drive(nav, { type: 'fall', from: to.id, to: to.id }, s, mem);
}

// Up close: run straight at them (or straight away from them).
function pursue(sim, me, mem, nav) {
  const o = sim.players[mem.direct.slot];
  if (!o || o.s.dead > 0 || o.s.orb > 0) {
    mem.direct = null;
    mem.think = 0;
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

  if (here && dir) {
    // What is the ground like a step ahead?
    const z = nav.hazard(cx + dir * 6, cx + dir * 58, feet);
    const pit = !nav.below(cx + dir * 44, feet - 4, null); // nothing at our level or anywhere under it
    if (z && z.kind === 'pad' && (flee || dy < -120)) {
      // a trampoline or launcher, and we could use the lift: straight in
    } else if (z || pit) {
      // thorns, a portal, a pit: is there somewhere to land on the far side?
      let far = false;
      for (const b of nav.surfaces) {
        const d = dir > 0 ? b.x0 - cx : cx - b.x1;
        if (d > 0 && d < 300 && Math.abs(b.y - feet) < 130) far = true;
      }
      if (far) bits |= IN_JUMP;
      else if (flee) {
        dir = -dir; // nowhere to go: back past them, over their head
        bits |= IN_JUMP;
      } else {
        mem.direct = null; // they are across a gap we cannot simply jump: take the proper way round
        mem.think = 0;
        return 0;
      }
    }
  } else if (!s.ground && s.vy > 0 && !nav.below(cx, feet - 6, null)) {
    // falling with nothing underneath: forget them, find the ground
    return glide(nav, s, mem, null);
  }

  if (flee) {
    // cornered against a wall: go over or under instead
    if (here && ((dir < 0 && cx - here.x0 < 26 && !here.openL && here.endL) || (dir > 0 && here.x1 - cx < 26 && !here.openR && here.endR))) {
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
