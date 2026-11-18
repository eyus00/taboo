// Onigokko - everything outside the match itself: the title scroll, Play
// (host a room, join with a code, open rooms), your profile, the room and its
// stage sheet, how to play, the draw before a round, results.
//
// On a wide screen the title scroll stays on the left and what you open from
// it (play, profile, how to play) opens beside it; a room takes the whole
// screen. On a narrow one there is one panel at a time. Every screen can be
// driven with the keyboard alone (arrows + Enter, Esc to go back, a letter or
// number for most things).

import { MODES, DURATIONS, DEFAULT_THEME, THEMES, CUP_ROUNDS, NAME_MAX, CODE_LEN, MIN_PLAYERS, MAX_PLAYERS, TEAM_NAMES, TEAM_COLORS, TEAM_SLOTS, BOMB_POINTS, BOMB_COST, FLAG_POINTS, BEAT_TICKS, CUP_SCORES, FLAG_CAP_TICKS, TICK_RATE, ITEM_KINDS, ITEM_INFO, COUNTDOWN_MS, INTRO_MS, VS_MS } from '/shared/config.js';
import { ARENAS } from '/shared/arenas.js';
import { play } from './play.js';
import { scenePreview, styleStill, clearPictures, paintBackdrop, paperTexture } from './art.js';
import * as art from './art.js'; // (also: playerPortrait, for the results)
import { loadTheme, THEME_MAP } from './themes/index.js';
import { draw } from './spinner.js';
import { present } from './present.js';

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
const calm = matchMedia('(prefers-reduced-motion: reduce)');
// Key cues are shown wherever there is a keyboard: always on a computer, and
// on a tablet from the moment someone presses a real key.
document.body.classList.toggle('no-kbd', isTouch);

const socket = io({ tryAllTransports: true });
// The match itself (renderer, heads-up display, game events) lives in play.js.
play.init({
  socket,
  isTouch,
  // a round is starting: show the match, and over it the draw for arena, style and who is it
  // - but first, where the server leaves the time for it, the players walk on, face to face
  onStart(info) {
    show('game');
    const drawOpts = { sfx, colorOf: (slot) => play.colorOf(slot), me: play.mySlot(), prefer: [cardTheme] };
    const spare = (Number(info.countdown) || 0) - COUNTDOWN_MS - INTRO_MS - 350; // what is left before the draw has to begin
    const walk = info.playing || spare < 1300 ? 0 : present.versus({ ...info, practice: play.kind === 'practice' }, { me: play.mySlot(), ms: Math.min(spare, VS_MS) });
    if (!walk) return draw.show(play.el.spin, info, drawOpts);
    // (the draw comes on as the walk-on leaves, with the time that is left by then)
    const lead = walk - 300;
    clearTimeout(walkTimer);
    walkTimer = setTimeout(() => {
      if (play.info === info && screen === 'game') draw.show(play.el.spin, { ...info, countdown: info.countdown - lead }, drawOpts);
    }, lead);
  },
  onEnd: (res) => endOfRound(res),
  onPause: () => openPause(),
});
const { renderer, input, sfx, net } = play;

present.init({ sfx, colorOf: (slot) => play.colorOf(slot), portrait: (slot, size, face) => portraitOf(slot, { size, face }) });

let myName = cleanName(store.get('tag.name'));
let screen = ''; // name | home | game
let panel = ''; // what is open from the title scroll: '' | rooms (Play) | lobby (a room) | help
let overlay = ''; // over a match: '' | results | pause | help
let helpFrom = ''; // what How to play goes back to
let walkTimer = 0; // the draw, waiting for the walk-on to leave
let rig = false; // a match against bots in this browser alone, started by the test hook (__tag.practice)
let room = null; // latest room state from the server
let afterName = null;
let lastResults = null;
let nextTimer = 0;
let cardTheme = DEFAULT_THEME; // the style the arena cards were last painted in
let demos = null; // the live demos on the How to play page (loaded when it is first opened)
// the card that explains an item in the room (see itemTip):
let tip = null; // its parts, made the first time it is wanted
let tipFor = null; // the item it is open for
let tipTimer = 0;
let peeker = null; // demo.js's player for one item (loaded with the first card)

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

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
const PANELS = ['lobby', 'help'];
// the first letter of a name, for its seal
const initial = (name) => (Array.from(String(name || '').trim())[0] || '?').toUpperCase();

// Popups: a sheet of paper laid over whatever is open - the stage, the open
// rooms, your profile, a question. Each is a native <dialog>, so what is
// behind it cannot be reached (by pointer, by Tab or by a screen reader) and
// is not rebuilt; Esc, its cross or a click on the dark around it closes it.
const POPUPS = ['ask', 'info', 'find', 'profile', 'code']; // (front to back, should two be open)
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
  setLabel($('btn-ask-yes'), yes, 'Enter');
  setLabel($('btn-ask-no'), no, 'Esc');
  $('btn-ask-no').hidden = !no;
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
  hideItemTip();
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
  document.body.classList.toggle('in-room', panel === 'lobby');
  document.body.dataset.panel = panel; // (what is open beside the main menu)
  if (name !== 'game') {
    play.stop();
    draw.clear();
  }
  // which entry of the title scroll is open
  $('btn-create').toggleAttribute('aria-current', panel === 'lobby');
  if (name === 'home' && !beside) homeReady();
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
  if (next.hasAttribute('data-group')) (next.querySelector('input:checked, [aria-checked="true"], [aria-selected="true"]') || next.querySelector('input, button'))?.focus();
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
  setCode(''); // (a code typed earlier is not waiting there)
  show('home');
  if (focus) focusFirst(focus);
}

// Close whatever is open beside the title scroll; the focus goes back to the entry that opened it.
function closePanel() {
  const opener = panel === 'help' ? $('btn-help') : $('btn-create');
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
  if (room) return openLobby(); // the room you are in comes first
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
socket.on('connect', () => {
  setConn('ok', 'Server awake', 'You are connected.');
  refreshGames(); // (how many rooms are open, for the title scroll)
});
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
for (const [key, value] of Object.entries({ bomb: plural(BOMB_POINTS, 'point'), beat: String(Math.round(BEAT_TICKS / TICK_RATE)), flagpay: plural(FLAG_POINTS, 'point'), bombcost: plural(BOMB_COST, 'point'), flagtime: (FLAG_CAP_TICKS / TICK_RATE).toFixed(1).replace('.0', ''), rounds: orList(CUP_ROUNDS), teams: `${TEAM_NAMES[0]} against ${TEAM_NAMES[1]}` })) {
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
// Three ways in, all on the title scroll: host a room of your own (the big
// button), look through the rooms that are open to everyone (a popup, with a
// few ways to narrow them down), or type the code a friend gave you (digits
// go straight in, from anywhere on the title scroll).
let code = '';
let codeTried = '';
const svg = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}" /></svg>`;

// (the title scroll is in front, with nothing open beside it)
function homeReady() {
  $('numpad').hidden = true;
  $('digits').classList.remove('open');
  codeTried = '';
  paintGames(); // what we already know, straight away...
  watchGames(); // ...then the latest
}

// Host: a room of your own. It starts private, and the button in the room
// opens it to everyone - unless you asked for an open one from the list.
const hostGame = (errorEl, open, btn) => enterRoom('create', { name: myName, open }, errorEl, btn);
$('btn-create').addEventListener('click', () => {
  if (room) openLobby(); // already in a room: that is where the game is
  else hostGame($('home-error'), false, $('btn-create'));
});

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
  if (room) {
    // Already in a room: the code of another takes you there - once you have said so.
    // (The server looks at the other room first: if it is not there, or full, you stay where you are.)
    if (code === room.code) {
      $('join-error').textContent = 'You are in this room.';
      return;
    }
    const to = code;
    if (!(await ask({ title: `Go to room ${to}?`, body: whatLeavingDoes(), yes: 'Change rooms' }))) {
      codeTried = ''; // (typed again, it asks again)
      return setCode('');
    }
    if (code !== to || busy) return;
  }
  const was = room?.code;
  const ok = await enterRoom('join', { code, name: myName }, $('join-error'), $('btn-join-go'));
  if (ok) {
    if (was && was !== room.code) toast(`You are in room ${room.code} now`);
    setCode(''); // (the room says its own code; the squares are free for the next one)
  } else if (top() === 'home' || room) {
    $('digits').classList.add('bad');
    sfx.play('lose');
  }
}
// (what becomes of the room you are in when you go to another)
function whatLeavingDoes() {
  const people = room ? room.players.filter((p) => !p.bot).length : 0;
  return !amHost() ? 'You leave the room you are in.' : people > 1 ? 'You are the host here: the room passes to the next player.' : 'Nobody else is in this room: it closes when you go.';
}
// On a narrow screen the title scroll is not beside the room: a key in the room's
// top bar opens a small sheet for the other room's code. Its button is the question.
for (const id of ['btn-other', 'btn-other-low']) {
  $(id).addEventListener('click', () => {
    if (!room) return;
    $('code-input').value = '';
    $('code-error').textContent = '';
    $('code-note').textContent = whatLeavingDoes();
    sfx.play('click');
    openPopup('code');
  });
}
$('code-input').addEventListener('input', () => {
  const inp = $('code-input');
  inp.value = inp.value.replace(/\D/g, '').slice(0, CODE_LEN);
  $('code-error').textContent = '';
});
$('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const to = $('code-input').value.replace(/\D/g, '');
  if (to.length !== CODE_LEN) return void ($('code-error').textContent = `Type the ${CODE_LEN} digits of the room's code.`);
  if (room && to === room.code) return void ($('code-error').textContent = 'You are in this room.');
  const was = room?.code;
  // (enterRoom opens the new room, which closes this sheet; if the room is not there or full, the sheet stays and says so)
  const ok = await enterRoom('join', { code: to, name: myName }, $('code-error'), $('btn-code-go'));
  if (ok && was && was !== room.code) toast(`You are in room ${room.code} now`);
  else if (!ok) sfx.play('lose');
});

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
  const on = top();
  setCode(next);
  // (typed from the room: the squares take the focus too, so Enter and Backspace go on belonging to the code)
  if ((on === 'home' || on === 'lobby') && top() === on && !isTouch && document.activeElement !== $('digits')) $('digits').focus({ preventScroll: true });
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
addEventListener('paste', (e) => {
  if (top() !== 'home' && top() !== 'lobby') return;
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
    if (top() !== 'home' && !popupOpen('find')) return clearInterval(gamesTimer);
    if (!document.hidden) refreshGames();
  }, 2500);
}

