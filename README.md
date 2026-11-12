# You're It!

Real-time multiplayer tag for 2&ndash;4 players, in the browser. One player is "it"; touch someone and they are "it" instead. Everyone plays on their own device: one person creates a room, shares the 4-digit code (or the invite link), and friends join.

- **Quick match or tournament.** A quick match is one round: *Hot Potato* (whoever is it when the clock hits zero loses) or *Least Time* (every second as it counts against you). A tournament is 3, 5 or 7 rounds for points.
- **The whole arena on one screen**, with small characters, on anything laptop-sized or bigger. On a phone the view follows you instead and leans towards whoever is it.
- **Movement with weight**: you build up speed, skid when you turn round, and jump in a floaty arc. Four actions only &ndash; left, right, jump, down.
- **Arenas with slopes, trampolines, updrafts and portals** (a portal turns you into a spark and flies you to its partner), plus power-ups.
- **Seven art styles**: Ink & Sakura (the house style), Orbit, Xeno, Neon District, Nightmare, Sketchbook and Arcade.
- **Practice against bots** without anyone else online.
- Menus drawn like a game, not a web page: brush lettering on hanging scrolls, with a picture card for every arena and every art style. They work with the keyboard alone; phones get on-screen controls and a built-in number pad for the room code.
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
| Run | &larr; / &rarr; or A / D | left thumb strip (slide to change direction) |
| Jump &ndash; press again in the air for a second jump; tap for a short hop | &uarr;, W or Space | big button |
| Drop through a thin ledge or slope, fall faster | &darr; or S | small button |
| Pause menu | Esc | menu button |

Everything can be done without a mouse, and every screen shows its keys (on phones the cues are hidden):

| Where | Keys |
|---|---|
| Any menu | &uarr; / &darr; move, &larr; / &rarr; change the choice you are on, Enter choose, Esc back |
| Anywhere | M sound on / off, F full screen |
| Title screen | 1 create a room, 2 join, 3 practice, H how to play, N change name |
| Join | type the four digits, Backspace deletes, Enter joins |
| Match setup | A next arena, S next style (Shift goes back), G game, R rules or rounds, L round length, P power-ups, B bots, Enter start, C copy the invite link |
| In a match | Esc pause menu; there: Esc resume, H how to play, Q leave |
| Results | Enter play again, Esc back |

Keys that would throw you out of a game (Esc in a room, Q in the pause menu, Esc to end a tournament) have to be pressed twice.

- "It" tags by touching another player. Grazing counts, and the server also accepts a touch against where the target was on the tagger's own screen, so lag does not rob you of a tag.
- The tagged player is frozen for 0.4 s so the tagger can get away, and the tagger cannot be tagged back for 1 s (they flash while protected). "It" runs slightly faster than everyone else.
- Players pass through each other.
- **Slopes** behave like tilted thin ledges: walk up and down them, jump up through them from below, hold down to drop through &ndash; or to walk under one from its low end.
- **Trampolines** launch you about twelve tiles up. **Updrafts** are columns of rising air: step in, let go and ride. **Portals** come in coloured pairs: step into one and you fly to its partner as a spark, with no control and safe from tags until you arrive.
- **Power-ups** appear every few seconds:

  | | |
  |---|---|
  | Swift (bolt) | run faster for 6 s |
  | Spring (chevrons) | jump higher for 7 s |
  | Ward (shield) | blocks one tag and knocks "it" back; "it" cannot carry one |
  | Frost (snowflake) | freezes the other side: a runner freezes "it", "it" freezes every runner |

- Everyone needs a name before playing; two players with the same name in a room get a number.
- If you join while a round is running you watch it and play the next one.
- The player who created the room is the host (picks the game, style, arena and round length; starts it). If they leave, the next player becomes host.

### Tournament rules

