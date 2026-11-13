// Arenas, drawn as text. Every arena is 64 x 36 tiles (one tile = 40 px): a good
// two screens wide and two high, so the camera follows the player and a minimap
// shows the rest.
//
//   #  solid block: land on top, bump into the sides, bonk your head underneath
//   =  thin ledge: jump up through it, land on it, hold DOWN to drop through
//   ^  trampoline (sits on the tile below it)      < >  launcher: flings you up and to that side
//   x  thorns (on the tile below): a sting and a short stun
//   u  updraft: a column of rising air that carries you up
//   A/a B/b C/c  portal pairs: step into one and fly to its partner as an orb
//   *  a place where lucky boxes can appear
//   1-6  player start positions      r  where you come back after falling in a pit
//        (starts 7-10 are worked out: see extraStarts below)
//   7 8  the two team bases (flag stands) for team battles; left and right ends if left out
//   .  air
//
// "drop" lists the portal letters you can let go from mid-flight (press jump).
// Slopes are listed separately as "ramps": [col, row, col, row] from one end to
// the other, in tiles. They behave like thin ledges that happen to be tilted.
// A player's centre line rides the slope, so where a slope meets the side of a
// solid block it has to end 0.4 tiles (half a player) clear of it.
// The left and right edges of the map are walls; a gap in the floor is a pit.
//
// Things worth knowing when drawing one (the tests at the end of
// test/sim.test.js check most of them, and public/_map.html draws the result;
// add &open=1 there to see the open ground shaded):
//  * Room to run comes first. Every arena has at least four flat stretches of
//    14 tiles or more (one of them 24) with nothing standing on them and five
//    tiles of clear air above. Few, long platforms; floors 6 or 7 tiles apart,
//    which a jump and the jump in mid-air still climb through a thin ledge.
//  * Pads, portals, updrafts and thorns live at the END of a stretch: against
//    a wall or a cliff, on a side ledge, in a pit, under the foot of a climb.
//    They are shortcuts to choose, not things to trip over. At most 8 pads and
//    4 updrafts an arena, 4 to 8 thorn patches (the maze may have 12), and no
//    more than a quarter of the bottom floor within two tiles of any of them.
//  * A jump clears 4 tiles up (7 with the jump in mid-air), a trampoline 12, a
//    launcher 7 up and 15 across. Walking covers 7 or 8 tiles a second.
//    Look at where a launcher lands you: on clear ground, never in a portal.
//  * Walking into the LOW end of a slope that rests on the ground takes you up
//    it, and to get past it on the ground you have to hold DOWN - so nothing
//    people need (a flag, say) goes behind one. A slope whose low end hangs a
//    tile above the ground is hopped onto, and the ground runs on underneath:
//    that is the one to use for stairs over a floor. Slopes are gentle (none
//    steeper than 3 in 4) and meet flat ground at the END of a ledge or at the
//    top corner of a block.
//  * Leave two free tiles between thorns, pads, portals and walls, or the bit
//    of ground between them is too small to stand on. (Thorns hard up
//    against a trapdoor, with no gap at all, are fine too.)
//  * Portals near both flags make the other team's flag too easy to reach: link
//    a base to its own side of the map, and keep a pair that crosses the map a
//    good way from both flags (the canyon has no pair across at all).
//  * No arena has a pit you can fall out of at present: the two in the canyon
//    and the well in the maze are full of wind. If you draw one ('r' marks
//    where people come back), put it at the end of a stretch, in plain sight,
//    and never under a ledge or a slope that people drop through.

import { PW, PH, MAX_PLAYERS, LAUNCH_VX, LAUNCH_VY } from './config.js';

export const TILE = 40;
export const LEDGE_H = 14;
export const TRAMP_H = 16;
export const PORTAL_W = 44;
export const PORTAL_H = 76;

