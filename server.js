// Onigokko - game server.
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
  BOMB_END_TICKS,
  TICK_MS,
  SNAP_EVERY,
  COUNTDOWN_MS,
  INTRO_MS,
  TEAM_SLOTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX,
  CODE_LEN,
  DURATIONS,
  DEFAULT_DURATION,
  THEME_IDS,
  DEFAULT_THEME,
  MODE_IDS,
  CUP_ROUNDS,
  DEFAULT_CUP_ROUNDS,
  CUP_BREAK_MS,
  TWISTS,
  twistById,
  IN_MASK,
} from './shared/config.js';
import { ARENA_IDS, arenaById } from './shared/arenas.js';
import { Sim, standings, cupPoints, makeTeams, botFill } from './shared/sim.js';
import { makeBot, botThink, prepareBots, BOT_NAMES } from './shared/bots.js';
import { packState, publicFlags } from './shared/physics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// The automated tests play very short rounds with short breaks; nothing else can ask for them.
const TEST_DURATION = Number(process.env.TAG_TEST_DURATION) || 0;
const BREAK_MS = Number(process.env.TAG_TEST_BREAK) || CUP_BREAK_MS;
const DRAW_MS = Number(process.env.TAG_TEST_INTRO) || INTRO_MS;

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

// Room codes are four digits: quick to say, quick to type on a number pad.
function makeCode() {
  for (let tries = 0; tries < 400; tries++) {
    const code = String(Math.floor(Math.random() * 10 ** CODE_LEN)).padStart(CODE_LEN, '0');
    if (!rooms.has(code)) return code;
  }
  return null;
}

// A usable display name, or '' if there is nothing left after tidying.
function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

// Two people with the same name in one room would be impossible to tell apart.
function uniqueName(room, name) {
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; n < 9; n++) {
    const alt = `${name.slice(0, NAME_MAX - 2)} ${n}`;
    if (!taken.has(alt.toLowerCase())) return alt;
  }
  return name;
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
    cup: room.cup ? { round: room.cup.round, rounds: room.cup.rounds } : null,
    // side: which team (0 Sun, 1 Moon) the player is on whenever the game is a team battle
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, slot: p.slot, side: p.side, playing: p.playing, wins: p.wins, pts: p.pts })),
  };
}

function emitRoom(room) {
  io.to(room.code).emit('room', roomState(room));
}

// The games anyone may join: rooms whose host opened them to the public, with
// a free place. Waiting rooms come first, then the fullest.
function publicRooms() {
  const list = [];
  for (const room of rooms.values()) {
    if (!room.settings.open || room.players.size >= MAX_PLAYERS) continue;
    const s = room.settings;
    list.push({
      code: room.code,
      host: room.players.get(room.hostId)?.name || '',
      players: room.players.size,
      max: MAX_PLAYERS,
      game: s.game,
      mode: s.mode,
      arena: s.arena,
      theme: s.theme,
      playing: room.phase !== 'lobby',
    });
  }
  list.sort((x, y) => x.playing - y.playing || y.players - x.players || (x.code < y.code ? -1 : 1));
  return list.slice(0, 40);
}

function roundInfo(room) {
  const g = room.game;
  return {
    arena: g.arenaId,
    theme: g.themeId,
    mode: g.mode,
    duration: g.duration,
    twist: g.twist,
    it: g.startIt, // who starts as it (-1 in a team battle)
    bombs: g.teams ? g.sim.bombPlan : null, // team battle: who starts with a bomb
    random: g.random, // what was left to chance: { arena, theme }
    teams: g.teams, // team battle: team (0 or 1) of each slot; otherwise null
    cols: g.cols, // which player colour each slot is drawn in this round
    cup: g.cup, // null, or { round, rounds, double, leader }
    playing: g.state === 'playing',
    countdown: Math.max(0, g.goAt - Date.now()),
    // everyone in this round: the real players still in it, and any bots filling in (bot: true)
    players: [
      ...[...room.players.values()].filter((p) => p.playing).map((p) => ({ slot: p.slot, name: p.name })),
      ...[...g.bots.keys()].map((slot) => ({ slot, name: g.names[slot], bot: true })),
    ],
  };
}

