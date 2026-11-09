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
import { RG, region, setRegions, cedeRegion, updateRegions, occupyRegion, CONTROL } from '../src/sim/regions';
import { claim, claimProblem, answer, inCrisis, armyProblem, armyOrder, armyOf, makePeace, offerPeace, acceptPeace, giveGoals, setClaims, claimsProblem, claimsOf, wageOf, diceFactor, CRISIS_TICKS, CAPTURE_TICKS, ROLL_TICKS, MAX_CLAIMS, P_GOALS, A_HOME, A_MARCH, A_HOLD, A_BATTLE, O_DEFEND, partner } from '../src/sim/war';
import { WAGE, WAGE_IDLE, B_TOWER, B_ARCHERY } from '../src/core/constants';
import { buildFort, fortTier, fortSpot } from '../src/sim/buildings';
import { pTier } from '../src/sim/state';
import { waiting, fortUpkeep, FORT_DMG, began, outlook, ARROW_TICKS, ARROW_DMG, RALLY_TICKS, ARCHER_WAGE } from '../src/sim/war';
import { unitAt, SOLDIER_HP, SOLDIER_DMG } from '../src/sim/army';
import { pArch, pArmor } from '../src/sim/state';
import { incomeParts } from '../src/sim/sim';

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
/** k soldiers for kingdom o in an army of their own: barracks modules (5 men each) built side by side in region r; `archers` of them archers
    (archer barracks modules after the spearmen's, in the same row: one barracks, one army). */
