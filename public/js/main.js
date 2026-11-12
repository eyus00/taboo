// Onigokko - everything outside the match itself: the title scroll, the ways
// to play (host, public, private), your profile, match setup, how to play,
// the draw before a round, results.
//
// On a wide screen the title scroll stays on the left and whatever you open
// (play, public games, profile, match setup, how to play) opens beside it; on a narrow one there is
// one panel at a time. Every screen can be driven with the keyboard alone
// (arrows + Enter, Esc to go back, a letter or number for most things).

import { MODES, DURATIONS, DEFAULT_DURATION, DEFAULT_THEME, THEMES, CUP_ROUNDS, NAME_MAX, CODE_LEN, MIN_PLAYERS, MAX_PLAYERS, TEAM_NAMES, TEAM_COLORS, BOMB_POINTS, FLAG_POINTS, BOMB_FUSE_TICKS, TICK_RATE, ITEM_KINDS, ITEM_INFO, ITEM_LOCK_TICKS } from '/shared/config.js';
import { ARENAS } from '/shared/arenas.js';
import { play } from './play.js';
import { scenePreview, styleStill, clearPictures, paintBackdrop, paperTexture } from './art.js';
import { loadTheme } from './themes/index.js';
import { draw } from './spinner.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const store = {
  get(key, fallback = '') {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};
const cleanName = (raw) =>
  String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
const INK_COLORS = ['#c8372d', '#2f62b0', '#3c8f57', '#d79a12', '#7a4a9e', '#d9689a']; // the house style's six player colours
const isTouch = matchMedia('(pointer: coarse)').matches;
// Key cues are shown wherever there is a keyboard: always on a computer, and
// on a tablet from the moment someone presses a real key.
document.body.classList.toggle('no-kbd', isTouch);

const socket = io({ tryAllTransports: true });
// The match itself (renderer, heads-up display, game events) lives in play.js.
play.init({
  socket,
  isTouch,
  // a round is starting: show the match, and over it the draw for arena, style and who is it
  onStart(info) {
    kind = play.kind;
    show('game');
    draw.show(play.el.spin, info, { sfx, colorOf: (slot) => play.colorOf(slot), me: play.mySlot(), prefer: [cardTheme] });
  },
  onEnd: (res) => showResults(res),
  onPause: () => openPause(),
});
const { renderer, input, sfx, net } = play;

let myName = cleanName(store.get('tag.name'));
let screen = ''; // name | home | game
let panel = ''; // what is open beside the title scroll: '' | rooms (the ways to play) | find | profile | lobby | help
let overlay = ''; // over a match: '' | results | pause | help
let helpFrom = ''; // what How to play goes back to
let profileFrom = ''; // and what your profile goes back to
let kind = 'online'; // what match setup is showing: online | practice
let room = null; // latest room state from the server
let afterName = null;
let lastResults = null;
let nextTimer = 0;
let cardTheme = DEFAULT_THEME; // the style the arena cards were last painted in
let demos = null; // the live demos on the How to play page (loaded when it is first opened)

const practice = { mode: 'potato', arena: 'random', theme: DEFAULT_THEME, duration: DEFAULT_DURATION, powerups: true, bots: 3 };
try {
  Object.assign(practice, JSON.parse(store.get('tag.practice', '{}')));
} catch {}

// ---------------------------------------------------------------------------
// The painted scene behind the menus
// ---------------------------------------------------------------------------
document.documentElement.style.setProperty('--tex', `url(${paperTexture()})`);

// The landscape is painted once per window size, never while a match is on.
let scenePainted = '';
function paintScene() {
  const size = `${innerWidth}x${innerHeight}`;
  if (size === scenePainted) return;
  scenePainted = size;
  requestAnimationFrame(() => paintBackdrop($('scene')));
}

// A few petals on the wind (the browser animates them without any script).
for (let i = 0; i < 14; i++) {
  const p = document.createElement('i');
  const r = (a, b) => a + Math.random() * (b - a);
  p.style.cssText = `--x:${r(-4, 100).toFixed(1)}vw;--s:${r(9, 16).toFixed(1)}px;--d:${r(9, 17).toFixed(1)}s;--w:${(-r(0, 17)).toFixed(1)}s;--dx:${r(-22, -6).toFixed(1)}vw;--c:${Math.random() < 0.5 ? '#f3b3c6' : '#e88aa6'}`;
  $('petals').append(p);
}

// The name in kana is a flourish: only shown where the device can draw it.
(() => {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true });
    const ink = (ch) => {
      g.clearRect(0, 0, 24, 24);
      g.font = `18px ${getComputedStyle(document.querySelector('.kana')).fontFamily}`;
      g.textBaseline = 'top';
      g.fillText(ch, 2, 2);
      return g.getImageData(0, 0, 24, 24).data.join();
    };
    const blank = ink(' ');
    const kana = ink(String.fromCharCode(0x3054)); // hiragana GO
    // a glyph nobody has: if the kana looks the same as that, it is only a placeholder box
    if (kana === blank || kana === ink(String.fromCharCode(0xffff))) document.body.classList.add('no-kana');
  } catch {}
})();

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
const PANELS = ['rooms', 'find', 'profile', 'lobby', 'help'];
// the first letter of a name, for its seal
const initial = (name) => (Array.from(String(name || '').trim())[0] || '?').toUpperCase();

// the name of what is in front right now (also what the automated checks ask for)
const top = () => overlay || (screen === 'home' ? panel || 'home' : screen);

function show(name, beside = '') {
  screen = name;
  panel = name === 'home' ? beside : '';
  if (name !== 'game') paintScene();
  $('s-name').hidden = name !== 'name';
  $('s-home').hidden = name !== 'home';
  $('home-name').textContent = myName;
  $('home-seal').textContent = initial(myName);
  $('game').hidden = name !== 'game';
  document.body.classList.toggle('in-game', name === 'game');
  document.body.classList.toggle('has-panel', !!panel);
  if (name !== 'game') {
    play.stop();
    draw.clear();
  }
  // which entry of the title scroll is open
  $('btn-play').toggleAttribute('aria-current', panel === 'rooms' || panel === 'find' || (panel === 'lobby' && kind === 'online'));
  $('btn-practice').toggleAttribute('aria-current', panel === 'lobby' && kind === 'practice');
  $('btn-profile').toggleAttribute('aria-current', panel === 'profile');
  $('btn-help').toggleAttribute('aria-current', panel === 'help');
  setOverlay('');
}

function setOverlay(name) {
  overlay = name;
  $('s-results').hidden = name !== 'results';
  $('s-pause').hidden = name !== 'pause';
  for (const p of PANELS) $(`s-${p}`).hidden = !(panel === p || (p === 'help' && name === 'help'));
  $('s-help').classList.toggle('over', name === 'help');
  input.active = screen === 'game' && !name;
  if (!input.active) input.clear();
  // the demos only run while How to play is in front
  if (demos) {
    if (top() === 'help') demos.start();
    else demos.stop();
  }
  focusFirst();
}

