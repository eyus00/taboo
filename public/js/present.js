// The occasions: what is shown when something that matters happens.
//
//   Before a round - ONE scene, over everything: the two sides (or a duel, or
//   everyone) come on face to face with the round's billing over them; then
//   the draw is revealed in the same picture - the stage, the art style, and
//   who starts as the oni (a light runs along the players and stops on them;
//   in a team game, who starts with a bomb).
//
//   After a round - the head of the results card: the word for it, whoever
//   won (with what each of them did), the score and what comes next. The
//   scoreboard sits right under it, on the same card.
//
// A scene is built from what the game already knows (the round message, the
// result message), never from anything of its own. Scenes only show; nothing
// here decides or delays anything in the match: the opening fits into the
// time the server leaves before the 3-2-1.
//
//   present.init({ sfx, portrait(slot, size, face), colorOf(slot), onCover(on) })
//   present.versus(info, { me, ms })   info: what play.js hands to onStart; returns the ms it will take (0: not shown)
//   present.hero(box, res, { me })     fills `box` (the head of the results card)
//   present.clear()   present.busy ('' | 'versus')
//
// Smoothness: everything that moves is a CSS animation of transform or
// opacity. An opening is built while the match behind it is being set up (the
// slow part), with its animations held; it only starts to move on a later
// frame, when the pictures are painted and the page is quiet again. While it
// covers the screen the match behind it is not drawn at all (onCover).

import { MODES, THEMES, TEAM_NAMES, TEAM_COLORS, twistById } from '/shared/config.js';
import { arenaById, ARENAS } from '/shared/arenas.js';
import { scenePreview, styleStill, styleReady } from './art.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const svg = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}" /></svg>`;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const WARM = '#c8372d';
const COOL = '#2f4f8f';
const GOLD = '#d9a53a';

let root = null;
let opts = {};
let timers = [];
let token = 0;
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
  }
  return root;
}

// One player: their character over a slab of their colour, and a name plate.
//   face: 1 looks right, -1 left; i: the place in the line (for the stagger); from: l | r | up
function card(p, { face = 1, i = 0, from = 'up', me = false, size = 192, tag = '', stats = null } = {}) {
  const c = el('div', `pz-card from-${from}${me ? ' me' : ''}${p.out ? ' gone' : ''}`);
  c.style.setProperty('--i', String(i));
  c.style.setProperty('--c', p.color || '#888');
  const pic = el('span', 'pz-pic');
  const url = opts.portrait?.(p.slot, size, face);
  if (url) {
    const img = el('img');
    img.alt = '';
    img.decoding = 'sync';
    img.src = url;
    pic.append(img);
  }
  c.append(el('i', 'pz-slab'), pic);
  const plate = el('span', 'pz-name', p.name);
  if (p.name.length > 9) plate.classList.add('long');
  c.append(plate);
  if (me) c.append(el('b', 'pz-you', 'You'));
  if (tag) c.append(el('b', 'pz-tag', tag));
  if (stats) {
    const row = el('span', 'pz-stats');
    for (const [icon, text, label, top] of stats) {
      const s = el('span', top ? 'st top' : 'st');
      s.innerHTML = svg(icon);
      s.append(text);
      s.title = label;
      row.append(s);
    }
    c.append(row);
  }
  return c;
}

// how big a card can be: `n` of them in `cols` columns inside w x h
const fit = (w, h, n, cols, max = 200) => {
  const rows = Math.ceil(n / cols);
  return Math.floor(Math.max(50, Math.min(max, w / cols - 12, (h / rows - 34) / 1.08)));
};

