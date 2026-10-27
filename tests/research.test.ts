// Research stations, house tiers and the builders guild.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, B_HOUSE, B_RESEARCH, B_GUILD, B_TOWER, GOLD_PER_SEC, TAX_PER_VILLAGER } from '../src/core/constants';
import { W, owner, isLand, pType, pOwner, pTier, pCenter, pTimer } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { build, placeProblem } from '../src/sim/buildings';
import { H_VILLAGER, TASK_FIX, FIX_TICKS, REHIRE_TICKS, improvements, upgradeCost } from '../src/sim/population';
import { R_HOUSING, R_TAXES, R_INFANTRY, R_TOWERS, TIER_XP, HOUSE_BEDS } from '../src/sim/research';
import { TOWER_COST } from '../src/sim/defense';
import { bldHp } from '../src/sim/war';
import { listen } from '../src/sim/events';
import { gained, spent, perMinute, mayInvest } from '../src/sim/ledger';

const me = () => W.nations[1];
const mine = () => W.humans.filter(h => h.o === 1);
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
const houses = () => { const out: number[]=[]; for (let q=0;q<NP;q++) if (pType[q]===B_HOUSE && pOwner[q]===1) out.push(q); return out; };
function start(seed: number){
  newWorld(seed);
  for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (startMatch((TH/2+dy*3)*TW + TW/2+dx*3, 0)) return;
  }
  throw new Error('no spawn spot');
}
function expand(rounds: number){
  for (let r=0;r<rounds;r++){
    let t=-1;
    for (let i=0;i<NT && t<0;i++) if (!owner[i] && isLand[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1)) t=i;
    W.nations[1].gold+=400;
    if (t>=0) queueCommand({ type: 'attack', nation: 1, tile: t, ratio: 0.8 });
    run(40);
  }
}
function until(ok: () => boolean, max = 6000){ for (let i=0;i<max;i++){ if (ok()) return; tick(); } throw new Error('condition never met'); }
const fromCapital = (q: number) => { const c=me().capTile; return Math.hypot((pCenter[q]%TW)-(c%TW), ((pCenter[q]/TW)|0)-((c/TW)|0)); };
/** Places a building of `type` on the first free spot, paying for it. Returns its plot. */
function place(type: number){
  me().stock=[100,100,100];
  for (const q of me().plots) if (!placeProblem(me(),q,type) && build(me(),q,type)) return q;
  throw new Error('nowhere to build');
}

describe('research', () => {
  it('earns a point a second per station, for housing first, and goes up a tier at 100 then 200', () => {
    start(12345); run(20);
    expect(me().study).toBe(R_HOUSING);
    expect(me().tier).toEqual([1,1,1,1,1,1]);
    run(100); expect(me().xp).toEqual([0,0,0,0,0,0]);   // nothing without a station
    place(B_RESEARCH); run(100);                // 10 s
    expect(me().xp[R_HOUSING]).toBe(100);       // 10 points, in tenths
    place(B_RESEARCH); run(100);                // two stations: twice as fast
    expect(me().xp[R_HOUSING]).toBe(300);
    run(350); expect(me().tier[R_HOUSING]).toBe(2); expect(me().xp[R_HOUSING]).toBe(0);   // 100 points
    expect(TIER_XP[R_HOUSING][2]).toBe(200);
  });

  it('takes 200 points for infantry tier 2 and 300 more for tier 3', () => {
    expect(TIER_XP[R_INFANTRY].slice(1)).toEqual([200,300]);
    start(12345); run(20);
    me().study=R_INFANTRY; place(B_RESEARCH); place(B_RESEARCH);   // 2 points a second
    run(999); expect(me().tier[R_INFANTRY]).toBe(1);
    run(1);   expect(me().tier[R_INFANTRY]).toBe(2);
    run(1500); expect(me().tier[R_INFANTRY]).toBe(3);
  });

  it('studies one topic at a time and keeps what the other has learned', () => {
    start(12345); run(20);
    place(B_RESEARCH); run(200);
    queueCommand({ type:'research', nation:1, topic:R_TAXES }); run(100);
    expect(me().xp).toEqual([200,100,0,0,0,0]);
    queueCommand({ type:'research', nation:1, topic:R_HOUSING }); run(1);
    expect(me().study).toBe(R_HOUSING);
  });

  it('moves on to the other topic when one is done, and keeps its tiers if the stations burn', () => {
    start(12345); run(20);
    me().tier=[3,1,1,1,1,1]; me().study=R_HOUSING;
    const q=place(B_RESEARCH); run(10);
    expect(me().study).toBe(R_TAXES);
    pType[q]=0; pOwner[q]=0; run(20);
    expect(me().labs).toBe(0);
    expect(me().tier).toEqual([3,1,1,1,1,1]);
  });

  it('raises each villager\'s tax by 0.1 a tier', () => {
    start(12345); run(300);
    const n=me(); expect(n.taxpayers).toBeGreaterThan(0);
    n.tier[R_TAXES]=3; run(1);
    expect(n.income).toBeCloseTo(GOLD_PER_SEC+TAX_PER_VILLAGER*3*n.taxpayers);
  });
});