const topRoot = () => $(`s-${top()}`);

function focusFirst(prefer) {
  const root = topRoot();
  if (!root) return document.activeElement?.blur();
  const target = (prefer && !prefer.disabled && prefer.offsetParent !== null && prefer) || root.querySelector('[data-autofocus]:not([hidden]):not(:disabled)');
  // on a phone, focusing a button only leaves a stray outline; text fields still get focus
  if (target && (!isTouch || target.tagName === 'INPUT')) target.focus({ preventScroll: true });
  else document.activeElement?.blur();
}

// Up / down walk through the controls of whatever is in front.
function moveFocus(dir) {
  const root = topRoot();
  if (!root) return;
  // a group of choices (a row of rules, a grid of cards) counts as one stop; left / right move inside it
  const stops = [...root.querySelectorAll('button, input[type="text"], .seg, .cards, .digits')].filter((e) => {
    if (e.closest('.numpad') || e.closest('.locked') || e.closest('.demo')) return false;
    return !e.disabled && e.offsetParent !== null;
  });
  if (!stops.length) return;
  const cur = stops.findIndex((s) => s === document.activeElement || s.contains(document.activeElement));
  const next = stops[cur < 0 ? (dir > 0 ? 0 : stops.length - 1) : (cur + dir + stops.length) % stops.length];
  const group = next.classList.contains('seg') || next.classList.contains('cards');
  (group ? next.querySelector('input:checked') || next.querySelector('input') : next).focus();
}

// A button label with its key beside it.
function setLabel(btn, text, key) {
  btn.textContent = text;
  if (key) btn.append(' ', el('kbd', '', key));
}

// A row of key cues: [[keys, what they do], ...]
function setLegend(box, items) {
  box.textContent = '';
  for (const [keys, text] of items) {
    const s = el('span');
    for (const k of keys) s.append(el('kbd', '', k));
    s.append(text);
    box.append(s);
  }
}

// Things that would throw you out of a game need the key twice.
let armed = '';
let armedAt = 0;
function twice(what, message) {
  const now = performance.now();
  if (armed === what && now - armedAt < 2500) {
    armed = '';
    return true;
  }
  armed = what;
  armedAt = now;
  toast(message);
  return false;
}

function toggleSound(say) {
  sfx.toggle();
  paintSound();
  sfx.play('click');
  if (say) toast(`Sound ${sfx.muted ? 'off' : 'on'}`);
}

const canFullscreen = !!document.documentElement.requestFullscreen;
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

function toast(text) {
  const box = $('toasts');
  while (box.children.length > 1) box.firstChild.remove(); // never more than two at once
  const t = el('div', '', text);
  box.append(t);
  setTimeout(() => t.remove(), 3000);
}

// The title scroll on its own (after leaving a room, a lost connection...).
function toHome(message = '', focus) {
  room = null;
  play.game = null;
  $('home-error').textContent = message;
  show('home');
  if (focus) focusFirst(focus);
}

// Close whatever is open beside the title scroll; the focus goes back to the entry that opened it.
function closePanel() {
  const opener = panel === 'help' ? $('btn-help') : panel === 'profile' ? $('btn-profile') : panel === 'lobby' && kind === 'practice' ? $('btn-practice') : $('btn-play');
  $('home-error').textContent = '';
  show('home');
  focusFirst(opener);
}

// ---------------------------------------------------------------------------
// Name: nobody plays without one
// ---------------------------------------------------------------------------
function askName(then) {
  afterName = then || null;
  $('name').value = myName;
  $('name-error').textContent = '';
  show('name');
}

$('name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = cleanName($('name').value);
  if (!name) {
    $('name-error').textContent = 'Type a name to continue.';
    $('name').focus();
    return;
  }
  myName = name;
  store.set('tag.name', name);
  const then = afterName;
  afterName = null;
  if (then) then();
  else toHome();
});
$('name').addEventListener('input', () => ($('name-error').textContent = ''));

// ---------------------------------------------------------------------------
// Profile: who you are (your name, under your own seal)
// ---------------------------------------------------------------------------
// Go back to whatever was open before How to play or the profile.
function reopen(from) {
  if (from === 'lobby' && (room || kind === 'practice')) return openLobby();
  if (room) return openLobby(); // the room you are in comes first
  if (from === 'rooms') return openRooms(code);
  if (from === 'find') return openFind();
  if (from === 'profile') return openProfile(true);
  closePanel();
}

function openProfile(again) {
  if (screen !== 'home') return;
  if (!again && panel !== 'profile') profileFrom = panel === 'help' ? '' : panel;
  const field = $('profile-name');
  field.value = myName;
  // the room knows you by the name you came in with
  field.disabled = !!room;
  $('btn-profile-save').hidden = !!room;
  $('profile-error').textContent = '';
  $('profile-note').textContent = room ? `You are in room ${room.code}. Leave the room to change your name.` : 'This is how the others see you: in the room, above your head, on the scoreboard.';
  $('profile-seal').textContent = initial(myName);
  show('home', 'profile');
  if (isTouch) field.blur(); // on a phone the keyboard comes up when you tap the name, not before
  else if (!room) field.select();
}
function closeProfile() {
  const from = profileFrom;
  profileFrom = '';
  if (from) reopen(from);
  else closePanel();
}
$('btn-profile').addEventListener('click', () => (panel === 'profile' ? closeProfile() : openProfile()));
$('btn-profile-back').addEventListener('click', closeProfile);
$('profile-name').addEventListener('input', () => {
  $('profile-error').textContent = '';
  $('profile-seal').textContent = initial(cleanName($('profile-name').value));
});
$('profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (room) return closeProfile();
  const name = cleanName($('profile-name').value);
  if (!name) {
    $('profile-error').textContent = 'Type a name to continue.';
    $('profile-name').focus();
    return;
  }
  const changed = name !== myName;
  myName = name;
  store.set('tag.name', name);
  sfx.play('click');
  if (changed) toast(`Signed as ${name}`);
  closeProfile();
});

// ---------------------------------------------------------------------------
// Talking to the server
// ---------------------------------------------------------------------------
function request(event, payload) {
  return new Promise((resolve) => {
    // free hosting sleeps when idle: give it time to wake up
    socket.timeout(socket.connected ? 8000 : 60000).emit(event, payload, (err, res) => {
      resolve(err ? { error: 'The server did not answer. Check your connection and try again.' } : res);
    });
  });
}