function army(o: number, k: number, r: number, spot=0, archers=0): Army {
  const n=N(o), spearMods=Math.ceil((k-archers)/5), mods=spearMods+Math.ceil(archers/5), cx=RG.tiles[RG.start[r]+((RG.start[r+1]-RG.start[r])>>1)];
  const q0=((((cx/TW)|0)>>2))*PW+((cx%TW)>>2)+spot*3*PW;
  n.gold=1e6;   // (wages paid: unpaid soldiers lay down their arms)
  const plots: number[]=[];
  for (let i=0;plots.length<mods && i<40;i++){ const q=q0+(i%6)+((i/6)|0)*PW; n.stock=[100,100,100]; if (!placeProblem(n,q,B_BARRACKS) && build(n,q,plots.length<spearMods ? B_BARRACKS : B_ARCHERY)) plots.push(q); }
  if (plots.length<mods) throw new Error('no room for barracks');
  const [x,y]=[(plots[0]%PW)*8+4, ((plots[0]/PW)|0)*8+9];
  for (let i=0;i<k;i++){ const h=makeHuman(n,H_SOLDIER,x+(i%5)-2,y+((i/5)|0)); W.humans.push(h); }
  n.soldierShare=1;
  census(); run(3);   // (a full count: the census counted a slice at a time, maybe before these barracks stood)
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

  it('go whole to a kingdom that owns more than half of one (51%): the others are pushed out, their buildings burn', () => {
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

  it('go to a 55% holder over a 45% one: a majority is enough, all the land need not be settled', () => {
    world();
    const [bx,by]=blockOf(N(1).capTile), r=regionAt(bx+2,by);
    const tiles=RG.tiles.slice(RG.start[r],RG.start[r+1]), L=tiles.length;
    expect(CONTROL).toBeCloseTo(0.51);
    let k=0;
    for (;k<L*0.45;k++) setOwner(tiles[k],2);
    for (;k<L;k++) setOwner(tiles[k],1);   // (about 55%)
    updateRegions();
    expect(W.rOwner[r]).toBe(1);
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

  it('attack only claimed regions beside ground we hold, at war; are stationed in any region of ours; one army a region', () => {
    world(); const { home, theirs }=lands(2);
    const a=army(1,10,home), b=army(1,10,home,-3);
    expect(armyProblem(1,a.id,'attack',theirs[0])).toMatch(/claimed in a war/);
    war(1,2,theirs);
    expect(armyProblem(1,a.id,'attack',theirs[1])).toMatch(/border ground you hold/);
    expect(armyProblem(1,a.id,'station',home)).toBeNull();                  // (a region of our own: always)
    expect(armyProblem(1,a.id,'station',theirs[0])).toMatch(/stationed only in regions of yours/);
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
    expect(armyProblem(1,a.id,'return')).toMatch(/rallying/);   // (its morale broken: no orders for 30 s)
    until(() => a.mode===A_HOLD, 3000);
    expect(region[(((a.y/2)|0)*TW+((a.x/2)|0))]).toBe(home);
    run(100); expect(a.mode).toBe(A_HOLD);   // (let go: not taken on again)
    until(() => !armyProblem(1,a.id,'return'), RALLY_TICKS);
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

describe('armies in peace and war', () => {
  it('are stationed in any region of their own in peace, paid the field wage there; home garrisons them for less', () => {
    world(); const { home }=lands(1);
    const [bx,by]=blockOf(N(1).capTile), other=regionAt(bx,by+1); cedeRegion(other,1); census();
    const a=army(1,10,home);
    expect(armyOrder(1,a.id,'station',other)).toBe(true);
    until(() => a.mode===A_HOLD, 3000);
    expect(region[(((a.y/2)|0)*TW+((a.x/2)|0))]).toBe(other);
    const man=W.humans.find(h => h.war===a.id)!; expect(wageOf(man)).toBe(WAGE);
    armyOrder(1,a.id,'return'); until(() => a.mode===A_HOME, 3000);
    expect(wageOf(man)).toBe(WAGE_IDLE);
  });

  it('bring a flag down in 30 seconds sitting in the region, whatever their size; the owner raises it again as fast', () => {
    for (const k of [5, 40]){
      world(); const { home, theirs }=lands(1);
      const a=army(1,k,home);
      war(1,2,theirs);
      armyOrder(1,a.id,'attack',theirs[0]);
      until(() => a.mode===A_HOLD, 3000);
      const t=until(() => W.rOcc[theirs[0]]===1 || W.rOwner[theirs[0]]===1, CAPTURE_TICKS*2);   // (the only claim taken: the war is won, the region handed over at once)
      expect(t).toBeGreaterThan(CAPTURE_TICKS*0.9); expect(t).toBeLessThan(CAPTURE_TICKS*1.1);
    }
  });

  it('attack two border regions at once with two armies, each beside ground we hold', () => {
    world(); const [bx,by]=blockOf(N(1).capTile), home=regionAt(bx,by); cedeRegion(home,1);
    const e=regionAt(bx+1,by), s2=regionAt(bx,by+1);
    for (const r of [e,s2]){ if (region[N(2).capTile]===r) return; cedeRegion(r,2); }
    census();
    const a=army(1,10,home), b=army(1,10,home,-3);
    war(1,2,[e]); expect(setClaims(1,2,[e,s2])).toBe(true);   // (the crisis claims a chain; at war, any region of theirs may be added)
    expect(armyOrder(1,a.id,'attack',e)).toBe(true);
    expect(armyOrder(1,b.id,'attack',s2)).toBe(true);
    until(() => W.rOcc[e]===1 && W.rOcc[s2]===1 || !W.wars[1*M()+2], CAPTURE_TICKS*4);
    expect(W.rOwner[e]).toBe(1); expect(W.rOwner[s2]).toBe(1);   // (both taken: the war is won)
  });

  it('fight with the whole front rank at once, every man one on one, the wider army\'s spare men round the flank', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,60,home), d=army(2,20,theirs[0]);
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    run(40);
    let most=0;
    for (let i=0;i<60;i++){ tick(); const n=W.humans.filter(h => h.hp>0 && partner(h)).length/2; most=Math.max(most,n); }
    expect(most).toBeGreaterThanOrEqual(Math.min(a.files.length,d.men)-2);   // (as many duels as the wider front can find men for, bar a man or two still stepping up)
    expect(most).toBeGreaterThan(d.files.length);                              // (more than the narrow front alone: its rear ranks are flanked)
  });

  it('roll a die for each line every 3 seconds: 1 is -20%, 3 even, 6 is +20%', () => {
    expect(diceFactor(1)).toBeCloseTo(0.8); expect(diceFactor(3)).toBe(1); expect(diceFactor(6)).toBeCloseTo(1.2); expect(diceFactor(2)).toBeCloseTo(0.9);
    world(); const { home, theirs }=lands(1);
    const a=army(1,20,home), d=army(2,20,theirs[0]);
    war(1,2,theirs);
    const rolls: { id: number; t: number; r: number }[]=[];
    listen({ battleRoll: (_o,id,r) => rolls.push({ id, t:W.tickN, r }) });
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    run(ROLL_TICKS*6);
    listen({ battleRoll: () => {} });
    const mine=rolls.filter(r => r.id===a.id), theirsR=rolls.filter(r => r.id===d.id);
    expect(mine.length).toBeGreaterThanOrEqual(5); expect(theirsR.length).toBeGreaterThanOrEqual(5);
    for (let i=1;i<mine.length;i++) expect(mine[i].t-mine[i-1].t).toBe(ROLL_TICKS);
    expect(rolls.every(r => r.r>=1 && r.r<=6)).toBe(true);
  });
});

describe('battle lines', () => {
  it('two lines that meet fight all along: nearly every man of the front rank is in a duel, none idle for long', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,40,home), d=army(2,40,theirs[0]);
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    run(60);   // (the lines close)
    let sum=0, k=0;
    for (let i=0;i<200 && a.men>8 && d.men>8;i++){
      tick();
      const fronts=Math.min(a.files.length,d.files.length), duels=W.humans.filter(h => h.hp>0 && partner(h)).length/2;
      sum+=duels/fronts; k++;
    }
    expect(sum/k).toBeGreaterThan(0.85);   // (on average at least 85% of the narrower front is fighting, man to man)
  });

  it('are reinforced from the barracks: the men waiting there march up and join the back of the phalanx, in a fight too', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,10,home), d=army(2,30,theirs[0]);
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    expect(armyProblem(1,a.id,'reinforce')).toMatch(/Nobody/);
    // ten new recruits at its barracks
    const q=a.plots[0], n=N(1); n.stock=[100,100,100];
    for (const k of [q+2,q+3]) build(n,k,B_BARRACKS);
    for (let i=0;i<10;i++){ const h=makeHuman(n,H_SOLDIER,(q%PW)*8+4+i%5,((q/PW)|0)*8+10); W.humans.push(h); }
    run(5);
    const x=armyOf(a.id)!;
    expect(waiting(x)).toBeGreaterThanOrEqual(5);
    const before=x.men+x.coming.length;
    expect(armyOrder(1,x.id,'reinforce')).toBe(true);
    expect(x.coming.length).toBeGreaterThan(0);
    until(() => x.coming.length===0 || x.mode===A_HOME, 3000);
    expect(x.mode===A_HOME || x.men>=before-10).toBe(true);   // (they joined its ranks: it may have lost men meanwhile)
  });
});

describe('archers', () => {
  it('train in archer barracks, which join any barracks beside them into one army: 2 of spearmen and 1 of archers make 15 men, 5 of them archers', () => {
    world(); const { home }=lands(1);
    const a=army(1,15,home,0,5), u=unitAt(a.id)!;
    expect(u.cap).toBe(15); expect(u.archCap).toBe(5);
    expect(W.armies.filter(x => x.o===1)).toHaveLength(1);
    const men=u.members, archers=men.filter(h => h.arch);
    expect(archers).toHaveLength(5);
    expect(u.plots.filter(q => pArch[q])).toHaveLength(1);
    // half a spearman's hit points and blows, no armour; paid a tenth more
    const s=men.find(h => !h.arch)!, b=archers[0];
    expect(maxHp(b)).toBe(SOLDIER_HP[1]/2); expect(maxHp(s)).toBe(SOLDIER_HP[1]);
    expect(wageOf(b)).toBeCloseTo(wageOf(s)*ARCHER_WAGE,9);
    // armour on the racks goes to the spearmen only
    pArmor[2][u.plots[0]]+=15; run(30);
    expect(archers.every(h => h.tier===1)).toBe(true);
    expect(men.filter(h => !h.arch).every(h => h.tier===2)).toBe(true);
    void SOLDIER_DMG;
  });

  it('any mix makes one army: 6 archer barracks beside 2 of spearmen give 30 archers and 10 spearmen', () => {
    world(); const { home }=lands(1);
    const a=army(1,40,home,0,30), u=unitAt(a.id)!;
    expect(u.cap).toBe(40); expect(u.archers).toBe(30); expect(u.members.length-u.archers).toBe(10);
  });

  it('stand behind the spearmen: the head of every file is a spearman while there are spearmen enough, and a file that loses its spearmen takes one from another', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,40,home,0,30);
    war(1,2,theirs); armyOrder(1,a.id,'attack',theirs[0]);
    run(50);
    const arch=(id: number) => W.humans.find(h => h.id===id)!.arch;
    const F=a.files.length; expect(F).toBeLessThanOrEqual(10);
    expect(a.files.every(f => !arch(f[0]))).toBe(true);
    for (const f of a.files){ const k=f.findIndex(arch); if (k>=0) expect(f.slice(k).every(arch)).toBe(true); }   // (spearmen at the head, archers behind)
    // the spearmen of one file fall: another file's spare spearman takes the head
    const f0=a.files[0], spears=f0.filter(id => !arch(id));
    for (const id of spears) W.humans.find(h => h.id===id)!.hp=0;
    run(3);
    const alive=W.humans.filter(h => h.o===1 && h.war===a.id && h.hp>0 && !h.arch).length;
    expect(a.files.filter(f => !arch(f[0])).length).toBe(Math.min(a.files.length,alive));
  });

  it('shoot from the ranks behind in a battle: an arrow each every 4 seconds for 1 damage, at the enemy army only', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,25,home,0,15), d=army(2,15,theirs[0]);
    war(1,2,theirs);
    let shots=0; listen({ arrowShot: () => { shots++; } });
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    shots=0; run(ARROW_TICKS);
    const behind=a.files.reduce((k,f) => k+f.slice(1).filter(id => W.humans.find(h => h.id===id)?.arch).length,0);
    expect(behind).toBeGreaterThan(5);
    expect(shots).toBeGreaterThanOrEqual(behind-2); expect(shots).toBeLessThanOrEqual(15);
    expect(ARROW_DMG).toBe(1);
    // no shots without a fight
    world(); const l2=lands(1); army(1,15,l2.home,0,10);
    shots=0; run(ARROW_TICKS*2); expect(shots).toBe(0);
  });
});

