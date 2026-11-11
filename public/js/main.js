// Menus, lobby, and the glue between the network, the game and the renderer.

import { io } from '/socket.io/socket.io.esm.min.js';
import { THEMES, THEME_IDS, PLAYER_COLORS, COLOR_NAMES, DURATIONS, MAX_PLAYERS, MIN_PLAYERS, NAME_MAX } from '/shared/config.js';
import { ARENAS, arenaById } from '/shared/arenas.js';
import { Renderer } from './renderer.js';
import { THEME_MAP } from './themes/index.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { LocalGame } from './local.js';
import { NetGame } from './net.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = null) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const pickRandom = (list, avoid) => {
  const pool = list.length > 1 ? list.filter((x) => x !== avoid) : list;
  return pool[Math.floor(Math.random() * pool.length)];
};

// ---------------------------------------------------------------------------
// Core objects
// ---------------------------------------------------------------------------
const renderer = new Renderer($('stage'));
const input = new Input();
const sfx = new Sfx();
const socket = io({ transports: ['websocket', 'polling'] });
const net = new NetGame(socket, input, onGameEvent);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

let mode = 'backdrop'; // backdrop | practice | net
let local = null; // LocalGame for backdrop / practice
let room = null; // latest room state from the server
let screen = 'home';
let backdropKey = '';
let menuTheme = store.get('tag.style');
if (!THEME_IDS.includes(menuTheme)) menuTheme = pickRandom(THEME_IDS);

input.bindTouch($('touch'));
$('btn-mute').classList.toggle('off', sfx.muted);

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function show(name) {
  screen = name;
  $('home').classList.toggle('hidden', name !== 'home');
  $('lobby').classList.toggle('hidden', name !== 'lobby');
  $('results').classList.toggle('hidden', name !== 'results');
  const inMatch = name === 'game' || name === 'results';
  $('btn-exit').classList.toggle('hidden', !inMatch);
  $('touch').classList.toggle('hidden', !(name === 'game' && isTouch));
  input.active = name === 'game';
}

function applyTheme(id) {
  document.body.dataset.theme = id;
  sfx.setTheme(id);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_MAP[id].letterbox);
}

// A bot match playing behind the menus, in the chosen style.
function showBackdrop(themeId, arenaId = 'random') {
  const key = `${themeId}/${arenaId}`;
  applyTheme(themeId);
  if (mode === 'backdrop' && backdropKey === key && local) return;
  const arena = arenaId === 'random' ? arenaById(pickRandom(ARENAS.map((a) => a.id), local?.arena.id)) : arenaById(arenaId);
  local = new LocalGame({ arena, themeId, bots: 4, backdrop: true });
  mode = 'backdrop';
  backdropKey = key;
  renderer.setScene(arena, themeId);
}

function toHome(message = '') {
  room = null;
  net.round = null;
  history.replaceState(null, '', location.pathname);
  $('home-error').textContent = message;
  $('style-name').textContent = THEMES.find((t) => t.id === menuTheme).name;
  showBackdrop(menuTheme);
  show('home');
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

const me = () => room?.players.find((p) => p.id === socket.id) || null;
const amHost = () => !!room && room.hostId === socket.id;
const playerName = () => {
  const n = $('name').value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return n || 'Player';
};

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
$('name').value = store.get('tag.name', '');
$('name').addEventListener('input', () => store.set('tag.name', $('name').value));
$('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-create').click();
});

function request(event, payload) {
  return new Promise((resolve) => {
    if (!socket.connected) $('home-error').textContent = 'Waking up the server, hang on…';
    socket.timeout(45000).emit(event, payload, (err, res) => {
      resolve(err ? { error: 'The server did not answer. Try again in a moment.' } : res);
    });
  });
}

let busy = false;
async function enterRoom(event, payload) {
  if (busy) return;
  busy = true;
  sfx.play('click');
  const res = await request(event, payload);
  busy = false;
  if (!res || res.error) {
    $('home-error').textContent = res?.error || 'Something went wrong.';
    return;
  }
  $('home-error').textContent = '';
  room = res.room;
  history.replaceState(null, '', `?room=${room.code}`);
  sfx.play('join');
  onRoom();
}

