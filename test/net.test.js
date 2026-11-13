// End-to-end server check with scripted socket clients. Run with: npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { IN_LEFT, IN_RIGHT, IN_JUMP, TICK_RATE, BOMB_POINTS } from '../shared/config.js';
import { STATE_LEN, stepPlayer, unpackState, packState } from '../shared/physics.js';
import { arenaById } from '../shared/arenas.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const SHORT = 6; // seconds; only the test server accepts a round this short
const BREAK = 700; // ms between tournament rounds on the test server
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), TAG_TEST_DURATION: String(SHORT), TAG_TEST_BREAK: String(BREAK), TAG_TEST_INTRO: '300' },
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
    const { plan, ...rest } = res.room.settings;
    assert.deepEqual(rest, { game: 'quick', rounds: 5, mode: 'potato', arena: 'random', theme: 'ink', duration: 60, powerups: true, open: false });
    assert.equal(plan.length, 7, 'a stage for every round a tournament can have');
    assert.ok(plan.every((st) => st.arena === 'random' && st.theme === 'ink'));
    a.room = res.room;
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
    a.socket.emit('settings', { arena: 'dojo', theme: 'space', mode: 'time', duration: 90, powerups: false, rounds: 3 });
    await until(() => b.room.settings.arena === 'dojo' && b.room.settings.mode === 'time', 'settings');
    a.socket.emit('settings', { arena: 'nope', theme: 'nope', mode: 'nope', duration: 5, powerups: 'yes', game: 'nope', rounds: 4 });
    await sleep(150);
    const { plan, ...rest } = b.room.settings;
    assert.deepEqual(rest, { game: 'quick', rounds: 3, mode: 'time', arena: 'dojo', theme: 'space', duration: 90, powerups: false, open: false });
    assert.ok(plan.every((st) => st.arena === 'dojo' && st.theme === 'space'), 'an arena or a style set like this goes for every round');
    // one round of a tournament can have its own; junk is ignored
    a.socket.emit('settings', { stage: { i: 2, arena: 'hills', theme: 'neon' } });
    await until(() => b.room.settings.plan[2].arena === 'hills', 'round 3 planned');
    assert.deepEqual(b.room.settings.plan[2], { arena: 'hills', theme: 'neon' });
    assert.deepEqual(b.room.settings.plan[1], { arena: 'dojo', theme: 'space' });
    a.socket.emit('settings', { stage: { i: 99, arena: 'hills' } });
    a.socket.emit('settings', { stage: { i: 1, arena: 'nowhere', theme: 'random' } });
    await until(() => b.room.settings.plan[1].theme === 'random', 'round 2 left to the draw');
    assert.equal(b.room.settings.plan[1].arena, 'dojo');
    assert.equal(b.room.settings.arena, 'dojo', 'arena and theme still say what round 1 is played on');
    a.socket.emit('settings', { arena: 'dojo', theme: 'space' });
    await until(() => b.room.settings.plan.every((st) => st.arena === 'dojo' && st.theme === 'space'), 'back to one stage for all');
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

  await test('tournament: rounds follow on their own, points add up, the leader starts as it, a champion is crowned', async () => {
    a.socket.emit('lobby');
    await until(() => a.room.phase === 'lobby', 'back to lobby');
    a.socket.emit('settings', { game: 'cup', rounds: 3, arena: 'random' });
    await until(() => a.room.settings.game === 'cup' && a.room.settings.arena === 'random', 'cup settings');
    assert.equal(a.room.settings.mode, 'team', 'a tournament is played in teams unless the host chooses otherwise');
    a.socket.emit('settings', { mode: 'time' }); // this test is about the free-for-all points
    await until(() => a.room.settings.mode === 'time', 'free-for-all tournament');
    for (const p of [a, b, c]) p.ends.length = 0;
    const winsBefore = a.room.players.map((p) => p.wins);
    a.socket.emit('start');
    startChasing([a, b, c]);
    const arenas = [];
    const totals = { 0: 0, 1: 0, 2: 0 };
    for (let round = 1; round <= 3; round++) {
      await until(() => a.round && a.round.cup && a.round.cup.round === round && a.go !== null, `round ${round} go`, 9000);
      arenas.push(a.round.arena);
      assert.equal(a.round.cup.rounds, 3);
      assert.equal(a.round.cup.double, round === 3, 'only the last round counts double');
      assert.equal(a.round.twist !== 'none', round === 2, 'round 2 has a twist');
      if (round === 1) assert.equal(a.round.cup.leader, -1);
      else {
        const top = Math.max(...Object.values(totals));
        if (top > 0) {
          assert.equal(totals[a.round.cup.leader], top, 'the leader is named');
          assert.equal(a.go, a.round.cup.leader, 'and starts as it');
        }
      }
      if (round === 2) {
        // nothing can be changed or restarted in the middle of a tournament
        a.socket.emit('settings', { game: 'quick', arena: 'dojo' });
        a.socket.emit('start');
        await sleep(100);
        assert.equal(a.room.settings.game, 'cup');
        assert.equal(a.room.cup.round, 2);
      }
      await until(() => a.ends.length === round && b.ends.length === round, `round ${round} end`, (SHORT + 4) * 1000);
      const e = a.end;
      assert.equal(e.mode, 'cup');
      assert.equal(e.cup.round, round);
      assert.equal(e.cup.final, round === 3);
      const safe = e.rows.filter((r) => r.slot !== e.loser).length;
      assert.equal(safe, 2, 'exactly one player is it at the buzzer');
      for (const r of e.rows) {
        totals[r.slot] += r.pts;
        if (round === 3) assert.equal(r.pts % 2, 0, 'double points');
        if (r.slot === e.loser) assert.ok(r.pts <= 2 * (round === 3 ? 2 : 1), 'no bonus for whoever is it at the end');
      }
      for (const row of e.cup.table) assert.equal(row.pts, totals[row.slot], 'the table is the running total');
      assert.deepEqual(e.cup.table.map((r) => r.pts), e.cup.table.map((r) => r.pts).sort((x, y) => y - x), 'most points first');
    }
    clearInterval(chase);
    assert.equal(new Set(arenas).size, 3, `a different arena every round: ${arenas}`);
    const champ = a.end.cup.table[0];
    assert.ok(a.end.winners.includes(champ.slot));
    await until(() => a.room.phase === 'results' && a.room.cup === null, 'tournament over');
    const after = a.room.players.find((p) => p.slot === champ.slot).wins;
    assert.equal(after, winsBefore[a.room.players.findIndex((p) => p.slot === champ.slot)] + 1, 'the cup counts as a win');
    await sleep(BREAK + 400);
    assert.equal(a.room.phase, 'results', 'no fourth round');
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

    for (const p of [a, b, c]) p.ends.length = 0;
    a.socket.emit('start');
    await until(() => a.round && a.round.mode === 'team' && a.go === null && a.round.teams, 'team round info');
    // the round has the sides exactly as the room had them, plus one bot on the short side
    const roster = a.round.players;
    assert.equal(roster.length, 4, 'three players and a bot');
    const bots = roster.filter((p) => p.bot);
    assert.equal(bots.length, 1);
    const bot = bots[0];
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
    assert.equal(a.snap[8].length, 8, 'scores, who carries a bomb, whether it is over, and fill + owner of both flags');
    const bits = (m) => m.toString(2).replace(/0/g, '').length;
    assert.equal(bits(a.snap[8][2]), 2, 'two players carry a bomb');
    assert.equal(a.snap[8][3], 0);
    assert.deepEqual(a.snap[8].slice(4), [0, -1, 0, -1], 'the flags start as nobody\'s');
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
    // the bombs went off on whoever held them when the clock stopped, and the other side scored
    const blown = e.rows.filter((r) => r.boom);
    assert.equal(blown.length, 2, 'two bombs, two explosions');
    for (const t of [0, 1]) assert.ok(e.team.score[t] >= BOMB_POINTS * blown.filter((r) => r.team === 1 - t).length, `score ${e.team.score}`);
    assert.ok(e.rows.every((r) => typeof r.caps === 'number'));
    const win = e.team.score[0] === e.team.score[1] ? -1 : e.team.score[0] > e.team.score[1] ? 0 : 1;
    assert.equal(e.team.win, win);
    assert.deepEqual(e.winners.slice().sort(), e.rows.filter((r) => win < 0 || r.team === win).map((r) => r.slot).sort());
    // a bot wins no matches: only real players collect wins
    assert.ok(a.room.players.every((p) => p.slot !== bot.slot));
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
    a.socket.emit('settings', { stage: { i: 0, arena: 'hills', theme: 'space' } });
    a.socket.emit('settings', { stage: { i: 1, arena: 'canyon', theme: 'random' } });
    await until(() => a.room.settings.plan[1].arena === 'canyon', 'stages planned');
    a.round = null;
    a.socket.emit('start');
    await until(() => a.round && a.round.cup && a.round.cup.round === 1, 'round 1');
    assert.deepEqual([a.round.arena, a.round.theme, a.round.random], ['hills', 'space', { arena: false, theme: false }], 'round 1 is played where the plan says');
    assert.deepEqual(teamsNow(), sides0, 'round 1');
    const cols1 = a.round.cols.slice();
    c.socket.emit('side', 1 - sideOf(c));
    await until(() => a.round.cup.round === 2, 'round 2', (SHORT + 14) * 1000);
    assert.deepEqual(teamsNow(), sides0, 'round 2: the same sides (and nobody could switch in between)');
    assert.equal(a.round.arena, 'canyon', 'round 2: its own arena');
    assert.deepEqual(a.round.random, { arena: false, theme: true }, 'and a style left to the draw');
    assert.deepEqual(a.round.cols, cols1, 'and the same colours');
    assert.equal(a.round.players.filter((p) => p.bot).length, 1, 'the bot fills in every round');
    // the host ends the tournament between rounds
    await until(() => a.ends.length === 4, 'round 2 over', (SHORT + 12) * 1000);
    a.socket.emit('lobby');
    await until(() => a.room.phase === 'lobby' && !a.room.cup, 'tournament ended');
    assert.deepEqual([a, b, c].map(sideOf), sides0);
  });

  await test('a player leaving a 2-player match ends it; whoever stayed wins', async () => {
    c.stop();
    c.socket.close();
    await until(() => a.room.players.length === 2, 'c gone');
    a.socket.emit('lobby');
    a.socket.emit('settings', { game: 'quick' });
    await until(() => a.room.phase === 'lobby' && a.room.settings.game === 'quick', 'quick match again');
    a.socket.emit('start');
    await until(() => a.round && a.round.players.length === 2 && a.go === null, 'round');
    await until(() => a.go !== null, 'go', 6000);
    b.stop();
    b.socket.emit('leave');
    await until(() => a.end && a.end.reason === 'forfeit', 'forfeit');
    assert.deepEqual(a.end.winners, [a.me().slot]);
    assert.equal(a.end.loser, -1);
  });

  await test('room is full at 10 players; host leaving hands the room over', async () => {
    const extra = ['Di', 'Eve', 'Flo', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu', 'Max'].map((n) => client(n));
    const slots = [a.me().slot];
    for (const x of extra.slice(0, 9)) {
      const res = await x.call('join', { code, name: x.name });
      assert.ok(res.ok, `${x.name} joins`);
      slots.push(res.room.players.find((p) => p.id === x.socket.id).slot);
    }
    assert.deepEqual(slots.slice().sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'ten players, ten different colours');
    assert.match((await extra[9].call('join', { code, name: 'Max' })).error, /full \(10 players max\)/);
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
    assert.equal(made.room.settings.open, false, 'a new room is private');
    assert.deepEqual(await list(seeker), [], 'so nobody can find it');
    // only the host can open it
    assert.ok((await guest.call('join', { code: made.room.code, name: 'Gen' })).ok);
    await until(() => host.room && host.room.players.length === 2, 'guest in');
    guest.socket.emit('settings', { open: true });
    await sleep(120);
    assert.deepEqual(await list(seeker), []);
    host.socket.emit('settings', { open: true, game: 'cup' });
    await until(() => host.room.settings.open === true, 'room opened');
    const found = await list(seeker);
    assert.equal(found.length, 1);
    assert.deepEqual(
      { ...found[0] },
      { code: made.room.code, host: 'Hoshi', players: 2, max: 10, game: 'cup', mode: 'team', arena: 'random', theme: host.room.settings.theme, playing: false },
    );
    // found it: join with what the list gave us
    const joined = await seeker.call('join', { code: found[0].code, name: 'Suki' });
    assert.ok(joined.ok);
    assert.equal(joined.room.players.length, 3);
    // a full room is no longer offered, and neither is one made private again
    const more = ['Ichi', 'Ni', 'San', 'Shi', 'Go', 'Roku', 'Nana'].map((n) => client(n));
    for (const x of more) assert.ok((await x.call('join', { code: made.room.code, name: x.name })).ok);
    assert.deepEqual(await list(seeker), [], 'ten of ten: nothing to join');
    more[2].socket.emit('leave');
    await until(() => host.room.players.length === 9, 'one left');
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

  console.log(`net: ${passed} tests passed`);
} finally {
  clearInterval(chase);
  for (const x of [a, b, c]) {
    x.stop();
    x.socket.close();
  }
  server.kill();
}
