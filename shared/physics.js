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
  AIR_ACCEL,
  GROUND_FRICTION,
  AIR_FRICTION,
  JUMP_V,
  AIR_JUMP_V,
  AIR_JUMPS,
  JUMP_CUT_V,
  G_UP,
  G_DOWN,
  G_FAST,
  MAX_FALL,
  MAX_FAST_FALL,
  COYOTE_TICKS,
  JUMP_BUFFER_TICKS,
  DASH_SPEED,
  DASH_TICKS,
  DASH_COOLDOWN,
  DROP_TICKS,
  TRAMP_V,
  EPS,
  RESPAWN_TICKS,
  SPEED_BUFF_MUL,
  JUMP_BUFF_MUL,
  IN_LEFT,
  IN_RIGHT,
  IN_JUMP,
  IN_DOWN,
  IN_DASH,
} from './config.js';

const q = (v) => Math.round(v * 100) / 100;

export function makeState(x, y) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    ground: false,
    gk: 0, // what we are standing on: 1 solid block, 2 thin ledge
    face: 1, // -1 left, 1 right
    nc: false, // "no cut": a trampoline launch that releasing jump must not shorten
    dashDir: 1,
    coyote: 0, // ticks left in which a jump is still allowed after leaving ground
    jbuf: 0, // ticks a jump press is remembered
    air: AIR_JUMPS, // mid-air jumps left
    dashT: 0, // ticks of dash remaining
    dashCd: 0, // ticks until dash is ready again
    drop: 0, // ticks of falling through thin ledges
    tp: 0, // > 0 while standing in a portal we just came out of
    stun: 0, // ticks of ignored input (just got tagged)
    frz: 0, // ticks frozen by a Frost power-up
    dead: 0, // ticks until respawn (fell into a pit)
    pb: 0, // input bits of the previous tick (to spot fresh presses)
    spd: 0, // ticks of Swift left
    jmp: 0, // ticks of Spring left
    shd: 0, // ticks of Ward left
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
    (s.ground ? 1 : 0) | (s.face > 0 ? 2 : 0) | (s.nc ? 4 : 0) | (s.dashDir > 0 ? 8 : 0) | (s.gk << 4),
    s.coyote,
    s.jbuf,
    s.air,
    s.dashT,
    s.dashCd,
    s.drop,
    s.tp,
    s.stun,
    s.frz,
    s.dead,
    s.pb,
    s.spd,
    s.jmp,
    s.shd,
  ];
}

export function unpackState(a) {
  const s = makeState(a[0], a[1]);
  s.vx = a[2];
  s.vy = a[3];
  const f = a[4];
  s.ground = (f & 1) === 1;
  s.face = f & 2 ? 1 : -1;
  s.nc = (f & 4) === 4;
  s.dashDir = f & 8 ? 1 : -1;
  s.gk = (f >> 4) & 3;
  s.coyote = a[5];
  s.jbuf = a[6];
  s.air = a[7];
  s.dashT = a[8];
  s.dashCd = a[9];
  s.drop = a[10];
  s.tp = a[11];
  s.stun = a[12];
  s.frz = a[13];
  s.dead = a[14];
  s.pb = a[15];
  s.spd = a[16];
  s.jmp = a[17];
  s.shd = a[18];
  return s;
}

// What everybody else needs to draw this player.
export const PF_GROUND = 1;
export const PF_FACE = 2;
export const PF_STUN = 4;
export const PF_FROZEN = 8;
export const PF_DASH = 16;
export const PF_SPEED = 32;
export const PF_JUMP = 64;
export const PF_SHIELD = 128;
export const PF_DEAD = 256;

