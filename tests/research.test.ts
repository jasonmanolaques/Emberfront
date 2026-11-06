// Research stations, house tiers and the builders guild.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, B_HOUSE, B_SMITHY, B_RESEARCH, B_GUILD, B_TOWER, TAX_PER_VILLAGER, TAX_PER_TIER, LAND_TAX } from '../src/core/constants';
import { W, owner, isLand, pType, pOwner, pTier, pCenter, pTimer, pSpan } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { build, placeProblem, costFor, structureOf } from '../src/sim/buildings';
import { H_VILLAGER, TASK_FIX, TASK_FIX_GO, TASK_SUPPLY, FIX_TICKS, REHIRE_TICKS, improvements } from '../src/sim/population';
import { R_HOUSING, R_TAXES, R_INFANTRY, R_TOWERS, TIER_XP, HOUSE_BEDS } from '../src/sim/research';
import { bldHp } from '../src/sim/war';
import { listen } from '../src/sim/events';

const me = () => W.nations[1];
const mine = () => W.humans.filter(h => h.o === 1);
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
const houses = () => { const out: number[]=[]; for (let q=0;q<NP;q++) if (pType[q]===B_HOUSE && pOwner[q]===1) out.push(q); return out; };
function start(seed: number){
  newWorld(seed); W.rushUntil=0;
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
function place(type: number, near=false){
  me().stock=[100,100,100];
  for (const q of near ? me().plots.slice().sort((a,b) => fromCapital(a)-fromCapital(b)) : me().plots) if (!placeProblem(me(),q,type) && build(me(),q,type)) return q;
  throw new Error('nowhere to build');
}

describe('blacksmiths side by side', () => {
  it('each plot of a joined smithy has its own smith: the join is only for looks', () => {
    start(12345); expand(6); until(() => houses().length>=12);
    me().stock=[100,100,100];
    const plots=me().plots.filter(q => !placeProblem(me(),q,B_SMITHY) && !placeProblem(me(),q+1,B_SMITHY) && (q%PW)<PW-1 && Math.floor(q/PW)===Math.floor((q+1)/PW));
    expect(plots.length).toBeGreaterThan(0);
    const q=plots[0]; expect(build(me(),q,B_SMITHY)).toBe(true); me().stock=[100,100,100]; expect(build(me(),q+1,B_SMITHY)).toBe(true);
    run(20);
    const mains=Array.from({ length: NP }, (_, k) => k).filter(k => pType[k]===B_SMITHY && pOwner[k]===1);
    const plotsOf=mains.reduce((k,m) => k+[1,2,4][pSpan[m]],0);
    expect(plotsOf).toBe(2);
    until(() => mine().filter(h => h.work>=0 && mains.includes(h.work)).length===2, 600);
    expect(mine().filter(h => h.work>=0 && mains.includes(h.work))).toHaveLength(2);
  });
});

describe('research stations', () => {
  it('each one you own makes the next 20% dearer', () => {
    start(12345);
    const base=structureOf(B_RESEARCH)!.cost;
    expect(costFor(me(),structureOf(B_RESEARCH)!)).toEqual(base);
    place(B_RESEARCH);
    expect(costFor(me(),structureOf(B_RESEARCH)!)).toEqual(base.map(c => Math.round(c*1.2)));
    place(B_RESEARCH);
    expect(costFor(me(),structureOf(B_RESEARCH)!)).toEqual(base.map(c => Math.round(c*1.4)));
  });
});

/** Runs until k scholars are at their stations' doors (the points are earned only there), then clears what was earned meanwhile. */
function staffed(k: number){ for (let i=0;i<6000 && me().studying<k;i++) tick(); expect(me().studying).toBe(k); me().xp.fill(0); }

describe('research', () => {
  it('earns a point a second per station, for housing first, and goes up a tier at 400 then 800', () => {
    start(12345); run(20);
    expect(me().study).toBe(R_HOUSING);
    expect(me().tier).toEqual([1,1,1,1,1,1,1]);
    run(100); expect(me().xp).toEqual([0,0,0,0,0,0,0]);   // nothing without a station
    place(B_RESEARCH); staffed(1); run(100);    // 10 s
    expect(me().xp[R_HOUSING]).toBe(100);       // 10 points, in tenths
    place(B_RESEARCH); staffed(2); run(100);    // two stations: twice as fast
    expect(me().xp[R_HOUSING]).toBe(200);
    run(1895); expect(me().tier[R_HOUSING]).toBe(1);   // 400 points at two stations: 3800 tenths to go at 2 a tick
    run(10); expect(me().tier[R_HOUSING]).toBe(2); expect(me().xp[R_HOUSING]).toBeLessThan(30);
    expect(TIER_XP[R_HOUSING][2]).toBe(800);
  });

  it('takes 400 points for infantry tier 2 and 800 more for tier 3', () => {
    expect(TIER_XP[R_INFANTRY].slice(1)).toEqual([400,800]);
    start(12345); run(20);
    me().study=R_INFANTRY; place(B_RESEARCH); place(B_RESEARCH); staffed(2);   // 2 points a second
    run(1999); expect(me().tier[R_INFANTRY]).toBe(1);
    run(1);   expect(me().tier[R_INFANTRY]).toBe(2);
    run(4000); expect(me().tier[R_INFANTRY]).toBe(3);
  });

  it('studies one topic at a time and keeps what the other has learned', () => {
    start(12345); run(20);
    place(B_RESEARCH); staffed(1); run(200);
    queueCommand({ type:'research', nation:1, topic:R_TAXES }); run(100);
    expect(me().xp).toEqual([200,100,0,0,0,0,0]);
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
    start(12345); run(1500);
    const n=me(); expect(n.taxpayers).toBeGreaterThan(0);
    n.tier[R_TAXES]=3; run(1);
    expect(n.income).toBeCloseTo((TAX_PER_VILLAGER+2*TAX_PER_TIER)*n.taxpayers+LAND_TAX*n.tiles);
  });
});

describe('house tiers and the builders guild', () => {
  it('stone houses hold 2 and take 3 times the blows, manors 3 and 6 times', () => {
    expect(HOUSE_BEDS.slice(1)).toEqual([1,2,3]);
    start(12345); expand(4); until(() => houses().length>=4);
    const [a,b,c]=houses(); pTier[b]=2; pTier[c]=3;
    expect([bldHp(a),bldHp(b),bldHp(c)]).toEqual([20,60,120]);
    run(20);   // census (a pass takes ten ticks, and one may be under way)
    expect(me().beds).toBe(houses().length+1+2);
  });

  it('takes one villager as its builder, and does nothing until housing research allows it', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    const g=place(B_GUILD); until(() => mine().some(h => h.work===g), 3000);
    const builders=mine().filter(h => h.work===g);
    expect(builders).toHaveLength(1);
    expect(builders[0].kind).toBe(H_VILLAGER);
    run(300);
    expect(houses().every(q => pTier[q]===1)).toBe(true);
  });

  it('raises a house a tier for nothing: 20 seconds from tier 1 to 2, then 40 from 2 to 3', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    const g=place(B_GUILD); me().tier[R_HOUSING]=3; until(() => mine().some(h => h.work===g), 3000);
    const b=mine().find(h => h.work===g)!;
    until(() => b.task===TASK_FIX);
    const q=b.fix, before=[...me().stock];
    expect(pTier[q]).toBe(1);
    expect(FIX_TICKS(1)).toBe(400); expect(FIX_TICKS(2)).toBe(800);
    run(FIX_TICKS(1)-5); expect(pTier[q]).toBe(1);
    until(() => pTier[q]===2, 10);
    expect(me().stock).toEqual(before);   // (nobody brings in goods meanwhile: only buildings make them) it costs nothing
    expect(me().beds).toBe(houses().reduce((k,q) => k+HOUSE_BEDS[pTier[q]],0));   // room for more right away
  });

  it('works on the lowest houses first, however far, and on a tier 2 one when only those are left', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    me().tier[R_HOUSING]=3;
    const g0=me().plots.find(q => !placeProblem(me(),q,B_GUILD))!, hs=houses().sort((a,b) => Math.abs(pCenter[a]-pCenter[g0])-Math.abs(pCenter[b]-pCenter[g0])), last=hs[0];
    for (const q of hs) if (q!==last) pTier[q]=2;   // all but one already stone houses
    const g=place(B_GUILD); until(() => mine().some(h => h.work===g), 3000);
    const b=mine().find(h => h.work===g)!;
    until(() => b.task===TASK_FIX, 2000);
    expect(pTier[b.fix]).toBe(1);   // the tier 1 house, not one of the stone houses
  });

  it('with only tier 2 houses left, raises one of those to a manor', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    me().tier[R_HOUSING]=3;
    for (const q of houses()) pTier[q]=2;
    const g=place(B_GUILD); until(() => mine().some(h => h.work===g), 3000);
    const b=mine().find(h => h.work===g)!;
    until(() => b.task===TASK_FIX, 2000);
    const q=b.fix; expect(pTier[q]).toBe(2);
    until(() => pTier[q]===3, FIX_TICKS(2)+5);
  });

  it('has every guild\'s builder at work non-stop, and the stone houses go on to manors', () => {
    start(12345); expand(8); until(() => houses().length>=12);
    const g1=place(B_GUILD), g2=place(B_GUILD); me().tier[R_HOUSING]=3; until(() => mine().some(h => h.work===g1) && mine().some(h => h.work===g2), 3000);
    const bs=[g1,g2].map(g => mine().find(h => h.work===g)!);
    me().humanProg=-1e9;   // (nobody new: the builders have the houses there are to go on with, each trip back to the guild for materials taking its time)
    let idle=0;
    for (let i=0;i<16000;i++){ tick(); if (i>600 && improvements(me()).length>bs.length && bs.some(b => b.fix<0 && b.task!==TASK_FIX_GO && b.task!==TASK_FIX && b.task!==TASK_SUPPLY)) idle++; }
    expect(idle).toBeLessThan(100);   // (a few moments choosing)
    expect(houses().filter(q => pTier[q]===3).length).toBeGreaterThanOrEqual(1);
  });

  it('finds a new builder 5 seconds after the old one falls', () => {
    start(12345); expand(6); until(() => houses().length>=10);
    const g=place(B_GUILD); until(() => mine().some(h => h.work===g), 3000);
    const b=mine().find(h => h.work===g)!; b.hp=0; run(1);
    expect(pTimer[g]).toBeGreaterThan(0);
    run(REHIRE_TICKS-5); expect(mine().filter(h => h.work===g)).toHaveLength(0);
    until(() => mine().filter(h => h.work===g).length===1, 2000);   // (as soon as a villager is free to take it)
    expect(mine().filter(h => h.work===g)).toHaveLength(1);
  });
});

describe('watchtowers rebuilt by the builders guild', () => {
  it('rebuilds a watchtower a tier up for nothing: 20 seconds, then 40', () => {
    start(12345); expand(6); until(() => houses().length>=6);
    const t=place(B_TOWER,true); const g=place(B_GUILD,true);   // (beside the capital, where the builder can walk)
    me().tier[R_TOWERS]=3; me().tier[R_HOUSING]=1; until(() => mine().some(h => h.work===g), 3000);
    const b=mine().find(h => h.work===g)!;
    expect(pTier[t]).toBe(1);
    expect(improvements(me())[0]).toBe(t);
    const before=[...me().stock];
    until(() => pTier[t]===2, 3000);
    until(() => pTier[t]===3, 3000);
    expect(me().stock).toEqual(before);
    expect(b.fix).toBe(-1);
    expect(bldHp(t)).toBe(80);
  });
});