const MAPS = [
  {
    id: 'hills',
    name: 'Bounce Hills',
    blurb: 'Two mesas and a wide open valley under an arch of sky ledges. The bounce at each wall goes all the way to the top.',
    drop: 'A',
    ramps: [[19, 34, 10.4, 29], [18, 22, 25, 17], [45, 34, 53.6, 29], [46, 22, 39, 17]],
    map: [
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '....A..x..>>............c....x.**.x....b............<<..x..a....',
      '==============......========================......==============',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu.........................*..5..6..*.........................uu',
      'uu.......................==============.......................uu',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu....*...3...*..................................*...4...*....uu',
      '==================............................==================',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '^^..7..1................................................2..8..^^',
      '##########............................................##########',
      '##########............................................##########',
      '##########............................................##########',
      '##########............................................##########',
      '##########B...........*.....*......*.....*...........C##########',
      '################################################################',
      '################################################################',
    ],
  },
  {
    id: 'canyon',
    name: 'Windy Canyon',
    blurb: 'Two cliffs and a broken bridge over a long canyon floor. The wind in the pit at the foot of each cliff blows you back up.',
    drop: 'BC',
    ramps: [[18, 20, 24, 23], [24, 12, 16, 16], [46, 20, 40, 23], [40, 12, 48, 16]],
    map: [
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '..............................x..x..............................',
      '....B..x..>>............================............<<..x..C....',
      '============........................................============',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '^^...7..1.*.....*..............................*.....*.2..8...^^',
      '############======............................======############',
      '############uuu..................................uuu############',
      '############uuu..................................uuu############',
      '############uuu..................................uuu############',
      '############uuu..................................uuu############',
      '############uuu..................................uuu############',
      '############uuu.......b...*..5....6..*...c.......uuu############',
      '############uuu.......====================.......uuu############',
      '############uuu..................................uuu############',
      '############uuu..................................uuu############',
      '############uuu..................................uuu############',
      '############uuu..................................uuu############',
      '############uuu..................................uuu############',
      '############uuu....3..*...*...*..*...*...*..4....uuu############',
      '############uuu##################################uuu############',
      '############uuu##################################uuu############',
    ],
  },
  {
    id: 'pagoda',
    name: 'Sky Pagoda',
    blurb: 'An open tower of three wide storeys. Climb the eaves outside or ride the chimney inside; the courtyard runs right through.',
    drop: 'A',
    ramps: [
      [15, 27, 9, 30], [16, 20, 10, 23], [22, 13, 18, 15], [49, 27, 55, 30], [48, 20, 54, 23],
      [42, 13, 46, 15],
    ],
    map: [
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '...........................b..x**x..c...........................',
      '.........................==============.........................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '.........................*.....uu.....*.........................',
      '......................=========uu=========......................',
      'A...x...>>.....................uu.....................<<...x...a',
      '==========.....................uu.....................==========',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '......................*...5....uu....6...*......................',
      '................===============uu===============................',
      '....B..>>......................uu......................<<..C....',
      '=========......................uu......................=========',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '.................3..*......*...uu...*......*..4.................',
      '...............================..================...............',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '^^...7..1...........*.......*......*.......*...........2..8...^^',
      '################################################################',
      '################################################################',
    ],
  },
  {
    id: 'zigzag',
    name: 'Switchback',
    blurb: 'A trail zigzags up each wall to two long benches. The launcher at the first hairpin and the wind in the pass each skip a leg.',
    drop: 'A',
    ramps: [
      [18, 33, 8, 28], [5, 27, 14, 22], [12, 21, 5, 16], [46, 33, 56, 28], [59, 27, 50, 22],
      [52, 21, 59, 16],
    ],
    map: [
      '................................................................',
      '................................................................',
      '................................................................',
      '.........................x..b.*..*.c..x.........................',
      '.........................==============.........................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '......A..x.....*....5...*......uu......*...6....*.....x..a......',
      '......========================.uu.========================......',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      'B..............................uu..............................C',
      '=====..........................uu..........................=====',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '..................*..3....*....uu....*....4..*..................',
      '..............================....================..............',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '..>>........................................................<<..',
      '..======................................................======..',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '^^...7....1...........*.....*......*.....*...........2....8...^^',
      '################################################################',
      '################################################################',
    ],
  },
  {
    id: 'dojo',
    name: 'Twin Keeps',
    blurb: 'Two keeps across a wide courtyard, the flags in their halls. A long rampart walk joins the battlements high above.',
    drop: 'A',
    ramps: [[12.4, 27, 22, 33], [8, 13, 16, 17], [51.6, 27, 42, 33], [56, 13, 48, 17]],
    map: [
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '>>..A......................................................a..<<',
      '========................................................========',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '....b..x............*......*........*......*............x..c....',
      '============....================================....============',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu............................................................uu',
      'uu...3..*.................x.*..^^..*.x.................*..4...uu',
      '############..............============..............############',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      'B....7...1..*...........*..5..*..*..6..*...........*..2...8....C',
      '################################################################',
      '################################################################',
    ],
  },
  {
    id: 'bramble',
    name: 'Bramble Maze',
    blurb: 'Three long floors, each open at one end only, and a windy well up the middle. Find the stairs and trapdoors, and mind the brambles.',
    drop: 'A',
    ramps: [
      [5.6, 27, 1.2, 30], [22.4, 20, 26.8, 23], [5.6, 13, 1.2, 16], [58.4, 27, 62.8, 30],
      [41.6, 20, 37.2, 23], [58.4, 13, 62.8, 16],
    ],
    map: [
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '................................................................',
      '.....................<<x....b..**..c....x>>.....................',
      '.....................======================.....................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '..........*......*...x.........uu.........x...*......*..........',
      '......################==#######uu#######==################......',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      'A......x....*....5.............uu.............6....*....x......a',
      '########==############.........uu.........############==########',
      '..............#................uu................#..............',
      '..............#................uu................#..............',
      '..............#................uu................#..............',
      '...............................uu...............................',
      '...............................uu...............................',
      '.........3...*.........^^...x..uu..x...^^.........*...4.........',
      '......#######################==uu==#######################......',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      '...............................uu...............................',
      'B........7...1.....*.....*.....uu.....*.....*.....2...8........C',
      '###############################uu###############################',
      '###############################uu###############################',
    ],
  },
];

