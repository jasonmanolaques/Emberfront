// Trades and the soldier slider: the price of a first building, the limit set by the professionals, and the lock.
import { describe, it, expect, beforeEach } from 'vitest';
import { B_BARRACKS, TW, TH, NP, PW, B_FARM, B_TOWER, B_RESEARCH, B_CARPENTER, RUSH_TICKS, GAME_SPEED } from '../src/core/constants';
import { plotProblem, build } from '../src/sim/buildings';
import { taxRate } from '../src/sim/sim';
import { TIER_XP, TOPICS, R_TAXES, R_HOUSING } from '../src/sim/research';
import { LAND_TAX } from '../src/core/constants';
import { occ, pCenter } from '../src/sim/state';
import { barracksOf } from '../src/sim/population';
import { units, buildUnits } from '../src/sim/army';
import { strike } from '../src/sim/war';
import { makeHuman, doorOf } from '../src/sim/population';
import { tileCost } from '../src/sim/territory';
import { BUILD_TICKS, CARPENT_TICKS, TASK_SUPPLY, TASK_HOME_BUILD, HUMAN_EVERY } from '../src/sim/population';
import { W } from '../src/sim/state';
import { STRUCTURES, structureOf, costFor, RISE } from '../src/sim/buildings';
import { setOwner } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { soldierMax, professionals, H_SOLDIER, H_VILLAGER } from '../src/sim/population';

const me = () => W.nations[1];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };

beforeEach(() => {
  newWorld(12345);
  for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (startMatch((TH/2+dy*3)*TW + TW/2+dx*3, 0)) return;
  }
  throw new Error('no spawn spot');
});

describe('prices', () => {
  it('charge the base price for the first building of a kind, and dearer ones only after that', () => {
    const n=me(), f=structureOf(B_FARM)!;
    n.farms=0; expect(costFor(n,f)).toEqual(f.cost);
    n.farms=10; expect(costFor(n,f)[0]).toBeGreaterThan(f.cost[0]);   // (ten farms: half as dear again)
    n.farms=0;
    for (const s of STRUCTURES) if (RISE[s.type]) expect(costFor(n,s).every(c => Number.isInteger(c))).toBe(true);
  });
  it('round to the nearest whole good: a 2 wood tower is not 3 wood after one', () => {
    const n=me(), t=structureOf(B_TOWER)!;
    n.towers=1; expect(costFor(n,t)).toEqual(t.cost.map(c => Math.round(c*1.05)));
    n.towers=0;
  });
});

describe('the soldier slider and its lock', () => {
  const people = (v: number, s: number, jobs: number[]) => { const n=me(); n.villagers=v; n.soldiers=s; n.jobs=[...jobs]; };

  it('stops at the share of people without a trade: 100 people, 10 of them professionals, 90%', () => {
    people(100,0,[4,3,1,2,0]);
    expect(professionals(me())).toBe(10);
    expect(soldierMax(me())).toBeCloseTo(0.9, 5);
    people(50,50,[0,0,0,0,0]);
    expect(soldierMax(me())).toBe(1);
    people(0,0,[0,0,0,0,0]);
    expect(soldierMax(me())).toBe(1);
  });

  it('clamps a request past the limit, unless the lock is on', () => {
    people(100,0,[4,3,1,2,0]);
    queueCommand({ type: 'soldiers', nation: 1, share: 1 });
    // apply the command without letting the headcount rewrite our numbers: tick once, the limit is read when it applies
    tick();
    expect(me().soldierShare).toBeCloseTo(0.9,5);   // 10 of the 100 have a trade: the slider stops at 90%
    expect(me().draftAll).toBe(false);
    queueCommand({ type: 'draftAll', nation: 1, on: true });
    queueCommand({ type: 'soldiers', nation: 1, share: 1 });
    tick();
    expect(me().draftAll).toBe(true);
    expect(me().soldierShare).toBe(1);
  });

  it('slides the share back to the limit when the lock is turned off', () => {
    const n=me();
    queueCommand({ type: 'draftAll', nation: 1, on: true });
    queueCommand({ type: 'soldiers', nation: 1, share: 1 });
    tick();
    expect(n.soldierShare).toBe(1);
    // nobody has a trade yet, so the limit is the whole population; make it smaller and unlock
    n.jobs=[2,0,0,0,0]; n.villagers=8; n.soldiers=0;
    queueCommand({ type: 'draftAll', nation: 1, on: false });
    tick();
    expect(n.draftAll).toBe(false);
    expect(n.soldierShare).toBeCloseTo(0.75,5);   // 2 of 8 have a trade
  });

  it('counts only the people with a trade as professionals, and starts with none', () => {
    run(5);
    expect(me().jobs).toEqual([0,0,0,0,0]);
    expect(me().unhoused).toBe(0);
    expect(H_SOLDIER).not.toBe(H_VILLAGER);
  });
});