// The stage plan: an arena and a style for every round a tournament can have
// (a quick match is round 1). 'random' leaves it to the draw.
const MAX_ROUNDS = Math.max(...CUP_ROUNDS);
const okArena = (v) => v === 'random' || ARENA_IDS.includes(v);
const okTheme = (v) => v === 'random' || THEME_IDS.includes(v);
const newPlan = (arena, theme) => Array.from({ length: MAX_ROUNDS }, () => ({ arena, theme }));

// How many players are on each side of a room.
function sideSizes(room) {
  const sizes = [0, 0];
  for (const p of room.players.values()) sizes[p.side]++;
  return sizes;
}

function addPlayer(room, socket, name) {
  // The lowest free place. Bots filling in for the round in progress hold the
  // highest ones; a newcomer only takes one of those if nothing else is left
  // (they watch this round anyway, and the bot is gone by the next).
  const used = new Set([...room.players.values()].map((p) => p.slot));
  const bots = room.game ? room.game.bots : new Map();
  let slot = 0;
  while (used.has(slot) || bots.has(slot)) slot++;
  if (slot >= MAX_PLAYERS) for (slot = 0; used.has(slot); ) slot++;
  // Sides belong to the room: a newcomer joins the smaller one (a coin toss if
  // they are level) and stays there until they - or the host - change it.
  const sizes = sideSizes(room);
  const side = sizes[0] === sizes[1] ? (Math.random() < 0.5 ? 0 : 1) : sizes[0] < sizes[1] ? 0 : 1;
  const player = { id: socket.id, name: uniqueName(room, name), slot, side, playing: false, wins: 0, pts: 0, itMs: 0, rtt: 0 };
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
    clearTimeout(room.nextTimer);
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
    // nobody left to play against: fewer than two real players, or (in a team
    // battle) a side with nobody on it, not even a bot
    const left = g.sim.active();
    const real = left.filter((p) => !g.bots.has(p.slot));
    if (real.length < 2 || (g.sim.teams && !(left.some((p) => p.team === 0) && left.some((p) => p.team === 1)))) {
      finishRound(room, 'forfeit');
      return;
    }
  } else if (!g && room.cup && room.players.size < MIN_PLAYERS) {
    endCup(room); // between rounds and nobody left to play against
  }
  emitRoom(room);
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
function startCup(room) {
  room.cup = { round: 0, rounds: room.settings.rounds, arenas: [], lastTwist: '', teamPts: [0, 0] };
  for (const p of room.players.values()) {
    p.pts = 0;
    p.itMs = 0;
  }
}

function endCup(room) {
  clearTimeout(room.nextTimer);
  room.nextTimer = null;
  room.cup = null;
  room.phase = 'lobby';
}

