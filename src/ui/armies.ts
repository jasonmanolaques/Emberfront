/* ---------- armies in the UI: names, a one-line summary, and a picker of which to send ----------
   Each barracks keeps its own army (sim/army.ts). The war screen and the intercept menu list the
   player's armies as toggles; each one chosen marches out on its own. */
import { PLAYER, PW } from '../core/constants';
import { W, type Nation } from '../sim/state';
import { units, unitLabel, type Unit } from '../sim/army';
import { available } from '../sim/war';

const DIRS = ['East', 'South-east', 'South', 'South-west', 'West', 'North-west', 'North', 'North-east'];
/** "North barracks", by where it stands from the castle; "Castle barracks" right beside it. */
export function armyName(n: Nation, u: Unit){
  if (n.capTile<0) return 'Barracks';
  const q=n.capPlot, cx=(q%PW)*8+8, cy=((q/PW)|0)*8+8, dx=u.x-cx, dy=u.y-cy;
  if (dx*dx+dy*dy<24*24) return 'Castle barracks';
  return DIRS[(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8]+' barracks';
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
    for (const a of available(me).sort((x,y) => y.men.length-x.men.length || x.unit.key-y.unit.key)){
      this.known.add(a.unit.key);
      if (got<need){ this.picked.add(a.unit.key); got+=a.men.length; }
    }
    this.refresh();
  }
  /** The armies picked that can still march, as barracks plots for the command. */
  chosen(){ const me=W.nations[PLAYER]; return me ? available(me).filter(a => this.picked.has(a.unit.key)).map(a => a.unit.key) : []; }
  /** How many soldiers the armies picked would send. */
  count(){ const me=W.nations[PLAYER]; return me ? available(me).filter(a => this.picked.has(a.unit.key)).reduce((k,a) => k+a.men.length,0) : 0; }
  refresh(){
    const me=W.nations[PLAYER]; if (!me) return;
    const ready=new Map(available(me).map(a => [a.unit.key, a.men.length]));
    const U=(units[PLAYER] ?? []).slice().sort((a,b) => a.key-b.key);
    for (const u of U) if (!this.known.has(u.key)){ this.known.add(u.key); if (ready.get(u.key)) this.picked.add(u.key); }   // a new army joins the choice
    const html=U.map(u => {
      const k=ready.get(u.key) ?? 0, on=this.picked.has(u.key) && k>0;
      return `<button class="army" data-key="${u.key}" aria-pressed="${on}" ${k?'':'disabled'}><span class="an">${armyName(me,u)}</span><span class="at">${unitLabel(u)}</span></button>`;
    }).join('') || '<p class="dnote">No armies: a barracks trains soldiers, an army of 5 each, more where barracks stand side by side. Militia can go instead.</p>';
    if (html!==this.html){ this.html=html; this.el.innerHTML=html; }
  }
}
