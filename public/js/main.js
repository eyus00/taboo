// You're It! - everything outside the match itself: menus, lobby, heads-up
// display, results. One screen is visible at a time; every screen can be
// driven with the keyboard (arrows + Enter, Esc to go back).

import { MODES, DURATIONS, DEFAULT_DURATION, DEFAULT_THEME, THEMES, CUP_ROUNDS, NAME_MAX, CODE_LEN, MIN_PLAYERS, MAX_PLAYERS } from '/shared/config.js';
import { ARENAS, arenaById } from '/shared/arenas.js';
import { play } from './play.js';
import { scenePreview, styleStill, clearPictures, paintBackdrop, paperTexture } from './art.js';
import { loadTheme } from './themes/index.js';

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
  onStart() {
    kind = play.kind;
    show('game');
  },
  onEnd: (res) => showResults(res),
  onPause: () => openPause(),
});
const { renderer, input, sfx, net } = play;

let myName = cleanName(store.get('tag.name'));
let screen = ''; // name | home | join | lobby | game
let overlay = ''; // '' | results | pause | help
let helpFrom = '';
let kind = 'online'; // what the lobby screen is showing: online | practice
let room = null; // latest room state from the server
let afterName = null;
let lastResults = null;
let nextTimer = 0;

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

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
const SCREENS = ['name', 'home', 'join', 'lobby'];
const OVERLAYS = ['results', 'pause', 'help'];

function show(name) {
  screen = name;
  if (name !== 'game') paintScene();
  for (const s of SCREENS) $(`s-${s}`).hidden = s !== name;
  $('game').hidden = name !== 'game';
  document.body.classList.toggle('in-game', name === 'game');
  setOverlay('');
  if (name !== 'game') play.stop();
}

function setOverlay(name) {
  overlay = name;
  for (const o of OVERLAYS) $(`s-${o}`).hidden = o !== name;
  input.active = screen === 'game' && !name;
  if (!input.active) input.clear();
  focusFirst();
}

const topRoot = () => $(`s-${overlay || screen}`);

function focusFirst() {
  const root = topRoot();
  if (!root) return document.activeElement?.blur();
  const target = root.querySelector('[data-autofocus]:not([hidden]):not(:disabled)');
  // on a phone, focusing a button only leaves a stray outline; text fields still get focus
  if (target && (!isTouch || target.tagName === 'INPUT')) target.focus({ preventScroll: true });
  else document.activeElement?.blur();
}

