// Plantations, stone quarries and copper mines: one plot each, joining into bigger ones with research.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_FARM } from '../src/core/constants';
import { W, owner, isLand, pType, pMain, pBurn, pCenter, pSpan } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { build, placeProblem, plotProblem, footprint, gatherTier, PRODUCES, PRODUCE_TICKS } from '../src/sim/buildings';
import { R_GATHER } from '../src/sim/research';
import { bldHp } from '../src/sim/defense';

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

/** Builds a `type` on plot q, paying for it. */
function put(type: number, q: number){ me().stock=[50,50,50]; if (!build(me(),q,type)) throw new Error('could not build'); }
/** The free plot nearest the capital with room for a w×h block of single plots. */
function block(w: number, h: number){
  const n=me(), cap=n.capPlot; let best=-1, bd=Infinity;
  for (let q=0;q<NP;q++){
    if (q%PW+w>PW) continue;
    let ok=true; for (let y=0;y<h && ok;y++) for (let x=0;x<w && ok;x++) if (plotProblem(n,q+y*PW+x)) ok=false;
    if (!ok) continue;
    const d=(q%PW-cap%PW)**2+((q/PW|0)-(cap/PW|0))**2; if (d<bd){ bd=d; best=q; }
  }
  if (best<0) throw new Error('no room'); return best;
}
const yields = (type: number) => { const made: number[]=[]; listen({ produced: (_q,o,_g,k) => { if (o===1) made.push(k); } }); return made; };

describe('production buildings', () => {
  it('take one plot each', () => {
    emptyKingdom();
    for (const type of [B_PLANTATION, B_QUARRY, B_COPPERMINE]){
      const q=spot(type); put(type,q);
      expect([pType[q], pSpan[q]]).toEqual([type, 0]);
      expect(footprint(q,type)).toEqual([q]);
    }
  });

  it('make 2 wood, 1 stone and 1 copper every 30 seconds at tier 1', () => {
    emptyKingdom();
    for (const type of [B_PLANTATION, B_QUARRY, B_COPPERMINE]) put(type,spot(type));
    me().stock=[0,0,0]; run(PRODUCE_TICKS+1);
    expect(me().stock).toEqual([2,1,1]);
    expect(Object.values(PRODUCES).map(p => p[1].slice(1))).toEqual([[2,5,15],[1,3,10],[1,3,10]]);
  });

  it('stand apart side by side until resource gathering reaches tier 2; then join in pairs, making more than the two did', () => {
    emptyKingdom();
    const q=block(2,1); put(B_PLANTATION,q); put(B_PLANTATION,q+1);
    run(12);
    expect([pType[q], pType[q+1]]).toEqual([B_PLANTATION, B_PLANTATION]);   // two separate buildings
    me().tier[R_GATHER]=2; run(12);
    expect([pType[q], pSpan[q], pType[q+1], pMain[q+1]]).toEqual([B_PLANTATION, 1, B_PART, q]);
    expect(gatherTier(q)).toBe(2);
    const made=yields(B_PLANTATION); me().stock=[0,0,0]; run(PRODUCE_TICKS+2);
    expect(made).toEqual([5]);
    listen({ produced: () => {} });
  });

  it('at tier 3, four of a kind in a square become one; a pair and two singles in a square too', () => {
    emptyKingdom(); me().tier[R_GATHER]=3;
    const q=block(2,2);
    put(B_QUARRY,q); put(B_QUARRY,q+1);
    expect([pSpan[q], pType[q+1]]).toEqual([1, B_PART]);   // a pair first
    put(B_QUARRY,q+PW);
    expect([pSpan[q], pType[q+PW]]).toEqual([1, B_QUARRY]);   // a single above it stays single
    put(B_QUARRY,q+PW+1);
    expect([pType[q], pSpan[q]]).toEqual([B_QUARRY, 2]);    // then all four join
    for (const k of [q+1,q+PW,q+PW+1]) expect([pType[k], pMain[k]]).toEqual([B_PART, q]);
    expect(gatherTier(q)).toBe(3);
    const made=yields(B_QUARRY); run(PRODUCE_TICKS+2);
    expect(made).toEqual([10]);
    listen({ produced: () => {} });
  });

  it('take 15 blows a tier', () => {
    emptyKingdom(); me().tier[R_GATHER]=3;
    const a=spot(B_COPPERMINE); put(B_COPPERMINE,a); expect(bldHp(a)).toBe(15);
    const q=block(2,2); for (const k of [q,q+1,q+PW,q+PW+1]) put(B_COPPERMINE,k);
    expect(bldHp(q)).toBe(45);
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

  it('a joined one burns down whole when any of its plots is taken, and stops producing', () => {
    start(987654321, 1); me().humanProg=-1e9; expand(8); me().tier[R_GATHER]=3;
    const q=block(2,2); for (const k of [q,q+1,q+PW,q+PW+1]) put(B_QUARRY,k);
    setOwner(pCenter[q+PW+1], 2);   // an enemy takes the bottom-right plot
    for (const k of [q,q+1,q+PW,q+PW+1]) expect(pBurn[k]).toBeGreaterThan(0);
    const s=me().stock[1];
    run(PRODUCE_TICKS*2);
    expect(me().stock[1]).toBe(s);
    expect(me().quarries).toBe(0);
  });
});
