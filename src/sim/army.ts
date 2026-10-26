/* ---------- armies: each barracks keeps an army of its own ----------
   Barracks plots side by side join into one barracks; each plot of it (a module) houses 5
   soldiers and has 5 armour racks. The soldiers a barracks has room for are its army: they wait
   in front of it and march out together, one army per barracks, so a kingdom with two barracks
   in different places has two armies, and four modules joined together make one army of 20.
   Soldiers with no room in any barracks patrol the city and only ever defend.
   Soldiers come in three tiers: archaic (tier 1, everyone starts there), reinforced (tier 2)
   and heavy armour (tier 3). The blacksmith forges armour once infantry research allows it and
   carries it to the barracks; a soldier of that barracks who comes by takes the best piece on the
   racks that beats what he wears, and his old armour is thrown away. Reinforced armour comes
   first, for every rack of the barracks; only then heavy armour, which replaces it. */
import { PW, PH, B_BARRACKS } from '../core/constants';
import { W, pType, pOwner, pBurn, pArmor, type Human, type Nation } from './state';
import { on } from './events';
import { R_INFANTRY } from './research';

export const UNIT_SIZE = 5;                         // soldiers and armour racks per barracks module
export const SOLDIER_HP = [0, 8, 10, 15];           // by tier
export const SOLDIER_DMG = [0, 1, 1.5, 2];          // a blow, by tier
export const VILLAGER_HP = 4;
export const TIER_NAME = ['', 'I', 'II', 'III'];
const H_SOLDIER = 1;                                // (population.ts; repeated here to keep this module standalone)
const RACK_R = 14;                                  // pixels from a barracks door a soldier picks up armour

/** One barracks (joined modules) and its army. */
export interface Unit {
  key: number;           // its first plot: names it while its modules stay the same
  o: number; plots: number[]; cap: number;
  x: number; y: number;  // where its army gathers: in front of its middle module, in pixels
  members: Human[];      // soldiers of its army, home or away
  home: number;          // of them, at the barracks (not out on campaign)
  tiers: number[];       // members by tier [_, I, II, III]
  stored: number[];      // armour on the racks by tier [_, _, II, III]
}
export let units: Unit[][] = [];                    // per kingdom, rebuilt every tick
const unitOf = new Map<number, Unit>();             // barracks plot -> its unit
export const unitAt = (q: number) => unitOf.get(q);
export const maxHp = (h: Human) => h.kind===H_SOLDIER ? SOLDIER_HP[h.tier] : VILLAGER_HP;
const frontOf = (q: number): [number, number] => [(q%PW)*8+4, ((q/PW)|0)*8+7.5];
const standing = (q: number, o: number) => pType[q]===B_BARRACKS && pOwner[q]===o && pBurn[q]<=0;

/** "4/5 · 3 I · 1 II · 1 III": soldiers at the barracks over its room, then the army by tier. */
export function unitLabel(u: Unit){
  const t=[1,2,3].filter(k => u.tiers[k]).map(k => `${u.tiers[k]} ${TIER_NAME[k]}`);
  return [`${u.home}/${u.cap}`, ...t].join(' · ');
}

/** Joins every kingdom's standing barracks plots into barracks (4-neighbours). */
export function buildUnits(){
  units=W.nations.map(() => []); unitOf.clear();
  for (const n of W.nations){
    if (!n.alive) continue;
    const plots=n.blds.filter(q => standing(q,n.id)).sort((a,b) => a-b);
    for (const q0 of plots){
      if (unitOf.has(q0)) continue;
      const u: Unit={ key:q0, o:n.id, plots:[], cap:0, x:0, y:0, members:[], home:0, tiers:[0,0,0,0], stored:[0,0,0,0] };
      const todo=[q0]; unitOf.set(q0,u);
      while (todo.length){
        const q=todo.pop()!; u.plots.push(q);
        const x=q%PW, y=(q/PW)|0;
        for (const k of [y>0?q-PW:-1, x<PW-1?q+1:-1, y<PH-1?q+PW:-1, x>0?q-1:-1]) if (k>=0 && !unitOf.has(k) && standing(k,n.id)){ unitOf.set(k,u); todo.push(k); }
      }
      u.plots.sort((a,b) => a-b); u.key=u.plots[0]; u.cap=UNIT_SIZE*u.plots.length;
      [u.x,u.y]=frontOf(u.plots[(u.plots.length/2)|0]);
      for (const k of u.plots){ u.stored[2]+=pArmor[2][k]; u.stored[3]+=pArmor[3][k]; }
      units[n.id].push(u);
    }
  }
}

