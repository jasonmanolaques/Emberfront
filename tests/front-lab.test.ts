// How the men behave on a front, measured on borders of every shape (tests/lab/lab.ts): they stand on the line and fight there, evenly spread,
// and ground changes hands by the balance of power at each stretch of the front.
import { describe, it, expect } from 'vitest';
import { W } from '../src/sim/state';
import { tick } from '../src/sim/sim';
import { H_SOLDIER } from '../src/sim/population';
import { declare, offensiveFront, F_READY } from '../src/sim/war';
import { DENSITY, RESERVE_LINE } from '../src/sim/front';
import { world, shape, fight, soldiers, noDraft, N, type Report } from './lab/lab';

const straight = (x: number, _y: number, mx: number) => x<mx ? 1 : 2;
const go = (who: Parameters<typeof shape>[0], A: number, D: number, ticks=3000): Report => { world(1); shape(who); return fight('lab',A,D,ticks); };

describe('the men of a front', () => {
  it('stand at their places on the line (not across it), evenly, without clumping, in a war of equals', () => {
    const r=go(straight,20,20,1200);   // (while both sides still have their men: a war of equals ends with one side wiped out, and a lone survivor is all that is left to measure)
    expect(r.atkInPlace).toBeGreaterThan(0.5);   // (every enemy soldier near counts against a stretch: a war of equals is a grind at the line, and men step out to meet the enemy)
    expect(r.atkOutside).toBeLessThan(0.05);          // none out on the enemy's free ground (bar the odd man at a tile just retaken)
    expect(r.clump).toBeLessThan(0.01);
    expect(r.crossings).toBeLessThan(2.5);           // no running in and out of the border zone (a man crosses a few times in all, as the line moves)
    expect(r.fightFar).toBeLessThan(0.1);             // the blows are struck at the line
    expect(r.defNear).toBeGreaterThan(0.9);           // and the defenders are at it too
  });
  it('keep to ground their side holds on every shape of border: corners, bays, enclaves, a sea gap', () => {
    const shapes: [string, Parameters<typeof shape>[0]][]=[
      ['sawtooth', (x,y,mx) => x<mx+((((y|0)%16)<8) ? 6 : -6) ? 1 : 2],
      ['diagonal', (x,y,mx,my) => (x-mx)*0.8+(y-my)*0.6<0 ? 1 : 2],
      ['defender enclave', (x,y,mx,my) => Math.hypot(x-(mx-20),y-my)<9 ? 2 : (x<mx ? 1 : 2)],
      ['sea gap', (x,y,mx,my) => Math.abs(y-my)<4 ? 0 : (x<mx ? 1 : 2)],
    ];
    for (const [name,who] of shapes){ const r=go(who,20,20); expect(r.atkOutside, name).toBeLessThan(0.06); expect(r.atkInPlace, name).toBeGreaterThan(0.45); expect(r.clump, name).toBeLessThan(0.02); }
  });
  it('are not all sent running when a man falls: a place moves only a little at a time', () => {
    const r=go(straight,16,16);
    expect(r.atkInPlace).toBeGreaterThan(0.75);
    expect(r.crossings).toBeLessThan(2.5);
  });
});

describe('the balance of power on the front', () => {
  it('takes no ground from the stronger defence, and the outmatched side does not push on', () => {
    expect(go(straight,10,40).gained).toBe(0);
    expect(go(straight,5,100).gained).toBe(0);
  });
  it('grinds slowly at even strength, and breaks through when it is several times as strong', () => {
    const even=go(straight,20,20), strong=go(straight,60,20);
    expect(even.gained).toBeGreaterThan(50); expect(even.gained).toBeLessThan(strong.gained);
    expect(strong.gained).toBeGreaterThan(3000);
  });
  it('counts the soldiers in the fight, not the soldiers on the landmass: defenders at home add nothing to a front they are not at', () => {
    // 20 men against a kingdom with 20 soldiers standing about at home (none sent to the border) take ground as fast as against none
    world(1); shape(straight); const idle=fight('idle',20,0,1500).gained;
    expect(idle).toBeGreaterThan(1000);
  });
});

describe('a big army on a short front', () => {
  it('puts only so many on the line (2.5 to a tile of it): the rest wait behind it, spread out, not in one block', () => {
    world(1); shape((x,y,mx,my) => Math.abs(y-my)<3 ? (x<mx ? 1 : 2) : (x<mx-4 ? 1 : x>mx+4 ? 2 : 0));   // the two kingdoms meet in a neck 6 tiles wide
    soldiers(N(1),80); noDraft(1); noDraft(2); tick();
    expect(declare(1,2,80)).toBe(true);
    for (let i=0;i<4000 && W.offensive[1*W.M+2]!==F_READY;i++) tick();
    for (let i=0;i<300;i++) tick();
    const F=offensiveFront(1,2)!.F!, men=W.humans.filter(h => h.o===1 && h.kind===H_SOLDIER && h.war>=0 && h.fk>=0);
    const onLine=men.filter(h => h.line<RESERVE_LINE), waiting=men.filter(h => h.line>=RESERVE_LINE);
    expect(onLine.length).toBeLessThanOrEqual(Math.ceil(F.len*DENSITY)+1);
    expect(waiting.length).toBeGreaterThanOrEqual(80-Math.ceil(F.len*DENSITY)-2);   // (all the rest wait)
    expect(waiting.length).toBeGreaterThan(10);
    // the reserves are well behind the line, and spread over a good deal of ground: no two on top of each other
    let nearest=Infinity; for (const a of waiting) for (const b of waiting) if (a!==b) nearest=Math.min(nearest,Math.hypot(a.fx-b.fx,a.fy-b.fy));
    expect(nearest).toBeGreaterThan(1);
  });
});
