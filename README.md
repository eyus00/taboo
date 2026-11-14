# Onigokko

*Onigokko* (鬼ごっこ) is Japanese for tag; whoever is it is the *oni*. This is real-time multiplayer tag for 2&ndash;10 players, in the browser. Everyone plays on their own device. **Host** a room, walk into one that is **open** to everyone, or type the 4-digit code of a friend's (an invite link works too).

- **Three ways to play.** *Hot Potato* (whoever is the oni when the clock hits zero loses), *Least Time* (every second as the oni counts against you), and *Team Bomb* (two teams, flags to hold, and bombs that go off at the buzzer). Any of them as a quick match or a tournament of 3, 5 or 7 rounds.
- **Lucky boxes.** Touch one and you get a random item to keep: set it off when it hurts most. A Blast that hurls everyone on screen away, a Swap that trades places with someone, a Storm that puts everyone else in slow motion, Goo to slip on, Frost, Ward, Swift and Spring. Nothing works in the last 10 seconds, so nobody can sit on one for the buzzer.
- **Close-up camera** that follows you, with a minimap (top left) for everyone you cannot see. Each round opens on the whole arena, then zooms in on you.
- **A display that stays out of the way**: the clock in the middle of the top edge, in a team game each side's score and names on its own side of the clock, and what you are holding along the bottom. Before GO a card in the middle says what the game is about in one line (and, in your first matches, the keys); it leaves at GO.
- **Movement with weight**: you build up speed, skid when you turn round, and jump in a floaty arc. Five actions &ndash; left, right, jump, down, use item.
- **Six big arenas with room to run.** Each is built around long stretches of plain open ground (at least four of 14 tiles or more, one of them 24 or more), with the slopes, trampolines, launchers, updrafts and portals at the ends and edges instead of in the way. A portal flies you over the map in an arc, and some let you drop out half way.
- **A draw before every round**: three picture cards spin for the arena (shown in that round's style), the art style, and who starts as the oni (their character, in their colour).
- **Seven art styles**: Ink & Sakura (the house style), Orbit, Xeno, Neon District, Nightmare, Sketchbook and Arcade.
- **Practice against bots** (one to nine of them), including team battles.
- Menus drawn like a game: brush lettering on hanging scrolls, a room that reads like a match card, and popups (the stage, open rooms, your profile, questions) laid over what is open like sheets of paper. A how-to-play page where every picture is the real game playing itself. Everything works with the keyboard alone; phones get on-screen controls and a built-in number pad for the room code.
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
| Use the item you are holding | E, X or Shift | item button |
| Pause menu | Esc | menu button |

Everything can be done without a mouse, and every screen shows its keys (on phones the cues are hidden):

| Where | Keys |
|---|---|
| Any menu | &uarr; / &darr; move, &larr; / &rarr; change the choice you are on, Enter choose, Esc back |
| Anywhere | M sound on / off, F full screen |
| Title screen | 1 play, 2 practice, 3 your profile (your name), H how to play |
| Play | C host a room, P look through the open rooms (a popup: filter by game, or only rooms waiting to start), or type the four digits of a room's code (the fourth joins) |
| In a room | G one match or a tournament, N how many rounds, R which game, A next arena, S next style (Shift goes back), T along the rounds of a tournament (A and S then change that round only), L round time, P lucky boxes, B bots (practice), X change sides, Z shuffle the sides (host), Enter start; also C copy the invite link and V open or private |
| Choosing the stage | Enter on the stage picture (or on a round's) opens a popup with every style in a row and every arena as a picture; there: arrows choose, A and S step, T picks which round the choice is for, Enter or Esc closes |
| In a match | Esc pause menu; there: Esc resume, H how to play, M sound, F full screen, Q leave |
| Results | Enter play again, Esc back |

Anything that would take you out of a game (Esc or the arrow in a room, Q in the pause menu, Esc on a guest's results, ending a tournament early) asks first: a small popup says what will happen, with *Stay* and *Leave room* (Esc is *Stay*).

- The oni tags by touching another player. Grazing counts, and the server also accepts a touch against where the target was on the tagger's own screen, so lag does not rob you of a tag.
- The tagged player is frozen for 0.4 s so the tagger can get away, and the tagger cannot be tagged back for 1 s (they flash while protected). The oni runs slightly faster than everyone else.
- Players pass through each other.
- **Slopes** behave like tilted thin ledges: walk up and down them, jump up through them from below, hold down to drop through &ndash; or to walk under one from its low end.
- **Trampolines** launch you straight up; **launchers** (the pads with arrows) fling you up and across. **Updrafts** are columns of rising air: step in, let go and ride. **Thorns** sting: a short stun, and you are thrown back off them. There are few of them: a match gets a quarter of what an arena is drawn with, which in most arenas is none at all.
- **Portals** come in coloured pairs: step into one and you fly to its partner as a spark, in an unhurried arc over the map (the view flies with you), safe from tags until you arrive. A portal with a small arrow badge lets you press jump to drop out wherever you are.
- If you join while a round is running you watch it and play the next one.
- The player who opened the room is the host (picks the game, stage and rules; starts it). If they leave, the next player becomes host. A room reads like a match card: on the left what is played, each setting under its own name (format, game, stage, round time, lucky boxes); on the right who is in it, with Start underneath. Guests see the same card without the controls.
- A room starts **private**: only people with the code or the invite link get in (the share button beside the code copies the link, or opens the phone's share sheet). The host can make it an **open room** with the button in the corner, and then it shows up under Play in *Open rooms* for anyone to walk into until it is full.

### Lucky boxes

Boxes appear around the arena every few seconds. Touch one with empty hands and a reel spins low in the middle of the screen &ndash; big enough to see, clear of the action &ndash; then lands on your item and drops into your item tile. You hold one of:

| | |
|---|---|
| Swift | run much faster for 6 s |
| Spring | jump much higher for 7 s |
| Ward | blocks the next tag and knocks the oni back (the oni gets a burst of speed instead) |
| Frost | freezes the other side: a runner freezes the oni, the oni freezes every runner |
| Blast | a shockwave: everyone else on screen is hurled away and stunned |
| Swap | trade places with another player |
| Storm | everyone else moves in slow motion for 3.5 s |
| Goo | drop a puddle; the next player to step in it slips |

You hold one item at a time and choose when to use it. Items stop working (and boxes stop appearing) for the last 10 seconds of a round.

### Team Bomb

- Two teams, Sun (warm colours) and Moon (cool colours), up to 5 v 5. The sides belong to the room: the room shows who is on which, anyone can cross over (X, or the arrow next to their name), the host can move anybody and shuffle (Z), and nothing is redrawn between rounds or matches. Once a match or a tournament is on, the sides are locked.
- If one side is short, **bots fill in** for it: they play on the server like anyone else, and are marked BOT on the scoreboard.
- You can tell friend from foe at a glance: every name sits on a plate in its side's colour (white edge: your side; dark edge: theirs; your own is white), everyone stands in a ring of their side's colour, and each side's names sit beside its own score at the top (Sun on the left, Moon on the right, a small bomb next to whoever carries one).
- **Bombs.** One for every two players (1 to 5), handed out at GO starting with a random player of each team. A carrier gets rid of theirs by touching an **enemy** whose hands are free; team mates are safe and nobody carries two. The bombs burn for the whole round and all go off when the clock stops: each one scores 10 for the team that is *not* holding it.
- **Flags.** A flag is a spot on the map with a ring around it (there is one near each side's start). Stand in the ring and it fills with your colour: 2.5 s alone to take a free flag, twice that to turn an enemy one, faster with a team mate. With as many enemies as friends in the ring nothing moves. A flag in your colour pays your team 1 point every 5 seconds, whether you stay or not.
- So: the flags decide the round while it runs, and the bombs can turn it over in the last second.
- Items only hit the other team.

### Tournaments

- **Teams** (the default): Team Bomb every round, the sides stay together, points add up, and the last round counts double.
- **Free-for-all**: each round players are ranked by time spent as the oni &ndash; least is best &ndash; and score one point for every player they beat (9 down to 0 with ten players; equal times share the better place). Everyone who is **not** the oni at the buzzer gets 1 more. From round 2 the leader starts as the oni. A tie at the end is broken by less total time as the oni.
- Every second round has a twist: *Moon Gravity*, *Turbo* or *Item Frenzy*.
- **Every round can have its own arena and style.** The stage is shown as one picture per round - one match is simply one round - with a mark on the rounds with a twist and on the last one, which counts double. Pick a round to choose its style and arena; in the popup the tab *Every round* sets them all at once. A round left on Random gets a different arena from the round before.

## How it works

```
server.js            Express + Socket.io. Rooms, tournaments, and the real simulation of every match.
shared/              Code that runs on BOTH the server and the browser:
  config.js            every tunable number (speeds, jump, timers, items, team battle, tournament rules)
  physics.js           one player, one tick: movement, ledges, slopes, trampolines, launchers, updrafts, thorns, portals
  sim.js               the rules: who is it, tagging, lucky boxes and items, the team battle, scoring
  arenas.js            the maps, drawn as text
  nav.js, bots.js      route map of each arena and the computer players that use it
public/
  index.html, css/     menus (hanging scrolls on an ink landscape), heads-up display, results
  css/rooms.css        playing with others: Play, the room, and the popups over them (one spacing scale, one set of parts)
  js/main.js           menus: screens, keyboard navigation, Play, the room, the popups, results
  js/play.js           the match on screen: frame loop, heads-up display, minimap, game events
  js/spinner.js        the draw before each round
  js/demo.js           the live demos on the how-to-play page
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

- Everything that never moves &ndash; backdrop, platforms, slopes &ndash; is painted once into a picture of the whole arena. Each frame the part you can see is copied onto the screen, pixel for pixel, which is about the cheapest thing a browser can do.
- Only the moving things are drawn on top of that each frame: players, items, sparks. Anything fancy (glows, portals, name tags) is pre-rendered into small sprites.
- The heads-up display is ordinary HTML, updated ten times a second; only the countdown and the item reel are looked at every frame, and written when they change.
- Art styles are loaded only when a match needs them.
- On a large screen (from about 1700 x 940) the menus are laid out 1.2 times larger rather than left small in the middle; pictures inside them are painted at that size, so they stay sharp.
- If frames still take too long, the game drops ambient animation first and then the resolution of the moving layer.

## Changing things

- **Feel** &ndash; speeds, acceleration, jump, gravity, tag protection, item strength and timing are all in `shared/config.js`.
- **Maps** &ndash; `shared/arenas.js` holds every arena as a grid of characters (`#` solid, `=` ledge, `^` trampoline, `<` `>` launchers, `u` updraft, `x` thorns, letters for portal pairs, `*` lucky-box spots, `1`&ndash;`6` starts, `7` `8` team bases) plus a list of slopes and of the portals you can drop out of. Edit one or add another and it shows up in the lobby; the bots work out their own routes. `npm test` checks that every surface can be reached, that there is enough open ground, and that bots can play it. `/_map.html?arena=hills&open=1` draws an arena as a plan with its open stretches shaded.
- **New art style** &ndash; read `public/js/themes/README.md`, add a file next to the others and add it to `THEMES` in `shared/config.js`.

Set `DEBUG_NET=1` when starting the server to print input-buffer statistics after each round.

## Credits

Fonts are self-hosted copies from Google Fonts under the SIL Open Font License or Apache 2.0 (see `public/fonts/README.txt`). All artwork is drawn by code; there are no image or audio assets.
