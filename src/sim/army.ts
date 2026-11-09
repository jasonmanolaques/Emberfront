/* ---------- armies: each barracks keeps an army of its own ----------
   Barracks plots side by side join into one barracks; each plot of it (a module) houses 5
   soldiers and has 5 armour racks. The soldiers a barracks has room for are its army: they wait
   in front of it and march out together, one army per barracks, so a kingdom with two barracks
   in different places has two armies, and four modules joined together make one army of 20.
   Its room is all the trained soldiers a kingdom can have: those it raises beyond it are militia,
   trained at the castle (sim/population.ts), who patrol the city, guard watchtowers, and go to war
   only when called up as reserves (sim/war.ts). Militia are weaker: 5 hit points and 1 a blow, and no armour.
   Soldiers come in three tiers: archaic (tier 1, everyone starts there), reinforced (tier 2)
   and heavy armour (tier 3). The blacksmith forges armour once infantry research allows it and
   carries it to the barracks; a soldier of that barracks who comes by takes the best piece on the
   racks that beats what he wears, and his old armour is thrown away. Reinforced armour comes
   first, for every rack of the barracks; only then heavy armour, which replaces it. */
import { PW, PH, B_BARRACKS } from '../core/constants';
import { W, occ, pType, pOwner, pBurn, pCenter, pArmor, type Human, type Nation } from './state';
import { on } from './events';
import { R_INFANTRY } from './research';

export const UNIT_SIZE = 5;                         // soldiers and armour racks per barracks module
export const SOLDIER_HP = [0, 16, 20, 30];          // by tier (twice what they were: longer fights)
export const SOLDIER_DMG = [0, 1.5, 2.25, 3];       // a blow, by tier (half as much again)
export const VILLAGER_HP = 8;
export const MILITIA_HP = 10, MILITIA_HIT = 1.125;       // a militiaman's hit points, and his blow
export const TIER_NAME = ['', 'I', 'II', 'III'];
const H_SOLDIER = 1;                                // (population.ts; repeated here to keep this module standalone)
const RACK_R = 14;                                  // pixels from a barracks door a soldier picks up armour

/* ---------- order groups: armies merged under one name, like the armies of a field marshal ----------
   Merged armies stay what they are (each barracks keeps its own soldiers and recruits its own): they are only given orders together. A group has up to a lead and
   MAX_MERGES others. */
export const MAX_MERGES = 5;
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
export const maxHp = (h: Human) => (h.kind!==H_SOLDIER ? VILLAGER_HP : h.militia ? MILITIA_HP : SOLDIER_HP[h.tier]*2**h.lead)*(h.fury ? 1.25 : 1)*(h.dug ? 1.15 : 1);   // an army's leader: doubled for each rank; one spawned in a siege, a quarter more
const frontOf = (q: number): [number, number] => [(q%PW)*8+4, ((q/PW)|0)*8+7.5];
/** Does o's barracks q stand and work: not burning, and not on ground the enemy occupies (it raises no soldiers and trains none there). */
const standing = (q: number, o: number) => pType[q]===B_BARRACKS && pOwner[q]===o && pBurn[q]<=0 && !occ[pCenter[q]];

/** "4/5 · 3 I · 1 II · 1 III": the army's living soldiers (at home or away) over its room, then the army by tier. */
export function unitLabel(u: Unit){
  const t=[1,2,3].filter(k => u.tiers[k]).map(k => `${u.tiers[k]} ${TIER_NAME[k]}`);
  return [`${u.members.length}/${u.cap}`, ...t].join(' · ');
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
  tidyGroups();
}

