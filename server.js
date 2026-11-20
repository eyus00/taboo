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
  VS_MS,
  CUP_SCORES,
  TEAM_SLOTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX,
  CODE_LEN,
  DURATIONS,
  DEFAULT_DURATION,
  THEME_IDS,
  MODE_IDS,
  CUP_ROUNDS,
  DEFAULT_CUP_ROUNDS,
  CUP_BREAK_MS,
  TWISTS,
  twistById,
  IN_MASK,
  ITEM_KINDS,
} from './shared/config.js';
import { ARENAS, ARENA_IDS, arenaById, arenasFor, arenaFits } from './shared/arenas.js';
import { Sim, standings, makeTeams } from './shared/sim.js';
import { makeBot, botThink, prepareBots, BOT_NAMES } from './shared/bots.js';
import { packState, publicFlags } from './shared/physics.js';
import { CHAT_MAX, cleanText, soften, makeSpeaker, take, makeLog, remember } from './chat.js';
import { makeAccounts, NEED_ROUNDS } from './accounts.js';
import { timingSafeEqual, createHash } from 'node:crypto';

const DEFAULT_SIZE = 6; // seats in a new room

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// The automated tests play very short rounds with short breaks; nothing else can ask for them.
const TEST_DURATION = Number(process.env.TAG_TEST_DURATION) || 0;
const BREAK_MS = Number(process.env.TAG_TEST_BREAK) || CUP_BREAK_MS;
const DRAW_MS = Number(process.env.TAG_TEST_INTRO) || INTRO_MS;
// (the walk-on before the draw: none in the tests' short rounds, unless asked for)
const WALK_MS = process.env.TAG_TEST_VS != null ? Number(process.env.TAG_TEST_VS) || 0 : process.env.TAG_TEST_INTRO ? 0 : VS_MS;

// Other players are drawn this many ticks in the past on every screen
// (see INTERP_TICKS in public/js/net.js). Used for lag-compensated tagging.
const VIEW_DELAY_TICKS = 6;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // (behind the host's proxy: an address is the visitor's, not the proxy's)
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

