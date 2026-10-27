// Barracks armies, soldier tiers, armour and the blacksmith.
import { describe, it, expect } from 'vitest';
import { listen } from '../src/sim/events';
import { TW, TH, NT, PW, B_BARRACKS, B_SMITHY, B_TOWER } from '../src/core/constants';
import { W, owner, isLand, pArmor, pType, pOwner, pTimer, type Human } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { build, placeProblem } from '../src/sim/buildings';
import { H_SOLDIER, H_VILLAGER, REHIRE_TICKS, FORGE_TICKS, makeHuman, doorOf, frontOf } from '../src/sim/population';
import { units, unitAt, UNIT_SIZE, SOLDIER_HP } from '../src/sim/army';
import { R_INFANTRY } from '../src/sim/research';
import { available } from '../src/sim/war';

const me = () => W.nations[1];
const mine = () => W.humans.filter(h => h.o === 1);
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
function until(ok: () => boolean, max = 6000){ for (let i=0;i<max;i++){ if (ok()) return; tick(); } throw new Error('condition never met'); }
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
    me().gold+=400;
    if (t>=0) queueCommand({ type: 'attack', nation: 1, tile: t, ratio: 0.8 });
    run(40);
  }
}
const cap = (q: number) => { const c=me().capPlot; return (q%PW-c%PW)**2+((q/PW|0)-(c/PW|0))**2; };
/** Builds `type` on the free plot nearest the capital (or the one given). */
function place(type: number, q?: number){
  me().stock=[100,100,100];
  q ??= me().plots.filter(k => !placeProblem(me(),k,type)).sort((a,b) => cap(a)-cap(b) || a-b)[0];
  if (!build(me(),q,type)) throw new Error('could not build');
  return q;
}
/** k soldiers standing at the castle gate. */
function soldiers(k: number){
  const [x,y]=doorOf(me()), out: Human[]=[];
  for (let i=0;i<k;i++){ const h=makeHuman(me(),H_SOLDIER,x+(i%5)-2,y+1); W.humans.push(h); out.push(h); }
  me().soldierShare=mine().filter(h => h.kind===H_SOLDIER).length/mine().length; me().humanProg=-1e9;   // keep them soldiers, and nobody new arrives
  return out;
}

describe('barracks armies', () => {
  it('joins barracks side by side into one army of 5 per module; barracks apart are separate armies', () => {
    start(12345); expand(6);
    const a=place(B_BARRACKS), b=place(B_BARRACKS, [a+1,a-1,a+PW,a-PW].find(k => !placeProblem(me(),k,B_BARRACKS))!);
    const far=me().plots.filter(k => !placeProblem(me(),k,B_BARRACKS)).sort((x,y) => cap(y)-cap(x))[0];
    place(B_BARRACKS, far);
    tick();
    const U=units[1];
    expect(U.map(u => u.cap).sort()).toEqual([10, 5].map(k => k*1).sort());
    expect(unitAt(a)).toBe(unitAt(b));
    expect(unitAt(a)!.plots).toHaveLength(2);
    expect(UNIT_SIZE).toBe(5);
  });

  it('stations as many soldiers as the barracks hold; the rest patrol the city, guard towers and only defend', () => {
    start(12345); expand(6);
    const b=place(B_BARRACKS), t=place(B_TOWER);
    const men=soldiers(8); run(2);
    expect(men.filter(h => h.base>=0)).toHaveLength(5);
    expect(available(me()).map(a => a.men.length)).toEqual([5]);   // only they can march
    queueCommand({ type:'priority', nation:1, plot:t }); run(2);
    const guards=men.filter(h => h.post===t);
    expect(guards).toHaveLength(3);
    expect(guards.every(h => h.base<0)).toBe(true);                 // tower guards come from the patrol
    run(300);
    const [bx,by]=frontOf(b);
    for (const h of men.filter(h => h.base>=0)) expect(Math.hypot(h.x-bx,h.y-by)).toBeLessThan(16);
  });
});