function parse(def) {
  const rows = def.map;
  const R = rows.length;
  const C = rows[0].length;
  const at = (r, c) => (r >= 0 && r < R && c >= 0 && c < C ? rows[r][c] : '.');
  const platforms = [];
  const tramps = [];
  const spikes = [];
  const bases = [];
  const lifts = [];
  const portals = [];
  const pickups = [];
  const spawns = [];
  const respawns = [];
  const letters = {};

  // Runs of a character along a row, merged downwards when the run repeats
  // exactly on the next row (so a block of '#' becomes one rectangle).
  const blocks = (ch, make) => {
    const open = new Map();
    for (let r = 0; r <= R; r++) {
      const seen = new Set();
      for (let c = 0; c < C; c++) {
        if (at(r, c) !== ch) continue;
        const c0 = c;
        while (at(r, c + 1) === ch) c++;
        const key = c0 + '-' + c;
        seen.add(key);
        const prev = open.get(key);
        if (prev) prev.h += TILE;
        else open.set(key, make({ x: c0 * TILE, y: r * TILE, w: (c - c0 + 1) * TILE, h: TILE }));
      }
      for (const key of [...open.keys()]) if (!seen.has(key)) open.delete(key);
    }
  };
  blocks('#', (rect) => {
    const p = { ...rect, oneway: false, ground: true };
    platforms.push(p);
    return p;
  });
  blocks('u', (rect) => {
    lifts.push(rect);
    return rect;
  });

  for (let r = 0; r < R; r++) {
    if (rows[r].length !== C) throw new Error(def.id + ': row ' + r + ' has the wrong length');
    for (let c = 0; c < C; c++) {
      const ch = rows[r][c];
      if (ch === '=' || ch === '^' || ch === '<' || ch === '>' || ch === 'x') {
        const c0 = c;
        while (at(r, c + 1) === ch) c++;
        const x = c0 * TILE;
        const w = (c - c0 + 1) * TILE;
        if (ch === '=') platforms.push({ x, y: r * TILE, w, h: LEDGE_H, oneway: true, ground: false });
        else if (ch === 'x') spikes.push({ x: x + 3, y: (r + 1) * TILE - 16, w: w - 6, h: 16 });
        else {
          const pad = { x: x + 6, y: (r + 1) * TILE - TRAMP_H, w: w - 12, h: TRAMP_H, cx: x + w / 2, vx: 0, vy: 0 };
          if (ch !== '^') {
            pad.vx = ch === '>' ? LAUNCH_VX : -LAUNCH_VX;
            pad.vy = LAUNCH_VY;
          }
          tramps.push(pad);
        }
      } else if (ch === '7' || ch === '8') {
        bases[ch === '7' ? 0 : 1] = [c * TILE + TILE / 2, (r + 1) * TILE];
      } else if (ch === '*') {
        pickups.push({ x: c * TILE + TILE / 2, y: r * TILE + 18 });
      } else if (ch >= '1' && ch <= '6') {
        spawns[Number(ch) - 1] = [c * TILE + (TILE - PW) / 2, (r + 1) * TILE - PH];
      } else if (ch === 'r') {
        respawns.push([c * TILE + (TILE - PW) / 2, (r + 1) * TILE - PH]);
      } else if (/[A-Za-z]/.test(ch) && ch !== 'u') {
        const cx = c * TILE + TILE / 2;
        const bottom = (r + 1) * TILE;
        const k = ch.toUpperCase();
        (letters[k] ||= []).push(portals.length);
        portals.push({ x: cx - PORTAL_W / 2, y: bottom - PORTAL_H, w: PORTAL_W, h: PORTAL_H, cx, cy: bottom - PORTAL_H / 2, to: -1, pair: 0, drop: (def.drop || '').toUpperCase().includes(k) });
      }
    }
  }
  Object.keys(letters)
    .sort()
    .forEach((k, pair) => {
      const [a, b] = letters[k];
      if (b === undefined) throw new Error(def.id + ': portal ' + k + ' has no partner');
      portals[a].to = b;
      portals[b].to = a;
      portals[a].pair = portals[b].pair = pair;
    });
  if (spawns.filter(Boolean).length !== DRAWN_STARTS) throw new Error(def.id + ': needs spawns 1-' + DRAWN_STARTS);
  extraStarts(def.id, C * TILE, spawns, pickups, platforms, { tramps, spikes, lifts, portals, bases });
  if (spawns.length < MAX_PLAYERS) throw new Error(def.id + ': only found ' + spawns.length + ' starts');

  // slopes: always stored left to right
  const ramps = (def.ramps || []).map(([c0, r0, c1, r1]) => {
    const a = { x0: c0 * TILE, y0: r0 * TILE, x1: c1 * TILE, y1: r1 * TILE };
    return a.x0 < a.x1 ? a : { x0: a.x1, y0: a.y1, x1: a.x0, y1: a.y0 };
  });

  // team bases: where each side's flag stands (feet position). By default the
  // start positions nearest the left and right walls.
  const byX = spawns.slice().sort((a, b) => a[0] - b[0]);
  if (!bases[0]) bases[0] = [byX[0][0] + PW / 2, byX[0][1] + PH];
  if (!bases[1]) bases[1] = [byX[byX.length - 1][0] + PW / 2, byX[byX.length - 1][1] + PH];

  return {
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    w: C * TILE,
    h: R * TILE,
    platforms,
    ramps,
    tramps,
    spikes,
    bases,
    lifts,
    portals,
    pickups,
    spawns,
    respawns: respawns.length ? respawns : spawns,
  };
}

