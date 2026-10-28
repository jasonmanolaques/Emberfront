// Buildings a kingdom places, and the gold economy.
import { describe, it, expect } from 'vitest';
import { TW, TH, NP, PW, NT, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_RESEARCH, B_GUILD, B_SMITHY, B_FARM, B_BARRACKS, B_TOWER, B_MINTER, B_HOUSE, B_CASTLE, B_CPART, B_EMPTY, B_RUINS, B_SITE, GOLD_START, GOLD_PER_TILE, TAX_PER_VILLAGER, STR_TILE, STR_VILLAGER, STR_SOLDIER, STR_GOLD } from '../src/core/constants';
import { W, owner, isLand, pType, pCenter, pBuild, type Human } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen } from '../src/sim/events';
import { setOwner, tileCost } from '../src/sim/territory';
import { STRUCTURES, structureOf, build, plotProblem, placeProblem } from '../src/sim/buildings';
import { HUMAN_EVERY as E, H_SOLDIER, H_VILLAGER, SOLDIER_HP, frontOf, doorOf, switching, makeHuman } from '../src/sim/population';
import { declare } from '../src/sim/war';

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
    expect(structureOf(B_PLANTATION)!.cost).toEqual([10,0,0]);
    expect(structureOf(B_QUARRY)!.cost).toEqual([3,5,0]);
    expect(structureOf(B_COPPERMINE)!.cost).toEqual([10,10,0]);
    expect(structureOf(B_RESEARCH)!.cost).toEqual([15,15,10]);
    expect(structureOf(B_GUILD)!.cost).toEqual([10,20,5]);
    expect(structureOf(B_SMITHY)!.cost).toEqual([10,15,5]);
    expect(STRUCTURES).toHaveLength(10);
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

  it('only gets houses without asking (its villagers build them); everything else is built on purpose', () => {
    start(987654321, 0); expand(10); run(2000);
    const types = new Set<number>();
    for (let q=0;q<NP;q++) if (owner[pCenter[q]]===1) types.add(pType[q]);
    expect(types.has(B_HOUSE)).toBe(true);
    for (const t of types) expect([B_EMPTY, B_HOUSE, B_SITE, B_CASTLE, B_CPART, B_RUINS]).toContain(t);   // (a house going up)
  });
});

