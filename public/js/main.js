// Onigokko - everything outside the match itself: the title scroll, Play
// (host a room, join with a code, open rooms), your profile, the room and its
// stage sheet, how to play, the draw before a round, results.
//
// On a wide screen the title scroll stays on the left and what you open from
// it (play, profile, how to play) opens beside it; a room takes the whole
// screen. On a narrow one there is one panel at a time. Every screen can be
// driven with the keyboard alone (arrows + Enter, Esc to go back, a letter or
// number for most things).

import { MODES, DURATIONS, DEFAULT_DURATION, DEFAULT_THEME, THEMES, CUP_ROUNDS, NAME_MAX, CODE_LEN, MIN_PLAYERS, MAX_PLAYERS, TEAM_NAMES, TEAM_COLORS, TEAM_SLOTS, BOMB_POINTS, FLAG_POINTS, FLAG_PAY_TICKS, FLAG_CAP_TICKS, TICK_RATE, ITEM_KINDS, ITEM_INFO, ITEM_LOCK_TICKS } from '/shared/config.js';
import { ARENAS } from '/shared/arenas.js';
import { botFill } from '/shared/sim.js';
import { BOT_NAMES } from '/shared/bots.js';
import { play } from './play.js';
import { scenePreview, styleStill, clearPictures, paintBackdrop, paperTexture } from './art.js';
import * as art from './art.js'; // (also: playerPortrait, for the results)
import { loadTheme, THEME_MAP } from './themes/index.js';
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
let panel = ''; // what is open from the title scroll: '' | rooms (Play) | lobby (a room, or practice) | help
let overlay = ''; // over a match: '' | results | pause | help
let helpFrom = ''; // what How to play goes back to
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
const PANELS = ['rooms', 'lobby', 'help'];
// the first letter of a name, for its seal
const initial = (name) => (Array.from(String(name || '').trim())[0] || '?').toUpperCase();

// Popups: a sheet of paper laid over whatever is open - the stage, the open
// rooms, your profile, a question. Each is a native <dialog>, so what is
// behind it cannot be reached (by pointer, by Tab or by a screen reader) and
// is not rebuilt; Esc, its cross or a click on the dark around it closes it.
const POPUPS = ['ask', 'stage', 'find', 'profile']; // (front to back, should two be open)
const popupOpen = (name) => $(`s-${name}`).open;
const popupTop = () => POPUPS.find(popupOpen) || '';
function openPopup(name) {
  const d = $(`s-${name}`);
  if (d.open) return;
  d.showModal();
  focusFirst();
}
const onClose = {}; // what to do once a popup has closed
function closePopup(name) {
  const d = $(`s-${name}`);
  if (!d.open) return;
  d.close(); // (the browser puts the focus back on what opened it)
  onClose[name]?.();
}
const closePopups = () => POPUPS.forEach((name) => closePopup(name));
for (const name of POPUPS) {
  const d = $(`s-${name}`);
  // (Esc is handled with every other key, further down)
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    closePopup(name);
  });
  d.addEventListener('click', (e) => e.target === d && closePopup(name));
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => closePopup(name));
}

// A question before anything that cannot be taken back: what will happen, and
// two buttons that say what each does. Resolves true only for yes; Esc, the
// dark around it and the other button are all no. (`no: ''` leaves one button:
// something to read and close.)
let answer = null;
function answerWith(yes) {
  const tell = answer;
  answer = null;
  tell?.(yes);
}
function ask({ title, body = '', yes, no = 'Stay' }) {
  answerWith(false);
  $('ask-title').textContent = title;
  $('ask-body').textContent = body;
  $('ask-body').hidden = !body;
  $('btn-ask-yes').textContent = yes;
  $('btn-ask-no').textContent = no;
  $('btn-ask-no').hidden = !no;
  $('btn-ask-no').toggleAttribute('data-autofocus', !!no);
  $('btn-ask-yes').toggleAttribute('data-autofocus', !no);
  return new Promise((resolve) => {
    answer = resolve;
    openPopup('ask');
  });
}
onClose.ask = () => answerWith(false);
$('btn-ask-yes').addEventListener('click', () => {
  answerWith(true);
  closePopup('ask');
});
$('btn-ask-no').addEventListener('click', () => closePopup('ask'));

// the name of what is in front right now (also what the automated checks ask for)
const top = () => popupTop() || overlay || (screen === 'home' ? panel || 'home' : screen);

function show(name, beside = '') {
  closePopups();
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
  document.body.classList.toggle('in-room', panel === 'lobby'); // a room has the screen to itself
  if (name !== 'game') {
    play.stop();
    draw.clear();
  }
  // which entry of the title scroll is open
  $('btn-play').toggleAttribute('aria-current', panel === 'rooms' || (panel === 'lobby' && kind === 'online'));
  $('btn-practice').toggleAttribute('aria-current', panel === 'lobby' && kind === 'practice');
  $('btn-help').toggleAttribute('aria-current', panel === 'help');
  setOverlay('');
}

