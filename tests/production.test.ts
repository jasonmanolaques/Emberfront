// Plantations, stone quarries and copper mines: multi-plot buildings that fill the stockpile.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_FARM } from '../src/core/constants';
import { W, owner, isLand, pType, pMain, pBurn, pCenter } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { build, placeProblem, footprint, PRODUCE_TICKS } from '../src/sim/buildings';

const me = () => W.nations[1];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
function start(seed: number, rivals: number){
  newWorld(seed);
  for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (startMatch((TH/2+dy*3)*TW + TW/2+dx*3, rivals)) return;
  }
  throw new Error('no spawn spot');
}
function expand(rounds: number){
  for (let r=0;r<rounds;r++){
    let t=-1;
    for (let i=0;i<NT && t<0;i++) if (!owner[i] && isLand[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1)) t=i;
    me().gold+=400;
    if (t>=0) queueCommand({ type: 'attack', nation: 1, tile: t, ratio: 0.8 });
    run(40);
  }
}
/** Nearest spot to the capital where a `type` building fits. */
function spot(type: number){
  const n=me(), cap=n.capPlot; let best=-1, bd=Infinity;
  for (let q=0;q<NP;q++){ if (placeProblem(n,q,type)) continue; const d=(q%PW-cap%PW)**2+((q/PW|0)-(cap/PW|0))**2; if (d<bd){ bd=d; best=q; } }
  if (best<0) throw new Error('no room'); return best;
}
/** A kingdom with room to build and nobody living in it, so only buildings change the stockpile. */
function emptyKingdom(){ start(987654321, 0); me().humanProg=-1e9; expand(8); }

describe('production buildings', () => {
  it('cover 2x2 plots (plantation, quarry) or 2x1 (copper mine)', () => {
    emptyKingdom();
    for (const [type, w, h] of [[B_PLANTATION,2,2],[B_QUARRY,2,2],[B_COPPERMINE,2,1]]){
      const q=spot(type); me().stock=[20,20,20];
      expect(build(me(),q,type)).toBe(true);
      const plots=footprint(q,type);
      expect(plots).toHaveLength(w*h);
      expect(pType[q]).toBe(type);
      for (const k of plots.slice(1)){ expect(pType[k]).toBe(B_PART); expect(pMain[k]).toBe(q); }
    }
    expect([me().plantations, me().quarries, me().copperMines]).toEqual([1,1,1]);
  });

  it('need every plot of their footprint free', () => {
    emptyKingdom();
    const q=spot(B_PLANTATION);
    me().stock=[5,2,0]; build(me(), q+PW+1, B_FARM);   // a farm on the bottom-right plot
    me().stock=[10,0,0];
    expect(placeProblem(me(), q, B_PLANTATION)).toBe('Needs 2×2 free plots');
    expect(build(me(), q, B_PLANTATION)).toBe(false);
    expect(me().stock).toEqual([10,0,0]);
  });

  it('deliver every 30 seconds: plantation +5 wood, quarry +3 stone, copper mine +2 copper', () => {
    emptyKingdom();
    for (const type of [B_PLANTATION, B_QUARRY, B_COPPERMINE]){ me().stock=[20,20,20]; build(me(), spot(type), type); }
    const got: number[][]=[]; listen({ produced: (_q,id,good,amount) => { if (id===1) got.push([good,amount]); } });
    me().stock=[0,0,0];
    run(PRODUCE_TICKS-1);
    expect(me().stock).toEqual([0,0,0]);
    run(1);
    expect(me().stock).toEqual([5,3,2]);
    expect(got.sort()).toEqual([[0,5],[1,3],[2,2]]);
    run(PRODUCE_TICKS*3);
    expect(me().stock).toEqual([20,12,8]);
    listen({ produced: () => {} });
  });

  it('cost what the design says', () => {
    emptyKingdom();
    for (const [type, cost] of [[B_PLANTATION,[10,0,0]],[B_QUARRY,[3,5,0]],[B_COPPERMINE,[10,10,0]]] as [number, number[]][]){
      me().stock=cost.map(c => c ? c-1 : 0);
      expect(build(me(), spot(type), type)).toBe(false);   // one short of each
      me().stock=[...cost];
      expect(build(me(), spot(type), type)).toBe(true);
      expect(me().stock).toEqual([0,0,0]);
    }
  });

  it('burns down whole when any of its plots is taken, and stops producing', () => {
    start(987654321, 1); me().humanProg=-1e9; expand(8);
    const q=spot(B_QUARRY); me().stock=[20,20,0]; build(me(),q,B_QUARRY);
    setOwner(pCenter[q+PW+1], 2);   // an enemy takes the bottom-right plot
    for (const k of footprint(q,B_QUARRY)) expect(pBurn[k]).toBeGreaterThan(0);
    const s=me().stock[1];
    run(PRODUCE_TICKS*2);
    expect(me().stock[1]).toBe(s);
    expect(me().quarries).toBe(0);
  });
});