export function publicFlags(s) {
  return (
    (s.ground ? PF_GROUND : 0) |
    (s.face > 0 ? PF_FACE : 0) |
    (s.stun > 0 ? PF_STUN : 0) |
    (s.frz > 0 ? PF_FROZEN : 0) |
    (s.dashT > 0 ? PF_DASH : 0) |
    (s.spd > 0 ? PF_SPEED : 0) |
    (s.jmp > 0 ? PF_JUMP : 0) |
    (s.shd > 0 ? PF_SHIELD : 0) |
    (s.dead > 0 ? PF_DEAD : 0)
  );
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

// Advance one player by one tick.
//   bits  - IN_LEFT | IN_RIGHT | IN_JUMP | IN_DOWN | IN_DASH
//   arena - a parsed arena (platforms, trampolines, portals)
//   isIt  - whoever is "it" runs a little faster
export function stepPlayer(p, bits, arena, isIt = false) {
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
      p.dashT = 0;
    }
    return;
  }

  if (p.spd > 0) p.spd--;
  if (p.jmp > 0) p.jmp--;
  if (p.shd > 0) p.shd--;
  if (p.dashCd > 0) p.dashCd--;
  if (p.drop > 0) p.drop--;

  let b = bits;
  if (p.stun > 0 || p.frz > 0) {
    if (p.stun > 0) p.stun--;
    if (p.frz > 0) p.frz--;
    b = 0;
    p.dashT = 0;
  }
  const pressed = b & ~p.pb; // buttons that went down this very tick
  p.pb = bits;

  let dir = 0;
  if (b & IN_LEFT) dir -= 1;
  if (b & IN_RIGHT) dir += 1;
  if (dir !== 0) p.face = dir;

  const speed = MOVE_SPEED * (isIt ? IT_SPEED_MUL : 1) * (p.spd > 0 ? SPEED_BUFF_MUL : 1);
  const jumpMul = p.jmp > 0 ? JUMP_BUFF_MUL : 1;

  if (pressed & IN_DASH && p.dashCd === 0 && p.dashT === 0) {
    p.dashT = DASH_TICKS;
    p.dashCd = DASH_COOLDOWN + DASH_TICKS;
    p.dashDir = dir !== 0 ? dir : p.face;
    p.face = p.dashDir;
  }

  if (pressed & IN_JUMP) p.jbuf = JUMP_BUFFER_TICKS;
  else if (p.jbuf > 0) p.jbuf--;

  if (p.dashT > 0) {
    // dash: a short flat burst that ignores gravity
    p.dashT--;
    p.vx = p.dashDir * DASH_SPEED;
    p.vy = 0;
    if (p.dashT === 0) p.vx = p.dashDir * speed;
  } else {
    if (p.ground) {
      if (dir !== 0) {
        p.vx = dir * speed; // no ramp-up: full speed the moment you press
      } else {
        p.vx *= GROUND_FRICTION;
        if (Math.abs(p.vx) < 6) p.vx = 0;
      }
    } else if (dir !== 0) {
      const target = dir * speed;
      if (p.vx < target) p.vx = Math.min(target, p.vx + AIR_ACCEL * DT);
      else if (p.vx > target) p.vx = Math.max(target, p.vx - AIR_ACCEL * DT);
    } else {
      p.vx *= AIR_FRICTION;
      if (Math.abs(p.vx) < 6) p.vx = 0;
    }

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

    const fast = (b & IN_DOWN) !== 0 && !p.ground;
    p.vy += ((p.vy < 0 ? G_UP : G_DOWN) + (fast ? G_FAST : 0)) * DT;
    const cap = fast ? MAX_FAST_FALL : MAX_FALL;
    if (p.vy > cap) p.vy = cap;
  }

  // hold down on a thin ledge to drop through it
  if (b & IN_DOWN && p.ground && p.gk === 2) {
    p.drop = DROP_TICKS;
    p.coyote = 0;
  }

  moveX(p, p.vx * DT, arena);
  p.ground = false;
  p.gk = 0;
  moveY(p, p.vy * DT, arena);

  // trampolines: touch one while not rising and up you go
  if (p.vy >= 0) {
    const tr = arena.tramps;
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i];
      if (p.x + PW - t.x < 8 || t.x + t.w - p.x < 8) continue;
      if (p.y + PH < t.y || p.y > t.y + t.h) continue;
      p.vy = -TRAMP_V;
      p.ground = false;
      p.gk = 0;
      p.coyote = 0;
      p.air = AIR_JUMPS;
      p.nc = true;
      p.dashT = 0;
      break;
    }
  }

  if (p.ground) {
    p.coyote = COYOTE_TICKS;
    p.air = AIR_JUMPS;
    p.nc = false;
  } else {
    if (p.coyote > 0) p.coyote--;
    if (p.vy >= 0) p.nc = false;
  }

  // portals: step in, come out of the partner. You have to step out before
  // a portal will take you again.
  let inPortal = false;
  const po = arena.portals;
  for (let i = 0; i < po.length; i++) {
    const a = po[i];
    if (p.x + PW < a.x + 10 || p.x > a.x + a.w - 10 || p.y + PH < a.y + 10 || p.y > a.y + a.h - 4) continue;
    inPortal = true;
    if (p.tp === 0) {
      const d = po[a.to];
      p.x = d.cx - PW / 2;
      p.y = d.y + d.h - PH - 1;
      p.dashT = 0;
    }
    break;
  }
  p.tp = inPortal ? 1 : 0;

  if (p.y > arena.h + 80) {
    p.dead = RESPAWN_TICKS;
    p.vx = 0;
    p.vy = 0;
    p.dashT = 0;
  }

  p.x = q(p.x);
  p.y = q(p.y);
  p.vx = q(p.vx);
  p.vy = q(p.vy);
}
