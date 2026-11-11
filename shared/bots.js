// Simple computer players. Used in the browser for practice mode and for the
// little matches that play behind the menus. They are deliberately beatable.

import { W, PW, PH, G_UP, EPS, IN_LEFT, IN_RIGHT, IN_JUMP } from './config.js';

const MAX_RISE = 140; // how high a bot trusts itself to jump
const MAX_GAP = 165; // how far across a pit

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
  return { rnd: rng(seed * 7919 + 13), think: 0, bits: 0, lastX: 0, stuck: 0, wander: 0, wdir: 0, dir: 1 };
}

// Is there anything to stand on below this point?
function floorUnder(arena, x, y) {
  if (x < 0 || x > W) return true; // walls, not pits
  for (const p of arena.platforms) {
    if (x >= p.x && x <= p.x + p.w && p.y >= y - 4) return true;
  }
  return false;
}

// The platform a player is standing on / hovering over.
function platUnder(arena, s) {
  let best = null;
  for (const p of arena.platforms) {
    if (s.x + PW - p.x <= EPS || p.x + p.w - s.x <= EPS || p.y < s.y + PH - 4) continue;
    if (!best || p.y < best.y) best = p;
  }
  return best;
}

// A platform right above my head that I would bonk into if I jumped here.
function ceilingAbove(arena, s, reach) {
  let best = null;
  for (const p of arena.platforms) {
    if (s.x + PW - p.x <= EPS || p.x + p.w - s.x <= EPS) continue;
    const bottom = p.y + p.h;
    if (bottom > s.y + EPS || bottom < s.y - reach) continue;
    if (!best || bottom > best.y + best.h) best = p;
  }
  return best;
}

// Something reachable on the far side of a pit?
function landingAhead(arena, s, dir, under) {
  const feet = s.y + PH;
  for (const p of arena.platforms) {
    if (p === under || p.y < feet - 120) continue;
    if (dir > 0) {
      const gap = p.x - (s.x + PW);
      if (p.x + p.w > s.x + PW + 16 && gap < MAX_GAP) return true;
    } else {
      const gap = s.x - (p.x + p.w);
      if (p.x < s.x - 16 && gap < MAX_GAP) return true;
    }
  }
  return false;
}

// Walk to the side of platform q, jump, then steer onto it.
function mount(arena, s, q, out) {
  const cx = s.x + PW / 2;
  const mid = q.x + q.w / 2;
  let ax = cx < mid ? q.x - PW - 3 : q.x + q.w + 3;
  if (ax < 0) ax = q.x + q.w + 3;
  if (ax > W - PW) ax = q.x - PW - 3;
  const feet = s.y + PH;
  if (s.ground) {
    if (feet <= q.y + 2) out.dir = cx < mid ? 1 : -1; // already level with it: just walk on
    else if (Math.abs(s.x - ax) > 7) out.dir = s.x < ax ? 1 : -1;
    else out.jump = true;
  } else if (s.y < q.y + q.h - 2) {
    // head is above the slab's underside: safe to steer in
    out.dir = cx < mid ? 1 : -1;
  } else {
    out.dir = Math.abs(s.x - ax) > 7 ? (s.x < ax ? 1 : -1) : 0;
  }
}

