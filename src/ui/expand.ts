/* ---------- settling land: a click on unclaimed ground opens a small menu right there ----------
   25%, 50%, 75% or 100% of the treasury goes into pushing the border toward that spot. */
import { W } from '../sim/state';
import { PLAYER } from '../core/constants';
import { fmt } from '../core/util';
import { playerAttack, playerColonize } from '../game';
import { colonyPlan, hasLandOn } from '../sim/naval';
import { $ } from './dom';

const menu=$('expand');
let tile=-1, colony=false;   // the tile it is for, and whether it is to colonize (an island: a ship goes) rather than settle

export const expandOpen = () => !menu.hidden;
/** Opens the menu for unclaimed tile t at (x, y): page pixels where the player clicked. */
export function openExpand(t: number, x: number, y: number){
  const me=W.nations[PLAYER]; if (!me) return;
  tile=t; menu.hidden=false;
  // land of a landmass where the kingdom has none is colonized by sea (and needs a naval base)
  const plan=hasLandOn(PLAYER,t) ? null : colonyPlan(me,t);
  colony=plan!==null; const why=typeof plan==='string' ? plan : null;
  for (const b of menu.querySelectorAll<HTMLButtonElement>('button')){
    const g=me.gold*+b.dataset.r!;
    b.title=why ?? (colony ? `Send a ship with ${fmt(g)} gold to settle that land` : `Spend ${fmt(g)} gold settling land this way`); b.disabled=g<2 || !!why;
  }
  menu.classList.toggle('off',!!why);
  $('exTitle').textContent = why ? why : me.gold<2 ? 'Not enough gold yet' : colony ? 'Colonize: spend of your gold' : 'Settle: spend of your gold';
  const g=$('game').getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(g.width-menu.offsetWidth-8,x-g.left-menu.offsetWidth/2))+'px';
  menu.style.top=Math.max(8,Math.min(g.height-menu.offsetHeight-8,y-g.top-menu.offsetHeight-12))+'px';
}
export function closeExpand(){ menu.hidden=true; tile=-1; }
menu.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || b.disabled) return;
  if (tile>=0) (colony ? playerColonize : playerAttack)(tile,+b.dataset.r!);
  closeExpand();
});