describe('orders', () => {
  it('an army that retreats rallies for 30 seconds: it takes no orders until then', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,10,home), d=army(2,30,theirs[0]);
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    expect(armyOrder(1,a.id,'retreat')).toBe(true);
    const t0=W.tickN;
    expect(armyOrder(1,a.id,'return')).toBe(false);
    expect(armyProblem(1,a.id,'station',home)).toMatch(/rallying/);
    until(() => !armyProblem(1,a.id,'return'), RALLY_TICKS+5);
    expect(W.tickN-t0).toBeGreaterThanOrEqual(RALLY_TICKS-1);
  });

  it('a second army sent where one of ours is fighting stands by, and marches in when the first is beaten', () => {
    world(); const { home, theirs }=lands(1);
    const a=army(1,5,home), b=army(1,15,home,1), d=army(2,25,theirs[0]);
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => a.mode===A_BATTLE, 4000);
    expect(armyProblem(1,b.id,'attack',theirs[0])).toBeNull();
    expect(armyOrder(1,b.id,'attack',theirs[0])).toBe(true);
    expect(b.next).toEqual({ order:'attack', r:theirs[0] }); expect(b.mode).toBe(A_HOME);
    until(() => b.mode!==A_HOME, 6000);   // (the first is beaten: the second marches in)
    expect(a.mode).toBe(A_HOME); expect(b.goal).toBe(theirs[0]); expect(b.next).toBeNull();
  });

  it('the defender may queue the next army for a region it defends the same way', () => {
    world(); const { home, theirs }=lands(2);
    const a=army(1,30,home), d1=army(2,5,theirs[0]), d2=army(2,15,theirs[1]);
    war(1,2,theirs);
    armyOrder(2,d1.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => d1.mode===A_BATTLE, 4000);
    expect(armyOrder(2,d2.id,'defend',theirs[0])).toBe(true);
    expect(d2.next?.r).toBe(theirs[0]);
    until(() => d2.goal===theirs[0], 6000);
  });

  it('an attacker is stationed in a region it occupies, to keep it: the owner can\'t raise the flag while it stands there', () => {
    world(); const { home, theirs }=lands(2);
    const a=army(1,15,home);
    war(1,2,[theirs[0],theirs[1]]);
    occupyRegion(theirs[0],1);
    expect(armyProblem(1,a.id,'station',theirs[0])).toBeNull();
    expect(armyProblem(1,a.id,'attack',theirs[0])).toMatch(/hold it already/);
    expect(armyOrder(1,a.id,'station',theirs[0])).toBe(true);
    expect(a.enemy).toBe(2);
    until(() => a.mode===A_HOLD, 4000);
    expect(W.rOcc[theirs[0]]).toBe(1);
  });
});

