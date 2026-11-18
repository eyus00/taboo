// Rules + physics checks. Run with: npm test
import assert from 'node:assert/strict';
import {
  FLAG_LETTERS, PW, PH, IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN, MOVE_SPEED, IMMUNE_TICKS, STUN_TICKS, RESPAWN_TICKS,
  SPEED_BUFF_MUL, TOUCH, AIR_JUMPS, twistById, IN_USE, ITEM_KINDS, BOX_FIRST_TICKS, ITEM_ARM_TICKS, STORM_SPEED, IT_SPEED_MUL,
  BLAST_RADIUS, BOMB_POINTS, BOMB_COST, FLAG_POINTS, FLAG_END_POINTS, BEAT_TICKS, FLAG_CAP_TICKS, FLAG_HALF, FLAG_UP, LAUNCH_VX, LAUNCH_VY,
  MAX_PLAYERS, PLAYER_COLORS, TEAM_SLOTS, ITEM_INFO, BODY_SCALE, BOX_EVERY_TICKS, QUAKE_STUN_TICKS, WARP_GAP, WARP_DROP, ECLIPSE_TICKS, DASH_TICKS, DASH_SPEED, JUMP_V, AIR_JUMP_V, JUMP_BUFFER_TICKS,
  GHOST_TICKS, GHOST_NEAR, STAR_TICKS, PORTAL_SETTLE_TICKS, TEAM_NAMES, THEMES,
} from '../shared/config.js';
import { ARENAS, ARENA_IDS, arenaById, arenaFits, arenasFor, TILE, rampY, VIEW_USUAL } from '../shared/arenas.js';
import { makeState, stepPlayer, packState, unpackState, STATE_LEN, publicFlags, PF_DARK, PF_DASH, PF_GHOST, PF_STAR, isFree, portalAt } from '../shared/physics.js';
import { Sim, standings, cupPoints, makeTeams, warpSpots } from '../shared/sim.js';
import { buildNav, surfaceAt } from '../shared/nav.js';
import { makeBot, botThink } from '../shared/bots.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// A tiny hand-made arena so every mechanic can be tested in isolation.
const box = {
  id: 'box', w: 3000, h: 800, // the far right is open floor for the tag tests
  platforms: [
    { x: 0, y: 720, w: 3000, h: 80, oneway: false, ground: true }, // floor
    { x: 200, y: 560, w: 200, h: 14, oneway: true, ground: false }, // thin ledge
    { x: 600, y: 560, w: 160, h: 160, oneway: false, ground: true }, // solid block standing on the floor
    { x: 1820, y: 560, w: 200, h: 14, oneway: true, ground: false }, // ledge at the top of the slope
  ],
  ramps: [{ x0: 1500, y0: 720, x1: 1820, y1: 560 }], // rises to the right
  lifts: [{ x: 2080, y: 200, w: 80, h: 520 }],
  spikes: [],
  bases: [[300, 720], [2700, 720]],
  tramps: [{ x: 900, y: 704, w: 68, h: 16, cx: 934 }],
  portals: [
    { x: 38, y: 644, w: 44, h: 76, cx: 60, cy: 682, to: 1, pair: 0 },
    { x: 1118, y: 644, w: 44, h: 76, cx: 1140, cy: 682, to: 0, pair: 0 },
  ],
  pickups: [{ x: 500, y: 698 }],
  spawns: [[300, 680], [500, 680], [800, 680], [1000, 680]],
  respawns: [[300, 680]],
};
const floorY = 720 - PH;
const settle = (p, n = 2) => { for (let i = 0; i < n; i++) stepPlayer(p, 0, box); };
const run = (p, bits, n, arena = box) => { for (let i = 0; i < n; i++) stepPlayer(p, bits, arena); };
const ticksUntil = (p, bits, done, max = 200) => { let n = 0; while (!done(p) && n < max) { stepPlayer(p, bits, box); n++; } return n; };

test('running has weight: you speed up, skid when you turn round, and coast to a stop', () => {
  const p = makeState(2300, 600);
  run(p, 0, 60);
  assert.equal(p.y, floorY);
  assert.ok(p.ground);
  stepPlayer(p, IN_RIGHT, box);
  assert.ok(p.vx > 0 && p.vx < MOVE_SPEED / 2, `first step is gentle: ${p.vx}`);
  const up = 1 + ticksUntil(p, IN_RIGHT, (q) => q.vx === MOVE_SPEED);
  assert.ok(up >= 5 && up <= 9, `full speed after ${up} ticks`);
  const skid = ticksUntil(p, IN_LEFT, (q) => q.vx <= 0);
  assert.ok(skid >= 4 && skid <= 6, `turning round: ${skid} ticks before moving the other way`);
  const back = ticksUntil(p, IN_LEFT, (q) => q.vx === -MOVE_SPEED);
  assert.ok(back >= 5 && back <= 9, `then ${back} ticks back up to speed`);
  const stop = ticksUntil(p, 0, (q) => q.vx === 0);
  assert.ok(stop >= 5 && stop <= 9, `stopped in ${stop} ticks`);
  // in the air you keep most of your momentum when you let go
  run(p, IN_RIGHT, 20);
  stepPlayer(p, IN_RIGHT | IN_JUMP, box);
  run(p, IN_JUMP, 10);
  assert.ok(p.vx > MOVE_SPEED * 0.8, `still drifting: ${p.vx}`);
});

const jump = (script, arena = box, twist) => {
  const p = makeState(450, floorY);
  settle(p);
  let minY = p.y;
  let maxFall = 0;
  let ticks = 0;
  for (let i = 0; i < 300; i++) {
    stepPlayer(p, script(i, p), arena, false, twist);
    minY = Math.min(minY, p.y);
    maxFall = Math.max(maxFall, p.vy);
    ticks++;
    if (i > 5 && p.ground) break;
  }
  return { height: floorY - minY, ticks, maxFall };
};

test('jumps are floaty: ~200px and over a second in the air; tap for a hop; press again to double-jump', () => {
  const full = jump(() => IN_JUMP);
  assert.ok(full.height > 185 && full.height < 215, `full jump ${full.height}`);
  assert.ok(full.ticks > 60 && full.ticks < 76, `air time ${full.ticks} ticks`);
  const tap = jump((i) => (i < 3 ? IN_JUMP : 0));
  assert.ok(tap.height > 55 && tap.height < 105, `tap ${tap.height}`);
  const dbl = jump((i, p) => (i < 26 || (i > 28 && p.vy < 0) ? IN_JUMP : 0));
  assert.ok(dbl.height > 320, `double ${dbl.height}`);
  // air resistance caps how fast you fall, however far
  const tall = { ...box, platforms: [{ x: 0, y: 5000, w: 3000, h: 80, oneway: false, ground: true }], ramps: [], lifts: [], tramps: [], portals: [], h: 5200 };
  const p = makeState(450, 100);
  let top = 0;
  for (let i = 0; i < 400 && !p.ground; i++) { stepPlayer(p, 0, tall); top = Math.max(top, p.vy); }
  assert.ok(top > 700 && top < 880, `terminal fall speed ${top}`);
  // moon gravity (a tournament twist) makes the same jump much higher
  const moon = jump(() => IN_JUMP, box, twistById('moon'));
  assert.ok(moon.height > full.height * 1.3, `moon jump ${moon.height}`);
});

test('thin ledges: jump up through, stand on top, hold down to drop through', () => {
  const p = makeState(284, floorY);
  settle(p);
  stepPlayer(p, IN_JUMP, box);
  let landed = false;
  for (let i = 0; i < 120 && !landed; i++) { stepPlayer(p, IN_JUMP, box); landed = p.ground; }
  assert.equal(p.y, 560 - PH, 'on the ledge');
  assert.equal(p.gk, 2);
  run(p, IN_DOWN, 3);
  assert.ok(!p.ground && p.y > 560 - PH, 'dropping through');
  run(p, 0, 60);
  assert.equal(p.y, floorY);
});

test('solid blocks: bonk underneath, blocked from the side', () => {
  const p = makeState(500, floorY);
  settle(p);
  run(p, IN_RIGHT, 60);
  assert.equal(p.x, 600 - PW, 'stopped by the side of the block');
  assert.equal(p.vx, 0);
  const roof = { ...box, platforms: box.platforms.concat([{ x: 400, y: 540, w: 200, h: 40, oneway: false, ground: true }]) };
  const q = makeState(450, floorY);
  run(q, 0, 2, roof);
  let minY = q.y;
  for (let i = 0; i < 60; i++) { stepPlayer(q, IN_JUMP, roof); minY = Math.min(minY, q.y); }
  assert.equal(minY, 580, 'head stops at the underside');
});

test('walls and the ceiling keep players inside the arena', () => {
  const p = makeState(40, floorY);
  p.tp = 1; // as if we had just arrived through the portal by the wall, so it ignores us
  settle(p);
  run(p, IN_LEFT, 40);
  assert.equal(p.x, 0);
  const q = makeState(2960, floorY);
  settle(q);
  run(q, IN_RIGHT, 40);
  assert.equal(q.x, 3000 - PW);
  const low = { ...box, platforms: [{ x: 0, y: 150, w: 3000, h: 80, oneway: false, ground: true }], tramps: [], portals: [], ramps: [], lifts: [] };
  const r = makeState(500, 150 - PH);
  run(r, 0, 2, low);
  let minY = r.y;
  for (let i = 0; i < 40; i++) { stepPlayer(r, IN_JUMP, low); minY = Math.min(minY, r.y); }
  assert.equal(minY, 0);
});

test('trampolines launch you ~480px, and pressing jump never makes the launch shorter', () => {
  for (const hammer of [false, true]) {
    const p = makeState(820, floorY);
    settle(p);
    const n = ticksUntil(p, IN_RIGHT, (q) => q.vy < -1000, 60);
    assert.ok(n < 40, 'walked onto the trampoline');
    let minY = p.y;
    for (let i = 0; i < 140 && !p.ground; i++) {
      stepPlayer(p, hammer && i % 2 ? IN_JUMP : 0, box); // mash jump on the way up
      minY = Math.min(minY, p.y);
    }
    assert.ok(floorY - minY > 440, `launch ${floorY - minY}px${hammer ? ' while mashing jump' : ''}`);
  }
});

