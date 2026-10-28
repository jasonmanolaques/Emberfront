// Resources on the map, and villagers gathering them.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, T_GRASS, T_DRY, T_FOREST, T_DESERT, T_HILLS, T_MOUNT, B_HOUSE, B_MINE } from '../src/core/constants';
import { W, terr, isLand, owner, pType, resType, resLeft, resBusy } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { R_TREE, R_TWIG, R_STONE, R_COPPER, G_WOOD, G_STONE, G_COPPER, YIELD, harvest, resourceCensus } from '../src/sim/resources';
import { H_SOLDIER, H_VILLAGER, TASK_ROAM, TASK_GATHER, TASK_HARVEST, TASK_HAUL, TASK_STORE, chooseGood } from '../src/sim/population';

const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
const mine = () => W.humans.filter(h => h.o === 1);
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
    run(30);
  }
}

describe('resources on the map', () => {
  // densities per terrain, pooled over several maps
  const tiles = new Array(11).fill(0), per = Array.from({ length: 11 }, () => [0,0,0,0,0]);
  let nearStone = 0, nearTiles = 0, farStone = 0, farTiles = 0;
  for (const seed of [1, 2, 3, 4]){
    newWorld(seed);
    for (let t=0;t<NT;t++) if (isLand[t]) tiles[terr[t]]++;
    resourceCensus().forEach((row, tr) => row.forEach((c, r) => per[tr][r] += c));
    // stone on ordinary ground close to mountains versus far from them
    for (let y=3;y<TH-3;y++) for (let x=3;x<TW-3;x++){
      const t=y*TW+x; if (!isLand[t] || (terr[t]!==T_GRASS && terr[t]!==T_FOREST)) continue;
      let near=false; for (let dy=-3;dy<=3 && !near;dy++) for (let dx=-3;dx<=3;dx++) if (terr[t+dy*TW+dx]===T_MOUNT){ near=true; break; }
      if (near){ nearTiles++; nearStone += +(resType[t]===R_STONE); } else { farTiles++; farStone += +(resType[t]===R_STONE); }
    }
  }
  const density = (tr: number, r: number) => per[tr][r] / tiles[tr];

  it('puts the most copper in deserts', () => {
    for (const tr of [T_GRASS, T_DRY, T_FOREST, T_HILLS, T_MOUNT]) expect(density(T_DESERT, R_COPPER)).toBeGreaterThan(2*density(tr, R_COPPER));
  });
  it('puts the most stone on mountains, and more of it near mountains', () => {
    for (const tr of [T_GRASS, T_DRY, T_FOREST, T_DESERT, T_HILLS]) expect(density(T_MOUNT, R_STONE)).toBeGreaterThan(2*density(tr, R_STONE));
    expect(density(T_HILLS, R_STONE)).toBeGreaterThan(3*density(T_GRASS, R_STONE));
    expect(nearStone/nearTiles).toBeGreaterThan(4*farStone/farTiles);
  });
  it('grows healthy trees in temperate land and dry twiggy ones in deserts and savanna', () => {
    expect(density(T_FOREST, R_TREE)).toBeGreaterThan(0.2);   // (at half the density of old)
    expect(density(T_GRASS, R_TREE)).toBeGreaterThan(0.005);
    expect(per[T_DESERT][R_TREE] + per[T_DRY][R_TREE]).toBe(0);
    expect(density(T_DRY, R_TWIG)).toBeGreaterThan(0.01);
    expect(density(T_DESERT, R_TWIG)).toBeGreaterThan(0.005);
    expect(per[T_FOREST][R_TWIG] + per[T_GRASS][R_TWIG]).toBe(0);
  });
  it('scatters some stone and copper almost everywhere', () => {
    for (const tr of [T_GRASS, T_DRY, T_FOREST, T_DESERT, T_HILLS, T_MOUNT]){
      expect(per[tr][R_STONE]).toBeGreaterThan(0);
      expect(per[tr][R_COPPER]).toBeGreaterThan(0);
    }
  });
  it('is the same for the same seed', () => {
    newWorld(77); const a = Array.from(resType); newWorld(77);
    expect(Array.from(resType)).toEqual(a);
  });
});

describe('harvesting', () => {
  it('gives 1 per harvest of every kind: healthy or twiggy tree, rock or copper', () => {
    newWorld(5);
    const first = (r: number) => { for (let t=0;t<NT;t++) if (resType[t]===r) return t; throw new Error('none of '+r); };
    expect(harvest(first(R_TREE))).toBe(1);
    expect(harvest(first(R_TWIG))).toBe(1);
    expect(harvest(first(R_STONE))).toBe(1);
    expect(harvest(first(R_COPPER))).toBe(1);
  });
  it('fells a tree in one harvest, takes three from a rock, and never grows them back: used up, they are gone', () => {
    newWorld(5);
    const tree = resType.indexOf(R_TREE), rock = resType.indexOf(R_STONE);
    harvest(tree); expect(resLeft[tree]).toBe(0); expect(harvest(tree)).toBe(0);
    harvest(rock); harvest(rock); expect(resLeft[rock]).toBe(1); harvest(rock); expect(resLeft[rock]).toBe(0);
    run(3000);
    expect(resLeft[tree]).toBe(0); expect(resLeft[rock]).toBe(0);
    expect([resType[tree], resType[rock]]).toEqual([0, 0]);   // no stump or gravel left behind
  });
});