const staticOpts = {
  setHeaders(res, file) {
    // Fonts never change; everything else revalidates so deploys show up at once.
    res.setHeader('Cache-Control', /\.woff2$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
  },
};
app.use('/shared', express.static(path.join(__dirname, 'shared'), staticOpts));
app.use(express.static(path.join(__dirname, 'public'), staticOpts));

// --- the owner's page (public/admin.html): accounts, reset codes, stopping new ones ---
// Only with ADMIN_KEY set, and only for whoever has it. Ten wrong keys from one address
// and that address is turned away for an hour.
const adminFails = new Map(); // address -> [count, since]
app.post('/api/admin', express.json({ limit: '2kb' }), async (req, res) => {
  const key = process.env.ADMIN_KEY || '';
  if (!key || key.length < 8) return res.status(404).json({ error: 'There is no admin page on this server (ADMIN_KEY is not set).' });
  const from = req.ip || 'x';
  const f = adminFails.get(from);
  if (f && Date.now() - f[1] > 3600000) adminFails.delete(from);
  if ((adminFails.get(from)?.[0] || 0) >= 10) return res.status(429).json({ error: 'Too many wrong keys. Try again in an hour.' });
  const given = createHash('sha256').update(String(req.body?.key || '')).digest();
  if (!timingSafeEqual(given, createHash('sha256').update(key).digest())) {
    adminFails.set(from, [(adminFails.get(from)?.[0] || 0) + 1, adminFails.get(from)?.[1] || Date.now()]);
    return res.status(401).json({ error: 'That is not the key.' });
  }
  if (!accounts) return res.json({ off: true, error: 'Accounts are off on this server (no database, or it cannot be reached).' });
  const id = Number(req.body.id);
  try {
    const A = accounts.admin;
    const act = String(req.body.action || 'overview');
    let out;
    if (act === 'overview') out = await A.overview();
    else if (act === 'find') out = { account: await A.find(id) };
    else if (act === 'reset') out = await A.reset(id);
    else if (act === 'close' || act === 'open') out = await A.ban(id, act === 'close');
    else if (act === 'delete') out = await A.remove(id);
    else if (act === 'pause' || act === 'resume') out = await A.pause(act === 'pause');
    else return res.status(400).json({ error: 'Unknown action.' });
    // (whoever was signed in to an account that is closed or gone is signed out where they sit)
    if ((act === 'close' || act === 'delete' || act === 'reset') && out.ok) {
      for (const s of acctSockets(id)) {
        s.data.acct = null;
        s.data.token = null;
        s.emit('acct', { out: true });
      }
    }
    res.json(out);
  } catch (err) {
    res.status(503).json({ error: `The database did not answer (${err.message}). Try again in a moment.` });
  }
});

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

// Everyone who plays in a room: the people in it, and the bots keeping the other seats warm.
const members = (room) => [...room.players.values(), ...room.bots.values()];
// How many will play the next round (the stages are fitted to this).
const headcount = (room) => Math.max(MIN_PLAYERS, room.players.size + room.bots.size);
// A knockout tournament: every round the oni at the buzzer is out, until one is left.
const isKnockout = (s) => s.game === 'cup' && s.mode !== 'team';
// Who is still in it (everyone, unless a knockout is on).
const stillIn = (room) => members(room).filter((p) => !p.out);
// Of the stages that fit, the ones built for the smallest crowd: a knockout moves to smaller ground as the field thins.
const snuggest = (ids) => {
  const most = (id) => ARENAS.find((a) => a.id === id).players[1];
  const least = Math.min(...ids.map(most));
  return ids.filter((id) => most(id) === least);
};

// A room has a number of seats. People sit in them; a bot can sit in any seat
// nobody has (the host puts one there, or takes it away); a seat with nobody
// in it is open. With `settings.bots` on, every open seat gets a bot by
// itself - that is how a room starts. Bots are members of the room like
// anyone else (a place, a side, a score): the first to go when a person
// arrives and there is no open seat.
function addBot(room) {
  // the highest free place (people take the lowest), clear of a bot that is still playing out the round
  const used = new Set(members(room).map((p) => p.slot));
  const busy = room.game ? room.game.bots : new Map();
  let slot = MAX_PLAYERS - 1;
  while (slot > 0 && (used.has(slot) || busy.has(slot))) slot--;
  if (used.has(slot) || busy.has(slot)) for (slot = MAX_PLAYERS - 1; slot > 0 && used.has(slot); ) slot--;
  const sizes = sideSizes(room);
  const id = `bot-${++room.botSeq}`;
  // (in a team game it stands on the side that is short)
  // (one that turns up while a knockout is on sits it out, like anyone who arrives late)
  room.bots.set(id, { id, name: botName(room, slot), slot, side: sizes[0] <= sizes[1] ? 0 : 1, playing: false, wins: 0, pts: 0, itMs: 0, rtt: 0, bot: true, out: !!room.cup?.ko });
}
function botName(room, slot) {
  const taken = new Set(members(room).map((p) => p.name.toLowerCase()));
  return BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) || `Bot ${slot + 1}`;
}
function syncBots(room) {
  const s = room.settings;
  if (s.size < room.players.size) s.size = Math.min(MAX_PLAYERS, room.players.size); // (never fewer seats than people)
  // more members than seats: the bots leave - from the side that has more of the room, the newest
  // first (so someone who walks in, or a seat taken away, leaves the two sides as even as they were)
  while (room.bots.size && room.players.size + room.bots.size > s.size) {
    const sizes = sideSizes(room);
    const newest = [...room.bots.values()].reverse();
    const bot = (sizes[0] !== sizes[1] && newest.find((b) => b.side === (sizes[0] > sizes[1] ? 0 : 1))) || newest[0];
    room.bots.delete(bot.id);
  }
  if (s.bots) while (room.players.size + room.bots.size < s.size) addBot(room);
  // (someone called Zap walks in: the bot called Zap takes another name)
  const people = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  for (const b of room.bots.values()) {
    if (!people.has(b.name.toLowerCase())) continue;
    b.name = '';
    b.name = botName(room, b.slot);
  }
  fitPlan(room);
}

// Team games: someone crossed over and their new side is now two or more
// ahead - a bot from that side crosses the other way, if there is one.
function makeRoom(room, to) {
  const sizes = sideSizes(room);
  if (sizes[to] - sizes[1 - to] < 2) return;
  const bot = [...room.bots.values()].reverse().find((b) => b.side === to);
  if (bot) bot.side = 1 - to;
}

