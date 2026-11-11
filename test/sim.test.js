// Rules + physics checks. Run with: npm test
import assert from 'node:assert/strict';
import {
  PW, PH, IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN, IN_DASH, MOVE_SPEED, IMMUNE_TICKS, STUN_TICKS, RESPAWN_TICKS, DASH_COOLDOWN, DASH_TICKS,
  SPEED_BUFF_MUL, TOUCH, PICKUP_TYPES, PICKUP_FIRST_TICKS,
} from '../shared/config.js';
import { ARENAS, arenaById } from '../shared/arenas.js';
import { makeState, stepPlayer, packState, unpackState } from '../shared/physics.js';
import { Sim, standings } from '../shared/sim.js';
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
  id: 'box', w: 2200, h: 800, // everything interesting is on the left; the right half is open floor
  platforms: [
    { x: 0, y: 720, w: 2200, h: 80, oneway: false, ground: true }, // floor
    { x: 200, y: 560, w: 200, h: 14, oneway: true, ground: false }, // thin ledge
    { x: 600, y: 560, w: 160, h: 160, oneway: false, ground: true }, // solid block standing on the floor
  ],
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
const run = (p, bits, n) => { for (let i = 0; i < n; i++) stepPlayer(p, bits, box); };

test('lands, runs at full speed at once, stops quickly', () => {
  const p = makeState(450, 600);
  run(p, 0, 60);
  assert.equal(p.y, floorY);
  assert.ok(p.ground);
  stepPlayer(p, IN_RIGHT, box);
  assert.equal(p.vx, MOVE_SPEED);
  let ticks = 0;
  while (p.vx !== 0 && ticks++ < 100) stepPlayer(p, 0, box);
  assert.ok(ticks <= 20, `stopped in ${ticks} ticks`);
});

const jumpHeight = (script) => {
  const p = makeState(450, floorY);
  settle(p);
  let minY = p.y;
  for (let i = 0; i < 200; i++) {
    stepPlayer(p, script(i, p), box);
    minY = Math.min(minY, p.y);
    if (i > 5 && p.ground) break;
  }
  return floorY - minY;
};

test('a held jump is ~210px; tapping gives a short hop; a second press double-jumps', () => {
  const full = jumpHeight(() => IN_JUMP);
  assert.ok(full > 195 && full < 225, `full ${full}`);
  const tap = jumpHeight((i) => (i < 3 ? IN_JUMP : 0));
  assert.ok(tap < full * 0.55, `tap ${tap}`);
  const dbl = jumpHeight((i, p) => (i < 22 ? IN_JUMP : i < 24 ? 0 : IN_JUMP));
  assert.ok(dbl > full + 110, `double ${dbl}`);
  const tripleAttempt = jumpHeight((i) => (Math.floor(i / 6) % 2 ? 0 : IN_JUMP)); // mash the button
  assert.ok(tripleAttempt < dbl + 40, 'only one air jump');
});

test('thin ledges: jump up through, stand on top, hold down to drop through', () => {
  const p = makeState(280, floorY);
  settle(p);
  let landed = false;
  for (let i = 0; i < 90 && !landed; i++) {
    stepPlayer(p, IN_JUMP, box);
    landed = p.ground && p.y === 560 - PH;
  }
  assert.ok(landed, 'landed on the ledge from below');
  assert.equal(p.gk, 2);
  run(p, IN_DOWN, 30);
  assert.equal(p.y, floorY, 'dropped back to the floor');
});

test('solid blocks: bonk underneath, blocked from the side', () => {
  const side = makeState(540, floorY);
  settle(side);
  run(side, IN_RIGHT, 30);
  assert.equal(side.x, 600 - PW);
  // from inside the gap under an overhang: use a low ceiling
  const low = { ...box, platforms: [...box.platforms, { x: 400, y: 600, w: 150, h: 40, oneway: false, ground: true }] };
  const p = makeState(450, floorY);
  for (let i = 0; i < 3; i++) stepPlayer(p, 0, low);
  let minY = p.y;
  for (let i = 0; i < 40; i++) {
    stepPlayer(p, IN_JUMP, low);
    minY = Math.min(minY, p.y);
  }
  assert.equal(minY, 640, 'head stops at the underside');
});

test('walls and the ceiling keep players inside the arena', () => {
  const p = makeState(100, floorY);
  settle(p);
  run(p, IN_LEFT, 60);
  assert.ok(p.x >= 0);
  const q = makeState(934 - PW / 2, 500);
  for (let i = 0; i < 400; i++) {
    stepPlayer(q, 0, box);
    assert.ok(q.y >= 0, 'never above the top of the map');
  }
});