describe('villagers at work', () => {
  it('walk to a resource, harvest it, carry it home and store it, then pick the next job', () => {
    start(12345, 0); expand(6);
    const stored: number[][] = []; listen({ stored: (id, good, amount) => { if (id===1) stored.push([good, amount]); } });
    // follow a villager from the moment it sets off on a job until it is back out thinking
    let h = mine().find(h => h.task===TASK_GATHER);
    while (!h){ tick(); h = mine().find(h => h.task===TASK_GATHER); }
    const seen: number[] = [h.task];
    let carried = -1, carriedAmount = 0, from = resType[h.res];
    const stockBefore = [...W.nations[1].stock];
    for (let i=0;i<3000 && !(seen.includes(TASK_STORE) && h.task!==TASK_STORE);i++){
      if (h.task===TASK_GATHER || h.task===TASK_HARVEST) from = resType[h.res];
      tick();
      if (seen.at(-1)!==h.task) seen.push(h.task);
      if (h.task===TASK_HAUL){ carried = h.carry; carriedAmount = h.amount; }
      if (h.task===TASK_GATHER || h.task===TASK_HARVEST) expect(h.carry).toBe(-1);
    }
    expect(seen.slice(0,4)).toEqual([TASK_GATHER, TASK_HARVEST, TASK_HAUL, TASK_STORE]);
    expect([TASK_ROAM, TASK_GATHER]).toContain(seen[4]);   // back out, deciding on the next job
    expect(carriedAmount).toBe(YIELD[from]);
    expect(stored).toContainEqual([carried, carriedAmount]);
    expect(W.nations[1].stock[carried]).toBeGreaterThanOrEqual(stockBefore[carried] + carriedAmount);
    expect(h.carry).toBe(-1);
    listen({ stored: () => {} });
  });

  it('never send two villagers to the same spot', () => {
    start(987654321, 9); run(2000);
    const claims = W.humans.filter(h => h.res>=0).map(h => h.res);
    expect(claims.length).toBeGreaterThan(10);
    expect(new Set(claims).size).toBe(claims.length);
    expect(resBusy.reduce((a, b) => a+b, 0)).toBe(claims.length);
  });

  it('fills every kingdom stockpile, and never lets soldiers gather', () => {
    start(987654321, 9); queueCommand({ type: 'soldiers', nation: 1, share: 0.5 });
    for (let i=0;i<2500;i++){
      tick();
      for (const h of W.humans) if (h.kind===H_SOLDIER){
        expect(h.carry).toBe(-1); expect(h.res).toBe(-1);
        expect([TASK_GATHER, TASK_HARVEST, TASK_HAUL, TASK_STORE]).not.toContain(h.task);
      }
    }
    const working = W.nations.slice(1).filter(n => n.alive && n.capTile>=0 && n.villagers>3);
    expect(working.length).toBeGreaterThan(4);
    for (const n of working) expect(n.stock[G_WOOD] + n.stock[G_STONE] + n.stock[G_COPPER]).toBeGreaterThan(0);
    expect(W.nations.slice(1).some(n => n.stock[G_COPPER] > 0)).toBe(true);
  });

  it('drop their loads and stop gathering when the capital falls', () => {
    start(12345, 0); expand(6); run(1500);
    expect(mine().some(h => h.kind===H_VILLAGER && h.task!==TASK_ROAM)).toBe(true);
    const capTile = W.nations[1].capTile;
    setOwner(capTile, 0); tick();
    const stock = [...W.nations[1].stock];
    run(400);
    expect(W.nations[1].stock).toEqual(stock);
    expect(mine().every(h => h.carry===-1 && h.res===-1)).toBe(true);
  });

  it('clear the trees and rocks from a plot when a building goes up', () => {
    start(987654321, 9); run(1500);
    let built = 0;
    for (let q=0;q<NP;q++){
      if (pType[q]<B_HOUSE || pType[q]>B_MINE) continue; built++;
      const px=(q%PW)*4, py=((q/PW)|0)*4;
      for (let y=py;y<py+4;y++) for (let x=px;x<px+4;x++) expect(resType[y*TW+x]).toBe(0);
    }
    expect(built).toBeGreaterThan(20);
  });
});

describe('choosing what to fetch', () => {
  it('takes the nearest when the stockpile is even', () => {
    expect(chooseGood([10,10,10], [30,5,20])).toBe(G_STONE);
  });
  it('goes for what the kingdom lacks when distances are equal', () => {
    expect(chooseGood([50,40,0], [20,20,20])).toBe(G_COPPER);
    expect(chooseGood([0,40,50], [20,20,20])).toBe(G_WOOD);
  });
  it('still fetches a plentiful good if the scarce one is far away', () => {
    expect(chooseGood([90,10,0], [4,10,400])).toBe(G_STONE);   // stone is short and close; copper is shortest but very far
    expect(chooseGood([30,30,30], [4,200,200])).toBe(G_WOOD);
  });
  it('skips goods out of reach and gives up when nothing is in reach', () => {
    expect(chooseGood([100,0,0], [5,Infinity,Infinity])).toBe(G_WOOD);
    expect(chooseGood([0,0,0], [Infinity,Infinity,Infinity])).toBe(-1);
  });
});