// Up / down walk through the controls of the current screen.
function moveFocus(dir) {
  const root = topRoot();
  if (!root) return;
  // a group of choices (a row of rules, a grid of cards) counts as one stop; left / right move inside it
  const stops = [...root.querySelectorAll('button, input[type="text"], .seg, .cards')].filter((e) => {
    if (e.closest('.numpad') || e.closest('.locked')) return false;
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

function toHome(message = '') {
  room = null;
  play.game = null;
  $('home-name').textContent = myName;
  $('home-error').textContent = message;
  show('home');
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
$('btn-rename').addEventListener('click', () => askName());

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

function setConn(cls, text) {
  $('conn').className = `conn ${cls}`;
  $('conn').textContent = text;
}
setConn('', 'Connecting...');
socket.on('connect', () => setConn('ok', 'Server online'));
socket.on('connect_error', () => setConn('bad', 'Waking up the server - free hosting naps when idle, give it up to a minute.'));
socket.on('disconnect', () => {
  setConn('bad', 'Reconnecting...');
  if (room) {
    play.stop();
    toHome('Lost the connection to the server.');
  }
});

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
$('btn-create').addEventListener('click', () => enterRoom('create', { name: myName }, $('home-error')));
$('btn-join').addEventListener('click', () => openJoin(''));
$('btn-practice').addEventListener('click', () => {
  kind = 'practice';
  openLobby();
});
$('btn-help').addEventListener('click', () => openHelp());
const soundLabel = () => `Sound: ${sfx.muted ? 'off' : 'on'}`;
function paintSound() {
  $('sound-label').textContent = soundLabel();
  $('pause-sound').textContent = soundLabel();
}
for (const id of ['btn-sound', 'btn-pause-sound']) $(id).addEventListener('click', () => toggleSound(false));
paintSound();

function openHelp() {
  helpFrom = overlay;
  setOverlay('help');
}
function closeHelp() {
  setOverlay(helpFrom);
}
$('btn-help-back').addEventListener('click', closeHelp);

// ---------------------------------------------------------------------------
// Join: four digits, typed on our own number pad (or a real keyboard)
// ---------------------------------------------------------------------------
let code = '';
let codeTried = '';

function openJoin(start) {
  $('join-error').textContent = '';
  codeTried = '';
  show('join');
  setCode(start);
}

function setCode(next) {
  code = String(next).replace(/\D/g, '').slice(0, CODE_LEN);
  const boxes = $('digits').children;
  for (let i = 0; i < CODE_LEN; i++) {
    boxes[i].textContent = code[i] || '';
    boxes[i].classList.toggle('next', i === code.length);
  }
  $('digits').classList.remove('bad');
  $('digits').setAttribute('aria-label', `Room code: ${code.split('').join(' ') || 'empty'}`);
  $('btn-join-go').disabled = code.length !== CODE_LEN;
  if (code.length < CODE_LEN) $('join-error').textContent = '';
  // the fourth digit joins straight away (once per code, so a wrong one can be corrected)
  if (code.length === CODE_LEN && code !== codeTried) submitCode();
}

async function submitCode() {
  if (code.length !== CODE_LEN || busy) return;
  codeTried = code;
  const ok = await enterRoom('join', { code, name: myName }, $('join-error'));
  if (!ok && screen === 'join') {
    $('digits').classList.add('bad');
    sfx.play('lose');
  }
}

$('numpad').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset.d;
  if (d === 'back') setCode(code.slice(0, -1));
  else if (d === 'go') {
    codeTried = '';
    submitCode();
  } else setCode(code + d);
  sfx.play('click');
});
$('btn-join-back').addEventListener('click', () => toHome());
addEventListener('paste', (e) => {
  if (screen !== 'join' || overlay) return;
  const text = e.clipboardData?.getData('text') || '';
  if (/\d/.test(text)) setCode(text);
});

// ---------------------------------------------------------------------------
// Lobby (an online room) / practice setup
// ---------------------------------------------------------------------------
const OPTIONS = [
  { key: 'arena', hot: 'a', type: 'cards', box: 'arena-cards', values: [...ARENAS.map((a) => [a.id, a.name]), ['random', 'Random']] },
  { key: 'theme', hot: 's', type: 'cards', box: 'style-cards', values: [...THEMES.map((t) => [t.id, t.name]), ['random', 'Random']] },
  { key: 'game', hot: 'g', label: 'Game', only: 'online', type: 'seg', values: [['quick', 'Quick match'], ['cup', 'Tournament']] },
  { key: 'mode', hot: 'r', label: 'Rules', type: 'seg', values: MODES.map((m) => [m.id, m.name]), show: (s) => s.game !== 'cup', hint: (s) => MODES.find((m) => m.id === s.mode)?.blurb },
  { key: 'rounds', hot: 'r', label: 'Rounds', only: 'online', type: 'seg', values: CUP_ROUNDS.map((n) => [n, String(n)]), show: (s) => s.game === 'cup', hint: () => 'Points every round. The leader starts as it. The last round counts double.' },
  { key: 'bots', hot: 'b', label: 'Bots', only: 'practice', type: 'seg', values: [1, 2, 3, 4, 5].map((n) => [n, String(n)]) },
  { key: 'duration', hot: 'l', label: 'Round length', type: 'seg', values: DURATIONS.map((d) => [d, `${d} s`]) },
  { key: 'powerups', hot: 'p', label: 'Power-ups', type: 'seg', values: [[true, 'On'], [false, 'Off']] },
];
const settings = () => (kind === 'practice' ? practice : room.settings);
const locked = () => kind === 'online' && !amHost();

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
function radio(o, value) {
  const inp = document.createElement('input');
  inp.type = 'radio';
  inp.name = `opt-${o.key}`;
  inp.value = String(value);
  inp.addEventListener('change', () => changeSetting({ [o.key]: value }));
  return inp;
}

function buildOptions() {
  const box = $('options');
  box.textContent = '';
  for (const o of OPTIONS) {
    if (o.only && o.only !== kind) continue;
    if (o.type === 'cards') {
      // picture cards: one per arena / art style, painted a moment later
      const grid = $(o.box);
      grid.textContent = '';
      for (const [value, text] of o.values) {
        const card = el('label', 'card');
        let pic;
        if (value === 'random') pic = el('span', 'pic any', '?');
        else {
          pic = el('img', 'pic');
          pic.alt = '';
          pic.dataset.id = value;
        }
        card.append(radio(o, value), pic, el('span', 'cap', text));
        grid.append(card);
      }
      continue;
    }
    const row = el('div', 'opt');
    row.dataset.key = o.key;
    const lab = el('span', 'lab', o.label);
    lab.append(el('kbd', '', o.hot.toUpperCase()));
    row.append(lab);
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', o.label);
    for (const [value, text] of o.values) {
      const lab = el('label');
      lab.append(radio(o, value), el('span', '', text));
      seg.append(lab);
    }
    row.append(seg);
    if (o.hint) row.append(el('span', 'hint'));
    box.append(row);
  }
}

function syncOptions() {
  const s = settings();
  const lock = locked();
  for (const id of ['options', 'arena-cards', 'style-cards']) $(id).classList.toggle('locked', lock);
  for (const inp of $('s-lobby').querySelectorAll('input[type="radio"]')) {
    const key = inp.name.slice(4);
    inp.checked = inp.value === String(s[key]);
    inp.disabled = lock;
    inp.parentElement.classList.toggle('on', inp.checked);
  }
  for (const row of $('options').children) {
    const o = OPTIONS.find((x) => x.key === row.dataset.key);
    row.hidden = !!o.show && !o.show(s);
    const hint = row.querySelector('.hint');
    if (hint) hint.textContent = o.hint(s) || '';
  }
  const arenaName = s.arena === 'random' ? 'Random arena' : arenaById(s.arena).name;
  const styleName = s.theme === 'random' ? 'random style' : THEMES.find((t) => t.id === s.theme).name;
  $('preview-cap').textContent = `${arenaName} - ${styleName}`;
  paintCards();
}

// A letter key steps one setting to its next value (Shift: previous) and puts
// the focus there, so the arrow keys carry on from it.
function hotOption(letter, back) {
  if (locked()) return false;
  const s = settings();
  const o = OPTIONS.find((x) => x.hot === letter && (!x.only || x.only === kind) && (!x.show || x.show(s)));
  if (!o) return false;
  const i = o.values.findIndex(([v]) => v === s[o.key]);
  changeSetting({ [o.key]: o.values[(i + (back ? -1 : 1) + o.values.length) % o.values.length][0] });
  $('s-lobby').querySelector(`input[name="opt-${o.key}"]:checked`)?.focus();
  sfx.play('click');
  return true;
}

// Paint the pictures one at a time between frames, so the screen never stalls:
// the big preview first, then each arena in the chosen style, then one still
// per art style. Everything is cached, so this is instant the second time.
let paintRun = 0;
function paintCards() {
  const s = settings();
  const run = ++paintRun;
  const themeId = s.theme === 'random' ? DEFAULT_THEME : s.theme;
  const jobs = [[themeId, () => ($('preview').src = scenePreview(s.arena, themeId, 480, 270))]];
  for (const img of $('arena-cards').querySelectorAll('img')) jobs.push([themeId, () => (img.src = scenePreview(img.dataset.id, themeId, 240, 135))]);
  for (const img of $('style-cards').querySelectorAll('img')) if (!img.dataset.done) jobs.push([img.dataset.id, () => ((img.src = styleStill(img.dataset.id)), (img.dataset.done = '1'))]);
  const next = async () => {
    const job = jobs.shift();
    if (!job || run !== paintRun || screen !== 'lobby') return;
    await loadTheme(job[0]);
    if (run !== paintRun || screen !== 'lobby') return;
    job[1]();
    setTimeout(next, 0);
  };
  next();
}

function openLobby() {
  show('lobby');
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
  for (let i = rows.length; i < (online ? MAX_PLAYERS : 0); i++) list.append(el('li', 'empty', 'waiting for a challenger...'));

  const start = $('btn-start');
  if (online) {
    $('lobby-code').textContent = room.code;
    $('players-title').textContent = `Players ${room.players.length}/${MAX_PLAYERS}`;
    const host = room.players.find((p) => p.id === room.hostId);
    const enough = room.players.length >= MIN_PLAYERS;
    start.hidden = !amHost();
    start.disabled = !enough;
    setLabel(start, room.settings.game === 'cup' ? 'Start tournament' : 'Start match', 'Enter');
    $('lobby-note').textContent = enough ? '' : 'Share the code with your friends - you need at least 2 players.';
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
      ? [[['Esc', 'Esc'], 'leave the room'], [['C'], 'copy the invite link']]
      : [[['\u2191', '\u2193'], 'move'], [['\u2190', '\u2192'], 'choose'], [['Enter'], 'start'], [online ? ['Esc', 'Esc'] : ['Esc'], online ? 'leave the room' : 'back']],
  );
  start.toggleAttribute('data-autofocus', !start.hidden);
  syncOptions();
}

function leaveRoom() {
  if (kind === 'online' && room) socket.emit('leave');
  play.stop();
  toHome();
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
  if (screen === 'lobby') {
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
  $('btn-pause-full').hidden = !document.documentElement.requestFullscreen;
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

function showResults(res) {
  lastResults = res;
  clearInterval(nextTimer);
  const mySlot = play.mySlot();
  const cup = res.cup;
  const iWon = res.winners.includes(mySlot);
  const nameOf = (slot) => (res.rows.find((r) => r.slot === slot) || cup?.table.find((r) => r.slot === slot))?.name || `Player ${slot + 1}`;
  const winners = res.winners.map(nameOf);
  let kicker;
  let title;
  let sub = '';
  if (cup) {
    kicker = cup.final ? 'Tournament over' : `Round ${cup.round} of ${cup.rounds}`;
    if (cup.final) {
      title = iWon ? 'You win the tournament!' : `${list(winners)} win${winners.length > 1 ? '' : 's'} the tournament!`;
      sub = res.reason === 'forfeit' ? 'Everyone else left.' : 'Final standings.';
    } else {
      const lead = cup.table[0];
      const tied = cup.table.filter((r) => r.pts === lead.pts).length > 1;
      title = tied ? 'Level at the top' : lead.slot === mySlot ? 'You are in the lead' : `${lead.name} is in the lead`;
      sub = 'Points for the least time as it, plus one if you were not it at the buzzer.';
    }
  } else if (res.reason === 'forfeit') {
    kicker = 'Match over';
    title = iWon ? 'You win!' : `${list(winners)} wins!`;
    sub = 'Everyone else left.';
  } else if (res.mode === 'potato') {
    kicker = 'Hot Potato';
    title = res.loser === mySlot ? 'You were it. You lose!' : iWon ? 'You got away!' : `${nameOf(res.loser)} loses!`;
    sub = `${res.loser === mySlot ? 'You were' : `${nameOf(res.loser)} was`} it when the clock ran out.`;
  } else {
    kicker = 'Least Time';
    title = iWon ? (winners.length > 1 ? 'You share the win!' : 'You win!') : `${list(winners)} win${winners.length > 1 ? '' : 's'}!`;
    sub = 'Least time as it wins.';
  }
  $('res-kicker').textContent = kicker;
  $('res-title').textContent = title;
  $('res-sub').textContent = sub;

  // the table
  const table = $('res-table');
  table.textContent = '';
  const head = el('tr');
  for (const h of cup ? ['', 'Player', 'As it', 'Round', 'Total'] : ['', 'Player', 'As it', 'Tags']) head.append(el('th', '', h));
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
    const mark = (glyph, word, dark) => {
      const m = el('span', 'mark');
      m.append(el('i', dark ? 'seal sm dark' : 'seal sm', glyph), word);
      who.append(m);
    };
    if (final && res.winners.includes(r.slot)) mark('\u52dd', 'wins');
    if (res.loser === r.slot && res.reason !== 'forfeit') mark('\u9b3c', 'it', true);
    tr.append(el('td', '', String(i + 1)), who, el('td', '', r.row ? secs(r.row.ms) : '-'));
    if (cup) tr.append(el('td', 'gain', r.row ? `+${r.gained}` : '-'), el('td', '', `${r.pts} pts`));
    else tr.append(el('td', '', String(r.row.tags)));
    table.append(tr);
  });

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
    if (screen !== 'lobby' || kind !== 'online') {
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
  else if (screen === 'join') toHome();
  else if (screen === 'lobby') {
    if (kind === 'practice') toHome();
    else if (twice('leave', 'Press Esc again to leave the room')) leaveRoom();
  } else if (screen === 'name' && myName) toHome();
}

// One place for every shortcut. Returns true when the key was used.
function shortcut(key, e) {
  const top = overlay || screen;
  const onButton = document.activeElement?.tagName === 'BUTTON';
  const typing = document.activeElement?.tagName === 'INPUT' && document.activeElement.type === 'text';
  if (typing) return false; // letters belong to the name being typed

  // anywhere: sound and full screen
  if (key === 'm') return toggleSound(true), true;
  if (key === 'f') return toggleFullscreen(), true;
  if (top === 'game') return false; // everything else belongs to the match

  if (top === 'home') {
    if (/^[123]$/.test(key)) return [$('btn-create'), $('btn-join'), $('btn-practice')][Number(key) - 1].click(), true;
    if (key === 'h') return openHelp(), true;
    if (key === 'n') return askName(), true;
  } else if (top === 'join') {
    if (/^\d$/.test(key)) return setCode(code + key), true;
    if (key === 'backspace') return setCode(code.slice(0, -1)), true;
    if (key === 'enter' && !onButton) {
      codeTried = '';
      return submitCode(), true;
    }
  } else if (top === 'lobby') {
    if (key === 'enter' && !onButton) {
      if (!$('btn-start').hidden && !$('btn-start').disabled) $('btn-start').click();
      return true;
    }
    if (key === 'c' && kind === 'online') return copyInvite(), true;
    if (key === 'h') return openHelp(), true;
    if (/^[a-z]$/.test(key)) return hotOption(key, e.shiftKey);
  } else if (top === 'pause') {
    if (key === 'h') return openHelp(), true;
    if (key === 'q') {
      if (twice('quit', 'Press Q again to leave the match')) leaveRoom();
      return true;
    }
  } else if (top === 'results') {
    if (key === 'enter' && !onButton) {
      const again = $('btn-res-again');
      if (!again.hidden && !again.disabled) again.click();
      return true;
    }
    if (key === 'arrowleft' || key === 'arrowright') return moveFocus(key === 'arrowright' ? 1 : -1), true;
  } else if (top === 'help') {
    // read the scroll with the arrow keys
    const step = { arrowdown: 70, arrowup: -70, pagedown: 400, pageup: -400, ' ': 400 }[key];
    if (step) return $('s-help').scrollBy({ top: step }), true;
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
const start = () => (invite.length === CODE_LEN ? openJoin(invite) : toHome());
if (myName) start();
else askName(start);

// Handy for debugging from the browser console (and used by the automated checks).
window.__tag = { renderer, net, socket, input, get game() { return play.game; }, play, get screen() { return overlay || screen; }, get room() { return room; }, fontsReady: () => fontsIn };
