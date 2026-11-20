// End-to-end server check with scripted socket clients. Run with: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { IN_LEFT, IN_RIGHT, IN_JUMP, TICK_RATE, BEAT_TICKS, BOMB_POINTS, FLAG_END_POINTS } from '../shared/config.js';
import { STATE_LEN, stepPlayer, unpackState, packState } from '../shared/physics.js';
import * as Arenas from '../shared/arenas.js';
const { arenaById } = Arenas;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const SHORT = 6; // seconds; only the test server accepts a round this short
const BREAK = 700; // ms between tournament rounds on the test server
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), TAG_TEST_DURATION: String(SHORT), TAG_TEST_BREAK: String(BREAK), TAG_TEST_INTRO: '300', TAG_TEST_DB: 'memory', TAG_ACCOUNT_ROUNDS: '1', ADMIN_KEY: 'net-test-admin-key', PIN_SECRET: 'net-test-secret' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('running') && resolve()));

function client(name) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { socket, name, room: null, round: null, snap: null, end: null, ends: [], go: null, tags: [], picks: [], seq: 0, bits: 0, timer: null };
  socket.on('room', (r) => (c.room = r));
  socket.on('round', (r) => {
    c.round = r;
    c.end = null;
    c.go = null;
    c.seq = 0;
    c.snap = null;
  });
  socket.on('s', (s) => (c.snap = s));
  socket.on('go', (it, bombs) => {
    c.go = it;
    c.goBombs = bombs;
  });
  socket.on('tag', (from, to) => c.tags.push([from, to]));
  socket.on('pick', (slot, kind) => c.picks.push([slot, kind]));
  socket.on('end', (e) => {
    c.end = e;
    c.ends.push(e);
  });
  socket.on('q', (ack) => ack());
  c.call = (ev, msg) => new Promise((res) => socket.emit(ev, msg, res));
  c.me = () => c.room.players.find((p) => p.id === socket.id);
  c.mine = () => c.snap[4].find((p) => p[0] === c.me().slot); // [slot, x, y, vx, vy, flags, immune, itTicks, tags]
  c.play = () => {
    c.timer = setInterval(() => {
      if (c.go === null || c.end) return;
      socket.emit('in', ++c.seq, [c.bits]);
    }, 1000 / 60);
  };
  c.stop = () => clearInterval(c.timer);
  return c;
}
async function until(fn, what, ms = 8000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}

let passed = 0;
// (TAG_ONLY=friends node test/net.test.js runs just the tests with that in their name - the later ones stand on their own)
const ONLY = process.env.TAG_ONLY || '';
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const a = client('Ana');
const b = client('Ben');
const c = client('Cy');
let code;
let chase = null;

// Whoever is it runs at the other player, hopping and double-jumping over
// whatever is in the way; the other one stands still.
function startChasing(players) {
  let n = 0;
  chase = setInterval(() => {
    n++;
    for (const p of players) {
      if (!p.snap || p.end || p.go === null) continue;
      const me = p.mine();
      if (!me) continue; // (caught out of a knockout: watching)
      const other = p.snap[4].find((q) => q[0] !== me[0]);
      if (!other) continue;
      if (p.snap[2] === me[0]) p.bits = (other[1] > me[1] ? IN_RIGHT : IN_LEFT) | (n % 12 < 7 ? IN_JUMP : 0);
      else p.bits = 0;
    }
  }, 30);
}

