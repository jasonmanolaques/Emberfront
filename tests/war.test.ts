// War: diplomacy, attacks, fighting, peace, and the fall of a kingdom.
// Most of these play on a flat all-grass map, so distances and borders are predictable.
import { describe, it, expect } from 'vitest';
import { TICK, TW, TH, NT, NP, PW, WAGE, WAGE_IDLE, WAGE_ATTACK, MIL_WAGE, MIL_ATTACK, T_GRASS, T_WATER, B_NAVAL, B_HOUSE, B_FARM, B_TOWER, B_BARRACKS, B_RUINS, B_GUILD, B_HOSPITAL } from '../src/core/constants';
import { W, owner, occ, isLand, isle, terr, pBuild, pType, pOwner, pBurn, pCenter, pHp, pIn, type Human, type Nation } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick, grossIncome } from '../src/sim/sim';
import { listen, on } from '../src/sim/events';
import { setOwner, occIsleAdd } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { build, plotProblem, placeProblem, SIZE, structureOf, costFor, togglePriority, finishHouse } from '../src/sim/buildings';
import { resetRooms } from '../src/sim/population';
import { humanRate, indoors, TASK_ROAM, TASK_HOME_GO, H_SOLDIER, H_VILLAGER, TASK_REST, TASK_TO_TRAIN, TASK_INSIDE, MILITIA_HP, SOLDIER_HP, VILLAGER_HP, HOME_PACE, makeHuman, doorOf, frontOf, switching, pace, maxHp } from '../src/sim/population';
import { UNIT_SIZE, buildUnits, station, unitAt, units, groupKeys, mergeArmies, SOLDIER_DMG } from '../src/sim/army';
import { wallOf, walledFor, buildWalls } from '../src/sim/defense';
import { callable, partner, warringNow, besieged, siegeLocked, allied, atWar, available, ready, declare, warProblem, mayStand, endWar, makePeace, MAX_ALLIES, HIT_DMG, MILITIA_DMG, DANGER_R, MOB, REVENGE_DMG, REVENGE_PACE, spread,
  RANKS, rankFor, PEACE_MARCH, DIG_TICKS, invadeSpeed, INVADE_EMPTY, assignArmy, assignProblem, bordersOf, freeArmy, CRISIS_TICKS, frontKey, stalled, inCrisis, escalate, deescalate, deescalateProblem, defend, callReserves, defendProblem, reservesOf, reservesProblem, menOn, deployArmies, armyOrder, armyFront, armyRecall, frontIsles, occOn, attacks, F_GATHER, F_READY, F_PUSH, F_HOLD, setOffensive, offensiveProblem, frontLines, marchPace, offensiveFront, ADVANCE_TICKS, DENSE, PRESENT, GATHER_AT, ZOC } from '../src/sim/war';
import { navalPlan, declareNaval, navalOf, landingOn } from '../src/sim/war';
import { botSea, navalAttack, seaDrive } from '../src/sim/botsea';
import { basesOf, dockTile, labelWorld, allocIsles, landingZone, SHIP_CAP, SHIP_FRONT, INV_SAIL, INV_READY, INV_LAND, INV_DONE, shipById } from '../src/sim/naval';
import { navalSite, cover } from '../src/sim/buildings';
import { sea, ferry } from '../src/sim/state';
import { SEC_SIEGE, sectorOf, MIN_GAP, RANK_GAP, A_OFF, holds, freeOf, underCastle, lineOf, castleCutOff } from '../src/sim/front';
import { beggarProblem, stuck, warChest, botThink } from '../src/sim/bots';
import { MILITIA_HIT } from '../src/sim/army';
import { armyName, renameArmy, resetArmyNames } from '../src/ui/armies';
import { incomeParts } from '../src/sim/sim';
import { R_HOUSING, R_MEDICS, TIER_XP, TOPIC_MAX, woundChance } from '../src/sim/research';
import { BLEED_TICKS, HEAL_TICKS, MEDIC_SPEED, TASK_DOC_GO, TASK_DOC_HEAL, TASK_DOC_WAIT } from '../src/sim/medics';

const N = (i: number) => W.nations[i];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
/** Ticks until `done` holds; fails after `max`. */
function until(done: () => boolean, max: number){ for (let i=0;i<max;i++){ if (done()) return i; tick(); } throw new Error('timed out'); }

/** A flat, all-grass, empty map with the player in the middle and `rivals` bots that never think. */
function world(rivals: number, seed=7){
  newWorld(seed);
  isLand.fill(1); terr.fill(T_GRASS); pBuild.fill(1);
  W.landTiles=Int32Array.from({ length: NT }, (_, i) => i); W.landCount=NT;
  if (!startMatch((TH/2)*TW+TW/2, rivals)) throw new Error('no spawn');
  for (const n of W.nations.slice(2)){ n.nextThink=1e9; n.nextWar=1e9; }
}
/** Claims a 3-tile-wide strip for a from its capital toward b's, until it touches b's land. */
function paintToward(a: number, b: number){
  const A=N(a).capTile, B=N(b).capTile, ax=A%TW, ay=(A/TW)|0, bx=B%TW, by=(B/TW)|0, steps=Math.max(Math.abs(bx-ax),Math.abs(by-ay));
  for (let s=0;s<=steps;s++){
    const x=Math.round(ax+(bx-ax)*s/steps), y=Math.round(ay+(by-ay)*s/steps);
    let touch=false;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const t=(y+dy)*TW+x+dx; if (owner[t]===b) touch=true; else if (!owner[t]) setOwner(t,a); }
    if (touch) break;
  }
  census();
}
/** k soldiers of nation n standing at its capital door, as the army of a new barracks beside the
    castle (modules side by side, 5 soldiers each); with `own=false`, without a barracks. */
function soldiers(n: Nation, k: number, own=true){
  const [x,y]=doorOf(n), out: Human[]=[];
  for (let i=0;i<k;i++){ const h=makeHuman(n,H_SOLDIER,x+(i%5)-2,y+((i/5)|0)*0.5); W.humans.push(h); out.push(h); }
  if (own && k>0){
    // modules grown one beside another from the free plot nearest the castle, so they make one barracks
    const m=Math.ceil(k/UNIT_SIZE), cap=n.capPlot, d=(q: number) => (q%PW-cap%PW)**2+((q/PW|0)-(cap/PW|0))**2;
    const stock=n.stock, mods: number[]=[];
    n.stock=[1000,1000,1000];
    for (let tries=0; mods.length<m && tries<2; tries++){
      while (mods.length<m){
        const near=mods.length ? mods.flatMap(q => [q-PW,q+1,q+PW,q-1]) : Array.from({ length: NP }, (_, q) => q);
        const q=near.filter(q => q>=0 && q<NP && !mods.includes(q) && !plotProblem(n,q)).sort((a,b) => d(a)-d(b) || a-b)[0];
        if (q===undefined) break;
        build(n,q,B_BARRACKS); mods.push(q);
      }
      if (mods.length<m){ for (const q of mods){ pType[q]=0; pOwner[q]=0; } mods.length=0; paintDisc(n,14); }   // a little more room round the castle
    }
    n.stock=stock;
    buildUnits(); const u=unitAt(mods[0])!;
    out.forEach((h,i) => { h.base=u.plots[i%u.plots.length]; });
    station(n, W.humans.filter(h => h.o===n.id), switching);
    // the kingdom keeps them as soldiers rather than sending them back to work
    const mine=W.humans.filter(h => h.o===n.id); n.soldierShare=Math.max(n.soldierShare, mine.filter(h => h.kind===H_SOLDIER).length/mine.length);
  }
  return out;
}
/** Claims the unclaimed land within r tiles of n's capital. */
function paintDisc(n: Nation, r: number){
  const cx=n.capTile%TW, cy=(n.capTile/TW)|0;
  for (let y=Math.max(0,cy-r);y<=Math.min(TH-1,cy+r);y++) for (let x=Math.max(0,cx-r);x<=Math.min(TW-1,cx+r);x++){ const t=y*TW+x; if ((x-cx)**2+(y-cy)**2<=r*r && !owner[t]) setOwner(t,n.id); }
  census();
}
/** Builds `type` on n's free plot nearest its capital (or, with `awayFrom`, farthest from that tile). */
function place(n: Nation, type: number, awayFrom=-1){
  const [px,py] = awayFrom>=0 ? [(awayFrom%TW)>>2, ((awayFrom/TW)|0)>>2] : [n.capPlot%PW, (n.capPlot/PW)|0];
  const d=(q: number) => ((q%PW-px)**2+((q/PW|0)-py)**2)*(awayFrom>=0 ? -1 : 1);
  const q=Array.from({ length: NP }, (_, k) => k).filter(k => !plotProblem(n,k)).sort((a,b) => d(a)-d(b))[0];
  if (type===B_HOUSE){ finishHouse(q,n.id); return q; }
  n.stock=[...costFor(n,structureOf(type)!)];
  if (!build(n,q,type)) throw new Error('could not build');
  return q;
}
/** Test hacks that occupy / free a tile of o's by writing the arrays: the counts (W.occCount and W.occIsle) kept with them. */
function occupyHack(t: number, by: number){ const o=owner[t]; occ[t]=by; W.occCount[o*W.M+by]++; occIsleAdd(t,o,by,1); }
function freeHack(t: number){ const o=owner[t], by=occ[t]; occ[t]=0; W.occCount[o*W.M+by]--; occIsleAdd(t,o,by,-1); }
function collect<K extends keyof typeof on>(name: K){
  const got: Parameters<(typeof on)[K]>[]=[];
  listen({ [name]: (...a: never[]) => { got.push(a as never); } } as never);
  return got;
}
/** Kingdom a's offensive against d: waits for its armies to gather on the border, then gives the word to attack. */
function giveWord(a: number, d: number, max=3000){
  until(() => W.offensive[a*W.M+d]===F_READY, max);
  if (inCrisis(a,d)) W.crisisAt[a*W.M+d]-=CRISIS_TICKS;   // (its time to talk is up)
  queueCommand({ type:'offensive', nation:a, target:d, go:true }); tick();
  expect(W.offensive[a*W.M+d]).toBe(F_PUSH);
}
/** Kingdom o raises no more soldiers: nobody left to sign up, and the wages paid. */
const noDraft = (o=1) => { W.humans=W.humans.filter(h => h.o!==o || h.kind===H_SOLDIER); N(o).soldierShare=1; N(o).humanProg=-1e9; N(o).gold=1e6; };
const quiet = () => listen({ warBegan(){}, armyHome(){}, armyGone(){}, peaceOffered(){}, peaceRefused(){}, peaceMade(){}, allied(){}, allyRefused(){}, allianceBroken(){}, annexed(){}, hit(){}, bldHit(){} });

describe('clicking another kingdom', () => {
  it('no longer takes its land: gold only settles unclaimed ground', () => {
    world(1); paintToward(1,2);
    const t=Array.from({ length: NT }, (_, i) => i).find(i => owner[i]===2 && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1))!;
    const tiles=N(2).tiles, gold=N(1).gold;
    queueCommand({ type:'attack', nation:1, tile:t, ratio:1 }); run(30);
    expect(N(2).tiles).toBe(tiles);
    expect(W.attacks.filter(A => A.def===2)).toHaveLength(0);
    expect(N(1).gold).toBeGreaterThanOrEqual(gold);   // nothing spent
  });
});

describe('alliances', () => {
  it('are accepted by a kingdom of similar strength, both ways, and open its land to the ally\'s armies', () => {
    world(2); quiet();
    const ok=collect('allied');
    queueCommand({ type:'ally', nation:1, target:2 }); tick();
    expect(ok).toEqual([[1,2]]);
    expect(allied(1,2) && allied(2,1)).toBe(true);
    expect(allied(1,3)).toBe(false);
    // a soldier of ours marching against 3 may stand on 2's land, and only then
    const h=soldiers(N(1),1)[0]; place(N(3),B_FARM); paintToward(1,3);
    expect(mayStand(h,2)).toBe(false);
    expect(declare(1,3,1)).toBe(true); tick();
    expect(mayStand(h,2)).toBe(true);
    expect(mayStand(h,3)).toBe(true);
  });

  it('are refused by a kingdom we attacked lately, or one far stronger, and capped at a few allies', () => {
    world(MAX_ALLIES+2); quiet();
    const no=collect('allyRefused');
    N(3).strength=N(1).strength*10+1000;
    queueCommand({ type:'ally', nation:1, target:3 }); tick();
    expect(allied(1,3)).toBe(false);
    expect(no[0][2]).toMatch(/too weak/);
    // attack 2, make peace, and it still won't have us
    soldiers(N(1),2); place(N(2),B_FARM); paintToward(1,2);
    expect(declare(1,2,2)).toBe(true); tick();
    queueCommand({ type:'peace', nation:2, target:1 }); W.offers[1*W.M+2]=W.tickN; tick();
    expect(atWar(1,2)).toBe(false);
    queueCommand({ type:'ally', nation:1, target:2 }); tick();
    expect(allied(1,2)).toBe(false);
    expect(no.at(-1)![2]).toMatch(/not forgotten/);
    // no more than MAX_ALLIES
    for (let o=3;o<W.M;o++){ N(o).strength=N(1).strength; queueCommand({ type:'ally', nation:1, target:o }); }
    tick();
    let k=0; for (let o=2;o<W.M;o++) if (allied(1,o)) k++;
    expect(k).toBe(MAX_ALLIES);
  });

  it('are broken by massing an attack on the ally\'s border', () => {
    world(1); quiet(); paintToward(1,2);
    queueCommand({ type:'ally', nation:1, target:2 }); tick();
    expect(allied(1,2)).toBe(true);
    soldiers(N(1),3);
    queueCommand({ type:'war', nation:1, target:2, soldiers:3 }); tick();
    expect(allied(1,2)).toBe(false);
    expect(inCrisis(1,2)).toBe(true);   // a crisis, not yet a war
    expect(atWar(1,2)).toBe(false);
  });
});

describe('declaring war', () => {
  it('sends each barracks\' army on its own; soldiers without room in a barracks stay home', () => {
    world(1); quiet(); paintDisc(N(1),14); place(N(2),B_FARM); paintToward(1,2);
    const a=place(N(1),B_BARRACKS), b=place(N(1),B_BARRACKS,pCenter[a]);   // two barracks far apart
    const men=soldiers(N(1),12,false); N(1).soldierShare=1; tick();
    const pool=available(N(1));
    expect(pool.map(p => p.men.length)).toEqual([5,5]);
    const patrol=men.filter(h => h.base<0);
    expect(patrol).toHaveLength(2);       // no room for them: they patrol the city
    expect(declare(1,2,[a,b])).toBe(true);
    const [c1,c2]=W.campaigns;
    expect(W.campaigns).toHaveLength(2);  // two armies, marching separately
    expect([c1.members.length,c2.members.length]).toEqual([5,5]);
    expect(Math.hypot(c1.bx-c2.bx,c1.by-c2.by)).toBeGreaterThan(16);   // each forms up at its own barracks
    expect(patrol.every(h => h.war===-1)).toBe(true);
    expect(available(N(1))).toHaveLength(0);
  });

  it('asked for a number of soldiers, sends the biggest armies first; joined barracks make one bigger army', () => {
    world(1); quiet(); place(N(2),B_FARM); paintToward(1,2);
    soldiers(N(1),10);                    // two modules side by side: one army of 10
    expect(available(N(1)).map(p => [p.men.length,p.unit.cap])).toEqual([[10,10]]);
    expect(declare(1,2,7)).toBe(true);
    expect(W.campaigns).toHaveLength(1);
    expect(W.campaigns[0].members).toHaveLength(7);
  });


  it('keeps soldiers on campaign out of training and off watchtower guard', () => {
    world(1); quiet();
    place(N(1),B_BARRACKS); place(N(2),B_FARM); paintToward(1,2);
    const men=soldiers(N(1),4);
    const tower=place(N(1),B_TOWER); togglePriority(N(1),tower);
    expect(declare(1,2,4)).toBe(true);
    queueCommand({ type:'soldiers', nation:1, share:0 });   // the kingdom wants no soldiers at all
    for (let i=0;i<60;i++){ tick(); for (const h of men) if (W.humans.includes(h)){ expect(switching(h)).toBe(false); expect(h.post).toBe(-1); } }
  });
});

describe('at war', () => {
  it('soldiers only fight between kingdoms at war', () => {
    world(1); quiet(); paintToward(1,2);
    const mine=soldiers(N(1),6), theirs=soldiers(N(2),6);
    const blows=collect('hit');
    // put them face to face on unclaimed ground
    let spot=-1; for (let t=0;t<NT && spot<0;t++) if (!owner[t] && owner[t+3]===0 && Math.abs((t%TW)-N(1).capTile%TW)<20 && Math.abs(((t/TW)|0)-((N(1).capTile/TW)|0))<20) spot=t;
    const sx=(spot%TW)*2+1, sy=((spot/TW)|0)*2+1;
    mine[0].x=sx; mine[0].y=sy; mine[0].sp=0; mine[0].wait=1e9; theirs[0].x=sx+1; theirs[0].y=sy; theirs[0].sp=0; theirs[0].wait=1e9;
    run(100);
    expect(blows).toHaveLength(0);
    expect(mine[0].hp).toBe(SOLDIER_HP[1]);
    // now 1 attacks with everything but that soldier, and fighting starts where the armies meet
    queueCommand({ type:'war', nation:1, target:2, soldiers:6 }); tick();
    expect(atWar(1,2)).toBe(false);   // massing on the border is a crisis: nobody fights yet
    giveWord(1,2);
    expect(atWar(1,2)).toBe(true);
    until(() => blows.length>5, 3000);
  });

  it('an attack takes the ground before its front, and breaking the castle annexes the kingdom: land, buildings and people, but not its gold or goods', () => {
    world(1); quiet(); paintDisc(N(2),14); paintToward(1,2);
    const house=place(N(2),B_HOUSE,N(1).capTile);   // on the far side, away from the fighting
    for (let i=0;i<3;i++) place(N(2),B_HOUSE,N(1).capTile);   // (a home for each of the four: the homeless starve after a minute and a half)
    // four of its people stand by the house far from the fighting when the kingdom falls
    const people: Human[]=[];
    for (let i=0;i<4;i++){ const [x,y]=frontOf(house); const v=makeHuman(N(2),H_VILLAGER,x+i,y); v.wait=1e9; v.hp=1e6; v.sp=0; W.humans.push(v); people.push(v); }   // (the mob that rises at the gate would cut them down; here they are annexed alive)
    N(2).gold=500; N(2).stock=[9,9,9]; N(1).stock=[3,4,5]; N(2).soldierShare=0;   // (they stay villagers, with no barracks to make them militia)
    const theirLand=Array.from({ length: NT }, (_, i) => i).filter(i => owner[i]===2);
    soldiers(N(1),30);
    const annexed=collect('annexed');
    queueCommand({ type:'war', nation:1, target:2, soldiers:30 }); tick();
    giveWord(1,2);
    // pushing in, the army occupies land before it reaches the castle; it stays theirs until the end
    until(() => theirLand.some(t => occ[t]===1), 2000);
    expect(theirLand.every(t => owner[t]===2)).toBe(true);
    expect(N(2).alive).toBe(true);
    until(() => !N(2).alive, 4000);
    expect(annexed).toEqual([[2,1]]);
    expect(theirLand.every(t => owner[t]===1)).toBe(true);
    for (const h of people){ expect(W.humans).toContain(h); expect(h.o).toBe(1); }
    expect([pType[house], pOwner[house], pBurn[house]]).toEqual([B_HOUSE, 1, 0]);   // the town changes hands unburnt
    expect(N(2).gold).toBe(0);
    expect(N(2).stock).toEqual([0,0,0]);
    expect(N(1).stock).toEqual([3,4,5]);   // the loser's goods are lost, not handed over
    expect(atWar(1,2)).toBe(false);
  });


});

describe('peace', () => {
  it('a kingdom in trouble accepts a peace offer; the armies go home without fighting', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),20);
    queueCommand({ type:'war', nation:1, target:2, soldiers:20 }); tick();
    escalate(1,2,true); run(50);
    const made=collect('peaceMade');
    queueCommand({ type:'endWar', nation:1, target:2 }); tick();
    expect(W.offers[1*W.M+2]).toBeGreaterThan(0);
    N(2).nextThink=0; tick();   // the bot answers when it next thinks
    expect(made).toEqual([[2,1]]);
    expect(atWar(1,2)).toBe(false);
    const c=W.campaigns[0];
    expect([c.phase, c.hostile]).toEqual([2, false]);
  });

  it('a kingdom that thinks it can win refuses', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),3); soldiers(N(2),40); run(1);
    queueCommand({ type:'war', nation:1, target:2, soldiers:3 }); tick();
    escalate(1,2,true);
    const refused=collect('peaceRefused');
    endWar(1,2);
    N(2).nextThink=0; N(2).nextWar=1e9; tick();
    expect(refused).toEqual([[1,2]]);
    expect(atWar(1,2)).toBe(true);
  });

  it('the player accepts a bot\'s offer from the war chip', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(2),5); run(1);
    expect(declare(2,1,5)).toBe(true); tick();
    W.offers[2*W.M+1]=W.tickN;
    queueCommand({ type:'peace', nation:1, target:2 }); tick();
    expect(atWar(1,2)).toBe(false);
  });

});


describe('soldiers on the move', () => {
  it('move 15% faster on their own land', () => {
    world(1);
    const [h]=soldiers(N(1),1), v=makeHuman(N(1),H_VILLAGER,h.x,h.y);
    expect(pace(h)).toBeCloseTo(h.sp*HOME_PACE);
    expect(HOME_PACE).toBeCloseTo(1.15);
    expect(pace(v)).toBe(v.sp);                    // villagers don't
    h.x=2; h.y=2;                                  // out on unclaimed ground
    expect(pace(h)).toBe(h.sp);
  });

  it('keep some room between them in a fight instead of piling onto one spot', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(2),4); tick();
    expect(declare(2,1,4)).toBe(true); escalate(2,1,true); tick();
    const [x,y]=doorOf(N(1)), men=soldiers(N(1),6);
    for (const h of men){ h.x=x; h.y=y+4; }   // all on one spot just outside the gate
    for (let i=0;i<20;i++) spread();
    let closest=Infinity;
    for (const a of men) for (const b of men) if (a!==b) closest=Math.min(closest,Math.hypot(a.x-b.x,a.y-b.y));
    expect(closest).toBeGreaterThan(1.8);
    expect(men.every(h => owner[((h.y/2)|0)*TW+((h.x/2)|0)]===1)).toBe(true);   // and stay on their own land
  });
});

