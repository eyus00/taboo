// Menus, lobby, and the glue between the network, the game and the renderer.

import { io } from '/socket.io/socket.io.esm.min.js';
import { THEMES, THEME_IDS, DEFAULT_THEME, MODES, MODE_IDS, DURATIONS, DEFAULT_DURATION, MAX_PLAYERS, MIN_PLAYERS, NAME_MAX, PICKUP_TYPES } from '/shared/config.js';
import { ARENAS, ARENA_IDS, arenaById } from '/shared/arenas.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { LocalGame } from './local.js';
import { NetGame } from './net.js';
import { drawAvatar, arenaThumb, styleThumb } from './art.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
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
// Default transport order on purpose: plain HTTP first (gets through school and
// office firewalls), then upgrade to a WebSocket whenever one is allowed.
const socket = io({ tryAllTransports: true });
const net = new NetGame(socket, input, onGameEvent);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

let mode = 'backdrop'; // backdrop | practice | net
let local = null; // LocalGame for backdrop / practice
let room = null; // latest online room state from the server
let lobbyKind = 'online'; // online | solo
let screen = 'home';

// Practice setup, remembered between visits.
const solo = { mode: MODE_IDS[0], arena: 'random', theme: DEFAULT_THEME, duration: DEFAULT_DURATION, powerups: true, bots: 3 };
try {
  const saved = JSON.parse(store.get('tag.solo', '{}'));
  if (MODE_IDS.includes(saved.mode)) solo.mode = saved.mode;
  if (saved.arena === 'random' || ARENA_IDS.includes(saved.arena)) solo.arena = saved.arena;
  if (saved.theme === 'random' || THEME_IDS.includes(saved.theme)) solo.theme = saved.theme;
  if (DURATIONS.includes(saved.duration)) solo.duration = saved.duration;
  if (typeof saved.powerups === 'boolean') solo.powerups = saved.powerups;
  if ([1, 2, 3].includes(saved.bots)) solo.bots = saved.bots;
} catch {}

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

// Behind every menu: bots playing in the house style.
function showBackdrop() {
  sfx.setTheme(DEFAULT_THEME);
  if (mode === 'backdrop' && local) return;
  const arena = arenaById(pickRandom(ARENA_IDS, local?.arena.id));
  local = new LocalGame({ arena, themeId: DEFAULT_THEME, bots: 4, backdrop: true });
  mode = 'backdrop';
  renderer.setScene(arena, DEFAULT_THEME);
}

function toHome(message = '') {
  room = null;
  net.round = null;
  history.replaceState(null, '', location.pathname);
  $('home-error').textContent = message;
  showBackdrop();
  show('home');
}

function toast(text) {
  const t = el('div', 'toast', text);
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3100);
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
  lobbyKind = 'online';
  history.replaceState(null, '', `?room=${room.code}`);
  sfx.play('join');
  onRoom();
}

$('btn-create').addEventListener('click', () => enterRoom('create', { name: playerName() }));
$('code').addEventListener('input', () => {
  $('code').value = $('code').value.toUpperCase().replace(/[^A-Z]/g, '');
});
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) {
    $('home-error').textContent = 'Room codes are 4 letters.';
    $('code').focus();
    return;
  }
  enterRoom('join', { code, name: playerName() });
});
$('btn-practice').addEventListener('click', () => {
  sfx.play('click');
  lobbyKind = 'solo';
  renderLobby();
  show('lobby');
});

// the character on the home scroll: yours, standing in the wind
function heroFrame(now) {
  if (screen === 'home') drawAvatar($('hero-avatar'), 0, { t: now / 1000, vx: 150, scale: 2.4, shift: 12, blink: now % 3600 < 130 ? 1 : 0 });
  requestAnimationFrame(heroFrame);
}
requestAnimationFrame(heroFrame);

// ---------------------------------------------------------------------------
// Lobby (an online room, or the practice setup - same screen)
// ---------------------------------------------------------------------------
const settingsNow = () => (lobbyKind === 'solo' ? solo : room.settings);
const canEdit = () => lobbyKind === 'solo' || amHost();

function changeSetting(patch) {
  if (!canEdit()) return;
  sfx.play('click');
  if (lobbyKind === 'solo') {
    Object.assign(solo, patch);
    store.set('tag.solo', JSON.stringify(solo));
    renderLobby();
  } else {
    socket.emit('settings', patch);
  }
}

