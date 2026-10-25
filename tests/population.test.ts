// Humans: spawning from the capital and switching between villager and soldier at a barracks.
import { describe, it, expect, beforeEach } from 'vitest';
import { TW, TH, PW, NP, B_BARRACKS } from '../src/core/constants';
import { W, owner, isLand, pType } from '../src/sim/state';
import { build, plotProblem } from '../src/sim/buildings';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { setOwner } from '../src/sim/territory';
import { H_SOLDIER, H_VILLAGER, TASK_ROAM, TASK_TO_TRAIN, TASK_INSIDE, doorOf, frontOf, switching as isSwitching, indoors } from '../src/sim/population';

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
let barracks = -1;
function start(seed: number, rivals: number, withBarracks = true){
  newWorld(seed);
  for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (startMatch((TH/2+dy*3)*TW + TW/2+dx*3, rivals)){ barracks = withBarracks ? addBarracks() : -1; return; }
  }
  throw new Error('no spawn spot');
}
// runs until nobody is switching role, then returns how many ticks that took
function settle(max = 3000){ for (let i=0;i<max;i++){ if (!mine().some(isSwitching)) return i; tick(); } throw new Error('never settled'); }

describe('population', () => {
  beforeEach(() => start(12345, 0));

  it('releases one human from the capital every 10 seconds', () => {
    run(99);  expect(mine()).toHaveLength(0);
    run(1);   expect(mine()).toHaveLength(1);
    const [dx, dy] = doorOf(me()), h = mine()[0];
    expect(Math.hypot(h.x-dx, h.y-dy)).toBeLessThan(1);   // stepped out of the door
    run(100); expect(mine()).toHaveLength(2);
    run(800); expect(mine()).toHaveLength(10);
  });

  it('makes everyone a villager while the soldier share is 0%', () => {
    run(1000);
    expect(count(H_VILLAGER)).toBe(10);
    expect(count(H_SOLDIER)).toBe(0);
  });

  it('sends the nearest half of 10 villagers into the barracks at 50%, and they come out as soldiers', () => {
    run(1000);
    const [dx, dy] = frontOf(barracks), dist = (h: { x: number; y: number }) => Math.hypot(h.x-dx, h.y-dy);
    const entered = new Map<number, number>(), stints: number[] = [];
    const lastTask = new Map(mine().map(h => [h.id, h.task]));
    setShare(0.5);
    for (let i=0;i<600 && stints.length<5;i++){
      tick();
      if (i===0){
        // villagers carrying a load deliver it first, so they are not picked
        const walking = switching(), carrying = mine().filter(h => h.carry>=0 && !isSwitching(h)).length;
        expect(walking.length).toBe(Math.min(5, 10-carrying));
        expect(walking.every(h => h.kind === H_VILLAGER)).toBe(true);
        expect(Math.max(...walking.map(dist))).toBeLessThanOrEqual(Math.min(...mine().filter(h => !isSwitching(h) && h.carry<0).map(dist)));
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

  it('spawns newcomers as soldiers at the barracks while the kingdom is short of them', () => {
    run(1000); setShare(1); tick();
    expect(switching().length).toBeGreaterThan(5);
    while (mine().length < 11) tick();
    const newest = mine().reduce((a, b) => a.id > b.id ? a : b), [bx, by] = frontOf(barracks);
    expect(newest.kind).toBe(H_SOLDIER);
    expect(newest.task).toBe(TASK_ROAM);   // born a soldier, no detour to train
    expect(Math.hypot(newest.x-bx, newest.y-by)).toBeLessThan(15);   // came out of the barracks, not the capital
  });

  it('makes no soldiers at all without a barracks', () => {
    start(12345, 0, false);
    run(1000); setShare(1); run(600);
    expect(count(H_SOLDIER)).toBe(0);
    expect(switching()).toHaveLength(0);
  });

  it('counts a born soldier toward the target, so one fewer villager has to convert', () => {
    run(1000); setShare(0.5);
    // the 11th human is due next tick; at 50% of 11 the kingdom wants 6 soldiers
    run(99); tick();
    expect(mine()).toHaveLength(11);
    settle();
    expect(count(H_SOLDIER)).toBe(6);
    expect(count(H_VILLAGER)).toBe(5);
  });

  it('turns soldiers back into villagers when the share is lowered', () => {
    run(1000); setShare(0.5); tick(); settle();
    expect(count(H_SOLDIER)).toBeGreaterThan(0);
    setShare(0); tick(); settle();
    expect(count(H_SOLDIER)).toBe(0);
  });

  it('turns back walkers who are no longer needed when the share drops mid-walk', () => {
    run(1000); setShare(1); tick();
    const walkers = mine().filter(h => h.task === TASK_TO_TRAIN).map(h => h.id);
    expect(walkers.length).toBeGreaterThan(0);
    setShare(0); tick();
    expect(walkers.every(id => W.humans.find(h => h.id === id)!.kind === H_VILLAGER)).toBe(true);
    expect(mine().filter(h => h.task === TASK_TO_TRAIN)).toHaveLength(0);   // only those already inside finish
  });

  it('stops new humans once the capital falls, while the barracks keeps training', () => {
    run(1000); setShare(1); run(5);
    expect(switching().length).toBeGreaterThan(0);
    setOwner(me().capTile, 0);           // capital lost
    expect(me().capTile).toBe(-1);
    const before = mine().length;
    run(500);
    expect(mine().length).toBeLessThanOrEqual(before);
    expect(count(H_SOLDIER)).toBeGreaterThan(0);
  });

  it('stops training when the barracks is lost', () => {
    run(1000); setShare(1); run(5);
    expect(switching().length).toBeGreaterThan(0);
    setOwner(barracks%PW*4+2 + ((barracks/PW|0)*4+2)*TW, 0);   // the ground under it is lost and it burns
    tick();
    expect(switching()).toHaveLength(0);
    expect(pType[barracks]).toBe(B_BARRACKS);   // still burning for a moment
  });

  it('walks people around the castle walls instead of across them', () => {
    expand(8);   // the founding circle barely covers the castle's corners; give them room to walk round
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

  it('kills a human when another kingdom takes the ground under them', () => {
    start(12345, 3);
    run(300);
    const h = mine()[0];
    setOwner(((h.y/2)|0)*TW + ((h.x/2)|0), 2);
    tick();
    expect(W.humans.find(x => x.id === h.id)).toBeUndefined();
  });
});

describe('population with bots', () => {
  it('never loses a person while the kingdom loses no land', () => {
    // seed 4242, spawned at tile 40500: bots expand into the unclaimed ground right next to the castle
    newWorld(4242); startMatch(40500, 9); setShare(0.5);
    let tiles = me().tiles, lost = 0;
    for (let i=0;i<1500;i++){
      const before = new Set(mine().map(h => h.id));
      tick();
      const dead = [...before].filter(id => !W.humans.some(h => h.id === id)).length;
      if (me().tiles >= tiles) lost += dead;
      tiles = me().tiles;
    }
    expect(mine().length).toBeGreaterThan(10);
    expect(lost).toBe(0);
  });

  it('gives every kingdom its own people and plays out identically from the same seed', () => {
    const snapshot = () => JSON.stringify(W.humans) + '|' + W.nations.map(n => [n.villagers, n.soldiers, n.training].join(',')).join(';');
    start(987654321, 9); setShare(0.3); run(1500); const a = snapshot();
    const owners = new Set(W.humans.map(h => h.o));
    expect(owners.size).toBeGreaterThan(5);
    expect(W.humans.some(h => h.o !== 1 && h.kind === H_SOLDIER)).toBe(true);
    start(987654321, 9); setShare(0.3); run(1500);
    expect(snapshot()).toBe(a);
  });
});
