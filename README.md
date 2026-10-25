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

## People

Every kingdom's capital releases one human every 10 seconds (`sim/population.ts`). Each one is a villager or a soldier, and the kingdom keeps the share of soldiers its slider asks for:

- too few soldiers: newcomers are born soldiers, and the villagers nearest the capital walk in, spend 3 seconds inside, and come out as soldiers;
- too many: the nearest soldiers walk in and come out as villagers.

People only walk inside their own borders, go around the castle rather than over it, and die if another kingdom takes the ground they stand on. Without a capital, no new humans arrive and nobody can switch role. Soldiers don't fight yet; troop numbers still work as before.

People use their own random stream (`W.prand`), so adding them didn't change anything else in the game. The match recordings below still pass unchanged.

## Resources

`sim/resources.ts` scatters resources over the map by terrain, so every region has its own advantage:

| Resource | Where | Per harvest | Harvests | Grows back |
|---|---|---|---|---|
| Healthy tree | dense in forests; some on grassland, hills, snow | 3 wood | 1 (felled to a stump) | 90 s |
| Dry, twiggy tree | savanna, desert, beaches, hills | 1 wood | 1 | 90 s |
| Rock | a little everywhere; plenty on hills and snow, most on and around mountains | 1 stone | 3 | 120 s |
| Copper | rare everywhere; most in deserts, some in mountains | 1 copper | 3 | 150 s |

Building on a plot clears what stood there. Villagers (`sim/population.ts`) work in a loop: pick a resource, walk to it, harvest, carry the load home above their head, store it in the capital, come back out and decide again. They lean toward whatever the kingdom has least of (counting loads already on the way), weighed against distance, and never claim a spot another villager has taken. Soldiers never gather; they patrol around the capital.

## The determinism test

`tests/determinism.test.ts` plays three scripted 5-minute matches on the simulation alone and compares fingerprints of the full game state (ownership, troops, buildings, roads, fires, attacks) every 20 seconds of game time against `tests/golden.json`. A pass means the game still plays exactly as it did when the file was recorded. It was first recorded from the original single-file version, and re-recorded when the map grew to 400×248 tiles.

If you change gameplay on purpose, the test will fail. That's expected. Re-record the golden file with:

```sh
UPDATE_GOLDEN=1 npm test
```
