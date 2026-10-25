// Buildings a kingdom places, and the gold economy.
import { describe, it, expect } from 'vitest';
import { TW, TH, NP, PW, NT, B_FARM, B_BARRACKS, B_TOWER, B_MINTER, B_HOUSE, B_CASTLE, B_CPART, B_EMPTY, B_RUINS, GOLD_START, STR_TILE, STR_VILLAGER, STR_SOLDIER, STR_GOLD } from '../src/core/constants';
import { W, owner, isLand, pType, pCenter, pBuild, type Human } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen } from '../src/sim/events';
import { setOwner, tileCost } from '../src/sim/territory';
import { STRUCTURES, structureOf, build, plotProblem } from '../src/sim/buildings';
import { H_SOLDIER, H_VILLAGER, SOLDIER_HP, frontOf, switching } from '../src/sim/population';

const me = () => W.nations[1];
const mine = () => W.humans.filter(h => h.o === 1);
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
    if (t>=0) queueCommand({ type: 'attack', nation: 1, tile: t, ratio: 0.8 });
    run(40);
  }
}
/** Free plots of the player's, nearest the capital first. */
function freePlots(){
  const n=me(), cap=n.capPlot, out: number[]=[];
  for (let q=0;q<NP;q++) if (!plotProblem(n,q)) out.push(q);
  return out.sort((a,b)=>((a%PW-cap%PW)**2+((a/PW|0)-(cap/PW|0))**2)-((b%PW-cap%PW)**2+((b/PW|0)-(cap/PW|0))**2));
}
function place(type: number, q = freePlots()[0]){
  me().stock=[...structureOf(type)!.cost];
  if (!build(me(), q, type)) throw new Error('could not build');
  return q;
}

describe('building costs and placement', () => {
  it('costs what the design says', () => {
    expect(structureOf(B_FARM)!.cost).toEqual([5,2,0]);
    expect(structureOf(B_BARRACKS)!.cost).toEqual([5,5,0]);
    expect(structureOf(B_TOWER)!.cost).toEqual([2,5,1]);
    expect(structureOf(B_MINTER)!.cost).toEqual([5,5,5]);
    expect(STRUCTURES.map(s => s.type).sort()).toEqual([B_FARM, B_TOWER, B_BARRACKS, B_MINTER].sort());
  });

  it('takes the resources and places the building, but only if they are all there', () => {
    start(12345, 0);
    const q=freePlots()[0];
    me().stock=[5,4,0];
    expect(build(me(), q, B_BARRACKS)).toBe(false);   // one stone short
    expect(pType[q]).toBe(B_EMPTY);
    me().stock=[7,6,1];
    expect(build(me(), q, B_BARRACKS)).toBe(true);
    expect(pType[q]).toBe(B_BARRACKS);
    expect(me().stock).toEqual([2,1,1]);
    expect(me().barracks).toBe(1);
  });

  it('refuses plots that are taken, outside the kingdom, or under the castle', () => {
    start(12345, 0);
    const q=place(B_FARM);
    me().stock=[50,50,50];
    expect(plotProblem(me(), q)).toBeTruthy();
    expect(plotProblem(me(), me().capPlot)).toBeTruthy();
    const outside = Array.from({ length: NP }, (_, k) => k).find(k => pBuild[k] && owner[pCenter[k]]===0)!;
    expect(plotProblem(me(), outside)).toBe('Build on your own land');
    expect(build(me(), outside, B_FARM)).toBe(false);
  });

  it('places buildings through the command queue, as a player click does', () => {
    start(12345, 0);
    const q=freePlots()[0];
    me().stock=[5,2,0];
    queueCommand({ type: 'build', nation: 1, plot: q, kind: B_FARM });
    expect(pType[q]).toBe(B_EMPTY);   // nothing happens until the next tick
    tick();
    expect(pType[q]).toBe(B_FARM);
  });

  it('only grows houses by itself; everything else is built on purpose', () => {
    start(987654321, 0); expand(10); run(2000);
    const types = new Set<number>();
    for (let q=0;q<NP;q++) if (owner[pCenter[q]]===1) types.add(pType[q]);
    expect(types.has(B_HOUSE)).toBe(true);
    for (const t of types) expect([B_EMPTY, B_HOUSE, B_CASTLE, B_CPART, B_RUINS]).toContain(t);
  });
});

