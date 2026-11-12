// Rules + physics checks. Run with: npm test
import assert from 'node:assert/strict';
import {
  PW, PH, IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN, MOVE_SPEED, IMMUNE_TICKS, STUN_TICKS, RESPAWN_TICKS,
  SPEED_BUFF_MUL, TOUCH, PICKUP_TYPES, PICKUP_FIRST_TICKS, AIR_JUMPS, twistById,
} from '../shared/config.js';
import { ARENAS } from '../shared/arenas.js';
import { makeState, stepPlayer, packState, unpackState, STATE_LEN } from '../shared/physics.js';
import { Sim, standings, cupPoints } from '../shared/sim.js';
import { buildNav } from '../shared/nav.js';
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
  assert.ok(total >= 16 && total <= 50, `flight takes ${total} ticks`);
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
  assert.equal(p.tp, 1);
  run(p, 0, 30);
  assert.equal(p.orb, 0, 'standing in the exit does not send you back');
  assert.equal(p.y, floorY);
  run(p, IN_RIGHT, 30); // step out...
  assert.equal(p.tp, 0);
  ticksUntil(p, IN_LEFT, (q) => q.orb > 0, 60); // ...and back in
  assert.ok(p.orb > 0, 'works again after stepping out');
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

test('updrafts carry you up without any input and give your air jump back', () => {
  const p = makeState(2000, floorY);
  settle(p);
  run(p, IN_RIGHT, 25); // walk into the column
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

test('after a tag: 0.4s freeze for the new it, 1s no tag-backs', () => {
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

test('power-ups appear, and each one does its job', () => {
  const sim = new Sim(box, () => 0.4);
  const a = sim.add(0);
  const b = sim.add(1);
  a.s.x = 1300;
  b.s.x = 1900;
  a.s.y = b.s.y = floorY;
  sim.start();
  sim.it = 0;
  for (let i = 0; i <= PICKUP_FIRST_TICKS + 1; i++) sim.step([0, 0]);
  assert.equal(sim.pickups.length, 1, 'one spawned');
  const give = (pl, kind) => sim.applyPickup(pl, PICKUP_TYPES.indexOf(kind));
  give(b, 'speed');
  for (let i = 0; i < 15; i++) sim.step([0, IN_LEFT]);
  assert.ok(Math.abs(Math.abs(b.s.vx) - MOVE_SPEED * SPEED_BUFF_MUL) < 0.5, `swift ${b.s.vx}`);
  give(b, 'freeze'); // a runner freezes "it"
  assert.ok(a.s.frz > 0 && b.s.frz === 0);
  const ax = a.s.x;
  for (let i = 0; i < 10; i++) sim.step([IN_RIGHT, 0]);
  assert.equal(a.s.x, ax, 'frozen players cannot move');
  a.s.frz = 0;
  give(b, 'shield');
  a.s.x = b.s.x - PW;
  sim.step([0, 0]);
  assert.equal(sim.it, 0, 'shield blocked the tag');
  assert.ok(sim.events.some((e) => e.type === 'block') && b.s.shd === 0 && a.s.stun > 0);
  give(a, 'shield');
  assert.equal(a.s.shd, 0, '"it" cannot carry a shield');
  // walking over an item picks it up
  sim.pickups = [{ point: 0, type: PICKUP_TYPES.indexOf('jump') }];
  b.s.x = 470;
  b.s.stun = 0;
  for (let i = 0; i < 10; i++) sim.step([0, IN_RIGHT]);
  assert.ok(b.s.jmp > 0 && sim.pickups.length === 0, 'picked up Spring');
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
  for (let i = 0; i < PICKUP_FIRST_TICKS / 2; i++) frenzy.step([0, 0]);
  assert.equal(frenzy.pickups.length, 1, 'items arrive sooner in a frenzy');
});

test('six players: everyone gets their own start, any of them can tag or be tagged, and all six score', () => {
  for (const arena of ARENAS) {
    assert.equal(arena.spawns.length, 6, `${arena.id} has six start positions`);
    assert.equal(new Set(arena.spawns.map((s) => s.join())).size, 6, `${arena.id}: no two players start on the same spot`);
  }
  const sim = new Sim(box);
  for (let i = 0; i < 6; i++) sim.add(i).itTicks = [300, 100, 500, 200, 600, 400][i];
  assert.equal(sim.active().length, 6);
  // slot 5 (the sixth player) is it and touches slot 4
  const a = sim.players[5].s;
  const b = sim.players[4].s;
  a.x = 2400;
  b.x = 2400 + PW;
  a.y = b.y = floorY;
  sim.it = 5;
  sim.step([]);
  assert.equal(sim.it, 4, 'the sixth player tagged the fifth');
  assert.equal(sim.players[5].tags, 1);
  // tournament points: 5 down to 0 for least time as it, +1 for everyone but whoever is it
  sim.it = 4;
  assert.deepEqual(cupPoints(sim), { 0: 4, 1: 6, 2: 2, 3: 5, 4: 0, 5: 3 });
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  assert.deepEqual(standings(sim, names, 'potato').winners.sort(), [0, 1, 2, 3, 5]);
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

test('every arena: spawns stand on something, every surface can reach every other', () => {
  for (const arena of ARENAS) {
    arena.spawns.concat(arena.respawns).forEach(([x, y], i) => {
      const p = makeState(x, y);
      for (let t = 0; t < 20; t++) stepPlayer(p, 0, arena);
      assert.ok(p.ground && Math.abs(p.y - y) < 1 && p.dead === 0, `${arena.id} spawn ${i}`);
    });
    const nav = buildNav(arena);
    const n = nav.surfaces.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) assert.ok(nav.dist[i][j] < 1e9, `${arena.id}: surface ${i} cannot reach ${j}`);
    assert.equal(arena.portals.length % 2, 0);
    for (const po of arena.portals) assert.equal(arena.portals[po.to].to, arena.portals.indexOf(po));
  }
});

test('bots play every arena: tags keep happening, nobody gets stuck, everyone gets chased', () => {
  for (const arena of ARENAS) {
    for (const n of [2, 4, 6]) {
      let seed = 99 + n;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const sim = new Sim(arena, rnd);
      const mem = [];
      for (let i = 0; i < n; i++) {
        sim.add(i);
        mem.push(makeBot(i + 1));
      }
      sim.start();
      let tags = 0;
      let gap = 0;
      let worst = 0;
      const tagged = new Array(n).fill(0);
      for (let t = 0; t < 60 * 120; t++) {
        sim.step(mem.map((m, i) => (sim.players[i] ? botThink(sim, i, m) : 0)));
        gap++;
        for (const e of sim.events) {
          if (e.type !== 'tag') continue;
          tags++;
          tagged[e.to]++;
          worst = Math.max(worst, gap);
          gap = 0;
        }
        sim.events.length = 0;
        for (const p of sim.active()) {
          assert.ok(p.s.x >= 0 && p.s.x <= arena.w - PW && p.s.y >= 0, `${arena.id}: out of bounds`);
          assert.equal(p.s.dead, 0, `${arena.id}: a bot fell into a pit`);
        }
      }
      worst = Math.max(worst, gap);
      assert.ok(tags >= 8, `${arena.id} ${n}p: only ${tags} tags in 2 minutes`);
      assert.ok(worst < 60 * 70, `${arena.id} ${n}p: ${Math.round(worst / 60)}s without a tag`);
      assert.ok(tagged.slice(0, n).every((c) => c > 0), `${arena.id} ${n}p: tagged ${tagged.slice(0, n)}`);
    }
  }
});

console.log(`sim: ${passed} tests passed`);
