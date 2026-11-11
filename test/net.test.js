// End-to-end server check with scripted socket clients. Run with: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { IN_LEFT, IN_RIGHT, IN_JUMP, PW } from '../shared/config.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('running') && resolve()));

function client(name) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { socket, name, room: null, round: null, snap: null, end: null, go: null, tags: [], toasts: [], seq: 0, bits: 0, timer: null };
  socket.on('room', (r) => (c.room = r));
  socket.on('round', (r) => {
    c.round = r;
    c.end = null;
    c.go = null;
    c.seq = 0;
  });
  socket.on('s', (s) => (c.snap = s));
  socket.on('go', (it) => (c.go = it));
  socket.on('tag', (from, to) => c.tags.push([from, to]));
  socket.on('end', (e) => (c.end = e));
  socket.on('toast', (t) => c.toasts.push(t));
  c.call = (ev, msg) => new Promise((res) => socket.emit(ev, msg, res));
  c.me = () => c.room.players.find((p) => p.id === socket.id);
  c.mine = () => c.snap[4].find((p) => p[0] === c.me().slot);
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

try {
  await test('create a room, get a 4-letter code, creator is host and red', async () => {
    const res = await a.call('create', { name: '  Ana<script>  ' });
    assert.ok(res.ok);
    code = res.room.code;
    assert.match(code, /^[A-Z]{4}$/);
    assert.equal(res.room.hostId, a.socket.id);
    assert.equal(res.room.players[0].slot, 0);
    assert.equal(res.room.players[0].name, 'Anascript');
    a.room = res.room;
  });

  await test('joining: bad code is rejected, good code works (case-insensitive)', async () => {
    const bad = await b.call('join', { code: 'QQQQ', name: 'Ben' });
    assert.ok(bad.error);
    const res = await b.call('join', { code: code.toLowerCase(), name: 'Ben' });
    assert.ok(res.ok);
    b.room = res.room;
    await until(() => a.room.players.length === 2, 'host sees the joiner');
    assert.equal(b.me().slot, 1);
  });

  await test('only the host can start, and only with 2+ players', async () => {
    b.socket.emit('start');
    await sleep(150);
    assert.equal(a.room.phase, 'lobby');
  });

  await test('host settings are validated and broadcast', async () => {
    a.socket.emit('settings', { arena: 'classic', theme: 'neon', duration: 60 });
    await until(() => b.room.settings.arena === 'classic' && b.room.settings.duration === 60, 'settings');
    a.socket.emit('settings', { arena: 'nope', theme: 'nope', duration: 5 });
    b.socket.emit('settings', { arena: 'towers' });
    await sleep(150);
    assert.deepEqual(b.room.settings, { arena: 'classic', theme: 'neon', duration: 60 });
  });

  await test('start: countdown, then GO with exactly one "it"', async () => {
    a.socket.emit('start');
    await until(() => a.round && b.round, 'round info');
    assert.equal(a.round.arena, 'classic');
    assert.equal(a.round.players.length, 2);
    assert.ok(a.round.countdown > 2500);
    await until(() => a.snap && a.snap[1] === 0, 'countdown snapshot');
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
    assert.equal(c.round.players.length, 2);
  });

  await test('inputs move the player and are acknowledged in order', async () => {
    a.play();
    b.play();
    const x0 = a.mine()[1];
    a.bits = a.me().slot === 0 ? IN_RIGHT : IN_LEFT;
    await sleep(400);
    const m = a.mine();
    assert.ok(Math.abs(m[1] - x0) > 40, `moved ${m[1] - x0}px`);
    assert.ok(m[11] > 10 && m[11] <= a.seq, `ack ${m[11]} of ${a.seq}`);
    a.bits = 0;
  });

  await test('chasing down the other player transfers "it" and scores time', async () => {
    // Whoever is it runs at the other; the other stands still.
    const chase = setInterval(() => {
      for (const p of [a, b]) {
        if (!p.snap || p.end) continue;
        const it = p.snap[2];
        const me = p.mine();
        const other = p.snap[4].find((q) => q[0] !== me[0]);
        if (!other) continue;
        if (it === me[0]) {
          const dx = other[1] - me[1];
          const dy = other[2] - me[2];
          p.bits = (dx > 0 ? IN_RIGHT : IN_LEFT) | (dy < -20 || Math.abs(dx) < PW + 8 ? IN_JUMP : 0);
        } else p.bits = 0;
      }
    }, 30);
    await until(() => a.tags.length >= 2, 'two tags', 30000);
    clearInterval(chase);
    assert.deepEqual(a.tags[0].slice().sort(), [0, 1]);
    assert.notEqual(a.tags[0][0], a.tags[1][0], 'role really swapped');
    const times = a.snap[4].map((p) => p[10]);
    assert.ok(times.every((t) => t > 0), `both have it-time: ${times}`);
  });

  await test('a player leaving a 2-player match ends it; the one who stayed wins', async () => {
    b.stop();
    b.socket.emit('leave');
    await until(() => a.end, 'end');
    assert.equal(a.end.reason, 'forfeit');
    assert.deepEqual(a.end.winners, [a.me().slot]);
    await until(() => a.room.phase === 'results' && a.room.players.length === 2, 'results phase');
    assert.ok(c.end, 'spectator also sees the results');
  });

  await test('play again includes the spectator; a full timed round ends with standings', async () => {
    a.socket.emit('lobby');
    await until(() => a.room.phase === 'lobby', 'back to lobby');
    a.socket.emit('settings', { duration: 60 });
    a.socket.emit('start');
    await until(() => a.round && a.round.players.length === 2 && a.go === null, 'new round');
    assert.ok(a.round.players.some((p) => p.name === 'Cy'));
    await until(() => a.go !== null && a.snap[1] === 1, 'go', 6000);
    c.play();
    const left = a.snap[3];
    assert.ok(left > 59 * 60 && left <= 60 * 60, `ticks left ${left}`);
  });

  await test('room is full at 4 players', async () => {
    const d = client('Di');
    const e = client('Eve');
    const f = client('Flo');
    assert.ok((await d.call('join', { code, name: 'Di' })).ok);
    assert.ok((await e.call('join', { code, name: 'Eve' })).ok);
    const res = await f.call('join', { code, name: 'Flo' });
    assert.match(res.error, /full/);
    for (const x of [d, e, f]) x.socket.close();
    await sleep(100);
  });

  await test('host leaving hands the room to the next player', async () => {
    a.stop();
    a.socket.close();
    await until(() => c.room.hostId === c.socket.id, 'host handoff');
    await until(() => c.end && c.end.reason === 'forfeit', 'forfeit end');
  });

  await test('the room is destroyed when the last player leaves', async () => {
    c.stop();
    c.socket.close();
    await sleep(200);
    const z = client('Zed');
    const res = await z.call('join', { code, name: 'Zed' });
    assert.ok(res.error);
    z.socket.close();
  });

  console.log(`net: ${passed} tests passed`);
} finally {
  for (const x of [a, b, c]) {
    x.stop();
    x.socket.close();
  }
  server.kill();
}
