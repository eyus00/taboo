// End-to-end server check with scripted socket clients. Run with: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { IN_LEFT, IN_RIGHT, IN_JUMP, TICK_RATE } from '../shared/config.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const SHORT = 6; // seconds; only the test server accepts a round this short
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), TAG_TEST_DURATION: String(SHORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('running') && resolve()));

function client(name) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { socket, name, room: null, round: null, snap: null, end: null, go: null, tags: [], picks: [], seq: 0, bits: 0, timer: null };
  socket.on('room', (r) => (c.room = r));
  socket.on('round', (r) => {
    c.round = r;
    c.end = null;
    c.go = null;
    c.seq = 0;
    c.snap = null;
  });
  socket.on('s', (s) => (c.snap = s));
  socket.on('go', (it) => (c.go = it));
  socket.on('tag', (from, to) => c.tags.push([from, to]));
  socket.on('pick', (slot, kind) => c.picks.push([slot, kind]));
  socket.on('end', (e) => (c.end = e));
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
async function test(name, fn) {
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
      const other = p.snap[4].find((q) => q[0] !== me[0]);
      if (!other) continue;
      if (p.snap[2] === me[0]) p.bits = (other[1] > me[1] ? IN_RIGHT : IN_LEFT) | (n % 12 < 7 ? IN_JUMP : 0);
      else p.bits = 0;
    }
  }, 30);
}

try {
  await test('create a room: 4-letter code, creator is host, sensible defaults', async () => {
    const res = await a.call('create', { name: '  Ana<script>  ' });
    assert.ok(res.ok);
    code = res.room.code;
    assert.match(code, /^[A-Z]{4}$/);
    assert.equal(res.room.hostId, a.socket.id);
    assert.equal(res.room.players[0].name, 'Anascript');
    assert.deepEqual(res.room.settings, { mode: 'potato', arena: 'random', theme: 'ink', duration: 90, powerups: true });
    a.room = res.room;
  });

  await test('joining: bad code is rejected, good code works (case-insensitive)', async () => {
    assert.ok((await b.call('join', { code: 'QQQQ', name: 'Ben' })).error);
    const res = await b.call('join', { code: code.toLowerCase(), name: 'Ben' });
    assert.ok(res.ok);
    b.room = res.room;
    await until(() => a.room.players.length === 2, 'host sees the joiner');
    assert.equal(b.me().slot, 1);
  });

  await test('only the host can change settings or start; bad values are ignored', async () => {
    b.socket.emit('start');
    b.socket.emit('settings', { arena: 'keep' });
    a.socket.emit('settings', { arena: 'dojo', theme: 'neon', mode: 'time', duration: 60, powerups: false });
    await until(() => b.room.settings.arena === 'dojo' && b.room.settings.mode === 'time', 'settings');
    a.socket.emit('settings', { arena: 'nope', theme: 'nope', mode: 'nope', duration: 5, powerups: 'yes' });
    await sleep(150);
    assert.deepEqual(b.room.settings, { mode: 'time', arena: 'dojo', theme: 'neon', duration: 60, powerups: false });
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
    assert.ok(Array.isArray(a.snap[6]) && a.snap[6].length === 20, 'each player gets their own full state');
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
    a.socket.emit('settings', { mode: 'time', arena: 'keep' });
    await until(() => a.room.settings.mode === 'time' && a.room.settings.arena === 'keep', 'time mode');
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

  await test('a player leaving a 2-player match ends it; whoever stayed wins', async () => {
    c.stop();
    c.socket.close();
    await until(() => a.room.players.length === 2, 'c gone');
    a.socket.emit('start');
    await until(() => a.round && a.round.players.length === 2 && a.go === null, 'round');
    await until(() => a.go !== null, 'go', 6000);
    b.stop();
    b.socket.emit('leave');
    await until(() => a.end && a.end.reason === 'forfeit', 'forfeit');
    assert.deepEqual(a.end.winners, [a.me().slot]);
    assert.equal(a.end.loser, -1);
  });

  await test('room is full at 4 players; host leaving hands the room over', async () => {
    const extra = [client('Di'), client('Eve'), client('Flo'), client('Gus')];
    assert.ok((await extra[0].call('join', { code, name: 'Di' })).ok);
    assert.ok((await extra[1].call('join', { code, name: 'Eve' })).ok);
    assert.ok((await extra[2].call('join', { code, name: 'Flo' })).ok);
    assert.match((await extra[3].call('join', { code, name: 'Gus' })).error, /full/);
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

  console.log(`net: ${passed} tests passed`);
} finally {
  clearInterval(chase);
  for (const x of [a, b, c]) {
    x.stop();
    x.socket.close();
  }
  server.kill();
}
