// The sea: naval bases, ships, colonies, naval invasions.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, T_GRASS, T_WATER, B_NAVAL, B_HOUSE } from '../src/core/constants';
import { W, owner, occ, isLand, isle, terr, pBuild, pType, pSpan, ferry } from '../src/sim/state';
import { newWorld, startMatch, tick, queueCommand } from '../src/sim/sim';
import { setOwner } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { build, navalSite, navalProblem, plotProblem, costFor, structureOf } from '../src/sim/buildings';
import { labelWorld, allocIsles, basesOf, dockTile, colonyPlan, SHIP_TICKS, hasLandOn } from '../src/sim/naval';

const N = (i: number) => W.nations[i];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
const SEA_X0=250, SEA_X1=290;   // a channel of water from x=250 to 289; the island lies east of it

/** A flat map: mainland west of a channel, an island east of it; the player in the middle of the mainland. */
function world(rivals=0){
  newWorld(7);
  isLand.fill(1); terr.fill(T_GRASS); pBuild.fill(1);
  for (let y=0;y<TH;y++) for (let x=SEA_X0;x<SEA_X1;x++){ const t=y*TW+x; isLand[t]=0; terr[t]=T_WATER; }
  for (let q=0;q<NP;q++){ const c=(((q/PW)|0)*4+2)*TW+(q%PW)*4+2; pBuild[q]=isLand[c] ? 1 : 0; }
  W.landTiles=Int32Array.from({ length: NT }, (_, i) => i).filter(t => isLand[t]); W.landCount=W.landTiles.length;
  labelWorld();
  if (!startMatch((TH/2)*TW+TW/2-20, rivals)) throw new Error('no spawn');
  for (const n of W.nations.slice(2)){ n.nextThink=1e9; n.nextWar=1e9; }
  // the mainland shore is the player's, to the channel
  const me=N(1);
  for (let y=60;y<190;y++) for (let x=150;x<SEA_X0;x++){ const t=y*TW+x; if (!owner[t]) setOwner(t,1); }
  census();
  me.stock=[200,200,200]; me.gold=2000;
}
/** The plot at the top-left of a naval base on the shore: three plots of land and a channel's width of water. */
const shorePlot = () => 40*PW+60;   // plot x 60..63 = tiles 240..255: water from tile 250

describe('the naval base', () => {
  it('stands over plots on the water, a third of it at least, and the land in it your own', () => {
    world();
    const me=N(1), q=shorePlot();
    expect(navalProblem(me,q,0)).toBeNull();                        // 4×2 plots: 6 of 16 columns are water
    const far=40*PW+45;                                             // all land
    expect(navalSite(me,far).problem).toMatch(/third/);
    expect(navalSite(me,q).orient).toBe(0);
    // unowned land in it: no
    for (let y=160;y<168;y++) for (let x=240;x<SEA_X0;x++) setOwner(y*TW+x,0);
    expect(navalSite(me,41*PW+60+0).problem).toBeTruthy();
  });
  it('costs 15 wood and 5 stone, covers 8 plots (4×2, or turned 2×4), and is counted', () => {
    world();
    const me=N(1), s=structureOf(B_NAVAL)!;
    expect(costFor(me,s)).toEqual([15,5,0]);
    me.stock=[15,5,0];
    expect(build(me,shorePlot(),B_NAVAL)).toBe(true);
    expect(me.stock).toEqual([0,0,0]);
    census();
    expect(me.navals).toBe(1);
    expect(basesOf(me)).toEqual([shorePlot()]);
    expect(pSpan[shorePlot()]).toBe(0);
    const parts=[...Array(8).keys()].map(i => shorePlot()+(i%4)+((i/4)|0)*PW);
    expect(parts.slice(1).every(k => pType[k]!==0 && plotProblem(me,k)!==null)).toBe(true);
    expect(isLand[dockTile(shorePlot())]).toBe(0);                  // the dock is on the water
  });
});

describe('ships', () => {
  it('cost 5 wood and take 15 seconds each, one after another; ready ships are the kingdom\'s', () => {
    world();
    const me=N(1); me.stock=[100,100,0];
    expect(build(me,shorePlot(),B_NAVAL)).toBe(true); census();
    expect(SHIP_TICKS).toBe(300);
    const wood=me.stock[0];
    queueCommand({ type:'ship', nation:1, plot:shorePlot() }); queueCommand({ type:'ship', nation:1, plot:shorePlot() }); tick();
    expect(me.stock[0]).toBe(wood-10);
    run(SHIP_TICKS-5); expect(me.fleet).toBe(0);
    run(10); expect(me.fleet).toBe(1);
    run(SHIP_TICKS); expect(me.fleet).toBe(2);
    me.stock[0]=3; queueCommand({ type:'ship', nation:1, plot:shorePlot() }); tick();
    expect(W.docks.get(shorePlot())!.queued).toBe(0);               // 5 wood or nothing
  });
});

