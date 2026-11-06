/* ---------- HUD: kingdom card, leaderboard, attack chips, log, toasts, end card ---------- */
import { PLAYER, TICK, UNPAID_TICKS, GAME_SPEED } from '../core/constants';
import { fmt, fmtTime } from '../core/util';
import { HUMAN_EVERY, FARM_BONUS, BED_BONUS, humanRate, houseBonus, professionals, soldierMax } from '../sim/population';
import { setSoldierShare } from '../game';
import { W } from '../sim/state';
import { allied, atWar } from '../sim/war';
import { client } from '../client';
import { updateWarChips, refreshDiplomacy } from './diplomacy';
import { refreshResearch } from './research';
import { refreshArmy } from './army';
import { refreshNaval } from './naval';
import { refreshCommand } from './command';
import { flagCSS } from '../render/flags';
import { $ } from './dom';
import { paid, incomeParts } from '../sim/sim';

export const ui={ meGold:$('meGold'), meRate:$('meRate'), meLand:$('meLand'), meHouses:$('meHouses'), meStrength:$('meStrength'),
  meWood:$('meWood'), meStone:$('meStone'), meCopper:$('meCopper'),
  meVillagers:$('meVillagers'), meTax:$('meTax'), meLandTax:$('meLandTax'), meBoost:$('meBoost'), meBoostRow:$('meBoostRow'), meSoldCost:$('meSoldCost'), meMilCost:$('meMilCost'), meMilCostRow:$('meMilCostRow'), meWages:$('meWages'), meHomeless:$('meHomeless'), meSoldiers:$('meSoldiers'), meMilitia:$('meMilitia'), meMilitiaRow:$('meMilitiaRow'), meTraining:$('meTraining'), meNext:$('meNext'),
  soldiers:$('soldiers') as HTMLInputElement, soldiersHint:$('soldiersHint'),
  clock:$('clock'), boardList:$('boardList'), attacks:$('attacks'), log:$('log'), toast:$('toast'), tip:$('tip'), banner:$('banner') };

