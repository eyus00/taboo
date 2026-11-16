# Onigokko

*Onigokko* (鬼ごっこ) is Japanese for tag; whoever is it is the *oni*. This is real-time multiplayer tag for 2&ndash;10 players, in the browser. Everyone plays on their own device. **Host** a room, walk into one that is **open** to everyone, or type the 4-digit code of a friend's (an invite link works too). Bots take the seats nobody has, so a room is a game from the moment it opens &ndash; alone, or with friends walking in.

- **Three ways to play.** *Hot Potato* (whoever is the oni when the clock hits zero loses), *Least Time* (every second as the oni counts against you), and *Team Bomb* (two teams, flags to hold, and bombs that go off at the buzzer). Any of them as *Quick Play* (one round) or a tournament of 3, 5 or 7 rounds.
- **Lucky boxes.** Touch one and you get a random item to keep: set it off when it hurts most. Eleven of them, and several turn a round over: a Quake that throws everyone else into the air wherever they are, a Warp that drops the oni next to the nearest runner (or carries a runner far away), an Eclipse that leaves everyone else in the dark, a Dash that shoots you six tiles ahead in a fifth of a second, a Blast, a Swap, a Storm, Frost, Ward, Swift and Spring. A new box every 3 seconds, and they work right up to the buzzer.
- **Close-up camera** that follows you, with big characters, a minimap (bottom right; under the menu button on a phone) of the whole arena, and **pointers at the edge of the screen** for every player out of sight: their colour, aimed at where they are, the oni's bigger and marked IT (in a team game, the side's colour and who carries a bomb). Each round opens on the whole arena, then zooms in on you.
- **A display you can read at a glance**: everything about the score is in one block at the top in the middle &ndash; the clock, large, and in a team game each side's score, its bombs, its flag and its players right beside it, the two halves mirror images of each other (a white line under a plate says which side is yours). Under the round's name, tags stay up for the whole round: the tournament round, the round's twist (Moon Gravity, Turbo, Item Frenzy) and, in the last round, *&times;2 points* &ndash; lit up while the round is about to begin. What you are holding is at the bottom in the middle, the map bottom right. Before GO a card says only the game and what you are this round ("You are the oni", "You start with a bomb"), and who carries what already shows over the characters. How to score (and the keys, in your first matches) is a small list of objectives in the corner; a bar runs down on it and it closes by itself &ndash; O, or a tap, opens it again. Players out of sight have sharp little pointers at the edge of the screen.
- **Movement with weight**: you build up speed, skid when you turn round, and jump in a floaty arc. Every press of jump counts, however fast you hammer the key (one jump from the ground, one more in the air). Five actions &ndash; left, right, jump, down, use item.
- **Nine stages with room to run, in two sizes**: six for 2&ndash;6 players (Bounce Hills, Windy Canyon, Sky Pagoda, Switchback, Twin Keeps, Bramble Maze) and three with 1.75 times the room for 5&ndash;10 (Great Valley, Storm Gorge, Sky Halls). Each is built around long stretches of plain open ground (at least four of 14 tiles or more, one of them 24 or more), with the slopes, trampolines, launchers, updrafts and portals at the ends and edges instead of in the way. A portal flies you over the map in an arc, and some let you drop out half way.
- **A draw before every round**: three picture cards spin for the arena (shown in that round's style), the art style, and who starts as the oni (their character, in their colour) &ndash; in a team game, everyone who starts with a bomb, side by side.
- **Seven art styles**: Ink & Sakura (the house style), Orbit, Xeno, Neon District, Nightmare, Sketchbook and Arcade.
- **Bots in the empty seats.** A room has a number of seats (2 to 10, six to begin with) and starts with a bot in every one nobody has. A bot gives its seat to anyone who walks in. The host decides seat by seat: take a bot out (its seat stays open for a friend), put one into an open seat, fill every open seat or clear all the bots at once, add or remove seats, send a player out. In a team game the host can move anyone across, bots included, and a shuffle deals everybody out afresh.
- Menus drawn like a game: brush lettering on hanging scrolls. The title scroll stays on the left and whatever you open hangs beside it; small popups (open rooms, your profile, the "about" panels, questions) are laid over that like sheets of paper. A how-to-play page where every picture is the real game playing itself. Everything works with the keyboard alone, and every control shows its key; phones get on-screen controls and a built-in number pad for the room code.
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
| Title screen | 1 play, 2 your name, H how to play |
| Play | C host a room, P look through the open rooms (a popup: filter by game, or only rooms waiting to start), or type the four digits of a room's code (the fourth joins) |
| In a room | G Quick Play or a tournament, R which game, N how many rounds (tournament), S next style, A next stage (Shift goes back), T which round of a tournament the style and stage are for, L round time, P lucky boxes, &minus; and + how many seats, B a bot in every open seat (or, when none is open, every bot out), X change sides, Z shuffle the sides (host), Enter start; also C copy the invite link and V public or private |
| In a match | O the objectives, Esc pause menu; there: Esc resume, H how to play, M sound, F full screen, Q leave |
| Results | Enter play again, Esc back |

Anything that would take you out of a game (Esc or the cross in a room, Q in the pause menu, Esc on a guest's results, ending a tournament early) asks first: a small popup asks, with *Stay* (Esc) and *Leave* (Enter).

- The oni tags by touching another player. Grazing counts, and the server also accepts a touch against where the target was on the tagger's own screen, so lag does not rob you of a tag.
- The tagged player is frozen for 0.3 s so the tagger can get away, and the tagger cannot be tagged back for 0.7 s (they flash while protected). The oni runs 10% faster than everyone else. A tag or a bomb pass somewhere else on the map sounds quieter the further away it is.
- Players pass through each other.
- **Slopes** behave like tilted thin ledges: walk up and down them, jump up through them from below, hold down to drop through &ndash; or to walk under one from its low end.
- **Trampolines** launch you straight up; **launchers** (the pads with arrows) fling you up and across. **Updrafts** are columns of rising air: step in, let go and ride. **Thorns** sting: a short stun, and you are thrown back off them. There are few of them: a match gets a quarter of what an arena is drawn with, which in most arenas is none at all.
- **Portals** come in coloured pairs: step into one and you fly to its partner as a spark, in an unhurried arc over the map (the view flies with you), safe from tags until you arrive. A portal with a small arrow badge lets you press jump to drop out wherever you are.
- If you join while a round is running you watch it and play the next one.
- The player who opened the room is the host (picks everything and starts it). If they leave, the next player becomes host.
- **The room.** Along the top, left to right: *Room*, its code, a share button (copies the invite link, or opens the phone's share sheet), and who may come in (a lock and *Private*, or a globe and *Public*); the way out is on the right. Under that, two tabs: **Quick Play** or **Tournament**. They are set up separately and each remembers its own game, style and stage. On the left, in this order: the game, the art style (one row of pictures, Random first), the stage (a grid of pictures, Random first), round time and lucky boxes. On the right: the players, one row a seat &ndash; a person, a bot, or an open seat &ndash; with what can be done about each at the end of its row, and Start underneath. Nothing changes size as you choose: the list is always as tall as ten seats, and Start stays where it is. The small (i) beside a heading opens a panel that shows and explains every game, style, stage or item. Guests see what was chosen, without the controls.
- A room starts **private**: only people with the code or the invite link get in. Made **public**, it shows up under Play in *Open rooms* for anyone to walk into until every seat has a person in it.
- **Stages come in two sizes.** The six smaller ones are for 2&ndash;6 players, the three big ones for 5&ndash;10. A stage that does not suit the number of players is shut (its card says for how many it is), and one that was chosen goes back to Random when the room outgrows it.
- **What Random draws from is yours to say.** While Random is the choice, every stage (and every style) has a tick in the corner of its picture: take one out of the draw, or put it back. Random then only draws from the ones left in (and from the stages that suit the number of players).
- **When it is over** one card says it all: on the left your own character under the seal (or the first three on a podium), with rays turning and petals flying for a winner; beside it the verdict in two words &ndash; *You win!* or *You lose* &ndash; a line about how you played, and your own numbers as a few small tags; under that the scoreboard; and at the foot the way back and the way on. Between the rounds of a tournament a tag there counts down to the next one.

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
| Quake | everyone else, wherever they are, is thrown into the air and stunned for 1.3 s |
| Warp | the oni (or a bomb carrier) lands beside the nearest runner; a runner lands as far from danger as the arena allows |
| Eclipse | night for everyone else: for 4 s they see only a small circle around themselves, and their minimap and pointers go dark |
| Dash | shoot straight ahead: six tiles in a fifth of a second, on the ground or through the air (a wall stops it) |

You hold one item at a time and choose when to use it. Boxes keep coming, and items keep working, right up to the buzzer.

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
- **Style and stage, round by round.** The *Round plan* row says which rounds a choice is for: every round, or one of them. A round left on Random gets a different stage from the round before.

## How it works

```
server.js            Express + Socket.io. Rooms (people and the bots in the empty seats), tournaments, and the real simulation of every match.
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
  js/local.js          a match against bots in the browser alone (not in any menu: the automated checks use it, as __tag.practice())
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
