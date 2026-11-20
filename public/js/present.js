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
//   present.interval(res, { me, back })   between the rounds of a tournament: the same screen with
//                                         the result on it, until the next round's draw begins there
//   present.clear()   present.busy ('' | 'versus' | 'interval')
//
// Smoothness: everything that moves is a CSS animation of transform or
// opacity. An opening is built while the match behind it is being set up (the
// slow part), with its animations held; it only starts to move on a later
// frame, when the pictures are painted and the page is quiet again. While it
// covers the screen the match behind it is not drawn at all (onCover).

import { MODES, THEMES, TEAM_NAMES, TEAM_COLORS, twistById } from '/shared/config.js';
import { arenaById, ARENAS } from '/shared/arenas.js';
import { scenePreview, styleStill, styleReady, styleThumb, arenaThumb } from './art.js';

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
function card(p, { face = 1, i = 0, from = 'up', me = false, size = 192, tag = '', stats = null, sad = false } = {}) {
  const c = el('div', `pz-card from-${from}${me ? ' me' : ''}${p.out ? ' gone' : ''}`);
  c.style.setProperty('--i', String(i));
  c.style.setProperty('--c', p.color || '#888');
  const pic = el('span', 'pz-pic');
  // (sad: the style's own drawing of this character having lost - see pv.sad in the styles)
  const url = opts.portrait?.(p.slot, size, face, sad ? { sad: true } : undefined);
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
    for (const [icon, text, label, tone] of stats) {
      const s = el('span', tone ? `st ${tone}` : 'st');
      s.innerHTML = svg(icon);
      if (text) s.append(text);
      s.title = label;
      row.append(s);
    }
    c.append(row);
  }
  return c;
}

