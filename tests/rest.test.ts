// Villagers resting at home when there is nothing to do, the counts kept as the map changes, and
// full investment.
import { describe, it, expect } from 'vitest';
import { TW, TH, NP, B_HOUSE, B_GUILD } from '../src/core/constants';
import { build, plotProblem, finishHouse } from '../src/sim/buildings';
import { R_HOUSING } from '../src/sim/research';
import { W, owner, isLand, occ, pType, pIn, pTier, pCenter, resType, resLeft } from '../src/sim/state';
import { newWorld, startMatch, tick } from '../src/sim/sim';
import { setOwner } from '../src/sim/territory';
import { scanContacts } from '../src/sim/census';
import { R_TREE, freeIn, available } from '../src/sim/resources';
import { HOUSE_BEDS } from '../src/sim/research';
import { mayInvest } from '../src/sim/ledger';
import { HUMAN_EVERY as E, H_VILLAGER, TASK_REST, TASK_GATHER, indoors, frontOf } from '../src/sim/population';

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
/** Clears every tree, rock and copper from the map (and the counts kept of them). */
function bare(){
  resType.fill(0); resLeft.fill(0); freeIn.fill(0);
  scanContacts(true);
}

describe('the counts kept as the map changes', () => {
  it('borders, kingdom centres and what is left to gather stay exactly what a scan of the map finds', () => {
    start(987654321, 9);
    run(3000);   // bots settle, gather, fight
    const snap = () => ({ contact: Array.from(W.contact), sums: W.nations.map(n => [n.sumX, n.sumY]), res: W.nations.map(n => [...n.resHere]) });
    const kept = snap();
    scanContacts(true);
    expect(kept).toEqual(snap());
  });

  it('counts the free things to gather in every building plot', () => {
    start(12345, 3); run(1500);
    const count = new Uint16Array(freeIn.length);
    for (let t=0;t<TW*TH;t++) if (available(t)) count[((t/TW|0)>>2)*(TW>>2)+((t%TW)>>2)]++;
    expect(Array.from(freeIn)).toEqual(Array.from(count));
  });
});

describe('resting at home', () => {
  it('sends villagers with nothing to gather into the nearest house with room, out of sight, a bed each', () => {
    start(12345, 0); bare();
    run(10*E);
    const resting = mine().filter(h => h.task===TASK_REST);
    expect(resting.length).toBeGreaterThan(5);
    expect(resting.every(h => indoors(h) && h.kind===H_VILLAGER && h.housed && pType[h.rest]===B_HOUSE)).toBe(true);
    // the houses count who is in (or on the way in), never more than their beds
    const inside = new Map<number, number>();
    for (const h of mine()) if (h.rest>=0) inside.set(h.rest, (inside.get(h.rest) ?? 0)+1);
    for (const [q, k] of inside){ expect(pIn[q]).toBe(k); expect(k).toBeLessThanOrEqual(HOUSE_BEDS[pTier[q]]); }
    // standing at the door of the house
    for (const h of resting){ const [x, y] = frontOf(h.rest); expect(Math.hypot(h.x-x, h.y-y)).toBeLessThan(1); }
  });

  it('wakes the villager resting nearest to new land with a tree on it, and only him', () => {
    start(12345, 0); bare();
    run(10*E);
    const before = mine().filter(h => h.task===TASK_REST);
    // a tree just outside the border, then the tile is settled
    let t=-1; for (let i=0;i<TW*TH && t<0;i++) if (!owner[i] && isLand[i] && !occ[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1)) t=i;
    for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++){ const k=t+dy*TW+dx; if (k!==t && isLand[k] && !owner[k]) setOwner(k, 1); }   // (settled round it: bare ground)
    resType[t]=R_TREE; resLeft[t]=1;
    setOwner(t, 1); tick();
    const going = mine().filter(h => h.task===TASK_GATHER);
    expect(going).toHaveLength(1);
    expect(going[0].res).toBe(t);
    const d = (h: { x: number; y: number }) => Math.hypot(h.x-(t%TW)*2, h.y-((t/TW)|0)*2);
    expect(before.every(h => h===going[0] || d(h)>=d(going[0])-0.01)).toBe(true);   // the nearest one
    expect(mine().filter(h => h.task===TASK_REST)).toHaveLength(before.length-1);
  });

  it('looks for work again every 10 to 12 seconds while resting', () => {
    start(12345, 0); bare(); run(10*E);
    const h = mine().find(h => h.task===TASK_REST)!;
    expect(h.wait).toBeGreaterThan(0); expect(h.wait).toBeLessThanOrEqual(120);
  });
});

