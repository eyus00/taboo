// Little live demos for the How to play page: each one is a tiny hand-made
// arena where the real game engine plays a short scripted scene in a loop.
//
// A scene is a generator: every `yield` is one tick of buttons for "You". It can
// look at the players between ticks, so scripts read like stage directions
// ("run right until you are past the box, then press USE") and keep working if
// the feel of the game is tuned later.
//
//   demos.mount(root)   find every [data-demo] under root and get it ready
//   demos.start()       run the ones that are on screen (about 30 frames a second)
//   demos.stop()        stop everything

import { PW, PH, TICK_MS, MAX_PLAYERS, IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN, IN_USE, ITEM_KINDS, ITEM_INFO, TEAM_NAMES, TEAM_COLORS, TEAM_SLOTS, BOMB_FUSE_TICKS, BOMB_POINTS, FLAG_POINTS } from '/shared/config.js';
import { Sim } from '/shared/sim.js';
import { makeBot, botThink } from '/shared/bots.js';
import { Renderer } from './renderer.js';

const L = IN_LEFT;
const R = IN_RIGHT;
const J = IN_JUMP;
const D = IN_DOWN;
const U = IN_USE;

// --- tiny arenas ------------------------------------------------------------------
const W = 560;
const H = 420;
const FLOOR = H - 40; // where feet stand on the floor

function world(id, parts) {
  return { id: `demo-${id}`, name: '', blurb: '', w: W, h: H, platforms: [], ramps: [], tramps: [], spikes: [], bases: [], lifts: [], portals: [], pickups: [], spawns: [[20, FLOOR - PH]], respawns: [[20, FLOOR - PH]], ...parts };
}
const floor = () => ({ x: 0, y: FLOOR, w: W, h: H - FLOOR, oneway: false, ground: true });
const ledge = (x, y, w) => ({ x, y, w, h: 14, oneway: true, ground: false });
const pad = (x, y, vx = 0, vy = 0, w = 68) => ({ x, y: y - 16, w, h: 16, cx: x + w / 2, vx, vy });
const gate = (cx, bottom, to, drop = false, pair = 0) => ({ x: cx - 22, y: bottom - 76, w: 44, h: 76, cx, cy: bottom - 38, to, pair, drop });
const thorns = (x, y, w) => ({ x, y: y - 16, w, h: 16 });

// --- stage directions ---------------------------------------------------------------
const cx = (s) => s.x + PW / 2;
const feet = (s) => s.y + PH;
const kindId = (kind) => ITEM_KINDS.indexOf(kind) + 1;
const steer = (s, x, slack = 6) => (cx(s) < x - slack ? R : cx(s) > x + slack ? L : 0);

function* hold(bits, n) {
  for (let i = 0; i < n; i++) yield bits;
}
// keep pressing until something is true (bits may be a function, for steering)
function* until(bits, done, max = 360) {
  for (let i = 0; i < max && !done(); i++) yield typeof bits === 'function' ? bits() : bits;
}
function* runTo(s, x, extra = 0, max = 300) {
  const dir = cx(s) < x ? 1 : -1;
  yield* until((dir > 0 ? R : L) | extra, () => (cx(s) - x) * dir >= 0, max);
}
// in the air: steer towards x until we land
function* airTo(s, x, extra = 0, max = 240) {
  yield* until(() => steer(s, x) | extra, () => s.ground, max);
}

// what the other players do: (run, slot) => buttons
const chase = (target, hop = true) => (run, slot) => {
  const s = run.sim.players[slot].s;
  const t = run.sim.players[target].s;
  return steer(s, cx(t), 4) | (hop && s.ground && feet(t) < feet(s) - 60 && Math.abs(cx(t) - cx(s)) < 110 ? J : 0);
};
const flee = (from) => (run, slot) => {
  const s = run.sim.players[slot].s;
  return cx(s) < cx(run.sim.players[from].s) ? L : R;
};
const pace = (x0, x1) => {
  let dir = -1;
  return (run, slot) => {
    const s = run.sim.players[slot].s;
    if (cx(s) > x1) dir = -1;
    else if (cx(s) < x0) dir = 1;
    return dir > 0 ? R : L;
  };
};

// --- the scenes ---------------------------------------------------------------------
// d is the running scene (see Run below): d.cast() puts the players on stage,
// d.say() changes the caption, d.ai[slot] says what somebody else does.

