// War: diplomacy, raids, attacks, fighting, peace, and the fall of a kingdom.
// Most of these play on a flat all-grass map, so distances and borders are predictable.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, T_GRASS, B_HOUSE, B_FARM, B_TOWER, B_BARRACKS, B_RUINS } from '../src/core/constants';
import { W, owner, occ, isLand, terr, resType, resLeft, pBuild, pType, pOwner, pBurn, pCenter, type Human, type Nation } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen, on } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { build, plotProblem, structureOf, togglePriority, finishHouse } from '../src/sim/buildings';
import { H_SOLDIER, H_VILLAGER, TASK_STORE, SOLDIER_HP, VILLAGER_HP, HOME_PACE, makeHuman, doorOf, switching, pace } from '../src/sim/population';
import { UNIT_SIZE, buildUnits, station, unitAt } from '../src/sim/army';
import { allied, atWar, available, ready, declare, intercept, interceptProblem, warProblem, routeOpen, mayStand, endWar, makePeace, LOOT_GOLD, MAX_ALLIES, HIT_DMG, MILITIA_DMG, DANGER_R, MOB, REVENGE_DMG, REVENGE_PACE, spread } from '../src/sim/war';

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
const quiet = () => listen({ warBegan(){}, armyHome(){}, armyGone(){}, peaceOffered(){}, peaceRefused(){}, peaceMade(){}, allied(){}, allyRefused(){}, allianceBroken(){}, annexed(){}, plunder(){}, hit(){}, bldHit(){} });

describe('clicking another kingdom', () => {
  it('no longer takes its land: gold only settles unclaimed ground', () => {
    world(1); paintToward(1,2);
    const t=Array.from({ length: NT }, (_, i) => i).find(i => owner[i]===2 && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1))!;
    const tiles=N(2).tiles, gold=N(1).gold;
    queueCommand({ type:'attack', nation:1, tile:t, ratio:1 }); run(30);
    expect(N(2).tiles).toBe(tiles);
    expect(W.attacks.filter(A => A.def===2)).toHaveLength(0);
    expect(N(1).gold).toBeGreaterThan(gold);   // nothing spent
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

  it('are broken by declaring war on the ally', () => {
    world(1); quiet(); paintToward(1,2);
    queueCommand({ type:'ally', nation:1, target:2 }); tick();
    expect(allied(1,2)).toBe(true);
    soldiers(N(1),3);
    queueCommand({ type:'war', nation:1, target:2, raid:false, soldiers:3 }); tick();
    expect(allied(1,2)).toBe(false);
    expect(atWar(1,2)).toBe(true);
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
    expect(atWar(1,2)).toBe(true);
    until(() => blows.length>5, 3000);
  });

  it('an attack takes the ground it marches over, and breaking the castle annexes the kingdom: land, buildings and people, but not its gold or goods', () => {
    world(1); quiet(); paintDisc(N(2),14); paintToward(1,2);
    const house=place(N(2),B_HOUSE,N(1).capTile);   // on the far side, away from the fighting
    // four of its people are inside the castle when it falls
    const people: Human[]=[];
    for (let i=0;i<4;i++){ const [x,y]=doorOf(N(2)); const v=makeHuman(N(2),H_VILLAGER,x,y); v.task=TASK_STORE; v.wait=1e9; W.humans.push(v); people.push(v); }
    N(2).gold=500; N(2).stock=[9,9,9]; N(1).stock=[3,4,5];
    const theirLand=Array.from({ length: NT }, (_, i) => i).filter(i => owner[i]===2);
    soldiers(N(1),30);
    const annexed=collect('annexed');
    queueCommand({ type:'war', nation:1, target:2, raid:false, soldiers:30 }); tick();
    // marching in, the army occupies land before it reaches the castle; it stays theirs until the end
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
    const c=W.campaigns[0];
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
    const gold0=N(1).gold;
    until(() => !W.campaigns.includes(c), 4000);
    expect(plunder.length).toBeGreaterThan(0);
    expect(plunder.every(p => p[0]===1 && p[3]===LOOT_GOLD)).toBe(true);
    expect(N(1).gold-gold0).toBeGreaterThanOrEqual(plunder.length*LOOT_GOLD);
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
    run(50);
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
    expect(declare(2,1,false,4)).toBe(true); tick();
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
    const began=collect('warBegan'), annexed=collect('annexed');
    run(9500);   // armies big enough to break a castle take a while to raise
    expect(began.some(b => b[2])).toBe(true);    // raids
    expect(began.some(b => !b[2])).toBe(true);   // and attacks
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
    expect(died[0].slice(2)).toEqual([1, s0.id, 1, 1]);   // kingdom, who, a soldier, of tier 1
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
  it('leaves occupied land with its owner, hatched as the occupier\'s; nobody builds there; at peace the occupier keeps it', () => {
    invaded(8,30);
    const held=Array.from({ length: NT }, (_, t) => t).filter(t => occ[t]===2);
    expect(held.every(t => owner[t]===1)).toBe(true);
    const centre=held.find(t => (t%TW&3)===2 && (((t/TW)|0)&3)===2);
    if (centre!==undefined){ const q=((centre/TW|0)>>2)*PW+((centre%TW)>>2); N(1).stock=[50,50,50]; expect(plotProblem(N(1),q)).toMatch(/enemy holds/); }
    makePeace(1,2);
    for (const t of held) if (occ[t]===0 && owner[t]===2) continue; else expect([owner[t], occ[t]]).toEqual([2, 0]);
    expect(W.occCount[1*W.M+2]).toBe(0);
    expect(atWar(1,2)).toBe(false);
  });

  it('keeps the war going when the attacking army is gone; the defenders take their land back and are ready to counter-attack', () => {
    const c=invaded(8,30);
    for (const id of c.members) W.humans.find(h => h.id===id)!.hp=0;
    N(2).soldierShare=0;   // and it raises no more
    tick(); tick();
    expect(W.campaigns.includes(c)).toBe(false);
    expect(atWar(1,2)).toBe(true);   // the war is not over
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

  it('sends the idle soldiers to form a line where an enemy army is about to cross the border', () => {
    world(1); quiet(); paintToward(1,2);
    const guard=soldiers(N(1),6);
    soldiers(N(2),6); run(1);
    expect(declare(2,1,false,6)).toBe(true);
    const c=W.campaigns[0];
    const dist=() => guard.reduce((a,h) => a+Math.hypot(h.x-c.bx,h.y-c.by),0)/guard.length;
    const d0=dist();
    run(150);
    expect(dist()).toBeLessThan(d0);
    for (const h of guard) if (W.humans.includes(h)) expect(owner[(((h.y/2)|0)*TW+((h.x/2)|0))]).toBe(1);   // without leaving home
  });
});

describe('intercepting', () => {
  it('sends soldiers after an enemy army, once, and brings them home when it is gone', () => {
    world(1); quiet(); paintToward(1,2);
    soldiers(N(1),8); soldiers(N(2),6); run(1);
    expect(declare(2,1,false,6)).toBe(true);
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
