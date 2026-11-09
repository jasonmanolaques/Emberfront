// War for regions: claims and their answer, phalanxes and their orders, battles man to man, flags, and peace.
// The map is all grass, cut into square regions 40 tiles a side (10 across, 7 down), so who holds what is easy to set up.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, PW, T_GRASS, B_BARRACKS, GAME_SPEED } from '../src/core/constants';
import { W, owner, occ, isLand, terr, pBuild, pType, pOwner, pBurn, type Human, type Army } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { listen } from '../src/sim/events';
import { setOwner } from '../src/sim/territory';
import { census } from '../src/sim/census';
import { build, placeProblem } from '../src/sim/buildings';
import { labelWorld, allocIsles } from '../src/sim/naval';
import { H_SOLDIER, makeHuman, doorOf } from '../src/sim/population';
import { maxHp } from '../src/sim/army';
import { RG, region, setRegions, cedeRegion, updateRegions, CONTROL } from '../src/sim/regions';
import { claim, claimProblem, answer, inCrisis, armyProblem, armyOrder, armyOf, makePeace, offerPeace, CRISIS_TICKS, CAPTURE_TICKS, MAX_CLAIMS, A_HOME, A_MARCH, A_HOLD, A_BATTLE, O_DEFEND, partner } from '../src/sim/war';

const N = (i: number) => W.nations[i];
const M = () => W.M;
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
function until(ok: () => boolean, max: number){ for (let i=0;i<max;i++){ if (ok()) return i; tick(); } throw new Error('timed out'); }
const S = 40;   // a region's side in tiles
const regionAt = (bx: number, by: number) => by*10+bx+1;
const blockOf = (t: number) => [((t%TW)/S)|0, (((t/TW)|0)/S)|0];

/** A flat grass map cut into square regions, the player and one bot that never thinks of its own. */
function world(){
  newWorld(7); W.rushUntil=0;
  isLand.fill(1); terr.fill(T_GRASS); pBuild.fill(1);
  W.landTiles=Int32Array.from({ length: NT }, (_, i) => i); W.landCount=NT;
  labelWorld();
  if (!startMatch((TH/2)*TW+TW/2, 1)) throw new Error('no spawn');
  allocIsles();
  for (const n of W.nations.slice(1)){ n.nextThink=1e9; n.nextWar=1e9; n.humanProg=-1e9; }
  const names: string[]=[]; for (let by=0;by<7;by++) for (let bx=0;bx<10;bx++) names.push(`R${bx}.${by}`);
  setRegions(t => regionAt(((t%TW)/S)|0, (((t/TW)|0)/S)|0), names);
  census();
}
/** The player's castle region, and regions east of it given to the bot (none with its castle). */
function lands(east=2){
  const [bx,by]=blockOf(N(1).capTile), home=regionAt(bx,by);
  cedeRegion(home,1);
  const theirs: number[]=[];
  for (let k=1;k<=east;k++){ const r=regionAt(bx+k,by); if (region[N(2).capTile]===r) throw new Error('bot castle in the way'); cedeRegion(r,2); theirs.push(r); }
  census();
  return { home, theirs };
}
/** k soldiers for kingdom o in an army of their own: barracks modules (5 men each) built side by side in region r. */
function army(o: number, k: number, r: number, spot=0): Army {
  const n=N(o), mods=Math.ceil(k/5), cx=RG.tiles[RG.start[r]+((RG.start[r+1]-RG.start[r])>>1)];
  const q0=((((cx/TW)|0)>>2))*PW+((cx%TW)>>2)+spot*3*PW;
  n.gold=1e6;   // (wages paid: unpaid soldiers lay down their arms)
  const plots: number[]=[];
  for (let i=0;plots.length<mods && i<40;i++){ const q=q0+(i%6)+((i/6)|0)*PW; n.stock=[100,100,100]; if (!placeProblem(n,q,B_BARRACKS) && build(n,q,B_BARRACKS)) plots.push(q); }
  if (plots.length<mods) throw new Error('no room for barracks');
  const [x,y]=[(plots[0]%PW)*8+4, ((plots[0]/PW)|0)*8+9];
  for (let i=0;i<k;i++){ const h=makeHuman(n,H_SOLDIER,x+(i%5)-2,y+((i/5)|0)); W.humans.push(h); }
  n.soldierShare=1;
  run(3);
  const a=W.armies.find(a => a.o===o && a.plots.includes(plots[0]));
  if (!a) throw new Error('no army');
  return a;
}
/** a claims regions of d's and d refuses: war. */
function war(a: number, d: number, regs: number[]){
  expect(claim(a,d,regs)).toBe(true);
  expect(answer(d,a,false)).toBe(true);
  expect(W.wars[a*M()+d]).toBe(1);
}

