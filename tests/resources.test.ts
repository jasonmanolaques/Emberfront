// Goods: nothing lies on the map to gather, the gathering buildings make it all, the first of each free.
import { describe, it, expect } from 'vitest';
import { TW, TH, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_FARM } from '../src/core/constants';
import { W, pType } from '../src/sim/state';
import { newWorld, startMatch, tick } from '../src/sim/sim';
import { build, placeProblem, structureOf, costFor, canAfford, FARM_RISE } from '../src/sim/buildings';
import { TASK_REST } from '../src/sim/population';

const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
const me = () => W.nations[1];
function start(seed: number, rivals: number){
  newWorld(seed);
  for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (startMatch((TH/2+dy*3)*TW + TW/2+dx*3, rivals)) return;
  }
  throw new Error('no spawn spot');
}
/** Builds `type` on the first free plot, whatever it costs, and returns what the stockpile lost. */
function place(type: number){
  const before=[...me().stock];
  for (const q of me().plots) if (!placeProblem(me(),q,type) && build(me(),q,type)) return before.map((b,g) => b-me().stock[g]);
  throw new Error('nowhere to build');
}

describe('goods with nothing on the map to gather', () => {
  it('start a kingdom with 10 wood, 10 stone and 10 copper, and add nothing to them without a gathering building', () => {
    start(12345, 0);
    expect(me().stock).toEqual([10,10,10]);
    run(3000);
    expect(me().stock).toEqual([10,10,10]);   // nobody goes out to gather: there is nothing out there
    expect(W.humans.filter(h => h.o===1 && h.task===TASK_REST).length).toBeGreaterThan(0);   // they are at home
  });
  it('make the first plantation, quarry and copper mine free, and the next ones cost', () => {
    start(12345, 0);
    me().stock=[0,0,0];
    for (const type of [B_PLANTATION, B_QUARRY, B_COPPERMINE]){
      expect(canAfford(me(),structureOf(type)!)).toBe(true);   // with an empty stockpile
      expect(costFor(me(),structureOf(type)!)).toEqual([0,0,0]);
      expect(place(type)).toEqual([0,0,0]);
      expect(costFor(me(),structureOf(type)!)).toEqual(structureOf(type)!.cost);
      expect(canAfford(me(),structureOf(type)!)).toBe(false);   // the second is paid for
    }
  });
  it('fill the stockpile through the buildings alone', () => {
    start(12345, 0);
    place(B_PLANTATION); const w0=me().stock[0];
    run(305);
    expect(me().stock[0]).toBe(w0+2);   // 2 wood every 30 seconds
  });
  it('make each farm 2% dearer to the next one, rounded up', () => {
    start(12345, 0);
    const base=structureOf(B_FARM)!.cost;
    expect(FARM_RISE).toBe(0.02);
    expect(costFor(me(),structureOf(B_FARM)!)).toEqual(base);
    me().farms=10;
    expect(costFor(me(),structureOf(B_FARM)!)).toEqual(base.map(c => c ? Math.ceil(c*1.2-1e-9) : 0));
    me().farms=50;
    expect(costFor(me(),structureOf(B_FARM)!)).toEqual(base.map(c => c*2));   // doubled
  });
});
