# Emberfront

A fast, arcade-paced browser territory war: click land to push your border with a share of your troops, while every kingdom grows its own villages, farms, mines, towers and roads.

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
  sim/       the game itself: map generation, territory & combat, troops, buildings, people, bots
  render/    camera, terrain & territory pixels, building sprites, effects, frame drawing
  ui/        HUD, log & toasts, mouse/touch/keyboard input
  game.ts    connects the simulation to the screen (new game, spawn, player orders)
  main.ts    boot and the main loop
tests/       scripted matches checked against recorded results
```

**The one rule: `src/sim` never touches the page.** No `document`, no canvas, no `Math.random`. The simulation:

- runs in fixed 0.1 s ticks and gets all of its randomness from the map seed, so the same seed plus the same player orders always produce the same match;
- takes player actions only as **commands** (`queueCommand`), which are applied at the start of the next tick and re-checked there;
- reports what happened through **events** (`sim/events.ts`: tile changed, building placed, capital fell, …). Rendering and UI subscribe to these; with no subscribers (a server, a test) the simulation runs the same, just without visuals.

That split is what makes online multiplayer possible later: every browser runs the same simulation and only commands go over the network.

## Gold and strength

Each kingdom starts with 250 gold and earns 5 a second plus 0.1 a second in tax from each villager (soldiers pay none); each coin minter adds 10% to the total. Pushing the border spends gold from the treasury (the top slider sets how much each push takes): settling unclaimed land costs 1 gold a tile, and another kingdom's land costs more the stronger it is for its size, and 1.5× near its watchtowers. Unspent gold comes back when a push ends, and the defender loses some gold on every tile taken. Losing your capital loses a quarter of your gold.

**Strength** is what the labels and leaderboard show: 1 per tile, 50 per villager, 100 per soldier and 3 per gold (`STR_*` in `core/constants.ts`).

## People

The capital releases one human every 10 seconds, 5% sooner per farm (`sim/population.ts`). Each one is a villager or a soldier, and the kingdom keeps the share of soldiers its slider asks for. Soldiers need a **barracks**: without one the slider is locked. With too few soldiers, newcomers are born soldiers at the barracks, and the villagers nearest a barracks walk in, spend 3 seconds inside, and come out as soldiers; with too many, the nearest soldiers walk in and come out as villagers.

Villagers gather (see below). Soldiers never gather: they wait in front of their barracks, or guard a watchtower that calls for them. People only walk inside their own borders, go around the castle rather than over it, and die if another kingdom takes the ground they stand on, or a watchtower brings them down (soldiers have 10 hit points).

## Homes

Every person, villager or soldier, needs a home: one house each. Whenever the kingdom has fewer houses (counting ones being built) than people, a villager's next job is to build one, so a newcomer usually starts by building his own hovel before he goes to work. He picks the plot himself the way towns grow: beside other buildings and roads, outward from the edge of town, near the capital. He walks there carrying a plank, puts up a frame, works 4 seconds, and the hovel stands; new houses connect to the road network. If a house is already free (people died but their homes survived), a newcomer goes straight to work.

With more houses than people for 20 seconds, the spare ones stand empty and run down, the farthest from the capital first; as people arrive again, the innermost empty houses are lived in first (`sim/population.ts`). Land caps housing: once a kingdom's plots are full, new people stay homeless until it expands.

## Buildings

Houses are built by villagers (above). Everything else is placed by the kingdom from the buildings panel (the hammer button, or B) and paid for from its stockpile:

| Building | Cost (wood / stone / copper) | Does |
|---|---|---|
| Farm | 5 / 2 / 0 | New humans arrive 5% sooner per farm |
| Barracks | 5 / 5 / 0 | Trains soldiers and is where they wait; needed to raise an army |
| Watchtower | 2 / 5 / 1 | Shoots the nearest enemy soldier in range (1 damage every 1.5 s); land around it costs 1.5× to take. Click it to toggle **!**: it then calls 5 idle soldiers to guard it. Several calling towers share the idle soldiers out one at a time in the order they called, so 5 soldiers for 2 towers go 3 and 2 |
| Coin minter | 5 / 5 / 5 | +10% gold income |

Buildings run by themselves; none need workers. They are modular: a plot draws itself from its four neighbours, so fields of farms merge into one farmland with a single fence round the outside, barracks and minters next to each other become one long hall, and neighbouring watchtowers are joined by walls (`render/sprites.ts`). Bots build with simple priorities of their own (`sim/bots.ts`).

## Resources

`sim/resources.ts` scatters resources over the map by terrain, so every region has its own advantage. **Nothing grows back**: once an area is stripped, a kingdom has to expand to find more.

| Resource | Where | Per harvest | Harvests |
|---|---|---|---|
| Healthy tree | dense in forests; some on grassland, hills, snow | 3 wood | 1 (felled to a stump) |
| Dry, twiggy tree | savanna, desert, beaches, hills | 1 wood | 1 |
| Rock | a little everywhere; plenty on hills and snow, most on and around mountains | 1 stone | 3 |
| Copper | rare everywhere; most in deserts, some in mountains | 1 copper | 3 |

Building on a plot clears what stood there. Villagers work in a loop: pick a resource, walk to it, harvest, carry the load home above their head, store it in the capital, come back out and decide again. They lean toward whatever the kingdom has least of (counting loads already on the way), weighed against distance, and never claim a spot another villager has taken.

## The determinism test

`tests/determinism.test.ts` plays three scripted 5-minute matches on the simulation alone and compares fingerprints of the full game state (ownership, troops, buildings, roads, fires, attacks) every 20 seconds of game time against `tests/golden.json`. A pass means the game still plays exactly as it did when the file was recorded. It was first recorded from the original single-file version, and re-recorded when the map grew to 400×248 tiles, when gold replaced troops, and when the ocean shrank.

If you change gameplay on purpose, the test will fail. That's expected. Re-record the golden file with:

```sh
UPDATE_GOLDEN=1 npm test
```
