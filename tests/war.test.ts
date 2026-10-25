// War: diplomacy, raids, attacks, fighting, peace, and the fall of a kingdom.
// Most of these play on a flat all-grass map, so distances and borders are predictable.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, T_GRASS, B_HOUSE, B_FARM, B_TOWER, B_BARRACKS, B_RUINS } from '../src/core/constants';
import { W, owner, isLand, terr, resType, resLeft, pBuild, pType, pOwner, pBurn, type Human, type Nation } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen, on } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { build, plotProblem, structureOf, togglePriority, finishHouse } from '../src/sim/buildings';
import { H_SOLDIER, H_VILLAGER, TASK_STORE, makeHuman, doorOf, switching } from '../src/sim/population';
import { allied, atWar, available, declare, warProblem, routeOpen, mayStand, endWar, LOOT_GOLD, MAX_ALLIES } from '../src/sim/war';

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
/** k soldiers of nation n standing at its capital door. */
function soldiers(n: Nation, k: number){
  const [x,y]=doorOf(n), out: Human[]=[];
  for (let i=0;i<k;i++){ const h=makeHuman(n,H_SOLDIER,x+(i%5)-2,y+((i/5)|0)*0.5); W.humans.push(h); out.push(h); }
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
  it('sends idle soldiers first, then watchtower guards, and leaves the rest at home', () => {
    world(1); quiet();
    const men=soldiers(N(1),5), tower=place(N(1),B_TOWER); place(N(2),B_FARM);
    men[0].post=tower; men[1].post=tower;   // two of them on guard
    const pool=available(N(1));
    expect(pool.idle.map(h => h.id)).toEqual(men.slice(2).map(h => h.id));
    expect(pool.all.map(h => h.id)).toEqual([...men.slice(2), ...men.slice(0,2)].map(h => h.id));
    expect(declare(1,2,true,4)).toBe(true);
    const c=W.campaigns[0];
    expect(men.filter(h => h.war===c.id).map(h => h.id).sort()).toEqual([men[0],men[2],men[3],men[4]].map(h => h.id).sort());
    expect(men[0].post).toBe(-1);         // the guard who went
    expect(men[1].post).toBe(tower);      // and the one who stayed
    expect(men[1].war).toBe(-1);
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
    expect(mine[0].hp).toBe(10);
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
    // marching in, the army takes land before it reaches the castle
    until(() => theirLand.some(t => owner[t]===1), 2000);
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
    world(1); quiet();
    for (const t of [B_FARM, B_FARM, B_HOUSE, B_HOUSE, B_FARM]) place(N(2),t);
    const men=soldiers(N(1),6);
    const plunder=collect('plunder');
    queueCommand({ type:'war', nation:1, target:2, raid:true, soldiers:6 }); tick();
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

describe('bots at war', () => {
  it('declare wars and raids, take land, and annex one another in a long match', () => {
    newWorld(987654321);
    outer: for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){ if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue; if (startMatch((TH/2+dy*3)*TW+TW/2+dx*3, 9)) break outer; }
    quiet();
    const began=collect('warBegan'), annexed=collect('annexed');
    run(7000);
    expect(began.some(b => b[2])).toBe(true);    // raids
    expect(began.some(b => !b[2])).toBe(true);   // and attacks
    expect(annexed.length).toBeGreaterThan(0);
  });
});