// Returns input bits for this tick.
export function botThink(sim, slot, mem) {
  const me = sim.players[slot];
  if (!me) return 0;
  const s = me.s;
  if (s.dead > 0 || s.stun > 0) {
    mem.bits = 0;
    return 0;
  }
  const arena = sim.arena;
  const rnd = mem.rnd;

  // Unstick: pushing against something on the ground and not moving -> hop.
  const pushing = mem.bits & (IN_LEFT | IN_RIGHT);
  if (pushing && s.ground && Math.abs(s.x - mem.lastX) < 0.3) mem.stuck++;
  else mem.stuck = 0;
  mem.lastX = s.x;

  // Between decisions keep doing the same thing - unless we are stuck or
  // about to run off an edge, which forces a rethink right now.
  let rethink = mem.stuck >= 5;
  if (pushing && s.ground) {
    const d = mem.bits & IN_RIGHT ? 1 : -1;
    if (!floorUnder(arena, d > 0 ? s.x + PW + 10 : s.x - 10, s.y + PH)) rethink = true;
  }
  if (--mem.think > 0 && !rethink) return guard(arena, s, mem.bits);
  mem.think = 4 + Math.floor(rnd() * 6);

  const out = { dir: 0, jump: false };
  const cx = s.x + PW / 2;
  const feet = s.y + PH;
  const under = platUnder(arena, s);
  const isIt = sim.it === slot;

  if (isIt) {
    let target = null;
    let best = Infinity;
    for (const o of sim.players) {
      if (!o || o === me || o.s.dead > 0) continue;
      const d = Math.abs(o.s.x - s.x) + 1.6 * Math.abs(o.s.y - s.y) + (o.immune > 20 ? 500 : 0);
      if (d < best) {
        best = d;
        target = o;
      }
    }
    if (target) {
      const tx = target.s.x + PW / 2;
      const tfeet = target.s.y + PH;
      const dx = tx - cx;
      const dy = tfeet - feet;
      const goal = platUnder(arena, target.s);
      if (dy < -30 && goal && goal !== under) {
        // Target is higher: climb towards it one reachable platform at a time.
        let q = null;
        if (goal.y >= feet - MAX_RISE) {
          q = goal;
        } else {
          let score = Infinity;
          for (const p of arena.platforms) {
            if (p === under || p.y > feet - 25 || p.y < feet - MAX_RISE) continue;
            const sc = Math.abs(p.x + p.w / 2 - tx) + 0.6 * Math.abs(p.x + p.w / 2 - cx);
            if (sc < score) {
              score = sc;
              q = p;
            }
          }
        }
        if (q) mount(arena, s, q, out);
        else out.dir = dx > 0 ? 1 : -1;
      } else if (dy > 30 && under && under !== goal && tx > under.x - 12 && tx < under.x + under.w + 12) {
        // Target is underneath this platform: step off its nearest open end.
        const toLeft = cx - under.x;
        const toRight = under.x + under.w - cx;
        const leftOpen = under.x > 4;
        const rightOpen = under.x + under.w < W - 4;
        out.dir = leftOpen && (!rightOpen || toLeft < toRight) ? -1 : 1;
      } else {
        out.dir = dx > 8 ? 1 : dx < -8 ? -1 : 0;
        // lunge when the target hops just out of reach
        if (s.ground && Math.abs(dx) < 70 && dy < -8 && !ceilingAbove(arena, s, 150)) out.jump = true;
      }
    }
  } else {
    const it = sim.players[sim.it];
    const threat = it && it.s.dead === 0 ? it : null;
    const dx = threat ? cx - (threat.s.x + PW / 2) : 0;
    const dist = Math.abs(dx);
    const dyAbs = threat ? Math.abs(feet - (threat.s.y + PH)) : 999;
    const danger = dist + 0.9 * dyAbs;
    if (!threat || danger > 290 || me.immune > 30) {
      // Nothing to worry about: mill around.
      if (--mem.wander <= 0) {
        mem.wander = 6 + Math.floor(rnd() * 16);
        const r = rnd();
        mem.wdir = r < 0.35 ? 0 : r < 0.675 ? -1 : 1;
      }
      out.dir = mem.wdir;
      if (s.ground && rnd() < 0.04 && !ceilingAbove(arena, s, 150)) out.jump = true;
    } else {
      out.dir = dx >= 0 ? 1 : -1;
      const wall = out.dir > 0 ? s.x > W - PW - 46 : s.x < 46;
      const edgeX = out.dir > 0 ? s.x + PW + 12 : s.x - 12;
      const pit = s.ground && !floorUnder(arena, edgeX, feet) && !landingAhead(arena, s, out.dir, under);
      if (wall || pit) {
        if (dist < 140 && dyAbs < 60) {
          // cornered: leap back over the chaser
          out.dir = -out.dir;
          if (s.ground && !ceilingAbove(arena, s, 150)) out.jump = true;
        } else if (dist < 220) {
          out.dir = 0;
        }
      } else if (s.ground && dist < 100 && dyAbs < 50 && rnd() < 0.7 && !ceilingAbove(arena, s, 150)) {
        out.jump = true;
      }
    }
  }

  // Pits and walls, for everyone.
  if (s.ground && out.dir !== 0) {
    const edgeX = out.dir > 0 ? s.x + PW + 10 : s.x - 10;
    if (!floorUnder(arena, edgeX, feet)) {
      if (landingAhead(arena, s, out.dir, under)) out.jump = true;
      else out.dir = 0;
    }
  }
  if (mem.stuck >= 5 && s.ground) {
    out.jump = true;
    mem.stuck = 0;
  }

  let bits = 0;
  if (out.dir < 0) bits |= IN_LEFT;
  if (out.dir > 0) bits |= IN_RIGHT;
  if (out.jump) bits |= IN_JUMP;
  mem.bits = bits & ~IN_JUMP; // a jump is only pressed on the tick it was decided
  return guard(arena, s, bits);
}

// Mid-air sanity: once over a pit, commit to the jump instead of changing
// your mind halfway, and never steer under a ledge while rising (that just
// bonks your head).
function guard(arena, s, bits) {
  if (s.ground) return bits;
  bits &= ~IN_JUMP;
  if (Math.abs(s.vx) > 40 && !floorUnder(arena, s.x + PW / 2, s.y + PH)) {
    bits = (bits & ~(IN_LEFT | IN_RIGHT)) | (s.vx > 0 ? IN_RIGHT : IN_LEFT);
  }
  const dir = bits & IN_RIGHT ? 1 : bits & IN_LEFT ? -1 : 0;
  if (dir !== 0 && s.vy < 0) {
    const rise = (s.vy * s.vy) / (2 * G_UP);
    const nx = s.x + dir * 22;
    for (const p of arena.platforms) {
      const bottom = p.y + p.h;
      if (bottom > s.y + EPS || bottom < s.y - rise) continue;
      const overlapNow = s.x + PW - p.x > EPS && p.x + p.w - s.x > EPS;
      const overlapNext = nx + PW - p.x > EPS && p.x + p.w - nx > EPS;
      if (!overlapNow && overlapNext) return bits & ~(IN_LEFT | IN_RIGHT);
    }
  }
  return bits;
}
