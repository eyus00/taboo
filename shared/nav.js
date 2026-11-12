// A route map of an arena for the bots: which stretches of ground exist
// ("surfaces") and how to get from one to another ("edges": walk, hop, drop,
// trampoline, launcher, updraft, portal).
//
// Nothing here trusts a formula. Every edge is found by actually making the
// move with the real physics and the very same hands the bots use (drive(),
// below) - so when the map says "you can hop from here to there", a bot that
// tries it lands it. Thorns, trampolines, launchers, portals and the feet of
// updrafts are cut out of the surfaces: a bot never plans to stand in one, it
// plans a hop over it or a deliberate step into it.
//
// Costs are in ticks, so the shortest route is the quickest one.

import { PW, PH, MOVE_SPEED, AIR_TURN, LAUNCH_VX, LAUNCH_VY, IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN } from './config.js';
import { rampY } from './arenas.js';
import { RAMP_LIP, makeState, stepPlayer } from './physics.js';

const HALF = PW / 2;
const PIECE = 320; // long floors are handled in pieces this long, so routes know where along them they are
const RAMP_PIECE = 120; // slopes are cut finer: each piece is treated as a small ledge at its middle height
const WALK = MOVE_SPEED / 60; // px per tick at a run
const NEAR = 13; // close enough to a take-off point
const FAR = 1e9;