$('btn-create').addEventListener('click', () => enterRoom('create', { name: playerName() }));
$('btn-join').addEventListener('click', () => {
  $('join-form').classList.toggle('hidden');
  if (!$('join-form').classList.contains('hidden')) $('code').focus();
});
$('code').addEventListener('input', () => {
  $('code').value = $('code').value.toUpperCase().replace(/[^A-Z]/g, '');
});
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) {
    $('home-error').textContent = 'Room codes are 4 letters.';
    return;
  }
  enterRoom('join', { code, name: playerName() });
});

function cycleStyle(step) {
  const i = THEME_IDS.indexOf(menuTheme);
  menuTheme = THEME_IDS[(i + step + THEME_IDS.length) % THEME_IDS.length];
  store.set('tag.style', menuTheme);
  $('style-name').textContent = THEMES.find((t) => t.id === menuTheme).name;
  sfx.play('click');
  backdropKey = '';
  showBackdrop(menuTheme);
}
$('style-prev').addEventListener('click', () => cycleStyle(-1));
$('style-next').addEventListener('click', () => cycleStyle(1));

// ---------------------------------------------------------------------------
// Practice
// ---------------------------------------------------------------------------
function startPractice(arenaId, themeId = menuTheme) {
  const arena = arenaById(arenaId || pickRandom(ARENAS.map((a) => a.id), local?.arena.id));
  local = new LocalGame({ arena, themeId, duration: 60, human: playerName(), bots: 3, input, onEvent: onGameEvent });
  mode = 'practice';
  backdropKey = '';
  applyTheme(themeId);
  renderer.setScene(arena, themeId);
  show('game');
}
$('btn-practice').addEventListener('click', () => {
  sfx.play('click');
  startPractice();
});

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
function buildOptions() {
  const add = (parent, value, label, extra) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.dataset.value = value;
    if (extra) b.appendChild(extra);
    b.appendChild(document.createTextNode(label));
    parent.appendChild(b);
    return b;
  };
  const chip = (bg) => {
    const s = document.createElement('span');
    s.className = 'chip';
    s.style.background = bg;
    return s;
  };
  const SWATCH = {
    neon: 'linear-gradient(135deg,#22e6ff,#ff2bd6)',
    nightmare: 'linear-gradient(135deg,#0b0d0e,#8a0f18)',
    sketch: 'linear-gradient(135deg,#fdf9ec 45%,#2f6fde)',
    arcade: 'linear-gradient(180deg,#3a1d6e,#ffd27a)',
    ink: 'linear-gradient(135deg,#efe6d2 50%,#c8372d)',
  };
  add($('opt-theme'), 'random', 'Random', chip('conic-gradient(#22e6ff,#ff2bd6,#ffd27a,#2ecc71,#22e6ff)'));
  for (const t of THEMES) add($('opt-theme'), t.id, t.name, chip(SWATCH[t.id])).title = t.blurb;

  const mini = (arena) => {
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 50;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,.92)';
    if (!arena) {
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('?', 40, 27);
    } else {
      for (const p of arena.platforms) g.fillRect(p.x / 10, p.y / 10, p.w / 10, Math.max(2, p.h / 10));
    }
    return c;
  };
  add($('opt-arena'), 'random', 'Random', mini(null));
  for (const a of ARENAS) add($('opt-arena'), a.id, a.name, mini(a)).title = a.blurb;
  for (const d of DURATIONS) add($('opt-duration'), String(d), `${d}s`);

  const wire = (id, key, parse = (v) => v) => {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('.opt');
      if (!b || !amHost()) return;
      sfx.play('click');
      socket.emit('settings', { [key]: parse(b.dataset.value) });
    });
  };
  wire('opt-theme', 'theme');
  wire('opt-arena', 'arena');
  wire('opt-duration', 'duration', Number);
}
buildOptions();

