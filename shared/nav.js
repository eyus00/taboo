// A route map of an arena for the bots: which standing surfaces exist and how
// to get from one to another (walk, jump, double jump, drop, trampoline, portal).

import { PW, PH, MOVE_SPEED } from './config.js';
import { TRAMP_H } from './arenas.js';

const HALF = PW / 2;
const RISE_1 = 180; // comfortable single jump
const RISE_2 = 325; // with the double jump
const RISE_T = 485; // off a trampoline

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
      surfaces.push({ id: surfaces.length, y: p.y, x0, x1, oneway: p.oneway, openL: !blocked(x0), openR: !blocked(x1), edges: [] });
    }
  }

  const clearColumn = (x, yTop, yBot) => !solids.some((b) => b.x < x + HALF && b.x + b.w > x - HALF && b.y < yBot && b.y + b.h > yTop);
  const below = (x, y, skip) => {
    // first surface underneath a point
    let best = null;
    for (const s of surfaces) {
      if (s === skip || s.y < y + 2 || x < s.x0 - 6 || x > s.x1 + 6) continue;
      if (!best || s.y < best.y) best = s;
    }
    return best;
  };
  // is there a trampoline at this spot of a surface? (landing on one by accident sends you flying)
  const padAt = (surf, x, margin = 26) => arena.tramps.some((t) => Math.abs(t.y + TRAMP_H - surf.y) <= 2 && x > t.x - margin && x < t.x + t.w + margin);
  const add = (a, b, e) => {
    if (a === b) return;
    const old = a.edges.find((x) => x.to === b.id);
    if (old && old.cost <= e.cost) return;
    if (old) a.edges.splice(a.edges.indexOf(old), 1);
    a.edges.push({ from: a.id, to: b.id, ...e });
  };

  // 2. Edges
  for (const a of surfaces) {
    for (const b of surfaces) {
      if (a === b) continue;
      const rise = a.y - b.y; // > 0: b is higher
      const side = b.x0 > a.x1 ? 1 : a.x0 > b.x1 ? -1 : 0;
      const gap = side > 0 ? b.x0 - a.x1 : side < 0 ? a.x0 - b.x1 : 0;
      const open = side > 0 ? a.openR : a.openL;
      const edgeX = side > 0 ? a.x1 : a.x0;

      if (Math.abs(rise) <= 6) {
        if (!side) continue;
        if (gap <= 44) add(a, b, { type: 'walk', dir: side, cost: 6 + gap / 5 });
        else if (open && gap <= 235) add(a, b, { type: 'hop', dir: side, x: edgeX, double: false, cost: 40 + gap / 5 });
        else if (open && gap <= 400) add(a, b, { type: 'hop', dir: side, x: edgeX, double: true, cost: 60 + gap / 5 });
      } else if (rise > 0) {
        if (!side) {
          // straight up through a thin ledge
          if (!b.oneway || rise > RISE_2) continue;
          const xs = [];
          const lo = Math.max(a.x0, b.x0) + 6;
          const hi = Math.min(a.x1, b.x1) - 6;
          for (let x = lo; x <= hi; x += 14) if (clearColumn(x, b.y - PH - 6, a.y - 1)) xs.push(x);
          if (!xs.length && hi >= lo - 12 && clearColumn((lo + hi) / 2, b.y - PH - 6, a.y - 1)) xs.push((lo + hi) / 2);
          if (xs.length) add(a, b, { type: 'up', xs, double: rise > RISE_1, cost: (rise > RISE_1 ? 62 : 40) + rise / 12 });
        } else if (open || rise > PH) {
          // jump across and up
          if (rise <= RISE_1 && gap <= 235 - rise * 0.75) add(a, b, { type: 'hop', dir: side, x: edgeX, double: false, cost: 46 + gap / 5 + rise / 12 });
          else if (rise <= RISE_2 && gap <= 400 - rise * 0.7) add(a, b, { type: 'hop', dir: side, x: edgeX, double: true, cost: 66 + gap / 5 + rise / 12 });
        }
      } else {
        const drop = -rise;
        const reach = MOVE_SPEED * Math.sqrt((2 * drop) / 2800) * 0.8;
        if (!side) {
          if (a.oneway) {
            // hold down and fall through
            const xs = [];
            const lo = Math.max(a.x0, b.x0) + 4;
            const hi = Math.min(a.x1, b.x1) - 4;
            for (let x = lo; x <= hi; x += 14) if (below(x, a.y, a) === b && !padAt(b, x)) xs.push(x);
            if (xs.length) add(a, b, { type: 'drop', xs, cost: 14 + drop / 14 });
          }
        } else if (open) {
          if (gap <= reach) add(a, b, { type: 'fall', dir: side, x: edgeX, cost: 12 + gap / 5 + drop / 14 });
          else if (gap <= reach + 215) add(a, b, { type: 'hop', dir: side, x: edgeX, double: false, cost: 40 + gap / 5 + drop / 14 });
          else if (gap <= reach + 380) add(a, b, { type: 'hop', dir: side, x: edgeX, double: true, cost: 60 + gap / 5 + drop / 14 });
        }
      }
    }
    // stepping off an open end lands on whatever is underneath
    for (const dir of [-1, 1]) {
      if (!(dir > 0 ? a.openR : a.openL)) continue;
      const x = dir > 0 ? a.x1 : a.x0;
      const b = below(x + dir * 26, a.y, a);
      if (b && !padAt(b, x + dir * 40, 40)) add(a, b, { type: 'fall', dir, x, cost: 12 + (b.y - a.y) / 14 });
    }
  }

  // trampolines
  for (const t of arena.tramps) {
    const a = surfaces.find((s) => Math.abs(s.y - (t.y + TRAMP_H)) <= 2 && t.cx >= s.x0 - 12 && t.cx <= s.x1 + 12);
    if (!a) continue;
    for (const b of surfaces) {
      const rise = a.y - b.y;
      if (rise < 60 || rise > RISE_T) continue;
      const d = t.cx < b.x0 + 12 ? b.x0 + 12 - t.cx : t.cx > b.x1 - 12 ? t.cx - (b.x1 - 12) : 0;
      if (d > 300) continue;
      if (!b.oneway && d === 0) continue; // cannot bounce up through a solid block
      if (!clearColumn(t.cx, Math.max(b.y - PH, a.y - rise * 0.6), a.y - PH - 2)) continue;
      add(a, b, { type: 'tramp', x: t.cx, cost: 44 + rise / 14 + d / 6 });
    }
  }

  // portals
  for (const p of arena.portals) {
    const d = arena.portals[p.to];
    const a = surfaces.find((s) => Math.abs(s.y - (p.y + p.h)) <= 2 && p.cx >= s.x0 - 12 && p.cx <= s.x1 + 12);
    const b = surfaces.find((s) => Math.abs(s.y - (d.y + d.h)) <= 2 && d.cx >= s.x0 - 12 && d.cx <= s.x1 + 12);
    if (a && b) add(a, b, { type: 'portal', x: p.cx, cost: 10 });
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
  for (const sf of surfaces) sf.pads = arena.tramps.filter((t) => Math.abs(t.y + TRAMP_H - sf.y) <= 2 && t.cx >= sf.x0 - 12 && t.cx <= sf.x1 + 12);

  return { surfaces, dist, hop, below };
}

// The surface a grounded player is standing on.
export function surfaceAt(nav, cx, feet) {
  let best = null;
  let bestD = 30;
  for (const s of nav.surfaces) {
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
  if (under && under.y - feet < 260) return under;
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