const ITEM_ACTS = {
  *box(d) {
    const me = d.cast([{ name: 'You', x: 110 }]);
    d.show('box');
    d.sim.boxes.push(0);
    d.sim.rollItem = () => kindId('jump');
    d.say('Touch a lucky box to draw an item');
    yield* hold(0, 40);
    yield* runTo(me, 300);
    yield* hold(0, 14);
    d.say('The draw takes a moment...');
    yield* until(0, () => d.p(0).arm === 0, 90);
    d.show('jump', 'It is yours to keep');
    d.say('Set it off whenever you like');
    yield* hold(0, 70);
    yield U;
    yield* hold(0, 30);
  },
  *speed(d) {
    const me = d.cast([{ name: 'You', x: 120 }, { name: 'Oni', x: 30 }], { it: 1 });
    d.give('speed');
    d.ai[1] = chase(0, false);
    d.say('The oni is right behind you...');
    yield* runTo(me, 210);
    d.say('Swift! You pull away');
    yield R | U;
    yield* runTo(me, 515);
    d.ai[1] = null;
    yield* hold(0, 45);
  },
  *jump(d) {
    const me = d.cast([{ name: 'You', x: 345 }]);
    d.give('jump');
    d.say('Too high for a normal jump...');
    yield* hold(0, 30);
    yield J;
    yield* until(J, () => me.ground, 150);
    yield* hold(0, 22);
    d.say('Spring! Up you go');
    yield U;
    yield* hold(0, 22);
    yield J;
    yield* until(J, () => me.ground, 180);
    yield* hold(0, 60);
  },
  *shield(d) {
    const me = d.cast([{ name: 'You', x: 190 }, { name: 'Oni', x: 520, face: -1 }], { it: 1 });
    d.give('shield');
    d.say('Here comes the oni...');
    yield* hold(0, 26);
    yield U;
    d.ai[1] = chase(0, false);
    yield* until(0, () => d.p(1).s.stun > 0, 200);
    d.say('Blocked! The oni is knocked back');
    yield* hold(0, 16);
    yield* runTo(me, 70);
    d.ai[1] = null;
    yield* hold(0, 30);
  },
  *freeze(d) {
    const me = d.cast([{ name: 'You', x: 130 }, { name: 'Oni', x: 520, face: -1 }], { it: 1 });
    d.give('freeze');
    d.ai[1] = chase(0, false);
    d.say('The oni charges...');
    yield* until(0, () => cx(d.p(1).s) - cx(me) < 170, 200);
    d.say('Frost! Frozen solid');
    yield U;
    yield* hold(0, 34);
    yield* until(R, () => cx(d.p(1).s) - cx(me) < 84, 100);
    yield R | J;
    yield* until(R | J, () => me.vy > 0, 60);
    yield* until(R, () => me.ground, 90);
    yield* runTo(me, 500);
    d.ai[1] = null;
    yield* hold(0, 20);
  },
  *blast(d) {
    const me = d.cast([{ name: 'You', x: 280 }, { name: 'Oni', x: 40 }, { name: 'Kiko', x: 520, face: -1 }], { it: 1 });
    d.give('blast');
    d.ai[1] = chase(0, false);
    d.ai[2] = pace(330, 525);
    d.say('Too close for comfort...');
    yield* until(0, () => cx(me) - cx(d.p(1).s) < 86, 200);
    d.say('Blast! Everyone nearby goes flying');
    yield U;
    d.ai[1] = d.ai[2] = null;
    yield* hold(0, 100);
  },
  *swap(d) {
    const me = d.cast([{ name: 'You', x: 90 }, { name: 'Oni', x: 520, face: -1 }, { name: 'Kiko', x: 345, y: 150 }], { it: 1 });
    d.sim.rnd = () => 0.99; // of everyone it could be, the swap takes the last: Kiko
    d.give('swap');
    d.ai[1] = chase(0, false);
    d.say('Cornered by the oni...');
    yield* until(0, () => cx(d.p(1).s) - cx(me) < 150, 240);
    d.say('Swap! Kiko can deal with that');
    yield U;
    d.ai[1] = chase(2, false);
    yield* until(0, () => d.sim.it === 2, 150);
    d.ai[1] = flee(2);
    yield* hold(0, 50);
  },
  *storm(d) {
    const me = d.cast([{ name: 'You', x: 250 }, { name: 'Oni', x: 40 }, { name: 'Kiko', x: 400, y: 150, face: -1 }], { it: 1 });
    d.give('storm');
    d.ai[1] = chase(0, false);
    d.ai[2] = pace(275, 415);
    d.say('The oni closes in...');
    yield* until(0, () => cx(me) - cx(d.p(1).s) < 120, 200);
    d.say('Storm! Everyone else is in slow motion');
    yield U;
    yield* runTo(me, 500);
    yield* until(0, () => cx(me) - cx(d.p(1).s) < 105, 200);
    yield L | J;
    yield* until(L | J, () => me.vy > 0, 60);
    yield* until(L, () => me.ground, 90);
    yield* runTo(me, 90);
    d.ai[1] = null;
    yield* hold(0, 20);
  },
  *goo(d) {
    const me = d.cast([{ name: 'You', x: 170 }, { name: 'Oni', x: 50 }], { it: 1 });
    d.give('goo');
    d.ai[1] = chase(0, false);
    d.say('The oni is on your heels...');
    yield* runTo(me, 290);
    d.say('Goo! Whoever steps in it slips');
    yield R | U;
    yield* runTo(me, 505);
    yield* until(0, () => d.p(1).s.stun > 0, 120);
    d.ai[1] = null;
    yield* hold(0, 70);
  },
};
const ITEM_ORDER = ['box', ...ITEM_KINDS];

