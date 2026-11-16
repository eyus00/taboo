// Shared constants. Imported by the Node server AND by the browser, so the
// physics on both sides is the same code with the same numbers.

// Backdrop paintings are composed on an 800x500 board and scaled to cover the screen.
export const ART_W = 800;
export const ART_H = 500;

// Player hitbox
export const PW = 32;
export const PH = 40;
// Players are DRAWN this much bigger than their hitbox, standing on the same
// feet (so the arenas, the route maps and the bots keep the body they were
// built around). TOUCH below makes up the difference for tags.
export const BODY_SCALE = 1.25;

// Simulation runs at a fixed 60 steps per second everywhere.
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAP_EVERY = 2; // server broadcasts every 2nd tick (30 Hz)

// --- Movement feel -----------------------------------------------------------
// Running has a little weight: you pick up speed over about a tenth of a
// second, and reversing direction costs a brief skid before you go the other way.
export const MOVE_SPEED = 330; // px/s top speed
export const IT_SPEED_MUL = 1.1; // the chaser is faster, so chases end
export const GROUND_ACCEL = 2900; // px/s^2 while speeding up
export const GROUND_TURN = 4600; // braking when you push against your own motion
export const GROUND_STOP = 3200; // braking when you let go
export const AIR_ACCEL = 1800;
export const AIR_TURN = 2450;
export const AIR_KEEP = 0.985; // per tick: momentum mostly carries when you let go mid-air

// Jumps are floaty: gentle gravity plus air resistance, so you rise in a smooth
// curve, hang for a moment and drift down instead of dropping like a stone.
export const GRAVITY = 1300; // px/s^2
export const AIR_DRAG = 1.5; // 1/s: slows vertical motion the faster it gets (fall tops out near 870 px/s)
export const JUMP_V = 960; // full jump: ~210 px high, ~1.15 s in the air
export const AIR_JUMP_V = 800; // the second jump in mid-air: ~155 px more
export const AIR_JUMPS = 1;
export const JUMP_CUT_V = 360; // letting go of jump early caps the rise (short hops)
export const FAST_FALL_G = 1900; // extra gravity while holding down in the air
export const COYOTE_TICKS = 7; // grace period to jump after leaving a ledge
export const JUMP_BUFFER_TICKS = 8; // a jump pressed just before landing still counts
export const DROP_TICKS = 10; // how long "down" lets you fall through a thin ledge
export const TRAMP_V = 1800; // trampoline launch: ~530 px
export const LIFT_V = 560; // updraft: the speed it carries you up at
export const LIFT_RATE = 0.14; // how quickly you settle to that speed (per tick)
export const LIFT_GRIP = 0.86; // per tick: sideways drift dies quickly inside the column, so letting go rides it
// (unhurried enough for the camera - and your eyes - to follow the flight)
export const ORB_SPEED = 15; // px per tick while flying between portals
export const ORB_MIN_TICKS = 30;
export const ORB_MAX_TICKS = 140;
export const ORB_ARC = 0.36; // the flight arcs up over the map: height as a share of the distance...
export const ORB_ARC_MIN = 170; // ...and at least this high
export const ORB_DROP_FROM = 0.15; // some portals let you press jump to drop out early,
export const ORB_DROP_TO = 0.85; // anywhere in this stretch of the flight
export const LAUNCH_VX = 780; // launchers fling you sideways as well as up
export const LAUNCH_VY = 1250;
export const SPIKE_STUN_TICKS = 22; // thorns: a short stun and a bounce off them
export const SPIKE_BOUNCE = 520;
export const SPIKE_COOLDOWN = 80; // ticks before thorns can hurt you again
export const EPS = 0.5; // collision tolerance in px

// --- Tag rules ----------------------------------------------------------------
// (bodies are drawn BODY_SCALE times their hitbox: 4 px wider on each side and 10 px taller.
// So two players LOOK as if they touch with their hitboxes 8 px apart side by side, or
// 10 px apart one above the other - and a touch you can see has to count.)
export const TOUCH = 12; // "it" tags anyone whose hitbox is within this many px
export const IMMUNE_TICKS = 42; // 0.7 s no-tag-back protection for the old "it"
export const STUN_TICKS = 18; // 0.3 s freeze for the newly tagged player
export const BLOCK_STUN_TICKS = 36; // "it" is knocked back when a shield blocks the tag
export const RESPAWN_TICKS = 24;
export const COUNTDOWN_MS = 3000;
export const INTRO_MS = 4200; // before the countdown: the draw for arena, style and who is it

