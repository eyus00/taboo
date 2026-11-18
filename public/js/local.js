// A match that runs entirely in the browser: practice against bots.
// Same rules code as the server, so it plays exactly like an online match.

import { TICK_MS, TICK_RATE, COUNTDOWN_MS, INTRO_MS, VS_MS, MAX_PLAYERS, TEAM_SLOTS, BOMB_END_TICKS, FLAG_CAP_TICKS, twistById } from '/shared/config.js';
import { Sim, standings, makeTeams } from '/shared/sim.js';
import { makeBot, botThink, prepareBots, BOT_NAMES } from '/shared/bots.js';

export class LocalGame {
  // opts: { arena, mode, duration, powerups, name, bots, input, onEvent, intro, squad, twist, cup }
  //   squad: { names, teams } from the match before, to play again with the same bots on the same sides
  //   twist: a twist's id, to try one out here; cup: what a tournament round would say about itself
  //   ({ round, rounds, double, leader }) - it changes nothing in the round, only what the display is told
  constructor(opts) {
    this.arena = opts.arena;
    this.mode = opts.mode || 'potato';
    this.duration = opts.duration || 60;
    this.input = opts.input;
    this.onEvent = opts.onEvent || (() => {});
    this.sim = new Sim(this.arena);
    this.sim.powerups = opts.powerups !== false;
    this.sim.itemPool = Array.isArray(opts.items) ? opts.items.slice() : null; // which kinds are in the boxes (none given: all)
    this.twistId = opts.twist && opts.twist !== 'none' ? twistById(opts.twist).id : 'none';
    if (this.twistId !== 'none') this.sim.twist = twistById(this.twistId);
    this.cup = opts.cup || null;
    this.names = [opts.name];
    this.bots = new Array(MAX_PLAYERS).fill(null);
    this.human = 0;
    this.twist = this.sim.twist;

    const count = Math.max(1, Math.min(MAX_PLAYERS - 1, opts.bots || 3));
    const slots = [...Array(count + 1).keys()];
    // the same bots as last time (and, below, the same sides) if this is "play again"
    const old = opts.squad && opts.squad.names.length === count + 1 ? opts.squad : null;
    const pool = old ? old.names.slice(1) : BOT_NAMES.filter((n) => n.toLowerCase() !== String(opts.name).toLowerCase()).sort(() => Math.random() - 0.5);
    // team battle: two sides, each starting on its own half, one in warm colours and one in cool
    this.teams = null;
    this.cols = null;
    if (this.mode === 'team') {
      this.teams = new Array(MAX_PLAYERS).fill(-1);
      this.cols = new Array(MAX_PLAYERS).fill(0);
      const sides = old && old.teams ? [0, 1].map((t) => slots.filter((slot) => old.teams[slot] === t)) : makeTeams(slots);
      sides.forEach((list, t) => list.forEach((slot, i) => ((this.teams[slot] = t), (this.cols[slot] = TEAM_SLOTS[t][i % TEAM_SLOTS[t].length]))));
    }
    const order = [...this.arena.spawns.keys()].sort(() => Math.random() - 0.5);
    const half = [order.filter((i) => this.arena.spawns[i][0] < this.arena.w / 2), order.filter((i) => this.arena.spawns[i][0] >= this.arena.w / 2)];
    for (const slot of slots) {
      const spot = this.teams && half[this.teams[slot]].length ? half[this.teams[slot]].shift() : order[slot];
      this.sim.add(slot, spot);
      if (slot > 0) {
        this.sim.players[slot].auto = true; // (a bot: see tagFrom in sim.js)
        this.names[slot] = pool[slot - 1];
        this.bots[slot] = makeBot(Math.floor(Math.random() * 1e6) + slot);
      }
    }
    if (this.teams) this.sim.setTeams(this.teams);
    this.squad = { names: this.names.slice(), teams: this.teams ? this.teams.slice() : null };
    prepareBots(this.arena); // work out the bots' route map now, not on the first tick of the round
    this.startIt = slots[Math.floor(Math.random() * slots.length)]; // drawn now, so the draw can be shown

    this.phase = 'countdown';
    this.countdownMs = (opts.intro ?? VS_MS + INTRO_MS) + COUNTDOWN_MS;
    this.goTime = null;
    this.endTick = 0;
    this.acc = 0;
    this.lastNow = null;
    this.lastCount = 4;
    this.lastSecond = -1;
    this.prev = new Array(MAX_PLAYERS).fill(null);
  }

  // What this round is, in the same shape the server announces an online round.
  info() {
    return {
      mode: this.mode,
      duration: this.duration,
      twist: this.twistId,
      cup: this.cup,
      items: this.sim.itemPool || [],
      it: this.teams ? -1 : this.startIt,
      bombs: this.teams ? this.sim.bombPlan : null, // team battle: who starts with a bomb
      teams: this.teams,
      cols: this.cols,
      countdown: this.countdownMs,
      players: this.names.map((name, slot) => ({ slot, name })),
    };
  }

  teamOf(slot) {
    return this.teams ? this.teams[slot] : -1;
  }

