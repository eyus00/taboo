// Arena layouts. Every platform is a solid rectangle {x, y, w, h}: you land on
// top, bump into the sides and bonk your head underneath. Anything that reaches
// the bottom edge of the screen is "ground" (drawn as a thick block), the rest
// are floating slabs. Falling past the bottom respawns you at the top centre.
//
// All of these are tuned to the jump in config.js (~150 px high, ~195 px long).

import { W, H, PW, PH } from './config.js';

const P = (x, y, w, h) => ({ x, y, w, h });

const RAW = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Full floor, three tiers. Nowhere to fall.',
    platforms: [P(0, 460, 800, 40), P(90, 345, 200, 20), P(510, 345, 200, 20), P(320, 235, 160, 20)],
    spawns: [
      [60, 420],
      [708, 420],
      [174, 305],
      [594, 305],
    ],
  },
  {
    id: 'towers',
    name: 'Towers',
    blurb: 'Three towers, two deadly gaps.',
    platforms: [
      P(0, 350, 180, 150),
      P(310, 290, 180, 210),
      P(620, 350, 180, 150),
      P(0, 225, 120, 18),
      P(680, 225, 120, 18),
      P(345, 160, 110, 18),
    ],
    spawns: [
      [40, 310],
      [728, 310],
      [330, 250],
      [438, 250],
    ],
  },
  {
    id: 'steps',
    name: 'Steps',
    blurb: 'A giant staircase with a risky way back down.',
    platforms: [
      P(0, 450, 170, 50),
      P(170, 385, 150, 115),
      P(320, 320, 150, 180),
      P(470, 255, 150, 245),
      P(620, 190, 180, 310),
      P(0, 280, 160, 18),
      P(250, 175, 120, 18),
    ],
    spawns: [
      [30, 410],
      [230, 345],
      [380, 280],
      [530, 215],
    ],
  },
  {
    id: 'chasm',
    name: 'Chasm',
    blurb: 'Two cliffs, one tiny stepping stone.',
    platforms: [
      P(0, 450, 300, 50),
      P(500, 450, 300, 50),
      P(365, 405, 70, 18),
      P(60, 325, 150, 18),
      P(590, 325, 150, 18),
      P(300, 255, 200, 18),
      P(0, 205, 110, 18),
      P(690, 205, 110, 18),
    ],
    spawns: [
      [100, 410],
      [668, 410],
      [120, 285],
      [648, 285],
    ],
  },
  {
    id: 'skyhop',
    name: 'Skyhop',
    blurb: 'Floating islands. Do not look down.',
    platforms: [
      P(0, 440, 150, 20),
      P(325, 440, 150, 20),
      P(650, 440, 150, 20),
      P(185, 345, 105, 18),
      P(510, 345, 105, 18),
      P(0, 245, 125, 18),
      P(345, 245, 110, 18),
      P(675, 245, 125, 18),
    ],
    spawns: [
      [40, 400],
      [728, 400],
      [221, 305],
      [546, 305],
    ],
  },
];

export const ARENAS = RAW.map((a) => ({
  ...a,
  platforms: a.platforms.map((p) => ({ ...p, ground: p.y + p.h >= H })),
}));

export const ARENA_IDS = ARENAS.map((a) => a.id);

export function arenaById(id) {
  return ARENAS.find((a) => a.id === id) || ARENAS[0];
}

// Where players drop back in after falling off the bottom.
export const RESPAWN = { x: W / 2 - PW / 2, y: -PH };