const near = () => { const n=me(), cap=n.capPlot; return Array.from({ length: NP }, (_, q) => q).filter(q => !plotProblem(n,q)).sort((a,b) => ((a%PW-cap%PW)**2+((a/PW|0)-(cap/PW|0))**2)-((b%PW-cap%PW)**2+((b/PW|0)-(cap/PW|0))**2) || a-b); };
const roomy = () => { const c=me().capTile, cx=c%TW, cy=(c/TW)|0; for (let y=Math.max(0,cy-24);y<=Math.min(TH-1,cy+24);y++) for (let x=Math.max(0,cx-24);x<=Math.min(TW-1,cx+24);x++){ const t=y*TW+x; if (!W.nations[0] && false) continue; setOwner(t,1); } census(); };

describe('numbers', () => {
  it('every research topic costs 400 points for the first step, 800 for the next, and so on', () => {
    for (const t of TOPICS) expect(TIER_XP[t].slice(0,3)).toEqual([0,400,800]);
    expect(TIER_XP[6]).toEqual([0,400,800,1200]);
  });
  it('taxation adds 0.5 gold a second a tier to what a villager pays', () => {
    const n=me(); n.tier[R_TAXES]=1; expect(taxRate(n)).toBeCloseTo(0.1,9);
    n.tier[R_TAXES]=2; expect(taxRate(n)).toBeCloseTo(0.6,9);
    n.tier[R_TAXES]=3; expect(taxRate(n)).toBeCloseTo(1.1,9);
  });
  it('a spawned villager takes 15 seconds on the clock to build his home, a carpenter 20', () => {
    expect(BUILD_TICKS).toBe(15*GAME_SPEED*10);
    expect(CARPENT_TICKS).toBe(20*GAME_SPEED*10);
  });
  it('the first minute settles unclaimed land at half price, then at the usual one', () => {
    const t=(me().capTile%TW)+TW*(((me().capTile/TW)|0)+30), full=tileCost(1,0,t)*2;
    expect(W.rushUntil).toBe(RUSH_TICKS);
    expect(W.tickN).toBeLessThan(RUSH_TICKS);
    run(RUSH_TICKS);
    expect(tileCost(1,0,t)).toBeCloseTo(full,9);
  });
});