// What one player did, in as few tags as say it (each: [icon, text, what it means, tone]):
//   a team game - a bomb, if one went off in their hands; bombs passed on; flags taken;
//   everyone for themselves - how long they were the oni, how many tags they made.
// Nothing is shown for a nought.
function tagsFor(res, x) {
  if (!x) return null;
  const list = [];
  if (res.team) {
    if (x.boom) list.push(['bomb', '', 'A bomb went off in their hands', 'boom']);
    if (x.tags > 0) list.push(['swap', String(x.tags), `${x.tags} bomb${x.tags === 1 ? '' : 's'} passed on`, '']);
    if (x.caps > 0) list.push(['flag', String(x.caps), `${x.caps} flag${x.caps === 1 ? '' : 's'} taken`, '']);
  } else {
    list.push(['oni', `${Math.round(x.ms / 1000)}s`, 'Time as the oni', '']);
    if (x.tags > 0) list.push(['target', String(x.tags), `${x.tags} tag${x.tags === 1 ? '' : 's'} made`, '']);
  }
  return list.length ? list : null;
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

// A reel of the draw: a paper card with what it is and the name over a window, and in the
// window a strip of pictures - "?" first, then some it might have been, last the one it is.
// Spun, the strip runs up through the window and stops on the last (see `land` in versus).
//   cells: [{ name, url }]  the last is the one drawn; one cell: nothing to spin
function plate(label, name, cells, i) {
  const p = el('div', 'pz-plate');
  p.style.setProperty('--i', String(i));
  const words = el('span', 'pz-words');
  words.append(el('small', '', label), el('b', '', name));
  const win = el('span', 'pz-thumb');
  const strip = el('span', 'pz-strip');
  const list = Array.isArray(cells) ? cells : [];
  strip.style.setProperty('--n', String(Math.max(1, list.length)));
  for (const c of list) {
    const cell = el('span', c.url ? 'pz-cell' : 'pz-cell blank', c.url ? null : c.name);
    if (c.url) {
      const img = el('img');
      img.alt = '';
      img.decoding = 'sync';
      img.src = c.url;
      cell.append(img);
    }
    strip.append(cell);
  }
  win.append(strip);
  p.append(words, win);
  return p;
}
// where a team tournament stands: the two sides and their tally, large
function tallyStrip(total, small) {
  const strip = el('div', 'pz-tally');
  const side = (t) => {
    const e = el('span', `ts t${t}`);
    e.style.setProperty('--side', TEAM_COLORS[t]);
    e.append(el('i', '', TEAM_NAMES[t]), el('b', '', String(total[t])));
    return e;
  };
  strip.append(side(0), el('span', 'dash', '–'), side(1));
  if (small) strip.append(el('small', '', small));
  return strip;
}

export const present = {
  init(o) {
    opts = o || {};
  },
  get busy() {
    return kind;
  },

  // The picture both scenes share: the ground in two colours, the billing at the top with the
  // two plates of the draw under it, the players in the middle (two sides and VS, or everyone
  // in a line), and room at the foot for a board.
  //   players: [{ slot, name, color, out?, won?, stats? }]   teams: team of each slot, or null
  //   keep: this follows another scene of the same shape - nothing comes on again, it is just there
  frame({ name, players, teams, me, bill, note, plates, keep }) {
    const layout = teams ? 'team' : players.length === 2 ? 'duel' : 'ffa';
    const r = layer();
    kind = name;
    r.className = `pz pz-versus pz-${name} hold${keep ? ' keep' : ''}`;
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
    const ground = el('i', 'pz-ground');
    r.append(el('i', 'pz-half l'), el('i', 'pz-half r'), ground);
    const top = el('div', 'pz-top');
    const head = el('div', 'pz-head');
    head.append(el('span', 'pz-kicker', bill.kicker), el('b', 'pz-title', bill.title));
    if (bill.title.length > 14) head.lastChild.classList.add('long');
    if (note) head.append(el('span', 'pz-note', note));
    // the draw: in which style, and where
    const draw = el('div', 'pz-draw');
    for (const p of plates) if (p) draw.append(p);
    top.append(head, draw);
    r.append(top);
    const stage = el('div', 'pz-stage');
    r.append(stage);
    const emblem = el('b', 'pz-vs');
    const cards = new Map(); // slot -> its card
    const add = (line, p, o, size) => {
      // (their tags only where a card is wide enough to carry them)
      const c = card(p, { ...o, me: p.slot === me, tag: p.out ? 'Out' : '', stats: size >= 72 ? p.stats || null : null, sad: !!p.sad });
      if (p.won) c.classList.add('won');
      if (p.sad) c.classList.add('sad');
      cards.set(p.slot, c);
      line.append(c);
    };
    if (layout === 'ffa') {
      // everyone for themselves: one line of all of them, coming on from both ends
      const n = players.length;
      const cols = tall ? (n <= 4 ? 2 : n <= 9 ? 3 : 4) : n <= 6 ? n : Math.ceil(n / 2);
      const size = fit(W * 0.94, H * (tall ? 0.4 : 0.31), n, cols, 190);
      const line = el('div', 'pz-line');
      line.style.setProperty('--card', `${size}px`);
      line.style.maxWidth = `${cols * (size + 14)}px`;
      players.forEach((p, i) => {
        const col = i % cols;
        const left = col < cols / 2;
        add(line, p, { face: left ? 1 : -1, i: left ? col : cols - 1 - col, from: left ? 'l' : 'r' }, size);
      });
      emblem.innerHTML = '<i>All</i><span>VS</span><i>All</i>';
      emblem.classList.add('wide');
      stage.append(emblem, line);
    } else {
      const sides = teams ? [0, 1].map((t) => players.filter((p) => teams[p.slot] === t)) : [[players[0]], [players[1]]];
      for (const s of sides) s.sort((x, y) => (y.slot === me) - (x.slot === me)); // (you are the first of your own side)
      const most = Math.max(sides[0].length, sides[1].length, 1);
      const cols = most <= 3 ? most : most === 4 ? 2 : 3;
      const size = layout === 'duel' ? Math.floor(Math.min(tall ? W * 0.42 : W * 0.24, H * (tall ? 0.18 : 0.33), 250)) : fit(tall ? W * 0.94 : W * 0.41, H * (tall ? 0.2 : 0.4), most, cols, 180);
      sides.forEach((list, t) => {
        const side = el('div', `pz-side ${t ? 'r' : 'l'}`);
        side.style.setProperty('--card', `${size}px`);
        if (teams) side.append(el('b', 'pz-team', TEAM_NAMES[t]));
        const line = el('div', 'pz-line');
        line.style.maxWidth = `${cols * (size + 14)}px`;
        list.forEach((p, i) => add(line, p, { face: t ? -1 : 1, i, from: t ? 'r' : 'l', size: layout === 'duel' ? 288 : 192 }, size));
        side.append(line);
        stage.append(side);
        if (!t) stage.append(emblem);
      });
      emblem.textContent = 'VS';
    }
    const board = el('div', 'pz-board');
    r.append(board);
    r.hidden = false;
    opts.onCover?.(true);
    return { r, layout, stage, emblem, cards, ground, board, a, b };
  },

  // --- before a round: who is playing whom, and the draw: style, stage, who starts as the oni ---
  versus(info, { me = -1, ms = 5000 } = {}) {
    const players = info.players.map((p) => ({ ...p, color: opts.colorOf?.(p.slot) }));
    if (calm.matches || ms < 1500 || players.length < 2) {
      this.clear();
      return 0;
    }
    const keep = kind === 'interval'; // straight on from the last round's result, on the same screen
    this.clear();
    const my = token;
    const deadline = performance.now() + ms;
    const teams = info.mode === 'team' && info.teams ? info.teams : null;
    const bill = billing(info);
    const twist = info.twist && info.twist !== 'none' ? twistById(info.twist) : null;
    // The draw. Until it lands nothing is known: a plate says "?", the players are blank tokens
    // in their colours, the ground is plain. Then the style is drawn (the players turn into
    // that style's characters) and the stage (it shows through the ground). What the host
    // fixed beforehand is simply there from the start.
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
    // (a reel: "?", a handful of the others - whatever pictures of them are already painted - and the one drawn)
    const others = (all, own, pic) => {
      const rest = all.filter((x) => x.id !== own.id);
      const pick = [];
      for (let k = 0; k < Math.min(6, rest.length); k++) pick.push(rest[(k * 5 + (info.cup?.round || 0) * 3 + own.name.length) % rest.length]);
      return [{ name: '?' }, ...pick.map((x) => ({ name: x.name, url: pic(x.id) })), { name: own.name, url: pic(own.id, true) }];
    };
    const styleCells = !theme ? [] : drawn.theme ? others(THEMES, theme, (id, mine) => (mine ? stylePic : styleThumb(id))) : [{ name: theme.name, url: stylePic }];
    const stageCells = !arena ? [] : drawn.arena ? others(ARENAS, arena, (id, mine) => (mine ? stagePic : arenaThumb(id, [info.theme]))) : [{ name: arena.name, url: stagePic }];
    const stylePlate = theme ? plate('Style', drawn.theme ? '?' : theme.name, styleCells, 0) : null;
    const stagePlate = arena ? plate('Stage', drawn.arena ? '?' : arena.name, stageCells, 1) : null;
    if (drawn.theme) stylePlate.classList.add('unknown');
    if (drawn.arena) stagePlate.classList.add('unknown');
    const f = this.frame({ name: 'versus', players, teams, me, bill, note: [bill.note, twist?.name ? `Twist: ${twist.name}` : ''].filter(Boolean).join(' · '), plates: [stylePlate, stagePlate], keep });
    const { r, stage, cards, a, b } = f;
    if (drawn.theme) r.classList.add('masked');
    if (groundPic) f.ground.style.backgroundImage = `url("${groundPic}")`;
    if (!drawn.arena) r.classList.add('staged');
    // (a team tournament: where the sides stand, at the foot)
    if (teams && info.cup?.total && info.cup.round > 1) f.board.append(tallyStrip(info.cup.total, ''));

    // Now wait for the page to go quiet (the match is being set up behind us), then let it move.
    const go = () => {
      if (my !== token) return;
      const T = deadline - performance.now(); // until GO
      if (T < 1500) return this.clear();
      // The scene parts before the 3-2-1: for those three seconds the stage and where everyone
      // stands are in plain view, so there is time to choose where to run.
      const view = T >= 5200 ? 3000 : 0;
      const end = T - view; // when it is gone
      const free = end - 450; // what there is for the draw
      const long = free >= 4300;
      r.classList.remove('hold');
      const hit = keep ? 0 : 620;
      if (!keep) {
        sound(40, 'whoosh', 0.6);
        sound(hit, 'slam', bill.grade === 'final' ? 0.6 : 0.42);
        later(hit, () => sparks(stage, bill.grade === 'final' ? 14 : 8, bill.grade === 'final' ? [GOLD, '#fff', a, b] : ['#fff', a, b]));
      }
      if (bill.grade) sound(hit + 240, 'drum');
      const t0 = keep ? 500 : 1100; // when the draw begins
      // a plate runs through names, then lands on the one that was drawn
      const land = (pl, isDrawn, names, final, at, dur, done) => {
        if (!pl || !isDrawn) return at;
        const name = pl.querySelector('.pz-words b');
        // the reel spins for exactly as long as the names run
        later(at, () => {
          pl.style.setProperty('--spin', `${dur}ms`);
          pl.classList.add('spin');
        });
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
      const styleAt = land(stylePlate, drawn.theme, THEMES.map((t) => t.name), theme?.name, t0, long ? 1000 : 300, () => r.classList.remove('masked'));
      const stageAt = land(stagePlate, drawn.arena, ARENAS.map((x) => x.name), arena?.name, Math.max(t0, styleAt + 150), long ? 1100 : 300, () => r.classList.add('staged'));
      // who starts as the oni: a light runs along the line and stops on them
      const mark = (slot, text, cls) => {
        const c = cards.get(slot);
        if (!c) return;
        c.classList.add('picked');
        const m = el('b', `pz-mark ${cls}`, text);
        if (!text) m.innerHTML = svg(cls); // (a sign instead of a word: the bomb)
        c.append(m);
      };
      const start = Math.min(Math.max(t0 + 400, stageAt + 350), free - 300);
      if (teams) {
        (info.bombs || []).forEach((slot, i) => later(start + i * 180, () => {
          mark(slot, '', 'bomb');
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
      later(end - 380, () => {
        r.classList.add('out');
        opts.onCover?.(false);
        opts.sfx?.play('whoosh', 0.4);
      });
      later(end, () => this.clear());
    };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 0)));
    return ms;
  },

  // --- between the rounds of a tournament: the same screen, with how the round went --------
  // The winners are marked (in a knockout, whoever went out), everyone has their numbers,
  // the board at the foot says where the tournament stands and counts down to the next round -
  // whose draw then begins right here (see `keep` in versus).
  //   back: { label, run }  a way out (ending the tournament, or leaving)
  interval(res, { me = -1, back = null } = {}) {
    const cup = res?.cup;
    if (calm.matches || !cup || cup.final || !res.rows?.length) return false;
    this.clear();
    const my = token;
    const team = res.team;
    const mine = res.rows.find((x) => x.slot === me);
    const stillIn = cup.ko ? cup.table.filter((x) => !x.out) : [];
    const through = stillIn.some((x) => x.slot === me);
    const players = res.rows.map((x) => ({
      slot: x.slot,
      name: x.name,
      color: opts.colorOf?.(x.slot),
      out: cup.ko && cup.caught === x.slot,
      won: team ? team.win === x.team : cup.caught >= 0 && cup.caught !== x.slot,
      sad: team ? team.win >= 0 && team.win !== x.team : cup.caught === x.slot,
      stats: tagsFor(res, x),
    }));
    if (players.length < 2) return false;
    const teams = team ? Object.fromEntries(res.rows.map((x) => [x.slot, x.team])) : null;
    let title;
    let mood;
    let kicker;
    const board = [];
    if (team) {
      kicker = `Round ${cup.round} of ${cup.rounds} · Team Bomb`;
      mood = team.win < 0 ? 'draw' : !mine ? 'info' : mine.team === team.win ? 'win' : 'lose';
      title = team.win < 0 ? 'Round drawn' : !mine ? `${TEAM_NAMES[team.win]} take it` : mine.team === team.win ? 'Round won' : 'Round lost';
      // (the round's own score under the tally: it is what decided it)
      board.push(tallyStrip(team.total || team.score, `This round ${team.score[0]} \u2013 ${team.score[1]}`));
    } else {
      const out = res.rows.find((x) => x.slot === cup.caught);
      kicker = `Knockout · round ${cup.round} of ${cup.rounds}`;
      mood = cup.caught === me ? 'lose' : through ? 'win' : 'info';
      title = cup.caught === me ? 'Knocked out' : through ? 'Through' : out ? `${out.name} is out` : 'Next round';
      const strip = el('div', 'pz-tally');
      strip.append(el('b', 'n', String(stillIn.length)), el('span', 'what', stillIn.length === 2 ? 'left: the Final is next' : stillIn.length === 3 ? 'left: the semi-final is next' : 'left'));
      board.push(strip);
    }
    const unknown = (label, i) => {
      const p = plate(label, '?', [{ name: '?' }], i);
      p.classList.add('unknown');
      return p;
    };
    const f = this.frame({ name: 'interval', players, teams, me, bill: { kicker, title, grade: '' }, note: cup.tie ? 'Level: a tie-break decides it' : '', plates: [unknown('Next style', 0), unknown('Next stage', 1)] });
    f.r.dataset.mood = mood;
    // the countdown to the next round, and the way out
    const next = el('div', 'pz-wait');
    const n = el('b', '', '');
    next.append(el('span', '', cup.tie ? 'Tie-break in' : 'Next round in'), n);
    const foot = el('div', 'pz-row');
    foot.append(next);
    if (back) {
      const btn = el('button', 'pz-btn', back.label);
      btn.type = 'button';
      btn.addEventListener('click', () => back.run());
      foot.append(btn);
    }
    f.board.append(...board, foot);
    const until = performance.now() + (Number(cup.next) || 0);
    const tick = () => {
      if (my !== token) return;
      const left = Math.max(0, Math.ceil((until - performance.now()) / 1000));
      if (n.textContent !== String(left)) {
        n.textContent = String(left);
        if (left > 0 && left <= 3) opts.sfx?.play('tick', 0.8);
      }
      timers.push(setTimeout(tick, 200));
    };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (my !== token) return;
      f.r.classList.remove('hold');
      opts.sfx?.play('whoosh', 0.5);
      if (mood === 'win') later(500, () => sparks(f.stage, 10, [GOLD, '#fff']));
      tick();
    }));
    return true;
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
      // what each of them did (see tagsFor)
      const statsOf = (p) => (between || p.out ? null : tagsFor(res, res.rows.find((y) => y.slot === p.slot)));
      const n = cast.length + (fallen ? 1 : 0);
      const W = Math.min(innerWidth, 860) * 0.92;
      const cols = innerWidth < 560 && n > 3 ? Math.ceil(n / 2) : n;
      const low = innerHeight < 780 || res.rows.length > 6;
      const size = Math.floor(Math.max(46, Math.min(n <= 2 ? 124 : low ? 76 : 104, W / cols - 14)));
      const row = el('div', 'pz-line');
      row.style.setProperty('--card', `${size}px`);
      row.style.maxWidth = `${cols * (size + 16)}px`;
      cast.forEach((p, i) => {
        const c = card(p, { i, from: 'up', me: p.slot === me, tag: p.out ? 'Oni' : '', size: 144, stats: size >= 70 ? statsOf(p) : null, sad: !!p.out });
        row.append(c);
      });
      if (fallen) row.append(card({ ...fallen, out: true }, { i: cast.length, from: 'up', me: fallen.slot === me, tag: 'Out', size: 144, sad: true }));
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
