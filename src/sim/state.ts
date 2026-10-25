/* ---------- world state ----------
   Everything the simulation decides lives here. Rendering and UI may read it but never write it. */
import { NT, NP, PW, TW } from '../core/constants';
import type { Rng } from '../core/rng';

export interface Nation {
  id: number; name: string; hex: string; isPlayer: boolean;
  troops: number; maxTroops: number; rate: number; tiles: number; alive: boolean; capTile: number; capPlot: number;
  plots: number[]; blds: number[]; houses: number; farms: number; towers: number; mines: number; bCount: number;
  sumX: number; sumY: number; ltx: number; lty: number; peak: number;   // ltx/lty: where the kingdom's label sits
  expandAt: number; attackAt: number; ratio: number; nextThink: number;  // bot personality
}
export interface Attack { id: number; att: number; def: number; troops: number; front: number[]; done: boolean; }

/** A player action. Actions are queued and applied at the start of the next tick, so every
    client that receives the same actions in the same ticks runs the same game. */
export type Command = { type: 'attack'; nation: number; tile: number; ratio: number };

export const elev = new Float32Array(NT), moist = new Float32Array(NT);
export const terr = new Uint8Array(NT), isLand = new Uint8Array(NT), owner = new Uint8Array(NT), road = new Uint8Array(NT);
export const frontMark = new Int32Array(NT);
export const pType = new Uint8Array(NP), pOwner = new Uint8Array(NP), pVar = new Uint8Array(NP), pBuild = new Uint8Array(NP);
export const pMain = new Int32Array(NP), pCenter = new Int32Array(NP), pBurn = new Float32Array(NP), pTimer = new Float32Array(NP);
for (let q=0;q<NP;q++){ const px=q%PW, py=(q/PW)|0; pCenter[q]=(py*4+2)*TW+px*4+2; }

export const W = {
  mapSeed: 1, srand: Math.random as Rng, seaLevel: 0, heightRange: 1, landCount: 1, landTiles: new Int32Array(0),
  nations: [] as Nation[], M: 1, contact: new Int32Array(1), attacks: [] as Attack[], burning: [] as number[], attackSeq: 0,
  commands: [] as Command[], simTime: 0, tickN: 0,
};