let busy = false;
async function enterRoom(event, payload, errorEl) {
  if (busy) return false;
  busy = true;
  errorEl.textContent = socket.connected ? '' : 'Waking up the server - this can take up to a minute...';
  const res = await request(event, payload);
  busy = false;
  if (!res || res.error) {
    if (res?.needName) askName(() => enterRoom(event, { ...payload, name: myName }, errorEl));
    else errorEl.textContent = res?.error || 'Something went wrong.';
    return false;
  }
  errorEl.textContent = '';
  room = res.room;
  net.code = room.code;
  kind = 'online';
  sfx.play('join');
  openLobby();
  return true;
}

const me = () => room?.players.find((p) => p.id === socket.id) || null;
const amHost = () => !!room && room.hostId === socket.id;

// The connection is a paper lantern in the corner: lit when the server is
// there, flickering while it is being woken up.
const NAP = 'Free hosting naps when nobody is playing. Give it up to a minute.';
function setConn(state, text, more = '') {
  const box = $('conn');
  box.className = `conn ${state}`;
  $('conn-text').textContent = text;
  $('conn-more').textContent = more;
  // say it for a moment, then let the lantern speak for itself (it stays up while there is trouble)
  box.classList.add('say');
  clearTimeout(setConn.timer);
  if (state === 'ok') setConn.timer = setTimeout(() => box.classList.remove('say'), 2600);
}
$('btn-conn').addEventListener('click', () => $('conn').classList.toggle('open'));
$('btn-conn').addEventListener('blur', () => $('conn').classList.remove('open'));
setConn('wait', 'Lighting the lantern...');
socket.on('connect', () => setConn('ok', 'Server awake', 'You are connected.'));
socket.on('connect_error', () => setConn('bad', 'Waking the server...', NAP));
socket.on('disconnect', () => {
  setConn('bad', 'Reconnecting...', NAP);
  if (room) {
    play.stop();
    toHome('Lost the connection to the server.');
  }
});

// ---------------------------------------------------------------------------
// The title scroll
// ---------------------------------------------------------------------------
$('btn-play').addEventListener('click', () => {
  if (room) openLobby(); // already in a room: that is where the game is
  else openRooms('');
});
$('btn-practice').addEventListener('click', () => {
  if (room) {
    if (!twice('leave', 'Press again to leave the room')) return;
    socket.emit('leave');
    room = null;
  }
  kind = 'practice';
  openLobby();
});
$('btn-help').addEventListener('click', () => (panel === 'help' ? closeHelp() : openHelp()));
function paintSound() {
  const word = `Sound ${sfx.muted ? 'off' : 'on'}`;
  $('sound-label').textContent = word;
  $('pause-sound').textContent = word;
  document.body.classList.toggle('muted', sfx.muted);
}
for (const id of ['btn-sound', 'btn-pause-sound']) $(id).addEventListener('click', () => toggleSound(false));
paintSound();
$('btn-full').hidden = !canFullscreen;
$('btn-full').addEventListener('click', toggleFullscreen);

// How to play opens beside the title scroll - or over a paused match.
async function openHelp() {
  if (top() === 'help' || screen === 'name') return;
  helpFrom = screen === 'game' ? overlay : panel;
  if (screen === 'game') setOverlay('help');
  else show('home', 'help');
  $(overlay === 'help' ? 's-help' : 'ui').scrollTop = 0;
  if (!demos) {
    try {
      const m = await import('./demo.js');
      demos = m.demos;
      demos.mount($('s-help'));
    } catch (err) {
      console.warn('How to play: the demos could not be loaded', err);
      return;
    }
  }
  if (top() === 'help') demos.start();
}
function closeHelp() {
  if (overlay === 'help') return setOverlay(helpFrom);
  if (helpFrom && helpFrom !== 'help') reopen(helpFrom);
  else closePanel();
}
$('btn-help-back').addEventListener('click', closeHelp);

// numbers in the rules come from the game's own settings
const orList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : String(items[0]));
for (const [key, value] of Object.entries({ fuse: Math.round(BOMB_FUSE_TICKS / TICK_RATE), bomb: `${BOMB_POINTS} points`, flag: `${FLAG_POINTS} points`, lock: Math.round(ITEM_LOCK_TICKS / TICK_RATE), rounds: orList(CUP_ROUNDS) })) {
  for (const e of document.querySelectorAll(`[data-n="${key}"]`)) e.textContent = value;
}
for (const k of ITEM_KINDS) {
  const li = el('li');
  li.dataset.kind = k;
  li.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-${k}" /></svg>`;
  const words = el('span');
  words.append(el('b', '', ITEM_INFO[k].name), ITEM_INFO[k].blurb);
  li.append(words);
  $('item-list').append(li);
}

// ---------------------------------------------------------------------------
// Play: host a game, find a public one, or enter the code of a private one
// ---------------------------------------------------------------------------
let code = '';
let codeTried = '';

function openRooms(start) {
  $('join-error').textContent = '';
  $('create-error').textContent = '';
  $('numpad').hidden = true;
  $('digits').classList.remove('open');
  codeTried = '';
  show('home', 'rooms');
  setCode(start);
  watchGames();
}

// Host: a room of your own. It starts private, and "Public" in the room opens
// it to everyone - unless you came from the list of public games, where a new
// game is meant for everyone from the start.
const hostGame = (errorEl, open = false) => enterRoom('create', { name: myName, open }, errorEl);
$('btn-create').addEventListener('click', () => hostGame($('create-error')));

// Private: the code is typed straight into the menu.
function setCode(next) {
  code = String(next).replace(/\D/g, '').slice(0, CODE_LEN);
  const boxes = $('digits').children;
  for (let i = 0; i < CODE_LEN; i++) {
    boxes[i].textContent = code[i] || '';
    boxes[i].classList.toggle('next', i === code.length);
  }
  $('digits').classList.remove('bad');
  $('digits').setAttribute('aria-label', `Room code: ${code.split('').join(' ') || 'empty'}`);
  for (const id of ['btn-join-go', 'btn-pad-go']) $(id).disabled = code.length !== CODE_LEN;
  if (code.length < CODE_LEN) $('join-error').textContent = '';
  // the fourth digit joins straight away (once per code, so a wrong one can be corrected)
  if (code.length === CODE_LEN && code !== codeTried) submitCode();
}

async function submitCode() {
  if (code.length !== CODE_LEN || busy) return;
  codeTried = code;
  const ok = await enterRoom('join', { code, name: myName }, $('join-error'));
  if (!ok && top() === 'rooms') {
    $('digits').classList.add('bad');
    sfx.play('lose');
  }
}
function retryCode() {
  codeTried = '';
  submitCode();
}

// Typing a digit anywhere on this panel goes into the code.
function typeCode(next) {
  setCode(next);
  if (top() === 'rooms' && !isTouch && document.activeElement !== $('digits')) $('digits').focus({ preventScroll: true });
}