describe('what the buildings do', () => {
  it('farms bring new humans 5% sooner each', () => {
    start(12345, 0); run(1000);
    expect(mine()).toHaveLength(10);
    start(12345, 0); expand(3);
    const plots=freePlots();
    for (let k=0;k<4;k++) place(B_FARM, plots[k]);
    const before=mine().length, t0=W.tickN, p0=me().humanProg;
    run(1000);
    expect(mine().length-before).toBe(Math.floor((p0+1000*1.2)/100) - Math.floor(p0/100));   // 4 farms: 20% faster
    expect(W.tickN-t0).toBe(1000);
  });

  it('coin minters add 10% to the 5 gold a second each', () => {
    start(12345, 0);
    const g0=me().gold; run(100);
    expect(me().gold-g0).toBeCloseTo(50, 6);
    place(B_MINTER, freePlots()[0]); place(B_MINTER, freePlots()[0]);
    const g1=me().gold; run(100);
    expect(me().gold-g1).toBeCloseTo(60, 6);
  });

  it('keeps idle soldiers waiting at the barracks', () => {
    start(12345, 0); expand(4);
    const b=place(B_BARRACKS);
    run(1000); queueCommand({ type: 'soldiers', nation: 1, share: 0.5 }); run(600);
    const [bx, by]=frontOf(b), soldiers=mine().filter(h => h.kind===H_SOLDIER && !switching(h));
    expect(soldiers.length).toBeGreaterThan(3);
    run(100);
    for (const h of soldiers) expect(Math.hypot(h.x-bx, h.y-by)).toBeLessThan(16);
  });

  it('splits 5 idle soldiers 3 and 2 between two watchtowers calling for a garrison', () => {
    start(12345, 0); expand(8);
    const plots=freePlots(); place(B_BARRACKS, plots[0]); const t1=place(B_TOWER, plots[3]), t2=place(B_TOWER, plots[6]);
    while (mine().length<10) tick();
    me().humanProg = -1e9;   // no more newcomers, so the kingdom stays at 10 people
    queueCommand({ type: 'soldiers', nation: 1, share: 0.5 });
    for (let i=0;i<2000 && (mine().some(switching) || mine().filter(h => h.kind===H_SOLDIER).length<5);i++) tick();
    expect(mine().filter(h => h.kind===H_SOLDIER)).toHaveLength(5);
    queueCommand({ type: 'priority', nation: 1, plot: t1 });
    queueCommand({ type: 'priority', nation: 1, plot: t2 });
    tick();
    const at=(q: number)=>mine().filter(h => h.post===q).length;
    expect([at(t1), at(t2)]).toEqual([3, 2]);
    // they walk over and stand guard
    run(400);
    const [x1, y1]=frontOf(t1);
    for (const h of mine().filter(h => h.post===t1)) expect(Math.hypot(h.x-x1, h.y-y1)).toBeLessThan(16);
    // the first tower stands down: its guards go back, and the second fills up to 5
    queueCommand({ type: 'priority', nation: 1, plot: t1 }); tick();
    expect([at(t1), at(t2)]).toEqual([0, 5]);
  });

  it('lets only the owner call a garrison, and only to a watchtower', () => {
    start(12345, 1);
    const farm=place(B_FARM);
    queueCommand({ type: 'priority', nation: 1, plot: farm }); tick();
    const tower=place(B_TOWER);
    queueCommand({ type: 'priority', nation: 2, plot: tower }); tick();
    expect(mine().filter(h => h.post>=0)).toHaveLength(0);
  });

  it('shoots enemy soldiers in range until they fall, and leaves villagers alone', () => {
    start(12345, 1); expand(3);
    const tower=place(B_TOWER), [tx, ty]=frontOf(tower);
    // an enemy soldier and villager standing on unclaimed ground just outside the border, in range
    let spot=-1, best=Infinity;
    for (let t=0;t<NT;t++){ if (!isLand[t] || owner[t]) continue; const d=Math.hypot((t%TW)*2+1-tx, ((t/TW)|0)*2+1-ty); if (d<best){ best=d; spot=t; } }
    expect(best).toBeLessThan(20);
    const mk=(kind: number): Human => ({ id: 90000+kind, o: 2, kind, task: 0, x: (spot%TW)*2+1, y: ((spot/TW)|0)*2+1.5, tx: (spot%TW)*2+1, ty: ((spot/TW)|0)*2+1.5,
      path: [], wait: 1e9, sp: 0, res: -1, carry: -1, amount: 0, hp: SOLDIER_HP, post: -1, site: -1 });
    const soldier=mk(H_SOLDIER), villager=mk(H_VILLAGER);
    W.humans.push(soldier, villager);
    let shots=0; listen({ towerShot: () => { shots++; } });
    run(16);
    expect(soldier.hp).toBe(SOLDIER_HP-1);
    run(15*SOLDIER_HP);
    expect(W.humans.includes(soldier)).toBe(false);
    expect(W.humans.includes(villager)).toBe(true);
    expect(villager.hp).toBe(SOLDIER_HP);
    expect(shots).toBe(SOLDIER_HP);
    listen({ towerShot: () => {} });
  });
});

describe('gold and strength', () => {
  it('starts every kingdom with gold and adds it up in strength: land, villagers, soldiers and gold', () => {
    start(987654321, 9); run(1500);
    for (const n of W.nations.slice(1)){
      if (!n.alive) continue;
      expect(n.strength).toBeCloseTo(n.tiles*STR_TILE + n.villagers*STR_VILLAGER + n.soldiers*STR_SOLDIER + n.gold*STR_GOLD, 6);
    }
    start(12345, 0);
    expect(me().gold).toBe(GOLD_START);
  });

  it('settles unclaimed land at 1 gold a tile, and gives back what it did not spend', () => {
    start(12345, 0);
    const g0=me().gold, tiles0=me().tiles;
    queueCommand({ type: 'attack', nation: 1, tile: (() => { for (let i=0;i<NT;i++) if (!owner[i] && isLand[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1)) return i; return -1; })(), ratio: 0.5 });
    let ticks=0; tick(); ticks++;
    while (W.attacks.some(A => !A.done)){ tick(); ticks++; }
    const earned=ticks*0.5, gained=me().tiles-tiles0;
    expect(gained).toBeGreaterThan(100);
    expect(g0 + earned - me().gold).toBeCloseTo(gained, 6);
  });

  it('charges more for enemy land the stronger the defender is for its size, and more near its watchtowers', () => {
    start(987654321, 9); run(1200);
    const a=1;
    for (let t=0;t<NT;t++){
      const d=owner[t]; if (!d || d===a) continue;
      const c=tileCost(a,d,t);
      expect(c).toBeGreaterThan(1);
      const D=W.nations[d], g=D.gold;
      D.strength+=D.tiles*4;                       // as if it were far stronger
      expect(tileCost(a,d,t)).toBeGreaterThan(c);
      D.strength-=D.tiles*4; D.gold=g;
      break;
    }
  });

  it('loses a quarter of its gold when its capital falls', () => {
    start(12345, 0);
    const g=me().gold;
    setOwner(me().capTile, 0);
    expect(me().gold).toBeCloseTo(g*0.75, 6);
  });
});