const nameOfArena = (id) => (id === 'random' ? 'Random stage' : ARENAS.find((a) => a.id === id)?.name || 'Arena');
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
  const many = known && games.length ? String(games.length) : '';
  if (count.textContent !== many) count.textContent = many;
  count.hidden = !many;
  const said = known ? (games.length ? `${games.length} open now` : 'none open right now') : 'looking…';
  $('btn-find').title = `Open rooms: ${said}`;
  $('btn-find').setAttribute('aria-label', `Open rooms: ${said} (P)`);
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
// The room
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
const OPTIONS = [
  { id: 'mode', key: 'mode', hot: 'r', label: 'Game', type: 'modes', box: 'opt-mode', info: 'game', values: MODES.map((m) => [m.id, m.name]), icon: (v) => MODE_ICON[v], show: (s) => s.game !== 'cup' },
  // a tournament is a knockout (the oni at the buzzer is out, round after round), or a team battle over a number of rounds
  { id: 'sides', key: 'mode', hot: 'r', label: 'Game', type: 'modes', box: 'opt-mode', info: 'cup', values: [['potato', 'Knockout'], ['team', 'Team Bomb']], icon: (v) => (v === 'team' ? 'bomb' : 'oni'), on: (s, v) => (v === 'team') === (s.mode === 'team'), show: (s) => s.game === 'cup' },
  { id: 'rounds', key: 'rounds', hot: 'n', label: 'Rounds', box: 'opt-mode', values: CUP_ROUNDS.map((n) => [n, String(n)]), show: (s) => s.game === 'cup' && s.mode === 'team' },
  // how a team tournament is decided: rounds won, or every point added up
  { id: 'score', key: 'score', hot: 'w', label: 'Winner by', box: 'opt-mode', values: [['rounds', 'Rounds won'], ['points', 'Total points']], show: (s) => s.game === 'cup' && s.mode === 'team' },
  { id: 'theme', hot: 's', label: 'Style', type: 'cards', box: 'style-cards', values: [['random', 'Random'], ...THEMES.map((t) => [t.id, t.name])], on: (s, v) => stageValue('theme') === v, set: (v) => setStage('theme', v) },
  { id: 'arena', hot: 'a', label: 'Stage', type: 'cards', box: 'arena-cards', values: [['random', 'Random'], ...ARENAS.map((a) => [a.id, a.name])], on: (s, v) => stageValue('arena') === v, set: (v) => setStage('arena', v) },
  { id: 'powerups', key: 'powerups', hot: 'p', label: 'Lucky boxes', box: 'options', info: 'boxes', values: [[true, 'On'], [false, 'Off']] },
  { id: 'duration', key: 'duration', hot: 'l', label: 'Round time', box: 'options', values: DURATIONS.map((d) => [d, `${d} s`]) },
];
const optionById = (id) => OPTIONS.find((o) => o.id === id);
const settings = () => room.settings;
const locked = () => !amHost();
const isOn = (o, s, value) => (o.on ? o.on(s, value) : String(s[o.key]) === String(value));
const isCup = () => room.settings.game === 'cup';
// (a knockout: every round the oni at the buzzer is out, so it has one round fewer than players)
const isKnockout = () => isCup() && room.settings.mode !== 'team';
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
  if (inRoom()) renderLobby();
}
const touched = () => {
  settingsAt = performance.now();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, SETTLE_MS + 20);
};

function changeSetting(patch) {
  if (!amHost()) return;
  const s = room.settings;
  // (what the server will do too, so the screen does not wait for it)
  if (patch.game === 'cup' && s.game !== 'cup' && patch.mode === undefined) s.mode = 'team';
  Object.assign(s, patch);
  if ('size' in patch || 'bots' in patch || 'mode' in patch || 'game' in patch) fitStages();
  socket.emit('settings', patch);
  touched();
  // (whether there are two sides decides how the players are shown; the seats, how many of them)
  if ('mode' in patch || 'game' in patch || 'bots' in patch || 'size' in patch || 'powerups' in patch) renderLobby();
  else {
    syncDoor();
    syncOptions();
  }
}

// --- how many play: the people in the room, and the bots in the seats nobody
// has taken. A stage is built for a crowd of a certain size: with more (or
// fewer) players than it suits it is locked, and goes back to Random if it
// was chosen.
const people = () => room.players.filter((p) => !p.bot);
const headcount = () => Math.max(MIN_PLAYERS, room.settings.bots ? Math.max(room.settings.size, room.players.length) : room.players.length);
// how many rounds are being set up, and how many play in round k (a knockout loses one a round)
const roundsNow = () => (!isCup() ? 1 : isKnockout() ? Math.max(1, headcount() - 1) : room.settings.rounds);
const playersIn = (k) => (isKnockout() ? Math.max(MIN_PLAYERS, headcount() - k) : headcount());
const stageRange = (id) => ARENAS.find((a) => a.id === id)?.players || [MIN_PLAYERS, MAX_PLAYERS];
const fitsCount = (id, n) => n >= stageRange(id)[0] && n <= stageRange(id)[1];
// Can this stage be chosen for the round(s) in hand? (For "every round" it has to suit every one of them.)
const stageFits = (id, sel = stageSel) => {
  if (id === 'random' || !id) return true;
  const rounds = sel === 'all' || !isCup() ? Array.from({ length: roundsNow() }, (_, k) => k) : [sel];
  return rounds.every((k) => fitsCount(id, playersIn(k)));
};
const rangeText = (id) => stageRange(id).join('–');
function fitStages() {
  const s = room.settings;
  s.plan.forEach((st, k) => {
    if (st.arena !== 'random' && !fitsCount(st.arena, playersIn(k))) st.arena = 'random';
  });
  s.arena = s.plan[0].arena;
}
function setSize(to) {
  if (!room || !amHost()) return false;
  const s = room.settings;
  const size = Math.max(MIN_PLAYERS, people().length, Math.min(MAX_PLAYERS, to));
  if (size === s.size) return false;
  sfx.play('click');
  changeSetting({ size });
  return true;
}
// (the button says which: a bot in every open seat, or - when no seat is open - every bot out)
function toggleBots() {
  if (!room || !amHost() || $('btn-bots').disabled) return false;
  sfx.play('click');
  changeSetting({ bots: $('btn-bots').dataset.does === 'fill' });
  return true;
}
$('btn-size-down').addEventListener('click', () => setSize(room.settings.size - 1));
$('btn-size-up').addEventListener('click', () => setSize(room.settings.size + 1));
$('btn-bots').addEventListener('click', toggleBots);

// --- the stage: an arena and a style. A tournament has one of each for every
// round; `stageSel` says which round a choice is for right now.
let stageSel = 'all'; // 'all', or a round of the tournament (0 = the first)
const planNow = () => room.settings.plan.slice(0, roundsNow());

// What counts as chosen: the selected round's pick - for "every round", the
// pick they all share ('' if they do not).
function stageValue(what) {
  const plan = planNow();
  if (stageSel !== 'all' && isCup()) return plan[Math.min(stageSel, plan.length - 1)][what];
  return plan.every((st) => st[what] === plan[0][what]) ? plan[0][what] : '';
}
function setStage(what, value) {
  if (!amHost()) return;
  if (what === 'arena' && !stageFits(value)) return;
  const s = room.settings;
  if (!isCup()) {
    s.plan[0][what] = value;
    socket.emit('settings', { stage: { i: 0, [what]: value } });
  } else if (stageSel === 'all') {
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

// --- what Random draws from: every stage (and every style) to begin with.
// While Random is the choice, each card has a tick in its corner: the host
// takes a stage out of the draw, or puts it back in. (An empty list means
// all of them; one that only holds stages this many players cannot use
// counts as all of them too.)
const poolOf = (what) => {
  const all = stageList(what).map((x) => x.id);
  const chosen = room.settings.pool?.[what] || [];
  return chosen.length ? all.filter((id) => chosen.includes(id)) : all;
};
const inPool = (what, id) => poolOf(what).includes(id);
function togglePool(what, id) {
  if (!amHost()) return;
  const all = stageList(what).map((x) => x.id);
  const now = poolOf(what);
  let next = now.includes(id) ? now.filter((x) => x !== id) : all.filter((x) => now.includes(x) || x === id);
  // (something has to be left to draw - for a stage, something this many players can use)
  if (!next.some((x) => what !== 'arena' || stageFits(x))) return toast('Random needs at least one');
  if (next.length === all.length) next = [];
  const s = room.settings;
  s.pool = { arena: [], theme: [], ...s.pool, [what]: next };
  socket.emit('settings', { pool: { [what]: next } });
  touched();
  sfx.play('click');
  syncOptions();
}
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
// The name of a setting stands over it like the title of a section, with its
// key beside it - and, where there is more to know, a button that explains.
function title(o) {
  const h = el('h3', 'lab', o.label);
  h.append(el('kbd', '', o.hot.toUpperCase()));
  if (o.info) h.insertAdjacentHTML('beforeend', `<button class="info" data-info="${o.info}" aria-label="About ${o.label.toLowerCase()}">${svg('info')}</button>`);
  return h;
}

// Quick Play, or a tournament: one switch (two radio buttons underneath; an
// ink thumb slides to the one that is on).
const FORMATS = [['quick', 'Quick Play', 'play'], ['cup', 'Tournament', 'cup']];
function buildFormat() {
  const box = $('opt-format');
  box.textContent = '';
  for (const [game, name, icon] of FORMATS) {
    const item = el('label');
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = 'format';
    inp.value = game;
    inp.addEventListener('change', () => setFormat(game));
    const face = el('span', '', name);
    face.insertAdjacentHTML('afterbegin', svg(icon));
    item.append(inp, face);
    box.append(item);
  }
  box.append(el('i', 'thumb'), el('kbd', '', 'G'));
}

function buildOptions() {
  for (const id of ['options', 'opt-mode', 'arena-cards', 'style-cards']) $(id).textContent = '';
  buildFormat();
  for (const o of OPTIONS) {
    const box = $(o.box);
    if (o.type === 'cards') {
      // a picture card for every art style (one row) and every stage (as many rows as it takes)
      o.values.forEach(([value, text], i) => {
        const card = el('label', 'card');
        let pic;
        if (value === 'random') {
          pic = el('span', 'pic any', '?');
          pic.setAttribute('aria-hidden', 'true');
        } else {
          pic = el('img', 'pic');
          pic.alt = '';
          pic.dataset.id = value;
        }
        card.append(radio(o, value, i), pic, el('span', 'cap', text));
        card.dataset.id = value;
        if (value !== 'random') {
          // (shown while Random is the choice: whether this one is in the draw)
          const tick = el('button', 'pool');
          tick.type = 'button';
          tick.innerHTML = svg('check');
          tick.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePool(o.id, value);
          });
          card.append(tick);
        }
        if (o.id === 'arena' && value !== 'random') {
          // (shown when the stage is shut: how many players it is for)
          const tag = el('span', 'for');
          tag.innerHTML = `${svg('lock')}<span>${rangeText(value)}</span>`;
          tag.setAttribute('aria-hidden', 'true');
          card.append(tag);
          card.querySelector('input').setAttribute('aria-label', `${text}, for ${rangeText(value)} players`);
        }
        box.append(card);
      });
      continue;
    }
    const row = el('div', 'opt');
    row.dataset.opt = o.id;
    const group = el('div', o.type === 'modes' ? 'rm-modes' : 'seg');
    group.dataset.group = '';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', o.label);
    o.values.forEach(([value, text], i) => {
      const item = el('label', o.type === 'modes' ? 'rm-mode' : '');
      const face = el('span', '', text);
      // (a game carries its sign)
      if (o.type === 'modes') face.insertAdjacentHTML('afterbegin', svg(o.icon(value)));
      item.append(radio(o, value, i), face);
      group.append(item);
    });
    row.append(title(o), group);
    box.append(row);
  }
  // a knockout has as many rounds as it takes: one fewer than players
  const fact = el('div', 'opt ko');
  fact.id = 'ko-rounds';
  fact.append(el('h3', 'lab', 'Rounds'), el('p', 'ko-n'));
  fact.title = 'One round fewer than players: every round the oni at the buzzer is out';
  $('opt-mode').append(fact);
  buildItems();
}