function startRound(room) {
  clearTimeout(room.nextTimer);
  room.nextTimer = null;
  const s = room.settings;
  const cup = room.cup;
  // what this round is played on: the plan's entry for it (a quick match is round 1)
  const stage = s.plan[cup ? Math.min(cup.round, MAX_ROUNDS - 1) : 0];
  let arenaId = stage.arena;
  if (arenaId === 'random') {
    if (cup) {
      // a tournament visits every arena before repeating one
      if (!cup.arenas.length) cup.arenas = shuffled(ARENA_IDS).filter((id, i, all) => all.length < 2 || i > 0 || id !== room.lastArena);
      arenaId = cup.arenas.shift();
    } else arenaId = pick(ARENA_IDS, room.lastArena);
  }
  const themeId = stage.theme === 'random' ? pick(THEME_IDS, room.lastTheme) : stage.theme;
  const random = { arena: stage.arena === 'random', theme: stage.theme === 'random' }; // what was left to chance this round
  room.lastArena = arenaId;
  room.lastTheme = themeId;

  const sim = new Sim(arenaById(arenaId));
  sim.powerups = s.powerups;
  let twist = 'none';
  let info = null;
  let startIt = -1;
  if (cup) {
    cup.round++;
    const last = cup.round === cup.rounds;
    if (cup.round % 2 === 0 && !last) {
      twist = pick(TWISTS.slice(1).map((t) => t.id), cup.lastTwist);
      cup.lastTwist = twist;
    }
    if (cup.round > 1) {
      // the leader starts as it (a tie for the lead is settled by a coin toss)
      const all = [...room.players.values()];
      const top = Math.max(...all.map((p) => p.pts));
      if (top > 0) startIt = pick(all.filter((p) => p.pts === top).map((p) => p.slot));
    }
    info = { round: cup.round, rounds: cup.rounds, double: last, leader: startIt };
  }
  sim.twist = twistById(twist);

  // Team battle: two sides, exactly as the room has them - nothing is redrawn
  // from round to round or from match to match. If one side is short, bots
  // fill it up for this round.
  const everyone = [...room.players.values()];
  const mode = s.mode;
  let teams = null;
  let cols = null;
  const bots = new Map(); // slot -> the bot's memory
  const names = [];
  for (const p of everyone) names[p.slot] = p.name;
  if (mode === 'team' && MAX_PLAYERS - everyone.length < 1 && sideSizes(room).includes(0)) {
    // a full room all on one side, and no place left for a bot to stand against them: deal the sides out evenly
    makeTeams(everyone).forEach((list, t) => list.forEach((p) => (p.side = t)));
  }
  const fill = mode === 'team' ? botFill(sideSizes(room), MAX_PLAYERS - everyone.length) : [0, 0];
  const botSide = new Map(); // slot -> side
  if (fill[0] + fill[1] > 0) {
    // bots take the highest free places and the first names nobody else has
    const free = [];
    for (let slot = MAX_PLAYERS - 1; slot >= 0; slot--) if (names[slot] === undefined) free.push(slot);
    const taken = new Set(everyone.map((p) => p.name.toLowerCase()));
    const pool = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
    for (const t of [0, 1]) {
      for (let k = 0; k < fill[t]; k++) {
        const slot = free.shift();
        names[slot] = pool.shift() || `Bot ${slot + 1}`;
        botSide.set(slot, t);
        bots.set(slot, makeBot(Math.floor(Math.random() * 1e6) + slot));
      }
    }
  }
  if (mode === 'team') {
    teams = new Array(MAX_PLAYERS).fill(-1);
    cols = new Array(MAX_PLAYERS).fill(0);
    const seen = [0, 0];
    const join = (slot, t) => {
      teams[slot] = t;
      cols[slot] = TEAM_SLOTS[t][seen[t]++ % TEAM_SLOTS[t].length]; // one side in warm colours, the other in cool ones
    };
    for (const p of everyone) join(p.slot, p.side);
    for (const [slot, t] of botSide) join(slot, t);
  }

  // start positions: shuffled; in a team battle each side starts on its own half
  const arena = sim.arena;
  const order = shuffled([...arena.spawns.keys()]);
  const half = [order.filter((i) => arena.spawns[i][0] < arena.w / 2), order.filter((i) => arena.spawns[i][0] >= arena.w / 2)];
  const net = new Array(MAX_PLAYERS).fill(null);
  let i = 0;
  const place = (slot) => {
    const spot = teams && half[teams[slot]].length ? half[teams[slot]].shift() : order[i];
    i++;
    sim.add(slot, spot);
  };
  for (const p of everyone) {
    p.playing = true;
    place(p.slot);
    net[p.slot] = { q: [], recv: 0, lastSeq: 0, budget: 0, idle: 0, win: 0, spare: Infinity, late: 0, trimmed: 0, skipped: 0, id: p.id };
  }
  for (const slot of bots.keys()) place(slot);
  if (bots.size) prepareBots(arena); // their route map, worked out now rather than on the first tick of the round
  if (teams) {
    sim.setTeams(teams); // (this also draws who starts with a bomb)
    startIt = -1; // nobody is "it" in a team battle, and the leader rule is for free-for-all tournaments
    if (info) info.leader = -1;
  } else if (startIt < 0) startIt = pick(everyone.map((p) => p.slot)); // drawn now, so every screen can show the draw
  room.game = {
    sim,
    net,
    arenaId,
    themeId,
    mode,
    duration: s.duration,
    twist,
    cup: info,
    startIt,
    teams,
    cols,
    random,
    bots, // slot -> memory of each bot filling in
    names, // slot -> name of everyone who started this round (bots too)
    state: 'countdown',
    goAt: Date.now() + DRAW_MS + COUNTDOWN_MS + 500, // the draw, then 3-2-1
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
    // per-player input stats: late = ticks spent waiting for an input, trimmed = extra steps to shed a pile-up, skipped = dropped after a stall
    const played = g.sim.tick - (g.endTick - g.duration * TICK_RATE);
    console.log(`[net ${room.code}] ${played} ticks |`, g.net.map((n, i) => (n ? `p${i} received=${n.recv} late=${n.late} trimmed=${n.trimmed} skipped=${n.skipped} queued=${n.q.length}` : '')).filter(Boolean).join(' | '));
  }
  const names = g.names; // as the round started: someone who left meanwhile keeps their name on the board
  const cup = room.cup;
  const forfeit = reason === 'forfeit';
  const team = g.mode === 'team';
  if (!forfeit) g.sim.finish(); // (already done when the clock ran out; this is for safety)
  let { rows, winners, loser, score, win } = standings(g.sim, names, team ? 'team' : cup ? 'time' : g.mode);
  if (cup && !team) loser = g.sim.it;
  if (forfeit) {
    // everyone else left: whoever stayed wins, whatever the clock says
    winners = rows.map((r) => r.slot);
    loser = -1;
  }
  const bySlot = new Map([...room.players.values()].map((p) => [p.slot, p]));
  const gained = cup && !team && !forfeit ? cupPoints(g.sim, g.cup.double) : {};
  for (const p of room.players.values()) {
    if (!p.playing) continue;
    if (cup) {
      p.pts += gained[p.slot] || 0;
      p.itMs += Math.round((g.sim.players[p.slot].itTicks * 1000) / TICK_RATE);
    } else if (winners.includes(p.slot)) p.wins++;
    p.playing = false;
  }

  const out = {
    reason, // 'time' | 'forfeit'
    mode: team ? 'team' : cup ? 'cup' : g.mode,
    winners, // slots
    loser, // slot of whoever was "it" at the end, or -1
    // ms: time as it (team battle: with a bomb in hand); tags: tags made (bombs passed); boom: a bomb went off on them; caps: flags taken
    rows: rows.map((r) => ({ slot: r.slot, name: r.name, ms: Math.round((r.ticks * 1000) / TICK_RATE), tags: r.tags, pts: gained[r.slot] || 0, team: r.team, boom: !!r.boom, caps: r.caps || 0, bot: g.bots.has(r.slot) })),
    team: team ? { score, win, total: null } : null, // team battle: this round's score, who won it (-1: a draw)
    cup: null,
  };
  if (cup) {
    const final = cup.round >= cup.rounds || forfeit || room.players.size < MIN_PLAYERS;
    let table = [];
    if (team) {
      // the last round counts double here too
      const k = g.cup.double ? 2 : 1;
      cup.teamPts[0] += score[0] * k;
      cup.teamPts[1] += score[1] * k;
      out.team.total = cup.teamPts.slice();
      if (final) {
        const [a, b] = cup.teamPts;
        const best = a === b ? -1 : a > b ? 0 : 1;
        out.team.win = best;
        out.winners = rows.filter((r) => best < 0 || r.team === best).map((r) => r.slot);
      }
    } else {
      // the table: most points first, less time as it breaks ties
      table = [...room.players.values()]
        .sort((a, b) => b.pts - a.pts || a.itMs - b.itMs || a.slot - b.slot)
        .map((p) => ({ slot: p.slot, name: p.name, pts: p.pts, ms: p.itMs, gained: gained[p.slot] || 0 }));
      if (final) {
        const best = table[0];
        out.winners = table.filter((r) => r.pts === best.pts && r.ms === best.ms).map((r) => r.slot);
      }
    }
    out.cup = { round: cup.round, rounds: cup.rounds, double: g.cup.double, final, next: final ? 0 : BREAK_MS, table };
    if (final) {
      for (const slot of out.winners) if (bySlot.has(slot)) bySlot.get(slot).wins++;
      room.cup = null;
    } else {
      room.nextAt = Date.now() + BREAK_MS;
      room.nextTimer = setTimeout(() => {
        room.nextTimer = null;
        if (rooms.get(room.code) !== room || room.game || !room.cup) return;
        if (room.players.size < MIN_PLAYERS) {
          endCup(room);
          emitRoom(room);
        } else startRound(room);
      }, BREAK_MS);
    }
  }
  room.results = out;
  room.game = null;
  room.phase = 'results';
  io.to(room.code).emit('end', out);
  emitRoom(room);
  updateLoop();
}