function renderLobby() {
  const host = amHost();
  $('room-code').textContent = room.code;

  const list = $('players');
  list.textContent = '';
  const bySlot = [...room.players].sort((a, b) => a.slot - b.slot);
  for (const p of bySlot) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = PLAYER_COLORS[p.slot];
    sw.title = COLOR_NAMES[p.slot];
    const nm = document.createElement('span');
    nm.className = 'pname';
    nm.textContent = p.name;
    li.append(sw, nm);
    if (p.id === room.hostId) li.appendChild(tagEl('host', 'host'));
    if (p.id === socket.id) li.appendChild(tagEl('you'));
    list.appendChild(li);
  }
  for (let i = room.players.length; i < MAX_PLAYERS; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Waiting for player…';
    list.appendChild(li);
  }

  const s = room.settings;
  const mark = (id, value) => {
    for (const b of $(id).children) {
      b.classList.toggle('on', b.dataset.value === String(value));
      b.disabled = !host;
    }
  };
  mark('opt-theme', s.theme);
  mark('opt-arena', s.arena);
  mark('opt-duration', s.duration);
  $('settings-note').textContent = host ? '' : '(host chooses)';

  const enough = room.players.length >= MIN_PLAYERS;
  $('btn-start').classList.toggle('hidden', !host);
  $('btn-start').disabled = !enough;
  $('lobby-wait').textContent = host ? (enough ? '' : 'Share the code - you need at least 2 players') : 'Waiting for host to start';

  showBackdrop(s.theme === 'random' ? menuTheme : s.theme, s.arena);
}

function tagEl(text, cls = '') {
  const t = document.createElement('span');
  t.className = `tag ${cls}`;
  t.textContent = text;
  return t;
}

function leaveRoom() {
  socket.emit('leave');
  toHome();
}

$('btn-leave').addEventListener('click', leaveRoom);
$('btn-start').addEventListener('click', () => {
  sfx.play('click');
  socket.emit('start');
});
$('btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${room.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied');
  } catch {
    prompt('Copy this link and send it to your friends:', url);
  }
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
let resultsPractice = false;

function showResults(res, practice) {
  resultsPractice = practice;
  const mySlot = practice ? 0 : (me()?.slot ?? -1);
  const winners = res.rows.filter((r) => res.winners.includes(r.slot));
  const iWon = res.winners.includes(mySlot);
  $('results-title').textContent = winners.length > 1 ? "It's a tie!" : `${winners[0]?.name ?? 'Nobody'} wins!`;
  $('results-sub').textContent =
    res.reason === 'forfeit'
      ? 'Everyone else left the match.'
      : winners.length > 1
        ? `${winners.map((w) => w.name).join(' & ')} spent exactly the same time as "it".`
        : 'Least time spent as "it".';
  const list = $('results-list');
  list.textContent = '';
  const colors = renderer.theme?.colors || PLAYER_COLORS;
  res.rows.forEach((r, i) => {
    const li = document.createElement('li');
    const win = res.winners.includes(r.slot);
    if (win) li.className = 'win';
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = win ? '★' : `${i + 1}.`;
    if (win) rank.classList.add('crown');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = colors[r.slot];
    const nm = document.createElement('span');
    nm.className = 'pname';
    nm.textContent = r.name + (r.slot === mySlot ? ' (you)' : '');
    const tm = document.createElement('span');
    tm.className = 'time';
    tm.textContent = `${(r.ms / 1000).toFixed(1)}s`;
    li.append(rank, sw, nm, tm);
    list.appendChild(li);
  });
  renderResultButtons();
  show('results');
  if (mySlot >= 0 && res.rows.some((r) => r.slot === mySlot)) sfx.play(iWon ? 'win' : 'lose');
}

function renderResultButtons() {
  const host = resultsPractice || amHost();
  $('btn-again').textContent = host ? 'Play Again' : 'Rematch!';
  $('btn-again').disabled = !resultsPractice && host && room.players.length < MIN_PLAYERS;
  $('btn-tolobby').classList.toggle('hidden', resultsPractice || !host);
  $('btn-quit').textContent = resultsPractice ? 'Exit' : 'Leave Room';
  $('results-wait').textContent = resultsPractice
    ? ''
    : host
      ? room.players.length < MIN_PLAYERS
        ? 'Waiting for another player to join'
        : ''
      : 'Waiting for host to start the next round';
}

$('btn-again').addEventListener('click', () => {
  sfx.play('click');
  if (resultsPractice) startPractice();
  else if (amHost()) socket.emit('start');
  else {
    socket.emit('rematch');
    toast('Asked the host for a rematch');
  }
});
$('btn-tolobby').addEventListener('click', () => socket.emit('lobby'));
$('btn-quit').addEventListener('click', () => (resultsPractice ? toHome() : leaveRoom()));
$('btn-exit').addEventListener('click', () => {
  if (mode === 'practice') toHome();
  else if (confirm('Leave this match?')) leaveRoom();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode === 'practice') toHome();
});
$('btn-mute').addEventListener('click', () => {
  $('btn-mute').classList.toggle('off', sfx.toggle());
});