// --- what is in the lucky boxes: every item to begin with. Each is a small
// button under the switch: press it to take the item out, or put it back.
// (An empty list means all of them.)
const itemsIn = () => {
  const chosen = room.settings.items || [];
  return chosen.length ? ITEM_KINDS.filter((k) => chosen.includes(k)) : ITEM_KINDS.slice();
};
function buildItems() {
  const box = $('opt-items');
  box.textContent = '';
  for (const kind of ITEM_KINDS) {
    const b = el('button', 'item');
    b.type = 'button';
    b.dataset.kind = kind;
    b.innerHTML = svg(kind);
    b.addEventListener('click', () => toggleItem(kind));
    box.append(b);
  }
}
// --- an item, explained where you point at it ---------------------------------------
// Rest the pointer on an item in the room (the host's buttons, a guest's row of
// icons), or bring the keyboard's focus to one, and a card opens over it: the
// How to play demo of that item, playing, with its name and what it does. It
// never takes the pointer, and it goes when the pointer or the focus does.
// (tip, tipFor, tipTimer and peeker are declared at the top, with the rest of what the menus remember)
function itemTip() {
  if (tip) return tip;
  const box = el('div', 'item-tip');
  box.id = 'item-tip';
  box.hidden = true;
  box.setAttribute('role', 'tooltip');
  box.innerHTML = '<div class="it-demo"></div><div class="it-what"><span class="pic"></span><span class="words"><b></b><small></small></span><em></em></div><i class="it-tail"></i>';
  document.body.append(box);
  tip = { box, demo: box.querySelector('.it-demo'), pic: box.querySelector('.pic'), name: box.querySelector('b'), blurb: box.querySelector('small'), state: box.querySelector('em') };
  return tip;
}
// (what the card says, and where it stands: above the item, or below it if there is no room above)
function paintItemTip() {
  if (!tip || !tipFor) return;
  if (!tipFor.isConnected) return hideItemTip();
  const kind = tipFor.dataset.kind;
  const info = ITEM_INFO[kind];
  tip.pic.innerHTML = svg(kind);
  tip.name.textContent = info.name;
  tip.blurb.textContent = info.blurb;
  const host = tipFor.tagName === 'BUTTON';
  const inBox = host && tipFor.classList.contains('in');
  tip.state.hidden = !host;
  tip.state.textContent = inBox ? 'In the boxes' : 'Left out';
  tip.state.classList.toggle('out', !inBox);
  const z = tip.box.currentCSSZoom || 1;
  const at = tipFor.getBoundingClientRect();
  const size = tip.box.getBoundingClientRect();
  const left = Math.min(Math.max(8, at.left + at.width / 2 - size.width / 2), innerWidth - size.width - 8);
  const above = at.top - size.height - 12 >= 8;
  tip.box.classList.toggle('below', !above);
  tip.box.style.left = `${left / z}px`;
  tip.box.style.top = `${(above ? at.top - size.height - 12 : at.bottom + 12) / z}px`;
  tip.box.style.setProperty('--tail', `${(at.left + at.width / 2 - left) / z}px`);
}
function showItemTip(target) {
  if (tipFor === target || !ITEM_INFO[target.dataset.kind]) return;
  const t = itemTip();
  tipFor = target;
  t.box.hidden = false;
  t.demo.hidden = !peeker; // (until the demos have been fetched: the words alone)
  paintItemTip();
  const play = () => {
    if (tipFor !== target) return;
    t.demo.hidden = !peeker.show(t.demo, target.dataset.kind);
    paintItemTip(); // (it has its full height now)
  };
  if (peeker) play();
  else import('./demo.js').then((m) => ((peeker = m.itemPeek), play())).catch(() => {});
}
function hideItemTip() {
  clearTimeout(tipTimer);
  tipFor = null;
  if (tip) tip.box.hidden = true;
  peeker?.hide();
}
{
  const item = (e) => (e.target instanceof Element ? e.target.closest('#opt-items .item, .gc-items [data-kind]') : null);
  const lobby = $('s-lobby');
  lobby.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const it = item(e);
    if (!it || it === tipFor) return;
    clearTimeout(tipTimer);
    // (a moment's rest before the first card; going along the row, the next one at once)
    if (tipFor) showItemTip(it);
    else tipTimer = setTimeout(() => showItemTip(it), 220);
  });
  lobby.addEventListener('pointerout', (e) => {
    const it = item(e);
    if (!it || (e.relatedTarget instanceof Node && it.contains(e.relatedTarget))) return;
    clearTimeout(tipTimer);
    // (unless the pointer went straight on to another item, the card goes)
    const next = e.relatedTarget instanceof Element ? e.relatedTarget.closest('#opt-items .item, .gc-items [data-kind]') : null;
    if (!next) hideItemTip();
  });
  lobby.addEventListener('focusin', (e) => {
    const it = item(e);
    if (it && it.matches(':focus-visible')) showItemTip(it);
  });
  lobby.addEventListener('focusout', (e) => item(e) && hideItemTip());
  addEventListener('scroll', hideItemTip, true);
  addEventListener('resize', hideItemTip);
}

function toggleItem(kind) {
  if (!amHost() || !room.settings.powerups) return;
  const now = itemsIn();
  let next = now.includes(kind) ? now.filter((k) => k !== kind) : ITEM_KINDS.filter((k) => now.includes(k) || k === kind);
  if (!next.length) return toast('Keep one item, or turn the boxes off');
  if (next.length === ITEM_KINDS.length) next = [];
  room.settings.items = next;
  socket.emit('settings', { items: next });
  touched();
  sfx.play('click');
  syncOptions();
}

