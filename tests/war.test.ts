// War: diplomacy, raids, attacks, fighting, peace, and the fall of a kingdom.
// Most of these play on a flat all-grass map, so distances and borders are predictable.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, WAGE, T_GRASS, B_HOUSE, B_FARM, B_TOWER, B_BARRACKS, B_RUINS } from '../src/core/constants';
import { W, owner, occ, isLand, terr, resType, resLeft, pBuild, pType, pOwner, pBurn, pCenter, pHp, type Human, type Nation } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick, grossIncome } from '../src/sim/sim';
import { listen, on } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { build, plotProblem, structureOf, togglePriority, finishHouse } from '../src/sim/buildings';
import { H_SOLDIER, H_VILLAGER, TASK_STORE, TASK_TO_TRAIN, TASK_INSIDE, MILITIA_HP, SOLDIER_HP, VILLAGER_HP, HOME_PACE, makeHuman, doorOf, switching, pace, maxHp } from '../src/sim/population';
import { UNIT_SIZE, buildUnits, station, unitAt, SOLDIER_DMG } from '../src/sim/army';
import { wallOf, walledFor } from '../src/sim/defense';
import { allied, atWar, available, ready, declare, intercept, interceptProblem, warProblem, routeOpen, mayStand, endWar, makePeace, LOOT_GOLD, MAX_ALLIES, HIT_DMG, MILITIA_DMG, DANGER_R, MOB, REVENGE_DMG, REVENGE_PACE, spread,
  RANKS, rankFor, stalled, inCrisis, escalate, deescalate, deescalateProblem, defend, callReserves, reservesOf, reservesProblem, menOn, M_MARCH, M_HOLD, M_ASSAULT, F_GATHER, F_READY, F_PUSH, F_HOLD, setOffensive, offensiveProblem, offensiveFront, ADVANCE_TICKS, DENSE, PRESENT, GATHER_AT, ZOC } from '../src/sim/war';
import { MIN_GAP, RANK_GAP, A_OFF, holds, freeOf, underCastle } from '../src/sim/front';
import { beggarProblem, stuck } from '../src/sim/bots';
import { MILITIA_HIT } from '../src/sim/army';
import { R_HOUSING } from '../src/sim/research';

const N = (i: number) => W.nations[i];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
/** Ticks until `done` holds; fails after `max`. */
function until(done: () => boolean, max: number){ for (let i=0;i<max;i++){ if (done()) return i; tick(); } throw new Error('timed out'); }

/** A flat, all-grass, empty map with the player in the middle and `rivals` bots that never think. */
function world(rivals: number, seed=7){
  newWorld(seed);
  isLand.fill(1); terr.fill(T_GRASS); resType.fill(0); resLeft.fill(0); pBuild.fill(1);
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
  n.stock=[...structureOf(type)!.cost];
  if (!build(n,q,type)) throw new Error('could not build');
  return q;
}
function collect<K extends keyof typeof on>(name: K){
  const got: Parameters<(typeof on)[K]>[]=[];
  listen({ [name]: (...a: never[]) => { got.push(a as never); } } as never);
  return got;
}
/** Kingdom a's offensive against d: waits for its armies to gather on the border, then gives the word to attack. */
function giveWord(a: number, d: number, max=3000){
  until(() => W.offensive[a*W.M+d]===F_READY, max);
  queueCommand({ type:'offensive', nation:a, target:d, go:true }); tick();
  expect(W.offensive[a*W.M+d]).toBe(F_PUSH);
}
/** Kingdom a's raid on d: waits for it to reach d's border, then sends it in. */
function sendRaid(a: number, d: number, max=3000){
  const c=W.campaigns.find(k => k.a===a && k.d===d && k.raid)!;
  until(() => c.mode===M_HOLD, max);
  queueCommand({ type:'offensive', nation:a, target:d, go:true }); tick();
  return c;
}
/** Kingdom o raises no more soldiers: nobody left to sign up, and the wages paid. */
const noDraft = (o=1) => { W.humans=W.humans.filter(h => h.o!==o || h.kind===H_SOLDIER); N(o).soldierShare=1; N(o).humanProg=-1e9; N(o).gold=1e6; };
const quiet = () => listen({ warBegan(){}, armyHome(){}, armyGone(){}, peaceOffered(){}, peaceRefused(){}, peaceMade(){}, allied(){}, allyRefused(){}, allianceBroken(){}, annexed(){}, plunder(){}, hit(){}, bldHit(){} });

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
    const h=soldiers(N(1),1)[0]; place(N(3),B_FARM);
    expect(mayStand(h,2)).toBe(false);
    expect(declare(1,3,true,1)).toBe(true); tick();
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
    soldiers(N(1),2); place(N(2),B_FARM);
    expect(declare(1,2,true,2)).toBe(true); tick();
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
    queueCommand({ type:'war', nation:1, target:2, raid:false, soldiers:3 }); tick();
    expect(allied(1,2)).toBe(false);
    expect(inCrisis(1,2)).toBe(true);   // a crisis, not yet a war
    expect(atWar(1,2)).toBe(false);
  });
});

