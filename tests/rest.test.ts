// Villagers resting at home when there is nothing to do, the counts kept as the map changes, builders
// round a wall.
import { describe, it, expect } from 'vitest';
import { TW, TH, NP, B_HOUSE, B_GUILD } from '../src/core/constants';
import { build, plotProblem, finishHouse } from '../src/sim/buildings';
import { R_HOUSING } from '../src/sim/research';
import { W, owner, isLand, pType, pIn, pTier, pCenter } from '../src/sim/state';
import { newWorld, startMatch, tick } from '../src/sim/sim';
import { setOwner } from '../src/sim/territory';
import { scanContacts } from '../src/sim/census';
import { HOUSE_BEDS } from '../src/sim/research';
import { HUMAN_EVERY as E, H_VILLAGER, TASK_REST, indoors, frontOf } from '../src/sim/population';

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

describe('the counts kept as the map changes', () => {
  it('borders, and kingdom centres stay exactly what a scan of the map finds', () => {
    start(987654321, 9);
    run(3000);   // bots settle and fight
    const snap = () => ({ contact: Array.from(W.contact), sums: W.nations.map(n => [n.sumX, n.sumY]) });
    const kept = snap();
    scanContacts(true);
    expect(kept).toEqual(snap());
  });

});

describe('resting at home', () => {
  it('sends villagers with nothing to do into the nearest house with room, out of sight, a bed each', () => {
    start(12345, 0);
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

  it('checks for houses to build every 10 to 12 seconds while resting', () => {
    start(12345, 0); run(10*E);
    const h = mine().find(h => h.task===TASK_REST)!;
    expect(h.wait).toBeGreaterThan(0); expect(h.wait).toBeLessThanOrEqual(120);
  });
});

describe('builders and smiths round a wall', () => {
  it('improve houses the straight way to which is shut', () => {
    start(12345, 0);
    const c=me().capTile, cx=c%TW, cy=(c/TW)|0;
    for (let y=cy-25;y<=cy+25;y++) for (let x=cx-20;x<=cx+40;x++){ const t=y*TW+x; if (isLand[t] && !owner[t]) setOwner(t,1); }
    for (let y=cy-25;y<=cy+20;y++) for (let x=cx+12;x<=cx+14;x++) setOwner(y*TW+x,0);
    scanContacts(true);
    // houses on the far side of the wall, and a guild at home
    const far: number[]=[];
    for (let q=0;q<NP && far.length<3;q++){ const t=pCenter[q]; if (t%TW>=cx+20 && Math.abs(((t/TW)|0)-cy)<8 && !plotProblem(me(),q)){ finishHouse(q,1); far.push(q); } }
    expect(far).toHaveLength(3);
    me().stock=[100,100,100]; me().tier[R_HOUSING]=2;
    for (let q=0;q<NP;q++) if (!plotProblem(me(),q) && (pCenter[q]%TW)<cx+8){ expect(build(me(),q,B_GUILD)).toBe(true); break; }
    for (let k=0;k<20 && far.some(q => pTier[q]<2);k++){ me().stock=[100,100,100]; run(300); }
    expect(far.map(q => pTier[q])).toEqual([2,2,2]);   // stone houses
  });
});
