// The occasions: a layer over everything that plays a short scene when
// something that matters happens - a round is about to begin (the two sides,
// or everyone, walk on face to face), or one has just ended (the word for it,
// who won, what the score is and what comes next).
//
// A scene is built from what the game already knows (the round message, the
// result message), never from anything of its own: who is playing, on which
// side, in which colour and style, which round of which tournament this is.
// Scenes only show; nothing here decides or delays anything in the match.
// The walk-on fits into time the server leaves before the draw (VS_MS); the
// ending plays before the results card and can be skipped with any key or tap.
//
//   present.init({ sfx, portrait(slot, size, face), colorOf(slot) })
//   present.versus(info, { me, ms })        info: what play.js hands to onStart
//   present.outcome(res, { me })  -> Promise<boolean>   false: it was cut off by something else
//   present.skip()  present.clear()  present.busy ('' | 'versus' | 'outcome')
//
// Everything that moves is a CSS animation with its delay set up front; the
// script builds the scene, makes the sounds and takes it down.

import { MODES, TEAM_NAMES, TEAM_COLORS, twistById } from '/shared/config.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const WARM = '#c8372d';
const COOL = '#2f4f8f';
const GOLD = '#d9a53a';

let root = null;
let opts = {};
let timers = [];
let token = 0;
let done = null; // resolves an outcome's promise
let kind = '';

const later = (ms, fn) => {
  const my = token;
  timers.push(setTimeout(() => my === token && fn(), Math.max(0, ms)));
};
const sound = (ms, name, vol) => later(ms, () => opts.sfx?.play(name, vol));

function layer() {
  if (!root) {
    root = el('div');
    root.id = 'present';
    root.setAttribute('aria-hidden', 'true');
    root.hidden = true;
    document.body.append(root);
    root.addEventListener('pointerdown', () => kind === 'outcome' && present.skip());
  }
  return root;
}

// One player: their character over a slab of their colour, and a name plate.
//   face: 1 looks right, -1 left; i: the place in the line (for the stagger); from: l | r | up
function card(p, { face = 1, i = 0, from = 'up', me = false, size = 192, tag = '' } = {}) {
  const c = el('div', `pz-card from-${from}${me ? ' me' : ''}${p.out ? ' gone' : ''}`);
  c.style.setProperty('--i', String(i));
  c.style.setProperty('--c', p.color || '#888');
  const pic = el('span', 'pz-pic');
  const url = opts.portrait?.(p.slot, size, face);
  if (url) {
    const img = el('img');
    img.alt = '';
    img.src = url;
    pic.append(img);
  }
  c.append(el('i', 'pz-slab'), pic);
  const plate = el('span', 'pz-name', p.name);
  if (p.name.length > 9) plate.classList.add('long');
  c.append(plate);
  if (me) c.append(el('b', 'pz-you', 'You'));
  if (tag) c.append(el('b', 'pz-tag', tag));
  return c;
}

// how big a card can be: `n` of them in `cols` columns inside w x h
const fit = (w, h, n, cols, max = 200) => {
  const rows = Math.ceil(n / cols);
  return Math.floor(Math.max(54, Math.min(max, w / cols - 12, (h / rows - 34) / 1.08)));
};

// a burst of sparks from the middle (where the two sides meet)
function sparks(box, many, colors) {
  const fx = el('span', 'pz-sparks');
  for (let i = 0; i < many; i++) {
    const s = el('i');
    const a = Math.random() * Math.PI * 2;
    const far = 90 + Math.random() * 260;
    s.style.setProperty('--x', `${Math.cos(a) * far}px`);
    s.style.setProperty('--y', `${Math.sin(a) * far * 0.7}px`);
    s.style.setProperty('--d', `${Math.random() * 0.12}s`);
    s.style.background = colors[i % colors.length];
    fx.append(s);
  }
  box.append(fx);
}