function buildOptions() {
  const add = (parent, key, value, build) => {
    const b = el('button', 'opt');
    b.type = 'button';
    b.dataset.value = String(value);
    build(b);
    b.addEventListener('click', () => changeSetting({ [key]: value }));
    $(parent).appendChild(b);
    return b;
  };
  const svg = (id) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', `#${id}`);
    s.appendChild(u);
    return s;
  };

  for (const m of MODES) {
    add('opt-mode', 'mode', m.id, (b) => {
      const txt = el('span');
      txt.append(el('b', '', m.name), el('small', '', m.blurb));
      b.append(svg(m.id === 'potato' ? 'i-potato' : 'i-hourglass'), txt);
    });
  }

  const thumb = (b, id, name, dice) => {
    const pic = el('span', dice ? 'pic dice' : 'pic', dice ? '?' : null);
    if (!dice) pic.id = `pic-${id}`;
    b.append(pic, el('span', 'cap', name));
  };
  add('opt-theme', 'theme', 'random', (b) => thumb(b, '', 'Surprise me', true));
  for (const t of THEMES) add('opt-theme', 'theme', t.id, (b) => thumb(b, `theme-${t.id}`, t.name)).title = t.blurb;
  add('opt-arena', 'arena', 'random', (b) => thumb(b, '', 'Surprise me', true));
  for (const a of ARENAS) add('opt-arena', 'arena', a.id, (b) => thumb(b, `arena-${a.id}`, a.name)).title = a.blurb;

  for (const d of DURATIONS) add('opt-duration', 'duration', d, (b) => (b.textContent = `${d}s`));
  add('opt-powerups', 'powerups', true, (b) => (b.textContent = 'On'));
  add('opt-powerups', 'powerups', false, (b) => (b.textContent = 'Off'));
  for (const n of [1, 2, 3]) add('opt-bots', 'bots', n, (b) => (b.textContent = String(n)));
}
buildOptions();

// The picture cards are painted with the real game renderer, a few at a time
// so the page never freezes.
function paintThumbs() {
  const jobs = [];
  for (const a of ARENAS) jobs.push(() => ($(`pic-arena-${a.id}`).style.backgroundImage = `url(${arenaThumb(a)})`));
  const stage = arenaById('dojo');
  for (const t of THEMES) jobs.push(() => ($(`pic-theme-${t.id}`).style.backgroundImage = `url(${styleThumb(t.id, stage)})`));
  const next = () => {
    const job = jobs.shift();
    if (!job) return;
    try {
      job();
    } catch (err) {
      console.error(err);
    }
    setTimeout(next, 30);
  };
  next();
}

function plaque(p) {
  const li = el('li', 'plaque');
  const c = el('canvas', 'avatar');
  c.width = 56;
  c.height = 56;
  const who = el('div', 'who');
  who.appendChild(el('b', '', p.name));
  const tags = el('div', 'tags');
  if (p.host) tags.appendChild(el('span', 'host', 'Host'));
  if (p.you) tags.appendChild(el('span', 'you', 'You'));
  if (p.bot) tags.appendChild(el('span', 'bot', 'Bot'));
  who.appendChild(tags);
  li.append(c, who);
  if (p.wins) li.appendChild(el('span', 'wins', `★ ${p.wins}`));
  requestAnimationFrame(() => drawAvatar(c, p.slot, { vx: 90, t: p.slot * 0.7 }));
  return li;
}

function renderLobby() {
  const s = settingsNow();
  const isSolo = lobbyKind === 'solo';
  const edit = canEdit();

  // header
  $('room-label').textContent = isSolo ? 'Solo' : 'Room code';
  const tiles = $('room-code');
  tiles.textContent = '';
  tiles.classList.toggle('word', isSolo);
  if (isSolo) tiles.textContent = 'Practice';
  else for (const ch of room.code) tiles.appendChild(el('span', '', ch));
  $('btn-copy').classList.toggle('hidden', isSolo);
  $('bots-row').classList.toggle('hidden', !isSolo);

  // players
  const list = $('players');
  list.textContent = '';
  let count = 0;
  if (isSolo) {
    list.appendChild(plaque({ name: playerName(), slot: 0, you: true }));
    for (let i = 1; i <= solo.bots; i++) list.appendChild(plaque({ name: `Bot ${i}`, slot: i, bot: true }));
    count = 1 + solo.bots;
  } else {
    for (const p of [...room.players].sort((a, b) => a.slot - b.slot)) {
      list.appendChild(plaque({ name: p.name, slot: p.slot, host: p.id === room.hostId, you: p.id === socket.id, wins: p.wins }));
    }
    count = room.players.length;
  }
  for (let i = count; i < MAX_PLAYERS; i++) list.appendChild(el('li', 'plaque empty', isSolo ? 'No bot' : 'Empty seat'));

  // settings
  const mark = (id, value) => {
    for (const b of $(id).children) {
      b.classList.toggle('on', b.dataset.value === String(value));
      b.disabled = !edit;
    }
  };
  mark('opt-mode', s.mode);
  mark('opt-theme', s.theme);
  mark('opt-arena', s.arena);
  mark('opt-duration', s.duration);
  mark('opt-powerups', s.powerups);
  mark('opt-bots', solo.bots);
  $('settings-note').textContent = edit ? '' : 'the host decides';

  const enough = isSolo || room.players.length >= MIN_PLAYERS;
  $('btn-start').classList.toggle('hidden', !edit);
  $('btn-start').disabled = !enough;
  $('btn-start').textContent = isSolo ? 'Start practice' : 'Start match';
  $('lobby-wait').textContent = edit ? (enough ? '' : 'Share the code. You need at least 2 players') : 'Waiting for the host to start';
  showBackdrop();
}