function flushEvents(room) {
  const sim = room.game.sim;
  for (const e of sim.events) {
    if (e.type === 'tag') io.to(room.code).emit('tag', e.from, e.to);
    else if (e.type === 'block') io.to(room.code).emit('block', e.from, e.to);
    else if (e.type === 'pick') io.to(room.code).emit('pick', e.slot, e.kind, e.point);
    else if (e.type !== 'spawn') io.to(room.code).emit('ev', e); // items going off, the bomb, flags
  }
  sim.events.length = 0;
}

// Which input(s) to apply for a player this tick.
//
// The browser predicts its own player by running the physics once per input,
// so the server must do exactly the same: one step per input, never an
// invented one. Then both always agree and the player never gets nudged.
// Packets do not arrive evenly though, so:
//   * nothing has arrived (a late packet): wait - this player simply does not
//     move this tick. Nobody guesses what they pressed.
//   * the late inputs turn up together: catch up, at most 3 steps in a tick,
//     and never more steps in total than ticks have passed (the "budget"), so
//     sending inputs faster than real time gains nothing.
//   * silent for 200 ms: stop waiting and carry on with no keys held.
//   * inputs keep piling up for a whole second (clocks drifting apart): run
//     one extra step to trim the pile, so lag never builds up.
//   * a real stall (a quarter second of inputs at once): skip to the newest.
const NO_INPUT = [];

