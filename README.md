# You're It!

Real-time multiplayer tag for 2&ndash;4 players, in the browser. One player is "it"; touch someone and they are "it" instead. Everyone plays on their own device: one person creates a room, shares the 4-letter code (or the invite link), and friends join.

- **Two rule sets** &ndash; *Hot Potato* (whoever is it when the clock hits zero loses, everyone else wins) and *Least Time* (every second as it counts against you).
- **Big arenas** with thin ledges you can jump up through, trampolines, portals and power-ups. The camera follows you and pulls "it" into frame when they get close; arrows and a minimap show everyone else.
- **Fluid movement** &ndash; double jump, short hops, dash, drop through ledges, fast fall.
- **Five art styles** &ndash; Ink & Sakura (the house style), Neon District, Nightmare, Sketchbook and Arcade.
- **Practice against bots** &ndash; works without anyone else online.
- Keyboard on computers, on-screen buttons on phones and tablets.
- No accounts, no database, no API keys. One small Node server.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:3000>. To try multiplayer alone, open it in two browser windows.

## Put it online for free (Render)

1. Push this repository to GitHub.
2. On [render.com](https://render.com) choose **New &rarr; Web Service** and connect the repository.
3. Settings: Runtime **Node**, Build command `npm install`, Start command `node server.js`, Instance type **Free**, branch `main`.
4. Deploy. Render gives you a URL like `https://your-name.onrender.com` &ndash; that is the game. Send it to your friends.

`render.yaml` describes the same setup, so **New &rarr; Blueprint** also works.

Things to know about the free plan:

- The server goes to sleep after about 15 minutes with no visitors. The next visit takes 30&ndash;60 seconds to wake it up; after that it is fast. Opening the page is what wakes it, so load the site a minute before you want to play.
- Rooms live in memory. If the server restarts or goes to sleep, open rooms are gone &ndash; just make a new one.

Any host that runs a long-lived Node process with WebSockets works the same way (the server reads the `PORT` environment variable). Static-only hosts such as GitHub Pages cannot run it.

## How to play

| | Keyboard | Phone |
|---|---|---|
| Run | A / D or &larr; / &rarr; | &#9664; &#9654; |
| Jump (press again in the air for a double jump; tap for a short hop) | W, &uarr; or Space | JUMP |
| Drop through a thin ledge, fall faster | S or &darr; | &#9660; |
| Dash | Shift, E, X or K | DASH |

- "It" tags by touching another player. Grazing counts: the hitboxes only need to come within a few pixels, and the server also accepts a touch against where the target was on the tagger's own screen, so lag does not rob you of a tag.
- The tagged player is frozen for 0.4 s so the tagger can get away, and the tagger cannot be tagged back for 1 s (they flash while protected). "It" runs slightly faster than everyone else.
- Players pass through each other.
- **Trampolines** launch you about twelve tiles up. **Portals** come in coloured pairs: step into one and you come out of its partner.
- **Power-ups** appear every few seconds:

  | | |
  |---|---|
  | Swift (bolt) | run faster for 6 s |
  | Spring (chevrons) | jump higher for 7 s |
  | Ward (shield) | blocks one tag and knocks "it" back; "it" cannot carry one |
  | Frost (snowflake) | freezes the other side: a runner freezes "it", "it" freezes every runner |

- If you join while a round is running you watch it and play the next one.
- The player who created the room is the host (picks rules, style, arena, round length; starts rounds). If they leave, the next player becomes host.

## How it works

```
server.js            Express + Socket.io. Rooms, and the real simulation of every match.
shared/              Code that runs on BOTH the server and the browser:
  config.js            every tunable number (speeds, jump, dash, timers, power-ups)
  physics.js           one player, one tick: movement, ledges, trampolines, portals
  sim.js               the rules: who is it, tagging, power-ups, scoring
  arenas.js            the maps, drawn as text
  nav.js, bots.js      route map of each arena and the computer players that use it
public/
  index.html, css/     menus, lobby, results (one ink-and-paper house style)
  js/main.js           screens and wiring
  js/net.js            online play: prediction, reconciliation, interpolation
  js/local.js          offline play against bots
  js/renderer.js       camera, particles, labels, minimap, HUD
  js/themes/*.js       one file per art style
  js/art.js            avatars and preview pictures for the menus
  js/audio.js          synthesised sound effects (no audio files)
  fonts/               self-hosted open-licence fonts
test/                `npm test` - rules/physics checks and scripted online matches
```

The server is the referee: browsers only send which buttons are held, 60 times a second, and the server decides where everyone is and who got tagged. To keep that from feeling laggy:

- **Prediction.** Your own character moves the instant you press a key, simulated locally with the exact same physics code the server runs. Players do not collide with each other, so this prediction is exact.
- **Reconciliation.** Each server update says which of your inputs it has applied. The browser rewinds to that confirmed state, replays the inputs the server has not seen yet, and blends away any difference.
- **Interpolation.** Other players are drawn about 100 ms in the past, gliding between the last few updates, so 30 updates a second looks smooth at any frame rate.
- **Lag-compensated tags.** Because of that delay, the server keeps a short history of everyone's position and checks a tag against what the tagger was actually looking at.

## Changing things

- **Feel** &ndash; speeds, jump heights, dash, tag protection, power-up strength and timing are all in `shared/config.js`.
- **Maps** &ndash; `shared/arenas.js` holds every arena as a grid of characters (`#` solid, `=` ledge, `^` trampoline, letters for portal pairs, `*` power-up spots, `1`&ndash;`4` spawns). Edit one or add another and it shows up in the lobby; the bots work out their own routes. `npm test` checks that every surface can be reached.
- **New art style** &ndash; copy a file in `public/js/themes/`, register it in `themes/index.js` and add it to `THEMES` in `shared/config.js`.

Set `DEBUG_NET=1` when starting the server to print input-buffer statistics after each round.

## Credits

Fonts are self-hosted copies from Google Fonts under the SIL Open Font License or Apache 2.0 (see `public/fonts/README.txt`). All artwork is drawn by code; there are no image or audio assets.
