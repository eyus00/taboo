// Rules + physics checks. Run with: npm test
import assert from 'node:assert/strict';
import { PW, PH, IN_LEFT, IN_RIGHT, IN_JUMP, IMMUNE_TICKS, STUN_TICKS, RESPAWN_TICKS, H } from '../shared/config.js';
import { ARENAS, arenaById } from '../shared/arenas.js';
import { makeState, stepPlayer, copyState } from '../shared/physics.js';
import { Sim, standings } from '../shared/sim.js';
import { makeBot, botThink } from '../shared/bots.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const classic = arenaById('classic');
const floorY = 460 - PH;

test('player lands on the floor and stops', () => {
  const p = makeState(30, 300);
  for (let i = 0; i < 120; i++) stepPlayer(p, 0, classic.platforms);
  assert.equal(p.y, floorY);
  assert.equal(p.ground, true);
  assert.equal(p.vx, 0);
});

test('running is full speed immediately and stops quickly', () => {
  const p = makeState(30, floorY);
  stepPlayer(p, 0, classic.platforms);
  stepPlayer(p, IN_RIGHT, classic.platforms);
  assert.equal(p.vx, 260);
  let ticks = 0;
  while (p.vx !== 0 && ticks < 100) {
    stepPlayer(p, 0, classic.platforms);
    ticks++;
  }
  assert.ok(ticks <= 20, `stopped in ${ticks} ticks`);
});

test('jump is ~150px high, ~0.75s long and cannot be repeated in the air', () => {
  const p = makeState(400, floorY);
  stepPlayer(p, 0, classic.platforms);
  let minY = p.y;
  let air = 0;
  stepPlayer(p, IN_JUMP, classic.platforms);
  while (!p.ground && air < 200) {
    stepPlayer(p, air === 10 ? IN_JUMP : 0, classic.platforms); // second press mid-air is ignored
    minY = Math.min(minY, p.y);
    air++;
  }
  const height = floorY - minY;
  assert.ok(height > 140 && height < 165, `height ${height}`);
  assert.ok(air > 38 && air < 52, `airtime ${air} ticks`);
});

test('platforms are solid from below and from the side', () => {
  const slab = [{ x: 100, y: 300, w: 200, h: 20 }, { x: 0, y: 460, w: 800, h: 40 }];
  const p = makeState(150, floorY);
  stepPlayer(p, 0, slab);
  stepPlayer(p, IN_JUMP, slab);
  let minY = p.y;
  for (let i = 0; i < 60; i++) {
    stepPlayer(p, 0, slab);
    minY = Math.min(minY, p.y);
  }
  assert.equal(minY, 320, 'head stops at the underside');
  const w = makeState(40, 290);
  w.ground = false;
  for (let i = 0; i < 6; i++) stepPlayer(w, IN_RIGHT, slab);
  assert.ok(w.x <= 100 - PW, `blocked by the side at x=${w.x}`);
});

test('walls keep players inside the arena', () => {
  const p = makeState(5, floorY);
  for (let i = 0; i < 60; i++) stepPlayer(p, IN_LEFT, classic.platforms);
  assert.equal(p.x, 0);
});

test('falling off the bottom respawns at the top after 0.5s', () => {
  const towers = arenaById('towers');
  const p = makeState(230, 300, 2);
  let dead = 0;
  for (let i = 0; i < 400 && !(dead > 0 && p.dead === 0); i++) {
    stepPlayer(p, 0, towers.platforms);
    if (p.dead > 0) dead++;
  }
  assert.equal(dead, RESPAWN_TICKS);
  assert.equal(p.y, -PH);
  assert.equal(p.x, p.rx);
});

test('physics is deterministic (prediction can replay it exactly)', () => {
  const a = makeState(60, floorY);
  const seq = [];
  for (let i = 0; i < 600; i++) seq.push([IN_RIGHT, IN_RIGHT | IN_JUMP, IN_LEFT, 0, IN_LEFT | IN_JUMP][(i * 7 + (i >> 4)) % 5]);
  for (const b of seq.slice(0, 300)) stepPlayer(a, b, classic.platforms);
  const snap = JSON.parse(JSON.stringify(a)); // what a snapshot does to the numbers
  const b2 = copyState(snap);
  for (const b of seq.slice(300)) {
    stepPlayer(a, b, classic.platforms);
    stepPlayer(b2, b, classic.platforms);
  }
  assert.deepEqual(copyState(a), b2);
});

