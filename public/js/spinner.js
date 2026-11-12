// The draw before every round: a wooden rack of three paper reels - arena,
// style, and who is it - that spin, stop one after the other and get stamped.
// When the arena or the style is a surprise, two paper doors hide the match
// until both have landed, then slide open.
//
// It is shown in play.el.spin, above the match, and has to be gone by the time
// the 3-2-1 starts. Everything that moves is a CSS transform or opacity with
// its delay worked out up front, so it stays smooth while the match behind it
// is still being set up; scripts only build it and make the clicks.
//
//   draw.show(layer, info, { sfx, colorOf, me, prefer })   info is what play.js hands to onStart
//   draw.clear()

import { THEMES, MODES, TEAM_NAMES, TEAM_COLORS, COUNTDOWN_MS, twistById } from '/shared/config.js';
import { ARENAS, arenaById } from '/shared/arenas.js';
import { arenaThumb, styleThumb } from './art.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const shuffled = (list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const calm = matchMedia('(prefers-reduced-motion: reduce)');

const MIN_MS = 450; // less time than this: show nothing at all
const FULL_MS = 1700; // less than this: no spinning, just the result for a moment

let layer = null;
let timers = [];
let token = 0;

// A reel: its label, the window, and the strip of cells that runs through it.
// `cells` are the things it can show, `landing` the one it stops on. When it
// spins, `stop` is when (ms from now) it comes to rest.
function reel(kind, label, cells, landing, cell, spin, start, stop) {
  const box = el('section', `reel ${kind}`);
  box.append(el('h4', '', label));
  const win = el('div', 'win');
  const strip = el('div', 'strip');
  let n = 1;
  if (spin && cells.length > 1) {
    // enough cells to blur past; worked out backwards from the one it lands on,
    // so the same cell never comes twice running (with two players they simply take turns)
    n = Math.max(9, Math.min(26, Math.round((stop - start) / 105)));
    const run = [landing];
    while (run.length < n) {
      const others = cells.filter((c) => c !== run[0]);
      run.unshift(others[Math.floor(Math.random() * others.length)]);
    }
    run.push(cells.find((c) => c !== landing) || landing); // what peeks in when the reel overshoots
    for (const c of run) strip.append(cell(c));
    const total = run.length;
    strip.style.setProperty('--end', `${(-(n - 1) / total) * 100}%`);
    strip.style.setProperty('--over', `${(-(n - 1 + 0.26) / total) * 100}%`);
    strip.style.animation = `reel ${Math.round(stop - start)}ms linear ${Math.round(start)}ms both`;
    box.classList.add('spun');
    box.style.setProperty('--at', `${Math.round(stop)}ms`); // the drum's shading lifts as it stops
  } else strip.append(cell(landing));
  win.append(strip);
  box.append(win);
  return box;
}

function stamp(box, cls, at, html = '') {
  const s = el('i', `stamp ${cls}`);
  s.innerHTML = html;
  if (at > 0) s.style.setProperty('--at', `${Math.round(at)}ms`);
  else s.classList.add('still');
  box.append(s);
}