function syncOptions() {
  const s = settings();
  const lock = locked();
  $('s-lobby').classList.toggle('guest', lock);
  // the host sets things up; a guest reads what was set up, as a card
  $('rm-setup').hidden = lock;
  $('guest-card').hidden = !lock;
  if (lock) return paintGuestCard();
  renderRounds();
  for (const inp of $('s-lobby').querySelectorAll('input[type="radio"][name^="opt-"]')) {
    const o = optionById(inp.name.slice(4));
    if (!o) continue;
    const value = o.values[inp.dataset.i][0];
    inp.checked = isOn(o, s, value);
    // a stage built for a different number of players is not offered (the "about" panel has them all)
    const shut = o.id === 'arena' && !stageFits(value);
    inp.disabled = lock || shut;
    inp.parentElement.classList.toggle('on', inp.checked);
    if (o.id === 'arena') {
      inp.parentElement.classList.toggle('shut', shut);
      inp.parentElement.hidden = shut;
    }
  }
  // the stage grid keeps its ten places whatever is on offer; a line under it says why some are not
  const grid = $('arena-cards');
  for (const old of grid.querySelectorAll('.spare')) old.remove();
  const offered = [...grid.children].filter((c) => !c.hidden).length;
  for (let k = offered; k < 10; k++) {
    // (an unseen card: the same size as a real one, so the rows are as tall as ever)
    const spare = el('i', 'card spare');
    spare.setAttribute('aria-hidden', 'true');
    spare.append(el('span', 'pic'), el('span', 'cap', '.'));
    grid.append(spare);
  }
  const fewer = grid.querySelectorAll('.card.shut').length;
  $('stage-note').textContent = !fewer ? '' : isKnockout() && stageSel === 'all' && offered <= 1 ? 'Pick a round to choose its stage.' : `${fewer} more for other numbers of players.`;
  for (const row of $('s-lobby').querySelectorAll('[data-opt]')) {
    const o = optionById(row.dataset.opt);
    row.hidden = !!o.show && !o.show(s);
  }
  // Random is the choice: every card says whether it is in the draw (and the host can take it out, or put it back)
  for (const what of ['theme', 'arena']) {
    const box = $(what === 'theme' ? 'style-cards' : 'arena-cards');
    box.classList.toggle('drawing', !lock && stageValue(what) === 'random');
    const names = new Map(stageList(what).map((x) => [x.id, x.name]));
    let left = 0;
    let could = 0;
    for (const card of box.children) {
      const id = card.dataset.id;
      const tick = card.querySelector('.pool');
      if (!tick) continue;
      const playable = what !== 'arena' || stageFits(id);
      const on = inPool(what, id);
      could += playable;
      left += playable && on;
      card.classList.toggle('in', on);
      tick.setAttribute('aria-pressed', String(on));
      tick.setAttribute('aria-label', `${names.get(id)}: ${on ? 'in the Random draw. Take it out' : 'not in the Random draw. Put it in'}`);
      tick.title = on ? 'In the Random draw' : 'Not in the Random draw';
    }
    // (the Random card says how many it draws from, once that is not all of them)
    const cap = box.querySelector('.card[data-id="random"] .cap');
    if (cap) cap.textContent = left && left < could ? `Random · ${left}` : 'Random';
  }
  // the format: which way the switch is thrown
  $('opt-format').dataset.on = s.game;
  for (const inp of $('opt-format').querySelectorAll('input')) inp.checked = inp.value === s.game;
  // a knockout: how many rounds it will take
  const ko = isKnockout();
  $('ko-rounds').hidden = !ko;
  if (ko) $('ko-rounds').lastChild.innerHTML = `<b>${roundsNow()}</b>`; // (one out a round: one round fewer than players)
  // the items in the boxes (nothing to choose while the boxes are off)
  const boxes = !!s.powerups;
  const inBox = itemsIn();
  $('opt-items').classList.toggle('off', !boxes);
  for (const b of $('opt-items').children) {
    const kind = b.dataset.kind;
    const on = inBox.includes(kind);
    const info = ITEM_INFO[kind];
    b.classList.toggle('in', on);
    b.disabled = !boxes;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', `${info.name}: ${info.blurb}. ${on ? 'In the boxes: take it out' : 'Not in the boxes: put it in'}`);
  }
  if (tipFor) paintItemTip(); // (the card over an item says whether it is in)
  paintCards();
  paintFaces();
}
// --- A guest's side of the room: what the host has set up, as a card to
// read - the game and what it asks of you, the style and the stage as
// pictures, the rules as a few tags, and (in a tournament whose rounds
// differ) the plan round by round.
const GAME_LINE = { potato: "Don't be the oni when the clock runs out", time: 'Spend the least time as the oni', team: 'Hold the flags, and pass your bombs on', ko: 'The oni at the buzzer is out, round after round' };
// (a guest's match card: the way to win, in two or three steps)
const HOW_TO_WIN = {
  potato: ['Touch someone to pass the oni on', "Don't be the oni when the clock stops"],
  time: ['Touch someone to pass the oni on', 'Every second you are the oni is counted', 'The least time wins'],
  team: ["Stand in a flag's ring to turn it your colour", 'Stick your bomb on an enemy by touching them', `Every ${Math.round(BEAT_TICKS / TICK_RATE)} s: +${FLAG_POINTS} for each flag, \u2212${BOMB_COST} for each bomb in hand`],
  ko: ['Whoever is the oni at the buzzer is out', 'Everyone else plays the next round', 'The last one standing wins'],
};
function paintGuestCard() {
  const s = settings();
  const box = $('guest-card');
  const cup = isCup();
  const ko = isKnockout();
  const plan = planNow();
  const sig = JSON.stringify([s.game, s.mode, s.rounds, plan, s.duration, s.powerups, s.items, s.pool, headcount(), fontsIn]);
  if (box.dataset.sig === sig) return paintFaces();
  box.dataset.sig = sig;
  box.textContent = '';
  // the game
  const head = el('header', 'gc-head');
  head.innerHTML = `<span class="crest">${svg(ko ? 'oni' : MODE_ICON[s.mode])}</span>`;
  const words = el('div', 'words');
  words.append(el('p', 'kicker', cup ? `Tournament · ${roundsNow()} rounds` : 'Quick Play'), el('h3', '', ko ? 'Knockout' : nameOfMode(s.mode)), el('p', 'line', GAME_LINE[ko ? 'ko' : s.mode]));
  head.append(words);
  // the style and the stage, as pictures (what Random draws from, if that is not everything)
  const jobs = [];
  const picture = (what, label) => {
    const fig = el('figure', 'gc-pic');
    const one = plan.every((st) => st[what] === plan[0][what]) ? plan[0][what] : '';
    const real = one && one !== 'random';
    let frame;
    if (real) {
      frame = el('img');
      frame.alt = '';
      const style = paintIn(plan[0].theme);
      jobs.push([what === 'theme' ? one : style, () => (frame.src = what === 'theme' ? styleStill(one, 320, 180) : scenePreview(one, style, 320, 180))]);
    } else {
      frame = el('span', 'any', one ? '?' : '');
      if (!one) frame.innerHTML = svg('shuffle');
    }
    const left = one === 'random' ? poolOf(what).filter((id) => what !== 'arena' || plan.some((_, k) => fitsCount(id, playersIn(k)))) : [];
    const all = stageList(what).length;
    const name = real ? stageList(what).find((x) => x.id === one)?.name || one : !one ? 'Changes every round' : left.length && left.length < all ? `Random · one of ${left.length}` : 'Random';
    const cap = el('figcaption');
    cap.append(el('small', '', label), el('b', '', name));
    fig.append(frame, cap);
    return fig;
  };
  const pics = el('div', 'gc-pics');
  pics.append(picture('theme', 'Style'), picture('arena', 'Stage'));
  // the rules, as tags
  const facts = el('ul', 'gc-facts');
  const fact = (icon, text) => {
    const li = el('li');
    li.innerHTML = svg(icon);
    li.append(text);
    facts.append(li);
    return li;
  };
  fact('clock', `${s.duration} s a round`);
  fact('crowd', `${headcount()} players`);
  const boxes = fact('box', s.powerups ? 'Lucky boxes' : 'No lucky boxes');
  if (s.powerups) {
    const row = el('span', 'gc-items');
    for (const kind of itemsIn()) row.insertAdjacentHTML('beforeend', `<i data-kind="${kind}" role="img" aria-label="${ITEM_INFO[kind].name}: ${ITEM_INFO[kind].blurb}">${svg(kind)}</i>`);
    boxes.append(row);
  }
  box.append(head, pics, facts);
  // a tournament whose rounds differ: the plan, round by round
  if (cup && !plan.every((st) => st.arena === plan[0].arena && st.theme === plan[0].theme)) {
    const rounds = el('ol', 'gc-rounds');
    plan.forEach((st, k) => {
      const li = el('li');
      const name = (what) => (st[what] === 'random' ? 'Random' : stageList(what).find((x) => x.id === st[what])?.name || st[what]);
      li.append(el('b', '', String(k + 1)), `${name('arena')} · ${name('theme')}`);
      rounds.append(li);
    });
    box.append(rounds);
  } else {
    // otherwise there is room to say how the game is won, step by step, and which keys do what
    const how = el('section', 'gc-how');
    const steps = el('ol');
    HOW_TO_WIN[ko ? 'ko' : s.mode].forEach((text, i) => {
      const li = el('li');
      li.append(el('b', '', String(i + 1)), text);
      steps.append(li);
    });
    how.append(el('h4', 'lab', 'How to win'), steps);
    if (!isTouch) {
      const keys = el('p', 'gc-keys');
      keys.innerHTML = '<span><kbd>A</kbd><kbd>D</kbd>run</span><span><kbd>W</kbd>jump, twice</span><span><kbd>S</kbd>drop</span><span><kbd>E</kbd>use your item</span>';
      how.append(keys);
    }
    box.append(how);
  }
  paintQueue(jobs, () => panel === 'lobby' && box.dataset.sig === sig);
  paintFaces();
}

// (the top of the room: who may come in - for everyone, host or guest)
function syncDoor() {
  const s = settings();
  const lock = locked();
  // one button that says which it is (and, for the host, changes it)
  const door = $('btn-open');
  door.classList.toggle('on', !!s.open);
  door.disabled = lock;
  $('open-label').textContent = s.open ? 'Public' : 'Private';
  const what = s.open ? 'Public: anyone can find this room and come in' : 'Private: only people with the code can come in';
  door.title = what;
  door.setAttribute('aria-label', lock ? what : `${what}. Make it ${s.open ? 'private' : 'public'} (V)`);
}
$('btn-open').addEventListener('click', () => {
  if (!amHost()) return;
  sfx.play('click');
  changeSetting({ open: !room.settings.open });
});

// One match and a tournament are set up separately: each keeps its own game
// and its own stage, and what you chose for one is still there when you come
// back from the other. (The server holds one set of settings; the host's
// screen remembers the other and hands it back on the way over.)
const kept = {};
function setFormat(game) {
  if (!amHost()) return;
  const s = room.settings;
  if (s.game === game) return;
  sfx.play('click');
  kept[s.game] = { mode: s.mode, first: { ...s.plan[0] } };
  const to = kept[game] || { mode: game === 'cup' ? 'team' : s.mode === 'team' ? 'team' : 'potato', first: { ...s.plan[0] } };
  s.game = game;
  s.mode = to.mode;
  Object.assign(s.plan[0], to.first);
  s.arena = to.first.arena;
  s.theme = to.first.theme;
  socket.emit('settings', { game, mode: to.mode, stage: { i: 0, ...to.first } });
  touched();
  stageSel = 'all';
  renderLobby();
}

// A letter key steps one setting to its next value (Shift: previous) and puts
// the focus there, so the arrow keys carry on from it.
function hotOption(letter, back) {
  const s = settings();
  if (letter === 't') {
    if (!isCup()) return false;
    // which round the style and the stage are for: every round, 1, 2, ... (anyone may look)
    const order = ['all', ...planNow().map((_, i) => i)];
    pickRound(order[(order.indexOf(stageSel) + (back ? -1 : 1) + order.length) % order.length]);
    $('round-tabs').querySelector('input:checked')?.focus();
    return true;
  }
  if (locked()) return false;
  // (the button is not focused: Enter must still start the match right after)
  if (letter === 'v') return $('btn-open').click(), true;
  if (letter === 'b') return toggleBots();
  if (letter === 'g') {
    setFormat(s.game === 'cup' ? 'quick' : 'cup');
    $('opt-format').querySelector('input:checked')?.focus();
    return true;
  }
  const o = OPTIONS.find((x) => x.hot === letter && (!x.show || x.show(s)));
  if (!o) return false;
  // (a stage that is shut for this many players is stepped over)
  const open = o.values.filter(([v]) => o.id !== 'arena' || stageFits(v));
  const i = open.findIndex(([v]) => isOn(o, s, v));
  const next = open[(i + (back ? -1 : 1) + open.length) % open.length][0];
  if (o.set) o.set(next);
  else changeSetting({ [o.key]: next });
  const now = $('s-lobby').querySelector(`input[name="opt-${o.id}"]:checked`);
  now?.focus();
  now?.closest('.card')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  sfx.play('click');
  return true;
}

