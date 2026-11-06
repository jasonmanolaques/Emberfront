// A capital on a neck of land (Greece's on the small Europe map): the sea runs close on both sides of the
// castle, so its gate and the rest of the kingdom are cut apart by the walls unless people pass through.
import { describe, it, expect } from 'vitest';
import { TW, NT, B_BARRACKS, B_SMITHY } from '../src/core/constants';
import { W, owner, isLand } from '../src/sim/state';
import { newWorld, startMatch, tick, queueCommand } from '../src/sim/sim';
import { capitalsOn } from '../src/sim/realmap';
import { build, placeProblem } from '../src/sim/buildings';
import { R_INFANTRY } from '../src/sim/research';
import { units } from '../src/sim/army';
import { walkOf, frontOf, tileOf, doorOf } from '../src/sim/population';

const me = () => W.nations[1];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };

describe('a capital on a neck of land', () => {
  it('lets the smith reach barracks on the far side of the castle, and the walking field cover the whole town', () => {
    newWorld(5,'europe-s'); W.rushUntil=0;
    const gr=capitalsOn('europe-s').find(c => c.country.code==='GR')!;
    expect(startMatch(gr.tile,15,'GR','real')).toBe(true);
    const n=me(); n.tier[R_INFANTRY]=2;
    for (let r=0;r<14;r++){
      let t=-1;
      for (let i=0;i<NT && t<0;i++) if (!owner[i] && isLand[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1)) t=i;
      n.gold+=400; if (t>=0) queueCommand({ type:'attack', nation:1, tile:t, ratio:0.8 }); run(40);
    }
    n.stock=[300,300,300];
    const bs: number[]=[]; let s=-1;
    const own=(q: number) => owner[tileOf(...frontOf(q))]===1;   // (a plot whose doorstep is on their own ground)
    for (const q of n.plots) if (own(q) && bs.length<8 && !placeProblem(n,q,B_BARRACKS) && build(n,q,B_BARRACKS)){ bs.push(q); n.stock=[300,300,300]; }
    for (const q of n.plots) if (own(q) && !placeProblem(n,q,B_SMITHY) && build(n,q,B_SMITHY)){ s=q; break; }
    expect(bs.length).toBeGreaterThan(0); expect(s).toBeGreaterThanOrEqual(0);
    run(102);
    const f=walkOf(n).f, [dx,dy]=doorOf(n);
    expect(f.at(tileOf(dx,dy))).toBe(0);
    expect(f.at(tileOf(...frontOf(s)))).toBeGreaterThan(0);   // (the smithy and the barracks stand behind the castle)
    for (const u of units[1] ?? []) expect(f.at(tileOf(...frontOf(u.plots[0])))).toBeGreaterThan(0);
    for (let k=0;k<12;k++){ run(300); n.stock[2]=Math.max(n.stock[2],100); }
    expect((units[1] ?? []).reduce((k,u) => k+u.stored[2],0)).toBeGreaterThan(0);   // armour on the racks
  }, 60000);
});
