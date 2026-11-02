/* ---------- the naval base panel: opened by clicking a naval base ----------
   The fleet (ships ready in the harbour, which belong to the kingdom, not to a base), the ships
   being built, and a button to build another: 5 wood, 15 seconds. A slider shows how far the ship
   in the yard has got. */
import { PLAYER, PS, B_NAVAL } from '../core/constants';
import { W, pType, pOwner } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { SHIP_COST, SHIP_TICKS, shipProblem } from '../sim/naval';
import { drawIcon } from '../render/sprites';
import { styleOf } from '../render/style';
import { closeDiplomacy, diplomacyOpen } from './diplomacy';
import { closeResearch } from './research';
import { closeArmy } from './army';
import { $ } from './dom';

const panel=$('naval');
let plot=-1;   // the main plot of the naval base shown

export const navalOpen = () => !panel.hidden;
export function openNaval(q: number){
  const c=$('nIcon') as HTMLCanvasElement; c.width=4*PS; c.height=2*PS; drawIcon(c.getContext('2d')!,B_NAVAL,styleOf(PLAYER));
  if (diplomacyOpen()) closeDiplomacy();
  closeResearch(); closeArmy();
  plot=q; panel.hidden=false; refreshNaval();
}
export function closeNaval(){ panel.hidden=true; plot=-1; }
$('nClose').addEventListener('click', closeNaval);
$('nBuild').addEventListener('click', () => { if (plot>=0) queueCommand({ type:'ship', nation:PLAYER, plot }); });

/** Brings the panel up to date (cheap; skipped while it is closed). */
export function refreshNaval(){
  if (panel.hidden) return;
  const me=W.nations[PLAYER];
  if (!me || pType[plot]!==B_NAVAL || pOwner[plot]!==PLAYER){ closeNaval(); return; }
  const dock=W.docks.get(plot), queued=dock?.queued ?? 0, prog=dock?.prog ?? 0;
  const out=W.ships.filter(s => s.o===PLAYER && s.fleet).length;
  $('nReady').textContent=String(me.fleet);
  $('nBuilding').textContent=String(queued);
  $('nOut').textContent=String(out);
  const pct=queued ? Math.round(prog/SHIP_TICKS*100) : 0, slider=$('nProg') as HTMLInputElement;
  slider.value=String(pct); slider.style.setProperty('--fill',pct+'%');
  $('nProgVal').textContent=queued ? `${pct}%` : 'idle';
  const why=shipProblem(me,plot), btn=$('nBuild') as HTMLButtonElement;
  btn.disabled=!!why; btn.title=why ?? 'Pay 5 wood: a ship is built in 15 seconds';
  btn.textContent=`Build a ship · ${SHIP_COST[0]} wood`;
  $('nNote').textContent=`Each ship carries ${5} soldiers on a naval invasion. Settling islands and carrying villagers need no ship. The fleet is the kingdom's: every base can send it.`+(why ? ' '+why+'.' : '');
}
