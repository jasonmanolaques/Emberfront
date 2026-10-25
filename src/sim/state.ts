/* ---------- world state ----------
   Everything the simulation decides lives here. Rendering and UI may read it but never write it. */
import { NT, NP, PW, TW } from '../core/constants';
import type { Rng } from '../core/rng';

export interface Nation {
  id: number; name: string; hex: string; isPlayer: boolean;
  gold: number; income: number;      // treasury and gold per second
  strength: number;                  // tiles + people + gold, weighted (STR_* in constants)
  tiles: number; alive: boolean; capTile: number; capPlot: number;
  plots: number[]; blds: number[]; bCount: number;
  houses: number; farms: number; towers: number; mines: number; barracks: number; minters: number;
  plantations: number; quarries: number; copperMines: number;
  sumX: number; sumY: number; ltx: number; lty: number; peak: number;   // ltx/lty: where the kingdom's label sits
  expandAt: number; attackAt: number; ratio: number; nextThink: number;  // bot personality
  soldierShare: number;              // share of the population the kingdom wants as soldiers (0..1)
  humanProg: number;                 // progress toward the next human; one arrives at HUMAN_EVERY (farms speed it up)
  villagers: number; soldiers: number; training: number;   // headcount, updated every tick; training = switching role
  beggars: number; homeless: number; taxpayers: number;     // villagers turned beggar; people without a home; housed working villagers
  stock: number[];                   // goods stored in the capital: [wood, stone, copper]
  abandoned: number;                 // houses standing empty
  surplusTicks: number;              // how long the kingdom has had more houses than people
}
/** A person walking the map. Positions are in detail pixels (2 per tile). */
export interface Human {
  id: number; o: number;             // owning nation
  kind: number;                      // H_VILLAGER | H_SOLDIER
  task: number;                      // TASK_* in population.ts
  x: number; y: number; tx: number; ty: number;
  path: number[];                    // waypoints before (tx,ty), flat x,y pairs: the way around the castle
  wait: number;                      // ticks left to idle, harvest, or spend inside the capital
  sp: number;                        // walking speed, pixels per second
  res: number;                       // tile of the resource this villager has claimed, or -1
  carry: number; amount: number;     // good being hauled home (G_* in resources.ts, -1 = nothing) and how much
  hp: number;                        // soldiers: hit points, lost to enemy watchtowers
  post: number;                      // soldiers: plot of the watchtower they guard, or -1 (waiting at a barracks)
  site: number;                      // plot of the barracks they are heading to or training in, or -1
  home: number;                      // villagers: plot of the house they are building, or -1
  housed: boolean;                   // has a home this tick (the longest-standing people get the houses)
  homeless: number;                  // ticks spent without a home
  beggar: boolean;                   // a villager homeless too long: idle, unrecruitable, pays no tax
}
export interface Attack { id: number; att: number; def: number; gold: number; front: number[]; done: boolean; }   // gold still to spend on this front

/** A player action. Actions are queued and applied at the start of the next tick, so every
    client that receives the same actions in the same ticks runs the same game. */
export type Command =
  | { type: 'attack'; nation: number; tile: number; ratio: number }
  | { type: 'soldiers'; nation: number; share: number }
  | { type: 'build'; nation: number; plot: number; kind: number }     // kind: B_FARM, B_BARRACKS, B_TOWER or B_MINTER
  | { type: 'priority'; nation: number; plot: number };               // toggle a watchtower's call for a garrison

export const elev = new Float32Array(NT), moist = new Float32Array(NT);
// resources: at most one per tile (R_* in resources.ts), harvests left, claimed by a villager
export const resType = new Uint8Array(NT), resLeft = new Uint8Array(NT), resBusy = new Uint8Array(NT);
export const terr = new Uint8Array(NT), isLand = new Uint8Array(NT), owner = new Uint8Array(NT), road = new Uint8Array(NT);
export const frontMark = new Int32Array(NT);
export const pType = new Uint8Array(NP), pOwner = new Uint8Array(NP), pVar = new Uint8Array(NP), pBuild = new Uint8Array(NP);
export const pMain = new Int32Array(NP), pCenter = new Int32Array(NP), pBurn = new Float32Array(NP), pTimer = new Float32Array(NP);
for (let q=0;q<NP;q++){ const px=q%PW, py=(q/PW)|0; pCenter[q]=(py*4+2)*TW+px*4+2; }
export const pAband = new Uint8Array(NP);  // houses standing empty, run down
export const pPrio = new Int32Array(NP);   // watchtowers calling for a garrison: order they asked in (0 = not asking)

export const W = {
  mapSeed: 1, srand: Math.random as Rng, seaLevel: 0, heightRange: 1, landCount: 1, landTiles: new Int32Array(0),
  nations: [] as Nation[], M: 1, contact: new Int32Array(1), attacks: [] as Attack[], burning: [] as number[], attackSeq: 0,
  commands: [] as Command[], simTime: 0, tickN: 0,
  prand: Math.random as Rng,         // separate stream for people, so they never shift the territory game's randomness
  humans: [] as Human[], humanSeq: 0,
  prioSeq: 0,
};