// --- Lucky boxes and the items inside them --------------------------------------
// Boxes appear around the arena. Touch one (with empty hands) and you get a
// random item to keep; press USE to set it off whenever you like - right up to
// the buzzer.
export const ITEM_KINDS = ['speed', 'jump', 'shield', 'freeze', 'blast', 'swap', 'storm', 'quake', 'warp', 'eclipse', 'dash'];
export const ITEM_INFO = {
  speed: { name: 'Swift', blurb: 'Run much faster for 6 s' },
  jump: { name: 'Spring', blurb: 'Jump much higher for 7 s' },
  shield: { name: 'Ward', blurb: 'Blocks the next tag' },
  freeze: { name: 'Frost', blurb: 'Freezes the other side solid' },
  blast: { name: 'Blast', blurb: 'A shockwave hurls everyone nearby away and stuns them' },
  swap: { name: 'Swap', blurb: 'Trade places with another player' },
  storm: { name: 'Storm', blurb: 'Everyone else moves in slow motion' },
  quake: { name: 'Quake', blurb: 'Throws everyone else into the air, wherever they are, and stuns them' },
  warp: { name: 'Warp', blurb: 'The oni lands beside the nearest runner; a runner lands far from the oni' },
  eclipse: { name: 'Eclipse', blurb: 'Everyone else is left in the dark for 4 s' },
  dash: { name: 'Dash', blurb: 'Shoot straight ahead in a flash' },
};
export const PICKUP_TYPES = ITEM_KINDS; // older name, still used by the art styles
export const PICKUP_INFO = ITEM_INFO;
export const PICKUP_R = 26; // pick-up radius around a box
export const BOX_FIRST_TICKS = 90; // first box 1.5 s after GO
export const BOX_EVERY_TICKS = 180; // then one every 3 s
export const BOX_MAX = 5; // at most this many lying around (one more for every two players beyond four)
export const ITEM_ARM_TICKS = 30; // the draw takes half a second before the item can be used
export const SPEED_BUFF_MUL = 1.4;
export const JUMP_BUFF_MUL = 1.25;
export const SPEED_BUFF_TICKS = 360;
export const JUMP_BUFF_TICKS = 420;
export const SHIELD_TICKS = 480;
export const FREEZE_IT_TICKS = 110; // a runner freezes "it" for 1.8 s
export const FREEZE_RUNNERS_TICKS = 75; // "it" freezes the runners for 1.25 s
export const BLAST_RADIUS = 400; // a third of the screen or so: you have to be near them
export const BLAST_STUN_TICKS = 50;
export const BLAST_KICK = 900;
export const STORM_TICKS = 210; // 3.5 s of slow motion for everyone else
export const STORM_SPEED = 0.55;
export const QUAKE_STUN_TICKS = 80; // everyone else, wherever they are: 1.3 s out of the game...
export const QUAKE_POP = 500; // ...thrown straight up at this speed (about 90 px), no push sideways
export const WARP_GAP = 26; // the oni lands with this much air between it and the runner (more than TOUCH: the runner gets a blink)
export const WARP_DROP = 30; // "beside" means level with them, give or take this much
export const ECLIPSE_TICKS = 240; // 4 s of night for everyone else
export const ECLIPSE_SIGHT = 150; // what they still see: a circle of this radius (world units) around themselves
export const DASH_TICKS = 12; // a fifth of a second...
export const DASH_SPEED = 1200; // ...at this speed, dead straight the way you face: 240 px, six tiles (a run covers 66 px in that time)