  update(now) {
    const dt = this.lastNow == null ? 0 : Math.min(now - this.lastNow, 100);
    this.lastNow = now;
    const sim = this.sim;

    if (this.phase === 'countdown') {
      this.countdownMs -= dt;
      const n = Math.ceil(this.countdownMs / 1000);
      if (n !== this.lastCount && n >= 1 && n <= 3) {
        this.lastCount = n;
        this.onEvent('count', n);
      }
      if (this.countdownMs <= 0) {
        this.phase = 'playing';
        this.goTime = now;
        sim.start(this.startIt);
        this.endTick = sim.tick + this.duration * TICK_RATE;
        this.onEvent('go', sim.it, sim.bombs());
      }
    }

    if (this.phase !== 'over') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 5) {
        this.acc -= TICK_MS;
        steps++;
        for (const p of sim.players) if (p) this.prev[p.slot] = { x: p.s.x, y: p.s.y, dead: p.s.dead };
        const inputs = new Array(MAX_PLAYERS).fill(0);
        if (this.phase === 'playing') {
          inputs[0] = this.input ? this.input.bits() : 0;
          for (let s = 1; s < MAX_PLAYERS; s++) if (this.bots[s]) inputs[s] = botThink(sim, s, this.bots[s]);
        }
        sim.step(inputs);
        if (this.phase === 'playing' && sim.tick >= this.endTick && !sim.over) {
          // the buzzer: in a team battle the bombs go off now, and there is a moment to see it
          sim.finish();
          this.doneTick = sim.tick + (sim.teams ? BOMB_END_TICKS : 0);
        }
        for (const e of sim.events) {
          if (e.type === 'tag') this.onEvent('tag', e.from, e.to);
          else if (e.type === 'block') this.onEvent('block', e.from, e.to);
          else if (e.type === 'pick') this.onEvent('pick', e.slot, e.kind);
          else if (e.type !== 'spawn') this.onEvent(e.type, e); // items going off, the bomb, flags
        }
        sim.events.length = 0;
        if (this.phase === 'playing' && sim.over && sim.tick >= this.doneTick) {
          this.phase = 'over';
          const { rows, winners, loser, score, win } = standings(sim, this.names, this.mode);
          this.onEvent('end', {
            reason: 'time',
            mode: this.mode,
            winners,
            loser,
            cup: null,
            team: this.teams ? { score, win, total: null } : null,
            rows: rows.map((r) => ({ slot: r.slot, name: r.name, ms: Math.round((r.ticks * 1000) / TICK_RATE), tags: r.tags, pts: 0, team: r.team, boom: !!r.boom, caps: r.caps || 0 })),
          });
          break;
        }
      }
      if (this.acc >= TICK_MS) this.acc = 0; // tab was in the background: skip the backlog
    }

    // draw between the last two steps, so motion is smooth at any refresh rate
    const a = this.phase === 'over' ? 1 : this.acc / TICK_MS;
    // Before GO, once the draw is over and the count is on: who is going to start as it,
    // or with a bomb, is shown already (the sim only makes it so at GO).
    const pre = this.phase === 'countdown' && this.countdownMs <= COUNTDOWN_MS;
    const plan = pre && this.teams ? sim.bombPlan || [] : [];
    const players = [];
    for (const p of sim.players) {
      if (!p) continue;
      const s = p.s;
      const pr = this.prev[p.slot];
      const smooth = pr && pr.dead === 0 && s.dead === 0 && Math.abs(pr.y - s.y) + Math.abs(pr.x - s.x) < 90;
      players.push({
        slot: p.slot,
        name: this.names[p.slot],
        col: this.cols ? this.cols[p.slot] : p.slot,
        team: p.team,
        bomb: p.bomb || plan.includes(p.slot),
        x: smooth ? pr.x + (s.x - pr.x) * a : s.x,
        y: smooth ? pr.y + (s.y - pr.y) * a : s.y,
        vx: s.vx,
        vy: s.vy,
        ground: s.ground,
        face: s.face,
        immune: p.immune,
        stun: s.stun,
        frz: s.frz,
        orb: s.orb,
        canDrop: s.orb > 0 && !!this.arena.portals[s.pi]?.drop, // this portal lets you let go mid-flight
        spd: s.spd,
        jmp: s.jmp,
        shd: s.shd,
        slw: s.slw,
        ecl: s.ecl,
        dsh: s.dsh,
        gho: s.gho,
        inv: s.inv,
        dead: s.dead,
        itTicks: p.itTicks,
        item: p.item,
        arm: p.arm,
        local: p.slot === 0,
      });
    }
    const timeLeft = this.phase === 'countdown' ? this.duration : Math.max(0, (this.endTick - sim.tick) / TICK_RATE);
    if (this.phase === 'playing') {
      const sec = Math.ceil(timeLeft);
      if (sec !== this.lastSecond) {
        if (sec <= 5 && sec >= 1 && this.lastSecond !== -1) this.onEvent('tick', sec);
        this.lastSecond = sec;
      }
    }
    const me = sim.players[0];
    return {
      phase: this.phase,
      mode: this.mode,
      cup: null,
      twist: sim.twist,
      mySlot: 0,
      countdownMs: this.phase === 'countdown' ? this.countdownMs : null,
      goAge: this.goTime != null ? (now - this.goTime) / 1000 : null,
      timeLeft,
      duration: this.duration,
      it: this.phase === 'countdown' ? (pre && !this.teams ? this.startIt : -1) : sim.it,
      pre,
      players,
      boxes: sim.boxes,
      team: sim.teams ? { score: sim.score, over: sim.over, flags: sim.flags.map((f) => ({ x: f.x, y: f.y, owner: f.owner, fill: f.m / FLAG_CAP_TICKS })) } : null,
      me: this.phase === 'playing' ? { spd: me.s.spd, jmp: me.s.jmp, shd: me.s.shd, slw: me.s.slw, ecl: me.s.ecl, gho: me.s.gho, inv: me.s.inv, item: me.item, arm: me.arm } : null,
      code: null,
      ping: null,
      spectating: false,
    };
  }
}