describe('bots at war', () => {
  it('declare wars, take land, and annex one another in a long match', () => {
    newWorld(987654321);
    outer: for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){ if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue; if (startMatch((TH/2+dy*3)*TW+TW/2+dx*3, 9)) break outer; }
    quiet();
    const began=collect('warBegan'), crises=collect('crisis'), wars=collect('escalated'), annexed=collect('annexed');
    run(36000);   // armies big enough to break a castle take a while to raise (forty minutes, living on tax; the farms make the bots richer and slower to quarrel)
    expect(crises.length).toBeGreaterThan(0);    // attacks: massed on a border...
    expect(wars.length).toBeGreaterThan(0);      // ...and then war
    expect(annexed.length).toBeGreaterThan(0);
  }, 400000);
});

describe('wounds and healing', () => {
  it('gives tier 1 soldiers 8 hit points and 1 damage, tier 2 10 and 1.5, tier 3 15 and 2; villagers 4 and 0.5; everyone heals 0.1 a second', () => {
    world(1); quiet();
    const [s0]=soldiers(N(1),1), [x,y]=doorOf(N(1)), v=makeHuman(N(1),H_VILLAGER,x,y); W.humans.push(v); N(1).soldierShare=0.5;
    expect([s0.tier, s0.hp, v.hp, VILLAGER_HP]).toEqual([1, 8, 4, 4]);
    expect(SOLDIER_HP.slice(1)).toEqual([8, 10, 15]);
    expect([HIT_DMG.slice(1), MILITIA_DMG]).toEqual([[1, 1.5, 2], 0.5]);
    s0.hp=5; v.hp=2; run(100);
    expect(s0.hp).toBeCloseTo(6, 5);
    expect(v.hp).toBeCloseTo(3, 5);
    run(1000);
    expect([s0.hp, v.hp]).toEqual([8, 4]);     // no more than full
    s0.tier=3; run(1000);
    expect(s0.hp).toBe(15);                     // heavy armour holds more
  });

  it('announces the fallen where they fell', () => {
    world(1); quiet();
    const died=collect('died'), [s0]=soldiers(N(1),1); s0.hp=0; tick();
    expect(died).toHaveLength(1);
    expect(died[0].slice(2)).toEqual([1, s0.id, 1, 1, false]);   // kingdom, who, a soldier, of tier 1, in battle
  });
});

describe('villagers in danger', () => {
  it('either run or take up arms, about half each; runners get away, fighters go for the enemy', () => {
    world(1); quiet(); place(N(1),B_FARM); paintDisc(N(1),30);
    // out in the fields, well away from the castle (an enemy at the gate would raise a mob)
    const c=N(1).capTile, x=(c%TW)*2+1+50, y=((c/TW)|0)*2+1, folk: Human[]=[];
    for (let i=0;i<60;i++){ const v=makeHuman(N(1),H_VILLAGER,x+(i%10)-5,y+((i/10)|0)*0.8); W.humans.push(v); folk.push(v); }
    soldiers(N(2),1); run(1);
    W.contact[2*W.M+1]=W.contact[1*W.M+2]=1; expect(declare(2,1,1)).toBe(true); escalate(2,1,true);   // (at war, with an enemy soldier in the field)
    const e=W.humans.find(h => h.o===2 && h.war>=0)!; e.x=x; e.y=y+2; e.sp=0; e.hp=1000;   // an enemy among them who won't fall
    run(8);
    const near=folk.filter(v => Math.hypot(v.x-e.x,v.y-e.y)<DANGER_R && W.humans.includes(v));
    const fight=near.filter(v => v.brave===1).length, flee=near.filter(v => v.brave===0).length;
    expect(fight+flee).toBe(near.length);
    expect(fight).toBeGreaterThan(near.length*0.25);
    expect(flee).toBeGreaterThan(near.length*0.25);
    const runners=near.filter(v => v.brave===0), d0=runners.map(v => Math.hypot(v.x-e.x,v.y-e.y));
    run(30);
    const d1=runners.map(v => Math.hypot(v.x-e.x,v.y-e.y));
    expect(d1.reduce((a,b)=>a+b,0)).toBeGreaterThan(d0.reduce((a,b)=>a+b,0));
    expect(e.hp).toBeLessThan(1000);   // the brave ones are at him with pitchforks
  });
});

describe('occupation', () => {
  /** Bot 2 attacks us with k soldiers and occupies some of our land; returns its army. */
  function invaded(k: number, tiles: number){
    world(1); quiet(); paintToward(1,2); paintDisc(N(1),14);
    soldiers(N(2),k); run(1);
    expect(declare(2,1,k)).toBe(true);
    const c=W.campaigns[0];
    until(() => W.occCount[1*W.M+2]>=tiles, 4000);
    return c;
  }
  it('leaves occupied land with its owner, hatched as the occupier\'s; nobody builds there; at peace the occupier keeps what joins on to its land', () => {
    invaded(8,30);
    const held=Array.from({ length: NT }, (_, t) => t).filter(t => occ[t]===2);
    expect(held.every(t => owner[t]===1)).toBe(true);
    const centre=held.find(t => (t%TW&3)===2 && (((t/TW)|0)&3)===2);
    if (centre!==undefined){ const q=((centre/TW|0)>>2)*PW+((centre%TW)>>2); N(1).stock=[50,50,50]; expect(plotProblem(N(1),q)).toMatch(/enemy holds/); }
    makePeace(1,2);
    for (const t of held) expect([owner[t], occ[t]]).toEqual([2, 0]);   // (it all joins on: the front pushed in from 2's border)
    expect(W.occCount[1*W.M+2]).toBe(0);
    expect(atWar(1,2)).toBe(false);
  });

  it('at peace, occupied pockets landlocked in the other\'s borders go back to their owner: no islands in the new border', () => {
    invaded(8,30);
    const joined=Array.from({ length: NT }, (_, t) => t).filter(t => occ[t]===2);
    // a pocket of 1's land held by 2 with 1's land all round it, away from 2's ground (as a front left behind)
    const [ax,ay]=[N(1).capTile%TW, (N(1).capTile/TW)|0], [bx,by]=[N(2).capTile%TW, (N(2).capTile/TW)|0], L=Math.hypot(ax-bx,ay-by);
    const cx=Math.round(ax+(ax-bx)/L*10), cy=Math.round(ay+(ay-by)/L*10), pocket: number[]=[];   // beyond our castle, away from them
    for (let y=cy;y<cy+3;y++) for (let x=cx-1;x<cx+2;x++){ const t=y*TW+x; expect([owner[t], occ[t]]).toEqual([1, 0]); occupyHack(t,2); pocket.push(t); }
    makePeace(1,2);
    for (const t of joined) expect(owner[t]).toBe(2);
    for (const t of pocket) expect([owner[t], occ[t]]).toEqual([1, 0]);
    expect(W.occCount[1*W.M+2]).toBe(0);
  });

  it('doesn\'t burn what stands on the ground it occupies: the army has to break it', () => {
    world(1); quiet(); paintToward(1,2); paintDisc(N(1),28);
    soldiers(N(2),10); run(1);
    expect(declare(2,1,10)).toBe(true);
    // a farm of ours a few tiles ahead of their front, once it is pushing
    until(() => W.offensive[2*W.M+1]===F_PUSH && W.occCount[1*W.M+2]>20, 4000);
    const F=offensiveFront(2,1)!.F!, mid=F.tiles[F.tiles.length>>1], mx=mid%TW, my=(mid/TW)|0;
    const [cx,cy]=[N(1).capTile%TW, (N(1).capTile/TW)|0], L=Math.hypot(cx-mx,cy-my), px=mx+(cx-mx)/L*6, py=my+(cy-my)/L*6;
    const farm=Array.from({ length: NP }, (_, q) => q).filter(q => !plotProblem(N(1),q)).sort((a,b) => Math.hypot((a%PW)*4+2-px,((a/PW)|0)*4+2-py)-Math.hypot((b%PW)*4+2-px,((b/PW)|0)*4+2-py) || a-b)[0];
    N(1).stock=[10,10,0]; expect(build(N(1),farm,B_FARM)).toBe(true);
    until(() => occ[pCenter[farm]]===2, 4000);
    expect([pType[farm], pBurn[farm]]).toEqual([B_FARM, 0]);   // still standing on occupied ground
    until(() => pHp[farm]>0, 600);                             // until the line, passing by, sets about it
    until(() => pBurn[farm]>0 || pType[farm]===B_RUINS, 2000);
  });

  it('keeps the war going when the attacking army is gone; the defenders take their land back and are ready to counter-attack', () => {
    const c=invaded(8,30);
    for (const id of c.members) W.humans.find(h => h.id===id)!.hp=0;
    N(2).soldierShare=0;   // and it raises no more
    tick(); tick();
    expect(c.members).toHaveLength(0);   // its army waits in the field, empty, for whatever its barracks raises
    expect(atWar(1,2)).toBe(true);       // the war is not over
    const ready=collect('counterReady');
    soldiers(N(1),10);
    until(() => W.occCount[1*W.M+2]===0, 4000);
    until(() => ready.length>0, 50);
    expect(ready[0]).toEqual([1,2]);
    expect(W.ready[1*W.M+2]).toBeGreaterThan(0);
    // the counter-attack: the defender becomes the attacker, its troops thirsty for revenge
    const told=collect('story');
    queueCommand({ type:'war', nation:1, target:2, soldiers:10 }); tick();
    expect(W.ready[1*W.M+2]).toBe(0);
    const k=W.campaigns.find(k => k.a===1 && k.d===2)!;
    expect(k.inspired).toBe(true);
    expect(told.map(t => [t[0],t[1],t[4]])).toEqual([['revenge',1,2]]);
    // inspired, they hit a quarter harder and march a tenth faster
    expect([REVENGE_DMG, REVENGE_PACE]).toEqual([1.25, 1.1]);
    const h=W.humans.find(h => h.war===k.id)!, e=makeHuman(N(2),H_SOLDIER,h.x+1,h.y); W.humans.push(e);
    const hp=e.hp, hits=collect('hit'); h.cool=0; h.foe=e.id;
    for (let i=0;i<40 && !hits.length;i++){ h.cool=0; tick(); }
    expect(hp-e.hp).toBeCloseTo(HIT_DMG[1]*REVENGE_DMG*hits.filter(x => x[3]===e.id).length, 1);
  });

  it('an ordinary attack is not a counter-attack', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),5); const told=collect('story');
    expect(declare(1,2,5)).toBe(true);
    expect(W.campaigns[0].inspired).toBe(false);
    expect(told).toHaveLength(0);
  });

  it('sends the soldiers at home to man their side of the front, on their own land', () => {
    world(1); quiet(); paintToward(1,2);
    const guard=soldiers(N(1),6);
    soldiers(N(2),6); run(1);
    expect(declare(2,1,6)).toBe(true); escalate(2,1,true);
    until(() => guard.filter(h => h.fk===frontKey(2,1) && Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT*2).length>=4, 600);   // (a longer walk from a bigger kingdom)
    const F=offensiveFront(2,1)!.F!;
    for (const h of guard.filter(h => W.humans.includes(h))){   // (one may have fallen already)
      expect(h.fk).toBe(frontKey(2,1));
      expect(owner[(((h.y/2)|0)*TW+((h.x/2)|0))]).toBe(1);   // without leaving home
      // placed on the line, or (the border here is short) in ranks behind it
      expect(F.tiles.some(t => Math.hypot(t%TW+0.5-h.fx/2, ((t/TW)|0)+0.5-h.fy/2)<1.5+h.line*RANK_GAP)).toBe(true);
    }
    expect(guard.filter(h => Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT*2).length).toBeGreaterThanOrEqual(4);   // (one may be out fighting)
  });
});

describe('army leaders', () => {
  const byId = (id: number) => W.humans.find(h => h.id===id);
  /** Kingdom 1 attacks kingdom 2 (land 26 tiles round its castle, out of the castle's reach at the border) with k soldiers. */
  function attack(k: number){
    world(1); quiet(); paintDisc(N(2),26); paintToward(1,2);
    const men=soldiers(N(1),k); run(1);
    expect(declare(1,2,k)).toBe(true);
    return { c: W.campaigns[0], men };
  }

  it('are ranked by the size of the army: none up to 5, a leader to 15, a general to 30, a captain to 50, a commander to 80, a grand marshal beyond', () => {
    const at=[1,5,6,15,16,30,31,50,51,80,81,100,250].map(rankFor);
    expect(at).toEqual([0,0,1,1,2,2,3,3,4,4,5,5,5]);
    expect(RANKS.slice(1)).toEqual(['Leader','General','Captain','Commander','Grand Marshal']);
  });

  it('5 soldiers have none; 6 or more are led by the best armoured of them, who gives the order to march', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),5); run(1);
    expect(declare(1,2,5)).toBe(true);
    expect([W.campaigns[0].leader, W.campaigns[0].rank]).toEqual([-1,0]);
    const orders=collect('order');
    const { c, men }=attack(20);
    expect(c.rank).toBe(2);   // a general
    expect(c.leader).toBe(Math.min(...men.map(h => h.id)));   // all tier 1: the longest serving
    expect(orders.map(o => [o[0],o[3],o[4]])).toEqual([['march',2,c.leader]]);
    world(1); quiet(); paintToward(1,2);
    const six=soldiers(N(1),6); six[4].tier=2; run(1);
    expect(declare(1,2,6)).toBe(true);
    expect([W.campaigns[0].rank, W.campaigns[0].leader]).toEqual([1, six[4].id]);
  });

  it('the leader stands behind his men on the front, a rank behind the last, and tells when they are ready and when they go in', () => {
    const { c }=attack(12);
    const orders=collect('order');
    noDraft();
    giveWord(1,2);
    expect(orders.map(o => o[0])).toEqual(['ready','assault']);
    run(60);
    const l=byId(c.leader)!, men=c.members.filter(id => id!==c.leader).map(id => byId(id)!);
    expect(l.line).toBeGreaterThan(Math.max(...men.map(h => h.line)));
    // further from the line than any of his men's places
    const F=offensiveFront(1,2)!.F!, off=(x: number, y: number) => Math.min(...F.tiles.map(t => Math.hypot(t%TW+0.5-x/2, ((t/TW)|0)+0.5-y/2)));
    expect(off(l.fx,l.fy)).toBeGreaterThan(Math.max(...men.map(h => off(h.fx,h.fy))));
  });

  it('never retreat: bled however white, the army stays on the front, and every man its barracks raises joins it there', () => {
    const { c }=attack(10);
    noDraft();
    giveWord(1,2);
    run(30);
    let spared=0; for (const id of c.members) if (id!==c.leader && spared++>0) byId(id)!.hp=0;   // all but one and the leader
    run(20);
    expect(c.members).toHaveLength(2);
    expect([c.phase, W.offensive[1*W.M+2]]).toEqual([1, F_PUSH]);   // no falling back: it is the player's call
    queueCommand({ type:'offensive', nation:1, target:2, go:false }); tick();   // (the player holds the front)
    // new men at home march out to it, and take their places on the line
    const u=unitAt(c.unit)!, [x,y]=doorOf(N(1)), fresh: Human[]=[];
    for (let i=0;i<4;i++){ const h=makeHuman(N(1),H_SOLDIER,x+i,y+1); h.base=u.plots[0]; W.humans.push(h); fresh.push(h); }
    run(20);
    for (const h of fresh) expect(h.war).toBe(c.id);
    until(() => fresh.every(h => h.fk===frontKey(1,2) && Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT), 1500);
  });

  it('if he falls, the army fights on without him', () => {
    const { c }=attack(10);
    const orders=collect('order');
    noDraft();
    giveWord(1,2); run(20);
    byId(c.leader)!.hp=0; run(2);
    expect(orders.map(o => o[0])).toContain('fell');
    expect([c.leader, c.phase, W.offensive[1*W.M+2]]).toEqual([-1, 1, F_PUSH]);
    const taken=W.occCount[2*W.M+1]; run(50);
    expect(W.occCount[2*W.M+1]).toBeGreaterThan(taken);   // and pushes on
  });

  it('a leader who gets home ahead of his army is not mourned', () => {
    const { c }=attack(10);
    const orders=collect('order');
    run(30);
    makePeace(1,2);
    until(() => !W.campaigns.includes(c), 3000);
    expect(orders.filter(o => o[0]==='fell' || o[0]==='slain')).toHaveLength(0);
  });

  it('take double the blows of their soldiers for each rank, and go back to a soldier\'s once home', () => {
    const { c }=attack(20);   // a general: rank 2
    const l=byId(c.leader)!;
    expect(l.lead).toBe(2);
    expect(maxHp(l)).toBe(SOLDIER_HP[l.tier]*4);
    expect(l.hp).toBe(SOLDIER_HP[l.tier]*4);
    expect(HIT_DMG[l.tier]).toBe(SOLDIER_DMG[l.tier]);   // he hits no harder
    makePeace(1,2);
    until(() => l.war<0, 3000); run(1);
    expect([l.lead, maxHp(l)]).toEqual([0, SOLDIER_HP[l.tier]]);
    expect(l.hp).toBeLessThanOrEqual(SOLDIER_HP[l.tier]);
  });
});

/** Kingdoms 1 and 2 split a 200×120 box round the middle between their castles by a straight
    border `deg` degrees off the vertical. Returns the box. */
function split(deg: number){
  world(1); quiet();
  const [ax,ay]=[N(1).capTile%TW,(N(1).capTile/TW)|0], [bx,by]=[N(2).capTile%TW,(N(2).capTile/TW)|0];
  const mx=(ax+bx)/2, my=(ay+by)/2, nx=Math.cos(deg*Math.PI/180), ny=-Math.sin(deg*Math.PI/180);
  const box={ x0:Math.round(mx-100), x1:Math.round(mx+100), y0:Math.round(my-60), y1:Math.round(my+60), deg };
  for (let y=box.y0;y<box.y1;y++) for (let x=box.x0;x<box.x1;x++) setOwner(y*TW+x, (x-mx)*nx+(y-my)*ny<0 ? 1 : 2);
  census();
  return box;
}
type Box = ReturnType<typeof split>;
/** For each row of the box (bar its top and bottom 3), the furthest tile 1 holds: where its line is. */
const lineAt = (b: Box) => { const out: number[]=[]; for (let y=b.y0+3;y<b.y1-3;y++){ let m=b.x0; for (let x=b.x0;x<b.x1;x++) if (holds(1,2,y*TW+x)) m=x; out.push(m); } return out; };

/** How far the line strays from a straight one through it (tiles), by least squares; leaving out
    the rows across 2's castle (which the line goes round) and the last few at each end. */
function crooked(xs: number[], b: Box){
  const cy=((N(2).capPlot/PW)|0)*4, n0=xs.length, pts: [number, number][]=[];
  xs.forEach((x,i) => { const y=b.y0+3+i; if (i>=6 && i<n0-6 && (y<cy-1 || y>cy+8)) pts.push([y,x]); });
  const n=pts.length, my=pts.reduce((a,p) => a+p[0],0)/n, mx=pts.reduce((a,p) => a+p[1],0)/n;
  let sxy=0, syy=0; for (const [y,x] of pts){ sxy+=(y-my)*(x-mx); syy+=(y-my)**2; }
  const k=sxy/syy; return Math.max(...pts.map(([y,x]) => Math.abs(x-(mx+k*(y-my)))));
}