// A stage chosen for a different number of players goes back to Random.
// (In a knockout each round has one player fewer than the one before: round k is fitted to n - k.)
function fitPlan(room) {
  const s = room.settings;
  const n = headcount(room);
  const ko = isKnockout(s);
  s.plan.forEach((st, k) => {
    if (st.arena !== 'random' && !arenaFits(st.arena, ko ? Math.max(MIN_PLAYERS, n - k) : n)) st.arena = 'random';
  });
  s.arena = s.plan[0].arena;
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
    cup: room.cup ? { round: room.cup.round, rounds: room.cup.rounds, ko: !!room.cup.ko } : null,
    // side: which team (0 or 1) the player is on whenever the game is a team battle
    // bot: one of the bots filling the seats nobody has taken (they come after the people)
    players: members(room).map((p) => ({ id: p.id, name: p.name, slot: p.slot, side: p.side, playing: p.playing, wins: p.wins, pts: p.pts, bot: !!p.bot, out: !!p.out })),
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
    const s = room.settings;
    if (!s.open || room.players.size >= s.size) continue;
    list.push({
      code: room.code,
      host: room.players.get(room.hostId)?.name || '',
      players: room.players.size,
      bots: room.bots.size,
      max: s.size,
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
    cup: g.cup, // null, or { round, rounds, double, leader, ko, left }
    items: g.sim.itemPool || [], // which items are in the boxes ([]: all of them)
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
const MAX_ROUNDS = Math.max(...CUP_ROUNDS, MAX_PLAYERS - 1); // (a knockout of ten is nine rounds)
const okArena = (v) => v === 'random' || ARENA_IDS.includes(v);
const okTheme = (v) => v === 'random' || THEME_IDS.includes(v);
const newPlan = (arena, theme) => Array.from({ length: MAX_ROUNDS }, () => ({ arena, theme }));
// What Random draws from: the stages (and the styles) the host has left in the
// draw. An empty list means all of them - and so does a list with nothing in it that can be played.
const drawFrom = (all, chosen) => {
  const left = all.filter((id) => chosen.includes(id));
  return left.length ? left : all;
};
const cleanPool = (list, all) => {
  if (!Array.isArray(list)) return null;
  const ids = all.filter((id) => list.includes(id));
  return ids.length === all.length ? [] : ids;
};

// How many are on each side of a room (bots too, unless asked for the people alone).
function sideSizes(room, bots = true) {
  const sizes = [0, 0];
  for (const p of bots ? members(room) : room.players.values()) sizes[p.side]++;
  return sizes;
}

function addPlayer(room, socket, name) {
  // Sides belong to the room: a newcomer joins the one with fewer people on it (a
  // coin toss if they are level) and stays there until they - or the host - change it.
  const sizes = sideSizes(room, false);
  const side = sizes[0] === sizes[1] ? (Math.random() < 0.5 ? 0 : 1) : sizes[0] < sizes[1] ? 0 : 1;
  // A bot gives up its seat for them, if that is what it takes: the newest one on
  // the side they are joining, so the two sides stay as even as they were.
  while (room.bots.size && room.players.size + room.bots.size >= room.settings.size) {
    const newest = [...room.bots.values()].reverse();
    room.bots.delete((newest.find((b) => b.side === side) || newest[0]).id);
  }
  // The lowest free place. Bots hold the highest ones; one that is still
  // playing out the round in progress only has its place taken if nothing
  // else is left (the newcomer watches this round anyway, and that bot is
  // gone by the next).
  const used = new Set(members(room).map((p) => p.slot));
  const bots = room.game ? room.game.bots : new Map();
  let slot = 0;
  while (used.has(slot) || bots.has(slot)) slot++;
  if (slot >= MAX_PLAYERS) for (slot = 0; used.has(slot); ) slot++;
  // (someone who walks in while a knockout is on watches the rest of it)
  const player = { id: socket.id, name: uniqueName(room, name), slot, side, playing: false, wins: 0, pts: 0, itMs: 0, rtt: 0, out: !!room.cup?.ko };
  room.players.set(socket.id, player);
  socket.join(room.code);
  socket.data.code = room.code;
  syncBots(room);
  return player;
}

// ---------------------------------------------------------------------------
// Chat (see chat.js): a channel for everyone in the menus, and one per room
const GLOBAL_CHAT = process.env.TAG_GLOBAL_CHAT !== 'off'; // (the channel for everyone can be switched off where it is not wanted)
const EPOCH = Date.now(); // when this server started: a client seeing another one knows the chat began again
const allChat = makeLog();
const inChat = () => io.sockets.adapter.rooms.get('chat:all')?.size || 0;
// a line in a room's chat that nobody said ("Hana joined")
const roomNote = (room, text) => io.to(room.code).emit('chat', remember(room.chat, { to: 'room', sys: true, text }));

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
  roomNote(room, `${player.name} left`);
  syncBots(room); // (a bot takes the empty seat, from the next round on)

  const g = room.game;
  if (g && player.playing) {
    g.sim.remove(player.slot); // hands "it" to someone else if needed
    flushEvents(room);
    // nobody left to play against (a bot counts): one player, or - in a team
    // battle - a side with nobody on it
    const left = g.sim.active();
    if (left.length < 2 || (g.sim.teams && !(left.some((p) => p.team === 0) && left.some((p) => p.team === 1)))) {
      finishRound(room, 'forfeit');
      return;
    }
  } else if (!g && room.cup && stillIn(room).length < MIN_PLAYERS) {
    endCup(room); // between rounds and nobody left to play against
  }
  emitRoom(room);
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
// A tournament is a team battle over a number of rounds (the points add up),
// or a knockout: Hot Potato round after round, and every time the oni at the
// buzzer is out - as many rounds as it takes to leave one standing.
function startCup(room) {
  const ko = isKnockout(room.settings);
  const all = members(room);
  room.cup = { round: 0, rounds: ko ? all.length - 1 : room.settings.rounds, arenas: [], lastTwist: '', teamPts: [0, 0], ko, gone: [], score: room.settings.score };
  for (const p of all) {
    p.pts = 0;
    p.itMs = 0;
    p.out = false;
  }
}

function endCup(room) {
  clearTimeout(room.nextTimer);
  room.nextTimer = null;
  room.cup = null;
  room.phase = 'lobby';
  for (const p of members(room)) p.out = false;
}

function startRound(room) {
  clearTimeout(room.nextTimer);
  room.nextTimer = null;
  const s = room.settings;
  const cup = room.cup;
  // what this round is played on: the plan's entry for it (a quick match is round 1)
  const stage = s.plan[cup ? Math.min(cup.round, MAX_ROUNDS - 1) : 0];
  syncBots(room);
  const everyone = stillIn(room); // (in a knockout: whoever has not been caught out yet)
  if (cup?.ko) cup.rounds = cup.round + everyone.length - 1; // one out a round from here (someone may have left)
  // the stages that suit this many players (a small one is chaos with ten in it, a big one empty with two):
  // the draw is among them, and one that was chosen for a different crowd is drawn again
  const fits = arenasFor(everyone.length).filter((id) => ARENA_IDS.includes(id));
  const fitting = fits.length ? fits : ARENA_IDS;
  let arenaId = fitting.includes(stage.arena) ? stage.arena : 'random';
  const drawn = arenaId === 'random';
  if (drawn) {
    let pool = drawFrom(fitting, s.pool.arena); // (the ones the host left in the draw)
    if (cup?.ko) pool = snuggest(pool); // a knockout: smaller ground as the field thins
    if (cup) {
      // a tournament visits every stage before repeating one
      cup.arenas = cup.arenas.filter((id) => pool.includes(id));
      if (!cup.arenas.length) cup.arenas = shuffled(pool).filter((id, i, all) => all.length < 2 || i > 0 || id !== room.lastArena);
      arenaId = cup.arenas.shift();
    } else arenaId = pick(pool, room.lastArena);
  }
  const themeId = stage.theme === 'random' ? pick(drawFrom(THEME_IDS, s.pool.theme), room.lastTheme) : stage.theme;
  const random = { arena: drawn, theme: stage.theme === 'random' }; // what was left to chance this round
  room.lastArena = arenaId;
  room.lastTheme = themeId;

  const sim = new Sim(arenaById(arenaId));
  sim.powerups = s.powerups;
  sim.itemPool = s.items.slice(); // which items are in the boxes ([]: all of them)
  let twist = 'none';
  let info = null;
  let startIt = -1;
  if (cup) {
    cup.round++;
    const last = cup.round === cup.rounds;
    if (cup.round % 2 === 0 && !last && !cup.tie) {
      twist = pick(TWISTS.slice(1).map((t) => t.id), cup.lastTwist);
      cup.lastTwist = twist;
    }
    // ko: a knockout (the oni at the buzzer is out); left: how many are still in it this round
    // score: how a team tournament is decided ('rounds' won, or 'points' added up); total: where the sides stand
    info = { round: cup.round, rounds: cup.rounds, double: last && !cup.ko && !cup.tie, tie: !!cup.tie, leader: -1, ko: cup.ko, left: everyone.length, score: cup.ko ? null : cup.score, total: cup.ko ? null : cup.teamPts.slice() };
  }
  sim.twist = twistById(twist);

  // Team battle: two sides, exactly as the room has them - nothing is redrawn
  // from round to round or from match to match (the bots stand wherever the
  // sides are short).
  const mode = s.mode;
  let teams = null;
  let cols = null;
  const bots = new Map(); // slot -> the bot's memory
  const names = [];
  for (const p of everyone) names[p.slot] = p.name;
  if (mode === 'team' && sideSizes(room).includes(0)) {
    // everyone on one side, and no bot to stand against them: deal the sides out evenly
    makeTeams(everyone).forEach((list, t) => list.forEach((p) => (p.side = t)));
  }
  for (const p of everyone) if (p.bot) bots.set(p.slot, makeBot(Math.floor(Math.random() * 1e6) + p.slot));
  if (mode === 'team') {
    teams = new Array(MAX_PLAYERS).fill(-1);
    cols = new Array(MAX_PLAYERS).fill(0);
    const seen = [0, 0];
    const join = (slot, t) => {
      teams[slot] = t;
      cols[slot] = TEAM_SLOTS[t][seen[t]++ % TEAM_SLOTS[t].length]; // one side in warm colours, the other in cool ones
    };
    for (const p of everyone) join(p.slot, p.side);
  }

  // start positions: shuffled; in a team battle each side starts on its own half
  const arena = sim.arena;
  const order = shuffled([...arena.spawns.keys()]);
  const half = [order.filter((i) => arena.spawns[i][0] < arena.w / 2), order.filter((i) => arena.spawns[i][0] >= arena.w / 2)];
  const net = new Array(MAX_PLAYERS).fill(null);
  let i = 0;
  const place = (slot, auto) => {
    const spot = teams && half[teams[slot]].length ? half[teams[slot]].shift() : order[i];
    i++;
    sim.add(slot, spot);
    if (auto) sim.players[slot].auto = true; // (a bot: see tagFrom in sim.js)
  };
  for (const p of everyone) {
    p.playing = true;
    place(p.slot, !!p.bot);
    if (!p.bot) net[p.slot] = { q: [], recv: 0, lastSeq: 0, budget: 0, idle: 0, win: 0, spare: Infinity, late: 0, trimmed: 0, skipped: 0, id: p.id };
  }
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
    bots, // slot -> memory of each bot playing this round
    names, // slot -> name of everyone who started this round (bots too)
    state: 'countdown',
    goAt: Date.now() + WALK_MS + DRAW_MS + COUNTDOWN_MS + 500, // the walk-on, the draw, then 3-2-1
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
  let { rows, winners, loser, score, win } = standings(g.sim, names, team ? 'team' : g.mode);
  if (forfeit) {
    // everyone else left: whoever stayed wins, whatever the clock says
    winners = rows.map((r) => r.slot);
    loser = -1;
  }
  const bySlot = new Map(members(room).filter((p) => p.playing).map((p) => [p.slot, p])); // (who played this round)
  const gained = {};
  // a knockout: whoever is the oni when the clock runs out is out of the tournament
  const caught = cup?.ko && !forfeit ? bySlot.get(loser) : null;
  if (caught) {
    caught.out = true;
    cup.gone.push({ slot: caught.slot, name: caught.name, round: cup.round, bot: !!caught.bot });
  }
  for (const p of members(room)) {
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
    rows: rows.map((r) => ({ slot: r.slot, name: r.name, ms: Math.round((r.ticks * 1000) / TICK_RATE), tags: r.tags, pts: gained[r.slot] || 0, team: r.team, boom: !!r.boom, caps: r.caps || 0, plus: r.plus || 0, minus: r.minus || 0, bot: g.bots.has(r.slot) })),
    // team battle: this round's score, who won it (-1: a draw) - and how: flags each side held at the buzzer, bombs that went off on each side
    team: team ? { score, win, total: null, held: [0, 1].map((t) => g.sim.flags.filter((f) => f.owner === t).length), blown: [0, 1].map((t) => rows.filter((r) => r.team === t && r.boom).length) } : null,
    cup: null,
  };
  if (cup) {
    let final = cup.ko ? forfeit || stillIn(room).length < MIN_PLAYERS : cup.round >= cup.rounds || forfeit || members(room).length < MIN_PLAYERS;
    let table = [];
    if (team) {
      // As the host chose: rounds won (one for whoever takes a round, two for the last; a
      // drawn round gives nobody anything) - or every point added up (the last round double).
      // Level after the last round: one more round, a tie-break, and another if need be.
      const k = g.cup.double ? 2 : 1;
      if (cup.score === 'points') {
        cup.teamPts[0] += score[0] * k;
        cup.teamPts[1] += score[1] * k;
      } else if (win >= 0) cup.teamPts[win] += k;
      out.team.total = cup.teamPts.slice();
      if (final && !forfeit && members(room).length >= MIN_PLAYERS && cup.teamPts[0] === cup.teamPts[1]) {
        final = false;
        cup.rounds = cup.round + 1;
        cup.tie = true;
      }
      if (final) {
        const [a, b] = cup.teamPts;
        const best = a === b ? -1 : a > b ? 0 : 1;
        out.team.win = best;
        out.winners = rows.filter((r) => best < 0 || r.team === best).map((r) => r.slot);
      }
    } else {
      // the table of a knockout: whoever is still in (less time as the oni first), then the ones who went out, the last to go first
      // (out: the round they went out in, 0 while they are still in)
      const row = (p, round) => ({ slot: p.slot, name: p.name, pts: 0, ms: p.itMs || 0, gained: 0, bot: !!p.bot, out: round });
      const ms = new Map(members(room).map((p) => [p.slot, p.itMs]));
      table = [
        ...stillIn(room).filter((p) => bySlot.has(p.slot)).sort((a, b) => a.itMs - b.itMs || a.slot - b.slot).map((p) => row(p, 0)),
        ...cup.gone.slice().reverse().map((q) => row({ ...q, itMs: ms.get(q.slot) }, q.round)),
      ];
      if (final) out.winners = table.filter((r) => !r.out).map((r) => r.slot); // the last one standing
    }
    out.cup = { round: cup.round, rounds: cup.rounds, score: cup.ko ? null : cup.score, double: g.cup.double, tie: !!cup.tie && !final, final, next: final ? 0 : BREAK_MS, table, ko: cup.ko, caught: caught ? caught.slot : -1 };
    if (final) {
      for (const slot of out.winners) if (bySlot.has(slot)) bySlot.get(slot).wins++;
      room.cup = null;
      for (const p of members(room)) p.out = false;
    } else {
      room.nextAt = Date.now() + BREAK_MS;
      room.nextTimer = setTimeout(() => {
        room.nextTimer = null;
        if (rooms.get(room.code) !== room || room.game || !room.cup) return;
        if (stillIn(room).length < MIN_PLAYERS) {
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
  afterRound(room, out, [...bySlot.values()].filter((p) => !p.bot), g, cup);
  emitRoom(room);
  updateLoop();
}

// ---------------------------------------------------------------------------
// Accounts (see accounts.js). There are none unless a database is given
// (DATABASE_URL): the game is the same without them.
// ---------------------------------------------------------------------------
let accounts = null;
async function openAccounts() {
  let query = null;
  if (process.env.TAG_TEST_DB === 'memory') {
    // (the tests: a real Postgres, in memory)
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    query = (text, params) => db.query(text, params);
  } else if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
    pool.on('error', (err) => console.log(`accounts: the database dropped a connection (${err.message})`)); // (a sleeping database does: the next query opens another)
    // one more try when the connection itself failed: a database that was asleep is awake by then
    query = async (text, params) => {
      try {
        return await pool.query(text, params);
      } catch (err) {
        if (err.code && /^[0-9A-Z]{5}$/.test(err.code) && !err.code.startsWith('08') && !err.code.startsWith('57')) throw err; // (the database answered: it is the question that is wrong)
        return pool.query(text, params);
      }
    };
  }
  if (!query) return console.log('Accounts are off (no DATABASE_URL): records stay in each browser.');
  if (!process.env.PIN_SECRET) console.log('accounts: PIN_SECRET is not set - set one (any long random text) and keep it: PINs are hashed with it.');
  const secret = process.env.PIN_SECRET || createHash('sha256').update(`fallback:${process.env.DATABASE_URL || 'memory'}`).digest('hex');
  const a = makeAccounts({ query, secret, perHour: Number(process.env.TAG_SIGNUPS_PER_HOUR) || 120, need: Number(process.env.TAG_ACCOUNT_ROUNDS) || NEED_ROUNDS, log: console.log });
  try {
    await a.init();
    accounts = a;
    console.log('Accounts are on.');
  } catch (err) {
    console.log(`Accounts are off: the database could not be reached (${err.message}).`);
    setTimeout(openAccounts, 60000).unref(); // (it may only be asleep, or not there yet)
  }
}
const acctSockets = (id) => [...io.sockets.sockets.values()].filter((s) => s.data.acct === id);

// A round has been played to the buzzer. Everyone who played in it has one more round on
// their ticket (three make an account possible); whoever has an account has the round
// counted into their record - here, by the server, not by their browser.
function afterRound(room, out, players, g, cup) {
  if (!accounts || out.reason === 'forfeit') return;
  const ctx = { theme: g.themeId, arena: g.arenaId, duration: g.duration };
  const told = new Map(); // account -> its record after this round
  for (const p of players) {
    const s = io.sockets.sockets.get(p.id);
    if (!s) continue;
    s.data.played = { tid: (s.data.played || accounts.newTicket()).tid, n: (s.data.played?.n || 0) + 1 };
    const msg = { ticket: accounts.ticket(s.data.played), played: s.data.played.n };
    if (s.data.acct) {
      msg.record = accounts.count(s.data.acct, out, { ...ctx, slot: p.slot });
      if (cup && out.cup) (cup.seen ||= new Map()).set(s.data.acct, p.slot); // (they played in this tournament)
      told.set(s.data.acct, msg.record);
    }
    s.emit('acct', msg);
  }
  // a tournament is over: it counts for everyone with an account who played a round of it
  if (cup?.seen && out.cup?.final) {
    for (const [id, slot] of cup.seen) {
      const record = accounts.cup(id, out.cup.ko ? 'ko' : 'team', out.winners.includes(slot));
      if (record) for (const s of acctSockets(id)) s.emit('acct', { record });
    }
  }
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
//   [tick, playing, itSlot, ticksLeft | msToGo, players[], boxes[], mine, [], team]
//   player: [slot, x, y, vx, vy, flags, immune, itTicks, tags, item]   (item: 0 or kind + 1, +16 while it is being drawn)
//   boxes:  indices of the box spots that have a box
//   mine:   [ackSeq, ...packState(mine)] or 0 for spectators
//   []:     (puddles, once; the place is kept so that what follows does not move)
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
    io.to(p.id).volatile.emit('s', [...head, mine, [], team]);
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
      chat: makeLog(), // what has been said in this room (it goes when the room does)
      hostId: socket.id,
      players: new Map(),
      bots: new Map(), // the bots in the seats nobody has taken: id -> the same kind of record as a player
      botSeq: 0,
      phase: 'lobby',
      // open: anyone can find the room under "Public"; otherwise it takes the code
      // size: how many seats (2 to 10); bots: whether every open seat gets a bot by itself
      // pool: what Random draws from, for the stage and for the style ([] is all of them)
      // items: which items are in the lucky boxes ([] is all of them)
      // arena / theme: what round 1 (and a quick match) is played on; plan: the same for every round of a tournament
      settings: { game: 'quick', rounds: DEFAULT_CUP_ROUNDS, mode: MODE_IDS[0], size: DEFAULT_SIZE, bots: true, arena: 'random', theme: 'random', duration: DEFAULT_DURATION, score: CUP_SCORES[0], powerups: true, open: msg?.open === true, plan: newPlan('random', 'random'), pool: { arena: [], theme: [] }, items: [] },
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
    if (room.players.size >= room.settings.size) return ack({ error: `That room is full (${room.settings.size} players). Ask the host to add a seat, or host your own.` });
    leaveRoom(socket);
    const player = addPlayer(room, socket, name);
    ack({ ok: true, id: socket.id, room: roomState(room) });
    socket.to(room.code).emit('toast', `${player.name} joined`);
    roomNote(room, `${player.name} joined`);
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

  // --- accounts ---
  // (every question here is answered, with an error if need be: the page is waiting)
  const acctTurn = makeSpeaker(); // (the same patience as for chat: a burst, then a trickle)
  const acct = (name, fn) =>
    socket.on(name, async (msg, ack) => {
      if (typeof ack !== 'function') return;
      if (!accounts) return ack({ off: true, error: 'There are no accounts on this server.' });
      if (name !== 'acct:hello' && !take(acctTurn, Date.now()).ok) return ack({ error: 'Slow down a little.' });
      try {
        ack(await fn(msg || {}));
      } catch (err) {
        console.log(`accounts: ${name} failed (${err.message})`);
        ack({ error: 'Accounts are waking up. Try again in a moment.' });
      }
    });
  const signedIn = (account, token) => {
    socket.data.acct = account.id;
    socket.data.token = token;
    return { ok: true, token, account };
  };
  const signedOut = async () => {
    const id = socket.data.acct;
    socket.data.acct = null;
    socket.data.token = null;
    if (id && !acctSockets(id).length) await accounts.release(id);
  };
  // What this connection brings along: the ticket of the rounds it has played, and - if this
  // device is signed in - its token.
  acct('acct:hello', async (msg) => {
    socket.data.played = accounts.readTicket(msg.ticket) || socket.data.played || accounts.newTicket();
    const account = msg.token ? await accounts.resume(msg.token) : null;
    if (account) signedIn(account, msg.token);
    return { on: true, need: accounts.need, played: socket.data.played.n, open: !accounts.paused, account, gone: !!msg.token && !account };
  });
  acct('acct:create', async (msg) => {
    if (socket.data.acct) return { error: 'You are signed in already.' };
    const res = await accounts.create({ pin: msg.pin, name: cleanName(msg.name), look: { style: msg.look?.[0], colour: msg.look?.[1] }, record: msg.record, played: socket.data.played });
    return res.ok ? signedIn(res.account, res.token) : res;
  });
  acct('acct:signin', async (msg) => {
    if (socket.data.acct) return { error: 'You are signed in already.' };
    const res = await accounts.signIn(Number(msg.id), msg.pin);
    return res.ok ? signedIn(res.account, res.token) : res;
  });
  acct('acct:reset', async (msg) => {
    if (socket.data.acct) return { error: 'You are signed in already.' };
    const res = await accounts.useReset(Number(msg.id), msg.code, msg.pin);
    return res.ok ? signedIn(res.account, res.token) : res;
  });
  acct('acct:pin', async (msg) => (socket.data.acct ? accounts.setPin(socket.data.acct, msg.pin, socket.data.token) : { error: 'Not signed in.' }));
  acct('acct:save', async (msg) => (socket.data.acct ? accounts.saveProfile(socket.data.acct, { name: cleanName(msg.name), look: { style: msg.look?.[0], colour: msg.look?.[1] } }) : { error: 'Not signed in.' }));
  acct('acct:signout', async (msg) => {
    if (!socket.data.acct) return { ok: true };
    const id = socket.data.acct;
    await accounts.signOut(socket.data.token, { everywhere: !!msg.everywhere, id });
    if (msg.everywhere) {
      for (const s of acctSockets(id)) {
        if (s === socket) continue;
        s.data.acct = null;
        s.data.token = null;
        s.emit('acct', { out: true });
      }
    }
    await signedOut();
    return { ok: true };
  });
  acct('acct:delete', async (msg) => {
    if (!socket.data.acct) return { error: 'Not signed in.' };
    const id = socket.data.acct;
    const res = await accounts.remove(id, msg.pin);
    if (!res.ok) return res;
    for (const s of acctSockets(id)) {
      s.data.acct = null;
      s.data.token = null;
      if (s !== socket) s.emit('acct', { out: true });
    }
    return res;
  });
  socket.on('disconnect', () => {
    const id = socket.data.acct;
    socket.data.acct = null;
    if (id && accounts && !acctSockets(id).length) accounts.release(id).catch(() => {});
  });

  // --- chat ---
  const speaker = makeSpeaker();
  const who = socket.id.slice(0, 6); // (how the others know two messages are from the same connection - to mute it, say)
  // Open the chat: what has been said so far, in the room this socket is in and - if
  // wanted, and from then on - in the channel for everyone.
  socket.on('chat:open', (msg, ack) => {
    if (typeof ack !== 'function') return;
    const all = GLOBAL_CHAT && msg?.all !== false;
    if (all) socket.join('chat:all');
    else socket.leave('chat:all');
    const room = rooms.get(socket.data.code);
    ack({ me: who, epoch: EPOCH, max: CHAT_MAX, global: GLOBAL_CHAT, all: all ? allChat : [], room: room?.players.has(socket.id) ? room.chat : null, online: inChat() });
  });
  socket.on('chat:close', () => socket.leave('chat:all'));
  socket.on('chat:say', (msg, ack) => {
    const done = typeof ack === 'function' ? ack : () => {};
    const to = msg?.to === 'room' ? 'room' : 'all';
    const room = rooms.get(socket.data.code);
    const player = room?.players.get(socket.id);
    if (to === 'room' && !player) return done({ error: 'You are not in a room.' });
    if (to === 'all' && !GLOBAL_CHAT) return done({ error: 'This chat is switched off.' });
    const name = player?.name || cleanName(msg?.name);
    if (!name) return done({ error: 'Enter your name first.', needName: true });
    const text = soften(cleanText(msg?.text));
    if (!text) return done({ error: '' });
    if (text === speaker.last) return done({ error: 'You just said that.' });
    const turn = take(speaker, Date.now());
    if (!turn.ok) return done({ error: turn.shut ? `Too many messages. Chat is back in ${Math.ceil(turn.wait / 1000)} s.` : 'Slow down a little.', wait: turn.wait });
    speaker.last = text;
    // (how they show themselves: one of the styles' characters, in one of its ten colours)
    const look = Array.isArray(msg?.look) && THEME_IDS.includes(msg.look[0]) && Number.isInteger(msg.look[1]) && msg.look[1] >= 0 && msg.look[1] <= 9 ? [msg.look[0], msg.look[1]] : undefined;
    // (no: their account's number, if they have one - shown as "#12" beside the name)
    const m = remember(to === 'room' ? room.chat : allChat, { to, from: who, name, text, look, no: socket.data.acct || undefined });
    if (to === 'room') io.to(room.code).emit('chat', m);
    else {
      socket.join('chat:all'); // (whoever speaks there hears the answer)
      io.to('chat:all').emit('chat', { ...m, online: inChat() });
    }
    done({ ok: true, id: m.id });
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
    if (CUP_SCORES.includes(msg?.score)) s.score = msg.score;
    if (typeof msg?.powerups === 'boolean') s.powerups = msg.powerups;
    if (typeof msg?.open === 'boolean') s.open = msg.open;
    // which items are in the boxes: items = [kinds] (all of them, or none that exist, is [])
    const items = cleanPool(msg?.items, ITEM_KINDS);
    if (items) s.items = items;
    // what Random may draw: pool = { arena?: [ids], theme?: [ids] }
    const arenaPool = cleanPool(msg?.pool?.arena, ARENA_IDS);
    const themePool = cleanPool(msg?.pool?.theme, THEME_IDS);
    if (arenaPool) s.pool.arena = arenaPool;
    if (themePool) s.pool.theme = themePool;
    // how many seats; and bots in every open one (on), or no bots at all (off)
    if (Number.isInteger(msg?.size)) s.size = Math.max(MIN_PLAYERS, room.players.size, Math.min(MAX_PLAYERS, msg.size));
    if (typeof msg?.bots === 'boolean') {
      s.bots = msg.bots;
      if (!msg.bots) room.bots.clear();
    }
    syncBots(room);
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
    const player = other ? room.players.get(id) || room.bots.get(id) : room.players.get(socket.id);
    if (!player || player.side === t) return;
    player.side = t;
    if (!player.bot) makeRoom(room, t); // (a person crossing over: a bot makes room for them, if that keeps the sides level)
    emitRoom(room);
  });

  // Host: deal everyone out afresh, as evenly as possible.
  socket.on('shuffle', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game || room.cup) return;
    // everyone is dealt out afresh, bots too - and never back into the very same sides
    const all = members(room);
    const before = all.map((p) => p.side).join('');
    for (let tries = 0; tries < 8; tries++) {
      makeTeams(all).forEach((list, t) => list.forEach((p) => (p.side = t)));
      if (all.length < 2 || all.map((p) => p.side).join('') !== before) break;
    }
    io.to(room.code).emit('toast', 'The teams were shuffled');
    emitRoom(room);
  });

  // Host: a bot into an open seat ({ add: true }), or one out of its seat ({ remove: id }) - which then stays open.
  socket.on('bot', (msg) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game || room.cup) return;
    if (msg?.add === true) {
      if (room.players.size + room.bots.size >= room.settings.size) return;
      addBot(room);
    } else if (typeof msg?.remove === 'string' && room.bots.has(msg.remove)) {
      room.bots.delete(msg.remove);
      room.settings.bots = false; // (or another would be in the seat at once)
    } else return;
    syncBots(room);
    emitRoom(room);
  });

  // Host: send someone out of the room.
  socket.on('kick', (id) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || typeof id !== 'string' || id === socket.id || !room.players.has(id)) return;
    const other = io.sockets.sockets.get(id);
    if (!other) return;
    other.emit('kicked');
    leaveRoom(other);
  });

  socket.on('start', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.game || room.cup) return;
    if (members(room).length < MIN_PLAYERS) return socket.emit('toast', 'Minimum 2 players');
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

openAccounts();
http.listen(PORT, () => {
  console.log(`Onigokko running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  io.close();
  http.close(() => process.exit(0));
});