function setOverlay(name) {
  overlay = name;
  $('game').inert = !!name; // (the match behind a menu laid over it is out of reach)
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

// Up / down walk through the controls of whatever is in front. A group of
// choices (a row of words, a grid of cards, the rounds of a tournament - any
// element marked data-group) counts as one stop; left / right move inside it.
function moveFocus(dir) {
  const root = topRoot();
  if (!root) return;
  const stops = [...root.querySelectorAll('[data-group], button, input[type="text"], input[type="checkbox"], .digits')].filter((e) => {
    if (e.closest('.numpad') || e.closest('.locked') || e.closest('.demo')) return false;
    const group = e.closest('[data-group]');
    if (group && group !== e) return false;
    return !e.disabled && e.offsetParent !== null && (!e.hasAttribute('data-group') || e.querySelector('input:not(:disabled), button:not(:disabled)'));
  });
  if (!stops.length) return;
  const cur = stops.findIndex((s) => s === document.activeElement || s.contains(document.activeElement));
  const next = stops[cur < 0 ? (dir > 0 ? 0 : stops.length - 1) : (cur + dir + stops.length) % stops.length];
  if (next.hasAttribute('data-group')) (next.querySelector('input:checked, [aria-checked="true"]') || next.querySelector('input, button'))?.focus();
  else next.focus();
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
  const opener = panel === 'help' ? $('btn-help') : panel === 'lobby' && kind === 'practice' ? $('btn-practice') : $('btn-play');
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
    $('name').setAttribute('aria-invalid', 'true');
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
$('name').addEventListener('input', () => {
  $('name-error').textContent = '';
  $('name').removeAttribute('aria-invalid');
});

// ---------------------------------------------------------------------------
// Profile: who you are (your name, under your own seal) - a popup
// ---------------------------------------------------------------------------
// Go back to whatever was open before How to play.
function reopen(from) {
  if (from === 'lobby' && (room || kind === 'practice')) return openLobby();
  if (room) return openLobby(); // the room you are in comes first
  if (from === 'rooms') return openRooms(code);
  closePanel();
}

function openProfile() {
  if (screen !== 'home' || popupTop()) return;
  const field = $('profile-name');
  field.value = myName;
  // the room knows you by the name you came in with
  field.disabled = !!room;
  $('btn-profile-save').hidden = !!room;
  $('profile-error').textContent = '';
  $('profile-note').textContent = room ? `You are in room ${room.code}. Leave the room to change your name.` : '';
  $('profile-seal').textContent = initial(myName);
  openPopup('profile');
  if (isTouch) field.blur(); // on a phone the keyboard comes up when you tap the name, not before
  else if (!room) field.select();
}
const closeProfile = () => closePopup('profile');
$('btn-profile').addEventListener('click', openProfile);
$('profile-name').addEventListener('input', () => {
  $('profile-error').textContent = '';
  $('profile-name').removeAttribute('aria-invalid');
  $('profile-seal').textContent = initial(cleanName($('profile-name').value));
});
$('profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (room) return closeProfile();
  const name = cleanName($('profile-name').value);
  if (!name) {
    $('profile-error').textContent = 'Type a name to save it.';
    $('profile-name').setAttribute('aria-invalid', 'true');
    $('profile-name').focus();
    return;
  }
  const changed = name !== myName;
  myName = name;
  store.set('tag.name', name);
  $('home-name').textContent = myName;
  $('home-seal').textContent = initial(myName);
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
async function enterRoom(event, payload, errorEl, btn) {
  if (busy) return false;
  busy = true;
  btn?.setAttribute('aria-busy', 'true'); // (the button that asked shows it is working)
  errorEl.textContent = socket.connected ? '' : 'Waking the server. This can take up to a minute…';
  const res = await request(event, payload);
  busy = false;
  btn?.removeAttribute('aria-busy');
  if (!res || res.error) {
    if (res?.needName) askName(() => enterRoom(event, { ...payload, name: myName }, errorEl, btn));
    else errorEl.textContent = res?.error || 'Unable to get into the room. Check your connection and try again.';
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
setConn('wait', 'Lighting the lantern…');
socket.on('connect', () => setConn('ok', 'Server awake', 'You are connected.'));
socket.on('connect_error', () => setConn('bad', 'Waking the server…', NAP));
socket.on('disconnect', () => {
  setConn('bad', 'Reconnecting…', NAP);
  if (room) {
    play.stop();
    toHome(`Lost the connection to the server. When the lantern is lit again, go back in with code ${room.code}, or host a new room.`);
  }
});

// ---------------------------------------------------------------------------
// The title scroll
// ---------------------------------------------------------------------------
$('btn-play').addEventListener('click', () => {
  if (room) openLobby(); // already in a room: that is where the game is
  else openRooms('');
});
$('btn-practice').addEventListener('click', async () => {
  if (room) {
    if (!(await ask({ title: `Leave room ${room.code} to practise?`, body: 'Practice is on your own, against bots. You can come back with the code while the room is open.', yes: 'Leave room' }))) return;
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
// the drifting petals and the swaying lantern can be stilled (and stay as they were left)
function paintStill() {
  const still = store.get('tag.still') === '1';
  document.body.classList.toggle('still', still);
  $('still-label').textContent = `Petals ${still ? 'off' : 'on'}`;
}
$('btn-still').addEventListener('click', () => {
  store.set('tag.still', store.get('tag.still') === '1' ? '0' : '1');
  sfx.play('click');
  paintStill();
});
paintStill();
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
// Play: the way in to every online game
// ---------------------------------------------------------------------------
// Three ways in: host a room of your own (the one big button), look through
// the rooms that are open to everyone (a popup of their own, with a few ways
// to narrow them down), or type the code a friend gave you (digits go
// straight in, from anywhere on the screen).
let code = '';
let codeTried = '';
const svg = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}" /></svg>`;

function openRooms(start) {
  for (const id of ['join-error', 'create-error']) $(id).textContent = '';
  $('numpad').hidden = true;
  $('digits').classList.remove('open');
  codeTried = '';
  show('home', 'rooms');
  setCode(start);
  paintGames(); // what we already know, straight away...
  watchGames(); // ...then the latest
}

// Host: a room of your own. It starts private, and the button in the room
// opens it to everyone - unless you asked for an open one from the list.
const hostGame = (errorEl, open, btn) => enterRoom('create', { name: myName, open }, errorEl, btn);
$('btn-create').addEventListener('click', () => hostGame($('create-error'), false, $('btn-create')));

// A friend's room: the code is typed straight into the screen.
function setCode(next) {
  code = String(next).replace(/\D/g, '').slice(0, CODE_LEN);
  const boxes = $('digits').children;
  for (let i = 0; i < CODE_LEN; i++) {
    boxes[i].textContent = code[i] || '';
    boxes[i].classList.toggle('next', i === code.length);
  }
  $('digits').classList.remove('bad');
  $('digits').setAttribute('aria-label', `Room code: ${code.split('').join(' ') || 'empty'}`);
  for (const id of ['btn-join-go', 'btn-pad-go']) $(id).classList.toggle('ready', code.length === CODE_LEN);
  $('join-error').textContent = '';
  // the fourth digit joins straight away (once per code, so a wrong one can be corrected)
  if (code.length === CODE_LEN && code !== codeTried) submitCode();
}

async function submitCode() {
  if (code.length !== CODE_LEN || busy) return;
  codeTried = code;
  const ok = await enterRoom('join', { code, name: myName }, $('join-error'), $('btn-join-go'));
  if (!ok && top() === 'rooms') {
    $('digits').classList.add('bad');
    sfx.play('lose');
  }
}
function retryCode() {
  if (code.length !== CODE_LEN) {
    // not whole yet: say what is missing, and put the keyboard where it goes
    $('join-error').textContent = `Type the ${CODE_LEN} digits of the room's code.`;
    $('digits').classList.add('bad');
    if (!isTouch) $('digits').focus({ preventScroll: true });
    return;
  }
  codeTried = '';
  submitCode();
}

// Typing a digit anywhere on this screen goes into the code.
function typeCode(next) {
  setCode(next);
  if (top() === 'rooms' && !isTouch && document.activeElement !== $('digits')) $('digits').focus({ preventScroll: true });
}

// Tapping the code opens our own little number pad under it (a phone has no
// keys; with a mouse there is a keyboard, and the squares just take the focus).
$('digits').addEventListener('click', (e) => {
  if (!isTouch && e.pointerType !== 'touch') return;
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
  // an invite link (its ?room=), a code on its own, or any four digits standing together
  const found = text.match(/[?&]room=(\d{4})(?!\d)/) || text.match(/(?<!\d)(\d{4})(?!\d)/);
  if (found) typeCode(found[1]);
  else if (/\d/.test(text)) typeCode(text);
});

// --- open rooms: the ones anyone may join. While Play (or their popup) is
// up, the server is asked again every couple of seconds; the Play menu only
// says how many there are, the popup lists them.
const MODE_ICON = { potato: 'flame', time: 'glass', team: 'bomb' };
const FIND_GAMES = [['all', 'All'], ['potato', 'Hot Potato'], ['time', 'Least Time'], ['team', 'Team Bomb'], ['cup', 'Tournament']];
const find = { game: 'all', waiting: false }; // how the list is narrowed down
let games = null; // (null: the server has not answered yet)
let gamesSig = null;
let gamesTimer = 0;

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
    if (panel !== 'rooms') return clearInterval(gamesTimer);
    if (!document.hidden) refreshGames();
  }, 2500);
}

const nameOfArena = (id) => (id === 'random' ? 'Random arena' : ARENAS.find((a) => a.id === id)?.name || 'Arena');
const nameOfMode = (id) => MODES.find((m) => m.id === id)?.name || '';
// what a room is playing, in a few words: "Hot Potato · Bounce Hills", "Team tournament"
const describeGame = (g) => (g.game === 'cup' ? (g.mode === 'team' ? 'Team tournament' : 'Tournament') : [nameOfMode(g.mode), nameOfArena(g.arena)].filter(Boolean).join(' · '));
const shownGames = () => (games || []).filter((g) => (find.game === 'all' || (find.game === 'cup' ? g.game === 'cup' : g.game !== 'cup' && g.mode === find.game)) && (!find.waiting || !g.playing));

// the choices that narrow the list down: a row of words (radio buttons underneath) and a tick box
FIND_GAMES.forEach(([value, text]) => {
  const item = el('label');
  const inp = document.createElement('input');
  inp.type = 'radio';
  inp.name = 'find-game';
  inp.value = value;
  inp.checked = value === find.game;
  inp.addEventListener('change', () => {
    find.game = value;
    sfx.play('click');
    paintGames();
  });
  item.append(inp, el('span', '', text));
  $('find-game').append(item);
});
$('find-waiting').addEventListener('change', (e) => {
  find.waiting = e.target.checked;
  sfx.play('click');
  paintGames();
});
function clearFind() {
  find.game = 'all';
  find.waiting = false;
  $('find-game').querySelector('input').checked = true;
  $('find-waiting').checked = false;
  paintGames();
  focusFirst($('games').querySelector('button') || $('find-game').querySelector('input'));
}
$('btn-find-clear').addEventListener('click', clearFind);

function paintGames() {
  // the Play menu: how many there are (a grey bar until the server has said)
  const known = games !== null;
  const count = $('find-count');
  count.classList.toggle('sk', !known && socket.connected);
  const said = known ? (games.length ? `${games.length} open now` : 'None open right now') : socket.connected ? '' : 'Waking the server…';
  if (count.textContent !== said) count.textContent = said;
  if (!popupOpen('find')) return;
  const box = $('games');
  const list = shownGames();
  const sig = JSON.stringify([known, list]);
  if (sig !== gamesSig) {
    gamesSig = sig;
    const held = box.contains(document.activeElement) ? document.activeElement.dataset.code : '';
    box.textContent = '';
    box.setAttribute('aria-busy', String(!known));
    // not heard from the server yet: the shape of what is coming
    for (let k = 0; !known && k < 3; k++) {
      const li = el('li', 'hub-room sk-row');
      li.setAttribute('aria-hidden', 'true');
      li.append(el('i', 'sk'), el('span', 'sk'), el('span', 'sk'));
      box.append(li);
    }
    for (const g of list) {
      const li = el('li');
      const b = el('button', 'hub-room');
      b.dataset.code = String(g.code).replace(/\D/g, '');
      const who = el('span', 'who');
      const what = el('small');
      what.innerHTML = svg(g.game === 'cup' ? 'cup' : MODE_ICON[g.mode] || 'flame');
      what.append(describeGame(g));
      who.append(el('b', '', `${g.host || 'Someone'}'s room`), what);
      const fill = el('span', 'fill');
      fill.append(el('b', '', String(g.players)), `/${g.max}`);
      b.append(el('i', 'seal hanko', initial(g.host)), who, fill, el('span', g.playing ? 'state on' : 'state', g.playing ? 'Playing' : 'In the room'), el('span', 'join', 'Join'));
      b.setAttribute('aria-label', `Join ${g.host}'s room: ${describeGame(g)}, ${g.players} of ${g.max} players, ${g.playing ? 'playing - you join the next round' : 'waiting in the room'}`);
      b.addEventListener('click', () => joinGame(b.dataset.code, b));
      li.append(b);
      box.append(li);
    }
    if (held) (box.querySelector(`[data-code="${held}"]`) || box.querySelector('button') || $('find-game').querySelector('input:checked')).focus?.();
  }
  // nothing to show: say why, and what to do about it
  const none = known && !list.length;
  const narrowed = none && games.length > 0;
  $('find-none').hidden = !none;
  $('find-none-title').textContent = narrowed ? 'No open room matches' : 'No open rooms yet';
  $('find-none-text').textContent = narrowed ? `${games.length} open ${games.length === 1 ? 'room is' : 'rooms are'} hidden by what you chose above.` : 'Rooms their hosts have opened to everyone show up here.';
  $('btn-find-clear').hidden = !narrowed;
  const lead = socket.connected ? '' : 'Waking the server. This can take up to a minute…';
  if ($('find-lead').textContent !== lead) $('find-lead').textContent = lead;
}
function openFind() {
  $('find-error').textContent = '';
  gamesSig = null;
  sfx.play('click');
  openPopup('find');
  paintGames();
  refreshGames();
  focusFirst($('games').querySelector('button') || $('find-game').querySelector('input:checked'));
}
$('btn-find').addEventListener('click', openFind);
$('btn-find-host').addEventListener('click', () => hostGame($('find-error'), true, $('btn-find-host')));
async function joinGame(roomCode, btn) {
  sfx.play('click');
  const ok = await enterRoom('join', { code: roomCode, name: myName }, $('find-error'), btn);
  if (!ok && popupOpen('find')) refreshGames(); // it filled up, or it is gone
}

// ---------------------------------------------------------------------------
// The room: online, or practice
// ---------------------------------------------------------------------------
// A room is first of all something to read: what is being played (Game),
// where (Stage), by which rules (Rules) and who is in it (Players, with Start
// underneath). The host's controls sit in those same places; a guest sees the
// same card without them. Choosing the stage has a sheet of its own, with
// room for proper pictures (see "The stage sheet" below).
//
// Every entry of OPTIONS writes one setting (`key`) - or says how with `set`.
// `box` is where it is drawn and `type` how (a row of words unless it says
// otherwise), `show` when, `hot` the key that steps it.
const MODE_LINE = { potato: "Don't be the oni when time runs out", time: 'Least time as the oni wins', team: 'Two sides: hold flags, pass bombs' };
const CUP_LINE = { potato: 'Everyone for themselves: least time as the oni scores', team: 'Two sides all the way: their points add up each round' };
const OPTIONS = [
  { id: 'game', key: 'game', hot: 'g', label: 'Format', only: 'online', box: 'opt-format', values: [['quick', 'One match'], ['cup', 'Tournament']] },
  { id: 'rounds', key: 'rounds', hot: 'n', label: 'Rounds', only: 'online', box: 'opt-format', values: CUP_ROUNDS.map((n) => [n, String(n)]), show: (s) => s.game === 'cup' },
  { id: 'mode', key: 'mode', hot: 'r', label: 'Game', type: 'modes', box: 'opt-mode', values: MODES.map((m) => [m.id, m.name]), line: (v) => MODE_LINE[v], icon: (v) => MODE_ICON[v], show: (s) => s.game !== 'cup' },
  // a tournament is scored on time as the oni (everyone for themselves), or played as a team battle
  { id: 'sides', key: 'mode', hot: 'r', label: 'Game', type: 'modes', only: 'online', box: 'opt-mode', values: [['potato', 'Free-for-all'], ['team', 'Team Bomb']], line: (v) => CUP_LINE[v], icon: (v) => (v === 'team' ? 'bomb' : 'crowd'), on: (s, v) => (v === 'team') === (s.mode === 'team'), show: (s) => s.game === 'cup' },
  { id: 'arena', hot: 'a', label: 'Arena', type: 'cards', box: 'arena-cards', values: [...ARENAS.map((a) => [a.id, a.name]), ['random', 'Random']], on: (s, v) => stageValue('arena') === v, set: (v) => setStage('arena', v) },
  { id: 'theme', hot: 's', label: 'Style', type: 'cards', box: 'style-cards', values: [...THEMES.map((t) => [t.id, t.name]), ['random', 'Random']], on: (s, v) => stageValue('theme') === v, set: (v) => setStage('theme', v) },
  { id: 'duration', key: 'duration', hot: 'l', label: 'Round time', box: 'options', values: DURATIONS.map((d) => [d, `${d} s`]) },
  { id: 'powerups', key: 'powerups', hot: 'p', label: 'Lucky boxes', box: 'options', values: [[true, 'On'], [false, 'Off']] },
  { id: 'bots', key: 'bots', hot: 'b', label: 'Bots', only: 'practice', box: 'opt-bots', values: [1, 2, 3, 5, 7, 9].map((n) => [n, String(n)]) },
];
const optionById = (id) => OPTIONS.find((o) => o.id === id);
const settings = () => (kind === 'practice' ? practice : room.settings);
const locked = () => kind === 'online' && !amHost();
const isOn = (o, s, value) => (o.on ? o.on(s, value) : String(s[o.key]) === String(value));
const isCup = () => kind === 'online' && room.settings.game === 'cup';
// the room is in front (with or without a popup over it)
const inRoom = () => panel === 'lobby' && !overlay;

// (see the 'room' handler: how a host's own changes are kept from being undone by late echoes)
const SETTLE_MS = 450;
let settingsAt = -1e9;
let echoed = null;
let settleTimer = 0;
function settle() {
  if (!room || !echoed || performance.now() - settingsAt < SETTLE_MS) return;
  room.settings = echoed;
  echoed = null;
  if (inRoom() && kind === 'online') renderLobby();
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
  // (whether there are two sides decides how the players are shown)
  if ('mode' in patch || 'game' in patch || 'bots' in patch) renderLobby();
  else syncOptions();
}

// --- the stage: an arena and a style. A tournament has one of each for every
// round; `stageSel` says which round a choice is for right now.
let stageSel = 'all'; // 'all', or a round of the tournament (0 = the first)
const planNow = () => (kind === 'practice' ? [{ arena: practice.arena, theme: practice.theme }] : room.settings.plan.slice(0, isCup() ? room.settings.rounds : 1));

// What counts as chosen: the selected round's pick - for "every round", the
// pick they all share ('' if they do not).
function stageValue(what) {
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
const stageList = (what) => (what === 'arena' ? ARENAS : THEMES);
const stageName = (what, id, short) => (id === 'random' ? (short ? 'Random' : `Random ${what === 'arena' ? 'arena' : 'style'}`) : stageList(what).find((x) => x.id === id)?.name || id);
const stageBlurb = (what, id) => (id === 'random' ? (what === 'arena' ? 'Drawn before every round: you find out when it starts.' : 'Drawn before every round.') : stageList(what).find((x) => x.id === id)?.blurb || '');
// the style a picture is painted in while the real one is still to be drawn
const paintIn = (theme) => (!theme || theme === 'random' ? DEFAULT_THEME : theme);

// Pictures are painted one at a time between frames, so the screen never
// stalls, and remembered, so one that has been shown comes back at once.
// (240 px wide ones are shared with the draw before a round.)
const painted = new Map();
const picKey = (arena, theme, w) => `${arena}/${theme}/${w}`;
function paintQueue(jobs, live) {
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
// the picture of a stage, w px wide: an arena in a style, or the "?" of one that is still to be drawn
function stagePic(arena, theme, w) {
  const box = el('span', 'pic');
  if (!arena || arena === 'random') {
    box.classList.add('any');
    box.textContent = '?';
    return box;
  }
  const img = el('img');
  img.alt = '';
  Object.assign(img.dataset, { arena, theme: paintIn(theme), w });
  const key = picKey(arena, img.dataset.theme, w);
  if (painted.has(key)) {
    img.src = painted.get(key);
    img.dataset.key = key;
  }
  box.append(img);
  return box;
}
function paintPics(root, live) {
  const jobs = [];
  for (const img of root.querySelectorAll('img[data-arena]')) {
    const { arena, theme } = img.dataset;
    const w = Number(img.dataset.w);
    const key = picKey(arena, theme, w);
    if (img.dataset.key === key) continue;
    jobs.push([theme, () => {
      if (!painted.has(key)) painted.set(key, scenePreview(arena, theme, w, Math.round((w * 9) / 16)));
      img.src = painted.get(key);
      img.dataset.key = key;
    }]);
  }
  paintQueue(jobs, live);
}

// Every choice is a real radio button underneath, so the arrow keys work for free.
function radio(o, value, i) {
  const inp = document.createElement('input');
  inp.type = 'radio';
  inp.name = `opt-${o.id}`;
  inp.value = String(value);
  inp.dataset.i = i;
  inp.addEventListener('change', () => {
    sfx.play('click');
    if (o.set) o.set(value);
    else changeSetting({ [o.key]: value });
  });
  return inp;
}

// The name of a setting stands over it like the title of a section, with its key beside it.
function title(o) {
  const h = el('h3', 'lab', o.label);
  h.append(el('kbd', '', o.hot.toUpperCase()));
  return h;
}

function buildOptions() {
  for (const id of ['options', 'opt-format', 'opt-mode', 'opt-bots', 'arena-cards', 'style-cards']) $(id).textContent = '';
  for (const o of OPTIONS) {
    if (o.only && o.only !== kind) continue;
    const box = $(o.box);
    if (o.type === 'cards') {
      // the stage popup: a picture card for every arena and every art style
      o.values.forEach(([value, text], i) => {
        const card = el('label', 'card');
        let pic;
        if (value === 'random') {
          pic = el('span', 'pic any', '?');
          pic.setAttribute('aria-hidden', 'true');
        }
        else {
          pic = el('img', 'pic');
          pic.alt = '';
          pic.dataset.id = value;
        }
        card.append(radio(o, value, i), pic, el('span', 'cap', text));
        box.append(card);
      });
      continue;
    }
    const row = el('div', o.type === 'modes' ? 'opt wide' : 'opt');
    row.dataset.opt = o.id;
    const group = el('div', o.type === 'modes' ? 'rm-modes' : 'seg');
    group.dataset.group = '';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', o.label);
    o.values.forEach(([value, text], i) => {
      if (o.type === 'modes') {
        // the games: a card each, with its sign and what it is about in a line
        const card = el('label', 'rm-mode');
        const words = el('span', 'words');
        words.append(el('b', '', text), el('small', '', o.line(value)));
        card.append(radio(o, value, i));
        card.insertAdjacentHTML('beforeend', `<span class="crest">${svg(o.icon(value))}</span>`);
        card.append(words);
        group.append(card);
      } else {
        // a short row of words: the chosen one gets a stroke of ink
        const item = el('label');
        item.append(radio(o, value, i), el('span', '', text));
        group.append(item);
      }
    });
    row.append(title(o), group);
    box.append(row);
  }
}

function syncOptions() {
  const s = settings();
  const lock = locked();
  $('s-lobby').classList.toggle('guest', lock);
  for (const id of ['options', 'opt-format', 'opt-mode', 'opt-bots', 'arena-cards', 'style-cards']) $(id).classList.toggle('locked', lock);
  for (const root of [$('s-lobby'), $('s-stage')]) {
    for (const inp of root.querySelectorAll('input[type="radio"]')) {
      const o = optionById(inp.name.slice(4));
      inp.checked = isOn(o, s, o.values[inp.dataset.i][0]);
      inp.disabled = lock;
      inp.parentElement.classList.toggle('on', inp.checked);
    }
  }
  for (const row of $('s-lobby').querySelectorAll('[data-opt]')) {
    const o = optionById(row.dataset.opt);
    row.hidden = !!o.show && !o.show(s);
  }
  renderStage();
  // who can come in: one button that says which it is (and, for the host, changes it)
  const door = $('btn-open');
  door.hidden = kind !== 'online';
  if (kind === 'online') {
    door.classList.toggle('on', !!s.open);
    door.disabled = lock;
    $('open-label').textContent = s.open ? 'Open room' : 'Private room';
    const what = s.open ? 'Open room: anyone can find it under Open rooms and come in' : 'Private room: only people with the code can come in';
    door.title = what;
    door.setAttribute('aria-label', lock ? what : `${what}. Make it ${s.open ? 'private' : 'open'} (V)`);
  }
  paintFaces();
  if (popupOpen('stage')) syncStage();
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
  const picking = popupOpen('stage');
  if (letter === 't' && isCup()) {
    if (picking) {
      // which round the arena and style are for: every round, 1, 2, ...
      const order = ['all', ...planNow().map((_, i) => i)];
      pickRound(order[(order.indexOf(stageSel) + (back ? -1 : 1) + order.length) % order.length]);
      $('round-strip').querySelector('[aria-checked="true"]')?.focus();
    } else {
      // along the rounds of the tournament
      const tiles = [...$('stage-view').querySelectorAll('button.rm-round')];
      const i = tiles.indexOf(document.activeElement);
      tiles[i < 0 ? (back ? tiles.length - 1 : 0) : (i + (back ? -1 : 1) + tiles.length) % tiles.length]?.focus();
    }
    return true;
  }
  if (locked()) return false;
  // (the button is not focused: Enter must still start the match right after)
  if (letter === 'v' && kind === 'online' && !picking) return $('btn-open').click(), true;
  const o = OPTIONS.find((x) => x.hot === letter && (!x.only || x.only === kind) && (!x.show || x.show(s)));
  if (!o || (picking && o.type !== 'cards')) return false;
  // from the room itself, A and S are for the round whose tile has the focus - or for every round
  const tile = !picking && o.type === 'cards' ? document.activeElement?.closest?.('.rm-round') : null;
  if (!picking) stageSel = tile && isCup() ? Number(tile.dataset.i) : 'all';
  const i = o.values.findIndex(([v]) => isOn(o, s, v));
  const next = o.values[(i + (back ? -1 : 1) + o.values.length) % o.values.length][0];
  if (o.set) o.set(next);
  else changeSetting({ [o.key]: next });
  if (!picking) stageSel = 'all';
  if (picking || o.type !== 'cards') (picking ? $('s-stage') : $('s-lobby')).querySelector(`input[name="opt-${o.id}"]:checked`)?.focus();
  sfx.play('click');
  return true;
}

// --- the stage, as the room shows it: one tile per round, each with its
// picture, its arena and its style. One match is one round, so it looks and
// works the same as a tournament with more of them (which also numbers them
// and marks the ones with a twist and the one that counts double). For the
// host a tile opens the stage popup for that round.
function renderStage() {
  const box = $('stage-view');
  const cup = isCup();
  const host = !locked();
  const plan = planNow();
  const sig = JSON.stringify([kind, cup, host, plan]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const act = document.activeElement;
  const held = box.contains(act) ? act.dataset.i : null;
  box.textContent = '';
  box.className = `rm-prog n${plan.length}`;
  box.toggleAttribute('data-group', plan.length > 1);
  plan.forEach((st, i) => box.append(roundTile(st, i, plan.length, host, cup)));
  if (held != null) box.querySelector(`[data-i="${held}"]`)?.focus();
  paintPics(box, () => panel === 'lobby');
}
function roundTile(st, i, n, host, cup) {
  const tile = el(host ? 'button' : 'div', 'rm-round');
  tile.dataset.i = i;
  const names = `${stageName('arena', st.arena)}, ${stageName('theme', st.theme)}`;
  if (host) {
    tile.type = 'button';
    if (i === 0) tile.id = 'btn-stage';
    tile.setAttribute('aria-label', `${cup ? `Round ${i + 1}` : 'Stage'}: ${names}. Change it`);
    tile.addEventListener('click', () => openStage(cup ? i : 'all'));
  }
  const cap = el('span', 'cap');
  cap.append(el('span', 'name', stageName('arena', st.arena, cup)), el('small', '', stageName('theme', st.theme, cup)));
  tile.append(stagePic(st.arena, st.theme, 240));
  if (cup) {
    tile.append(el('b', 'no', String(i + 1)));
    // what is special about this round
    if (i === n - 1) tile.append(el('i', 'flag x2', 'x2'));
    else if (i % 2 === 1) tile.append(el('i', 'flag', 'Twist'));
  }
  tile.append(cap);
  tile.title = names;
  return tile;
}

// --- the stage popup: the art styles in one row, then every arena as a
// picture. A choice counts at once, for everyone in the room; Done (or the
// cross, or Esc) only closes the popup. In a tournament the tabs at the top
// say which round the choice is for.
let stageFrom = 0; // the tile the popup was opened from
function openStage(sel = 'all') {
  if (locked() || panel !== 'lobby') return;
  stageSel = isCup() ? sel : 'all';
  stageFrom = stageSel === 'all' ? 0 : stageSel;
  sfx.play('click');
  openPopup('stage');
  syncOptions();
  focusFirst($('arena-cards').querySelector('input:checked') || $('style-cards').querySelector('input:checked') || $('style-cards').querySelector('input'));
}
const closeStage = () => closePopup('stage');
$('btn-stage-done').addEventListener('click', () => {
  sfx.play('click');
  closeStage();
});
// closed, however: the choice is for every round again, and the keyboard goes back to the tile it came from
onClose.stage = () => {
  stageSel = 'all';
  if (panel === 'lobby') focusFirst($('stage-view').querySelector(`[data-i="${stageFrom}"]`));
};

function syncStage() {
  renderRounds();
  // what the chosen arena is like, in a line under the pictures ('' : the rounds of the tournament do not share one)
  const arena = stageValue('arena');
  $('pk-arena').textContent = arena ? stageName('arena', arena) : 'A different arena each round';
  $('pk-arena-blurb').textContent = arena ? stageBlurb('arena', arena) : 'Pick a round at the top to see it, or choose here to set them all.';
  // the chosen style is in view in its row
  $('style-cards').querySelector('.card.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  paintCards();
}

// A tournament: one tab per round, and one for all of them at once.
function renderRounds() {
  const strip = $('round-strip');
  const cup = isCup();
  strip.hidden = !cup;
  if (!cup) {
    stageSel = 'all';
    strip.textContent = '';
    delete strip.dataset.sig;
    return;
  }
  const plan = planNow();
  if (stageSel !== 'all' && stageSel >= plan.length) stageSel = 'all';
  const sig = JSON.stringify([plan.length, stageSel]);
  if (strip.dataset.sig === sig) return;
  strip.dataset.sig = sig;
  const held = strip.contains(document.activeElement) ? document.activeElement.dataset.i : null;
  strip.textContent = '';
  const add = (value, text, label) => {
    const b = el('button', 'tab', text);
    b.type = 'button';
    b.dataset.i = String(value);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(stageSel === value));
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => pickRound(value));
    strip.append(b);
  };
  add('all', 'Every round', 'Every round: one arena and one style for all of them');
  plan.forEach((_, i) => add(i, String(i + 1), `Round ${i + 1} only`));
  strip.prepend(el('kbd', '', 'T'));
  if (held != null) strip.querySelector(`[data-i="${held}"]`)?.focus();
}
function pickRound(value) {
  stageSel = value;
  sfx.play('click');
  syncOptions();
}

// The cards' pictures: one still per art style, and each arena in the chosen
// style. (Painted between frames and cached, like every other picture; until
// one is there its card shows a shimmer of the paper it will be painted on.)
let paintRun = 0;
function paintCards() {
  const run = ++paintRun;
  const themeId = paintIn(stageValue('theme'));
  const jobs = [];
  for (const img of $('style-cards').querySelectorAll('img')) if (!img.dataset.done) jobs.push([img.dataset.id, () => ((img.src = styleStill(img.dataset.id)), (img.dataset.done = '1'))]);
  for (const img of $('arena-cards').querySelectorAll('img')) {
    if (img.dataset.in === themeId) continue;
    jobs.push([themeId, () => ((img.src = scenePreview(img.dataset.id, themeId, 240, 135)), (img.dataset.in = themeId))]);
  }
  jobs.push([themeId, () => (cardTheme = themeId)]);
  paintQueue(jobs, () => run === paintRun && popupOpen('stage'));
}
// (the fonts arrived, or the window changed: everything painted so far is stale)
function repaintPictures() {
  painted.clear();
  for (const img of document.querySelectorAll('#s-stage .card img, #stage-view img')) for (const k of ['in', 'done', 'key']) delete img.dataset[k];
  for (const f of $('s-lobby').querySelectorAll('.face')) delete f.dataset.in;
  if (panel !== 'lobby') return;
  $('stage-view').dataset.sig = '';
  syncOptions();
}

// (how tall the bar with Start is, for the layouts that pin it to the foot of the screen)
const measureBar = () => document.body.style.setProperty('--bar', `${document.querySelector('.rm-go').offsetHeight}px`);

function openLobby() {
  show('home', 'lobby');
  buildOptions();
  $('stage-view').dataset.sig = '';
  renderLobby();
  focusFirst();
}

// --- who is in it. A seat is a player's character as it will look in the
// room's style (a square of their colour until it has been painted), their
// name, and what they are here.
function seat(p) {
  const li = el('li', `rm-seat${p.you ? ' me' : ''}${p.bot ? ' bot' : ''}`);
  const f = el('i', 'face');
  f.dataset.ci = p.ci;
  f.style.setProperty('--c', INK_COLORS[p.ci]);
  const who = el('span', 'who');
  who.append(el('span', 'nm', p.name));
  const role = [p.host && 'Host', p.bot && 'Bot', p.score].filter(Boolean);
  if (role.length) who.append(el('small', p.host ? 'role host' : 'role', role.join(' · ')));
  li.append(f, who);
  if (p.you) {
    li.title = 'You';
    li.setAttribute('aria-label', `${p.name} (you)${role.length ? ', ' + role.join(', ') : ''}`);
  }
  return li;
}
let faceRun = 0;
function paintFaces() {
  const run = ++faceRun;
  const themeId = paintIn(planNow()[0].theme);
  const faces = [...$('s-lobby').querySelectorAll('.face[data-ci]')].filter((f) => f.dataset.in !== themeId);
  if (!faces.length) return;
  loadTheme(themeId).then((theme) => {
    const next = () => {
      const f = faces.shift();
      if (!f || run !== faceRun || panel !== 'lobby') return;
      const ci = Number(f.dataset.ci);
      const url = art.playerPortrait(theme.id, ci, { size: 44 });
      f.style.setProperty('--c', theme.colors?.[ci] || INK_COLORS[ci]);
      if (url) {
        const img = f.querySelector('img') || f.appendChild(el('img'));
        img.alt = '';
        img.src = url;
      }
      f.dataset.in = themeId;
      setTimeout(next, 0);
    };
    next();
  });
}
// (a seat that is rebuilt gets the picture it had, without a blink)
function faceNow(f) {
  const themeId = paintIn(planNow()[0].theme);
  if (!art.styleReady(themeId)) return;
  const url = art.playerPortrait(themeId, Number(f.dataset.ci), { size: 44, peek: true });
  if (!url) return;
  const img = f.appendChild(el('img'));
  img.alt = '';
  img.src = url;
  f.style.setProperty('--c', THEME_MAP[themeId]?.colors?.[Number(f.dataset.ci)] || INK_COLORS[Number(f.dataset.ci)]);
  f.dataset.in = themeId;
}

function renderLobby() {
  const online = kind === 'online';
  $('lobby-title').textContent = online ? 'Room' : 'Practice';
  $('btn-copy').hidden = !online;
  $('btn-leave').setAttribute('aria-label', online ? 'Leave the room' : 'Back (Esc)');
  $('opt-bots').hidden = online;
  // a team battle in a room shows the two sides instead of one list
  const sided = online && room.settings.mode === 'team';
  const list = $('players');
  list.hidden = sided;
  $('squads').hidden = !sided;
  $('btn-shuffle').hidden = !(sided && amHost());
  const inviting = document.activeElement?.classList.contains('invite');
  list.textContent = '';
  if (sided) renderSquads();
  else {
    const rows = online
      ? room.players.slice().sort((a, b) => a.slot - b.slot).map((p) => ({ ci: p.slot, name: p.name, host: p.id === room.hostId, you: p.id === socket.id, score: p.wins ? `${p.wins} win${p.wins > 1 ? 's' : ''}` : '' }))
      : [{ ci: 0, name: myName, you: true }, ...Array.from({ length: practice.bots }, (_, i) => ({ ci: i + 1, name: BOT_NAMES[i] || 'Bot', bot: true }))];
    for (const r of rows) list.append(seat(r));
    // the seats still free: the first of them is the way to fill it
    for (let k = rows.length; online && k < MAX_PLAYERS; k++) {
      const li = el('li', 'rm-seat free');
      if (k === rows.length) {
        const b = el('button', 'invite', 'Invite a friend');
        b.type = 'button';
        b.addEventListener('click', copyInvite);
        li.append(b);
        if (inviting) queueMicrotask(() => b.focus());
      } else li.setAttribute('aria-hidden', 'true');
      list.append(li);
    }
  }
  for (const f of $('s-lobby').querySelectorAll('.face[data-ci]')) faceNow(f);

  const start = $('btn-start');
  if (online) {
    $('lobby-code').textContent = room.code;
    $('players-title').textContent = `Players ${room.players.length}/${MAX_PLAYERS}`;
    const host = room.players.find((p) => p.id === room.hostId);
    const enough = room.players.length >= MIN_PLAYERS;
    start.hidden = !amHost();
    start.disabled = !enough;
    setLabel(start, room.settings.game === 'cup' ? 'Start tournament' : 'Start match', 'Enter');
    $('lobby-note').textContent = enough ? '' : 'You need at least 2 players. Send someone the code or the invite link.';
    $('start-note').textContent = amHost() ? '' : `Waiting for ${host ? host.name : 'the host'} to start…`;
  } else {
    $('players-title').textContent = 'Players';
    $('lobby-note').textContent = '';
    $('start-note').textContent = '';
    start.hidden = false;
    start.disabled = false;
    setLabel(start, 'Start', 'Enter');
  }
  const cup = isCup();
  setLegend(
    $('lobby-legend'),
    locked()
      ? [[['Esc'], 'leave the room'], [['C'], 'copy the invite link'], ...(sided ? [[['X'], 'change sides']] : [])]
      : [[['↑', '↓'], 'move'], [['←', '→'], 'choose'], [['A'], 'arena'], [['S'], 'style'], ...(cup ? [[['T'], 'rounds']] : []), ...(sided ? [[['X'], 'change sides']] : []), [['Enter'], 'start'], [['Esc'], online ? 'leave' : 'back']],
  );
  // Where the keyboard starts: the start button; alone in a room, the invite
  // link. (A guest gets no starting point: Enter must not walk them out.)
  const first = start.hidden ? null : start.disabled ? $('btn-copy') : start;
  for (const b of [start, $('btn-copy')]) b.toggleAttribute('data-autofocus', b === first);
  measureBar();
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
  const held = box.contains(document.activeElement) ? document.activeElement.dataset.id : '';
  box.textContent = '';
  const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
  const botNames = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  // (colours are handed out in the order people came in, bots last - the same way the server does it)
  const seen = [0, 0];
  const colour = (t) => TEAM_SLOTS[t][seen[t]++ % TEAM_SLOTS[t].length];
  const cis = new Map(room.players.map((p) => [p.id, colour(p.side)]));
  [0, 1].forEach((t) => {
    const side = el('section', 'rm-team');
    side.style.setProperty('--side', TEAM_COLORS[t]);
    const head = el('header');
    head.append(el('b', '', TEAM_NAMES[t]), el('span', 'n', `${sizes[t]}${fill[t] ? ` + ${fill[t]} bot${fill[t] > 1 ? 's' : ''}` : ''}`));
    if (mine && mine.side === t) head.append(el('em', '', 'Your side'));
    const ul = el('ul', 'rm-seats');
    for (const p of room.players) {
      if (p.side !== t) continue;
      const you = p.id === socket.id;
      const li = seat({ ci: cis.get(p.id), name: p.name, host: p.id === room.hostId, you });
      if (you || host) {
        // across to the other side: your own arrow, and - for the host - everyone's
        const go = el('button', 'cross');
        go.type = 'button';
        go.dataset.id = p.id;
        go.setAttribute('aria-label', `Move ${you ? 'yourself' : p.name} to ${TEAM_NAMES[1 - t]}`);
        go.innerHTML = svg(t ? 'left' : 'right');
        go.title = you ? 'Change sides (X)' : `Move ${p.name} to ${TEAM_NAMES[1 - t]}`;
        go.addEventListener('click', () => moveSide(p.id, 1 - t));
        li.append(go);
      }
      ul.append(li);
    }
    for (let k = 0; k < fill[t]; k++) ul.append(seat({ ci: colour(t), name: botNames.shift() || 'Bot', bot: true }));
    if (!ul.childElementCount) ul.append(el('li', 'rm-seat none', 'Nobody yet'));
    side.append(head, ul);
    box.append(side);
  });
  if (held) box.querySelector(`[data-id="${held}"]`)?.focus();
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
$('btn-shuffle').addEventListener('click', shuffleSides);

function leaveRoom() {
  const wasOnline = kind === 'online';
  if (wasOnline && room) socket.emit('leave');
  play.stop();
  toHome('', wasOnline ? $('btn-play') : $('btn-practice'));
}
// Leaving a room cannot be taken back (it may close, or pass to someone
// else), so it is asked about first: what will happen, Stay or Leave room.
function sureToLeave() {
  if (kind !== 'online' || !room) return Promise.resolve(true);
  const playing = screen === 'game' && overlay !== 'results';
  const alone = room.players.length < 2;
  return ask({
    title: playing ? 'Leave the match?' : `Leave room ${room.code}?`,
    body: alone
      ? 'You are the only one here, so the room closes behind you.'
      : amHost()
        ? 'You are the host: the room passes to the next player.'
        : playing
          ? 'The others play on without you. You can come back with the code.'
          : 'You can come back with the code while the room is open.',
    yes: 'Leave room',
  });
}
const leaveIfSure = async () => (await sureToLeave()) && leaveRoom();
$('btn-leave').addEventListener('click', () => (kind === 'practice' ? leaveRoom() : leaveIfSure()));
$('btn-start').addEventListener('click', () => {
  sfx.play('click');
  if (kind === 'practice') play.practice(practice, myName);
  else socket.emit('start');
});
// The invite link: the button beside the room's code hands it to the phone's
// own share sheet, or copies it - and shows a tick for a moment either way.
let copiedTimer = 0;
async function copyInvite() {
  if (!room) return;
  const link = `${location.origin}/?room=${room.code}`;
  const done = (text) => {
    if (text) toast(text);
    $('btn-copy').classList.add('done');
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => $('btn-copy').classList.remove('done'), 1600);
  };
  try {
    if (isTouch && navigator.share) {
      await navigator.share({ title: 'Onigokko', text: `Join room ${room.code}`, url: link });
      return done('');
    }
    await navigator.clipboard.writeText(link);
    done('Invite link copied');
  } catch (err) {
    // (no clipboard here: show the link, to be copied by hand, for as long as that takes)
    if (err?.name !== 'AbortError') ask({ title: 'Invite link', body: link, yes: 'Close', no: '' });
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
  repaintPictures();
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
$('btn-quit').addEventListener('click', leaveIfSure);

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
    const points = `Flags ${fromFlags[0]}–${fromFlags[1]}, bombs ${fromBombs[0]}–${fromBombs[1]}.`;
    if (cup) {
      kicker = cup.final ? 'Tournament over · Team Bomb' : `Round ${cup.round} of ${cup.rounds} · Team Bomb`;
      if (cup.final) {
        title = lead < 0 ? 'The tournament ends level!' : lead === mine ? 'Your team wins the tournament!' : `${TEAM_NAMES[lead]} win the tournament!`;
        sub = forfeit ? 'Everyone else left.' : 'Final score.';
      } else {
        title = lead < 0 ? `Level at ${tally[0]} all` : `${side(lead)} ${lead === mine ? 'leads' : 'lead'} ${tally[lead]}–${tally[1 - lead]}`;
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
      if (lastResults === res) $('res-note').textContent = `Next round in ${left}…`;
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
    setLabel(back, host ? (between ? 'End tournament' : 'Back to the room') : 'Leave room', 'Esc');
    again.hidden = !host || between;
    setLabel(again, res.cup ? 'New tournament' : 'Play again', 'Enter');
    again.disabled = !room || room.players.length < MIN_PLAYERS;
    if (!between) {
      const h = room?.players.find((p) => p.id === room.hostId);
      $('res-note').textContent = host ? (again.disabled ? 'Waiting for another player…' : '') : `Waiting for ${h ? h.name : 'the host'}…`;
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
// straight back when it only changes screens; asked about first when it would end a tournament or leave the room
async function backFromResults() {
  const safe = kind === 'practice' || (amHost() && !(lastResults?.cup && !lastResults.cup.final));
  const sure = safe || (amHost() ? await ask({ title: 'End the tournament?', body: 'The rounds still to come are dropped, and everyone goes back to the room.', yes: 'End tournament', no: 'Keep playing' }) : await sureToLeave());
  if (sure && overlay === 'results') resultsBack();
}
$('btn-res-back').addEventListener('click', backFromResults);

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
    if (panel === 'help' && kind === 'online') renderLobby(); // reading How to play in a room: leave them to it
    else if (!inRoom() || kind !== 'online') {
      kind = 'online';
      openLobby();
    } else {
      if (popupOpen('stage') && locked()) closeStage(); // (no longer the host)
      renderLobby();
    }
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
  const popup = popupTop();
  if (popup) closePopup(popup); // (for a question, that is a "no")
  else if (overlay === 'help') closeHelp();
  else if (overlay === 'pause') closePause();
  else if (overlay === 'results') backFromResults();
  else if (screen === 'game') openPause();
  else if (panel === 'help') closeHelp();
  else if (panel === 'rooms') closePanel();
  else if (panel === 'lobby') {
    if (kind === 'practice') closePanel();
    else leaveIfSure();
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

  // every menu: how to play (not from under a popup)
  const popup = popupTop();
  if (key === 'h' && at !== 'results' && !popup) return at === 'help' ? closeHelp() : openHelp(), true;

  if (at === 'home' || (at === 'help' && screen === 'home')) {
    // the title scroll's entries (digits are a room code while Play is open)
    if (key === '1') return $('btn-play').click(), true;
    if (key === '2') return $('btn-practice').click(), true;
    if (key === '3') return $('btn-profile').click(), true;
  }
  // the tools under the menu sit in a row: left and right walk along it
  if ((key === 'arrowleft' || key === 'arrowright') && document.activeElement?.classList.contains('tool')) return moveFocus(key === 'arrowright' ? 1 : -1), true;
  // inside a group of buttons (the rounds of a tournament, the two sides): left and right walk along it
  const act = document.activeElement;
  const group = act?.tagName === 'BUTTON' ? act.closest('[data-group]') : null;
  if (group && (key === 'arrowleft' || key === 'arrowright')) {
    const all = [...group.querySelectorAll('button:not(:disabled)')];
    const to = all[all.indexOf(act) + (key === 'arrowright' ? 1 : -1)];
    if (to) {
      const i = to.dataset.i;
      if (to.getAttribute('role') === 'radio') to.click(); // (a tab: being on it chooses it)
      (i != null ? group.querySelector(`[data-i="${i}"]`) || to : to).focus();
    }
    return true;
  }
  if (at === 'rooms') {
    if (/^\d$/.test(key)) return typeCode(code + key), true;
    if (key === 'backspace') return typeCode(code.slice(0, -1)), true;
    if (key === 'c') return $('btn-create').click(), true;
    if (key === 'p') return openFind(), true;
    // Enter on the code (or anywhere but a button, once the code is complete) tries it again
    if (key === 'enter' && (document.activeElement === $('digits') || (code.length === CODE_LEN && !onButton))) return retryCode(), true;
  } else if (at === 'lobby') {
    // Enter starts the match from anywhere but a button (a button does what it says)
    if (key === 'enter' && !onButton) {
      if (!$('btn-start').hidden && !$('btn-start').disabled) $('btn-start').click();
      return true;
    }
    if (key === 'c' && kind === 'online') return copyInvite(), true;
    if (key === 'x' && switchSide()) return true;
    if (key === 'z' && shuffleSides()) return true;
    if (/^[a-z]$/.test(key)) return hotOption(key, e.shiftKey);
  } else if (at === 'stage') {
    // Enter is Done from anywhere but a button (a round's tab is already chosen once it has the focus)
    if (key === 'enter' && (!onButton || act.getAttribute('role') === 'radio')) return closeStage(), true;
    if (key === 'a' || key === 's' || key === 't') return hotOption(key, e.shiftKey);
  } else if (at === 'find') {
    if (key === 'c') return $('btn-find-host').click(), true;
  } else if (at === 'ask') {
    // the two answers sit side by side
    if (key === 'arrowleft' || key === 'arrowright') return moveFocus(key === 'arrowright' ? 1 : -1), true;
  } else if (at === 'pause') {
    if (key === 'q') return leaveIfSure(), true;
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
    if (panel === 'lobby') measureBar();
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
