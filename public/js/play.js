// Everything that happens while a match is on screen: the renderer, the frame
// loop, the heads-up display, touch controls, and turning game events into
// pictures, words and sound.
//
// The heads-up display, and where each part sits:
//   top centre    the board: the clock, and in a team battle each side's score
//                 and bombs beside it, that side's players beyond the score
//                 (the warm side left, the cool side right); underneath, the round's
//                 name - or in a team battle the three flags, in the order they
//                 stand on the map - and under that the round's tags
//   top left      in a free-for-all, the list of players
//   top right     the menu button
//   bottom right  the minimap (on a phone: under the menu button, clear of the thumbs)
//   bottom left   the objectives: a small panel that says what this round asks of
//                 you (and its twist, the tournament round, the keys in a first
//                 match). Open for the first seconds, then folded to its title;
//                 O, a click or the pointer over it opens it again. (On a phone:
//                 top left, under the list of players.)
//   bottom centre the "kit": what you are (it / carrying a bomb), the item in
//                 your hands, boosts that are running
//   above the kit the item draw: a small reel that rolls while a lucky box's
//                 item is being armed, stops on it and drops into the item tile
//   upper middle  for the 3-2-1 only: one card that says the game's name and
//                 what YOU are this round - nothing else
//
// The menus (main.js) only call a handful of things here:
//   play.init({ socket, isTouch, onStart(info), onEnd(results), onPause() })
//   play.practice(settings, name)        a match against bots
//   play.round(msg, mySlot)              an online round is starting
//   play.finish() / play.stop() / play.hold(true|false)
//   play.nameOf(slot), play.colorOf(slot), play.portraitOf(slot), play.mySlot(), play.el.spin

import { MODES, TICK_RATE, COUNTDOWN_MS, ITEM_KINDS, ITEM_INFO, ITEM_ARM_TICKS, TEAM_NAMES, TEAM_COLORS, BOMB_POINTS, BOMB_COST, FLAG_POINTS, BEAT_TICKS, FLAG_LETTERS, PW, PH, THEMES } from '/shared/config.js';
import { arenasFor, arenaById } from '/shared/arenas.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { NetGame } from './net.js';
import { LocalGame } from './local.js';
import { loadTheme, THEME_MAP } from './themes/index.js';
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