let lastBoard=0;
export function updateHUD(now: number){
  const me=W.nations[PLAYER]; if (!me) return;
  const landCount=W.landCount, pros=professionals(me);
  ui.meGold.textContent=fmt(me.gold); const inc=me.alive?me.income:0;
  ui.meRate.textContent=(inc<0?'':'+')+(inc*GAME_SPEED).toFixed(1)+'/s'; ui.meRate.classList.toggle('neg',inc<0); ui.meGold.classList.toggle('neg',me.gold<0);
  // soldiers' wages, and what happens when they go unpaid
  ui.meWages.hidden=!paid(me) || me.gold>=0;
  ui.meWages.textContent = me.unpaid<UNPAID_TICKS ? `No gold for wages: soldiers desert in ${Math.ceil((UNPAID_TICKS-me.unpaid)*TICK/GAME_SPEED)}s` : `Unpaid soldiers are deserting, one every ${+(3/GAME_SPEED).toFixed(1)} s`;
  // what the income is made of
  const parts=incomeParts(me), signed=(v: number) => (v<0 ? '−' : '+')+Math.abs(v*GAME_SPEED).toFixed(1);   // (per real second)
  ui.meTax.textContent=signed(parts.tax); ui.meLandTax.textContent=signed(parts.land);
  ui.meBoostRow.hidden=!me.minters; ui.meBoost.textContent=signed(parts.boost);
  ui.meSoldCost.textContent=signed(-parts.soldiers); ui.meSoldCost.classList.toggle('neg',parts.soldiers>0);
  ui.meMilCostRow.hidden=!me.called; ui.meMilCost.textContent=signed(-parts.militia); ui.meMilCost.classList.toggle('neg',parts.militia>0);
  ui.meLand.textContent=(me.tiles/landCount*100).toFixed(1)+'%';
  ui.meHouses.textContent=String(me.houses);
  const sub=[me.beds>me.houses ? `room for ${me.beds}` : '', me.abandoned ? `${me.abandoned} empty` : ''].filter(Boolean).join(' · ');
  if (sub){ const sp=document.createElement('small'); sp.textContent=sub; ui.meHouses.append(sp); } ui.meStrength.textContent=fmt(me.strength);
  ui.meWood.textContent=fmt(me.stock[0]); ui.meStone.textContent=fmt(me.stock[1]); ui.meCopper.textContent=fmt(me.stock[2]);
  ui.meHomeless.hidden=!me.unhoused && !me.beggars;   // (only those who have been without a home for a while, and are not off to build one)
  ui.meHomeless.textContent=`${me.unhoused} homeless${me.beggars?` · ${me.beggars} begging`:''} · homeless villagers pay no tax`;
  { const open=$('meJobsCell').getAttribute('aria-expanded')==='true', box=$('meJobs'); box.hidden=!open;
    if (open){ const rows: [string, number][]=[['Builders',me.jobs[0]],['Blacksmiths',me.jobs[1]],['Doctors',me.jobs[2]],['Carpenters',me.jobs[3]],['Scholars',me.jobs[4]]].filter(r => (r[1] as number)>0) as [string, number][];
      const html=rows.length ? rows.map(r => `<span>${r[0]}<b>${r[1]}</b></span>`).join('') : '<span class="none">No villager has a trade yet: build a builders guild, blacksmith, hospital, carpenters or research station</span>';
      if (box.dataset.h!==html){ box.dataset.h=html; box.innerHTML=html; } } }
  ui.meVillagers.textContent=String(Math.max(0,me.villagers-pros)); $('meJobsN').textContent=String(pros); ui.meSoldiers.textContent=String(me.soldiers-me.militia);
  ui.meMilitia.textContent=me.called ? `${me.militia} (${me.called} called up)` : String(me.militia); ui.meMilitiaRow.hidden=!me.militia; ui.meTraining.textContent=String(me.training);
  const people=me.villagers+me.soldiers+me.beggars, perTick=humanRate(me,people), bedsB=BED_BONUS*me.beds, empty=houseBonus(me,people)-bedsB;
  ui.meNext.textContent = me.alive && me.capTile>=0 ? `Next human in ${Math.max(0,(HUMAN_EVERY-me.humanProg)/perTick*TICK/GAME_SPEED).toFixed(1)}s${me.farms?` · farms +${Math.round(FARM_BONUS*me.farms*100)}%`:''}${empty>0.0005?` · empty homes +${Math.round(empty*100)}%`:''}${bedsB>0?` · home capacity +${+(bedsB*100).toFixed(1)}%`:''}` : 'No capital: no new humans';
  // without a barracks, everyone under arms trains at the castle as militia
  ui.soldiers.disabled=!me.alive; ui.soldiersHint.hidden=!me.alive || me.barracks>0;
  // the slider stops short of the professionals (the blue part), unless the lock is open
  { const people=me.villagers+me.soldiers, cap=me.draftAll ? 1 : Math.floor(soldierMax(me)*100)/100;
    const blk=$('soldierBlock'), lock=$('soldierLock');
    blk.style.width=people ? `calc((100% - 14px) * ${(pros/people).toFixed(4)} + 7px)` : '0'; blk.hidden=!pros;
    lock.setAttribute('aria-pressed',String(me.draftAll)); lock.textContent=me.draftAll ? '🔓' : '🔒';
    if (me.alive && +ui.soldiers.value/100>cap+0.004) setSoldierShare(cap); }
  ui.clock.textContent=fmtTime(W.simTime/GAME_SPEED);
  { const left=Math.max(0,W.rushUntil-W.tickN), rush=$('rush'), show=left>0 && me.alive;   // the land rush: the first minute, settling at half price
    if (rush.hidden===show){ rush.hidden=!show; if (!show && wasRush){ wasRush=false; log('The land rush is over: settling costs the usual price again'); } }
    if (show){ wasRush=true; $('rushT').textContent=fmtTime(Math.ceil(left*TICK/GAME_SPEED)); } }
  if (now-lastBoard>450){
    lastBoard=now;
    const list=W.nations.slice(1).sort((a,b)=>(+b.alive - +a.alive)||(b.tiles-a.tiles));
    let html='', shown=0;
    for (const n of list){
      if (shown>=6 && !n.isPlayer) continue; if (!n.alive && !n.isPlayer) continue;
      shown++;
      const rel=allied(PLAYER,n.id) ? ' ally' : atWar(PLAYER,n.id) ? ' war' : '';
      html+=`<li class="${n.isPlayer?'you':''}${n.alive?'':' dead'}${rel}"><i class="flag" style="${flagCSS(n.code)}"></i><span class="nm">${n.name}${n.isPlayer?' (you)':''}</span><span class="tr">${fmt(n.strength)}</span><span class="pc">${(n.tiles/landCount*100).toFixed(1)}%</span></li>`;
    }
    ui.boardList.innerHTML=html;
    let ah='';
    for (const A of W.attacks){ if (A.done || A.att!==PLAYER) continue; const d=W.nations[A.def];
      ah+=`<span class="chip"><i ${A.def ? `class="flag" style="${flagCSS(d.code)}"` : 'style="background:#cfc6a8"'}></i>${A.def?d.name:'Unclaimed land'} · ${fmt(A.gold)} gold</span>`; }
    ui.attacks.innerHTML=ah;
  }
  // each panel on its own: one that fails can't leave the others (the war chips, say) frozen as they were
  for (const f of [updateWarChips, refreshDiplomacy, refreshResearch, refreshArmy, refreshNaval, refreshCommand]){
    try { f(); } catch (e){ if (!failed.has(f)){ failed.add(f); console.error(e); } }
  }
}
const failed=new Set<() => void>();

