// The start of a match: 15 seconds in which every kingdom chooses the region it starts in.
import { describe, it, expect } from 'vitest';
import { TW, GAME_SPEED } from '../src/core/constants';
import { W, owner } from '../src/sim/state';
import { newWorld, tick } from '../src/sim/sim';
import { RG, region } from '../src/sim/regions';
import { beginPick, claimRegion, pickProblem, pickTick, endPick, picking, PICK_TICKS } from '../src/sim/pick';
import { COUNTRIES } from '../src/core/countries';

const regionOwned = (r: number, o: number) => { for (let i=RG.start[r];i<RG.start[r+1];i++) if (owner[RG.tiles[i]]!==o) return false; return true; };
const runPick = () => { while (!pickTick()); };

describe('choosing the starting region', () => {
  it('takes 15 seconds; the kingdoms are any countries, the bots drawn at random', () => {
    expect(PICK_TICKS).toBe(15*GAME_SPEED*10);
    newWorld(5,'europe-s');
    expect(beginPick('AU',63)).toBe(true);   // (Australia: no capital on the map, and it plays all the same)
    expect(W.nations.length-1).toBe(64);
    expect(W.nations[1].code).toBe('AU'); expect(W.nations[1].isPlayer).toBe(true);
    expect(new Set(W.nations.slice(1).map(n => n.code)).size).toBe(64);
    expect(W.nations.slice(1).every(n => COUNTRIES.some(k => k.code===n.code))).toBe(true);
  });

  it('gives a kingdom the whole region it claims at once, and moves it when it claims another; a region claimed by another can\'t be taken', () => {
    newWorld(5,'europe-s'); beginPick('FR',10);
    const open=picking!.open, [a,b]=open;
    expect(claimRegion(1,a)).toBe(true);
    expect(regionOwned(a,1)).toBe(true);
    expect(claimRegion(1,b)).toBe(true);   // a swap
    expect(regionOwned(b,1)).toBe(true);
    for (let i=RG.start[a];i<RG.start[a+1];i++) expect(owner[RG.tiles[i]]).toBe(0);   // (the first one let go)
    expect(claimRegion(2,b)).toBe(false);
    expect(pickProblem(2,b)).toMatch(/has claimed that region/);
    expect(pickProblem(2,0)).toMatch(/region on land/);
  });

  it('has the bots choose and keep moving, spread over the map, never two in one region', () => {
    newWorld(5,'europe-s'); beginPick('DE',63);
    const moves: number[]=[0,0];
    let seen=0;
    while (!pickTick()){ seen++; if (seen===60) moves[0]=picking!.of.slice(2).filter(r => r).length; }
    expect(moves[0]).toBeGreaterThan(40);   // (most have chosen within three seconds)
    const P=picking!, held=[...P.of.slice(1)].filter(r => r);
    expect(new Set(held).size).toBe(held.length);
    // spread out: no two kingdoms' regions crowded together
    const at=(r: number) => [RG.flag[r]%TW, (RG.flag[r]/TW)|0];
    let close=0; for (let i=0;i<held.length;i++) for (let j=i+1;j<held.length;j++){ const [x,y]=at(held[i]), [u,v]=at(held[j]); if (Math.hypot(x-u,y-v)<P.ideal*0.35) close++; }
    expect(close).toBeLessThan(4);
  });

  it('founds everyone in the region it holds when the time is up, owning all of it, its castle in it; the player who chose nothing gets the best region left', () => {
    newWorld(5,'europe-s'); beginPick('PL',63);
    runPick();
    expect(picking!.of[1]).toBe(0);   // (the player let the time run out)
    endPick();
    expect(picking).toBeNull();
    const regs=new Set<number>();
    for (const n of W.nations.slice(1)){
      expect(n.alive).toBe(true);
      const r=region[n.capTile]; regs.add(r);
      expect(W.rOwner[r]).toBe(n.id);
      expect(regionOwned(r,n.id)).toBe(true);
      expect(n.tiles).toBe(RG.land[r]);
    }
    expect(regs.size).toBe(64);   // one region each
    for (let i=0;i<200;i++) tick();   // (and the game runs from there)
    expect(W.nations.slice(1).every(n => n.alive)).toBe(true);
  });
});