test('portals: you fly to the partner as an orb, with no control, and are not sent straight back', () => {
  const p = makeState(160, floorY);
  settle(p);
  const n = ticksUntil(p, IN_LEFT, (q) => q.orb > 0, 60);
  assert.ok(n < 40 && p.orb > 0, 'entered the portal');
  const total = p.ot;
  assert.ok(total >= 60 && total <= 110, `flight takes ${total} ticks`); // unhurried: about twice a run, so the eye (and the camera) can follow
  let lastX = p.x;
  let flown = 0;
  while (p.orb > 0) {
    stepPlayer(p, IN_LEFT | IN_JUMP, box); // inputs do nothing in flight
    assert.ok(p.x >= lastX, 'always moving towards the exit');
    lastX = p.x;
    flown++;
  }
  assert.equal(flown, total);
  assert.equal(p.x, 1140 - PW / 2, 'arrived at the partner');
  // the flight arcs up over the map, and some portals let you drop out on the way
  const open = { ...box, portals: box.portals.map((po) => ({ ...po, drop: true })) };
  const o = makeState(160, floorY);
  run(o, 0, 2, open);
  for (let i = 0; i < 60 && o.orb === 0; i++) stepPlayer(o, IN_LEFT, open);
  let peak = o.y;
  for (let i = 0; i < Math.floor(o.ot / 2); i++) {
    stepPlayer(o, 0, open);
    peak = Math.min(peak, o.y);
  }
  assert.ok(o.orb > 0 && floorY - peak > 150, `halfway there it is ${Math.round(floorY - peak)}px above the ground`);
  stepPlayer(o, IN_JUMP, open);
  assert.equal(o.orb, 0, 'jump lets go');
  assert.ok(o.x > 300 && o.x < 900, `dropped out at x=${o.x}`);
  for (let i = 0; i < 200 && !o.ground; i++) stepPlayer(o, 0, open);
  assert.ok(o.ground, 'and falls from there');
  const shut = makeState(160, floorY); // the same in a portal that does not allow it
  settle(shut);
  for (let i = 0; i < 60 && shut.orb === 0; i++) stepPlayer(shut, IN_LEFT, box);
  for (let i = 0; i < 12; i++) stepPlayer(shut, i % 2 ? IN_JUMP : 0, box);
  assert.ok(shut.orb > 0, 'ordinary portals carry you all the way');
  assert.equal(p.tp, 1);
  run(p, 0, 30);
  assert.equal(p.orb, 0, 'standing in the exit does not send you back');
  assert.equal(p.y, floorY);
  run(p, IN_RIGHT, 30); // step out...
  assert.equal(p.tp, 0);
  ticksUntil(p, IN_LEFT, (q) => q.orb > 0, 60); // ...and back in
  assert.ok(p.orb > 0, 'works again after stepping out');
  // A portal waits for feet that have been on the ground a moment: coming down in one - off a jump,
  // a trampoline, a launcher - sends you nowhere, and there is time to step away.
  assert.ok(PORTAL_SETTLE_TICKS >= 4 && PORTAL_SETTLE_TICKS <= 12, 'a fraction of a second');
  const drop = makeState(60 - PW / 2, floorY - 150); // falling straight into the mouth of the one at x = 60
  let air = 0;
  while (!drop.ground && air < 120) {
    stepPlayer(drop, 0, box);
    air++;
  }
  assert.ok(drop.ground && drop.orb === 0 && portalAt(box, drop.x, drop.y) === 0, 'landed in the portal: nothing happens yet');
  run(drop, 0, PORTAL_SETTLE_TICKS - 3);
  assert.equal(drop.orb, 0, 'still here just before the moment is up');
  run(drop, 0, 4);
  assert.ok(drop.orb > 0, 'stay, and it takes you');
  const off = makeState(60 - PW / 2, floorY - 150); // the same fall, but steering away as they land
  while (!off.ground) stepPlayer(off, off.y > floorY - 40 ? IN_RIGHT : 0, box); // (already steering away as they come down)
  run(off, IN_RIGHT, 40);
  assert.ok(off.orb === 0 && off.x > 200 && portalAt(box, off.x, off.y) < 0, 'step away in time and you stay where you are');
});

test('slopes: walk up and down without bouncing, jump up through, hold down to pass under or drop', () => {
  const p = makeState(1400, floorY);
  settle(p);
  for (let i = 0; i < 150 && p.x < 1900; i++) {
    stepPlayer(p, IN_RIGHT, box);
    assert.ok(p.ground, `left the ground walking uphill at x=${p.x}`);
  }
  assert.equal(p.y, 560 - PH, 'walked up onto the ledge at the top');
  let lastY = p.y;
  for (let i = 0; i < 150 && p.x > 1380; i++) {
    stepPlayer(p, IN_LEFT, box);
    assert.ok(p.ground, `left the ground walking downhill at x=${p.x}`);
    assert.ok(p.y >= lastY - 0.01, 'never pops upwards on the way down');
    lastY = p.y;
  }
  assert.equal(p.y, floorY, 'and back down to the floor');
  // from underneath: jump up through the slope and land on it
  const q = makeState(1650, floorY);
  settle(q);
  stepPlayer(q, IN_JUMP, box);
  let landed = false;
  for (let i = 0; i < 120 && !landed; i++) { stepPlayer(q, IN_JUMP, box); landed = q.ground; }
  assert.ok(landed && q.y < floorY - 40 && q.gk === 2, `landed on the slope at y=${q.y}`);
  run(q, IN_DOWN, 4);
  assert.ok(!q.ground, 'down drops through it');
  run(q, 0, 60);
  assert.equal(q.y, floorY);
  // walking under the slope from its low end: hold down
  const r = makeState(1400, floorY);
  settle(r);
  run(r, IN_RIGHT | IN_DOWN, 60);
  assert.equal(r.y, floorY, 'passed underneath');
  assert.ok(r.x > 1600);
});

test('steep slopes: a runner always climbs from the low end, even with a speed boost, and never slips underneath', () => {
  for (const slope of [1, 1.5, 2, 2.5]) {
    for (const speed of [1, 1.35, 1.6]) {
      const hill = { ...box, platforms: [box.platforms[0]], ramps: [{ x0: 1500, y0: 720, x1: 1700, y1: 720 - 200 * slope }], lifts: [], portals: [], tramps: [], spikes: [] };
      for (let off = 0; off < 40; off++) {
        const p = makeState(1200 + off, floorY);
        let top = p.y;
        for (let i = 0; i < 120; i++) {
          stepPlayer(p, IN_RIGHT, hill, false, { grav: 1, speed });
          top = Math.min(top, p.y);
        }
        assert.ok(top < floorY - 150, `slope ${slope}, speed x${speed}, start ${off}: went underneath`);
      }
    }
  }
});

test('updrafts carry you up without any input and give your air jump back', () => {
  const p = makeState(2000, floorY);
  settle(p);
  run(p, IN_RIGHT, 22); // walk into the column
  let minY = p.y;
  let inside = 0;
  for (let i = 0; i < 150; i++) {
    stepPlayer(p, 0, box);
    minY = Math.min(minY, p.y);
    if (p.y < 600 && p.y > 300) { inside++; assert.equal(p.air, AIR_JUMPS); }
  }
  assert.ok(inside > 10, 'rode the column');
  assert.ok(minY < 220, `carried to the top: y=${minY}`);
  // steer out and you fall again
  run(p, IN_RIGHT, 120);
  assert.equal(p.y, floorY);
});

test('falling into a pit brings you back at a respawn point', () => {
  const pit = { ...box, platforms: [{ x: 0, y: 720, w: 400, h: 80, oneway: false, ground: true }], ramps: [], lifts: [] };
  const p = makeState(450, floorY);
  let dead = 0;
  for (let i = 0; i < 400 && !(dead > 0 && p.dead === 0); i++) {
    stepPlayer(p, 0, pit);
    if (p.dead > 0) dead++;
  }
  assert.equal(dead, RESPAWN_TICKS);
  assert.deepEqual([p.x, p.y], [300, 680]);
});

test('physics is deterministic across a network snapshot (prediction replays exactly)', () => {
  const combos = [IN_RIGHT, IN_RIGHT | IN_JUMP, IN_LEFT, 0, IN_LEFT | IN_JUMP, IN_RIGHT | IN_DOWN, IN_DOWN, IN_JUMP];
  for (const startX of [300, 1300, 1950]) { // near the portal and ledge, the slope, the updraft
    const a = makeState(startX, floorY);
    const seq = [];
    for (let i = 0; i < 1200; i++) seq.push(combos[(i * 7 + (i >> 3) + (i >> 6)) % combos.length]);
    for (const b of seq.slice(0, 500)) stepPlayer(a, b, box, true);
    a.dsh = 7; // (in the middle of a Dash: that has to travel too)
    a.ecl = 90;
    const wire = JSON.parse(JSON.stringify(packState(a)));
    assert.equal(wire.length, STATE_LEN);
    const copy = unpackState(wire);
    for (const b of seq.slice(500)) {
      stepPlayer(a, b, box, true);
      stepPlayer(copy, b, box, true);
    }
    assert.deepEqual(packState(a), packState(copy));
  }
});

const duel = (gap = 80) => {
  const sim = new Sim(box);
  const a = sim.add(0);
  const b = sim.add(1);
  a.s.x = 2400;
  b.s.x = 2400 + PW + gap;
  a.s.y = b.s.y = floorY;
  sim.it = 0;
  return { sim, a, b };
};

test('"it" tags by grazing: within a few pixels is enough, and players pass through each other', () => {
  const { sim, a, b } = duel(TOUCH + 4);
  sim.step([0, 0]);
  assert.equal(sim.it, 0, 'not touching yet');
  a.s.x += 5;
  sim.step([0, 0]);
  assert.equal(sim.it, 1, 'grazed');
  assert.ok(b.s.x - a.s.x > PW, 'hitboxes never overlapped');
  // not solid: a third player can run straight through
  const c = sim.add(2);
  c.s.x = a.s.x - 60;
  c.s.y = floorY;
  for (let i = 0; i < 90; i++) sim.step([0, 0, IN_RIGHT]);
  assert.ok(c.s.x > b.s.x + PW, 'ran through both');
});

test('after a tag: a short freeze for the new it (0.3 s), then no tag-backs for a moment (0.7 s)', () => {
  assert.ok(STUN_TICKS < IMMUNE_TICKS, 'the old it is still protected when the new one can move again');
  const { sim, a, b } = duel(0);
  sim.step([0, 0]);
  assert.equal(sim.it, 1);
  assert.ok(a.immune > IMMUNE_TICKS - 2 && b.s.stun > STUN_TICKS - 2);
  assert.equal(a.tags, 1);
  for (let i = 0; i < IMMUNE_TICKS - 4; i++) sim.step([0, 0]);
  assert.equal(sim.it, 1, 'still protected');
  for (let i = 0; i < 8; i++) sim.step([0, 0]);
  assert.equal(sim.it, 0, 'tag-back once protection ends');
});

test('nobody is tagged, and nobody tags, while flying through a portal', () => {
  const { sim, a, b } = duel(0);
  b.s.orb = 5;
  b.s.ot = 20;
  b.s.pi = 0;
  sim.step([0, 0]);
  assert.equal(sim.it, 0, 'an orb cannot be tagged');
  b.s.orb = 0;
  b.s.x = a.s.x + PW;
  b.s.y = floorY;
  a.s.orb = 5;
  a.s.ot = 20;
  a.s.pi = 0;
  sim.checkTag();
  assert.equal(sim.it, 0, 'and "it" cannot tag as an orb');
});

test('only "it" accumulates time, with no gap on handover', () => {
  const { sim, a, b } = duel(200);
  for (let i = 0; i < 300; i++) sim.step([IN_RIGHT, 0]);
  assert.equal(a.itTicks + b.itTicks, 300);
  assert.ok(b.itTicks > 0);
});

test('lag compensation: a touch on where the target was on the tagger\'s screen counts', () => {
  const { sim, a, b } = duel(300);
  for (let i = 0; i < 20; i++) sim.step([0, IN_RIGHT]); // b runs away
  const where = b.s.x;
  for (let i = 0; i < 10; i++) sim.step([0, IN_RIGHT]); // ... and 10 more ticks
  a.s.x = where - PW - 2; // a stands where b was 10 ticks ago
  sim.step([0, IN_RIGHT]);
  assert.equal(sim.it, 0, 'no hit against the present position');
  sim.rewind[0] = 12;
  sim.step([0, IN_RIGHT]);
  assert.equal(sim.it, 1, 'hit against the position a actually saw');
});