describe('scholars and the call-up', () => {
  it('a research station employs a scholar: a villager with a trade, who holds the slider back', () => {
    roomy();
    const n=me(); n.stock=[50,50,50]; const [q]=near(); expect(build(n,q,B_RESEARCH)).toBe(true);
    for (let i=0;i<8000 && !W.humans.some(h => h.o===1 && h.work===q);i++) tick();
    run(5);
    expect(n.jobs[4]).toBe(1);
    expect(professionals(n)).toBeGreaterThanOrEqual(1);
    expect(soldierMax(n)).toBeLessThan(1);
  });
  it('with the lock open the professionals are called up as militia', () => {
    roomy();
    const n=me(); n.stock=[50,50,50]; const [q]=near(); expect(build(n,q,B_RESEARCH)).toBe(true);
    for (let i=0;i<8000 && !W.humans.some(h => h.o===1 && h.work===q);i++) tick();
    const scholar=W.humans.find(h => h.o===1 && h.work>=0)!; expect(scholar).toBeDefined();
    queueCommand({ type: 'draftAll', nation: 1, on: true });
    queueCommand({ type: 'soldiers', nation: 1, share: 1 });
    run(400);
    expect(scholar.kind).toBe(H_SOLDIER);
    expect(scholar.militia).toBe(true);
    expect(scholar.work).toBe(-1);
  });
  it('a carpenter walks back to his workshop for materials after each house', () => {
    roomy();
    const n=me(); n.stock=[500,500,500];
    const [q,...rest]=near(); expect(build(n,q,B_CARPENTER)).toBe(true);
    for (let i=0;i<8000 && !W.humans.some(h => h.o===1 && h.work===q);i++) tick();
    const c=W.humans.find(h => h.o===1 && h.work===q)!; expect(c).toBeDefined();
    let sawBuild=false, sawSupply=false;
    for (let i=0;i<CARPENT_TICKS*4 && !sawSupply;i++){ tick(); if (c.task===TASK_HOME_BUILD) sawBuild=true; if (sawBuild && c.task===TASK_SUPPLY) sawSupply=true; }
    void rest;
    expect(sawBuild).toBe(true);
    expect(sawSupply).toBe(true);
  });
});

describe('v70', () => {
  it('the land rush lasts two minutes, and the land tax is twice what it was', () => {
    expect(RUSH_TICKS).toBe(120*GAME_SPEED*10);
    expect(LAND_TAX).toBeCloseTo(0.0008,9);
  });

  it('a research station earns nothing until its scholar stands at its door', () => {
    roomy();
    const n=me(); n.stock=[50,50,50]; const [q]=near(); expect(build(n,q,B_RESEARCH)).toBe(true);
    run(60); expect(n.studying).toBe(0); expect(n.xp[R_HOUSING]).toBe(0);   // (nobody has come yet)
    for (let i=0;i<8000 && n.studying<1;i++) tick();
    expect(n.studying).toBe(1);
    const before=n.xp[R_HOUSING]; run(100);
    expect(n.xp[R_HOUSING]-before).toBe(100);   // (10 points in 10 s)
  });

  it('a barracks on ground the enemy occupies raises and trains no one: it is no barracks until the ground is free', () => {
    roomy();
    const n=me(); n.stock=[50,50,50]; const [q]=near(); expect(build(n,q,B_BARRACKS)).toBe(true);
    buildUnits();
    expect(barracksOf(n)).toContain(q); expect(units[1].length).toBe(1);
    occ[pCenter[q]]=2;   // (as if occupied by kingdom 2)
    buildUnits();
    expect(barracksOf(n)).not.toContain(q); expect(units[1].length).toBe(0);
    occ[pCenter[q]]=0;
    buildUnits(); expect(units[1].length).toBe(1);
  });

  it('every blow that lands is 15% weaker, as it is, or 15% harder', () => {
    const [x,y]=doorOf(me()), a=makeHuman(me(),H_SOLDIER,x,y), b=makeHuman(W.nations[1],H_SOLDIER,x,y);
    const seen=new Set<number>();
    for (let i=0;i<400;i++){ b.hp=1e6; a.cool=0; a.duel=-1; b.duel=-1; strike(a,b); const d=1e6-b.hp; if (d>0) seen.add(Math.round(d*1000)); }
    const v=[...seen].sort((p,r) => p-r); expect(v).toHaveLength(3);
    expect(v.map(d => +(d/v[1]).toFixed(2))).toEqual([0.85,1,1.15]);
  });
});