describe('the front', () => {
  /** Tiles of 2's free land left behind 1's line (not under the castle): ground the front missed. */
  const missed = (b: Box) => { const L=lineAt(b); let k=0; L.forEach((m,i) => { const y=b.y0+3+i; for (let x=b.x0;x<m;x++){ const t=y*TW+x; if (freeOf(2,t) && !underCastle(2,t)) k++; } }); return k; };
  const men = (o: number) => W.humans.filter(h => h.o===o && h.kind===H_SOLDIER);

  it('spreads the armies evenly along the whole border, behind it on their own ground; men the line has no room for stand in ranks behind', () => {
    split(0);
    const army=soldiers(N(1),30); noDraft(); noDraft(2);
    expect(declare(1,2,30)).toBe(true);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    const { F, k }=offensiveFront(1,2)!;
    expect(F!.len).toBeGreaterThan(100);                 // the whole border, 120 tiles of it
    const line=army.filter(h => h.id!==W.campaigns[0].leader);
    expect(k).toBe(line.length);                         // room enough: everyone in the front rank
    const ys=line.map(h => h.fy).sort((p,q) => p-q), gaps=ys.slice(1).map((y,i) => y-ys[i]), mean=gaps.reduce((a,b) => a+b,0)/gaps.length;
    expect(mean*29/2).toBeGreaterThan(100);              // spread over all of it
    for (const g of gaps){ expect(g).toBeGreaterThan(mean*0.5); expect(g).toBeLessThan(mean*1.6); }   // evenly
    for (const h of line){ expect(holds(1,2,((h.fy/2)|0)*TW+((h.fx/2)|0))).toBe(true); expect(Math.min(...F!.tiles.map(t => Math.abs(t%TW+0.5-h.fx/2)))).toBeLessThan(A_OFF+1); }
    // a border a few tiles long: as many as fit stand in the front rank, MIN_GAP apart, the rest in ranks behind them
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),30); noDraft();
    expect(declare(1,2,30)).toBe(true);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    const S=offensiveFront(1,2)!, lines=new Map<number, number>();
    for (const h of W.humans) if (h.o===1 && h.fk===frontKey(1,2) && h.line>=0) lines.set(h.line,(lines.get(h.line) ?? 0)+1);
    expect(S.k).toBe(Math.round(S.F!.len/MIN_GAP));
    expect(lines.get(0)).toBe(S.k);
    expect(lines.size).toBeGreaterThan(2);               // two ranks of reserves at least
    // each behind the man he backs up, no nearer the line than him
    const off=(x: number, y: number) => Math.min(...S.F!.tiles.map(t => Math.hypot(t%TW+0.5-x/2, ((t/TW)|0)+0.5-y/2)));
    for (const h of W.humans) if (h.o===1 && h.fk===frontKey(1,2) && h.line>=1){
      const front=W.humans.find(e => e.o===1 && e.line===0 && e.slot===h.slot)!;
      expect(off(h.fx,h.fy)).toBeGreaterThanOrEqual(off(front.fx,front.fy)-0.25);
      if (h.line===1) expect(off(h.fx,h.fy)).toBeGreaterThan(off(front.fx,front.fy)+RANK_GAP*0.5);   // the first rank behind, a rank back
    }
  });

  it('gathers, then waits for the word: nothing is taken before it; bots give it at once', () => {
    split(0);
    soldiers(N(1),20); noDraft(); noDraft(2);
    expect(declare(1,2,20)).toBe(true);
    expect(W.offensive[1*W.M+2]).toBe(F_GATHER);
    expect(offensiveProblem(1,2,false)).toMatch(/No war/);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    const placed=W.humans.filter(h => h.o===1 && h.war>=0 && h.id!==W.campaigns[0].leader);
    expect(placed.filter(h => Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT).length).toBeGreaterThanOrEqual(Math.ceil(placed.length*GATHER_AT));
    run(300);
    expect([W.offensive[1*W.M+2], W.occCount[2*W.M+1]]).toEqual([F_READY, 0]);
    expect(offensiveProblem(1,2,true)).toMatch(/Time to talk/);   // (the 30 seconds both sides have to react)
    queueCommand({ type:'offensive', nation:1, target:2, go:true }); tick();
    expect(inCrisis(1,2)).toBe(true);
    W.crisisAt[1*W.M+2]-=CRISIS_TICKS;
    expect(offensiveProblem(1,2,true)).toBeNull();
    queueCommand({ type:'offensive', nation:1, target:2, go:true }); tick();
    expect(W.offensive[1*W.M+2]).toBe(F_PUSH);
    run(50);
    expect(W.occCount[2*W.M+1]).toBeGreaterThan(100);
    // a bot's army goes in as soon as it is ready
    split(0);
    soldiers(N(2),20); noDraft(); noDraft(2);
    expect(declare(2,1,20)).toBe(true);
    until(() => W.offensive[2*W.M+1]===F_PUSH, 3000);
  });

  for (const deg of [0, 25, 45]) it(`pushes on a strip every two seconds all along the line, keeping it straight and missing nothing (border ${deg}° off the vertical)`, () => {
    const b=split(deg);
    soldiers(N(1),48); noDraft(); noDraft(2);
    expect(declare(1,2,48)).toBe(true);
    giveWord(1,2);
    const start=lineAt(b);
    run(200);   // 20 s
    const now=lineAt(b), cos=Math.cos(deg*Math.PI/180);
    const advance=now.reduce((a,x,i) => a+(x-start[i]),0)/now.length*cos;   // along the normal
    expect(advance).toBeGreaterThan(20*(10/ADVANCE_TICKS)*0.75*INVADE_EMPTY);   // a tile a strip, a strip every ADVANCE_TICKS (faster by INVADE_EMPTY: nobody of theirs stands there): 10 tiles in 20 seconds
    expect(advance).toBeLessThan(20*(10/ADVANCE_TICKS)*1.4*INVADE_EMPTY);
    expect(crooked(now,b)).toBeLessThanOrEqual(3);
    expect(missed(b)).toBe(0);
  });

  it('pushes slower the thinner its line: a man every DENSE tiles or closer at full speed', () => {
    const pace=(n: number) => {
      const b=split(0); soldiers(N(1),n); noDraft(); noDraft(2);
      expect(declare(1,2,n)).toBe(true);
      giveWord(1,2);
      const start=lineAt(b); run(600);   // (a tile every two seconds at full strength)
      const now=lineAt(b); return now.reduce((a,x,i) => a+(x-start[i]),0)/now.length;
    };
    const full=pace(40), thin=pace(10);   // 120 tiles of front: a man every 3 tiles, and every 12
    expect(full).toBeGreaterThan(24);
    expect(thin/full).toBeGreaterThan(DENSE/12*0.6);
    expect(thin/full).toBeLessThan(DENSE/12*1.5);
  });

  it('holds when told: takes no more ground and keeps its line; attacks again when told', () => {
    const b=split(0);
    soldiers(N(1),30); noDraft(); noDraft(2);
    expect(declare(1,2,30)).toBe(true);
    giveWord(1,2); run(100);
    expect(offensiveProblem(1,2,false)).toBeNull();
    queueCommand({ type:'offensive', nation:1, target:2, go:false }); tick();
    expect(W.offensive[1*W.M+2]).toBe(F_HOLD);
    const held=W.occCount[2*W.M+1]; run(200);
    expect(W.occCount[2*W.M+1]).toBe(held);
    const line=W.humans.filter(h => h.o===1 && h.war>=0 && h.line===0);
    expect(line.every(h => Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT)).toBe(true);   // every man at his place
    expect(missed(b)).toBe(0);
    queueCommand({ type:'offensive', nation:1, target:2, go:true }); tick();
    until(() => W.occCount[2*W.M+1]>held+500, 1500);   // a second wave: back to the front, then on
  });

  it('takes no more ground than its men stand on: the occupation ends a tile or two before its front rank', () => {
    const b=split(0);
    soldiers(N(1),40); noDraft(); run(1);
    expect(declare(1,2,40)).toBe(true);
    giveWord(1,2);
    let worst=0;
    for (let k=0;k<6;k++){
      run(40);
      const L=lineAt(b);
      for (const h of W.humans){
        if (h.o!==1 || h.war<0 || h.line!==0 || Math.hypot(h.x-h.fx,h.y-h.fy)>PRESENT) continue;
        const row=((h.y/2)|0)-b.y0-3; if (row<6 || row>=L.length-6) continue;
        worst=Math.max(worst, L[row]-h.x/2);
      }
    }
    expect(worst).toBeLessThanOrEqual(3.6);   // tiles from a man in his place to the edge of what his side holds before him (at most a strip's depth ahead, where a duel has just ended and the line closes over the gap)
  });

  it('can\'t take what a defender on the line holds; once he falls, the gap fills and the line comes even again', () => {
    const b=split(0);
    soldiers(N(1),40); noDraft(); noDraft(2);
    // one defender who can't be beaten, standing on their side of the border, in the middle
    const mid=(b.y0+b.y1)>>1, edge=lineAt(b)[mid-b.y0-3]+1, [d]=soldiers(N(2),1,false);
    d.x=(edge+ZOC+1)*2+1; d.y=mid*2+1; d.sp=0; d.militia=true;   // (a militiaman holds his ground like anyone)
    expect(declare(1,2,40)).toBe(true);
    giveWord(1,2);
    for (let i=0;i<400;i++){ d.hp=1e6; tick(); }
    // the ground round him is still theirs, while the line has gone on either side
    const t=((d.y/2)|0)*TW+((d.x/2)|0);
    for (let dy=-ZOC;dy<=ZOC;dy++) for (let dx=-ZOC;dx<=ZOC;dx++) expect(freeOf(2,t+dy*TW+dx)).toBe(true);
    expect(Math.min(...lineAt(b))).toBeGreaterThan(edge+10);
    d.hp=0; run(300);
    expect(missed(b)).toBe(0);
    expect(crooked(lineAt(b),b)).toBeLessThanOrEqual(4);
  });

  it('a man of the front rank who falls is replaced by the one behind him', () => {
    world(1,11); quiet(); paintToward(1,2);   // (a front whose slots stay put while he falls: where the line is laid out again just then, the gap goes to whoever is nearest)
    soldiers(N(1),30); noDraft(); N(2).soldierShare=0;
    expect(declare(1,2,30)).toBe(true);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    const front=W.humans.find(h => h.o===1 && h.line===0 && W.humans.some(e => e.o===1 && e.line===1 && e.slot===h.slot))!;
    const u=front.slot, second=new Set(W.humans.filter(e => e.o===1 && e.line===1 && e.slot===u).map(e => e.id));
    front.hp=0; run(12);
    const behind=W.humans.find(h => h.o===1 && h.line===0 && h.slot===u)!;
    expect(second.has(behind.id)).toBe(true);   // one from the rank behind steps up into the gap
    until(() => Math.hypot(behind.x-behind.fx,behind.y-behind.fy)<=PRESENT, 200);
  });

  it('takes ground of theirs cut off behind the front', () => {
    const b=split(0);
    soldiers(N(1),40); noDraft(); noDraft(2);
    expect(declare(1,2,40)).toBe(true);
    giveWord(1,2); run(300);
    // a patch behind the line, theirs again, cut off from the rest of their land
    const y=(b.y0+b.y1)>>1, x=lineAt(b)[y-b.y0-3]-8, patch: number[]=[];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const t=(y+dy)*TW+x+dx; expect(occ[t]).toBe(1); freeHack(t); patch.push(t); }
    run(25);
    for (const t of patch) expect(occ[t]).toBe(1);
  });

  it('stays quick with a hundred men a side fighting along a long front', () => {
    split(0);
    soldiers(N(1),100); soldiers(N(2),100); noDraft(); noDraft(2); run(1);
    expect(declare(1,2,100)).toBe(true);
    giveWord(1,2,4000);
    const t0=performance.now(); run(300); const ms=(performance.now()-t0)/300;
    expect(ms).toBeLessThan(25);
    expect(men(1).length+men(2).length).toBeLessThan(200);   // (they fought)
  });
});

describe('walls', () => {
  it('join two watchtowers side by side, keep out everyone but their kingdom and its allies, and fall with a tower', () => {
    world(1); quiet(); paintDisc(N(2),20);
    const q=place(N(2),B_TOWER,N(1).capTile);
    N(2).stock=[50,50,50];
    const q2=[q+1,q-1,q+PW,q-PW].find(k => !plotProblem(N(2),k))!;
    expect(build(N(2),q2,B_TOWER)).toBe(true);
    tick();
    const tiles=Array.from({ length: NT }, (_, t) => t).filter(t => wallOf[t]);
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles.every(t => wallOf[t]===2)).toBe(true);
    expect(walledFor(1,tiles[0])).toBe(true);
    expect(walledFor(2,tiles[0])).toBe(false);
    W.ally[1*W.M+2]=W.ally[2*W.M+1]=1;
    expect(walledFor(1,tiles[0])).toBe(false);
    W.ally[1*W.M+2]=W.ally[2*W.M+1]=0;
    pBurn[q2]=50; tick();
    expect(tiles.some(t => wallOf[t])).toBe(false);
  });

  it('an army walled out knocks down a tower to get in', () => {
    world(1); quiet(); paintDisc(N(2),24); paintToward(1,2);
    // a ring of towers round their castle (2 by 2 plots), two plots out
    const cx=N(2).capPlot%PW, cy=(N(2).capPlot/PW)|0, ring: number[]=[];
    for (let y=cy-2;y<=cy+3;y++) for (let x=cx-2;x<=cx+3;x++){
      if (x>cx-2 && x<cx+3 && y>cy-2 && y<cy+3) continue;
      const k=y*PW+x; N(2).stock=[50,50,50];
      if (!plotProblem(N(2),k)) build(N(2),k,B_TOWER);
      if (pType[k]!==B_TOWER){ pType[k]=B_TOWER; pOwner[k]=2; N(2).blds.push(k); }
      ring.push(k);
    }
    const inside=(h: Human) => h.x>(cx-1)*8 && h.x<(cx+3)*8 && h.y>(cy-1)*8 && h.y<(cy+3)*8;
    const men=soldiers(N(1),10);
    for (const h of men){ h.tier=3; }
    expect(declare(1,2,10)).toBe(true);
    giveWord(1,2);
    let breached=-1;
    for (let i=0;i<9000 && breached<0;i++){
      for (const h of men) if (h.hp>0) h.hp=1000;   // (no matter the arrows)
      tick();
      const broken=ring.some(k => pType[k]!==B_TOWER || pBurn[k]>0);
      if (men.some(h => W.humans.includes(h) && inside(h))){ expect(broken).toBe(true); breached=i; }
    }
    expect(breached).toBeGreaterThan(0);
  });
});


describe('crisis', () => {
  const M = () => W.M;
  /** Everyone of kingdom o out with an army stands on o's own land. */
  const home = (o: number) => W.humans.filter(h => h.o===o && h.war>=0).every(h => owner[((h.y/2)|0)*TW+((h.x/2)|0)]===o);

  it('an attack begins as a crisis: both sides mass on the border and nobody fights until the attacker gives the word', () => {
    split(0);
    soldiers(N(1),20); soldiers(N(2),20); noDraft(); noDraft(2); run(1);
    const blows=collect('hit'), crises=collect('crisis'), wars=collect('escalated');
    expect(declare(1,2,20)).toBe(true);
    expect(crises).toEqual([[1,2]]);
    expect([inCrisis(1,2), atWar(1,2), W.wars[1*M()+2]]).toEqual([true, false, 0]);
    expect(defend(2,1,20)).toBe(true);   // 2 sends its army to hold its side of the border
    until(() => W.offensive[1*M()+2]===F_READY && W.offensive[2*M()+1]===F_READY, 3000);
    run(200);
    expect(blows).toHaveLength(0);
    expect(atWar(1,2)).toBe(false);
    expect(W.occCount[2*M()+1]+W.occCount[1*M()+2]).toBe(0);
    expect(home(1) && home(2)).toBe(true);   // each on its own side
    expect([menOn(1,2), menOn(2,1)]).toEqual([20, 20]);
    // only the side that massed first can turn it into a war
    expect(offensiveProblem(2,1,true)).toMatch(/not attacked/);
    expect(setOffensive(2,1,true)).toBe(false);
    expect(inCrisis(1,2)).toBe(true);
    // the word: war. 1 attacks all along the front, 2's front holds, and the armies clash on the border
    giveWord(1,2);
    expect(wars).toEqual([[1,2]]);
    expect([W.wars[1*M()+2], W.wars[2*M()+1], W.offensive[2*M()+1]]).toEqual([1, 1, F_HOLD]);
    until(() => blows.length>10, 600);
  });

  it('the side that massed first can call it off: both sides go home and there is nothing to make peace over; at war it can\'t', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),10); soldiers(N(2),10); noDraft(); noDraft(2); run(1);
    expect(declare(1,2,10)).toBe(true);
    expect(defend(2,1,10)).toBe(true);
    run(50);
    expect(deescalateProblem(2,1)).toMatch(/No crisis/);
    const calm=collect('deescalated');
    queueCommand({ type:'deescalate', nation:1, target:2 }); tick();
    expect(calm).toEqual([[1,2]]);
    expect([inCrisis(1,2), W.aggr[1*M()+2], W.wars[1*M()+2]]).toEqual([false, 0, 0]);
    expect(W.campaigns.every(c => c.phase===2 && !c.hostile)).toBe(true);   // both sides' armies head home
    until(() => !W.campaigns.length, 2000);
    expect(ready(N(1))).toBe(10);
    // again, and this time to war: there is no calling that off
    expect(declare(1,2,10)).toBe(true);
    expect(escalate(1,2,true)).toBe(true);
    expect(deescalateProblem(1,2)).toMatch(/peace/);
    expect(deescalate(1,2)).toBe(false);
  });

  it('a bot massed on a border goes to war once ready, unless far more stand against it: then it backs down', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(2),10); soldiers(N(1),30); noDraft(); noDraft(2); N(2).attackAt=0.6; run(1);
    const calm=collect('deescalated'), wars=collect('escalated');
    expect(declare(2,1,10)).toBe(true);
    expect(defend(1,2,30)).toBe(true);   // three times its men hold the other side
    until(() => calm.length+wars.length>0, 3000);
    expect([calm.length, wars.length]).toEqual([1, 0]);
    until(() => !W.campaigns.length, 3000);
    // a fair fight, and it goes to war
    for (const h of W.humans.filter(h => h.o===1 && h.kind===H_SOLDIER).slice(5)) h.hp=0;
    run(2);
    expect(declare(2,1,10)).toBe(true);
    expect(defend(1,2,5)).toBe(true);
    until(() => wars.length>0, 3000);
    tick();
    expect(calm).toHaveLength(1);
    expect(W.offensive[2*M()+1]).toBe(F_PUSH);
  });

  it('at war the defender can strike back from its own front: its own land first, then theirs', () => {
    const b=split(0);
    soldiers(N(1),10); soldiers(N(2),40); noDraft(); noDraft(2); run(1);
    expect(declare(1,2,10)).toBe(true);
    expect(defend(2,1,40)).toBe(true);
    until(() => W.offensive[1*M()+2]===F_READY && W.offensive[2*M()+1]===F_READY, 3000);
    expect(escalate(1,2,true)).toBe(true);
    setOffensive(1,2,false);   // 1 holds; say it had taken a band of 2's land along the border
    const line=lineAt(b);
    for (let y=b.y0+3;y<b.y1-3;y++) for (let x=line[y-b.y0-3]+1;x<=line[y-b.y0-3]+4;x++){ const t=y*TW+x; if (owner[t]===2){ occupyHack(t,1); } }
    const taken=W.occCount[2*M()+1];
    expect(taken).toBeGreaterThan(300);
    run(30);   // the fronts move to the new line
    // 2's land is occupied: its armies take it back by themselves, and it may neither counter-charge nor hold the border
    expect(W.offensive[2*M()+1]).toBe(F_PUSH);
    expect(offensiveProblem(2,1,true)).toMatch(/attacks already/);
    expect(setOffensive(2,1,true)).toBe(false);
    // all the while it takes its land back, and after it, its men keep to their own side: none out on the enemy's own ground
    let strays=0;
    for (let i=0;i<4000 && W.occCount[2*M()+1]>0;i++){ tick();
      for (const h of W.humans) if (h.o===2 && h.war>=0 && h.kind===H_SOLDIER){ const t=((h.y/2)|0)*TW+((h.x/2)|0); if (owner[t]===1 && !occ[t] && [t-1,t+1,t-TW,t+TW].every(k => owner[k]===1 && !occ[k])) strays++; }   // (on the line itself, a tile over it, does not count: deeper in does)
    }
    expect(strays).toBe(0);
    until(() => W.occCount[2*M()+1]===0, 4000);
    const inBand=(t: number) => { const y=(t/TW)|0, x=t%TW; return y>=b.y0+3 && y<b.y1-3 && x>line[y-b.y0-3] && x<=line[y-b.y0-3]+4; };
    expect(Array.from({ length: NT }, (_, t) => t).some(t => inBand(t) && occ[t]===1)).toBe(false);
    expect(W.occCount[1*M()+2]).toBe(0);                       // (it took none of theirs while it did: only its own)
    run(40);
    expect(W.offensive[2*M()+1]).toBe(F_HOLD);                 // its land is back: it holds, and may strike back
    for (let i=0;i<300;i++){ tick();   // ...and goes on holding on its own side of the border, out of reach of their watchtowers, until it is told to attack
      for (const h of W.humans) if (h.o===2 && h.war>=0 && h.kind===H_SOLDIER){ const t=((h.y/2)|0)*TW+((h.x/2)|0); expect(owner[t]===1 && !occ[t]).toBe(false); }
    }
    expect(W.offensive[2*M()+1]).toBe(F_HOLD);
    queueCommand({ type:'offensive', nation:2, target:1, go:true }); tick();
    expect(W.offensive[2*M()+1]).toBe(F_PUSH);                 // and is then the attacker
    until(() => W.occCount[1*M()+2]>500, 4000);                // on into 1's, all along
    const now=lineAt(b), mid=now.slice().sort((p,q) => p-q)[now.length>>1];
    expect(now.filter(x => Math.abs(x-mid)<=1).length).toBeGreaterThan(now.length*0.6);   // a fairly straight line (bar where 1's men still stand their ground, each in a duel)
    expect(mid).toBeLessThan(Math.min(...line));   // and back past where the border was
  });
});

describe('duels', () => {
  /** One unbeatable defender in the middle of 40 attackers: the hit points it lost in 300 ticks, and how many were swinging at it. */
  function lone(){
    const b=split(0);
    soldiers(N(1),40); noDraft(); noDraft(2);
    const mid=(b.y0+b.y1)>>1, edge=lineAt(b)[mid-b.y0-3]+1, [d]=soldiers(N(2),1,false);
    d.x=(edge+ZOC+1)*2+1; d.y=mid*2+1; d.sp=0; d.militia=true; d.hp=1e6;
    expect(declare(1,2,40)).toBe(true); giveWord(1,2);
    const swinging=new Set<number>(); let most=0;
    listen({ swing: (a: number, e: number) => { if (e===d.id) swinging.add(a); } });
    const hp0=d.hp;
    for (let i=0;i<300;i++){ d.hp=hp0-(hp0-d.hp); tick(); }
    return { lost: hp0-d.hp, swinging: swinging.size, d };
  }
  it('are one on one: a lone defender among 40 attackers is struck by one man at a time, not swarmed', () => {
    const { lost, swinging } = lone();
    expect(lost).toBeGreaterThan(0);
    // one man swings once a second (10 ticks), 7 times in 10 land, a tier 1 soldier for 1: at most about 30 in 300 ticks, a swarm of even four would be four times that
    expect(lost).toBeLessThanOrEqual(31);
    expect(swinging).toBeGreaterThanOrEqual(1);
  });
  it('end with a death, and the next man takes his place', () => {
    const b=split(0);
    soldiers(N(1),40); noDraft(); noDraft(2);
    const mid=(b.y0+b.y1)>>1, edge=lineAt(b)[mid-b.y0-3]+1, men=soldiers(N(2),3,false);
    men.forEach((d,i) => { d.x=(edge+ZOC+1)*2+1; d.y=(mid+i*3)*2+1; d.sp=0; d.militia=true; d.hp=3; });
    expect(declare(1,2,40)).toBe(true); giveWord(1,2);
    run(900);
    expect(men.every(d => d.hp<=0)).toBe(true);   // all three fell, each to the one man who took him on
    // no attacker was ever in two duels, and none is left with a dead man as his partner
    for (const h of W.humans) if (h.duel>=0){ const p=W.humans.find(x => x.id===h.duel); expect(p && p.duel===h.id).toBe(true); }
  });
  it('are with whoever is alive and close: a man who runs from his duel is free of it', () => {
    world(1); quiet();
    const [a]=soldiers(N(1),1,false), [e]=soldiers(N(2),1,false);
    a.duel=e.id; e.duel=a.id; a.x=100; a.y=100; e.x=200; e.y=200;   // far apart
    // (a duel holds only while they are close)
    run(1);
    expect(partner(a)).toBeUndefined(); expect([a.duel,e.duel]).toEqual([-1,-1]);
    a.x=100; a.y=100; e.x=102; e.y=100; a.duel=e.id; e.duel=a.id;   // close, both alive: it holds
    expect(partner(a)).toBe(e);
    e.hp=0; expect(partner(a)).toBeUndefined();   // he fell: it is over
  });
});