describe('declaring war', () => {
  it('sends each barracks\' army on its own; soldiers without room in a barracks stay home', () => {
    world(1); quiet(); paintDisc(N(1),14); place(N(2),B_FARM);
    const a=place(N(1),B_BARRACKS), b=place(N(1),B_BARRACKS,pCenter[a]);   // two barracks far apart
    const men=soldiers(N(1),12,false); N(1).soldierShare=1; tick();
    const pool=available(N(1));
    expect(pool.map(p => p.men.length)).toEqual([5,5]);
    const patrol=men.filter(h => h.base<0);
    expect(patrol).toHaveLength(2);       // no room for them: they patrol the city
    expect(declare(1,2,true,[a,b])).toBe(true);
    const [c1,c2]=W.campaigns;
    expect(W.campaigns).toHaveLength(2);  // two armies, marching separately
    expect([c1.members.length,c2.members.length]).toEqual([5,5]);
    expect(Math.hypot(c1.bx-c2.bx,c1.by-c2.by)).toBeGreaterThan(16);   // each forms up at its own barracks
    expect(patrol.every(h => h.war===-1)).toBe(true);
    expect(available(N(1))).toHaveLength(0);
  });

  it('asked for a number of soldiers, sends the biggest armies first; joined barracks make one bigger army', () => {
    world(1); quiet(); place(N(2),B_FARM);
    soldiers(N(1),10);                    // two modules side by side: one army of 10
    expect(available(N(1)).map(p => [p.men.length,p.unit.cap])).toEqual([[10,10]]);
    expect(declare(1,2,true,7)).toBe(true);
    expect(W.campaigns).toHaveLength(1);
    expect(W.campaigns[0].members).toHaveLength(7);
  });

  it('needs a shared border to attack, but can raid across unclaimed land', () => {
    world(1); quiet();
    soldiers(N(1),3); place(N(2),B_FARM);
    expect(warProblem(1,2,false)).toMatch(/shared border/i);
    expect(warProblem(1,2,true)).toBeNull();
    paintToward(1,2);
    expect(warProblem(1,2,false)).toBeNull();
  });

  it('keeps soldiers on campaign out of training and off watchtower guard', () => {
    world(1); quiet();
    place(N(1),B_BARRACKS); place(N(2),B_FARM);
    const men=soldiers(N(1),4);
    const tower=place(N(1),B_TOWER); togglePriority(N(1),tower);
    expect(declare(1,2,true,4)).toBe(true);
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
    queueCommand({ type:'war', nation:1, target:2, raid:false, soldiers:6 }); tick();
    expect(atWar(1,2)).toBe(false);   // massing on the border is a crisis: nobody fights yet
    giveWord(1,2);
    expect(atWar(1,2)).toBe(true);
    until(() => blows.length>5, 3000);
  });

  it('an attack takes the ground before its front, and breaking the castle annexes the kingdom: land, buildings and people, but not its gold or goods', () => {
    world(1); quiet(); paintDisc(N(2),14); paintToward(1,2);
    const house=place(N(2),B_HOUSE,N(1).capTile);   // on the far side, away from the fighting
    // four of its people are inside the castle when it falls
    const people: Human[]=[];
    for (let i=0;i<4;i++){ const [x,y]=doorOf(N(2)); const v=makeHuman(N(2),H_VILLAGER,x,y); v.task=TASK_STORE; v.wait=1e9; W.humans.push(v); people.push(v); }
    N(2).gold=500; N(2).stock=[9,9,9]; N(1).stock=[3,4,5]; N(2).soldierShare=0;   // (they stay villagers, with no barracks to make them militia)
    const theirLand=Array.from({ length: NT }, (_, i) => i).filter(i => owner[i]===2);
    soldiers(N(1),30);
    const annexed=collect('annexed');
    queueCommand({ type:'war', nation:1, target:2, raid:false, soldiers:30 }); tick();
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

  it('a raid burns buildings for loot, keeps at it until recalled, and pays 50 gold for each bag brought home', () => {
    world(1); quiet(); paintDisc(N(2),26);
    // the farmsteads out on the edge, beyond the castle's arrows
    for (const t of [B_FARM, B_FARM, B_HOUSE, B_HOUSE, B_FARM]) place(N(2),t,N(1).capTile);
    const men=soldiers(N(1),10);
    const plunder=collect('plunder');
    queueCommand({ type:'war', nation:1, target:2, raid:true, soldiers:10 }); tick();
    const c=sendRaid(1,2);
    until(() => men.some(h => h.loot), 4000);
    // it goes on raiding while it is not recalled
    const burnt=() => Array.from({ length: NP }, (_, q) => q).filter(q => (pBurn[q]>0 && pOwner[q]===2) || pType[q]===B_RUINS).length;
    const b0=burnt();
    until(() => burnt()>b0, 2000);
    expect(c.phase).toBe(1);
    const bags=men.filter(h => h.loot && W.humans.includes(h)).length;
    expect(bags).toBeGreaterThan(0);
    queueCommand({ type:'endWar', nation:1, target:2 }); tick();
    expect(c.phase).toBe(2);
    const gold0=N(1).gold, t0=W.tickN;
    until(() => !W.campaigns.includes(c), 4000);
    expect(plunder.length).toBeGreaterThan(0);
    expect(plunder.every(p => p[0]===1 && p[3]===LOOT_GOLD)).toBe(true);
    expect(N(1).gold-gold0).toBeGreaterThanOrEqual(plunder.length*LOOT_GOLD-(W.tickN-t0)*0.1*WAGE*men.length);   // (less the wages paid meanwhile)
    expect(men.filter(h => W.humans.includes(h)).every(h => !h.loot && h.war===-1)).toBe(true);
    expect(atWar(1,2)).toBe(false);   // home again, the raid is over
  });

  it('a raid is called off when other kingdoms close every way through; an alliance opens one', () => {
    world(2); quiet();
    place(N(2),B_FARM);
    // kingdom 3 walls kingdom 2 in, all but a gap
    const c2=N(2).capTile, cx=c2%TW, cy=(c2/TW)|0, R=12, gap: number[]=[];
    for (let y=cy-R;y<=cy+R;y++) for (let x=cx-R;x<=cx+R;x++){
      if (Math.max(Math.abs(x-cx),Math.abs(y-cy))<R-1) continue;
      const t=y*TW+x; if (owner[t]) continue;
      if (y===cy && x<cx) { gap.push(t); continue; }
      if (Math.abs(y-cy)<=1 && x<cx) { gap.push(t); continue; }
      setOwner(t,3);
    }
    census();
    soldiers(N(1),4);
    expect(routeOpen(1,2)).toBe(true);
    const home=collect('armyHome');
    queueCommand({ type:'war', nation:1, target:2, raid:true, soldiers:4 }); tick();
    expect(W.campaigns).toHaveLength(1);
    for (const t of gap) setOwner(t,3);   // the gap closes while the raiders muster
    until(() => home.length>0, 100);
    expect(home[0]).toEqual([1,2,true,'cut']);
    expect(warProblem(1,2,true)).toMatch(/block/);
    // with 3 as an ally its land is open
    queueCommand({ type:'ally', nation:1, target:3 }); tick();
    expect(allied(1,3)).toBe(true);
    expect(routeOpen(1,2)).toBe(true);
  });
});

describe('peace', () => {
  it('a kingdom in trouble accepts a peace offer; the armies go home without fighting', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),20);
    queueCommand({ type:'war', nation:1, target:2, raid:false, soldiers:20 }); tick();
    escalate(1,2); run(50);
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
    queueCommand({ type:'war', nation:1, target:2, raid:false, soldiers:3 }); tick();
    escalate(1,2);
    const refused=collect('peaceRefused');
    endWar(1,2);
    N(2).nextThink=0; N(2).nextWar=1e9; tick();
    expect(refused).toEqual([[1,2]]);
    expect(atWar(1,2)).toBe(true);
  });

  it('the player accepts a bot\'s offer from the war chip', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(2),5); run(1);
    expect(declare(2,1,false,5)).toBe(true); tick();
    W.offers[2*W.M+1]=W.tickN;
    queueCommand({ type:'peace', nation:1, target:2 }); tick();
    expect(atWar(1,2)).toBe(false);
  });

  it('a raid recalled with nothing else going on just ends', () => {
    world(1); quiet();
    place(N(2),B_FARM);
    soldiers(N(1),3);
    expect(declare(1,2,true,3)).toBe(true); tick();
    endWar(1,2); tick();
    expect(W.offers[1*W.M+2]).toBe(0);   // no peace offer needed: we are only raiding
    until(() => !W.campaigns.length, 2000);
    expect(atWar(1,2)).toBe(false);
  });
});

