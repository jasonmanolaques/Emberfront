/* ---------- research: stations earn points, the kingdom studies one topic at a time ----------
   Each research station earns 1 research point a second, all of them going to the one topic the
   kingdom is studying (housing until it picks another). Every topic starts at tier 1 and goes up
   to tier 3: 50 points to reach tier 2, 100 more for tier 3. What is learned stays learned, even
   if every station burns.
   Housing lets the builders guild turn hovels into stone houses (tier 2) and manors (tier 3);
   taxation raises each villager's tax by 0.1 gold a second per tier. */
import { TICK } from '../core/constants';
import { W, type Nation } from './state';
import { on } from './events';

export const R_HOUSING = 0, R_TAXES = 1;
export const TOPIC_NAME = ['Housing', 'Taxation'];
export const MAX_TIER = 3;
export const TIER_XP = [0, 50, 100];   // points to go from tier t to t+1, by t
export const XP_PER_STATION = 1;      // points a second each research station earns
/** People a house of each tier holds, and how many blows it takes compared with a hovel. */
export const HOUSE_BEDS = [1, 1, 2, 3], HOUSE_TOUGH = [1, 1, 3, 6];

export const maxed = (n: Nation, topic: number) => n.tier[topic]>=MAX_TIER;
/** Points still needed for the topic's next tier (0 once it is at the top). */
export const xpNeeded = (n: Nation, topic: number) => maxed(n,topic) ? 0 : TIER_XP[n.tier[topic]];

/** Switches what kingdom n studies; progress made on the other topic is kept. */
export function setStudy(n: Nation, topic: number){
  if (topic!==R_HOUSING && topic!==R_TAXES) return;
  if (!maxed(n,topic)) n.study=topic;
}

export function updateResearch(){
  const N=W.nations;
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive || !n.labs) continue;
    // a finished topic gives way to one that isn't
    if (maxed(n,n.study)){ const other=n.study^1; if (maxed(n,other)) continue; n.study=other; }
    const t=n.study;
    n.xp[t]+=Math.round(n.labs*XP_PER_STATION*TICK*10);   // tenths of a point, so the sums stay exact
    if (n.xp[t]>=TIER_XP[n.tier[t]]*10){
      n.xp[t]-=TIER_XP[n.tier[t]]*10; n.tier[t]++;
      if (maxed(n,t)) n.xp[t]=0;
      on.researched(n.id,t,n.tier[t]);
    }
  }
}
