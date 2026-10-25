// Runs scripted matches on the simulation alone (no browser, no canvas) and checks the
// result tick-for-tick against fingerprints recorded from the original single-file game.
// If you change gameplay on purpose, re-record with: UPDATE_GOLDEN=1 npm test
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { TW, TH } from '../src/core/constants';
import { W, owner, isLand, terr, road, pType, pOwner, pVar, pBurn, pTimer } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import './scenario.js';

const goldenPath = new URL('./golden.json', import.meta.url);
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));

let state = 'spawn', ratio = 0.4;
const api = {
  TW, TH,
  get state(){ return state; }, get nations(){ return W.nations; }, get simTime(){ return W.simTime; },
  newWorld: (seed: number) => { newWorld(seed); state = 'spawn'; },
  spawnAt: (x: number, y: number) => { if (startMatch(y*TW+x, 9)) state = 'play'; },
  run: (n: number) => { for (let i=0;i<n;i++) tick(); },
  setRatio: (r: number) => { ratio = r; },
  attack: (t: number) => {
    const me = W.nations[1]; if (!me || !me.alive || t<0 || !isLand[t] || owner[t]===1) return;
    queueCommand({ type: 'attack', nation: 1, tile: t, ratio });
  },
  dump: () => ({ owner, isLand, terr, road, pType, pOwner, pVar, pBurn, pTimer, attacks: W.attacks, campaigns: W.campaigns, tickN: W.tickN }),
};

const run = (globalThis as any).efScenario as (api: unknown, opts: { seed: number }) => { spawned: boolean; checkpoints: object[] };
const fresh: Record<string, unknown> = {};

describe('simulation is deterministic and unchanged', () => {
  for (const seed of Object.keys(golden)) {
    it(`seed ${seed}`, () => {
      const out = run(api, { seed: +seed });
      fresh[seed] = out;
      if (!process.env.UPDATE_GOLDEN) expect(out).toEqual(golden[seed]);
    });
  }
  it.runIf(!!process.env.UPDATE_GOLDEN)('writes golden.json', () => {
    writeFileSync(goldenPath, JSON.stringify(fresh, null, 1) + '\n');
  });
});