const SCENES = {
  // run, jump, drop through, second jump
  move: {
    arena: world('move', { platforms: [floor(), ledge(150, 270, 180), ledge(372, 110, 170)] }),
    keys: 'lrjd',
    *play(d) {
      const me = d.cast([{ name: 'You', x: 50 }]);
      d.say('Run left and right');
      yield* hold(0, 20);
      yield* runTo(me, 125);
      yield* runTo(me, 60);
      yield* runTo(me, 110);
      d.say('Jump - hold it longer to go higher');
      yield R | J;
      yield* airTo(me, 240, J);
      yield* hold(0, 34);
      d.say('Hold down to drop through a thin ledge');
      yield* until(D, () => me.ground && feet(me) > FLOOR - 2, 120);
      yield* hold(0, 24);
      yield* runTo(me, 318);
      d.say('Jump again in the air for a second jump');
      yield R | J;
      yield* until(() => steer(me, 455) | J, () => me.vy > 150, 90);
      yield steer(me, 455);
      yield steer(me, 455) | J;
      yield* airTo(me, 455, J);
      yield* hold(0, 40);
      d.say('In the air, down makes you fall faster');
      yield* runTo(me, 346);
      yield* until(D, () => me.ground, 120);
      yield* runTo(me, 50);
      yield* hold(0, 16);
    },
  },

  // slopes: up, down, through from below, drop through
  slope: {
    arena: world('slope', { platforms: [floor(), ledge(390, 250, 170)], ramps: [{ x0: 150, y0: FLOOR, x1: 390, y1: 250 }] }),
    keys: 'lrjd',
    *play(d) {
      const me = d.cast([{ name: 'You', x: 50 }]);
      d.say('Slopes: just walk up...');
      yield* hold(0, 20);
      yield* runTo(me, 480);
      yield* hold(0, 14);
      d.say('...and back down');
      yield* runTo(me, 70);
      yield* hold(0, 14);
      d.say('Hold down to pass underneath');
      yield* runTo(me, 300, D);
      yield* hold(0, 20);
      d.say('Jump up through a slope from below');
      yield J;
      yield* until(J, () => me.ground, 150);
      yield* hold(0, 34);
      d.say('Down drops you through it again');
      yield* until(D, () => me.ground && feet(me) > FLOOR - 2, 120);
      yield* hold(0, 20);
      yield* runTo(me, 50);
      yield* hold(0, 16);
    },
  },

  // launcher, then trampoline
  bounce: {
    arena: world('bounce', {
      platforms: [floor(), ledge(392, 220, 168), ledge(110, 150, 150)],
      tramps: [pad(72, FLOOR, 560, 1040), pad(292, FLOOR, 0, 1230)],
    }),
    keys: 'lr',
    *play(d) {
      const me = d.cast([{ name: 'You', x: 28 }]);
      d.say('Launchers fling you up and across');
      yield* hold(0, 24);
      yield* until(R, () => !me.ground, 60);
      yield* airTo(me, 478, 0);
      yield* hold(0, 30);
      d.say('Trampolines bounce you high');
      yield* runTo(me, 372);
      yield* until(() => steer(me, 326), () => me.vy < -600, 150);
      d.say('Steer in the air to pick your landing');
      yield* until(() => (feet(me) < 150 ? steer(me, 190) : 0), () => me.ground, 240);
      yield* hold(0, 34);
      yield* runTo(me, 88);
      yield* until(0, () => me.ground, 120);
      yield* runTo(me, 28);
      yield* hold(0, 12);
    },
  },

  // an updraft
  lift: {
    arena: world('lift', { platforms: [floor(), ledge(330, 130, 190)], lifts: [{ x: 236, y: 30, w: 84, h: FLOOR - 30 }] }),
    keys: 'lr',
    *play(d) {
      const me = d.cast([{ name: 'You', x: 60 }]);
      d.say('Step into an updraft...');
      yield* hold(0, 24);
      yield* runTo(me, 262);
      d.say('...let go, and it carries you up');
      yield* until(0, () => feet(me) < 112, 200);
      d.say('Steer out wherever you like');
      yield* airTo(me, 430, 0);
      yield* hold(0, 36);
      yield* runTo(me, 536);
      yield* until(0, () => me.ground, 120);
      d.say('Run through one and it gives you a lift');
      yield* runTo(me, 150);
      yield* until(0, () => me.ground, 150);
      yield* runTo(me, 60);
      yield* hold(0, 16);
    },
  },

  // portals: the whole flight, then letting go half way
  portal: {
    arena: world('portal', { platforms: [floor(), ledge(400, 170, 160), ledge(200, 262, 130)], portals: [gate(64, FLOOR, 1, true), gate(500, 170, 0, true)] }),
    keys: 'lrj',
    *play(d) {
      const me = d.cast([{ name: 'You', x: 230 }]);
      d.say('Step into a portal...');
      yield* hold(0, 24);
      yield* until(L, () => me.orb > 0, 120);
      d.say('...and fly to its partner. Nobody can tag you on the way');
      yield* until(0, () => me.orb === 0, 120);
      yield* hold(0, 40);
      yield* runTo(me, 420);
      yield* hold(0, 16);
      d.say('Marked portals let you go early: press jump mid-flight');
      yield* until(R, () => me.orb > 0, 120);
      yield* until(0, () => me.orb <= me.ot * 0.5, 80);
      yield J;
      yield* airTo(me, 262, 0);
      yield* hold(0, 40);
      yield* until(D, () => me.ground && feet(me) > FLOOR - 2, 120);
      yield* runTo(me, 230);
      yield* hold(0, 16);
    },
  },

  // thorns
  thorns: {
    arena: world('thorns', { platforms: [floor()], spikes: [thorns(254, FLOOR, 76)] }),
    keys: 'lrj',
    *play(d) {
      const me = d.cast([{ name: 'You', x: 60 }]);
      d.say('Thorns sting...');
      yield* hold(0, 20);
      yield* until(R, () => me.stun > 0, 120);
      d.say('...a short stun, and you are thrown back');
      yield* until(0, () => me.stun === 0 && me.ground, 150);
      yield* hold(0, 30);
      d.say('So jump over them');
      yield* runTo(me, 205);
      yield R | J;
      yield* until(R | J, () => me.vy > 0, 60);
      yield* until(R, () => me.ground, 90);
      yield* runTo(me, 480);
      yield* hold(0, 14);
      yield* runTo(me, 384);
      yield L | J;
      yield* until(L | J, () => me.vy > 0, 60);
      yield* until(L, () => me.ground, 90);
      yield* runTo(me, 60);
      yield* hold(0, 14);
    },
  },

  // a lucky box, then each of the eight items
  items: {
    arena: world('items', { platforms: [floor(), ledge(250, 150, 190)], pickups: [{ x: 300, y: FLOOR - 22 }] }),
    keys: 'lrju',
    pips: ITEM_ORDER,
    *play(d) {
      for (let i = d.from; i < ITEM_ORDER.length; i++) {
        d.at = i;
        yield* ITEM_ACTS[ITEM_ORDER[i]](d);
      }
    },
  },

  // hot potato: three bots and a short clock
  tag: {
    arena: world('tag', { platforms: [floor(), ledge(40, 276, 150), ledge(370, 276, 150), ledge(190, 172, 180)], tramps: [pad(246, FLOOR, 0, 1100)] }),
    *play(d) {
      d.cast([{ name: 'Kiko', x: 90 }, { name: 'Taro', x: 280 }, { name: 'Nori', x: 470, face: -1 }], { it: 1, bots: true, you: false });
      const who = () => d.names[d.sim.it];
      d.say(`${who()} is the oni: touch someone to pass it on`);
      d.on = (e) => e.type === 'tag' && d.say(`${d.names[e.from]} tagged ${d.names[e.to]}!`);
      for (let t = 18 * 60; t > 0; t--) {
        d.clock = Math.ceil(t / 60);
        yield 0;
      }
      d.clock = 0;
      d.paused = true;
      d.say(`Time! ${who()} is still the oni - and loses`);
      yield* hold(0, 170);
    },
  },

  // team bomb: pass the bomb, watch it blow, then steal the flag
  team: {
    arena: world('team', { platforms: [floor(), ledge(170, 270, 150), ledge(400, 160, 150)], bases: [[52, FLOOR], [508, FLOOR]] }),
    keys: 'lrj',
    *play(d) {
      const me = d.cast(
        [{ name: 'You', x: 130, team: 0 }, { name: 'Taro', x: 360, team: 1, face: -1 }, { name: 'Nori', x: 60, team: 0 }, { name: 'Mox', x: 470, y: 160, team: 1, face: -1 }],
        { it: 0, teams: true },
      );
      const sim = d.sim;
      const taro = d.p(1).s;
      sim.rnd = () => 0.99; // the next bomb goes to Nori, so your hands stay free for the flag
      sim.fuse = 250;
      d.say('You carry the bomb. Stick it on an enemy!');
      d.ai[1] = pace(300, 420);
      yield* hold(0, 50);
      yield* until(() => steer(me, cx(taro), 2), () => sim.it !== 0, 240);
      d.ai[1] = chase(0, false);
      d.say('Now it is theirs - and the fuse is still burning');
      yield* runTo(me, 262);
      yield L | J;
      yield* airTo(me, 232, J);
      yield* until(0, () => sim.it < 0, 260);
      d.ai[1] = null;
      d.say(`BOOM! It blew up on ${TEAM_NAMES[1]}: ${BOMB_POINTS} points for ${TEAM_NAMES[0]}`);
      yield* hold(0, 100);
      d.say('Hands free? Steal their flag...');
      yield* runTo(me, 350);
      yield* until(R, () => sim.flags[1].carrier === 0, 240);
      yield* hold(0, 10);
      d.say('...and carry it home. An enemy who touches you sends it back');
      yield* until(L, () => cx(me) - cx(taro) < 112 || sim.flags[1].carrier !== 0, 240);
      yield L | J;
      yield* until(L | J, () => me.vy > 0, 60);
      yield* until(L, () => me.ground, 120);
      yield* until(L, () => sim.flags[1].carrier !== 0, 200);
      d.say(sim.score[0] > BOMB_POINTS ? `Captured! ${FLAG_POINTS} points for ${TEAM_NAMES[0]}` : 'Saved by the defender - the flag goes home');
      yield* hold(0, 150);
    },
  },
};

