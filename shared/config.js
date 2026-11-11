// Shared constants. Imported by the Node server AND by the browser, so the
// physics on both sides is byte-for-byte the same code with the same numbers.

export const W = 800;
export const H = 500;

// Player hitbox
export const PW = 32;
export const PH = 40;

// Simulation runs at a fixed 60 steps per second everywhere.
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAP_EVERY = 2; // server broadcasts every 2nd tick (30 Hz)

// Movement feel
export const MOVE_SPEED = 260; // px/s, reached instantly on the ground
export const IT_SPEED_MUL = 1.06; // the chaser is a touch faster, so chases end
export const AIR_ACCEL = 1500; // px/s^2, weaker steering in the air
export const GROUND_FRICTION = 0.82; // per tick, when no direction is held
export const AIR_FRICTION = 0.95;
export const JUMP_V = 800; // px/s, fixed height jump (~150 px, ~0.75 s airtime)
export const G_UP = 2000; // gravity while rising
export const G_DOWN = 2600; // gravity while falling (snappier descent)
export const MAX_FALL = 1000;
export const COYOTE_TICKS = 5; // grace period to jump after leaving a ledge
export const EPS = 0.5; // collision tolerance in px

// Tag rules
export const TOUCH = 2; // "it" tags when within this many px of touching
export const IMMUNE_TICKS = 90; // 1.5 s no-tag-back protection for the old "it"
export const STUN_TICKS = 30; // 0.5 s freeze for the newly tagged player
export const RESPAWN_TICKS = 30; // 0.5 s after falling off the bottom
export const COUNTDOWN_MS = 3000;

// Rooms
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
export const NAME_MAX = 12;
export const DURATIONS = [60, 90, 120];
export const DEFAULT_DURATION = 90;

// Input bit flags
export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;

// Join-order colours: red, blue, green, yellow
export const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
export const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];

// Art styles (drawing code lives in public/js/themes)
export const THEMES = [
  { id: 'neon', name: 'Neon District', blurb: 'Cyberpunk rain & chrome' },
  { id: 'nightmare', name: 'Nightmare', blurb: 'Something is watching' },
  { id: 'sketch', name: 'Sketchbook', blurb: 'Doodles come alive' },
  { id: 'arcade', name: 'Arcade', blurb: '8-bit sunset' },
  { id: 'ink', name: 'Ink & Sakura', blurb: 'Brush strokes on paper' },
];
export const THEME_IDS = THEMES.map((t) => t.id);