// Starts 7 to 10. The maps are drawn with six; a full room of ten gets two more
// on each side, taken from the box spots: of all the mirror-image pairs of
// spots standing on flat ground, the ones furthest from every other start
// (and from the flags). Odd-numbered starts are on the left, like the drawn ones.
const DRAWN_STARTS = 6;
function extraStarts(id, w, spawns, pickups, platforms, { tramps, spikes, lifts, portals, bases }) {
  const ground = (pt) => pt.y - 18 + TILE; // a box floats just above the tile it stands on
  const firm = (pt) => {
    const y = ground(pt);
    if (!platforms.some((p) => p.y === y && p.x <= pt.x - PW && p.x + p.w >= pt.x + PW)) return false;
    const near = (z, pad) => z.x < pt.x + pad && z.x + z.w > pt.x - pad && z.y < y + 4 && z.y + z.h > y - PH - 8;
    return !tramps.some((z) => near(z, 44)) && !spikes.some((z) => near(z, 44)) && !lifts.some((z) => near(z, 30)) && !portals.some((z) => near(z, 50));
  };
  const left = pickups.filter((pt) => pt.x < w / 2 - 60 && firm(pt));
  const pairs = left
    .map((pt) => [pt, pickups.find((q) => Math.abs(q.x - (w - pt.x)) < 3 && q.y === pt.y)])
    .filter(([, mirror]) => mirror && firm(mirror));
  const taken = [...spawns.map(([x, y]) => [x + PW / 2, y + PH]), ...bases];
  while (spawns.length < MAX_PLAYERS && pairs.length) {
    const apart = ([pt]) => Math.min(...taken.map(([x, y]) => Math.hypot(pt.x - x, (ground(pt) - y) * 1.5)));
    pairs.sort((a, b) => apart(b) - apart(a));
    const [l, r] = pairs.shift();
    for (const pt of [l, r]) {
      spawns.push([pt.x - PW / 2, ground(pt) - PH]);
      taken.push([pt.x, ground(pt)], [w - pt.x, ground(pt)]);
    }
  }
}

