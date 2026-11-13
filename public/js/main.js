// Onigokko - everything outside the match itself: the title scroll, the ways
// to play (host, public, private), your profile, match setup, how to play,
// the draw before a round, results.
//
// On a wide screen the title scroll stays on the left and whatever you open
// (play, public games, profile, match setup, how to play) opens beside it; on a narrow one there is
// one panel at a time. Every screen can be driven with the keyboard alone
// (arrows + Enter, Esc to go back, a letter or number for most things).

import { MODES, DURATIONS, DEFAULT_DURATION, DEFAULT_THEME, THEMES, CUP_ROUNDS, NAME_MAX, CODE_LEN, MIN_PLAYERS, MAX_PLAYERS, TEAM_NAMES, TEAM_COLORS, TEAM_SLOTS, BOMB_POINTS, FLAG_POINTS, FLAG_PAY_TICKS, FLAG_CAP_TICKS, TICK_RATE, ITEM_KINDS, ITEM_INFO, ITEM_LOCK_TICKS } from '/shared/config.js';
import { ARENAS } from '/shared/arenas.js';
import { botFill } from '/shared/sim.js';
import { BOT_NAMES } from '/shared/bots.js';
import { play } from './play.js';
import { scenePreview, styleStill, clearPictures, paintBackdrop, paperTexture } from './art.js';
import * as art from './art.js'; // (also: playerPortrait, for the results)
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
const INK_COLORS = ['#c8372d', '#2f62b0', '#3c8f57', '#d79a12', '#7a4a9e', '#d9689a', '#d2691e', '#2a8f8f', '#7a5230', '#7c8088']; // the house style's ten player colours
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
  const stops = [...root.querySelectorAll('button, input[type="text"], .seg, .cards, .digits, .rounds')].filter((e) => {
    if (e.closest('.numpad') || e.closest('.locked') || e.closest('.demo')) return false;
    if (e.classList.contains('slot')) return false; // (the rounds of a tournament are one stop: left and right move along them)
    return !e.disabled && e.offsetParent !== null;
  });
  if (!stops.length) return;
  const cur = stops.findIndex((s) => s === document.activeElement || s.contains(document.activeElement));
  const next = stops[cur < 0 ? (dir > 0 ? 0 : stops.length - 1) : (cur + dir + stops.length) % stops.length];
  const group = next.classList.contains('seg') || next.classList.contains('cards');
  if (next.classList.contains('rounds')) (next.querySelector('[aria-checked="true"]') || next.querySelector('button'))?.focus();
  else (group ? next.querySelector('input:checked') || next.querySelector('input') : next).focus();
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
  $('profile-note').textContent = room ? `You are in room ${room.code}. Leave the room to change your name.` : '';
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
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const flagPay = `${plural(FLAG_POINTS, 'point')} every ${Math.round(FLAG_PAY_TICKS / TICK_RATE)} seconds`;
for (const [key, value] of Object.entries({ bomb: plural(BOMB_POINTS, 'point'), flagpay: flagPay, flagtime: (FLAG_CAP_TICKS / TICK_RATE).toFixed(1).replace('.0', ''), lock: Math.round(ITEM_LOCK_TICKS / TICK_RATE), rounds: orList(CUP_ROUNDS) })) {
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
  $('find-count').textContent = n ? `${n} open` : '';
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
  $('find-lead').textContent = socket.connected ? '' : 'Waking up the server - this can take up to a minute...';
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
// The screen reads top to bottom, in the order you decide things: what game
// (one match or a tournament, and which game), who is in it (a list - or, for
// a team battle, the two sides), where it is played (an arena and a style; a
// tournament has one of each per round), and a last few switches beside Start.
//
// Every row below writes one setting (`key`) - or says how with `set`. `box`
// is where it is drawn, `show` when, `hot` the key that steps it.
const MODE_ICON = { potato: 'flame', time: 'glass', team: 'bomb' };
const OPTIONS = [
  { id: 'game', key: 'game', hot: 'g', label: 'Format', only: 'online', box: 'opt-format', values: [['quick', 'One match'], ['cup', 'Tournament']] },
  { id: 'rounds', key: 'rounds', hot: 'n', label: 'Rounds', only: 'online', box: 'opt-format', values: CUP_ROUNDS.map((n) => [n, String(n)]), show: (s) => s.game === 'cup' },
  { id: 'mode', key: 'mode', hot: 'r', label: 'Game', box: 'opt-mode', icon: (v) => MODE_ICON[v], values: MODES.map((m) => [m.id, m.name]), show: (s) => s.game !== 'cup' },
  // a tournament is scored on time as the oni (everyone for themselves), or played as a team battle
  { id: 'sides', key: 'mode', hot: 'r', label: 'Game', only: 'online', box: 'opt-mode', icon: (v) => (v === 'team' ? 'bomb' : 'crowd'), values: [['potato', 'Free-for-all'], ['team', 'Team Bomb']], on: (s, v) => (v === 'team') === (s.mode === 'team'), show: (s) => s.game === 'cup' },
  { id: 'arena', hot: 'a', type: 'cards', box: 'arena-cards', values: [...ARENAS.map((a) => [a.id, a.name]), ['random', 'Random']], on: (s, v) => stageValue('arena') === v, set: (v) => setStage('arena', v) },
  { id: 'theme', hot: 's', type: 'cards', box: 'style-cards', values: [...THEMES.map((t) => [t.id, t.name]), ['random', 'Random']], on: (s, v) => stageValue('theme') === v, set: (v) => setStage('theme', v) },
  { id: 'bots', key: 'bots', hot: 'b', label: 'Bots', only: 'practice', box: 'options', values: [1, 2, 3, 5, 7, 9].map((n) => [n, String(n)]) },
  { id: 'duration', key: 'duration', hot: 'l', label: 'Round', box: 'options', values: DURATIONS.map((d) => [d, `${d} s`]) },
  { id: 'powerups', key: 'powerups', hot: 'p', label: 'Lucky boxes', box: 'options', values: [[true, 'On'], [false, 'Off']] },
];
const settings = () => (kind === 'practice' ? practice : room.settings);
const locked = () => kind === 'online' && !amHost();
const isOn = (o, s, value) => (o.on ? o.on(s, value) : String(s[o.key]) === String(value));
const isCup = () => kind === 'online' && room.settings.game === 'cup';

// (see the 'room' handler: how a host's own changes are kept from being undone by late echoes)
const SETTLE_MS = 450;
let settingsAt = -1e9;
let echoed = null;
let settleTimer = 0;
function settle() {
  if (!room || !echoed || performance.now() - settingsAt < SETTLE_MS) return;
  room.settings = echoed;
  echoed = null;
  if (panel === 'lobby' && kind === 'online' && !overlay) renderLobby();
}
const touched = () => {
  settingsAt = performance.now();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, SETTLE_MS + 20);
};

