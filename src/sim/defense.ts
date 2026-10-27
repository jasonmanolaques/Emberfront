/* ---------- defences: watchtowers, the castle, and how much a building can take ----------
   Watchtowers and the castle come in three tiers. Each watchtower has its own: research
   (sim/research.ts) lets the builders guild rebuild them a tier up, for 10 stone and 4 wood to
   tier 2 and 20 stone and 8 wood to tier 3. The castle is rebuilt at once, free, when the
   research is done.
   A watchtower shoots every 4, 3.5 or 3 seconds for 2, 3 or 4 damage, and takes 20, 30 or 40
   blows. The castle shoots like two towers of its tier (twice as often, the same damage) and is
   far tougher: 200, 400 or 600 blows, mending 2 a second by itself. Towers don't mend.
   A tower looks battered from half its blows; the castle damaged from a third, and badly from
   two thirds.
   Two watchtowers of a kingdom side by side are joined by a wall. While both stand, nobody but
   that kingdom and its allies gets across it: an army goes round, or knocks down a tower. */
import { TW, NT, PW, PH, B_HOUSE, B_FARM, B_TOWER, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_MINE, B_RESEARCH, B_GUILD, B_SMITHY, B_CASTLE } from '../core/constants';
import { W, pType, pOwner, pTier, pHp, pBurn } from './state';
import { HOUSE_TOUGH, R_CASTLE } from './research';
import { isGatherer, gatherTier } from './buildings';

export const TOWER_RELOADS = [0, 40, 35, 30];   // ticks between a watchtower's shots, by tier
export const TOWER_DMGS = [0, 2, 3, 4];         // damage of a shot, by tier (the castle's too)
export const TOWER_HP = [0, 20, 30, 40];        // blows a watchtower takes, by tier
export const CASTLE_HP = [0, 200, 400, 600];    // blows the castle takes, by tier
export const CASTLE_MEND = 0.2;                 // blows the castle mends a tick (2 a second)
export const TOWER_COST = [[], [4,10,0], [8,20,0]];   // [wood, stone, copper] to rebuild a watchtower from tier t to t+1
export const HOUSE_HP = 10, GATHER_HP = 15;     // blows a hovel takes (a stone house 3 times, a manor 6); a plantation, quarry or mine per tier

/** Blows a building takes before it burns (the castle: before the kingdom falls). */
export const BLD_HP: Record<number, number> = { [B_HOUSE]: HOUSE_HP, [B_FARM]: 15, [B_TOWER]: TOWER_HP[1], [B_BARRACKS]: 20, [B_MINTER]: 15,
  [B_PLANTATION]: GATHER_HP, [B_QUARRY]: GATHER_HP, [B_COPPERMINE]: GATHER_HP, [B_MINE]: 10, [B_RESEARCH]: 15, [B_GUILD]: 15, [B_SMITHY]: 15, [B_CASTLE]: CASTLE_HP[1] };

/** The tier of the watchtower on plot q, and of kingdom o's castle. */
export const towerTier = (q: number) => pTier[q] || 1;
export const castleTier = (o: number) => W.nations[o]?.tier[R_CASTLE] ?? 1;

/** Blows the building on plot q takes: a hovel 10, stone houses 3 times that, manors 6 times;
    plantations, quarries and mines 15 per tier; towers by their tier, the castle by its kingdom's. */
export function bldHp(q: number){
  const ty=pType[q];
  if (ty===B_HOUSE) return HOUSE_HP*HOUSE_TOUGH[pTier[q]];
  if (isGatherer(ty)) return GATHER_HP*gatherTier(q);
  if (ty===B_TOWER) return TOWER_HP[towerTier(q)];
  if (ty===B_CASTLE) return CASTLE_HP[castleTier(pOwner[q])];
  return BLD_HP[ty] ?? 8;
}
/** How battered the building on plot q looks: 0 whole; towers 1 from half their blows; the castle
    1 damaged (a third gone) or 2 badly damaged (two thirds gone). */
export function wear(q: number){
  const ty=pType[q]; if (ty!==B_TOWER && ty!==B_CASTLE) return 0;
  const f=pHp[q]/bldHp(q);
  return ty===B_TOWER ? (f>=0.5 ? 1 : 0) : f>=2/3 ? 2 : f>=1/3 ? 1 : 0;
}

/* ---------- walls between watchtowers ---------- */
export const wallOf = new Uint8Array(NT);      // kingdom whose wall stands on each tile, 0 none
export const wallTower = new Int32Array(NT);   // a tower holding up the wall on each tile
let walled: number[] = [];
const standingTower = (q: number, o: number) => pType[q]===B_TOWER && pOwner[q]===o && pBurn[q]<=0;
function mark(o: number, t: number, q: number){ if (!wallOf[t]) walled.push(t); wallOf[t]=o; wallTower[t]=q; }
/** Works out the walls: a band of tiles from each tower to the next one east or south of it, where
    the wall is drawn (render/sprites.ts drawTower), while both towers stand. */
export function buildWalls(){
  for (const t of walled) wallOf[t]=0;
  walled=[];
  for (const n of W.nations){
    if (!n.alive) continue;
    for (const q of n.blds){
      if (!standingTower(q,n.id)) continue;
      const x=q%PW, y=(q/PW)|0, t0=y*4*TW+x*4;   // the plot's top-left tile
      if (x<PW-1 && standingTower(q+1,n.id))
        for (let r=2;r<=3;r++){ for (let c=1;c<=3;c++) mark(n.id,t0+r*TW+c,q); for (let c=4;c<=6;c++) mark(n.id,t0+r*TW+c,q+1); }
      if (y<PH-1 && standingTower(q+PW,n.id))
        for (let c=1;c<=2;c++){ for (let r=2;r<=3;r++) mark(n.id,t0+r*TW+c,q); for (let r=4;r<=7;r++) mark(n.id,t0+r*TW+c,q+PW); }
    }
  }
}
/** Does a wall on tile t keep kingdom o's people out? (Its own and its allies' pass through the gates.) */
export const walledFor = (o: number, t: number) => { const w=wallOf[t]; return w!==0 && w!==o && W.ally[o*W.M+w]!==1; };
export function resetWalls(){ wallOf.fill(0); walled=[]; }