/** The unit keys of the order group army `key` of kingdom o belongs to, the lead first; just [key] if it has none. */
export function groupKeys(o: number, key: number): number[] {
  const u=unitOf.get(key); if (!u) return [key];
  for (const g of W.groups){
    if (g.o!==o || !g.members.some(m => m.some(q => u.plots.includes(q)))) continue;
    const keys: number[]=[]; for (const m of g.members){ const k=m.map(q => unitOf.get(q)).find(x => x && x.o===o); if (k && !keys.includes(k.key)) keys.push(k.key); }
    return keys.length ? keys : [key];
  }
  return [key];
}
/** The lead of army `key`'s group: the key of the army that carries its name. */
export const groupLead = (o: number, key: number) => groupKeys(o,key)[0];
/** Joins army b to army a's group (a leads, or a's group's lead does): false if either is gone, they are one group already, b is in another, or the group is full. */
export function mergeArmies(o: number, a: number, b: number){
  const ua=unitOf.get(a), ub=unitOf.get(b); if (!ua || !ub || ua.o!==o || ub.o!==o || ua===ub) return false;
  const ka=groupKeys(o,a), kb=groupKeys(o,b);
  if (kb.length>1 || ka.includes(ub.key) || ka.length>MAX_MERGES) return false;
  let g=W.groups.find(g => g.o===o && g.members.some(m => m.some(q => ua.plots.includes(q))));
  if (!g){ g={ o, members:[ua.plots.slice()] }; W.groups.push(g); }
  g.members.push(ub.plots.slice());
  return true;
}
/** Dissolves the order group army `key` belongs to: every army in it is on its own again. */
export function unmergeArmies(o: number, key: number){
  const u=unitOf.get(key); if (!u) return false;
  const i=W.groups.findIndex(g => g.o===o && g.members.some(m => m.some(q => u.plots.includes(q))));
  if (i<0) return false;
  W.groups.splice(i,1); return true;
}
/** Groups follow their armies: a member is found again by any of its plots (barracks modules come and go); one whose barracks is gone leaves; a group of one is no group. */
function tidyGroups(){
  for (let i=W.groups.length-1;i>=0;i--){
    const g=W.groups[i], seen=new Set<Unit>(), members: number[][]=[];
    for (const m of g.members){ const u=m.map(q => unitOf.get(q)).find(x => x && x.o===g.o); if (u && !seen.has(u)){ seen.add(u); members.push(u.plots.slice()); } }
    if (members.length<2) W.groups.splice(i,1); else g.members=members;
  }
}

/** Gives kingdom n's soldiers their places: each keeps his barracks while it has room for him,
    and free places (a soldier fell, or a new barracks) go to new recruits: the newest soldiers
    without one, never a watchtower's guards (militia train for them: sim/population.ts).
    Returns the soldiers who just joined an army, so they can walk over. */
export function station(n: Nation, mine: Human[], switching: (h: Human) => boolean){
  const U=units[n.id] ?? [], joined: Human[]=[];
  for (const h of mine){
    if (h.kind!==H_SOLDIER || h.base<0) continue;
    const u=unitOf.get(h.base);
    if (!u || u.o!==n.id || u.members.length>=u.cap){ h.base=-1; continue; }   // his barracks is gone or has shrunk
    u.members.push(h);
  }
  // new recruits go to the army that has lost the most compared to its size (its free places over its room), one at a time,
  // so the armies are made up evenly and the one bled hardest first
  const free=mine.filter(h => h.kind===H_SOLDIER && !h.militia && h.base<0 && h.post<0 && h.war<0 && h.hp>0 && !switching(h));
  free.sort((a,b) => b.id-a.id);   // the newest recruits first
  for (const h of free){
    let best: Unit | undefined, bs=0;
    for (const u of U){ const s=(u.cap-u.members.length)/u.cap; if (s>bs+1e-9){ bs=s; best=u; } }
    if (!best) break;
    h.base=best.plots[best.members.length%best.plots.length];   // spread along the modules
    best.members.push(h); joined.push(h);
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
          if (!u.plots.some(q => { const [x,y]=frontOf(q); return (h.x-x)**2+(h.y-y)**2<RACK_R*RACK_R*4; })) continue;   // (at home: his army stands in front of its barracks)
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
