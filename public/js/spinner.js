// The draw before every round: a wooden rack of three picture reels - arena,
// style, and who is it - that spin, stop one after the other and get stamped.
// When the arena or the style is a surprise, two paper doors hide the match
// until both have landed, then slide open.
//
// It is shown in play.el.spin, above the match, and has to be gone by the time
// the 3-2-1 starts. Everything that moves is a CSS transform or opacity with
// its delay worked out up front, so it stays smooth while the match behind it
// is still being set up; scripts only build it and make the clicks.
//
// Pictures: every reel stops on a picture in THIS round's art style - the
// arena as it looks in that style, the style's own still, and the player's
// character in that style and their colour. Whatever of that has not been
// painted yet is painted a moment after the draw appears, one picture at a
// time between frames (most urgent first), and dropped into its cell.
//
//   draw.show(layer, info, { sfx, colorOf, me, prefer })   info is what play.js hands to onStart
//   draw.clear()

import { THEMES, MODES, TEAM_NAMES, TEAM_COLORS, COUNTDOWN_MS, twistById } from '/shared/config.js';
import { ARENAS, arenaById } from '/shared/arenas.js';
import { sceneThumb, arenaThumb, styleThumb, styleReady, scenePreview, styleStill, playerPortrait, portraitBackdrop } from './art.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const BOMB = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="15" r="7.5" fill="currentColor"/><path d="M13.3 8.2l2.9-2.9 2.500 2.500-2.900 2.900z" fill="currentColor"/><path d="M17.800 5.900c.700-1.700 1.900-2.600 3.400-2.700" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round"/><path d="M21.600 1v1.300M23.300 3.300H22M22.900 1.500l-.900.900" fill="none" stroke="currentColor" stroke-width="1.300" stroke-linecap="round"/></svg>';

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
    strip.style.animation = `draw-reel ${Math.round(stop - start)}ms linear ${Math.round(start)}ms both`;
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

// A picture cell: the picture if it is there, the name underneath. Until the
// picture has been painted the name stands alone in brush letters.
function picCell(name, url) {
  const d = el('div', 'cell');
  d.append(el('b', '', name));
  setPic(d, url);
  return d;
}
function setPic(cell, url) {
  if (!url) return cell.classList.add('word');
  let img = cell.firstChild;
  if (img.tagName !== 'IMG') {
    img = el('img');
    img.alt = '';
    img.decoding = 'async';
    cell.prepend(img);
  }
  img.src = url;
  cell.classList.remove('word');
}