describe('regions', () => {
  it('are the real provinces on Europe, each with its flag inside it and its neighbours both ways', () => {
    newWorld(1,'europe');
    expect(RG.n-1).toBeGreaterThan(500);
    expect(RG.n-1).toBeLessThan(700);
    const names=new Set(RG.names.slice(1)); expect(names.size).toBe(RG.n-1);
    for (const n of ['Toscana','Crete','Sicily','Thessalia','Peloponnisos']) expect(names.has(n)).toBe(true);
    for (let r=1;r<RG.n;r++){
      expect(region[RG.flag[r]]).toBe(r);
      for (const q of RG.adj[r]) expect(RG.adj[q]).toContain(r);
    }
    let none=0, land=0; for (let t=0;t<NT;t++) if (isLand[t]){ land++; if (!region[t]) none++; }
    expect(none/land).toBeLessThan(0.01);   // (only small islands belong to none)
  });

  it('go whole to a kingdom that owns more than 60% of one: the others are pushed out, their buildings burn', () => {
    world();
    const [bx,by]=blockOf(N(1).capTile), r=regionAt(bx+2,by);
    expect(region[N(2).capTile]).not.toBe(r);
    const tiles=RG.tiles.slice(RG.start[r],RG.start[r+1]);
    // the bot settles a tenth of it, and builds there
    for (let i=0;i<tiles.length*0.1;i++) setOwner(tiles[i],2);
    const q=((tiles[45]/TW|0)>>2)*PW+((tiles[45]%TW)>>2); N(2).stock=[100,100,100];
    const qq=[q,q+1,q+2,q+PW].find(k => !placeProblem(N(2),k,B_BARRACKS))!; expect(build(N(2),qq,B_BARRACKS)).toBe(true);
    // the player settles 60%: not yet
    let k=Math.ceil(tiles.length*0.1);
    for (;k<tiles.length*0.1+tiles.length*CONTROL-1;k++) setOwner(tiles[k],1);
    updateRegions(); expect(W.rOwner[r]).toBe(0);
    // and a little more: it is the player's, all of it, the flag up
    for (;k<tiles.length*0.1+tiles.length*CONTROL+2;k++) setOwner(tiles[k],1);
    updateRegions();
    expect(W.rOwner[r]).toBe(1);
    expect(W.rFlag[r]).toBe(1);
    expect(tiles.every(t => owner[t]===1)).toBe(true);
    expect(pBurn[qq]>0 || pOwner[qq]!==2).toBe(true);
  });

  it('with another kingdom\'s castle in it can\'t be taken from that kingdom', () => {
    world();
    const r=region[N(2).capTile], tiles=RG.tiles.slice(RG.start[r],RG.start[r+1]);
    for (const t of tiles) if (!owner[t]) setOwner(t,1);
    updateRegions();
    expect(W.rOwner[r]).not.toBe(1);
    expect(owner[N(2).capTile]).toBe(2);
  });
});

