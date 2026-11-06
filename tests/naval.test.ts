// The sea: naval bases, ships, colonies, naval invasions.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, T_GRASS, T_WATER, B_NAVAL, B_HOUSE } from '../src/core/constants';
import { W, owner, occ, isLand, isle, sea, terr, pBuild, pType, pSpan, ferry } from '../src/sim/state';
import { newWorld, startMatch, tick, queueCommand } from '../src/sim/sim';
import { setOwner } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { build, navalSite, navalProblem, plotProblem, costFor, structureOf } from '../src/sim/buildings';
import { labelWorld, allocIsles, seaPaths, waypoints, basesOf, dockTile, settlePlan, SHIP_TICKS, hasLandOn } from '../src/sim/naval';

const N = (i: number) => W.nations[i];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
const SEA_X0=250, SEA_X1=290;   // a channel of water from x=250 to 289; the island lies east of it

/** A flat map: mainland west of a channel, an island east of it; the player in the middle of the mainland. */
function world(rivals=0){
  newWorld(7); W.rushUntil=0;
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

describe('naval settlement', () => {
  const ISLAND=100*TW+300, NEAR=30*TW+240, FAR=30*TW+200;   // an island tile; mainland 9 tiles from the shore; mainland 49 tiles from it
  const owned = (f: (k: number) => boolean) => { let n=0; for (let k=0;k<NT;k++) if (owner[k]===1 && f(k)) n++; return n; };
  function withBase(ships=2){
    world();
    const me=N(1); me.stock=[100,100,0]; me.gold=2000;
    expect(build(me,shorePlot(),B_NAVAL)).toBe(true); census();
    me.fleet=ships;
    return me;
  }
  it('needs a naval base, and a ship of the fleet', () => {
    world();
    expect(settlePlan(N(1),ISLAND)).toMatch(/naval base/i);
    const me=withBase(0);
    expect(settlePlan(me,ISLAND)).toMatch(/ship/i);
    me.fleet=1; expect(typeof settlePlan(me,ISLAND)).toBe('object');
  });
  it('land joined to your own must lie within 10 tiles of a shore; an island may be any distance from one', () => {
    const me=withBase();
    expect(typeof settlePlan(me,NEAR)).toBe('object');
    expect(settlePlan(me,FAR)).toMatch(/too far from the coast/i);
    const deep=130*TW+340;   // the middle of the island: nowhere near the shore, but an island
    expect(typeof settlePlan(me,deep)).toBe('object');
  });
  it('sends a ship of the fleet, and it comes home: the fleet is counted again', () => {
    const me=withBase(2);
    queueCommand({ type:'colonize', nation:1, tile:ISLAND, ratio:0.5 }); tick();
    expect(me.fleet).toBe(1);
    expect(W.ships).toHaveLength(1); expect(W.ships[0].fleet).toBe(true);
    for (let i=0;i<4000 && W.ships.length;i++){ tick(); for (const s of W.ships) expect(isLand[((s.y/2)|0)*TW+((s.x/2)|0)]).toBe(0); }
    expect(W.ships).toHaveLength(0);
    expect(me.fleet).toBe(2);
  });
  it('puts ashore one tile where it lands, and the gold spreads the border from that tile the way settling does, over that island only', () => {
    const me=withBase();
    const mainBefore=owned(k => k%TW<SEA_X0), gold=me.gold;
    queueCommand({ type:'colonize', nation:1, tile:ISLAND, ratio:0.5 }); tick();
    expect(me.gold).toBeLessThan(gold*0.52);
    let ticks=0; while (!hasLandOn(1,ISLAND) && ticks++<4000) tick();
    expect(hasLandOn(1,ISLAND)).toBe(true);
    expect(owned(k => k%TW>=SEA_X1)).toBeLessThanOrEqual(2);       // just the landing tile, not the island
    const sizes: number[]=[];
    for (let i=0;i<6;i++){ run(60); sizes.push(owned(k => k%TW>=SEA_X1)); }
    expect(sizes[0]).toBeLessThan(sizes[5]);                        // it spreads, tick by tick, as any settling
    expect(sizes.every((v,i) => i===0 || v>=sizes[i-1])).toBe(true);
    expect(sizes[0]).toBeLessThan(300);                             // and not all at once
    run(1500);
    expect(owned(k => k%TW>=SEA_X1)).toBeGreaterThan(300);
    expect(owned(k => k%TW<SEA_X0)).toBe(mainBefore);               // none of it on the mainland
    expect(ferry.some(v => v===1)).toBe(true);                       // a sea lane for the villagers
    expect(settlePlan(me,ISLAND)).toMatch(/already|ship|Click/);     // (it is settled like the mainland now)
  });
  it('land of the mainland within reach of the shore: the ship lands there and the border spreads from that spot only, not from the rest of the border', () => {
    const me=withBase();
    me.gold=2000;
    queueCommand({ type:'colonize', nation:1, tile:NEAR, ratio:0.3 }); tick();
    let ticks=0; while (W.ships.some(s => s.colony>=0) && ticks++<4000) tick();
    run(30);
    const near=(k: number) => Math.abs((k%TW)-240)<=25 && Math.abs(((k/TW)|0)-30)<=25;
    const faraway=(k: number) => k%TW<200 || ((k/TW)|0)>=120;   // (the old border, away from the landing)
    const before=owned(near);
    expect(before).toBeGreaterThan(0);
    // nothing of the old border moved: the rest of the mainland did not grow (only the landing's patch)
    const elsewhere=owned(k => k%TW<SEA_X0 && faraway(k));
    run(600);
    expect(owned(near)).toBeGreaterThan(before);
    expect(owned(k => k%TW<SEA_X0 && faraway(k))).toBe(elsewhere);
  });
  it('a plain settle, once there is land on the island, spreads over the mainland and the island alike', () => {
    const me=withBase();
    queueCommand({ type:'colonize', nation:1, tile:ISLAND, ratio:0.3 }); tick();
    run(3000);
    const was=me.tiles; me.gold=3000;
    const open=Array.from({ length: NT }, (_, k) => k).find(k => isLand[k] && !owner[k] && k%TW>=SEA_X1 && [k-1,k+1,k-TW,k+TW].some(j => owner[j]===1))!;   // free land beside the colony
    queueCommand({ type:'attack', nation:1, tile:open, ratio:1 }); tick();
    const islandWas=owned(k => k%TW>=SEA_X1), mainWas=owned(k => k%TW<SEA_X0);
    run(600);
    expect(me.tiles).toBeGreaterThan(was+200);
    expect(owned(k => k%TW>=SEA_X1)).toBeGreaterThan(islandWas);   // both grew
    expect(owned(k => k%TW<SEA_X0)).toBeGreaterThan(mainWas);
  });
});

describe('villagers cross by boat', () => {
  it('once a colony stands, villagers walk the sea lane to build houses on the island, and do not need a ship', () => {
    world();
    const me=N(1); me.stock=[100,100,0]; me.gold=4000;
    expect(build(me,shorePlot(),B_NAVAL)).toBe(true); census();
    me.fleet=2; queueCommand({ type:'colonize', nation:1, tile:100*TW+300, ratio:0.5 }); tick();
    run(1500);
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


describe('ships keep to the water', () => {
  it('no stretch of any ship\'s course crosses land, on a real map with coves, peninsulas and islands', () => {
    newWorld(5,'europe-s'); W.rushUntil=0;
    const water: number[]=[]; for (let t=0;t<NT;t+=37) if (!isLand[t] && sea[t]>0) water.push(t);
    let checked=0, bad=0, rng=12345; const rnd=() => (rng=(Math.imul(rng,1103515245)+12345)>>>0)/4294967296;
    for (let k=0;k<400 && checked<60;k++){
      const s=water[(rnd()*water.length)|0], g=water[(rnd()*water.length)|0];
      if (s===g || sea[s]!==sea[g]) continue;
      const path=seaPaths(s,[g]).get(g); if (!path) continue;
      const wp=waypoints(path), pts: number[]=[(s%TW)*2+1,((s/TW)|0)*2+1,...wp];
      for (let i=0;i+3<pts.length;i+=2){
        const ax=pts[i]/2, ay=pts[i+1]/2, bx=pts[i+2]/2, by=pts[i+3]/2, n=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)*10));
        for (let j=0;j<=n;j++){ const x=ax+(bx-ax)*j/n, y=ay+(by-ay)*j/n; if (isLand[Math.floor(y)*TW+Math.floor(x)]){ bad++; break; } }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    expect(bad).toBe(0);
  });
});
