# Onigokko

*Onigokko* (鬼ごっこ) is Japanese for tag; whoever is it is the *oni*. This is real-time multiplayer tag for 2&ndash;10 players, in the browser. Everyone plays on their own device. **Host** a room, walk into one that is **open** to everyone, or type the 4-digit code of a friend's right on the title screen (an invite link works too). Bots take the seats nobody has, so a room is a game from the moment it opens &ndash; alone, or with friends walking in.

- **Three ways to play.** *Hot Potato* (whoever is the oni when the clock hits zero loses), *Least Time* (every second as the oni counts against you), and *Team Bomb* (two teams, three flags to hold, and bombs that go off at the buzzer). Any of them as *Quick Play* (one round), or a **tournament**: a *Knockout* in which the oni at the buzzer goes out, round after round, until one player is left standing &ndash; or Team Bomb over 3, 5 or 7 rounds.
- **Lucky boxes.** Touch one and you get a random item to keep: set it off when it hurts most. Thirteen of them, and several turn a round over: a Quake that throws everyone else into the air wherever they are, a Warp that drops the oni next to the nearest runner (or carries a runner far away), an Eclipse that leaves everyone else in the dark, a Dash that shoots you six tiles ahead in a fifth of a second, **Vanish** (nobody else can see you for five seconds), **Titan** (nothing can touch you for four), a Blast, a Swap, a Storm, Frost, Ward, Swift and Spring. A new box every 3 seconds, and they work right up to the buzzer. The host chooses which of them are in the boxes, and resting the pointer on an item in the room opens a card with that item's demo playing.
- **Close-up camera** that follows you, with big characters, a minimap (bottom right; under the menu button on a phone) of the whole arena, and **pointers at the edge of the screen** for every player out of sight: their colour, aimed at where they are, the oni's bigger and marked IT (in a team game, the side's colour and who carries a bomb). Each round opens on the whole arena, then zooms in on you.
- **A display you can read at a glance**: everything about the score is in one block at the top in the middle &ndash; the clock, large, and in a team game each side's score, its bombs and its players right beside it, the two halves mirror images of each other (a white line under a plate says which side is yours), with the three flags A B C underneath in the order they stand on the map. Under that, tags stay up for the whole round: the tournament round, how many are still in a knockout, the round's twist (Moon Gravity, Turbo, Item Frenzy) and, in the last round of a team tournament, *&times;2 points* &ndash; lit up while the round is about to begin. What you are holding is at the bottom in the middle, the map bottom right. Before GO a card says only the game and what you are this round ("You are the oni", "You start with a bomb"), and who carries what already shows over the characters. How to score (and the keys, in your first matches) is a small list of objectives in the corner; a bar runs down on it and it closes by itself &ndash; O, or a tap, opens it again. Players out of sight have sharp little pointers at the edge of the screen.
- **Movement with weight, and fast**: you build up speed, skid when you turn round, and jump in a floaty arc. A run covers a little over nine tiles a second. Every press of jump counts, however fast you hammer the key (one jump from the ground, one more in the air). Five actions &ndash; left, right, jump, down, use item.
- **Eleven stages with room to run, in three sizes**: two *duel* stages for 2&ndash;4 players (Tea Court, Lantern Bridge: quick to cross, with hardly any toys &ndash; a knockout ends on them), six for 2&ndash;6 (Bounce Hills, Windy Canyon, Sky Pagoda, Switchback, Twin Keeps, Bramble Maze) and three big ones with about twice the room for 5&ndash;10 (Great Valley, Storm Gorge, Sky Halls), watched from a little further off so that ten players are busy but readable. Each is built around long stretches of plain open ground, with floors an easy double jump apart all the way up (five tiles on the big stages) &ndash; in the middle of the map as much as at its ends &ndash; and the slopes, trampolines, launchers, updrafts and portals at the ends and edges instead of in the way. Portals and pads are kept well apart: no portal stands where a trampoline, a launcher or an updraft puts you down. A portal flies you over the map in an arc, and some let you drop out half way.
- **The draw is part of the opening**: the stage (shown in that round's style), the art style, and who starts as the oni are all revealed in the scene before the round &ndash; see *Every round is an occasion* below.
- **Six art styles**: Ink & Sakura (the house style), Shadow (a black night in white steel, where the players are blocks: a ninja's hooded head and nothing under it, gliding along the ground and turning over and over in the air), Neon District, Nightmare, Sketchbook and Arcade.
- **Bots in the empty seats.** A room has a number of seats (2 to 10, six to begin with) and starts with a bot in every one nobody has. A bot gives its seat to anyone who walks in. The host decides seat by seat: take a bot out (its seat stays open for a friend), put one into an open seat, fill every open seat or clear all the bots at once, add or remove seats, send a player out. In a team game the host can move anyone across, bots included, and a shuffle deals everybody out afresh.
- Menus drawn like a game: brush lettering on hanging scrolls. The title scroll stays on the left &ndash; **Host**, the globe for open rooms, and four squares for a friend's code &ndash; and whatever you open hangs beside it; small popups (open rooms, your name, the "about" panels, questions) are laid over that like sheets of paper. A how-to-play page where every picture is the real game playing itself. Everything works with the keyboard alone, and every control shows its key; phones get on-screen controls and a built-in number pad for the room code.
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
| Title screen | C host a room, P look through the open rooms (a popup: filter by game, or only rooms waiting to start), 0&ndash;9 type a room's code (the fourth digit joins), N your name, H how to play |
| In a room | G Quick Play or Tournament, R which game, N how many rounds (a team tournament), S next style, A next stage (Shift goes back), T which round of a tournament the style and stage are for, L round time, P lucky boxes, &minus; and + how many seats, B a bot in every open seat (or, when none is open, every bot out), X change sides, Z shuffle the sides (host), Enter start; also C copy the invite link and V public or private |
| In a match | O the objectives, Esc pause menu; there: Esc resume, H how to play, M sound, F full screen, Q leave |
| Results | Enter play again, Esc back |

Anything that would take you out of a game (Esc or the cross in a room, Q in the pause menu, Esc on a guest's results, ending a tournament early) asks first: a small popup asks, with *Stay* (Esc) and *Leave* (Enter).

- The oni tags by touching another player. Grazing counts, and the server also accepts a touch against where the target was on the tagger's own screen, so lag does not rob you of a tag.
- The tagged player is frozen for 0.3 s so the tagger can get away, and the tagger cannot be tagged back for 0.7 s (they flash while protected). The oni runs 10% faster than everyone else. A tag or a bomb pass somewhere else on the map sounds quieter the further away it is.
- Players pass through each other.
- **Slopes** behave like tilted thin ledges: walk up and down them, jump up through them from below, hold down to drop through &ndash; or to walk under one from its low end.
- **Trampolines** launch you straight up; **launchers** (the pads with arrows) fling you up and across. **Updrafts** are columns of rising air: step in, let go and ride. **Thorns** sting: a short stun, and you are thrown back off them. There are few of them: a match gets a quarter of what an arena is drawn with, which in most arenas is none at all.
- **Portals** come in coloured pairs: step into one and you fly to its partner as a spark, in an unhurried arc over the map (the view flies with you), safe from tags until you arrive. A portal only takes someone whose feet have been on the ground for a moment (under a tenth of a second): come down in or beside one off a jump or a pad and nothing happens &ndash; there is time to step away. A portal with a small arrow badge lets you press jump to drop out wherever you are.
- If you join while a round is running you watch it and play the next one (in a knockout: the next tournament).
- The player who opened the room is the host (picks everything and starts it). If they leave, the next player becomes host.
- **The room.** Along the top, left to right: *Room*, its code, a share button (copies the invite link, or opens the phone's share sheet), and who may come in (a lock and *Private*, or a globe and *Public*); the way out is on the right. Under that one switch: **Quick Play | Tournament**. Both are laid out exactly alike, so nothing moves when you flip it; each remembers its own game, style and stage. On the left, top to bottom: the game; a narrow rail of round numbers (one round in Quick Play; *All* and 1, 2, 3&hellip; in a tournament) beside the art style (one row of pictures, Random first) and the stage (a grid of pictures, Random first: only the stages that suit the number of players are shown); lucky boxes, with a small button for each of the thirteen items; round time. On the right: the players, one row a seat &ndash; a person, a bot, or an open seat (Invite, then + Bot) &ndash; with what can be done about each at the end of its row, and Start underneath. Nothing changes size as you choose: the list is always as tall as ten seats, and Start stays where it is. The small (i) beside a heading opens a panel that shows and explains every game, style, stage or item.
- **Guests get a match card** instead of the controls: the game and what it asks of you in one line, big pictures of the style and the stage, the round time, how many rounds, which items are in the boxes &ndash; and, in a tournament, the plan round by round. It follows every choice the host makes.
- **From one room to another.** The code squares on the title scroll go on working while you are in a room: type another room's code (digits go in from anywhere in the room) and a question asks *Go to room 1234?* before anything happens &ndash; *Stay* or *Change rooms*. If that room is not there, or full, you stay where you are. On a narrow screen, where the title scroll is not beside the room, a key in the room's top bar (on a phone: a line under the players) opens a small sheet for the code.
- A room starts **private**: only people with the code or the invite link get in. Made **public**, it shows up in *Open rooms* (the globe on the title screen) for anyone to walk into until every seat has a person in it.
- **Stages come in three sizes.** Two duel stages for 2&ndash;4 players, six for 2&ndash;6 and three big ones for 5&ndash;10. The room only offers the ones that suit the number of players (a line under them says how many more there are for other numbers), and one that was chosen goes back to Random when the room outgrows it.
- **What Random draws from is yours to say.** While Random is the choice, every stage (and every style) has a small round tick in the corner of its picture: take one out of the draw, or put it back. Random then only draws from the ones left in (and from the stages that suit the number of players). The same goes for the lucky boxes: tap an item's button to take it out of the boxes or put it back; the reel of a box then only rolls through what is in. Point at an item (or bring the keyboard's focus to it) and a card opens over it: its name, what it does, and the How to play demo of it, playing. Guests get the same card from the row of icons on their match card.
- **Every round is an occasion.** Before a round one scene plays over everything: the players come on face to face &ndash; the two teams from either side of a split screen with VS between them, two players alone for a duel, or everyone in a line under *All VS All* &ndash; with the round's billing over them (*Round 2 of 5* and where the sides stand, *Semi-final*, a golden *The Final*, *Tie-break*). In the same picture the draw is shown: the stage and the art style on two plates at the foot, and who starts as the oni &ndash; a light runs along the players and stops on them (in a team game, whoever starts with a bomb is stamped). Then 3-2-1. After a round the results card opens with the word for it across its head &ndash; *Victory*, *Defeat*, *Round won*, *Through*, *Knocked out*, *Champions* &ndash; over whoever won, each with their own numbers (and, in a knockout, whoever went out), with the score and what comes next (*Next: the Final*); the scoreboard is right under it on the same card. The opening is built while the match is being set up and only starts to move once the page is quiet, moves nothing but transforms and opacity, and the match behind it is not drawn while it covers the screen. With reduced motion switched on in the system, the opening is not shown.
- **When it is over** one card says it all: the head of the card (the word for the result, the winners with their numbers, the score), the scoreboard under it, and at the foot the way back and the way on. Between the rounds of a tournament a tag there counts down to the next one.

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
| Vanish | for 5 s nobody on the other side can see you: no body, no name, no dot on the map, no pointer. You see yourself as a faint shape (so does your own team). A touch still counts, both ways |
| Titan | for 4 s nothing touches you: no tag, no bomb, no item, no thorns &ndash; and a Storm or an Eclipse already on you is shaken off |

You hold one item at a time and choose when to use it. Boxes keep coming, and items keep working, right up to the buzzer.

### Team Bomb

- Two teams, Tigers (warm colours) and Dragons (cool colours), up to 5 v 5. The sides belong to the room: the room shows who is on which, anyone can cross over (X, or the arrow next to their name), the host can move anybody and shuffle (Z), and nothing is redrawn between rounds or matches. Once a match or a tournament is on, the sides are locked.
- If one side is short, **bots fill in** for it: they play on the server like anyone else, and are marked BOT on the scoreboard.
- You can tell friend from foe at a glance: every name sits on a plate in its side's colour (white edge: your side; dark edge: theirs; your own is white), everyone stands in a ring of their side's colour, and each side's names sit beside its own score at the top (Tigers on the left, Dragons on the right, a small bomb next to whoever carries one).
- **Bombs.** One for every two players (1 to 5), handed out at GO starting with a random player of each team. A carrier gets rid of theirs by touching an **enemy** whose hands are free; team mates are safe and nobody carries two. The bombs burn for the whole round and all go off when the clock stops.
- **Flags.** A flag is a spot on the map with a ring around it. There are three: A near the Tigers' start, C near the Dragons', and B high up in the very middle &ndash; as far from one end as from the other, and the one worth fighting over. Stand in the ring and it fills with your colour: 2.5 s alone to take a free flag, twice that to turn an enemy one, faster with a team mate. With as many enemies as friends in the ring nothing moves.
- **Points.** What counts is the buzzer: every flag gives the team whose colour it is 20 points, and every bomb that goes off gives the *other* team 20. While the round runs only a little moves, to keep everyone at it: every 6 seconds a flag gives its team 1 point (a *+1* rises from it) and a bomb takes 1 off the team holding it (a *&minus;1* over its carrier; never below nothing), and the team's plate on the board jumps with it.
- Items only hit the other team.

### Tournaments

- **Knockout** (everyone for themselves): Hot Potato, round after round. Whoever is the oni at the buzzer is out and watches the rest; everyone else plays the next round. With *n* players that is *n* &minus; 1 rounds, and the last one standing wins. The stages shrink with the field: the big ones while there are many, then the small ones, and the last rounds on the duel stages. The board says how many are left; the results list who went out in which round.
- **Team Bomb**: the sides stay together over 3, 5 or 7 rounds, and the host chooses how it is decided (*Winner by*, in the room). **Rounds won**: whoever wins a round gets a point (a drawn round: nobody does), and the last round is worth two. **Total points**: everything the sides score is added up, the last round double. Level at the end? A tie-break round is played, until one side is ahead.
- Every second round has a twist: *Moon Gravity*, *Turbo* or *Item Frenzy*.
- **Style and stage, round by round.** The rail of round numbers says which rounds a choice is for: *All*, or one of them. A round left on Random gets a different stage from the round before.

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
  js/present.js        the opening before each round (players, stage, style, who is the oni) and the head of the results card
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
- **Maps** &ndash; `shared/arenas.js` holds every arena as a grid of characters (`#` solid, `=` ledge, `^` trampoline, `<` `>` launchers, `u` updraft, `x` thorns, letters for portal pairs, `*` lucky-box spots, `1`&ndash;`6` starts, `7` `8` the flags at the two ends, `9` the flag in the middle) plus a list of slopes and of the portals you can drop out of, and says how many players it is meant for. Edit one or add another and it shows up in the room; the bots work out their own routes. `npm test` checks that every surface can be reached, that there is enough open ground, that no portal stands where a pad or an updraft puts you down, that the middle flag is as far from one end as from the other, and that bots can play it. `/_map.html?arena=hills&open=1` draws an arena as a plan with its open stretches shaded.
- **New art style** &ndash; read `public/js/themes/README.md`, add a file next to the others and add it to `THEMES` in `shared/config.js`.

Set `DEBUG_NET=1` when starting the server to print input-buffer statistics after each round.

## Credits

Fonts are self-hosted copies from Google Fonts under the SIL Open Font License or Apache 2.0 (see `public/fonts/README.txt`). All artwork is drawn by code; there are no image or audio assets.
