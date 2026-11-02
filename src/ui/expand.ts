/* ---------- settling land: a click on unclaimed ground opens a small menu right there ----------
   25%, 50%, 75% or 100% of the treasury goes into pushing the border toward that spot. Below, the
   same choice for a naval settlement: a ship of the fleet takes the gold over the sea to land you
   point at next, and the border begins there. */
import { W } from '../sim/state';
import { PLAYER } from '../core/constants';
import { fmt } from '../core/util';
import { playerAttack, startNavalSettle } from '../game';
import { hasLandOn, basesOf } from '../sim/naval';
import { $ } from './dom';

const menu=$('expand'), land=menu.querySelector('.exrow:not(#exNaval)') as HTMLElement, sea=$('exNaval');
let tile=-1;

export const expandOpen = () => !menu.hidden;
/** Opens the menu for unclaimed tile t at (x, y): page pixels where the player clicked. */
export function openExpand(t: number, x: number, y: number){
  const me=W.nations[PLAYER]; if (!me) return;
  tile=t; menu.hidden=false;
  // the border settles land it touches: land on a landmass where the kingdom has none can only be settled by sea
  const here=hasLandOn(PLAYER,t), why=here ? null : 'No land of yours on that island: settle it by sea';
  for (const b of land.querySelectorAll<HTMLButtonElement>('button')){ const g=me.gold*+b.dataset.r!; b.title=why ?? `Spend ${fmt(g)} gold settling land this way`; b.disabled=g<2 || !!why; }
  // by sea: a naval base, and a ship of the fleet
  const noSea = !basesOf(me).length ? 'Build a naval base to settle by sea' : me.fleet<1 ? 'You need a ship: build one at a naval base' : null;
  for (const b of sea.querySelectorAll<HTMLButtonElement>('button')){ const g=me.gold*+b.dataset.r!; b.title=noSea ?? `Send a ship with ${fmt(g)} gold: then click the land to settle`; b.disabled=g<2 || !!noSea; }
  $('exTitle').textContent = me.gold<2 ? 'Not enough gold yet' : why ?? 'Settle: spend of your gold';
  $('exSea').textContent = noSea ?? '⚓ Naval settlement: send a ship';
  land.classList.toggle('off',!!why); sea.classList.toggle('off',!!noSea);
  const g=$('game').getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(g.width-menu.offsetWidth-8,x-g.left-menu.offsetWidth/2))+'px';
  menu.style.top=Math.max(8,Math.min(g.height-menu.offsetHeight-8,y-g.top-menu.offsetHeight-12))+'px';
}
export function closeExpand(){ menu.hidden=true; tile=-1; }
menu.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || b.disabled) return;
  const ratio=+b.dataset.r!;
  if (sea.contains(b)) startNavalSettle(ratio);
  else if (tile>=0) playerAttack(tile,ratio);
  closeExpand();
});