test('lucky boxes: you get an item to keep and set it off yourself - one at a time, any time up to the buzzer', () => {
  assert.deepEqual(ITEM_KINDS, ['speed', 'jump', 'shield', 'freeze', 'blast', 'swap', 'storm', 'quake', 'warp', 'eclipse', 'dash', 'ghost', 'star']);
  assert.ok(ITEM_INFO.dash.blurb.length <= 45, 'a short line for Dash');
  assert.deepEqual([ITEM_INFO.ghost.name, ITEM_INFO.star.name], ['Vanish', 'Titan']);
  assert.ok(ITEM_INFO.ghost.blurb.length <= 45 && ITEM_INFO.star.blurb.length <= 45, 'short lines for the two new ones');
  for (const k of ITEM_KINDS) assert.ok(ITEM_INFO[k].name && ITEM_INFO[k].blurb, `${k} has a name and a blurb`);
  const sim = new Sim(box, () => 0.4);
  const a = sim.add(0);
  const b = sim.add(1);
  a.s.x = 2300;
  b.s.x = 2800;
  a.s.y = b.s.y = floorY;
  sim.start(0);
  for (let i = 0; i <= BOX_FIRST_TICKS + 1; i++) sim.step([0, 0]);
  assert.equal(sim.boxes.length, 1, 'a box appeared');
  b.s.x = 470; // walk over it
  for (let i = 0; i < 10; i++) sim.step([0, IN_RIGHT]);
  assert.ok(b.item > 0 && sim.boxes.length === 0, 'picked it up');
  const held = b.item;
  sim.step([0, IN_USE]);
  assert.equal(b.item, held, 'the draw takes a moment: pressing USE straight away does nothing');
  sim.boxes = [0];
  b.s.x = 470;
  for (let i = 0; i < 10; i++) sim.step([0, IN_RIGHT]);
  assert.ok(b.item === held && sim.boxes.length === 1, 'hands full: the second box stays where it is');
  sim.boxes = [];

  // each item, set off with the USE button
  const use = (pl, kind) => {
    pl.item = ITEM_KINDS.indexOf(kind) + 1;
    pl.arm = 0;
    pl.s.stun = pl.s.frz = 0;
    const inputs = [0, 0, 0];
    sim.step(inputs); // button up...
    inputs[pl.slot] = IN_USE;
    sim.events.length = 0;
    sim.step(inputs); // ...button down
    assert.equal(pl.item, 0, `${kind} was used`);
    assert.ok(sim.events.some((e) => e.type === 'use' && e.slot === pl.slot && ITEM_KINDS[e.kind] === kind));
  };
  const apart = () => {
    a.s.x = 2300;
    b.s.x = 2800;
    a.s.y = b.s.y = floorY;
    for (const p of [a, b]) p.s.vx = p.s.vy = p.s.stun = p.s.frz = p.s.slw = p.s.spd = p.s.shd = 0;
    a.immune = b.immune = 0;
    sim.it = 0;
  };
  apart();
  use(b, 'speed');
  for (let i = 0; i < 15; i++) sim.step([0, IN_LEFT]);
  assert.ok(Math.abs(Math.abs(b.s.vx) - MOVE_SPEED * SPEED_BUFF_MUL) < 0.5, `swift ${b.s.vx}`);
  apart();
  use(b, 'freeze'); // a runner freezes "it"
  assert.ok(a.s.frz > 0 && b.s.frz === 0);
  const ax = a.s.x;
  for (let i = 0; i < 10; i++) sim.step([IN_RIGHT, 0]);
  assert.equal(a.s.x, ax, 'frozen players cannot move');
  apart();
  use(b, 'shield');
  a.s.x = b.s.x - PW;
  sim.step([0, 0]);
  assert.equal(sim.it, 0, 'the ward blocked the tag');
  assert.ok(sim.events.some((e) => e.type === 'block') && b.s.shd === 0 && a.s.stun > 0);
  apart();
  use(a, 'shield');
  assert.ok(a.s.shd === 0 && a.s.spd > 0, 'a ward is no use to "it": it becomes a burst of speed');
  apart();
  const c = sim.add(2);
  c.s.x = b.s.x - BLAST_RADIUS - 300; // far outside the blast
  c.s.y = floorY;
  a.s.x = b.s.x - 300;
  use(b, 'blast');
  assert.ok(a.s.stun > 0 && a.s.vx < -300 && a.s.vy < 0, 'the blast hurls those nearby away, stunned');
  assert.ok(c.s.stun === 0 && c.s.vx === 0, 'and leaves those far away alone');
  sim.remove(2);
  apart();
  use(b, 'swap');
  assert.deepEqual([a.s.x, b.s.x], [2800, 2300], 'swapped places');
  apart();
  use(b, 'storm');
  assert.ok(a.s.slw > 0 && b.s.slw === 0);
  for (let i = 0; i < 20; i++) sim.step([IN_LEFT, 0]);
  assert.ok(Math.abs(Math.abs(a.s.vx) - MOVE_SPEED * IT_SPEED_MUL * STORM_SPEED) < 0.5, `slow motion ${a.s.vx}`);
  // Quake: everyone else, however far away, is thrown straight up and is out of it for over a second
  apart();
  const far = sim.add(2);
  far.s.x = 300; // 2500 px from b: far outside any blast
  far.s.y = floorY;
  sim.step([0, 0, 0]);
  use(b, 'quake');
  assert.ok(a.s.stun > QUAKE_STUN_TICKS - 3 && far.s.stun > QUAKE_STUN_TICKS - 3 && b.s.stun === 0, 'everyone but whoever set it off is stunned');
  assert.ok(QUAKE_STUN_TICKS >= 72 && QUAKE_STUN_TICKS <= 90, 'for 1.2 to 1.5 seconds');
  assert.ok(a.s.vy < 0 && !a.s.ground && far.s.vy < 0 && !far.s.ground && b.s.ground, 'and in the air');
  const ax0 = a.s.x;
  let peak = a.s.y;
  for (let i = 0; i < QUAKE_STUN_TICKS - 2; i++) {
    sim.step([IN_RIGHT, 0, IN_LEFT]);
    peak = Math.min(peak, a.s.y);
  }
  assert.ok(floorY - peak > 50 && floorY - peak < 140, `thrown ${floorY - peak} px up`);
  assert.ok(a.s.x === ax0 && a.s.ground && a.s.y === floorY, 'straight up and down again: no push sideways, no moving meanwhile');
  for (let i = 0; i < 6; i++) sim.step([IN_RIGHT, 0, 0]);
  assert.ok(a.s.stun === 0 && a.s.x > ax0, 'then they are back in the game');
  // Warp, as a runner: to the standing spot furthest from whoever is it
  apart();
  const spots = warpSpots(box);
  assert.ok(spots.length >= 6, 'starts, flag stands and the ground under box spots are places to warp to');
  const off = ([x, y]) => Math.hypot(a.s.x - x, a.s.y - y);
  const furthest = spots.reduce((best, sp) => (off(sp) > off(best) ? sp : best));
  sim.events.length = 0;
  use(b, 'warp');
  assert.deepEqual([b.s.x, b.s.y], furthest, 'as far from "it" as there is somewhere to stand');
  assert.ok(off(furthest) > 1900 && b.s.ground, 'the other end of the arena, on the ground');
  // Warp, as "it": right beside the nearest runner, on the side they are running towards
  apart();
  far.s.x = 1250; // another runner, further off
  far.s.y = floorY;
  far.s.stun = 0;
  for (let i = 0; i < 12; i++) sim.step([0, IN_RIGHT, 0]); // b runs away to the right
  use(a, 'warp');
  const beside = a.s.x - b.s.x - PW; // the air between them
  assert.ok(beside > TOUCH && beside <= WARP_GAP && a.s.y === floorY && a.s.ground, `"it" lands ${beside} px in front of the nearest runner`);
  assert.equal(sim.it, 0, 'not touching yet: there is a blink in which to jump');
  assert.ok(sim.events.some((e) => e.type === 'use' && ITEM_KINDS[e.kind] === 'warp' && e.to === 1 && e.tx > 2700), 'the event says who was warped to, and where');
  for (let i = 0; i < 12 && sim.it === 0; i++) sim.step([IN_LEFT, 0, 0]);
  assert.equal(sim.it, 1, 'and a step later they are tagged');
  sim.remove(2);
  // Eclipse: night for everyone else - a timer on each of them that travels in their state like the others
  apart();
  use(b, 'eclipse');
  assert.ok(a.s.ecl > ECLIPSE_TICKS - 3 && b.s.ecl === 0, 'night falls on everyone but whoever called it');
  assert.ok(publicFlags(a.s) & PF_DARK && !(publicFlags(b.s) & PF_DARK), 'and everybody is told who is in the dark');
  assert.equal(unpackState(JSON.parse(JSON.stringify(packState(a.s)))).ecl, a.s.ecl, 'the timer is part of the state a browser predicts from');
  const before = a.s.x;
  for (let i = 0; i < ECLIPSE_TICKS; i++) sim.step([i < 30 ? IN_RIGHT : 0, 0]);
  assert.ok(a.s.ecl === 0 && a.s.x > before + 100, 'it lifts after 4 seconds; meanwhile they can still move');
  // Dash: straight ahead at full tilt for a fifth of a second - the way you steer as you set it off, else the way you face
  apart();
  b.s.face = -1;
  use(b, 'dash');
  assert.ok(b.s.dsh > 0 && publicFlags(b.s) & PF_DASH, 'dashing, and everybody is told');
  for (let i = 1; i < DASH_TICKS; i++) sim.step([0, IN_RIGHT | IN_JUMP]); // (steering and jumping do nothing meanwhile)
  const reach = (DASH_SPEED * DASH_TICKS) / 60;
  assert.ok(reach >= 200 && reach <= 280, `a dash covers ${reach} px`);
  assert.deepEqual([b.s.x, b.s.y, b.s.dsh], [2800 - reach, floorY, 0], 'dead straight, the way they faced');
  assert.ok(Math.abs(b.s.vx) <= MOVE_SPEED, 'and it ends at a run, not at dash speed');
  apart();
  b.s.face = -1;
  b.item = ITEM_KINDS.indexOf('dash') + 1;
  sim.step([0, 0]);
  sim.step([0, IN_USE | IN_RIGHT]);
  assert.ok(b.s.face === 1 && b.s.x > 2800, 'steering as you set it off chooses the way');
  for (let i = 0; i < DASH_TICKS + 5; i++) sim.step([0, IN_RIGHT]);
  assert.equal(b.s.x, 3000 - PW, 'a wall stops a dash like anything else');
  apart();
  a.s.x = 2300;
  b.s.x = 2300 + PW + 190; // well out of reach at a run: half a second away
  use(a, 'dash'); // (apart() leaves "it" facing right)
  for (let i = 0; i < DASH_TICKS && sim.it === 0; i++) sim.step([0, 0]);
  assert.equal(sim.it, 1, '"it" dashes and tags');
  assert.ok(b.s.stun > 0);
  apart();
  b.s.y = floorY - 200; // in mid-air
  b.s.ground = false;
  b.s.face = -1;
  use(b, 'dash');
  for (let i = 1; i < DASH_TICKS; i++) sim.step([0, 0]);
  assert.ok(b.s.x === 2800 - reach && b.s.y - (floorY - 200) < 16, 'through the air it holds its height');
  apart();
  use(b, 'dash');
  b.s.stun = 20; // tagged, say, in mid-dash
  const bx = b.s.x;
  sim.step([0, 0]);
  assert.ok(b.s.dsh === 0 && Math.abs(b.s.x - bx) < 20, 'a stun ends it');
  // Vanish: for five seconds everybody is told not to show where we are - and a touch still counts, both ways
  apart();
  use(b, 'ghost');
  assert.ok(b.s.gho > GHOST_TICKS - 3 && a.s.gho === 0 && GHOST_TICKS === 300, 'five seconds, for whoever set it off only');
  assert.ok(publicFlags(b.s) & PF_GHOST && !(publicFlags(a.s) & PF_GHOST), 'and everybody is told who is out of sight');
  assert.equal(unpackState(JSON.parse(JSON.stringify(packState(b.s)))).gho, b.s.gho, 'the timer travels in the state');
  a.s.x = b.s.x - PW;
  sim.step([0, 0]);
  assert.equal(sim.it, 1, 'out of sight is not out of reach: a touch tags them');
  apart();
  use(a, 'ghost'); // "it" out of sight: the same
  b.s.x = a.s.x + PW;
  sim.step([0, 0]);
  assert.equal(sim.it, 1, 'and "it" can tag without being seen');
  apart();
  b.s.gho = 2;
  sim.step([0, 0]);
  sim.step([0, 0]);
  assert.ok(b.s.gho === 0 && !(publicFlags(b.s) & PF_GHOST), 'then they are back in sight');
  // Titan: for four seconds nothing lands on us - no tag, no item, no thorns - and what was on us is shaken off
  apart();
  b.s.slw = 100;
  b.s.ecl = 100;
  use(b, 'star');
  assert.ok(b.s.inv > STAR_TICKS - 3 && STAR_TICKS === 240 && b.s.slw === 0 && b.s.ecl === 0, 'four seconds; the storm and the night on us are gone');
  assert.ok(publicFlags(b.s) & PF_STAR && !(publicFlags(a.s) & PF_STAR), 'and everybody is told');
  assert.equal(unpackState(JSON.parse(JSON.stringify(packState(b.s)))).inv, b.s.inv, 'the timer travels in the state');
  a.s.x = b.s.x - PW;
  for (let i = 0; i < 20; i++) sim.step([0, 0]);
  assert.equal(sim.it, 0, 'touching a Titan tags nobody');
  a.s.x = 2300;
  for (const kind of ['freeze', 'storm', 'quake', 'eclipse', 'blast', 'swap']) {
    a.s.x = b.s.x - 120; // (inside a blast)
    a.s.stun = 0;
    use(a, kind);
    assert.ok(b.s.frz === 0 && b.s.slw === 0 && b.s.stun === 0 && b.s.ecl === 0 && b.s.x === 2800 && b.s.vx === 0, `${kind} does nothing to a Titan`);
  }
  a.s.x = 2300;
  use(a, 'warp'); // "it" can still warp to one - and then stands beside somebody it cannot tag
  for (let i = 0; i < 10; i++) sim.step([IN_RIGHT, 0]);
  assert.equal(sim.it, 0, 'warping to a Titan gets "it" nowhere');
  const thorny = { ...box, spikes: [{ x: 2795, y: 720 - 16, w: 60, h: 16 }] };
  const tough = makeState(2800, floorY);
  tough.inv = 60;
  for (let i = 0; i < 20; i++) stepPlayer(tough, 0, thorny);
  assert.ok(tough.stun === 0 && tough.hz === 0 && tough.x === 2800, 'a Titan stands in thorns unharmed');
  const soft = makeState(2800, floorY);
  for (let i = 0; i < 20; i++) stepPlayer(soft, 0, thorny);
  assert.ok(soft.hz > 0, '(anyone else is stung)');
  apart();
  b.s.inv = 2;
  b.s.x = 2800;
  a.s.x = b.s.x - PW;
  for (let i = 0; i < 4; i++) sim.step([0, 0]);
  assert.equal(sim.it, 1, 'when it wears off they can be tagged again');
  // The host's pool: only those kinds come out of the boxes (none chosen: all of them)
  apart();
  const kinds = (pool, who = b) => {
    sim.itemPool = pool;
    const seen = new Set();
    let k = 0;
    const was = sim.rnd;
    sim.rnd = () => (k++ % 97) / 97;
    for (let i = 0; i < 97; i++) seen.add(ITEM_KINDS[sim.rollItem(who) - 1]);
    sim.rnd = was;
    return [...seen].sort();
  };
  assert.deepEqual(kinds(['dash', 'ghost']), ['dash', 'ghost'], 'a pool of two: those two');
  assert.deepEqual(kinds(['star']), ['star'], 'a pool of one');
  assert.deepEqual(kinds([]), ITEM_KINDS.slice().sort(), 'nothing chosen: everything');
  assert.deepEqual(kinds(null), ITEM_KINDS.slice().sort(), 'no pool: everything');
  assert.deepEqual(kinds(['nonsense']), ITEM_KINDS.slice().sort(), 'a pool of unknown kinds: everything');
  assert.deepEqual(kinds(['shield', 'speed'], a), ['speed'], 'whoever is it never draws a Ward...');
  assert.deepEqual(kinds(['shield'], a), ['shield'], '...unless Wards are all there is (it turns into speed)');
  sim.itemPool = null;
  // boxes keep coming and items keep working right up to the buzzer (there is no lock near the end any more) - and nothing after it
  apart();
  assert.equal(sim.locked, undefined);
  sim.boxes = [];
  for (let i = 0; i <= BOX_EVERY_TICKS; i++) sim.step([0, 0]);
  assert.equal(sim.boxes.length, 1, 'another box');
  b.item = ITEM_KINDS.indexOf('speed') + 1;
  b.arm = 0;
  sim.step([0, 0]);
  sim.step([0, IN_USE]);
  assert.ok(b.item === 0 && b.s.spd > 0);
  sim.finish(); // the buzzer
  b.item = ITEM_KINDS.indexOf('jump') + 1;
  sim.boxes = [];
  sim.step([0, 0]);
  sim.step([0, IN_USE]);
  for (let i = 0; i <= BOX_EVERY_TICKS; i++) sim.step([0, 0]);
  assert.ok(b.item > 0 && b.s.jmp === 0 && sim.boxes.length === 0, 'after the buzzer nothing goes off and nothing appears');
});