describe('claims', () => {
  it('are a chain of regions the other controls, the first beside one of ours, at most four', () => {
    world();
    const { home, theirs }=lands(4);
    const [b1,b2,b3,b4]=theirs;
    expect(claimProblem(1,2,[b2])).toMatch(/first region must border/);
    expect(claimProblem(1,2,[b1,b3])).toMatch(/border one already claimed/);
    expect(claimProblem(1,2,[home])).toMatch(/Only regions they control/);
    expect(claimProblem(1,2,[b1,b2,b3,b4,b4])).toMatch(/At most|twice/);
    expect(MAX_CLAIMS).toBe(4);
    expect(claimProblem(1,2,[b1,b2,b3,b4])).toBeNull();
    expect(claimProblem(1,2,[])).toMatch(/Pick a region/);
  });

  it('are given up by a bot far weaker than the claimant (the regions change hands, no war), and refused by one that is not', () => {
    world();
    const { theirs }=lands(2);
    W.srand=() => 0.1;
    const theirsPeople=() => W.humans.filter(h => h.o===2);
    for (const h of theirsPeople()) h.hp=0;   // (a kingdom with nobody: no strength at all, against one with soldiers)
    for (let i=0;i<20;i++){ const [x,y]=doorOf(N(1)); W.humans.push(makeHuman(N(1),H_SOLDIER,x,y+1)); }
    run(2);
    queueCommand({ type:'claim', nation:1, target:2, regions:[theirs[0]] }); tick();
    expect(inCrisis(1,2)).toBe(true);
    until(() => !inCrisis(1,2), 200);
    expect(W.wars[1*M()+2]).toBe(0);
    expect(W.rOwner[theirs[0]]).toBe(1);
    // the next claim, on one no weaker: refused, war
    for (const h of W.humans.filter(h => h.o===1)) h.hp=0;
    for (let i=0;i<20;i++){ const [x,y]=doorOf(N(2)); W.humans.push(makeHuman(N(2),H_SOLDIER,x,y+1)); }
    run(2);
    queueCommand({ type:'claim', nation:1, target:2, regions:[theirs[1]] }); tick();
    until(() => !inCrisis(1,2), 200);
    expect(W.wars[1*M()+2]).toBe(1);
    expect(W.rOwner[theirs[1]]).toBe(2);
  });

  it('on the player wait for its answer: giving up hands them over; silence for 30 seconds is war', () => {
    world();
    const [bx,by]=blockOf(N(2).capTile), bh=regionAt(bx,by);
    cedeRegion(bh,2);
    const mine=RG.adj[bh].find(r => region[N(1).capTile]!==r)!; cedeRegion(mine,1); census();
    expect(claim(2,1,[mine])).toBe(true);
    queueCommand({ type:'answer', nation:1, target:2, accept:true }); tick();
    expect(W.rOwner[mine]).toBe(2);
    expect(W.wars[2*M()+1]).toBe(0);
    const other=RG.adj[bh].find(r => r!==mine && region[N(1).capTile]!==r)!; cedeRegion(other,1); census();
    expect(claim(2,1,[other])).toBe(true);
    run(CRISIS_TICKS-5); expect(inCrisis(2,1)).toBe(true);
    run(10);
    expect(W.wars[2*M()+1]).toBe(1);
  });
});