test('touching "it" passes the tag, with freeze and no tag-backs', () => {
  const sim = new Sim(classic);
  const a = sim.add(0);
  const b = sim.add(1);
  a.s.x = 300;
  a.s.y = floorY;
  b.s.x = 300 + PW + 40;
  b.s.y = floorY;
  sim.it = 0;
  let tagTick = -1;
  for (let i = 0; i < 60 && tagTick < 0; i++) {
    sim.step([IN_RIGHT, 0]);
    if (sim.events.some((e) => e.type === 'tag')) tagTick = i;
  }
  assert.ok(tagTick >= 0, 'tag happened');
  assert.equal(sim.it, 1);
  assert.ok(a.immune > IMMUNE_TICKS - 3);
  assert.ok(b.s.stun > STUN_TICKS - 3);
  assert.ok(b.s.x - a.s.x >= PW - 0.5, 'players are solid, not overlapping');
  // the new "it" stands right next to the old one but cannot tag back yet
  for (let i = 0; i < IMMUNE_TICKS - 5; i++) sim.step([0, IN_LEFT]);
  assert.equal(sim.it, 1);
  for (let i = 0; i < 10; i++) sim.step([0, IN_LEFT]);
  assert.equal(sim.it, 0, 'tag-back allowed once protection ends');
});

test('only the closest of two touching players is tagged', () => {
  const sim = new Sim(classic);
  const it = sim.add(0);
  const near = sim.add(1);
  const far = sim.add(2);
  it.s.x = 400;
  near.s.x = 400 + PW;
  far.s.x = 400 - PW - 1.5;
  for (const p of [it, near, far]) {
    p.s.y = floorY;
    p.s.ground = true;
  }
  sim.it = 0;
  sim.step([0, 0, 0]);
  const tags = sim.events.filter((e) => e.type === 'tag');
  assert.equal(tags.length, 1);
  assert.equal(tags[0].to, 1);
});

test('only "it" accumulates time, with no gap on handover', () => {
  const sim = new Sim(classic);
  sim.add(0);
  sim.add(1);
  sim.it = 0;
  sim.players[0].s.x = 200;
  sim.players[1].s.x = 600;
  for (let i = 0; i < 300; i++) sim.step([IN_RIGHT, IN_LEFT]);
  const total = sim.players[0].itTicks + sim.players[1].itTicks;
  assert.equal(total, 300);
  assert.ok(sim.players[1].itTicks > 0);
});

test('if "it" leaves, someone else becomes it', () => {
  const sim = new Sim(classic);
  sim.add(0);
  sim.add(1);
  sim.add(2);
  sim.it = 1;
  sim.remove(1);
  assert.ok(sim.it === 0 || sim.it === 2);
});

test('standings: lowest time wins, exact ties share', () => {
  const sim = new Sim(classic);
  sim.add(0).itTicks = 500;
  sim.add(1).itTicks = 120;
  sim.add(2).itTicks = 120;
  const { rows, winners } = standings(sim, ['A', 'B', 'C']);
  assert.deepEqual(winners, [1, 2]);
  assert.equal(rows[2].name, 'A');
});

test('every arena: spawns are on solid ground and the respawn drop lands', () => {
  for (const arena of ARENAS) {
    arena.spawns.forEach(([x, y], i) => {
      const p = makeState(x, y, i);
      for (let t = 0; t < 30; t++) stepPlayer(p, 0, arena.platforms);
      assert.ok(p.ground && Math.abs(p.y - y) < 1, `${arena.id} spawn ${i}`);
    });
    for (let slot = 0; slot < 4; slot++) {
      const p = makeState(0, 0, slot);
      p.x = p.rx;
      p.y = -PH;
      for (let t = 0; t < 200; t++) stepPlayer(p, 0, arena.platforms);
      assert.ok(p.ground && p.y < H, `${arena.id} respawn lane ${slot}`);
    }
  }
});

test('bots can play every arena without getting stuck inside anything', () => {
  for (const arena of ARENAS) {
    const sim = new Sim(arena);
    const mem = [];
    for (let i = 0; i < 4; i++) {
      sim.add(i);
      mem.push(makeBot(i + 1));
    }
    sim.it = 0;
    let tags = 0;
    for (let t = 0; t < 60 * 90; t++) {
      sim.step([0, 1, 2, 3].map((i) => botThink(sim, i, mem[i])));
      tags += sim.events.filter((e) => e.type === 'tag').length;
      sim.events.length = 0;
      for (const p of sim.players) {
        for (const q of arena.platforms) {
          const ox = Math.min(p.s.x + PW, q.x + q.w) - Math.max(p.s.x, q.x);
          const oy = Math.min(p.s.y + PH, q.y + q.h) - Math.max(p.s.y, q.y);
          assert.ok(!(ox > 0.6 && oy > 0.6), `${arena.id}: player inside a platform`);
        }
      }
    }
    assert.ok(tags > 5, `${arena.id}: ${tags} tags`);
  }
});

console.log(`sim: ${passed} tests passed`);