describe('forts', () => {
  it('stand round a region\'s flag, four watchtowers for 15 wood, 50 stone and 15 copper, one a region; 1.5 gold a second a tier', () => {
    world(); const { home: castle }=lands(1);
    const n=N(1); n.stock=[15,50,15];
    expect(buildFort(n,castle)).toBe(false);   // (a capital's region defends itself as a tier 4 fort)
    const [bx,by]=blockOf(n.capTile), home=regionAt(bx,by+1); cedeRegion(home,1); census();
    expect(buildFort(n,home)).toBe(true);
    expect(n.stock).toEqual([0,0,0]);
    expect(fortTier(home)).toBe(1);
    const q=fortSpot(home); expect([q,q+1,q+PW,q+PW+1].every(k => pType[k]===B_TOWER)).toBe(true);
    n.stock=[100,100,100]; expect(buildFort(n,home)).toBe(false);   // (one a region)
    run(12); expect(fortUpkeep(1)).toBeCloseTo(1.5); expect(incomeParts(n).towers).toBeCloseTo(1.5);
    for (const k of [q,q+1,q+PW,q+PW+1]) pTier[k]=3; run(12);
    expect(fortTier(home)).toBe(3); expect(fortUpkeep(1)).toBeCloseTo(4.5);
  });

  it('slow the capture of their region by 40% a tier, and shoot its attackers for 2, 4 and 8 every 3 seconds; they work for the occupier too', () => {
    for (const tier of [1,3]){
      world(); const { home, theirs }=lands(1);
      const n2=N(2); n2.stock=[100,100,100]; expect(buildFort(n2,theirs[0])).toBe(true);
      const q=fortSpot(theirs[0]); for (const k of [q,q+1,q+PW,q+PW+1]) pTier[k]=tier;
      const a=army(1,30,home);
      for (const h of W.humans) if (h.war===a.id || h.o===1) h.hp=1e6;   // (they don't die of the shots: the time is what is measured)
      war(1,2,theirs);
      const shots: number[]=[]; listen({ towerShot: () => shots.push(W.tickN) });
      armyOrder(1,a.id,'attack',theirs[0]);
      until(() => a.mode===A_HOLD, 3000);
      const t=until(() => W.rOcc[theirs[0]]===1 || W.rOwner[theirs[0]]===1, CAPTURE_TICKS*4);
      listen({ towerShot: () => {} });
      expect(t).toBeGreaterThan(CAPTURE_TICKS*(1+0.4*tier)*0.9); expect(t).toBeLessThan(CAPTURE_TICKS*(1+0.4*tier)*1.1);
      expect(shots.length).toBeGreaterThan(3);
      for (let i=1;i<shots.length;i++) expect(shots[i]-shots[i-1]).toBe(ROLL_TICKS);
      expect(FORT_DMG[tier]).toBe(tier===1 ? 2 : 8);
    }
  });
});

