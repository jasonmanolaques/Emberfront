/* ---------- settling land: a click on unclaimed ground opens a small menu right there ----------
   25%, 50%, 75% or 100% of the treasury goes into pushing the border toward that spot. Below, the
   a single ⚓ button for a naval settlement: it asks for the coast to land on, and then the same choice of how
   much gold the ship carries over the sea; the border begins where it lands. */
import { W } from '../sim/state';
import { PLAYER } from '../core/constants';
import { fmt } from '../core/util';
import { playerAttack, startNavalSettle, settleBySea } from '../game';
import { hasLandOn, basesOf } from '../sim/naval';
import { $ } from './dom';

const menu=$('expand'), land=$('exLand'), seaBtn=$('exSeaBtn') as HTMLButtonElement;
let tile=-1, sea=false;   // the tile clicked, and whether the menu is the naval settlement's (the coast chosen) or the land's

export const expandOpen = () => !menu.hidden;
function place(x: number, y: number){
  const g=$('game').getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(g.width-menu.offsetWidth-8,x-g.left-menu.offsetWidth/2))+'px';
  menu.style.top=Math.max(8,Math.min(g.height-menu.offsetHeight-8,y-g.top-menu.offsetHeight-12))+'px';
}
/** Opens the menu for unclaimed tile t at (x, y): page pixels where the player clicked. */
export function openExpand(t: number, x: number, y: number){
  const me=W.nations[PLAYER]; if (!me) return;
  tile=t; sea=false; menu.hidden=false; seaBtn.hidden=false;
  // the border settles land it touches: land on a landmass where the kingdom has none can only be settled by sea
  const here=hasLandOn(PLAYER,t), why=here ? null : 'No land of yours on that island: settle it by sea';
  for (const b of land.querySelectorAll<HTMLButtonElement>('button[data-r]')){ const g=me.gold*+b.dataset.r!; b.title=why ?? `Spend ${fmt(g)} gold settling land this way`; b.disabled=g<2 || !!why; }
  // by sea: a naval base, and a ship of the fleet; the one button asks for the coast to land on, and the gold after it
  const noSea = !basesOf(me).length ? 'Build a naval base to settle by sea' : me.fleet<1 ? 'You need a ship: build one at a naval base' : null;
  seaBtn.disabled=me.gold<2 || !!noSea; seaBtn.title=noSea ?? 'Naval settlement: point at the coast to land on, then choose how much gold the ship carries';
  $('exTitle').textContent = me.gold<2 ? 'Not enough gold yet' : why ?? 'Settle: spend of your gold';
  land.classList.toggle('off',!!why);
  place(x,y);
}
/** The coast a ship is to land on is chosen (tile t): how much of the gold goes with it. */
export function openExpandSea(t: number, x: number, y: number){
  const me=W.nations[PLAYER]; if (!me) return;
  tile=t; sea=true; menu.hidden=false; seaBtn.hidden=true;
  for (const b of land.querySelectorAll<HTMLButtonElement>('button[data-r]')){ const g=me.gold*+b.dataset.r!; b.title=`Send a ship with ${fmt(g)} gold`; b.disabled=g<2; }
  $('exTitle').textContent='⚓ Naval settlement: spend of your gold'; land.classList.remove('off');
  place(x,y);
}
export function closeExpand(){ menu.hidden=true; tile=-1; sea=false; }
menu.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || b.disabled) return;
  if (b===seaBtn){ closeExpand(); startNavalSettle(); return; }
  const ratio=+b.dataset.r!;
  if (sea && tile>=0) settleBySea(tile,ratio);
  else if (tile>=0) playerAttack(tile,ratio);
  closeExpand();
});