// ---------------------------------------------------------------------------
// Server events
// ---------------------------------------------------------------------------
function onRoom() {
  if (!room) return;
  net.code = room.code;
  if (room.phase === 'lobby') {
    renderLobby();
    if (screen !== 'lobby') show('lobby');
  } else if (room.phase === 'results') {
    if (screen === 'results') renderResultButtons();
  }
}

socket.on('room', (r) => {
  if (!room || room.code !== r.code) return; // not in (or no longer in) this room
  room = r;
  onRoom();
});

socket.on('round', (msg) => {
  if (!room) return;
  const arena = arenaById(msg.arena);
  const mine = me();
  const mySlot = mine && msg.players.some((p) => p.slot === mine.slot) ? mine.slot : -1;
  net.onRound(msg, arena, mySlot);
  net.code = room.code;
  mode = 'net';
  backdropKey = '';
  applyTheme(msg.theme);
  renderer.setScene(arena, msg.theme);
  show('game');
});

socket.on('s', (m) => {
  if (mode === 'net') net.onSnap(m);
});
socket.on('go', (it) => {
  if (mode === 'net') net.onGo(it);
});
socket.on('tag', (from, to) => {
  if (mode === 'net') onGameEvent('tag', from, to);
});
socket.on('end', (res) => {
  if (!room) return;
  net.onEnd();
  showResults(res, false);
});
socket.on('toast', (text) => toast(String(text)));

function setConn(cls, text) {
  $('conn').className = `conn ${cls}`;
  $('conn').textContent = text;
}
socket.on('connect', () => setConn('ok', 'Server online'));
socket.on('disconnect', () => {
  setConn('bad', 'Reconnecting…');
  if (room) toHome('Lost connection to the server. Rejoin with the room code.');
});
socket.on('connect_error', () => setConn('bad', 'Waking up the server… (free hosting naps when idle, give it up to a minute)'));

setInterval(() => {
  if (mode !== 'net' || !socket.connected) return;
  const t0 = performance.now();
  socket.emit('p', () => {
    const rtt = performance.now() - t0;
    net.ping = net.ping == null ? rtt : net.ping * 0.6 + rtt * 0.4;
  });
}, 2000);

// ---------------------------------------------------------------------------
// Game events -> sound + effects
// ---------------------------------------------------------------------------
function onGameEvent(type, a, b) {
  if (type === 'tag') {
    renderer.tagFx(a, b);
    const mySlot = mode === 'net' ? net.mySlot : 0;
    sfx.play(b === mySlot ? 'tagged' : 'tag');
  } else if (type === 'count') sfx.play('count');
  else if (type === 'go') sfx.play('go');
  else if (type === 'tick') sfx.play('tick');
  else if (type === 'end') showResults(a, true);
}

renderer.onEvent = (type, pv) => {
  if (mode === 'backdrop') return;
  sfx.play(type, pv.local ? 1 : 0.35);
};

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function frame(now) {
  const view = mode === 'net' ? net.update(now) : local?.update(now);
  if (view) renderer.draw(view, now);
  requestAnimationFrame(frame);
}

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderer.resize(), 120);
});

// Canvas text needs the fonts loaded; re-bake the scenery once they are in.
const FONTS = ['Orbitron', 'Rajdhani', 'Creepster', 'Special Elite', 'Permanent Marker', 'Patrick Hand', 'Press Start 2P', 'Kaushan Script', 'Cormorant Garamond'];
Promise.all(FONTS.map((f) => document.fonts.load(`16px "${f}"`).catch(() => {}))).then(() => renderer.rebuild());

const invite = new URLSearchParams(location.search).get('room');
toHome();
if (invite && /^[A-Za-z]{4}$/.test(invite)) {
  $('code').value = invite.toUpperCase();
  $('join-form').classList.remove('hidden');
  history.replaceState(null, '', `?room=${invite.toUpperCase()}`);
}
requestAnimationFrame(frame);

// Handy for debugging from the browser console.
window.__tag = { renderer, net, socket, practice: startPractice, get mode() { return mode; }, get local() { return local; } };