test('jump can be hammered: every fresh press does something while there is a jump to be had - and never more than the double', () => {
  // how many ticks a press made at tick 0 takes to show: it must be none
  const kicks = (p, script, n, arena = box) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const before = p.vy;
      stepPlayer(p, script(i, p), arena);
      if (p.vy < -250 && p.vy < before - 250) out.push(i); // thrown upwards: a jump went off on this tick
      if (i > 3 && p.ground) break;
    }
    return out;
  };
  // press, release, press, release... on alternate ticks, from standing
  const p = makeState(2300, floorY);
  settle(p);
  const hammered = kicks(p, (i) => (i % 2 === 0 ? IN_JUMP : 0), 300);
  assert.deepEqual(hammered, [0, 2], 'the first press jumps, the very next press is the jump in mid-air, and that is all until landing');
  assert.ok(p.ground, 'landed');
  // ...and keeps hammering: back on the ground the next press jumps at once (one made just before landing counts on landing)
  let wait = 0;
  for (let i = 0; i < 6 && p.vy >= 0; i++, wait++) stepPlayer(p, i % 2 === 0 ? IN_JUMP : 0, box);
  assert.ok(p.vy < -250 && wait <= 2, `jumping again ${wait} tick(s) after landing`);
  // a full jump held down, let go for a single tick and pressed again: no dead window either
  for (const held of [1, 2, 3, 5, 8, 14, 30]) {
    const q = makeState(2300, floorY);
    settle(q);
    const got = kicks(q, (i) => (i === held ? 0 : i <= held + 1 ? IN_JUMP : 0), 300);
    assert.deepEqual(got, [0, held + 1], `held for ${held} ticks: the second press went off on tick ${got[1]}`);
  }
  // a press straight after walking off a ledge is still a ground jump, and the jump in mid-air is still there after it
  const w = makeState(2300, floorY);
  settle(w);
  w.ground = false; // (as if the ground had just ended)
  w.coyote = 3;
  const off = kicks(w, (i) => (i % 2 === 0 ? IN_JUMP : 0), 300);
  assert.deepEqual(off, [0, 2]);
  // flying up off a trampoline, faster than a jump would send you: hammering never makes the launch shorter, a tap
  // at the start of it is not spent on nothing, and the jump in mid-air is still there once it can add height
  const launch = (script) => {
    const t = makeState(820, floorY);
    settle(t);
    ticksUntil(t, IN_RIGHT, (s) => s.vy < -1000, 60);
    let top = t.y;
    for (let i = 0; i < 200 && !t.ground; i++) {
      stepPlayer(t, script(i, t), box);
      top = Math.min(top, t.y);
    }
    return floorY - top;
  };
  const plain = launch(() => 0);
  assert.equal(launch((i) => (i === 2 ? IN_JUMP : 0)), plain, 'one tap at the start of a launch changes nothing');
  assert.ok(launch((i) => (i % 2 ? IN_JUMP : 0)) >= plain, 'hammering all the way up never makes it shorter');
  const later = launch((i, t) => (i === 2 || (i > 4 && t.vy > -200 && t.air > 0) ? IN_JUMP : 0));
  assert.ok(later > plain + 100, `and the jump in mid-air is still there near the top: ${Math.round(plain)} px without it, ${Math.round(later)} px with`);
  assert.ok(JUMP_V > AIR_JUMP_V && JUMP_BUFFER_TICKS >= 6);
});

test('a touch you can see counts: bodies are drawn bigger than their hitboxes, and the tag reaches as far as the drawing', () => {
  assert.ok(BODY_SCALE >= 1.2 && BODY_SCALE <= 1.3, 'players are drawn about a quarter bigger');
  const side = ((BODY_SCALE - 1) * PW) / 2; // how far a drawn body sticks out of its hitbox on each side...
  const head = (BODY_SCALE - 1) * PH; // ...and above it (the feet are where they always were)
  assert.ok(TOUCH >= 2 * side && TOUCH >= head, `two drawn bodies touch with their hitboxes ${2 * side} px apart side by side, ${head} px apart head to feet`);
  const flank = duel(2 * side - 1);
  flank.sim.step([0, 0]);
  assert.equal(flank.sim.it, 1, 'side by side, the drawings just overlapping');
  const above = duel(0);
  above.b.s.x = above.a.s.x;
  above.b.s.y = floorY - PH - head + 1;
  above.sim.step([0, 0]);
  assert.equal(above.sim.it, 1, 'feet on a head');
  const clear = duel(TOUCH + 6);
  clear.sim.step([0, 0]);
  assert.equal(clear.sim.it, 0, 'but not from a distance');
});

