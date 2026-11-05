/* ---------- field medics: the wounded, the hospital and its doctors ----------
   With field medics researched, 8% of the soldiers who fall are only wounded: they lie where they fell (like the dead, but with no blood and a cross above
   them) and bleed out in 45 seconds, unless a doctor is on his way: then the cross turns green and the clock stops. A hospital has two doctors, villagers
   who wait inside; when a soldier of the kingdom lies wounded on the hospital's landmass the nearest doctor runs out to him, 50% faster than usual, picks him
   up, carries him back and tends him in one of the two beds for 7 seconds, after which the soldier goes back to the field. The doctor stays with him until
   then, and goes out again afterwards. */
import { PW, TW, GAME_SPEED, TICK, B_HOSPITAL } from '../core/constants';
import { W, isle, pType, pOwner, pBurn, type Human, type Wounded } from './state';
import { hasMedics, woundChance } from './research';
import { on } from './events';

export const BLEED_TICKS = 45*GAME_SPEED*10;      // a wounded man with no doctor on his way bleeds out in 45 seconds
export const HEAL_TICKS = 7*GAME_SPEED*10;        // and one in a hospital bed is on his feet again after 7
export const MEDIC_SPEED = 1.5;                   // a doctor on his way to a wounded man runs 50% faster
export const BEDS = 2;
// doctors' tasks (Human.task): the numbers follow TASK_BOAT in population.ts
export const TASK_DOC_WAIT = 18, TASK_DOC_GO = 19, TASK_DOC_BACK = 20, TASK_DOC_HEAL = 21;
export const isDoctorTask = (t: number) => t>=TASK_DOC_WAIT && t<=TASK_DOC_HEAL;

/** Does a hospital of kingdom o stand on plot q? */
export const hospitalStands = (q: number, o: number) => q>=0 && pType[q]===B_HOSPITAL && pOwner[q]===o && pBurn[q]<=0;
/** The pixel just outside a hospital's door. */
export const hospitalDoor = (q: number): [number, number] => [(q%PW)*8+8, ((q/PW)|0)*8+9];

/** A soldier of a kingdom that has learned field medics has fallen: he may be wounded, not dead (returns true: he is on the list, and is not mourned). */
export function wound(h: Human): boolean {
  const n=W.nations[h.o];
  if (!n?.alive || h.kind!==1 || !hasMedics(n) || W.prand()>=woundChance(n)) return false;
  W.wounded.push({ id:h.id, o:h.o, h, x:h.x, y:h.y, left:BLEED_TICKS, medic:-1, carried:false, hosp:-1, bed:-1, heal:0 });
  return true;
}
const landmass = (x: number, y: number) => isle[((y/2)|0)*TW+((x/2)|0)];
/** The nearest wounded man of doctor h's kingdom that no doctor is going to, on the hospital's landmass. */
function pickWounded(h: Human, q: number): Wounded | undefined {
  const [dx,dy]=hospitalDoor(q), I=landmass(dx,dy); let best: Wounded | undefined, bd=Infinity;
  for (const w of W.wounded){
    if (w.o!==h.o || w.medic>=0 || w.carried || w.bed>=0 || landmass(w.x,w.y)!==I) continue;
    const d=(w.x-dx)**2+(w.y-dy)**2; if (d<bd || (d===bd && w.id<(best?.id ?? 1e9))){ bd=d; best=w; }
  }
  return best;
}
/** Steps h toward (tx,ty) at `mult` times his pace; true once there. */
function go(h: Human, tx: number, ty: number, mult: number){
  const dx=tx-h.x, dy=ty-h.y, d=Math.hypot(dx,dy);
  if (d<=1.2){ h.x=tx; h.y=ty; return true; }
  const st=Math.min(d,h.sp*mult*TICK); h.x+=dx/d*st; h.y+=dy/d*st;
  return false;
}
/** A free bed in hospital q (0 or 1), or -1. */
const freeBed = (q: number) => { for (let b=0;b<BEDS;b++) if (!W.wounded.some(w => w.hosp===q && w.bed===b)) return b; return -1; };

/** One tick for a doctor (a villager whose workplace is a hospital): wait inside, run to a wounded man, carry him back, stay with him in his bed. */
export function medicStep(h: Human){
  const q=h.work, [dx,dy]=hospitalDoor(q);
  if (h.task===TASK_DOC_WAIT){
    if ((h.id+W.tickN)%5) return;
    const w=pickWounded(h,q); if (!w) return;
    w.medic=h.id; h.dest=w.id; h.x=dx; h.y=dy; h.task=TASK_DOC_GO;
    return;
  }
  const w=h.dest>=0 ? W.wounded.find(k => k.id===h.dest) : undefined;
  if (h.task===TASK_DOC_GO){
    if (!w || w.medic!==h.id || w.carried){ h.dest=-1; h.task=TASK_DOC_BACK; return; }
    if (go(h,w.x,w.y,MEDIC_SPEED)){ w.carried=true; h.task=TASK_DOC_BACK; }
    return;
  }
  if (h.task===TASK_DOC_BACK){
    const carrying=!!w && w.carried && w.medic===h.id;
    if (go(h,dx,dy,1)){
      if (carrying){ const b=freeBed(q); if (b>=0){ w!.bed=b; w!.hosp=q; w!.heal=HEAL_TICKS; w!.x=dx; w!.y=dy; h.task=TASK_DOC_HEAL; } }   // (no bed free: he waits at the door)
      else { h.dest=-1; h.task=TASK_DOC_WAIT; }
    } else if (carrying){ w!.x=h.x; w!.y=h.y; }   // he carries him
    return;
  }
  if (h.task===TASK_DOC_HEAL && (!w || w.bed<0)){ h.dest=-1; h.task=TASK_DOC_WAIT; }   // (healed and gone, or the hospital fell)
}

/** Once a tick: the wounded bleed, are healed in their beds, or die. `revive` puts a healed soldier back on the map. */
export function updateMedics(revive: (h: Human, x: number, y: number) => void){
  if (!W.wounded.length) return;
  const docs=new Map<number, Human>(); for (const h of W.humans) if (h.work>=0 && h.kind===0) docs.set(h.id,h);
  for (let i=W.wounded.length-1;i>=0;i--){
    const w=W.wounded[i], n=W.nations[w.o];
    if (!n.alive){ W.wounded.splice(i,1); continue; }
    if (w.medic>=0){   // the doctor on his way (or with him) is still at it?
      const d=docs.get(w.medic);
      if (!d || d.dest!==w.id || !(d.task===TASK_DOC_GO || d.task===TASK_DOC_BACK || d.task===TASK_DOC_HEAL)){ w.medic=-1; if (w.bed<0) w.carried=false; }
    }
    if (w.bed>=0){
      if (!hospitalStands(w.hosp,w.o)){ w.bed=-1; w.medic=-1; w.carried=false; continue; }
      if (--w.heal<=0){ const [x,y]=hospitalDoor(w.hosp); W.wounded.splice(i,1); revive(w.h,x,y); }
      continue;
    }
    if (w.carried || w.medic>=0) continue;   // a doctor has him: the clock is stopped
    if (--w.left<=0){ on.died(w.x,w.y,w.o,w.id,1,w.h.militia ? 0 : w.h.tier,false); W.wounded.splice(i,1); }
  }
}