// Height of a slope's surface at x.
export function rampY(r, x) {
  const f = (x - r.x0) / (r.x1 - r.x0);
  return r.y0 + (r.y1 - r.y0) * (f < 0 ? 0 : f > 1 ? 1 : f);
}

export const ARENAS = MAPS.map(parse);
export const ARENA_IDS = ARENAS.map((a) => a.id);

// Thorns. The maps are drawn with plenty of them, but a match only gets a
// quarter (in most arenas that is none at all): they are a hazard to trip over
// now and then, not something to pick your way through. Mirror-image pairs
// stay together, so both sides of an arena always get the same.
const THORN_SHARE = 0.25;
function thinThorns(arena, share) {
  const groups = new Map();
  for (const z of arena.spikes) {
    const side = Math.round(Math.min(z.x, arena.w - z.x - z.w)); // the same for a patch and its mirror image
    const key = `${String(z.y).padStart(6, '0')}/${String(side).padStart(6, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(z);
  }
  const keep = [];
  [...groups.keys()].sort().forEach((key, i) => {
    if (Math.floor((i + 1) * share) > Math.floor(i * share)) keep.push(...groups.get(key));
  });
  return keep;
}

// The arena as a match plays it (ARENAS holds the maps as drawn).
const played = new Map();
export function arenaById(id) {
  const base = ARENAS.find((a) => a.id === id) || ARENAS[0];
  let arena = played.get(base.id);
  if (!arena) {
    // (nav: the bots' route map belongs to this version, since thorns are in the way of some routes)
    arena = { ...base, spikes: thinThorns(base, THORN_SHARE), nav: undefined };
    played.set(base.id, arena);
  }
  return arena;
}