test('Warp never lands in a wall, over a pit, in thorns, a portal or an updraft: tried to and from hundreds of places in every arena', () => {
  const log = [];
  for (const { id } of ARENAS) {
    const arena = arenaById(id); // as a match plays it
    const spots = warpSpots(arena);
    assert.ok(spots.length >= 14, `${id}: only ${spots.length} places to warp to`);
    const stands = (x, y, what) => {
      assert.ok(isFree({ x, y }, arena), `${id}: ${what} is inside a wall or outside the arena (${x}, ${y})`);
      const p = makeState(x, y);
      for (let t = 0; t < 40; t++) stepPlayer(p, 0, arena);
      assert.ok(p.ground && Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1 && p.dead === 0 && p.stun === 0 && p.orb === 0, `${id}: ${what} is not somewhere to stand (${x}, ${y})`);
    };
    spots.forEach(([x, y], i) => stands(x, y, `warp spot ${i}`));
    const nav = buildNav(arena);
    let tries = 0;
    let level = 0;
    let onGround = 0;
    for (const sf of nav.surfaces) {
      for (const f of [0.08, 0.5, 0.92]) {
        for (const up of [0, 60, 190]) {
          for (const vx of [-250, 0, 250]) {
            const x = sf.x0 + (sf.x1 - sf.x0) * f;
            const sim = new Sim(arena, () => 0.5);
            const it = sim.add(0, tries % arena.spawns.length);
            const runner = sim.add(1);
            runner.s.x = Math.round(x - PW / 2);
            runner.s.y = Math.round(nav.heightAt(sf, x)) - PH - up;
            runner.s.ground = up === 0;
            runner.s.vx = vx;
            sim.start(0);
            // "it" comes out beside the runner...
            const hop = sim.warpFor(it);
            assert.ok(hop && hop.to === runner, `${id}: no way to warp to (${runner.s.x}, ${runner.s.y})`);
            stands(hop.x, hop.y, `"it" warping to (${runner.s.x}, ${runner.s.y})`);
            if (up === 0) {
              onGround++;
              if (Math.abs(hop.x - runner.s.x) <= PW + WARP_GAP && Math.abs(hop.y - runner.s.y) <= WARP_DROP) level++;
            }
            // ...and the runner far away from "it"
            const away = sim.warpFor(runner);
            assert.ok(away && away.to === null);
            stands(away.x, away.y, 'a runner warping away');
            assert.ok(Math.hypot(away.x - it.s.x, away.y - it.s.y) > arena.w * 0.4, `${id}: a runner warped only ${Math.round(Math.hypot(away.x - it.s.x, away.y - it.s.y))} px away`);
            tries++;
          }
        }
      }
    }
    log.push(`${id} ${spots.length} spots, ${tries} warps, ${Math.round((100 * level) / onGround)}% right beside a runner on the ground`);
    assert.ok(level >= onGround * 0.9, `${id}: only ${level} of ${onGround} warps to a runner on the ground came out right beside them`);
  }
  console.log(`      ${log.join('; ')}`);
});

test('Eclipse: a bot in the dark forgets who it was after, uses nothing and wanders - until the night lifts', () => {
  const arena = arenaById('dojo');
  const sim = new Sim(arena, () => 0.5);
  sim.add(0);
  sim.add(1);
  sim.powerups = false;
  const mem = [makeBot(1), null];
  sim.start(0);
  const tick = () => {
    sim.step([botThink(sim, 0, mem[0]), 0]); // (the runner just stands there)
    sim.events.length = 0;
  };
  for (let i = 0; i < 40; i++) tick();
  assert.equal(mem[0].target, 1, 'the bot that is it goes after the other player');
  sim.players[0].s.ecl = ECLIPSE_TICKS;
  sim.players[0].item = ITEM_KINDS.indexOf('blast') + 1;
  sim.players[1].immune = 1e6; // (so bumping into them in the dark changes nothing here)
  let moved = 0;
  let from = sim.players[0].s.x;
  for (let i = 0; i < ECLIPSE_TICKS - 2; i++) {
    tick();
    assert.ok(mem[0].blind && mem[0].target === -1 && !mem[0].direct, 'in the dark: nobody to chase');
    moved += Math.abs(sim.players[0].s.x - from);
    from = sim.players[0].s.x;
  }
  assert.ok(sim.players[0].item > 0, 'and no item is set off blind');
  assert.ok(moved > 200, `it feels its way about (${Math.round(moved)} px)`);
  sim.players[1].immune = 0;
  // (it may be in the middle of a jump or a portal when the night lifts: it looks around again as soon as that is over)
  for (let i = 0; i < 180 && sim.it === 0 && (mem[0].blind || mem[0].target !== 1); i++) tick();
  assert.ok(!mem[0].blind && (sim.it !== 0 || mem[0].target === 1), 'the night lifts and the chase is on again');
});

test('team battle: a bomb for every two players, passed only to enemies with free hands; they all go off at the buzzer', () => {
  const sim = new Sim(box, () => 0.1);
  const p = [0, 1, 2, 3].map((i) => sim.add(i));
  const park = () => p.forEach((q, i) => {
    q.s.x = [1300, 1900, 2300, 2500][i]; // nobody near anybody, and nobody on a flag
    q.s.y = floorY;
    q.s.vx = q.s.vy = q.s.stun = 0;
    q.immune = 0;
  });
  park();
  sim.setTeams([0, 0, 1, 1]);
  // who starts with one is drawn with the teams: two bombs for four players, one a side
  assert.equal(sim.bombPlan.length, 2);
  assert.deepEqual(sim.bombPlan.map((slot) => p[slot].team).sort(), [0, 1]);
  for (let i = 0; i < 30; i++) sim.step([]); // the countdown: the sim runs, but nothing is in play yet
  assert.deepEqual(sim.bombs(), [], 'no bombs before GO');
  assert.ok(p.every((q) => q.itTicks === 0), 'and nobody clocks up time');
  sim.start();
  assert.equal(sim.it, -1, 'nobody is "it" in a team battle');
  assert.deepEqual(sim.bombs().sort(), sim.bombPlan.slice().sort(), 'the bombs go out as drawn');
  // a known layout: 0 (team 0) and 2 (team 1) carry
  const give = (...slots) => p.forEach((q) => (q.bomb = slots.includes(q.slot)));
  give(0, 2);
  p[1].s.x = p[0].s.x + PW; // a team mate: nothing happens
  sim.step([]);
  assert.deepEqual(sim.bombs(), [0, 2], 'a bomb does not stick to your own team');
  park();
  p[2].s.x = p[0].s.x + PW; // an enemy who already carries one: nothing happens either way
  sim.step([]);
  assert.deepEqual(sim.bombs(), [0, 2], 'nobody carries two');
  park();
  p[3].s.x = p[0].s.x + PW; // an enemy with free hands
  sim.events.length = 0;
  sim.step([]);
  assert.deepEqual(sim.bombs(), [2, 3], 'stuck on an enemy');
  assert.ok(sim.events.some((e) => e.type === 'tag' && e.from === 0 && e.to === 3));
  assert.ok(p[3].s.stun > 0 && p[0].immune > 0 && p[0].tags === 1, 'the new carrier is held a moment and cannot hand it straight back');
  for (let i = 0; i < 5; i++) sim.step([]);
  assert.deepEqual(sim.bombs(), [2, 3]);
  // carriers run a touch faster, like whoever is it
  park();
  const lane = { ...box, ramps: [], lifts: [], platforms: [box.platforms[0]] };
  const fast = makeState(1200, floorY);
  const slow = makeState(1200, floorY);
  for (let i = 0; i < 90; i++) {
    stepPlayer(fast, IN_RIGHT, lane, true);
    stepPlayer(slow, IN_RIGHT, lane, false);
  }
  assert.ok(fast.x > slow.x + 10);
  // nothing goes off during the round, however long it lasts; time with a bomb is counted
  sim.events.length = 0;
  for (let i = 0; i < 4 * BEAT_TICKS + 10; i++) sim.step([]);
  assert.ok(!sim.events.some((e) => e.type === 'boom'));
  assert.deepEqual(sim.score, [0, 0], 'a bomb costs its side a point on every beat, but there is nothing to take');
  assert.ok(sim.events.filter((e) => e.type === 'cost').length >= 8);
  sim.flags.forEach((f) => (f.owner = -1));
  assert.ok(p[2].itTicks > 1200 && p[3].itTicks >= 1200 && p[1].itTicks === 0);
  // the buzzer: both bombs are on team 1, and each scores for the other side
  sim.score[0] = 7;
  sim.score[1] = 10;
  sim.finish();
  assert.ok(sim.over);
  assert.deepEqual(sim.score, [7 + 2 * BOMB_POINTS, 10]);
  assert.deepEqual(sim.events.filter((e) => e.type === 'boom').map((e) => [e.slot, e.team]), [[2, 1], [3, 1]]);
  assert.ok(p[2].boom && p[3].boom && !p[0].boom && p[2].s.stun > 0);
  assert.deepEqual(sim.bombs(), []);
  sim.finish();
  assert.deepEqual(sim.score, [7 + 2 * BOMB_POINTS, 10], 'only once');
  const res = standings(sim, ['A', 'B', 'C', 'D'], 'team');
  assert.equal(res.win, 0);
  assert.deepEqual(res.winners.sort(), [0, 1]);
  assert.deepEqual(res.rows.filter((r) => r.boom).map((r) => r.slot).sort(), [2, 3]);
  // how many bombs, and how they are shared out
  for (const [n, want] of [[2, 1], [3, 1], [4, 2], [5, 2], [6, 3], [7, 3], [8, 4], [9, 4], [10, 5]]) {
    for (let seed = 1; seed <= 6; seed++) {
      let x = seed * 7919;
      const m = new Sim(box, () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296));
      for (let i = 0; i < n; i++) m.add(i);
      m.setTeams(Array.from({ length: n }, (_, i) => i % 2));
      m.start();
      const held = m.bombs();
      assert.equal(held.length, want, `${n} players: ${want} bombs`);
      const share = [0, 1].map((t) => held.filter((slot) => m.players[slot].team === t).length);
      assert.ok(Math.abs(share[0] - share[1]) <= 1, `${n} players: shared ${share}`);
      if (n >= 4) assert.ok(share[0] >= 1 && share[1] >= 1, 'each side starts with one');
    }
  }
  // a carrier who leaves hands the bomb to one of their own side
  const m = new Sim(box, () => 0.3);
  for (let i = 0; i < 4; i++) m.add(i);
  m.setTeams([0, 0, 1, 1]);
  m.start();
  m.active().forEach((q) => (q.bomb = q.slot === 0 || q.slot === 2));
  m.remove(0);
  assert.deepEqual(m.bombs(), [1, 2]);
  // teams are as even as they can be
  assert.deepEqual(makeTeams([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).map((t) => t.length), [5, 5]);
  assert.deepEqual(makeTeams([0, 1, 2, 3, 4, 5]).map((t) => t.length), [3, 3]);
  assert.deepEqual(makeTeams([0, 1, 2, 3, 4]).map((t) => t.length), [3, 2]);
  assert.deepEqual(makeTeams([0, 1]).map((t) => t.length), [1, 1]);
});