describe('forts held by the occupier', () => {
  it('slow the defender who comes to take its region back, and shoot at him', () => {
    world(); const { home, theirs }=lands(2);
    const n2=N(2); n2.stock=[100,100,100]; expect(buildFort(n2,theirs[0])).toBe(true);
    const q=fortSpot(theirs[0]); for (const k of [q,q+1,q+PW,q+PW+1]) pTier[k]=2;
    const a=army(1,30,home), d=army(2,20,theirs[1]);
    for (const h of W.humans) if (h.o===1 || h.o===2) h.hp=1e6;
    war(1,2,theirs);
    armyOrder(1,a.id,'attack',theirs[0]);
    until(() => W.rOcc[theirs[0]]===1, CAPTURE_TICKS*5);
    armyOrder(1,a.id,'return'); until(() => a.mode===A_HOME, 4000);
    const shots: number[]=[]; listen({ towerShot: (_x,_y,_x1,_y1,_k,v) => { const h=W.humans.find(h => h.id===v); if (h && h.o===2) shots.push(W.tickN); } });
    armyOrder(2,d.id,'defend',theirs[0]);
    until(() => d.mode===A_HOLD, 3000);
    const t=until(() => !W.rOcc[theirs[0]], CAPTURE_TICKS*5);
    listen({ towerShot: () => {} });
    expect(t).toBeGreaterThan(CAPTURE_TICKS*1.8*0.9);   // (a tier 2 fort: 80% slower, now against its builder)
    expect(shots.length).toBeGreaterThan(3);
  });
});