function open(name, data = {}) {
  present.clear();
  const r = layer();
  kind = name;
  r.className = `pz pz-${name}`;
  for (const k of Object.keys(r.dataset)) delete r.dataset[k];
  Object.assign(r.dataset, data);
  r.hidden = false;
  return r;
}

// What a round is called, and how much of an occasion it is.
//   grade: '' | semi | final   (a knockout down to three, or two; a tournament's last round; a tie-break)
function billing(info) {
  const cup = info.cup;
  const ko = !!cup?.ko;
  const mode = ko ? 'Knockout' : MODES.find((m) => m.id === info.mode)?.name || '';
  if (!cup) return { kicker: info.practice ? 'Practice' : 'Quick Play', title: mode, grade: '', note: '' };
  if (ko) {
    if (cup.left === 2) return { kicker: 'Knockout', title: 'The Final', grade: 'final', note: 'The oni at the buzzer loses it all' };
    if (cup.left === 3) return { kicker: 'Knockout', title: 'Semi-final', grade: 'semi', note: 'Three left: two go through' };
    return { kicker: `Knockout · round ${cup.round} of ${cup.rounds}`, title: `${cup.left} left`, grade: '', note: 'The oni at the buzzer is out' };
  }
  if (cup.tie) return { kicker: 'Team Bomb · level', title: 'Tie-break', grade: 'final', note: 'Whoever wins this round wins it all' };
  if (cup.round === cup.rounds) return { kicker: `Team Bomb · round ${cup.round} of ${cup.rounds}`, title: 'Final round', grade: 'final', note: cup.score === 'rounds' ? 'Worth two' : 'Points count double' };
  return { kicker: 'Team Bomb tournament', title: `Round ${cup.round} of ${cup.rounds}`, grade: cup.round === cup.rounds - 1 ? 'semi' : '', note: '' };
}

function header(r, bill, extra = '') {
  const head = el('div', 'pz-head');
  head.append(el('span', 'pz-kicker', bill.kicker), el('b', 'pz-title', bill.title));
  if (bill.note || extra) head.append(el('span', 'pz-note', [bill.note, extra].filter(Boolean).join(' · ')));
  r.append(head);
  return head;
}