describe('armies', () => {
  it('stand at home in a phalanx in front of their barracks, and heal there', () => {
    world(); const { home }=lands(1);
    const a=army(1,20,home);
    run(200);
    expect(a.mode).toBe(A_HOME);
    expect(a.files.length).toBeGreaterThanOrEqual(5);
    const men=W.humans.filter(h => h.o===1 && h.kind===H_SOLDIER);
    const cx=men.reduce((s,h) => s+h.x,0)/men.length, cy=men.reduce((s,h) => s+h.y,0)/men.length;
    for (const h of men) expect(Math.hypot(h.x-cx,h.y-cy)).toBeLessThan(20);
    for (const h of men) h.hp=1;
    run(30*GAME_SPEED*10+5);
    for (const h of men) expect(h.hp).toBeCloseTo(maxHp(h),5);
  });

  it('are sent only at war, to claimed regions: theirs beside ground we hold to attack, ours to defend; one army a region', () => {
    world(); const { home, theirs }=lands(2);
    const a=army(1,10,home), b=army(1,10,home,-3);
    expect(armyProblem(1,a.id,'attack',theirs[0])).toMatch(/claimed in a war/);
    war(1,2,theirs);
    expect(armyProblem(1,a.id,'attack',theirs[1])).toMatch(/border ground you hold/);
    expect(armyProblem(1,a.id,'defend',home)).toMatch(/claimed in a war on you/);
    expect(armyProblem(1,a.id,'attack',theirs[0])).toBeNull();
    expect(armyOrder(1,a.id,'attack',theirs[0])).toBe(true);
    expect(armyProblem(1,b.id,'attack',theirs[0])).toMatch(/One army per region/);
    expect(a.mode).toBe(A_MARCH);
  });

  it('lower an undefended region\'s flag, occupy it, go on to the next; holding every claim wins the war', () => {
    world(); const { home, theirs }=lands(2);
    const a=army(1,16,home);
    war(1,2,theirs);
    armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_HOLD, 3000);
    const down: number[]=[]; listen({ regionTaken: (r,by) => { if (by===1) down.push(r); } });
    const t0=W.tickN;
    until(() => W.rOcc[theirs[0]]===1, CAPTURE_TICKS*3);
    expect(W.tickN-t0).toBeGreaterThan(CAPTURE_TICKS*0.5);   // (16 men: about the time an army of CAPTURE_MEN takes)
    expect(W.rFlag[theirs[0]]).toBe(0);
    const t=RG.tiles[RG.start[theirs[0]]+10]; expect(owner[t]).toBe(2); expect(occ[t]).toBe(1);
    expect(armyProblem(1,a.id,'attack',theirs[1])).toBeNull();   // the next one is beside ground we hold now
    armyOrder(1,a.id,'attack',theirs[1]);
    until(() => !W.wars[1*M()+2], CAPTURE_TICKS*4);
    expect(theirs.every(r => W.rOwner[r]===1 && !W.rOcc[r])).toBe(true);
    expect(down).toEqual(theirs);
    listen({ regionTaken: () => {} });
  });

  it('fight a defending army man to man: front rank against front rank, one on one; the man behind steps up when one falls', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,20,home), d=army(2,20,theirs[0]);
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    expect(d.mode).toBe(A_BATTLE);
    let most=0, stepped=0;
    const heads=new Map<number, number>();
    for (let i=0;i<600 && a.men>0 && d.men>0;i++){
      tick();
      const fighting=W.humans.filter(h => h.hp>0 && partner(h));
      for (const h of fighting) expect(partner(partner(h)!)).toBe(h);   // (a duel is two men, each the other's)
      const duels=fighting.length/2; most=Math.max(most,duels);
      expect(duels).toBeLessThanOrEqual(Math.max(a.files.length,d.files.length));   // (one man of each front rank at most in a duel: files come and go as men fall)
      a.files.forEach((f,k) => { const was=heads.get(k); if (was!==undefined && was!==f[0]) stepped++; heads.set(k,f[0]); });
      expect(W.rFlag[theirs[0]]).toBe(1);   // (no flag moves while they fight)
    }
    expect(most).toBeGreaterThan(2);
    expect(stepped).toBeGreaterThan(0);
  });

  it('retreat out of a fight to the nearest region of their own, and the fight is over', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,15,home), d=army(2,15,theirs[0]);
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    expect(armyOrder(1,a.id,'retreat')).toBe(true);
    expect(a.mode).toBe(A_MARCH); expect(d.mode).not.toBe(A_BATTLE);
    until(() => a.mode===A_HOLD, 3000);
    expect(region[(((a.y/2)|0)*TW+((a.x/2)|0))]).toBe(home);
    run(100); expect(a.mode).toBe(A_HOLD);   // (let go: not taken on again)
    // home: back to the barracks, the men no longer in the field
    expect(armyOrder(1,a.id,'return')).toBe(true);
    until(() => a.mode===A_HOME, 3000);
    expect(W.humans.filter(h => h.o===1 && h.war===a.id)).toHaveLength(0);
  });

  it('defending a region beside one under attack with nobody there march in to defend it (the second wave)', () => {
    world(); const { home, theirs }=lands(2);
    const a=army(1,15,home), d=army(2,15,theirs[1]);
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[1]);
    until(() => d.mode===A_HOLD, 3000);
    armyOrder(1,a.id,'attack',theirs[0]);
    until(() => d.goal===theirs[0], 200);
    expect(d.order).toBe(O_DEFEND);
  });
});

describe('peace', () => {
  it('gives the attacker the claimed regions it occupies; the rest are free again', () => {
    world(); const { home, theirs }=lands(2);
    const a=army(1,16,home);
    war(1,2,theirs);
    armyOrder(1,a.id,'attack',theirs[0]);
    until(() => W.rOcc[theirs[0]]===1, CAPTURE_TICKS*4);
    offerPeace(2,1); makePeace(1,2);
    expect(W.wars[1*M()+2]).toBe(0);
    expect(W.rOwner[theirs[0]]).toBe(1);
    expect(W.rOwner[theirs[1]]).toBe(2);
    expect(W.rOcc[theirs[1]]).toBe(0);
    run(5); expect([A_MARCH, A_HOME]).toContain(armyOf(a.id)!.mode);   // (going home)
  });

  it('a kingdom whose castle region is won falls to the winner', () => {
    world();
    const [bx,by]=blockOf(N(2).capTile), bh=regionAt(bx,by); cedeRegion(bh,2);
    const mine=RG.adj[bh][0]; cedeRegion(mine,1); census();
    const a=army(1,16,mine);
    war(1,2,[bh]);
    armyOrder(1,a.id,'attack',bh);
    until(() => !N(2).alive || !W.wars[1*M()+2], CAPTURE_TICKS*6);
    expect(N(2).alive).toBe(false);
    expect(owner[N(2).capTile]===1 || N(2).capTile<0).toBe(true);
    void pType; void (null as unknown as Human);
  });
});
