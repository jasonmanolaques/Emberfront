// Watchtowers and the castle by tier, battle damage, and soldiers' wages.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, T_GRASS, B_FARM, B_TOWER, B_CASTLE, WAGE, UNPAID_TICKS, DESERT_TICKS, SCRAP_GOLD } from '../src/core/constants';
import { W, owner, isLand, terr, resType, resLeft, pBuild, pType, pHp, type Human, type Nation } from '../src/sim/state';
import { newWorld, startMatch, tick, grossIncome } from '../src/sim/sim';
import { listen } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { build, plotProblem, structureOf } from '../src/sim/buildings';
import { H_SOLDIER, H_VILLAGER, makeHuman, doorOf } from '../src/sim/population';
import { declare } from '../src/sim/war';
import { bldHp, wear, TOWER_RELOADS, TOWER_DMGS, TOWER_HP, CASTLE_HP } from '../src/sim/defense';
import { R_TOWERS, R_CASTLE } from '../src/sim/research';

const N = (i: number) => W.nations[i];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
function until(done: () => boolean, max: number){ for (let i=0;i<max;i++){ if (done()) return i; tick(); } throw new Error('timed out'); }
/** A flat, all-grass map with the player in the middle and `rivals` bots that never think. */
function world(rivals: number){
  newWorld(7);
  isLand.fill(1); terr.fill(T_GRASS); resType.fill(0); resLeft.fill(0); pBuild.fill(1);
  W.landTiles=Int32Array.from({ length: NT }, (_, i) => i); W.landCount=NT;
  if (!startMatch((TH/2)*TW+TW/2, rivals)) throw new Error('no spawn');
  for (const n of W.nations.slice(2)){ n.nextThink=1e9; n.nextWar=1e9; }
}
function paintDisc(n: Nation, r: number){
  const cx=n.capTile%TW, cy=(n.capTile/TW)|0;
  for (let y=cy-r;y<=cy+r;y++) for (let x=cx-r;x<=cx+r;x++){ const t=y*TW+x; if ((x-cx)**2+(y-cy)**2<=r*r && !owner[t]) setOwner(t,n.id); }
  census();
}
function place(n: Nation, type: number, near=n.capPlot, far=false){
  const d=(q: number) => ((q%PW-near%PW)**2+((q/PW|0)-(near/PW|0))**2)*(far ? -1 : 1);
  const q=Array.from({ length: NP }, (_, k) => k).filter(k => !plotProblem(n,k)).sort((a,b) => d(a)-d(b))[0];
  n.stock=[...structureOf(type)!.cost]; if (!build(n,q,type)) throw new Error('could not build');
  return q;
}
/** A raider of kingdom 2's, rooted to (x,y) on kingdom 1's land and tough enough to count shots on. */
function dummy(x: number, y: number){
  const e=N(2); paintDisc(e,10); place(e,8);
  const [dx,dy]=doorOf(e), h=makeHuman(e,H_SOLDIER,dx,dy+2); W.humans.push(h); e.soldierShare=1; run(2);
  if (!declare(2,1,true,1)) throw new Error('no raid');
  h.x=x; h.y=y; h.sp=0; h.hp=1000; h.tier=3;
  return h;
}

describe('watchtowers by tier', () => {
  it('shoot every 4, 3.5 and 3 seconds for 2, 3 and 4 damage, and take 20, 30 and 40 blows', () => {
    expect(TOWER_RELOADS.slice(1)).toEqual([40, 35, 30]);
    expect(TOWER_DMGS.slice(1)).toEqual([2, 3, 4]);
    for (const tier of [1,2,3]){
      world(1); paintDisc(N(1),40);
      N(1).tier[R_TOWERS]=tier;
      // a tower 8 plots from the castle, its target on the far side, out of the castle's reach
      const c=N(1).capPlot, q=c+8, tx=(q%PW)*8+4, ty=((q/PW)|0)*8+8;
      N(1).stock=[10,10,10]; expect(build(N(1),q,B_TOWER)).toBe(true);
      expect(bldHp(q)).toBe(TOWER_HP[tier]);
      const e=dummy(tx+16,ty);
      const shots: number[]=[]; listen({ towerShot: (x0) => { if (x0===(q%PW)*8+4) shots.push(W.tickN); } });
      const hp=e.hp; run(200);
      expect(shots.length).toBeGreaterThanOrEqual(3);
      for (let k=1;k<shots.length;k++) expect(shots[k]-shots[k-1]).toBe(TOWER_RELOADS[tier]);
      expect(hp-e.hp).toBe(TOWER_DMGS[tier]*shots.length);
      listen({ towerShot: () => {} });
    }
  });

  it('look battered from half their blows, and don\'t mend', () => {
    world(1); paintDisc(N(1),14);
    const q=place(N(1),B_TOWER);
    pHp[q]=9; expect(wear(q)).toBe(0);
    pHp[q]=10; expect(wear(q)).toBe(1);
    run(100); expect(pHp[q]).toBe(10);
  });
});