- Each round, players are ranked by time spent as it &ndash; least is best &ndash; and score 3, 2, 1, 0 points (with four players; equal times share the better place).
- Everyone who is **not** it when the buzzer sounds gets 1 more point. So a tag in the last second matters even if your time is already the worst.
- From round 2, the leader starts the round as it.
- Every second round has a twist: *Moon Gravity* (everything floats), *Turbo* (everyone runs faster) or *Item Frenzy* (power-ups everywhere).
- The last round counts double. Most points wins; a tie is broken by less total time as it.
- With "Random" arena a tournament visits a different arena every round.

## How it works

```
server.js            Express + Socket.io. Rooms, tournaments, and the real simulation of every match.
shared/              Code that runs on BOTH the server and the browser:
  config.js            every tunable number (speeds, jump, timers, power-ups, tournament rules)
  physics.js           one player, one tick: movement, ledges, slopes, trampolines, updrafts, portals
  sim.js               the rules: who is it, tagging, power-ups, scoring
  arenas.js            the maps, drawn as text
  nav.js, bots.js      route map of each arena and the computer players that use it
public/
  index.html, css/     menus (hanging scrolls on an ink landscape), heads-up display, results
  js/main.js           screens, keyboard navigation and wiring
  js/net.js            online play: prediction, reconciliation, interpolation
  js/local.js          offline play against bots
  js/renderer.js       draws a match (see below)
  js/themes/*.js       one file per art style; README.md there describes how to write one
  js/art.js            menu pictures: the landscape behind the menus, arena and style cards
  js/audio.js          synthesised sound effects (no audio files)
  fonts/               self-hosted open-licence fonts
test/                `npm test` - rules/physics checks and scripted online matches
```

**Fair and responsive.** The server is the referee: browsers only send which buttons are held, 60 times a second, and the server decides where everyone is and who got tagged. To keep that from feeling laggy:

- *Prediction.* Your own character moves the instant you press a key, simulated locally with the exact same physics code the server runs. Players do not collide with each other, so this prediction is exact.
- *Reconciliation.* Each server update says which of your inputs it has applied. The browser rewinds to that confirmed state, replays the inputs the server has not seen yet, and blends away any difference.
- *Interpolation.* Other players are drawn about 100 ms in the past, gliding between the last few updates, so 30 updates a second looks smooth at any frame rate.
- *Lag-compensated tags.* Because of that delay, the server keeps a short history of everyone's position and checks a tag against what the tagger was actually looking at.

**Smooth.** Drawing is built so that weak laptops hold their frame rate:

- Everything that never moves &ndash; backdrop, platforms, slopes &ndash; is painted once into a background canvas. Showing a finished picture again costs the browser nothing.
- A transparent canvas on top is cleared and redrawn each frame with only the moving things: players, items, sparks. Anything fancy (glows, portals, name tags) is pre-rendered into small sprites.
- The heads-up display is ordinary HTML, updated ten times a second.
- Art styles are loaded only when a match needs them.
- If frames still take too long, the game drops ambient animation first and then the resolution of the moving layer.

## Changing things

- **Feel** &ndash; speeds, acceleration, jump, gravity, tag protection, power-up strength and timing are all in `shared/config.js`.
- **Maps** &ndash; `shared/arenas.js` holds every arena as a grid of characters (`#` solid, `=` ledge, `^` trampoline, `u` updraft, letters for portal pairs, `*` power-up spots, `1`&ndash;`4` spawns) plus a list of slopes. Edit one or add another and it shows up in the lobby; the bots work out their own routes. `npm test` checks that every surface can be reached and that bots can play it.
- **New art style** &ndash; read `public/js/themes/README.md`, add a file next to the others and add it to `THEMES` in `shared/config.js`.

Set `DEBUG_NET=1` when starting the server to print input-buffer statistics after each round.

## Credits

Fonts are self-hosted copies from Google Fonts under the SIL Open Font License or Apache 2.0 (see `public/fonts/README.txt`). All artwork is drawn by code; there are no image or audio assets.
