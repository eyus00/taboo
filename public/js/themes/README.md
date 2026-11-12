# Art styles

Every style is one file that exports an object. The renderer (`../renderer.js`)
calls it to paint the same arena and the same 32x40 players in a different look.
`ink.js` is the reference implementation.

The golden rule: **anything expensive is painted once; per-frame code stays tiny.**
The renderer paints all scenery a single time into a background canvas and never
touches it again. Each frame it only draws moving things on a transparent canvas
above. Styles that put gradients, blur or big translucent fills in per-frame code
are what made the old version slow.

## Coordinates

- **Art board**: 800 x 500 units (`ART_W`, `ART_H`). Backdrops are composed on it
  and scaled to cover the screen, so keep important things away from the edges.
- **World**: arena units. Arenas are 2000 x 1120; a tile is 40; a player is
  32 x 40 (`PW`, `PH`). On a typical laptop one world unit is about 0.7-1 screen
  pixel, so players are only ~25-35 px tall on screen: favour bold, simple
  shapes with the player's colour clearly visible over fine detail.

## The object

```js
export default {
  id: 'ink',
  colors: ['#c8372d', '#2f62b0', '#3c8f57', '#d79a12', '#7a4a9e', '#d9689a'], // players 1-6: red, blue, green, yellow, purple, pink (in that order, any shade)
  letterbox: '#ddd2b8',   // page colour behind / around everything
  lift: '#4f6f8f',        // colour of the air streaks in updraft columns
  pixel: 2,               // OPTIONAL, pixel-art styles only: size of one art pixel in world units
  label: {                // player names (drawn by the renderer at a fixed on-screen size)
    font: '600 15px "Cormorant Garamond", Georgia, serif',   // the px size is replaced
    color: '#1c1b1f', stroke: 'rgba(239,230,210,.92)', strokeWidth: 4,
    you: '#c8372d',       // colour of your own name
    gap: 7,               // OPTIONAL space between head and name, CSS px
  },

  // ---- painted ONCE (be as fancy as you like: gradients, thousands of strokes) ----
  build(env) -> scene     // prepare layers / data. env = { arena, rnd, scale, layer(draw, scale?), sprite(w, h, draw) }
  back(g, scene)          // backdrop, art-board coordinates
  platform(g, p, i, rnd, arena)   // one platform, world coordinates. p = { x, y, w, h, oneway, ground, ramp? }
                          //   p.ground: a solid block (can be very tall: the floor is extended to the bottom of the screen)
                          //   p.oneway: a thin ledge, 14 high
  ramp(g, r, i, rnd, arena)       // OPTIONAL: a slope, r = { x0, y0, x1, y1 } with x0 < x1 (y is the walking surface).
                          //   If absent the renderer draws your thin ledge (platform with p.ramp = true) rotated along
                          //   the slope and 16 longer at each end. Pixel-art styles should implement it (staircase).
  decor(g, scene, arena)  // OPTIONAL: extras painted over platforms, world coordinates
  front(g, scene)         // OPTIONAL: static overlay (vignette, light shafts), art-board coordinates

  // ---- pre-rendered into sprites by the renderer, called with t = 0 at the origin ----
  portal(g, po, t, i, scene)      // po = { cx, cy, w: 44, h: 76, pair }. Use PORTAL_COLORS[po.pair % 3] from util.js so pairs match.
                                  //   Must fit in a 92 x 112 box centred on (cx, cy). The renderer adds a gentle pulse + circling sparks.
  pickup(g, kind, x, y, t, scene) // kind: 'speed' | 'jump' | 'shield' | 'freeze'. Fit in 68 x 68 centred on (x, y).
                                  //   Use drawIcon(g, kind, x, y, r, color) + KIND_COLORS from util.js so the icons stay recognisable.
  marker(g, cx, cy, t, pv, scene) // the "IT" sign that floats above a head: (cx, cy) is its bottom-centre anchor.
                                  //   Fit within x: cx-44..cx+44, y: cy-60..cy+18. Must read at ~25 px tall.

  // ---- called EVERY FRAME: keep it cheap ----
  live(g, scene, t)       // OPTIONAL ambient animation behind the players, art-board coordinates
  trampoline(g, tr, t, k, scene)  // tr = { x, y, w, h: 16, cx }; k = 0 at rest (that frame becomes a sprite), up to 1 while squashed
  player(g, pv, t, scene) // one character, world coordinates (see pv below)
  fx: { jump(R, pv), land(R, pv, impact), step(R, pv), trail(R, pv, dt, t), respawn(R, pv), tag(R, to, from) }  // all optional
};
```

`env.layer(draw)` pre-renders something on the art board and returns a canvas:
`g.drawImage(layer, 0, 0, 800, 500)`. `env.sprite(w, h, draw)` pre-renders a
small picture `w` x `h` world units big at screen resolution; draw it later with
`g.drawImage(spr, x, y, w, h)` - this is how to get glows cheaply (bake a radial
gradient once, stamp it every frame). `env.rnd` is a seeded random generator, so
every player sees the same scenery; never use `Math.random()` for scenery.

### pv (a player, as the style sees it)

```
slot, color, name, x, y (top-left of the 32x40 box), cx, feet, vx, vy,
ground, face (-1 | 1), isIt, immune, stunned, frozen, speedy, springy, shield, local,
run (advances while running - drive leg cycles with Math.sin(pv.run)),
squash (-0.2 stretch .. 0.3 squash; use squashAt(g, cx, feet, pv.squash) from util.js),
blink (1 -> 0 during a blink), seed (stable per player)
```

The renderer draws on top of your player: the frozen ice block, the shield
ring, the name, the IT marker, and the orb while travelling through a portal.
Whoever `isIt` should still look different in your own drawing (angry eyes, a
glow sprite, a tint...) - it is the most important thing on screen.

### Effects

`R.emit({ x, y, vx, vy, g, drag, life, size, grow, color, alpha, shape, back, ... })`
adds a particle (world coordinates). Shapes: `'circle'` (default), `'square'`,
`'ring'` (+ `width`), `'line'` (+ `width`, optional `lx`); or pass
`draw(g, p, k)` for a custom one (k runs 1 -> 0). `back: true` draws behind
players. `R.flash(color, alpha)` flashes the screen, `R.shake(px)` shakes it.
Keep counts small: a handful per event, at most ~30 for a tag.

## Per-frame budget (live, trampoline, player, particle draw callbacks)

Allowed: paths, fills, strokes, arcs, small `fillRect`s, `drawImage` of a sprite,
`save/translate/rotate/restore`, solid or rgba colours.

Good to know: a fill is about half the cost of a fill plus a stroke, so draw an
outline as a slightly bigger dark shape under the coloured one. Many small paths
are cheaper than one path whose pieces are scattered across the screen. `live`
is drawn above the platforms (it is on the moving layer), so keep ambient things
in open sky or check where the platforms are.

Not allowed: `createLinearGradient` / `createRadialGradient` / `createPattern`,
`shadowBlur` / `shadowColor`, `filter`, `globalCompositeOperation` other than the
default, `getImageData`, text (`fillText`), clipping big regions, or filling large
areas (more than about 80 x 80 world units) with translucent colour. `live` should
draw at most a few dozen small shapes.

## Checking your work

Start the server (`PORT=3000 node server.js`) and open
`/_theme.html?theme=<id>&arena=hills` - four bots play a match in your style.
Add `&zoom=1.6&fx=1000&fy=900` for a close-up of a world point, `&names=0` to
hide names, `&seed=3` for a different match. Arenas: hills, canyon, pagoda,
zigzag, dojo.