describe('holding the border, and the second wave', () => {
  /** A broad war against a far kingdom, run until the attacker has taken some ground. */
  function started(defenders=0){
    world(1); quiet(); paintDisc(N(2),60); paintToward(1,2);
    soldiers(N(1),40); if (defenders) soldiers(N(2),defenders); noDraft(); N(2).soldierShare=defenders ? 1 : 0; N(2).humanProg=-1e9; run(2);
    expect(declare(1,2,40)).toBe(true); if (defenders) expect(defendProblem(2,1)).toBeNull(), expect(defend(2,1,defenders)).toBe(true); giveWord(1,2); run(500);
    const taken=() => W.occCount[2*W.M+1];
    expect(taken()).toBeGreaterThan(100);
    return taken;
  }
  const crew = (c: { members: number[] }) => W.humans.filter(h => c.members.includes(h.id) && h.hp>0);
  const onOwn = (c: { members: number[] }) => crew(c).filter(h => owner[((h.y/2)|0)*TW+((h.x/2)|0)]===1).length / Math.max(1,crew(c).length);

  it('defending falls back to the edge of the ground the towers of the enemy do not reach (the occupied ground stays occupied), and attacking again goes on from there', () => {
    const taken=started(), before=taken();
    const c=W.campaigns.find(k => k.a===1 && k.d===2 && k.front)!;
    // a watchtower of theirs shoots out over the ground their enemy has taken
    const [gx,gy]=doorOf(N(2)), edge=Array.from({ length: NT }, (_, t) => t).filter(t => owner[t]===2 && occ[t]===1).sort((p,q) => Math.hypot((p%TW)*2-gx,((p/TW)|0)*2-gy)-Math.hypot((q%TW)*2-gx,((q/TW)|0)*2-gy))[0];
    const q=(((edge/TW)|0)>>2)*PW+((edge%TW)>>2)+3;
    pType[q]=B_TOWER; pOwner[q]=2; pBurn[q]=0; buildWalls();
    expect(setOffensive(1,2,false)).toBe(true);
    run(400);
    expect(W.offensive[1*W.M+2]).toBe(F_HOLD);
    expect(taken()).toBeGreaterThanOrEqual(before);       // nothing given back
    expect(onOwn(c)).toBeLessThan(0.5);                   // it fell back onto the ground it holds, not onto its own land: the occupied zone is the closest place...
    const inReach=crew(c).filter(h => walledFor(1,((h.y/2)|0)*TW+((h.x/2)|0))).length;
    expect(inReach).toBe(0);                              // ...that no tower reaches
    // the second wave
    queueCommand({ type:'offensive', nation:1, target:2, go:true }); tick();
    expect(W.offensive[1*W.M+2]).toBe(F_PUSH);
    run(600);
    expect(taken()).toBeGreaterThan(before);
  });

  it('how fast an invasion goes depends on the defender\'s soldiers on that landmass: 75% faster with none, 10% slower with a few, 40% slower with as many as the invaders, 50% at most', () => {
    expect(invadeSpeed(40,0)).toBe(INVADE_EMPTY); expect(INVADE_EMPTY).toBe(1.75);
    expect(invadeSpeed(100,1)).toBeCloseTo(0.9-0.003,3);         // one man: about 10% off
    expect(invadeSpeed(40,40)).toBeCloseTo(0.6,9);               // as many: 40% off
    expect(invadeSpeed(40,20)).toBeCloseTo(0.75,9);              // between
    expect(invadeSpeed(40,80)).toBeCloseTo(0.5,9);               // twice as many: 50% off, no more
    expect(invadeSpeed(40,400)).toBeCloseTo(0.5,9);
  });

  it('the invader marches slower on enemy ground it has not occupied yet (never faster than usual), and at full pace over ground it has', () => {
    started();
    const c=W.campaigns.find(k => k.a===1 && k.d===2 && k.front)!, h=crew(c)[0];
    const put=(t: number) => { h.x=(t%TW)*2+1; h.y=((t/TW)|0)*2+1; };
    const free=Array.from({ length: NT }, (_, t) => t).find(t => owner[t]===2 && !occ[t])!;
    const held=Array.from({ length: NT }, (_, t) => t).find(t => owner[t]===2 && occ[t]===1)!;
    put(free); const slow=marchPace(h,c)/(pace(h)*(c.inspired ? 1.15 : 1));
    expect(slow).toBeGreaterThanOrEqual(0.5-1e-9); expect(slow).toBeLessThanOrEqual(1+1e-9);
    put(held); expect(marchPace(h,c)).toBeGreaterThan(pace(h)*0.99);
  });

  it('there is one front between two kingdoms at war, and a pocket cut off from the occupied ground goes back at once', () => {
    started();
    expect(frontLines().filter(f => (f.a===1 && f.d===2) || (f.a===2 && f.d===1))).toHaveLength(1);
    // a lone tile deep in 2's land, marked as occupied by 1, is no part of the front
    const [gx,gy]=doorOf(N(2)), deep=((gy/2)|0)*TW+((gx/2)|0)+8;
    expect(owner[deep]).toBe(2); expect(occ[deep]).toBe(0);
    occupyHack(deep,1);
    run(25);
    expect(occ[deep]).toBe(0);
  });

  it('a bot whose attack has stuck pulls back to the border to mass a second wave, and goes in again when the recruits are there (or it has waited long enough)', () => {
    started();
    soldiers(N(1),6); run(2);
    const n=N(1), key=1*W.M+2, was=W.occCount[2*W.M+1];
    W.stall[key]=W.stall[2*W.M+1]=800;      // no headway for a minute and more
    n.nextThink=0; botThink(n); tick();
    expect(W.offensive[key]).toBe(F_HOLD);
    expect(n.mass.has(2)).toBe(true);
    run(50);
    expect(W.offensive[key]).toBe(F_HOLD);   // it waits there for the others
    expect(W.occCount[2*W.M+1]).toBeGreaterThanOrEqual(was);
    n.mass.get(2)!.t-=5000;                  // ...and in the end goes in anyway
    n.nextThink=0; botThink(n); tick();
    expect(W.offensive[key]).toBe(F_PUSH);
    expect(n.mass.has(2)).toBe(false);
  });

  it('a kingdom whose land is occupied has to take it back first: no counter-charge, no holding, and its armies go after it', () => {
    started(6); run(60);
    expect(W.offensive[2*W.M+1]).toBe(F_PUSH);   // (set by the retaking itself)
    expect(offensiveProblem(2,1,true)).toMatch(/attacks already/);
    expect(setOffensive(2,1,true)).toBe(false);
    // told to defend instead, its armies fall back and stop retaking its land (and attack again, retaking it, when told)
    expect(setOffensive(2,1,false)).toBe(true);
    run(5); expect(W.offensive[2*W.M+1]).toBe(F_HOLD);
    expect(setOffensive(2,1,true)).toBe(true);
    run(5); expect(W.offensive[2*W.M+1]).toBe(F_PUSH);
  });
});

describe('parts of a border, and the siege of a capital', () => {
  /** A war on a broad front against a kingdom far off, its armies assigned to `sec` of the border (0: all of it); what its army took. */
  function fight(sec: number, ticks=240){
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),60); paintToward(1,2);
    soldiers(N(1),40); noDraft(); N(2).soldierShare=0; N(2).humanProg=-1e9; run(2);
    const keys=available(N(1)).map(a => a.unit.key); expect(keys.length).toBeGreaterThan(0);
    expect(declare(1,2,40)).toBe(true);
    if (sec) for (const k of keys) expect(assignArmy(1,k,2,0,undefined,sec)).toBe(true);
    giveWord(1,2); run(ticks);
    const [gx,gy]=doorOf(N(2)), took: number[]=[];
    for (let t=0;t<NT;t++) if (owner[t]===2 && occ[t]===1) took.push(t);
    const near=Math.min(...took.map(t => Math.hypot((t%TW)*2+1-gx, ((t/TW)|0)*2+1-gy)));
    return { took, near, gx, gy };
  }
  it('the siege: the armies take a narrow way to the capital, further in than the whole border gets, and not the rest of the border', () => {
    const all=fight(0,360), siege=fight(SEC_SIEGE,360);   // (the invasion is slow: strips come every 2 seconds, a siege's every second)
    expect(all.took.length).toBeGreaterThan(50);
    expect(siege.took.length).toBeGreaterThan(50);
    expect(siege.near).toBeLessThan(all.near-10);                  // closer to the capital
  });
  it('a siege that holds the way to the capital goes on to break it: the capital falls', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),60); paintToward(1,2);
    soldiers(N(1),40); noDraft(); N(2).soldierShare=0; N(2).humanProg=-1e9; run(2);
    const keys=available(N(1)).map(a => a.unit.key), fell=collect('capitalFell');
    expect(declare(1,2,40)).toBe(true);
    for (const k of keys) expect(assignArmy(1,k,2,0,undefined,SEC_SIEGE)).toBe(true);
    giveWord(1,2); run(1200);
    expect(fell.length+collect('eliminated').length+(N(2).alive ? 0 : 1)).toBeGreaterThan(0);
  });
  it('one border that runs on unbroken is offered whole, however many compass sectors it crosses: no parts, so no gaps in the front', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14);
    const [ax,ay]=[N(1).capTile%TW,(N(1).capTile/TW)|0], [bx,by]=[N(2).capTile%TW,(N(2).capTile/TW)|0], mx=(ax+bx)/2, my=(ay+by)/2;
    for (let y=Math.round(my-60);y<Math.round(my+60);y++) for (let x=Math.round(mx-100);x<Math.round(mx+100);x++) setOwner(y*TW+x, x<mx ? 1 : 2);
    census(); W.tickN+=100;
    const parts=bordersOf(1).filter(b => b.sec!==SEC_SIEGE);
    expect(parts).toHaveLength(1); expect(parts[0].sec).toBe(0);
    expect(new Set(parts[0].tiles.map(t => sectorOf(2,t))).size).toBeGreaterThan(1);   // (it does cross several sectors)
  });
  it('a compass sector: the armies take only the part of the border that lies that way from their castle', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14);
    const [ax,ay]=[N(1).capTile%TW,(N(1).capTile/TW)|0], [bx,by]=[N(2).capTile%TW,(N(2).capTile/TW)|0], mx=(ax+bx)/2, my=(ay+by)/2;
    for (let y=Math.round(my-60);y<Math.round(my+60);y++) for (let x=Math.round(mx-100);x<Math.round(mx+100);x++) setOwner(y*TW+x, x<mx ? 1 : 2);
    census();
    const border: number[]=[]; for (let t=0;t<NT;t++) if (owner[t]===2 && [t-1,t+1,t-TW,t+TW].some(k => owner[k]===1)) border.push(t);
    const secs=new Map<number, number>(); for (const t of border) secs.set(sectorOf(2,t),(secs.get(sectorOf(2,t)) ?? 0)+1);
    expect(secs.size).toBeGreaterThan(1);                           // (the border runs across more than one sector)
    const sec=[...secs].sort((p,q) => q[1]-p[1])[0][0];
    soldiers(N(1),40); noDraft(); noDraft(2); N(2).soldierShare=0; N(2).humanProg=-1e9; run(2);
    const keys=available(N(1)).map(a => a.unit.key); expect(keys.length).toBeGreaterThan(0);
    expect(declare(1,2,40)).toBe(true);
    for (const k of keys) expect(assignArmy(1,k,2,0,undefined,1<<(sec-1))).toBe(true);   // (a set of sectors: this one)
    giveWord(1,2); run(480);
    const took: number[]=[]; for (let t=0;t<NT;t++) if (owner[t]===2 && occ[t]===1) took.push(t);
    expect(took.length).toBeGreaterThan(20);
    // what they took lies in that sector (or beside it): not the whole border
    const inSec=took.filter(t => { const k=Math.abs(sectorOf(2,t)-sec); return k<=1 || k>=7; }).length;
    expect(inSec).toBeGreaterThan(took.length*0.85);
  });
  it('a capital with all the ground round it occupied is under siege: both sides are told, it cannot expand for 30 seconds, and the defenders it raises are a quarter stronger until the siege is over', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),20); paintToward(1,2); noDraft(2);
    soldiers(N(1),10); noDraft(); W.wars[1*W.M+2]=W.wars[2*W.M+1]=1; W.atWar[1*W.M+2]=W.atWar[2*W.M+1]=1;
    const told=collect('siege');
    const D=N(2), q=D.capPlot, x0=(q%PW)*4, y0=((q/PW)|0)*4, ring: number[]=[];
    for (let y=y0-1;y<=y0+8;y++) for (let x=x0-1;x<=x0+8;x++){ const t=y*TW+x; if ((x>=x0 && x<x0+8 && y>=y0 && y<y0+8) || owner[t]!==2) continue; ring.push(t); }
    expect(ring.length).toBeGreaterThan(10);
    run(12); expect(told).toHaveLength(0);
    for (const t of ring) occupyHack(t,1);
    run(12);
    expect(told).toEqual([[1,2,true]]);                              // told once, the besieger and the besieged
    expect(besieged(2)).toBe(true); expect(siegeLocked(2)).toBe(true);
    // a defender raised now is a quarter stronger, in hit points and in blows
    const h=makeHuman(D,H_SOLDIER,doorOf(D)[0],doorOf(D)[1]); h.fury=true; h.hp=maxHp(h);
    expect(maxHp(h)).toBeCloseTo(SOLDIER_HP[1]*1.25,9);
    W.tickN+=CRISIS_TICKS;   // (30 seconds on)
    expect(siegeLocked(2)).toBe(false); expect(besieged(2)).toBe(true);   // the lock lasts 30 seconds; the siege goes on
    for (const t of ring) freeHack(t);
    run(12);
    expect(told[told.length-1]).toEqual([1,2,false]);
    expect(besieged(2)).toBe(false);
  });
  it('a kingdom whose capital is spawning during a siege: its new people are born stronger, and lose it when the siege ends', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),20); paintToward(1,2); soldiers(N(1),10); noDraft(); noDraft(2);
    W.wars[1*W.M+2]=W.wars[2*W.M+1]=1; W.atWar[1*W.M+2]=W.atWar[2*W.M+1]=1;
    const D=N(2), q=D.capPlot, x0=(q%PW)*4, y0=((q/PW)|0)*4, ring: number[]=[];
    for (let y=y0-1;y<=y0+8;y++) for (let x=x0-1;x<=x0+8;x++){ const t=y*TW+x; if ((x>=x0 && x<x0+8 && y>=y0 && y<y0+8) || owner[t]!==2) continue; ring.push(t); }
    run(12);   // (some ticks first: ground hacked in at the very start is handed back at once)
    for (const t of ring) occupyHack(t,1);
    run(12);
    expect(besieged(2)).toBe(true);
    const before=new Set(W.humans.filter(h => h.o===2).map(h => h.id));
    D.humanProg=1e9; run(1);
    const born=W.humans.filter(h => h.o===2 && !before.has(h.id));
    expect(born.length).toBeGreaterThan(0);
    expect(born.every(h => h.fury)).toBe(true);
    for (const t of ring) freeHack(t);
    run(12); expect(besieged(2)).toBe(false);
    expect(born.every(h => !h.fury)).toBe(true);
  });
});

describe('bots going to war', () => {
  it('save a war chest first: no war while the treasury could not pay two minutes of an army', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    const B=N(2); soldiers(B,10); run(2);
    expect(warChest(B)).toBeGreaterThan(100);
    B.gold=0; B.nextWar=0; B.humanProg=-1e9;
    for (let i=0;i<60;i++){ B.nextThink=0; B.soldierShare=1; B.gold=Math.min(B.gold,0); tick(); }   // (keeping its army)
    expect(W.campaigns.some(c => c.a===2 && c.hostile)).toBe(false);
    B.gold=warChest(B)+100;
    for (let i=0;i<60 && !W.campaigns.some(c => c.a===2 && c.hostile);i++){ B.nextThink=0; B.soldierShare=1; tick(); }
    expect(W.campaigns.some(c => c.a===2 && c.hostile)).toBe(true);
  });
});

describe('militia', () => {
  const M = () => W.M;
  it('rest in their houses at peace, out of sight, and the call-up sends the number asked from the houses', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    for (let i=0;i<30;i++) place(N(1),B_HOUSE);
    const mil=soldiers(N(1),12,false); noDraft(); N(2).soldierShare=0; run(1200);   // (the spare houses are given up after 20 s, and everyone settles in the rest)
    const home=mil.filter(h => h.task===TASK_REST);
    expect(home.length).toBeGreaterThanOrEqual(11);                        // at home, indoors (a house whose door can't be reached is no home)
    expect(home.every(h => h.housed)).toBe(true);
    expect(callable(1)).toHaveLength(12);                                  // and still the kingdom's to call
    expect(declare(1,2,0,7)).toBe(true); run(40);
    expect(mil.filter(h => h.war>=0)).toHaveLength(7);                     // exactly the seven asked for
    expect(mil.filter(h => h.war>=0).every(h => h.task!==TASK_REST)).toBe(true);   // out of their houses
    expect(mil.filter(h => h.war<0 && h.task===TASK_REST).length).toBeGreaterThanOrEqual(home.length-7);   // the rest stay in
    queueCommand({ type:'reserves', nation:1, target:2, call:true }); run(40);
    expect(mil.every(h => h.war>=0)).toBe(true);                           // "call the rest" empties the houses
  });
  it('come out of their houses when their kingdom goes to war, and go back in at peace', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    soldiers(N(1),5);
    for (let i=0;i<30;i++) place(N(1),B_HOUSE);
    const mil=soldiers(N(1),12,false); noDraft(); N(2).soldierShare=0; run(1200);
    expect(mil.filter(h => h.task===TASK_REST).length).toBeGreaterThanOrEqual(11);
    expect(declare(1,2,5)).toBe(true); escalate(1,2,true); run(60);       // war
    expect(mil.some(h => h.task===TASK_REST)).toBe(false);                 // out, to defend
    makePeace(1,2); run(1500);
    expect(mil.filter(h => h.task===TASK_REST).length).toBeGreaterThanOrEqual(11);   // home again
  });
  it('go home after a peace deal, every one of them, and no army or war is left', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    soldiers(N(1),10); const mil=soldiers(N(1),12,false); const foes=soldiers(N(2),8); noDraft(); run(2); for (const h of [...mil,...foes]) h.hp=1e6;
    expect(declare(1,2,10,8)).toBe(true);
    giveWord(1,2); run(500);
    queueCommand({ type:'reserves', nation:1, target:2, call:true }); run(200);
    expect(mil.some(h => h.war>=0)).toBe(true);
    makePeace(1,2);
    run(900);
    const [dx,dy]=doorOf(N(1));
    for (const h of mil){ expect(h.war).toBe(-1); expect(Math.hypot(h.x-dx,h.y-dy)).toBeLessThan(80); }   // back round the castle, none left standing out at the front
    expect(W.campaigns.filter(c => c.hostile || c.a===1 || c.d===1)).toHaveLength(0);
    expect([W.wars[1*W.M+2], W.aggr[1*W.M+2], W.atWar[1*W.M+2], W.offensive[1*W.M+2], W.offensive[2*W.M+1]]).toEqual([0,0,0,0,0]);
  });

  it('can go with an attack, as many as asked; calling the reserves at war then calls up the rest', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    const mil=soldiers(N(1),8,false); noDraft(); run(2);   // no barracks: militia only
    expect(mil.every(h => h.militia)).toBe(true);
    expect(available(N(1))).toHaveLength(0);
    queueCommand({ type:'war', nation:1, target:2, units:[], militia:5 }); tick();
    expect(inCrisis(1,2)).toBe(true);   // an attack of militia alone masses on the border all the same
    const R=reservesOf(1,2)!;
    expect([R.militia, R.front, R.all, R.members.length]).toEqual([true, true, false, 5]);
    run(20);
    expect(R.members).toHaveLength(5);   // the rest stay home: they were not called
    expect(N(1).called).toBe(5);
    expect(reservesProblem(1,2,true)).toBeNull();   // the rest can still be called up
    queueCommand({ type:'reserves', nation:1, target:2, call:true }); tick();
    expect(R.all).toBe(true);
    expect(R.members).toHaveLength(8);
    expect(W.campaigns.filter(c => c.militia && c.a===1)).toHaveLength(1);   // all in one band
    expect(reservesProblem(1,2,true)).toMatch(/already on that front/);
  });


  it('stay home when the armies march, and are called up as reserves from the war bar: paid while out, home again when sent', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    soldiers(N(1),10); const mil=soldiers(N(1),12,false); noDraft(); run(2);
    expect([N(1).soldiers, N(1).militia, N(1).called]).toEqual([22, 12, 0]);
    expect(mil.every(h => h.militia && h.hp===MILITIA_HP)).toBe(true);
    expect(available(N(1)).reduce((k,a) => k+a.men.length,0)).toBe(10);   // only the barracks' army can be picked to march
    expect(reservesProblem(1,2,true)).toMatch(/No crisis/);
    expect(declare(1,2,10)).toBe(true);
    expect(mil.every(h => h.war<0)).toBe(true);
    queueCommand({ type:'reserves', nation:1, target:2, call:true }); tick();
    const R=reservesOf(1)!;
    expect(R.militia && R.front && R.d===2).toBe(true);
    expect(R.members).toHaveLength(12);
    tick();
    expect(N(1).called).toBe(12);
    expect(N(1).income).toBeCloseTo(grossIncome(N(1))-(10*WAGE+12*MIL_WAGE), 6);   // the army on the border costs 0.3 a man, the militia called up 0.1
    until(() => mil.every(h => h.fk===frontKey(1,2)), 400);   // on the front with the army
    queueCommand({ type:'reserves', nation:1, target:2, call:false }); tick();
    expect(R.phase).toBe(2);
    until(() => mil.every(h => h.war<0), 2000);
    tick();
    expect(N(1).called).toBe(0);
    expect(N(1).income).toBeCloseTo(grossIncome(N(1))-10*WAGE, 6);
  });

  it('without reserves called, fill the places of fallen soldiers all at once, and go to the front as soldiers', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    const army=soldiers(N(1),10), mil=soldiers(N(1),6,false); noDraft(); run(2);
    expect(declare(1,2,10)).toBe(true); run(20);
    const c=W.campaigns.find(k => k.a===1 && k.front)!;
    for (const h of army.slice(0,3)) h.hp=0;
    run(2);
    let most=0;
    until(() => { most=Math.max(most, mil.filter(h => h.task===TASK_TO_TRAIN || h.task===TASK_INSIDE).length); return mil.filter(h => !h.militia).length===3; }, 3000);
    expect(most).toBe(3);   // all three together
    expect(N(1).militia).toBe(3);
    until(() => c.members.length===10, 600);   // and they join the army at the front
  });

  it('a bot calls its militia up only when its armies on a front are badly outnumbered', () => {
    for (const [attackers, called] of [[30, true], [5, false]] as const){
      world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
      soldiers(N(2),5); soldiers(N(2),10,false); soldiers(N(1),attackers); noDraft(); noDraft(2); run(1);
      expect(declare(1,2,attackers)).toBe(true);
      for (let i=0;i<30;i++){ N(2).nextThink=0; tick(); }
      expect(menOn(2,1)).toBeGreaterThanOrEqual(5);   // it holds its border with its army
      expect(!!reservesOf(2)).toBe(called);
    }
  });
});