const ITEM_LAND_MS = 520; // the item draw, once it has stopped: its name for a moment, then into the tile (play.css: item-land)
const FIRST_MATCHES = 3; // how many matches start with a reminder of the controls
const TASKS_OPEN_MS = 7000; // the objectives stay open this long after GO (and after being asked for again), then fold to their title
const TAGS_LIT_MS = 1600; // how long after GO the twist and x2 tags stay lit up (they are from the moment the 3-2-1 starts)
const TWIST_ICONS = { moon: 'eclipse', turbo: 'speed', frenzy: 'box' }; // the tag for a round's twist wears one of the item icons
const TASKS_OPEN_TOUCH_MS = 2500; // (on a phone they cover a good part of the screen: there they fold much sooner)
// How far a tag between two OTHER players carries, in world units (the view is about 1170 x 660 of them):
const TAG_NEAR = 300; // right beside you: 80% of the sound, most of the shake
const TAG_SCREEN = 1000; // within about a screen: 45% falling to 18%
const TAG_HUSH = 1700; // from there it fades to nothing
const TAG_BANNER = 700; // team battle: someone else's bomb pass gets a banner only this close

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
<symbol id="pi-quake" viewBox="0 0 24 24"><path d="M2 13.500l4-6 3.200 4.500L12 4l3.200 9.500 2.800-5 4 5" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 19.500h7l1.500-2 2 3.500 1.500-1.500h6" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-warp" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/><path d="M12 7.800a4.200 4.200 0 1 1-4.200 4.200" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round"/><path d="M16.800 2.600l4.400.500-.900 4.300" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-dash" viewBox="0 0 24 24"><path d="M2.500 8.200h7.300M1.800 12h5.600M3.400 15.800h6.300" fill="none" stroke="currentColor" stroke-width="2.300" stroke-linecap="round"/><path d="M11.400 5.200c3.900 1.900 7.400 4.200 10.600 6.800-3.200 2.600-6.700 4.900-10.600 6.800 1.300-4.500 1.300-9.100 0-13.600z" fill="currentColor"/></symbol>
<symbol id="pi-ghost" viewBox="0 0 24 24"><path d="M5 20.500V11.200C5 6.900 8 3.500 12 3.500s7 3.400 7 7.700v9.300l-2.400-1.900-2.300 1.900-2.300-1.900-2.300 1.900-2.300-1.900L5 20.500z" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linejoin="round"/><circle cx="9.600" cy="11" r="1.400" fill="currentColor"/><circle cx="14.400" cy="11" r="1.400" fill="currentColor"/></symbol>
<symbol id="pi-star" viewBox="0 0 24 24"><path d="M12 2.300l2.900 6.300 6.900.800-5.100 4.700 1.400 6.800L12 17.500 5.900 20.900l1.400-6.800L2.200 9.400l6.900-.800L12 2.300z" fill="currentColor"/></symbol>
<symbol id="pi-eclipse" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2.500a9.500 9.500 0 1 1 0 19 9.500 9.500 0 0 1 0-19zM14.600 5.400a7 7 0 1 0 0 13.200 8.300 8.300 0 0 1 0-13.200z" fill="currentColor"/></symbol>
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
        <div id="side">
          <ul id="pills" aria-label="Players"></ul>
          <div id="tasks" hidden><button class="t-hd" type="button" aria-expanded="true">${icon('twist')}<b>Objectives</b><kbd>O</kbd></button><ul class="t-list"></ul></div>
        </div>
        <div id="top">
          <ul id="roster-a" class="h-roster a" aria-label="${TEAM_NAMES[0]}"></ul>
          <b id="team-a" class="h-score" hidden></b>
          <div id="timer" aria-label="Seconds left">60</div>
          <b id="team-b" class="h-score" hidden></b>
          <ul id="roster-b" class="h-roster b" aria-label="${TEAM_NAMES[1]}"></ul>
          <div id="under"><div id="flags" class="h-flags" hidden></div><div id="round-label"></div></div>
          <div id="tags" hidden></div>
        </div>
        <button id="btn-pause" class="hud-btn" aria-label="Menu (Esc)">${icon('menu')}</button>
        <kbd class="hud-key">Esc</kbd>
        <canvas id="minimap" width="308" height="174" aria-hidden="true"></canvas>
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
    for (const id of ['stage', 'hud', 'pills', 'top', 'tags', 'tasks', 'timer', 'team-a', 'team-b', 'roster-a', 'roster-b', 'flags', 'round-label', 'btn-pause', 'minimap', 'kit', 'status', 'itemslot', 'buffs', 'itemdraw', 'banner', 'brief', 'count', 'spin', 'touch']) this.el[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = root.querySelector(`#${id}`);
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
    // the objectives: a click (or a tap) on their title, or O, opens and folds them
    E.taskList = E.tasks.querySelector('.t-list');
    E.taskHead = E.tasks.querySelector('.t-hd');
    E.taskHead.addEventListener('click', () => this.showTasks(!this.hud.tasksOpen));
    // while the pointer is over the card, or its title has the keyboard's focus, its clock waits
    const hold = (what, on) => {
      this.hud[what] = on;
      this.runTasks();
    };
    E.tasks.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && hold('tasksOver', true));
    E.tasks.addEventListener('pointerleave', () => hold('tasksOver', false));
    E.taskHead.addEventListener('focus', () => E.taskHead.matches(':focus-visible') && hold('tasksFocus', true));
    E.taskHead.addEventListener('blur', () => hold('tasksFocus', false));
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyO' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !this.running || !this.input.active) return;
      this.showTasks(!this.hud.tasksOpen);
    });
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
    const th = THEME_MAP[this.info?.theme] || this.renderer.theme; // (this round's style, even a moment before the scene is set)
    const cols = this.info?.cols;
    return th ? th.colors[cols ? cols[slot] ?? slot : slot] : '#888';
  },
  // a picture of a player's character as it looks in this round: a data URL (see playerPortrait in art.js for opts), or null
  portraitOf(slot, opts) {
    const th = THEME_MAP[this.info?.theme] || this.renderer.theme; // (this round's style, even a moment before the scene is set)
    const cols = this.info?.cols;
    return th ? playerPortrait(th.id, cols ? cols[slot] ?? slot : slot, opts) : null;
  },

  // --- starting and stopping ----------------------------------------------------------
  async practice(s, name) {
    const arena = arenaById(s.arena === 'random' ? pickRandom(arenasFor((s.bots || 3) + 1)) : s.arena);
    const themeId = s.theme === 'random' ? pickRandom(THEMES).id : s.theme;
    await loadTheme(themeId);
    this.kind = 'practice';
    // "play again" keeps the same bots on the same sides, as long as you ask for the same kind of match
    const key = `${s.mode}/${s.bots}/${name}`;
    const squad = this.squad && this.squad.key === key ? this.squad : null;
    const g = new LocalGame({ arena, mode: s.mode, duration: s.duration, powerups: s.powerups, name, bots: s.bots, input: this.input, onEvent: (t, a, b) => this.onEvent(t, a, b), squad, twist: s.twist, cup: s.cup, items: s.items });
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
    const h = this.hud;
    const E = this.el;
    const team = info.mode === 'team';
    E.hud.className = team ? 'team' : 'ffa';
    E.touch.hidden = !this.isTouch;
    document.body.classList.toggle('touch-on', this.isTouch);
    this.renderer.setScene(arena, themeId, info.cols || null);
    this.root.style.background = this.renderer.theme.letterbox;
    clearTimeout(h.itemTimer);
    clearTimeout(h.briefTimer);
    clearTimeout(h.tasksTimer);
    clearTimeout(h.tagsTimer);
    E.tags.classList.remove('intro');
    Object.assign(h, { sec: -1, count: 0, buffs: '', pills: [], item: '', teams: '', crowd: 0, sides: '', role: '', side: -2, briefOn: false });
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
    E.pills.className = '';
    for (const [id, t] of [['teamA', 0], ['teamB', 1]]) {
      E[id].hidden = !team;
      E[id].style.background = TEAM_COLORS[t];
    }
    E.flags.hidden = !team;
    E.flags.textContent = '';
    h.flagEls = [];
    if (team) {
      // One marker per flag, in the order they stand on the map (A at the warm side's
      // end, B high in the middle, C at the cool side's end): a letter, and a bar that
      // fills with a team's colour. The last one is mirrored, so the row is symmetrical.
      arena.bases.forEach((_, i) => {
        const chip = el('div', i === arena.bases.length - 1 && i > 0 ? 'flagchip rev' : 'flagchip');
        chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#pi-flag"/></svg>';
        const bar = el('span', 'meter');
        const fill = el('i');
        bar.append(fill);
        chip.append(el('b', '', FLAG_LETTERS[i]), bar);
        E.flags.append(chip);
        h.flagEls.push({ chip, fill, sig: '' });
      });
    }
    const ko = !!info.cup?.ko;
    const mode = ko ? 'Knockout' : MODES.find((m) => m.id === info.mode)?.name || '';
    const label = this.kind === 'practice' && !info.cup ? `Practice · ${mode}` : mode;
    // (a team battle has its flags where the round's name would be: there the name is the first of the tags)
    E.roundLabel.textContent = team ? '' : label;
    // Whatever is special about this round stays on the board for all of it, as
    // tags under the round's name: the tournament round, the twist, and - loud -
    // the last round's double points. (Each has a short form for a phone.)
    const tags = [];
    const twist = info.twist && info.twist !== 'none' ? g.twist : null;
    if (team) tags.push(['mode', '', label, label, label]);
    if (info.cup?.tie) tags.push(['x2', '', 'Tie-break', 'Tie-break', 'Level: whoever wins this round wins the tournament']);
    else if (info.cup) tags.push(['round', '', `Round ${info.cup.round}/${info.cup.rounds}`, `${info.cup.round}/${info.cup.rounds}`, `Round ${info.cup.round} of ${info.cup.rounds} in this tournament`]);
    // a knockout: how many are still in it (whoever is the oni at the buzzer goes out)
    if (ko) tags.push(['left', 'it', info.cup.left === 2 ? 'The final' : `${info.cup.left} left`, info.cup.left === 2 ? 'Final' : `${info.cup.left} left`, info.cup.left === 2 ? 'The final: whoever is the oni at the buzzer loses the tournament' : `${info.cup.left} players are still in: the oni at the buzzer is out`]);
    if (twist?.name) tags.push(['twist', TWIST_ICONS[twist.id] || 'twist', twist.name, twist.name.split(' ')[0], `Twist: ${twist.name} - ${twist.blurb.toLowerCase()}`]);
    if (info.cup?.double) tags.push(['x2', '', info.cup.score === 'rounds' ? 'Worth 2' : '\u00d72 points', '\u00d72', info.cup.score === 'rounds' ? 'The last round is worth two' : 'The last round counts double']);
    E.tags.textContent = '';
    for (const [kind, ic, long, short, tip] of tags) {
      const tag = el('span', `tag ${kind}`);
      if (ic) tag.innerHTML = icon(ic);
      tag.append(el('b', 'long', long), el('b', 'short', short));
      tag.title = tip;
      E.tags.append(tag);
    }
    E.tags.hidden = !tags.length;
    E.hud.classList.toggle('tagged', tags.some(([kind]) => kind !== 'mode'));
    // the first few matches come with a reminder of the controls (among the objectives)
    let played = 0;
    try {
      played = Number(localStorage.getItem('tag.played')) || 0;
      localStorage.setItem('tag.played', String(played + 1));
    } catch {}
    this.buildBrief(info, g);
    this.buildTasks(info, g, played < FIRST_MATCHES);
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
    const state = !kind ? '' : m.arm > 0 ? 'draw' : kind;
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
      // a side's players stand beside its score: up to three in one row, more in two
      const sig = sizes.join();
      if (sig !== h.sides) {
        h.sides = sig;
        [E.rosterA, E.rosterB].forEach((list, t) => list.style.setProperty('--rows', sizes[t] > 3 ? '2' : '1'));
      }
    } else if (n !== h.crowd) {
      // six or more: two columns
      h.crowd = n;
      E.pills.classList.toggle('many', n > 5);
      E.pills.style.setProperty('--rows', String(Math.ceil(n / 2)));
    }

    // team battle: each side's score beside the clock, with how many bombs that side is holding; its flag beyond
    if (view.team) {
      const t = view.team;
      const held = [0, 0];
      for (const p of view.players) if (p.bomb && p.team >= 0) held[p.team]++;
      const sig = `${t.score[0]}-${t.score[1]}-${held[0]}-${held[1]}-${innerWidth}x${innerHeight}`;
      if (sig !== h.teams) {
        h.teams = sig;
        // (a bomb and a number: read at a glance, and the same width with one bomb or five)
        const bombs = (n) => `<span class="held${n ? '' : ' none'}" aria-label="${n} bomb${n === 1 ? '' : 's'}"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#pi-bomb"/></svg><i>${n}</i></span>`;
        E.teamA.innerHTML = `<span class="tn">${TEAM_NAMES[0]}</span><span class="pts">${t.score[0]}</span>${bombs(held[0])}`;
        E.teamB.innerHTML = `${bombs(held[1])}<span class="pts">${t.score[1]}</span><span class="tn">${TEAM_NAMES[1]}</span>`;
        // both plates exactly as wide as the wider of the two: the halves of the board mirror each other and the clock is dead centre
        for (const e of [E.teamA, E.teamB]) e.style.minWidth = '';
        const wide = Math.ceil(Math.max(E.teamA.getBoundingClientRect().width, E.teamB.getBoundingClientRect().width));
        if (wide > 0) for (const e of [E.teamA, E.teamB]) e.style.minWidth = `${wide}px`;
      }
      const side = view.players.find((p) => p.local)?.team ?? -1;
      if (side !== h.side) {
        h.side = side;
        E.teamA.classList.toggle('mine', side === 0);
        E.teamB.classList.toggle('mine', side === 1);
        E.rosterA.classList.toggle('mine', side === 0);
        E.rosterB.classList.toggle('mine', side === 1);
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
    // (before GO too: the view says who starts as it, or with a bomb, as soon as the draw is over)
    const before = view.phase === 'countdown';
    const self = view.phase === 'playing' || before ? view.players.find((p) => p.local) : null;
    const role = view.spectating ? 'watch' : !self ? '' : self.bomb ? 'bomb' : view.it === self.slot ? 'it' : '';
    const hot = role === 'bomb' && !before && view.timeLeft <= 10;
    const rsig = `${role}/${hot}/${before}`;
    if (rsig !== h.role) {
      h.role = rsig;
      E.status.hidden = !role;
      E.status.className = role + (hot ? ' hot' : '');
      if (role) {
        E.status.firstChild.innerHTML = icon(role === 'bomb' ? 'bomb' : role === 'watch' ? 'eye' : 'it');
        E.status.lastChild.textContent =
          role === 'watch' ? (this.info?.cup?.ko ? 'You are out - watching' : 'Watching - you play next round') : role === 'bomb' ? (before ? 'You start with a BOMB' : hot ? 'BOMB - get rid of it!' : 'BOMB - tag an enemy') : before ? 'You start as IT' : "YOU'RE IT - tag someone";
      }
    }

    // boosts that are running
    const m = view.me;
    const buffs = m ? [m.spd > 0 && ['speed', m.spd], m.jmp > 0 && ['jump', m.jmp], m.shd > 0 && ['shield', m.shd], m.gho > 0 && ['ghost', m.gho], m.inv > 0 && ['star', m.inv], m.slw > 0 && ['storm', m.slw], m.ecl > 0 && ['eclipse', m.ecl]].filter(Boolean) : [];
    const bsig = buffs.map(([k, t]) => `${k}${Math.ceil(t / TICK_RATE)}`).join();
    if (bsig !== h.buffs) {
      h.buffs = bsig;
      E.buffs.textContent = '';
      for (const [k, t] of buffs) {
        const d = el('div', k === 'storm' || k === 'eclipse' ? 'bad' : '');
        d.innerHTML = icon(k);
        d.append(`${Math.ceil(t / TICK_RATE)}s`);
        E.buffs.append(d);
      }
    }
    // the minimap is only for when you cannot see everything anyway
    const noMap = view.phase === 'over' || (view.phase === 'countdown' && view.countdownMs > 1800);
    if (noMap !== h.noMap) E.minimap.hidden = h.noMap = noMap;
  },

  // --- before GO: one card -------------------------------------------------------------
  // Shown for the 3-2-1 and gone at GO. It says two things and nothing else: the
  // game's name, and what YOU are this round - the oni or not (and who is), with
  // a bomb or without, and in a team battle which side you are on. The count is
  // the seal on the card's corner. (What the round asks of you is in the
  // objectives panel, which stays.)
  buildBrief(info, g) {
    const b = this.el.brief;
    const me = this.mySlot();
    const team = info.mode === 'team';
    b.hidden = true;
    b.textContent = '';
    this.hud.briefKind = info.mode;
    const head = el('div', 'b-hd');
    const seal = (this.hud.briefSeal = el('i', 'b-n'));
    const ko = !!info.cup?.ko;
    head.append(seal, el('b', 'b-title', ko ? (info.cup.left === 2 ? 'Knockout final' : 'Knockout') : MODES.find((m) => m.id === info.mode)?.name || 'Tag'));
    if (ko && info.cup.left > 2) head.append(el('span', 'b-side b-left', `${info.cup.left} left`));
    const side = team && me >= 0 ? (g.teamOf?.(me) ?? -1) : -1;
    if (side >= 0) {
      const tag = el('span', 'b-side', `You: ${TEAM_NAMES[side]}`);
      tag.style.background = TEAM_COLORS[side];
      head.append(tag);
    }
    b.append(head);
    let ic = 'eye';
    let words = ko ? 'You are out - watch the rest fight it out' : 'You are watching this round';
    let mine = false;
    if (me >= 0 && team) {
      mine = (info.bombs || []).includes(me);
      ic = mine ? 'bomb' : 'flag';
      words = mine ? 'You start with a bomb' : 'Your hands are free';
    } else if (me >= 0) {
      mine = info.it === me;
      ic = 'it';
      words = mine ? 'You are the oni' : info.it >= 0 ? `${this.nameOf(info.it)} is the oni` : 'Everyone for themselves';
    }
    const you = el('p', mine ? 'b-you mine' : 'b-you');
    you.innerHTML = `<i class="b-tile">${icon(ic)}</i>`;
    you.append(el('b', '', words));
    b.append(you);
  },

  // --- the objectives: what this round asks of you, there for the whole match -------------
  // One line a goal and, in someone's first matches, the controls - nothing else.
  // Open from the countdown until a few seconds after GO, then it folds to its
  // title, out of the way.
  buildTasks(info, g, teach) {
    const E = this.el;
    const team = info.mode === 'team';
    const list = E.taskList;
    list.textContent = '';
    const line = (ic, html, cls = '') => {
      const li = el('li', cls);
      li.innerHTML = `${icon(ic)}<span>${html}</span>`;
      list.append(li);
    };
    if (team) {
      line('flag', `<b>Hold the flags</b>: +${FLAG_POINTS} each, every ${Math.round(BEAT_TICKS / TICK_RATE)} s`);
      line('bomb', `<b>Pass your bomb</b> on: it costs ${BOMB_COST} every ${Math.round(BEAT_TICKS / TICK_RATE)} s, and ${BOMB_POINTS} at the buzzer`);
    } else if (info.mode === 'time') line('clock', '<b>Least time as the oni</b> wins');
    else if (info.cup?.ko) {
      line('it', info.cup.left === 2 ? '<b>The oni at the buzzer loses</b> the final' : '<b>The oni at the buzzer is out</b> of the tournament');
      line('crown', info.cup.left === 2 ? '<b>The other one wins</b> it all' : '<b>Everyone else</b> plays the next round');
    } else line('it', "<b>Don't be the oni</b> at the buzzer");
    // (the twist and a tournament's double points are tags on the board, lit up as the round begins; who starts as the oni is on the card before GO)
    if (teach) {
      const keys = el('li', 't-keys');
      keys.innerHTML = this.isTouch
        ? `<span><i class="b-tb b-wide">${icon('left')}${icon('right')}</i>Run</span><span><i class="b-tb">${icon('up')}</i>Jump, twice</span><span><i class="b-tb">${icon('down')}</i>Drop</span><span><i class="b-tb">${icon('box')}</i>Item</span>`
        : `<span><kbd>A</kbd><kbd>D</kbd>Run</span><span><kbd>W</kbd>Jump, twice</span><span><kbd>S</kbd>Drop</span><span><kbd>E</kbd>Item</span>`;
      list.append(keys);
    }
    E.tasks.hidden = false;
    this.showTasks(true, false);
  },

  // open: show the lines; else only the title. timed: it closes by itself after
  // a while, and a thin bar draining across the card says how long that is.
  // (During the countdown it simply stays open: timed = false.)
  showTasks(open, timed = true) {
    const h = this.hud;
    const E = this.el;
    h.tasksOpen = open;
    E.tasks.classList.toggle('open', open);
    E.tasks.classList.remove('timed', 'wait');
    E.taskHead.setAttribute('aria-expanded', String(open));
    clearTimeout(h.tasksTimer);
    h.tasksLeft = open && timed ? (this.isTouch ? TASKS_OPEN_TOUCH_MS : TASKS_OPEN_MS) : 0;
    h.tasksEnd = 0;
    this.runTasks();
  },

  // Start the card's clock, or carry on with it - unless the pointer is over the
  // card or its title has the keyboard's focus: then it waits (and so does the bar).
  runTasks() {
    const h = this.hud;
    const E = this.el;
    const now = performance.now();
    if (h.tasksEnd) h.tasksLeft = Math.max(0, h.tasksEnd - now); // (it was running: this much is left)
    h.tasksEnd = 0;
    clearTimeout(h.tasksTimer);
    if (!h.tasksOpen || !(h.tasksLeft > 0)) return;
    if (!E.tasks.classList.contains('timed')) {
      E.tasks.style.setProperty('--ms', `${Math.round(h.tasksLeft)}ms`);
      void E.tasks.offsetWidth; // (so the bar starts from full)
      E.tasks.classList.add('timed');
    }
    const waiting = !!(h.tasksOver || h.tasksFocus);
    E.tasks.classList.toggle('wait', waiting);
    if (waiting) return;
    h.tasksEnd = now + h.tasksLeft;
    h.tasksTimer = setTimeout(() => this.showTasks(false), h.tasksLeft);
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
      this.el.tags.classList.add('intro'); // the round's tags draw the eye for the 3-2-1 (and a beat after GO: see onEvent)
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
          else if (r.width < natural * 0.72) break; // no room for it down there (a phone on its side: the gap between the thumb controls is too narrow even with the line folded)
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

  // a team's plate on the board jumps as its score changes: up (a flag paid) or down (a bomb cost)
  scorePulse(team, up) {
    const e = team === 0 ? this.el.teamA : this.el.teamB;
    if (!e) return;
    e.classList.remove('gain', 'drop');
    void e.offsetWidth;
    e.classList.add(up ? 'gain' : 'drop');
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
  // arms the item a moment after you touch the box) | <kind>
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
    const hold = (named) => {
      const it = ITEM_INFO[kind];
      slot.hidden = false;
      slot.className = 'ready';
      E.itemPic.innerHTML = icon(kind);
      E.itemCap.textContent = it.name;
      slot.title = `${it.name}: ${it.blurb}`;
      this.setUse(kind, true);
      if (named) {
        void slot.offsetWidth; // (so the caption's fade starts afresh even if it was showing a moment ago)
        slot.classList.add('named');
      }
    };
    if (was === 'draw' && h.reelOn) {
      // the reel stops on it and says its name; a moment later it drops into the tile
      this.reelLand(kind);
      h.itemTimer = setTimeout(() => {
        this.reelOff();
        hold(false);
        slot.classList.add('got');
      }, calm.matches ? 900 : ITEM_LAND_MS);
    } else {
      this.reelOff();
      hold(was === '' || was === 'draw');
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
    // (only what the host put in the boxes rolls past - and with a single kind there is nothing to roll)
    const chosen = ITEM_KINDS.filter((k) => (this.info?.items || []).includes(k));
    const pool = chosen.length ? chosen : ITEM_KINDS;
    if (!still && pool.length > 1) {
      const n = Math.max(5, Math.min(13, Math.round(ms / 68)));
      while (seq.length < n) {
        let k = pickRandom(pool);
        if (k === seq[0]) k = pool[(pool.indexOf(k) + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length];
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
      st.left = `${Math.min(host.width - size - 18, Math.max(18, u.left - host.left + u.width / 2 - size / 2))}px`; // (room for the pop it lands with)
      st.top = `${u.top - host.top - size - 34}px`;
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
  // The canvas has as many pixels as the map takes up on this screen.
  bakeMinimap(arena) {
    const c = this.el.minimap;
    const hid = c.hidden;
    c.hidden = false;
    const cssW = c.clientWidth || 220;
    c.hidden = hid;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(cssW * dpr);
    c.height = Math.round((cssW * dpr * 124) / 220);
    const u = c.width / 220; // canvas pixels per unit the marks below are drawn in
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
    for (const p of arena.platforms) g.fillRect(p.x * k, p.y * k, Math.max(1, p.w * k), p.oneway ? 1.4 * u : Math.max(1.4 * u, p.h * k));
    g.strokeStyle = 'rgba(255,255,255,.62)';
    g.lineWidth = 1.4 * u;
    g.beginPath();
    for (const r of arena.ramps) {
      g.moveTo(r.x0 * k, r.y0 * k);
      g.lineTo(r.x1 * k, r.y1 * k);
    }
    g.stroke();
    g.fillStyle = '#ffc94d';
    for (const t of arena.tramps) g.fillRect(t.x * k, t.y * k - u, Math.max(2 * u, t.w * k), 2 * u);
    g.fillStyle = '#ff5a4d';
    for (const sp of arena.spikes) g.fillRect(sp.x * k, sp.y * k, Math.max(2 * u, sp.w * k), 2 * u);
    this.mini = { base, k, ox, oy, u, cssW, arena };
  },

  // Where the HUD stands (about once a second): so that the map and the list of
  // players can turn faint while you are under them, and the pointers to players
  // out of sight (renderer.js) keep off all of it.
  measureHud(m) {
    const E = this.el;
    const a = E.stage.getBoundingClientRect();
    const rect = (e) => {
      const b = e.getBoundingClientRect();
      return b.width && b.height ? { x0: b.left - a.left, y0: b.top - a.top, x1: b.right - a.left, y1: b.bottom - a.top } : null;
    };
    const wide = (r) => r && { x0: r.x0 - 36, y0: r.y0 - 56, x1: r.x1 + 36, y1: r.y1 + 36 };
    const map = rect(E.minimap);
    const lists = [E.pills, E.tasks].map(rect);
    m.rect = wide(map);
    m.lists = lists.map(wide);
    m.w = a.width;
    m.h = a.height;
    const keep = [map, ...lists, rect(E.btnPause), rect(E.hud.querySelector('.hud-key')), rect(E.status), rect(E.itemslot), rect(E.buffs)];
    for (const e of E.top.children) keep.push(rect(e));
    if (!E.touch.hidden) for (const e of E.touch.querySelectorAll('.pad, .acts button')) keep.push(rect(e));
    this.renderer.avoid = keep.filter(Boolean);
    if (map && Math.abs(E.minimap.clientWidth - m.cssW) > 6) this.bakeMinimap(m.arena); // the window changed size: paint the map again at its new one
  },

  drawMinimap(view) {
    let m = this.mini;
    if (!m) return;
    const now = performance.now();
    if (!m.rectAt || now - m.rectAt > 1000) {
      this.measureHud(m);
      m = this.mini; // (it may just have been painted again)
      m.rectAt = now;
      if (!m.rect) this.measureHud(m);
    }
    const c = this.el.minimap;
    const g = c.getContext('2d');
    const u = m.u;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(m.base, 0, 0);
    // Eclipse: the map goes dark with everything else - only you are on it
    const night = !!(view.me && view.me.ecl > 0);
    if (night) {
      g.fillStyle = 'rgba(7,9,18,.82)';
      g.fillRect(0, 0, c.width, c.height);
    }
    g.translate(m.ox, m.oy);
    const k = m.k;
    // what the main view is showing
    const cam = this.renderer.viewRect();
    if (cam && !night) {
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = u;
      g.strokeRect(cam.x * k + 0.5, cam.y * k + 0.5, cam.w * k, cam.h * k);
    }
    if (!night) {
      g.fillStyle = '#ffd23f';
      for (const point of view.boxes || []) {
        const pt = this.renderer.arena.pickups[point];
        if (pt) g.fillRect(pt.x * k - 1.6 * u, pt.y * k - 1.6 * u, 3.2 * u, 3.2 * u);
      }
      if (view.team) {
        // flags: a pole and a pennant in the colour of whoever holds it (pale: nobody's)
        for (const f of view.team.flags) {
          g.fillStyle = f.owner >= 0 ? TEAM_COLORS[f.owner] : '#e9e2cf';
          g.fillRect(f.x * k - u, f.y * k - 9 * u, 2 * u, 9 * u);
          g.fillRect(f.x * k, f.y * k - 9 * u, 6 * u, 4 * u);
        }
      }
    }
    // never hide your own player: the map - and each list of players - turns
    // faint while you are underneath it
    const me = cam && view.players.find((p) => p.local);
    let under = false;
    const sx = me ? ((me.x + PW / 2 - cam.x) / cam.w) * m.w : 0;
    const sy = me ? ((me.y + PH / 2 - cam.y) / cam.h) * m.h : 0;
    const inside = (r) => !!me && !!r && sx > r.x0 && sx < r.x1 && sy > r.y0 && sy < r.y1;
    under = inside(m.rect);
    if (under !== m.under) c.classList.toggle('aside', (m.under = under));
    m.underList ||= [];
    [this.el.pills, this.el.tasks].forEach((list, i) => {
      const u = inside(m.lists && m.lists[i]);
      if (u !== m.underList[i]) list.classList.toggle('aside', (m.underList[i] = u));
    });
    const mySide = view.team ? (view.players.find((p) => p.local)?.team ?? -1) : -1;
    for (const p of view.players) {
      if (p.dead > 0 || (night && !p.local)) continue;
      // Vanish: only they themselves (and their own side) still have them on the map
      if (p.gho > 0 && !p.local && !(mySide >= 0 && p.team === mySide) && !view.spectating) continue;
      const x = (p.x + PW / 2) * k;
      const y = (p.y + PH / 2) * k;
      g.fillStyle = view.team && p.team >= 0 ? TEAM_COLORS[p.team] : this.colorOf(p.slot); // team battle: friend or foe at a glance
      g.beginPath();
      g.arc(x, y, (p.local ? 4 : 3) * u, 0, 6.283);
      g.fill();
      if (p.local) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5 * u;
        g.stroke();
      }
      if (view.it === p.slot || p.bomb) {
        g.strokeStyle = '#ff4d3d';
        g.lineWidth = 1.5 * u;
        g.beginPath();
        g.arc(x, y, 6.5 * u, 0, 6.283);
        g.stroke();
      }
    }
  },

  // How far (world units) something that happened to these players is from the
  // one you are watching: your own, or the middle of the view if you have none.
  farFrom(...slots) {
    const R = this.renderer;
    const mine = R.last[this.mySlot()];
    const cam = R.viewRect();
    const x = mine ? mine.cx : cam ? cam.x + cam.w / 2 : 0;
    const y = mine ? mine.y : cam ? cam.y + cam.h / 2 : 0;
    let d = Infinity;
    for (const slot of slots) {
      const o = R.last[slot];
      if (o) d = Math.min(d, Math.hypot(o.cx - x, o.y - y));
    }
    return d === Infinity ? 0 : d;
  },

  // --- game events -> pictures, words, sound ---------------------------------------------
  onEvent(type, a, b) {
    const me = this.mySlot();
    const R = this.renderer;
    const sfx = this.sfx;
    const team = this.info?.mode === 'team';
    if (type === 'tag') {
      // A tag you are part of is loud and shakes the screen. Anyone else's reaches
      // you by how far away it is: right beside you nearly as loud, within about a
      // screen clearly quieter, further off barely there, beyond TAG_HUSH nothing.
      // (Everyone for themselves: there is only one "it", so news of a tag always
      // carries a little; in a team battle bombs change hands all the time.)
      const d = this.farFrom(b, a);
      const near = d <= TAG_NEAR ? 0.8 : d <= TAG_SCREEN ? 0.45 - (0.27 * (d - TAG_NEAR)) / (TAG_SCREEN - TAG_NEAR) : d <= TAG_HUSH ? (0.18 * (TAG_HUSH - d)) / (TAG_HUSH - TAG_SCREEN) : 0;
      const vol = team ? near : Math.max(near, 0.3);
      R.tagFx(a, b, near);
      if (b === me) sfx.play('tagged');
      else if (a === me) sfx.play('tag', 0.9);
      else if (vol > 0.02) sfx.play('tag', vol);
      if (team) {
        // (someone else's bomb changing hands a long way off is not worth a banner: the list of players shows it)
        if (a === me || b === me || d <= TAG_BANNER) this.banner(b === me ? 'A bomb is on YOU - pass it on!' : a === me ? `You stuck it on ${this.nameOf(b)}!` : `${this.nameOf(b)} has a bomb now`, b === me);
      } else if (b === me) this.banner("You're it!", true);
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
      this.showBrief(0); // the card makes way
      if (this.hud.tasksOpen) this.showTasks(true); // (and the objectives fold a little later)
      clearTimeout(this.hud.tagsTimer);
      this.hud.tagsTimer = setTimeout(() => this.el.tags.classList.remove('intro'), TAGS_LIT_MS); // the tags settle to their plain size
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
      sfx.play({ freeze: 'freeze', blast: 'blast', storm: 'storm', swap: 'swap', quake: 'quake', warp: 'warp', eclipse: 'eclipse', dash: 'dash', ghost: 'ghost', star: 'star' }[kind] || 'pick', a.slot === me || kind === 'quake' || kind === 'eclipse' ? 1 : 0.6);
      const who = a.slot === me ? 'You' : this.nameOf(a.slot);
      if (kind === 'blast') this.banner(`${who} set off a Blast!`, a.slot !== me);
      else if (kind === 'storm') this.banner(`${who} called a Storm!`, a.slot !== me);
      else if (kind === 'freeze') this.banner(`${who} used Frost!`, a.slot !== me);
      else if (kind === 'swap' && a.to >= 0 && (a.slot === me || a.to === me)) this.banner(a.slot === me ? `You swapped with ${this.nameOf(a.to)}` : `${who} swapped places with you!`, a.to === me);
      else if (kind === 'quake') this.banner(a.slot === me ? 'Quake! Everyone else is in the air' : `${who} shook the ground - Quake!`, a.slot !== me);
      else if (kind === 'eclipse') this.banner(a.slot === me ? 'Eclipse! Nobody else can see' : `${who} called an Eclipse!`, a.slot !== me);
      else if (kind === 'ghost' && a.slot === me) this.banner('Vanish! Nobody can see you');
      else if (kind === 'ghost' && (!team || this.game?.teamOf?.(me) !== this.game?.teamOf?.(a.slot))) this.banner(`${who} has vanished!`, true);
      else if (kind === 'star') this.banner(a.slot === me ? 'Titan! Nothing can touch you' : `${who} is a Titan - nothing touches them`, a.slot !== me);
      else if (kind === 'warp' && a.to === me) this.banner(`${who} warped right beside you!`, true);
      else if (kind === 'warp' && a.slot === me && a.tx != null) this.banner(a.to >= 0 ? `Warp! Right beside ${this.nameOf(a.to)}` : team ? 'Warp! Far away from their bombs' : 'Warp! Far away from the oni');
    } else if (type === 'boom') {
      R.boomFx(a);
      sfx.play('boom');
      this.banner(a.slot === me ? `BOOM! Your bomb costs ${TEAM_NAMES[a.team]} ${BOMB_POINTS} points` : `BOOM! ${this.nameOf(a.slot)} blows up: ${TEAM_NAMES[a.team]} lose ${BOMB_POINTS} points`, this.game?.teamOf?.(me) === a.team);
      if (a.n) R.pointFx?.(a.x, a.y - 50, `\u2212${a.n}`, '#ff5a3c', true);
      this.scorePulse(a.team, false);
    } else if (type === 'cost') {
      // the beat: a bomb in hand takes a point off its side (a = { slot, team, n })
      const at = R.last?.[a.slot];
      if (at && a.n) R.pointFx?.(at.cx, at.y - 34, `\u2212${a.n}`, '#ff5a3c');
      if (a.n) this.scorePulse(a.team, false);
      if (a.slot === me && a.n) sfx.play('minus');
    } else if (type === 'it') {
      if (team) this.banner(a.to === me ? 'A bomb has been handed to you!' : `${this.nameOf(a.to)} has a bomb now`, a.to === me);
    } else if (type === 'flag') {
      // a = { what: take | lose | pay (the beat: a point for the side whose colour it is), team, i }
      const mine = this.game?.teamOf?.(me) === a.team;
      const letter = FLAG_LETTERS[a.i];
      if (a.what === 'take') {
        this.banner(`${TEAM_NAMES[a.team]} hold flag ${letter}!`, !mine && me >= 0);
        sfx.play(mine ? 'pick' : 'block', 0.9);
        R.flagFx?.(a.i, a.team);
      } else if (a.what === 'lose') this.banner(`Flag ${letter} is up for grabs`);
      else if (a.what === 'pay') {
        const b = R.arena?.bases[a.i];
        if (b) R.pointFx?.(b[0], b[1] - 130, `+${a.n || FLAG_POINTS}`, TEAM_COLORS[a.team]);
        R.flagFx?.(a.i, a.team, true);
        this.scorePulse(a.team, true);
        if (mine) sfx.play('point', 0.7);
      }
    }
  },
};