// --- Team battle: bombs and flags -------------------------------------------------
// Two teams.
// Bombs: one for every two players, dealt out at GO starting with a random
// player of each team. A carrier gets rid of theirs by touching an ENEMY whose
// hands are free (nobody carries two). The bombs burn for the whole round and
// go off at the buzzer: every bomb scores for the team that is NOT holding it.
// Flags: a flag is a spot on the map. Stand in its ring and it fills with your
// colour; full, it is yours, and it pays your team a point every few seconds
// until the other side stands there long enough to turn it.
export const BOMB_POINTS = 10; // to the other team, for each bomb that goes off (as much as a flag pays in 50 s)
export const BOMB_STUN_TICKS = 80;
export const BOMB_END_TICKS = 84; // the moment after the buzzer in which the bombs go off, before the result
export const FLAG_HALF = 96; // half the width of a flag's ring
export const FLAG_UP = 120; // and how far above the ground it reaches (a hop on the spot still counts)
export const FLAG_CAP_TICKS = 150; // standing there alone: 2.5 s to take a free flag (twice that to turn an enemy one)
export const FLAG_CROWD = 2; // more of you fill it faster, up to this many times as fast
export const FLAG_PAY_TICKS = 300; // a flag in your colour pays every 5 s...
export const FLAG_POINTS = 1; // ...this much
export const TEAM_NAMES = ['Sun', 'Moon'];
export const TEAM_COLORS = ['#e2543f', '#3f7fe2'];
// colour slots handed out by team, so one side is warm and the other cool
export const TEAM_SLOTS = [[0, 3, 5, 6, 8], [1, 2, 4, 7, 9]]; // red, yellow, pink, orange, brown | blue, green, purple, teal, silver

// --- Rooms and games --------------------------------------------------------------
export const MAX_PLAYERS = 10;
export const MIN_PLAYERS = 2;
export const NAME_MAX = 12;
export const CODE_LEN = 4; // room codes are 4 digits
export const DURATIONS = [45, 60, 90];
export const DEFAULT_DURATION = 60;
export const MODES = [
  { id: 'potato', name: 'Hot Potato', blurb: 'Whoever is it when time runs out loses.' },
  { id: 'time', name: 'Least Time', blurb: 'Least total time as it wins.' },
  { id: 'team', name: 'Team Bomb', blurb: 'Two teams. Hold the flags; do not be holding a bomb when the clock stops.' },
];
export const MODE_IDS = MODES.map((m) => m.id);

// Tournament: several rounds, points every round, most points takes the cup.
//  * Each round, players are ranked by time spent as it (least is best) and
//    score N-1, N-2 ... 0 points for N players (so 5 down to 0 with six). Equal times share the better place.
//  * Everyone who is NOT it when the buzzer sounds gets 1 more point.
//  * From round 2 on, the current leader starts the round as it.
//  * Every second round has a twist (see TWISTS). The last round counts double.
//  * Ties in the final table are broken by total time as it (less is better).
export const CUP_ROUNDS = [3, 5, 7];
export const DEFAULT_CUP_ROUNDS = 5;
export const CUP_BREAK_MS = 9000; // scoreboard shown between rounds
export const SAFE_BONUS = 1;

// A twist that can apply to a round.
export const TWISTS = [
  { id: 'none', name: '', blurb: '', grav: 1, speed: 1, items: 1 },
  { id: 'moon', name: 'Moon Gravity', blurb: 'Everything floats', grav: 0.6, speed: 1, items: 1 },
  { id: 'turbo', name: 'Turbo', blurb: 'Everyone runs faster', grav: 1, speed: 1.22, items: 1 },
  { id: 'frenzy', name: 'Item Frenzy', blurb: 'Power-ups everywhere', grav: 1, speed: 1, items: 3 },
];
export const twistById = (id) => TWISTS.find((t) => t.id === id) || TWISTS[0];

// Input bit flags
export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;
export const IN_DOWN = 8;
export const IN_USE = 16; // set off the item you are holding
export const IN_MASK = 31;

// Join-order colours: red, blue, green, yellow, purple, pink, orange, teal, brown, silver
export const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#ff79b0', '#ff8c1a', '#1abc9c', '#a0693c', '#dfe6ee'];
export const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink', 'Orange', 'Teal', 'Brown', 'Silver'];

// Art styles (drawing code lives in public/js/themes). Ink is the house style.
export const THEMES = [
  { id: 'ink', name: 'Ink & Sakura', blurb: 'Brush strokes on rice paper' },
  { id: 'space', name: 'Orbit', blurb: 'Astronauts on a space station' },
  { id: 'alien', name: 'Xeno', blurb: 'A glowing alien world' },
  { id: 'neon', name: 'Neon District', blurb: 'Cyberpunk rain and chrome' },
  { id: 'nightmare', name: 'Nightmare', blurb: 'Something is watching' },
  { id: 'sketch', name: 'Sketchbook', blurb: 'Doodles come alive' },
  { id: 'arcade', name: 'Arcade', blurb: '8-bit sunset' },
];
export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = 'ink';