function nextInput(n) {
  const d = n.q.shift();
  n.lastSeq = d.seq;
  return d.bits;
}

function takeInputs(n) {
  if (n.budget < 12) n.budget++;
  if (n.q.length > 15) {
    while (n.q.length > 4) {
      nextInput(n);
      n.skipped++;
    }
  }
  if (n.q.length === 0) {
    n.win = 0;
    n.spare = Infinity;
    n.late++;
    return ++n.idle > 12 ? [0] : NO_INPUT;
  }
  n.idle = 0;
  const out = [];
  while (n.q.length && n.budget > 0 && out.length < 3) {
    out.push(nextInput(n));
    n.budget--;
  }
  if (n.q.length < n.spare) n.spare = n.q.length;
  if (++n.win >= TICK_RATE) {
    const unused = n.spare;
    n.win = 0;
    n.spare = Infinity;
    if (unused >= 2 && n.q.length && out.length < 3) {
      out.push(nextInput(n));
      n.trimmed++;
    }
  }
  return out;
}

function tickRoom(room) {
  const g = room.game;
  const sim = g.sim;

  if (g.state === 'countdown') {
    // Players stand frozen on their spawn points until GO.
    for (let slot = 0; slot < MAX_PLAYERS; slot++) sim.stepOne(slot, 0);
    sim.endTick();
    sim.events.length = 0;
    if (Date.now() >= g.goAt) {
      g.state = 'playing';
      room.phase = 'playing';
      sim.start(g.startIt);
      g.endTick = sim.tick + g.duration * TICK_RATE;
      sim.endsAt = g.endTick; // items lock shortly before this
      io.to(room.code).emit('go', sim.it, sim.bombs());
      emitRoom(room);
    }
  } else {
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      if (!sim.players[slot]) continue;
      const bot = g.bots.get(slot);
      if (bot) {
        sim.stepOne(slot, botThink(sim, slot, bot)); // a bot filling in: one step a tick, no network in between
        continue;
      }
      const n = g.net[slot];
      for (const bits of takeInputs(n)) sim.stepOne(slot, bits);
      // How far in the past this player sees everyone else: the round trip to
      // them and back, the smoothing delay, and whatever waits in their queue.
      const rtt = room.players.get(n.id)?.rtt || 0;
      sim.rewind[slot] = Math.min(40, Math.round(rtt / TICK_MS) + VIEW_DELAY_TICKS + n.q.length);
    }
    sim.endTick();
    if (sim.tick >= g.endTick && !sim.over) {
      // the buzzer: in a team battle the bombs go off now, and everyone gets a moment to see it
      sim.finish();
      g.doneTick = sim.tick + (sim.teams ? BOMB_END_TICKS : 0);
    }
    flushEvents(room);
    if (sim.over && sim.tick >= g.doneTick) {
      sendSnapshot(room);
      finishRound(room, 'time');
      return;
    }
  }
  if (sim.tick % SNAP_EVERY === 0) sendSnapshot(room);
}

