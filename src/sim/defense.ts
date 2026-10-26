/* ---------- defences: watchtowers, the castle, and how much a building can take ----------
   Watchtowers and the castle come in three tiers, researched (sim/research.ts) for the whole
   kingdom at once: every tower and the castle of a kingdom stand at its tier.
   A watchtower shoots every 4, 3.5 or 3 seconds for 2, 3 or 4 damage, and takes 20, 30 or 40
   blows. The castle shoots like two towers of its tier (twice as often, the same damage) and is
   far tougher: 100, 200 or 300 blows, mending 2 a second by itself. Towers don't mend.
   A tower looks battered from half its blows; the castle damaged from a third, and badly from
   two thirds. */
import { B_HOUSE, B_FARM, B_TOWER, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_MINE, B_RESEARCH, B_GUILD, B_SMITHY, B_CASTLE } from '../core/constants';
import { W, pType, pOwner, pTier, pHp } from './state';
import { HOUSE_TOUGH, R_TOWERS, R_CASTLE } from './research';

export const TOWER_RELOADS = [0, 40, 35, 30];   // ticks between a watchtower's shots, by tier
export const TOWER_DMGS = [0, 2, 3, 4];         // damage of a shot, by tier (the castle's too)
export const TOWER_HP = [0, 20, 30, 40];        // blows a watchtower takes, by tier
export const CASTLE_HP = [0, 100, 200, 300];    // blows the castle takes, by tier
export const CASTLE_MEND = 0.2;                 // blows the castle mends a tick (2 a second)

/** Blows a building takes before it burns (the castle: before the kingdom falls). */
export const BLD_HP: Record<number, number> = { [B_HOUSE]: 6, [B_FARM]: 5, [B_TOWER]: TOWER_HP[1], [B_BARRACKS]: 12, [B_MINTER]: 10,
  [B_PLANTATION]: 10, [B_QUARRY]: 10, [B_COPPERMINE]: 10, [B_MINE]: 8, [B_RESEARCH]: 10, [B_GUILD]: 10, [B_SMITHY]: 10, [B_CASTLE]: CASTLE_HP[1] };

/** The tier of kingdom o's watchtowers, and of its castle. */
export const towerTier = (o: number) => W.nations[o]?.tier[R_TOWERS] ?? 1;
export const castleTier = (o: number) => W.nations[o]?.tier[R_CASTLE] ?? 1;

/** Blows the building on plot q takes: stone houses 3 times a hovel's, manors 6 times; towers and
    the castle by their kingdom's tier. */
export function bldHp(q: number){
  const ty=pType[q];
  if (ty===B_HOUSE) return BLD_HP[B_HOUSE]*HOUSE_TOUGH[pTier[q]];
  if (ty===B_TOWER) return TOWER_HP[towerTier(pOwner[q])];
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