describe('raids have no peace', () => {
  it('neither side can offer peace; recalled raiders stay the enemy until home, and can be intercepted on the way', () => {
    world(1); quiet(); paintDisc(N(2),26);
    for (const t of [B_FARM, B_FARM, B_HOUSE]) place(N(2),t,N(1).capTile);
    soldiers(N(1),6);
    expect(declare(1,2,true,6)).toBe(true);
    const c=W.campaigns[0];
    until(() => c.phase===1, 2000); run(60);
    endWar(2,1); tick();                           // the raided kingdom asks for peace: there is none to make
    expect(W.offers[2*W.M+1]).toBe(0);
    expect(c.phase).toBe(1);
    queueCommand({ type:'endWar', nation:1, target:2 }); tick();
    expect(c.phase).toBe(2);                       // recalled: off home at once...
    expect(W.offers[1*W.M+2]).toBe(0);
    expect(c.hostile).toBe(true);                  // ...but still the enemy
    expect(atWar(1,2)).toBe(true);
    soldiers(N(2),8); tick();
    expect(interceptProblem(2,c.id)).toBeNull();
    expect(intercept(2,c.id,8)).toBe(true);
    const I=W.campaigns.find(k => k.a===2)!;
    until(() => !W.campaigns.includes(c), 4000);   // the raiders are home or dead
    until(() => !W.campaigns.includes(I) || !I.hostile, 50);
    expect(I.hostile).toBe(false);                 // the chase is over, and so is the raid
    until(() => !atWar(1,2), 3000);
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
    expect(declare(2,1,false,4)).toBe(true); escalate(2,1); tick();
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
  it('declare wars and raids, take land, and annex one another in a long match', () => {
    newWorld(987654321);
    outer: for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){ if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue; if (startMatch((TH/2+dy*3)*TW+TW/2+dx*3, 9)) break outer; }
    quiet();
    const began=collect('warBegan'), crises=collect('crisis'), wars=collect('escalated'), annexed=collect('annexed');
    run(18000);   // armies big enough to break a castle take a while to raise (half an hour, living on tax)
    expect(began.some(b => b[2])).toBe(true);    // raids
    expect(crises.length).toBeGreaterThan(0);    // attacks: massed on a border...
    expect(wars.length).toBeGreaterThan(0);      // ...and then war
    expect(annexed.length).toBeGreaterThan(0);
  });
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
    expect(declare(2,1,true,1)).toBe(true);
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
    expect(declare(2,1,false,k)).toBe(true);
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
    for (let y=cy;y<cy+3;y++) for (let x=cx-1;x<cx+2;x++){ const t=y*TW+x; expect([owner[t], occ[t]]).toEqual([1, 0]); occ[t]=2; W.occCount[1*W.M+2]++; pocket.push(t); }
    makePeace(1,2);
    for (const t of joined) expect(owner[t]).toBe(2);
    for (const t of pocket) expect([owner[t], occ[t]]).toEqual([1, 0]);
    expect(W.occCount[1*W.M+2]).toBe(0);
  });

  it('doesn\'t burn what stands on the ground it occupies: the army has to break it', () => {
    world(1); quiet(); paintToward(1,2); paintDisc(N(1),28);
    soldiers(N(2),10); run(1);
    expect(declare(2,1,false,10)).toBe(true);
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
    queueCommand({ type:'war', nation:1, target:2, raid:false, soldiers:10 }); tick();
    expect(W.ready[1*W.M+2]).toBe(0);
    const k=W.campaigns.find(k => k.a===1 && k.d===2 && !k.raid && k.target<0)!;
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
    expect(declare(1,2,false,5)).toBe(true);
    expect(W.campaigns[0].inspired).toBe(false);
    expect(told).toHaveLength(0);
  });

  it('sends the soldiers at home to man their side of the front, on their own land', () => {
    world(1); quiet(); paintToward(1,2);
    const guard=soldiers(N(1),6);
    soldiers(N(2),6); run(1);
    expect(declare(2,1,false,6)).toBe(true);
    until(() => guard.filter(h => h.fk===2*W.M+1 && Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT*2).length>=4, 600);   // (a longer walk from a bigger kingdom)
    const F=offensiveFront(2,1)!.F!;
    for (const h of guard.filter(h => W.humans.includes(h))){   // (one may have fallen already)
      expect(h.fk).toBe(2*W.M+1);
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
    expect(declare(1,2,false,k)).toBe(true);
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
    expect(declare(1,2,false,5)).toBe(true);
    expect([W.campaigns[0].leader, W.campaigns[0].rank]).toEqual([-1,0]);
    const orders=collect('order');
    const { c, men }=attack(20);
    expect(c.rank).toBe(2);   // a general
    expect(c.leader).toBe(Math.min(...men.map(h => h.id)));   // all tier 1: the longest serving
    expect(orders.map(o => [o[0],o[3],o[4]])).toEqual([['march',2,c.leader]]);
    world(1); quiet(); paintToward(1,2);
    const six=soldiers(N(1),6); six[4].tier=2; run(1);
    expect(declare(1,2,false,6)).toBe(true);
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
    until(() => fresh.every(h => h.fk===1*W.M+2 && Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT), 1500);
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
    expect(declare(1,2,false,30)).toBe(true);
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
    expect(declare(1,2,false,30)).toBe(true);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    const S=offensiveFront(1,2)!, lines=new Map<number, number>();
    for (const h of W.humans) if (h.o===1 && h.fk===1*W.M+2 && h.line>=0) lines.set(h.line,(lines.get(h.line) ?? 0)+1);
    expect(S.k).toBe(Math.round(S.F!.len/MIN_GAP));
    expect(lines.get(0)).toBe(S.k);
    expect(lines.size).toBeGreaterThan(2);               // two ranks of reserves at least
    // each behind the man he backs up, no nearer the line than him
    const off=(x: number, y: number) => Math.min(...S.F!.tiles.map(t => Math.hypot(t%TW+0.5-x/2, ((t/TW)|0)+0.5-y/2)));
    for (const h of W.humans) if (h.o===1 && h.fk===1*W.M+2 && h.line>=1){
      const front=W.humans.find(e => e.o===1 && e.line===0 && e.slot===h.slot)!;
      expect(off(h.fx,h.fy)).toBeGreaterThanOrEqual(off(front.fx,front.fy)-0.25);
      if (h.line===1) expect(off(h.fx,h.fy)).toBeGreaterThan(off(front.fx,front.fy)+RANK_GAP*0.5);   // the first rank behind, a rank back
    }
  });

  it('gathers, then waits for the word: nothing is taken before it; bots give it at once', () => {
    split(0);
    soldiers(N(1),20); noDraft(); noDraft(2);
    expect(declare(1,2,false,20)).toBe(true);
    expect(W.offensive[1*W.M+2]).toBe(F_GATHER);
    expect(offensiveProblem(1,2,false)).toMatch(/No offensive/);
    until(() => W.offensive[1*W.M+2]===F_READY, 3000);
    const placed=W.humans.filter(h => h.o===1 && h.war>=0 && h.id!==W.campaigns[0].leader);
    expect(placed.filter(h => Math.hypot(h.x-h.fx,h.y-h.fy)<=PRESENT).length).toBeGreaterThanOrEqual(Math.ceil(placed.length*GATHER_AT));
    run(300);
    expect([W.offensive[1*W.M+2], W.occCount[2*W.M+1]]).toEqual([F_READY, 0]);
    expect(offensiveProblem(1,2,true)).toBeNull();
    queueCommand({ type:'offensive', nation:1, target:2, go:true }); tick();
    expect(W.offensive[1*W.M+2]).toBe(F_PUSH);
    run(50);
    expect(W.occCount[2*W.M+1]).toBeGreaterThan(100);
    // a bot's army goes in as soon as it is ready
    split(0);
    soldiers(N(2),20); noDraft(); noDraft(2);
    expect(declare(2,1,false,20)).toBe(true);
    until(() => W.offensive[2*W.M+1]===F_PUSH, 3000);
  });

  for (const deg of [0, 25, 45]) it(`pushes on a strip a second all along the line, keeping it straight and missing nothing (border ${deg}° off the vertical)`, () => {
    const b=split(deg);
    soldiers(N(1),48); noDraft(); noDraft(2);
    expect(declare(1,2,false,48)).toBe(true);
    giveWord(1,2);
    const start=lineAt(b);
    run(200);   // 20 s
    const now=lineAt(b), cos=Math.cos(deg*Math.PI/180);
    const advance=now.reduce((a,x,i) => a+(x-start[i]),0)/now.length*cos;   // along the normal
    expect(advance).toBeGreaterThan(20*ADVANCE_TICKS/10*0.75);
    expect(advance).toBeLessThan(20*ADVANCE_TICKS/10*1.4);
    expect(crooked(now,b)).toBeLessThanOrEqual(3);
    expect(missed(b)).toBe(0);
  });

  it('pushes slower the thinner its line: a man every DENSE tiles or closer at full speed', () => {
    const pace=(n: number) => {
      const b=split(0); soldiers(N(1),n); noDraft(); noDraft(2);
      expect(declare(1,2,false,n)).toBe(true);
      giveWord(1,2);
      const start=lineAt(b); run(300);
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
    expect(declare(1,2,false,30)).toBe(true);
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
    run(60);
    expect(W.occCount[2*W.M+1]).toBeGreaterThan(held+500);
  });

  it('takes no more ground than its men stand on: the occupation ends a tile or two before its front rank', () => {
    const b=split(0);
    soldiers(N(1),40); noDraft(); run(1);
    expect(declare(1,2,false,40)).toBe(true);
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
    expect(worst).toBeLessThanOrEqual(1.2);   // tiles from a man in his place to the edge of what his side holds before him
  });

  it('can\'t take what a defender on the line holds; once he falls, the gap fills and the line comes even again', () => {
    const b=split(0);
    soldiers(N(1),40); noDraft(); noDraft(2);
    // one defender who can't be beaten, standing on their side of the border, in the middle
    const mid=(b.y0+b.y1)>>1, edge=lineAt(b)[mid-b.y0-3]+1, [d]=soldiers(N(2),1,false);
    d.x=(edge+ZOC+1)*2+1; d.y=mid*2+1; d.sp=0; d.militia=true;   // (a militiaman holds his ground like anyone)
    expect(declare(1,2,false,40)).toBe(true);
    giveWord(1,2);
    for (let i=0;i<200;i++){ d.hp=1e6; tick(); }
    // the ground round him is still theirs, while the line has gone on either side
    const t=((d.y/2)|0)*TW+((d.x/2)|0);
    for (let dy=-ZOC;dy<=ZOC;dy++) for (let dx=-ZOC;dx<=ZOC;dx++) expect(freeOf(2,t+dy*TW+dx)).toBe(true);
    expect(Math.min(...lineAt(b))).toBeGreaterThan(edge+10);
    d.hp=0; run(150);
    expect(missed(b)).toBe(0);
    expect(crooked(lineAt(b),b)).toBeLessThanOrEqual(4);
  });

  it('a man of the front rank who falls is replaced by the one behind him', () => {
    world(1,11); quiet(); paintToward(1,2);   // (a front whose slots stay put while he falls: where the line is laid out again just then, the gap goes to whoever is nearest)
    soldiers(N(1),30); noDraft(); N(2).soldierShare=0;
    expect(declare(1,2,false,30)).toBe(true);
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
    expect(declare(1,2,false,40)).toBe(true);
    giveWord(1,2); run(150);
    // a patch behind the line, theirs again, cut off from the rest of their land
    const y=(b.y0+b.y1)>>1, x=lineAt(b)[y-b.y0-3]-8, patch: number[]=[];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const t=(y+dy)*TW+x+dx; expect(occ[t]).toBe(1); occ[t]=0; W.occCount[2*W.M+1]--; patch.push(t); }
    run(25);
    for (const t of patch) expect(occ[t]).toBe(1);
  });

  it('stays quick with a hundred men a side fighting along a long front', () => {
    split(0);
    soldiers(N(1),100); soldiers(N(2),100); noDraft(); noDraft(2); run(1);
    expect(declare(1,2,false,100)).toBe(true);
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
    expect(declare(1,2,false,10)).toBe(true);
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

describe('intercepting', () => {
  it('sends soldiers after raiders, once, and brings them home when they are gone; an attack is met on the front instead', () => {
    world(1); quiet(); paintToward(1,2); place(N(1),B_FARM,N(2).capTile);
    soldiers(N(1),8); soldiers(N(2),6); run(1);
    expect(declare(2,1,true,6)).toBe(true);
    noDraft(2);   // (no reinforcements for it)
    const E=W.campaigns[0], blows=collect('hit');
    queueCommand({ type:'intercept', nation:1, campaign:E.id, soldiers:6 }); tick();
    const I=W.campaigns.find(c => c.a===1)!;
    expect(I.target).toBe(E.id);
    expect(I.members).toHaveLength(6);
    expect(ready(N(1))).toBe(2);
    expect(interceptProblem(1,E.id)).toMatch(/already/);
    expect(intercept(1,E.id,2)).toBe(false);
    until(() => !W.campaigns.includes(E) || E.phase===2, 4000);
    expect(blows.length).toBeGreaterThan(0);
    until(() => !W.campaigns.includes(I), 3000);   // its job done, the rest come home
    // an attacking army can't be intercepted: armies are sent to hold the border against it instead
    soldiers(N(2),6); run(1);
    expect(declare(2,1,false,6)).toBe(true);
    const A=W.campaigns.find(c => c.a===2 && c.front)!;
    expect(interceptProblem(1,A.id)).toMatch(/border/);
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
    expect(declare(1,2,false,20)).toBe(true);
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
    expect(declare(1,2,false,10)).toBe(true);
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
    expect(declare(1,2,false,10)).toBe(true);
    expect(escalate(1,2)).toBe(true);
    expect(deescalateProblem(1,2)).toMatch(/peace/);
    expect(deescalate(1,2)).toBe(false);
  });

  it('a bot massed on a border goes to war once ready, unless far more stand against it: then it backs down', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(2),10); soldiers(N(1),30); noDraft(); noDraft(2); N(2).attackAt=0.6; run(1);
    const calm=collect('deescalated'), wars=collect('escalated');
    expect(declare(2,1,false,10)).toBe(true);
    expect(defend(1,2,30)).toBe(true);   // three times its men hold the other side
    until(() => calm.length+wars.length>0, 3000);
    expect([calm.length, wars.length]).toEqual([1, 0]);
    until(() => !W.campaigns.length, 3000);
    // a fair fight, and it goes to war
    for (const h of W.humans.filter(h => h.o===1 && h.kind===H_SOLDIER).slice(5)) h.hp=0;
    run(2);
    expect(declare(2,1,false,10)).toBe(true);
    expect(defend(1,2,5)).toBe(true);
    until(() => wars.length>0, 3000);
    expect(calm).toHaveLength(1);
    expect(W.offensive[2*M()+1]).toBe(F_PUSH);
  });

  it('at war the defender can strike back from its own front: its own land first, then theirs', () => {
    const b=split(0);
    soldiers(N(1),10); soldiers(N(2),40); noDraft(); noDraft(2); run(1);
    expect(declare(1,2,false,10)).toBe(true);
    expect(defend(2,1,40)).toBe(true);
    until(() => W.offensive[1*M()+2]===F_READY && W.offensive[2*M()+1]===F_READY, 3000);
    expect(escalate(1,2)).toBe(true);
    setOffensive(1,2,false);   // 1 holds; say it had taken a band of 2's land along the border
    const line=lineAt(b);
    for (let y=b.y0+3;y<b.y1-3;y++) for (let x=line[y-b.y0-3]+1;x<=line[y-b.y0-3]+4;x++){ const t=y*TW+x; if (owner[t]===2){ occ[t]=1; W.occCount[2*M()+1]++; } }
    const taken=W.occCount[2*M()+1];
    expect(taken).toBeGreaterThan(300);
    run(30);   // the fronts move to the new line
    expect(W.offensive[2*M()+1]).toBe(F_HOLD);
    queueCommand({ type:'offensive', nation:2, target:1, go:true }); tick();
    expect(W.offensive[2*M()+1]).toBe(F_PUSH);
    // where its land was taken it takes it back first, while elsewhere along the line it is into 1's
    let back=-1; until(() => { if (back<0 && W.occCount[2*M()+1]<taken/2) back=W.occCount[1*M()+2]; return W.occCount[2*M()+1]===0; }, 3000);
    const inBand=(t: number) => { const y=(t/TW)|0, x=t%TW; return y>=b.y0+3 && y<b.y1-3 && x>line[y-b.y0-3] && x<=line[y-b.y0-3]+4; };
    expect(Array.from({ length: NT }, (_, t) => t).some(t => inBand(t) && occ[t]===1)).toBe(false);
    until(() => W.occCount[1*M()+2]>back+500, 3000);   // ...and then on into 1's, all along
    const now=lineAt(b), mid=now.slice().sort((p,q) => p-q)[now.length>>1];
    expect(now.filter(x => Math.abs(x-mid)<=1).length).toBeGreaterThan(now.length*0.85);   // a straight line (bar where 1's men still stand their ground)
    expect(mid).toBeLessThan(Math.min(...line));   // and back past where the border was
  });
});

describe('militia', () => {
  const M = () => W.M;
  it('can go with an attack, as many as asked; calling the reserves at war then calls up the rest', () => {
    world(1); quiet(); paintToward(1,2);
    const mil=soldiers(N(1),8,false); noDraft(); run(2);   // no barracks: militia only
    expect(mil.every(h => h.militia)).toBe(true);
    expect(available(N(1))).toHaveLength(0);
    queueCommand({ type:'war', nation:1, target:2, raid:false, units:[], militia:5 }); tick();
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

  it('can go raiding, alone or beside an army', () => {
    world(1); quiet(); place(N(2),B_FARM);
    const mil=soldiers(N(1),6,false); noDraft(); run(2);
    expect(warProblem(1,2,true)).toBeNull();
    expect(declare(1,2,true,0,4)).toBe(true);
    const raid=W.campaigns.find(c => c.a===1 && c.raid)!;
    expect([raid.militia, raid.front, raid.members.length]).toEqual([true, false, 4]);
    expect(mil.filter(h => h.war===raid.id)).toHaveLength(4);
    expect(declare(1,2,true,0,0)).toBe(false);   // nobody to send
    const army=soldiers(N(1),5); run(2);   // (a full barracks, so the militia at home have no places to fill in it)
    expect(declare(1,2,true,5,2)).toBe(true);   // an army, and the last 2 militia beside it, each band on its own
    expect(army.every(h => h.war>=0 && h.war!==raid.id)).toBe(true);
    expect(mil.every(h => h.war>=0)).toBe(true);
  });

  it('stay home when the armies march, and are called up as reserves from the war bar: paid while out, home again when sent', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),10); const mil=soldiers(N(1),12,false); noDraft(); run(2);
    expect([N(1).soldiers, N(1).militia, N(1).called]).toEqual([22, 12, 0]);
    expect(mil.every(h => h.militia && h.hp===MILITIA_HP)).toBe(true);
    expect(available(N(1)).reduce((k,a) => k+a.men.length,0)).toBe(10);   // only the barracks' army can be picked to march
    expect(reservesProblem(1,2,true)).toMatch(/No crisis/);
    expect(declare(1,2,false,10)).toBe(true);
    expect(mil.every(h => h.war<0)).toBe(true);
    queueCommand({ type:'reserves', nation:1, target:2, call:true }); tick();
    const R=reservesOf(1)!;
    expect(R.militia && R.front && R.d===2).toBe(true);
    expect(R.members).toHaveLength(12);
    tick();
    expect(N(1).called).toBe(12);
    expect(N(1).income).toBeCloseTo(grossIncome(N(1))-22*WAGE, 6);   // called up, they are paid like soldiers
    until(() => mil.every(h => h.fk===1*W.M+2), 400);   // on the front with the army
    queueCommand({ type:'reserves', nation:1, target:2, call:false }); tick();
    expect(R.phase).toBe(2);
    until(() => mil.every(h => h.war<0), 2000);
    tick();
    expect(N(1).called).toBe(0);
    expect(N(1).income).toBeCloseTo(grossIncome(N(1))-10*WAGE, 6);
  });

  it('without reserves called, fill the places of fallen soldiers one at a time, and go to the front as soldiers', () => {
    world(1); quiet(); paintToward(1,2);
    const army=soldiers(N(1),10), mil=soldiers(N(1),6,false); noDraft(); run(2);
    expect(declare(1,2,false,10)).toBe(true); run(20);
    const c=W.campaigns.find(k => k.a===1 && k.front)!;
    for (const h of army.slice(0,3)) h.hp=0;
    run(2);
    let most=0;
    until(() => { most=Math.max(most, mil.filter(h => h.task===TASK_TO_TRAIN || h.task===TASK_INSIDE).length); return mil.filter(h => !h.militia).length===3; }, 3000);
    expect(most).toBe(1);   // one at a time
    expect(N(1).militia).toBe(3);
    until(() => c.members.length===10, 600);   // and they join the army at the front
  });

  it('a bot calls its militia up only when its armies on a front are badly outnumbered', () => {
    for (const [attackers, called] of [[30, true], [5, false]] as const){
      world(1); quiet(); paintToward(1,2);
      soldiers(N(2),5); soldiers(N(2),10,false); soldiers(N(1),attackers); noDraft(); noDraft(2); run(1);
      expect(declare(1,2,false,attackers)).toBe(true);
      for (let i=0;i<30;i++){ N(2).nextThink=0; tick(); }
      expect(menOn(2,1)).toBeGreaterThanOrEqual(5);   // it holds its border with its army
      expect(!!reservesOf(2)).toBe(called);
    }
  });
});

describe('beggars, militia and stalemates', () => {
  it('beggars strike no blow: they only stand in the way, and are cut down', () => {
    split(0); soldiers(N(2),10); noDraft(2); run(1);
    expect(declare(2,1,false,10)).toBe(true);
    until(() => W.offensive[2*W.M+1]!==F_GATHER, 3000);   // (a bot goes to war as soon as it is ready)
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

  it('militia have 5 hit points and strike for 1', () => {
    expect([MILITIA_HP, MILITIA_HIT]).toEqual([5, 1]);
    world(1); const [m]=soldiers(N(1),1,false); N(1).soldierShare=1; run(1);
    expect([m.militia, maxHp(m)]).toEqual([true, 5]);
  });

  it('a war whose border has stood still for minutes while one side bleeds far more is offered peace, and its front holds', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(2),20); soldiers(N(1),20); noDraft(); noDraft(2); run(1);
    expect(declare(2,1,false,20)).toBe(true); expect(escalate(2,1)).toBe(true);
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

  it('a bot with a beggar problem studies housing, spends all its goods on its builders and builds no farms; with no way out it leans to war', () => {
    world(1); const n=N(2);
    n.villagers=20; n.soldiers=4; n.beggars=3; n.homeless=6; n.tier[R_HOUSING]=1; n.nextThink=0;
    expect(beggarProblem(n)).toBe(true);
    tick();   // (it thinks before the headcount is taken again)
    expect([n.study, n.invest]).toEqual([R_HOUSING, 1]);
    n.villagers=20; n.beggars=1; n.homeless=2;
    expect(beggarProblem(n)).toBe(false);
    n.villagers=20; n.soldiers=4; n.beggars=3; n.homeless=6; n.tier[R_HOUSING]=3; n.guilds=1;
    W.contact[2*W.M]=0;   // no open land left to settle
    expect(stuck(n)).toBe(true);
  });
});

describe('story events', () => {
  it('raises a mob when the enemy reaches the castle: the villagers nearby swarm him, and the log hears of it', () => {
    world(1); quiet(); place(N(1),B_FARM);
    const [x,y]=doorOf(N(1)), folk: Human[]=[];
    for (let i=0;i<12;i++){ const v=makeHuman(N(1),H_VILLAGER,x+(i%6)*3-8,y+((i/6)|0)*3+4); W.humans.push(v); folk.push(v); }
    soldiers(N(2),1); run(1);
    expect(declare(2,1,true,1)).toBe(true);
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
    world(1); quiet(); paintToward(1,2);
    const bot=N(2); bot.nextThink=0; bot.soldierShare=0.5;
    run(400);
    expect(bot.soldierShare).toBeLessThan(0.3);            // peace: back to work
    soldiers(N(1),20); run(1);
    expect(declare(1,2,false,20)).toBe(true);
    for (let i=0;i<40;i++){ bot.nextThink=0; tick(); }
    expect(bot.soldierShare).toBeGreaterThan(0.6);        // war against a far bigger army: to arms
  });
});
