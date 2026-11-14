// Everything that happens while a match is on screen: the renderer, the frame
// loop, the heads-up display, touch controls, and turning game events into
// pictures, words and sound.
//
// The heads-up display, and where each part sits:
//   top left      the minimap; under it, in a free-for-all, the list of players
//   top centre    the clock; in a team battle each side's score beside it and
//                 that side's players beyond the score (Sun left, Moon right),
//                 the flags and the name of the round underneath
//   top right     the menu button
//   bottom        the "kit": what you are (it / carrying a bomb), the item in
//                 your hands, boosts that are running
//   above the kit the item draw: a small reel that rolls while a lucky box's
//                 item is being armed, stops on it and drops into the item tile
//   upper middle  for the 3-2-1 only: the objective card (what this mode asks
//                 of you, the twist, who leads, the controls in a first match)
//
// The menus (main.js) only call a handful of things here:
//   play.init({ socket, isTouch, onStart(info), onEnd(results), onPause() })
//   play.practice(settings, name)        a match against bots
//   play.round(msg, mySlot)              an online round is starting
//   play.finish() / play.stop() / play.hold(true|false)
//   play.nameOf(slot), play.colorOf(slot), play.portraitOf(slot), play.mySlot(), play.el.spin

import { MODES, TICK_RATE, COUNTDOWN_MS, ITEM_KINDS, ITEM_INFO, ITEM_ARM_TICKS, TEAM_NAMES, TEAM_COLORS, BOMB_POINTS, FLAG_POINTS, PW, PH, THEMES } from '/shared/config.js';
import { ARENA_IDS, arenaById } from '/shared/arenas.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { NetGame } from './net.js';
import { LocalGame } from './local.js';
import { loadTheme } from './themes/index.js';
import { playerPortrait } from './art.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#pi-${name}" /></svg>`;
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
const calm = matchMedia('(prefers-reduced-motion: reduce)');

const ITEM_LAND_MS = 720; // the item draw, once it has stopped: its name for a moment, then into the tile
const FIRST_MATCHES = 3; // how many matches start with a reminder of the controls