function changeSetting(patch) {
  if (kind === 'practice') {
    Object.assign(practice, patch);
    store.set('tag.practice', JSON.stringify(practice));
  } else {
    if (!amHost()) return;
    const s = room.settings;
    // (what the server will do too, so the screen does not wait for it)
    if (patch.game === 'cup' && s.game !== 'cup' && patch.mode === undefined) s.mode = 'team';
    Object.assign(s, patch);
    socket.emit('settings', patch);
    touched();
  }
  syncOptions();
}

// --- the stage: an arena and a style. A tournament has one of each for every
// round; `stageSel` says which round the picture cards are for right now.
let stageSel = 'all'; // 'all', or a round of the tournament (0 = the first)
const planNow = () => room.settings.plan.slice(0, isCup() ? room.settings.rounds : 1);

// What the cards should show as chosen: the selected round's pick - for "all
// rounds", the pick they all share ('' if they do not).
function stageValue(what) {
  if (kind === 'practice') return practice[what];
  const plan = planNow();
  if (stageSel !== 'all' && isCup()) return plan[Math.min(stageSel, plan.length - 1)][what];
  return plan.every((st) => st[what] === plan[0][what]) ? plan[0][what] : '';
}
function setStage(what, value) {
  if (kind === 'practice') return changeSetting({ [what]: value });
  if (!amHost()) return;
  const s = room.settings;
  if (stageSel === 'all' || !isCup()) {
    for (const st of s.plan) st[what] = value;
    socket.emit('settings', { [what]: value });
  } else {
    s.plan[stageSel][what] = value;
    socket.emit('settings', { stage: { i: stageSel, [what]: value } });
  }
  touched();
  s[what] = s.plan[0][what];
  syncOptions();
}
const stageName = (what, id) => (id === 'random' ? 'Surprise' : (what === 'arena' ? ARENAS : THEMES).find((x) => x.id === id)?.name || id);