// Tapping the code opens our own little number pad under it (a phone has no keys).
$('digits').addEventListener('click', () => {
  $('numpad').hidden = false;
  $('digits').classList.add('open');
  $('numpad').scrollIntoView({ block: 'nearest' });
});
$('numpad').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset.d;
  if (d === 'back') setCode(code.slice(0, -1));
  else if (d === 'go') retryCode();
  else setCode(code + d);
  sfx.play('click');
});
$('btn-join-go').addEventListener('click', () => {
  sfx.play('click');
  retryCode();
});
$('btn-rooms-back').addEventListener('click', closePanel);
addEventListener('paste', (e) => {
  if (top() !== 'rooms') return;
  const text = e.clipboardData?.getData('text') || '';
  if (/\d/.test(text)) typeCode(text);
});

// Public: the games anyone may join. The server is asked again every couple
// of seconds while this panel or the list is open.
let games = [];
let gamesSig = '';
let gamesTimer = 0;
let findFresh = false; // the list was just opened: put the keyboard on its first row

async function refreshGames() {
  if (!socket.connected) return paintGames();
  const res = await new Promise((resolve) => socket.timeout(5000).emit('list', (err, r) => resolve(err ? null : r)));
  if (res && Array.isArray(res.rooms)) games = res.rooms;
  paintGames();
}
function watchGames() {
  clearInterval(gamesTimer);
  refreshGames();
  gamesTimer = setInterval(() => {
    if (panel !== 'rooms' && panel !== 'find') return clearInterval(gamesTimer);
    if (!document.hidden) refreshGames();
  }, 2500);
}

const nameOfArena = (id) => (id === 'random' ? 'Random arena' : ARENAS.find((a) => a.id === id)?.name || 'Arena');
const describeGame = (g) => [g.game === 'cup' ? 'Tournament' : 'Quick match', MODES.find((m) => m.id === g.mode)?.name || '', nameOfArena(g.arena)].filter(Boolean).join(' - ');

function paintGames() {
  const n = games.length;
  $('find-count').textContent = n ? `${n} game${n > 1 ? 's' : ''} open right now` : 'Join a game that is open to everyone';
  $('btn-find').classList.toggle('has', n > 0);
  if (panel !== 'find') return;
  const box = $('games');
  const sig = JSON.stringify(games);
  if (sig !== gamesSig || !box.childElementCount !== !n) {
    gamesSig = sig;
    const held = box.contains(document.activeElement) ? document.activeElement.dataset.code : '';
    box.textContent = '';
    for (const g of games) {
      const li = el('li');
      const b = el('button', 'game');
      b.dataset.code = String(g.code).replace(/\D/g, '');
      const who = el('span', 'who');
      who.append(el('b', '', `${g.host || 'Someone'}'s game`), el('small', '', describeGame(g)));
      const state = el('span', g.playing ? 'state on' : 'state', g.playing ? 'Playing' : 'In the room');
      b.append(el('i', 'seal hanko', initial(g.host)), who, el('span', 'count', `${g.players}/${g.max}`), state, el('span', 'join', 'Join'));
      b.setAttribute('aria-label', `Join ${g.host}'s game: ${describeGame(g)}, ${g.players} of ${g.max} players, ${g.playing ? 'playing - you join the next round' : 'waiting in the room'}`);
      b.addEventListener('click', () => joinGame(b.dataset.code));
      li.append(b);
      box.append(li);
    }
    if (held) (box.querySelector(`[data-code="${held}"]`) || box.querySelector('button') || $('btn-find-host')).focus?.();
  }
  $('find-none').hidden = n > 0;
  $('find-lead').textContent = !socket.connected ? 'Waking up the server - this can take up to a minute...' : n ? 'Games that are open to everyone. Pick one to join - the list keeps itself up to date.' : 'Games that are open to everyone show up here.';
  if (findFresh) {
    findFresh = false;
    focusFirst(box.querySelector('button') || $('btn-find-host'));
  }
}

function openFind() {
  $('find-error').textContent = '';
  gamesSig = '';
  findFresh = true;
  show('home', 'find');
  paintGames(); // what we already know, straight away...
  findFresh = true;
  watchGames(); // ...then the latest
}
async function joinGame(roomCode) {
  sfx.play('click');
  const ok = await enterRoom('join', { code: roomCode, name: myName }, $('find-error'));
  if (!ok && panel === 'find') refreshGames(); // it filled up, or it is gone
}
$('btn-find').addEventListener('click', openFind);
$('btn-find-back').addEventListener('click', () => openRooms(code));
$('btn-find-host').addEventListener('click', () => hostGame($('find-error'), true));

// ---------------------------------------------------------------------------
// Match setup: an online room, or practice
// ---------------------------------------------------------------------------
// Every row writes one setting (`key`); two rows may write the same one, shown
// at different times (the rules of a quick match / of a tournament).
const OPTIONS = [
  // who can join: beside the room code (private = by code only; public = also listed under "Public")
  { id: 'open', key: 'open', hot: 'v', label: 'Open to', only: 'online', type: 'seg', box: 'room-open', values: [[false, 'Private'], [true, 'Public']] },
  { id: 'arena', key: 'arena', hot: 'a', type: 'cards', box: 'arena-cards', values: [...ARENAS.map((a) => [a.id, a.name]), ['random', 'Random']] },
  { id: 'theme', key: 'theme', hot: 's', type: 'cards', box: 'style-cards', values: [...THEMES.map((t) => [t.id, t.name]), ['random', 'Random']] },
  { id: 'game', key: 'game', hot: 'g', label: 'Game', only: 'online', type: 'seg', values: [['quick', 'Quick match'], ['cup', 'Tournament']] },
  { id: 'mode', key: 'mode', hot: 'r', label: 'Rules', type: 'seg', wrap: true, values: MODES.map((m) => [m.id, m.name]), show: (s) => s.game !== 'cup', hint: (s) => MODES.find((m) => m.id === s.mode)?.blurb },
  {
    id: 'sides',
    key: 'mode',
    hot: 't',
    label: 'Sides',
    only: 'online',
    type: 'seg',
    // a tournament is scored on time as the oni, or played as a team battle
    values: [['potato', 'Free-for-all'], ['team', 'Team Bomb']],
    on: (s, v) => (v === 'team') === (s.mode === 'team'),
    show: (s) => s.game === 'cup',
    hint: (s) => (s.mode === 'team' ? 'The teams stay together; their points add up.' : 'Points for the least time as the oni.'),
  },
  { id: 'rounds', key: 'rounds', hot: 'r', label: 'Rounds', only: 'online', type: 'seg', values: CUP_ROUNDS.map((n) => [n, String(n)]), show: (s) => s.game === 'cup', hint: () => 'The last round counts double.' },
  { id: 'bots', key: 'bots', hot: 'b', label: 'Bots', only: 'practice', type: 'seg', values: [1, 2, 3, 4, 5].map((n) => [n, String(n)]) },
  { id: 'duration', key: 'duration', hot: 'l', label: 'Round length', type: 'seg', values: DURATIONS.map((d) => [d, `${d} s`]) },
  { id: 'powerups', key: 'powerups', hot: 'p', label: 'Lucky boxes', type: 'seg', values: [[true, 'On'], [false, 'Off']] },
];
const settings = () => (kind === 'practice' ? practice : room.settings);
const locked = () => kind === 'online' && !amHost();
const isOn = (o, s, value) => (o.on ? o.on(s, value) : String(s[o.key]) === String(value));