test('trampolines launch ~500px and pressing jump does not cancel the launch', () => {
  for (const mash of [false, true]) {
    const p = makeState(840, floorY);
    settle(p);
    let minY = p.y;
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, IN_RIGHT * (i < 12 ? 1 : 0) | (mash && i % 4 < 2 ? IN_JUMP : 0), box);
      minY = Math.min(minY, p.y);
    }
    const h = floorY - minY;
    assert.ok(h > 470, `launch ${h}px (mash=${mash})`);
  }
});

test('portals move you to the partner and do not bounce you straight back', () => {
  const p = makeState(140, floorY);
  settle(p);
  let hops = 0;
  let lastX = p.x;
  for (let i = 0; i < 60; i++) {
    stepPlayer(p, i < 30 ? IN_LEFT : 0, box);
    if (Math.abs(p.x - lastX) > 300) hops++;
    lastX = p.x;
  }
  assert.equal(hops, 1);
  assert.ok(p.x > 1000, `came out on the right at ${p.x}`);
});

test('dash is a short burst with a cooldown', () => {
  const p = makeState(450, floorY);
  settle(p);
  const x0 = p.x;
  stepPlayer(p, IN_RIGHT | IN_DASH, box);
  run(p, 0, DASH_TICKS);
  const dist = p.x - x0;
  assert.ok(dist > 100 && dist < 170, `dashed ${dist}px`);
  const cd = p.dashCd;
  assert.ok(cd > DASH_COOLDOWN - DASH_TICKS - 2);
  stepPlayer(p, 0, box);
  stepPlayer(p, IN_DASH, box); // too soon
  assert.equal(p.dashT, 0);
  run(p, 0, DASH_COOLDOWN + 2);
  stepPlayer(p, IN_DASH, box);
  assert.ok(p.dashT > 0, 'ready again');
});

test('falling into a pit brings you back at a respawn point', () => {
  const pit = { ...box, platforms: box.platforms.filter((q) => q.x !== 0).concat([{ x: 0, y: 720, w: 400, h: 80, oneway: false, ground: true }]) };
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
  const a = makeState(300, floorY);
  const seq = [];
  const combos = [IN_RIGHT, IN_RIGHT | IN_JUMP, IN_LEFT, 0, IN_LEFT | IN_JUMP, IN_RIGHT | IN_DASH, IN_DOWN, IN_JUMP];
  for (let i = 0; i < 900; i++) seq.push(combos[(i * 7 + (i >> 3)) % combos.length]);
  for (const b of seq.slice(0, 400)) stepPlayer(a, b, box, true);
  const copy = unpackState(JSON.parse(JSON.stringify(packState(a))));
  for (const b of seq.slice(400)) {
    stepPlayer(a, b, box, true);
    stepPlayer(copy, b, box, true);
  }
  assert.deepEqual(packState(a), packState(copy));
});

const duel = (gap = 80) => {
  const sim = new Sim(box);
  const a = sim.add(0);
  const b = sim.add(1);
  a.s.x = 1400;
  b.s.x = 1400 + PW + gap;
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
  for (let i = 0; i < 40; i++) sim.step([0, 0, IN_RIGHT]);
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
  sim.rewind[0] = 11;
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
  for (let i = 0; i < 3; i++) sim.step([0, IN_LEFT]);
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
    for (const n of [2, 4]) {
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
      const tagged = [0, 0, 0, 0];
      for (let t = 0; t < 60 * 120; t++) {
        sim.step([0, 1, 2, 3].map((i) => (sim.players[i] ? botThink(sim, i, mem[i]) : 0)));
        gap++;
        for (const e of sim.events) {
          if (e.type !== 'tag') continue;
          tags++;
          tagged[e.to]++;
          worst = Math.max(worst, gap);
          gap = 0;
        }
        sim.events.length = 0;
        for (const p of sim.active()) assert.ok(p.s.x >= 0 && p.s.x <= arena.w - PW && p.s.y >= 0, `${arena.id}: out of bounds`);
      }
      worst = Math.max(worst, gap);
      assert.ok(tags >= 15, `${arena.id} ${n}p: only ${tags} tags in 2 minutes`);
      assert.ok(worst < 60 * 45, `${arena.id} ${n}p: ${Math.round(worst / 60)}s without a tag`);
      assert.ok(tagged.slice(0, n).every((c) => c > 0), `${arena.id} ${n}p: tagged ${tagged.slice(0, n)}`);
    }
  }
});

console.log(`sim: ${passed} tests passed`);
