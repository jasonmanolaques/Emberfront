// Humans: spawning from the capital and switching between villager and soldier at a barracks.
import { B_HOUSE } from '../src/core/constants';
import { pAband } from '../src/sim/state';
import { describe, it, expect, beforeEach } from 'vitest';
import { TW, TH, PW, NP, B_BARRACKS, WAGE, WAGE_IDLE } from '../src/core/constants';
import { W, owner, isLand, pType } from '../src/sim/state';
import { build, plotProblem } from '../src/sim/buildings';
import { newWorld, startMatch, queueCommand, tick, grossIncome } from '../src/sim/sim';
import { setOwner } from '../src/sim/territory';
import { HUMAN_EVERY as E, H_SOLDIER, H_VILLAGER, T_SOLDIER, T_MILITIA, MILITIA_HP, TASK_ROAM, TASK_TO_TRAIN, TASK_INSIDE, doorOf, frontOf, switching as isSwitching, indoors } from '../src/sim/population';

const me = () => W.nations[1];
const mine = () => W.humans.filter(h => h.o === 1);
const count = (kind: number) => mine().filter(h => h.kind === kind).length;
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
const setShare = (share: number) => queueCommand({ type: 'soldiers', nation: 1, share });
const switching = () => mine().filter(isSwitching);   // walking to a barracks to switch role, or inside training

/** Builds a barracks on the free plot nearest the capital and returns its plot. */
function addBarracks(){
  const n=me(), cap=n.capPlot; let best=-1, bd=Infinity;
  for (let q=0;q<NP;q++){ if (plotProblem(n,q)) continue; const d=(q%PW-cap%PW)**2+((q/PW|0)-(cap/PW|0))**2; if (d<bd){ bd=d; best=q; } }
  n.stock=[5,5,0];
  if (!build(n,best,B_BARRACKS)) throw new Error('could not build a barracks');
  return best;
}

// grows the player's land into unclaimed ground (with no rivals there is nobody to fight)
function expand(rounds: number){
  for (let r=0;r<rounds;r++){
    let t=-1;
    for (let i=0;i<TW*TH && t<0;i++) if (W.nations[1] && !owner[i] && isLand[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1)) t=i;
    if (t>=0) queueCommand({ type: 'attack', nation: 1, tile: t, ratio: 0.8 });
    run(30);
  }
}
/** Gives the player the unclaimed land round its capital at once, room for everyone's house (so
    nobody turns beggar and starves while a test waits for people). */
function roomy(r = 24){
  const c=me().capTile, cx=c%TW, cy=(c/TW)|0;
  for (let y=Math.max(0,cy-r);y<=Math.min(TH-1,cy+r);y++) for (let x=Math.max(0,cx-r);x<=Math.min(TW-1,cx+r);x++){ const t=y*TW+x; if (!owner[t] && isLand[t]) setOwner(t,1); }
}
let barracks = -1;
function start(seed: number, rivals: number, withBarracks = true){
  newWorld(seed); W.rushUntil=0;
  for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (startMatch((TH/2+dy*3)*TW + TW/2+dx*3, rivals)){ roomy(); barracks = withBarracks ? addBarracks() : -1; return; }
  }
  throw new Error('no spawn spot');
}
// runs until ok() (a little while, so those busy with a load or a house can join in), and checks it
function soon(ok: () => boolean, max = 100){ for (let i=0;i<max && !ok();i++) tick(); expect(ok()).toBe(true); }
// runs until nobody is switching role, then returns how many ticks that took
function settle(max = 3000){ for (let i=0;i<max;i++){ if (!mine().some(isSwitching)) return i; tick(); } throw new Error('never settled'); }

