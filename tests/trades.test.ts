// Trades and the soldier slider: the price of a first building, the limit set by the professionals, and the lock.
import { describe, it, expect, beforeEach } from 'vitest';
import { TW, TH, B_FARM, B_TOWER } from '../src/core/constants';
import { W } from '../src/sim/state';
import { STRUCTURES, structureOf, costFor, RISE } from '../src/sim/buildings';
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
    people(100,0,[4,3,1,2]);
    expect(professionals(me())).toBe(10);
    expect(soldierMax(me())).toBeCloseTo(0.9, 5);
    people(50,50,[0,0,0,0]);
    expect(soldierMax(me())).toBe(1);
    people(0,0,[0,0,0,0]);
    expect(soldierMax(me())).toBe(1);
  });

  it('clamps a request past the limit, unless the lock is on', () => {
    people(100,0,[4,3,1,2]);
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
    n.jobs=[2,0,0,0]; n.villagers=8; n.soldiers=0;
    queueCommand({ type: 'draftAll', nation: 1, on: false });
    tick();
    expect(n.draftAll).toBe(false);
    expect(n.soldierShare).toBeCloseTo(0.75,5);   // 2 of 8 have a trade
  });

  it('counts only the people with a trade as professionals, and starts with none', () => {
    run(5);
    expect(me().jobs).toEqual([0,0,0,0]);
    expect(me().unhoused).toBe(0);
    expect(H_SOLDIER).not.toBe(H_VILLAGER);
  });
});
