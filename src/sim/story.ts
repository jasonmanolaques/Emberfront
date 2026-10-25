/* ---------- story events: moments in a kingdom's life that change what its people do ----------
   Each story is checked now and then for every kingdom; when its moment comes it acts on the
   world and announces itself (on.story), and the UI tells it in the message log (ui/story.ts).
   Every story keeps its own cooldown per kingdom so it doesn't repeat too often.
   Add a story by adding an entry to STORIES. */
import { PW, B_HOUSE } from '../core/constants';
import { W, pType, pOwner, pBurn } from './state';
import { on } from './events';
import { atWar, raiseMob } from './war';
import { H_SOLDIER, indoors } from './population';

export interface Story {
  id: string;
  every: number;      // ticks between checks
  cooldown: number;   // ticks after it happens before it can happen again in the same kingdom
  /** Looks at kingdom o; if the moment has come, acts and returns where [x, y, other kingdom], else null. */
  check(o: number): [number, number, number] | null;
}

/** Houses of kingdom o standing within r plots of plot q. */
function housesNear(o: number, q: number, r: number){
  const px=q%PW, py=(q/PW)|0; let k=0;
  for (let y=py-r;y<=py+r;y++) for (let x=px-r;x<=px+r;x++){ const k2=y*PW+x; if (k2>=0 && k2<pType.length && pType[k2]===B_HOUSE && pOwner[k2]===o && pBurn[k2]<=0) k++; }
  return k;
}

const MOB_NEAR_CASTLE = 36;   // pixels: an enemy soldier this close to the castle
const MOB_TOWN = 4;           // houses within 3 plots of a building under attack make it a town
const MOB_GATHER = 64;        // pixels around the danger the villagers rise

/** The mob: with the enemy at the castle gate, or burning a crowded part of town, the villagers
    nearby drop everything and swarm the attackers. */
const mob: Story = {
  id: 'mob', every: 10, cooldown: 900,
  check(o){
    const n=W.nations[o];
    for (const h of W.humans){
      if (h.kind!==H_SOLDIER || h.hp<=0 || indoors(h) || h.o===o || !atWar(o,h.o)) continue;
      const nearCastle = n.capTile>=0 && (() => { const q=n.capPlot, x=(q%PW)*8+8, y=((q/PW)|0)*8+8; return (h.x-x)**2+(h.y-y)**2<MOB_NEAR_CASTLE**2; })();
      const sacking = h.aim>=0 && pOwner[h.aim]===o && housesNear(o,h.aim,3)>=MOB_TOWN;
      if (!nearCastle && !sacking) continue;
      if (raiseMob(o,h.x,h.y,MOB_GATHER,true)<3) continue;   // too few people about to make a mob
      raiseMob(o,h.x,h.y,MOB_GATHER);
      return [h.x,h.y,h.o];
    }
    return null;
  },
};

export const STORIES: Story[] = [mob];

let next: Int32Array[] = [];   // per story: tick from which it may happen again, per kingdom
export function resetStories(M: number){ next=STORIES.map(() => new Int32Array(M)); }

export function updateStories(){
  const N=W.nations;
  STORIES.forEach((s,i) => {
    if (W.tickN%s.every) return;
    const due=next[i]; if (!due || due.length!==W.M) return;
    for (let o=1;o<N.length;o++){
      if (!N[o].alive || W.tickN<due[o]) continue;
      const hit=s.check(o); if (!hit) continue;
      due[o]=W.tickN+s.cooldown;
      on.story(s.id,o,hit[0],hit[1],hit[2]);
    }
  });
}