describe('population', () => {
  beforeEach(() => start(12345, 0));

  it('releases one human from the capital every 20 seconds', () => {
    run(E-1);  expect(mine()).toHaveLength(0);
    run(1);   expect(mine()).toHaveLength(1);
    const [dx, dy] = doorOf(me()), h = mine()[0];
    expect(Math.hypot(h.x-dx, h.y-dy)).toBeLessThan(1);   // stepped out of the door
    run(E); expect(mine()).toHaveLength(2);
    run(8*E); expect(mine()).toHaveLength(10);
  });

  it('makes everyone a villager while the soldier share is 0%', () => {
    run(10*E);
    expect(count(H_VILLAGER)).toBe(10);
    expect(count(H_SOLDIER)).toBe(0);
  });

  it('sends the nearest half of 10 villagers into the barracks at 50%, and they come out as soldiers', () => {
    run(10*E); me().humanProg=-1e9;   // (nobody new arrives while they train: ten people, five of them soldiers, the barracks' room)
    const [dx, dy] = frontOf(barracks), dist = (h: { x: number; y: number }) => Math.hypot(h.x-dx, h.y-dy);
    const entered = new Map<number, number>(), stints: number[] = [];
    const lastTask = new Map(mine().map(h => [h.id, h.task]));
    setShare(0.5);
    for (let i=0;i<600 && stints.length<5;i++){
      tick();
      if (i===0){
        // those building their house finish it, so they are not picked
        const busy = (h: { home: number }) => h.home>=0;
        const walking = switching(), others = mine().filter(h => busy(h) && !isSwitching(h)).length;
        expect(walking.length).toBe(Math.min(5, 10-others));
        expect(walking.every(h => h.kind === H_VILLAGER)).toBe(true);
        expect(Math.max(...walking.map(dist))).toBeLessThanOrEqual(Math.min(...mine().filter(h => !isSwitching(h) && !busy(h)).map(dist)));
      }
      // each one goes inside for exactly 3 s (30 ticks) and comes back out as a soldier
      for (const h of mine()){
        const was = lastTask.get(h.id);
        if (h.task === TASK_INSIDE && was !== TASK_INSIDE) entered.set(h.id, W.tickN);
        if (h.task !== TASK_INSIDE && was === TASK_INSIDE){ stints.push(W.tickN - entered.get(h.id)!); expect(h.kind).toBe(H_SOLDIER); }
        lastTask.set(h.id, h.task);
      }
    }
    expect(stints.length).toBeGreaterThanOrEqual(3);
    expect(new Set(stints)).toEqual(new Set([30]));

    settle();
    expect(count(H_SOLDIER)).toBe(Math.round(0.5 * mine().length));
    expect(me().soldiers).toBe(count(H_SOLDIER));
  });

  it('spawns every newcomer as a villager out of the door of a lived-in house (the castle\'s gate while there are none): soldiers are trained at a barracks', () => {
    expect(E).toBe(100);   // (one every 10 s of the game's, 5 on the clock)
    const [dx, dy] = doorOf(W.nations[1]);
    while (mine().length < 1) tick();
    expect(Math.hypot(mine()[0].x-dx, mine()[0].y-dy)).toBeLessThan(6);   // (no house yet: out of the gate)
    run(10*E); setShare(0.42);
    for (let k=0;k<6;k++){
      const was=new Set(mine().map(h => h.id));
      while (mine().every(h => was.has(h.id))) tick();
      const homes=W.nations[1].blds.filter(q => pType[q]===B_HOUSE && !pAband[q]);
      const newest = mine().find(h => !was.has(h.id))!;
      expect(newest.kind).toBe(H_VILLAGER);
      expect(homes.length).toBeGreaterThan(0);
      expect(homes.some(q => { const [x,y]=frontOf(q); return Math.hypot(newest.x-x, newest.y-y)<1; })).toBe(true);   // (out of a house's door)
    }
  });

  it('trains only as many soldiers as the barracks have room for: no militia in peace, the rest stay villagers', () => {
    run(10*E); { const prog=me().humanProg; me().humanProg=-1e9; for (let i=0;i<800 && mine().some(h => h.home>=0);i++) tick(); me().humanProg=prog; }
    setShare(1);
    soon(() => switching().length>=5);
    expect(switching().filter(h => h.to===T_SOLDIER)).toHaveLength(5);   // the barracks' room
    expect(switching().filter(h => h.to===T_MILITIA)).toHaveLength(0);
    const due=W.nations[1].humanProg; W.nations[1].humanProg=-1e9;
    settle(); W.nations[1].humanProg=due;
    const n=W.nations[1];
    expect(n.soldiers).toBe(5); expect(n.militia).toBe(0);
    void MILITIA_HP; void grossIncome; void WAGE_IDLE;
  });

  it('without a barracks, trains nobody: there are no soldiers, and no militia in peace', () => {
    start(12345, 0, false);
    run(10*E); setShare(0.5); run(200);
    expect(switching()).toHaveLength(0);
    expect(me().soldiers).toBe(0);
  });

  it('turns soldiers back into villagers when the share is lowered', () => {
    run(10*E); setShare(0.5); tick(); settle();
    expect(count(H_SOLDIER)).toBeGreaterThan(0);
    setShare(0); tick(); settle();
    expect(count(H_SOLDIER)).toBe(0);
  });

  it('turns back walkers who are no longer needed when the share drops mid-walk', () => {
    run(10*E); setShare(1); tick();
    const walkers = mine().filter(h => h.task === TASK_TO_TRAIN).map(h => h.id);
    expect(walkers.length).toBeGreaterThan(0);
    setShare(0); tick();
    expect(walkers.every(id => W.humans.find(h => h.id === id)!.kind === H_VILLAGER)).toBe(true);
    expect(mine().filter(h => h.task === TASK_TO_TRAIN)).toHaveLength(0);   // only those already inside finish
  });

  it('stops new humans once the capital falls, while the barracks keeps training', () => {
    run(10*E); setShare(1); run(5);
    expect(switching().length).toBeGreaterThan(0);
    setOwner(me().capTile, 0);           // capital lost
    expect(me().capTile).toBe(-1);
    const before = mine().length;
    run(500);
    expect(mine().length).toBeLessThanOrEqual(before);
    expect(count(H_SOLDIER)).toBeGreaterThan(0);
  });

  it('stops training when the barracks is lost', () => {
    run(10*E); setShare(1); run(5);
    expect(switching().length).toBeGreaterThan(0);
    setOwner(barracks%PW*4+2 + ((barracks/PW|0)*4+2)*TW, 0);   // the ground under it is lost and it burns
    tick();
    expect(switching().filter(h => h.to===T_SOLDIER)).toHaveLength(0);   // nobody trains for it any more (those who still want arms go to the castle, as militia)
    expect(switching().every(h => h.to===T_MILITIA)).toBe(true);
    expect(pType[barracks]).toBe(B_BARRACKS);   // still burning for a moment
  });

  it('walks people around the castle walls instead of across them', () => {
    expand(12);   // the founding circle barely covers the castle's corners; give them room to walk round
    const n = me(), ox = (n.capPlot%PW)*8, oy = ((n.capPlot/PW)|0)*8;
    let onWalls = 0, samples = 0;
    for (let i=0;i<3000;i++){
      if (i===1200) setShare(0.6);
      if (i===2200) setShare(0.1);
      tick();
      for (const h of mine()){ if (indoors(h)) continue; samples++;
        if (h.x >= ox+1 && h.x < ox+15 && h.y >= oy+1 && h.y < oy+13) onWalls++; }
    }
    expect(samples).toBeGreaterThan(10000);
    expect(onWalls).toBe(0);
  });

  it('sets a villager down on his own ground when another kingdom takes the ground under him in peace: nobody is lost', () => {
    start(12345, 3);
    run(300);
    const h = mine().find(k => k.kind===H_VILLAGER)!;
    const t=((h.y/2)|0)*TW + ((h.x/2)|0);
    setOwner(t, 2);
    tick();
    expect(W.humans.includes(h)).toBe(true);
    expect(owner[((h.y/2)|0)*TW + ((h.x/2)|0)]).toBe(1);
  });
});

