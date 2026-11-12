// Everything that happens while a match is on screen: the renderer, the frame
// loop, the heads-up display (timer, players, item slot, team score, minimap),
// touch controls, and turning game events into pictures, words and sound.
//
// The menus (main.js) only call a handful of things here:
//   play.init({ socket, isTouch, onStart(info), onEnd(results), onPause() })
//   play.practice(settings, name)        a match against bots
//   play.round(msg, mySlot)              an online round is starting
//   play.finish() / play.stop() / play.hold(true|false)
//   play.nameOf(slot), play.mySlot(), play.colors(), play.el.spin

import { MODES, TICK_RATE, COUNTDOWN_MS, ITEM_KINDS, ITEM_INFO, TEAM_NAMES, TEAM_COLORS, BOMB_FUSE_TICKS, PW, PH } from '/shared/config.js';
import { ARENA_IDS, arenaById } from '/shared/arenas.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { NetGame } from './net.js';
import { LocalGame } from './local.js';
import { loadTheme } from './themes/index.js';
import { THEMES } from '/shared/config.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const icon = (name) => `<svg class="ic"><use href="#pi-${name}" /></svg>`;
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

// item icons (and a few others), kept here so the match needs nothing from the page
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="pi-left" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-right" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-up" viewBox="0 0 24 24"><path d="M5 14l7-7 7 7M5 20l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-down" viewBox="0 0 24 24"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></symbol>
<symbol id="pi-speed" viewBox="0 0 24 24"><path d="M14 2L5 13.5h6L8.5 22 19 9.8h-6z" fill="currentColor"/></symbol>
<symbol id="pi-jump" viewBox="0 0 24 24"><path d="M5 11l7-7 7 7M5 20l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-shield" viewBox="0 0 24 24"><path d="M12 2l8 3.6v6.6c0 5-3.4 8.4-8 9.800-4.600-1.400-8-4.800-8-9.800V5.600z" fill="currentColor"/></symbol>
<symbol id="pi-freeze" viewBox="0 0 24 24"><path d="M12 2v20M3.300 7l17.400 10M20.700 7L3.300 17" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/></symbol>
<symbol id="pi-blast" viewBox="0 0 24 24"><path d="M12 1l2.600 6.200L21 4.500l-2.700 6.400L23 12l-4.700 1.100L21 19.500l-6.400-2.700L12 23l-2.600-6.200L3 19.500l2.700-6.400L1 12l4.700-1.100L3 4.500l6.400 2.700z" fill="currentColor"/></symbol>
<symbol id="pi-swap" viewBox="0 0 24 24"><path d="M4 8h14l-4-4M20 16H6l4 4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-storm" viewBox="0 0 24 24"><path d="M6 13a5 5 0 1 1 3.500-8.500A6 6 0 0 1 20 8a4 4 0 0 1-2 7.500" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/><path d="M12 12l-3 5h4l-2 5" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-goo" viewBox="0 0 24 24"><path d="M12 2c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z" fill="currentColor"/></symbol>
<symbol id="pi-box" viewBox="0 0 24 24"><path d="M8 9a4 4 0 1 1 6 3.500c-1.300.800-2 1.500-2 3M12 19.500v.500" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></symbol>
<symbol id="pi-bomb" viewBox="0 0 24 24"><circle cx="10.500" cy="14" r="7.500" fill="currentColor"/><path d="M15.500 8.500l3-3M18 3l3 1-1 3" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="pi-flag" viewBox="0 0 24 24"><path d="M6 22V3M6 4h12l-3 4 3 4H6" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/></symbol>
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
        <ul id="pills" aria-label="Players"></ul>
        <div class="clock">
          <div class="scoreline"><b id="team-a" hidden></b><div id="timer" aria-label="Seconds left">60</div><b id="team-b" hidden></b></div>
          <div id="fuse" hidden><i></i></div>
          <div id="round-label"></div>
        </div>
        <button id="btn-pause" class="hud-btn" aria-label="Menu (Esc)">${icon('menu')}</button>
        <kbd class="hud-key">Esc</kbd>
        <canvas id="minimap" width="220" height="124" aria-hidden="true"></canvas>
        <div id="itemslot" hidden><span class="pic"></span><span class="what"><b></b><small></small></span><kbd>E</kbd></div>
        <div id="buffs"></div>
        <div id="banner" role="status"></div>
        <div id="count" aria-hidden="true"></div>
        <div id="hint"></div>
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
    for (const id of ['stage', 'pills', 'timer', 'team-a', 'team-b', 'fuse', 'round-label', 'btn-pause', 'minimap', 'itemslot', 'buffs', 'banner', 'count', 'hint', 'spin', 'touch']) this.el[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = root.querySelector(`#${id}`);
    this.root = root;
    this.isTouch = opts.isTouch;
    // on touch screens the view can scroll a little past the floor, so the buttons never cover you
    this.renderer = new Renderer(this.el.stage, { padBottom: opts.isTouch ? 104 : 0 });
    this.input = new Input();
    this.sfx = new Sfx();
    this.net = new NetGame(opts.socket, this.input, (t, a, b) => this.onEvent(t, a, b));
    this.input.bindTouch(this.el.touch);
    this.renderer.onEvent = (type, pv) => this.sfx.play(type, pv.local ? 1 : 0.35);
    this.el.btnPause.addEventListener('click', () => opts.onPause?.());
    const s = opts.socket;
    s.on('s', (m) => this.game === this.net && this.net.onSnap(m));
    s.on('go', (it) => this.game === this.net && this.net.onGo(it));
    s.on('tag', (from, to) => this.game === this.net && this.onEvent('tag', from, to));
    s.on('block', (from, to) => this.game === this.net && this.onEvent('block', from, to));
    s.on('pick', (slot, k) => this.game === this.net && this.onEvent('pick', slot, k));
    s.on('ev', (e) => this.game === this.net && this.onEvent(e.type, e));
    this.hud = { sec: -1, count: 0, pills: [], buffs: '', hintNow: '', hint: '', item: '', teams: '', spinAt: 0, mapAt: 0 };
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

  // --- starting and stopping ----------------------------------------------------------
  async practice(s, name) {
    const arena = arenaById(s.arena === 'random' ? pickRandom(ARENA_IDS) : s.arena);
    const themeId = s.theme === 'random' ? pickRandom(THEMES).id : s.theme;
    await loadTheme(themeId);
    this.kind = 'practice';
    const g = new LocalGame({ arena, mode: s.mode, duration: s.duration, powerups: s.powerups, name, bots: s.bots, input: this.input, onEvent: (t, a, b) => this.onEvent(t, a, b) });
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
    Object.assign(h, { sec: -1, count: 0, buffs: '', pills: [], hintNow: '', item: '', teams: '' });
    this.el.pills.textContent = '';
    this.el.buffs.textContent = '';
    this.el.count.textContent = '';
    this.el.banner.className = '';
    this.el.itemslot.hidden = true;
    const team = info.mode === 'team';
    for (const [id, t] of [['teamA', 0], ['teamB', 1]]) {
      this.el[id].hidden = !team;
      this.el[id].style.background = TEAM_COLORS[t];
    }
    this.el.fuse.hidden = !team;
    const mode = MODES.find((m) => m.id === info.mode)?.name || '';
    let label = this.kind === 'practice' ? `Practice - ${mode}` : mode;
    let hint = '';
    if (info.cup) {
      label = info.cup.double ? 'Final round - double points' : `Round ${info.cup.round} of ${info.cup.rounds}`;
      if (team) label += ' - Team Bomb';
      if (info.twist && info.twist !== 'none' && g.twist?.name) {
        label += ` - ${g.twist.name}`;
        hint = `Twist: ${g.twist.name} - ${g.twist.blurb.toLowerCase()}. `;
      }
      if (info.cup.leader >= 0) hint += `${this.nameOf(info.cup.leader)} leads, so starts as it.`;
    }
    if (!hint && team) hint = 'Stick the bomb on an enemy before it blows. Steal their flag and carry it home.';
    // the first few matches on a keyboard start with a reminder of the keys
    let played = 0;
    try {
      played = Number(localStorage.getItem('tag.played')) || 0;
      localStorage.setItem('tag.played', String(played + 1));
    } catch {}
    if (!hint && !this.isTouch && played < 3) hint = 'Arrows or A / D to run - Up, W or Space to jump, again in the air for a second jump - Down to drop - E to use an item';
    this.el.roundLabel.textContent = label;
    h.hint = hint;
    this.el.touch.hidden = !this.isTouch;
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
  updateHud(view) {
    const h = this.hud;
    const E = this.el;
    const sec = view.phase === 'countdown' ? view.duration : Math.ceil(view.timeLeft);
    if (sec !== h.sec) {
      h.sec = sec;
      E.timer.textContent = String(sec);
      E.timer.classList.toggle('low', view.phase === 'playing' && sec <= 10);
    }
    // one plaque per player: colour, name, seconds spent as it
    const seen = [];
    for (const p of view.players) {
      seen[p.slot] = true;
      let pill = h.pills[p.slot];
      if (!pill) {
        const li = el('li');
        const chip = el('i', 'chip');
        chip.style.background = this.colorOf(p.slot);
        const val = el('span', 'val');
        li.append(chip, el('span', 'nm', p.name), val);
        li.classList.toggle('me', !!p.local);
        if (p.team >= 0) li.style.order = String(p.team);
        E.pills.append(li);
        pill = h.pills[p.slot] = { li, val, text: '', it: false };
      }
      const text = `${Math.floor((p.itTicks || 0) / TICK_RATE)}s`;
      if (text !== pill.text) pill.val.textContent = pill.text = text;
      const it = view.it === p.slot;
      if (it !== pill.it) pill.li.classList.toggle('it', (pill.it = it));
    }
    h.pills.forEach((pill, slot) => pill && pill.li.classList.toggle('gone', !seen[slot]));
    E.pills.classList.toggle('many', view.players.length > 4); // five or six: two columns
    E.pills.classList.toggle('bomb', !!view.team);

    // team battle: the score either side of the clock, and the fuse under it
    if (view.team) {
      const t = view.team;
      const sig = `${t.score[0]}-${t.score[1]}`;
      if (sig !== h.teams) {
        h.teams = sig;
        E.teamA.textContent = `${TEAM_NAMES[0]} ${t.score[0]}`;
        E.teamB.textContent = `${t.score[1]} ${TEAM_NAMES[1]}`;
      }
      const f = view.it >= 0 ? Math.max(0, Math.min(1, t.fuse / BOMB_FUSE_TICKS)) : 0;
      E.fuse.firstChild.style.transform = `scaleX(${f.toFixed(3)})`;
      E.fuse.classList.toggle('hot', view.it >= 0 && t.fuse < 240);
    }

    // the item in your hands
    const m = view.me;
    const kind = m && m.item ? ITEM_KINDS[m.item - 1] : '';
    const state = !kind ? '' : m.arm > 0 ? 'draw' : m.locked ? `${kind}-locked` : kind;
    if (state !== h.item) {
      h.item = state;
      E.itemslot.hidden = !kind;
      E.itemslot.className = !kind ? '' : m.arm > 0 ? 'draw' : m.locked ? 'locked' : 'ready';
      if (kind && m.arm === 0) {
        E.itemslot.querySelector('.pic').innerHTML = icon(kind);
        E.itemslot.querySelector('b').textContent = ITEM_INFO[kind].name;
        E.itemslot.querySelector('small').textContent = m.locked ? 'Locked: the round is nearly over' : ITEM_INFO[kind].blurb;
        E.itemslot.dataset.kind = kind;
      } else if (kind) {
        E.itemslot.querySelector('b').textContent = '...';
        E.itemslot.querySelector('small').textContent = '';
        E.itemslot.dataset.kind = '';
      }
      const use = E.touch.querySelector('.t-use');
      use.innerHTML = icon(kind && m.arm === 0 ? kind : 'box');
      use.classList.toggle('ready', !!kind && m.arm === 0 && !m.locked);
    }
    if (kind && m.arm > 0) E.itemslot.querySelector('.pic').innerHTML = icon(ITEM_KINDS[Math.floor(performance.now() / 70) % ITEM_KINDS.length]); // the draw spins

    // boosts that are running
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
    if (view.phase === 'countdown' && view.countdownMs <= COUNTDOWN_MS) {
      const n = Math.min(3, Math.max(1, Math.ceil((view.countdownMs || 0) / 1000)));
      if (n !== h.count) {
        h.count = n;
        this.pop(String(n));
      }
    }
    // the minimap is only for when you cannot see everything anyway
    E.minimap.hidden = view.phase === 'over' || (view.phase === 'countdown' && view.countdownMs > 1800);
    const hint = view.spectating ? 'Watching - you play in the next round' : view.phase === 'countdown' && view.countdownMs <= COUNTDOWN_MS ? h.hint : '';
    if (hint !== h.hintNow) E.hint.textContent = h.hintNow = hint;
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
      view.team.flags.forEach((f, t) => {
        g.fillStyle = TEAM_COLORS[t];
        g.fillRect(f.x * k - 1, f.y * k - 4, 2, 7);
        g.fillRect(f.x * k, f.y * k - 4, 5, 3.500);
      });
    }
    for (const p of view.players) {
      if (p.dead > 0) continue;
      const x = (p.x + PW / 2) * k;
      const y = (p.y + PH / 2) * k;
      g.fillStyle = this.colorOf(p.slot);
      g.beginPath();
      g.arc(x, y, p.local ? 4 : 3, 0, 6.283);
      g.fill();
      if (p.local) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.500;
        g.stroke();
      }
      if (view.it === p.slot) {
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
      if (team) this.banner(b === me ? 'The bomb is on YOU!' : a === me ? `You stuck it on ${this.nameOf(b)}!` : `${this.nameOf(b)} has the bomb`, b === me);
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
      this.pop('GO!');
      setTimeout(() => this.el.count.textContent === 'GO!' && (this.el.count.textContent = ''), 900);
      if (team) this.banner(a === me ? 'You carry the bomb - stick it on an enemy!' : `${this.nameOf(a)} carries the bomb`, a === me);
      else this.banner(a === me ? "You're it - catch someone!" : `${this.nameOf(a)} is it - run!`, a === me);
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
      this.banner(`BOOM! ${TEAM_NAMES[a.team]} score`, this.game?.teamOf?.(me) !== a.team);
    } else if (type === 'it') {
      if (team) this.banner(a.to === me ? 'A new bomb - and it is yours!' : `${this.nameOf(a.to)} has a new bomb`, a.to === me);
    } else if (type === 'flag') {
      const who = a.slot === me ? 'You' : this.nameOf(a.slot);
      if (a.what === 'take') this.banner(`${who} took the ${TEAM_NAMES[a.team]} flag!`, this.game?.teamOf?.(me) === a.team);
      else if (a.what === 'capture') {
        this.banner(`${who} captured the flag! ${TEAM_NAMES[a.team]} score`, this.game?.teamOf?.(me) !== a.team);
        sfx.play('win');
        R.shake(5);
      } else if (a.what === 'save') this.banner(`${who} saved the flag`);
    }
  },
};