// A tournament: one slot per round (and one for all of them at once).
function renderRounds() {
  const strip = $('round-strip');
  const cup = isCup();
  strip.hidden = !cup;
  if (!cup) {
    stageSel = 'all';
    strip.textContent = '';
    return;
  }
  const plan = planNow();
  if (stageSel !== 'all' && stageSel >= plan.length) stageSel = 'all';
  const sig = JSON.stringify([plan, stageSel]);
  if (strip.dataset.sig === sig) return;
  strip.dataset.sig = sig;
  const held = strip.contains(document.activeElement) ? document.activeElement.dataset.i : null;
  strip.textContent = '';
  const add = (value, title, st) => {
    const b = el('button', 'slot');
    b.type = 'button';
    b.dataset.i = String(value);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(stageSel === value));
    b.append(el('b', '', title));
    // (a round's slot says what it is played on: the arena, and under it the style)
    if (st) b.append(el('span', st.arena === 'random' ? 'any' : '', stageName('arena', st.arena)), el('span', st.theme === 'random' ? 'any st' : 'st', stageName('theme', st.theme)));
    else b.title = 'One arena and one style for every round';
    b.addEventListener('click', () => pickRound(value));
    strip.append(b);
  };
  add('all', 'All');
  plan.forEach((st, i) => add(i, String(i + 1), st));
  if (held != null) strip.querySelector(`[data-i="${held}"]`)?.focus();
}
function pickRound(value) {
  stageSel = value;
  sfx.play('click');
  syncOptions();
}

// Every choice is a real radio button underneath, so the arrow keys work for free.
function radio(o, value, i) {
  const inp = document.createElement('input');
  inp.type = 'radio';
  inp.name = `opt-${o.id}`;
  inp.value = String(value);
  inp.dataset.i = i;
  inp.addEventListener('change', () => (o.set ? o.set(value) : changeSetting({ [o.key]: value })));
  return inp;
}