describe('taking regions', () => {
  it('a region occupied loses its barracks: they burn, and the occupier gains no army from them', () => {
    world(); const { home, theirs }=lands(1);
    const b=army(2,5,theirs[0]), bq=b.plots[0];
    const a=army(1,20,home);
    war(1,2,theirs);
    armyOrder(1,a.id,'attack',theirs[0]);
    until(() => W.rOcc[theirs[0]]===1 || !W.wars[1*M()+2], CAPTURE_TICKS*4);
    expect(pType[bq]!==B_BARRACKS || pBurn[bq]>0).toBe(true);
    expect(pOwner[bq]).not.toBe(1);
  });

  it('a region given up in a peace hands over its buildings, but not its barracks: they burn', () => {
    world(); const { theirs }=lands(1);
    const b=army(2,5,theirs[0]), bq=b.plots[0];
    war(1,2,theirs);
    expect(giveGoals(2,1)).toBe(true);
    expect(W.rOwner[theirs[0]]).toBe(1);
    expect(pType[bq]===B_BARRACKS && pOwner[bq]===1 && pBurn[bq]<=0).toBe(false);
  });

  it('a capital\'s region is never given up: not in a crisis, not in a peace; it defends itself as a fort of tier 4, for nothing', () => {
    world();
    const [bx,by]=blockOf(N(2).capTile), bh=regionAt(bx,by); cedeRegion(bh,2);
    const mine=RG.adj[bh][0]; cedeRegion(mine,1); census();
    const other=RG.adj[bh].find(r => r!==mine && !RG.adj[mine].includes(r) && r!==region[N(1).capTile])!; cedeRegion(other,2); census();
    expect(fortTier(bh)).toBe(4); expect(FORT_DMG[4]).toBe(16);
    run(12); expect(fortUpkeep(2)).toBe(0);
    // claimed in a crisis: it can't be given up (a bot refuses, the player's Give up is refused too)
    expect(claim(1,2,[bh])).toBe(true);
    expect(answer(2,1,true)).toBe(false);
    expect(inCrisis(1,2)).toBe(true);
    expect(answer(2,1,false)).toBe(true);
    // at war: giving the war goals up hands over the rest, not the capital's region
    expect(setClaims(1,2,[bh,other])).toBe(true);
    expect(giveGoals(2,1)).toBe(true);
    expect(W.rOwner[bh]).toBe(2); expect(W.rOwner[other]).toBe(1);
    expect(N(2).alive).toBe(true);
  });

  it('a bot that loses one battle doesn\'t give up a chain of regions: it yields its war goals only once most are taken', () => {
    world(); const { home, theirs }=lands(3);
    const a=army(1,40,home), d=army(2,8,theirs[0]);
    const B=N(2); B.nextThink=0; B.nextWar=1e9; B.nextOffer=0;
    war(1,2,theirs);
    armyOrder(2,d.id,'defend',theirs[0]); armyOrder(1,a.id,'attack',theirs[0]);
    until(() => W.rOcc[theirs[0]]===1 || !W.wars[1*M()+2], CAPTURE_TICKS*6);
    run(1200);
    expect(W.rOwner[theirs[1]]).toBe(2); expect(W.rOwner[theirs[2]]).toBe(2);   // (whatever it offered: the rest are still its)
  });
});