const dirBits = (d) => (d < 0 ? IN_LEFT : d > 0 ? IN_RIGHT : 0);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function cut(segs, a, b) {
  const out = [];
  for (const [s, e] of segs) {
    if (b <= s || a >= e) out.push([s, e]);
    else {
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// The hands: which buttons to press, this tick, to make the move `e`.
// Used by the bots while playing and by buildNav() to try every move out.
//   mem: { rejump, pressed } - a countdown to the second jump press, and the
//   buttons sent last tick (the caller keeps `pressed` up to date).
// ----------------------------------------------------------------------------
export function drive(nav, e, s, mem, tx = e.x) {
  const cx = s.x + HALF;
  const feet = s.y + PH;
  const a = nav.surfaces[e.from];
  const b = nav.surfaces[e.to];
  let bits = 0;

  if (s.ground) {
    mem.rejump = 0;
    switch (e.type) {
      case 'walk':
        if (e.foot) {
          // up a slope from flat ground: you have to walk into its low end from
          // outside, so if we are under it (or too close for a run-up), back out first
          const off = (cx - tx) * e.dir;
          bits = dirBits(off > 24 || (off > -8 && s.vx * e.dir <= 0.1) ? -e.dir : e.dir);
          // a steep one can slip past underneath at a full run: ease off for the last step
          if (e.steep && off > -24 && off <= 2 && Math.abs(s.vx) > 180) bits = 0;
        } else bits = walk(a, cx, cx + e.dir * 400);
        break;
      case 'fall':
        bits = walk(a, cx, tx + e.dir * 60);
        break;
      case 'hop': {
        // run to the take-off point and jump
        const off = (cx - tx) * e.dir;
        if (off < -12) bits = walk(a, cx, tx + e.dir * 60);
        else if (off > 14 && !e.lip) bits = walk(a, cx, tx);
        else bits = dirBits(e.dir) | IN_JUMP;
        break;
      }
      case 'up':
        bits = Math.abs(cx - tx) > NEAR ? walk(a, cx, tx) : IN_JUMP;
        break;
      case 'drop':
        // (stop first: dropping through at a run drifts a long way before we are clear of the ledge)
        bits = Math.abs(cx - tx) > NEAR ? walk(a, cx, tx) : Math.abs(s.vx) > 70 ? 0 : IN_DOWN;
        break;
      case 'portal':
        // a portal we just came out of will not take us until we step right out of it
        bits = s.tp > 0 ? dirBits(-e.dir) : Math.abs(tx - cx) > 2 ? walk(a, cx, tx) : dirBits(e.dir);
        break;
      case 'lift':
        if (e.lip != null) {
          // the column is a step or a jump away from the end of this surface
          bits = (cx - e.lip) * e.dir < -12 ? walk(a, cx, e.lip + e.dir * 60) : dirBits(e.dir) | (e.jump ? IN_JUMP : 0);
        } else if (Math.abs(tx - cx) > 8) bits = walk(a, cx, tx);
        else bits = e.jump ? IN_JUMP : 0;
        break;
      default: // trampoline, launcher: just walk into it
        bits = Math.abs(tx - cx) > 2 ? walk(a, cx, tx) : dirBits(e.dir);
    }
    if (mem.pressed & IN_JUMP) bits &= ~IN_JUMP; // a jump only counts when the button goes down
    return bits;
  }

  // in the air: steer for the nearest part of the landing, allowing for the drift we already have
  const coast = (s.vx * Math.abs(s.vx)) / (2 * AIR_TURN);
  const wide = b.x1 - b.x0 > 28;
  const aim = clamp(cx + coast, wide ? b.x0 + 14 : (b.x0 + b.x1) / 2, wide ? b.x1 - 14 : (b.x0 + b.x1) / 2);
  const by = nav.heightAt(b, aim);
  const low = feet > by + 2 - (e.over || 0); // still below where we are going
  const z = nav.liftAt(cx, feet);
  if (e.type === 'lift' && low && !(z && s.vy > -60 && feet < z.y + 40)) {
    // get into the column and stay there until it has carried us high enough
    // (unless we are bobbing at the top of it: then it is time to jump out)
    const d = tx - (cx + coast);
    bits = Math.abs(d) > 6 ? dirBits(d) : 0;
    if (!z && s.vy < 0 && mem.pressed & IN_JUMP) bits |= IN_JUMP;
    return bits;
  }
  const d = aim - (cx + coast);
  bits = Math.abs(d) > 4 ? dirBits(d) : 0;
  if (e.type === 'drop' || e.type === 'portal' || e.type === 'walk') return bits;
  // going up: hold jump for full height
  if (s.vy < 0 && mem.pressed & IN_JUMP) bits |= IN_JUMP;
  // ... and use the jump in mid-air when we are about to come up short, or to sink past it
  if (mem.rejump > 0) {
    if (--mem.rejump === 0) bits |= IN_JUMP;
    else bits &= ~IN_JUMP;
  } else if (s.air > 0 && (!z || feet < z.y + 40) && ((low && s.vy > -90) || (s.vy > 0 && feet > by - 36 && Math.abs(aim - cx) > 40))) {
    mem.rejump = 2;
    bits &= ~IN_JUMP;
  }
  // onto a solid block from the side: do not press into its wall on the way up
  if (!b.oneway && b.wall && low && s.vy < -200) {
    if ((cx < b.wall[0] && cx > b.wall[0] - HALF - 10) || (cx > b.wall[1] && cx < b.wall[1] + HALF + 10)) bits &= ~(IN_LEFT | IN_RIGHT);
  }
  return bits;
}

// Walk along a surface to x.
export function walk(surf, cx, x) {
  const dir = x > cx ? 1 : -1;
  let bits = dirBits(dir);
  // the low end of a slope in the way: hold down to pass underneath it
  if (surf && surf.feet) {
    for (const f of surf.feet) {
      const ahead = (f.x - cx) * dir; // > 0: still in front of us
      if (f.up === dir && ahead > -30 && ahead < 60 && (x - f.x) * dir > 0) bits |= IN_DOWN;
    }
  }
  return bits;
}

// ----------------------------------------------------------------------------
// How far each kind of move carries in open air, by height difference. Worked
// out once by trying it; used to avoid testing moves that cannot possibly work.
// ----------------------------------------------------------------------------
const STEP = 80;
const RISE_MAX = 720;
const DROP_MAX = 1440;
let REACH = null;

function measureReach() {
  const y0 = 4000;
  const kinds = { hop: [], fall: [], tramp: [], fwd: [], back: [] };
  for (const kind of Object.keys(kinds)) {
    const pad = kind === 'tramp' || kind === 'fwd' || kind === 'back';
    const arena = {
      w: 40000, h: 9000, ramps: [], lifts: [], spikes: [], portals: [], pickups: [], spawns: [], respawns: [[0, 0]],
      platforms: [{ x: 19000, y: y0, w: 1000, h: 14, oneway: true }],
      tramps: pad ? [{ x: 19926, y: y0 - 16, w: 68, h: 16, cx: 19960, vx: kind === 'tramp' ? 0 : LAUNCH_VX, vy: kind === 'tramp' ? 0 : LAUNCH_VY }] : [],
    };
    const a = { id: 0, x0: 19002, x1: pad ? 19900 : 19998, y: y0, oneway: true };
    const tx = pad ? 19960 : 19998;
    for (let rise = RISE_MAX; rise >= -DROP_MAX; rise -= STEP) {
      if ((kind === 'fall' && rise >= 0) || (kind === 'back' && rise < 0) || (kind === 'hop' && rise > 400)) {
        kinds[kind].push(-Infinity); // cannot be done, or never asked for
        continue;
      }
      const far = kind === 'back' ? 100 : 39000;
      const b = { id: 1, x0: far, x1: far + 100, y: y0 - rise, oneway: true };
      const nav = { surfaces: [a, b], heightAt: (s) => s.y, liftAt: () => null };
      const e = { type: pad ? 'pad' : kind, from: 0, to: 1, x: tx, dir: 1, lip: true };
      const p = makeState((pad ? 19880 : 19990) - HALF, y0 - PH);
      const mem = { rejump: 0, pressed: 0 };
      stepPlayer(p, 0, arena);
      let above = rise < 0;
      let got = -Infinity;
      for (let t = 0; t < 420; t++) {
        const bits = drive(nav, e, p, mem, tx);
        stepPlayer(p, bits, arena);
        mem.pressed = bits;
        const feet = p.y + PH;
        if (feet < b.y - 1) above = true;
        if (above && p.vy >= 0 && feet >= b.y - 10 && !p.ground) {
          got = Math.abs(p.x + HALF - tx);
          break;
        }
        if (t > 10 && p.ground) break;
      }
      kinds[kind].push(got);
    }
  }
  return kinds;
}

// The reach of a move for a target `rise` px higher (negative: lower) than the
// take-off. Rounds towards the easier target: this only decides what is worth trying.
function reachOf(kind, rise) {
  const t = REACH[kind];
  return t[clamp(Math.ceil((RISE_MAX - rise) / STEP), 0, t.length - 1)];
}

// ----------------------------------------------------------------------------
export function buildNav(arena) {
  if (!REACH) REACH = measureReach();
  const solids = arena.platforms.filter((p) => !p.oneway);
  const surfaces = [];
  let runs = 0;

  // Stretches you cannot simply walk across: thorns, pads, portals, the feet of updrafts.
  const zones = [];
  for (const z of arena.spikes) zones.push({ y0: z.y + z.h, y1: z.y + z.h, x0: z.x - 16, x1: z.x + z.w + 16, kind: 'thorn' });
  arena.tramps.forEach((t, i) => zones.push({ y0: t.y + t.h, y1: t.y + t.h, x0: t.x - 14, x1: t.x + t.w + 14, kind: 'pad', i }));
  arena.portals.forEach((p, i) => zones.push({ y0: p.y + p.h, y1: p.y + p.h, x0: p.cx - 32, x1: p.cx + 32, kind: 'portal', i }));
  arena.lifts.forEach((z, i) => zones.push({ y0: z.y + 2, y1: z.y + z.h + PH - 2, x0: z.x - HALF - 4, x1: z.x + z.w + HALF + 4, kind: 'lift', i }));
  const zoneAt = (x, y) => zones.find((z) => y >= z.y0 - 1 && y <= z.y1 + 1 && x > z.x0 - 3 && x < z.x1 + 3);
  // Where the low end of a slope rests on the ground, walking into it takes you
  // up the slope. On a solid block you can hold down to pass underneath; on a
  // thin ledge that would drop you through it, so there the ground is split in
  // two at the foot and can only be walked across in the downhill direction.
  // (`reach`: how far up the slope its end still catches a walker's feet)
  const feet = arena.ramps.map((r) => {
    const reach = (8 * (r.x1 - r.x0)) / Math.abs(r.y1 - r.y0) + 4;
    return r.y0 > r.y1 ? { x: r.x0, y: r.y0, up: 1, reach } : { x: r.x1, y: r.y1, up: -1, reach };
  });

  // 1. Standing surfaces: the top of every platform, minus the parts where a
  //    solid block or one of those zones is in the way. x0..x1 is where a
  //    player's centre can be.
  for (const p of arena.platforms) {
    let segs = [[Math.max(HALF, p.x + 2), Math.min(arena.w - HALF, p.x + p.w - 2)]];
    for (const b of solids) {
      if (b === p || b.y >= p.y || b.y + b.h <= p.y - PH + 1) continue;
      segs = cut(segs, b.x - HALF, b.x + b.w + HALF);
    }
    for (const z of zones) if (p.y >= z.y0 - 1 && p.y <= z.y1 + 1) segs = cut(segs, z.x0, z.x1);
    if (p.oneway) for (const f of feet) if (f.y <= p.y + 0.5 && p.y - f.y <= 8 && f.x > p.x + 18 && f.x < p.x + p.w - 18) segs = cut(segs, f.x - (f.up > 0 ? 1 : f.reach), f.x + (f.up > 0 ? f.reach : 1));
    // an end is "open" if you can walk or jump off it
    const blocked = (x) => x <= HALF + 1 || x >= arena.w - HALF - 1 || solids.some((b) => b !== p && b.y < p.y && b.y + b.h > p.y - PH + 1 && x >= b.x - HALF - 3 && x <= b.x + b.w + HALF + 3);
    for (const [x0, x1] of segs) {
      if (x1 - x0 < 12) continue;
      const n = Math.max(1, Math.ceil((x1 - x0) / PIECE));
      const run = runs++;
      const under = []; // feet of slopes on this ground
      for (let i = 0; i < n; i++) {
        surfaces.push({
          id: surfaces.length, run, y: p.y, x0: x0 + ((x1 - x0) * i) / n, x1: x0 + ((x1 - x0) * (i + 1)) / n,
          oneway: p.oneway, ramp: null, wall: p.oneway ? null : [p.x, p.x + p.w], feet: under, edges: [],
          openL: i === 0 && !blocked(x0), openR: i === n - 1 && !blocked(x1), endL: i === 0, endR: i === n - 1,
        });
      }
    }
  }
  // slopes, in pieces
  const chains = [];
  for (const r of arena.ramps) {
    const n = Math.max(1, Math.round((r.x1 - r.x0) / RAMP_PIECE));
    const chain = [];
    const run = runs++;
    for (let i = 0; i < n; i++) {
      const x0 = r.x0 + ((r.x1 - r.x0) * i) / n;
      const x1 = r.x0 + ((r.x1 - r.x0) * (i + 1)) / n;
      // lo..hi is where you count as standing on this piece (the end pieces include the slope's flat lip)
      const s = {
        id: surfaces.length, run, y: rampY(r, (x0 + x1) / 2), x0, x1, lo: x0 - (i === 0 ? RAMP_LIP + 2 : 0), hi: x1 + (i === n - 1 ? RAMP_LIP + 2 : 0),
        oneway: true, ramp: r, wall: null, feet: null, edges: [], openL: i === 0, openR: i === n - 1, endL: i === 0, endR: i === n - 1,
      };
      surfaces.push(s);
      chain.push(s);
    }
    chains.push({ r, chain });
  }

  const heightAt = (s, x) => (s.ramp ? rampY(s.ramp, x) : s.y);
  const mid = (s) => (s.x0 + s.x1) / 2;
  const below = (x, y, skip) => {
    // first surface underneath a point
    let best = null;
    let bestY = Infinity;
    for (const s of surfaces) {
      if (s === skip || x < s.x0 - 6 || x > s.x1 + 6) continue;
      const sy = heightAt(s, x);
      if (sy < y + 2 || sy >= bestY) continue;
      best = s;
      bestY = sy;
    }
    return best;
  };
  const liftAt = (x, y) => arena.lifts.find((z) => x > z.x - HALF && x < z.x + z.w + HALF && y > z.y && y - PH < z.y + z.h) || null;
  // thorns, a pad or a portal on the ground between two points at this height
  const hazard = (xa, xb, y) => {
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    for (const z of zones) if (z.kind !== 'lift' && Math.abs(z.y0 - y) < 3 && z.x1 > lo && z.x0 < hi) return z;
    return null;
  };
  const nav = { surfaces, dist: null, hop: null, below, heightAt, liftAt, hazard, zones, stats: null };

  const add = (a, b, e) => {
    if (a === b) return;
    const old = a.edges.find((x) => x.to === b.id);
    if (old && old.cost <= e.cost) return;
    if (old) a.edges.splice(a.edges.indexOf(old), 1);
    e.from = a.id;
    e.to = b.id;
    a.edges.push(e);
  };

  // Try a move out for real: stand at startX on a, then let drive() make the
  // move e. Returns where and when it came down, or null if that was not on
  // b's stretch of ground (or it ended in thorns, a pit, a portal...).
  let tries = 0;
  let steps = 0;
  const attempt = (a, b, e, startX, limit = 260) => {
    tries++;
    e.from = a.id;
    e.to = b.id;
    const p = makeState(startX - HALF, heightAt(a, startX) - PH);
    stepPlayer(p, 0, arena);
    if (!p.ground) stepPlayer(p, 0, arena);
    if (!p.ground || p.orb > 0) return null;
    const mem = { rejump: 0, pressed: 0 };
    let left = false;
    let top = p.y; // the highest we have been, and when: hanging about in the air means it is not going to work
    let topT = 0;
    for (let t = 1; t <= limit; t++) {
      const bits = drive(nav, e, p, mem, e.x);
      stepPlayer(p, bits, arena);
      mem.pressed = bits;
      steps++;
      if (p.dead > 0 || p.stun > 0 || p.hz > 0) return null;
      if (p.y < top - 1) {
        top = p.y;
        topT = t;
      } else if (t - topT > 45 && !p.ground && p.orb === 0 && Math.abs(p.vy) < 90) return null;
      if (p.orb > 0) {
        if (e.type !== 'portal') return null;
        left = true;
        continue;
      }
      if (!p.ground) {
        left = true;
        continue;
      }
      const s = surfaceAt(nav, p.x + HALF, p.y + PH, p.gk);
      if (!left && (!s || s.run === a.run)) continue; // still on the way to the take-off
      if (!s || s.run !== b.run || s === a) return null;
      return { to: s, ticks: t, x: p.x + HALF };
    }
    return null;
  };
  // ... and if it works, put it on the map
  const tryEdge = (a, b, e, startX, limit) => {
    const got = attempt(a, b, e, startX, limit);
    if (!got) return false;
    add(a, got.to, { ...e, cost: got.ticks, land: got.x });
    return true;
  };

  // 2a. Walking: along a stretch of ground, along a slope, and on and off its ends
  const byRun = [];
  for (const s of surfaces) (byRun[s.run] ||= []).push(s);
  for (const list of byRun) {
    for (let i = 0; i + 1 < list.length; i++) {
      const c = (mid(list[i + 1]) - mid(list[i])) / WALK;
      add(list[i], list[i + 1], { type: 'walk', dir: 1, cost: c });
      add(list[i + 1], list[i], { type: 'walk', dir: -1, cost: c });
    }
  }
  for (const { r, chain } of chains) {
    for (const [end, x, y, dir] of [
      [chain[0], r.x0, r.y0, -1],
      [chain[chain.length - 1], r.x1, r.y1, 1],
    ]) {
      for (const s of surfaces) {
        if (s.ramp === r || Math.abs(heightAt(s, x) - y) > 12) continue;
        if (x < s.x0 - 46 || x > s.x1 + 46) continue;
        const side = s.x0 < x - 4 && s.x1 > x + 4 ? dir : mid(s) > x ? 1 : -1; // which way the flat ground lies
        const low = y >= Math.max(r.y0, r.y1) - 1; // the bottom end: you have to walk INTO it to go up
        // walking off the end of a slope carries you on in the same direction - never back underneath it
        if (side === dir) add(end, s, { type: 'walk', dir, cost: 8 });
        const steep = Math.abs((r.y1 - r.y0) / (r.x1 - r.x0)) > 0.85;
        if (low || side === dir) add(s, end, { type: 'walk', dir: -dir, x, foot: low && !s.ramp, steep, cost: 8 + Math.abs(mid(s) - x) / WALK });
        if (low && !s.ramp && !s.oneway && !s.feet.some((f) => f.x === x)) s.feet.push({ x, up: -dir });
        if (dir < 0) end.joinL = true;
        else end.joinR = true;
      }
    }
  }
  // flat neighbours at the same height (a ledge that carries on as a block, say)
  for (const a of surfaces) {
    if (a.ramp) continue;
    for (const b of surfaces) {
      if (b.ramp || a.run === b.run || Math.abs(a.y - b.y) > 6) continue;
      const gap = b.x0 - a.x1;
      const foot = feet.find((f) => f.x > a.x1 - 3 && f.x < b.x0 + 3 && Math.abs(f.y - a.y) <= 8);
      if (gap < -1 || gap > (foot ? foot.reach + 4 : 8) || !a.endR || !b.endL) continue; // (anything wider is a hole: that takes a hop)
      if (!foot || foot.up < 0) add(a, b, { type: 'walk', dir: 1, cost: (mid(b) - mid(a)) / WALK });
      if (!foot || foot.up > 0) add(b, a, { type: 'walk', dir: -1, cost: (mid(b) - mid(a)) / WALK });
      a.joinR = b.joinL = true;
    }
  }

  // Before trying a move out, a quick look at whether there is any way through
  // at all: a coarse grid of the solid blocks, and a flood fill from the
  // take-off to the landing that may wander a little way either side and a
  // jump's height above. Walls and ceilings rule out most hopeless moves.
  const G = 40;
  const cols = Math.ceil(arena.w / G);
  const rows = Math.ceil(arena.h / G);
  const wallAt = new Uint8Array(cols * rows);
  for (const q of solids) {
    for (let r = Math.max(0, Math.round(q.y / G)); r < Math.min(rows, Math.round((q.y + q.h) / G)); r++) {
      for (let c = Math.max(0, Math.round(q.x / G)); c < Math.min(cols, Math.round((q.x + q.w) / G)); c++) wallAt[r * cols + c] = 1;
    }
  }
  const seen = new Uint16Array(cols * rows * 2);
  const queue = new Int32Array(cols * rows * 2);
  let stamp = 0;
  //   arc: the move is one rise and one fall (a trampoline, a launcher, an
  //   updraft): once the way through has started down it may not go up again
  const wayThrough = (xa, ya, xb, yb, side = 3, up = 9, arc = false) => {
    const ca = clamp(Math.floor(xa / G), 0, cols - 1);
    const ra = clamp(Math.floor((ya - 20) / G), 0, rows - 1);
    const cb = clamp(Math.floor(xb / G), 0, cols - 1);
    const rb = clamp(Math.floor((yb - 20) / G), 0, rows - 1);
    const c0 = Math.max(0, Math.min(ca, cb) - side);
    const c1 = Math.min(cols - 1, Math.max(ca, cb) + side);
    const r0 = Math.max(0, Math.min(ra, rb) - up);
    const r1 = Math.min(rows - 1, Math.max(ra, rb) + 1);
    if (++stamp > 65000) {
      seen.fill(0);
      stamp = 1;
    }
    const goal = rb * cols + cb;
    const n = cols * rows; // cells n.. are the same cells again, "on the way down"
    let head = 0;
    let tail = 0;
    queue[tail++] = ra * cols + ca;
    seen[ra * cols + ca] = stamp;
    while (head < tail) {
      const q = queue[head++];
      const down = q >= n ? n : 0;
      const k = q - down;
      if (k === goal) return true;
      const c = k % cols;
      const r = (k - c) / cols;
      if (c > c0 && !wallAt[k - 1] && seen[q - 1] !== stamp) seen[(queue[tail++] = q - 1)] = stamp;
      if (c < c1 && !wallAt[k + 1] && seen[q + 1] !== stamp) seen[(queue[tail++] = q + 1)] = stamp;
      if (!down && r > r0 && !wallAt[k - cols] && seen[k - cols] !== stamp) seen[(queue[tail++] = k - cols)] = stamp;
      const under = k + cols + (arc ? n : down);
      if (r < r1 && !wallAt[k + cols] && seen[under] !== stamp) seen[(queue[tail++] = under)] = stamp;
    }
    return false;
  };

  // 2b. Off the ends: step off, or jump - across a gap, over thorns, up onto a block
  for (const a of surfaces) {
    for (const dir of [-1, 1]) {
      if (!(dir > 0 ? a.endR : a.endL) || (dir > 0 ? a.joinR : a.joinL)) continue;
      const open = dir > 0 ? a.openR : a.openL;
      const tx = dir > 0 ? a.x1 : a.x0;
      if (tx <= HALF + 1 || tx >= arena.w - HALF - 1) continue; // the wall of the arena
      const ay = heightAt(a, tx);
      const wet = zoneAt(tx + dir * 8, ay); // what the ground turns into right here, if anything
      // under a low ceiling a jump is cut short: how far can a level hop get from here?
      let room = 1e9;
      for (const q of solids) if (q.x < tx + HALF && q.x + q.w > tx - HALF && q.y + q.h <= ay - PH + 1) room = Math.min(room, ay - PH - (q.y + q.h));
      const levelReach = room < 200 ? WALK * 120 * (0.14 + Math.sqrt((2 * room) / 1300)) + 24 : 1e9;
      for (const list of byRun) {
        if (list[0].run === a.run) continue;
        // the nearest piece of that stretch that is within reach at all
        let pick = null;
        let pickGap = Infinity;
        let how = '';
        for (const b of list) {
          const ax = clamp(tx, b.x0 + 14, b.x1 - 14);
          const gap = (ax - tx) * dir;
          if (gap < -20 || gap >= pickGap) continue;
          const rise = ay - heightAt(b, ax);
          if (rise < -6) {
            const first = below(ax, ay - 4, a); // lower down: only if nothing else would catch us first
            if (!first || first.run !== b.run) continue;
          }
          let way = '';
          if (!open) {
            if (rise > PH - 2 && gap <= 70 && gap <= reachOf('hop', rise)) way = 'hop'; // up the wall we are standing against
          } else if (rise < -10 && gap <= reachOf('fall', rise) + 6) way = 'fall';
          else if (Math.abs(rise) <= 6 && wet && wet.kind === 'lift' && gap < 200) way = 'fall'; // wade through the updraft
          else if (gap <= reachOf('hop', rise) + 6) way = 'hop';
          if (!way || (Math.abs(rise) <= 20 && gap > levelReach) || !wayThrough(tx, ay, ax, ay - rise, 1)) continue;
          pick = b;
          pickGap = gap;
          how = way;
        }
        if (!pick) continue;
        const e = { type: how, x: tx, dir, lip: true };
        const start = how === 'fall' ? clamp(tx - dir * 34, a.x0, a.x1) : clamp(tx - dir * 4, a.x0, a.x1);
        if (!tryEdge(a, pick, e, start) && how === 'fall' && pickGap <= reachOf('hop', ay - heightAt(pick, clamp(tx, pick.x0 + 14, pick.x1 - 14))) + 6) {
          tryEdge(a, pick, { type: 'hop', x: tx, dir, lip: true }, clamp(tx - dir * 4, a.x0, a.x1));
        }
      }
    }
  }

  // 2c. Straight up through a thin ledge or slope, round the side of a block
  //     overhead, and down through a thin ledge
  const clearColumn = (x, yTop, yBot) => !solids.some((b) => b.x < x + HALF && b.x + b.w > x - HALF && b.y < yBot && b.y + b.h > yTop);
  const sideDone = new Set();
  for (const a of surfaces) {
    for (const b of surfaces) {
      if (a.run === b.run) continue;
      const lo = Math.max(a.x0, b.x0) + 6;
      const hi = Math.min(a.x1, b.x1) - 6;
      if (hi - lo < 12) continue;
      const m = (lo + hi) / 2;
      const rise = heightAt(a, m) - heightAt(b, m); // > 0: b is higher
      if (rise > 6 && reachOf('hop', rise) >= 0) {
        let done = false;
        if (b.oneway) {
          const xs = [m, lo + 8, hi - 8].filter((x, i) => i === 0 || hi - lo > 80);
          const good = [];
          let cost = 0;
          for (const x of xs) {
            if (!clearColumn(x, heightAt(b, x) - PH - 6, heightAt(a, x) - 1)) continue;
            if (good.length) {
              good.push(x); // the same jump a little to one side, with nothing solid in the way
              continue;
            }
            const got = attempt(a, b, { type: 'up', x }, x);
            if (got && got.to === b) {
              good.push(x);
              cost = got.ticks;
            }
          }
          if (good.length) {
            add(a, b, { type: 'up', xs: good.sort((p, q) => p - q), cost });
            done = true;
          }
        }
        if (!done) {
          // take off beside it and come down on top
          for (const dir of [1, -1]) {
            if (dir > 0 ? !b.endL : !b.endR) continue;
            const edge = dir > 0 ? (b.wall ? b.wall[0] : b.x0) : b.wall ? b.wall[1] : b.x1;
            const x = edge - dir * (HALF + 14);
            const from = byRun[a.run].find((s) => x >= s.x0 && x <= s.x1);
            const key = a.run + ':' + b.id + ':' + dir;
            if (!from || sideDone.has(key)) continue;
            sideDone.add(key);
            tryEdge(from, b, { type: 'hop', x, dir }, x);
          }
        }
      } else if (rise < -6 && a.oneway) {
        // hold down and fall through
        const xs = [m, lo + 8, hi - 8].filter((x, i) => i === 0 || hi - lo > 80).filter((x) => {
          const under = below(x, heightAt(a, x), a);
          return under && under.run === b.run && !liftAt(x, heightAt(a, x) + 60) && !liftAt(x, heightAt(b, x));
        });
        if (!xs.length) continue;
        const got = attempt(a, b, { type: 'drop', x: xs[0] }, xs[0]);
        if (got && got.to === b) add(a, b, { type: 'drop', xs: xs.sort((p, q) => p - q), cost: got.ticks });
      }
    }
  }

  // Which pieces of ground touch a zone (a pad, a portal, the foot of an updraft)?
  const beside = (z) => {
    const out = [];
    for (const s of surfaces) {
      if (s.ramp || s.y < z.y0 - 1 || s.y > z.y1 + 1) continue;
      if (s.endR && Math.abs(s.x1 - z.x0) < 3) out.push([s, 1]);
      else if (s.endL && Math.abs(s.x0 - z.x1) < 3) out.push([s, -1]);
    }
    return out;
  };
  // one landing spot per stretch of ground: the piece nearest to x
  const nearestPieces = (x) => byRun.map((list) => list.reduce((best, s) => (Math.abs(clamp(x, s.x0, s.x1) - x) < Math.abs(clamp(x, best.x0, best.x1) - x) ? s : best)));

  // 2d. Trampolines and launchers: walk in, and steer for wherever can be reached
  arena.tramps.forEach((t, i) => {
    const z = zones.find((q) => q.kind === 'pad' && q.i === i);
    const sides = beside(z);
    if (!sides.length) return;
    const sgn = Math.sign(t.vx);
    const py = t.y + t.h;
    if (sgn) sides.sort((p, q) => q[1] * sgn - p[1] * sgn); // a launcher is tried from the side it throws away from
    let targets;
    if (!sgn) targets = nearestPieces(t.cx).filter((b) => py - b.y >= 40 && Math.abs(clamp(t.cx, b.x0 + 14, b.x1 - 14) - t.cx) <= reachOf('tramp', py - heightAt(b, clamp(t.cx, b.x0, b.x1))) + 10);
    else {
      // a launcher: every piece it can throw you onto, near or far
      targets = surfaces.filter((b) => {
        const ax = clamp(t.cx + sgn * 500, b.x0 + 14, b.x1 - 14);
        const rise = py - heightAt(b, ax);
        const dx = (ax - t.cx) * sgn;
        return dx <= reachOf('fwd', rise) + 10 && dx >= -reachOf('back', Math.max(rise, 0)) + 20 && !(Math.abs(rise) < 3 && Math.abs(dx) < 120);
      });
    }
    const [first, firstDir] = sides[0];
    for (const b of targets) {
      if (b.run === first.run) continue;
      const bx = clamp(t.cx, b.x0 + 14, b.x1 - 14);
      if (!wayThrough(t.cx, py, bx, heightAt(b, bx), 4, sgn ? 12 : 18, true)) continue;
      const e = { type: 'pad', x: t.cx, dir: firstDir, pad: i };
      const got = attempt(first, b, e, clamp(t.cx - firstDir * 60, first.x0, first.x1), 320);
      if (!got) continue;
      add(first, got.to, { ...e, cost: got.ticks, land: got.x });
      // from the other side of the pad it is the same flight
      for (const [other, dir] of sides.slice(1)) if (other.run !== got.to.run) add(other, got.to, { ...e, dir, cost: got.ticks, land: got.x });
    }
  });

  // 2e. Updrafts: get into the column, ride it, steer off at the right height
  arena.lifts.forEach((lz, i) => {
    const zx = lz.x + lz.w / 2;
    const z = zones.find((q) => q.kind === 'lift' && q.i === i);
    const ins = []; // ways in: [surface, edge template, where to start]
    for (const [s, dir] of beside(z)) ins.push([s, { type: 'lift', x: zx, dir, jump: false }, dir > 0 ? s.x1 - 4 : s.x0 + 4]);
    for (const s of surfaces) {
      const sy = heightAt(s, clamp(zx, s.x0, s.x1));
      if (zx >= s.x0 && zx <= s.x1) {
        // underneath: jump up into it
        const gap = sy - (lz.y + lz.h);
        if (gap > PH - 2 && gap < 170) ins.push([s, { type: 'lift', x: zx, dir: 0, jump: true }, zx]);
        continue;
      }
      // beside it: step or jump across
      const dir = zx > s.x1 ? 1 : -1;
      const lip = dir > 0 ? s.x1 : s.x0;
      if (!(dir > 0 ? s.endR && s.openR && !s.joinR : s.endL && s.openL && !s.joinL)) continue;
      const gap = Math.abs(zx - lip) - lz.w / 2 - HALF;
      if (gap < 6 || gap > 220 || sy < lz.y + 30 || sy > lz.y + lz.h + 100) continue;
      if (zoneAt(lip + dir * 8, sy)) continue;
      ins.push([s, { type: 'lift', x: zx, dir, lip, jump: gap > 40 }, lip - dir * 4]);
    }
    ins.sort((p, q) => heightAt(q[0], q[2]) - heightAt(p[0], p[2])); // lowest way in first
    const dud = new Set();
    for (const [a, tpl, start] of ins) {
      const ay = heightAt(a, start);
      for (const b of nearestPieces(zx)) {
        if (b.run === a.run) continue;
        const ax = clamp(zx, b.x0 + 14, b.x1 - 14);
        const by = heightAt(b, ax);
        const off = Math.abs(ax - zx);
        if (by > ay - 70 || by < lz.y - 300 || off > 380) continue;
        if (!b.oneway && off === 0) continue; // cannot rise through a solid block
        // a ceiling over the column below where we want to get off? no way round from it to the landing?
        if (solids.some((q) => q.x < zx + HALF && q.x + q.w > zx - HALF && q.y + q.h > by - 60 && q.y + q.h <= ay - PH)) continue;
        if (!wayThrough(zx, by, ax, by, 3, 8, true) || dud.has(b.id)) continue;
        if (tryEdge(a, b, { ...tpl }, start, 400)) continue;
        // into an opening in the wall of a shaft: ride up the side of the column nearest to it
        if (off > 30 && off < 160 && tryEdge(a, b, { ...tpl, x: zx + Math.sign(ax - zx) * (lz.w / 2 + HALF - 10) }, start, 400)) continue;
        if (off > 150 && by > lz.y + 100 && tryEdge(a, b, { ...tpl, over: 110 }, start, 400)) continue;
        dud.add(b.id); // the ride is the same from every way in: no need to try this landing again from higher up
      }
    }
  });

  // 2f. Portals: walk in, come out at the partner
  arena.portals.forEach((p, i) => {
    const z = zones.find((q) => q.kind === 'portal' && q.i === i);
    const d = arena.portals[p.to];
    const dz = zones.find((q) => q.kind === 'portal' && q.i === p.to);
    const outs = beside(dz);
    if (!outs.length) return;
    for (const [a, dir] of beside(z)) {
      // you come out standing in the exit, a step from the ground on either side of it
      let got = null;
      for (const [b] of outs) if ((got = attempt(a, b, { type: 'portal', x: p.cx, dir }, dir > 0 ? a.x1 - 4 : a.x0 + 4, 200))) break;
      if (!got) continue;
      for (const [b, side] of outs) add(a, b, { type: 'portal', x: p.cx, dir, exit: d.cx, cost: got.ticks + 6, land: side > 0 ? b.x1 : b.x0 });
    }
  });

  // 3. All-pairs quickest routes.
  const n = surfaces.length;
  const dist = Array.from({ length: n }, () => new Float32Array(n).fill(FAR));
  const hop = Array.from({ length: n }, () => new Array(n).fill(null)); // first edge to take
  for (const a of surfaces) {
    dist[a.id][a.id] = 0;
    for (const e of a.edges) {
      // walking to the take-off point and away from the landing counts too
      const b = surfaces[e.to];
      let cost = e.cost;
      if (e.type !== 'walk') {
        const tx = e.x ?? e.xs[e.xs.length >> 1];
        cost += Math.abs(clamp(tx, a.x0, a.x1) - mid(a)) / WALK + (e.land != null ? Math.abs(clamp(e.land, b.x0, b.x1) - mid(b)) / WALK : 0);
      }
      e.w = cost;
      if (cost < dist[a.id][e.to]) {
        dist[a.id][e.to] = cost;
        hop[a.id][e.to] = e;
      }
    }
  }
  for (let k = 0; k < n; k++) {
    const dk = dist[k];
    for (let i = 0; i < n; i++) {
      const di = dist[i];
      const ik = di[k];
      if (ik >= FAR) continue;
      const hi = hop[i];
      const first = hi[k];
      for (let j = 0; j < n; j++) {
        const v = ik + dk[j];
        if (v < di[j]) {
          di[j] = v;
          hi[j] = first;
        }
      }
    }
  }
  nav.dist = dist;
  nav.hop = hop;
  nav.stats = { surfaces: n, runs, edges: surfaces.reduce((c, s) => c + s.edges.length, 0), tries, steps };
  return nav;
}

// The surface a grounded player is standing on.
//   gk - what the physics says is underfoot (state.gk): 1 a solid block, which
//        rules out ledges and slopes; 2 a thin ledge or a slope, which rules out
//        blocks; 0 if not known
// Where a slope runs out onto a thin ledge, the ledge wins.
export function surfaceAt(nav, cx, feet, gk = 0) {
  let best = null;
  let bestD = 40;
  let slope = null;
  for (const s of nav.surfaces) {
    if (s.ramp) {
      if (!slope && gk !== 1 && cx >= s.lo && cx <= s.hi && Math.abs(rampY(s.ramp, cx) - feet) <= 5) slope = s;
      continue;
    }
    if (Math.abs(s.y - feet) > 1 || (gk === 1 && s.oneway) || (gk === 2 && !s.oneway)) continue; // (standing on it means exactly on it)
    const d = cx < s.x0 ? s.x0 - cx : cx > s.x1 ? cx - s.x1 : 0;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return slope && bestD > 0 ? slope : best;
}

// The surface nearest to a point (for "where is that player / item, roughly").
export function surfaceNear(nav, cx, feet) {
  const under = nav.below(cx, feet - 6, null);
  if (under && nav.heightAt(under, cx) - feet < 260) return under;
  let best = null;
  let bestD = Infinity;
  for (const s of nav.surfaces) {
    const dx = cx < s.x0 ? s.x0 - cx : cx > s.x1 ? cx - s.x1 : 0;
    const d = dx + Math.abs(s.y - feet) * 1.5;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
