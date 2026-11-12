// Deterministic platformer physics for one player, one fixed step at a time.
//
// The server runs this to decide what really happened. The browser runs the
// exact same function to predict its own player without waiting for the
// server, and to replay inputs the server has not confirmed yet. State is
// rounded to 1/100 px after every step so both sides land on identical numbers.
//
// Players do not collide with each other, only with the arena - so a player's
// movement depends on nothing but their own inputs, and prediction is exact.

import {
  PW,
  PH,
  DT,
  MOVE_SPEED,
  IT_SPEED_MUL,
  GROUND_ACCEL,
  GROUND_TURN,
  GROUND_STOP,
  AIR_ACCEL,
  AIR_TURN,
  AIR_KEEP,
  GRAVITY,
  AIR_DRAG,
  JUMP_V,
  AIR_JUMP_V,
  AIR_JUMPS,
  JUMP_CUT_V,
  FAST_FALL_G,
  COYOTE_TICKS,
  JUMP_BUFFER_TICKS,
  DROP_TICKS,
  TRAMP_V,
  LIFT_V,
  LIFT_RATE,
  LIFT_GRIP,
  ORB_SPEED,
  ORB_MIN_TICKS,
  ORB_MAX_TICKS,
  ORB_ARC,
  ORB_ARC_MIN,
  ORB_DROP_FROM,
  ORB_DROP_TO,
  SPIKE_STUN_TICKS,
  SPIKE_BOUNCE,
  SPIKE_COOLDOWN,
  STORM_SPEED,
  EPS,
  RESPAWN_TICKS,
  SPEED_BUFF_MUL,
  JUMP_BUFF_MUL,
  IN_LEFT,
  IN_RIGHT,
  IN_JUMP,
  IN_DOWN,
} from './config.js';
import { rampY } from './arenas.js';

const q = (v) => Math.round(v * 100) / 100;
const NO_TWIST = { grav: 1, speed: 1 };
const STICK = 16; // how far a slope may be from your feet and still catch you while walking
const STEP = 8; // how high the low end of a slope may be when you walk onto it from flat ground
export const RAMP_LIP = 14; // a slope carries on flat for this far past each end, so its ends join up cleanly

export function makeState(x, y) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    ground: false,
    gk: 0, // what we are standing on: 1 solid block, 2 thin ledge or slope
    face: 1, // -1 left, 1 right
    nc: false, // "no cut": a trampoline launch that releasing jump must not shorten
    coyote: 0, // ticks left in which a jump is still allowed after leaving ground
    jbuf: 0, // ticks a jump press is remembered
    air: AIR_JUMPS, // mid-air jumps left
    drop: 0, // ticks of falling through thin ledges
    tp: 0, // > 0 while standing in a portal we just came out of
    orb: 0, // ticks left of flying between portals as an orb
    ot: 0, // total ticks of that flight
    pi: 0, // the portal we entered
    ox: 0, // where our centre was when we entered it
    oy: 0,
    stun: 0, // ticks of ignored input (just got tagged)
    frz: 0, // ticks frozen by a Frost power-up
    dead: 0, // ticks until respawn (fell into a pit)
    pb: 0, // input bits of the previous tick (to spot fresh presses)
    spd: 0, // ticks of Swift left
    jmp: 0, // ticks of Spring left
    shd: 0, // ticks of Ward left
    slw: 0, // ticks of slow motion left (someone used Storm)
    hz: 0, // ticks until thorns can hurt us again
    w: PW,
    h: PH,
  };
}

// Compact form for the network: everything the owner needs to resume predicting.
export function packState(s) {
  return [
    s.x,
    s.y,
    s.vx,
    s.vy,
    (s.ground ? 1 : 0) | (s.face > 0 ? 2 : 0) | (s.nc ? 4 : 0) | (s.gk << 4),
    s.coyote,
    s.jbuf,
    s.air,
    s.drop,
    s.tp,
    s.orb,
    s.ot,
    s.pi,
    s.stun,
    s.frz,
    s.dead,
    s.pb,
    s.spd,
    s.jmp,
    s.shd,
    s.ox,
    s.oy,
    s.slw,
    s.hz,
  ];
}
export const STATE_LEN = 24;