test('team battle: a flag fills with the colour of whoever stands in its ring, pays its side on the beat, and can be turned', () => {
  const sim = new Sim(box, () => 0.1);
  const p = [0, 1, 2, 3].map((i) => sim.add(i));
  const away = [1300, 1420, 2300, 2420];
  const park = () => p.forEach((q, i) => {
    q.s.x = away[i];
    q.s.y = floorY;
    q.s.vx = q.s.vy = q.s.stun = 0;
    q.immune = 0;
  });
  const stand = (q, f, dx = 0) => ((q.s.x = f.x + dx - PW / 2), (q.s.y = floorY));
  const run = (n) => { for (let i = 0; i < n; i++) sim.step([]); };
  park();
  sim.setTeams([0, 0, 1, 1]);
  const [fa, fb] = sim.flags;
  assert.deepEqual([fa.x, fa.y, fb.x, fb.y], [...box.bases[0], ...box.bases[1]], 'the flags stand on the bases');
  stand(p[2], fa);
  run(60);
  assert.equal(fa.m, 0, 'nothing counts before GO');
  sim.start();
  p.forEach((q) => (q.bomb = false)); // (bombs are another test)
  park();
  run(120);
  assert.deepEqual([fa.owner, fa.m, fb.owner, fb.m], [-1, 0, -1, 0], 'nobody there: nobody\'s');
  // one player of team 1 stands in the ring of flag A
  stand(p[2], fa);
  run(FLAG_CAP_TICKS - 1);
  assert.deepEqual([fa.owner, fa.m], [-1, FLAG_CAP_TICKS - 1], 'filling...');
  sim.events.length = 0;
  run(1);
  assert.deepEqual([fa.owner, fa.m], [1, FLAG_CAP_TICKS], 'full: it is theirs');
  assert.ok(sim.events.some((e) => e.type === 'flag' && e.what === 'take' && e.team === 1 && e.i === 0));
  assert.equal(p[2].caps, 1);
  // it gives its side a point on every beat, whether they stay or not
  park();
  assert.deepEqual(sim.score, [0, 0]);
  run(BEAT_TICKS);
  assert.deepEqual(sim.score, [0, FLAG_POINTS]);
  run(BEAT_TICKS);
  assert.deepEqual(sim.score, [0, 2 * FLAG_POINTS]);
  // a bomb in hand takes a point off its side on the beat - but a score never goes below nothing
  {
    const end = new Sim(box, () => 0.3);
    for (let i = 0; i < 4; i++) end.add(i);
    end.setTeams([0, 0, 1, 1]);
    end.start();
    end.players.forEach((q) => q && (q.bomb = false));
    end.players[0].bomb = true;
    end.payBeat();
    assert.deepEqual(end.score, [0, 0]);
    end.flags[0].owner = 0;
    end.score[0] = 2;
    end.events.length = 0;
    end.payBeat();
    assert.deepEqual(end.score, [2 + FLAG_POINTS - BOMB_COST, 0]);
    assert.deepEqual(end.events.map((e) => [e.type, e.n]), [['flag', FLAG_POINTS], ['cost', BOMB_COST]]);
    end.score[0] = 1;
    end.finish();
    assert.deepEqual(end.score, [1 + FLAG_END_POINTS, BOMB_POINTS], 'the buzzer: the flag pays its side in full, the bomb scores for the others');
  }
  // two together fill a flag twice as fast
  stand(p[0], fb, -30);
  stand(p[1], fb, 30);
  run(FLAG_CAP_TICKS / 2);
  assert.equal(fb.owner, 0);
  assert.ok(p[0].caps === 1 && p[1].caps === 1);
  // equal numbers in the ring: nothing moves
  park();
  const before = sim.score.slice();
  stand(p[0], fa, -40);
  stand(p[2], fa, 40);
  run(100);
  assert.deepEqual([fa.owner, fa.m], [1, FLAG_CAP_TICKS], 'contested: held');
  // alone, the other side empties it (nobody's), then fills it (theirs)
  p[2].s.x = away[2];
  sim.events.length = 0;
  run(FLAG_CAP_TICKS);
  assert.deepEqual([fa.owner, fa.m], [-1, 0]);
  assert.ok(sim.events.some((e) => e.type === 'flag' && e.what === 'lose' && e.team === 1 && e.i === 0));
  run(FLAG_CAP_TICKS);
  assert.deepEqual([fa.owner, fa.m], [0, -FLAG_CAP_TICKS]);
  assert.ok(sim.score[0] > before[0] || sim.score[1] > before[1], 'flags kept paying meanwhile');
  // half way and then walking off: the flag settles back
  park();
  stand(p[3], fa);
  run(60);
  assert.deepEqual([fa.owner, fa.m], [0, -FLAG_CAP_TICKS + 60]);
  park();
  run(60);
  assert.deepEqual([fa.owner, fa.m], [0, -FLAG_CAP_TICKS]);
  // the ring: its width, a hop on the spot counts, standing on something above it does not
  stand(p[3], fa, FLAG_HALF + 2);
  run(10);
  assert.equal(fa.m, -FLAG_CAP_TICKS, 'just outside');
  stand(p[3], fa, FLAG_HALF - 2);
  run(10);
  assert.equal(fa.m, -FLAG_CAP_TICKS + 10, 'just inside');
  park();
  run(10);
  stand(p[3], fa);
  for (let i = 0; i < 30; i++) sim.step([0, 0, 0, i < 2 ? IN_JUMP : 0]);
  assert.ok(p[3].s.y < floorY - 20, 'in the air');
  assert.equal(fa.m, -FLAG_CAP_TICKS + 30, 'a hop still counts');
  park();
  run(30);
  p[3].s.x = fa.x - PW / 2;
  p[3].s.y = floorY - FLAG_UP - 40;
  sim.step([]);
  assert.equal(fa.m, -FLAG_CAP_TICKS, 'above the ring does not');
  // after the buzzer nothing moves and nothing pays
  park();
  sim.finish();
  const end = sim.score.slice();
  stand(p[3], fa);
  run(310);
  assert.deepEqual([fa.owner, fa.m], [0, -FLAG_CAP_TICKS]);
  assert.deepEqual(sim.score, end);
});

test('launchers fling you across the arena; thorns sting once and throw you back', () => {
  const yard = { ...box, platforms: [box.platforms[0]], ramps: [], lifts: [], portals: [], tramps: [{ x: 906, y: 704, w: 68, h: 16, cx: 940, vx: LAUNCH_VX, vy: LAUNCH_VY }], spikes: [{ x: 2003, y: 704, w: 74, h: 16 }] };
  const p = makeState(820, floorY);
  run(p, 0, 2, yard);
  let n = 0;
  while (p.vy > -1000 && n++ < 60) stepPlayer(p, IN_RIGHT, yard);
  assert.ok(p.vx > 700, `launched sideways at ${p.vx}`);
  let top = p.y;
  for (let i = 0; i < 300 && !p.ground; i++) {
    stepPlayer(p, 0, yard);
    top = Math.min(top, p.y);
  }
  assert.ok(floorY - top > 250 && p.x > 940 + 500, `flew ${Math.round(p.x - 940)}px across and ${Math.round(floorY - top)}px up`);
  const q = makeState(1900, floorY);
  run(q, 0, 2, yard);
  n = 0;
  while (q.stun === 0 && n++ < 60) stepPlayer(q, IN_RIGHT, yard);
  assert.ok(q.stun > 0 && q.vx < 0 && q.vy < 0, 'stung and thrown back');
  const hz = q.hz;
  assert.ok(hz > 0);
  q.stun = 0;
  q.x = 2010; // standing right in them again
  q.y = floorY;
  stepPlayer(q, 0, yard);
  assert.equal(q.stun, 0, 'they cannot sting again straight away');
});

test('standings: hot potato has one loser; least-time has a winner; ties share', () => {
  const sim = new Sim(box);
  sim.add(0).itTicks = 500;
  sim.add(1).itTicks = 120;
  sim.add(2).itTicks = 120;
  sim.it = 1;
  const potato = standings(sim, ['A', 'B', 'C'], 'potato');
  assert.equal(potato.loser, 1);
  assert.deepEqual(potato.winners.sort(), [0, 2]);
  assert.equal(potato.rows[2].name, 'B', 'loser listed last');
  const time = standings(sim, ['A', 'B', 'C'], 'time');
  assert.deepEqual(time.winners, [1, 2]);
  assert.equal(time.loser, -1);
});

test('tournament points: places for least time as it, plus one for everyone safe at the buzzer', () => {
  const sim = new Sim(box);
  [500, 120, 120, 900].forEach((t, i) => (sim.add(i).itTicks = t));
  sim.it = 3;
  assert.deepEqual(cupPoints(sim), { 0: 2, 1: 4, 2: 4, 3: 0 }); // 1 and 2 share first place
  assert.deepEqual(cupPoints(sim, true), { 0: 4, 1: 8, 2: 8, 3: 0 }); // final round counts double
  sim.it = 1; // best time, but caught holding it at the end
  assert.deepEqual(cupPoints(sim), { 0: 2, 1: 3, 2: 4, 3: 1 });
  const two = new Sim(box);
  two.add(0).itTicks = 100;
  two.add(1).itTicks = 300;
  two.it = 0;
  assert.deepEqual(cupPoints(two), { 0: 1, 1: 1 }, 'a last-second tag evens a two-player round');
  two.it = 1;
  assert.deepEqual(cupPoints(two), { 0: 2, 1: 0 });
});

test('the leader can be made to start as it; twists change the round', () => {
  const sim = new Sim(box);
  sim.add(0);
  sim.add(1);
  sim.add(2);
  sim.twist = twistById('turbo');
  sim.start(2);
  assert.equal(sim.it, 2);
  const s = sim.players[0].s;
  s.x = 2400;
  s.y = floorY;
  for (let i = 0; i < 30; i++) sim.step([IN_RIGHT, 0, 0]);
  assert.ok(Math.abs(s.vx - MOVE_SPEED * twistById('turbo').speed) < 0.5, `turbo speed ${s.vx}`);
  const frenzy = new Sim(box, () => 0.4);
  frenzy.add(0).s.x = 2400;
  frenzy.add(1).s.x = 2600;
  frenzy.twist = twistById('frenzy');
  frenzy.start();
  for (let i = 0; i < BOX_FIRST_TICKS / 2; i++) frenzy.step([0, 0]);
  assert.equal(frenzy.boxes.length, 1, 'boxes arrive sooner in a frenzy');
});

test('ten players: everyone gets their own start, any of them can tag or be tagged, and all ten score', () => {
  assert.equal(MAX_PLAYERS, 10);
  assert.equal(PLAYER_COLORS.length, 10);
  assert.equal(new Set(PLAYER_COLORS).size, 10, 'ten different colours');
  assert.deepEqual([...TEAM_SLOTS[0], ...TEAM_SLOTS[1]].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'five colours a side');
  for (const arena of ARENAS) {
    assert.equal(arena.spawns.length, 10, `${arena.id} has ten start positions`);
    assert.equal(new Set(arena.spawns.map((s) => s.join())).size, 10, `${arena.id}: no two players start on the same spot`);
    // ...and not on top of each other either
    arena.spawns.forEach((p, i) => arena.spawns.forEach((q, j) => i < j && assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) > 60, `${arena.id}: starts ${i + 1} and ${j + 1} are too close`)));
  }
  const sim = new Sim(box);
  for (let i = 0; i < 10; i++) sim.add(i).itTicks = [300, 100, 500, 200, 600, 400, 700, 800, 900, 1000][i];
  assert.equal(sim.active().length, 10);
  // slot 9 (the tenth player) is it and touches slot 8
  const a = sim.players[9].s;
  const b = sim.players[8].s;
  a.x = 2400;
  b.x = 2400 + PW;
  a.y = b.y = floorY;
  sim.it = 9;
  sim.step([]);
  assert.equal(sim.it, 8, 'the tenth player tagged the ninth');
  assert.equal(sim.players[9].tags, 1);
  // tournament points: 9 down to 0 for least time as it, +1 for everyone but whoever is it
  sim.it = 4;
  assert.deepEqual(cupPoints(sim), { 0: 8, 1: 10, 2: 6, 3: 9, 4: 4, 5: 7, 6: 4, 7: 3, 8: 2, 9: 1 });
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  assert.deepEqual(standings(sim, names, 'potato').winners.sort(), [0, 1, 2, 3, 5, 6, 7, 8, 9]);
  assert.equal(standings(sim, names, 'time').winners[0], 1);
});

test('if "it" leaves, someone else becomes it', () => {
  const sim = new Sim(box);
  sim.add(0);
  sim.add(1);
  sim.add(2);
  sim.it = 1;
  sim.remove(1);
  assert.ok(sim.it === 0 || sim.it === 2);
});

// The player counts a stage's bots are tried with: all of them inside what the stage is meant for.
const sizeOf = (arena) => (arena.players[1] > 6 ? 'big' : arena.players[1] < 6 ? 'duel' : 'small');
const botCounts = (arena) => ({ big: [5, 6, 8, 10], small: [2, 4, 5, 6], duel: [2, 3, 4] })[sizeOf(arena)];