// Snapshot, one per player because each also gets their own full state:
//   [tick, playing, itSlot, ticksLeft | msToGo, players[], boxes[], mine, goo[], team]
//   player: [slot, x, y, vx, vy, flags, immune, itTicks, tags, item]   (item: 0 or kind + 1, +16 while it is being drawn)
//   boxes:  indices of the box spots that have a box
//   mine:   [ackSeq, ...packState(mine)] or 0 for spectators
//   goo:    [x, y] of every puddle
//   team:   0, or [score0, score1, bombs (one bit per slot), over, then for each flag: fill (-cap..cap), owner (-1, 0, 1)]
function sendSnapshot(room) {
  const g = room.game;
  const sim = g.sim;
  const ps = [];
  for (const pl of sim.players) {
    if (!pl) continue;
    const s = pl.s;
    ps.push([pl.slot, s.x, s.y, s.vx, s.vy, publicFlags(s), pl.immune, pl.itTicks, pl.tags, pl.item + (pl.arm > 0 ? 16 : 0)]);
  }
  const playing = g.state === 'playing';
  const left = playing ? Math.max(0, g.endTick - sim.tick) : Math.max(0, g.goAt - Date.now());
  const goo = sim.goo.map((p) => [Math.round(p.x), Math.round(p.y)]);
  let team = 0;
  if (sim.teams) {
    let mask = 0;
    for (const pl of sim.players) if (pl && pl.bomb) mask |= 1 << pl.slot;
    team = [sim.score[0], sim.score[1], mask, sim.over ? 1 : 0];
    for (const f of sim.flags) team.push(f.m, f.owner);
  }
  const head = [sim.tick, playing ? 1 : 0, sim.it, left, ps, sim.boxes];
  for (const p of room.players.values()) {
    const pl = p.playing ? sim.players[p.slot] : null;
    const mine = pl ? [g.net[p.slot].lastSeq, ...packState(pl.s)] : 0;
    io.to(p.id).volatile.emit('s', [...head, mine, goo, team]);
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
    const name = cleanName(msg?.name);
    if (!name) return ack({ error: 'Enter your name first.', needName: true });
    leaveRoom(socket);
    const code = makeCode();
    if (!code) return ack({ error: 'Every room code is in use. Try again in a minute.' });
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      phase: 'lobby',
      // open: anyone can find the room under "Public"; otherwise it takes the code
      // arena / theme: what round 1 (and a quick match) is played on; plan: the same for every round of a tournament
      settings: { game: 'quick', rounds: DEFAULT_CUP_ROUNDS, mode: MODE_IDS[0], arena: 'random', theme: DEFAULT_THEME, duration: DEFAULT_DURATION, powerups: true, open: msg?.open === true, plan: newPlan('random', DEFAULT_THEME) },
      game: null,
      cup: null,
      nextTimer: null,
      results: null,
      lastArena: null,
      lastTheme: null,
    };
    rooms.set(code, room);
    addPlayer(room, socket, name);
    ack({ ok: true, id: socket.id, room: roomState(room) });
  });

  socket.on('join', (msg, ack) => {
    if (typeof ack !== 'function') return;
    const name = cleanName(msg?.name);
    if (!name) return ack({ error: 'Enter your name first.', needName: true });
    const code = String(msg?.code ?? '')
      .replace(/\D/g, '')
      .slice(0, CODE_LEN);
    const room = rooms.get(code);
    if (!room) return ack({ error: code.length === CODE_LEN ? `No room ${code}. Check the code and try again.` : 'Room codes are 4 digits.' });
    if (room.players.has(socket.id)) return ack({ ok: true, id: socket.id, room: roomState(room) });
    if (room.players.size >= MAX_PLAYERS) return ack({ error: `That room is full (${MAX_PLAYERS} players max). Ask the host to make room, or host your own.` });
    leaveRoom(socket);
    const player = addPlayer(room, socket, name);
    ack({ ok: true, id: socket.id, room: roomState(room) });
    socket.to(room.code).emit('toast', `${player.name} joined`);
    emitRoom(room);
    // Arrived mid-match: watch this round, play the next one.
    if (room.game) socket.emit('round', roundInfo(room));
    else if (room.phase === 'results' && room.results) {
      const r = room.results;
      socket.emit('end', r.cup && !r.cup.final ? { ...r, cup: { ...r.cup, next: Math.max(0, room.nextAt - Date.now()) } } : r);
    }
  });

  // The list of public games (the client asks again every couple of seconds while it is looking).
  socket.on('list', (ack) => {
    if (typeof ack === 'function') ack({ rooms: publicRooms() });
  });

  socket.on('leave', () => leaveRoom(socket));
  socket.on('disconnect', () => {
    clearInterval(probe);
    leaveRoom(socket);
  });

  socket.on('settings', (msg) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game || room.cup) return;
    const s = room.settings;
    if (msg?.game === 'quick' || msg?.game === 'cup') {
      // a tournament is a team affair unless the host says otherwise
      if (msg.game === 'cup' && s.game !== 'cup' && msg.mode === undefined) s.mode = 'team';
      s.game = msg.game;
    }
    if (CUP_ROUNDS.includes(msg?.rounds)) s.rounds = msg.rounds;
    if (MODE_IDS.includes(msg?.mode)) s.mode = msg.mode;
    // an arena or a style for every round at once...
    if (okArena(msg?.arena)) for (const st of s.plan) st.arena = msg.arena;
    if (okTheme(msg?.theme)) for (const st of s.plan) st.theme = msg.theme;
    // ...or for one round of a tournament: stage = { i: 0-based round, arena?, theme? }
    const st = Number.isInteger(msg?.stage?.i) ? s.plan[msg.stage.i] : null;
    if (st) {
      if (okArena(msg.stage.arena)) st.arena = msg.stage.arena;
      if (okTheme(msg.stage.theme)) st.theme = msg.stage.theme;
    }
    s.arena = s.plan[0].arena;
    s.theme = s.plan[0].theme;
    if (DURATIONS.includes(msg?.duration) || (TEST_DURATION && msg?.duration === TEST_DURATION)) s.duration = msg.duration;
    if (typeof msg?.powerups === 'boolean') s.powerups = msg.powerups;
    if (typeof msg?.open === 'boolean') s.open = msg.open;
    emitRoom(room);
  });

  // Team battle: pick your own side. Only in the lobby - once a match or a
  // tournament is on, the sides are locked.
  // (The host can also move someone else: pass their id.)
  socket.on('side', (t, id) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.game || room.cup || (t !== 0 && t !== 1)) return;
    const other = typeof id === 'string' && id !== socket.id;
    if (other && room.hostId !== socket.id) return;
    const player = room.players.get(other ? id : socket.id);
    if (!player) return;
    player.side = t;
    emitRoom(room);
  });

  // Host: deal everyone out afresh, as evenly as possible.
  socket.on('shuffle', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game || room.cup) return;
    makeTeams([...room.players.values()]).forEach((list, t) => list.forEach((p) => (p.side = t)));
    io.to(room.code).emit('toast', 'The teams were shuffled');
    emitRoom(room);
  });

  socket.on('start', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game || room.cup) return;
    if (room.players.size < MIN_PLAYERS) return socket.emit('toast', 'Need at least 2 players to start.');
    if (room.settings.game === 'cup') startCup(room);
    startRound(room);
  });

  // Host: back to the lobby from the results screen (to change settings, or to end a tournament early).
  socket.on('lobby', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game) return;
    endCup(room); // also stops a tournament that is between rounds
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
  console.log(`Onigokko running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  io.close();
  http.close(() => process.exit(0));
});
