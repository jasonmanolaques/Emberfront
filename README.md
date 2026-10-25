# Emberfront

A fast, arcade-paced browser territory war: settle open land with gold, then make alliances or send your soldiers to raid and conquer your neighbours, while every kingdom grows its own villages, farms, mines, towers and roads.

## Running it

```sh
npm install
npm run dev        # play at http://localhost:5173 with live reload
npm test           # simulation regression test (no browser needed)
npm run build      # type-check and build a static site into dist/
```

`dist/` can be hosted anywhere that serves static files (GitHub Pages, Netlify, itch.io). It uses relative paths, so it works from a subfolder.

## How the code is organised

```
src/
  core/      constants, colour/number helpers, seeded random & noise
  sim/       the game itself: map generation, territory, buildings, people, war & diplomacy, bots
  render/    camera, terrain & territory pixels, building, nature & people sprites, effects, frame drawing
  ui/        HUD, log & toasts, buildings panel, diplomacy & war chips, mouse/touch/keyboard input
  game.ts    connects the simulation to the screen (new game, spawn, player orders)
  main.ts    boot and the main loop
tests/       scripted matches checked against recorded results
```

**The one rule: `src/sim` never touches the page.** No `document`, no canvas, no `Math.random`. The simulation:

- runs in fixed 0.1 s ticks and gets all of its randomness from the map seed, so the same seed plus the same player orders always produce the same match;
- takes player actions only as **commands** (`queueCommand`), which are applied at the start of the next tick and re-checked there;
- reports what happened through **events** (`sim/events.ts`: tile changed, building placed, capital fell, …). Rendering and UI subscribe to these; with no subscribers (a server, a test) the simulation runs the same, just without visuals.

That split is what makes online multiplayer possible later: every browser runs the same simulation and only commands go over the network.

## How it looks

The simulation works in 2 pixels per tile (where people stand). The renderer draws everything at twice that detail (`K`, `RS`, `PS` in `core/constants.ts`): 4×4 pixels per tile, 16×16 per building plot, people 4×8. The camera works in these render pixels. Drawing never changes the simulation, so the look can change freely without touching the determinism test.

- **Terrain** (`render/terrain.ts`): a warm, slightly muted palette lit from the top-left; sea with wave dashes, a foam line and wet sand; grass tufts and the odd flower. Kingdoms get a double border: their colour on the edge and a paler line inside. Roads are two-pixel tracks with worn verges.
- **Sprites** (`render/sprites.ts`, `render/nature.ts`, `render/people.ts`) are hand-placed pixel art, many drawn from text grids (`render/pixel.ts`), and outlined automatically where they meet open ground, so towns and crowds stay readable. Buildings and trees are drawn once into layers; people are made once per look and stamped each frame.
- **People** face the way they walk and step as they go. Soldiers wear a tabard and helmet crest in their kingdom's colour and raise a spear, thrust forward on the tick they strike. Each figure is outlined in a dark shade of its kingdom's colour, so mixed crowds stay apart.

## Gold and strength

Each kingdom starts with 250 gold and earns 5 a second plus 0.1 a second in tax from each housed villager (soldiers, the homeless and beggars pay none); each coin minter adds 10% to the total. Clicking unclaimed land pushes the border there with gold from the treasury (the top slider sets how much each push takes): 1 gold a tile, more on rough ground. Unspent gold comes back when a push ends. Gold never buys another kingdom's land: that takes war (below). Raiders bring home 50 gold for each loot bag.

**Strength** is what the labels and leaderboard show: 1 per tile, 50 per villager, 100 per soldier and 3 per gold (`STR_*` in `core/constants.ts`). Beggars count for nothing.

## People

The capital releases one human every 10 seconds, 5% sooner per farm (`sim/population.ts`). Each one is a villager or a soldier, and the kingdom keeps the share of soldiers its slider asks for. Soldiers need a **barracks**: without one the slider is locked. With too few soldiers, newcomers are born soldiers at the barracks, and the villagers nearest a barracks walk in, spend 3 seconds inside, and come out as soldiers; with too many, the nearest soldiers walk in and come out as villagers.

Villagers gather (see below). Soldiers never gather: they wait in front of their barracks, or guard a watchtower that calls for them, until they are sent to war. People only walk inside their own borders (armies in the field aside), go around the castle rather than over it, and die if another kingdom takes the ground they stand on, or they fall in battle (soldiers have 10 hit points, villagers 4).

## Homes

Every person, villager or soldier, needs a home: one house each. Whenever the kingdom has fewer houses (counting ones being built) than people, a villager's next job is to build one, so a newcomer usually starts by building his own hovel before he goes to work. He picks the plot himself the way towns grow: beside other buildings and roads, outward from the edge of town, near the capital. He walks there carrying a plank, puts up a frame, works 4 seconds, and the hovel stands; new houses connect to the road network. If a house is already free (people died but their homes survived), a newcomer goes straight to work.

With more houses than people for 20 seconds, the spare ones stand empty and run down, the farthest from the capital first; as people arrive again, the innermost empty houses are lived in first (`sim/population.ts`). Land caps housing: once a kingdom's plots are full, new people stay homeless until it expands.

The people who have lived in the kingdom longest get the houses, so the newest arrivals are the homeless ones, and whoever has been homeless longest moves in first when a house comes free. Homeless villagers pay no tax. A villager homeless for a minute turns **beggar**: he crawls slowly about town in rags, does no work, pays no tax and can't be recruited, until a home comes free for him and he goes back to work. Homeless soldiers stay soldiers.

## Buildings

Houses are built by villagers (above). Everything else is placed by the kingdom from the buildings panel (the hammer button, or B) and paid for from its stockpile:

