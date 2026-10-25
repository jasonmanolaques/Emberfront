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
  sim/       the game itself: map generation, territory & combat, troops, buildings, bots
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

## The determinism test

`tests/determinism.test.ts` plays three scripted 5-minute matches on the simulation alone and compares fingerprints of the full game state (ownership, troops, buildings, roads, fires, attacks) every 20 seconds of game time against `tests/golden.json`. The golden file was recorded from the original single-file version, so a pass means the game still plays exactly as it did.

If you change gameplay on purpose, the test will fail. That's expected. Re-record the golden file with:

```sh
UPDATE_GOLDEN=1 npm test
```