describe('the way round the kingdom', () => {
  it('has villagers gather trees the straight way home to which is shut: round the wall, by the walking field', () => {
    start(12345, 0); bare();
    const c=me().capTile, cx=c%TW, cy=(c/TW)|0;
    // a wide kingdom, with a wall of unclaimed ground from the top to near the bottom, 12 tiles east of the castle
    for (let y=cy-25;y<=cy+25;y++) for (let x=cx-20;x<=cx+40;x++){ const t=y*TW+x; if (isLand[t] && !owner[t]) setOwner(t,1); }
    for (let y=cy-25;y<=cy+20;y++) for (let x=cx+12;x<=cx+14;x++) setOwner(y*TW+x,0);
    const trees=[[cx+30,cy],[cx+31,cy+1],[cx+30,cy-2]].map(([x,y]) => y*TW+x);
    for (const t of trees){ resType[t]=R_TREE; resLeft[t]=1; freeIn[((t/TW|0)>>2)*(TW>>2)+((t%TW)>>2)]++; }
    scanContacts(true);
    run(3500);
    expect(trees.map(t => resLeft[t])).toEqual([0,0,0]);   // felled and taken home
    expect(me().stock[0]).toBeGreaterThanOrEqual(13);
  });
});

describe('builders and smiths round a wall', () => {
  it('improve houses the straight way to which is shut', () => {
    start(12345, 0); bare();
    const c=me().capTile, cx=c%TW, cy=(c/TW)|0;
    for (let y=cy-25;y<=cy+25;y++) for (let x=cx-20;x<=cx+40;x++){ const t=y*TW+x; if (isLand[t] && !owner[t]) setOwner(t,1); }
    for (let y=cy-25;y<=cy+20;y++) for (let x=cx+12;x<=cx+14;x++) setOwner(y*TW+x,0);
    scanContacts(true);
    // houses on the far side of the wall, and a guild at home
    const far: number[]=[];
    for (let q=0;q<NP && far.length<3;q++){ const t=pCenter[q]; if (t%TW>=cx+20 && Math.abs(((t/TW)|0)-cy)<8 && !plotProblem(me(),q)){ finishHouse(q,1); far.push(q); } }
    expect(far).toHaveLength(3);
    me().stock=[100,100,100]; me().tier[R_HOUSING]=2; me().invest=1;
    for (let q=0;q<NP;q++) if (!plotProblem(me(),q) && (pCenter[q]%TW)<cx+8){ expect(build(me(),q,B_GUILD)).toBe(true); break; }
    for (let k=0;k<20 && far.some(q => pTier[q]<2);k++){ me().stock=[100,100,100]; run(300); }
    expect(far.map(q => pTier[q])).toEqual([2,2,2]);   // stone houses
  });
});

describe('full investment', () => {
  it('at 100% the builders may spend whatever is in the stockpile, whatever comes in', () => {
    start(12345, 0);
    const n = me(); n.gain.fill(0); n.spend.fill(0);
    n.invest = 0.95; expect(mayInvest(n, [3,3,0])).toBe(false);   // nothing came in this past minute
    n.invest = 1;    expect(mayInvest(n, [3,3,0])).toBe(true);
  });
});
