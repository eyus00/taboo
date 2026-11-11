// Shared constants. Imported by the Node server AND by the browser, so the
// physics on both sides is the same code with the same numbers.

// What a player sees: 540 world units tall at zoom 1, as wide as the screen allows.
export const VIEW_H = 540;
export const ZOOM_MIN = 0.58; // furthest the camera pulls back
export const ZOOM_MAX = 1;

// Backdrop paintings are composed on an 800x500 board and scaled to cover the screen.
export const ART_W = 800;
export const ART_H = 500;

// Player hitbox
export const PW = 32;
export const PH = 40;

// Simulation runs at a fixed 60 steps per second everywhere.
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAP_EVERY = 2; // server broadcasts every 2nd tick (30 Hz)

// --- Movement feel -----------------------------------------------------------
export const MOVE_SPEED = 300; // px/s, reached instantly on the ground
export const IT_SPEED_MUL = 1.06; // the chaser is a touch faster, so chases end
export const AIR_ACCEL = 2600; // px/s^2: quick, floaty steering in the air
export const GROUND_FRICTION = 0.78; // per tick, when no direction is held
export const AIR_FRICTION = 0.94;
export const JUMP_V = 960; // full jump: ~210 px high
export const AIR_JUMP_V = 820; // the second jump in mid-air: ~150 px more
export const AIR_JUMPS = 1;
export const JUMP_CUT_V = 340; // letting go of jump early caps the rise (short hops)
export const G_UP = 2200;
export const G_DOWN = 2800;
export const G_FAST = 2600; // extra gravity while holding down in the air
export const MAX_FALL = 1150;
export const MAX_FAST_FALL = 1600;
export const COYOTE_TICKS = 6; // grace period to jump after leaving a ledge
export const JUMP_BUFFER_TICKS = 7; // a jump pressed just before landing still counts
export const DASH_SPEED = 840;
export const DASH_TICKS = 9; // ~125 px burst
export const DASH_COOLDOWN = 72; // 1.2 s
export const DROP_TICKS = 10; // how long "down" lets you fall through a thin ledge
export const TRAMP_V = 1500; // trampoline launch: ~510 px
export const EPS = 0.5; // collision tolerance in px

// --- Tag rules ----------------------------------------------------------------
export const TOUCH = 7; // "it" tags anyone within this many px of touching
export const IMMUNE_TICKS = 60; // 1 s no-tag-back protection for the old "it"
export const STUN_TICKS = 24; // 0.4 s freeze for the newly tagged player
export const BLOCK_STUN_TICKS = 36; // "it" is knocked back when a shield blocks the tag
export const RESPAWN_TICKS = 30;
export const COUNTDOWN_MS = 3000;

// --- Power-ups ------------------------------------------------------------------
export const PICKUP_TYPES = ['speed', 'jump', 'shield', 'freeze'];
export const PICKUP_INFO = {
  speed: { name: 'Swift', blurb: 'Run faster for 6 s' },
  jump: { name: 'Spring', blurb: 'Jump higher for 7 s' },
  shield: { name: 'Ward', blurb: 'Blocks one tag (8 s)' },
  freeze: { name: 'Frost', blurb: 'Freezes the other side' },
};
export const PICKUP_R = 20; // pick-up radius around the item
export const PICKUP_FIRST_TICKS = 180; // first item 3 s after GO
export const PICKUP_EVERY_TICKS = 390; // then one every 6.5 s
export const PICKUP_MAX = 3; // at most this many lying around
export const SPEED_BUFF_MUL = 1.38;
export const JUMP_BUFF_MUL = 1.22;
export const SPEED_BUFF_TICKS = 360;
export const JUMP_BUFF_TICKS = 420;
export const SHIELD_TICKS = 480;
export const FREEZE_IT_TICKS = 110; // a runner freezes "it" for 1.8 s
export const FREEZE_RUNNERS_TICKS = 70; // "it" freezes the runners for 1.2 s

// --- Rooms ----------------------------------------------------------------------
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
export const NAME_MAX = 12;
export const DURATIONS = [60, 90, 120];
export const DEFAULT_DURATION = 90;
export const MODES = [
  { id: 'potato', name: 'Hot Potato', blurb: 'Whoever is IT when the clock hits zero loses. Everyone else wins.' },
  { id: 'time', name: 'Least Time', blurb: 'Every second as IT counts against you. Lowest total wins.' },
];
export const MODE_IDS = MODES.map((m) => m.id);

// Input bit flags
export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;
export const IN_DOWN = 8;
export const IN_DASH = 16;
export const IN_MASK = 31;

// Join-order colours: red, blue, green, yellow
export const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
export const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];

// Art styles (drawing code lives in public/js/themes). Ink is the house style.
export const THEMES = [
  { id: 'ink', name: 'Ink & Sakura', blurb: 'Brush strokes on rice paper' },
  { id: 'neon', name: 'Neon District', blurb: 'Cyberpunk rain and chrome' },
  { id: 'nightmare', name: 'Nightmare', blurb: 'Something is watching' },
  { id: 'sketch', name: 'Sketchbook', blurb: 'Doodles come alive' },
  { id: 'arcade', name: 'Arcade', blurb: '8-bit sunset' },
];
export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = 'ink';