function changeSetting(patch) {
  if (kind === 'practice') {
    Object.assign(practice, patch);
    store.set('tag.practice', JSON.stringify(practice));
  } else {
    if (!amHost()) return;
    Object.assign(room.settings, patch);
    socket.emit('settings', patch);
  }
  syncOptions();
}

// Every choice is a real radio button underneath, so the arrow keys work for free.
function radio(o, value, i) {
  const inp = document.createElement('input');
  inp.type = 'radio';
  inp.name = `opt-${o.id}`;
  inp.value = String(value);
  inp.dataset.i = i;
  inp.addEventListener('change', () => changeSetting({ [o.key]: value }));
  return inp;
}

function buildOptions() {
  const box = $('options');
  box.textContent = '';
  $('room-open').textContent = '';
  for (const o of OPTIONS) {
    if (o.only && o.only !== kind) continue;
    if (o.type === 'cards') {
      // picture cards: one per arena / art style, painted a moment later
      const grid = $(o.box);
      grid.textContent = '';
      const n = o.values.length;
      grid.style.setProperty('--cols', o.id === 'arena' ? (n <= 6 ? 3 : n <= 8 ? 4 : n <= 10 ? 5 : 6) : 4);
      o.values.forEach(([value, text], i) => {
        const card = el('label', 'card');
        let pic;
        if (value === 'random') pic = el('span', 'pic any', '?');
        else {
          pic = el('img', 'pic');
          pic.alt = '';
          pic.dataset.id = value;
        }
        card.append(radio(o, value, i), pic, el('span', 'cap', text));
        grid.append(card);
      });
      continue;
    }
    const row = el('div', 'opt');
    row.dataset.id = o.id;
    const lab = el('span', 'lab', o.label);
    lab.append(el('kbd', '', o.hot.toUpperCase()));
    row.append(lab);
    const seg = el('div', o.wrap || o.values.some(([, t]) => t.length > 12) ? 'seg wrap' : 'seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', o.label);
    o.values.forEach(([value, text], i) => {
      const lab = el('label');
      lab.append(radio(o, value, i), el('span', '', text));
      seg.append(lab);
    });
    row.append(seg);
    if (o.hint) row.append(el('span', 'hint'));
    (o.box ? $(o.box) : box).append(row);
  }
}

function syncOptions() {
  const s = settings();
  const lock = locked();
  for (const id of ['options', 'arena-cards', 'style-cards', 'room-open']) $(id).classList.toggle('locked', lock);
  for (const inp of $('s-lobby').querySelectorAll('input[type="radio"]')) {
    const o = OPTIONS.find((x) => x.id === inp.name.slice(4));
    inp.checked = isOn(o, s, o.values[inp.dataset.i][0]);
    inp.disabled = lock;
    inp.parentElement.classList.toggle('on', inp.checked);
  }
  for (const row of $('s-lobby').querySelectorAll('.opt')) {
    const o = OPTIONS.find((x) => x.id === row.dataset.id);
    row.hidden = !!o.show && !o.show(s);
    const hint = row.querySelector('.hint');
    if (hint) hint.textContent = o.hint(s) || '';
  }
  paintCards();
}

// A letter key steps one setting to its next value (Shift: previous) and puts
// the focus there, so the arrow keys carry on from it.
function hotOption(letter, back) {
  if (locked()) return false;
  const s = settings();
  const o = OPTIONS.find((x) => x.hot === letter && (!x.only || x.only === kind) && (!x.show || x.show(s)));
  if (!o) return false;
  const i = o.values.findIndex(([v]) => isOn(o, s, v));
  changeSetting({ [o.key]: o.values[(i + (back ? -1 : 1) + o.values.length) % o.values.length][0] });
  $('s-lobby').querySelector(`input[name="opt-${o.id}"]:checked`)?.focus();
  sfx.play('click');
  return true;
}

// Paint the pictures one at a time between frames, so the screen never stalls:
// each arena in the chosen style, then one still per art style. Everything is
// cached, so this is instant the second time (and the draw before a round
// borrows the same pictures).
let paintRun = 0;
function paintCards() {
  const s = settings();
  const run = ++paintRun;
  const themeId = s.theme === 'random' ? DEFAULT_THEME : s.theme;
  const jobs = [];
  for (const img of $('arena-cards').querySelectorAll('img')) jobs.push([themeId, () => (img.src = scenePreview(img.dataset.id, themeId, 240, 135))]);
  for (const img of $('style-cards').querySelectorAll('img')) if (!img.dataset.done) jobs.push([img.dataset.id, () => ((img.src = styleStill(img.dataset.id)), (img.dataset.done = '1'))]);
  jobs.push([themeId, () => (cardTheme = themeId)]);
  const live = () => run === paintRun && panel === 'lobby';
  const next = async () => {
    const job = jobs.shift();
    if (!job || !live()) return;
    await loadTheme(job[0]);
    if (!live()) return;
    job[1]();
    setTimeout(next, 0);
  };
  next();
}

function openLobby() {
  show('home', 'lobby');
  buildOptions();
  renderLobby();
  focusFirst();
}