export const present = {
  init(o) {
    opts = o || {};
  },
  get busy() {
    return kind;
  },

  // --- before a round: who is playing whom -----------------------------------------
  versus(info, { me = -1, ms = 2600 } = {}) {
    if (calm.matches || ms < 1200) return 0;
    const players = info.players.map((p) => ({ ...p, color: opts.colorOf?.(p.slot) }));
    if (players.length < 2) return 0;
    const teams = info.mode === 'team' && info.teams;
    const layout = teams ? 'team' : players.length === 2 ? 'duel' : 'ffa';
    const bill = billing(info);
    const r = open('versus', { layout, grade: bill.grade });
    const W = innerWidth;
    const H = innerHeight;
    const tall = H > W * 1.05;
    r.classList.toggle('tall', tall);
    r.style.setProperty('--ms', `${ms}ms`);
    // the ground: two slabs of colour that slide in from either side and meet on a slant
    const a = teams ? TEAM_COLORS[0] : layout === 'duel' ? players[0].color : WARM;
    const b = teams ? TEAM_COLORS[1] : layout === 'duel' ? players[1].color : COOL;
    r.style.setProperty('--a', a);
    r.style.setProperty('--b', b);
    r.append(el('i', 'pz-half l'), el('i', 'pz-half r'), el('i', 'pz-streaks'), el('i', 'pz-flash'));
    const twist = info.twist && info.twist !== 'none' ? twistById(info.twist) : null;
    let tally = '';
    if (teams && info.cup?.total && info.cup.round > 1) tally = `${TEAM_NAMES[0]} ${info.cup.total[0]} – ${info.cup.total[1]} ${TEAM_NAMES[1]}`;
    header(r, bill, [tally, twist?.name ? `Twist: ${twist.name}` : ''].filter(Boolean).join(' · '));
    const stage = el('div', 'pz-stage');
    r.append(stage);
    const emblem = el('b', 'pz-vs');
    if (layout === 'ffa') {
      // everyone for themselves: one line of all of them, coming up from both ends towards the middle
      const n = players.length;
      const cols = tall ? (n <= 4 ? 2 : n <= 9 ? 3 : 4) : n <= 6 ? n : Math.ceil(n / 2);
      const size = fit(W * 0.94, H * (tall ? 0.56 : 0.5), n, cols, 200);
      const line = el('div', 'pz-line');
      line.style.setProperty('--card', `${size}px`);
      line.style.maxWidth = `${cols * (size + 14)}px`;
      players.forEach((p, i) => {
        const col = i % cols;
        const left = col < cols / 2;
        line.append(card(p, { face: left ? 1 : -1, i: left ? col : cols - 1 - col, from: left ? 'l' : 'r', me: p.slot === me }));
      });
      emblem.innerHTML = '<i>All</i><span>VS</span><i>All</i>';
      emblem.classList.add('wide');
      stage.append(emblem, line);
    } else {
      const sides = teams ? [0, 1].map((t) => players.filter((p) => teams[p.slot] === t)) : [[players[0]], [players[1]]];
      // (you are always among the first of your own side)
      for (const s of sides) s.sort((x, y) => (y.slot === me) - (x.slot === me));
      const most = Math.max(sides[0].length, sides[1].length);
      const cols = most <= 3 ? most : most === 4 ? 2 : 3;
      const size = layout === 'duel' ? Math.floor(Math.min(tall ? W * 0.5 : W * 0.3, H * (tall ? 0.26 : 0.46), 300)) : fit(tall ? W * 0.94 : W * 0.41, H * (tall ? 0.3 : 0.56), most, cols, 200);
      sides.forEach((list, t) => {
        const side = el('div', `pz-side ${t ? 'r' : 'l'}`);
        side.style.setProperty('--card', `${size}px`);
        if (teams) side.append(el('b', 'pz-team', TEAM_NAMES[t]));
        const line = el('div', 'pz-line');
        line.style.maxWidth = `${cols * (size + 14)}px`;
        list.forEach((p, i) => line.append(card(p, { face: t ? -1 : 1, i, from: t ? 'r' : 'l', me: p.slot === me, size: layout === 'duel' ? 288 : 192 })));
        side.append(line);
        stage.append(side);
        if (!t) stage.append(emblem);
      });
      emblem.textContent = 'VS';
    }
    // the moment they meet
    const hit = Math.min(820, ms * 0.34);
    r.style.setProperty('--hit', `${hit}ms`);
    sound(60, 'whoosh');
    sound(hit, 'slam', bill.grade === 'final' ? 1 : 0.8);
    if (bill.grade) sound(hit + 260, 'drum');
    later(hit, () => sparks(stage, bill.grade === 'final' ? 26 : 16, bill.grade === 'final' ? [GOLD, '#fff', a, b] : ['#fff', a, b]));
    later(ms - 330, () => {
      r.classList.add('out');
      opts.sfx?.play('whoosh', 0.6);
    });
    later(ms, () => this.clear());
    return ms;
  },

  // --- after a round: the word for it, who won, the score, what comes next ---------
  outcome(res, { me = -1 } = {}) {
    if (calm.matches || !res?.rows?.length) return Promise.resolve(true);
    const cup = res.cup;
    const team = res.team;
    const between = !!cup && !cup.final;
    const rowOf = (slot) => res.rows.find((x) => x.slot === slot) || cup?.table?.find((x) => x.slot === slot);
    const person = (slot) => ({ slot, name: rowOf(slot)?.name || `Player ${slot + 1}`, color: opts.colorOf?.(slot) });
    const mine = res.rows.find((x) => x.slot === me);
    const watching = !mine && !(cup?.ko && cup.table.some((x) => x.slot === me));
    const iWon = res.winners.includes(me);
    const forfeit = res.reason === 'forfeit';
    let word; // the big one
    let mood; // win | lose | draw | info
    let kicker;
    let cast = []; // who stands under it
    let fallen = null; // a knockout: who went out
    let line = ''; // the score
    let next = ''; // what comes now
    let side = -1; // a team's colour for the stage
    if (team) {
      const tally = cup && team.total ? team.total : team.score;
      const lead = !between ? team.win : team.win; // (between rounds the scene is about THIS round)
      side = lead;
      cast = lead >= 0 ? res.rows.filter((x) => x.team === lead).map((x) => person(x.slot)) : res.rows.map((x) => person(x.slot));
      line = `${TEAM_NAMES[0]} ${team.score[0]} – ${team.score[1]} ${TEAM_NAMES[1]}`;
      if (between) {
        kicker = `Round ${cup.round} of ${cup.rounds} · Team Bomb`;
        mood = lead < 0 ? 'draw' : watching ? 'info' : mine.team === lead ? 'win' : 'lose';
        word = lead < 0 ? 'Round drawn' : watching ? `${TEAM_NAMES[lead]} take it` : mine.team === lead ? 'Round won' : 'Round lost';
        const left = cup.rounds - cup.round;
        next = cup.tie ? 'Level: a tie-break decides it' : `${TEAM_NAMES[0]} ${tally[0]} – ${tally[1]} ${TEAM_NAMES[1]} · ${left === 1 ? 'the final round is next' : `${left} rounds to go`}`;
      } else {
        kicker = cup ? 'Tournament over · Team Bomb' : 'Team Bomb';
        mood = lead < 0 ? 'draw' : watching ? 'info' : iWon ? 'win' : 'lose';
        word = lead < 0 ? 'Draw' : watching ? `${TEAM_NAMES[lead]} win` : iWon ? (cup ? 'Champions' : 'Victory') : 'Defeat';
        if (cup) line = `${TEAM_NAMES[0]} ${tally[0]} – ${tally[1]} ${TEAM_NAMES[1]}`;
      }
    } else if (cup) {
      const still = cup.table.filter((x) => !x.out);
      const out = cup.caught >= 0 ? person(cup.caught) : null;
      if (cup.final) {
        kicker = 'Knockout · the final';
        cast = res.winners.map(person);
        mood = watching ? 'info' : iWon ? 'win' : 'lose';
        word = watching ? `${cast[0]?.name || 'Nobody'} wins` : iWon ? 'Champion' : 'Defeat';
        line = iWon ? 'The last one standing' : cast[0] ? `${cast[0].name} wins the knockout` : '';
      } else {
        kicker = `Knockout · round ${cup.round} of ${cup.rounds}`;
        cast = still.map((x) => person(x.slot));
        fallen = out;
        const through = still.some((x) => x.slot === me);
        mood = cup.caught === me ? 'lose' : through ? 'win' : 'info';
        word = cup.caught === me ? 'Knocked out' : through ? 'Through' : out ? `${out.name} is out` : 'Next round';
        line = out && cup.caught !== me ? `${out.name} was the oni at the buzzer` : cup.caught === me ? 'The oni at the buzzer' : '';
        next = still.length === 2 ? 'Next: the Final' : still.length === 3 ? 'Next: the semi-final' : `${still.length} play on`;
      }
    } else {
      kicker = forfeit ? 'Match over' : res.mode === 'potato' ? 'Hot Potato' : 'Least Time';
      cast = res.winners.map(person);
      mood = watching ? 'info' : iWon ? 'win' : 'lose';
      word = watching ? (res.mode === 'potato' && res.loser >= 0 && !forfeit ? `${person(res.loser).name} loses` : `${cast[0]?.name || 'Nobody'} wins`) : iWon ? 'Victory' : 'Defeat';
      if (forfeit) line = 'Everyone else left';
      else if (res.mode === 'potato' && res.loser >= 0) {
        line = res.loser === me ? 'You were the oni at the buzzer' : `${person(res.loser).name} was the oni at the buzzer`;
        if (res.loser === me) cast = [{ ...person(me), out: true }]; // (you, alone with it)
      } else line = cast.length ? `Least time as the oni: ${cast.map((c) => c.name).join(', ')}` : '';
    }
    cast = cast.slice(0, 10);
    cast.sort((x, y) => (y.slot === me) - (x.slot === me));
    const grand = !between && (mood === 'win' || mood === 'info');
    const r = open('outcome', { mood, grade: cup?.final ? 'final' : between ? 'round' : '' });
    const W = innerWidth;
    const H = innerHeight;
    const color = side >= 0 ? TEAM_COLORS[side] : mood === 'lose' ? '#3a3340' : mood === 'draw' ? '#5b5348' : GOLD;
    r.style.setProperty('--a', color);
    r.classList.toggle('tall', H > W * 1.05);
    r.append(el('i', 'pz-veil'), el('i', 'pz-rays'), el('i', 'pz-band'), el('i', 'pz-flash'));
    const box = el('div', 'pz-result');
    box.append(el('span', 'pz-kicker', kicker));
    // the word, letter by letter
    const big = el('b', 'pz-word');
    big.setAttribute('aria-label', word);
    if (word.length > 12) big.classList.add('long');
    let k = 0;
    for (const part of word.split(' ')) {
      const w = el('span', 'w');
      for (const ch of part) {
        const s = el('i', '', ch);
        s.style.setProperty('--k', String(k++));
        w.append(s);
      }
      big.append(w);
    }
    box.append(big);
    if (cast.length) {
      const n = cast.length + (fallen ? 1 : 0);
      const cols = W < 560 && n > 5 ? Math.ceil(n / 2) : n;
      const size = fit(W * 0.92, H * 0.3, n, cols, n <= 2 ? 190 : 150);
      const row = el('div', 'pz-line');
      row.style.setProperty('--card', `${size}px`);
      row.style.maxWidth = `${cols * (size + 14)}px`;
      cast.forEach((p, i) => row.append(card(p, { i, from: 'up', me: p.slot === me, tag: p.out ? 'Oni' : '' })));
      if (fallen) row.append(card({ ...fallen, out: true }, { i: cast.length, from: 'up', me: fallen.slot === me, tag: 'Out' }));
      if (mood === 'win' || mood === 'info') row.classList.add('cheer');
      box.append(row);
    }
    if (line) box.append(el('span', 'pz-score', line));
    if (next) box.append(el('span', 'pz-next', next));
    r.append(box);
    const T = between ? 2500 : grand ? 2900 : 2500;
    sound(0, 'slam', 0.9);
    sound(140, mood === 'win' || (mood === 'info' && !between) ? 'fanfare' : mood === 'lose' ? 'defeat' : 'drum');
    if (mood === 'win' || grand) later(180, () => sparks(box, grand ? 30 : 18, [GOLD, '#fff', color]));
    res.presented = true; // (the results card need not make the same noise again)
    return new Promise((resolve) => {
      const my = token;
      done = (ok) => {
        done = null;
        resolve(ok && my === token);
      };
      later(T - 300, () => r.classList.add('out'));
      later(T, () => {
        const end = done;
        end?.(true);
        this.clear();
      });
    });
  },

  // any key or tap: enough of that (an ending only; a walk-on is over in a moment anyway)
  skip() {
    if (kind !== 'outcome' || !done) return;
    const end = done;
    end(true);
    this.clear();
  },

  clear() {
    const end = done;
    done = null;
    end?.(false);
    token++;
    for (const t of timers) clearTimeout(t);
    timers = [];
    kind = '';
    if (root) {
      root.hidden = true;
      root.textContent = '';
      root.className = '';
    }
  },
};
