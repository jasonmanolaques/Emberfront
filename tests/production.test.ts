// Plantations, stone quarries and copper mines: a 2×2 block of plots each, joining into bigger ones with research (4×2, then 4×4).
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_FARM } from '../src/core/constants';
import { W, owner, isLand, pType, pMain, pBurn, pCenter, pSpan } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { build, placeProblem, plotProblem, footprint, gatherTier, PRODUCES, PRODUCE_TICKS } from '../src/sim/buildings';
import { R_GATHER } from '../src/sim/research';
import { bldHp } from '../src/sim/defense';
import { botThink } from '../src/sim/bots';
import { RG, region, cedeRegion } from '../src/sim/regions';

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
/** A kingdom with room to build and nobody living in it, so only buildings change the stockpile (the regions' works are shut, too). */
function emptyKingdom(){ start(987654321, 0); me().humanProg=-1e9; RG.site.fill(-1); expand(8); }
/** The plots of the w×h rectangle with its top-left at q. */
const rect = (q: number, w: number, h: number) => { const out: number[]=[]; for (let y=0;y<h;y++) for (let x=0;x<w;x++) out.push(q+y*PW+x); return out; };

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
  it('take a 2×2 block of plots each', () => {
    emptyKingdom();
    for (const type of [B_PLANTATION, B_QUARRY, B_COPPERMINE]){
      const q=spot(type); put(type,q);
      expect([pType[q], pSpan[q]]).toEqual([type, 0]);
      expect(footprint(q,type)).toEqual(rect(q,2,2));
      for (const k of rect(q,2,2).slice(1)) expect([pType[k], pMain[k]]).toEqual([B_PART, q]);
    }
  });

  it('make 2 wood, 2 stone and 1 copper every 30 seconds at tier 1', () => {
    emptyKingdom();
    for (const type of [B_PLANTATION, B_QUARRY, B_COPPERMINE]) put(type,spot(type));
    me().stock=[0,0,0]; run(PRODUCE_TICKS+1);
    expect(me().stock).toEqual([2,2,1]);
    expect(Object.values(PRODUCES).map(p => p[1].slice(1))).toEqual([[2,5,15],[2,5,15],[1,3,10]]);
  });

  it('stand apart side by side until resource gathering reaches tier 2; then join in pairs, making more than the two did', () => {
    emptyKingdom();
    const q=block(4,2); put(B_PLANTATION,q); put(B_PLANTATION,q+2);
    run(12);
    expect([pType[q], pType[q+2]]).toEqual([B_PLANTATION, B_PLANTATION]);   // two separate buildings
    me().tier[R_GATHER]=2; run(12);
    expect([pType[q], pSpan[q], pType[q+2], pMain[q+2]]).toEqual([B_PLANTATION, 1, B_PART, q]);   // one of 4×2
    expect(footprint(q,B_PLANTATION).length).toBe(2*2);   // (what a new one would cover)
    for (const k of rect(q,4,2).slice(1)) expect(pMain[k]).toBe(q);
    expect(gatherTier(q)).toBe(2);
    const made=yields(B_PLANTATION); me().stock=[0,0,0]; run(PRODUCE_TICKS+2);
    expect(made).toEqual([5]);
    listen({ produced: () => {} });
  });

  it('at tier 3, four of a kind in a square become one; a pair and two singles in a square too', () => {
    emptyKingdom(); me().tier[R_GATHER]=3;
    const q=block(4,4);
    put(B_QUARRY,q); put(B_QUARRY,q+2);
    expect([pSpan[q], pType[q+2]]).toEqual([1, B_PART]);   // a pair first
    put(B_QUARRY,q+2*PW);
    expect([pSpan[q], pType[q+2*PW]]).toEqual([1, B_QUARRY]);   // a single under it stays single
    put(B_QUARRY,q+2*PW+2);
    expect([pType[q], pSpan[q]]).toEqual([B_QUARRY, 2]);    // then all four join, into one of 4×4
    for (const k of rect(q,4,4).slice(1)) expect([pType[k], pMain[k]]).toEqual([B_PART, q]);
    expect(gatherTier(q)).toBe(3);
    const made=yields(B_QUARRY); run(PRODUCE_TICKS+2);
    expect(made).toEqual([15]);
    listen({ produced: () => {} });
  });

  it('take 30 blows a tier', () => {
    emptyKingdom(); me().tier[R_GATHER]=3;
    const a=spot(B_COPPERMINE); put(B_COPPERMINE,a); expect(bldHp(a)).toBe(30);
    const q=block(4,4); for (const k of [q,q+2,q+2*PW,q+2*PW+2]) put(B_COPPERMINE,k);
    expect(bldHp(q)).toBe(90);
  });

  it('cost what the design says', () => {
    emptyKingdom();
    for (const [type, cost] of [[B_PLANTATION,[10,0,0]],[B_QUARRY,[5,10,0]],[B_COPPERMINE,[10,10,0]]] as [number, number[]][]){
      me().stock=type===B_COPPERMINE ? [...cost] : [0,0,0];
      expect(build(me(), spot(type), type)).toBe(true);   // the first plantation and quarry are free, the copper mine is paid for
      expect(me().stock).toEqual([0,0,0]);
      const next=cost.map(c => c ? Math.round(c*1.1) : 0);   // each one owned makes the next a tenth dearer
      me().stock=next.map(c => c ? c-1 : 0);
      expect(build(me(), spot(type), type)).toBe(false);   // the next, one short of each
      me().stock=[...next];
      expect(build(me(), spot(type), type)).toBe(true);
      expect(me().stock).toEqual([0,0,0]);
    }
  });

  it('a joined one burns down whole when any of its plots is taken, and stops producing', () => {
    start(987654321, 1); me().humanProg=-1e9; RG.site.fill(-1); expand(8); me().tier[R_GATHER]=3;
    const q=block(4,4); for (const k of [q,q+2,q+2*PW,q+2*PW+2]) put(B_QUARRY,k);
    setOwner(pCenter[q+3*PW+3], 2);   // an enemy takes the bottom-right plot
    for (const k of rect(q,4,4)) expect(pBurn[k]).toBeGreaterThan(0);
    const s=me().stock[1];
    run(PRODUCE_TICKS*2);
    expect(me().stock[1]).toBe(s);
    expect(me().quarries).toBe(0);
  });
});