export function unpackState(a) {
  const s = makeState(a[0], a[1]);
  s.vx = a[2];
  s.vy = a[3];
  const f = a[4];
  s.ground = (f & 1) === 1;
  s.face = f & 2 ? 1 : -1;
  s.nc = (f & 4) === 4;
  s.gk = (f >> 4) & 3;
  s.coyote = a[5];
  s.jbuf = a[6];
  s.air = a[7];
  s.drop = a[8];
  s.tp = a[9];
  s.orb = a[10];
  s.ot = a[11];
  s.pi = a[12];
  s.stun = a[13];
  s.frz = a[14];
  s.dead = a[15];
  s.pb = a[16];
  s.spd = a[17];
  s.jmp = a[18];
  s.shd = a[19];
  s.ox = a[20];
  s.oy = a[21];
  s.slw = a[22];
  s.hz = a[23];
  return s;
}

// What everybody else needs to draw this player.
export const PF_GROUND = 1;
export const PF_FACE = 2;
export const PF_STUN = 4;
export const PF_FROZEN = 8;
export const PF_ORB = 16;
export const PF_SPEED = 32;
export const PF_JUMP = 64;
export const PF_SHIELD = 128;
export const PF_DEAD = 256;
export const PF_SLOW = 512;

export function publicFlags(s) {
  return (
    (s.ground ? PF_GROUND : 0) |
    (s.face > 0 ? PF_FACE : 0) |
    (s.stun > 0 ? PF_STUN : 0) |
    (s.frz > 0 ? PF_FROZEN : 0) |
    (s.orb > 0 ? PF_ORB : 0) |
    (s.spd > 0 ? PF_SPEED : 0) |
    (s.jmp > 0 ? PF_JUMP : 0) |
    (s.shd > 0 ? PF_SHIELD : 0) |
    (s.dead > 0 ? PF_DEAD : 0) |
    (s.slw > 0 ? PF_SLOW : 0)
  );
}

// Where an orb is, a fraction e of the way from where it entered (ox, oy) to
// portal d: a curve whose top is well above both ends.
function orbPoint(p, d, e) {
  const lift = Math.max(ORB_ARC_MIN, Math.hypot(d.cx - p.ox, d.cy - p.oy) * ORB_ARC);
  const top = Math.max(PH, Math.min(p.oy, d.cy) - lift);
  const cy = 2 * top - (p.oy + d.cy) / 2; // control point that puts the middle of the curve at `top`
  const u = 1 - e;
  p.x = q(u * u * p.ox + 2 * u * e * ((p.ox + d.cx) / 2) + e * e * d.cx - PW / 2);
  p.y = q(Math.max(0, u * u * p.oy + 2 * u * e * cy + e * e * d.cy - PH / 2)); // never above the top of the map
}

// Is the player's box clear of solid blocks and inside the arena?
function isFree(p, arena) {
  if (p.x < 0 || p.x > arena.w - PW || p.y < 0 || p.y > arena.h - PH) return false;
  const plats = arena.platforms;
  for (let i = 0; i < plats.length; i++) {
    const s = plats[i];
    if (!s.oneway && p.x + PW > s.x && p.x < s.x + s.w && p.y + PH > s.y && p.y < s.y + s.h) return false;
  }
  return true;
}

