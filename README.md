# You're It!

Real-time multiplayer tag for 2&ndash;4 players, in the browser. One player is "it"; touch someone and they are "it" instead. Whoever has spent the least time as "it" when the clock runs out wins.

Everyone plays on their own device. One person creates a room, shares the 4-letter code (or the invite link), and friends join.

- **Five art styles** &ndash; Neon District (cyberpunk), Nightmare (horror), Sketchbook, Arcade (8-bit) and Ink & Sakura. The host picks one or leaves it on Random.
- **Five arenas** &ndash; Classic, Towers, Steps, Chasm, Skyhop.
- **Practice vs bots** &ndash; works without anyone else online.
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
3. Settings: Runtime **Node**, Build command `npm install`, Start command `node server.js`, Instance type **Free**. Pick the branch the code is on.
4. Deploy. Render gives you a URL like `https://your-name.onrender.com` &ndash; that is the game. Send it to your friends.

`render.yaml` describes the same setup, so **New &rarr; Blueprint** also works.

Things to know about the free plan:

- The server goes to sleep after about 15 minutes with no visitors. The next visit takes 30&ndash;60 seconds to wake it up; after that it is fast. Opening the page is what wakes it, so load the site a minute before you want to play.
- Rooms live in memory. If the server restarts or goes to sleep, open rooms are gone &ndash; just make a new one.

Any host that runs a long-lived Node process with WebSockets works the same way (the server reads the `PORT` environment variable). Static-only hosts such as GitHub Pages cannot run it.

## How to play

| | |
|---|---|
| Move | &larr; &rarr; or A D |
| Jump | &uarr;, W or Space |

- Exactly one player is "it" (marked above their head). "It" tags by touching another player.
- The tagged player is frozen for half a second so the tagger can get away, and the tagger cannot be tagged back for 1.5 seconds (they flash while protected).
- "It" runs slightly faster than everyone else.
- Players are solid: you can block each other and stand on heads.
- Platforms are solid from every side. To get onto one, jump next to it and steer over.
- Fall off the bottom and you drop back in from the top half a second later.
- When the timer hits zero, least time as "it" wins. Exact ties share the win.
- If you join while a round is running you watch it and play the next one.
- The player who created the room is the host (picks style, arena, round length, starts rounds). If they leave, the next player becomes host.

## How it works

```
server.js            Express + Socket.io. Rooms, and the real simulation of every match.
shared/              Code that runs on BOTH the server and the browser:
  config.js            every tunable number (speed, jump, timers, colours)
  physics.js           one player, one tick: movement, gravity, collisions
  sim.js               the rules of tag: who is it, tagging, scoring
  arenas.js            platform layouts
  bots.js              computer players (practice mode, menu backdrops)
public/
  index.html, css/     menus, lobby, results - re-skinned per art style
  js/main.js           screens and wiring
  js/net.js            online play: prediction, reconciliation, interpolation
  js/local.js          offline play against bots
  js/renderer.js       canvas layout, particles, labels, HUD
  js/themes/*.js       one file per art style
  js/audio.js          synthesised sound effects (no audio files)
  fonts/               self-hosted open-licence fonts
test/                `npm test` - rules/physics checks and a scripted online match
```

The server is the referee: browsers only send which keys are held, 60 times a second, and the server decides where everyone is and who got tagged. To keep that from feeling laggy:

- **Prediction.** Your own character moves the instant you press a key, simulated locally with the exact same physics code the server runs.
- **Reconciliation.** Each server update says which of your inputs it has applied. The browser rewinds to that confirmed state, replays the inputs the server has not seen yet, and blends away any difference.
- **Interpolation.** Other players are drawn about 100 ms in the past, gliding between the last few updates, so 30 updates a second looks smooth at any frame rate.

## Changing things

- **Feel** &ndash; speeds, jump height, tag protection, round lengths are all in `shared/config.js`.
- **New arena** &ndash; add an entry to `shared/arenas.js` (rectangles on an 800&times;500 field, plus four spawn points). It appears in the lobby automatically. `npm test` checks that spawns and respawns land on something.
- **New art style** &ndash; copy a file in `public/js/themes/`, register it in `themes/index.js`, add it to `THEMES` in `shared/config.js`, and give the menus a matching `body[data-theme='...']` block in `public/css/style.css`.

Set `DEBUG_NET=1` when starting the server to print input-buffer statistics after each round.

## Credits

Fonts are self-hosted copies from Google Fonts under the SIL Open Font License or Apache 2.0 (see `public/fonts/README.txt`). All artwork is drawn by code; there are no image or audio assets.
