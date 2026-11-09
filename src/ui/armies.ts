/* ---------- armies in the UI: names and a one-line summary ----------
   Each barracks keeps its own army (sim/army.ts); an order group of them marches as one phalanx (sim/war.ts). */
import { PW } from '../core/constants';
import { type Nation } from '../sim/state';
import { unitLabel, type Unit } from '../sim/army';

const DIRS = ['East', 'South-east', 'South', 'South-west', 'West', 'North-west', 'North', 'North-east'];
/* Armies are "Army 1", "Army 2"… in the order they were first seen, and are renamed only by the player. The number and the name go with
   the barracks (found by any of its plots), so they survive modules being added or lost. */
const numbers=new Map<number, Map<number, number>>();   // kingdom → barracks plot → number
const names=new Map<number, string>();                  // the player's names, by barracks plot
export function resetArmyNames(){ numbers.clear(); names.clear(); }
function numberOf(n: Nation, u: Unit){
  let m=numbers.get(n.id); if (!m){ m=new Map(); numbers.set(n.id,m); }
  for (const q of u.plots){ const k=m.get(q); if (k!==undefined){ for (const p of u.plots) m.set(p,k); return k; } }
  let top=0; for (const k of m.values()) top=Math.max(top,k);
  for (const p of u.plots) m.set(p,top+1);
  return top+1;
}
/** "Army 3", or the name the player gave it. */
export function armyName(n: Nation, u: Unit){
  if (n.isPlayer){ for (const q of u.plots){ const c=names.get(q); if (c) return c; } }
  return `Army ${numberOf(n,u)}`;
}
/** The player names (or, with an empty name, un-names) the army of barracks u. */
export function renameArmy(u: Unit, name: string){
  for (const q of u.plots) names.delete(q);
  const t=name.trim().slice(0,20); if (t) names.set(u.key,t);
}
/** "North harbour", by where a naval base (main plot q) stands from the castle. */
export function baseName(n: Nation, q: number){
  if (n.capTile<0) return 'Naval base';
  const cq=n.capPlot, cx=(cq%PW)*8+8, cy=((cq/PW)|0)*8+8, dx=(q%PW)*8+16-cx, dy=((q/PW)|0)*8+8-cy;
  return DIRS[(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8]+' harbour';
}
export { unitLabel as armyLine };