// Move a value towards a target by at most `step`.
function approach(v, target, step) {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

function moveX(p, dx, arena) {
  if (dx === 0) return;
  let nx = p.x + dx;
  const top = p.y;
  const bot = p.y + PH;
  const plats = arena.platforms;
  if (dx > 0) {
    const right = p.x + PW;
    let lim = arena.w - PW;
    for (let i = 0; i < plats.length; i++) {
      const s = plats[i];
      if (s.oneway || bot - s.y <= EPS || s.y + s.h - top <= EPS) continue;
      if (right <= s.x + EPS && nx + PW > s.x) {
        const c = s.x - PW;
        if (c < lim) lim = c;
      }
    }
    if (nx > lim) {
      nx = lim;
      p.vx = 0;
    }
  } else {
    const left = p.x;
    let lim = 0;
    for (let i = 0; i < plats.length; i++) {
      const s = plats[i];
      if (s.oneway || bot - s.y <= EPS || s.y + s.h - top <= EPS) continue;
      const edge = s.x + s.w;
      if (left >= edge - EPS && nx < edge) {
        if (edge > lim) lim = edge;
      }
    }
    if (nx < lim) {
      nx = lim;
      p.vx = 0;
    }
  }
  p.x = nx;
}

function moveY(p, dy, arena) {
  if (dy === 0) return;
  let ny = p.y + dy;
  const left = p.x;
  const right = p.x + PW;
  const plats = arena.platforms;
  if (dy > 0) {
    const bot = p.y + PH;
    let lim = Infinity;
    let kind = 0;
    for (let i = 0; i < plats.length; i++) {
      const s = plats[i];
      if (right - s.x <= EPS || s.x + s.w - left <= EPS) continue;
      if (s.oneway && p.drop > 0) continue; // holding down: fall through thin ledges
      // thin ledges only catch you if your feet were above them
      if (bot <= s.y + EPS && ny + PH > s.y) {
        const c = s.y - PH;
        if (c < lim) {
          lim = c;
          kind = s.oneway ? 2 : 1;
        }
      }
    }
    if (ny > lim) {
      ny = lim;
      p.vy = 0;
      p.ground = true;
      p.gk = kind;
    }
  } else {
    let lim = 0; // the top of the map is a ceiling
    for (let i = 0; i < plats.length; i++) {
      const s = plats[i];
      if (s.oneway || right - s.x <= EPS || s.x + s.w - left <= EPS) continue;
      const edge = s.y + s.h;
      if (p.y >= edge - EPS && ny < edge) {
        if (edge > lim) lim = edge;
      }
    }
    if (ny < lim) {
      ny = lim;
      if (p.vy < 0) p.vy = 0;
    }
  }
  p.y = ny;
}

// Slopes. They work like thin ledges that are tilted: you land on them from
// above, walk along them without bouncing, and jump up through them from below.
// The player's centre line is what rides the slope.
function onRamps(p, arena, prevCx, prevFeet, wasGround, vy0, down) {
  const ramps = arena.ramps;
  if (!ramps.length || p.drop > 0) return;
  const cx = p.x + PW / 2;
  const feet = p.y + PH;
  let best = Infinity;
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    if (cx < r.x0 - RAMP_LIP || cx > r.x1 + RAMP_LIP) continue;
    const sy = rampY(r, cx);
    let ok;
    if (p.ground) {
      // standing on something flat: walk into the low end of a slope to go up it.
      // Walking the other way, or holding down, passes underneath instead.
      const uphill = r.y1 < r.y0 ? 1 : -1;
      ok = !down && p.vx * uphill > 0 && sy <= feet + EPS && feet - sy <= STEP;
    } else if (wasGround && vy0 >= 0 && Math.abs(prevFeet - sy) <= STICK) {
      ok = true; // walking along it, uphill or downhill
    } else {
      ok = p.vy >= 0 && prevFeet <= rampY(r, prevCx) + 2 && feet >= sy - EPS; // landing on it
    }
    if (ok && sy < best) best = sy;
  }
  if (best !== Infinity) {
    p.y = best - PH;
    p.vy = 0;
    p.ground = true;
    p.gk = 2;
  }
}