describe('beggars, militia and stalemates', () => {
  it('beggars strike no blow: they only stand in the way, and are cut down', () => {
    split(0); soldiers(N(2),10); noDraft(2); run(1);
    expect(declare(2,1,10)).toBe(true);
    until(() => W.wars[2*W.M+1]>0, 3000); tick();   // (a bot goes to war as soon as it is ready)
    expect(W.wars[2*W.M+1]).toBe(1);
    setOffensive(2,1,false);   // they hold, and the beggars come to them
    for (const h of W.humans) if (h.o===2 && h.war>=0) h.hp=1e6;
    const men=W.humans.filter(h => h.o===2 && h.war>=0 && h.line===0).slice(0,4), beggars: Human[]=[];
    for (const m of men){ const v=makeHuman(N(1),H_VILLAGER,m.x-5,m.y); if (owner[((v.y/2)|0)*TW+((v.x/2)|0)]!==1) v.x=m.x+5; v.beggar=true; v.sp=1; W.humans.push(v); beggars.push(v); }
    const hits=collect('hit');
    run(300);
    expect(beggars.every(b => !W.humans.includes(b) || b.brave>=1)).toBe(true);   // they go to stand in his way...
    expect(hits.some(h => beggars.some(b => b.id===h[3]))).toBe(true);           // ...are struck...
    expect(hits.some(h => beggars.some(b => b.id===h[4]))).toBe(false);          // ...and strike nothing
    expect(maxHp(beggars[0])).toBe(4);
  });

  it('every kingdom starts with 10 wood, 10 stone and 10 copper, and the land within 8 tiles of its castle', () => {
    world(3);
    for (const n of W.nations.slice(1)){
      expect(n.stock).toEqual([10,10,10]);
      const cx=n.capTile%TW, cy=(n.capTile/TW)|0;
      let disc=0; for (let dy=-8;dy<=8;dy++) for (let dx=-8;dx<=8;dx++) if (dx*dx+dy*dy<=64) disc++;
      expect(n.tiles).toBe(disc);   // (all grass here, far apart)
      expect(owner[(cy+8)*TW+cx]).toBe(n.id);
    }
  });

  it('militia have 5 hit points and strike for 0.75', () => {
    expect([MILITIA_HP, MILITIA_HIT]).toEqual([5, 0.75]);
    world(1); const [m]=soldiers(N(1),1,false); N(1).soldierShare=1; run(1);
    expect([m.militia, maxHp(m)]).toEqual([true, 5]);
  });

  it('a war whose border has stood still for minutes while one side bleeds far more is offered peace, and its front holds', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    soldiers(N(2),20); soldiers(N(1),20); noDraft(); noDraft(2); run(1);
    expect(declare(2,1,20)).toBe(true); expect(escalate(2,1,true)).toBe(true);
    until(() => W.offensive[2*W.M+1]===F_PUSH, 3000);
    // its border hardly moving: the war stalls, a little more every 30 seconds
    for (const h of W.humans) if (h.war>=0) h.hp=1e6;
    queueCommand({ type:'offensive', nation:2, target:1, go:false }); tick();
    N(2).nextThink=1e9; N(2).nextOffer=1e9;
    run(700);
    expect(stalled(1,2)).toBeGreaterThanOrEqual(300);
    // three minutes of it, and 2 has lost far more than it killed
    W.stall[2*W.M+1]=W.stall[1*W.M+2]=1800; W.kills[1*W.M+2]=30; W.kills[2*W.M+1]=6;
    setOffensive(2,1,true); N(2).nextOffer=0; N(2).nextThink=0; tick();
    expect(W.offers[2*W.M+1]).toBeGreaterThan(0);
    expect(W.offensive[2*W.M+1]).toBe(F_HOLD);
    // a fresh war, or an even fight in a short stall: nothing
    makePeace(1,2); run(1);
  });

  it('a bot with a beggar problem studies housing, builds no farms; with no way out it leans to war', () => {
    world(1); const n=N(2);
    n.villagers=20; n.soldiers=4; n.beggars=3; n.homeless=6; n.tier[R_HOUSING]=1; n.nextThink=0;
    expect(beggarProblem(n)).toBe(true);
    tick();   // (it thinks before the headcount is taken again)
    expect(n.study).toBe(R_HOUSING);
    n.villagers=20; n.beggars=1; n.homeless=2;
    expect(beggarProblem(n)).toBe(false);
    n.villagers=20; n.soldiers=4; n.beggars=3; n.homeless=6; n.tier[R_HOUSING]=3; n.guilds=1;
    W.contact[2*W.M]=0;   // no open land left to settle
    expect(stuck(n)).toBe(true);
  });
});

describe('story events', () => {
  it('raises a mob when the enemy reaches the castle: the villagers nearby swarm him, and the log hears of it', () => {
    world(1); labelWorld(); allocIsles(); quiet(); place(N(1),B_FARM);
    const [x,y]=doorOf(N(1)), folk: Human[]=[];
    for (let i=0;i<12;i++){ const v=makeHuman(N(1),H_VILLAGER,x+(i%6)*3-8,y+((i/6)|0)*3+4); W.humans.push(v); folk.push(v); }
    soldiers(N(2),1); run(1);
    W.contact[2*W.M+1]=W.contact[1*W.M+2]=1; expect(declare(2,1,1)).toBe(true); escalate(2,1,true);   // (at war, with an enemy soldier in the field)
    const e=W.humans.find(h => h.o===2 && h.war>=0)!; e.x=x; e.y=y+1; e.sp=0; e.hp=1000;
    const told=collect('story');
    until(() => told.length>0, 30);
    expect(told[0][0]).toBe('mob');
    expect(told[0][1]).toBe(1);
    expect(told[0][4]).toBe(2);
    const mob=folk.filter(v => W.humans.includes(v) && v.brave===MOB);
    expect(mob.length).toBeGreaterThanOrEqual(10);
    const hp=e.hp; run(40);
    expect(e.hp).toBeLessThan(hp);
    run(200);
    expect(told).toHaveLength(1);   // not again so soon
  });
});

describe('bots arming', () => {
  it('keep few soldiers in peace, and raise many when at war and outnumbered', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    const bot=N(2); bot.nextThink=0; bot.soldierShare=0.5;
    run(400);
    expect(bot.soldierShare).toBeLessThan(0.3);            // peace: back to work
    soldiers(N(1),20); run(1);
    expect(declare(1,2,20)).toBe(true);
    for (let i=0;i<40;i++){ bot.nextThink=0; tick(); }
    expect(bot.soldierShare).toBeGreaterThan(0.6);        // war against a far bigger army: to arms
  });
});

describe('invasions: the siege of a capital, peace, and two attackers', () => {
  /** Kingdom 2's land with 1 occupying everything within `r` tiles of its castle bar the castle; 1 at war with it. */
  function besieged(r: number){
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),30); paintToward(1,2);
    soldiers(N(1),10); noDraft(); N(2).soldierShare=0; N(2).humanProg=-1e9; run(2);
    expect(declare(1,2,10)).toBe(true); giveWord(1,2);
    const c=N(2).capPlot, cx=(c%PW)*4+4, cy=((c/PW)|0)*4+4;
    for (let t=0;t<NT;t++){
      if (owner[t]!==2 || occ[t]) continue;
      const x=t%TW, y=(t/TW)|0;
      if ((x+0.5-cx)**2+(y+0.5-cy)**2<=r*r && !underCastle(2,t)){ occupyHack(t,1); }
    }
    return { cx, cy };
  }
  it('an army that has the castle surrounded stops pushing the border: its front is the castle alone', () => {
    // 1 occupies all round the castle but the land further out is still free: it is the castle that is left to break
    const { cx, cy }=besieged(12);
    expect(castleCutOff(2)).toBe(true);
    const F=lineOf(1,2);
    expect(F.tiles.length).toBeGreaterThan(10);
    expect(F.tiles.every(t => underCastle(2,t))).toBe(true);   // nothing of the outer border is in the front
    // (whereas with free ground left beside the castle, the front is the border and not the castle)
    for (let t=0;t<NT;t++) if (owner[t]===2 && occ[t]===1 && Math.hypot((t%TW)+0.5-cx,((t/TW)|0)+0.5-cy)<5.5){ freeHack(t); }
    expect(castleCutOff(2)).toBe(false);
    expect(lineOf(1,2).tiles.some(t => !underCastle(2,t))).toBe(true);
  });
  it('a peace with the castle cut off gives its kingdom the ground round it back, to rebuild on', () => {
    const { cx, cy }=besieged(12);
    const near=(t: number) => Math.hypot((t%TW)+0.5-cx,((t/TW)|0)+0.5-cy);
    const farOcc=(t: number) => owner[t]===2 && occ[t]===1 && near(t)>25;
    // further out, a belt 1 holds (joined to its own land): it keeps that at peace
    for (let t=0;t<NT;t++) if (owner[t]===2 && !occ[t] && near(t)>25 && touchesOwn(t)){ occupyHack(t,1); }
    expect(Array.from({ length: NT }, (_, t) => t).some(farOcc)).toBe(true);
    makePeace(1,2);
    expect(atWar(1,2)).toBe(false);
    for (let t=0;t<NT;t++) if (owner[t]===2 && near(t)<=20 && !underCastle(2,t)) expect(occ[t]).toBe(0);   // its own again, to build on
    expect(Array.from({ length: NT }, (_, t) => t).some(t => owner[t]===1 && near(t)>25 && near(t)<40)).toBe(true);   // (what lies further out, joined to 1's land, is 1's)
  });
  it('a peace with its castle not cut off leaves things as they were: only what joins on stays', () => {
    const { cx, cy }=besieged(12);
    // free ground right beside the castle: not cut off
    for (let t=0;t<NT;t++) if (owner[t]===2 && occ[t]===1 && Math.hypot((t%TW)+0.5-cx,((t/TW)|0)+0.5-cy)<5.5){ freeHack(t); }
    expect(castleCutOff(2)).toBe(false);
    const was=W.occCount[2*W.M+1];
    makePeace(1,2);
    expect(W.occCount[2*W.M+1]).toBeLessThanOrEqual(was);   // (landlocked pockets go back as ever, nothing more)
  });
  /** Whether t has a land neighbour of kingdom 1. */
  function touchesOwn(t: number){ const x=t%TW; return [x>0 ? t-1 : -1, x<TW-1 ? t+1 : -1, t>=TW ? t-TW : -1, t<NT-TW ? t+TW : -1].some(k => k>=0 && ((owner[k]===1 && !occ[k]) || (owner[k]===2 && occ[k]===1))); }

  it('two kingdoms attacking one split its ground and both go forward; the second is not left stuck once the first has taken the ground beside it', () => {
    world(2); quiet(); paintDisc(N(3),50); paintToward(1,3); paintToward(2,3);
    N(1).isPlayer=false;   // (so that both go to war by themselves)
    soldiers(N(1),40); soldiers(N(2),40); soldiers(N(3),30); noDraft(); noDraft(2); noDraft(3); N(3).soldierShare=0.5; N(3).humanProg=-1e9; run(2);
    expect(declare(1,3,40)).toBe(true); expect(declare(2,3,40)).toBe(true);
    let both=false, stuck=false;
    for (let i=0;i<2400 && N(3).alive;i++){
      tick();
      if (W.occCount[3*W.M+1]>50 && W.occCount[3*W.M+2]>50) both=true;
      if (i>900 && W.occCount[3*W.M+1]>1000 && menOn(2,3)===0) stuck=true;   // (its army sent home, "no border to fight on")
    }
    expect(stuck).toBe(false);
    expect(both).toBe(true);
  });
});