// --- a scene being played (no pictures here: this part also runs in tests) -------------
class Run {
  constructor(scene, from = 0) {
    this.scene = scene;
    this.reset(from);
  }

  reset(from = 0) {
    this.from = from; // items: which one to start at
    this.at = from;
    this.sim = null;
    this.names = [];
    this.cols = null;
    this.ai = {};
    this.bots = null;
    this.on = null;
    this.caption = '';
    this.item = ''; // the item shown in the corner
    this.itemNote = '';
    this.clock = null;
    this.paused = false;
    this.done = false;
    this.cuts = 0; // counts every change of cast (the picture fades over it)
    this.fx = []; // game events since the last frame, for the renderer
    this.bits = 0;
    this.prev = [];
    this.gen = this.scene.play(this);
    this.pull();
  }

  // Put players on stage: [{ name, x (centre), y (feet, the floor if left out), face, team }]
  cast(list, o = {}) {
    const arena = this.scene.arena;
    const sim = new Sim(arena);
    sim.powerups = false;
    arena.spawns = list.map((c) => [c.x - PW / 2, (c.y ?? FLOOR) - PH]);
    arena.respawns = arena.spawns;
    this.names = list.map((c) => c.name);
    list.forEach((c, slot) => {
      const p = sim.add(slot, slot);
      p.s.face = c.face || 1;
      p.s.ground = true;
    });
    this.cols = null;
    if (o.teams) {
      const teams = new Array(MAX_PLAYERS).fill(-1);
      const seen = [0, 0];
      this.cols = [];
      list.forEach((c, slot) => {
        teams[slot] = c.team;
        this.cols[slot] = TEAM_SLOTS[c.team][seen[c.team]++ % 3];
      });
      sim.setTeams(teams);
    }
    if (o.it >= 0) {
      sim.start(o.it);
      sim.nextBox = Infinity; // boxes only appear when a scene puts one out
    }
    this.sim = sim;
    this.ai = {};
    this.bots = o.bots ? list.map((_, slot) => makeBot(slot * 31 + 7)) : null;
    this.you = o.you !== false;
    this.on = null;
    this.paused = false;
    this.clock = null;
    this.prev = [];
    this.cuts++;
    return sim.players[0].s;
  }