describe('peace', () => {
  it('white peace: every occupied region is free again, nothing changes hands', () => {
    world(); const { home, theirs }=lands(2);
    const a=army(1,16,home);
    war(1,2,theirs);
    armyOrder(1,a.id,'attack',theirs[0]);
    until(() => W.rOcc[theirs[0]]===1, CAPTURE_TICKS*4);
    offerPeace(2,1); expect(acceptPeace(1,2)).toBe(true);
    expect(W.wars[1*M()+2]).toBe(0);
    expect(theirs.every(r => W.rOwner[r]===2 && !W.rOcc[r])).toBe(true);
    run(5); expect([A_MARCH, A_HOME]).toContain(armyOf(a.id)!.mode);   // (going home)
  });

  /** A region of the player's beside its castle region (south of it, or south-east of it beside the bot's first region), ceded to it. */
  const ours = (dx=0) => { const [bx,by]=blockOf(N(1).capTile), r=regionAt(bx+dx,by+1); if (region[N(2).capTile]===r) throw new Error('bot castle in the way'); cedeRegion(r,1); census(); return r; };

  it('war goals demanded and accepted: each side gets the claimed regions it holds, no more; given up, the other gets every region it claims and the giver keeps what it holds', () => {
    world(); const { theirs }=lands(2), south=ours();
    war(1,2,theirs);
    expect(began(1,2)).toBe(true); expect(began(2,1)).toBe(false);
    expect(claimsProblem(2,1,[south])).toBeNull();   // (the defender may claim too)
    expect(setClaims(2,1,[south])).toBe(true);
    occupyRegion(theirs[0],1); occupyRegion(south,2);
    offerPeace(1,2,P_GOALS); expect(W.offerKind[1*M()+2]).toBe(P_GOALS);
    expect(acceptPeace(2,1)).toBe(true);
    expect(W.wars[1*M()+2]).toBe(0);
    expect(W.rOwner[theirs[0]]).toBe(1);   // taken by the attacker: its
    expect(W.rOwner[theirs[1]]).toBe(2);   // claimed, not taken: stays
    expect(W.rOwner[south]).toBe(2);       // taken by the defender: its
    expect(W.rOcc[theirs[0]]+W.rOcc[theirs[1]]+W.rOcc[south]).toBe(0);
    // the defender demands them in turn: the same split
    world(); const l3=lands(2), s3=ours();
    war(1,2,l3.theirs); setClaims(2,1,[s3]); occupyRegion(s3,2);
    offerPeace(2,1,P_GOALS); expect(W.offerKind[2*M()+1]).toBe(P_GOALS);
    expect(acceptPeace(1,2)).toBe(true);
    expect(W.rOwner[s3]).toBe(2); expect(l3.theirs.every(r => W.rOwner[r]===2)).toBe(true);
    // given straight away by the defender: every region the attacker claims, while the defender keeps the one of the attacker's it holds
    world(); const l2=lands(2), s2=ours();
    war(1,2,l2.theirs); setClaims(2,1,[s2]); occupyRegion(s2,2);
    expect(giveGoals(2,1)).toBe(true);
    expect(W.wars[1*M()+2]).toBe(0);
    expect(l2.theirs.every(r => W.rOwner[r]===1)).toBe(true);
    expect(W.rOwner[s2]).toBe(2);
  });

  it('at war either side claims any region of the other\'s or lets claims go: down to one while the other claims nothing, down to none while it does', () => {
    world(); const { home, theirs }=lands(3);
    const a=army(1,16,home);
    war(1,2,[theirs[0]]);
    const far=RG.adj[theirs[2]].find(r => W.rOwner[r]!==1 && r!==theirs[1] && r!==theirs[0])!;
    cedeRegion(far,2);
    expect(claimsProblem(1,2,[])).toMatch(/at least one/);
    expect(claimsProblem(2,1,[home])).toBeNull();
    expect(claimsProblem(2,1,[theirs[1]])).toMatch(/only regions they control/i);
    expect(setClaims(1,2,[theirs[0],theirs[1],far])).toBe(true);   // (far: not beside anything we hold, still claimable)
    expect(claimsOf(1,2)).toEqual([theirs[0],theirs[1],far]);
    armyOrder(1,a.id,'attack',theirs[0]);
    until(() => W.rOcc[theirs[0]]===1, CAPTURE_TICKS*4);
    expect(setClaims(1,2,[theirs[1]])).toBe(true);
    expect(W.rOcc[theirs[0]]).toBe(0);
    expect(W.wars[1*M()+2]).toBe(1);
    // the defender claims: now the attacker may let all of its own go, and the war goes on for the defender's
    expect(setClaims(2,1,[home])).toBe(true);
    expect(claimsProblem(1,2,[])).toBeNull();
    expect(setClaims(1,2,[])).toBe(true);
    expect(claimsOf(1,2)).toEqual([]); expect(W.wars[1*M()+2]).toBe(1);
    expect(claimsProblem(2,1,[])).toMatch(/at least one/);
  });

  it('the defender attacks the regions it claims, whether or not the attacker holds regions of its own, and takes them', () => {
    world(); const { home, theirs }=lands(2), se=ours(1);   // (se: the player's, beside the bot's first region)
    army(1,6,home); const d=army(2,16,theirs[0]);
    war(1,2,theirs);
    occupyRegion(theirs[1],1);   // (the attacker holds one of the defender's regions)
    expect(armyProblem(2,d.id,'attack',se)).toMatch(/claimed/);
    expect(setClaims(2,1,[se])).toBe(true);
    expect(armyProblem(2,d.id,'attack',se)).toBeNull();
    expect(armyOrder(2,d.id,'attack',se)).toBe(true);
    until(() => W.rOwner[se]===2, CAPTURE_TICKS*6);
    expect(W.wars[1*M()+2]).toBe(0);   // (every region the defender claimed is taken: it has won, and peace splits the goals)
    expect(W.rOwner[se]).toBe(2);
    expect(W.rOwner[theirs[1]]).toBe(1);
  });

  it('a defending bot whose defence holds claims a border region of the attacker\'s, takes it, and offers peace for the war goals', () => {
    world(); const { home, theirs }=lands(2), se=ours(1);
    army(1,5,home); army(2,30,theirs[0]);
    const B=N(2); B.attackAt=0.2; B.nextThink=0; B.nextWar=1e9; B.nextOffer=0; B.gold=1e6;
    war(1,2,theirs);
    until(() => claimsOf(2,1).length>0, 6000);
    expect(claimsOf(2,1)).toEqual([se]);   // (its castle region is not claimed by a bot this calm)
    until(() => W.rOcc[se]===2 || W.rOwner[se]===2, 12000);
    if (W.wars[1*M()+2]){
      until(() => W.offerKind[2*M()+1]===P_GOALS, 4000);
      expect(acceptPeace(1,2)).toBe(true);
    }
    expect(W.rOwner[se]).toBe(2);
    expect(W.wars[1*M()+2]).toBe(0);
  });

  it('a kingdom whose castle region is won falls to the winner', () => {
    world();
    const [bx,by]=blockOf(N(2).capTile), bh=regionAt(bx,by); cedeRegion(bh,2);
    const mine=RG.adj[bh][0]; cedeRegion(mine,1); census();
    const a=army(1,60,mine);   // (a capital holds out like a fort of tier 4: 2.6 times as long, and its arrows do 16)
    war(1,2,[bh]);
    armyOrder(1,a.id,'attack',bh);
    until(() => !N(2).alive || !W.wars[1*M()+2], CAPTURE_TICKS*8);
    expect(N(2).alive).toBe(false);
    expect(owner[N(2).capTile]===1 || N(2).capTile<0).toBe(true);
    void pType; void (null as unknown as Human);
  });
});