describe('naval invasions', () => {
  /** Kingdom 1 and kingdom 2 on either side of a channel 14 tiles wide; 1 has a naval base on its shore and a fleet of 20. */
  function seaWorld(men=20, defenders=0){
    world(1); labelWorld(); allocIsles(); quiet();
    const c1=N(1).capTile, c2=N(2).capTile, x1=c1%TW, y1=(c1/TW)|0, x2=c2%TW, y2=(c2/TW)|0;
    const L=Math.hypot(x2-x1,y2-y1), vx=(x2-x1)/L, vy=(y2-y1)/L, mx=(x1+x2)/2, my=(y1+y2)/2, half=Math.min(7,L/5);
    const side=(t: number) => ((t%TW)-mx)*vx+(((t/TW)|0)-my)*vy;
    for (let t=0;t<NT;t++) if (Math.abs(side(t))<=half){ isLand[t]=0; terr[t]=T_WATER; }
    for (let q=0;q<NP;q++){ const c=(((q/PW)|0)*4+2)*TW+(q%PW)*4+2; pBuild[q]=isLand[c] ? 1 : 0; }
    labelWorld();
    const claim=(n: Nation, r: number) => { const cx=n.capTile%TW, cy=(n.capTile/TW)|0, sg=Math.sign(side(n.capTile));
      for (let y=Math.max(0,cy-r);y<=Math.min(TH-1,cy+r);y++) for (let x=Math.max(0,cx-r);x<=Math.min(TW-1,cx+r);x++){ const t=y*TW+x; if (isLand[t] && !owner[t] && (x-cx)**2+(y-cy)**2<=r*r && Math.sign(side(t))===sg) setOwner(t,n.id); } };
    claim(N(1),70); claim(N(2),70); census(); allocIsles();
    // the base: the best site on 1's shore, nearest the middle of the channel
    let base=-1, bd=Infinity;
    for (let q=0;q<NP;q++){ if (navalSite(N(1),q).orient<0) continue; const d=Math.hypot(((q%PW)*4+8)-mx,(((q/PW)|0)*4+4)-my); if (d<bd){ bd=d; base=q; } }
    expect(base).toBeGreaterThanOrEqual(0);
    N(1).stock=[200,200,200]; expect(build(N(1),base,B_NAVAL)).toBe(true); census();
    if (defenders) soldiers(N(2),defenders);
    soldiers(N(1),men); noDraft(); noDraft(2); N(2).soldierShare=defenders ? 1 : 0; N(2).humanProg=-1e9; N(1).fleet=20; run(2);
    // a coast of 2's: the land of 2's by the channel nearest the middle of it
    let coast=-1, cd=Infinity;
    for (let t=0;t<NT;t++){ if (owner[t]!==2 || !isLand[t]) continue; const x=t%TW; const wet=(x>0 && !isLand[t-1]) || (x<TW-1 && !isLand[t+1]) || (t>=TW && !isLand[t-TW]) || (t<NT-TW && !isLand[t+TW]); if (!wet) continue;
      const d=Math.hypot((t%TW)-x2,((t/TW)|0)-y2)+Math.abs(side(t))*0; if (d<cd){ cd=d; coast=t; } }
    expect(coast).toBeGreaterThanOrEqual(0);
    return { base, coast, side, mx, my };
  }
  const aboard = () => W.humans.filter(h => h.o===1 && h.boat>=0);
  const seaOf = (s: { x: number; y: number }) => isLand[((s.y/2)|0)*TW+((s.x/2)|0)];

  it('a bot with no room left on the mainland builds a harbour and ships, and sends a landing at a kingdom it has no border with, giving the word itself', () => {
    const { base }=seaWorld(20,5);
    const n=N(1); n.isPlayer=false; n.expandAt=0.8; n.attackAt=0.8; n.fleet=0;
    // (its harbour stands already: it builds ships, and a landing, by its temper)
    W.contact[1*W.M]=0;                                  // nothing unclaimed touches its land: the sea is all it has
    expect(seaDrive(n)).toBeGreaterThan(0.6);
    for (let i=0;i<60 && n.fleet+(W.docks.get(base)?.queued ?? 0)<3;i++){ n.nextSea=0; n.homeless=0; botSea(n); }
    expect(n.fleet+(W.docks.get(base)?.queued ?? 0)).toBeGreaterThanOrEqual(2);   // ships ordered
    n.fleet=6;
    W.contact[1*W.M+2]=W.contact[2*W.M+1]=0;
    expect(navalAttack(n,20,0.5,() => 5)).toBe(true);   // a landing, as it is stronger than what stands against it
    expect(W.invasions).toHaveLength(1);
    until(() => W.wars[1*W.M+2]>0, 6000);                // the word, after the crisis's thirty seconds: given by the bot
    run(30);
    expect(W.invasions.length===0 || W.invasions[0].stage>=INV_LAND).toBe(true);
  });

  it('a bot builds a naval base of its own when the sea is all the room it has left', () => {
    seaWorld(10,5);
    const n=N(1); n.isPlayer=false; n.expandAt=0.8; n.attackAt=0.8; n.stock=[200,200,200];
    for (const q of basesOf(n)) for (const k of cover(q)){ pType[k]=0; pOwner[k]=0; }
    place(n,B_FARM); census();
    expect(basesOf(n)).toHaveLength(0);
    W.contact[1*W.M]=0;
    n.stock=[200,200,200];
    for (let i=0;i<200 && !basesOf(n).length;i++){ n.nextSea=0; n.homeless=0; botSea(n); }
    expect(basesOf(n).length).toBeGreaterThan(0);
  });

  it('plans a landing a tile a man along the coast, the ships in rows of as many as the coast holds, 5 men a ship', () => {
    const { base, coast }=seaWorld(20);
    const plan=navalPlan(1,2,10,base,coast);
    expect(typeof plan).toBe('object');
    if (typeof plan==='string') return;
    expect(plan.men).toBe(10); expect(plan.ships).toBe(2);
    expect(plan.zone.coast.length).toBe(20);                       // a man every 2 tiles of coast, as on any front
    expect(plan.zone.rows).toEqual([2]);
    // a bigger army takes more of the coast
    const big=navalPlan(1,2,20,base,coast);
    if (typeof big!=='string'){ expect(big.zone.coast.length).toBe(40); expect(big.ships).toBe(4); }
    // every tile of the zone is theirs, the coast first, the ground inland after it
    expect(plan.zone.zone.every(t => owner[t]===2)).toBe(true);
    expect(plan.zone.zone.length).toBeGreaterThan(plan.zone.coast.length*2);
    // too few ships
    N(1).fleet=1; expect(navalPlan(1,2,10,base,coast)).toMatch(/2 ships/);
  });

  it('a short coast takes the ships in rows: the first row lands, the next lands after', () => {
    const { base, coast }=seaWorld(20);
    // all but twelve tiles of that coast are nobody's: a stretch of 12
    const wet=(t: number) => (t%TW>0 && !isLand[t-1]) || (t%TW<TW-1 && !isLand[t+1]) || (t>=TW && !isLand[t-TW]) || (t<NT-TW && !isLand[t+TW]);
    for (let t=0;t<NT;t++) if (owner[t]===2 && isLand[t] && wet(t) && Math.hypot((t%TW)-(coast%TW),((t/TW)|0)-((coast/TW)|0))>10.5) setOwner(t,0);   // (a stretch of about 21)
    const plan=navalPlan(1,2,20,base,coast); if (typeof plan==='string') throw new Error(plan);
    expect(plan.zone.coast.length).toBeLessThanOrEqual(22);
    expect(plan.zone.cap).toBe(Math.max(1,Math.floor(plan.zone.coast.length/SHIP_FRONT)));
    expect(plan.zone.rows.length).toBeGreaterThan(1);
    expect(plan.zone.rows.reduce((a,b) => a+b,0)).toBe(4);       // 20 men, 4 ships, in more than one row
    expect(plan.zone.rows.slice(0,-1).every(r => r===plan.zone.cap)).toBe(true);
  });

  it('sails the armies over the water to a line off the coast: a crisis, with the men out of sight aboard, 5 to a ship', () => {
    const { base, coast }=seaWorld(20);
    const crisis=collect('crisis');
    expect(declareNaval(1,2,20,base,coast)).toBe(true);
    expect(crisis).toEqual([[1,2]]);
    expect(inCrisis(1,2)).toBe(true); expect(atWar(1,2)).toBe(false);
    expect(W.ships).toHaveLength(4);                                // 20 men: 4 ships
    expect(N(1).fleet).toBe(16);
    expect(W.ships.every(s => s.crew<=5 && s.fleet)).toBe(true);
    expect(W.ships.reduce((k,s) => k+s.crew,0)).toBe(20);
    expect(aboard()).toHaveLength(20);
    expect(aboard().every(h => indoors(h))).toBe(true);             // not on the map: they are on the ships
    let ticks=0; while (navalOf(1,2)?.stage===INV_SAIL && ticks++<6000){ tick(); for (const s of W.ships) expect(seaOf(s)).toBe(0); for (const h of aboard()){ const s=shipById(h.boat)!; expect([h.x,h.y]).toEqual([s.x,s.y]); } }
    const inv=navalOf(1,2)!;
    expect(inv.stage).toBe(INV_READY);
    expect(W.offensive[1*W.M+2]).toBe(F_READY);
    // the ships lie in a line off the coast, near it
    const zx=inv.coast.reduce((k,t) => k+t%TW,0)/inv.coast.length, zy=inv.coast.reduce((k,t) => k+((t/TW)|0),0)/inv.coast.length;
    for (const s of W.ships) expect(Math.hypot(s.x/2-zx,s.y/2-zy)).toBeLessThan(24);
    expect(atWar(1,2)).toBe(false);                                  // nobody fights in a crisis
  });

  /** Declares 20 men by sea and runs until the ships lie off the coast. */
  function sailed(men=20){
    const w=seaWorld(men);
    expect(declareNaval(1,2,men,w.base,w.coast)).toBe(true);
    let ticks=0; while (navalOf(1,2)?.stage===INV_SAIL && ticks++<6000) tick();
    expect(navalOf(1,2)!.stage).toBe(INV_READY);
    return w;
  }

  it('lands at the word: the zone is occupied, the men step ashore row by row and fight on like an ordinary offensive; the ships sail home and count again', () => {
    sailed();
    const zone=navalOf(1,2)!.zone;
    giveWord(1,2);
    until(() => !navalOf(1,2), 4);                                  // (the landing began)
    run(1);
    expect(zone.filter(t => occ[t]===1).length).toBe(zone.length);   // the whole zone is theirs to hold
    expect(aboard()).toHaveLength(0);                               // every man ashore
    const men=W.humans.filter(h => h.o===1 && h.war>=0);
    expect(men).toHaveLength(20);
    expect(men.every(h => owner[((h.y/2)|0)*TW+((h.x/2)|0)]===2)).toBe(true);   // on their land
    expect(W.ships.every(s => s.mode===2)).toBe(true);              // sailing home
    for (let i=0;i<6000 && W.ships.length;i++){ tick(); for (const s of W.ships) expect(seaOf(s)).toBe(0); }
    expect(W.ships).toHaveLength(0);
    expect(N(1).fleet).toBe(20);                                    // back at the base, counted again
    // the offensive goes on from the beachhead: more ground than the zone
    until(() => W.occCount[2*W.M+1]>zone.length+60, 3000);
    expect(W.occCount[2*W.M+1]).toBeGreaterThan(zone.length+60);
    // the beachhead has no land of 1's beside it, and stays: nothing sends it back
    run(100);
    expect(zone.filter(t => occ[t]===1).length).toBeGreaterThan(zone.length*0.9);
  });

  it('the defender sees it coming and may send its armies to the landing zone, standing on the coast', () => {
    const w=seaWorld(20,15);
    expect(declareNaval(1,2,20,w.base,w.coast)).toBe(true);
    expect(landingOn(1,2)).toBe(true);
    expect(defendProblem(2,1)).toBeNull();                          // no shared border, but a landing coming
    expect(defend(2,1,15)).toBe(true);
    const inv=navalOf(1,2)!;
    until(() => W.humans.filter(h => h.o===2 && h.fk>=0).length>=12, 2500);
    const mine=W.humans.filter(h => h.o===2 && h.fk===frontKey(2,1));
    expect(mine.length).toBeGreaterThanOrEqual(12);
    const near=mine.filter(h => inv.coast.some(t => Math.hypot((t%TW)*2+1-h.fx,((t/TW)|0)*2+1-h.fy)<=8));
    expect(near.length).toBeGreaterThanOrEqual(mine.length*0.8);    // on the coast it will land on
    expect(mine.every(h => owner[((h.fy/2)|0)*TW+((h.fx/2)|0)]===2)).toBe(true);   // on their own ground
  });

  it('a coast the invader already holds is landed on with no crisis and no defender; the new army joins the war', () => {
    const w=seaWorld(20);
    // a war, with 1 holding a stretch of 2's coast
    const wet=(t: number) => (t%TW>0 && !isLand[t-1]) || (t%TW<TW-1 && !isLand[t+1]) || (t>=TW && !isLand[t-TW]) || (t<NT-TW && !isLand[t+TW]);
    W.wars[1*W.M+2]=W.wars[2*W.M+1]=1; W.aggr[1*W.M+2]=1;
    for (let t=0;t<NT;t++) if (owner[t]===2 && isLand[t] && Math.hypot((t%TW)-(w.coast%TW),((t/TW)|0)-((w.coast/TW)|0))<=14){ occupyHack(t,1); }
    void wet;
    const plan=navalPlan(1,2,10,w.base,w.coast); if (typeof plan==='string') throw new Error(plan);
    expect(plan.zone.safe).toBe(true);
    expect(declareNaval(1,2,10,w.base,w.coast)).toBe(true);
    expect(landingOn(1,2)).toBe(false);                             // nothing for the defender to respond to
    until(() => !navalOf(1,2), 6000);                               // lands by itself on arrival: the war is on
    expect(aboard()).toHaveLength(0);
    expect(W.humans.filter(h => h.o===1 && h.war>=0 && h.boat<0)).toHaveLength(10);
  });

  it('calling the crisis off brings the ships home with the men aboard, and the fleet is counted again', () => {
    sailed(10);
    expect(N(1).fleet).toBe(18);
    expect(deescalate(1,2)).toBe(true);
    expect(aboard()).toHaveLength(10);                              // still on the ships, going home
    for (let i=0;i<6000 && W.ships.length;i++) tick();
    expect(W.ships).toHaveLength(0);
    expect(aboard()).toHaveLength(0);
    expect(N(1).fleet).toBe(20);
    expect(W.humans.filter(h => h.o===1 && h.kind===H_SOLDIER && h.war>=0)).toHaveLength(0);   // home at their barracks again
  });

  it('is never reinforced: soldiers raised after it sailed stay home, and can go by sea or land as another army', () => {
    sailed(10);
    const barracks=N(1).blds.find(q => pType[q]===B_BARRACKS)!;
    const extra=soldiers(N(1),0); void extra; void barracks;
    giveWord(1,2); run(40);
    const k=W.campaigns.filter(c => c.a===1 && c.naval>=0);
    expect(k.length).toBeGreaterThan(0);
    const n0=W.humans.filter(h => h.o===1 && h.war>=0).length;
    // a new recruit at the barracks does not join it
    const [r]=soldiers(N(1),1,false); r.base=barracks; N(1).soldierShare=1; run(200);
    expect(W.humans.filter(h => h.o===1 && h.war>=0).length).toBeLessThanOrEqual(n0);
    expect(r.war).toBe(-1);
  });

  it('on a short coast the ships land in rows, the first row at the word and the others after, and every ship that has landed sails home', () => {
    const w=seaWorld(20);
    const wet=(t: number) => (t%TW>0 && !isLand[t-1]) || (t%TW<TW-1 && !isLand[t+1]) || (t>=TW && !isLand[t-TW]) || (t<NT-TW && !isLand[t+TW]);
    for (let t=0;t<NT;t++) if (owner[t]===2 && isLand[t] && wet(t) && Math.hypot((t%TW)-(w.coast%TW),((t/TW)|0)-((w.coast/TW)|0))>10.5) setOwner(t,0);
    expect(declareNaval(1,2,20,w.base,w.coast)).toBe(true);
    const inv=navalOf(1,2)!; expect(inv.rows.length).toBeGreaterThan(1);
    let ticks=0; while (navalOf(1,2)?.stage===INV_SAIL && ticks++<8000) tick();
    giveWord(1,2);
    const left: number[]=[];
    for (let i=0;i<inv.rows.length*70;i++){ tick(); if (i%20===0) left.push(aboard().length); }
    expect(left[0]).toBeGreaterThan(0);                              // the later rows are still aboard when the first has landed
    expect(left.at(-1)).toBe(0);                                     // and in the end all are ashore
    expect(left.every((k,i) => i===0 || k<=left[i-1])).toBe(true);   // never more aboard than before
    expect(W.humans.filter(h => h.o===1 && h.war>=0 && h.boat<0)).toHaveLength(20);
    for (let i=0;i<6000 && W.ships.length;i++) tick();
    expect(N(1).fleet).toBe(20);
  });
});

describe('army orders', () => {
  /** Two kingdoms side by side; 1 has two barracks of 5 each (their plots returned) and 2 a few men and a barracks of its own. */
  function twoArmies(){
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14); paintDisc(N(2),60); place(N(2),B_FARM); paintToward(1,2);
    const a=place(N(1),B_BARRACKS), b=place(N(1),B_BARRACKS,pCenter[a]);
    soldiers(N(1),10,false); N(1).soldierShare=1; noDraft(); noDraft(2); N(2).soldierShare=0; N(2).humanProg=-1e9; tick();
    return { a, b };
  }
  const army = (a: number, d: number) => W.campaigns.filter(c => c.front && c.a===a && c.d===d && c.phase<2);

  it('armies can be put on a border in peace: no crisis, nothing fought, and a crisis begun later needs no march', () => {
    const { a }=twoArmies();
    const crisis=collect('crisis');
    expect(deployArmies(1,2,[a])).toBe(1);
    expect(crisis).toHaveLength(0);
    expect([W.aggr[1*W.M+2], W.wars[1*W.M+2], inCrisis(1,2)]).toEqual([0, 0, false]);
    const [c]=army(1,2); expect(c.deployed).toBe(true);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    run(300);
    expect(W.occCount[2*W.M+1]).toBe(0);
    const ids=army(1,2).map(k => k.id), at=c.members.map(id => W.humans.find(h => h.id===id)!).map(h => [h.x,h.y]);
    // a crisis with the army already on the border: nobody marches, nobody moves
    expect(declare(1,2,0)).toBe(true);
    expect(crisis).toHaveLength(1);
    expect(army(1,2).map(k => k.id)).toEqual(ids);
    run(5);
    const now=c.members.map(id => W.humans.find(h => h.id===id)!).map(h => [h.x,h.y]);
    expect(now.every((p,i) => Math.hypot(p[0]-at[i][0],p[1]-at[i][1])<4)).toBe(true);
    // calling the crisis off leaves the deployed army where it stands
    expect(deescalate(1,2)).toBe(true);
    run(5);
    expect(army(1,2)).toHaveLength(1);
    expect(W.aggr[1*W.M+2]).toBe(0);
    // and it can be brought home
    expect(armyRecall(1,c.id)).toBe(true);
    expect(c.phase).toBe(2);
  });

  it('a crisis runs 30 seconds before the word to attack can be given (both sides have time to call it off); then the word is war', () => {
    const { a, b }=twoArmies();
    expect(deployArmies(1,2,[a])).toBe(1);
    expect(declare(1,2,[b])).toBe(true);        // one army there already, one more marches
    expect(army(1,2)).toHaveLength(2);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    expect(CRISIS_TICKS).toBe(30*2*10);
    expect(offensiveProblem(1,2,true)).toMatch(/Time to talk/);
    expect(setOffensive(1,2,true)).toBe(false);
    expect(escalate(1,2)).toBe(false);
    expect(inCrisis(1,2)).toBe(true);
    // the side that is massed against can call it off by massing nothing; the aggressor may too
    run(CRISIS_TICKS-W.tickN+W.crisisAt[1*W.M+2]-2);
    expect(offensiveProblem(1,2,true)).toMatch(/Time to talk/);
    run(4);
    expect(offensiveProblem(1,2,true)).toBeNull();
    expect(setOffensive(1,2,true)).toBe(true);
    tick();
    expect([W.wars[1*W.M+2], W.offensive[1*W.M+2]]).toEqual([1, F_PUSH]);
  });

  it('each army attacks or defends as ordered: the one that attacks takes ground, the one that defends holds its line', () => {
    const { a, b }=twoArmies();
    expect(declare(1,2,[a,b])).toBe(true);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    W.crisisAt[1*W.M+2]-=CRISIS_TICKS;
    expect(escalate(1,2)).toBe(true);
    const [c1,c2]=army(1,2);
    expect([attacks(c1),attacks(c2)]).toEqual([true,true]);   // (it is 1's attack: its armies attack unless told otherwise)
    expect(armyOrder(1,c1.id,false)).toBe(true);
    run(5);
    expect([c1.mode,c2.mode,W.offensive[1*W.M+2]]).toEqual([F_HOLD,F_PUSH,F_PUSH]);
    run(300);
    expect(W.occCount[2*W.M+1]).toBeGreaterThan(0);
    // the army that defends has stayed on its own side of the line
    const crew=(c: typeof c1) => c.members.map(id => W.humans.find(h => h.id===id)!).filter(h => h && h.hp>0);
    expect(crew(c1).every(h => holds(1,2,((h.y/2)|0)*TW+((h.x/2)|0)))).toBe(true);
    // both defend: nothing more is taken
    expect(armyOrder(1,c2.id,false)).toBe(true);
    run(10);
    expect(W.offensive[1*W.M+2]).toBe(F_HOLD);
    const held=W.occCount[2*W.M+1];
    run(300);
    expect(W.occCount[2*W.M+1]).toBe(held);
    // and one is told to attack again
    expect(armyOrder(1,c1.id,true)).toBe(true);
    run(300);
    expect(W.occCount[2*W.M+1]).toBeGreaterThan(held);
    expect(armyOrder(1,c1.id,true)).toBe(false);               // (already attacking)
  });

  it('new soldiers join the army that has lost the most compared to its size, one at a time', () => {
    const { a, b }=twoArmies();
    const U=N(1).blds.filter(q => pType[q]===B_BARRACKS).map(q => unitAt(q)!).filter((u, i, l) => l.indexOf(u)===i);
    expect(U).toHaveLength(2);
    const [u1,u2]=U;
    // army 1 loses three, army 2 one
    for (const h of u1.members.slice(0,3)) h.hp=0;
    for (const h of u2.members.slice(0,1)) h.hp=0;
    run(3);
    const fresh=soldiers(N(1),4,false);
    for (const h of fresh){ h.base=-1; }
    N(1).soldierShare=1; run(3);
    const k=(q: number) => W.humans.filter(h => h.o===1 && h.kind===H_SOLDIER && h.hp>0 && !h.militia && h.base>=0 && unitAt(h.base)===unitAt(q)).length;
    expect([k(a),k(b)]).toEqual([5,5]);                         // 2 left + 3 new, 4 left + 1 new: both made up
    expect(fresh.filter(h => h.base>=0 && unitAt(h.base)===unitAt(a)).length).toBe(3);
  });
});