  p(slot) {
    return this.sim.players[slot];
  }
  say(text) {
    this.caption = text;
  }
  // the item shown in the corner of the picture
  show(kind, note = '') {
    this.item = kind;
    this.itemNote = note;
  }
  // put an item straight into your hands, ready to use
  give(kind) {
    const p = this.sim.players[0];
    p.item = kindId(kind);
    p.arm = 0;
    this.show(kind);
  }

  pull() {
    const r = this.gen.next();
    if (r.done) this.done = true;
    else this.bits = r.value | 0;
  }

  // one tick
  step() {
    if (this.done) return;
    const sim = this.sim;
    if (!this.paused) {
      const inputs = new Array(MAX_PLAYERS).fill(0);
      for (const p of sim.players) {
        if (!p) continue;
        this.prev[p.slot] = { x: p.s.x, y: p.s.y, dead: p.s.dead };
        if (this.bots) inputs[p.slot] = this.think(p.slot);
        else if (p.slot === 0) inputs[0] = this.bits;
        else if (this.ai[p.slot]) inputs[p.slot] = this.ai[p.slot](this, p.slot);
      }
      sim.step(inputs);
      for (const e of sim.events) {
        this.fx.push(e);
        this.on?.(e);
      }
      sim.events.length = 0;
    }
    this.pull();
  }