| Building | Cost (wood / stone / copper) | Does |
|---|---|---|
| Farm | 5 / 2 / 0 | New humans arrive 5% sooner per farm |
| Barracks | 5 / 5 / 0 | Trains soldiers and is where they wait; needed to raise an army |
| Watchtower | 2 / 5 / 1 | At war, shoots the nearest enemy soldier in range, or else the nearest enemy villager (1 damage every 1.5 s). Click it to toggle **!**: it then calls 5 idle soldiers to guard it. Several calling towers share the idle soldiers out one at a time in the order they called, so 5 soldiers for 2 towers go 3 and 2 |
| Coin minter | 5 / 5 / 5 | +10% gold income |
| Plantation | 10 / 0 / 0 | 2×2 plots. Four saplings grow into trees over 30 s, then +5 wood |
| Stone quarry | 3 / 5 / 0 | 2×2 plots. A pulley hauls stone out of the pit: +3 stone every 30 s |
| Copper mine | 10 / 10 / 0 | 2×1 plots. A shaft glowing orange: +2 copper every 30 s |

Buildings run by themselves; none need workers. They are modular: a plot draws itself from its four neighbours, so fields of farms merge into one farmland with a single fence round the outside, barracks and minters next to each other become one long hall, and neighbouring watchtowers are joined by walls (`render/sprites.ts`). The production buildings cover several plots (the top-left plot holds the building, the rest point to it); if any of their plots is taken, the whole building burns. Bots build with simple priorities of their own (`sim/bots.ts`).

## Diplomacy and war

Clicking another kingdom's land opens diplomacy (`ui/diplomacy.ts`, `sim/war.ts`):

- **Alliance.** A bot agrees unless it has 3 allies already, you attacked it in the last 90 seconds, or you are less than 0.4 of its strength. Allies are named in green, on the map and the leaderboard, and open their land to each other's armies. Declaring war on an ally ends the alliance.
- **War.** A second screen picks how many soldiers go, from none to every soldier you have free: idle soldiers at the barracks first, then watchtower guards (a warning says when guards will leave their posts). Then choose:
  - **Raid**: needs a way to the target over unclaimed or allied land, so it works on kingdoms you don't border. The raiders burn buildings from the outskirts toward the centre. A raider who destroys one carries a loot bag (one each) and keeps raiding; if he gets it home it pays 50 gold. If other kingdoms close every way through, the raid turns back.
  - **Attack**: needs a shared border. The army takes the enemy's ground as it marches (burning what stands there and killing villagers on it), knocks down watchtowers in its way, and pushes for the capital. Ground a defending soldier stands on can't be taken. Breaking the castle (400 blows) **annexes** the kingdom: its land, buildings and people become yours, and its gold and stockpile are lost.

Two kingdoms are **at war** while an army between them is still fighting, and only then do soldiers fight and watchtowers shoot. Each war has a button at the top of the screen: for a raid it calls the raiders home (they avoid fights on the way, striking back only at whoever is on them); for a war it keeps fighting but offers peace. Bots weigh an offer by how the war is going (armies, land won or lost, how long it has lasted): they refuse while they think they can win and accept when they are in trouble. Bots also offer peace when they are losing; the button then accepts it. A war also ends when one side's army is gone.

**Soldiers in the field** muster in a line behind a banner on their own border, then march in formation. The banner waits for stragglers and for fights to finish, but not for ever. Soldiers break off for enemies near the line (sooner one fighting a comrade), watchtowers shooting at them, and, on a raid, buildings to burn, then fall back into line. In melee a soldier strikes every 0.8 s, hitting 70% of the time for 2.

**At home**, soldiers at war fight enemies who come near their watchtower or barracks, sooner those attacking buildings or people, without leaving their own land. When an enemy army closes on the capital, every soldier not on guard rallies to it, and the castle shoots like a strong watchtower.

**Bots** go to war when they have free soldiers to spare, choosing the weakest kingdom in reach (one already beset by two armies is left alone), attacking a neighbour or raiding one further off. They rest between campaigns, bring raids home when they have bled too much or been at it long enough, and sue for peace when a war goes badly.

## Resources

`sim/resources.ts` scatters resources over the map by terrain, so every region has its own advantage. **Nothing grows back**: once an area is stripped, a kingdom has to expand to find more.

| Resource | Where | Per harvest | Harvests |
|---|---|---|---|
| Healthy tree | dense in forests; some on grassland, hills, snow | 1 wood | 1 (felled to a stump) |
| Dry, twiggy tree | savanna, desert, beaches, hills | 1 wood | 1 |
| Rock | a little everywhere; plenty on hills and snow, most on and around mountains | 1 stone | 3 |
| Copper | rare everywhere; most in deserts, some in mountains | 1 copper | 3 |

Building on a plot clears what stood there. Villagers work in a loop: pick a resource, walk to it, harvest, carry the load home above their head, store it in the capital, come back out and decide again. They lean toward whatever the kingdom has least of (counting loads already on the way), weighed against distance, and never claim a spot another villager has taken.

## The determinism test

`tests/determinism.test.ts` plays three scripted 5-minute matches on the simulation alone and compares fingerprints of the full game state (ownership, troops, buildings, roads, fires, attacks) every 20 seconds of game time against `tests/golden.json`. A pass means the game still plays exactly as it did when the file was recorded. It was first recorded from the original single-file version, and re-recorded when the map grew to 400×248 tiles, when gold replaced troops, when the ocean shrank, and when war replaced buying enemy land (it now fingerprints the armies in the field too).

If you change gameplay on purpose, the test will fail. That's expected. Re-record the golden file with:

```sh
UPDATE_GOLDEN=1 npm test
```