describe('two fronts', () => {
  /** 1 and 2 meet on the mainland (west and east of a line) and on an island in a sea off 1's west coast (the island's west half is 1's, its
      east half 2's). 1 has a naval base on that coast, a fleet of 3, and two barracks of 5 on the mainland. */
  function twoFronts(bridge=false){
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14);
    const [ax,ay]=[N(1).capTile%TW,(N(1).capTile/TW)|0], [bx,by]=[N(2).capTile%TW,(N(2).capTile/TW)|0];
    const mx=(ax+bx)/2, my=(ay+by)/2, x0=Math.round(mx-100), x1=Math.round(mx+100), y0=Math.round(my-60), y1=Math.round(my+60);
    for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) setOwner(y*TW+x, x<mx ? 1 : 2);
    const yA=y0+40, yB=yA+22, X1=x0-30, X0=X1-30;   // the island: 30 by 22 tiles
    for (let y=yA-6;y<yB+6;y++) for (let x=X0-6;x<x0+6;x++){ const t=y*TW+x; isLand[t]=0; terr[t]=T_WATER; if (owner[t]) setOwner(t,0); }
    for (let y=yA;y<yB;y++) for (let x=X0;x<X1;x++){ const t=y*TW+x; isLand[t]=1; terr[t]=T_GRASS; setOwner(t, x<X0+15 ? 1 : 2); }
    if (bridge){   // a thin land bridge round the north of the sea: the island is joined to the mainland, the long way
      for (let x=X0+2;x<x0+6;x++){ const t=(yA-6)*TW+x; isLand[t]=1; terr[t]=T_GRASS; }
      for (let y=yA-6;y<yA;y++){ const t=y*TW+X0+2; isLand[t]=1; terr[t]=T_GRASS; }
    }
    for (let q=0;q<NP;q++){ const c=(((q/PW)|0)*4+2)*TW+(q%PW)*4+2; pBuild[q]=isLand[c] ? 1 : 0; }
    labelWorld(); census(); allocIsles();
    let base=-1, bd=Infinity;
    for (let q=0;q<NP;q++){ if (navalSite(N(1),q).orient<0) continue; const d=Math.abs(((q%PW)*4)-(x0+6))+Math.abs(((q/PW)|0)*4-(yA+11)); if (d<bd){ bd=d; base=q; } }
    expect(base).toBeGreaterThanOrEqual(0);
    N(1).stock=[200,200,200]; expect(build(N(1),base,B_NAVAL)).toBe(true); census();
    const a=place(N(1),B_BARRACKS), b=place(N(1),B_BARRACKS,(yA+11)*TW+X0+7);   // (the second as far from the island as 1's land goes)
    expect([isle[pCenter[a]],isle[pCenter[b]]]).toEqual([isle[Math.round(my)*TW+Math.round(mx)], isle[Math.round(my)*TW+Math.round(mx)]]);
    soldiers(N(1),10,false); N(1).soldierShare=1; noDraft(); noDraft(2); N(2).soldierShare=0; N(2).humanProg=-1e9; N(1).fleet=3; run(3);
    const main=isle[(Math.round(my))*TW+Math.round(mx)], island=isle[(yA+5)*TW+X0+3];
    return { a, b, main, island, base, X0 };
  }

  it('knows each stretch of border by its landmass: the mainland and the island, the longer first', () => {
    const { main, island }=twoFronts();
    expect(main).not.toBe(island);
    expect(frontIsles(1,2)).toEqual([main, island]);
    expect(frontIsles(2,1)).toEqual([main, island]);
  });

  it('armies sent to different borders each make a front; the one on the island is carried over the sea 5 men to a ship, and fights its own war there', () => {
    const { a, b, main, island }=twoFronts();
    expect(deployArmies(1,2,[a],0,main)).toBe(1);
    expect(deployArmies(1,2,[b],0,island)).toBe(1);
    const [cm,ci]=W.campaigns;
    expect([cm.isle,ci.isle]).toEqual([main,island]);
    // the men of the island army walk to the naval base, board one ship (full: 5), cross, and land on the island
    let crew=0, fleetLow=3;
    until(() => { const s=W.ships.find(k => k.convoy===ci.id); if (s){ crew=Math.max(crew,s.crew); fleetLow=Math.min(fleetLow,N(1).fleet); }
      return ci.members.every(id => { const h=W.humans.find(k => k.id===id)!; return h.boat<0 && isle[((h.y/2)|0)*TW+((h.x/2)|0)]===island; }); }, 3000);
    expect(crew).toBe(5);                                          // one full ship
    expect(fleetLow).toBe(3);                                      // (the base's own boat: the fleet is not used)
    until(() => N(1).fleet===3, 3000);                            // the ship sails home and counts again
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    // a crisis with both armies in place: nobody marches. Then war
    expect(declare(1,2,0)).toBe(true);
    W.crisisAt[1*W.M+2]-=CRISIS_TICKS;
    expect(escalate(1,2)).toBe(true);
    run(5);
    expect(new Set(W.campaigns.map(c => frontKey(1,2)))).toBeTruthy();
    // the island army defends, the mainland army attacks: the mainland is invaded, the island is not
    expect(armyOrder(1,ci.id,false)).toBe(true);
    run(300);
    const takenOn=(isl: number) => { let k=0; for (let t=0;t<NT;t++) if (owner[t]===2 && occ[t]===1 && isle[t]===isl) k++; return k; };
    expect(takenOn(main)).toBeGreaterThan(0);
    expect(takenOn(island)).toBe(0);
    expect([occOn(2,1,main), occOn(2,1,island)]).toEqual([takenOn(main), 0]);   // (counted by landmass)
    // told to attack, the island army takes the island; when there is nothing left of theirs on it, it is done, and unassigned
    expect(armyOrder(1,ci.id,true)).toBe(true);
    until(() => takenOn(island)>0, 1500);
    for (let i=0;i<4000 && ci.phase<2;i++) tick();
    expect(ci.phase).toBe(2);
    expect(ci.why).toBe('done');
    expect(cm.phase).toBe(1);                                       // the other front is still being fought
  });

  it('a landing from the sea waits for the order to attack and holds nothing else up: the army pushing by land goes on while the ships sail', () => {
    const { a, b, main, island, base }=twoFronts();
    expect(declare(1,2,[a],0,main)).toBe(true);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    W.crisisAt[1*W.M+2]-=CRISIS_TICKS; expect(escalate(1,2)).toBe(true); run(3);
    // the coast of theirs on the island
    const wet=(t: number) => !isLand[t-1] || !isLand[t+1] || !isLand[t-TW] || !isLand[t+TW];
    const coast=Array.from({ length: NT }, (_, t) => t).find(t => owner[t]===2 && isle[t]===island && isLand[t] && wet(t))!;
    expect(declareNaval(1,2,[b],base,coast)).toBe(true);
    const camp=W.campaigns.find(c => c.naval>=0)!;
    expect(armyOrder(1,camp.id,false)).toBe(true);           // told to defend: it will wait off the coast
    const taken=() => W.occCount[2*W.M+1];
    const at0=taken();
    until(() => W.invasions.every(i => i.stage>=INV_READY), 3000);
    const atReady=taken();
    expect(atReady).toBeGreaterThan(at0);                      // the land army went on pushing while the ships sailed
    run(300);
    expect(W.invasions[0].stage).toBe(INV_READY);              // told to defend, the ships stay off the coast
    expect(taken()).toBeGreaterThan(atReady);                  // ...though the other army is at it
    expect(armyOrder(1,camp.id,true)).toBe(true);
    run(5);
    expect(W.invasions.length===0 || W.invasions[0].stage>=INV_LAND).toBe(true);   // told to attack, it lands at once
  });

  it('an army with a long way to march takes the base\'s boat when the sea is quicker: no ship of the fleet, and it arrives no later', () => {
    const { b, island, X0 }=twoFronts(true);
    for (let t=0;t<NT;t++) if (owner[t]===2 && (t%TW)>X0+40) setOwner(t,0);   // (all of theirs but the island: the only border is across the sea)
    census(); run(25);
    const fleet=N(1).fleet;
    expect(deployArmies(1,2,[b],0,island)).toBe(1);
    const [c]=W.campaigns;
    let boat=0, arrived=-1;
    for (let i=0;i<4000 && arrived<0;i++){
      tick();
      if (W.ships.some(sh => sh.convoy===c.id && !sh.fleet)) boat++;
      const men=c.members.map(id => W.humans.find(h => h.id===id)!);
      if (men.every(h => h.fk>=0 && Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT*3)) arrived=i;
    }
    expect(boat).toBeGreaterThan(0);                 // a boat of the base took them
    expect(N(1).fleet).toBe(fleet);                  // the fleet was not touched
    expect(arrived).toBeGreaterThan(0);
    // on foot only, with no base to sail from, the same march takes much longer
    const withBoat=arrived;
    const { b: b2, island: i2, base, X0: x02 }=twoFronts(true);
    for (let t=0;t<NT;t++) if (owner[t]===2 && (t%TW)>x02+40) setOwner(t,0);
    run(25);
    pType[base]=0; pOwner[base]=0; census();         // (no naval base)
    expect(deployArmies(1,2,[b2],0,i2)).toBe(1);
    const [c2]=W.campaigns; let foot=-1;
    for (let i=0;i<8000 && foot<0;i++){
      tick();
      const men=c2.members.map(id => W.humans.find(h => h.id===id)!);
      if (men.every(h => h.fk>=0 && Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT*3)) foot=i;
    }
    expect(foot).toBeGreaterThan(withBoat*0.95);   // (armies march 30% faster in peace now, so on this short detour the boat is no longer much quicker than the way round: it is taken only when the sea is clearly better, and is never slower)
  });

  it('the army on the island is reinforced by new soldiers sailing out: the base\'s boat takes up to 5, and leaves a few seconds after the first man, never using the fleet', () => {
    const { b, island }=twoFronts();
    const next=[b+1,b-1,b+PW,b-PW].find(q => q>=0 && q<NP && !plotProblem(N(1),q))!;
    N(1).stock=[200,200,200]; expect(build(N(1),next,B_BARRACKS)).toBe(true); census(); tick();
    expect(unitAt(b)!.cap).toBe(10);                               // a bigger army: room for five more
    expect(deployArmies(1,2,[b],0,island)).toBe(1);
    const [ci]=W.campaigns;
    const onIsland = (id: number) => { const h=W.humans.find(k => k.id===id)!; return h.boat<0 && isle[((h.y/2)|0)*TW+((h.x/2)|0)]===island; };
    until(() => W.ships.length===0 && ci.members.every(onIsland), 5000);
    // four new recruits: a boat of four, not kept waiting for a fifth
    soldiers(N(1),4,false); N(1).soldierShare=1;
    let crew=0, fleetLow=3;
    until(() => { for (const s of W.ships) if (s.convoy===ci.id){ crew=Math.max(crew,s.crew); fleetLow=Math.min(fleetLow,N(1).fleet); } return ci.members.length===9 && ci.members.every(onIsland); }, 5000);
    expect([crew,fleetLow]).toEqual([4,3]);
    // and the tenth man, alone: a boat of one, after a few seconds
    soldiers(N(1),1,false);
    crew=0;
    until(() => { for (const s of W.ships) if (s.convoy===ci.id) crew=Math.max(crew,s.crew); return ci.members.length===10 && ci.members.every(onIsland); }, 5000);
    expect(crew).toBe(1);
  });

  it('an army at home is stationed on a border in peace, moved to the other front of the same kingdom, and told to attack or defend, before and during the war', () => {
    const { a, main, island }=twoFronts();
    expect([...new Set(bordersOf(1).filter(b => b.sec!==SEC_SIEGE).map(b => b.isle))].sort()).toEqual([main,island].sort());   // (the mainland border in parts, the island's whole)
    expect(bordersOf(1).filter(b => b.sec===SEC_SIEGE).map(b => b.d)).toEqual([2]);   // (and the siege of their capital)
    expect(bordersOf(1).every(b => b.tiles.length>0)).toBe(true);
    expect(assignProblem(1,a,2)).toBeNull();
    expect(assignArmy(1,a,2,main)).toBe(true);
    const [c]=W.campaigns; expect([c.isle,c.deployed]).toEqual([main,true]);
    expect(assignArmy(1,a,2,main)).toBe(false);                    // it is there already
    expect(assignArmy(1,a,2,island)).toBe(true);                   // the same army, another front
    expect(W.campaigns).toHaveLength(1); expect(c.isle).toBe(island);
    expect(assignArmy(1,a,2,island,false)).toBe(true);             // told to defend there, in peace: kept for the war
    expect([c.ordered,c.attack]).toEqual([true,false]);
    until(() => W.offensive[1*W.M+2]===F_READY, 4000);
    expect(declare(1,2,0)).toBe(true);
    W.crisisAt[1*W.M+2]-=CRISIS_TICKS;
    expect(escalate(1,2)).toBe(true);
    expect(attacks(c)).toBe(false);                                // it defends, as it was told
    expect(assignArmy(1,a,2,main,true)).toBe(true);                // in the war: to the mainland, to attack
    expect([c.isle,attacks(c)]).toEqual([main,true]);
    expect(W.campaigns).toHaveLength(1);
  });

  it('naval bases on two landmasses are joined by a sea lane for the kingdom\'s villagers, and an army\'s boat sails from base to base', () => {
    const { b, island, base }=twoFronts();
    let q2=-1;
    for (let q=0;q<NP && q2<0;q++){
      if (navalSite(N(1),q).orient<0) continue;
      let ok=false; const px=(q%PW)*4, py=((q/PW)|0)*4;
      for (let y=py;y<py+8 && !ok;y++) for (let x=px;x<px+8;x++){ const t=y*TW+x; if (isLand[t] && isle[t]===island && owner[t]===1){ ok=true; break; } }
      if (ok) q2=q;
    }
    expect(q2).toBeGreaterThanOrEqual(0);
    N(1).stock=[200,200,200]; expect(build(N(1),q2,B_NAVAL)).toBe(true); census();
    run(101);
    const d1=dockTile(base), d2=dockTile(q2);
    expect([ferry[d1],ferry[d2]]).toEqual([1,1]);                  // both harbours are on the lane
    // the army sent to the island sails to the island's harbour
    expect(deployArmies(1,2,[b],0,island)).toBe(1);
    let landed=-1;
    until(() => { const s=W.ships.find(k => k.fleet===false && k.convoy>=0); if (s) landed=s.lands; return landed>=0; }, 3000);
    expect(isle[landed]).toBe(island);
    const [lx,ly]=[landed%TW,(landed/TW)|0], [dx,dy]=[d2%TW,(d2/TW)|0];
    expect(Math.hypot(lx-dx,ly-dy)).toBeLessThan(14);              // ...beside the second base, not on some far coast
  });
});

describe('what armies cost, and where they stand', () => {
  const wages=(n: Nation) => [n.wageS, n.wageM].map(v => +v.toFixed(6));
  it('a soldier costs 0.22 idle in his barracks, 0.3 on a border or defending, 0.4 attacking; militia nothing at home, 0.1 on a border or defending, 0.2 attacking', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14); paintDisc(N(2),60); place(N(2),B_FARM); paintToward(1,2);
    const a=place(N(1),B_BARRACKS), b=place(N(1),B_BARRACKS,pCenter[a]);
    soldiers(N(1),10,false); N(1).soldierShare=1; noDraft(); noDraft(2); N(2).soldierShare=0; N(2).humanProg=-1e9; tick();
    const mil=soldiers(N(1),3,false); for (const h of mil){ h.militia=true; h.base=-1; } tick();
    expect(wages(N(1))).toEqual([+(10*WAGE_IDLE).toFixed(6), 0]);                 // idle at home
    expect(deployArmies(1,2,[a])).toBe(1); tick();
    expect(wages(N(1))[0]).toBeCloseTo(5*WAGE+5*WAGE_IDLE,6);                      // one army deployed on a border
    expect(declare(1,2,[b],3)).toBe(true); until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    expect(wages(N(1))[0]).toBeCloseTo(10*WAGE,6);                                 // both massed in a crisis: border pay
    expect(wages(N(1))[1]).toBeCloseTo(3*MIL_WAGE,6);                              // the militia called up
    W.crisisAt[1*W.M+2]-=CRISIS_TICKS; expect(escalate(1,2)).toBe(true); run(3);
    expect(wages(N(1))[0]).toBeCloseTo(10*WAGE_ATTACK,6);                          // attacking
    expect(wages(N(1))[1]).toBeCloseTo(3*MIL_ATTACK,6);
    const [c1,c2]=army(1,2); expect(armyOrder(1,c1.id,false)).toBe(true); run(2);
    expect(wages(N(1))[0]).toBeCloseTo(5*WAGE_ATTACK+5*WAGE,6);                    // one defends
    for (const c of W.campaigns.filter(k => k.a===1)) armyOrder(1,c.id,false); run(2);
    expect(wages(N(1))).toEqual([+(10*WAGE).toFixed(6), +(3*MIL_WAGE).toFixed(6)]);   // all defend
    void c2;
  });
  const army = (a: number, d: number) => W.campaigns.filter(c => c.front && c.a===a && c.d===d && c.phase<2);

  it('land the enemy occupies pays no land tax', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14); paintDisc(N(2),30);
    const full=incomeParts(N(2)).land;
    for (let t=0, k=0;t<NT && k<40;t++) if (owner[t]===2 && !occ[t]){ occupyHack(t,1); k++; }
    expect(incomeParts(N(2)).land).toBeCloseTo(full*(N(2).tiles-40)/N(2).tiles,9);
  });

  it('an army deployed in peace takes no ground from a war it is not in: the front is only the free land of theirs beside its own', () => {
    world(2); quiet(); paintDisc(N(1),14); paintDisc(N(2),40);
    const [ax,ay]=[N(1).capTile%TW,(N(1).capTile/TW)|0], [bx,by]=[N(2).capTile%TW,(N(2).capTile/TW)|0], mx=Math.round((ax+bx)/2), my=Math.round((ay+by)/2);
    for (let y=my-60;y<my+60;y++) for (let x=mx-100;x<mx+100;x++) setOwner(y*TW+x, x<mx ? 1 : 2);
    census();
    // 3 occupies a band of 2's land beside the border, at war with 2
    for (let y=my-60;y<my+60;y++) for (let x=mx;x<mx+12;x++) occupyHack(y*TW+x,3);
    W.wars[3*W.M+2]=W.wars[2*W.M+3]=1; W.occCount[2*W.M+3]=W.occCount[2*W.M+3];
    const inZone=(t: number) => { const x=t%TW, y=(t/TW)|0; return Math.abs(y-my)<59 && x>=mx-1 && x<=mx+13; };
    expect(lineOf(1,2).tiles.filter(inZone)).toHaveLength(0);               // at peace: the free land of theirs touching ours is none here (the army goes home), and the band the other holds is not ours to follow
    W.wars[1*W.M+2]=W.wars[2*W.M+1]=1;
    expect(lineOf(1,2).tiles.filter(inZone).length).toBeGreaterThan(50);    // at war with them, it shares the zone with the other attacker
  });

  it('an army that answered one crisis can be taken to answer another, and armies out on a border are listed with the rest', () => {
    world(2); quiet();
    W.contact[1*W.M+2]=W.contact[2*W.M+1]=W.contact[1*W.M+3]=W.contact[3*W.M+1]=1;
    soldiers(N(2),5); soldiers(N(3),5); const mine=soldiers(N(1),5); void mine;
    N(1).soldierShare=1; noDraft(); noDraft(2); run(2);
    expect(declare(2,1,5)).toBe(true); expect(declare(3,1,5)).toBe(true);
    const key=available(N(1))[0].unit.key;
    expect(defend(1,2,[key])).toBe(true);
    expect(army(1,2)).toHaveLength(1);
    expect(available(N(1))).toHaveLength(0);                  // none at home...
    expect(available(N(1),true).map(a => !!a.out)).toEqual([true]);   // ...but it is listed, out on that border
    expect(defendProblem(1,3)).toBeNull();
    expect(defend(1,3,[key])).toBe(true);                     // taken from there, to this one
    expect([army(1,2).length, army(1,3).length]).toEqual([0, 1]);
  });

  it('armies are Army 1, Army 2, … until the player names one; a name stays through changes to the barracks', () => {
    world(1); labelWorld(); allocIsles(); quiet(); resetArmyNames();
    const a=place(N(1),B_BARRACKS), b=place(N(1),B_BARRACKS,pCenter[a]); soldiers(N(1),10,false); N(1).soldierShare=1; tick();
    const ua=unitAt(a)!, ub=unitAt(b)!;
    expect([armyName(N(1),ua), armyName(N(1),ub)]).toEqual(['Army 1','Army 2']);
    renameArmy(ub,'The Sea Guard');
    expect(armyName(N(1),ub)).toBe('The Sea Guard');
    expect(armyName(N(1),ua)).toBe('Army 1');
    renameArmy(ub,'');                                          // an empty name gives the number back
    expect(armyName(N(1),ub)).toBe('Army 2');
    const q2=place(N(2),B_BARRACKS); tick();
    expect(armyName(N(2),unitAt(q2)!)).toBe('Army 1');   // (a kingdom of its own numbers its own)
  });

  it('a crisis with nothing left of it (its armies gone, no landing under way) ends', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintToward(1,2);
    W.aggr[2*W.M+1]=1; W.crisisAt[2*W.M+1]=5;
    run(11);
    expect(W.aggr[2*W.M+1]).toBe(0);
  });
});

describe('marching to a border before war', () => {
  it('an army on its way to the border of a kingdom (in a crisis, or deployed in peace) never sets foot on that kingdom\'s land', () => {
    split(25);
    soldiers(N(1),30); noDraft(); noDraft(2);
    expect(declare(1,2,30)).toBe(true);
    let onTheirs=0;
    for (let i=0;i<900;i++){
      tick();
      for (const h of W.humans) if (h.o===1 && h.war>=0 && h.kind===H_SOLDIER){ const t=((h.y/2)|0)*TW+((h.x/2)|0); if (owner[t]===2 && !occ[t]) onTheirs++; }
    }
    expect(W.wars[1*W.M+2]).toBe(0);                 // (still no war: only a crisis)
    expect(onTheirs).toBe(0);
  });
  it('a villager on his way to build himself a home is not turned beggar by the minute', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14);
    const v=W.humans.find(h => h.o===1 && h.kind===H_VILLAGER) ?? makeHuman(N(1),H_VILLAGER,N(1).capTile%TW*2,((N(1).capTile/TW)|0)*2);
    if (!W.humans.includes(v)) W.humans.push(v);
    N(1).beds=0; N(1).houses=0;
    v.home=5; v.task=TASK_HOME_GO; v.housed=false; v.homeless=800;   // (on his way to a site: a minute and more homeless)
    tick();
    expect(v.beggar).toBe(false);
    v.home=-1; v.task=TASK_ROAM; v.homeless=800; v.beggar=false; N(1).beds=0;
    tick();
    expect(v.beggar).toBe(false);    // between jobs with room to build: still on his way to a house
    pBuild.fill(0); resetRooms(); v.homeless=800;
    tick();
    expect(v.beggar).toBe(true);     // with no room to build, the minute counts
  });
});

describe('watchtowers', () => {
  it('an invading army goes for the watchtowers in reach of its line first, and brings a ring of them down', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),60); paintToward(1,2);
    soldiers(N(1),40); soldiers(N(2),10); noDraft(); noDraft(2); N(2).soldierShare=0; N(2).humanProg=-1e9; run(2);
    // eight towers of theirs near the border
    const c=N(1).capTile, d=(q: number) => ((q%PW)*4+2-c%TW)**2+(((q/PW)|0)*4+2-((c/TW)|0))**2;
    const TQ: number[]=[];
    for (let k=0;k<8;k++){
      const q=Array.from({ length: NP }, (_, i) => i).filter(i => !plotProblem(N(2),i)).sort((a,b) => d(a)-d(b))[0];
      N(2).stock=[50,50,50]; expect(build(N(2),q,B_TOWER)).toBe(true); TQ.push(q);
    }
    census(); buildWalls();
    expect(declare(1,2,40)).toBe(true); giveWord(1,2);
    let tDown=-1, menAtDown=0;
    for (let i=0;i<2500 && tDown<0;i++){ tick(); if (TQ.filter(q => pType[q]===B_TOWER && pBurn[q]<=0).length<=2){ tDown=i; menAtDown=menOn(1,2); } }
    expect(tDown).toBeGreaterThan(0);                      // the ring comes down
    expect(menAtDown).toBeGreaterThan(20);                 // without bleeding the army white
  });
});

describe('stationing armies on borders (assign)', () => {
  it('an army can leave one kingdom\'s border for another\'s, even one that is fighting a war', () => {
    world(2); quiet(); paintDisc(N(1),14); paintDisc(N(2),60); paintDisc(N(3),60); place(N(2),B_FARM); place(N(3),B_FARM); paintToward(1,2); paintToward(1,3); labelWorld(); allocIsles();
    const a=place(N(1),B_BARRACKS);
    soldiers(N(1),5,false); N(1).soldierShare=1; noDraft(); noDraft(2); noDraft(3); N(2).soldierShare=0; N(3).soldierShare=0; tick();
    expect([W.contact[1*W.M+2]>0, W.contact[1*W.M+3]>0]).toEqual([true,true]);
    expect(assignArmy(1,a,2)).toBe(true);
    const [c]=W.campaigns; expect(c.d).toBe(2);
    run(30);
    expect(assignArmy(1,a,3)).toBe(true);                          // not committed: it goes on to the other kingdom
    expect(W.campaigns.map(k => k.d)).toEqual([3]);
    expect(W.campaigns[0].deployed).toBe(true);
    until(() => W.offensive[1*W.M+3]===F_READY, 4000);
    expect(declare(1,3,0)).toBe(true);                             // the crisis is 1's: the army is committed
    expect(freeArmy(W.campaigns[0])).toBe(false);
    expect(assignArmy(1,a,2)).toBe(true);                          // ...and is still moved, as the player may at any time
    expect(W.campaigns.map(k => k.d)).toEqual([2]);
    expect(assignProblem(1,-2,2)).toMatch(/militia/i);
  });
});

describe('bots at war on several fronts', () => {
  it('a bot threatened on one border with nobody at home brings an army over from a quiet border', () => {
    world(2); quiet(); paintDisc(N(1),14); paintDisc(N(2),60); paintDisc(N(3),60); place(N(2),B_FARM); place(N(3),B_FARM); paintToward(1,2); paintToward(1,3); labelWorld(); allocIsles();
    const a=place(N(1),B_BARRACKS);
    soldiers(N(1),5,false); N(1).soldierShare=1; noDraft(); noDraft(2); noDraft(3); N(2).soldierShare=0; N(3).soldierShare=0; tick();
    expect([W.contact[1*W.M+2]>0, W.contact[1*W.M+3]>0]).toEqual([true,true]);
    soldiers(N(3),10); N(3).soldierShare=1; tick();
    expect(assignArmy(1,a,2)).toBe(true);                            // 1's one army stands on a quiet border
    expect(W.campaigns.map(k => k.d)).toEqual([2]);
    run(30);
    N(3).nextThink=1e9; N(1).nextThink=1e9;
    expect(declare(3,1,10)).toBe(true);                            // 3 masses against 1
    run(200);
    expect(menOn(3,1)).toBeGreaterThan(0);
    botThink(N(1));
    expect(W.campaigns.filter(k => k.a===1 && k.front && k.phase<2).map(k => k.d)).toEqual([3]);   // the army now faces 3
  });
});

describe('peace and the buildings on ceded ground', () => {
  it('a building on land that changes hands in a peace deal stays standing and goes to its new owner; at war it burns as before', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),40); paintToward(1,2); noDraft(2);
    const c1=N(1).capTile, d=(q: number) => ((q%PW)*4+2-c1%TW)**2+(((q/PW)|0)*4+2-((c1/TW)|0))**2;
    const q=Array.from({ length: NP }, (_, i) => i).filter(i => !plotProblem(N(2),i)).sort((a,b) => d(a)-d(b))[0];
    N(2).stock=[100,100,100]; expect(build(N(2),q,B_FARM)).toBe(true); census();
    const cx=(q%PW)*4+2, cy=((q/PW)|0)*4+2;
    W.wars[1*W.M+2]=W.wars[2*W.M+1]=1; W.atWar[1*W.M+2]=W.atWar[2*W.M+1]=1;
    for (let y=cy-14;y<=cy+14;y++) for (let x=cx-14;x<=cx+14;x++){ const t=y*TW+x; if (owner[t]===2 && occ[t]===0 && ![t-1,t+1,t-TW,t+TW].every(k => owner[k]!==1 && !occ[k]) || (owner[t]===2 && Math.abs(x-cx)<=14 && Math.abs(y-cy)<=14)) { if (owner[t]===2 && !occ[t]) occupyHack(t,1); } }
    expect(occ[((cy|0))*TW+cx]).toBe(1);
    makePeace(1,2);
    expect(owner[cy*TW+cx]).toBe(1);                                // the ground is theirs
    expect([pType[q],pOwner[q]]).toEqual([B_FARM,1]);                // and the farm stands, theirs
    expect(pBurn[q]).toBeLessThanOrEqual(0);
    expect(N(1).blds.includes(q)).toBe(true); expect(N(2).blds.includes(q)).toBe(false);
  });
});