try {
  await test('a name is required; a room gets a 4-digit code, its creator is host, sensible defaults', async () => {
    for (const name of [undefined, '', '   ', '<>']) {
      const bad = await a.call('create', { name });
      assert.ok(bad.error && bad.needName, 'no name, no room');
    }
    const res = await a.call('create', { name: '  Ana<script>  ' });
    assert.ok(res.ok);
    code = res.room.code;
    assert.match(code, /^\d{4}$/);
    assert.equal(res.room.hostId, a.socket.id);
    assert.equal(res.room.players[0].name, 'Anascript');
    const { plan, pool, items, ...rest } = res.room.settings;
    assert.deepEqual(items, [], 'every item is in the boxes');
    assert.deepEqual(rest, { game: 'quick', rounds: 5, mode: 'potato', size: 6, bots: true, arena: 'random', theme: 'random', duration: 60, score: 'rounds', powerups: true, open: false });
    assert.deepEqual(pool, { arena: [], theme: [] }, 'Random draws from everything');
    assert.equal(plan.length, 9, 'a stage for every round a tournament can have (a knockout of ten is nine rounds)');
    assert.ok(plan.every((st) => st.arena === 'random' && st.theme === 'random'));
    a.room = res.room;
  });

  await test('bots take the seats nobody has: the room has a size, a person takes a bot\'s seat, the host can send the bots away', async () => {
    // six seats: the host and five bots, each with a name and a place of its own
    const bots = () => a.room.players.filter((p) => p.bot);
    const people = () => a.room.players.filter((p) => !p.bot);
    assert.equal(a.room.players.length, 6);
    assert.equal(bots().length, 5);
    assert.equal(a.room.players[0].id, a.socket.id, 'people come first in the list');
    assert.equal(new Set(a.room.players.map((p) => p.name.toLowerCase())).size, 6, 'six different names');
    assert.equal(new Set(a.room.players.map((p) => p.slot)).size, 6, 'six different places');
    assert.ok(bots().every((p) => p.slot > a.me().slot), 'people hold the lowest places');
    // the size is the host's to set, between 2 and 10; nonsense is ignored
    a.socket.emit('settings', { size: 3 });
    await until(() => a.room.settings.size === 3 && a.room.players.length === 3, 'three seats');
    for (const size of [1, 0, -4, 2.5, '4', null]) a.socket.emit('settings', { size });
    a.socket.emit('settings', { size: 99 });
    await until(() => a.room.settings.size === 10, 'the size is kept within 2 to 10');
    assert.equal(a.room.players.length, 10);
    // the two sides stay even whatever happens to the seats: a bot stands where a side is short, and the one that leaves comes from the side that has more
    const even = () => [0, 1].map((t) => a.room.players.filter((p) => p.side === t).length);
    assert.deepEqual(even(), [5, 5]);
    const g = client('Gus');
    assert.ok((await g.call('join', { code, name: 'Gus' })).ok);
    await until(() => people().length === 2 && a.room.players.length === 10, 'someone walks into a full room of bots');
    assert.deepEqual(even(), [5, 5], 'a bot of the side the newcomer joined made way');
    for (const size of [9, 7, 4, 8]) {
      a.socket.emit('settings', { size });
      await until(() => a.room.players.length === size, `${size} seats`);
      assert.ok(Math.abs(even()[0] - even()[1]) <= 1, `${size} seats: ${even().join(' v ')}`);
    }
    g.socket.disconnect();
    await until(() => people().length === 1 && a.room.players.length === 8, 'and leaves again: a bot is back in the seat');
    assert.deepEqual(even(), [4, 4]);
    a.socket.emit('settings', { size: 1 });
    await until(() => a.room.settings.size === 2 && a.room.players.length === 2, 'two at the least');
    a.socket.emit('settings', { size: 3 });
    await until(() => a.room.players.length === 3, 'three seats again');
    const names = bots().map((p) => p.name);
    // a person takes a bot's seat (the newest bot goes); a full room takes nobody else
    const d = client(names[0]); // ...and has the name one of the bots was using
    const e = client('Eli');
    const f = client('Fay');
    d.socket.on('room', (r) => (d.room = r));
    const dIn = await d.call('join', { code, name: names[0] });
    assert.ok(dIn.ok);
    await until(() => people().length === 2 && bots().length === 1, 'two people and a bot');
    assert.equal(new Set(a.room.players.map((p) => p.name.toLowerCase())).size, 3, 'the bot that had that name took another');
    assert.equal(a.room.players.find((p) => p.id === d.socket.id).name, names[0], 'the person keeps theirs');
    d.socket.emit('settings', { size: 8, bots: false });
    await sleep(120);
    assert.deepEqual([a.room.settings.size, a.room.settings.bots], [3, true], 'a guest changes neither');
    assert.ok((await e.call('join', { code, name: 'Eli' })).ok);
    await until(() => people().length === 3 && bots().length === 0, 'three people, no bot');
    assert.match((await f.call('join', { code, name: 'Fay' })).error, /full \(3 players\)/);
    // the host cannot take away a seat somebody is sitting in
    a.socket.emit('settings', { size: 2 });
    await sleep(120);
    assert.equal(a.room.settings.size, 3, 'never fewer seats than people');
    // someone leaves: a bot is back in the seat
    e.socket.emit('leave');
    await until(() => people().length === 2 && bots().length === 1, 'a bot is back');
    // no bots, thank you
    a.socket.emit('settings', { bots: false });
    await until(() => a.room.settings.bots === false && a.room.players.length === 2, 'the bots are gone');
    a.socket.emit('settings', { size: 5 });
    await until(() => a.room.settings.size === 5, 'five seats');
    assert.equal(a.room.players.length, 2, 'and the empty ones stay empty');
    // a team game: the bots stand wherever the sides are short
    a.socket.emit('settings', { bots: true, mode: 'team' });
    await until(() => a.room.players.length === 5, 'five again');
    const sides = () => [0, 1].map((t) => a.room.players.filter((p) => p.side === t).length).sort();
    assert.deepEqual(sides(), [2, 3]);
    const mine = a.me().side;
    a.socket.emit('side', 1 - mine);
    await until(() => a.me().side === 1 - mine, 'the host crossed over');
    assert.deepEqual(sides(), [2, 3], 'the bots made room');
    // the host can move a bot across by hand; a guest cannot
    const bot = bots()[0];
    d.socket.emit('side', 1 - bot.side, bot.id);
    await sleep(120);
    assert.equal(a.room.players.find((p) => p.id === bot.id).side, bot.side, 'a guest moves no bot');
    a.socket.emit('side', 1 - bot.side, bot.id);
    await until(() => a.room.players.find((p) => p.id === bot.id).side === 1 - bot.side, 'the host moved a bot');
    // shuffling deals everyone out afresh, the bots too: never the same sides again, and as even as five can be
    for (let i = 0; i < 4; i++) {
      const was = a.room.players.map((p) => `${p.id}:${p.side}`).join();
      a.socket.emit('shuffle');
      await until(() => a.room.players.map((p) => `${p.id}:${p.side}`).join() !== was, 'a different deal');
      assert.deepEqual(sides(), [2, 3]);
    }
    // seat by seat: the host takes one bot out (its seat stays open), puts one in, sends a person out
    a.socket.emit('settings', { mode: 'potato' });
    await until(() => a.room.settings.mode === 'potato', 'free-for-all again');
    const out = bots()[1];
    d.socket.emit('bot', { remove: out.id });
    await sleep(120);
    assert.equal(a.room.players.length, 5, 'a guest takes no bot out');
    a.socket.emit('bot', { remove: out.id });
    await until(() => a.room.players.length === 4, 'one bot out');
    assert.ok(!a.room.players.some((p) => p.id === out.id), 'that one');
    assert.deepEqual([a.room.settings.size, a.room.settings.bots], [5, false], 'its seat stays open: bots no longer fill by themselves');
    a.socket.emit('bot', { remove: 'bot-0' });
    a.socket.emit('bot', { add: 7 });
    await sleep(120);
    assert.equal(a.room.players.length, 4, 'nonsense changes nothing');
    a.socket.emit('bot', { add: true });
    await until(() => a.room.players.length === 5, 'a bot in the open seat');
    a.socket.emit('bot', { add: true });
    await sleep(120);
    assert.equal(a.room.players.length, 5, 'no seat, no bot');
    let gone = false;
    d.socket.on('kicked', () => (gone = true));
    d.socket.emit('kick', a.socket.id);
    a.socket.emit('kick', a.socket.id);
    a.socket.emit('kick', 'nobody');
    await sleep(120);
    assert.equal(people().length, 2, 'a guest sends nobody out, and the host cannot send themselves');
    a.socket.emit('kick', d.socket.id);
    await until(() => gone && people().length === 1, 'the host sent the guest out');
    assert.equal(a.room.players.length, 4, 'their seat is open');
    a.socket.emit('settings', { bots: true });
    await until(() => a.room.players.length === 5, 'bots in every open seat again');
    for (const x of [d, e, f]) x.socket.close();
    await until(() => people().length === 1, 'alone again');
    a.socket.emit('settings', { mode: 'potato', size: 6, bots: false });
    await until(() => a.room.players.length === 1 && a.room.settings.mode === 'potato', 'as it was, without the bots');
  });

  await test('joining: a bad code or a missing name is rejected; a taken name gets a number', async () => {
    const wrong = code === '0000' ? '0001' : '0000';
    assert.ok((await b.call('join', { code: wrong, name: 'Ben' })).error);
    assert.ok((await b.call('join', { code: '12', name: 'Ben' })).error);
    assert.ok((await b.call('join', { code, name: ' ' })).needName);
    const res = await b.call('join', { code: ` ${code.slice(0, 2)} ${code.slice(2)} `, name: 'anascript' });
    assert.ok(res.ok);
    b.room = res.room;
    await until(() => a.room.players.length === 2, 'host sees the joiner');
    assert.equal(b.me().slot, 1);
    assert.equal(b.me().name, 'anascript 2');
  });

  await test('only the host can change settings or start; bad values are ignored', async () => {
    b.socket.emit('start');
    b.socket.emit('settings', { arena: 'hills' });
    a.socket.emit('settings', { arena: 'dojo', theme: 'shadow', mode: 'time', duration: 90, powerups: false, rounds: 3 });
    await until(() => b.room.settings.arena === 'dojo' && b.room.settings.mode === 'time', 'settings');
    a.socket.emit('settings', { arena: 'nope', theme: 'nope', mode: 'nope', duration: 5, powerups: 'yes', game: 'nope', rounds: 4, bots: 'yes', size: 'six' });
    await sleep(150);
    const { plan, pool, items, ...rest } = b.room.settings;
    assert.deepEqual(rest, { game: 'quick', rounds: 3, mode: 'time', size: 6, bots: false, arena: 'dojo', theme: 'shadow', duration: 90, score: 'rounds', powerups: false, open: false });
    assert.ok(plan.every((st) => st.arena === 'dojo' && st.theme === 'shadow'), 'an arena or a style set like this goes for every round');
    // one round of a tournament can have its own; junk is ignored
    a.socket.emit('settings', { stage: { i: 2, arena: 'hills', theme: 'neon' } });
    await until(() => b.room.settings.plan[2].arena === 'hills', 'round 3 planned');
    assert.deepEqual(b.room.settings.plan[2], { arena: 'hills', theme: 'neon' });
    assert.deepEqual(b.room.settings.plan[1], { arena: 'dojo', theme: 'shadow' });
    a.socket.emit('settings', { stage: { i: 99, arena: 'hills' } });
    a.socket.emit('settings', { stage: { i: 1, arena: 'nowhere', theme: 'random' } });
    await until(() => b.room.settings.plan[1].theme === 'random', 'round 2 left to the draw');
    assert.equal(b.room.settings.plan[1].arena, 'dojo');
    assert.equal(b.room.settings.arena, 'dojo', 'arena and theme still say what round 1 is played on');
    a.socket.emit('settings', { arena: 'dojo', theme: 'shadow' });
    await until(() => b.room.settings.plan.every((st) => st.arena === 'dojo' && st.theme === 'shadow'), 'back to one stage for all');
    // which items are in the lucky boxes: a list of kinds, in the game's own order (junk is dropped; all of them is "everything")
    a.socket.emit('settings', { items: ['ghost', 'dash', 'nonsense', 'dash'] });
    await until(() => b.room.settings.items.length === 2, 'the item pool');
    assert.deepEqual(b.room.settings.items, ['dash', 'ghost']);
    b.socket.emit('settings', { items: ['star'] });
    a.socket.emit('settings', { items: 'all' });
    await sleep(150);
    assert.deepEqual(b.room.settings.items, ['dash', 'ghost'], 'only the host chooses, and only with a list');
    a.socket.emit('settings', { items: [] });
    await until(() => b.room.settings.items.length === 0, 'back to every item');
    assert.equal(a.room.phase, 'lobby');
  });

  await test('start: countdown, then GO with exactly one "it"', async () => {
    a.socket.emit('settings', { mode: 'potato', duration: SHORT, powerups: true });
    await until(() => a.room.settings.duration === SHORT, 'short round accepted');
    a.socket.emit('start');
    await until(() => a.round && b.round, 'round info');
    assert.equal(a.round.arena, 'dojo');
    assert.equal(a.round.mode, 'potato');
    assert.equal(a.round.players.length, 2);
    await until(() => a.snap && a.snap[1] === 0, 'countdown snapshot');
    assert.ok(Array.isArray(a.snap[6]) && a.snap[6].length === STATE_LEN + 1, 'each player gets their own full state');
    assert.equal(a.round.twist, 'none');
    assert.equal(a.round.cup, null);
    await until(() => a.go !== null && b.go !== null, 'go', 6000);
    assert.ok(a.go === 0 || a.go === 1);
    assert.equal(a.go, b.go);
  });

  await test('late joiner spectates the round in progress', async () => {
    const res = await c.call('join', { code, name: 'Cy' });
    assert.ok(res.ok);
    c.room = res.room;
    await until(() => c.round && c.snap, 'spectator gets round + snapshots');
    assert.equal(c.me().playing, false);
    assert.equal(c.snap[6], 0, 'no private state for spectators');
  });

  await test('inputs move the player and are acknowledged in order', async () => {
    a.play();
    b.play();
    await until(() => a.snap && a.snap[1] === 1, 'playing snapshot');
    const x0 = a.mine()[1];
    a.bits = x0 < 800 ? IN_RIGHT : IN_LEFT;
    await sleep(350);
    assert.ok(Math.abs(a.mine()[1] - x0) > 60, `moved ${a.mine()[1] - x0}px`);
    const ack = a.snap[6][0];
    assert.ok(ack > 10 && ack <= a.seq, `ack ${ack} of ${a.seq}`);
    a.bits = 0;
  });

  await test('exactly one physics step per input, however unevenly inputs arrive (so prediction is never corrected)', async () => {
    a.stop(); // take over a's inputs by hand
    await until(() => a.snap[6][0] === a.seq, 'everything sent so far is applied');
    await sleep(60);
    const arena = arenaById(a.round.arena);
    const slot = a.me().slot;
    const it = a.snap[2];
    const local = unpackState(a.snap[6].slice(1)); // predict from here, like a browser does
    const expected = new Map([[a.seq, packState(local)]]);
    const send = (list) => {
      a.socket.emit('in', a.seq + 1, list);
      for (const bits of list) {
        stepPlayer(local, bits, arena, it === slot);
        expected.set(++a.seq, packState(local));
      }
    };
    let checked = 0;
    const check = (m) => {
      if (m[2] !== it) return; // a tag changes running speed: not what this test is about
      const want = expected.get(m[6][0]);
      if (!want) return;
      assert.deepEqual(m[6].slice(1), want, `server and prediction disagree after input ${m[6][0]}`);
      checked++;
    };
    a.socket.on('s', check);
    // bursts and gaps, as on a jittery connection (gaps stay under the 200 ms "gone quiet" limit)
    const J = IN_JUMP;
    const L = IN_LEFT;
    const R = IN_RIGHT;
    for (const [gap, list] of [[0, [R, R, R]], [90, [R | J, R | J, R, R, R]], [20, [0]], [150, [L, L, L, L | J, L, L]], [40, [L, 0]], [110, [R, R, J, J, 0, 0]], [16, [0]], [16, [R]], [130, [L, L, L, L, L, L]]]) {
      await sleep(gap);
      send(list);
    }
    await until(() => a.snap[6][0] === a.seq, 'all bursts applied');
    await sleep(80);
    a.socket.off('s', check);
    assert.ok(checked >= 5, `compared ${checked} snapshots`);
    a.play();
  });

  await test('hot potato: whoever is it when the clock runs out loses, the other wins', async () => {
    startChasing([a, b]);
    await until(() => a.end && b.end && c.end, 'round end', (SHORT + 4) * 1000);
    clearInterval(chase);
    assert.equal(a.end.reason, 'time');
    assert.equal(a.end.mode, 'potato');
    assert.ok(a.end.loser === 0 || a.end.loser === 1);
    assert.deepEqual(a.end.winners, [1 - a.end.loser]);
    assert.equal(a.end.rows[a.end.rows.length - 1].slot, a.end.loser, 'loser listed last');
    const total = a.end.rows.reduce((t, r) => t + r.ms, 0);
    assert.ok(Math.abs(total - SHORT * 1000) < 40, `it-time adds up to the round: ${total}ms`);
    await until(() => a.room.phase === 'results', 'results phase');
    const winner = a.room.players.find((p) => p.slot === a.end.winners[0]);
    assert.equal(winner.wins, 1, 'the win is counted');
  });

  await test('least-time mode with the former spectator: tags happen, lowest time wins', async () => {
    a.socket.emit('lobby');
    await until(() => a.room.phase === 'lobby', 'back to lobby');
    a.socket.emit('settings', { mode: 'time', arena: 'hills' });
    await until(() => a.room.settings.mode === 'time' && a.room.settings.arena === 'hills', 'time mode');
    for (const p of [a, b, c]) p.tags.length = 0;
    a.socket.emit('start');
    await until(() => a.round && a.round.players.length === 3 && a.go === null, 'new round with 3');
    assert.ok(a.round.players.some((p) => p.name === 'Cy'));
    await until(() => a.go !== null && c.go !== null, 'go', 6000);
    c.play();
    await until(() => a.snap && a.snap[1] === 1, 'playing');
    assert.ok(a.snap[3] > (SHORT - 1) * TICK_RATE && a.snap[3] <= SHORT * TICK_RATE, `fresh clock: ${a.snap[3]} ticks`);
    startChasing([a, b, c]);
    await until(() => a.end, 'round end', (SHORT + 4) * 1000);
    clearInterval(chase);
    assert.equal(a.end.mode, 'time');
    assert.equal(a.end.loser, -1);
    const best = Math.min(...a.end.rows.map((r) => r.ms));
    assert.deepEqual(a.end.winners.slice().sort(), a.end.rows.filter((r) => r.ms === best).map((r) => r.slot).sort());
    assert.equal(a.end.rows.reduce((t, r) => t + r.tags, 0), a.tags.length, 'every tag is credited to someone');
  });

  await test('knockout tournament: every round the oni at the buzzer is out, the rest play on, the last one standing wins', async () => {
    a.socket.emit('lobby');
    await until(() => a.room.phase === 'lobby', 'back to lobby');
    a.socket.emit('settings', { game: 'cup', rounds: 3, arena: 'random' });
    await until(() => a.room.settings.game === 'cup' && a.room.settings.arena === 'random', 'cup settings');
    assert.equal(a.room.settings.mode, 'team', 'a tournament is played in teams unless the host chooses otherwise');
    a.socket.emit('settings', { mode: 'potato' }); // this test is about the knockout
    await until(() => a.room.settings.mode === 'potato', 'knockout');
    for (const p of [a, b, c]) p.ends.length = 0;
    const winsBefore = new Map(a.room.players.map((p) => [p.slot, p.wins]));
    const slotOf = (x) => x.me().slot;
    a.socket.emit('start');
    startChasing([a, b, c]);
    const arenas = [];
    const gone = [];
    for (let round = 1; round <= 2; round++) {
      await until(() => a.round && a.round.cup && a.round.cup.round === round && a.go !== null, `round ${round} go`, 9000);
      arenas.push(a.round.arena);
      const cup = a.round.cup;
      assert.deepEqual([cup.ko, cup.rounds, cup.left, cup.double], [true, 2, 4 - round, false], 'three players: two rounds, one fewer each time, nothing counts double');
      assert.equal(a.round.twist, 'none', 'two rounds: no room for a twist');
      assert.equal(a.round.players.length, 4 - round, 'only those still in it play');
      assert.ok(gone.every((slot) => !a.round.players.some((p) => p.slot === slot)), 'whoever went out is not in the round');
      assert.ok(a.round.players.some((p) => p.slot === a.round.it), 'one of those still in starts as it');
      assert.deepEqual(a.room.players.filter((p) => p.out).map((p) => p.slot), gone, 'and the room says who is out');
      if (round === 2) {
        // nothing can be changed or restarted in the middle of a tournament
        a.socket.emit('settings', { game: 'quick', arena: 'dojo' });
        a.socket.emit('start');
        await sleep(100);
        assert.equal(a.room.settings.game, 'cup');
        assert.deepEqual([a.room.cup.round, a.room.cup.ko], [2, true]);
      }
      await until(() => a.ends.length === round && b.ends.length === round && c.ends.length === round, `round ${round} end (also for whoever is watching)`, (SHORT + 4) * 1000);
      const e = a.end;
      assert.equal(e.mode, 'cup');
      assert.deepEqual([e.cup.round, e.cup.ko, e.cup.final], [round, true, round === 2]);
      assert.equal(e.rows.length, 4 - round);
      assert.ok(e.loser >= 0 && e.cup.caught === e.loser, 'whoever is the oni at the buzzer is caught out');
      gone.push(e.loser);
      // the table: those still in first, then the ones who went out - the last to go first
      assert.deepEqual(e.cup.table.filter((r) => r.out).map((r) => [r.slot, r.out]), gone.map((slot, i) => [slot, i + 1]).reverse());
      assert.equal(e.cup.table.filter((r) => !r.out).length, 3 - round);
      assert.equal(e.cup.table.length, 3, 'everyone who started is on it');
    }
    clearInterval(chase);
    assert.equal(new Set(arenas).size, 2, `a different arena every round: ${arenas}`);
    const champ = a.end.cup.table[0];
    assert.deepEqual(a.end.winners, [champ.slot], 'one winner: the last one standing');
    assert.ok(!gone.includes(champ.slot) && [a, b, c].map(slotOf).includes(champ.slot));
    await until(() => a.room.phase === 'results' && a.room.cup === null, 'tournament over');
    assert.equal(a.room.players.find((p) => p.slot === champ.slot).wins, winsBefore.get(champ.slot) + 1, 'the tournament counts as a win');
    assert.ok(a.room.players.every((p) => !p.out), 'and everyone is back in for the next one');
    await sleep(BREAK + 400);
    assert.equal(a.room.phase, 'results', 'no third round');
  });

  await test('team battle: sides belong to the room and can be changed in the lobby; a bot fills the short side; bombs, flags and a team result', async () => {
    a.socket.emit('lobby');
    await until(() => a.room.phase === 'lobby', 'back to lobby');
    a.socket.emit('settings', { game: 'quick', mode: 'team', arena: 'dojo', duration: SHORT });
    await until(() => a.room.settings.mode === 'team' && a.room.settings.game === 'quick', 'team settings');
    // everyone has a side from the moment they come in; three players are two and one
    const sideOf = (x) => a.room.players.find((p) => p.id === x.socket.id).side;
    const count = () => [0, 1].map((t) => [a, b, c].filter((x) => sideOf(x) === t).length);
    assert.deepEqual(count().sort(), [1, 2], 'newcomers joined the smaller side');
    // anyone can change their own side in the lobby (and nobody else's); nonsense is ignored
    const was = sideOf(c);
    c.socket.emit('side', 1 - was);
    await until(() => sideOf(c) === 1 - was, 'c changed sides');
    c.socket.emit('side', 7);
    c.socket.emit('side', was);
    await until(() => sideOf(c) === was, 'c went back');
    // the host can move someone else across; a guest cannot
    const bWas = sideOf(b);
    c.socket.emit('side', 1 - bWas, b.socket.id);
    await sleep(120);
    assert.equal(sideOf(b), bWas, 'a guest cannot move anybody but themselves');
    a.socket.emit('side', 1 - bWas, b.socket.id);
    await until(() => sideOf(b) === 1 - bWas, 'the host moved b');
    a.socket.emit('side', bWas, b.socket.id);
    await until(() => sideOf(b) === bWas, 'and back');
    // only the host can shuffle
    const before = [a, b, c].map(sideOf).join();
    b.socket.emit('shuffle');
    await sleep(120);
    assert.equal([a, b, c].map(sideOf).join(), before, 'a guest cannot shuffle the teams');
    a.socket.emit('shuffle');
    await sleep(150);
    assert.deepEqual(count().sort(), [1, 2], 'shuffled: still as even as three can be');
    const sides0 = [a, b, c].map(sideOf);
    // four seats: a bot takes the fourth, on the side that is short
    a.socket.emit('settings', { size: 4, bots: true });
    await until(() => a.room.players.length === 4, 'a bot in the fourth seat');
    const lobbyBot = a.room.players.find((p) => p.bot);
    assert.equal(lobbyBot.side, count()[0] < count()[1] ? 0 : 1, 'it stands where the sides are short');

    for (const p of [a, b, c]) p.ends.length = 0;
    a.socket.emit('start');
    await until(() => a.round && a.round.mode === 'team' && a.go === null && a.round.teams, 'team round info');
    // the round has the sides exactly as the room had them, the bot included
    const roster = a.round.players;
    assert.equal(roster.length, 4, 'three players and a bot');
    const bots = roster.filter((p) => p.bot);
    assert.equal(bots.length, 1);
    const bot = bots[0];
    assert.deepEqual([bot.slot, bot.name], [lobbyBot.slot, lobbyBot.name], 'the bot from the room');
    assert.ok(bot.name && !['Anascript', 'Ben', 'Cy'].includes(bot.name), `the bot has a name of its own (${bot.name})`);
    [a, b, c].forEach((x, i) => assert.equal(a.round.teams[x.me().slot], sides0[i], 'everyone is on the side they had in the lobby'));
    const slots = roster.map((p) => p.slot);
    const teams = [0, 1].map((t) => slots.filter((sl) => a.round.teams[sl] === t));
    assert.deepEqual(teams.map((x) => x.length), [2, 2], 'two against two');
    const short = count()[0] < count()[1] ? 0 : 1;
    assert.equal(a.round.teams[bot.slot], short, 'the bot is on the side that was short');
    assert.ok(![a, b, c].some((x) => x.me().slot === bot.slot), 'in a place of its own');
    for (const sl of slots) {
      const warm = [0, 3, 5, 6, 8].includes(a.round.cols[sl]);
      assert.equal(warm, a.round.teams[sl] === 0, 'one side wears warm colours, the other cool ones');
    }
    assert.equal(a.round.it, -1, 'nobody is "it" in a team battle');
    assert.equal(a.round.bombs.length, 2, 'four players: two bombs');
    assert.ok(a.round.bombs.every((sl) => slots.includes(sl)), 'who starts with them is known before GO');
    await until(() => a.go !== null && c.go !== null, 'go', 9000);
    assert.equal(a.go, -1);
    assert.deepEqual(a.goBombs.slice().sort(), a.round.bombs.slice().sort(), 'and they go out as drawn');
    await until(() => a.snap && a.snap[1] === 1 && a.snap[8], 'team snapshot');
    assert.equal(a.snap[8].length, 10, 'scores, who carries a bomb, whether it is over, and fill + owner of the three flags');
    const bits = (m) => m.toString(2).replace(/0/g, '').length;
    assert.equal(bits(a.snap[8][2]), 2, 'two players carry a bomb');
    assert.equal(a.snap[8][3], 0);
    assert.deepEqual(a.snap[8].slice(4), [0, -1, 0, -1, 0, -1], 'the flags start as nobody\'s');
    assert.ok(Array.isArray(a.snap[5]) && Array.isArray(a.snap[7]), 'boxes and puddles are lists');
    assert.equal(a.snap[4].length, 4, 'the bot is in the snapshot like anyone else');
    assert.equal(a.snap[4][0].length, 10, 'every player entry says what item they hold');
    // the bot plays: it does not stand where it started
    const botAt = () => a.snap[4].find((p) => p[0] === bot.slot);
    const [x0, y0] = [botAt()[1], botAt()[2]];
    startChasing([a, b, c]);
    await until(() => Math.hypot(botAt()[1] - x0, botAt()[2] - y0) > 120, 'the bot to get going', 5000);
    await until(() => a.ends.length === 1, 'round end', (SHORT + 5) * 1000);
    clearInterval(chase);
    const e = a.end;
    assert.equal(e.mode, 'team');
    assert.equal(e.team.score.length, 2);
    assert.equal(e.rows.length, 4);
    assert.deepEqual(e.rows.filter((r) => r.bot).map((r) => [r.slot, r.name]), [[bot.slot, bot.name]], 'the bot is on the scoreboard, marked as one');
    // the bombs went off on whoever held them when the clock stopped; a score is never below nothing, and three flags can only pay so much
    const blown = e.rows.filter((r) => r.boom);
    assert.equal(blown.length, 2, 'two bombs, two explosions');
    for (const t of [0, 1]) assert.ok(e.team.score[t] >= BOMB_POINTS * blown.filter((r) => r.team === 1 - t).length && e.team.score[t] <= 3 * (FLAG_END_POINTS + Math.ceil((SHORT * TICK_RATE) / BEAT_TICKS)) + 2 * BOMB_POINTS, `score ${e.team.score}`);
    assert.ok(e.rows.every((r) => typeof r.caps === 'number'));
    const win = e.team.score[0] === e.team.score[1] ? -1 : e.team.score[0] > e.team.score[1] ? 0 : 1;
    assert.equal(e.team.win, win);
    assert.deepEqual(e.winners.slice().sort(), e.rows.filter((r) => win < 0 || r.team === win).map((r) => r.slot).sort());
    assert.deepEqual(a.room.players.filter((p) => p.bot).map((p) => p.slot), [bot.slot], 'and still in its seat afterwards');
  });

  await test('the sides stay as they are: from one match to the next, and from round to round of a tournament', async () => {
    const sideOf = (x) => a.room.players.find((p) => p.id === x.socket.id).side;
    const sides0 = [a, b, c].map(sideOf);
    const teamsNow = () => [a, b, c].map((x) => a.round.teams[x.me().slot]);
    // another quick match: the same sides
    a.round = null;
    a.socket.emit('start');
    await until(() => a.round && a.round.teams, 'second match');
    assert.deepEqual(teamsNow(), sides0, 'play again: nobody changed sides');
    // nobody can change sides while a match is on
    c.socket.emit('side', 1 - sideOf(c));
    a.socket.emit('shuffle');
    await sleep(150);
    assert.deepEqual([a, b, c].map(sideOf), sides0, 'the sides are locked during a match');
    await until(() => a.ends.length === 2, 'second match over', (SHORT + 12) * 1000);
    // a tournament: round after round, the same sides
    a.socket.emit('lobby');
    await until(() => a.room.phase === 'lobby', 'lobby');
    a.socket.emit('settings', { game: 'cup', mode: 'team', rounds: 3 });
    await until(() => a.room.settings.game === 'cup' && a.room.settings.mode === 'team', 'tournament settings');
    // each round of a tournament has its own arena and style
    a.socket.emit('settings', { stage: { i: 0, arena: 'hills', theme: 'shadow' } });
    a.socket.emit('settings', { stage: { i: 1, arena: 'canyon', theme: 'random' } });
    await until(() => a.room.settings.plan[1].arena === 'canyon', 'stages planned');
    a.round = null;
    a.socket.emit('start');
    await until(() => a.round && a.round.cup && a.round.cup.round === 1, 'round 1');
    assert.deepEqual([a.round.arena, a.round.theme, a.round.random], ['hills', 'shadow', { arena: false, theme: false }], 'round 1 is played where the plan says');
    assert.deepEqual(teamsNow(), sides0, 'round 1');
    const cols1 = a.round.cols.slice();
    c.socket.emit('side', 1 - sideOf(c));
    await until(() => a.round.cup.round === 2, 'round 2', (SHORT + 14) * 1000);
    assert.deepEqual(teamsNow(), sides0, 'round 2: the same sides (and nobody could switch in between)');
    assert.equal(a.round.arena, 'canyon', 'round 2: its own arena');
    assert.deepEqual(a.round.random, { arena: false, theme: true }, 'and a style left to the draw');
    assert.deepEqual(a.round.cols, cols1, 'and the same colours');
    assert.equal(a.round.players.filter((p) => p.bot).length, 1, 'the bot plays every round');
    // the host ends the tournament between rounds
    await until(() => a.ends.length === 4, 'round 2 over', (SHORT + 12) * 1000);
    // a team tournament counts rounds won unless the host says otherwise: one for whoever took the round, nothing for a draw
    const won = [0, 0];
    for (const e of a.ends.slice(2)) {
      assert.ok(e.cup && !e.cup.final && !e.cup.double && e.cup.score === 'rounds', 'not the last round: worth one');
      if (e.team.win >= 0) won[e.team.win]++;
      assert.deepEqual(e.team.total, won, `after round ${e.cup.round}: ${e.team.total} (this round ${e.team.score}, to ${e.team.win})`);
    }
    a.socket.emit('lobby');
    await until(() => a.room.phase === 'lobby' && !a.room.cup, 'tournament ended');
    assert.deepEqual([a, b, c].map(sideOf), sides0);
  });

  await test('a player leaving a 2-player match ends it; whoever stayed wins', async () => {
    c.stop();
    c.socket.close();
    await until(() => a.room.players.filter((p) => !p.bot).length === 2, 'c gone');
    assert.equal(a.room.players.length, 4, 'a second bot in the seat c left');
    a.socket.emit('lobby');
    a.socket.emit('settings', { game: 'quick', bots: false });
    await until(() => a.room.phase === 'lobby' && a.room.settings.game === 'quick' && a.room.players.length === 2, 'quick match again, the two of them');
    a.socket.emit('start');
    await until(() => a.round && a.round.players.length === 2 && a.go === null, 'round');
    await until(() => a.go !== null, 'go', 6000);
    b.stop();
    b.socket.emit('leave');
    await until(() => a.end && a.end.reason === 'forfeit', 'forfeit');
    assert.deepEqual(a.end.winners, [a.me().slot]);
    assert.equal(a.end.loser, -1);
  });

  await test('alone with the bots: a match starts and is played to the end; the stage suits the number of players', async () => {
    a.socket.emit('lobby');
    a.socket.emit('settings', { mode: 'potato', size: 3, bots: true, duration: SHORT });
    await until(() => a.room.phase === 'lobby' && a.room.players.length === 3 && a.room.settings.mode === 'potato', 'one person, two bots');
    // a stage is built for a crowd of a certain size: a small one is shut to a big room, and the other way round
    const small = Arenas.ARENAS.find((x) => x.players[1] < 8).id;
    const big = Arenas.ARENAS.find((x) => x.players[0] > 3 && x.players[1] >= 8).id;
    a.socket.emit('settings', { arena: small });
    await until(() => a.room.settings.arena === small, 'a small stage for three');
    a.socket.emit('settings', { arena: big });
    await sleep(150);
    assert.equal(a.room.settings.arena, 'random', 'a big stage is not for three: left to the draw');
    // Random draws from what the host left in the draw: one stage and one style here, so there is nothing to draw
    const smalls = Arenas.ARENAS.filter((x) => x.players[1] < 8).map((x) => x.id);
    a.socket.emit('settings', { arena: 'random', theme: 'random', pool: { arena: [smalls[1], 'nowhere'], theme: ['neon'] } });
    await until(() => a.room.settings.pool.theme.length === 1, 'the draw narrowed');
    assert.deepEqual(a.room.settings.pool, { arena: [smalls[1]], theme: ['neon'] }, 'only what exists is kept');
    a.socket.emit('settings', { pool: { arena: 'all', theme: 7 } });
    await sleep(120);
    assert.deepEqual(a.room.settings.pool, { arena: [smalls[1]], theme: ['neon'] }, 'nonsense is ignored');
    for (const n of [3, 8]) {
      if (n === 8) {
        a.socket.emit('settings', { arena: small });
        await until(() => a.room.settings.arena === small, 'the small stage, chosen');
        a.socket.emit('settings', { size: 8 });
        await until(() => a.room.players.length === 8, 'eight seats');
        assert.ok(a.room.settings.plan.every((st) => st.arena === 'random'), 'eight players: the small stage went back to the draw');
        a.socket.emit('settings', { arena: small });
        await sleep(150);
        assert.equal(a.room.settings.arena, 'random', 'and cannot be chosen');
      }
      a.round = null;
      a.socket.emit('start');
      await until(() => a.round && a.go === null, 'round');
      assert.equal(a.round.players.length, n);
      assert.equal(a.round.players.filter((p) => p.bot).length, n - 1);
      assert.ok(a.round.players.some((p) => p.slot === a.round.it), 'one of them starts as it');
      assert.deepEqual([a.round.theme, a.round.random], ['neon', { arena: true, theme: true }], 'the style is drawn from the one that is left');
      if (n === 3) assert.equal(a.round.arena, smalls[1], 'three play on the one stage left in the draw');
      else assert.ok(Arenas.arenaFits(a.round.arena, 8), `eight play on a stage for eight, whatever the draw was narrowed to (${a.round.arena})`);
      await until(() => a.end && a.end.reason === 'time', 'played to the end', (SHORT + 12) * 1000);
      assert.equal(a.end.rows.length, n);
      assert.equal(a.end.rows.filter((r) => r.bot).length, n - 1, 'the bots are on the board, marked as bots');
      a.socket.emit('lobby');
      await until(() => a.room.phase === 'lobby', 'lobby');
    }
    a.socket.emit('settings', { bots: false, pool: { arena: [], theme: [] } });
    await until(() => a.room.players.length === 1 && !a.room.settings.pool.theme.length, 'the bots are gone, the draw is whole again');
    a.socket.emit('start');
    await sleep(150);
    assert.equal(a.room.phase, 'lobby', 'nobody to play against: no match');
  });

  await test('room is full at 10 players; host leaving hands the room over', async () => {
    const extra = ['Di', 'Eve', 'Flo', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu', 'Max'].map((n) => client(n));
    a.socket.emit('settings', { size: 10 });
    await until(() => a.room.settings.size === 10, 'ten seats');
    const slots = [a.me().slot];
    for (const x of extra.slice(0, 9)) {
      const res = await x.call('join', { code, name: x.name });
      assert.ok(res.ok, `${x.name} joins`);
      slots.push(res.room.players.find((p) => p.id === x.socket.id).slot);
    }
    assert.deepEqual(slots.slice().sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'ten players, ten different colours');
    assert.match((await extra[9].call('join', { code, name: 'Max' })).error, /full \(10 players\)/);
    extra[0].room = { players: [] };
    extra[0].socket.on('room', (r) => (extra[0].room = r));
    a.stop();
    a.socket.close();
    await until(() => extra[0].room.hostId === extra[0].socket.id, 'host handoff');
    for (const x of extra) x.socket.close();
  });

  await test('the room is destroyed when the last player leaves', async () => {
    await sleep(250);
    const z = client('Zed');
    assert.ok((await z.call('join', { code, name: 'Zed' })).error);
    z.socket.close();
  });

  await test('public games: a room is private until its host opens it; then anyone can find it and join without the code', async () => {
    const host = client('Hoshi');
    const guest = client('Gen');
    const seeker = client('Suki');
    const list = async (x) => (await new Promise((res) => x.socket.emit('list', res))).rooms;
    const made = await host.call('create', { name: 'Hoshi' });
    host.room = made.room;
    assert.equal(made.room.settings.open, false, 'a new room is private');
    assert.deepEqual(await list(seeker), [], 'so nobody can find it');
    // only the host can open it
    assert.ok((await guest.call('join', { code: made.room.code, name: 'Gen' })).ok);
    await until(() => host.room.players.filter((p) => !p.bot).length === 2, 'guest in');
    guest.socket.emit('settings', { open: true });
    await sleep(120);
    assert.deepEqual(await list(seeker), []);
    host.socket.emit('settings', { open: true, game: 'cup' });
    await until(() => host.room.settings.open === true, 'room opened');
    const found = await list(seeker);
    assert.equal(found.length, 1);
    assert.deepEqual(
      { ...found[0] },
      { code: made.room.code, host: 'Hoshi', players: 2, bots: 4, max: 6, game: 'cup', mode: 'team', arena: 'random', theme: host.room.settings.theme, playing: false },
    );
    // found it: join with what the list gave us
    const joined = await seeker.call('join', { code: found[0].code, name: 'Suki' });
    assert.ok(joined.ok);
    assert.equal(joined.room.players.filter((p) => !p.bot).length, 3);
    // a full room is no longer offered, and neither is one made private again
    host.socket.emit('settings', { size: 10 });
    await until(() => host.room.settings.size === 10, 'ten seats');
    const more = ['Ichi', 'Ni', 'San', 'Shi', 'Go', 'Roku', 'Nana'].map((n) => client(n));
    for (const x of more) assert.ok((await x.call('join', { code: made.room.code, name: x.name })).ok);
    assert.deepEqual(await list(seeker), [], 'ten of ten: nothing to join');
    more[2].socket.emit('leave');
    await until(() => host.room.players.filter((p) => !p.bot).length === 9, 'one left');
    assert.equal((await list(seeker)).length, 1);
    host.socket.emit('settings', { open: false });
    await until(() => host.room.settings.open === false, 'room closed');
    assert.deepEqual(await list(seeker), []);
    // a room can also be opened as public straight away, and shows as playing once a match is on
    const second = client('Tora');
    const pub = await second.call('create', { name: 'Tora', open: true });
    assert.equal(pub.room.settings.open, true);
    assert.deepEqual((await list(seeker)).map((r) => [r.code, r.playing]), [[pub.room.code, false]]);
    for (const x of [host, guest, seeker, second, ...more]) x.socket.close();
    await sleep(150);
  });

  await test('from one room to another: joining a second room leaves the first; a room that is not there, or full, leaves you where you are', async () => {
    const one = client('Ichika');
    const two = client('Futaba');
    const walker = client('Aruku');
    const people = (x) => x.room.players.filter((p) => !p.bot);
    // (a room's own list arrives with the answer; after that, with every change)
    const made = async (x, event, msg) => {
      const res = await x.call(event, msg);
      if (res.room) x.room = res.room;
      return res;
    };
    const r1 = (await made(one, 'create', { name: 'Ichika' })).room.code;
    const r2 = (await made(two, 'create', { name: 'Futaba' })).room.code;
    assert.ok((await made(walker, 'join', { code: r1, name: 'Aruku' })).ok);
    await until(() => people(one).length === 2, 'in the first room');
    // a room that is not there: an error, and nothing changes
    const none = ['0000', '9999', '5555'].find((c) => c !== r1 && c !== r2);
    const miss = await walker.call('join', { code: none, name: 'Aruku' });
    assert.ok(miss.error && /No room/.test(miss.error));
    await sleep(120);
    assert.equal(people(one).length, 2, 'still in the first room');
    // a full room: the same
    two.socket.emit('settings', { size: 2, bots: false });
    await until(() => two.room.settings.size === 2 && two.room.players.length === 1, 'two seats, no bots');
    const filler = client('Michiru');
    assert.ok((await made(filler, 'join', { code: r2, name: 'Michiru' })).ok);
    const full = await walker.call('join', { code: r2, name: 'Aruku' });
    assert.ok(full.error && /full/.test(full.error));
    await sleep(120);
    assert.equal(people(one).length, 2, 'a full room: still in the first');
    // room for one more: over they go - the first room has a bot in the seat again, and hears no more of them
    two.socket.emit('settings', { size: 3 });
    await until(() => two.room.settings.size === 3, 'a third seat');
    const over = await made(walker, 'join', { code: r2, name: 'Aruku' });
    assert.ok(over.ok && over.room.code === r2);
    await until(() => people(one).length === 1 && people(two).length === 3, 'left the first, in the second');
    assert.equal(one.room.players.length, 6, 'a bot took the seat they left');
    assert.equal(walker.room.code, r2, 'and the room they hear from is the second');
    // joining the room you are in changes nothing
    const again = await walker.call('join', { code: r2, name: 'Aruku' });
    assert.ok(again.ok);
    await sleep(100);
    assert.equal(people(two).length, 3);
    // the host of a room with someone in it walks away: the room passes on
    assert.ok((await made(two, 'join', { code: r1, name: 'Futaba' })).ok);
    await until(() => walker.room.hostId !== two.socket.id && people(walker).length === 2, 'the second room has a new host');
    assert.ok([filler.socket.id, walker.socket.id].includes(walker.room.hostId));
    for (const x of [one, two, walker, filler]) x.socket.close();
    await sleep(150);
  });

  await test('chat: everyone in the menus shares one channel, a room has its own; text is cut, softened and rate-limited; history is handed over', async () => {
    const [x, y, z] = [client('Xavi'), client('Yoko'), client('Zed')];
    for (const c of [x, y, z]) {
      c.heard = [];
      c.socket.on('chat', (m) => c.heard.push(m));
    }
    await until(() => x.socket.connected && y.socket.connected && z.socket.connected, 'three connections');
    // the channel for everyone: you are told from the moment you open it
    const ox = await x.call('chat:open', { all: true });
    assert.ok(ox.global && Array.isArray(ox.all) && ox.room === null && ox.max >= 100 && ox.me, 'opening hands over the history and the limits');
    await y.call('chat:open', { all: true });
    const said = await x.call('chat:say', { to: 'all', text: '  hello   everyone  ', name: 'Xavi' });
    assert.ok(said.ok);
    await until(() => y.heard.length === 1 && x.heard.length === 1, 'the message, on both screens');
    assert.deepEqual([y.heard[0].to, y.heard[0].name, y.heard[0].text, y.heard[0].from], ['all', 'Xavi', 'hello everyone', ox.me]);
    assert.ok(y.heard[0].id > 0 && Math.abs(y.heard[0].at - Date.now()) < 5000);
    assert.equal(z.heard.length, 0, 'someone who has not opened the chat is not sent it');
    // ...and whoever opens it later is handed what was said
    const oz = await z.call('chat:open', { all: true });
    assert.deepEqual(oz.all.map((m) => m.text).slice(-1), ['hello everyone']);
    // no name, no word; nothing to say, nothing said
    assert.ok((await z.call('chat:say', { to: 'all', text: 'hi', name: '   ' })).needName);
    assert.equal((await z.call('chat:say', { to: 'all', text: '   ', name: 'Zed' })).ok, undefined);
    // softened: links, phone numbers, the roughest words; cut to the limit; no markup survives as markup (it is plain text)
    await y.call('chat:say', { to: 'all', text: 'see www.example.com/x and evil.gg, ring 555 123 4567 you shit <b>bold</b>', name: 'Yoko' });
    await until(() => x.heard.length === 2, 'the softened message');
    assert.equal(x.heard[1].text, 'see [link] and [link], ring [number] you **** <b>bold</b>');
    await y.call('chat:say', { to: 'all', text: 'x'.repeat(500), name: 'Yoko' });
    await until(() => x.heard.length === 3, 'the long message');
    assert.equal(x.heard[2].text.length, ox.max);
    // the same thing twice in a row is not said twice
    assert.ok(/just said/.test((await y.call('chat:say', { to: 'all', text: 'x'.repeat(500), name: 'Yoko' })).error));
    // a flood: a short burst gets through, then nothing - and after a few more tries, a time-out
    const burst = [];
    for (let i = 0; i < 12; i++) burst.push(await z.call('chat:say', { to: 'all', text: `flood ${i}`, name: 'Zed' }));
    const through = burst.filter((r) => r.ok).length;
    assert.ok(through >= 3 && through <= 6, `${through} of 12 got through`);
    assert.ok(burst.some((r) => /Too many/.test(r.error || '') && r.wait > 5000), 'and then they are shut out for a while');
    // a room's own channel
    assert.ok((await x.call('chat:say', { to: 'room', text: 'anyone?', name: 'Xavi' })).error, 'no room, no room chat');
    const made = await x.call('create', { name: 'Xavi' });
    x.room = made.room;
    assert.ok((await y.call('join', { code: made.room.code, name: 'Yoko' })).ok);
    await until(() => x.heard.some((m) => m.sys && m.text === 'Yoko joined'), 'the room is told who came in');
    const before = z.heard.length;
    assert.ok((await x.call('chat:say', { to: 'room', text: 'ready?', name: 'ignored' })).ok);
    await until(() => y.heard.some((m) => m.to === 'room' && m.text === 'ready?'), 'the room message');
    assert.equal(y.heard.find((m) => m.text === 'ready?').name, 'Xavi', 'in a room your name is the one you came in with');
    await sleep(150);
    assert.equal(z.heard.length, before, 'nobody outside the room hears it');
    // the room's history comes with opening the chat there - and nobody else's does
    const oy = await y.call('chat:open', { all: true });
    assert.deepEqual(oy.room.map((m) => m.text), ['Yoko joined', 'ready?']);
    assert.equal((await z.call('chat:open', { all: true })).room, null);
    assert.ok(!('chat' in x.room), 'what is said is not part of the room everyone is sent');
    // closing the channel for everyone: nothing more from it
    y.socket.emit('chat:close');
    await sleep(100);
    const quiet = y.heard.length;
    await sleep(2600); // (Xavi's bucket has refilled by now)
    assert.ok((await x.call('chat:say', { to: 'all', text: 'still here', name: 'Xavi' })).ok);
    await until(() => z.heard.some((m) => m.text === 'still here'), 'the others hear it');
    assert.equal(y.heard.length, quiet, 'whoever closed it does not');
    for (const c of [x, y, z]) c.socket.close();
    await sleep(150);
  });

  await test('accounts: a round played earns the ticket; an account is the next number; the server counts its rounds; another connection signs in; the owner resets a PIN', async () => {
    const admin = (body) => fetch(`${URL}/api/admin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    const x = client('Aki');
    x.acct = [];
    x.socket.on('acct', (m) => x.acct.push(m));
    await until(() => x.socket.connected, 'a connection');
    const hello = await x.call('acct:hello', {});
    assert.deepEqual([hello.on, hello.need, hello.played, hello.open, hello.account], [true, 1, 0, true, null]);
    // not before a round has been played - and the page cannot simply say it has played
    assert.match((await x.call('acct:create', { pin: '4827', name: 'Aki' })).error, /Play 1 more round/);
    await x.call('acct:hello', { ticket: 'aaaaaaaaaaaaaaaa.9.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    assert.match((await x.call('acct:create', { pin: '4827', name: 'Aki' })).error, /Play 1 more round/, 'a ticket that was not signed here counts for nothing');
    // a round, alone with the bots
    const made = await x.call('create', { name: 'Aki' });
    x.room = made.room;
    x.socket.emit('settings', { duration: SHORT, mode: 'potato' });
    x.socket.emit('start');
    await until(() => x.ends.length === 1 && x.acct.length === 1, 'a round and its ticket', (SHORT + 12) * 1000);
    assert.ok(x.acct[0].ticket && x.acct[0].played === 1 && !x.acct[0].record, 'one round on the ticket; no account, no record from the server');
    const ticket = x.acct[0].ticket;
    // now an account can be made: the next number, with what the browser had counted so far
    assert.match((await x.call('acct:create', { pin: '1234', name: 'Aki' })).error, /first anyone would try/);
    const acc = await x.call('acct:create', { pin: '4827', name: 'Aki', look: ['shadow', 3], record: { app: 'onigokko', kind: 'profile', v: 1, rounds: 1, wins: 1 } });
    assert.ok(acc.ok && acc.token && acc.account.id >= 1);
    assert.deepEqual([acc.account.name, acc.account.look, acc.account.record.rounds], ['Aki', { style: 'shadow', colour: 3 }, 1]);
    const no = acc.account.id;
    assert.match((await x.call('acct:create', { pin: '4827', name: 'Aki' })).error, /signed in already/);
    // the next round is counted by the server, and sent back
    x.socket.emit('lobby');
    await until(() => x.room.phase === 'lobby', 'back in the room');
    x.socket.emit('start');
    await until(() => x.ends.length === 2 && x.acct.length === 2, 'the second round', (SHORT + 12) * 1000);
    assert.equal(x.acct[1].record.rounds, 2, 'counted once, by the server');
    assert.equal(x.acct[1].record.name, 'Aki');
    // what is said in chat carries the number
    x.heard = [];
    x.socket.on('chat', (m) => x.heard.push(m));
    await x.call('chat:say', { to: 'room', text: 'gg', look: ['shadow', 3] });
    await until(() => x.heard.some((m) => m.text === 'gg'), 'the chat message');
    assert.deepEqual([x.heard.find((m) => m.text === 'gg').no, x.heard.find((m) => m.text === 'gg').look], [no, ['shadow', 3]]);
    // a second connection: the same ticket makes no second account; the number and the PIN let it in
    const y = client('Other');
    y.acct = [];
    y.socket.on('acct', (m) => y.acct.push(m));
    await until(() => y.socket.connected, 'another connection');
    await y.call('acct:hello', { ticket });
    assert.match((await y.call('acct:create', { pin: '7730', name: 'Other' })).error, /already been made from here/);
    assert.match((await y.call('acct:signin', { id: no, pin: '0000' })).error, /4 more tries/);
    const inn = await y.call('acct:signin', { id: no, pin: '4827' });
    assert.ok(inn.ok && inn.account.record.rounds === 2 && inn.account.name === 'Aki');
    // a device comes back with its token
    const z = client('Back');
    await until(() => z.socket.connected, 'a third connection');
    assert.equal((await z.call('acct:hello', { token: inn.token })).account.id, no);
    assert.equal((await z.call('acct:hello', { token: 'not-a-token-not-a-token-not' })).gone, true);
    z.socket.close();
    // the name and the character are kept
    assert.ok((await y.call('acct:save', { name: 'Akira', look: ['neon', 5] })).ok);
    // the owner's door: shut without the key
    assert.equal((await admin({ key: 'nope', action: 'overview' })).status, 401);
    const over = await admin({ key: 'net-test-admin-key', action: 'overview' });
    assert.ok(over.total >= 1 && over.accounts.some((q) => q.id === no && q.name === 'Akira' && q.rounds === 2));
    // a forgotten PIN: a code from the owner; whoever was signed in is signed out where they sit
    const reset = await admin({ key: 'net-test-admin-key', action: 'reset', id: no });
    assert.ok(reset.ok && /^[A-Z2-9]{6}$/.test(reset.code));
    await until(() => x.acct.some((m) => m.out) && y.acct.some((m) => m.out), 'both are told they are signed out');
    assert.match((await y.call('acct:pin', { pin: '5120' })).error, /Not signed in/);
    await sleep(2700); // (account questions are rationed like chat: a burst of five, then one every 2.5 s)
    const back = await y.call('acct:reset', { id: no, code: reset.code, pin: '5120' });
    assert.ok(back.ok && back.account.name === 'Akira');
    assert.match((await x.call('acct:signin', { id: no, pin: '4827' })).error, /not right/);
    // signing out; and deleting, which needs the PIN
    await sleep(5200);
    assert.ok((await y.call('acct:signout', {})).ok);
    assert.match((await y.call('acct:delete', { pin: '5120' })).error, /Not signed in/);
    await sleep(7800);
    assert.ok((await y.call('acct:signin', { id: no, pin: '5120' })).ok);
    assert.match((await y.call('acct:delete', { pin: '0000' })).error, /not right/);
    assert.ok((await y.call('acct:delete', { pin: '5120' })).ok);
    assert.equal((await admin({ key: 'net-test-admin-key', action: 'find', id: no })).account, null);
    for (const c of [x, y]) c.socket.close();
    await sleep(150);
  });

  await test('friends: a request and its answer reach the other at once; friends see each other come and go and where they are; an invitation brings one into a private room; the star of a round is named', async () => {
    const mk = (name) => {
      const x = client(name);
      Object.assign(x, { acct: [], news: [], invites: [] });
      x.socket.on('acct', (m) => x.acct.push(m));
      x.socket.on('friend:news', (m) => x.news.push(m));
      x.socket.on('invite', (m) => x.invites.push(m));
      return x;
    };
    const p = mk('Pia');
    const q = mk('Quin');
    await until(() => p.socket.connected && q.socket.connected, 'two connections');
    for (let i = 0; i < 200 && !(await p.call('acct:hello', {})).on; i++) await sleep(50); // (run on its own, this test is here before the accounts are)
    await q.call('acct:hello', {});
    // friends go with an account
    const none = await p.call('friend:list', {});
    assert.ok(none.needAccount && /account/.test(none.error));
    assert.match((await p.call('invite:send', { id: 1 })).error, /account/);
    assert.match((await p.call('player:card', { id: 999999 })).error, /No such player/, 'anybody may look at a card - if there is one');
    // a round together, in a private room
    const made = await p.call('create', { name: 'Pia' });
    p.room = made.room;
    assert.equal(made.room.settings.open, false);
    assert.ok((await q.call('join', { name: 'Quin', code: made.room.code })).ok);
    p.socket.emit('settings', { duration: SHORT, mode: 'potato', bots: false });
    p.socket.emit('start');
    await until(() => p.acct.length === 1 && q.acct.length === 1, 'a round and its tickets', (SHORT + 12) * 1000);
    // (the result names the star of the round: whoever was not the oni at the buzzer - in a duel, the winner)
    const end = p.ends[p.ends.length - 1];
    assert.equal(end.rows.length, 2);
    assert.equal(end.star, end.rows.find((r) => r.slot !== end.loser).slot);
    const pa = (await p.call('acct:create', { pin: '4827', name: 'Pia' })).account;
    const qa = (await q.call('acct:create', { pin: '5938', name: 'Quin', look: ['neon', 2] })).account;
    assert.ok(pa.id >= 1 && qa.id === pa.id + 1);
    const empty = await p.call('friend:list', {});
    assert.deepEqual([empty.ok, empty.me, empty.friends, empty.incoming, empty.outgoing], [true, pa.id, [], [], []]);
    // a card: who they are, a few numbers, what we are to each other - and nothing of where they are
    let card = (await p.call('player:card', { id: qa.id })).card;
    assert.deepEqual([card.id, card.name, card.look, card.rounds, card.state, 'online' in card], [qa.id, 'Quin', ['neon', 2], 0, 'none', false]);
    assert.match((await p.call('invite:send', { id: qa.id })).error, /go to friends/);
    // Pia asks; Quin hears of it at once, and says yes; Pia hears of that
    assert.match((await p.call('friend:add', { id: pa.id })).error, /your own number/);
    assert.deepEqual(await p.call('friend:add', { id: qa.id }), { ok: true, state: 'asked', name: 'Quin' });
    await until(() => q.news.some((n) => n.kind === 'asked' && n.who.id === pa.id && n.who.name === 'Pia'), 'word of the request');
    assert.deepEqual((await q.call('friend:list', {})).incoming, [{ id: pa.id, name: 'Pia', look: ['ink', 0] }]);
    assert.deepEqual((await p.call('friend:list', {})).outgoing.map((x) => x.id), [qa.id]);
    assert.deepEqual(await q.call('friend:answer', { id: pa.id, yes: true }), { ok: true, state: 'friends' });
    await until(() => p.news.some((n) => n.kind === 'accepted' && n.who.id === qa.id), 'word of the yes');
    // friends see each other: about, and in this room
    await sleep(3000); // (questions about friends are rationed too: a burst, then one a second)
    let list = await p.call('friend:list', {});
    assert.deepEqual(list.friends, [{ id: qa.id, name: 'Quin', look: ['neon', 2], online: true, room: { here: true, open: false, code: made.room.code, playing: false, full: false } }]);
    card = (await p.call('player:card', { id: qa.id })).card;
    assert.deepEqual([card.state, card.online, card.room.here], ['friends', true, true]);
    assert.match((await p.call('invite:send', { id: qa.id })).error, /in this room already/);
    // Quin leaves the room: about, but nowhere. A private room's code is not for looking up...
    q.socket.emit('leave');
    await sleep(120);
    list = await p.call('friend:list', {});
    assert.deepEqual([list.friends[0].online, list.friends[0].room], [true, null]);
    assert.deepEqual((await q.call('friend:list', {})).friends[0].room, { here: false, open: false, code: '', playing: false, full: false });
    // ...it comes with an invitation
    assert.deepEqual(await p.call('invite:send', { id: qa.id }), { ok: true, name: 'Quin' });
    await until(() => q.invites.length === 1, 'the invitation');
    assert.deepEqual([q.invites[0].from, q.invites[0].code, q.invites[0].playing], [{ id: pa.id, name: 'Pia', look: ['ink', 0] }, made.room.code, false]);
    assert.match((await p.call('invite:send', { id: qa.id })).error, /just invited/);
    assert.match((await q.call('invite:send', { id: pa.id })).error, /not in a room/);
    assert.ok((await q.call('join', { name: 'Quin', code: q.invites[0].code })).ok);
    assert.equal((await p.call('friend:list', {})).friends[0].room.here, true);
    // a new name shows in the friend's list at once
    assert.ok((await q.call('acct:save', { name: 'Quinn', look: ['arcade', 7] })).ok);
    await sleep(3000);
    list = await p.call('friend:list', {});
    assert.deepEqual([list.friends[0].name, list.friends[0].look], ['Quinn', ['arcade', 7]]);
    // Quin goes: Pia hears of it, and sees it; Quin comes back on another connection: Pia hears of that too
    q.socket.close();
    await until(() => p.news.some((n) => n.kind === 'away' && n.who.id === qa.id), 'word that a friend has gone');
    list = await p.call('friend:list', {});
    assert.deepEqual([list.friends[0].online, list.friends[0].room], [false, null]);
    assert.match((await p.call('invite:send', { id: qa.id })).error, /not online/);
    const q2 = mk('Quin');
    await until(() => q2.socket.connected, 'a new connection');
    assert.ok((await q2.call('acct:signin', { id: qa.id, pin: '5938' })).ok);
    await until(() => p.news.some((n) => n.kind === 'here' && n.who.id === qa.id && n.who.name === 'Quinn'), 'word that a friend is here');
    // no longer friends: gone from both lists, and no more invitations
    assert.deepEqual(await q2.call('friend:remove', { id: pa.id }), { ok: true, state: 'none' });
    await until(() => p.news.some((n) => n.kind === 'removed'), 'word of it');
    assert.deepEqual((await p.call('friend:list', {})).friends, []);
    assert.match((await p.call('invite:send', { id: qa.id })).error, /go to friends/);
    for (const x of [p, q2]) x.socket.close();
    await sleep(150);
  });

  console.log(`net: ${passed} tests passed`);
} finally {
  clearInterval(chase);
  for (const x of [a, b, c]) {
    x.stop();
    x.socket.close();
  }
  server.kill();
}