describe('bots and their gathering buildings', () => {
  it('study resource gathering once they have two gathering buildings, to join them', () => {
    start(987654321, 1); const bot=W.nations[2]; bot.nextThink=0;
    cedeRegion(region[bot.capTile],2);   // (room for two 2×2 yards)
    // two plantations side by side for the bot
    let q=-1; for (let k=0;k<NP-2 && q<0;k++) if (!placeProblem(bot,k,B_PLANTATION) && !placeProblem(bot,k+2,B_PLANTATION)) q=k;
    bot.stock=[50,50,50]; build(bot,q,B_PLANTATION); bot.stock=[50,50,50]; build(bot,q+2,B_PLANTATION);
    expect(bot.plantations).toBe(2);
    bot.study=0; botThink(bot);
    expect(bot.study).toBe(R_GATHER);
  });
  it('build their gathering buildings in squares, so research can join four into one', () => {
    start(987654321, 1); const bot=W.nations[2];
    for (let i=0;i<30;i++){ bot.stock=[999,999,999]; bot.nextThink=0; bot.tiles>0 && botThink(bot); run(5); }
    const kinds=[B_PLANTATION,B_QUARRY,B_COPPERMINE];
    // for each kind with several buildings, they stand side by side rather than scattered
    for (const ty of kinds){
      const mine: number[]=[]; for (let q=0;q<NP;q++) if (pType[q]===ty && W.nations[2].blds.includes(q)) mine.push(q);
      if (mine.length<3) continue;
      const touching=mine.filter(q => mine.some(k => { const dx=Math.abs(k%PW-q%PW), dy=Math.abs(((k/PW)|0)-((q/PW)|0)); return k!==q && dx<=2 && dy<=2 && dx+dy===2 && (dx===0 || dy===0); })).length;   // (2×2 blocks edge to edge)
      expect(touching).toBeGreaterThanOrEqual(Math.floor(mine.length/2));   // (side by side, in groups: villagers' houses go up among them meanwhile and break up a square)
    }
  });
});
