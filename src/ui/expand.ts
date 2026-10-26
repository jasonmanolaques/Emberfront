/* ---------- settling land: a click on unclaimed ground opens a small menu right there ----------
   25%, 50%, 75% or 100% of the treasury goes into pushing the border toward that spot. */
import { W } from '../sim/state';
import { PLAYER } from '../core/constants';
import { fmt } from '../core/util';
import { playerAttack } from '../game';
import { $ } from './dom';

const menu=$('expand');
let tile=-1;

export const expandOpen = () => !menu.hidden;
/** Opens the menu for unclaimed tile t at (x, y): page pixels where the player clicked. */
export function openExpand(t: number, x: number, y: number){
  const me=W.nations[PLAYER]; if (!me) return;
  tile=t; menu.hidden=false;
  for (const b of menu.querySelectorAll<HTMLButtonElement>('button')){ const g=me.gold*+b.dataset.r!; b.title=`Spend ${fmt(g)} gold settling land this way`; b.disabled=g<2; }
  $('exTitle').textContent=me.gold>=2 ? 'Settle: spend of your gold' : 'Not enough gold yet';
  const g=$('game').getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(g.width-menu.offsetWidth-8,x-g.left-menu.offsetWidth/2))+'px';
  menu.style.top=Math.max(8,Math.min(g.height-menu.offsetHeight-8,y-g.top-menu.offsetHeight-12))+'px';
}
export function closeExpand(){ menu.hidden=true; tile=-1; }
menu.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || b.disabled) return;
  if (tile>=0) playerAttack(tile,+b.dataset.r!);
  closeExpand();
});