/** Gives kingdom n's soldiers their places: each keeps his barracks while it has room for him,
    and the soldiers without one fill free places, the nearest first (watchtower guards last).
    Returns the soldiers who just joined an army, so they can walk over. */
export function station(n: Nation, mine: Human[], switching: (h: Human) => boolean){
  const U=units[n.id] ?? [], joined: Human[]=[];
  for (const h of mine){
    if (h.kind!==H_SOLDIER || h.base<0) continue;
    const u=unitOf.get(h.base);
    if (!u || u.o!==n.id || u.members.length>=u.cap){ h.base=-1; continue; }   // his barracks is gone or has shrunk
    u.members.push(h);
  }
  for (const u of U){
    if (u.members.length>=u.cap) continue;
    const free=mine.filter(h => h.kind===H_SOLDIER && h.base<0 && h.war<0 && h.hp>0 && !switching(h));
    free.sort((a,b) => (+(a.post>=0) - +(b.post>=0)) || ((a.x-u.x)**2+(a.y-u.y)**2)-((b.x-u.x)**2+(b.y-u.y)**2) || a.id-b.id);
    for (const h of free){
      if (u.members.length>=u.cap) break;
      h.base=u.plots[u.members.length%u.plots.length]; h.post=-1;   // spread along the modules
      u.members.push(h); joined.push(h);
    }
  }
  for (const u of U){
    u.home=0; u.tiers=[0,0,0,0];
    for (const h of u.members){ u.tiers[h.tier]++; if (h.war<0) u.home++; }
  }
  return joined;
}

/** Soldiers at their barracks take armour from its racks: the best piece first, to whoever wears
    the least, oldest hands first. */
export function armUp(n: Nation, switching: (h: Human) => boolean){
  for (const u of units[n.id] ?? []){
    for (const t of [3,2]){
      while (u.stored[t]>0){
        let best: Human | undefined;
        for (const h of u.members){
          if (h.tier>=t || h.war>=0 || h.hp<=0 || switching(h)) continue;
          if (!u.plots.some(q => { const [x,y]=frontOf(q); return (h.x-x)**2+(h.y-y)**2<RACK_R*RACK_R; })) continue;
          if (!best || h.tier<best.tier || (h.tier===best.tier && h.id<best.id)) best=h;
        }
        if (!best) break;
        const q=u.plots.find(k => pArmor[t][k]>0)!; pArmor[t][q]--; u.stored[t]--;
        const was=maxHp(best); u.tiers[best.tier]--; best.tier=t; u.tiers[t]++;
        best.hp=Math.min(maxHp(best),best.hp+maxHp(best)-was);   // the new armour takes the blows his old didn't
        on.armored(best.id,best.x,best.y,t);
      }
    }
  }
}

/** The armour barracks u still wants: reinforced for every rack, then heavy for every rack (as far
    as research allows); `pending` counts pieces already being made for it. Returns 0, 2 or 3. */
export function armorWanted(n: Nation, u: Unit, pending: number[]){
  const top=n.tier[R_INFANTRY]; if (top<2) return 0;
  const has2=u.tiers[2]+u.tiers[3]+u.stored[2]+u.stored[3]+pending[2]+pending[3];
  if (has2<u.cap) return 2;
  if (top>=3 && u.tiers[3]+u.stored[3]+pending[3]<u.cap) return 3;
  return 0;
}