function leaveRoom() {
  if (lobbyKind === 'online') socket.emit('leave');
  toHome();
}

$('btn-leave').addEventListener('click', leaveRoom);
$('btn-start').addEventListener('click', () => {
  sfx.play('click');
  if (lobbyKind === 'solo') startPractice();
  else socket.emit('start');
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
// Practice
// ---------------------------------------------------------------------------
function startPractice(arenaId, themeId) {
  const arena = arenaById(arenaId || (solo.arena === 'random' ? pickRandom(ARENA_IDS, local?.arena.id) : solo.arena));
  const theme = themeId || (solo.theme === 'random' ? pickRandom(THEME_IDS) : solo.theme);
  lobbyKind = 'solo';
  local = new LocalGame({ arena, themeId: theme, mode: solo.mode, duration: solo.duration, human: playerName(), bots: solo.bots, input, onEvent: onGameEvent });
  local.sim.powerups = solo.powerups;
  mode = 'practice';
  sfx.setTheme(theme);
  renderer.setScene(arena, theme);
  show('game');
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
function showResults(res) {
  const practice = lobbyKind === 'solo';
  const mySlot = practice ? 0 : (me()?.slot ?? -1);
  const played = res.rows.some((r) => r.slot === mySlot);
  const iWon = played && res.winners.includes(mySlot);
  const nameOf = (slot) => res.rows.find((r) => r.slot === slot)?.name ?? 'Nobody';
  const seal = $('results-seal');
  let title;
  let sub;
  if (res.reason === 'forfeit') {
    title = iWon ? 'You win!' : `${nameOf(res.winners[0])} wins!`;
    sub = 'Everyone else left the match.';
    seal.textContent = '勝';
  } else if (res.mode === 'potato') {
    const loser = nameOf(res.loser);
    title = !played ? `${loser} lost!` : iWon ? "You're safe!" : "You're it. You lose!";
    sub = iWon || !played ? `${loser} was it when the clock ran out.` : 'You were still it when the clock ran out.';
    seal.textContent = played && !iWon ? '鬼' : '勝';
  } else {
    const winners = res.rows.filter((r) => res.winners.includes(r.slot));
    title = winners.length > 1 ? "It's a tie!" : iWon ? 'You win!' : `${winners[0]?.name ?? 'Nobody'} wins!`;
    sub = winners.length > 1 ? `${winners.map((w) => w.name).join(' and ')} spent exactly the same time as it.` : 'Least time spent as it.';
    seal.textContent = played && !iWon ? '負' : '勝';
  }
  seal.classList.toggle('dark', played && !iWon);
  // restart the stamp animation
  seal.style.animation = 'none';
  void seal.offsetWidth;
  seal.style.animation = '';
  $('results-title').textContent = title;
  $('results-sub').textContent = sub;

  const list = $('results-list');
  list.textContent = '';
  for (const r of res.rows) {
    const win = res.winners.includes(r.slot);
    const lose = r.slot === res.loser;
    const li = el('li', lose ? 'lose' : win ? 'win' : '');
    const c = el('canvas', 'avatar');
    c.width = 50;
    c.height = 50;
    const who = el('div', 'who');
    who.appendChild(el('b', '', r.name + (r.slot === mySlot ? ' (you)' : '')));
    const stat = (label, value, cls = '') => {
      const d = el('div', `stat ${cls}`);
      d.append(el('small', '', label), document.createTextNode(value));
      return d;
    };
    li.append(c, who, stat('As it', `${(r.ms / 1000).toFixed(1)}s`), stat('Tags', String(r.tags ?? 0), 'tags'));
    if (res.mode === 'potato' && res.reason !== 'forfeit') li.appendChild(el('span', `stamp ${lose ? 'it' : 'safe'}`, lose ? 'IT' : 'SAFE'));
    else if (win) li.appendChild(el('span', 'stamp win', 'WIN'));
    else li.appendChild(el('span'));
    list.appendChild(li);
    requestAnimationFrame(() => drawAvatar(c, r.slot, { vx: win ? 90 : 0, isIt: lose, t: r.slot }));
  }
  renderResultButtons();
  show('results');
  if (played) sfx.play(iWon ? 'win' : 'lose');
}

function renderResultButtons() {
  const practice = lobbyKind === 'solo';
  const host = practice || amHost();
  $('btn-again').textContent = host ? 'Play again' : 'Ask for a rematch';
  $('btn-again').disabled = !practice && host && room.players.length < MIN_PLAYERS;
  $('btn-tolobby').classList.toggle('hidden', !host);
  $('btn-quit').textContent = practice ? 'Quit' : 'Leave room';
  $('results-wait').textContent = practice ? '' : host ? (room.players.length < MIN_PLAYERS ? 'Waiting for another player to join' : '') : 'Waiting for the host to start the next round';
}

$('btn-again').addEventListener('click', () => {
  sfx.play('click');
  if (lobbyKind === 'solo') startPractice();
  else if (amHost()) socket.emit('start');
  else {
    socket.emit('rematch');
    toast('Asked the host for a rematch');
  }
});
$('btn-tolobby').addEventListener('click', () => {
  if (lobbyKind === 'solo') {
    renderLobby();
    show('lobby');
  } else socket.emit('lobby');
});
$('btn-quit').addEventListener('click', leaveRoom);
$('btn-exit').addEventListener('click', () => {
  if (mode === 'practice') {
    renderLobby();
    show('lobby');
  } else if (confirm('Leave this match?')) leaveRoom();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode === 'practice' && screen === 'game') $('btn-exit').click();
});
$('btn-mute').addEventListener('click', () => {
  $('btn-mute').classList.toggle('off', sfx.toggle());
});
$('btn-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
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
  sfx.setTheme(msg.theme);
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
socket.on('block', (from, to) => {
  if (mode === 'net') onGameEvent('block', from, to);
});
socket.on('pick', (slot, kind) => {
  if (mode === 'net') onGameEvent('pick', slot, kind);
});
socket.on('end', (res) => {
  if (!room) return;
  net.onEnd();
  showResults(res);
});
socket.on('toast', (text) => toast(String(text)));
socket.on('q', (ack) => {
  if (typeof ack === 'function') ack(); // the server timing our connection
});

function setConn(cls, text) {
  $('conn').className = `conn ${cls}`;
  $('conn').textContent = text;
}
socket.on('connect', () => setConn('ok', 'Server online'));
socket.on('disconnect', () => {
  setConn('bad', 'Reconnecting…');
  if (room) toHome('Lost connection to the server. Rejoin with the room code.');
});
socket.on('connect_error', () => setConn('bad', 'Waking up the server… free hosting naps when idle, give it up to a minute'));

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
  const mySlot = mode === 'net' ? net.mySlot : mode === 'practice' ? 0 : -1;
  if (type === 'tag') {
    renderer.tagFx(a, b);
    if (mode !== 'backdrop') sfx.play(b === mySlot ? 'tagged' : 'tag');
  } else if (type === 'block') {
    renderer.blockFx(a, b);
    if (mode !== 'backdrop') sfx.play('block');
  } else if (type === 'pick') {
    renderer.pickFx(a, b);
    if (mode !== 'backdrop') sfx.play(PICKUP_TYPES[b] === 'freeze' ? 'freeze' : 'pick', a === mySlot ? 1 : 0.5);
  } else if (type === 'count') sfx.play('count');
  else if (type === 'go') {
    sfx.play('go');
    renderer.flash('#ffffff', 0.25); // the moment someone becomes "it"
    renderer.shake(5);
  } else if (type === 'tick') sfx.play('tick');
  else if (type === 'end') showResults(a);
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

// Canvas text needs the fonts loaded; re-bake the scenery once they are in,
// then paint the picture cards.
const FONTS = ['Kaushan Script', 'Shippori Mincho', 'Cormorant Garamond', 'Orbitron', 'Rajdhani', 'Creepster', 'Special Elite', 'Permanent Marker', 'Patrick Hand', 'Press Start 2P'];
Promise.all(FONTS.map((f) => document.fonts.load(`16px "${f}"`).catch(() => {}))).then(() => {
  renderer.rebuild();
  paintThumbs();
});

const invite = new URLSearchParams(location.search).get('room');
toHome();
if (invite && /^[A-Za-z]{4}$/.test(invite)) {
  $('code').value = invite.toUpperCase();
  history.replaceState(null, '', `?room=${invite.toUpperCase()}`);
  $('code').focus();
}
requestAnimationFrame(frame);

// Handy for debugging from the browser console.
window.__tag = { renderer, net, socket, practice: startPractice, get mode() { return mode; }, get local() { return local; } };