function renderLobby() {
  const online = kind === 'online';
  $('lobby-title').textContent = online ? 'Room' : 'Practice';
  $('lobby-code').hidden = !online;
  $('btn-copy').hidden = !online;
  $('btn-leave').setAttribute('aria-label', online ? 'Leave room' : 'Back (Esc)');
  const list = $('players');
  list.textContent = '';
  const rows = online
    ? room.players.slice().sort((a, b) => a.slot - b.slot).map((p) => ({ slot: p.slot, name: p.name, host: p.id === room.hostId, you: p.id === socket.id, score: p.wins ? `${p.wins} win${p.wins > 1 ? 's' : ''}` : '' }))
    : [{ slot: 0, name: myName, you: true }, ...Array.from({ length: practice.bots }, (_, i) => ({ slot: i + 1, name: 'Bot', bot: true }))];
  for (const r of rows) {
    const li = el('li');
    const chip = el('i', 'chip');
    chip.style.background = INK_COLORS[r.slot];
    li.append(chip, el('span', 'nm', r.name));
    if (r.host) li.append(el('span', 'tag', 'HOST'));
    if (r.you) li.append(el('span', 'tag you', 'YOU'));
    if (r.score) li.append(el('span', 'score', r.score));
    list.append(li);
  }
  for (let i = rows.length; i < MAX_PLAYERS; i++) list.append(el('li', 'empty', online ? 'waiting...' : ''));

  const start = $('btn-start');
  if (online) {
    $('lobby-code').textContent = room.code;
    $('players-title').textContent = `Players ${room.players.length}/${MAX_PLAYERS}`;
    const host = room.players.find((p) => p.id === room.hostId);
    const enough = room.players.length >= MIN_PLAYERS;
    start.hidden = !amHost();
    start.disabled = !enough;
    setLabel(start, room.settings.game === 'cup' ? 'Start tournament' : 'Start match', 'Enter');
    const open = !!room.settings.open;
    $('room-open').hidden = false;
    $('lobby-note').textContent = open
      ? `Public: anyone can find this game${enough ? '.' : ' - you need at least 2 players.'}`
      : enough
        ? ''
        : 'Private: share the code with your friends - you need at least 2 players.';
    $('start-note').textContent = amHost() ? '' : `Waiting for ${host ? host.name : 'the host'} to start...`;
  } else {
    $('players-title').textContent = 'Players';
    $('room-open').hidden = true;
    $('lobby-note').textContent = '';
    $('start-note').textContent = '';
    start.hidden = false;
    start.disabled = false;
    setLabel(start, 'Start', 'Enter');
  }
  setLegend(
    $('lobby-legend'),
    locked()
      ? [[['Esc', 'Esc'], 'leave the room'], [['C'], 'copy the invite link']]
      : [[['\u2191', '\u2193'], 'move'], [['\u2190', '\u2192'], 'choose'], [['Enter'], 'start'], ...(online ? [[['V'], 'public or private']] : []), [online ? ['Esc', 'Esc'] : ['Esc'], online ? 'leave the room' : 'back']],
  );
  // Where the keyboard starts: the start button; alone in a room, the invite
  // link. (A guest gets no starting point: Enter must not walk them out.)
  const first = start.hidden ? null : start.disabled ? $('btn-copy') : start;
  for (const b of [start, $('btn-copy')]) b.toggleAttribute('data-autofocus', b === first);
  // someone joined and the match can start: Enter should start it, not copy the link again
  if (first === start && panel === 'lobby' && !overlay && [$('btn-copy'), document.body].includes(document.activeElement)) focusFirst();
  syncOptions();
}