// A tournament: which round the style and the stage are for - every round at
// once, or one of them. (Looking is for everyone; choosing is the host's.)
function renderRounds() {
  const tabs = $('round-tabs');
  const cup = isCup();
  if (!cup) stageSel = 'all';
  const n = roundsNow();
  if (stageSel !== 'all' && stageSel >= n) stageSel = 'all';
  const sig = JSON.stringify([cup, n, stageSel]);
  if (tabs.dataset.sig === sig) return;
  tabs.dataset.sig = sig;
  const held = tabs.contains(document.activeElement);
  tabs.textContent = '';
  // Quick Play is one round: it stands there alone. A tournament: "All", then each of its rounds.
  for (const value of cup ? ['all', ...Array.from({ length: n }, (_, i) => i)] : ['all']) {
    const item = el('label');
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = 'round';
    inp.checked = stageSel === value;
    inp.disabled = !cup;
    inp.setAttribute('aria-label', !cup ? 'The one round' : value === 'all' ? 'Every round' : `Round ${value + 1}`);
    inp.addEventListener('change', () => pickRound(value));
    item.append(inp, el('span', '', !cup ? '1' : value === 'all' ? 'All' : String(value + 1)));
    tabs.append(item);
  }
  if (held) tabs.querySelector('input:checked')?.focus();
}
function pickRound(value) {
  stageSel = value;
  sfx.play('click');
  syncOptions();
}

// The cards' pictures: one still per art style, and each stage in the chosen
// style. (Painted between frames and cached, like every other picture; until
// one is there its card is a block of grey paper, pulsing.)
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
  paintQueue(jobs, () => run === paintRun && panel === 'lobby');
}

// --- "about": a popup that shows and explains a part of the setup - every
// game, every style, every stage, every item in the lucky boxes.
const ABOUT_MODE = {
  potato: 'One player is the oni. Touch someone and it passes to them. Whoever is the oni when the clock runs out loses; everyone else wins.',
  time: 'The oni changes hands the same way, but every second you spend as the oni is counted. When time is up, the least time wins.',
  team: `${TEAM_NAMES[0]} against ${TEAM_NAMES[1]}. Three flags stand on every stage, one at each end and one high in the middle: stand in a flag's ring to turn it your colour. Bombs are dealt out at the start; stick yours on an enemy by touching them. Every ${Math.round(BEAT_TICKS / TICK_RATE)} seconds each flag gives the side whose colour it is ${plural(FLAG_POINTS, 'point')}, and each bomb takes ${plural(BOMB_COST, 'point')} off the side holding it. At the buzzer every bomb goes off and costs its side ${BOMB_POINTS} more. A score never goes below nothing.`,
};
function aboutRow(icon, name, text) {
  const row = el('div', 'info-row');
  row.innerHTML = `<span class="crest">${svg(icon)}</span>`;
  const words = el('div', 'words');
  words.append(el('b', '', name), el('p', '', text));
  row.append(words);
  return row;
}
function aboutPic(name, text, dataset) {
  const fig = el('figure', 'info-pic');
  const img = el('img');
  img.alt = '';
  Object.assign(img.dataset, dataset);
  const cap = el('figcaption');
  cap.append(el('b', '', name), el('span', '', text));
  fig.append(img, cap);
  return fig;
}
const ABOUT = {
  game: () => ['The games', MODES.map((m) => aboutRow(MODE_ICON[m.id], m.name, ABOUT_MODE[m.id]))],
  cup: () => ['Tournaments', [
    aboutRow('oni', 'Knockout', 'Hot Potato, round after round. Whoever is the oni at the buzzer is out and watches the rest; the others play on, on smaller stages as the field thins, until one is left standing.'),
    aboutRow('bomb', 'Team Bomb', `${TEAM_NAMES[0]} against ${TEAM_NAMES[1]} over three, five or seven rounds, the sides staying as they are. The host chooses how it is decided. Rounds won: whoever wins a round gets a point (a drawn round: nobody does), and the last round is worth two. Total points: everything the sides score is added up, the last round double. Level at the end? A tie-break round is played, until one side is ahead.`),
    aboutRow('storm', 'Twists', 'Every second round has one: Moon Gravity, Turbo or Item Frenzy.'),
  ]],
  style: () => ['Styles', [el('p', 'info-lead', 'A style changes how everything looks, never how it plays.'), el('div', 'info-grid')], (grid) => THEMES.forEach((t) => grid.append(aboutPic(t.name, t.blurb, { still: t.id })))],
  stage: () => ['Stages', [el('p', 'info-lead', 'Each stage is built for a crowd of a certain size: the small ones shut when the room is too big for them.'), el('div', 'info-grid')], (grid) => ARENAS.forEach((a) => grid.append(aboutPic(a.name, `${rangeText(a.id)} players. ${a.blurb}`, { arena: a.id, theme: paintIn(stageValue('theme')), w: 240 })))],
  boxes: () => ['Lucky boxes', [el('p', 'info-lead', 'Boxes drop into the arena every few seconds. Touch one with empty hands, wait for the draw, then set your item off when it hurts most.'), el('div', 'info-items')], (list) => ITEM_KINDS.forEach((k) => list.append(aboutRow(k, ITEM_INFO[k].name, ITEM_INFO[k].blurb)))],
};
function openInfo(topic) {
  if (!ABOUT[topic]) return;
  const [name, nodes, fill] = ABOUT[topic]();
  const body = $('info-body');
  body.textContent = '';
  body.append(...nodes.filter(Boolean));
  if (fill) fill(body.lastElementChild);
  $('info-h').textContent = name;
  sfx.play('click');
  openPopup('info');
  // its pictures, one at a time between frames
  const jobs = [];
  for (const img of body.querySelectorAll('img')) {
    const { still, arena, theme } = img.dataset;
    if (still) jobs.push([still, () => (img.src = styleStill(still))]);
    else jobs.push([theme, () => (img.src = scenePreview(arena, theme, 240, 135))]);
  }
  paintQueue(jobs, () => popupOpen('info'));
}
$('s-lobby').addEventListener('click', (e) => {
  const b = e.target.closest('.info');
  if (b) openInfo(b.dataset.info);
});

// (the fonts arrived, or the window changed: everything painted so far is stale)
function repaintPictures() {
  painted.clear();
  for (const img of $('s-lobby').querySelectorAll('.card img')) for (const k of ['in', 'done']) delete img.dataset[k];
  for (const f of $('s-lobby').querySelectorAll('.face')) delete f.dataset.in;
  if (panel === 'lobby') syncOptions();
}

// (how tall the bar with Start is, for the layouts that pin it to the foot of the screen)
const measureBar = () => document.body.style.setProperty('--bar', `${document.querySelector('.rm-go').offsetHeight}px`);

function openLobby() {
  show('home', 'lobby');
  buildOptions();
  renderLobby();
  focusFirst();
}