test('stages by size: two duel stages (48 x 28 tiles, 2 to 4 players), six small (64 x 36, 2 to 6), three big (96 x 47, 5 to 10); arenaFits and arenasFor say which', () => {
  assert.equal(ARENAS.length, 11);
  assert.equal(new Set(ARENA_IDS).size, 11);
  const small = ['hills', 'canyon', 'pagoda', 'zigzag', 'dojo', 'bramble'];
  const big = ['valley', 'gorge', 'halls'];
  const duel = ['court', 'span'];
  assert.deepEqual(ARENA_IDS, [...small, ...big, ...duel]);
  for (const a of ARENAS) {
    const kind = sizeOf(a);
    assert.equal(kind, big.includes(a.id) ? 'big' : duel.includes(a.id) ? 'duel' : 'small');
    assert.deepEqual(a.players, { big: [5, 10], small: [2, 6], duel: [2, 4] }[kind], `${a.id} is meant for ${a.players.join(' to ')} players`);
    assert.deepEqual([a.w / TILE, a.h / TILE], { big: [96, 47], small: [64, 36], duel: [48, 28] }[kind], `${a.id}: ${a.w / TILE} x ${a.h / TILE} tiles`);
    assert.ok(a.name && a.blurb && a.blurb.length <= 60, `${a.id}: a name, and a blurb of at most 60 characters (${a.blurb.length})`);
    assert.deepEqual(arenaById(a.id).players, a.players, 'the stage as a match plays it says the same');
    // a big stage is watched from a little further off (and no stage from closer than the usual)
    assert.equal(a.view, kind === 'big' ? 740 : VIEW_USUAL, `${a.id}: ${a.view} world units of height on screen`);
    assert.equal(arenaById(a.id).view, a.view);
  }
  assert.ok(VIEW_USUAL === 660, 'the usual view');
  assert.ok((96 * 47) / (64 * 36) >= 1.8 && (96 * 47) / (64 * 36) <= 2.2, 'a big stage has about twice the room of a small one');
  assert.ok((48 * 28) / (64 * 36) >= 0.5 && (48 * 28) / (64 * 36) <= 0.65, 'a duel stage a little over half');
  for (let n = 2; n <= 10; n++) {
    const want = n <= 4 ? [...small, ...duel] : n <= 6 ? [...small, ...big] : big;
    assert.deepEqual(arenasFor(n), want, `stages for ${n} players`);
    for (const id of ARENA_IDS) assert.equal(arenaFits(id, n), want.includes(id), `${id} with ${n} players`);
  }
  assert.ok(!arenaFits('nowhere', 4) && arenasFor(1).length === 8 && arenasFor(99).length === 3 && arenasFor().length === 8, 'never an empty list, never an unknown stage');
});

// Where a pad puts down someone who steps onto it and touches nothing: [x of their middle, y of their feet] - or null (off the map).
function landing(arena, pad) {
  const p = makeState(pad.cx - PW / 2, pad.y + pad.h - PH - 2);
  for (let t = 0; t < 400; t++) {
    stepPlayer(p, 0, arena);
    if (p.dead > 0) return null;
    if (t > 10 && p.ground && p.orb === 0) return [p.x + PW / 2, p.y + PH];
  }
  return null;
}

test('every arena: starts, three flags and boxes stand on something; every surface can reach every other; portals keep clear of pads', () => {
  const times = [];
  const mids = [];
  for (const arena of ARENAS) {
    assert.ok(arena.name && arena.blurb, `${arena.id} has a name and a blurb`);
    const stands = ([x, y], what) => {
      const p = makeState(x, y);
      for (let t = 0; t < 20; t++) stepPlayer(p, 0, arena);
      assert.ok(p.ground && Math.abs(p.y - y) < 1 && Math.abs(p.x - x) < 1 && p.dead === 0 && p.stun === 0 && p.orb === 0, `${arena.id} ${what} stands on firm ground`);
    };
    arena.spawns.forEach((sp, i) => stands(sp, `start ${i + 1}`));
    arena.respawns.forEach((sp, i) => stands(sp, `respawn point ${i}`));
    // starts 1, 3, 5 on the left half and 2, 4, 6 on the right
    arena.spawns.forEach(([x], i) => assert.equal(x + PW / 2 < arena.w / 2, i % 2 === 0, `${arena.id}: start ${i + 1} is on the ${i % 2 ? 'right' : 'left'}`));
    // three flag stands on firm ground: one at each end, and the third dead centre, higher up than both
    const duel = sizeOf(arena) === 'duel';
    assert.equal(arena.bases.length, 3);
    assert.equal(FLAG_LETTERS.length, 3, 'a letter for each');
    arena.bases.forEach(([x, y], t) => stands([x - PW / 2, y - PH], `base ${t}`));
    // (in the order they stand on the map: A at the left end, B in the middle, C at the right end)
    assert.ok(arena.bases[0][0] < arena.w * 0.4 && arena.bases[2][0] > arena.w * 0.6, `${arena.id}: bases on opposite sides`);
    assert.equal(arena.bases[0][0], arena.w - arena.bases[2][0], `${arena.id}: the two ends mirror each other`);
    assert.equal(arena.bases[0][1], arena.bases[2][1]);
    assert.equal(arena.bases[1][0], arena.w / 2, `${arena.id}: the third flag is dead centre`);
    assert.ok(arena.bases[1][1] <= arena.bases[0][1] - 6 * TILE && arena.bases[1][1] <= arena.h * 0.5, `${arena.id}: and high up (${arena.bases[1][1] / TILE} against ${arena.bases[0][1] / TILE})`);
    // portals come in pairs: one to three of them (a duel stage: one at most), at least one you can drop out of
    const pairs = arena.portals.length / 2;
    assert.ok(Number.isInteger(pairs) && pairs <= 3 && pairs >= (duel ? 0 : 1), `${arena.id}: ${pairs} portal pairs`);
    for (const po of arena.portals) assert.equal(arena.portals[po.to].to, arena.portals.indexOf(po));
    assert.ok(!pairs || arena.portals.some((po) => po.drop), `${arena.id}: a portal pair you can let go of`);
    // the toolbox is in use, sparingly (see the next test for how much of it there may be); a duel stage has hardly any of it
    if (duel) assert.ok(arena.tramps.length + arena.lifts.length + arena.spikes.length === 0, `${arena.id}: a duel stage has no pads, updrafts or thorns`);
    else {
      assert.ok(arena.tramps.some((t) => !t.vx) && arena.tramps.filter((t) => t.vx).length >= 2, `${arena.id}: trampolines and launchers`);
      assert.ok(arena.lifts.length >= 1 && arena.spikes.length >= 2 && arena.ramps.length >= 4, `${arena.id}: updrafts, thorns, slopes`);
    }
    // Portals and pads never go together: no portal within six tiles of a pad on its level, of where a
    // launcher or a trampoline puts you down, or of the top of an updraft; and plain ground for two tiles on its open side
    for (const po of arena.portals) {
      const feet = po.y + po.h;
      for (const t of arena.tramps) {
        if (Math.abs(t.y + t.h - feet) < TILE * 2) assert.ok(Math.abs(t.cx - po.cx) >= 6 * TILE, `${arena.id}: the portal at ${po.cx / TILE - 0.5},${feet / TILE} is ${Math.abs(t.cx - po.cx) / TILE} tiles from a pad`);
        const land = landing(arena, t);
        if (land) assert.ok(Math.hypot(land[0] - po.cx, land[1] - feet) >= 5 * TILE, `${arena.id}: the pad at ${t.cx / TILE},${(t.y + t.h) / TILE} puts you down at ${Math.round(land[0] / TILE)},${Math.round(land[1] / TILE)}, ${Math.round(Math.hypot(land[0] - po.cx, land[1] - feet) / TILE)} tiles from a portal`);
      }
      for (const z of arena.lifts) {
        if (Math.abs(z.y - feet) < TILE * 3) assert.ok(Math.min(Math.abs(z.x - po.cx), Math.abs(z.x + z.w - po.cx)) >= 4 * TILE, `${arena.id}: the portal at ${po.cx / TILE - 0.5},${feet / TILE} is at the top of an updraft`);
      }
    }

    const t0 = performance.now();
    const nav = buildNav(arena);
    times.push(`${arena.id} ${nav.surfaces.length} surfaces in ${Math.round(performance.now() - t0)} ms`);
    assert.ok(performance.now() - t0 < 1500, `${arena.id}: the route map took ${Math.round(performance.now() - t0)} ms to build`);
    const n = nav.surfaces.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) assert.ok(nav.dist[i][j] < 1e9, `${arena.id}: surface ${i} cannot reach ${j}`);
    // nobody is ever routed through thorns: no surface overlaps them
    for (const z of arena.spikes) {
      for (const sf of nav.surfaces) assert.ok(sf.ramp || Math.abs(sf.y - (z.y + z.h)) > 2 || sf.x1 <= z.x - 10 || sf.x0 >= z.x + z.w + 10, `${arena.id}: surface ${sf.id} runs into thorns`);
    }
    // 10 to 14 lucky-box spots (14 to 20 on a big stage, 8 to 10 on a duel stage), each within reach of someone standing on the ground below it
    const [fewest, most] = { big: [14, 20], small: [10, 14], duel: [8, 10] }[sizeOf(arena)];
    assert.ok(arena.pickups.length >= fewest && arena.pickups.length <= most, `${arena.id}: ${arena.pickups.length} box spots`);
    for (const pt of arena.pickups) {
      const under = nav.below(pt.x, pt.y - 30, null);
      assert.ok(under && nav.heightAt(under, pt.x) - pt.y <= PH + 20, `${arena.id}: nobody can reach the box spot at ${pt.x},${pt.y}`);
    }
    // the bases are as far from each other in both directions
    const at = ([x, y]) => surfaceAt(nav, x, y);
    const [b0, b2, b1] = arena.bases.map(at); // (b2: the one in the middle)
    assert.ok(b0 && b1 && b2, `${arena.id}: bases are on the route map`);
    // (the route map cuts a long ledge into pieces, and the middle flag stands where two meet: measure to the nearer piece)
    const mid = [-30, 30].map((dx) => at([arena.bases[1][0] + dx, arena.bases[1][1]]));
    assert.ok(mid[0] && mid[1], `${arena.id}: ground on both sides of the middle flag`);
    const toMid = (b) => Math.min(nav.dist[b.id][mid[0].id], nav.dist[b.id][mid[1].id]);
    const there = nav.dist[b0.id][b1.id];
    const back = nav.dist[b1.id][b0.id];
    assert.ok(Math.abs(there - back) < 0.1 * Math.max(there, back), `${arena.id}: base to base takes ${Math.round(there)} ticks one way, ${Math.round(back)} the other`);
    // ...and the flag in the middle is as far from one end as from the other, and no further than the ends are from each other
    const [m0, m1] = [toMid(b0), toMid(b1)];
    assert.ok(Math.abs(m0 - m1) < 0.1 * Math.max(m0, m1), `${arena.id}: the middle flag is ${Math.round(m0)} ticks from one end, ${Math.round(m1)} from the other`);
    assert.ok(m0 <= there * 1.15, `${arena.id}: the middle flag is ${Math.round(m0)} ticks from an end; the ends are ${Math.round(there)} apart`);
    mids.push(`${arena.id} ${Math.round(m0 / 60)}s/${Math.round(there / 60)}s`);
  }
  console.log(`      an end to the middle flag / end to end: ${mids.join(', ')}`);
  console.log(`      route maps: ${times.join(', ')}`);
});