function leaveRoom() {
  const wasOnline = kind === 'online';
  if (wasOnline && room) socket.emit('leave');
  play.stop();
  toHome('', wasOnline ? $('btn-play') : $('btn-practice'));
}
$('btn-leave').addEventListener('click', leaveRoom);
$('btn-start').addEventListener('click', () => {
  sfx.play('click');
  if (kind === 'practice') play.practice(practice, myName);
  else socket.emit('start');
});
async function copyInvite() {
  if (!room) return;
  const link = `${location.origin}/?room=${room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied');
  } catch {
    toast(link);
  }
}
$('btn-copy').addEventListener('click', copyInvite);

// ---------------------------------------------------------------------------
// Fonts: pictures painted before they arrive have to be painted again
// ---------------------------------------------------------------------------
const fonts = Promise.all(['Kaushan Script', 'Shippori Mincho', 'Cormorant Garamond', 'Orbitron', 'Rajdhani', 'Creepster', 'Special Elite', 'Permanent Marker', 'Patrick Hand', 'Press Start 2P'].map((f) => document.fonts.load(`16px "${f}"`).catch(() => {})));
let fontsIn = false;
fonts.then(() => {
  fontsIn = true;
  clearPictures();
  if (renderer.arena) renderer.layout(true); // names and signs were drawn with a fallback font
  demos?.refresh();
  if (panel === 'lobby') {
    for (const img of $('style-cards').querySelectorAll('img')) delete img.dataset.done;
    paintCards();
  }
});

// ---------------------------------------------------------------------------
// Pause menu
// ---------------------------------------------------------------------------
function openPause() {
  if (screen !== 'game' || overlay) return;
  $('pause-note').textContent = kind === 'practice' ? 'The match is on hold.' : `Room ${room?.code || ''} - the match carries on without you.`;
  $('btn-pause-full').hidden = !canFullscreen;
  play.hold(true); // practice really pauses; an online match carries on behind the menu
  setOverlay('pause');
}
function closePause() {
  setOverlay('');
  play.hold(false);
}
$('btn-resume').addEventListener('click', closePause);
$('btn-pause-help').addEventListener('click', openHelp);
$('btn-pause-full').addEventListener('click', () => {
  toggleFullscreen();
  closePause();
});
$('btn-quit').addEventListener('click', leaveRoom);

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');

// a small seal with a word beside it: who won, who was it at the end
function mark(glyph, word, dark) {
  const m = el('span', 'mark');
  m.append(el('i', dark ? 'seal sm dark' : 'seal sm', glyph), word);
  return m;
}

function showResults(res) {
  lastResults = res;
  clearInterval(nextTimer);
  draw.clear();
  const mySlot = play.mySlot();
  const cup = res.cup;
  const team = res.team || null;
  const iWon = res.winners.includes(mySlot);
  const nameOf = (slot) => (res.rows.find((r) => r.slot === slot) || cup?.table.find((r) => r.slot === slot))?.name || `Player ${slot + 1}`;
  const winners = res.winners.map(nameOf);
  const forfeit = res.reason === 'forfeit';
  let kicker;
  let title;
  let sub = '';
  if (team) {
    // team battle: this round's score, or the running total of a tournament
    const mine = res.rows.find((r) => r.slot === mySlot)?.team ?? -1;
    const final = !cup || cup.final;
    const tally = cup && team.total ? team.total : team.score;
    const lead = final ? team.win : tally[0] === tally[1] ? -1 : tally[0] > tally[1] ? 0 : 1;
    const side = (t) => (t === mine ? 'Your team' : TEAM_NAMES[t]);
    const points = `A bomb that goes off scores ${BOMB_POINTS} for the other team, a captured flag ${FLAG_POINTS}.`;
    if (cup) {
      kicker = cup.final ? 'Tournament over - Team Bomb' : `Round ${cup.round} of ${cup.rounds} - Team Bomb`;
      if (cup.final) {
        title = lead < 0 ? 'The tournament ends level!' : lead === mine ? 'Your team wins the tournament!' : `${TEAM_NAMES[lead]} win the tournament!`;
        sub = forfeit ? 'Everyone else left.' : 'Final score.';
      } else {
        title = lead < 0 ? `Level at ${tally[0]} all` : `${side(lead)} ${lead === mine ? 'leads' : 'lead'} ${tally[lead]} - ${tally[1 - lead]}`;
        sub = `${points} The last round counts double.`;
      }
    } else {
      kicker = forfeit ? 'Match over' : 'Team Bomb';
      title = lead < 0 ? 'A draw!' : lead === mine ? 'Your team wins!' : `${TEAM_NAMES[lead]} win!`;
      sub = forfeit ? 'Everyone else left.' : points;
    }
  } else if (cup) {
    kicker = cup.final ? 'Tournament over' : `Round ${cup.round} of ${cup.rounds}`;
    if (cup.final) {
      title = iWon ? 'You win the tournament!' : `${list(winners)} win${winners.length > 1 ? '' : 's'} the tournament!`;
      sub = forfeit ? 'Everyone else left.' : 'Final standings.';
    } else {
      const lead = cup.table[0];
      const tied = cup.table.filter((r) => r.pts === lead.pts).length > 1;
      title = tied ? 'Level at the top' : lead.slot === mySlot ? 'You are in the lead' : `${lead.name} is in the lead`;
      sub = 'Points for the least time as the oni, plus one if you were not it at the buzzer.';
    }
  } else if (forfeit) {
    kicker = 'Match over';
    title = iWon ? 'You win!' : `${list(winners)} wins!`;
    sub = 'Everyone else left.';
  } else if (res.mode === 'potato') {
    kicker = 'Hot Potato';
    title = res.loser === mySlot ? 'You were the oni. You lose!' : iWon ? 'You got away!' : `${nameOf(res.loser)} loses!`;
    sub = `${res.loser === mySlot ? 'You were' : `${nameOf(res.loser)} was`} it when the clock ran out.`;
  } else {
    kicker = 'Least Time';
    title = iWon ? (winners.length > 1 ? 'You share the win!' : 'You win!') : `${list(winners)} win${winners.length > 1 ? '' : 's'}!`;
    sub = 'Least time as the oni wins.';
  }
  $('res-kicker').textContent = kicker;
  $('res-title').textContent = title;
  $('res-sub').textContent = sub;
  $('res-teams').hidden = !team;
  $('res-table').hidden = !!team;
  if (team) paintSides(res, mySlot);
  else paintTable(res, mySlot);

  renderResultButtons();
  setOverlay('results');
  if (cup && !cup.final) {
    // the next round starts by itself
    const until = performance.now() + cup.next;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - performance.now()) / 1000));
      if (lastResults === res) $('res-note').textContent = `Next round in ${left}...`;
    };
    tick();
    nextTimer = setInterval(tick, 250);
  }
  sfx.play(iWon || (cup && !cup.final && res.loser !== mySlot) ? 'win' : 'lose');
}

// everyone for themselves: one table
function paintTable(res, mySlot) {
  const cup = res.cup;
  const table = $('res-table');
  table.textContent = '';
  const head = el('tr');
  for (const h of cup ? ['', 'Player', 'As oni', 'Round', 'Total'] : ['', 'Player', 'As oni', 'Tags']) head.append(el('th', '', h));
  table.append(head);
  const rows = cup ? cup.table.map((t) => ({ ...t, row: res.rows.find((r) => r.slot === t.slot) })) : res.rows.map((r) => ({ slot: r.slot, name: r.name, row: r }));
  rows.forEach((r, i) => {
    const tr = el('tr');
    const final = !cup || cup.final;
    if (r.slot === mySlot) tr.classList.add('me');
    const who = el('td', 'who');
    const chip = el('i', 'chip');
    chip.style.background = play.colorOf(r.slot);
    who.append(chip, r.name);
    // a seal for the winner, and one for whoever was it at the end
    if (final && res.winners.includes(r.slot)) who.append(mark('\u52dd', 'wins'));
    if (res.loser === r.slot && res.reason !== 'forfeit') who.append(mark('\u9b3c', 'it', true));
    tr.append(el('td', '', String(i + 1)), who, el('td', '', r.row ? secs(r.row.ms) : '-'));
    if (cup) tr.append(el('td', 'gain', r.row ? `+${r.gained}` : '-'), el('td', '', `${r.pts} pts`));
    else tr.append(el('td', '', String(r.row.tags)));
    table.append(tr);
  });
}

// team battle: the two sides face to face, each in its colour
function paintSides(res, mySlot) {
  const { score, win, total } = res.team;
  const cup = res.cup;
  const final = !cup || cup.final;
  const box = $('res-teams');
  box.textContent = '';
  [0, 1].forEach((t) => {
    const side = el('div', 'side');
    side.style.setProperty('--side', TEAM_COLORS[t]);
    const won = final && win === t;
    side.classList.toggle('won', won);
    side.classList.toggle('lost', final && win === 1 - t);
    const head = el('header');
    const tally = el('span', 'tally', String(cup && total ? total[t] : score[t]));
    head.append(el('b', 'nm', TEAM_NAMES[t]), tally);
    if (cup && total) head.append(el('small', '', `+${score[t] * (cup.double ? 2 : 1)} this round${cup.double ? ' (double)' : ''}`));
    if (won) head.append(mark('\u52dd', 'wins'));
    else if (final && win < 0) head.append(el('small', '', 'a draw'));
    side.append(head);
    const ul = el('ul');
    const hd = el('li', 'hd');
    hd.append(el('span', '', 'Player'), el('span', '', 'Bomb held'), el('span', '', 'Passed'));
    ul.append(hd);
    for (const r of res.rows) {
      if (r.team !== t) continue;
      const li = el('li', r.slot === mySlot ? 'me' : '');
      const chip = el('i', 'chip');
      chip.style.background = play.colorOf(r.slot);
      const who = el('span', 'who');
      who.append(chip, r.name);
      li.append(who, el('span', '', secs(r.ms)), el('span', '', String(r.tags)));
      ul.append(li);
    }
    side.append(ul);
    box.append(side);
    if (t === 0) box.append(el('i', 'vs', 'vs'));
  });
}

function renderResultButtons() {
  const res = lastResults;
  if (!res) return;
  const back = $('btn-res-back');
  const again = $('btn-res-again');
  const between = res.cup && !res.cup.final;
  if (kind === 'practice') {
    setLabel(back, 'Change setup', 'Esc');
    setLabel(again, 'Play again', 'Enter');
    again.hidden = false;
    $('res-note').textContent = '';
  } else {
    const host = amHost();
    setLabel(back, host ? (between ? 'End tournament' : 'Back to lobby') : 'Leave', host && !between ? 'Esc' : 'Esc Esc');
    again.hidden = !host || between;
    setLabel(again, res.cup ? 'New tournament' : 'Play again', 'Enter');
    again.disabled = !room || room.players.length < MIN_PLAYERS;
    if (!between) {
      const h = room?.players.find((p) => p.id === room.hostId);
      $('res-note').textContent = host ? (again.disabled ? 'Waiting for another player...' : '') : `Waiting for ${h ? h.name : 'the host'}...`;
    }
  }
  again.toggleAttribute('data-autofocus', !again.hidden);
  back.toggleAttribute('data-autofocus', again.hidden);
}

$('btn-res-again').addEventListener('click', () => {
  sfx.play('click');
  if (kind === 'practice') play.practice(practice, myName);
  else socket.emit('start');
});
function resultsBack() {
  clearInterval(nextTimer);
  if (kind === 'practice') {
    play.stop();
    kind = 'practice';
    openLobby();
  } else if (amHost()) socket.emit('lobby');
  else leaveRoom();
}
$('btn-res-back').addEventListener('click', resultsBack);

// ---------------------------------------------------------------------------
// Server events
// ---------------------------------------------------------------------------
socket.on('room', (r) => {
  if (!room || room.code !== r.code) return; // not in (or no longer in) this room
  room = r;
  net.code = r.code;
  if (r.phase === 'lobby') {
    clearInterval(nextTimer);
    if ((panel === 'help' || panel === 'profile') && kind === 'online') renderLobby(); // reading How to play (or their profile) in a room: leave them to it
    else if (panel !== 'lobby' || overlay || kind !== 'online') {
      kind = 'online';
      openLobby();
    } else renderLobby();
  } else if (overlay === 'results') renderResultButtons();
});

socket.on('round', (msg) => {
  if (!room) return;
  clearInterval(nextTimer);
  const mine = me();
  const mySlot = mine && msg.players.some((p) => p.slot === mine.slot) ? mine.slot : -1;
  net.code = room.code;
  kind = 'online';
  play.round(msg, mySlot);
});
socket.on('end', (res) => {
  if (!room) return;
  if (play.game !== net) {
    // joined while the scoreboard was up: nothing to show behind it yet
    play.game = net;
    show('game');
  }
  play.finish();
  showResults(res);
});
socket.on('toast', (text) => toast(String(text)));
socket.on('q', (ack) => typeof ack === 'function' && ack()); // the server timing our connection

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
function goBack() {
  if (overlay === 'help') closeHelp();
  else if (overlay === 'pause') closePause();
  else if (overlay === 'results') {
    // straight back when it only changes screens; twice when it would leave a game
    const safe = kind === 'practice' || (amHost() && !(lastResults?.cup && !lastResults.cup.final));
    if (safe || twice('results', `Press Esc again to ${amHost() ? 'end the tournament' : 'leave the room'}`)) resultsBack();
  } else if (screen === 'game') openPause();
  else if (panel === 'help') closeHelp();
  else if (panel === 'profile') closeProfile();
  else if (panel === 'find') openRooms(code);
  else if (panel === 'rooms') closePanel();
  else if (panel === 'lobby') {
    if (kind === 'practice') closePanel();
    else if (twice('leave', 'Press Esc again to leave the room')) leaveRoom();
  } else if (screen === 'name' && myName) toHome();
}

// One place for every shortcut. Returns true when the key was used.
function shortcut(key, e) {
  const at = top();
  const onButton = document.activeElement?.tagName === 'BUTTON';
  const typing = document.activeElement?.tagName === 'INPUT' && document.activeElement.type === 'text';
  if (typing) return false; // letters belong to the name being typed

  // anywhere: sound and full screen
  if (key === 'm') return toggleSound(true), true;
  if (key === 'f') return toggleFullscreen(), true;
  if (at === 'game') return false; // everything else belongs to the match

  // every menu: how to play
  if (key === 'h' && at !== 'results') return at === 'help' ? closeHelp() : openHelp(), true;

  if (at === 'home' || ((at === 'help' || at === 'profile' || at === 'find') && screen === 'home')) {
    // the title scroll's entries (digits are a room code while Play is open)
    if (key === '1') return $('btn-play').click(), true;
    if (key === '2') return $('btn-practice').click(), true;
    if (key === '3') return $('btn-profile').click(), true;
  }
  // the tools under the menu sit in a row: left and right walk along it
  if ((key === 'arrowleft' || key === 'arrowright') && document.activeElement?.classList.contains('tool')) return moveFocus(key === 'arrowright' ? 1 : -1), true;
  if (at === 'rooms') {
    if (/^\d$/.test(key)) return typeCode(code + key), true;
    if (key === 'backspace') return typeCode(code.slice(0, -1)), true;
    if (key === 'c') return $('btn-create').click(), true;
    if (key === 'p') return openFind(), true;
    // Enter on the code (or anywhere but a button, once the code is complete) tries it again
    if (key === 'enter' && code.length === CODE_LEN && (!onButton || document.activeElement === $('btn-join-go'))) return retryCode(), true;
    if (key === 'enter' && document.activeElement === $('digits')) return true;
  } else if (at === 'find') {
    if (key === 'c') return $('btn-find-host').click(), true;
  } else if (at === 'lobby') {
    if (key === 'enter' && !onButton) {
      if (!$('btn-start').hidden && !$('btn-start').disabled) $('btn-start').click();
      return true;
    }
    if (key === 'c' && kind === 'online') return copyInvite(), true;
    if (/^[a-z]$/.test(key)) return hotOption(key, e.shiftKey);
  } else if (at === 'pause') {
    if (key === 'q') {
      if (twice('quit', 'Press Q again to leave the match')) leaveRoom();
      return true;
    }
  } else if (at === 'results') {
    if (key === 'enter' && !onButton) {
      const again = $('btn-res-again');
      if (!again.hidden && !again.disabled) again.click();
      return true;
    }
    if (key === 'arrowleft' || key === 'arrowright') return moveFocus(key === 'arrowright' ? 1 : -1), true;
  } else if (at === 'help') {
    // read the scroll with the arrow keys
    const step = { arrowdown: 90, arrowup: -90, pagedown: 420, pageup: -420, ' ': 420 }[key];
    if (step) return $(overlay === 'help' ? 's-help' : 'ui').scrollBy({ top: step }), true;
  }
  if (key === 'arrowdown' || key === 'arrowup') return moveFocus(key === 'arrowdown' ? 1 : -1), true;
  return false;
}

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // a real keyboard is here: show the key cues (matters on tablets)
  if (/^(Arrow|Escape|Tab)/.test(e.key)) document.body.classList.remove('no-kbd');
  if (e.key === 'Escape') {
    e.preventDefault();
    return goBack();
  }
  if (shortcut(e.key.toLowerCase(), e)) e.preventDefault();
});

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (screen === 'game') renderer.arena && renderer.resize();
    else paintScene();
  }, 150);
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
const invite = (new URLSearchParams(location.search).get('room') || '').replace(/\D/g, '').slice(0, CODE_LEN);
if (invite) history.replaceState(null, '', location.pathname);
const start = () => (invite.length === CODE_LEN ? openRooms(invite) : toHome());
if (myName) start();
else askName(start);

// Handy for debugging from the browser console (and used by the automated checks).
window.__tag = { renderer, net, socket, input, get game() { return play.game; }, play, draw, get demos() { return demos; }, get screen() { return top(); }, get room() { return room; }, fontsReady: () => fontsIn };