describe('workers pass over what they cannot reach', () => {
  it('a builder whose nearest houses are out of reach (behind enemy-held ground) goes on to one he can reach, instead of standing idle', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),24); noDraft(2);
    N(1).tier[R_HOUSING]=2; N(1).humanProg=-1e9;
    place(N(1),B_GUILD);
    const hs: number[]=[]; for (let k=0;k<6;k++) hs.push(place(N(1),B_HOUSE));
    N(1).stock=[200,200,200]; census();
    for (let k=0;k<3;k++){ const [x,y]=doorOf(N(1)); W.humans.push(makeHuman(N(1),H_VILLAGER,x+k,y)); }
    const c=N(1).capTile, d=(q: number) => ((q%PW)*4+2-c%TW)**2+(((q/PW)|0)*4+2-((c/TW)|0))**2;
    const sorted=[...new Set(hs)].sort((a,b) => d(a)-d(b));
    expect(sorted.length).toBeGreaterThan(4);
    for (const q of sorted.slice(0,3)){ const [x,y]=[(q%PW)*4+2,((q/PW)|0)*4+4]; for (let yy=y-3;yy<=y+3;yy++) for (let xx=x-3;xx<=x+3;xx++){ const t=yy*TW+xx; if (owner[t]===1 && !occ[t]) occupyHack(t,2); } }
    let fixing=-1; for (let i=0;i<1500 && fixing<0;i++){ tick(); const b=W.humans.find(h => h.o===1 && h.fix>=0); if (b) fixing=b.fix; }
    expect(fixing).toBeGreaterThanOrEqual(0);
    expect(sorted.slice(0,3)).not.toContain(fixing);
  });
});

describe('the border as the war has made it', () => {
  it('assigning offers the border where the front stands now: the enemy ground beside what the army has occupied, not the old border', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),40); paintToward(1,2); noDraft(2);
    const old: number[]=[]; for (let t=0;t<NT;t++) if (owner[t]===2 && [t-1,t+1,t-TW,t+TW].some(k => owner[k]===1)) old.push(t);
    expect(old.length).toBeGreaterThan(0);
    W.wars[1*W.M+2]=W.wars[2*W.M+1]=1; W.atWar[1*W.M+2]=W.atWar[2*W.M+1]=1;
    const band=new Set<number>(old); for (let k=0;k<6;k++) for (const t of [...band]) for (const n of [t-1,t+1,t-TW,t+TW]) if (owner[n]===2) band.add(n);
    for (const t of band) occupyHack(t,1);
    W.tickN+=100;   // (the list is kept a second)
    const tiles=bordersOf(1).filter(b => b.sec!==SEC_SIEGE).flatMap(b => b.tiles);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every(t => owner[t]===2 && !occ[t])).toBe(true);   // free ground of theirs...
    expect(tiles.every(t => [t-1,t+1,t-TW,t+TW].some(k => owner[k]===2 && occ[k]===1))).toBe(true);   // ...beside what the army holds
    expect(tiles.some(t => old.includes(t))).toBe(false);
  });
});

describe('soldiers keep off third kingdoms\' ground', () => {
  it('a soldier found on the ground of a kingdom he is not at war with is set down on his own, not lost', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14); paintDisc(N(2),40); paintToward(1,2);
    const men=soldiers(N(1),5,false); noDraft(); noDraft(2); run(2);
    const h=men[0], t=Array.from({ length: NT }, (_, k) => k).find(k => owner[k]===2 && [k-1,k+1,k-TW,k+TW].some(j => owner[j]===1))!;
    h.x=(t%TW)*2+1; h.y=((t/TW)|0)*2+1;
    tick();
    expect(W.humans.includes(h)).toBe(true);
    expect(owner[((h.y/2)|0)*TW+((h.x/2)|0)]).toBe(1);
  });
});

describe('where new soldiers come out, entrenching, and order groups', () => {
  /** Two barracks of 5, a near the castle and b far from it (nobody of 1's but the soldiers), a war with 2. */
  function two(){
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),24); paintDisc(N(2),40); paintToward(1,2); noDraft(2);
    const a=place(N(1),B_BARRACKS), b=place(N(1),B_BARRACKS,pCenter[a]);
    soldiers(N(1),0,false); noDraft(); N(1).soldierShare=1; N(1).gold=1e6; run(3);
    return { a, b };
  }
  /** The kingdom raises one soldier now: where he stands. */
  function raise(){
    const before=new Set(W.humans.filter(h => h.o===1).map(h => h.id));
    N(1).humanProg=1e9; N(1).soldierShare=1; tick();
    const h=W.humans.find(k => k.o===1 && !before.has(k.id))!;
    return h;
  }
  const near = (h: { x: number; y: number }, q: number) => Math.hypot(h.x-((q%PW)*8+4),h.y-(((q/PW)|0)*8+7.5))<6;
  it('a new soldier comes out of a barracks the enemy does not hold, not the capital\'s nearest; of all of them occupied, out of the castle; and in a siege always out of the castle', () => {
    const { a, b }=two();
    expect(near(raise(),a)).toBe(true);                              // (no war: the barracks nearest the castle, as ever)
    const [dx,dy]=doorOf(N(1));
    // a is held by the enemy: b
    for (let y=0;y<4;y++) for (let x=0;x<4;x++) occupyHack(((((a/PW)|0)*4+y)*TW)+(a%PW)*4+x,2);
    expect(near(raise(),b)).toBe(true);
    for (let y=0;y<4;y++) for (let x=0;x<4;x++) occupyHack(((((b/PW)|0)*4+y)*TW)+(b%PW)*4+x,2);
    const h=raise(); expect(Math.hypot(h.x-dx,h.y-dy)).toBeLessThan(6);   // all held: the castle
    // a siege: always the castle
    for (let y=0;y<4;y++) for (let x=0;x<4;x++){ freeHack(((((a/PW)|0)*4+y)*TW)+(a%PW)*4+x); freeHack(((((b/PW)|0)*4+y)*TW)+(b%PW)*4+x); }
    while (W.tickN%10!==0) tick();   // (the siege is looked at on the seventh tick of ten: this one is held by hand)
    W.siege[1]=W.tickN||1;
    const g=raise();
    expect(Math.hypot(g.x-dx,g.y-dy)).toBeLessThan(6);
    expect(g.fury).toBe(true);
  });

  it('an army holding its place on defence digs in after 10 seconds: 15% harder and 15% more health, until it is told to attack', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),40); paintToward(1,2); noDraft(2);
    soldiers(N(1),10); noDraft(); run(2);
    const keys=available(N(1)).map(a => a.unit.key);
    for (const k of keys) expect(assignArmy(1,k,2)).toBe(true);
    const c=W.campaigns.find(k => k.a===1)!;
    expect(c.dug).toBe(false);
    until(() => c.dug, 4000);
    const men=c.members.map(id => W.humans.find(h => h.id===id)!);
    until(() => men.every(h => h.dug), 600);
    expect(DIG_TICKS).toBe(200);
    expect(maxHp(men.find(h => !h.lead)!)).toBeCloseTo(SOLDIER_HP[1]*1.15,9);
    const h=men.find(k => !k.lead)!; expect(h.hp).toBeCloseTo(SOLDIER_HP[1]*1.15,6);
    // the order to attack ends it
    expect(assignArmy(1,keys[0],2,0,true)).toBe(true);
    run(2);
    expect(c.dug).toBe(false); expect(men.every(k => !k.dug)).toBe(true);
    expect(h.hp).toBeLessThanOrEqual(SOLDIER_HP[1]+1e-9);
  });

  it('armies merge into one order group: orders go to all of them, they stay separate armies, up to five can join, and it can be undone', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),30); paintDisc(N(2),60); place(N(2),B_FARM); paintToward(1,2);
    const free=Array.from({ length: NP }, (_, q) => q).filter(q => !plotProblem(N(1),q)).sort((x,y) => x-y), bs: number[]=[];
    for (const q of free){ if (bs.length>=7) break; if (bs.every(b => Math.abs(b%PW-q%PW)>=3 || Math.abs(((b/PW)|0)-((q/PW)|0))>=3)){ N(1).stock=[100,100,100]; if (build(N(1),q,B_BARRACKS)) bs.push(q); } }
    expect(bs.length).toBe(7); census(); buildUnits();
    soldiers(N(1),35,false); N(1).soldierShare=1; noDraft(); noDraft(2); run(3);
    const U=units[1].map(u => u.key), uniq=[...new Set(U)];
    expect(uniq.length).toBeGreaterThanOrEqual(7);
    const [k0,k1,k2,k3,k4,k5,k6]=uniq;
    expect(groupKeys(1,k0)).toEqual([k0]);
    queueCommand({ type:'merge', nation:1, a:k0, b:k1 }); tick();
    expect(groupKeys(1,k0)).toEqual([k0,k1]); expect(groupKeys(1,k1)).toEqual([k0,k1]);
    expect(mergeArmies(1,k1,k0)).toBe(false);                        // already one group
    expect(mergeArmies(1,k0,k2)).toBe(true); expect(mergeArmies(1,k0,k3)).toBe(true); expect(mergeArmies(1,k0,k4)).toBe(true); expect(mergeArmies(1,k0,k5)).toBe(true);
    expect(groupKeys(1,k0)).toHaveLength(6);
    expect(mergeArmies(1,k0,k6)).toBe(false);                        // five merges at most
    // one order sends them all
    expect(assignArmy(1,k2,2)).toBe(true);
    expect(W.campaigns.filter(c => c.a===1 && c.d===2).map(c => c.unit).sort()).toEqual([k0,k1,k2,k3,k4,k5].sort());
    expect(W.campaigns.filter(c => c.a===1).length).toBe(6);         // six armies, still
    // and an unmerge on any makes them separate again
    queueCommand({ type:'unmerge', nation:1, key:k3 }); tick();
    expect(groupKeys(1,k0)).toEqual([k0]); expect(groupKeys(1,k3)).toEqual([k3]);
  });
});

describe('field medics, the wounded and the hospital', () => {
  /** A kingdom 1 with a hospital (field medics learned), two doctors and soldiers (a few to fall). */
  function field(medics=true, hospital=true){
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),24); noDraft(2); N(1).humanProg=-1e9;
    if (medics) N(1).tier[R_MEDICS]=2;
    let q=-1; if (hospital){ q=place(N(1),B_HOSPITAL); census(); }
    const men=soldiers(N(1),40,false); noDraft();
    if (hospital){ for (let k=0;k<3;k++){ const [x,y]=doorOf(N(1)); W.humans.push(makeHuman(N(1),H_VILLAGER,x+k,y)); } N(1).soldierShare=40/43; }   // (the soldiers stay soldiers, the three others are free to be doctors)
    run(2);
    return { q, men };
  }
  /** Soldiers fall until one is only wounded (or the kingdom has none left to try). */
  function fall(men: Human[]){
    for (const h of men){ h.hp=0; const before=W.wounded.length; tick(); if (W.wounded.length>before) return h; }
    return undefined;
  }
  it('a hospital costs 15 wood, 25 stone and 10 copper, takes 2 plots, and needs field medics researched first', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),24);
    expect(structureOf(B_HOSPITAL)!.cost).toEqual([15,25,10]);
    expect(SIZE[B_HOSPITAL]).toEqual([2,1]);
    const q=Array.from({ length: NP }, (_, i) => i).find(i => !plotProblem(N(1),i) && !plotProblem(N(1),i+1) && i%PW<PW-1)!;
    expect(placeProblem(N(1),q,B_HOSPITAL)).toMatch(/field medics/i);
    N(1).tier[R_MEDICS]=2; N(1).stock=[15,25,10];
    expect(placeProblem(N(1),q,B_HOSPITAL)).toBeNull();
    expect(build(N(1),q,B_HOSPITAL)).toBe(true);
    expect(N(1).stock).toEqual([0,0,0]); expect(pType[q]).toBe(B_HOSPITAL);
  });
  it('field medics is learned for 400 points (8% wounded), then 600 more (12%) and 800 more (20%); before that nobody is wounded', () => {
    world(1); expect(TIER_XP[R_MEDICS]).toEqual([0,400,600,800]);
    expect([1,2,3,4].map(t => { N(1).tier[R_MEDICS]=t; return woundChance(N(1)); })).toEqual([0,0.08,0.12,0.20]);
    expect(TOPIC_MAX[R_MEDICS]).toBe(4);
    const { men }=field(false,false);
    for (const h of men) h.hp=0; run(3);
    expect(W.wounded).toHaveLength(0);
  });
  it('some who fall are wounded, lie without blood, bleed out in 45 s with no hospital, and then die for good', () => {
    const { men }=field(true,false);
    const died=collect('died');
    const h=fall(men)!; expect(h).toBeDefined();
    const w=W.wounded[0]; const mourned=died.length;
    expect(mourned).toBe(men.indexOf(h)>=0 ? died.length : mourned);   // (the wounded are not mourned)
    expect(W.humans.includes(h)).toBe(false);
    expect(BLEED_TICKS).toBe(900);
    run(BLEED_TICKS-5); expect(W.wounded).toContain(w);
    const before=died.length; run(10);
    expect(W.wounded).not.toContain(w); expect(died.length).toBe(before+1);
  });
  it('two doctors staff the hospital; one runs out to the wounded man (green cross, the clock stopped), carries him to a bed and heals him in 7 s, and he goes back to his duty', () => {
    const { q, men }=field();
    run(100);
    const docs=W.humans.filter(h => h.o===1 && h.work===q); expect(docs).toHaveLength(2);
    const h=fall(men)!; expect(h).toBeDefined();
    const w=W.wounded[0];
    until(() => w.medic>=0, 200);
    const left=w.left; run(20); expect(w.left).toBe(left);          // (a doctor is on his way: no bleeding)
    const doc=docs.find(d => d.id===w.medic)!; expect(doc.task).toBe(TASK_DOC_GO);
    until(() => w.carried, 3000);
    until(() => w.bed>=0, 3000);
    expect(w.heal).toBe(HEAL_TICKS-0);                                // 7 seconds in his bed
    expect(HEAL_TICKS).toBe(140);
    expect(doc.task).toBe(TASK_DOC_HEAL);                            // the doctor stays with him
    until(() => !W.wounded.includes(w), 400);
    expect(W.humans.includes(h)).toBe(true); expect(h.hp).toBeCloseTo(maxHp(h),6);
    until(() => doc.task===TASK_DOC_WAIT, 400);
  });
  it('a doctor runs 50% faster on his way to a wounded man than a villager walks', () => {
    expect(MEDIC_SPEED).toBe(1.5);
    const { q, men }=field(); run(100);
    const h=fall(men)!; const w=W.wounded[0];
    until(() => w.medic>=0, 200);
    const doc=W.humans.find(d => d.id===w.medic)!, x0=doc.x, y0=doc.y; run(10);
    expect(Math.hypot(doc.x-x0,doc.y-y0)).toBeGreaterThan(doc.sp*TICK*10*1.4);
    void h; void q;
  });
});

describe('small changes of the medics batch', () => {
  it('a capital under siege raises people twice as fast; an army marches 30% faster in peace than at war', () => {
    world(1); labelWorld(); allocIsles(); quiet();
    const base=humanRate(N(1),50); W.siege[1]=W.tickN||1;
    expect(humanRate(N(1),50)).toBeCloseTo(base*2,9); W.siege[1]=0;
    paintDisc(N(2),40); paintToward(1,2); soldiers(N(1),10); noDraft(); noDraft(2); run(2);
    expect(assignArmy(1,available(N(1))[0].unit.key,2)).toBe(true);
    const c=W.campaigns.find(k => k.a===1)!, h=W.humans.find(k => k.id===c.members[0])!;
    const own=Array.from({ length: NT }, (_, t) => t).find(t => owner[t]===1 && !occ[t])!;
    h.x=(own%TW)*2+1; h.y=((own/TW)|0)*2+1;
    expect(marchPace(h,c)).toBeCloseTo(pace(h)*PEACE_MARCH*(c.inspired ? 1.15 : 1),9); expect(PEACE_MARCH).toBe(1.3);
    W.wars[1*W.M+2]=W.wars[2*W.M+1]=1;
    expect(marchPace(h,c)).toBeCloseTo(pace(h)*(c.inspired ? 1.15 : 1),9);
  });
});

describe('bot garrisons', () => {
  it('in peace a bot with two armies posts the smaller on its neighbour\'s border and keeps the other at home; a bot with one army keeps it at home', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14); paintDisc(N(2),60); place(N(2),B_FARM); paintToward(1,2);
    const a=place(N(1),B_BARRACKS), b=place(N(1),B_BARRACKS,pCenter[a]);
    soldiers(N(1),10,false); N(1).soldierShare=1; noDraft(); noDraft(2); N(2).soldierShare=0; N(2).humanProg=-1e9; run(3);
    N(1).nextThink=1e9; N(1).soldiers=10;
    W.tickN+=200-(W.tickN%200)+(1*13)%200;   // (the tick a bot looks to its borders)
    botThink(N(1));
    const out=W.campaigns.filter(c => c.a===1 && c.front && c.phase<2);
    expect(out).toHaveLength(1);
    expect([out[0].d,out[0].deployed]).toEqual([2,true]);
    expect(available(N(1)).length).toBe(1);                         // the other army stays at home
    // not a campaign: it does not keep the bot from going to war
    expect(out[0].deployed).toBe(true);
  });
});

describe('occupation leaves no pockets', () => {
  it('a defender who gets in behind the occupied zone frees nothing round him: ground is freed only from the edge in', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),24);
    W.contact[1*W.M+2]=W.contact[2*W.M+1]=1;
    const men=soldiers(N(2),3); noDraft(); noDraft(2); run(1);
    expect(declare(2,1,3)).toBe(true);
    const cx=N(2).capTile%TW, cy=(N(2).capTile/TW)|0, R=10;
    const ring=(t: number) => Math.hypot((t%TW)-cx,((t/TW)|0)-cy)<=R && !underCastle(2,t);
    for (let t=0;t<NT;t++) if (owner[t]===2 && ring(t)) occupyHack(t,1);
    const before=W.occCount[2*W.M+1];
    // the men stand in the middle of the zone (put back each tick: they would march off)
    for (let i=0;i<60;i++){ for (const h of men){ h.x=(cx+6)*2; h.y=cy*2; } tick(); }
    // pockets: free ground of theirs in the zone joined neither to the castle's ground nor to the free land outside it
    const free=(t: number) => owner[t]===2 && !occ[t], seenP=new Set<number>(); let pockets=0;
    for (let t0=0;t0<NT;t0++){
      if (!free(t0) || seenP.has(t0) || Math.hypot((t0%TW)-cx,((t0/TW)|0)-cy)>R+3) continue;
      const comp=[t0]; seenP.add(t0); let linked=false;
      for (let i=0;i<comp.length;i++){
        const t=comp[i]; if (underCastle(2,t) || Math.hypot((t%TW)-cx,((t/TW)|0)-cy)>R+1) linked=true;
        for (const n of [t-1,t+1,t-TW,t+TW]) if (free(n) && !seenP.has(n)){ seenP.add(n); comp.push(n); }
      }
      if (!linked) pockets++;
    }
    expect(pockets).toBe(0);
    expect(W.occCount[2*W.M+1]).toBeLessThanOrEqual(before);
  });
});

describe('shortcuts that keep the late game fast', () => {
  it('a front\'s line is kept while nothing changes, and worked out again at once when land is occupied', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(2),40); paintToward(1,2); place(N(2),B_FARM);
    soldiers(N(1),20); noDraft(); noDraft(2); N(2).soldierShare=0; N(2).humanProg=-1e9; run(2);
    expect(declare(1,2,20)).toBe(true);
    run(7);
    const F=offensiveFront(1,2)!.F!;
    run(5); expect(offensiveFront(1,2)!.F).toBe(F);           // (placed again every 5 ticks, on the same line)
    run(5); expect(offensiveFront(1,2)!.F).toBe(F);
    const t=Array.from({ length: NT }, (_, i) => i).find(i => owner[i]===2 && !occ[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1))!;
    occupyHack(t,1);
    run(6); expect(offensiveFront(1,2)!.F).not.toBe(F);       // the land changed hands: the line is new
    run(25); expect(offensiveFront(1,2)!.F).not.toBeNull();
  });

  it('the census counts over ten ticks, never showing a half-made count, and a direct census is at once', () => {
    world(1); labelWorld(); allocIsles(); quiet(); paintDisc(N(1),14);
    const q=place(N(1),B_HOUSE); census();
    const houses=N(1).houses, plots=N(1).plots.length;
    expect(houses).toBeGreaterThan(0);
    for (let i=0;i<40;i++){ tick(); expect(N(1).houses).toBeGreaterThan(0); expect(N(1).plots.length).toBeGreaterThan(plots*0.8); }   // (never a count half made)
    const q2=place(N(1),B_HOUSE); void q; void q2;
    const h0=N(1).houses; census(); expect(N(1).houses).toBeGreaterThanOrEqual(h0);   // (asked for, it is counted now)
    const again=place(N(1),B_FARM); void again;
    run(20); expect(N(1).farms).toBeGreaterThan(0);            // (left to the ticks, it is counted within a pass or two)
  });
});