// --- who plays. One list, a row a seat: a person, a bot, or nobody yet. A
// row is the player's character as it will look in the room's style (a
// square of their colour until it has been painted), their name, what they
// are here - and, at its end, what can be done about it: cross to the other
// side (yourself; the host, anyone), take a bot out or send a person out
// (the host). An open seat offers a bot, or the invite link.
const act = (cls, icon, label, title, run) => {
  const b = el('button', `act ${cls}`);
  b.type = 'button';
  b.dataset.act = cls.split(' ')[0];
  b.innerHTML = svg(icon);
  b.setAttribute('aria-label', label);
  b.title = title;
  b.addEventListener('click', run);
  return b;
};
function seat(p, opts = {}) {
  const li = el('li', `rm-seat${p.you ? ' me' : ''}${p.bot ? ' bot' : ''}`);
  li.dataset.group = '';
  const f = el('i', 'face');
  f.dataset.ci = p.ci;
  f.style.setProperty('--c', INK_COLORS[p.ci]);
  li.append(f, el('span', 'nm', p.name));
  const tags = [p.you && 'You', p.host && 'Host', p.bot && 'Bot'].filter(Boolean);
  for (const t of tags) li.append(el('small', `badge ${t.toLowerCase()}`, t));
  if (p.score) li.append(el('small', 'score', p.score));
  const acts = el('span', 'acts');
  if (opts.cross != null) {
    const to = TEAM_NAMES[opts.cross];
    const b = act(opts.cross ? 'cross' : 'cross up', 'down', `Move ${p.you ? 'yourself' : p.name} to ${to}`, p.you ? 'Change sides (X)' : `Move ${p.name} to ${to}`, () => moveSide(p.id, opts.cross));
    b.dataset.id = p.id;
    acts.append(b);
  }
  if (opts.out) {
    const b = act('out', 'close', p.bot ? `Take the bot ${p.name} out` : `Send ${p.name} out of the room`, p.bot ? 'Take this bot out' : 'Send out of the room', () => sendOut(p));
    b.dataset.id = p.id;
    acts.append(b);
  }
  if (acts.childElementCount) li.append(acts);
  if (p.you) li.setAttribute('aria-label', `${p.name} (you)${p.host ? ', host' : ''}`);
  return li;
}
// A seat nobody has: the host can put a bot in it, anyone can pass the invite on.
function openSeat(first) {
  const li = el('li', 'rm-seat free');
  li.dataset.group = '';
  const f = el('i', 'face none');
  f.setAttribute('aria-hidden', 'true');
  li.append(f, el('span', 'nm', 'Open seat'));
  const acts = el('span', 'acts');
  const mini = (cls, text, title, run) => {
    const b = el('button', `mini ${cls}`, text);
    b.type = 'button';
    b.dataset.act = cls;
    b.title = title;
    b.addEventListener('click', run);
    return b;
  };
  if (first) acts.append(mini('invite', 'Invite', 'Copy the invite link', copyInvite));
  if (amHost()) acts.append(mini('add', '+ Bot', 'Put a bot in this seat', () => (sfx.play('click'), socket.emit('bot', { add: true }))));
  if (acts.childElementCount) li.append(acts);
  return li;
}
// (the host) a bot out of its seat, at once; a person out of the room, asked about first
async function sendOut(p) {
  if (!amHost() || p.id === socket.id) return;
  if (p.bot) {
    sfx.play('click');
    socket.emit('bot', { remove: p.id });
  } else if (await ask({ title: `Send ${p.name} out?`, yes: 'Send out', no: 'Keep' })) socket.emit('kick', p.id);
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
  const s = room.settings;
  const host = amHost();
  $('btn-leave').setAttribute('aria-label', 'Leave the room');
  const sided = s.mode === 'team';
  const list = $('players');
  $('btn-shuffle').hidden = !(sided && host);
  if (list.dataset.sided !== String(sided)) {
    // (not the first time it is shown; and with less motion, a fade only)
    if (list.dataset.sided) list.animate(calm.matches ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    list.dataset.sided = String(sided);
  }
  // how many seats (everyone sees the number; the host changes it)
  const here = people().length;
  const bots = room.players.length - here;
  const open = Math.max(0, s.size - room.players.length);
  $('size-num').textContent = s.size;
  $('size-step').setAttribute('aria-label', `${s.size} seats`);
  for (const [id, off] of [['btn-size-down', s.size <= Math.max(MIN_PLAYERS, here)], ['btn-size-up', s.size >= MAX_PLAYERS]]) {
    $(id).hidden = !host;
    $(id).disabled = off;
  }
  // one button for all the bots at once: one in every open seat, or - when no seat is open - every bot out
  const all = $('btn-bots');
  const fill = open > 0 || !bots;
  all.hidden = !host;
  all.disabled = fill && !open;
  all.dataset.does = fill ? 'fill' : 'clear';
  $('bots-label').textContent = fill ? 'Fill' : 'Clear';
  const what = fill ? 'Put a bot in every open seat' : 'Take every bot out';
  all.title = `${what} (B)`;
  all.setAttribute('aria-label', `${what} (B)`);

  renderSeats(sided);
  for (const f of $('s-lobby').querySelectorAll('.face[data-ci]')) faceNow(f);

  const start = $('btn-start');
  $('lobby-code').textContent = room.code;
  const boss = room.players.find((p) => p.id === room.hostId);
  const enough = room.players.length >= MIN_PLAYERS;
  start.hidden = !host;
  start.disabled = !enough;
  setLabel(start, s.game === 'cup' ? 'Start tournament' : 'Start match', 'Enter');
  $('lobby-note').textContent = enough ? '' : 'Minimum 2 players';
  $('start-note').textContent = host ? '' : `Waiting for ${boss ? boss.name : 'the host'} to start…`;
  const cup = isCup();
  setLegend(
    $('lobby-legend'),
    locked()
      ? [[['Esc'], 'leave the room'], [['C'], 'copy the invite link'], ...(sided ? [[['X'], 'change sides']] : [])]
      : [[['↑', '↓'], 'move'], [['←', '→'], 'choose'], [['−', '+'], 'seats'], ...(cup ? [[['T'], 'round']] : []), ...(sided ? [[['X'], 'change sides']] : []), [['Enter'], 'start'], [['Esc'], 'leave']],
  );
  // Where the keyboard starts: the start button. (A guest gets no starting
  // point: Enter must not walk them out.)
  const first = start.hidden ? null : start.disabled ? $('btn-copy') : start;
  for (const b of [start, $('btn-copy')]) b.toggleAttribute('data-autofocus', b === first);
  measureBar();
  // someone joined and the match can start: Enter should start it, not copy the link again
  if (first === start && panel === 'lobby' && !overlay && [$('btn-copy'), document.body].includes(document.activeElement)) focusFirst();
  syncDoor();
  syncOptions();
}

// The seats: the people (in the order they came), then the bots, then the
// seats still open. In a team game the same rows stand under their side's
// name - one side, then the other - in the colours they will wear; the sides are the
// room's and stay as they are from match to match until someone crosses over
// (their own arrow, or X), the host moves somebody, or shuffles (Z).
function renderSeats(sided) {
  const s = room.settings;
  const host = amHost();
  const mine = me();
  const list = $('players');
  const at = list.contains(document.activeElement) ? document.activeElement : null;
  const held = at ? [at.dataset.act, at.dataset.id || ''] : null;
  list.textContent = '';
  list.classList.toggle('sided', sided);
  const order = (a, b) => !!a.bot - !!b.bot || a.slot - b.slot;
  const row = (p, ci) =>
    seat(
      { id: p.id, ci, name: p.name, host: p.id === room.hostId, you: p.id === socket.id, bot: p.bot, score: p.wins && !p.bot ? `${p.wins} win${p.wins > 1 ? 's' : ''}` : '' },
      { cross: sided && (p.id === socket.id || host) ? 1 - p.side : null, out: host && p.id !== socket.id },
    );
  if (sided) {
    // (colours are handed out in the order of the list, people first and bots last - the same way the server does it)
    const seen = [0, 0];
    const colour = (t) => TEAM_SLOTS[t][seen[t]++ % TEAM_SLOTS[t].length];
    const cis = new Map(room.players.map((p) => [p.id, colour(p.side)]));
    for (const t of [0, 1]) {
      const team = room.players.filter((p) => p.side === t).sort(order);
      const head = el('li', 'rm-team');
      head.style.setProperty('--side', TEAM_COLORS[t]);
      head.append(el('b', '', TEAM_NAMES[t]), el('span', 'n', String(team.length)));
      if (mine && mine.side === t) head.append(el('em', '', 'Your side'));
      list.append(head);
      for (const p of team) list.append(row(p, cis.get(p.id)));
      if (!team.length) list.append(el('li', 'rm-seat none', 'Nobody yet'));
    }
  } else for (const p of room.players.slice().sort(order)) list.append(row(p, p.slot));
  for (let k = room.players.length; k < s.size; k++) list.append(openSeat(k === room.players.length));
  // (the list was rebuilt under the keyboard: back to the same button of the same row - or, if that row is gone, the next one like it)
  if (held) {
    const same = [...list.querySelectorAll('button')].filter((b) => b.dataset.act === held[0]);
    (same.find((b) => (b.dataset.id || '') === held[1]) || same[0] || list.querySelector('button') || $('btn-start')).focus();
  }
}
function moveSide(id, to) {
  if (!room || room.settings.mode !== 'team') return false;
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
  if (!amHost() || room.settings.mode !== 'team') return false;
  socket.emit('shuffle');
  sfx.play('click');
  return true;
}
$('btn-shuffle').addEventListener('click', shuffleSides);

function leaveRoom() {
  if (room) socket.emit('leave');
  rig = false;
  play.stop();
  toHome('', $('btn-create'));
}
// Leaving a room cannot be taken back (it may close, or pass to someone
// else), so it is asked about first: what will happen, Stay or Leave room.
function sureToLeave() {
  if (!room) return Promise.resolve(true);
  const playing = screen === 'game' && overlay !== 'results';
  return ask({ title: playing ? 'Leave the match?' : 'Leave the room?', yes: 'Leave' });
}
const leaveIfSure = async () => (await sureToLeave()) && leaveRoom();
$('btn-leave').addEventListener('click', leaveIfSure);
$('btn-start').addEventListener('click', () => {
  sfx.play('click');
  socket.emit('start');
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
  $('pause-note').textContent = rig ? '' : 'The match carries on without you.';
  $('btn-pause-full').hidden = !canFullscreen;
  play.hold(true); // (an online match carries on behind the menu)
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

// A round is over: first the moment itself (the word for it, who won, what comes next -
// see present.js), then the card with everyone's numbers. Anything that happens
// meanwhile (the next round, leaving) cuts the moment short and the card is not shown.
function endOfRound(res) {
  clearInterval(nextTimer);
  draw.clear();
  const t0 = performance.now();
  present.outcome(res, { me: play.mySlot() }).then((ok) => {
    if (!ok || screen !== 'game') return;
    if (res.cup?.next) res.cup.next = Math.max(0, res.cup.next - (performance.now() - t0));
    showResults(res);
  });
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
  // The headline is about YOU, in two words: You win, You lose (or, between
  // the rounds of a tournament, whether you lead). Who it was that won, and by
  // what, is the line under it. Someone only watching reads who won instead.
  const watching = !res.rows.some((r) => r.slot === mySlot);
  // (in a knockout, someone who is out is still on its table: by the place they have in the room)
  const seat = cup?.ko ? me()?.slot ?? mySlot : mySlot;
  let kicker;
  let title;
  let sub = '';
  let mood = ''; // win | lose | level: how the headline is dressed ('' between rounds)
  const verdict = (won, level = false) => {
    mood = level ? 'level' : won ? 'win' : 'lose';
    return level ? 'A draw!' : won ? 'You win!' : 'You lose';
  };
  if (team) {
    // team battle: this round's score, or the running total of a tournament
    const mine = res.rows.find((r) => r.slot === mySlot)?.team ?? -1;
    const final = !cup || cup.final;
    const tally = cup && team.total ? team.total : team.score;
    const lead = final ? team.win : tally[0] === tally[1] ? -1 : tally[0] > tally[1] ? 0 : 1;
    if (cup && !cup.final) {
      kicker = cup.tie ? `Level after ${cup.round} rounds · Team Bomb` : `Round ${cup.round} of ${cup.rounds} · Team Bomb`;
      const vs = (x, y) => `${x}–${y}`;
      title = lead < 0 ? `Level at ${tally[0]} all` : watching ? `${TEAM_NAMES[lead]} lead ${vs(tally[lead], tally[1 - lead])}` : lead === mine ? `You lead ${vs(tally[lead], tally[1 - lead])}` : `You trail ${vs(tally[1 - lead], tally[lead])}`;
      // (counted in rounds won: say who took this one)
      const took = cup.score !== 'rounds' ? '' : team.win < 0 ? 'A drawn round: no point for anyone.' : `${TEAM_NAMES[team.win]} take the round, ${team.score[team.win]}–${team.score[1 - team.win]}.`;
      sub = `${took}${cup.tie ? ' A tie-break round decides it.' : ''}`.trim();
    } else {
      kicker = cup ? 'Tournament over · Team Bomb' : forfeit ? 'Match over' : 'Team Bomb';
      title = watching && lead >= 0 ? `${TEAM_NAMES[lead]} win!` : verdict(lead === mine, lead < 0);
      sub = forfeit ? 'Everyone else left.' : '';
    }
  } else if (cup) {
    // a knockout: who went out this round - and, at the end, who is left standing
    const left = cup.table.filter((r) => !r.out).length;
    const place = cup.table.findIndex((r) => r.slot === seat); // (the table comes best first; -1: never in it)
    const gone = cup.caught >= 0 ? nameOf(cup.caught) : '';
    kicker = cup.final ? 'Knockout · the final' : `Knockout · round ${cup.round} of ${cup.rounds}`;
    if (cup.final) {
      const champ = `${list(winners)} win${winners.length > 1 ? '' : 's'} the knockout`;
      title = watching ? `${list(winners)} win${winners.length > 1 ? '' : 's'}!` : verdict(iWon);
      sub = forfeit ? 'Everyone else left.' : iWon ? 'The last one standing.' : `${champ}.${place > 0 ? ` You came ${ordinal(place + 1)} of ${cup.table.length}.` : ''}`;
    } else if (cup.caught === mySlot) {
      mood = 'lose';
      title = 'You are out';
      sub = `The oni at the buzzer. ${left} play on.`;
    } else {
      title = watching ? `${gone} is out` : 'You are through';
      sub = watching ? `${left} left.` : `${gone} is out. ${left} left.`;
    }
  } else if (forfeit) {
    kicker = 'Match over';
    title = watching ? `${list(winners)} wins!` : verdict(iWon);
    sub = 'Everyone else left.';
  } else if (res.mode === 'potato') {
    kicker = 'Hot Potato';
    title = watching ? `${nameOf(res.loser)} loses!` : verdict(res.loser !== mySlot);
    sub = `${res.loser === mySlot ? 'You were' : `${nameOf(res.loser)} was`} the oni when the clock ran out.`;
  } else {
    kicker = 'Least Time';
    title = watching ? `${list(winners)} win${winners.length > 1 ? '' : 's'}!` : verdict(iWon);
    sub = iWon ? (winners.length > 1 ? 'A shared win.' : 'Least time as the oni.') : `${list(winners)} win${winners.length > 1 ? '' : 's'}.`;
  }
  // (a finished match needs no sentence under its verdict: the winners and the board say the rest)
  if (!(cup && !cup.final) && !forfeit) sub = '';
  $('res-kicker').textContent = kicker;
  $('res-title').textContent = title;
  $('res-sub').textContent = sub;
  // the seal says it in one sign: won, lost, level - or, between rounds, which round that was
  const between = !!cup && !cup.final;
  const level = team ? (cup && team.total ? team.total[0] === team.total[1] : team.win < 0) : false;
  const seal = $('res-seal');
  seal.textContent = between ? String(cup.round) : level ? '分' : iWon ? '勝' : '負';
  seal.className = `seal big${between || level ? ' dark' : iWon ? '' : ' dark'}`;
  const box = $('s-results');
  box.classList.toggle('won', !between && iWon && !level);
  box.dataset.mood = mood;
  box.classList.toggle('teams', !!team);
  box.classList.toggle('crowd', res.rows.length > 6); // seven or more: a tighter board
  // a podium for the first three, where there is a ranking to speak of: a
  // finished tournament, or a match scored on time as the oni
  const ranked = !team && !forfeit && (cup ? cup.final : res.mode !== 'potato');
  $('res-podium').hidden = !ranked;
  if (ranked) paintPodium(res, seat);
  // The hero of the screen: your own character (whoever won, for someone
  // watching) under the seal - unless the podium is up, which is that already.
  const star = watching ? res.winners[0] ?? res.rows[0]?.slot : mySlot;
  const medal = $('res-medal');
  medal.hidden = ranked || star == null;
  if (!medal.hidden) {
    const f = $('res-face');
    f.style.setProperty('--c', play.colorOf(star));
    const url = portraitOf(star, 144);
    f.textContent = '';
    if (url) {
      const img = el('img');
      img.alt = '';
      img.src = url;
      f.append(img);
    }
  }
  // Everyone who won, at the top of the card, side by side and dancing, each with what
  // they did: the winning team, or all who got away in a Hot Potato. They take the place
  // of your own picture. (Not between rounds, not for a draw; the podium has its own three.)
  const troupe = $('res-troupe');
  const dancers = between || level || ranked ? [] : res.winners.filter((slot) => res.rows.some((r) => r.slot === slot));
  troupe.hidden = dancers.length < 2;
  troupe.textContent = '';
  box.classList.toggle('has-troupe', !troupe.hidden);
  if (!troupe.hidden) {
    medal.hidden = true;
    const side = team && team.win >= 0 ? team.win : -1;
    troupe.style.setProperty('--side', side >= 0 ? TEAM_COLORS[side] : 'var(--gold)');
    troupe.classList.toggle('mine', dancers.includes(mySlot));
    const who = el('b', 'who');
    who.innerHTML = `${svg('star')}<span></span>`;
    who.lastChild.textContent = side >= 0 ? `${TEAM_NAMES[side]} win${cup ? ' the tournament' : ''}` : 'They got away';
    troupe.append(el('span', 'glow'), who);
    const line = el('div', 'line');
    const best = (k) => Math.max(...dancers.map((slot) => res.rows.find((r) => r.slot === slot)[k] || 0));
    dancers.forEach((slot, i) => {
      const r = res.rows.find((x) => x.slot === slot);
      const d = el('span', slot === mySlot ? 'dancer me' : 'dancer');
      d.style.setProperty('--i', String(i));
      d.style.setProperty('--c', play.colorOf(slot));
      const url = portraitOf(slot, 144);
      const pic = el('i', 'pic');
      if (url) {
        const img = el('img');
        img.alt = '';
        img.src = url;
        pic.append(img);
      }
      // their numbers: flags taken and bombs passed on (a team game), or tags made and time as the oni
      const stats = el('span', 'stats');
      const stat = (icon, text, label, top) => {
        const s = el('span', top ? 'st top' : 'st');
        s.innerHTML = svg(icon);
        s.append(text);
        s.title = label;
        stats.append(s);
      };
      if (team) {
        stat('flag', String(r.caps || 0), `${plural(r.caps || 0, 'flag')} taken`, r.caps > 0 && r.caps === best('caps'));
        stat('swap', String(r.tags), `${plural(r.tags, 'bomb')} passed on`, r.tags > 0 && r.tags === best('tags'));
      } else {
        stat('target', String(r.tags), `${plural(r.tags, 'tag')} made`, r.tags > 0 && r.tags === best('tags'));
        stat('oni', secs(r.ms), 'as the oni', false);
      }
      d.append(pic, el('small', '', play.nameOf(slot)), stats);
      line.append(d);
    });
    troupe.append(line);
  }
  $('res-praise').textContent = '';
  paintFeats(res, mySlot);
  // everyone's numbers, on the same card
  $('res-teams').hidden = !team;
  $('res-table').hidden = !!team;
  if (team) paintSides(res, mySlot);
  else paintBoard(res, seat, ranked);

  renderResultButtons();
  setOverlay('results');
  celebrate(mood);
  // a tournament between rounds: the next one starts by itself - a tag at the foot of the card counts it down
  $('res-next').hidden = !between;
  if (between) {
    const until = performance.now() + cup.next;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - performance.now()) / 1000));
      if (lastResults === res) $('res-next-n').textContent = left;
    };
    tick();
    nextTimer = setInterval(tick, 250);
  }
  if (!res.presented) sfx.play(iWon || (cup && !cup.final && res.loser !== mySlot) ? 'win' : 'lose');
}