  // a computer player's buttons; if the bots cannot cope with this arena, fall back to something simple
  think(slot) {
    if (this.bots !== 'simple') {
      try {
        return botThink(this.sim, slot, this.bots[slot]);
      } catch (err) {
        console.warn('demo: bots gave up, using simple ones', err);
        this.bots = 'simple';
      }
    }
    const it = this.sim.it;
    if (slot === it) {
      // chase whoever is nearest
      let best = -1;
      let bestD = Infinity;
      for (const o of this.sim.players) {
        if (!o || o.slot === slot) continue;
        const dist = Math.abs(o.s.x - this.sim.players[slot].s.x);
        if (dist < bestD) {
          bestD = dist;
          best = o.slot;
        }
      }
      return best < 0 ? 0 : chase(best)(this, slot);
    }
    return it >= 0 ? flee(it)(this, slot) : 0;
  }

  // What to draw: the same shape a real match hands to the renderer.
  view(a = 1) {
    const sim = this.sim;
    const players = [];
    for (const p of sim.players) {
      if (!p) continue;
      const s = p.s;
      const pr = this.prev[p.slot];
      const smooth = pr && !this.paused && pr.dead === 0 && s.dead === 0 && Math.abs(pr.y - s.y) + Math.abs(pr.x - s.x) < 90;
      players.push({
        slot: p.slot,
        name: this.names[p.slot],
        col: this.cols ? this.cols[p.slot] : p.slot,
        team: p.team,
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
        canDrop: s.orb > 0 && !!sim.arena.portals[s.pi]?.drop,
        spd: s.spd,
        jmp: s.jmp,
        shd: s.shd,
        slw: s.slw,
        dead: s.dead,
        itTicks: p.itTicks,
        item: p.item,
        arm: p.arm,
        local: this.you && p.slot === 0,
      });
    }
    return {
      phase: 'playing',
      mode: sim.teams ? 'team' : 'potato',
      cup: null,
      twist: sim.twist,
      mySlot: 0,
      countdownMs: null,
      goAge: 99,
      timeLeft: 60,
      duration: 60,
      it: sim.it,
      players,
      boxes: sim.boxes,
      goo: sim.goo.map((g) => [g.x, g.y]),
      team: sim.teams ? { score: sim.score, fuse: sim.fuse, flags: sim.flags } : null,
      me: null,
      code: null,
      ping: null,
      spectating: false,
    };
  }
}

// --- one demo on the page ---------------------------------------------------------------
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}" /></svg>`;
const KEY_ICONS = { l: ['left', L], r: ['right', R], j: ['up', J], d: ['down', D], u: ['use', U] };

