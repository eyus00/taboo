// Deterministic platformer physics for one player, one fixed step at a time.
//
// The server runs this to decide what really happened. The browser runs the
// exact same function to predict its own player without waiting for the
// server, and to replay inputs the server has not confirmed yet. State is
// rounded to 1/100 px after every step so both sides land on identical numbers
// and snapshots stay small.

import {
  W,
  H,
  PW,
  PH,
  DT,
  MOVE_SPEED,
  AIR_ACCEL,
  GROUND_FRICTION,
  AIR_FRICTION,
  JUMP_V,
  G_UP,
  G_DOWN,
  MAX_FALL,
  COYOTE_TICKS,
  EPS,
  RESPAWN_TICKS,
  IN_LEFT,
  IN_RIGHT,
  IN_JUMP,
} from './config.js';
import { RESPAWN } from './arenas.js';

const q = (v) => Math.round(v * 100) / 100;

// Each slot gets its own lane near the top centre so two players who fall at
// the same moment do not respawn inside each other.
export function respawnX(slot) {
  return RESPAWN.x + (slot - 1.5) * 36;
}

export function makeState(x, y, slot = 0) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    ground: false,
    coyote: 0, // ticks left in which a jump is still allowed after leaving ground
    stun: 0, // ticks of ignored input (just got tagged)
    dead: 0, // ticks until respawn (fell off the bottom)
    face: 1, // -1 left, 1 right
    w: PW, // carried so a player state can be used directly as a solid
    h: PH,
    rx: respawnX(slot), // where this player drops back in after a fall
  };
}

export function copyState(s) {
  return {
    x: s.x,
    y: s.y,
    vx: s.vx,
    vy: s.vy,
    ground: s.ground,
    coyote: s.coyote,
    stun: s.stun,
    dead: s.dead,
    face: s.face,
    w: PW,
    h: PH,
    rx: s.rx,
  };
}

// Solids only ever stop you when you cross one of their faces from outside.
// If you are somehow already inside one (two players respawning on the same
// spot) you can walk out freely instead of being trapped or flung away.
function moveX(p, dx, solids) {
  if (dx === 0) return;
  let nx = p.x + dx;
  const top = p.y;
  const bot = p.y + PH;
  if (dx > 0) {
    const right = p.x + PW;
    let lim = W - PW;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (bot - s.y <= EPS || s.y + s.h - top <= EPS) continue;
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
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (bot - s.y <= EPS || s.y + s.h - top <= EPS) continue;
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

function moveY(p, dy, solids) {
  if (dy === 0) return;
  let ny = p.y + dy;
  const left = p.x;
  const right = p.x + PW;
  if (dy > 0) {
    const bot = p.y + PH;
    let lim = Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (right - s.x <= EPS || s.x + s.w - left <= EPS) continue;
      if (bot <= s.y + EPS && ny + PH > s.y) {
        const c = s.y - PH;
        if (c < lim) lim = c;
      }
    }
    if (ny > lim) {
      ny = lim;
      p.vy = 0;
      p.ground = true;
    }
  } else {
    let lim = -Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (right - s.x <= EPS || s.x + s.w - left <= EPS) continue;
      const edge = s.y + s.h;
      if (p.y >= edge - EPS && ny < edge) {
        if (edge > lim) lim = edge;
      }
    }
    if (ny < lim) {
      ny = lim;
      p.vy = 0;
    }
  }
  p.y = ny;
}

// Advance one player by one tick.
//   bits     - IN_LEFT | IN_RIGHT | IN_JUMP
//   solids   - platforms plus the hitboxes of the other players
//   speedMul - 1 normally, IT_SPEED_MUL for whoever is "it"
export function stepPlayer(p, bits, solids, speedMul = 1) {
  if (p.dead > 0) {
    p.dead--;
    if (p.dead === 0) {
      p.x = p.rx;
      p.y = RESPAWN.y;
      p.vx = 0;
      p.vy = 0;
      p.ground = false;
      p.coyote = 0;
    }
    return;
  }

  if (p.stun > 0) {
    p.stun--;
    bits = 0;
  }

  let dir = 0;
  if (bits & IN_LEFT) dir -= 1;
  if (bits & IN_RIGHT) dir += 1;
  if (dir !== 0) p.face = dir;

  const speed = MOVE_SPEED * speedMul;
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

  if (bits & IN_JUMP && (p.ground || p.coyote > 0)) {
    p.vy = -JUMP_V;
    p.ground = false;
    p.coyote = 0;
  }

  p.vy += (p.vy < 0 ? G_UP : G_DOWN) * DT;
  if (p.vy > MAX_FALL) p.vy = MAX_FALL;

  moveX(p, p.vx * DT, solids);
  p.ground = false;
  moveY(p, p.vy * DT, solids);

  if (p.ground) p.coyote = COYOTE_TICKS;
  else if (p.coyote > 0) p.coyote--;

  if (p.y > H + 60) {
    p.dead = RESPAWN_TICKS;
    p.vx = 0;
    p.vy = 0;
  }

  p.x = q(p.x);
  p.y = q(p.y);
  p.vx = q(p.vx);
  p.vy = q(p.vy);
}
