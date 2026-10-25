/* ---------- buildings panel: pick a building, then click your land to place it ---------- */
import { PLAYER, TW, PW, B_FARM, B_BARRACKS, B_TOWER, B_MINTER } from '../core/constants';
import type { Nation } from '../sim/state';
import { W, owner, pType, pOwner, pPrio } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { STRUCTURES, canAfford, plotProblem, structureOf, type Structure } from '../sim/buildings';
import { GOOD_NAME } from '../sim/resources';
import { client } from '../client';
import { drawIcon } from '../render/sprites';
import { styleOf } from '../render/style';
import { ui, toast } from './hud';
import { $ } from './dom';

const panel=$('buildPanel'), list=$('buildList'), tip=$('btip'), button=$('build');
const ICO=['wood','stone','copper'];
const owned = (n: Nation, type: number) => type===B_FARM ? n.farms : type===B_BARRACKS ? n.barracks : type===B_TOWER ? n.towers : type===B_MINTER ? n.minters : 0;
const rows=new Map<number, HTMLButtonElement>();

/** Builds the panel's rows once a match starts, with icons in the player's colours. */
export function setupBuildPanel(){
  list.textContent=''; rows.clear();
  for (const s of STRUCTURES){
    const b=document.createElement('button'); b.className='bld'; b.dataset.type=String(s.type);
    const c=document.createElement('canvas'); c.width=c.height=8; drawIcon(c.getContext('2d')!,s.type,styleOf(PLAYER));
    const body=document.createElement('span'); body.style.display='grid'; body.style.gap='3px'; body.style.minWidth='0';
    body.innerHTML=`<span class="bn"><span></span><i></i></span><span class="costs"></span>`;
    (body.firstElementChild!.firstElementChild as HTMLElement).textContent=s.name;
    const costs=body.lastElementChild as HTMLElement;
    s.cost.forEach((n,g)=>{ if (!n) return; const sp=document.createElement('span'); sp.innerHTML=`<i class="ico ${ICO[g]}"></i>${n}`; sp.dataset.good=String(g); costs.append(sp); });
    b.append(c, body);
    b.addEventListener('click', ()=>pick(s));
    b.addEventListener('pointerenter', ()=>showTip(s,b));
    b.addEventListener('focus', ()=>showTip(s,b));
    b.addEventListener('pointerleave', ()=>{ tip.hidden=true; });
    b.addEventListener('blur', ()=>{ tip.hidden=true; });
    list.append(b); rows.set(s.type,b);
  }
  refreshBuildPanel();
}

/** Colours the rows the player can afford, greys out the rest, and shows how many of each they own. */
export function refreshBuildPanel(){
  const me=W.nations[PLAYER]; if (!me) return;
  for (const [type,b] of rows){
    const s=structureOf(type)!, ok=me.alive && canAfford(me,s);
    b.setAttribute('aria-disabled', String(!ok));
    b.classList.toggle('on', client.placing===type);
    const k=owned(me,type);
    (b.querySelector('.bn i') as HTMLElement).textContent = k ? '×'+k : '';
    for (const sp of b.querySelectorAll<HTMLElement>('.costs span')) sp.classList.toggle('short', me.stock[+sp.dataset.good!]<s.cost[+sp.dataset.good!]);
  }
  if (client.placing && !canAfford(me, structureOf(client.placing)!)) stopPlacing();
}

function showTip(s: Structure, b: HTMLElement){
  const me=W.nations[PLAYER];
  const cost=s.cost.map((n,g)=>n ? `${n} ${GOOD_NAME[g]}` : '').filter(Boolean).join(', ');
  const short=me ? s.cost.map((n,g)=>n>me.stock[g] ? `${Math.ceil(n-me.stock[g])} more ${GOOD_NAME[g]}` : '').filter(Boolean).join(', ') : '';
  tip.innerHTML=`<span class="t1"></span><span></span><span class="t3"></span>${short?'<span class="short"></span>':''}`;
  const [t1,t2,t3,t4]=tip.children as unknown as HTMLElement[];
  t1.textContent=s.name; t2.textContent=s.info; t3.textContent='Costs '+cost;
  if (t4) t4.textContent='You need '+short;
  tip.hidden=false;
  if (matchMedia('(max-width:640px)').matches){ tip.style.top=''; return; }
  tip.style.top=Math.max(0,b.offsetTop+b.offsetHeight/2-tip.offsetHeight/2)+'px';
}

function pick(s: Structure){
  const me=W.nations[PLAYER]; if (!me) return;
  if (client.placing===s.type){ stopPlacing(); return; }
  if (!canAfford(me,s)){ toast(`Not enough resources for a ${s.name.toLowerCase()}`); return; }
  client.placing=s.type;
  ui.banner.textContent=`Placing a ${s.name.toLowerCase()}: click your land · Esc to stop`; ui.banner.hidden=false;
  refreshBuildPanel();
}
export function stopPlacing(){
  if (!client.placing) return;
  client.placing=0; ui.banner.hidden=true; refreshBuildPanel();
}

export function toggleBuildPanel(open=panel.hidden){
  panel.hidden=!open; button.setAttribute('aria-expanded',String(open));
  if (open) refreshBuildPanel(); else { tip.hidden=true; stopPlacing(); }
}

/** A click on the map while placing: build there if the plot is good. */
export function placeAt(t: number){
  const me=W.nations[PLAYER], s=structureOf(client.placing); if (!me || !s || t<0) return;
  const q=((t/TW|0)>>2)*PW+((t%TW)>>2), problem=plotProblem(me,q);
  if (problem){ toast(problem); return; }
  if (!canAfford(me,s)){ toast(`Not enough resources for a ${s.name.toLowerCase()}`); stopPlacing(); return; }
  queueCommand({ type:'build', nation:PLAYER, plot:q, kind:s.type });
}

/** A click on your own land outside placing: toggles a watchtower's call for a garrison. Returns true if it did. */
export function clickOwnBuilding(t: number){
  const q=((t/TW|0)>>2)*PW+((t%TW)>>2);
  if (owner[t]!==PLAYER || pType[q]!==B_TOWER || pOwner[q]!==PLAYER) return false;
  queueCommand({ type:'priority', nation:PLAYER, plot:q });
  const me=W.nations[PLAYER]!;
  toast(pPrio[q] ? 'Watchtower no longer calls for a garrison' : me.barracks ? 'Watchtower calls for 5 soldiers' : 'Watchtower calls for soldiers: build a barracks to raise them');
  return true;
}
