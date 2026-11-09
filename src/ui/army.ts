/* ---------- barracks panel: opened by clicking a barracks ----------
   Its army (at the barracks over its room, and away), the army by tier, and the armour: worn by
   its soldiers and waiting on the racks, and what the blacksmith is doing about it. */
import { PLAYER, PS, B_BARRACKS, GAME_SPEED } from '../core/constants';
import { W, pType, pOwner } from '../sim/state';
import { unitAt, units, armorWanted, TIER_NAME, UNIT_SIZE } from '../sim/army';
import { R_INFANTRY } from '../sim/research';
import { A_HOME, A_MARCH, A_HOLD, A_BATTLE, O_ATTACK, O_DEFEND, O_RETURN, O_RETREAT } from '../sim/war';
import { regionName } from '../sim/regions';
import { drawIcon } from '../render/sprites';
import { styleOf } from '../render/style';
import { armyName } from './armies';
import { closeDiplomacy, diplomacyOpen } from './diplomacy';
import { closeResearch } from './research';
import { $ } from './dom';

const panel=$('army');
let plot=-1;   // a plot of the barracks shown

export const armyOpen = () => !panel.hidden;
export function openArmy(q: number){
  const c=$('aIcon') as HTMLCanvasElement; c.width=PS; c.height=PS; drawIcon(c.getContext('2d')!,B_BARRACKS,styleOf(PLAYER));
  if (diplomacyOpen()) closeDiplomacy();
  closeResearch();
  plot=q; panel.hidden=false; refreshArmy();
}
export function closeArmy(){ panel.hidden=true; plot=-1; }
$('aClose').addEventListener('click', closeArmy);

/** What this barracks' army is doing out there. */
function fieldReport(key: number){
  const x=W.armies.find(x => x.o===PLAYER && x.plots.includes(key));
  return x ? armyStatus(x) : 'At home';
}
/** A line on what army x is doing. */
export function armyStatus(x: import('../sim/state').Army){
  const r=x.goal ? regionName(x.goal) : '', men=`${x.men} men`;
  const wait=x.rally>W.tickN ? ` · rallying, ${Math.ceil((x.rally-W.tickN)/(GAME_SPEED*10))} s` : '';
  const sb=x.next ? ` · on standby for ${regionName(x.next.r)}` : '';
  return armyLine(x,r,men)+wait+sb;
}
function armyLine(x: import('../sim/state').Army, r: string, men: string){
  if (x.mode===A_HOME) return 'At home';
  if (x.mode===A_BATTLE) return `${men} · in battle${r ? ` for ${r}` : ''}`;
  if (x.order===O_RETURN) return `${men} · going home`;
  if (x.order===O_RETREAT) return `${men} · retreating to ${r}`;
  if (x.mode===A_MARCH) return `${men} · marching to ${x.order===O_ATTACK ? 'attack ' : x.order===O_DEFEND && x.enemy ? 'defend ' : ''}${r}`;
  if (x.mode===A_HOLD) return x.order===O_ATTACK ? `${men} · lowering the flag of ${r}` : x.order===O_DEFEND ? `${men} · ${x.enemy ? 'holding' : 'stationed in'} ${r}` : `${men} · waiting for orders`;
  return men;
}
const pieces = (n: number[]) => [3,2].filter(t => n[t]).map(t => `${n[t]} ${TIER_NAME[t]}`).join(' · ') || 'none';

/** Brings the panel up to date (cheap; skipped while it is closed). */
export function refreshArmy(){
  if (panel.hidden) return;
  const me=W.nations[PLAYER], u=unitAt(plot);
  if (!me || !u || pType[plot]!==B_BARRACKS || pOwner[plot]!==PLAYER){ closeArmy(); return; }
  $('aName').textContent=armyName(me,u);
  $('aHome').textContent=`${u.home}/${u.cap}`;
  $('aAway').textContent=String(u.members.length-u.home);
  $('aMods').textContent=String(u.plots.length);
  $('aField').textContent=fieldReport(u.key);
  $('aTiers').textContent=[1,2,3].map(t => `${t===1 ? u.tiers[1]-u.archers : u.tiers[t]} ${TIER_NAME[t]}`).join(' · ')+(u.archCap ? ` · ${u.archers}/${u.archCap} archers` : '');
  $('aWorn').textContent=pieces(u.tiers);
  $('aRacks').textContent=pieces(u.stored);
  $('aFree').textContent=String(Math.max(0,u.cap-u.archCap-u.tiers[2]-u.tiers[3]-u.stored[2]-u.stored[3]));
  const want=armorWanted(me,u,[0,0,0,0]);
  $('aSmith').textContent = me.tier[R_INFANTRY]<2 ? 'Research infantry to forge armour for this army.'
    : !me.smithies ? 'Build a blacksmith to forge armour for this army.'
    : want===2 ? 'The blacksmith brings reinforced armour (II) until every rack has some.'
    : want===3 ? 'The blacksmith brings heavy armour (III) to replace the reinforced.'
    : 'Every rack is filled with the best armour you have researched.';
  const patrol=W.humans.filter(h => h.o===PLAYER && h.kind===1 && h.base<0).length;
  $('aNote').textContent=(patrol ? `${patrol} soldier${patrol>1?'s have':' has'} no room in a barracks and patrol${patrol>1?'':'s'} the city, defending only. ` : '')
    +`Build barracks beside this one to grow its army: ${UNIT_SIZE} more spearmen and racks each, or archer barracks: ${UNIT_SIZE} more archers each (no armour; they shoot from behind the spearmen).`
    +((units[PLAYER]?.length ?? 0)>1 ? ' Barracks apart from each other march as separate armies.' : '');
}