// What you did, in a few small numbers that count up (gold, with a star,
// where nobody did better).
const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
let featRun = 0;
function paintFeats(res, mySlot) {
  const box = $('res-feats');
  const run = ++featRun;
  box.textContent = '';
  const rows = res.rows;
  const mine = rows.find((r) => r.slot === mySlot);
  if (!mine) return;
  const cup = res.cup;
  const least = (k) => Math.min(...rows.map((r) => r[k] || 0));
  const most = (k) => Math.max(...rows.map((r) => r[k] || 0));
  const whole = (v) => String(Math.round(v));
  const feats = []; // [icon, value, how to write it, what it is, nobody did better]
  if (res.team) {
    feats.push(['bomb', mine.ms, secs, 'with a bomb', rows.length > 2 && mine.ms === least('ms')]);
    feats.push(['swap', mine.tags, whole, mine.tags === 1 ? 'pass' : 'passes', mine.tags > 0 && mine.tags === most('tags')]);
    feats.push(['flag', mine.caps || 0, whole, mine.caps === 1 ? 'flag' : 'flags', mine.caps > 0 && mine.caps === most('caps')]);
  } else {
    feats.push(['oni', mine.ms, secs, 'as the oni', rows.length > 2 && mine.ms === least('ms')]);
    feats.push(['target', mine.tags, whole, mine.tags === 1 ? 'tag' : 'tags', mine.tags > 0 && mine.tags === most('tags')]);
    const table = cup ? cup.table : res.mode !== 'potato' && res.reason !== 'forfeit' ? rows : null; // (both come best first)
    const place = table ? table.findIndex((r) => r.slot === mySlot) : -1;
    // (while a knockout is on, and you are in it, what counts is how many are left)
    if (cup && !cup.final && place >= 0 && !table[place].out) feats.push(['crowd', table.filter((r) => !r.out).length, whole, 'still in', false]);
    else if (place >= 0) feats.push(['star', place + 1, ordinal, `of ${table.length}`, place === 0]);
  }
  const counting = [];
  feats.forEach(([icon, value, write, label, best], i) => {
    const li = el('li', best ? 'feat best' : 'feat');
    li.style.setProperty('--i', i);
    li.innerHTML = svg(icon);
    const num = el('b', '', write(calm.matches ? value : 0));
    li.append(num, el('span', '', label));
    if (best) {
      li.insertAdjacentHTML('beforeend', `<em>${svg('star')}</em>`);
      li.title = 'Nobody did better';
    }
    box.append(li);
    if (!calm.matches && value) counting.push([num, value, write, i]);
  });
  // the numbers run up to what they are, one after the other
  if (!counting.length) return;
  const t0 = performance.now() + 380;
  const step = (now) => {
    if (run !== featRun) return;
    let going = false;
    for (const [num, value, write, i] of counting) {
      const k = Math.min(1, Math.max(0, (now - t0 - i * 130) / 620));
      num.textContent = write(value * (1 - (1 - k) ** 3));
      if (k < 1) going = true;
    }
    if (going) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// The moment the result lands: for a win, petals burst from behind your
// character, twice; for a loss, the scroll takes the blow. (Only where motion
// is welcome; either way the headline and the seal already say it.)
function celebrate(mood) {
  const head = document.querySelector('#s-results .verdict');
  const stage = head.querySelector('.stage');
  for (const old of head.querySelectorAll('.res-fx')) old.remove();
  for (const a of head.getAnimations()) a.cancel();
  if (calm.matches || !mood) return;
  if (mood === 'lose') {
    head.animate([{ transform: 'translateY(-14px)', opacity: 0 }, { transform: 'translateY(5px)', opacity: 1, offset: 0.55 }, { transform: 'translateY(-2px)', offset: 0.78 }, { transform: 'none' }], { duration: 460, easing: 'ease-out' });
    return;
  }
  const burst = (many, wait, reach) => {
    const fx = el('span', 'res-fx');
    fx.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < many; i++) {
      const p = el('i');
      const a = -Math.PI * (0.04 + 0.92 * Math.random()); // up and out, in a fan
      const far = reach * (0.45 + Math.random() * 0.75);
      p.style.setProperty('--dx', `${Math.round(Math.cos(a) * far)}px`);
      p.style.setProperty('--dy', `${Math.round(Math.sin(a) * far * 0.8)}px`);
      p.style.setProperty('--turn', `${Math.round(Math.random() * 540 - 270)}deg`);
      p.style.setProperty('--wait', `${wait + Math.round(Math.random() * 160)}ms`);
      p.style.setProperty('--size', `${7 + Math.round(Math.random() * 7)}px`);
      if (i % 4 === 0) p.className = 'gold';
      fx.append(p);
    }
    stage.append(fx);
    setTimeout(() => fx.remove(), wait + 2300);
  };
  burst(mood === 'win' ? 30 : 10, 0, 230);
  if (mood === 'win') burst(18, 620, 300);
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
function portraitOf(slot, size) {
  if (size && typeof size === 'object') {
    // ({ size, face }: as art.js takes them)
    try {
      const cols = play.info?.cols;
      const theme = art.styleReady(play.info?.theme) ? play.info.theme : play.renderer.theme?.id;
      return theme ? art.playerPortrait(theme, cols ? cols[slot] ?? slot : slot, size) || '' : '';
    } catch {
      return '';
    }
  }
  try {
    const cols = play.info?.cols;
    const theme = art.styleReady(play.info?.theme) ? play.info.theme : play.renderer.theme?.id;
    return theme && typeof art.playerPortrait === 'function' ? art.playerPortrait(theme, cols ? cols[slot] ?? slot : slot, size ? { size } : undefined) || '' : '';
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
    step.append(face(r.slot, 'lg'), el('b', r.name.length > 9 ? 'nm long' : 'nm', r.name)); // (a long name a size down, so it is whole)
    step.append(el('span', 'stat', cup?.ko ? (r.out ? `Out in round ${r.out}` : 'Winner') : cup ? `${r.pts} pts` : r.row ? secs(r.row.ms) : ''));
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
  const ko = !!cup?.ko;
  board.className = `board${ko ? ' ko' : cup ? ' cup' : ''}`;
  const rows = ranking(res);
  const most = Math.max(1, ...rows.map((r) => (r.row ? r.row.ms : 0)));
  const head = el('li', 'hd');
  head.append(el('span', '', ''), el('span', '', 'Player'), el('span', '', 'As oni'), ...(ko ? [el('span', '', '')] : cup ? [el('span', '', 'Round'), el('span', '', 'Total')] : [el('span', '', 'Tags')]));
  board.append(head);
  rows.forEach((r, i) => {
    const li = el('li', `${r.slot === mySlot ? 'me' : ''}${ko && r.out ? ' gone' : ''}`);
    const final = !cup || cup.final;
    const who = el('span', 'who');
    who.append(face(r.slot), r.name);
    if (r.bot || r.row?.bot) who.append(el('span', 'badge bot', 'Bot'));
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
    } else time.append(el('span', 'track none'), el('b', '', ko ? secs(r.ms) : '-'));
    li.append(el('span', 'rank', String(i + 1)), who, time);
    if (ko) li.append(el('span', r.out ? 'state out' : 'state', r.out ? `Out · round ${r.out}` : 'In'));
    else if (cup) li.append(el('span', 'gain', r.row ? `+${r.gained}` : '-'), el('span', 'pts', `${r.pts}`));
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
    // (a tournament: what this round added - its points, or the round itself)
    if (cup && total) head.append(el('small', '', cup.score === 'rounds' ? `${score[t]} this round${score[t] > score[1 - t] ? ` · +${cup.double ? 2 : 1}` : ''}` : `+${score[t] * (cup.double ? 2 : 1)} this round${cup.double ? ' (double)' : ''}`));
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
      const who = el('span', r.name.length > 9 ? 'who long' : 'who'); // (a long name a size down, so it and its marks are whole)
      who.append(face(r.slot), r.name);
      if (r.bot) who.append(el('span', 'badge bot', 'Bot'));
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
  if (rig) {
    setLabel(back, 'Back', 'Esc');
    again.hidden = true;
    $('res-note').textContent = '';
  } else {
    const host = amHost();
    setLabel(back, host ? (between ? 'End tournament' : 'Back to the room') : 'Leave room', 'Esc');
    again.hidden = !host || between;
    setLabel(again, res.cup ? 'New tournament' : 'Play again', 'Enter');
    again.disabled = !room || room.players.length < MIN_PLAYERS;
    const h = room?.players.find((p) => p.id === room.hostId);
    // (between rounds the tag beside it counts down to the next one: nothing to add)
    $('res-note').textContent = between ? '' : host ? (again.disabled ? 'Waiting for another player…' : '') : `Waiting for ${h ? h.name : 'the host'}…`;
  }
  again.toggleAttribute('data-autofocus', !again.hidden);
  back.toggleAttribute('data-autofocus', again.hidden);
}

$('btn-res-again').addEventListener('click', () => {
  sfx.play('click');
  socket.emit('start');
});
function resultsBack() {
  clearInterval(nextTimer);
  if (rig) leaveRoom();
  else if (amHost()) socket.emit('lobby');
  else leaveRoom();
}
// straight back when it only changes screens; asked about first when it would end a tournament or leave the room
async function backFromResults() {
  const safe = rig || (amHost() && !(lastResults?.cup && !lastResults.cup.final));
  const sure = safe || (amHost() ? await ask({ title: 'End the tournament?', yes: 'End it', no: 'Keep playing' }) : await sureToLeave());
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
  } else echoed = null; // (this one is the server's word as it stands: nothing older may be put back over it)
  room = r;
  net.code = r.code;
  if (r.phase === 'lobby') {
    clearInterval(nextTimer);
    if (panel === 'help') renderLobby(); // reading How to play in a room: leave them to it
    else if (!inRoom()) openLobby();
    else {
      renderLobby();
    }
  } else if (overlay === 'results') renderResultButtons();
});

// The host sent us out of the room.
socket.on('kicked', () => {
  if (!room) return;
  room = null;
  rig = false;
  play.stop();
  toHome('The host sent you out of the room.', $('btn-create'));
});

socket.on('round', (msg) => {
  if (!room) return;
  clearInterval(nextTimer);
  present.clear();
  const mine = me();
  // (a bot filling in may hold the same place as someone who arrived after the round began: they are only watching)
  const mySlot = mine && msg.players.some((p) => p.slot === mine.slot && !p.bot) ? mine.slot : -1;
  net.code = room.code;
  rig = false;
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
  endOfRound(res);
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
  else if (panel === 'lobby') {
    if (code) setCode(''); // (a code half typed for another room: Esc takes that back first)
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
  if (at === 'home') {
    // the title scroll: digits are a room's code; a letter for each of the other ways in
    if (/^\d$/.test(key)) return typeCode(code + key), true;
    if (key === 'backspace') return typeCode(code.slice(0, -1)), true;
    if (key === 'c') return $('btn-create').click(), true;
    if (key === 'p') return openFind(), true;
    if (key === 'n') return $('btn-profile').click(), true;
    // Enter on the code (or anywhere but a button, once the code is complete) tries it again
    if (key === 'enter' && (document.activeElement === $('digits') || (code.length === CODE_LEN && !onButton))) return retryCode(), true;
  } else if (at === 'lobby') {
    // The title scroll is still there beside the room, and so is its code: digits go into
    // it from anywhere in the room (the fourth asks before it takes you to the other room).
    if (/^\d$/.test(key)) return typeCode(code + key), true;
    if (code) {
      if (key === 'backspace') return typeCode(code.slice(0, -1)), true;
      if (key === 'enter' && document.activeElement === $('digits')) return retryCode(), true;
    }
    // Enter starts the match from anywhere but a button (a button does what it says)
    if (key === 'enter' && !onButton) {
      if (!$('btn-start').hidden && !$('btn-start').disabled) $('btn-start').click();
      return true;
    }
    if (key === 'c') return copyInvite(), true;
    if (key === '-' || key === '_') return setSize(room.settings.size - 1), true;
    if (key === '+' || key === '=') return setSize(room.settings.size + 1), true;
    if (key === 'x' && switchSide()) return true;
    if (key === 'z' && shuffleSides()) return true;
    if (/^[a-z]$/.test(key)) return hotOption(key, e.shiftKey);
  } else if (at === 'find') {
    if (key === 'c') return $('btn-find-host').click(), true;
  } else if (at === 'ask') {
    // the two answers sit side by side
    if (key === 'arrowleft' || key === 'arrowright') return moveFocus(key === 'arrowright' ? 1 : -1), true;
    if (key === 'enter' && e.repeat) return true; // (a key held down from before the question is not an answer to it)
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
  // (the moment after a round: any key moves on to the card)
  if (present.busy === 'outcome') {
    e.preventDefault();
    return present.skip();
  }
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
const start = () => {
  toHome();
  if (invite.length === CODE_LEN) setCode(invite); // an invite link: straight to the room
};
if (myName) start();
else askName(start);

// Handy for debugging from the browser console (and used by the automated checks).
// (for the automated checks: a match against bots in this browser alone, with nothing to set up - not in any menu)
function practiceRig(opts = {}) {
  rig = true;
  play.practice({ mode: 'potato', arena: 'hills', theme: 'ink', duration: 60, powerups: true, bots: 3, ...opts }, myName || 'You');
}
window.__tag = { practice: practiceRig, renderer, net, socket, input, get game() { return play.game; }, play, draw, get demos() { return demos; }, get screen() { return top(); }, get room() { return room; }, fontsReady: () => fontsIn };