function buildOptions() {
  for (const id of ['options', 'opt-format', 'opt-mode']) $(id).textContent = '';
  for (const o of OPTIONS) {
    if (o.only && o.only !== kind) continue;
    if (o.type === 'cards') {
      // picture cards: one per arena / art style, in a single row, painted a moment later
      const grid = $(o.box);
      grid.textContent = '';
      grid.style.setProperty('--cols', o.values.length);
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
    const row = el('div', o.icon ? 'opt modes' : 'opt');
    row.dataset.id = o.id;
    const lab = el('span', 'lab', o.label);
    lab.append(el('kbd', '', o.hot.toUpperCase()));
    row.append(lab);
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', o.label);
    o.values.forEach(([value, text], i) => {
      const item = el('label');
      const face = el('span', '', text);
      if (o.icon) face.insertAdjacentHTML('afterbegin', `<svg class="ic" aria-hidden="true"><use href="#i-${o.icon(value)}" /></svg>`);
      item.append(radio(o, value, i), face);
      seg.append(item);
    });
    row.append(seg);
    $(o.box).append(row);
  }
  // practice has no format to choose: the games stand alone under the heading, which then carries their key
  const solo = !$('opt-format').childElementCount;
  $('opt-format').hidden = solo;
  document.querySelector('.blk.what').classList.toggle('solo', solo);
  const head = document.querySelector('.blk.what h3');
  head.textContent = 'Game';
  if (solo) head.append(el('kbd', '', 'R'));
}

function syncOptions() {
  const s = settings();
  const lock = locked();
  renderRounds();
  for (const id of ['options', 'opt-format', 'opt-mode', 'arena-cards', 'style-cards']) $(id).classList.toggle('locked', lock);
  for (const inp of $('s-lobby').querySelectorAll('input[type="radio"]')) {
    const o = OPTIONS.find((x) => x.id === inp.name.slice(4));
    inp.checked = isOn(o, s, o.values[inp.dataset.i][0]);
    inp.disabled = lock;
    inp.parentElement.classList.toggle('on', inp.checked);
  }
  for (const row of $('s-lobby').querySelectorAll('.opt')) {
    const o = OPTIONS.find((x) => x.id === row.dataset.id);
    row.hidden = !!o.show && !o.show(s);
  }
  // one line about the game that is chosen - no more
  const cup = isCup();
  $('mode-note').textContent = cup
    ? s.mode === 'team'
      ? 'The sides stay together and their points add up. The last round counts double.'
      : 'Points each round for the least time as the oni. The last round counts double.'
    : MODES.find((m) => m.id === s.mode)?.blurb || '';
  $('stage-title').textContent = cup ? (stageSel === 'all' ? 'Stage - every round' : `Stage - round ${stageSel + 1}`) : 'Stage';
  for (const key of ['A', 'S', ...(cup ? ['T'] : [])]) $('stage-title').append(el('kbd', '', key));
  // who can come in
  const sw = $('btn-open');
  sw.hidden = kind !== 'online';
  if (kind === 'online') {
    sw.setAttribute('aria-checked', String(!!s.open));
    sw.disabled = lock;
    $('open-label').textContent = s.open ? 'Public' : 'Private';
    sw.title = s.open ? 'Public: anyone can find this game' : 'Private: only people with the code can come in';
  }
  paintCards();
}
$('btn-open').addEventListener('click', () => {
  if (kind !== 'online' || !amHost()) return;
  sfx.play('click');
  changeSetting({ open: !room.settings.open });
});

// A letter key steps one setting to its next value (Shift: previous) and puts
// the focus there, so the arrow keys carry on from it.
function hotOption(letter, back) {
  const s = settings();
  if (letter === 't' && isCup()) {
    // which round the arena and style are for: all, 1, 2, ...
    const order = ['all', ...planNow().map((_, i) => i)];
    pickRound(order[(order.indexOf(stageSel) + (back ? -1 : 1) + order.length) % order.length]);
    $('round-strip').querySelector('[aria-checked="true"]')?.focus();
    return true;
  }
  if (locked()) return false;
  // (the switch is not focused: Enter must still start the match right after)
  if (letter === 'v' && kind === 'online') return $('btn-open').click(), true;
  const o = OPTIONS.find((x) => x.hot === letter && (!x.only || x.only === kind) && (!x.show || x.show(s)));
  if (!o) return false;
  const i = o.values.findIndex(([v]) => isOn(o, s, v));
  const next = o.values[(i + (back ? -1 : 1) + o.values.length) % o.values.length][0];
  if (o.set) o.set(next);
  else changeSetting({ [o.key]: next });
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
  const run = ++paintRun;
  const chosen = stageValue('theme');
  const themeId = !chosen || chosen === 'random' ? DEFAULT_THEME : chosen;
  const jobs = [];
  for (const img of $('arena-cards').querySelectorAll('img')) {
    if (img.dataset.in === themeId) continue;
    jobs.push([themeId, () => ((img.src = scenePreview(img.dataset.id, themeId, 240, 135)), (img.dataset.in = themeId))]);
  }
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
  // a team battle in a room shows the two sides instead of one list
  const sided = online && room.settings.mode === 'team';
  list.hidden = sided;
  $('squads').hidden = !sided;
  if (sided) renderSquads();
  const rows = sided
    ? []
    : online
      ? room.players.slice().sort((a, b) => a.slot - b.slot).map((p) => ({ slot: p.slot, name: p.name, host: p.id === room.hostId, you: p.id === socket.id, score: p.wins ? `${p.wins} win${p.wins > 1 ? 's' : ''}` : '' }))
      : [{ slot: 0, name: myName, you: true }, ...Array.from({ length: practice.bots }, (_, i) => ({ slot: i + 1, name: BOT_NAMES[i] || 'Bot', bot: true }))];
  for (const r of rows) {
    // your own name is underlined in red, here as on the team board and the results
    const li = el('li', r.bot ? 'bot' : r.you ? 'me' : '');
    const chip = el('i', 'chip');
    chip.style.background = INK_COLORS[r.slot];
    li.append(chip, el('span', 'nm', r.name));
    if (r.you) li.title = 'You';
    if (r.host) li.append(el('span', 'tag', 'HOST'));
    if (r.bot) li.append(el('span', 'tag bot', 'BOT'));
    if (r.score) li.append(el('span', 'score', r.score));
    list.append(li);
  }
  // one "waiting" place, so it is plain that more can come
  if (online && !sided && rows.length < MAX_PLAYERS) list.append(el('li', 'empty', 'waiting...'));

  const start = $('btn-start');
  if (online) {
    $('lobby-code').textContent = room.code;
    $('players-title').textContent = `Players ${room.players.length}/${MAX_PLAYERS}`;
    const host = room.players.find((p) => p.id === room.hostId);
    const enough = room.players.length >= MIN_PLAYERS;
    start.hidden = !amHost();
    start.disabled = !enough;
    setLabel(start, room.settings.game === 'cup' ? 'Start tournament' : 'Start match', 'Enter');
    $('lobby-note').textContent = enough ? '' : 'You need at least 2 players - send someone the code or the invite link.';
    $('start-note').textContent = amHost() ? '' : `Waiting for ${host ? host.name : 'the host'} to start...`;
  } else {
    $('players-title').textContent = 'Players';
    $('lobby-note').textContent = '';
    $('start-note').textContent = '';
    start.hidden = false;
    start.disabled = false;
    setLabel(start, 'Start', 'Enter');
  }
  setLegend(
    $('lobby-legend'),
    locked()
      ? [[['Esc', 'Esc'], 'leave the room'], [['C'], 'copy the invite link'], ...(sided ? [[['X'], 'change sides']] : [])]
      : [[['↑', '↓'], 'move'], [['←', '→'], 'choose'], [['Enter'], 'start'], ...(sided ? [[['X'], 'change sides']] : []), [online ? ['Esc', 'Esc'] : ['Esc'], online ? 'leave the room' : 'back']],
  );
  // Where the keyboard starts: the start button; alone in a room, the invite
  // link. (A guest gets no starting point: Enter must not walk them out.)
  const first = start.hidden ? null : start.disabled ? $('btn-copy') : start;
  for (const b of [start, $('btn-copy')]) b.toggleAttribute('data-autofocus', b === first);
  // someone joined and the match can start: Enter should start it, not copy the link again
  if (first === start && panel === 'lobby' && !overlay && [$('btn-copy'), document.body].includes(document.activeElement)) focusFirst();
  syncOptions();
}

// Team battle: the two sides, face to face, everyone in the colour they will
// wear. The sides are the room's: they stay as they are from match to match
// until someone crosses over (their own arrow, or X) or the host moves people
// (anyone's arrow) or shuffles (Z). A side that is short gets bots.
function renderSquads() {
  const box = $('squads');
  const mine = me();
  const host = amHost();
  const sizes = [0, 1].map((t) => room.players.filter((p) => p.side === t).length);
  const fill = botFill(sizes, MAX_PLAYERS - room.players.length);
  const held = box.contains(document.activeElement) ? document.activeElement.dataset.id || document.activeElement.id : '';
  box.textContent = '';
  const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
  const botNames = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  const seen = [0, 0];
  const colour = (t) => INK_COLORS[TEAM_SLOTS[t][seen[t]++ % TEAM_SLOTS[t].length]];
  // (colours are handed out in the order people came in, bots last - the same way the server does it)
  const chips = new Map(room.players.map((p) => [p.id, colour(p.side)]));
  [0, 1].forEach((t) => {
    const side = el('section', 'squad');
    side.style.setProperty('--side', TEAM_COLORS[t]);
    side.classList.toggle('mine', !!mine && mine.side === t);
    const head = el('header');
    head.append(el('b', '', TEAM_NAMES[t]), el('span', 'n', `${sizes[t]}${fill[t] ? ` + ${fill[t]} bot${fill[t] > 1 ? 's' : ''}` : ''}`));
    side.append(head);
    const ul = el('ul', 'players');
    for (const p of room.players) {
      if (p.side !== t) continue;
      const you = p.id === socket.id;
      const li = el('li', you ? 'me' : '');
      const chip = el('i', 'chip');
      chip.style.background = chips.get(p.id);
      li.append(chip, el('span', 'nm', p.name));
      if (p.id === room.hostId) li.append(el('span', 'tag', 'HOST'));
      if (you || host) {
        // across to the other side: your own arrow, and - for the host - everyone's
        const go = el('button', 'cross');
        go.type = 'button';
        go.dataset.id = p.id;
        go.setAttribute('aria-label', `Move ${you ? 'yourself' : p.name} to ${TEAM_NAMES[1 - t]}`);
        go.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-${t ? 'left' : 'right'}" /></svg>`;
        go.title = you ? 'Change sides (X)' : `Move ${p.name} to ${TEAM_NAMES[1 - t]}`;
        go.addEventListener('click', () => moveSide(p.id, 1 - t));
        li.append(go);
      }
      ul.append(li);
    }
    for (let k = 0; k < fill[t]; k++) {
      const li = el('li', 'bot');
      const chip = el('i', 'chip');
      chip.style.background = colour(t);
      li.append(chip, el('span', 'nm', botNames.shift() || 'Bot'), el('span', 'tag bot', 'BOT'));
      ul.append(li);
    }
    side.append(ul);
    box.append(side);
    if (t === 0) {
      const mid = el('div', 'mid');
      mid.append(el('i', 'vs', 'vs'));
      if (host) {
        const sh = el('button', 'shuffle');
        sh.type = 'button';
        sh.id = 'btn-shuffle';
        sh.setAttribute('aria-label', 'Shuffle the teams (Z)');
        sh.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-shuffle" /></svg>';
        sh.append(el('kbd', '', 'Z'));
        sh.addEventListener('click', shuffleSides);
        mid.append(sh);
      }
      box.append(mid);
    }
  });
  if (held) (box.querySelector(`[data-id="${held}"]`) || document.getElementById(held))?.focus();
}
function moveSide(id, to) {
  if (kind !== 'online' || !room || room.settings.mode !== 'team') return false;
  if (id !== socket.id && !amHost()) return false;
  socket.emit('side', to, id);
  sfx.play('click');
  return true;
}
function switchSide() {
  const mine = me();
  return !!mine && moveSide(mine.id, 1 - mine.side);
}
function shuffleSides() {
  if (!amHost() || kind !== 'online' || room.settings.mode !== 'team') return false;
  socket.emit('shuffle');
  sfx.play('click');
  return true;
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
  $('pause-note').textContent = kind === 'practice' ? '' : 'The match carries on without you.';
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
    // where this round's points came from: bombs that went off on the other side, and the flags
    const fromBombs = [0, 1].map((t) => BOMB_POINTS * res.rows.filter((r) => r.boom && r.team === 1 - t).length);
    const fromFlags = [0, 1].map((t) => Math.max(0, team.score[t] - fromBombs[t]));
    const points = `Flags ${fromFlags[0]} - ${fromFlags[1]}, bombs ${fromBombs[0]} - ${fromBombs[1]}.`;
    if (cup) {
      kicker = cup.final ? 'Tournament over - Team Bomb' : `Round ${cup.round} of ${cup.rounds} - Team Bomb`;
      if (cup.final) {
        title = lead < 0 ? 'The tournament ends level!' : lead === mine ? 'Your team wins the tournament!' : `${TEAM_NAMES[lead]} win the tournament!`;
        sub = forfeit ? 'Everyone else left.' : 'Final score.';
      } else {
        title = lead < 0 ? `Level at ${tally[0]} all` : `${side(lead)} ${lead === mine ? 'leads' : 'lead'} ${tally[lead]} - ${tally[1 - lead]}`;
        sub = points;
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
      sub = forfeit ? 'Everyone else left.' : '';
    } else {
      const lead = cup.table[0];
      const tied = cup.table.filter((r) => r.pts === lead.pts).length > 1;
      title = tied ? 'Level at the top' : lead.slot === mySlot ? 'You are in the lead' : `${lead.name} is in the lead`;
      sub = '';
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
    sub = '';
  }
  $('res-kicker').textContent = kicker;
  $('res-title').textContent = title;
  $('res-sub').textContent = sub;
  // the seal says it in one sign: won, lost, level - or, between rounds, which round that was
  const between = !!cup && !cup.final;
  const mine = res.rows.find((r) => r.slot === mySlot);
  const level = team ? (cup && team.total ? team.total[0] === team.total[1] : team.win < 0) : false;
  const seal = $('res-seal');
  seal.textContent = between ? String(cup.round) : level ? '分' : iWon ? '勝' : '負';
  seal.className = `seal big${between || level ? ' dark' : iWon ? '' : ' dark'}`;
  $('s-results').classList.toggle('won', !between && iWon && !level);
  $('res-teams').hidden = !team;
  $('res-table').hidden = !!team;
  $('s-results').classList.toggle('teams', !!team);
  $('s-results').classList.toggle('crowd', res.rows.length > 6); // seven or more: a tighter board
  // a podium for the first three, where there is a ranking to speak of: a
  // finished tournament, or a match scored on time as the oni
  const ranked = !team && !forfeit && (cup ? cup.final : res.mode !== 'potato');
  $('res-podium').hidden = !ranked;
  if (ranked) paintPodium(res, mySlot);
  if (team) paintSides(res, mySlot);
  else paintBoard(res, mySlot, ranked);

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
  void mine;
}

// Everyone in the order they finished: tournament points first, else the least time as the oni.
function ranking(res) {
  const cup = res.cup;
  return cup ? cup.table.map((t) => ({ ...t, row: res.rows.find((r) => r.slot === t.slot) })) : res.rows.map((r) => ({ slot: r.slot, name: r.name, row: r }));
}

// A picture of the player in the style the match was played in (their colour square until it is painted).
function face(slot, size = 'sm') {
  const box = el('i', `face ${size}`);
  box.style.setProperty('--c', play.colorOf(slot));
  const url = portraitOf(slot);
  if (url) {
    const img = el('img');
    img.alt = '';
    img.src = url;
    box.append(img);
  }
  return box;
}
function portraitOf(slot) {
  try {
    const cols = play.info?.cols;
    const theme = play.renderer.theme?.id;
    return theme && typeof art.playerPortrait === 'function' ? art.playerPortrait(theme, cols ? cols[slot] ?? slot : slot) || '' : '';
  } catch {
    return '';
  }
}

// The first three, the winner in the middle and a step higher.
function paintPodium(res, mySlot) {
  const cup = res.cup;
  const box = $('res-podium');
  box.textContent = '';
  const top = ranking(res).slice(0, 3);
  [1, 0, 2].forEach((i) => {
    const r = top[i];
    if (!r) return;
    const step = el('div', `step p${i + 1}${r.slot === mySlot ? ' me' : ''}`);
    step.append(face(r.slot, 'lg'), el('b', 'nm', r.name));
    step.append(el('span', 'stat', cup ? `${r.pts} pts` : r.row ? secs(r.row.ms) : ''));
    const block = el('div', 'block');
    block.append(el('i', i === 0 ? 'seal' : 'seal dark', String(i + 1)));
    step.append(block);
    box.append(step);
  });
}

// The board: one line each, with a bar for the time they spent as the oni.
function paintBoard(res, mySlot, ranked) {
  const cup = res.cup;
  const board = $('res-table');
  board.textContent = '';
  board.className = `board${cup ? ' cup' : ''}`;
  const rows = ranking(res);
  const most = Math.max(1, ...rows.map((r) => (r.row ? r.row.ms : 0)));
  const head = el('li', 'hd');
  head.append(el('span', '', ''), el('span', '', 'Player'), el('span', '', 'As oni'), ...(cup ? [el('span', '', 'Round'), el('span', '', 'Total')] : [el('span', '', 'Tags')]));
  board.append(head);
  rows.forEach((r, i) => {
    const li = el('li', r.slot === mySlot ? 'me' : '');
    const final = !cup || cup.final;
    const who = el('span', 'who');
    who.append(face(r.slot), r.name);
    // a seal for the winner, and one for whoever was it at the end
    // (not when nearly everyone won - Hot Potato - where the one seal that matters is the oni's)
    if (final && res.winners.includes(r.slot) && !ranked && res.winners.length * 2 <= rows.length) who.append(mark('勝', 'wins'));
    if (res.loser === r.slot && res.reason !== 'forfeit') who.append(mark('鬼', 'it', true));
    const time = el('span', 'time');
    if (r.row) {
      const track = el('span', 'track');
      const bar = el('i', 'bar');
      bar.style.width = `${Math.round((r.row.ms / most) * 100)}%`;
      track.append(bar);
      time.append(track, el('b', '', secs(r.row.ms)));
    } else time.append(el('b', '', '-'));
    li.append(el('span', 'rank', String(i + 1)), who, time);
    if (cup) li.append(el('span', 'gain', r.row ? `+${r.gained}` : '-'), el('span', 'pts', `${r.pts}`));
    else li.append(el('span', 'num', String(r.row.tags)));
    board.append(li);
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
    if (won) head.append(mark('勝', 'wins'));
    else if (final && win < 0) head.append(el('small', '', 'a draw'));
    side.append(head);
    const ul = el('ul');
    const hd = el('li', 'hd');
    hd.append(el('span', '', 'Player'), el('span', '', 'Bomb'), el('span', '', 'Passed'), el('span', '', 'Flags'));
    ul.append(hd);
    for (const r of res.rows) {
      if (r.team !== t) continue;
      const li = el('li', r.slot === mySlot ? 'me' : '');
      const who = el('span', 'who');
      who.append(face(r.slot), r.name);
      if (r.bot) who.append(el('span', 'tag bot', 'BOT'));
      // a bomb went off in their hands
      if (r.boom) {
        const blown = el('span', 'mark blown');
        blown.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-bomb" /></svg>';
        blown.title = 'A bomb went off in their hands';
        who.append(blown);
      }
      li.append(who, el('span', '', secs(r.ms)), el('span', '', String(r.tags)), el('span', '', String(r.caps || 0)));
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
  // The host is the only one who changes settings, and the screen shows each
  // change at once. The server's echo of an EARLIER change must not undo a
  // later one that is still on its way: while changes are fresh, keep ours,
  // and take the server's word once things have been quiet for a moment.
  if (r.hostId === socket.id && room.hostId === socket.id && performance.now() - settingsAt < SETTLE_MS) {
    echoed = r.settings;
    r = { ...r, settings: room.settings };
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_MS);
  }
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
  // (a bot filling in may hold the same place as someone who arrived after the round began: they are only watching)
  const mySlot = mine && msg.players.some((p) => p.slot === mine.slot && !p.bot) ? mine.slot : -1;
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
    // along the rounds of a tournament: left and right pick the one before or after
    const slot = document.activeElement?.classList.contains('slot') ? document.activeElement : null;
    if (slot && (key === 'arrowleft' || key === 'arrowright')) {
      const to = key === 'arrowright' ? slot.nextElementSibling : slot.previousElementSibling;
      if (to) {
        to.click();
        $('round-strip').querySelector('[aria-checked="true"]')?.focus();
      }
      return true;
    }
    // Enter starts, also from a round's tile (which is already chosen once it has the focus)
    if (key === 'enter' && (!onButton || slot)) {
      if (!$('btn-start').hidden && !$('btn-start').disabled) $('btn-start').click();
      return true;
    }
    if (key === 'c' && kind === 'online') return copyInvite(), true;
    if (key === 'x' && switchSide()) return true;
    if (key === 'z' && shuffleSides()) return true;
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