// Advance one player by one tick.
//   bits  - IN_LEFT | IN_RIGHT | IN_JUMP | IN_DOWN
//   arena - a parsed arena
//   isIt  - whoever is "it" runs a little faster
//   twist - optional round modifier { grav, speed }
export function stepPlayer(p, bits, arena, isIt = false, twist = NO_TWIST) {
  if (p.dead > 0) {
    p.dead--;
    p.pb = bits;
    if (p.dead === 0) {
      // come back at the respawn point nearest to where we fell
      let best = arena.respawns[0];
      for (const r of arena.respawns) if (Math.abs(r[0] - p.x) < Math.abs(best[0] - p.x)) best = r;
      p.x = best[0];
      p.y = best[1];
      p.vx = 0;
      p.vy = 0;
      p.ground = false;
      p.coyote = 0;
    }
    return;
  }

  if (p.spd > 0) p.spd--;
  if (p.jmp > 0) p.jmp--;
  if (p.shd > 0) p.shd--;
  if (p.slw > 0) p.slw--;
  if (p.hz > 0) p.hz--;
  if (p.drop > 0) p.drop--;

  // Flying between portals: an arc up over the map, no steering. Some portals
  // let you press jump to drop out wherever you happen to be.
  if (p.orb > 0) {
    const pressed = bits & ~p.pb;
    p.orb--;
    p.pb = bits;
    const a = arena.portals[p.pi];
    const d = arena.portals[a.to];
    p.vx = 0;
    p.vy = 0;
    if (p.orb === 0) {
      p.x = d.cx - PW / 2;
      p.y = d.y + d.h - PH - 1;
      p.tp = 1; // the exit will not take us again until we step out of it
      p.air = AIR_JUMPS;
      p.ground = false;
      return;
    }
    const f = 1 - p.orb / p.ot;
    const e = f * f * (3 - 2 * f); // ease in and out
    orbPoint(p, d, e);
    if (a.drop && pressed & IN_JUMP && f > ORB_DROP_FROM && f < ORB_DROP_TO && isFree(p, arena)) {
      p.orb = 0; // let go: fall from here with a little of the flight's drift
      p.vx = d.cx > p.ox ? 200 : -200;
      p.air = AIR_JUMPS;
      p.ground = false;
      p.coyote = 0;
      p.tp = 0;
    }
    return;
  }

  let b = bits;
  if (p.stun > 0 || p.frz > 0) {
    if (p.stun > 0) p.stun--;
    if (p.frz > 0) p.frz--;
    b = 0;
  }
  const pressed = b & ~p.pb; // buttons that went down this very tick
  p.pb = bits;

  let dir = 0;
  if (b & IN_LEFT) dir -= 1;
  if (b & IN_RIGHT) dir += 1;
  if (dir !== 0) p.face = dir;

  const slow = p.slw > 0 ? STORM_SPEED : 1;
  const speed = MOVE_SPEED * twist.speed * (isIt ? IT_SPEED_MUL : 1) * (p.spd > 0 ? SPEED_BUFF_MUL : 1) * slow;
  const jumpMul = (p.jmp > 0 ? JUMP_BUFF_MUL : 1) * (p.slw > 0 ? 0.85 : 1);

  // inside an updraft?
  let lifted = false;
  const lifts = arena.lifts;
  for (let i = 0; i < lifts.length; i++) {
    const z = lifts[i];
    if (p.x + PW > z.x && p.x < z.x + z.w && p.y + PH > z.y && p.y < z.y + z.h) {
      lifted = true;
      break;
    }
  }

  // --- running: speed builds up, and turning round costs a short skid ---------
  const target = dir * speed;
  if (p.ground) {
    if (dir === 0) p.vx = approach(p.vx, 0, GROUND_STOP * DT);
    else if (p.vx * dir < 0) p.vx = approach(p.vx, 0, GROUND_TURN * DT);
    else p.vx = approach(p.vx, target, (Math.abs(p.vx) > speed ? GROUND_STOP : GROUND_ACCEL) * DT);
  } else if (dir === 0) {
    p.vx *= lifted ? LIFT_GRIP : AIR_KEEP; // an updraft holds on to you when you let go
    if (Math.abs(p.vx) < 4) p.vx = 0;
  } else if (p.vx * dir > speed) {
    p.vx *= AIR_KEEP; // flung faster than you can run (a launcher): holding on keeps the momentum
  } else {
    p.vx = approach(p.vx, target, (p.vx * dir < 0 ? AIR_TURN : AIR_ACCEL) * DT);
  }

  // --- jumping -----------------------------------------------------------------
  if (pressed & IN_JUMP) p.jbuf = JUMP_BUFFER_TICKS;
  else if (p.jbuf > 0) p.jbuf--;
  if (p.jbuf > 0) {
    if (p.ground || p.coyote > 0) {
      p.vy = -JUMP_V * jumpMul;
      p.ground = false;
      p.coyote = 0;
      p.jbuf = 0;
      p.nc = false;
    } else if (pressed & IN_JUMP && p.air > 0 && p.vy > -AIR_JUMP_V * jumpMul) {
      // double jump (ignored while already flying up faster, e.g. off a trampoline;
      // and one used during a trampoline launch can never make the launch shorter)
      p.vy = -AIR_JUMP_V * jumpMul;
      p.air--;
      p.jbuf = 0;
    }
  }
  // let go early for a short hop
  if (!(b & IN_JUMP) && !p.nc && p.vy < -JUMP_CUT_V) p.vy = -JUMP_CUT_V;

  // --- gravity, air resistance, updrafts -----------------------------------------
  if (lifted) {
    p.vy += (-LIFT_V - p.vy) * LIFT_RATE; // settle to a steady climb
    p.air = AIR_JUMPS;
    p.nc = true;
  } else {
    const fast = (b & IN_DOWN) !== 0 && !p.ground;
    p.vy += (GRAVITY * twist.grav + (fast ? FAST_FALL_G : 0) - AIR_DRAG * p.vy) * DT;
  }

  // hold down on a thin ledge or slope to drop through it
  if (b & IN_DOWN && p.ground && p.gk === 2) {
    p.drop = DROP_TICKS;
    p.coyote = 0;
  }

  const wasGround = p.ground;
  const vy0 = p.vy;
  const prevCx = p.x + PW / 2;
  const prevFeet = p.y + PH;
  moveX(p, p.vx * DT, arena);
  p.ground = false;
  p.gk = 0;
  moveY(p, p.vy * DT, arena);
  onRamps(p, arena, prevCx, prevFeet, wasGround, vy0, (b & IN_DOWN) !== 0);

  // trampolines: touch one while not rising and up you go
  if (p.vy >= 0) {
    const tr = arena.tramps;
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i];
      if (p.x + PW - t.x < 8 || t.x + t.w - p.x < 8) continue;
      if (p.y + PH < t.y || p.y > t.y + t.h) continue;
      p.vy = -(t.vy || TRAMP_V);
      if (t.vx) p.vx = t.vx; // a launcher: up and across
      p.ground = false;
      p.gk = 0;
      p.coyote = 0;
      p.air = AIR_JUMPS;
      p.nc = true;
      break;
    }
  }

  // thorns: a sting, a short stun, and you are thrown back off them
  if (p.hz === 0) {
    const sp = arena.spikes;
    for (let i = 0; i < sp.length; i++) {
      const z = sp[i];
      if (p.x + PW - z.x < 6 || z.x + z.w - p.x < 6 || p.y + PH < z.y || p.y > z.y + z.h) continue;
      p.stun = SPIKE_STUN_TICKS;
      p.hz = SPIKE_COOLDOWN;
      p.vy = -SPIKE_BOUNCE;
      p.vx = p.x + PW / 2 < z.x + z.w / 2 ? -240 : 240;
      p.ground = false;
      p.gk = 0;
      p.coyote = 0;
      break;
    }
  }

  if (p.ground) {
    p.coyote = COYOTE_TICKS;
    p.air = AIR_JUMPS;
    p.nc = false;
  } else {
    if (p.coyote > 0) p.coyote--;
    if (p.vy >= 0 && !lifted) p.nc = false;
  }

  // portals: step in and fly to the partner as an orb
  let inPortal = false;
  const po = arena.portals;
  for (let i = 0; i < po.length; i++) {
    const a = po[i];
    if (p.x + PW < a.x + 10 || p.x > a.x + a.w - 10 || p.y + PH < a.y + 10 || p.y > a.y + a.h - 4) continue;
    inPortal = true;
    if (p.tp === 0) {
      const d = po[a.to];
      const dist = Math.hypot(d.cx - a.cx, d.cy - a.cy);
      p.ot = Math.max(ORB_MIN_TICKS, Math.min(ORB_MAX_TICKS, Math.round((dist * 1.2) / ORB_SPEED)));
      p.orb = p.ot;
      p.pi = i;
      p.ox = q(p.x + PW / 2);
      p.oy = q(p.y + PH / 2);
      p.vx = 0;
      p.vy = 0;
    }
    break;
  }
  p.tp = inPortal ? 1 : 0;

  if (p.y > arena.h + 80) {
    p.dead = RESPAWN_TICKS;
    p.vx = 0;
    p.vy = 0;
  }

  p.x = q(p.x);
  p.y = q(p.y);
  p.vx = q(p.vx);
  p.vy = q(p.vy);
}
