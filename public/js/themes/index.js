// Registry of art styles. Every theme draws the same arena and the same
// 32x40 player hitboxes in its own way.
//
// A theme is an object with:
//   id, colors[4], letterbox, label{}, hud{}, pixel? (render at 1/pixel scale)
//   build(env)                      -> scene (pre-rendered layers + animation data)
//   back(g, scene, t, view, players)       background
//   platforms(g, scene, t, view, players)  things you can stand on
//   player(g, pv, t, scene)                one character
//   marker(g, cx, cy, t, pv)               the "IT" sign above a head
//   front(g, scene, t, view, players)      weather / lighting / screen effects
//   fx: { jump, land, step, trail, respawn, tag }   particle hooks

import neon from './neon.js';
import nightmare from './nightmare.js';
import sketch from './sketch.js';
import arcade from './arcade.js';
import ink from './ink.js';

export const THEME_MAP = { neon, nightmare, sketch, arcade, ink };
