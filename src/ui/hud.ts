/* ---------- HUD: kingdom card, leaderboard, attack chips, log, toasts, end card ---------- */
import { PLAYER, TICK } from '../core/constants';
import { clamp, fmt, fmtTime } from '../core/util';
import { W } from '../sim/state';
import { client } from '../client';
import { $ } from './dom';

export const ui={ meTroops:$('meTroops'), meMax:$('meMax'), meRate:$('meRate'), meBar:$('meBar'), meLand:$('meLand'), meHouses:$('meHouses'), meFarms:$('meFarms'), meTowers:$('meTowers'),
  meVillagers:$('meVillagers'), meSoldiers:$('meSoldiers'), meTraining:$('meTraining'), meNext:$('meNext'),
  clock:$('clock'), boardList:$('boardList'), attacks:$('attacks'), log:$('log'), toast:$('toast'), tip:$('tip'), banner:$('banner') };

let lastBoard=0;
export function updateHUD(now: number){
  const me=W.nations[PLAYER]; if (!me) return;
  const landCount=W.landCount;
  ui.meTroops.textContent=fmt(me.troops); ui.meMax.textContent=fmt(me.maxTroops);
  ui.meRate.textContent=(me.rate>=0?'+':'−')+fmt(Math.abs(me.rate))+'/s'; ui.meRate.classList.toggle('neg',me.rate<0);
  ui.meBar.style.width=clamp(me.troops/me.maxTroops*100,0,100).toFixed(1)+'%';
  ui.meLand.textContent=(me.tiles/landCount*100).toFixed(1)+'%';
  ui.meHouses.textContent=String(me.houses); ui.meFarms.textContent=String(me.farms); ui.meTowers.textContent=String(me.towers);
  ui.meVillagers.textContent=String(me.villagers); ui.meSoldiers.textContent=String(me.soldiers); ui.meTraining.textContent=String(me.training);
  ui.meNext.textContent = me.alive && me.capTile>=0 ? `Next human in ${Math.max(0,Math.ceil((me.nextHuman-W.tickN)*TICK))}s` : 'No capital: no new humans';
  ui.clock.textContent=fmtTime(W.simTime);
  if (now-lastBoard>450){
    lastBoard=now;
    const list=W.nations.slice(1).sort((a,b)=>(+b.alive - +a.alive)||(b.tiles-a.tiles));
    let html='', shown=0;
    for (const n of list){
      if (shown>=6 && !n.isPlayer) continue; if (!n.alive && !n.isPlayer) continue;
      shown++;
      html+=`<li class="${n.isPlayer?'you':''}${n.alive?'':' dead'}"><i style="background:${n.hex}"></i><span class="nm">${n.name}${n.isPlayer?' (you)':''}</span><span class="tr">${fmt(n.troops)}</span><span class="pc">${(n.tiles/landCount*100).toFixed(1)}%</span></li>`;
    }
    ui.boardList.innerHTML=html;
    let ah='';
    for (const A of W.attacks){ if (A.done || A.att!==PLAYER) continue; const d=W.nations[A.def];
      ah+=`<span class="chip"><i style="background:${A.def?d.hex:'#cfc6a8'}"></i>${A.def?d.name:'Unclaimed land'} · ${fmt(A.troops)}</span>`; }
    ui.attacks.innerHTML=ah;
  }
}

export function log(text: string, kind?: string){
  const d=document.createElement('div'); d.className='entry'+(kind?' '+kind:''); d.textContent=text;
  ui.log.prepend(d); while (ui.log.children.length>4) ui.log.lastChild!.remove();
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
    ? `${me.name} holds ${(me.tiles/landCount*100).toFixed(0)}% of the land after ${fmtTime(simTime)}.`
    : `You lasted ${fmtTime(simTime)} and peaked at ${(me.peak*100).toFixed(0)}% of the land.${leader?` ${leader.name} now holds ${(leader.tiles/landCount*100).toFixed(0)}%.`:''}`;
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
  if (id===PLAYER){ log('Your capital burned. A quarter of your army scattered.','bad'); toast('Your capital has fallen'); }
  else log(`${by?W.nations[by].name:'Someone'} sacked the capital of ${n.name}`, by===PLAYER?'good':'');
}
export function onBuildingPlaced(_q: number, id: number, isNew: boolean){
  const n=W.nations[id];
  if (isNew && id===PLAYER && n.bCount>4 && W.simTime-client.lastVillageLog>25){ client.lastVillageLog=W.simTime; log('Your people founded a new village','good'); }
}
