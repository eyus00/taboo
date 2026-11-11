// You're It! - game server.
//
// One Node process does everything: serves the static site, runs the rooms,
// and is the single source of truth for every match (who is "it", who touched
// whom, who picked up what). Browsers only send key presses.
//
//   npm install && npm start   ->  http://localhost:3000

import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import {
  TICK_RATE,
  TICK_MS,
  SNAP_EVERY,
  COUNTDOWN_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX,
  DURATIONS,
  DEFAULT_DURATION,
  THEME_IDS,
  DEFAULT_THEME,
  MODE_IDS,
  IN_MASK,
} from './shared/config.js';
import { ARENA_IDS, arenaById } from './shared/arenas.js';
import { Sim, standings } from './shared/sim.js';
import { packState, publicFlags } from './shared/physics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// The automated tests play very short rounds; nothing else can ask for one.
const TEST_DURATION = Number(process.env.TAG_TEST_DURATION) || 0;

// Other players are drawn this many ticks in the past on every screen
// (see INTERP_TICKS in public/js/net.js). Used for lag-compensated tagging.
const VIEW_DELAY_TICKS = 6;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

const staticOpts = {
  setHeaders(res, file) {
    // Fonts never change; everything else revalidates so deploys show up at once.
    res.setHeader('Cache-Control', /\.woff2$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
  },
};
app.use('/shared', express.static(path.join(__dirname, 'shared'), staticOpts));
app.use(express.static(path.join(__dirname, 'public'), staticOpts));

const http = createServer(app);
const io = new Server(http, {
  maxHttpBufferSize: 16 * 1024, // nobody needs to send us more than a few bytes
  pingInterval: 10000,
  pingTimeout: 8000,
});

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
/** @type {Map<string, any>} */
const rooms = new Map();

// Consonants only, so codes never spell anything and are easy to read out loud.
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

function makeCode() {
  for (let tries = 0; tries < 200; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return name || 'Player';
}

function pick(list, avoid) {
  const pool = list.length > 1 ? list.filter((x) => x !== avoid) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase, // lobby | countdown | playing | results
    settings: room.settings,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, slot: p.slot, playing: p.playing, wins: p.wins })),
  };
}

function emitRoom(room) {
  io.to(room.code).emit('room', roomState(room));
}

function roundInfo(room) {
  const g = room.game;
  return {
    arena: g.arenaId,
    theme: g.themeId,
    mode: g.mode,
    duration: g.duration,
    playing: g.state === 'playing',
    countdown: Math.max(0, g.goAt - Date.now()),
    players: [...room.players.values()].filter((p) => p.playing).map((p) => ({ slot: p.slot, name: p.name })),
  };
}