function build(root, info, opts, T, my) {
  const full = T >= FULL_MS && !calm.matches;
  const players = info.players || [];
  const nameOf = (slot) => players.find((p) => p.slot === slot)?.name || `Player ${slot + 1}`;
  const team = info.mode === 'team' && Array.isArray(info.teams);
  const cup = info.cup || null;
  // team battle: several players start with a bomb; the reel lands on the first of them
  const bombs = team ? (info.bombs || []).filter((slot) => players.some((p) => p.slot === slot)) : [];
  const itSlot = team ? (bombs[0] ?? -1) : info.it;
  const hasIt = players.some((p) => p.slot === itSlot);
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

  const board = el('div', 'dr-board');
  const mode = MODES.find((m) => m.id === info.mode)?.name || '';
  const twist = info.twist && info.twist !== 'none' ? twistById(info.twist) : null;
  const head = el('p', 'head');
  head.append(el('b', '', cup ? (cup.double ? 'Final round - double points' : `Round ${cup.round} of ${cup.rounds}`) : 'The draw'));
  if (team || !cup) head.append(el('span', '', mode));
  if (twist?.name) head.append(el('span', 'twist', `Twist: ${twist.name}`));
  board.append(head);

  // --- the reels ---
  const rack = el('div', 'rack');
  const jobs = []; // pictures still to paint: [urgency, fn], run one at a time between frames
  const theme = info.theme;
  const canPaint = styleReady(theme);

  // Arena. The cell it stops on shows the arena in this round's style - never a
  // picture left over from another style. Cells that only roll past show
  // whatever is there already.
  const prefer = [theme, ...(opts.prefer || []), 'ink'];
  const arenas = ARENAS.map((a) => ({ id: a.id, name: a.name }));
  const landA = arenas.find((a) => a.id === info.arena) || { id: info.arena, name: arenaById(info.arena).name };
  const arenaCells = []; // every cell that shows the arena of this round
  const a = reel('pic', 'Arena', arenas, landA, (c) => {
    const mine = c.id === info.arena;
    const d = picCell(c.name, mine ? sceneThumb(c.id, theme) : arenaThumb(c.id, prefer));
    if (mine) arenaCells.push(d);
    return d;
  }, spinA, start, tA);
  stamp(a, 'ok', spinA ? tA + 30 : 0);
  if (canPaint && !sceneThumb(info.arena, theme)) {
    jobs.push([spinA ? tA : 0, () => {
      const url = scenePreview(info.arena, theme, 240, 135);
      for (const d of arenaCells) setPic(d, url);
    }]);
  }

  // Style
  const styles = THEMES.map((t) => ({ id: t.id, name: t.name }));
  const landS = styles.find((t) => t.id === theme) || { id: theme, name: theme };
  const styleCells = [];
  const s = reel('pic', 'Style', styles, landS, (c) => {
    const d = picCell(c.name, styleThumb(c.id));
    if (c.id === theme) styleCells.push(d);
    return d;
  }, spinS, start + 90, tS);
  stamp(s, 'ok', spinS ? tS + 30 : 0);
  if (canPaint && !styleThumb(theme)) {
    jobs.push([spinS ? tS : 0, () => {
      const url = styleStill(theme);
      for (const d of styleCells) setPic(d, url);
    }]);
  }
  rack.append(a, s);

  // Who is it: each player's character, in this round's style and their own
  // colour, standing in front of the style's backdrop; the name underneath.
  let verdict = '';
  let who = null;
  const poseCells = new Map(); // slot -> the cells that show that player
  if (hasIt) {
    const whoCell = (p) => {
      const d = el('div', 'cell');
      const pic = el('span', 'pose');
      const dot = el('i', 'dot'); // stands in until the portrait has been painted
      dot.style.background = opts.colorOf ? opts.colorOf(p.slot) : '#888';
      pic.append(dot);
      d.append(pic, el('b', p.name.length > 9 ? 'long' : '', p.name));
      if (team) d.style.setProperty('--side', TEAM_COLORS[info.teams[p.slot]] || 'transparent');
      if (!poseCells.has(p.slot)) poseCells.set(p.slot, []);
      poseCells.get(p.slot).push(pic);
      return d;
    };
    const land = players.find((p) => p.slot === itSlot);
    who = reel(team ? 'pic cast sided' : 'pic cast', team ? (bombs.length > 1 ? 'Bombs' : 'The bomb') : leader ? 'The leader is it' : 'Who is it?', players, land, whoCell, spinW, start + 180, tW);
    stamp(who, team ? 'fuse big' : 'oni big', spinW ? tW + 30 : 0, team ? BOMB : '鬼');
    rack.append(who);
    const mine = team ? bombs.includes(opts.me) : info.it === opts.me;
    if (team) {
      const and = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');
      const others = bombs.filter((slot) => slot !== opts.me).map(nameOf);
      if (mine) verdict = others.length ? `You carry a bomb - so ${others.length > 1 ? 'do' : 'does'} ${and(others)}` : 'You carry the bomb!';
      else verdict = `${and(others)} ${others.length > 1 ? 'carry the bombs' : 'carries the bomb'}`;
    } else verdict = mine ? 'You are it!' : `${land.name} is it!`;
    root.classList.toggle('mine', mine);
  }
  board.append(rack);

  // team battle: who is on which side
  if (team) {
    const sides = el('div', 'dr-sides');
    [0, 1].forEach((t) => {
      const side = el('div', 'dr-side');
      side.style.setProperty('--side', TEAM_COLORS[t]);
      side.append(el('b', '', TEAM_NAMES[t]));
      for (const p of players) {
        if (info.teams[p.slot] !== t) continue;
        const who = el('span', p.slot === opts.me ? 'me' : '', p.name);
        // a bomb beside everyone who starts with one (it appears when the reel stops)
        if (bombs.includes(p.slot)) {
          const mark = el('i', 'carries');
          mark.innerHTML = BOMB;
          mark.style.setProperty('--at', `${Math.round(spinW ? tW + 60 : doors ? tOpen + 380 : 0)}ms`);
          who.append(mark);
        }
        side.append(who);
      }
      sides.append(side);
      if (t === 0) sides.append(el('i', '', 'vs'));
    });
    board.append(sides);
  }
  if (verdict) {
    const v = el('p', 'dr-verdict', verdict);
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

  // --- the portraits: the ones already painted go in now, the rest are queued ---
  if (who && canPaint) {
    // painted a little larger than the cell shows them (in steps, so a round later it is all there already)
    const shown = who.querySelector('.pose').clientHeight || 96;
    const size = Math.min(168, Math.max(72, Math.ceil(shown / 24) * 24));
    const colOf = (slot) => (info.cols ? info.cols[slot] ?? slot : slot);
    const put = (slot, url) => {
      for (const pic of poseCells.get(slot) || []) {
        const img = el('img');
        img.alt = '';
        img.src = url;
        pic.textContent = '';
        pic.append(img);
      }
    };
    const back = (url) => who.style.setProperty('--back', `url("${url}")`);
    const haveBack = portraitBackdrop(theme, size, true);
    if (haveBack) back(haveBack);
    else jobs.push([spinW ? start + 180 : 0, () => back(portraitBackdrop(theme, size))]);
    // whoever the reel stops on first, then the rest in the order they roll past
    const order = [...poseCells.keys()].sort((x, y) => (x === itSlot ? -1 : y === itSlot ? 1 : 0));
    order.forEach((slot, i) => {
      const have = playerPortrait(theme, colOf(slot), { size, peek: true });
      if (have) put(slot, have);
      else jobs.push([spinW ? start + 181 + i : 1, () => put(slot, playerPortrait(theme, colOf(slot), { size }))]);
    });
    // and, with nothing else to do, the small portraits the results screen can use straight away
    if (size !== 96) for (const p of players) if (!playerPortrait(theme, colOf(p.slot), { peek: true })) jobs.push([1e9, () => playerPortrait(theme, colOf(p.slot))]);
  }
  paintLater(jobs, my);

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

// Paint what is missing, the picture needed soonest first, one per turn of the
// event loop so a frame can always get in between. Stops if the draw goes away.
function paintLater(jobs, my) {
  jobs.sort((x, y) => x[0] - y[0]);
  const next = () => {
    if (my !== token) return;
    const job = jobs.shift();
    if (!job) return;
    try {
      job[1]();
    } catch (err) {
      console.warn('a picture for the draw could not be painted', err);
    }
    if (jobs.length) timers.push(setTimeout(next, 24));
  };
  if (jobs.length) timers.push(setTimeout(next, 40));
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
        build(root, info, opts, T, my);
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
