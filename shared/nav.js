// A route map of an arena for the bots: which standing surfaces exist and how
// to get from one to another (walk, jump, double jump, drop, trampoline,
// updraft, portal). Slopes are cut into short pieces so they fit the same model.

import { PW, PH, MOVE_SPEED } from './config.js';
import { TRAMP_H, rampY } from './arenas.js';
import { RAMP_LIP } from './physics.js';

const HALF = PW / 2;
const RISE_1 = 165; // comfortable single jump
const RISE_2 = 315; // with the double jump
const RISE_T = 500; // off a trampoline
const PIECE = 80; // slopes are handled in pieces this long

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

export function buildNav(arena) {
  const solids = arena.platforms.filter((p) => !p.oneway);
  const surfaces = [];

  // 1. Standing surfaces: the top of every platform, minus the parts where a
  //    solid block is in the way. x0..x1 is where a player's centre can be.
  for (const p of arena.platforms) {
    let segs = [[Math.max(HALF, p.x + 2), Math.min(arena.w - HALF, p.x + p.w - 2)]];
    for (const b of solids) {
      if (b === p || b.y >= p.y || b.y + b.h <= p.y - PH + 1) continue;
      segs = cut(segs, b.x - HALF, b.x + b.w + HALF);
    }
    for (const [x0, x1] of segs) {
      if (x1 - x0 < 20) continue;
      // an end is "open" if you can walk off it
      const blocked = (x) => x <= HALF + 1 || x >= arena.w - HALF - 1 || solids.some((b) => b !== p && b.y < p.y && b.y + b.h > p.y - PH + 1 && x >= b.x - HALF - 3 && x <= b.x + b.w + HALF + 3);
      surfaces.push({ id: surfaces.length, y: p.y, x0, x1, oneway: p.oneway, openL: !blocked(x0), openR: !blocked(x1), ramp: null, edges: [] });
    }
  }
  // slopes, in pieces; each piece is treated as a small ledge at its middle height
  const chains = [];
  for (const r of arena.ramps) {
    const n = Math.max(1, Math.round((r.x1 - r.x0) / PIECE));
    const chain = [];
    for (let i = 0; i < n; i++) {
      const x0 = r.x0 + ((r.x1 - r.x0) * i) / n;
      const x1 = r.x0 + ((r.x1 - r.x0) * (i + 1)) / n;
      // lo..hi is where you count as standing on this piece (the end pieces include the slope's flat lip)
      const s = { id: surfaces.length, y: rampY(r, (x0 + x1) / 2), x0, x1, lo: x0 - (i === 0 ? RAMP_LIP + 2 : 0), hi: x1 + (i === n - 1 ? RAMP_LIP + 2 : 0), oneway: true, openL: true, openR: true, ramp: r, edges: [] };
      surfaces.push(s);
      chain.push(s);
    }
    chains.push({ r, chain });
  }

  const heightAt = (s, x) => (s.ramp ? rampY(s.ramp, x) : s.y);
  const clearColumn = (x, yTop, yBot) => !solids.some((b) => b.x < x + HALF && b.x + b.w > x - HALF && b.y < yBot && b.y + b.h > yTop);
  // would a body falling down this column pass through an updraft?
  const inLift = (x, yTop, yBot) => arena.lifts.some((z) => z.x < x + HALF && z.x + z.w > x - HALF && z.y < yBot && z.y + z.h > yTop);
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
  // is there a trampoline at this spot of a surface? (landing on one by accident sends you flying)
  const padAt = (surf, x, margin = 26) => !surf.ramp && arena.tramps.some((t) => Math.abs(t.y + TRAMP_H - surf.y) <= 2 && x > t.x - margin && x < t.x + t.w + margin);
  const add = (a, b, e) => {
    if (a === b) return;
    const old = a.edges.find((x) => x.to === b.id);
    if (old && old.cost <= e.cost) return;
    if (old) a.edges.splice(a.edges.indexOf(old), 1);
    a.edges.push({ from: a.id, to: b.id, ...e });
  };

  // 2a. Walking along a slope, and on and off its ends
  for (const { r, chain } of chains) {
    for (let i = 0; i + 1 < chain.length; i++) {
      add(chain[i], chain[i + 1], { type: 'walk', dir: 1, cost: 16 });
      add(chain[i + 1], chain[i], { type: 'walk', dir: -1, cost: 16 });
    }
    for (const [end, x, y, dir] of [
      [chain[0], r.x0, r.y0, -1],
      [chain[chain.length - 1], r.x1, r.y1, 1],
    ]) {
      for (const s of surfaces) {
        if (s.ramp === r || Math.abs(heightAt(s, x) - y) > 12) continue;
        if (x < s.x0 - 46 || x > s.x1 + 46) continue;
        const side = s.x0 > x ? 1 : s.x1 < x ? -1 : dir;
        const low = y >= Math.max(r.y0, r.y1) - 1; // the bottom end: you have to walk INTO it to go up
        add(end, s, { type: 'walk', dir: side, cost: 12 });
        add(s, end, { type: 'walk', dir: -dir, x, foot: low && !s.ramp, cost: 12 });
        if (low && !s.ramp && !s.oneway) (s.feet ||= []).push({ x, up: -dir });
      }
    }
  }

  // 2b. Everything else
  for (const a of surfaces) {
    for (const b of surfaces) {
      if (a === b || (a.ramp && a.ramp === b.ramp)) continue;
      const rise = a.y - b.y; // > 0: b is higher
      const side = b.x0 > a.x1 ? 1 : a.x0 > b.x1 ? -1 : 0;
      const gap = side > 0 ? b.x0 - a.x1 : side < 0 ? a.x0 - b.x1 : 0;
      const open = side > 0 ? a.openR : a.openL;
      const edgeX = side > 0 ? a.x1 : a.x0;

      if (Math.abs(rise) <= 6) {
        if (!side) continue;
        if (gap <= 44) add(a, b, { type: 'walk', dir: side, cost: 6 + gap / 5 });
        else if (open && gap <= 290) add(a, b, { type: 'hop', dir: side, x: edgeX, double: false, cost: 50 + gap / 5 });
        else if (open && gap <= 470) add(a, b, { type: 'hop', dir: side, x: edgeX, double: true, cost: 74 + gap / 5 });
      } else if (rise > 0) {
        if (!side) {
          // straight up through a thin ledge or slope
          if (!b.oneway || rise > RISE_2) continue;
          const xs = [];
          const lo = Math.max(a.x0, b.x0) + 6;
          const hi = Math.min(a.x1, b.x1) - 6;
          for (let x = lo; x <= hi; x += 14) if (clearColumn(x, b.y - PH - 6, a.y - 1)) xs.push(x);
          if (!xs.length && hi >= lo - 12 && clearColumn((lo + hi) / 2, b.y - PH - 6, a.y - 1)) xs.push((lo + hi) / 2);
          if (xs.length) add(a, b, { type: 'up', xs, double: rise > RISE_1, cost: (rise > RISE_1 ? 80 : 52) + rise / 10 });
        } else if (open || rise > PH) {
          // jump across and up
          if (rise <= RISE_1 && gap <= 280 - rise * 0.8) add(a, b, { type: 'hop', dir: side, x: edgeX, double: false, cost: 56 + gap / 5 + rise / 10 });
          else if (rise <= RISE_2 && gap <= 450 - rise * 0.7) add(a, b, { type: 'hop', dir: side, x: edgeX, double: true, cost: 82 + gap / 5 + rise / 10 });
        }
      } else {
        const drop = -rise;
        const reach = MOVE_SPEED * Math.sqrt((2 * drop) / 1500) * 0.75;
        if (!side) {
          if (a.oneway) {
            // hold down and fall through
            const xs = [];
            const lo = Math.max(a.x0, b.x0) + 4;
            const hi = Math.min(a.x1, b.x1) - 4;
            for (let x = lo; x <= hi; x += 14) if (below(x, heightAt(a, x), a) === b && !padAt(b, x) && !inLift(x, heightAt(a, x) - PH, heightAt(b, x))) xs.push(x);
            if (xs.length) add(a, b, { type: 'drop', xs, cost: 18 + drop / 10 });
          }
        } else if (open) {
          if (gap <= reach && !inLift(edgeX + side * 30, a.y - PH, b.y)) add(a, b, { type: 'fall', dir: side, x: edgeX, cost: 14 + gap / 5 + drop / 10 });
          else if (gap <= reach + 260) add(a, b, { type: 'hop', dir: side, x: edgeX, double: false, cost: 50 + gap / 5 + drop / 10 });
          else if (gap <= reach + 430) add(a, b, { type: 'hop', dir: side, x: edgeX, double: true, cost: 74 + gap / 5 + drop / 10 });
        }
      }
    }
    // stepping off an open end lands on whatever is underneath
    for (const dir of [-1, 1]) {
      if (!(dir > 0 ? a.openR : a.openL)) continue;
      const x = dir > 0 ? a.x1 : a.x0;
      const b = below(x + dir * 26, heightAt(a, x), a);
      if (b && !(a.ramp && a.ramp === b.ramp) && !padAt(b, x + dir * 40, 40) && !inLift(x + dir * 26, heightAt(a, x) - PH, heightAt(b, x))) add(a, b, { type: 'fall', dir, x, cost: 14 + (heightAt(b, x) - heightAt(a, x)) / 10 });
    }
  }

  // trampolines
  for (const t of arena.tramps) {
    const a = surfaces.find((s) => !s.ramp && Math.abs(s.y - (t.y + TRAMP_H)) <= 2 && t.cx >= s.x0 - 12 && t.cx <= s.x1 + 12);
    if (!a) continue;
    for (const b of surfaces) {
      const rise = a.y - b.y;
      if (rise < 60 || rise > RISE_T) continue;
      const d = t.cx < b.x0 + 12 ? b.x0 + 12 - t.cx : t.cx > b.x1 - 12 ? t.cx - (b.x1 - 12) : 0;
      if (d > 330) continue;
      if (!b.oneway && d === 0) continue; // cannot bounce up through a solid block
      if (!clearColumn(t.cx, Math.max(b.y - PH, a.y - rise * 0.6), a.y - PH - 2)) continue;
      add(a, b, { type: 'tramp', x: t.cx, cost: 60 + rise / 10 + d / 6 });
    }
  }

  // updrafts: get into the column, ride it, steer off at the top
  for (const z of arena.lifts) {
    const zx = z.x + z.w / 2;
    for (const a of surfaces) {
      const ay = heightAt(a, Math.max(a.x0, Math.min(a.x1, zx)));
      if (ay < z.y + 60 || ay > z.y + z.h + 6) continue; // must be able to stand inside or right under the column
      const d = zx < a.x0 ? a.x0 - zx : zx > a.x1 ? zx - a.x1 : 0;
      if (d > 70) continue;
      for (const b of surfaces) {
        if (b === a || b.y > ay - 70 || b.y < z.y - 100) continue;
        const bd = zx < b.x0 + 12 ? b.x0 + 12 - zx : zx > b.x1 - 12 ? zx - (b.x1 - 12) : 0;
        if (bd > 240 || (!b.oneway && bd === 0)) continue;
        add(a, b, { type: 'lift', x: zx, cost: 30 + (ay - b.y) / 8 + bd / 6 });
      }
    }
  }

  // portals
  for (const p of arena.portals) {
    const d = arena.portals[p.to];
    const a = surfaces.find((s) => !s.ramp && Math.abs(s.y - (p.y + p.h)) <= 2 && p.cx >= s.x0 - 12 && p.cx <= s.x1 + 12);
    const b = surfaces.find((s) => !s.ramp && Math.abs(s.y - (d.y + d.h)) <= 2 && d.cx >= s.x0 - 12 && d.cx <= s.x1 + 12);
    if (a && b) add(a, b, { type: 'portal', x: p.cx, cost: 40 });
  }

  // 3. All-pairs shortest routes (the graph is tiny, so brute force is fine).
  const n = surfaces.length;
  const dist = Array.from({ length: n }, () => new Float32Array(n).fill(1e9));
  const hop = Array.from({ length: n }, () => new Array(n).fill(null)); // first edge to take
  const mid = (s) => (s.x0 + s.x1) / 2;
  for (const a of surfaces) {
    dist[a.id][a.id] = 0;
    for (const e of a.edges) {
      // walking to the take-off point and away from the landing counts too
      const tx = e.x ?? (e.xs ? e.xs[e.xs.length >> 1] : mid(a));
      const cost = e.cost + Math.abs(tx - mid(a)) / 10;
      if (cost < dist[a.id][e.to]) {
        dist[a.id][e.to] = cost;
        hop[a.id][e.to] = e;
      }
    }
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const ik = dist[i][k];
      if (ik >= 1e9) continue;
      for (let j = 0; j < n; j++) {
        const d = ik + dist[k][j];
        if (d < dist[i][j]) {
          dist[i][j] = d;
          hop[i][j] = hop[i][k];
        }
      }
    }
  }

  // trampolines sitting on each surface, so walkers can hop over them
  for (const sf of surfaces) sf.pads = sf.ramp ? [] : arena.tramps.filter((t) => Math.abs(t.y + TRAMP_H - sf.y) <= 2 && t.cx >= sf.x0 - 12 && t.cx <= sf.x1 + 12);

  const liftAt = (x, y) => arena.lifts.find((z) => x > z.x - HALF && x < z.x + z.w + HALF && y > z.y && y - PH < z.y + z.h) || null;
  return { surfaces, dist, hop, below, heightAt, liftAt };
}

// The surface a grounded player is standing on.
// (solid = standing on a solid block, which rules out the slopes that end on it)
export function surfaceAt(nav, cx, feet, solid = false) {
  let best = null;
  let bestD = 30;
  for (const s of nav.surfaces) {
    if (s.ramp) {
      if (solid || cx < s.lo || cx > s.hi || Math.abs(rampY(s.ramp, cx) - feet) > 5) continue;
      return s;
    }
    if (Math.abs(s.y - feet) > 3) continue;
    const d = cx < s.x0 ? s.x0 - cx : cx > s.x1 ? cx - s.x1 : 0;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
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