function addPlayer(room, socket, name) {
  const used = new Set([...room.players.values()].map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const player = { id: socket.id, name: cleanName(name), slot, playing: false, wins: 0, rtt: 0 };
  room.players.set(socket.id, player);
  socket.join(room.code);
  socket.data.code = room.code;
  return player;
}

function leaveRoom(socket) {
  const room = rooms.get(socket.data.code);
  socket.data.code = null;
  if (!room) return;
  const player = room.players.get(socket.id);
  if (!player) return;
  room.players.delete(socket.id);
  socket.leave(room.code);

  if (room.players.size === 0) {
    rooms.delete(room.code); // last one out: the room is gone
    updateLoop();
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  io.to(room.code).emit('toast', `${player.name} left`);

  const g = room.game;
  if (g && player.playing) {
    g.sim.remove(player.slot); // hands "it" to someone else if needed
    flushEvents(room);
    if (g.sim.active().length < 2) {
      finishRound(room, 'forfeit');
      return;
    }
  }
  emitRoom(room);
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
function startRound(room) {
  const s = room.settings;
  const arenaId = s.arena === 'random' ? pick(ARENA_IDS, room.lastArena) : s.arena;
  const themeId = s.theme === 'random' ? pick(THEME_IDS, room.lastTheme) : s.theme;
  room.lastArena = arenaId;
  room.lastTheme = themeId;

  const sim = new Sim(arenaById(arenaId));
  sim.powerups = s.powerups;
  const spawns = shuffled([0, 1, 2, 3]);
  const net = [null, null, null, null];
  let i = 0;
  for (const p of room.players.values()) {
    p.playing = true;
    sim.add(p.slot, spawns[i++]);
    net[p.slot] = { q: [], recv: 0, lastSeq: 0, lastBits: 0, idle: 0, win: 0, spare: Infinity, late: 0, trimmed: 0, skipped: 0, id: p.id };
  }
  room.game = {
    sim,
    net,
    arenaId,
    themeId,
    mode: s.mode,
    duration: s.duration,
    state: 'countdown',
    goAt: Date.now() + COUNTDOWN_MS + 500, // a beat for everyone to load the arena
    endTick: 0,
  };
  room.phase = 'countdown';
  room.results = null;
  io.to(room.code).emit('round', roundInfo(room));
  emitRoom(room);
  updateLoop();
}

function finishRound(room, reason) {
  const g = room.game;
  if (!g) return;
  if (process.env.DEBUG_NET) {
    // per-player input buffer stats: late = had to repeat an input, trimmed = extra step, skipped = dropped after a stall
    const played = g.sim.tick - (g.endTick - g.duration * TICK_RATE);
    console.log(`[net ${room.code}] ${played} ticks |`, g.net.map((n, i) => (n ? `p${i} received=${n.recv} late=${n.late} trimmed=${n.trimmed} skipped=${n.skipped} queued=${n.q.length}` : '')).filter(Boolean).join(' | '));
  }
  const names = [];
  for (const p of room.players.values()) names[p.slot] = p.name;
  let { rows, winners, loser } = standings(g.sim, names, g.mode);
  if (reason === 'forfeit') {
    // everyone else left: whoever stayed wins, whatever the clock says
    winners = rows.map((r) => r.slot);
    loser = -1;
  }
  for (const p of room.players.values()) {
    if (p.playing && winners.includes(p.slot)) p.wins++;
    p.playing = false;
  }
  room.results = {
    reason, // 'time' | 'forfeit'
    mode: g.mode,
    winners, // slots
    loser, // slot of whoever was "it" at the end (hot potato), or -1
    rows: rows.map((r) => ({ slot: r.slot, name: r.name, ms: Math.round((r.ticks * 1000) / TICK_RATE), tags: r.tags })),
  };
  room.game = null;
  room.phase = 'results';
  io.to(room.code).emit('end', room.results);
  emitRoom(room);
  updateLoop();
}

function flushEvents(room) {
  const sim = room.game.sim;
  for (const e of sim.events) {
    if (e.type === 'tag') io.to(room.code).emit('tag', e.from, e.to);
    else if (e.type === 'block') io.to(room.code).emit('block', e.from, e.to);
    else if (e.type === 'pick') io.to(room.code).emit('pick', e.slot, e.kind, e.point);
  }
  sim.events.length = 0;
}

// Which input(s) to apply for a player this tick.
//
// Normally: exactly one, the next in their queue. Packets never arrive
// perfectly evenly though, so this doubles as a small adaptive jitter buffer:
//   * queue empty (a late packet): repeat their last input so they keep
//     moving. The late input then waits its turn, which leaves one input of
//     cushion against the next hiccup - the buffer grows only when needed.
//   * cushion never touched for a whole second: run one extra step to trim
//     it, so lag does not build up after a single bad moment.
//   * a real stall (a quarter second of inputs at once): skip to the newest.
// No input is ever thrown away in normal play, so a quick tap always counts.
function takeInputs(n) {
  if (n.q.length > 15) {
    while (n.q.length > 4) {
      const d = n.q.shift();
      n.lastSeq = d.seq;
      n.lastBits = d.bits;
      n.skipped++;
    }
  }
  if (n.q.length === 0) {
    n.idle++;
    n.win = 0;
    n.spare = Infinity;
    n.late++;
    return [n.idle > 12 ? 0 : n.lastBits]; // gone quiet for 200 ms: let go of the keys
  }
  n.idle = 0;
  const a = n.q.shift();
  n.lastSeq = a.seq;
  n.lastBits = a.bits;
  if (n.q.length < n.spare) n.spare = n.q.length;
  if (++n.win >= TICK_RATE) {
    const unused = n.spare;
    n.win = 0;
    n.spare = Infinity;
    if (unused >= 2 && n.q.length) {
      const b = n.q.shift();
      n.lastSeq = b.seq;
      n.lastBits = b.bits;
      n.trimmed++;
      return [a.bits, b.bits];
    }
  }
  return [a.bits];
}

function tickRoom(room) {
  const g = room.game;
  const sim = g.sim;

  if (g.state === 'countdown') {
    // Players stand frozen on their spawn points until GO.
    for (let slot = 0; slot < 4; slot++) sim.stepOne(slot, 0);
    sim.endTick();
    sim.events.length = 0;
    if (Date.now() >= g.goAt) {
      g.state = 'playing';
      room.phase = 'playing';
      sim.start();
      g.endTick = sim.tick + g.duration * TICK_RATE;
      io.to(room.code).emit('go', sim.it);
      emitRoom(room);
    }
  } else {
    for (let slot = 0; slot < 4; slot++) {
      if (!sim.players[slot]) continue;
      const n = g.net[slot];
      for (const bits of takeInputs(n)) sim.stepOne(slot, bits);
      // How far in the past this player sees everyone else: the round trip to
      // them and back, the smoothing delay, and whatever waits in their queue.
      const rtt = room.players.get(n.id)?.rtt || 0;
      sim.rewind[slot] = Math.min(40, Math.round(rtt / TICK_MS) + VIEW_DELAY_TICKS + n.q.length);
    }
    sim.endTick();
    flushEvents(room);
    if (sim.tick >= g.endTick) {
      sendSnapshot(room);
      finishRound(room, 'time');
      return;
    }
  }
  if (sim.tick % SNAP_EVERY === 0) sendSnapshot(room);
}

// Snapshot, one per player because each also gets their own full state:
//   [tick, playing, itSlot, ticksLeft | msToGo, players[], pickups[], mine]
//   player: [slot, x, y, vx, vy, flags, immune, itTicks, tags]
//   pickup: point * 4 + type
//   mine:   [ackSeq, ...packState(mine)] or 0 for spectators
function sendSnapshot(room) {
  const g = room.game;
  const sim = g.sim;
  const ps = [];
  for (const pl of sim.players) {
    if (!pl) continue;
    const s = pl.s;
    ps.push([pl.slot, s.x, s.y, s.vx, s.vy, publicFlags(s), pl.immune, pl.itTicks, pl.tags]);
  }
  const pk = sim.pickups.map((k) => k.point * 4 + k.type);
  const playing = g.state === 'playing';
  const left = playing ? g.endTick - sim.tick : Math.max(0, g.goAt - Date.now());
  const head = [sim.tick, playing ? 1 : 0, sim.it, left, ps, pk];
  for (const p of room.players.values()) {
    const pl = p.playing ? sim.players[p.slot] : null;
    const mine = pl ? [g.net[p.slot].lastSeq, ...packState(pl.s)] : 0;
    io.to(p.id).volatile.emit('s', [...head, mine]);
  }
}

// One loop drives every active match, and only runs while there is one.
let loop = null;
let lastTime = 0;
let acc = 0;

function updateLoop() {
  let any = false;
  for (const room of rooms.values()) {
    if (room.game) {
      any = true;
      break;
    }
  }
  if (any && !loop) {
    lastTime = performance.now();
    acc = 0;
    loop = setInterval(runLoop, 8);
  } else if (!any && loop) {
    clearInterval(loop);
    loop = null;
  }
}

function runLoop() {
  const now = performance.now();
  acc += now - lastTime;
  lastTime = now;
  if (acc > 250) acc = 250; // never try to catch up more than a quarter second
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    for (const room of rooms.values()) {
      if (!room.game) continue;
      try {
        tickRoom(room);
      } catch (err) {
        console.error(`room ${room.code} crashed`, err);
        room.game = null;
        room.phase = 'lobby';
        emitRoom(room);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.code = null;

  // Measure the round trip to this browser every couple of seconds.
  const probe = setInterval(() => {
    const room = rooms.get(socket.data.code);
    const player = room?.players.get(socket.id);
    if (!player) return;
    const t0 = performance.now();
    socket.timeout(3000).emit('q', (err) => {
      if (err) return;
      const rtt = performance.now() - t0;
      player.rtt = player.rtt ? player.rtt * 0.7 + rtt * 0.3 : rtt;
    });
  }, 2000);

  socket.on('create', (msg, ack) => {
    if (typeof ack !== 'function') return;
    leaveRoom(socket);
    const code = makeCode();
    if (!code) return ack({ error: 'Server is full, try again in a minute.' });
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      phase: 'lobby',
      settings: { mode: MODE_IDS[0], arena: 'random', theme: DEFAULT_THEME, duration: DEFAULT_DURATION, powerups: true },
      game: null,
      results: null,
      lastArena: null,
      lastTheme: null,
    };
    rooms.set(code, room);
    addPlayer(room, socket, msg?.name);
    ack({ ok: true, id: socket.id, room: roomState(room) });
  });

  socket.on('join', (msg, ack) => {
    if (typeof ack !== 'function') return;
    const code = String(msg?.code ?? '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 4);
    const room = rooms.get(code);
    if (!room) return ack({ error: `No room with code ${code || '????'}. Check the code and try again.` });
    if (room.players.has(socket.id)) return ack({ ok: true, id: socket.id, room: roomState(room) });
    if (room.players.size >= MAX_PLAYERS) return ack({ error: 'That room is full (4 players max).' });
    leaveRoom(socket);
    const player = addPlayer(room, socket, msg?.name);
    ack({ ok: true, id: socket.id, room: roomState(room) });
    socket.to(room.code).emit('toast', `${player.name} joined`);
    emitRoom(room);
    // Arrived mid-match: watch this round, play the next one.
    if (room.game) socket.emit('round', roundInfo(room));
    else if (room.phase === 'results' && room.results) socket.emit('end', room.results);
  });

  socket.on('leave', () => leaveRoom(socket));
  socket.on('disconnect', () => {
    clearInterval(probe);
    leaveRoom(socket);
  });

  socket.on('settings', (msg) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game) return;
    const s = room.settings;
    if (MODE_IDS.includes(msg?.mode)) s.mode = msg.mode;
    if (msg?.arena === 'random' || ARENA_IDS.includes(msg?.arena)) s.arena = msg.arena;
    if (msg?.theme === 'random' || THEME_IDS.includes(msg?.theme)) s.theme = msg.theme;
    if (DURATIONS.includes(msg?.duration) || (TEST_DURATION && msg?.duration === TEST_DURATION)) s.duration = msg.duration;
    if (typeof msg?.powerups === 'boolean') s.powerups = msg.powerups;
    emitRoom(room);
  });

  socket.on('start', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game) return;
    if (room.players.size < MIN_PLAYERS) return socket.emit('toast', 'Need at least 2 players to start.');
    startRound(room);
  });

  // Host: back to the lobby from the results screen (to change settings).
  socket.on('lobby', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game) return;
    room.phase = 'lobby';
    emitRoom(room);
  });

  // Anyone else: nudge the host for another round.
  socket.on('rematch', () => {
    const room = rooms.get(socket.data.code);
    const player = room?.players.get(socket.id);
    if (!room || !player || room.phase !== 'results') return;
    socket.to(room.code).emit('toast', `${player.name} wants a rematch!`);
  });

  // Inputs: one bitmask per client tick, numbered so the server can tell the
  // client which ones it has applied.
  socket.on('in', (first, list) => {
    const room = rooms.get(socket.data.code);
    const g = room?.game;
    if (!g || g.state !== 'playing') return;
    const player = room.players.get(socket.id);
    const n = player?.playing ? g.net[player.slot] : null;
    if (!n || !Number.isInteger(first) || !Array.isArray(list) || list.length > 32) return;
    for (let i = 0; i < list.length; i++) {
      const seq = first + i;
      if (seq <= n.recv) continue;
      n.recv = seq;
      n.q.push({ seq, bits: list[i] & IN_MASK });
    }
    if (n.q.length > 64) n.q.splice(0, n.q.length - 64);
  });

  // Latency probe from the browser (for its on-screen ping).
  socket.on('p', (ack) => {
    if (typeof ack === 'function') ack();
  });
});

http.listen(PORT, () => {
  console.log(`You're It! running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  io.close();
  http.close(() => process.exit(0));
});