function build(root, info, opts, T) {
  const full = T >= FULL_MS && !calm.matches;
  const players = info.players || [];
  const nameOf = (slot) => players.find((p) => p.slot === slot)?.name || `Player ${slot + 1}`;
  const team = info.mode === 'team' && Array.isArray(info.teams);
  const cup = info.cup || null;
  const hasIt = players.some((p) => p.slot === info.it);
  const leader = !team && cup && cup.leader >= 0 && cup.leader === info.it;
  const spinA = full && ARENAS.length > 1 && !!(info.random?.arena || cup);
  const spinS = full && THEMES.length > 1 && !!(info.random?.theme || cup);
  const spinW = full && hasIt && players.length > 1 && !leader;
  const doors = spinA || spinS;

  // --- when things happen (ms from now) ---
  const start = 200;
  const tA = spinA ? Math.min(0.26 * T, 1500) : 0;
  const tS = spinS ? Math.min((spinA ? 0.4 : 0.3) * T, 2300) : 0;
  const tOpen = doors ? Math.max(tA, tS) + Math.min(160, 0.04 * T) : 0;
  const tW = spinW ? (doors ? Math.min(0.7 * T, 4400) : Math.min(0.6 * T, 3000)) : 0;
  const tOut = T - Math.max(300, Math.min(380, 0.09 * T));
  root.style.setProperty('--out', `${Math.round(tOut)}ms`);
  root.style.setProperty('--open', `${Math.round(tOpen)}ms`);
  if (!doors) root.querySelectorAll('.door').forEach((d) => d.remove());
  root.classList.toggle('still', !full);
  root.prepend(el('i', 'veil'));

  const board = el('div', 'board');
  const mode = MODES.find((m) => m.id === info.mode)?.name || '';
  const twist = info.twist && info.twist !== 'none' ? twistById(info.twist) : null;
  const head = el('p', 'head');
  head.append(el('b', '', cup ? (cup.double ? 'Final round - double points' : `Round ${cup.round} of ${cup.rounds}`) : 'The draw'));
  if (team || !cup) head.append(el('span', '', mode));
  if (twist?.name) head.append(el('span', 'twist', `Twist: ${twist.name}`));
  board.append(head);

  // --- the reels ---
  const rack = el('div', 'rack');
  const picCell = (pic) => (c) => {
    const d = el('div', 'cell');
    const url = pic(c.id, c.id === c.land);
    if (url) {
      const img = el('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = url;
      d.append(img);
    } else d.classList.add('word');
    d.append(el('b', '', c.name));
    return d;
  };
  const arenas = ARENAS.map((a) => ({ id: a.id, name: a.name, land: info.arena }));
  const landA = arenas.find((a) => a.id === info.arena) || { id: info.arena, name: arenaById(info.arena).name, land: info.arena };
  const prefer = [info.theme, ...(opts.prefer || []), 'ink'];
  const a = reel('pic', 'Arena', arenas, landA, picCell((id, land) => arenaThumb(id, prefer, land)), spinA, start, tA);
  stamp(a, 'ok', spinA ? tA + 30 : 0);
  const styles = THEMES.map((t) => ({ id: t.id, name: t.name, land: info.theme }));
  const landS = styles.find((t) => t.id === info.theme) || { id: info.theme, name: info.theme, land: info.theme };
  const s = reel('pic', 'Style', styles, landS, picCell((id, land) => styleThumb(id, land)), spinS, start + 90, tS);
  stamp(s, 'ok', spinS ? tS + 30 : 0);
  rack.append(a, s);

  let verdict = '';
  if (hasIt) {
    const whoCell = (p) => {
      const d = el('div', 'cell');
      const chip = el('i', 'chip');
      chip.style.background = opts.colorOf ? opts.colorOf(p.slot) : '#888';
      d.append(chip, el('b', '', p.name));
      if (p.name.length > 8) d.classList.add('long');
      if (team) d.style.setProperty('--side', TEAM_COLORS[info.teams[p.slot]] || 'transparent');
      return d;
    };
    const land = players.find((p) => p.slot === info.it);
    const w = reel(team ? 'who sided' : 'who', team ? 'First bomb' : leader ? 'The leader is it' : 'Who is it?', players, land, whoCell, spinW, start + 180, tW);
    stamp(w, team ? 'dark big' : 'seal big', spinW ? tW + 30 : 0, team ? '<svg class="ic" aria-hidden="true"><use href="#i-bomb" /></svg>' : '\u9b3c');
    rack.append(w);
    const mine = info.it === opts.me;
    if (team) verdict = mine ? 'You carry the first bomb!' : `${land.name} carries the first bomb`;
    else verdict = mine ? 'You are it!' : `${land.name} is it!`;
    root.classList.toggle('mine', mine);
  }
  board.append(rack);

  // team battle: who is on which side
  if (team) {
    const sides = el('div', 'sides');
    [0, 1].forEach((t) => {
      const side = el('div', 'side');
      side.style.setProperty('--side', TEAM_COLORS[t]);
      side.append(el('b', '', TEAM_NAMES[t]));
      for (const p of players) if (info.teams[p.slot] === t) side.append(el('span', p.slot === opts.me ? 'me' : '', p.name));
      sides.append(side);
      if (t === 0) sides.append(el('i', '', 'vs'));
    });
    board.append(sides);
  }
  if (verdict) {
    const v = el('p', 'verdict', verdict);
    // the news waits for the reel to stop - or, when nothing spins for it, for the doors to open
    if (spinW) v.style.setProperty('--at', `${Math.round(tW + 60)}ms`);
    else if (doors) v.style.setProperty('--at', `${Math.round(tOpen + 380)}ms`);
    else v.classList.add('still');
    board.append(v);
  }
  root.append(board);
  // the same news in words, for anyone who cannot see the reels
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', `Arena: ${landA.name}. Style: ${landS.name}.${verdict ? ` ${verdict}` : ''}`);

  // --- a few clicks: each reel coming to rest, the last one slowing down, the stamp ---
  const sfx = opts.sfx;
  if (!sfx) return;
  const at = (ms, name) => timers.push(setTimeout(() => sfx.play(name), Math.max(0, ms)));
  if (spinA) at(tA, 'click');
  if (spinS) at(tS, 'click');
  if (spinW) {
    for (const back of [900, 640, 420, 240, 100]) if (tW - back > start + 200) at(tW - back, 'tick');
    at(tW + 40, 'count');
  } else if (hasIt && full) at(Math.max(tA, tS, 300) + 200, 'count');
}

export const draw = {
  show(target, info, opts = {}) {
    this.clear();
    if (!target || !info) return;
    const my = ++token;
    layer = target;
    // gone a breath before the 3-2-1
    const deadline = performance.now() + (Number(info.countdown) || 0) - COUNTDOWN_MS - 60;
    if (info.playing || deadline - performance.now() < MIN_MS) return;
    const root = el('div', 'draw');
    // if the arena or the style is a surprise, the doors are shut from the very first frame
    if (!calm.matches && deadline - performance.now() >= FULL_MS && (info.random?.arena || info.random?.theme || info.cup)) root.append(el('i', 'door l'), el('i', 'door r'));
    target.append(root);
    // The rest waits for the next frame: by then the match behind has been set
    // up (the slow part), so the time that is left is the time we really have.
    requestAnimationFrame(() => {
      if (my !== token) return;
      const T = deadline - performance.now();
      if (T < MIN_MS) return this.clear();
      try {
        build(root, info, opts, T);
      } catch (err) {
        console.warn('the draw could not be shown', err);
        this.clear();
      }
    });
    timers.push(setTimeout(() => my === token && this.clear(), Math.max(0, deadline - performance.now()) + 40));
  },

  clear() {
    token++;
    for (const t of timers) clearTimeout(t);
    timers = [];
    if (layer) layer.textContent = '';
    layer = null;
  },

  get showing() {
    return !!layer && layer.childElementCount > 0;
  },
};