describe('what the buildings do', () => {
  it('farms bring new humans 5% sooner each', () => {
    start(12345, 0); run(10*E);
    expect(W.humanSeq).toBe(10);   // (born: the last may have no house yet, and some may end up beggars)
    start(12345, 0); expand(3);
    const plots=freePlots();
    for (let k=0;k<4;k++) place(B_FARM, plots[k]);
    const before=mine().length, t0=W.tickN, p0=me().humanProg;
    run(10*E);
    expect(mine().length-before).toBe(Math.floor((p0+10*E*1.2)/E) - Math.floor(p0/E));   // 4 farms: 20% faster
    expect(W.tickN-t0).toBe(10*E);
  });

  it('earns nothing but tax, and coin minters add 10% to it', () => {
    start(12345, 0);
    me().humanProg=-1e9;   // nobody arrives, so there is nobody to pay tax
    const g0=me().gold; run(100);
    expect(me().gold).toBe(g0);   // no passive income
    start(12345, 0); expand(3); run(10*E);   // (room for the minters beside the houses)
    const n=me(); n.humanProg=-1e9;
    expect(n.taxpayers).toBeGreaterThan(0);
    expect(n.income).toBeCloseTo(TAX_PER_VILLAGER*n.taxpayers, 9);
    place(B_MINTER, freePlots()[0]); place(B_MINTER, freePlots()[0]); tick();
    expect(n.income).toBeCloseTo(TAX_PER_VILLAGER*n.taxpayers*1.2, 9);
  });

  it('keeps its army of 5 waiting at the barracks; soldiers with no room patrol the city', () => {
    start(12345, 0); expand(4);
    const b=place(B_BARRACKS);
    run(10*E); queueCommand({ type: 'soldiers', nation: 1, share: 0.6 }); run(600);
    const [bx, by]=frontOf(b), soldiers=mine().filter(h => h.kind===H_SOLDIER && !switching(h));
    expect(soldiers.length).toBeGreaterThan(6);
    run(100);
    const army=soldiers.filter(h => h.base>=0), patrol=soldiers.filter(h => h.base<0);
    expect(army).toHaveLength(5);
    for (const h of army) expect(Math.hypot(h.x-bx, h.y-by)).toBeLessThan(16);
    const [cx, cy]=doorOf(me());
    for (const h of patrol) expect(Math.hypot(h.x-cx, h.y-cy)).toBeLessThan(50);   // round the castle
  });

  it('splits 5 soldiers without room in a barracks 3 and 2 between two watchtowers calling for a garrison', () => {
    start(12345, 0); expand(8);
    const plots=freePlots(); place(B_BARRACKS, plots[0]); const t1=place(B_TOWER, plots[3]), t2=place(B_TOWER, plots[6]);
    while (mine().length<10) tick();
    me().humanProg = -1e9;   // no more newcomers, so the kingdom stays at 10 people
    queueCommand({ type: 'soldiers', nation: 1, share: 1 });   // 10 soldiers: 5 in the barracks' army, 5 patrolling
    for (let i=0;i<3000 && (mine().some(switching) || mine().filter(h => h.kind===H_SOLDIER).length<10);i++) tick();
    expect(mine().filter(h => h.kind===H_SOLDIER)).toHaveLength(10);
    expect(mine().filter(h => h.base<0)).toHaveLength(5);
    queueCommand({ type: 'priority', nation: 1, plot: t1 });
    queueCommand({ type: 'priority', nation: 1, plot: t2 });
    tick();
    const at=(q: number)=>mine().filter(h => h.post===q).length;
    expect([at(t1), at(t2)]).toEqual([3, 2]);
    // they walk over and stand guard
    run(400);
    const [x1, y1]=frontOf(t1);
    for (const h of mine().filter(h => h.post===t1)) expect(Math.hypot(h.x-x1, h.y-y1)).toBeLessThan(20);
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

  it('holds its fire at peace; at war it shoots enemy soldiers on its own land, 2 damage every 4 seconds, and not those outside', () => {
    start(12345, 1); expand(3);
    W.nations[2].nextThink=1e9;   // the bot stays out of it
    const tower=place(B_TOWER), [tx, ty]=frontOf(tower), ox=(tower%PW)*8+4;
    const near=(want: (t: number) => boolean) => { let spot=-1, best=Infinity;
      for (let t=0;t<NT;t++){ if (!isLand[t] || !want(t)) continue; const d=Math.hypot((t%TW)*2+1-tx, ((t/TW)|0)*2+1-ty); if (d<best){ best=d; spot=t; } } return [spot, best]; };
    const [inside]=near(t => owner[t]===1 && Math.hypot((t%TW)*2+1-tx, ((t/TW)|0)*2+1-ty)>6), [outside, out]=near(t => !owner[t]);
    expect(out).toBeLessThan(20);
    const mk=(t: number): Human => { const h=makeHuman(W.nations[2], H_SOLDIER, (t%TW)*2+1, ((t/TW)|0)*2+1.5); h.sp=0; h.wait=1e9; W.humans.push(h); return h; };
    const soldier=mk(outside), raider=mk(outside);
    // they are the army of a barracks of the bot's, so they can be sent
    const bq=W.nations[2].plots.find(q => !placeProblem(W.nations[2],q,B_BARRACKS))!; W.nations[2].stock=[50,50,50]; build(W.nations[2],bq,B_BARRACKS);
    soldier.base=raider.base=bq; W.nations[2].soldierShare=1;
    const shots: { from: number; tick: number; x: number }[]=[];
    listen({ towerShot: (x0,_y0,x1) => { shots.push({ from:x0, tick:W.tickN, x:x1 }); } });
    run(100);
    expect(shots).toHaveLength(0);
    // the enemy raids us with both; one comes onto our land, the other stays outside
    expect(declare(2, 1, true, 2)).toBe(true);
    raider.x=(inside%TW)*2+1; raider.y=((inside/TW)|0)*2+1.5; raider.hp=100;   // tough, so the castle's shots don't end the count
    run(170);
    const fromTower=shots.filter(s => s.from===ox);
    expect(fromTower.length).toBeGreaterThanOrEqual(3);
    for (let k=1;k<fromTower.length;k++) expect(fromTower[k].tick-fromTower[k-1].tick).toBe(40);   // once every 4 seconds
    expect(shots.every(s => s.x===raider.x)).toBe(true);           // nobody shoots past the border
    expect(soldier.hp).toBe(SOLDIER_HP[1]);
    expect(100-raider.hp).toBeGreaterThanOrEqual(2*shots.length-1e-6);   // 2 damage a shot (villagers with pitchforks may add some)
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

  it('settles unclaimed land at 0.5 gold a tile, and gives back what it did not spend', () => {
    start(12345, 0);
    me().humanProg=-1e9;   // nobody arrives, so no tax comes in meanwhile
    const g0=me().gold, tiles0=me().tiles;
    queueCommand({ type: 'attack', nation: 1, tile: (() => { for (let i=0;i<NT;i++) if (!owner[i] && isLand[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1)) return i; return -1; })(), ratio: 0.5 });
    let ticks=0; tick(); ticks++;
    while (W.attacks.some(A => !A.done)){ tick(); ticks++; }
    const gained=me().tiles-tiles0;
    expect(gained).toBeGreaterThan(100);
    expect(g0 - me().gold).toBeCloseTo(gained*GOLD_PER_TILE, 6);
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
