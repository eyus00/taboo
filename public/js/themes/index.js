// Registry of art styles. Every theme draws the same arena and the same
// 32x40 player hitboxes in its own way.
//
// A theme is an object with:
//   id, colors[4], letterbox, label{}, hud{}, pixel? (world rendered at 1/pixel scale)
//   build(env)                           -> scene (backdrop layers + animation data)
//   back(g, scene, t, view, players)     backdrop, on the 800x500 art board
//   platform(g, p, i, rnd)               paints one platform (cached by the renderer)
//   platPad, platVariants?, platformFx?  sprite padding / boil frames / animated accents
//   trampoline(g, tr, t, squash)         world space
//   portal(g, portal, t, index)          world space
//   pickup(g, kind, x, y, t)             world space
//   player(g, pv, t, scene)              one character, world space
//   marker(g, cx, cy, t, pv)             the "IT" sign above a head, screen space
//   front(g, scene, t, view, players)    weather / lighting, on the art board
//   fx: { jump, land, step, trail, respawn, tag }   particle hooks

import ink from './ink.js';
import neon from './neon.js';
import nightmare from './nightmare.js';
import sketch from './sketch.js';
import arcade from './arcade.js';

export const THEME_MAP = { ink, neon, nightmare, sketch, arcade };