class Demo {
  constructor(box, scene) {
    this.box = box;
    this.scene = scene;
    this.run = new Run(scene);
    this.r = null;
    this.acc = 0;
    this.visible = false;
    this.broken = false;
    this.sig = {};
    this.cuts = this.run.cuts;
    this.wait = 0;

    box.classList.add('demo');
    box.textContent = '';
    this.stage = el('div', 'demo-stage');
    this.hud = el('div', 'demo-hud');
    this.cap = el('p', 'demo-cap');
    box.append(this.stage, this.hud, this.cap);
    if (scene.keys) {
      this.keys = el('div', 'demo-keys');
      this.keyEls = [...scene.keys].map((k) => {
        const key = el('i', k === 'u' ? 'use' : '');
        if (k === 'u') key.textContent = 'E';
        else key.innerHTML = icon(KEY_ICONS[k][0]);
        key.dataset.bit = KEY_ICONS[k][1];
        this.keys.append(key);
        return key;
      });
      box.append(this.keys);
    }
    if (scene.pips) {
      // items: one mark for each, lit while it is being shown; click one to see it now
      this.pips = el('div', 'demo-pips');
      scene.pips.forEach((kind, i) => {
        const b = el('button', '');
        b.type = 'button';
        b.tabIndex = -1;
        b.innerHTML = icon(kind);
        b.setAttribute('aria-label', kind === 'box' ? 'Lucky box' : ITEM_INFO[kind].name);
        b.addEventListener('click', () => this.restart(i));
        this.pips.append(b);
      });
      this.chip = el('div', 'demo-item');
      this.chip.innerHTML = '<span class="pic"></span><span class="what"><b></b><small></small></span>';
      box.append(this.pips, this.chip);
    }
    this.sized = '';
    this.ro = new ResizeObserver(() => (this.resized = true));
    this.ro.observe(box);
  }

  // the renderer is only made when the demo first comes on screen
  ensure() {
    if (this.r || this.broken) return;
    const r = new Renderer(this.stage, { whole: true });
    r.govern = () => {}; // 30 frames a second is on purpose here: never drop detail because of it
    r.setScene(this.scene.arena, 'ink');
    this.r = r;
    this.resized = false;
  }

  restart(from = 0) {
    this.run.reset(from);
    this.acc = 0;
    this.wait = 0;
    this.fade();
  }

  fade() {
    this.cuts = this.run.cuts;
    this.stage.classList.remove('cut');
    void this.stage.offsetWidth;
    this.stage.classList.add('cut');
  }

  frame(dt, now) {
    if (this.broken) return;
    try {
      this.ensure();
      if (this.resized) {
        this.resized = false;
        if (this.stage.clientWidth > 0) this.r.resize();
      }
      const run = this.run;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 4) {
        this.acc -= TICK_MS;
        steps++;
        if (run.done) {
          // the scene is over: a breath, then from the top
          if (++this.wait > 20) this.restart(0);
          break;
        }
        run.step();
        if (run.cuts !== this.cuts) {
          this.fade();
          break; // do not blend the old cast into the new one
        }
      }
      if (this.acc >= TICK_MS) this.acc = 0;
      const R0 = this.r;
      for (const e of run.fx) {
        if (e.type === 'tag') R0.tagFx(e.from, e.to);
        else if (e.type === 'block') R0.blockFx(e.from, e.to);
        else if (e.type === 'pick') R0.pickFx(e.slot, e.kind);
        else if (e.type === 'use') R0.itemFx(e, ITEM_KINDS[e.kind]);
        else if (e.type === 'slip') R0.slipFx(e);
        else if (e.type === 'boom') R0.boomFx(e);
      }
      run.fx.length = 0;
      R0.draw(run.view(Math.min(1, this.acc / TICK_MS)), now);
      this.paint();
    } catch (err) {
      this.broken = true;
      console.warn('demo: could not play', this.scene.arena.id, err);
      this.box.classList.add('broken');
      this.cap.textContent = 'This demo could not be played here.';
    }
  }

  // captions, keys and counters: only touched when they change
  paint() {
    const run = this.run;
    const s = this.sig;
    if (run.caption !== s.cap) this.cap.textContent = s.cap = run.caption;
    if (this.keyEls && run.bits !== s.bits) {
      s.bits = run.bits;
      for (const k of this.keyEls) k.classList.toggle('on', (run.bits & Number(k.dataset.bit)) !== 0);
    }
    if (this.pips) {
      const sig = `${run.at}/${run.item}/${run.itemNote}`;
      if (sig !== s.item) {
        s.item = sig;
        [...this.pips.children].forEach((b, i) => b.classList.toggle('on', i === run.at));
        const kind = run.item;
        this.chip.hidden = !kind;
        if (kind) {
          this.chip.dataset.kind = kind;
          this.chip.querySelector('.pic').innerHTML = icon(kind);
          this.chip.querySelector('b').textContent = kind === 'box' ? 'Lucky box' : ITEM_INFO[kind].name;
          this.chip.querySelector('small').textContent = run.itemNote || (kind === 'box' ? 'A random item inside' : ITEM_INFO[kind].blurb);
        }
      }
    }
    const sim = run.sim;
    if (sim.teams) {
      const sig = `${sim.score[0]}-${sim.score[1]}`;
      if (!this.team) {
        this.team = el('div', 'demo-score');
        this.team.innerHTML = '<b></b><span class="fuse"><i></i></span><b></b>';
        [0, 1].forEach((t) => (this.team.querySelectorAll('b')[t].style.background = TEAM_COLORS[t]));
        this.hud.append(this.team);
      }
      if (sig !== s.team) {
        s.team = sig;
        const [a, b] = this.team.querySelectorAll('b');
        a.textContent = `${TEAM_NAMES[0]} ${sim.score[0]}`;
        b.textContent = `${sim.score[1]} ${TEAM_NAMES[1]}`;
      }
      const f = sim.it >= 0 ? Math.round(Math.max(0, Math.min(1, sim.fuse / BOMB_FUSE_TICKS)) * 50) : 0;
      if (f !== s.fuse) {
        s.fuse = f;
        const bar = this.team.querySelector('.fuse i');
        bar.style.transform = `scaleX(${f / 50})`;
        bar.classList.toggle('hot', sim.fuse < 240);
      }
    }
    if (run.clock !== s.clock) {
      s.clock = run.clock;
      if (!this.clock) {
        this.clock = el('div', 'demo-clock');
        this.hud.append(this.clock);
      }
      this.clock.hidden = run.clock == null;
      this.clock.textContent = run.clock ?? '';
      this.clock.classList.toggle('low', run.clock != null && run.clock <= 5);
    }
  }
}

