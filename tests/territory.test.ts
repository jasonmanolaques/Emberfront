// A kingdom's border spreads over unclaimed land without leaving empty squares inside it.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT } from '../src/core/constants';
import { W, owner, isLand } from '../src/sim/state';
import { newWorld, startMatch, tick } from '../src/sim/sim';
import { launch } from '../src/sim/territory';

function start(seed: number, rivals: number){
  newWorld(seed);
  for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (startMatch((TH/2+dy*3)*TW + TW/2+dx*3, rivals)) return;
  }
  throw new Error('no spawn spot');
}
/** Pockets of unclaimed land (up to 400 tiles) with one kingdom's land all round them (`of`: only that kingdom's). */
function pockets(of=0){
  const seen=new Uint8Array(NT), found: number[]=[];
  for (let t=0;t<NT;t++){
    if (!isLand[t] || owner[t] || seen[t]) continue;
    const q=[t]; seen[t]=1; let who=-1, closed=true;
    for (let i=0;i<q.length;i++){
      const c=q[i], x=c%TW;
      for (const n of [x>0 ? c-1 : -1, x<TW-1 ? c+1 : -1, c>=TW ? c-TW : -1, c<NT-TW ? c+TW : -1]){
        if (n<0){ closed=false; continue; }
        if (!isLand[n]) continue;
        if (!owner[n]){ if (!seen[n]){ seen[n]=1; q.push(n); } }
        else if (who<0) who=owner[n]; else if (who!==owner[n]) closed=false;
      }
    }
    if (closed && who>0 && q.length<=400 && (!of || who===of)) found.push(q.length);
  }
  return found;
}

describe('the border spreading', () => {
  it('leaves (next to) no empty squares inside the land it has taken, filled by the spread itself', () => {
    for (const seed of [4242, 987654321, 12345]){
      start(seed,4); 
      expect(pockets()).toEqual([]);   // (the first land has none)
      const me=W.nations[1], before=me.tiles;
      for (let i=0;i<8;i++){ me.gold=300; launch(1,0,300); for (let k=0;k<400;k++) tick(); }
      expect(me.tiles).toBeGreaterThan(before+500);   // (it did spread)
      expect(pockets(1).reduce((a,b) => a+b,0)).toBeLessThanOrEqual(3);   // (the kingdom whose border we spread)
      expect(pockets().reduce((a,b) => a+b,0)).toBeLessThanOrEqual(30);   // (and the bots', which spread by their own moods and gold: a few holes now and then, never a lot)
      //   (the front prefers ground the border has wound round, so holes fill as it goes; the odd tile may be left where the gold ran out)
    }
  });
});