// Open ground. A tile of flat ground is "open" when nothing stands on it (a pad, thorns, a portal, the foot
// of an updraft, a wall) and the five tiles of air above it are empty: no ledge, block, slope or updraft.
// Returns { grid, floor, runs }: the tiles, a test for "is this tile ground", and the stretches of open tiles
// as { row, c0, c1, len }.
function openGround(arena, head = 5) {
  const C = arena.w / TILE;
  const R = arena.h / TILE;
  const grid = Array.from({ length: R }, () => new Array(C).fill(0)); // 1 solid block, 2 thin ledge, 4 a gadget, 8 a slope
  const mark = (x0, y0, x1, y1, bit) => {
    for (let r = Math.max(0, Math.floor(y0 / TILE)); r <= Math.min(R - 1, Math.floor((y1 - 1) / TILE)); r++) {
      for (let c = Math.max(0, Math.floor(x0 / TILE)); c <= Math.min(C - 1, Math.floor((x1 - 1) / TILE)); c++) grid[r][c] |= bit;
    }
  };
  for (const p of arena.platforms) mark(p.x, p.y, p.x + p.w, p.y + (p.oneway ? 1 : p.h), p.oneway ? 2 : 1);
  for (const z of [...arena.tramps, ...arena.spikes, ...arena.lifts, ...arena.portals]) mark(z.x + 3, z.y, z.x + z.w - 3, z.y + z.h, 4);
  for (const s of arena.ramps) for (let x = s.x0; x < s.x1; x += 4) mark(x, rampY(s, x) - 2, x + 1, rampY(s, x) - 1, 8);
  const floor = (r, c) => r > 0 && (grid[r][c] & 3) !== 0 && !(grid[r - 1][c] & 1);
  const open = (r, c) => {
    if (!floor(r, c)) return false;
    for (let k = 1; k <= head; k++) if (r - k >= 0 && grid[r - k][c]) return false;
    return true;
  };
  const runs = [];
  for (let r = 1; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (!open(r, c)) continue;
      const c0 = c;
      while (c + 1 < C && open(r, c + 1)) c++;
      runs.push({ row: r, c0, c1: c, len: c - c0 + 1 });
    }
  }
  return { grid, floor, runs };
}

test('every arena has room to run: four clear flat stretches of 14 tiles (one of 24; a duel stage: 12, one of 16), a bottom floor that is mostly plain ground, few gadgets', () => {
  const log = [];
  for (const arena of ARENAS) {
    const { grid, floor, runs } = openGround(arena, sizeOf(arena) === 'big' ? 4 : 5); // (a big stage's floors are five tiles apart: four of air)
    const [least, best] = sizeOf(arena) === 'duel' ? [12, 16] : [14, 24];
    const long = runs.filter((q) => q.len >= least).map((q) => q.len).sort((a, b) => b - a);
    log.push(`${arena.id} ${long.join('/')}`);
    assert.ok(long.length >= 4, `${arena.id}: only ${long.length} clear stretches of ${least} tiles or more (${long})`);
    assert.ok(long[0] >= best, `${arena.id}: the longest clear stretch is ${long[0]} tiles`);
    // few gadgets
    assert.ok(arena.tramps.length <= 8, `${arena.id}: ${arena.tramps.length} trampolines and launchers`);
    assert.ok(arena.lifts.length <= 4, `${arena.id}: ${arena.lifts.length} updrafts`);
    assert.ok(arena.spikes.length <= (arena.id === 'bramble' ? 12 : 8), `${arena.id}: ${arena.spikes.length} thorn patches`);
    // the bottom floor is mostly plain ground: at most a quarter of it within two tiles of a pad, thorns, a portal or an updraft
    const C = arena.w / TILE;
    let bottom = 0;
    for (let r = 1; r < grid.length; r++) if (grid[r].filter((_, c) => floor(r, c)).length >= 20) bottom = r;
    let len = 0;
    let near = 0;
    for (let c = 0; c < C; c++) {
      if (!floor(bottom, c)) continue;
      len++;
      for (let d = -2; d <= 2; d++) {
        if (c + d >= 0 && c + d < C && (grid[bottom - 1][c + d] & 4 || grid[bottom][c + d] & 4)) {
          near++;
          break;
        }
      }
    }
    assert.ok(near <= len * 0.25, `${arena.id}: ${near} of the bottom floor's ${len} tiles are within two tiles of a gadget`);
    // the flags have room: six clear tiles of flat ground around each, under three tiles of air
    const roomy = openGround(arena, 3).runs;
    for (const [x, y] of arena.bases) {
      const at = roomy.find((q) => q.row === y / TILE && x / TILE >= q.c0 && x / TILE <= q.c1 + 1);
      assert.ok(at && at.len >= 6, `${arena.id}: the flag at ${x},${y} stands on ${at ? at.len : 0} clear tiles`);
    }
    // and lucky boxes turn up out in the open too
    const out = arena.pickups.filter((pt) => runs.some((q) => q.len >= least && q.row === Math.floor(pt.y / TILE) + 1 && pt.x / TILE >= q.c0 && pt.x / TILE <= q.c1 + 1)).length;
    assert.ok(arena.pickups.length >= (sizeOf(arena) === 'duel' ? 8 : 12) && out >= 4, `${arena.id}: ${arena.pickups.length} box spots, ${out} of them on open ground`);
  }
  console.log(`      clear stretches of 14 tiles or more: ${log.join(', ')}`);
});

// A bot-only match. Returns what happened.
function botMatch(arena, n, teams, seconds = 120) {
  let seed = 99 + n + (teams ? 1000 : 0);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const sim = new Sim(arena, rnd);
  const mem = [];
  for (let i = 0; i < n; i++) {
    sim.add(i);
    mem.push(makeBot(i + 1));
  }
  if (teams) sim.setTeams(Array.from({ length: n }, (_, i) => i % 2));
  sim.start();
  const out = { tags: 0, booms: 0, worst: 0, falls: 0, stings: 0, takes: 0, turned: 0, idle: 0, tagged: new Array(n).fill(0), score: sim.score, flags: 0 };
  let gap = 0;
  // "idle": the longest anyone stayed within 60px of one spot
  const anchor = mem.map(() => [0, 0]);
  const still = mem.map(() => 0);
  for (let t = 0; t < 60 * seconds; t++) {
    const was = sim.players.map((p) => p && [p.s.dead, p.s.hz]);
    sim.step(mem.map((m, i) => (sim.players[i] ? botThink(sim, i, m) : 0)));
    gap++;
    for (const e of sim.events) {
      if (e.type === 'tag') {
        out.tags++;
        out.tagged[e.to]++;
      } else if (e.type === 'flag' && e.what === 'take') out.takes++;
      else if (e.type === 'flag' && e.what === 'pay') out.flags++;
      else if (e.type === 'flag' && e.what === 'lose') out.turned++;
      if (e.type === 'tag') {
        out.worst = Math.max(out.worst, gap);
        gap = 0;
      }
    }
    sim.events.length = 0;
    for (const p of sim.active()) {
      const i = p.slot;
      assert.ok(p.s.x >= 0 && p.s.x <= arena.w - PW && p.s.y >= 0, `${arena.id}: out of bounds`);
      if (p.s.dead > 0 && was[i][0] === 0) out.falls++;
      if (p.s.hz > was[i][1]) out.stings++;
      if (Math.hypot(p.s.x - anchor[i][0], p.s.y - anchor[i][1]) > 60) {
        anchor[i] = [p.s.x, p.s.y];
        still[i] = 0;
      } else out.idle = Math.max(out.idle, ++still[i]);
    }
  }
  out.worst = Math.max(out.worst, gap);
  // the buzzer: in a team battle the bombs go off now
  sim.events.length = 0;
  sim.finish();
  out.booms = sim.events.filter((e) => e.type === 'boom').length;
  return out;
}

test('bots play every arena with as many as it is meant for (2 to 4, 2 to 6, or 5 to 10): tags keep happening, nobody stands about, pit falls are rare', () => {
  let falls = 0;
  let minutes = 0;
  const log = [];
  for (const { id } of ARENAS) {
    const arena = arenaById(id); // as a match plays it (with few thorns)
    for (const n of botCounts(arena)) {
      const r = botMatch(arena, n, false);
      const who = `${arena.id} ${n}p`;
      log.push(`${who} ${r.tags} tags (longest gap ${Math.round(r.worst / 60)}s, ${r.falls} falls)`);
      assert.ok(r.tags >= 5, `${who}: only ${r.tags} tags in 2 minutes`);
      assert.ok(r.worst < 60 * 75, `${who}: ${Math.round(r.worst / 60)}s without a tag`);
      assert.ok(r.tagged.filter((c) => c > 0).length >= Math.min(n, 3) - (n > 2 ? 1 : 0), `${who}: tagged ${r.tagged}`);
      assert.ok(r.idle < 60 * 10, `${who}: a bot stood still for ${Math.round(r.idle / 60)}s`);
      // the arenas are harder now: a bot may miss a jump over a pit, but not often
      assert.ok(r.falls <= 3, `${who}: ${r.falls} falls into a pit in one match`);
      falls += r.falls;
      minutes += 2 * n;
    }
  }
  console.log(`      ${log.join('; ')}`);
  // (over many more seeds than this it comes to about one fall per 500 minutes of play, per bot)
  assert.ok(falls / minutes < 0.02, `${falls} pit falls in ${minutes} bot-minutes`);
});

test('bots play team battles: flags are taken and turned, bombs change hands and go off at the buzzer, nobody stands about for long', () => {
  let falls = 0;
  let minutes = 0;
  const log = [];
  for (const { id } of ARENAS) {
    const arena = arenaById(id); // as a match plays it
    let passes = 0;
    let turned = 0;
    let paid = 0;
    let taken = 0;
    for (const n of botCounts(arena)) {
      const r = botMatch(arena, n, true, 90);
      const who = `${arena.id} ${n}p teams`;
      log.push(`${who} ${r.score.join('-')} (${r.tags} passes, ${r.booms} bombs, flags: ${r.takes} taken ${r.turned} lost, ${r.flags} points; idle ${Math.round(r.idle / 60)}s, ${r.falls} falls)`);
      assert.equal(r.booms, Math.max(1, Math.floor(n / 2)), `${who}: every bomb goes off at the buzzer`);
      // (one match is one roll of the dice - whoever has a bomb is busy chasing, the others busy running - so each
      // match only has to show some flag play; the three matches of an arena together have to show plenty)
      assert.ok(r.takes >= 1, `${who}: no flag was taken`);
      assert.ok(r.flags >= 3, `${who}: the flags paid only ${r.flags} points`);
      paid += r.flags;
      taken += r.takes;
      // taking a flag means standing in its ring; nobody should stand anywhere for much longer than that takes
      assert.ok(r.idle < 60 * 14, `${who}: a bot stood still for ${Math.round(r.idle / 60)}s`);
      assert.ok(r.falls <= 3, `${who}: ${r.falls} falls into a pit in one match`);
      passes += r.tags;
      turned += r.turned;
      falls += r.falls;
      minutes += 1.5 * n;
    }
    assert.ok(passes >= 3, `${arena.id}: bombs changed hands only ${passes} times in four team matches`);
    assert.ok(taken >= 6 && paid >= 40, `${arena.id}: in its team matches flags were taken ${taken} times and paid ${paid} points`);
    log.push(`[${arena.id}: ${passes} passes, ${turned} flags lost]`);
  }
  console.log(`      ${log.join('; ')}`);
  assert.ok(falls / minutes < 0.03, `${falls} pit falls in ${minutes} bot-minutes`);
});

console.log(`sim: ${passed} tests passed`);
