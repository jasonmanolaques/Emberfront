// Villagers resting at home when there is nothing to do, the counts kept as the map changes, and
// full investment.
import { describe, it, expect } from 'vitest';
import { TW, TH, B_HOUSE } from '../src/core/constants';
import { W, owner, isLand, occ, pType, pIn, pTier, resType, resLeft } from '../src/sim/state';
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

describe('full investment', () => {
  it('at 100% the builders may spend whatever is in the stockpile, whatever comes in', () => {
    start(12345, 0);
    const n = me(); n.gain.fill(0); n.spend.fill(0);
    n.invest = 0.95; expect(mayInvest(n, [3,3,0])).toBe(false);   // nothing came in this past minute
    n.invest = 1;    expect(mayInvest(n, [3,3,0])).toBe(true);
  });
});