// a burst of sparks from the middle of `box`
function sparks(box, many, colors) {
  const fx = el('span', 'pz-sparks');
  for (let i = 0; i < many; i++) {
    const s = el('i');
    const a = Math.random() * Math.PI * 2;
    const far = 90 + Math.random() * 240;
    s.style.setProperty('--x', `${Math.round(Math.cos(a) * far)}px`);
    s.style.setProperty('--y', `${Math.round(Math.sin(a) * far * 0.7)}px`);
    s.style.setProperty('--d', `${(Math.random() * 0.12).toFixed(2)}s`);
    s.style.background = colors[i % colors.length];
    fx.append(s);
  }
  box.append(fx);
  setTimeout(() => fx.remove(), 1100);
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

// a small picture with two lines under a label: the stage, the style
function plate(label, name, url, i) {
  const p = el('div', 'pz-plate');
  p.style.setProperty('--i', String(i));
  const pic = el('span', 'pz-thumb');
  if (url) {
    const img = el('img');
    img.alt = '';
    img.decoding = 'sync';
    img.src = url;
    pic.append(img);
  }
  const words = el('span', 'pz-words');
  words.append(el('small', '', label), el('b', '', name));
  p.append(pic, words);
  return p;
}

export const present = {
  init(o) {
    opts = o || {};
  },
  get busy() {
    return kind;
  },

  // --- before a round: who is playing whom, where, and who starts as the oni ----------
  versus(info, { me = -1, ms = 5000 } = {}) {
    if (calm.matches || ms < 1500) return 0;
    const players = info.players.map((p) => ({ ...p, color: opts.colorOf?.(p.slot) }));
    if (players.length < 2) return 0;
    this.clear();
    const my = token;
    const deadline = performance.now() + ms;
    const teams = info.mode === 'team' && info.teams;
    const layout = teams ? 'team' : players.length === 2 ? 'duel' : 'ffa';
    const bill = billing(info);
    const r = layer();
    kind = 'versus';
    r.className = 'pz pz-versus hold';
    for (const k of Object.keys(r.dataset)) delete r.dataset[k];
    r.dataset.layout = layout;
    r.dataset.grade = bill.grade;
    const W = innerWidth;
    const H = innerHeight;
    const tall = H > W * 1.05;
    r.classList.toggle('tall', tall);
    // the ground: two slabs of colour that slide in from either side and meet on a slant
    const a = teams ? TEAM_COLORS[0] : layout === 'duel' ? players[0].color : WARM;
    const b = teams ? TEAM_COLORS[1] : layout === 'duel' ? players[1].color : COOL;
    r.style.setProperty('--a', a);
    r.style.setProperty('--b', b);
    r.append(el('i', 'pz-half l'), el('i', 'pz-half r'), el('i', 'pz-flash'));
    const twist = info.twist && info.twist !== 'none' ? twistById(info.twist) : null;
    let tally = '';
    if (teams && info.cup?.total && info.cup.round > 1) tally = `${TEAM_NAMES[0]} ${info.cup.total[0]} – ${info.cup.total[1]} ${TEAM_NAMES[1]}`;
    const head = el('div', 'pz-head');
    head.append(el('span', 'pz-kicker', bill.kicker), el('b', 'pz-title', bill.title));
    const note = [bill.note, tally, twist?.name ? `Twist: ${twist.name}` : ''].filter(Boolean).join(' · ');
    if (note) head.append(el('span', 'pz-note', note));
    r.append(head);
    const stage = el('div', 'pz-stage');
    r.append(stage);
    const emblem = el('b', 'pz-vs');
    const cards = new Map(); // slot -> its card
    const add = (line, p, o) => {
      const c = card(p, { ...o, me: p.slot === me });
      cards.set(p.slot, c);
      line.append(c);
    };
    if (layout === 'ffa') {
      // everyone for themselves: one line of all of them, coming on from both ends
      const n = players.length;
      const cols = tall ? (n <= 4 ? 2 : n <= 9 ? 3 : 4) : n <= 6 ? n : Math.ceil(n / 2);
      const size = fit(W * 0.94, H * (tall ? 0.5 : 0.42), n, cols, 190);
      const line = el('div', 'pz-line');
      line.style.setProperty('--card', `${size}px`);
      line.style.maxWidth = `${cols * (size + 14)}px`;
      players.forEach((p, i) => {
        const col = i % cols;
        const left = col < cols / 2;
        add(line, p, { face: left ? 1 : -1, i: left ? col : cols - 1 - col, from: left ? 'l' : 'r' });
      });
      emblem.innerHTML = '<i>All</i><span>VS</span><i>All</i>';
      emblem.classList.add('wide');
      stage.append(emblem, line);
    } else {
      const sides = teams ? [0, 1].map((t) => players.filter((p) => teams[p.slot] === t)) : [[players[0]], [players[1]]];
      for (const s of sides) s.sort((x, y) => (y.slot === me) - (x.slot === me)); // (you are the first of your own side)
      const most = Math.max(sides[0].length, sides[1].length);
      const cols = most <= 3 ? most : most === 4 ? 2 : 3;
      const size = layout === 'duel' ? Math.floor(Math.min(tall ? W * 0.46 : W * 0.26, H * (tall ? 0.22 : 0.38), 270)) : fit(tall ? W * 0.94 : W * 0.41, H * (tall ? 0.25 : 0.46), most, cols, 180);
      sides.forEach((list, t) => {
        const side = el('div', `pz-side ${t ? 'r' : 'l'}`);
        side.style.setProperty('--card', `${size}px`);
        if (teams) side.append(el('b', 'pz-team', TEAM_NAMES[t]));
        const line = el('div', 'pz-line');
        line.style.maxWidth = `${cols * (size + 14)}px`;
        list.forEach((p, i) => add(line, p, { face: t ? -1 : 1, i, from: t ? 'r' : 'l', size: layout === 'duel' ? 288 : 192 }));
        side.append(line);
        stage.append(side);
        if (!t) stage.append(emblem);
      });
      emblem.textContent = 'VS';
    }
    // The draw, in the same picture. Until it lands nothing is known: a plate says "?", the
    // players are blank tokens in their colours, the ground is plain. Then the style is drawn
    // (the players turn into that style's characters) and the stage (it shows through the
    // ground). What the host fixed beforehand is simply there from the start.
    const foot = el('div', 'pz-foot');
    const arena = arenaById(info.arena);
    const theme = THEMES.find((t) => t.id === info.theme);
    let stagePic = null;
    let stylePic = null;
    let groundPic = null;
    try {
      if (styleReady(info.theme)) {
        stagePic = scenePreview(info.arena, info.theme, 240, 135);
        stylePic = styleStill(info.theme, 240, 135);
        groundPic = scenePreview(info.arena, info.theme, 480, 270);
      }
    } catch {}
    const drawn = { theme: !!info.random?.theme && !!theme, arena: !!info.random?.arena && !!arena };
    const stylePlate = theme ? plate('Style', drawn.theme ? '?' : theme.name, stylePic, 0) : null;
    const stagePlate = arena ? plate('Stage', drawn.arena ? '?' : arena.name, stagePic, 1) : null;
    if (stylePlate) foot.append(stylePlate);
    if (stagePlate) foot.append(stagePlate);
    if (drawn.theme) {
      stylePlate.classList.add('unknown');
      r.classList.add('masked');
    }
    if (drawn.arena) stagePlate.classList.add('unknown');
    const ground = el('i', 'pz-ground');
    if (groundPic) ground.style.backgroundImage = `url("${groundPic}")`;
    r.insertBefore(ground, head);
    if (!drawn.arena) r.classList.add('staged');
    r.append(foot);
    r.hidden = false;
    opts.onCover?.(true);

    // Now wait for the page to go quiet (the match is being set up behind us), then let it move.
    const go = () => {
      if (my !== token) return;
      const T = deadline - performance.now(); // until GO
      if (T < 1500) return this.clear();
      const counted = T >= 4200; // the 3-2-1 is shown in here too
      const free = T - (counted ? 3100 : 400); // what there is before the count
      const long = free >= 4300;
      r.classList.remove('hold');
      const hit = 620;
      sound(40, 'whoosh');
      sound(hit, 'slam', bill.grade === 'final' ? 1 : 0.8);
      if (bill.grade) sound(hit + 240, 'drum');
      later(hit, () => sparks(stage, bill.grade === 'final' ? 22 : 14, bill.grade === 'final' ? [GOLD, '#fff', a, b] : ['#fff', a, b]));
      // a plate runs through names, then lands on the one that was drawn
      const land = (pl, isDrawn, names, final, at, dur, done) => {
        if (!pl) return at;
        if (!isDrawn) return at;
        const name = pl.querySelector('.pz-words b');
        const pool = names.filter((n) => n !== final);
        for (let t = at, k = 0; t < at + dur && pool.length; t += 75, k++) {
          const n = pool[(k * 7 + 3) % pool.length];
          later(t, () => {
            name.textContent = n;
            if (k % 2 === 0) opts.sfx?.play('tick', 0.5);
          });
        }
        later(at + dur, () => {
          name.textContent = final;
          pl.classList.remove('unknown');
          pl.classList.add('landed');
          opts.sfx?.play('pick', 0.8);
          done();
        });
        return at + dur;
      };
      const styleAt = land(stylePlate, drawn.theme, THEMES.map((t) => t.name), theme?.name, 1100, long ? 800 : 250, () => r.classList.remove('masked'));
      const stageAt = land(stagePlate, drawn.arena, ARENAS.map((x) => x.name), arena?.name, Math.max(1100, styleAt + 150), long ? 900 : 250, () => r.classList.add('staged'));
      // who starts as the oni: a light runs along the line and stops on them
      const mark = (slot, text, cls) => {
        const c = cards.get(slot);
        if (!c) return;
        c.classList.add('picked');
        c.append(el('b', `pz-mark ${cls}`, text));
      };
      const start = Math.min(Math.max(1500, stageAt + 350), free - 300);
      if (teams) {
        (info.bombs || []).forEach((slot, i) => later(start + i * 180, () => {
          mark(slot, 'Bomb', 'bomb');
          opts.sfx?.play('tick');
        }));
      } else if (info.it >= 0 && cards.has(info.it)) {
        const order = [...cards.keys()];
        const stop = order.indexOf(info.it);
        const steps = order.length * (order.length > 5 ? 1 : 2) + stop; // round the line, then on to them
        if (order.length > 1 && free - start >= steps * 120 + 200) {
          let at = start;
          for (let k = 0; k <= steps; k++) {
            const slot = order[k % order.length];
            const last = k === steps;
            later(at, () => {
              for (const c of cards.values()) c.classList.remove('lit');
              cards.get(slot).classList.add('lit');
              opts.sfx?.play('tick', 0.7);
              if (last) {
                mark(slot, 'Oni', 'oni');
                opts.sfx?.play('tagged');
              }
            });
            at += 55 + (k / steps) ** 3 * 240; // slower and slower
          }
        } else later(start, () => {
          mark(info.it, 'Oni', 'oni');
          opts.sfx?.play('tagged');
        });
      }
      // 3 - 2 - 1, big, where VS stood (the match makes the sounds for it)
      if (counted) {
        for (const n of [3, 2, 1]) later(T - n * 1000, () => {
          emblem.className = layout === 'ffa' ? 'pz-vs wide count' : 'pz-vs count'; // (the same box VS had: nothing shifts)
          emblem.textContent = String(n);
          emblem.style.animation = 'none';
          void emblem.offsetWidth;
          emblem.style.animation = '';
        });
      }
      const leave = counted ? 240 : 340;
      later(T - leave, () => {
        r.classList.add('out');
        opts.onCover?.(false);
        if (!counted) opts.sfx?.play('whoosh', 0.6);
      });
      later(T, () => this.clear());
    };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 0)));
    return ms;
  },

  // --- after a round: the head of the results card -------------------------------------
  // the word for it, who won (and what each of them did), the score, what comes next
  hero(box, res, { me = -1 } = {}) {
    box.textContent = '';
    box.className = 'pz-hero';
    if (!res?.rows?.length) return '';
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
    let side = -1; // a team's colour for the band
    if (team) {
      const tally = cup && team.total ? team.total : team.score;
      const lead = team.win; // (between rounds the head is about THIS round)
      side = lead;
      cast = lead >= 0 ? res.rows.filter((x) => x.team === lead).map((x) => person(x.slot)) : [];
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
        line = forfeit ? 'Everyone else left' : iWon ? 'The last one standing' : cast[0] ? `${cast[0].name} wins the knockout` : '';
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
    const color = side >= 0 ? TEAM_COLORS[side] : mood === 'lose' ? '#4a4250' : mood === 'draw' ? '#6a6156' : GOLD;
    box.dataset.mood = mood;
    box.dataset.grade = cup?.final ? 'final' : between ? 'round' : '';
    box.style.setProperty('--a', color);
    box.append(el('i', 'pz-band'), el('i', 'pz-rays'));
    const inner = el('div', 'pz-result');
    inner.append(el('span', 'pz-kicker', kicker));
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
    inner.append(big);
    if (cast.length) {
      // what each of them did: flags taken and bombs passed on (a team game), or tags made and time as the oni
      const rows = cast.map((p) => res.rows.find((x) => x.slot === p.slot)).filter(Boolean);
      const best = (key) => Math.max(0, ...rows.map((x) => x[key] || 0));
      const statsOf = (p) => {
        const x = res.rows.find((y) => y.slot === p.slot);
        if (!x || between || p.out) return null;
        if (team) return [['flag', String(x.caps || 0), 'flags taken', x.caps > 0 && x.caps === best('caps')], ['swap', String(x.tags), 'bombs passed on', x.tags > 0 && x.tags === best('tags')]];
        return [['target', String(x.tags), 'tags made', x.tags > 0 && x.tags === best('tags')], ['oni', `${(x.ms / 1000).toFixed(1)}s`, 'as the oni', false]];
      };
      const n = cast.length + (fallen ? 1 : 0);
      const W = Math.min(innerWidth, 860) * 0.92;
      const cols = innerWidth < 560 && n > 3 ? Math.ceil(n / 2) : n;
      const low = innerHeight < 780 || res.rows.length > 6;
      const size = Math.floor(Math.max(46, Math.min(n <= 2 ? 124 : low ? 76 : 104, W / cols - 14)));
      const row = el('div', 'pz-line');
      row.style.setProperty('--card', `${size}px`);
      row.style.maxWidth = `${cols * (size + 16)}px`;
      cast.forEach((p, i) => row.append(card(p, { i, from: 'up', me: p.slot === me, tag: p.out ? 'Oni' : '', size: 144, stats: size >= 70 ? statsOf(p) : null })));
      if (fallen) row.append(card({ ...fallen, out: true }, { i: cast.length, from: 'up', me: fallen.slot === me, tag: 'Out', size: 144 }));
      if (mood === 'win' || mood === 'info') row.classList.add('cheer');
      inner.append(row);
    }
    if (line) inner.append(el('span', 'pz-score', line));
    if (next) inner.append(el('span', 'pz-next', next));
    box.append(inner);
    if (!calm.matches) {
      opts.sfx?.play('slam', 0.8);
      if (mood === 'win' || grand) setTimeout(() => box.isConnected && sparks(inner, grand ? 22 : 14, [GOLD, '#fff', color]), 200);
    }
    return mood;
  },

  clear() {
    token++;
    for (const t of timers) clearTimeout(t);
    timers = [];
    if (kind) opts.onCover?.(false);
    kind = '';
    if (root) {
      root.hidden = true;
      root.textContent = '';
      root.className = '';
    }
  },
};