// --- all of them --------------------------------------------------------------------------
const all = [];
let io = null;
let running = false;
let raf = 0;
let last = 0;

function loop(now) {
  raf = 0;
  if (!running) return;
  const live = all.filter((d) => d.visible && !d.broken);
  if (!live.length) return; // nothing on screen: sleep until something scrolls into view
  raf = requestAnimationFrame(loop);
  const dt = now - last;
  if (dt < 30) return; // about thirty frames a second is plenty
  last = now;
  for (const d of live) d.frame(Math.min(dt, 100), now);
}
function wake() {
  if (running && !raf) {
    last = performance.now() - 33;
    raf = requestAnimationFrame(loop);
  }
}

export const demos = {
  mount(root) {
    io ||= new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const d = all.find((x) => x.box === e.target);
          if (d) d.visible = e.isIntersecting;
        }
        wake();
      },
      { rootMargin: '60px' },
    );
    for (const box of root.querySelectorAll('[data-demo]')) {
      const scene = SCENES[box.dataset.demo];
      if (!scene || all.some((d) => d.box === box)) continue;
      const d = new Demo(box, scene);
      all.push(d);
      io.observe(box);
    }
  },
  start() {
    running = true;
    wake();
  },
  stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  },
  // fonts arrived after the first paint: names were drawn with a stand-in
  refresh() {
    for (const d of all) if (d.r) d.r.layout(true);
  },
  get running() {
    return running && !!raf;
  },
};

// For the automated checks: play a scene without drawing it and report what happened.
export function traceScene(id, maxTicks = 6000, every = 0) {
  const run = new Run(SCENES[id]);
  const log = [];
  let cap = '';
  let n = 0;
  const pos = () => run.sim.players.filter(Boolean).map((p) => `${run.names[p.slot]}(${Math.round(cx(p.s))},${Math.round(feet(p.s))}${p.s.ground ? 'g' : ''}${p.s.stun ? ' stun' : ''}${p.s.frz ? ' frz' : ''}${p.s.orb ? ' orb' : ''})`).join(' ');
  while (!run.done && n < maxTicks) {
    if (run.caption !== cap) {
      cap = run.caption;
      log.push(`${n}: [${ITEM_ORDER[run.at] && id === 'items' ? ITEM_ORDER[run.at] : ''}] "${cap}" ${pos()}`);
    }
    run.step();
    for (const e of run.fx) log.push(`${n}:   event ${e.type}${e.what ? ` ${e.what}` : ''} ${JSON.stringify(e)} ${pos()}`);
    run.fx.length = 0;
    n++;
    if (every && n % every === 0) log.push(`${n}: ${pos()} bits=${run.bits}`);
  }
  log.push(`${n}: ${run.done ? 'done' : 'STILL RUNNING'} ${pos()} score=${run.sim.score}`);
  return log;
}
export const SCENE_IDS = Object.keys(SCENES);