describe('filling the ranks', () => {
  it('gives a fallen soldier\'s place to a new recruit, never to a watchtower guard', () => {
    start(12345); expand(6);
    place(B_BARRACKS); const t=place(B_TOWER);
    const men=soldiers(8); run(2);
    queueCommand({ type:'priority', nation:1, plot:t }); run(2);
    const army=men.filter(h => h.base>=0), guards=men.filter(h => h.post===t);
    expect([army.length, guards.length]).toEqual([5, 3]);
    army[0].hp=0; run(5);
    expect(guards.every(h => h.base<0 && h.post===t)).toBe(true);   // the guards stay at their tower
    expect(units[1][0].members).toHaveLength(4);
    const [x,y]=doorOf(me()), recruit=makeHuman(me(),H_SOLDIER,x,y+1); W.humans.push(recruit); run(2);
    expect(recruit.base).toBeGreaterThanOrEqual(0);                    // the new recruit takes the place
    expect(units[1][0].members).toHaveLength(5);
  });
});

describe('soldier tiers and the blacksmith', () => {
  function armoury(k: number){
    start(12345); expand(8);
    const b=place(B_BARRACKS), men=soldiers(k); run(5);
    const s=place(B_SMITHY);
    for (let i=0;i<300 && !mine().some(h => h.work===s);i++) run(1);   // a villager takes the job
    const smith=mine().find(h => h.work===s)!;
    return { b, s, men, smith };
  }

  it('takes a villager as its smith, who does nothing until infantry research allows it', () => {
    const { smith, men }=armoury(5);
    expect(smith.kind).toBe(H_VILLAGER);
    me().stock=[0,0,20]; run(400);
    expect(me().stock[2]).toBe(20);
    expect(men.every(h => h.tier===1 && h.hp===SOLDIER_HP[1])).toBe(true);
  });

  it('fetches a copper from the castle, forges 5 seconds, and brings the armour to the barracks, where a soldier puts it on', () => {
    const { b, smith, men }=armoury(5);
    me().tier[R_INFANTRY]=2; me().stock=[0,0,20];
    until(() => smith.load===1, 2000);
    expect(me().stock[2]).toBe(15);                 // 5 copper taken from the store
    until(() => smith.load===2, 1000);              // forged
    until(() => men.some(h => h.tier===2), 1500);   // delivered, and worn
    const t2=men.find(h => h.tier===2)!;
    expect(SOLDIER_HP[2]).toBe(10);
    until(() => t2.hp>=10, 400);
    expect(FORGE_TICKS).toBe(50);
    // reinforced armour for every rack, then no more
    until(() => men.every(h => h.tier===2), 8000);
    let made=0; listen({ forged: () => { made++; } });
    run(1500);
    expect(made).toBe(0);                            // nothing more to make
    expect(pArmor[2][b]+pArmor[3][b]).toBe(0);
    listen({ forged: () => {} });
  });

  it('with heavy armour researched, fills every rack with reinforced first, then replaces it with heavy', () => {
    const { men }=armoury(5);
    me().tier[R_INFANTRY]=3; me().stock=[0,0,40];
    until(() => men.some(h => h.tier>=2), 3000);
    expect(men.some(h => h.tier===3)).toBe(false);   // reinforced comes first
    until(() => men.every(h => h.tier===2) || men.some(h => h.tier===3), 9000);
    expect(men.every(h => h.tier>=2)).toBe(true);    // every rack got reinforced before any heavy
    until(() => men.every(h => h.tier===3), 9000);
    expect(men[0].hp).toBeLessThanOrEqual(SOLDIER_HP[3]);
    expect(SOLDIER_HP[3]).toBe(15);
  });

  it('a soldier who goes back to work leaves his armour on the racks', () => {
    const { b, men }=armoury(5);
    for (const h of men) h.tier=2;
    me().soldierShare=0; until(() => mine().filter(h => h.kind===H_SOLDIER).length===0, 3000);
    expect(pArmor[2][b]).toBe(5);
  });

  it('finds a new smith 5 seconds after the old one falls', () => {
    const { s, smith }=armoury(5);
    smith.hp=0; run(1);
    expect(pTimer[s]).toBeGreaterThan(0);
    run(REHIRE_TICKS-5); expect(mine().filter(h => h.work===s)).toHaveLength(0);
    until(() => mine().some(h => h.work===s), 600);   // the first villager free after that (not one building his house)
    expect(mine().filter(h => h.work===s)).toHaveLength(1);
    expect([pType[s], pOwner[s]]).toEqual([B_SMITHY, 1]);
  });
});