describe('house tiers and the builders guild', () => {
  it('stone houses hold 2 and take 3 times the blows, manors 3 and 6 times', () => {
    expect(HOUSE_BEDS.slice(1)).toEqual([1,2,3]);
    start(12345); expand(4); until(() => houses().length>=4);
    const [a,b,c]=houses(); pTier[b]=2; pTier[c]=3;
    expect([bldHp(a),bldHp(b),bldHp(c)]).toEqual([10,30,60]);
    run(10);   // census
    expect(me().beds).toBe(houses().length+1+2);
  });

  it('takes one villager as its builder, and does nothing until housing research allows it', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    const g=place(B_GUILD); run(2);
    const builders=mine().filter(h => h.work===g);
    expect(builders).toHaveLength(1);
    expect(builders[0].kind).toBe(H_VILLAGER);
    run(300);
    expect(houses().every(q => pTier[q]===1)).toBe(true);
  });

  it('turns hovels into stone houses from the castle outward, for 3 wood and 3 stone each', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    const g=place(B_GUILD); me().tier[R_HOUSING]=2; run(2);
    const b=mine().find(h => h.work===g)!, first=improvements(me())[0];
    const nearest=Math.min(...houses().map(fromCapital));
    expect(fromCapital(first)).toBeLessThanOrEqual(nearest*1.2+1e-9);   // the inner town first (a little ragged)
    until(() => b.task===TASK_FIX);
    const q=b.fix, before=[...me().stock], got=[0,0,0];
    listen({ stored: (o,g,k) => { if (o===1) got[g]+=k; } });   // goods villagers bring in meanwhile
    until(() => pTier[q]===2, FIX_TICKS+5);
    listen({ stored: () => {} });
    expect(me().stock[0]).toBe(before[0]+got[0]-3);
    expect(me().stock[1]).toBe(before[1]+got[1]-3);
    expect(me().beds).toBe(houses().reduce((k,q) => k+HOUSE_BEDS[pTier[q]],0));   // room for one more right away
  });

  it('with manors allowed, puts the manors in the heart of town and stone houses further out', () => {
    start(12345); expand(8); until(() => houses().length>=12);
    place(B_GUILD); place(B_GUILD); me().tier[R_HOUSING]=3;
    until(() => { me().stock=[100,100,100]; gained(me(),0,1); gained(me(),1,1); return improvements(me()).length===0; }, 20000);   // goods keep coming in, so the builders may spend
    const hs=houses().filter(q => pTier[q]>0).sort((a,b) => fromCapital(a)-fromCapital(b));
    const manors=hs.filter(q => pTier[q]===3), stone=hs.filter(q => pTier[q]===2);
    expect(manors.length).toBeGreaterThan(0); expect(stone.length).toBeGreaterThan(0);
    const avg=(l: number[]) => l.reduce((s,q) => s+fromCapital(q),0)/l.length;
    expect(avg(manors)).toBeLessThan(avg(stone));
  });

  it('finds a new builder 5 seconds after the old one falls', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    const g=place(B_GUILD); run(2);
    const b=mine().find(h => h.work===g)!; b.hp=0; run(1);
    expect(pTimer[g]).toBeGreaterThan(0);
    run(REHIRE_TICKS-5); expect(mine().filter(h => h.work===g)).toHaveLength(0);
    run(10); expect(mine().filter(h => h.work===g)).toHaveLength(1);
  });
});

describe('watchtowers rebuilt by the builders guild', () => {
  it('rebuilds a watchtower a tier up for 10 stone and 4 wood, then 20 stone and 8 wood, towers before houses', () => {
    start(12345); expand(6); until(() => houses().length>=6);
    const t=place(B_TOWER); place(B_GUILD);
    me().tier[R_TOWERS]=3; me().tier[R_HOUSING]=2; me().invest=1;
    expect(pTier[t]).toBe(1);
    expect(improvements(me())[0]).toBe(t);
    expect([upgradeCost(t), TOWER_COST[2]]).toEqual([[4,10,0], [8,20,0]]);
    until(() => { me().stock=[100,100,100]; gained(me(),0,2); gained(me(),1,2); return pTier[t]===3; }, 6000);
    expect(bldHp(t)).toBe(40);
  });
});

describe('city investment', () => {
  it('lets the builders spend only that share of the goods coming in over the last minute', () => {
    start(12345);
    const n=me(); n.invest=0.5;
    gained(n,0,30);                                      // 30 wood a minute coming in
    expect(perMinute(n).gain).toEqual([30,0,0]);
    expect(mayInvest(n,[3,0,0])).toBe(true);
    spent(n,0,12); expect(mayInvest(n,[3,0,0])).toBe(true);   // 15 of 30 is the half allowed
    spent(n,0,3);  expect(mayInvest(n,[3,0,0])).toBe(false);  // that would make 18
    expect(mayInvest(n,[0,3,0])).toBe(false);            // nothing comes in of stone
    n.invest=1; expect(mayInvest(n,[3,0,0])).toBe(true);
    run(610);                                            // a minute later the ledger has moved on
    expect(perMinute(n).spend[0]).toBe(0);
  });

  it('keeps a builder idle once the investment is spent, with the rest left in the stockpile', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    const g=place(B_GUILD); me().tier[R_HOUSING]=2; me().invest=0; run(2);
    const b=mine().find(h => h.work===g)!;
    me().stock=[100,100,0]; run(300);
    expect(b.fix).toBe(-1);
    expect(houses().every(q => pTier[q]===1)).toBe(true);
  });
});
