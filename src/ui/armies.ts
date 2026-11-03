/* ---------- armies in the UI: names, a one-line summary, and a picker of which to send ----------
   Each barracks keeps its own army (sim/army.ts). The war screen and the respond menu list the
   player's armies as toggles; each one chosen marches out on its own. */
import { PLAYER, PW } from '../core/constants';
import { W, type Nation } from '../sim/state';
import { units, unitLabel, type Unit } from '../sim/army';
import { available } from '../sim/war';

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

/** A row of toggles, one per army of the player's that has soldiers at home. */
export class ArmyPicker {
  private picked=new Set<number>(); private known=new Set<number>(); private html='';
  constructor(private el: HTMLElement, private onChange: () => void){
    el.addEventListener('click', e => {
      const b=(e.target as HTMLElement).closest('button.army') as HTMLButtonElement | null; if (!b || b.disabled) return;
      const k=+b.dataset.key!; if (this.picked.has(k)) this.picked.delete(k); else this.picked.add(k);
      this.html=''; this.refresh(); this.onChange();
    });
  }
  /** Starts afresh: every army picked, or (with `need`) the biggest ones until they match that many. */
  reset(need=Infinity){
    this.picked.clear(); this.known.clear(); this.html='';
    const me=W.nations[PLAYER]; if (!me) return;
    let got=0;
    for (const a of available(me,true).sort((x,y) => y.men.length-x.men.length || x.unit.key-y.unit.key)){
      this.known.add(a.unit.key);
      if (!a.out && got<need){ this.picked.add(a.unit.key); got+=a.men.length; }   // (armies already out on another border are listed, but chosen only by hand)
    }
    this.refresh();
  }
  /** The armies picked that can still march, as barracks plots for the command. */
  chosen(){ const me=W.nations[PLAYER]; return me ? available(me,true).filter(a => this.picked.has(a.unit.key)).map(a => a.unit.key) : []; }
  /** How many soldiers the armies picked would send. */
  count(){ const me=W.nations[PLAYER]; return me ? available(me,true).filter(a => this.picked.has(a.unit.key)).reduce((k,a) => k+a.men.length,0) : 0; }
  refresh(){
    const me=W.nations[PLAYER]; if (!me) return;
    const avail=available(me,true), ready=new Map(avail.map(a => [a.unit.key, a.men.length])), outs=new Set(avail.filter(a => a.out).map(a => a.unit.key));
    const U=(units[PLAYER] ?? []).slice().sort((a,b) => a.key-b.key);
    for (const u of U) if (!this.known.has(u.key)){ this.known.add(u.key); if (ready.get(u.key) && !outs.has(u.key)) this.picked.add(u.key); }   // a new army joins the choice
    const html=U.map(u => {
      const k=ready.get(u.key) ?? 0, on=this.picked.has(u.key) && k>0;
      return `<button class="army" data-key="${u.key}" aria-pressed="${on}" ${k?'':'disabled'}><span class="an">${armyName(me,u)}</span><span class="at">${outs.has(u.key) ? 'on a border · '+k+' men' : unitLabel(u)}</span></button>`;
    }).join('') || '<p class="dnote">No armies: a barracks trains soldiers, an army of 5 each, more where barracks stand side by side. Militia can go instead.</p>';
    if (html!==this.html){ this.html=html; this.el.innerHTML=html; }
  }
}