describe('colonies', () => {
  it('need a naval base: without one an island cannot be settled', () => {
    world();
    const t=100*TW+300;
    expect(isLand[t]).toBe(1); expect(hasLandOn(1,t)).toBe(false);
    expect(colonyPlan(N(1),t)).toMatch(/naval base/i);
  });
  it('send a ship over the water to the nearest coast, take the beach there, and spread over that island only', () => {
    world();
    const me=N(1); me.stock=[100,100,0];
    expect(build(me,shorePlot(),B_NAVAL)).toBe(true); census();
    const t=100*TW+300, plan=colonyPlan(me,t);
    expect(typeof plan).toBe('object');
    const mainBefore=Array.from({ length: NT }, (_, k) => k).filter(k => k%TW<SEA_X0 && owner[k]===1).length;
    const gold=me.gold;
    queueCommand({ type:'colonize', nation:1, tile:t, ratio:0.5 }); tick();
    expect(me.gold).toBeLessThan(gold*0.52);
    expect(W.ships).toHaveLength(1);
    expect(W.ships.every(s => { const k=((s.y/2)|0)*TW+((s.x/2)|0); return !isLand[k]; })).toBe(true);   // at sea
    let ticks=0; while (!hasLandOn(1,t) && ticks++<4000){ tick(); for (const s of W.ships) expect(isLand[((s.y/2)|0)*TW+((s.x/2)|0)]).toBe(0); }
    expect(hasLandOn(1,t)).toBe(true);
    run(800);
    const island=Array.from({ length: NT }, (_, k) => k).filter(k => k%TW>=SEA_X1 && owner[k]===1).length;
    expect(island).toBeGreaterThan(100);                            // it spread over the island...
    const mainAfter=Array.from({ length: NT }, (_, k) => k).filter(k => k%TW<SEA_X0 && owner[k]===1).length;
    expect(mainAfter).toBe(mainBefore);                             // ...and not the mainland
    // the ship went home
    run(2000); expect(W.ships).toHaveLength(0);
    // a lane over the water for the villagers
    expect(ferry.some(v => v===1)).toBe(true);
    // and settled like the mainland now: one settle command spreads over both
    expect(colonyPlan(me,t)).toMatch(/already/);
  });
  it('a settle (attack) once there is land on the island spreads over the mainland and the island alike', () => {
    world();
    const me=N(1); me.stock=[100,100,0];
    expect(build(me,shorePlot(),B_NAVAL)).toBe(true); census();
    queueCommand({ type:'colonize', nation:1, tile:100*TW+300, ratio:0.3 }); tick();
    run(3000);
    const was=me.tiles; me.gold=3000;
    queueCommand({ type:'attack', nation:1, tile:100*TW+300, ratio:1 }); tick();
    run(300);
    expect(me.tiles).toBeGreaterThan(was+200);
  });
});
describe('villagers cross by boat', () => {
  it('once a colony stands, villagers walk the sea lane to build houses on the island, and do not need a ship', () => {
    world();
    const me=N(1); me.stock=[100,100,0]; me.gold=4000;
    expect(build(me,shorePlot(),B_NAVAL)).toBe(true); census();
    queueCommand({ type:'colonize', nation:1, tile:100*TW+300, ratio:0.5 }); tick();
    run(1500);
    expect(me.fleet).toBe(0);
    let onWater=0, island=0;
    for (let i=0;i<9000;i++){
      tick();
      if (i%20===0){
        for (const h of W.humans) if (h.o===1 && !isLand[((h.y/2)|0)*TW+((h.x/2)|0)]){ onWater++; expect(ferry[((h.y/2)|0)*TW+((h.x/2)|0)]).toBe(1); }   // only ever on a sea lane
        island=0; for (let q=0;q<NP;q++) if (pType[q]===B_HOUSE && (q%PW)*4>=SEA_X1) island++;
      }
    }
    expect(island).toBeGreaterThan(0);
    expect(onWater).toBeGreaterThan(0);
  });
});