// item icons (and a few others), kept here so the match needs nothing from the page
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="pi-left" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-right" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-up" viewBox="0 0 24 24"><path d="M5 14l7-7 7 7M5 20l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-down" viewBox="0 0 24 24"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></symbol>
<symbol id="pi-speed" viewBox="0 0 24 24"><path d="M14 2L5 13.5h6L8.5 22 19 9.8h-6z" fill="currentColor"/></symbol>
<symbol id="pi-jump" viewBox="0 0 24 24"><path d="M5 11l7-7 7 7M5 20l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-shield" viewBox="0 0 24 24"><path d="M12 2l8 3.6v6.6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.800-8-9.800V5.600z" fill="currentColor"/></symbol>
<symbol id="pi-freeze" viewBox="0 0 24 24"><path d="M12 2v20M3.3 7l17.400 10M20.700 7L3.300 17" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></symbol>
<symbol id="pi-blast" viewBox="0 0 24 24"><path d="M12 1l2.6 6.2L21 4.5l-2.700 6.400L23 12l-4.700 1.100L21 19.500l-6.400-2.700L12 23l-2.600-6.200L3 19.500l2.700-6.400L1 12l4.700-1.100L3 4.500l6.400 2.700z" fill="currentColor"/></symbol>
<symbol id="pi-swap" viewBox="0 0 24 24"><path d="M4 8h14l-4-4M20 16H6l4 4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-storm" viewBox="0 0 24 24"><path d="M6 13a5 5 0 1 1 3.5-8.5A6 6 0 0 1 20 8a4 4 0 0 1-2 7.500" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M12 12l-3 5h4l-2 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-goo" viewBox="0 0 24 24"><path d="M12 2c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z" fill="currentColor"/></symbol>
<symbol id="pi-box" viewBox="0 0 24 24"><path d="M8 9a4 4 0 1 1 6 3.5c-1.300.800-2 1.500-2 3M12 19.500v.500" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></symbol>
<symbol id="pi-it" viewBox="0 0 24 24"><path d="M6 2.5c.3 2.6 1.300 4.300 3.200 5.400M18 2.500c-.300 2.600-1.300 4.300-3.200 5.400" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M5.5 9.5h13l-1 8.200c-.400 2.600-2.600 4.300-5.500 4.300s-5.100-1.700-5.500-4.300z" fill="currentColor"/></symbol>
<symbol id="pi-bomb" viewBox="0 0 24 24"><circle cx="10" cy="15" r="7.5" fill="currentColor"/><path d="M13.3 8.2l2.9-2.900 2.500 2.500-2.900 2.900z" fill="currentColor"/><path d="M17.8 5.9c.7-1.700 1.900-2.600 3.400-2.700" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M21.6 1v1.300M23.300 3.300H22M22.900 1.500l-.900.900" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></symbol>
<symbol id="pi-flag" viewBox="0 0 24 24"><path d="M6 22V3M6 4h12l-3 4 3 4H6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-clock" viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7.8" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 9v4.500l3 2M9.500 2.500h5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-crown" viewBox="0 0 24 24"><path d="M3.5 19L2 7.500l5.500 4.300L12 4l4.500 7.800L22 7.500 20.500 19z" fill="currentColor"/></symbol>
<symbol id="pi-twist" viewBox="0 0 24 24"><path d="M12 1.5l2.5 7.500 7.500 2.500-7.500 2.500-2.500 7.500-2.500-7.500L2 11.500 9.500 9z" fill="currentColor"/></symbol>
<symbol id="pi-eye" viewBox="0 0 24 24"><path d="M2 12c2.800-4.700 6.100-7 10-7s7.200 2.300 10 7c-2.800 4.700-6.100 7-10 7s-7.200-2.300-10-7z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></symbol>
</defs></svg>`;

export const play = {
  renderer: null,
  input: null,
  sfx: null,
  net: null,
  game: null, // the match on screen: play.net or a LocalGame
  kind: 'online', // online | practice
  running: false,
  info: null, // what the current round is: { arena, theme, mode, cup, twist, players, it, teams }
  el: {},

  init(opts) {
    this.opts = opts;
    const root = document.getElementById('game');
    root.innerHTML = `${SPRITE}
      <div id="stage"></div>
      <div id="hud">
        <canvas id="minimap" width="220" height="124" aria-hidden="true"></canvas>
        <ul id="pills" aria-label="Players"></ul>
        <div id="top">
          <div class="h-wing a"><ul id="roster-a" class="h-roster" aria-label="${TEAM_NAMES[0]}"></ul><b id="team-a" class="h-score" hidden></b></div>
          <div id="timer" aria-label="Seconds left">60</div>
          <div class="h-wing b"><b id="team-b" class="h-score" hidden></b><ul id="roster-b" class="h-roster" aria-label="${TEAM_NAMES[1]}"></ul></div>
          <div id="flags" hidden></div>
          <div id="round-label"></div>
        </div>
        <button id="btn-pause" class="hud-btn" aria-label="Menu (Esc)">${icon('menu')}</button>
        <kbd class="hud-key">Esc</kbd>
        <div id="kit">
          <div id="status" hidden><span class="sign"></span><b></b></div>
          <div id="itemslot" hidden><span class="tile"><span class="pic"></span></span><kbd>E</kbd><span class="cap"></span></div>
          <div id="buffs"></div>
        </div>
        <div id="itemdraw" hidden aria-hidden="true"><div class="box"><div class="win"><div class="strip"></div></div></div><div class="tag"><b></b><kbd>E</kbd></div></div>
        <div id="banner" role="status"></div>
        <div id="brief" hidden></div>
        <div id="count" aria-hidden="true"></div>
        <div id="spin"></div>
      </div>
      <div id="touch" class="touch" hidden>
        <div class="pad" data-pad><span data-side="l">${icon('left')}</span><span data-side="r">${icon('right')}</span></div>
        <div class="acts">
          <button class="t-use" data-bit="16" aria-label="Use item">${icon('box')}</button>
          <button class="t-down" data-bit="8" aria-label="Down">${icon('down')}</button>
          <button class="t-jump" data-bit="4" aria-label="Jump">${icon('up')}</button>
        </div>
      </div>`;
    for (const id of ['stage', 'hud', 'pills', 'top', 'timer', 'team-a', 'team-b', 'roster-a', 'roster-b', 'flags', 'round-label', 'btn-pause', 'minimap', 'kit', 'status', 'itemslot', 'buffs', 'itemdraw', 'banner', 'brief', 'count', 'spin', 'touch']) this.el[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = root.querySelector(`#${id}`);
    const E = this.el;
    E.use = E.touch.querySelector('.t-use');
    E.itemPic = E.itemslot.querySelector('.pic');
    E.itemCap = E.itemslot.querySelector('.cap');
    E.reelStrip = E.itemdraw.querySelector('.strip');
    E.reelName = E.itemdraw.querySelector('.tag b');
    this.root = root;
    this.isTouch = opts.isTouch;
    // on touch screens the view can scroll a little past the floor, so the buttons never cover you
    // room under the arena: for the thumb buttons on a phone, for the item plaque on a computer
    this.renderer = new Renderer(this.el.stage, { padBottom: opts.isTouch ? 104 : 24, touch: !!opts.isTouch });
    this.input = new Input();
    this.sfx = new Sfx();
    this.net = new NetGame(opts.socket, this.input, (t, a, b) => this.onEvent(t, a, b));
    this.input.bindTouch(this.el.touch);
    this.renderer.onEvent = (type, pv) => this.sfx.play(type, pv.local ? 1 : 0.35);
    this.el.btnPause.addEventListener('click', () => opts.onPause?.());
    const s = opts.socket;
    s.on('s', (m) => this.game === this.net && this.net.onSnap(m));
    s.on('go', (it, bombs) => this.game === this.net && this.net.onGo(it, bombs));
    s.on('tag', (from, to) => this.game === this.net && this.onEvent('tag', from, to));
    s.on('block', (from, to) => this.game === this.net && this.onEvent('block', from, to));
    s.on('pick', (slot, k) => this.game === this.net && this.onEvent('pick', slot, k));
    s.on('ev', (e) => this.game === this.net && this.onEvent(e.type, e));
    this.hud = { sec: -1, count: 0, pills: [], buffs: '', item: '', teams: '', at: 0, mapAt: 0 };
  },

  nameOf(slot) {
    return this.game?.names?.[slot] || `Player ${slot + 1}`;
  },
  mySlot() {
    return this.game === this.net ? this.net.mySlot : 0;
  },
  // the colour each player is drawn in this round (teams hand out warm and cool colours)
  colorOf(slot) {
    const th = this.renderer.theme;
    const cols = this.info?.cols;
    return th ? th.colors[cols ? cols[slot] ?? slot : slot] : '#888';
  },
  // a picture of a player's character as it looks in this round: a data URL (see playerPortrait in art.js for opts), or null
  portraitOf(slot, opts) {
    const th = this.renderer.theme;
    const cols = this.info?.cols;
    return th ? playerPortrait(th.id, cols ? cols[slot] ?? slot : slot, opts) : null;
  },

  // --- starting and stopping ----------------------------------------------------------
  async practice(s, name) {
    const arena = arenaById(s.arena === 'random' ? pickRandom(ARENA_IDS) : s.arena);
    const themeId = s.theme === 'random' ? pickRandom(THEMES).id : s.theme;
    await loadTheme(themeId);
    this.kind = 'practice';
    // "play again" keeps the same bots on the same sides, as long as you ask for the same kind of match
    const key = `${s.mode}/${s.bots}/${name}`;
    const squad = this.squad && this.squad.key === key ? this.squad : null;
    const g = new LocalGame({ arena, mode: s.mode, duration: s.duration, powerups: s.powerups, name, bots: s.bots, input: this.input, onEvent: (t, a, b) => this.onEvent(t, a, b), squad });
    this.squad = { key, ...g.squad };
    this.begin(g, arena, themeId, { ...g.info(), arena: arena.id, theme: themeId, random: { arena: s.arena === 'random', theme: s.theme === 'random' } });
  },

  // 'round' from the server
  round(msg, mySlot) {
    const arena = arenaById(msg.arena);
    this.net.onRound(msg, arena, mySlot);
    this.kind = 'online';
    this.game = this.net; // snapshots count from now, even while the art style is still loading
    loadTheme(msg.theme).then(() => {
      if (this.net.round === msg) this.begin(this.net, arena, msg.theme, msg);
    });
  },

  begin(g, arena, themeId, info) {
    this.game = g;
    this.info = info;
    this.sfx.setTheme(themeId);
    this.opts.onStart?.(info); // the menus show the match screen now
    this.renderer.setScene(arena, themeId, info.cols || null);
    this.root.style.background = this.renderer.theme.letterbox;
    const h = this.hud;
    const E = this.el;
    clearTimeout(h.itemTimer);
    clearTimeout(h.briefTimer);
    Object.assign(h, { sec: -1, count: 0, buffs: '', pills: [], item: '', teams: '', crowd: 0, sides: '', role: '', hot: false, side: -2, briefOn: false });
    E.status.hidden = true;
    E.pills.textContent = '';
    E.rosterA.textContent = '';
    E.rosterB.textContent = '';
    E.buffs.textContent = '';
    E.count.textContent = '';
    E.count.className = '';
    E.banner.className = '';
    E.itemslot.hidden = true;
    E.itemslot.className = '';
    this.reelOff();
    this.setUse('');
    const team = info.mode === 'team';
    E.hud.className = team ? 'team' : 'ffa';
    E.pills.className = '';
    for (const [id, t] of [['teamA', 0], ['teamB', 1]]) {
      E[id].hidden = !team;
      E[id].style.background = TEAM_COLORS[t];
    }
    E.flags.hidden = !team;
    E.flags.textContent = '';
    h.flagEls = [];
    if (team) {
      // one marker per flag, in the order they stand on the map: a letter, and a bar that fills with a team's colour
      arena.bases.forEach((_, i) => {
        const chip = el('div', 'flagchip');
        chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#pi-flag"/></svg>';
        const bar = el('span', 'meter');
        const fill = el('i');
        bar.append(fill);
        chip.append(el('b', '', 'ABCD'[i]), bar);
        E.flags.append(chip);
        h.flagEls.push({ chip, fill, sig: '' });
      });
    }
    const mode = MODES.find((m) => m.id === info.mode)?.name || '';
    let label = this.kind === 'practice' ? `Practice · ${mode}` : mode;
    if (info.cup) {
      label = info.cup.double ? 'Final round - double points' : `Round ${info.cup.round} of ${info.cup.rounds}`;
      if (team) label += ' · Team Bomb';
      if (info.twist && info.twist !== 'none' && g.twist?.name) label += ` · ${g.twist.name}`;
    }
    E.roundLabel.textContent = label;
    // the first few matches start with a reminder of the controls (on the objective card)
    let played = 0;
    try {
      played = Number(localStorage.getItem('tag.played')) || 0;
      localStorage.setItem('tag.played', String(played + 1));
    } catch {}
    this.buildBrief(info, g, played < FIRST_MATCHES);
    E.touch.hidden = !this.isTouch;
    document.body.classList.toggle('touch-on', this.isTouch);
    this.bakeMinimap(arena);
    this.start();
  },

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame((t) => this.frame(t));
  },
  stop() {
    this.running = false;
  },
  // practice can really pause; an online match just carries on behind the menu
  hold(on) {
    if (on) {
      if (this.kind === 'practice') this.stop();
    } else {
      if (this.game && this.game !== this.net) this.game.lastNow = null;
      this.start();
    }
  },
  finish() {
    this.net.onEnd();
  },

  frame(now) {
    if (!this.running || !this.game) return (this.running = false);
    requestAnimationFrame((t) => this.frame(t));
    const view = this.game.update(now);
    if (!view) return;
    this.renderer.draw(view, now);
    const h = this.hud;
    this.tick(view);
    if (now - h.at > 100 || !h.at) {
      h.at = now;
      this.updateHud(view);
    }
    if (now - h.mapAt > 50) {
      h.mapAt = now;
      this.drawMinimap(view);
    }
  },

  // --- heads-up display -------------------------------------------------------------------
  // Every frame: the two things that have to happen on the dot - the 3-2-1 with
  // the objective card, and the item draw. Only comparisons, unless something changed.
  tick(view) {
    const h = this.hud;
    const cd = view.phase === 'countdown' ? view.countdownMs || 0 : 0;
    const n = cd > 0 && cd <= COUNTDOWN_MS ? Math.min(3, Math.ceil(cd / 1000)) : 0;
    if (n !== h.count) {
      h.count = n;
      this.showBrief(n, view);
    }
    const m = view.me;
    const kind = m && m.item ? ITEM_KINDS[m.item - 1] : '';
    const state = !kind ? '' : m.arm > 0 ? 'draw' : m.locked ? `${kind}-locked` : kind;
    if (state !== h.item) this.itemChanged(state, kind, m, view);
  },

  // About ten times a second: everything else.
  updateHud(view) {
    const h = this.hud;
    const E = this.el;
    const sec = view.phase === 'countdown' ? view.duration : Math.ceil(view.timeLeft);
    if (sec !== h.sec) {
      h.sec = sec;
      E.timer.textContent = String(sec);
      E.timer.classList.toggle('low', view.phase === 'playing' && sec <= 10);
    }
    // One plaque per player. Free-for-all: colour, name, seconds spent as it, in a
    // list under the minimap. Team battle: colour and name beside that side's
    // score, with a bomb on it while they carry one.
    const seen = [];
    const sizes = [0, 0];
    for (const p of view.players) {
      seen[p.slot] = true;
      const sided = !!view.team && p.team >= 0;
      if (sided) sizes[p.team]++;
      let pill = h.pills[p.slot];
      if (!pill) {
        const li = el('li');
        const chip = el('i', 'chip');
        chip.style.background = this.colorOf(p.slot);
        li.append(chip, el('span', 'nm', p.name));
        let val = null;
        if (sided) {
          li.insertAdjacentHTML('beforeend', '<svg class="bm" viewBox="0 0 24 24" aria-hidden="true"><use href="#pi-bomb"/></svg>');
          (p.team ? E.rosterB : E.rosterA).append(li);
        } else {
          val = el('span', 'val');
          li.append(val, el('em', '', 'IT'));
          E.pills.append(li);
        }
        if (p.local) li.classList.add('me');
        pill = h.pills[p.slot] = { li, val, text: '', it: false };
      }
      if (pill.val) {
        const text = `${Math.floor((p.itTicks || 0) / TICK_RATE)}s`;
        if (text !== pill.text) pill.val.textContent = pill.text = text;
      }
      const it = view.it === p.slot || !!p.bomb;
      if (it !== pill.it) pill.li.classList.toggle('it', (pill.it = it));
    }
    h.pills.forEach((pill, slot) => {
      if (pill && pill.gone !== !seen[slot]) pill.li.classList.toggle('gone', (pill.gone = !seen[slot]));
    });
    const n = view.players.length;
    if (view.team) {
      // up to five a side, in at most two rows: three or fewer stand in one row
      const sig = sizes.join();
      if (sig !== h.sides) {
        h.sides = sig;
        [E.rosterA, E.rosterB].forEach((list, t) => {
          const cols = sizes[t] <= 3 ? Math.max(1, sizes[t]) : Math.ceil(sizes[t] / 2);
          list.style.setProperty('--cols', String(cols));
          list.className = `h-roster c${cols}`;
        });
        E.hud.classList.toggle('deep', Math.max(sizes[0], sizes[1]) > 3); // a side stands in two rows
      }
    } else if (n !== h.crowd) {
      // six or more: two columns
      h.crowd = n;
      E.pills.classList.toggle('many', n > 5);
      E.pills.style.setProperty('--rows', String(Math.ceil(n / 2)));
    }

    // team battle: the score either side of the clock (with a bomb for every one that side is holding), the flags under it
    if (view.team) {
      const t = view.team;
      const held = [0, 0];
      for (const p of view.players) if (p.bomb && p.team >= 0) held[p.team]++;
      const sig = `${t.score[0]}-${t.score[1]}-${held[0]}-${held[1]}`;
      if (sig !== h.teams) {
        h.teams = sig;
        const bombs = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#pi-bomb"/></svg>'.repeat(n);
        E.teamA.innerHTML = `<span class="tn">${TEAM_NAMES[0]}</span> ${t.score[0]}<span class="held">${bombs(held[0])}</span>`;
        E.teamB.innerHTML = `<span class="held">${bombs(held[1])}</span>${t.score[1]} <span class="tn">${TEAM_NAMES[1]}</span>`;
      }
      const side = view.players.find((p) => p.local)?.team ?? -1;
      if (side !== h.side) {
        h.side = side;
        E.teamA.classList.toggle('mine', side === 0);
        E.teamB.classList.toggle('mine', side === 1);
        E.rosterA.parentNode.classList.toggle('mine', side === 0);
        E.rosterB.parentNode.classList.toggle('mine', side === 1);
      }
      t.flags.forEach((f, i) => {
        const e = h.flagEls[i];
        if (!e) return;
        const side = f.fill < 0 ? 0 : 1; // whose colour is in the bar
        const amount = Math.round(Math.min(1, Math.abs(f.fill)) * 40) / 40;
        const fsig = `${f.owner}/${side}/${amount}`;
        if (fsig === e.sig) return;
        e.sig = fsig;
        e.fill.style.transform = `scaleX(${amount})`;
        e.fill.style.background = TEAM_COLORS[side];
        e.chip.style.color = f.owner >= 0 ? TEAM_COLORS[f.owner] : '';
        e.chip.classList.toggle('held', f.owner >= 0);
      });
    }

    // what you are right now: it, or carrying a bomb - or only watching (a small sign that stays up as long as it is true)
    const self = view.phase === 'playing' ? view.players.find((p) => p.local) : null;
    const role = view.spectating ? 'watch' : !self ? '' : self.bomb ? 'bomb' : view.it === self.slot ? 'it' : '';
    const hot = role === 'bomb' && view.timeLeft <= 10;
    if (role !== h.role || hot !== h.hot) {
      h.role = role;
      h.hot = hot;
      E.status.hidden = !role;
      E.status.className = role + (hot ? ' hot' : '');
      if (role) {
        E.status.firstChild.innerHTML = icon(role === 'bomb' ? 'bomb' : role === 'watch' ? 'eye' : 'it');
        E.status.lastChild.textContent = role === 'watch' ? 'Watching - you play next round' : role === 'bomb' ? (hot ? 'BOMB - get rid of it!' : 'BOMB - tag an enemy') : "YOU'RE IT - tag someone";
      }
    }

    // boosts that are running
    const m = view.me;
    const buffs = m ? [m.spd > 0 && ['speed', m.spd], m.jmp > 0 && ['jump', m.jmp], m.shd > 0 && ['shield', m.shd], m.slw > 0 && ['storm', m.slw]].filter(Boolean) : [];
    const bsig = buffs.map(([k, t]) => `${k}${Math.ceil(t / TICK_RATE)}`).join();
    if (bsig !== h.buffs) {
      h.buffs = bsig;
      E.buffs.textContent = '';
      for (const [k, t] of buffs) {
        const d = el('div', k === 'storm' ? 'bad' : '');
        d.innerHTML = icon(k);
        d.append(`${Math.ceil(t / TICK_RATE)}s`);
        E.buffs.append(d);
      }
    }
    // the minimap is only for when you cannot see everything anyway
    const noMap = view.phase === 'over' || (view.phase === 'countdown' && view.countdownMs > 1800);
    if (noMap !== h.noMap) E.minimap.hidden = h.noMap = noMap;
  },

  // --- the objective card -----------------------------------------------------------------
  // Shown for the 3-2-1 and gone at GO: the mode's name, a line per goal with
  // its icon, then whatever is special about this round - the twist, the leader
  // starting as it - and, in someone's first matches, the controls. The count
  // itself is the seal on the card's corner.
  buildBrief(info, g, teach) {
    const b = this.el.brief;
    const me = this.mySlot();
    const team = info.mode === 'team';
    b.hidden = true;
    b.textContent = '';
    this.hud.briefKind = info.mode;
    const head = el('div', 'b-hd');
    const seal = (this.hud.briefSeal = el('i', 'b-n'));
    head.append(seal, el('b', 'b-title', MODES.find((m) => m.id === info.mode)?.name || 'Tag'));
    const side = team && me >= 0 ? (g.teamOf?.(me) ?? -1) : -1;
    if (side >= 0) {
      const tag = el('span', 'b-side', `You: ${TEAM_NAMES[side]}`);
      tag.style.background = TEAM_COLORS[side];
      head.append(tag);
    }
    b.append(head);
    const goals = el('ul', 'b-goals');
    const goal = (ic, html) => {
      const li = el('li');
      li.innerHTML = `<i class="b-tile">${icon(ic)}</i><span>${html}</span>`;
      goals.append(li);
    };
    if (team) {
      goal('flag', '<b>Stand in a flag ring</b> to score');
      goal('bomb', '<b>Pass bombs</b> to enemies before the buzzer');
    } else if (info.mode === 'time') goal('clock', '<b>Least time as it</b> wins');
    else goal('it', "<b>Don't be it</b> at the buzzer");
    b.append(goals);
    const extra = (cls, ic, strong, rest) => {
      const p = el('p', `b-extra b-${cls}`);
      p.innerHTML = icon(ic);
      const words = el('span');
      words.append(el('b', '', strong), rest);
      p.append(words);
      b.append(p);
    };
    const twist = info.twist && info.twist !== 'none' ? g.twist : null;
    if (twist?.name) extra('twist', 'twist', `Twist: ${twist.name}`, `: ${twist.blurb.toLowerCase()}`);
    if (!team && info.cup && info.cup.leader >= 0) {
      if (info.cup.leader === me) extra('lead', 'crown', 'You lead', ', so you start as it');
      else extra('lead', 'crown', this.nameOf(info.cup.leader), ' leads, so starts as it');
    }
    if (teach) {
      const keys = el('div', 'b-keys');
      keys.innerHTML = this.isTouch
        ? `<span><i class="b-tb b-wide">${icon('left')}${icon('right')}</i>Run</span><span><i class="b-tb">${icon('up')}</i>Jump, twice</span><span><i class="b-tb">${icon('down')}</i>Drop</span><span><i class="b-tb">${icon('box')}</i>Item</span>`
        : `<span><kbd>A</kbd><kbd>D</kbd>Run</span><span><kbd>W</kbd>Jump, twice</span><span><kbd>S</kbd>Drop</span><span><kbd>E</kbd>Item</span><small>Arrows and Space work too</small>`;
      b.append(keys);
    }
  },

  showBrief(n, view) {
    const h = this.hud;
    const b = this.el.brief;
    if (!n) {
      if (h.briefOn) {
        h.briefOn = false;
        b.classList.remove('in');
        b.classList.add('out');
        this.el.hud.classList.remove('briefing');
        // and once it has faded it is taken away altogether
        clearTimeout(h.briefTimer);
        h.briefTimer = setTimeout(() => !h.briefOn && (b.hidden = true), 300);
      }
      return;
    }
    if (!h.briefOn) {
      h.briefOn = true;
      // Upper middle - unless that would hide your own player, either now (the
      // whole arena is in view) or once the view has closed in on you: then lower
      // middle, if that is any better. Worked out once, when the card appears.
      const R = this.renderer;
      const me = view.players.find((p) => p.local);
      const spots = []; // [x, y, how much it matters] in CSS px
      const cam = me && R.viewRect();
      if (cam) {
        spots.push([((me.x + PW / 2 - cam.x) / cam.w) * R.cssW, ((me.y + PH / 2 - cam.y) / cam.h) * R.cssH, 1]);
        const A = R.arena;
        const vw = R.cssW / R.kCss; // world units on screen during play
        const vh = R.cssH / R.kCss;
        const roomX = A.w - vw;
        const roomY = A.h + (R.padB || 0) - vh;
        const left = roomX <= 0 ? roomX / 2 : Math.min(Math.max(me.x + PW / 2 - vw / 2, 0), roomX);
        const top = roomY <= 0 ? (A.h - vh) / 2 : Math.min(Math.max(me.y + PH / 2 - vh * 0.54, 0), roomY);
        spots.push([(me.x + PW / 2 - left) * R.kCss, (me.y + PH / 2 - top) * R.kCss, 2]);
      }
      b.hidden = false;
      let best = 'hi';
      let least = Infinity;
      let natural = 0;
      for (const where of spots.length ? ['hi', 'lo'] : ['hi']) {
        b.className = `${h.briefKind} ${where}`;
        let cost = 0;
        if (spots.length) {
          const host = this.el.hud.getBoundingClientRect();
          const r = b.getBoundingClientRect();
          if (where === 'hi') natural = r.width;
          else if (r.width < natural - 1) break; // no room for it down there (a phone on its side: the gap between the thumb controls)
          // (the name and the YOU pointer stand well above a player's head)
          for (const [x, y, w] of spots) if (x > r.left - host.left - 50 && x < r.right - host.left + 50 && y > r.top - host.top - 26 && y < r.bottom - host.top + 96) cost += w;
        }
        if (cost < least) {
          least = cost;
          best = where;
        }
        if (!cost) break;
      }
      b.className = `${h.briefKind} ${best} in`;
      this.el.hud.classList.add('briefing'); // (on a small screen the card takes the place of the round's name)
    }
    const seal = h.briefSeal;
    seal.textContent = String(n);
    seal.classList.remove('pop');
    void seal.offsetWidth; // restart the pop
    seal.classList.add('pop');
  },

  pop(text) {
    const c = this.el.count;
    c.textContent = text;
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
  },

  banner(text, red) {
    const b = this.el.banner;
    b.textContent = text;
    b.className = '';
    void b.offsetWidth;
    b.className = red ? 'show red' : 'show';
  },

  // --- the item in your hands, and the draw that deals it -----------------------------------
  // state: '' (empty hands) | 'draw' (a lucky box is being opened: the server
  // arms the item a moment after you touch the box) | <kind> | <kind>-locked
  itemChanged(state, kind, m, view) {
    const h = this.hud;
    const E = this.el;
    const was = h.item;
    h.item = state;
    clearTimeout(h.itemTimer);
    const slot = E.itemslot;
    if (!kind) {
      slot.hidden = true;
      slot.className = '';
      this.reelOff();
      this.setUse('');
      return;
    }
    if (state === 'draw') {
      // the tile waits, empty, where the item will land
      slot.hidden = false;
      slot.className = 'draw';
      E.itemPic.innerHTML = icon('box');
      slot.removeAttribute('title');
      this.setUse('');
      // online the server only says "arming": by the time we hear of it a frame or two have gone
      const ms = this.game === this.net ? ((ITEM_ARM_TICKS - 3) * 1000) / TICK_RATE : (m.arm * 1000) / TICK_RATE;
      this.reelStart(kind, ms, view);
      return;
    }
    const locked = !!m.locked;
    const hold = (named) => {
      const it = ITEM_INFO[kind];
      slot.hidden = false;
      slot.className = locked ? 'locked' : 'ready';
      E.itemPic.innerHTML = icon(kind);
      E.itemCap.textContent = locked ? 'Locked - the round is nearly over' : it.name;
      slot.title = `${it.name}: ${it.blurb}`;
      this.setUse(kind, !locked);
      if (named) {
        void slot.offsetWidth; // (so the caption's fade starts afresh even if it was showing a moment ago)
        slot.classList.add('named');
      }
    };
    if (was === 'draw' && h.reelOn && !locked) {
      // the reel stops on it and says its name; a moment later it drops into the tile
      this.reelLand(kind);
      h.itemTimer = setTimeout(() => {
        this.reelOff();
        hold(false);
        slot.classList.add('got');
      }, calm.matches ? 900 : ITEM_LAND_MS);
    } else {
      this.reelOff();
      hold(locked || was === '' || was === 'draw');
    }
  },

  // the item button on a touch screen shows what you hold
  setUse(kind, ready) {
    const h = this.hud;
    const sig = `${kind}/${ready ? 1 : 0}`;
    if (sig === h.use) return;
    h.use = sig;
    this.el.use.innerHTML = icon(kind || 'box');
    this.el.use.classList.toggle('ready', !!kind && !!ready);
  },

  // The draw: a window the item icons roll through, slowing down, for exactly
  // as long as the item takes to arm. Built once per draw; the rolling itself is
  // one CSS animation.
  reelStart(kind, ms, view) {
    const h = this.hud;
    const E = this.el;
    const R = E.itemdraw;
    const still = calm.matches;
    ms = Math.max(120, ms);
    const seq = [kind];
    if (!still) {
      const n = Math.max(5, Math.min(13, Math.round(ms / 68)));
      while (seq.length < n) {
        let k = pickRandom(ITEM_KINDS);
        if (k === seq[0]) k = ITEM_KINDS[(ITEM_KINDS.indexOf(k) + 1 + Math.floor(Math.random() * (ITEM_KINDS.length - 1))) % ITEM_KINDS.length];
        seq.unshift(k);
      }
    }
    E.reelStrip.innerHTML = seq.map((k) => `<i>${icon(k)}</i>`).join('');
    E.reelStrip.style.setProperty('--end', `${(-(seq.length - 1) / seq.length) * 100}%`);
    E.reelStrip.style.animation = still ? 'none' : `item-roll ${Math.round(ms)}ms cubic-bezier(0.1, 0.55, 0.25, 1) both`;
    E.reelName.textContent = still ? ITEM_INFO[kind].name : 'Lucky box';
    // where it goes
    const st = R.style;
    st.left = st.top = st.bottom = '';
    st.removeProperty('--dx');
    if (this.isTouch) {
      // right above the item button, which it drops into
      const host = E.hud.getBoundingClientRect();
      const u = E.use.getBoundingClientRect();
      const size = 92;
      st.left = `${Math.min(host.width - size - 4, Math.max(4, u.left - host.left + u.width / 2 - size / 2))}px`;
      st.top = `${u.top - host.top - size - 30}px`;
    } else {
      // low in the middle, just above the kit - unless that is where you are standing: then a step to the side
      const cam = this.renderer.viewRect();
      const me = cam && view.players.find((p) => p.local);
      if (me) {
        const W = this.renderer.cssW;
        const H = this.renderer.cssH;
        const sx = ((me.x + PW / 2 - cam.x) / cam.w) * W;
        const sy = ((me.y + PH / 2 - cam.y) / cam.h) * H;
        if (sy > H - 300 && Math.abs(sx - W / 2) < 150) st.setProperty('--dx', `${sx < W / 2 ? 190 : -190}px`);
      }
    }
    R.className = still ? 'roll still' : 'roll';
    R.hidden = false;
    h.reelOn = true;
  },

  reelLand(kind) {
    const E = this.el;
    const R = E.itemdraw;
    E.reelStrip.style.animation = '';
    E.reelName.textContent = ITEM_INFO[kind].name;
    // where it flies to: the item tile (on a touch screen, the item button)
    const from = R.getBoundingClientRect();
    const to = (this.isTouch ? E.use : E.itemslot).getBoundingClientRect();
    const st = R.style;
    st.setProperty('--fx', `${Math.round(to.left + to.width / 2 - (from.left + from.width / 2))}px`);
    st.setProperty('--fy', `${Math.round(to.top + to.height / 2 - (from.top + from.height / 2))}px`);
    st.setProperty('--fs', (Math.max(24, to.width) / Math.max(1, from.width)).toFixed(3));
    R.className = calm.matches ? 'land still' : 'land';
    this.sfx.play('click', 0.7);
  },

  reelOff() {
    const h = this.hud;
    if (!h.reelOn) return;
    h.reelOn = false;
    const R = this.el.itemdraw;
    R.hidden = true;
    R.className = '';
    this.el.reelStrip.style.animation = '';
    this.el.reelStrip.textContent = '';
  },

  // --- minimap ---------------------------------------------------------------------------
  // The arena in miniature: painted once, with a dot for every player on top.
  bakeMinimap(arena) {
    const c = this.el.minimap;
    const k = Math.min(c.width / arena.w, c.height / arena.h);
    const base = document.createElement('canvas');
    base.width = c.width;
    base.height = c.height;
    const g = base.getContext('2d');
    const ox = (c.width - arena.w * k) / 2;
    const oy = (c.height - arena.h * k) / 2;
    g.fillStyle = 'rgba(14,12,10,.72)';
    g.fillRect(0, 0, c.width, c.height);
    g.translate(ox, oy);
    g.fillStyle = 'rgba(255,255,255,.2)';
    for (const z of arena.lifts) g.fillRect(z.x * k, z.y * k, z.w * k, z.h * k);
    g.fillStyle = 'rgba(255,255,255,.62)';
    for (const p of arena.platforms) g.fillRect(p.x * k, p.y * k, Math.max(1, p.w * k), p.oneway ? 1.4 : Math.max(1.4, p.h * k));
    g.strokeStyle = 'rgba(255,255,255,.62)';
    g.lineWidth = 1.4;
    g.beginPath();
    for (const r of arena.ramps) {
      g.moveTo(r.x0 * k, r.y0 * k);
      g.lineTo(r.x1 * k, r.y1 * k);
    }
    g.stroke();
    g.fillStyle = '#ffc94d';
    for (const t of arena.tramps) g.fillRect(t.x * k, t.y * k - 1, Math.max(2, t.w * k), 2);
    g.fillStyle = '#ff5a4d';
    for (const sp of arena.spikes) g.fillRect(sp.x * k, sp.y * k, Math.max(2, sp.w * k), 2);
    this.mini = { base, k, ox, oy };
  },

  drawMinimap(view) {
    const m = this.mini;
    if (!m) return;
    const c = this.el.minimap;
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(m.base, 0, 0);
    g.translate(m.ox, m.oy);
    const k = m.k;
    // what the main view is showing
    const cam = this.renderer.viewRect();
    if (cam) {
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = 1;
      g.strokeRect(cam.x * k + 0.5, cam.y * k + 0.5, cam.w * k, cam.h * k);
    }
    g.fillStyle = '#ffd23f';
    for (const point of view.boxes || []) {
      const pt = this.renderer.arena.pickups[point];
      if (pt) g.fillRect(pt.x * k - 1.5, pt.y * k - 1.500, 3, 3);
    }
    if (view.team) {
      // flags: a pole and a pennant in the colour of whoever holds it (pale: nobody's)
      for (const f of view.team.flags) {
        g.fillStyle = f.owner >= 0 ? TEAM_COLORS[f.owner] : '#e9e2cf';
        g.fillRect(f.x * k - 1, f.y * k - 9, 2, 9);
        g.fillRect(f.x * k, f.y * k - 9, 6, 4);
      }
    }
    // never hide your own player: the map - and the list of players under it -
    // turns faint while you are underneath it
    const me = cam && view.players.find((p) => p.local);
    let under = false;
    let underList = false;
    if (me) {
      const now = performance.now();
      if (!m.rect || now - m.rectAt > 1000) {
        const a = this.el.stage.getBoundingClientRect();
        const box = (e) => {
          const b = e.getBoundingClientRect();
          return b.width ? { x0: b.left - a.left - 36, y0: b.top - a.top - 56, x1: b.right - a.left + 36, y1: b.bottom - a.top + 36 } : null;
        };
        m.rect = box(c);
        m.list = box(this.el.pills);
        m.w = a.width;
        m.h = a.height;
        m.rectAt = now;
      }
      const sx = ((me.x + PW / 2 - cam.x) / cam.w) * m.w;
      const sy = ((me.y + PH / 2 - cam.y) / cam.h) * m.h;
      const inside = (r) => !!r && sx > r.x0 && sx < r.x1 && sy > r.y0 && sy < r.y1;
      under = inside(m.rect);
      underList = inside(m.list);
    }
    if (under !== m.under) c.classList.toggle('aside', (m.under = under));
    if (underList !== m.underList) this.el.pills.classList.toggle('aside', (m.underList = underList));
    for (const p of view.players) {
      if (p.dead > 0) continue;
      const x = (p.x + PW / 2) * k;
      const y = (p.y + PH / 2) * k;
      g.fillStyle = view.team && p.team >= 0 ? TEAM_COLORS[p.team] : this.colorOf(p.slot); // team battle: friend or foe at a glance
      g.beginPath();
      g.arc(x, y, p.local ? 4 : 3, 0, 6.283);
      g.fill();
      if (p.local) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.500;
        g.stroke();
      }
      if (view.it === p.slot || p.bomb) {
        g.strokeStyle = '#ff4d3d';
        g.lineWidth = 1.500;
        g.beginPath();
        g.arc(x, y, 6.500, 0, 6.283);
        g.stroke();
      }
    }
  },

  // --- game events -> pictures, words, sound ---------------------------------------------
  onEvent(type, a, b) {
    const me = this.mySlot();
    const R = this.renderer;
    const sfx = this.sfx;
    const team = this.info?.mode === 'team';
    if (type === 'tag') {
      R.tagFx(a, b);
      sfx.play(b === me ? 'tagged' : 'tag');
      if (team) this.banner(b === me ? 'A bomb is on YOU - pass it on!' : a === me ? `You stuck it on ${this.nameOf(b)}!` : `${this.nameOf(b)} has a bomb now`, b === me);
      else if (b === me) this.banner("You're it!", true);
      else if (a === me) this.banner(`You tagged ${this.nameOf(b)}!`);
      else this.banner(`${this.nameOf(b)} is it`);
    } else if (type === 'block') {
      R.blockFx(a, b);
      sfx.play('block');
    } else if (type === 'pick') {
      R.pickFx(a, b);
      sfx.play('pick', a === me ? 1 : 0.5);
    } else if (type === 'count') sfx.play('count');
    else if (type === 'go') {
      sfx.play('go');
      this.hud.count = 0;
      this.showBrief(0); // the objective card makes way
      this.pop('GO!');
      setTimeout(() => this.el.count.textContent === 'GO!' && (this.el.count.textContent = ''), 900);
      if (team) {
        // b: who starts with a bomb
        const mine = (b || []).includes(me);
        const who = (b || []).map((slot) => this.nameOf(slot));
        this.banner(mine ? 'You carry a bomb - stick it on an enemy!' : `${who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]} carry bombs` : `${who[0] || 'Someone'} carries the bomb`} - keep away!`, mine);
      } else this.banner(a === me ? "You're it - catch someone!" : `${this.nameOf(a)} is it - run!`, a === me);
      R.shake(4);
    } else if (type === 'tick') sfx.play('tick');
    else if (type === 'end') this.opts.onEnd?.(a);
    else if (type === 'use') {
      // a = { slot, kind, x, y, to }
      const kind = ITEM_KINDS[a.kind];
      R.itemFx(a, kind);
      sfx.play({ freeze: 'freeze', blast: 'blast', storm: 'storm', swap: 'swap', goo: 'goo' }[kind] || 'pick', a.slot === me ? 1 : 0.6);
      const who = a.slot === me ? 'You' : this.nameOf(a.slot);
      if (kind === 'blast') this.banner(`${who} set off a Blast!`, a.slot !== me);
      else if (kind === 'storm') this.banner(`${who} called a Storm!`, a.slot !== me);
      else if (kind === 'freeze') this.banner(`${who} used Frost!`, a.slot !== me);
      else if (kind === 'swap' && a.to >= 0 && (a.slot === me || a.to === me)) this.banner(a.slot === me ? `You swapped with ${this.nameOf(a.to)}` : `${who} swapped places with you!`, a.to === me);
    } else if (type === 'slip') {
      R.slipFx(a);
      sfx.play('fall', a.slot === me ? 1 : 0.4);
    } else if (type === 'boom') {
      R.boomFx(a);
      sfx.play('boom');
      this.banner(a.slot === me ? `BOOM! Your bomb gives ${TEAM_NAMES[a.team]} ${BOMB_POINTS} points` : `BOOM! ${this.nameOf(a.slot)} blows up: ${BOMB_POINTS} points to ${TEAM_NAMES[a.team]}`, this.game?.teamOf?.(me) !== a.team);
    } else if (type === 'it') {
      if (team) this.banner(a.to === me ? 'A bomb has been handed to you!' : `${this.nameOf(a.to)} has a bomb now`, a.to === me);
    } else if (type === 'flag') {
      // a = { what: take | lose | pay, team, i }
      const mine = this.game?.teamOf?.(me) === a.team;
      const letter = 'ABCD'[a.i];
      if (a.what === 'take') {
        this.banner(`${TEAM_NAMES[a.team]} hold flag ${letter}!`, !mine && me >= 0);
        sfx.play(mine ? 'pick' : 'block', 0.9);
        R.flagFx?.(a.i, a.team);
      } else if (a.what === 'lose') this.banner(`Flag ${letter} is up for grabs`);
      else if (a.what === 'pay') R.flagFx?.(a.i, a.team, `+${FLAG_POINTS}`);
    }
  },
};