describe('population with bots', () => {
  it('never loses a person while the kingdom loses no land', () => {
    // seed 4242, spawned at tile 40500: bots expand into the unclaimed ground right next to the castle
    newWorld(4242); W.rushUntil=0; startMatch(40500, 9); setShare(0.5);
    let tiles = me().tiles, lost = 0;
    for (let i=0;i<3000;i++){
      const before = new Set(mine().filter(h => !h.beggar).map(h => h.id));   // (beggars can die of want)
      tick();
      const dead = [...before].filter(id => !W.humans.some(h => h.id === id)).length;
      if (me().tiles >= tiles) lost += dead;
      tiles = me().tiles;
    }
    expect(mine().length).toBeGreaterThan(5);
    expect(lost).toBe(0);
  });

  it('gives every kingdom its own people and plays out identically from the same seed', () => {
    const snapshot = () => JSON.stringify(W.humans) + '|' + W.nations.map(n => [n.villagers, n.soldiers, n.training].join(',')).join(';');
    start(987654321, 9); setShare(0.3); run(1500); const a = snapshot();
    const owners = new Set(W.humans.map(h => h.o));
    expect(owners.size).toBeGreaterThan(5);
    expect(W.humans.every(h => h.o === 1 || h.kind !== H_SOLDIER || W.nations[h.o].barracks>0)).toBe(true);   // (soldiers only where barracks trained them)
    start(987654321, 9); setShare(0.3); run(1500);
    expect(snapshot()).toBe(a);
  });
});