describe('the castle by tier', () => {
  it('takes 100, 200 and 300 blows, mends 2 a second, and looks damaged then badly damaged', () => {
    world(1);
    const q=N(1).capPlot;
    expect(pType[q]).toBe(B_CASTLE);
    for (const tier of [1,2,3]){ N(1).tier[R_CASTLE]=tier; expect(bldHp(q)).toBe(CASTLE_HP[tier]); }
    N(1).tier[R_CASTLE]=1;
    pHp[q]=30; expect(wear(q)).toBe(0);
    pHp[q]=40; expect(wear(q)).toBe(1);
    pHp[q]=70; expect(wear(q)).toBe(2);
    run(100); expect(pHp[q]).toBeCloseTo(50, 3);   // 2 a second
    run(400); expect(pHp[q]).toBe(0);
  });

  it('shoots like two watchtowers of its tier: twice as often, as hard', () => {
    for (const tier of [1,3]){
      world(1); paintDisc(N(1),14); place(N(1),B_FARM); N(1).tier[R_CASTLE]=tier;   // something for them to raid
      const [x,y]=doorOf(N(1)), e=dummy(x,y+4);
      const shots: number[]=[]; listen({ towerShot: (_x0,_y0,_x1,_y1,_k,v) => { if (v===e.id) shots.push(W.tickN); } });
      const hp=e.hp; run(TOWER_RELOADS[tier]*5);
      expect(shots.length).toBeGreaterThanOrEqual(9);
      expect(shots.length).toBeLessThanOrEqual(11);
      expect(hp-e.hp).toBeGreaterThanOrEqual(TOWER_DMGS[tier]*shots.length);   // (villagers with pitchforks may add some)
      expect(hp-e.hp).toBeLessThan(TOWER_DMGS[tier]*shots.length+5);
      listen({ towerShot: () => {} });
    }
  });
});

describe('invaders and towers', () => {
  it('break off from a farm to go for a watchtower that can shoot them', () => {
    world(1); paintDisc(N(2),20);
    const farm=place(N(2),B_FARM,N(1).capPlot), tower=place(N(2),B_TOWER,N(1).capPlot);
    const men: Human[]=[]; const [x,y]=doorOf(N(1));
    for (let i=0;i<5;i++){ const h=makeHuman(N(1),H_SOLDIER,x+i,y); W.humans.push(h); men.push(h); }
    N(1).stock=[50,50,50]; place(N(1),8);   // a barracks for them
    run(2); N(1).soldierShare=1;
    expect(declare(1,2,true,5)).toBe(true);
    until(() => men.some(h => h.aim>=0), 4000);
    run(20);
    expect(men.filter(h => h.aim===tower).length).toBeGreaterThan(men.filter(h => h.aim===farm).length);
  });
});

describe('wages', () => {
  it('cost 0.15 gold a second a soldier, and the treasury may go below zero', () => {
    world(0);
    const [x,y]=doorOf(N(1));
    for (let i=0;i<10;i++) W.humans.push(makeHuman(N(1),H_SOLDIER,x,y));
    N(1).soldierShare=1; N(1).humanProg=-1e9; run(2);
    expect(N(1).income).toBeCloseTo(grossIncome(N(1))-10*WAGE, 6);
    expect(WAGE).toBe(0.15);
    N(1).gold=-5; run(1);
    expect(N(1).gold).toBeLessThan(0);
  });

  it('unpaid for 10 seconds, soldiers lay down their arms one every 3 seconds, the least armoured first, their armour scrapped for 30 gold a tier', () => {
    world(0);
    const [x,y]=doorOf(N(1)), men: Human[]=[];
    for (const t of [3,1,2,1]){ const h=makeHuman(N(1),H_SOLDIER,x,y+2); h.tier=t; W.humans.push(h); men.push(h); }
    N(1).soldierShare=1; N(1).humanProg=-1e9;
    const gone: number[][]=[]; listen({ deserted: (o,_x,_y,tier,gold) => { gone.push([o,tier,gold]); } });
    N(1).gold=-1000;
    run(UNPAID_TICKS-2); expect(gone).toHaveLength(0);
    run(3); expect(gone).toHaveLength(1);
    run(DESERT_TICKS); expect(gone).toHaveLength(2);
    run(DESERT_TICKS*2);
    expect(gone.map(g => g[1])).toEqual([1,1,2,3]);                         // the least armoured first
    expect(gone.map(g => g[2])).toEqual([0,0,2*SCRAP_GOLD,3*SCRAP_GOLD]);   // armour scrapped for gold
    expect(men.every(h => h.kind===H_VILLAGER && h.tier===0)).toBe(true);
    expect(W.humans.filter(h => h.o===1 && h.kind===H_SOLDIER)).toHaveLength(0);   // and nobody signs up unpaid
    listen({ deserted: () => {} });
  });

  it('stops counting once the treasury is back above zero', () => {
    world(0);
    const [x,y]=doorOf(N(1)); W.humans.push(makeHuman(N(1),H_SOLDIER,x,y));
    N(1).soldierShare=1; N(1).humanProg=-1e9;
    N(1).gold=-1; run(UNPAID_TICKS-10);
    N(1).gold=100; run(1); expect(N(1).unpaid).toBe(0);
  });
});