let wasRush=false;
export function log(text: string, kind?: string){
  const d=document.createElement('div'); d.className='entry'+(kind?' '+kind:''); d.textContent=text;
  ui.log.prepend(d); const es=ui.log.querySelectorAll('.entry'); if (es.length>4) es[es.length-1].remove();   // (the land rush note under them stays)
  setTimeout(()=>d.remove(),9500);
}
let toastTimer=0;
export function toast(text: string){ ui.toast.textContent=text; ui.toast.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>ui.toast.hidden=true,2200); }

export function showHUD(on: boolean){ for (const id of ['me','board','bar']) $(id).hidden=!on; }
function showOver(win: boolean){
  client.overShown=true;
  const me=W.nations[PLAYER], landCount=W.landCount, simTime=W.simTime;
  let leader=null; for (let i=1;i<W.nations.length;i++){ const n=W.nations[i]; if (n.alive && (!leader || n.tiles>leader.tiles)) leader=n; }
  $('overTitle').textContent = win ? 'Victory' : 'Your kingdom has fallen';
  $('overText').textContent = win
    ? `${me.name} holds ${(me.tiles/landCount*100).toFixed(0)}% of the land after ${fmtTime(simTime/GAME_SPEED)}.`
    : `You lasted ${fmtTime(simTime/GAME_SPEED)} and peaked at ${(me.peak*100).toFixed(0)}% of the land.${leader?` ${leader.name} now holds ${(leader.tiles/landCount*100).toFixed(0)}%.`:''}`;
  $('watch').textContent = win ? 'Keep playing' : 'Keep watching';
  $('over').hidden=false; $('scrim').hidden=false;
}
export function checkEnd(){
  if (client.overShown) return; const me=W.nations[PLAYER]; if (!me) return;
  if (!me.alive){ showOver(false); return; }
  let others=0; for (let i=1;i<W.nations.length;i++) if (i!==PLAYER && W.nations[i].alive) others++;
  if (me.tiles>=W.landCount*0.75 || others===0) showOver(true);
}

/* ---------- messages for simulation events ---------- */
export function onEliminated(id: number, by: number){
  const n=W.nations[id];
  if (id===PLAYER) log('Your kingdom has been wiped from the map','bad');
  else log(`${n.name} has fallen${by?' to '+W.nations[by].name:''}`, by===PLAYER?'good':'');
}
export function onCapitalFell(id: number, by: number){
  const n=W.nations[id];
  if (id===PLAYER){ log('Your capital burned and a quarter of your gold was lost','bad'); toast('Your capital has fallen'); }
  else log(`${by?W.nations[by].name:'Someone'} sacked the capital of ${n.name}`, by===PLAYER?'good':'');
}
export function onBuildingPlaced(_q: number, id: number, isNew: boolean){
  const n=W.nations[id];
  if (isNew && id===PLAYER && n.bCount>4 && W.simTime-client.lastVillageLog>25){ client.lastVillageLog=W.simTime; log('Your people founded a new village','good'); }
}
