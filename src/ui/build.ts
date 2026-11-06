/* ---------- buildings panel: pick a building, then click your land to place it ---------- */
import { PLAYER, TW, PW, PS, B_FARM, B_BARRACKS, B_TOWER, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_RESEARCH, B_GUILD, B_SMITHY, B_HOSPITAL, B_CARPENTER, B_PART, B_NAVAL } from '../core/constants';
import type { Nation } from '../sim/state';
import { W, owner, pType, pTier, pOwner, pMain } from '../sim/state';
import { R_HOUSING, R_INFANTRY, hasMedics } from '../sim/research';
import { TASK_FORGE, TASK_HOME_GO, improvements } from '../sim/population';
import { units, armorWanted } from '../sim/army';
import { openResearch } from './research';
import { openArmy } from './army';
import { openNaval, closeNaval } from './naval';
import { queueCommand } from '../sim/sim';
import { STRUCTURES, canAfford, costFor, placeProblem, structureOf, SIZE, BLOCKABLE, blockPlan, type Structure } from '../sim/buildings';
import { GOOD_NAME } from '../sim/resources';
import { client } from '../client';
import { drawIcon } from '../render/sprites';
import { styleOf } from '../render/style';
import { ui, toast } from './hud';
import { $ } from './dom';

const panel=$('buildPanel'), list=$('buildList'), tip=$('btip'), title=$('buildTitle');
/** The building menus on the right: what each holds. */
export const CATEGORIES = [
  { id:'urban',     name:'Urban development',   types:[B_FARM, B_GUILD, B_CARPENTER, B_MINTER, B_HOSPITAL] },
  { id:'military',  name:'Military',            types:[B_BARRACKS, B_TOWER, B_SMITHY, B_NAVAL] },
  { id:'resources', name:'Resource buildings',  types:[B_PLANTATION, B_QUARRY, B_COPPERMINE] },
  { id:'society',   name:'Society advancement', types:[B_RESEARCH] },
];
let category='urban';   // the menu showing, or the last one opened
const ICO=['wood','stone','copper'];
const owned = (n: Nation, type: number) => type===B_FARM ? n.farms : type===B_BARRACKS ? n.barracks : type===B_TOWER ? n.towers : type===B_MINTER ? n.minters
  : type===B_PLANTATION ? n.plantations : type===B_QUARRY ? n.quarries : type===B_COPPERMINE ? n.copperMines : type===B_RESEARCH ? n.labs : type===B_GUILD ? n.guilds : type===B_SMITHY ? n.smithies : type===B_CARPENTER ? n.carpenters : type===B_HOSPITAL ? n.hospitals : type===B_NAVAL ? n.navals : 0;
const rows=new Map<number, HTMLButtonElement>();   // by type; a block of four by type+BLOCK
const BLOCK=1000;
const blockCost = (n: Nation, type: number) => blockPlan(n,0,type).cost;   // (the cost does not depend on where)

$('openResearch').addEventListener('click',()=>{ openResearch(); });
/** Builds the panel's rows once a match starts, with icons in the player's colours. */
export function setupBuildPanel(){
  list.textContent=''; rows.clear();
  for (const s of STRUCTURES) for (const four of BLOCKABLE.includes(s.type) ? [false,true] : [false]){
    const b=document.createElement('button'); b.className='bld'; b.dataset.type=String(s.type); if (four) b.dataset.block='1';
    b.dataset.cat=CATEGORIES.find(c => c.types.includes(s.type))?.id ?? 'urban';
    const [fw,fh]=SIZE[s.type] ?? [1,1], c=document.createElement('canvas'); c.width=fw*PS*(four ? 2 : 1); c.height=fh*PS*(four ? 2 : 1);
    const cx=c.getContext('2d')!;
    if (four){ for (let i=0;i<4;i++){ const t=document.createElement('canvas'); t.width=PS; t.height=PS; drawIcon(t.getContext('2d')!,s.type,styleOf(PLAYER)); cx.drawImage(t,(i%2)*PS,((i/2)|0)*PS); } }
    else drawIcon(cx,s.type,styleOf(PLAYER));
    if (fh<fw) c.style.height='16px';   // keep the pixels square for a 2x1 building
    const body=document.createElement('span'); body.style.display='grid'; body.style.gap='3px'; body.style.minWidth='0';
    body.innerHTML=`<span class="bn"><span></span><i></i></span><span class="costs"></span>`;
    (body.firstElementChild!.firstElementChild as HTMLElement).textContent=four ? s.name+' ×4' : s.name;
    const costs=body.lastElementChild as HTMLElement;
    s.cost.forEach((n,g)=>{ if (!n) return; const sp=document.createElement('span'); sp.innerHTML=`<i class="ico ${ICO[g]}"></i>${n*(four ? 4 : 1)}`; sp.dataset.good=String(g); costs.append(sp); });
    b.append(c, body);
    b.addEventListener('click', ()=>pick(s,four));
    b.addEventListener('pointerenter', ()=>showTip(s,b,four));
    b.addEventListener('focus', ()=>showTip(s,b,four));
    b.addEventListener('pointerleave', ()=>{ tip.hidden=true; });
    b.addEventListener('blur', ()=>{ tip.hidden=true; });
    list.append(b); rows.set(s.type+(four ? BLOCK : 0),b);
  }
  refreshBuildPanel();
}

/** Colours the rows the player can afford, greys out the rest, and shows how many of each they own. */
export function refreshBuildPanel(){
  const me=W.nations[PLAYER]; if (!me) return;
  for (const [key,b] of rows){
    const four=key>=BLOCK, type=four ? key-BLOCK : key, s=structureOf(type)!;
    const price=four ? blockCost(me,type) : costFor(me,s), ok=me.alive && price.every((c,g) => me.stock[g]>=c);
    const locked=type===B_HOSPITAL && !hasMedics(me);   // (grayed out until field medics is learned)
    b.setAttribute('aria-disabled', String(!ok || locked)); b.classList.toggle('locked',locked);
    b.classList.toggle('on', client.placing===type && client.block===four);
    const k=owned(me,type);
    (b.querySelector('.bn i') as HTMLElement).textContent = k ? '×'+k : '';
    // what it costs this kingdom now: the first gatherer is free, each farm makes the next dearer
    const cost=price, free=cost.every(c => !c);
    let first=true;
    for (const sp of b.querySelectorAll<HTMLElement>('.costs span')){
      const g=+sp.dataset.good!;
      sp.hidden=free && !first; (sp.lastChild as Text).textContent=free ? ' free' : String(cost[g]); first=false;
      sp.classList.toggle('short', me.stock[g]<cost[g]);
    }
  }
  if (client.placing && !(client.block ? blockCost(me,client.placing) : costFor(me,structureOf(client.placing)!)).every((c,g) => me.stock[g]>=c)) stopPlacing();
}

function showTip(s: Structure, b: HTMLElement, four=false){
  const me=W.nations[PLAYER];
  const price=me ? (four ? blockCost(me,s.type) : costFor(me,s)) : s.cost.map(c => c*(four ? 4 : 1));
  const cost=price.some(c => c) ? price.map((n,g)=>n ? `${n} ${GOOD_NAME[g]}` : '').filter(Boolean).join(', ') : 'nothing: the first one is free';
  const short=me ? price.map((n,g)=>n>me.stock[g] ? `${Math.ceil(n-me.stock[g])} more ${GOOD_NAME[g]}` : '').filter(Boolean).join(', ') : '';
  tip.innerHTML=`<span class="t1"></span><span></span><span class="t3"></span>${short?'<span class="short"></span>':''}`;
  const [t1,t2,t3,t4]=tip.children as unknown as HTMLElement[];
  t1.textContent=four ? s.name+' ×4' : s.name; t2.textContent=four ? `Four ${s.name.toLowerCase()}s in a square of 2 by 2 plots, placed as four one after the other: each makes the next dearer. All or none. ${s.info}` : s.info; t3.textContent='Costs '+cost;
  if (t4) t4.textContent='You need '+short;
  if (s.type===B_HOSPITAL && me && !hasMedics(me)){ t3.textContent='Needs the field medics research (400 points)'; }
  tip.hidden=false;
  if (matchMedia('(max-width:640px)').matches){ tip.style.top=''; return; }
  tip.style.top=Math.max(0,b.offsetTop+b.offsetHeight/2-tip.offsetHeight/2)+'px';
}

function pick(s: Structure, four=false){
  const me=W.nations[PLAYER]; if (!me) return;
  if (client.placing===s.type && client.block===four){ stopPlacing(); return; }
  const price=four ? blockCost(me,s.type) : costFor(me,s);
  if (s.type===B_HOSPITAL && !hasMedics(me)){ toast('Research field medics first (the research station)'); return; }
  if (!price.every((c,g) => me.stock[g]>=c)){ toast(`Not enough resources for ${four ? 'four ' : 'a '}${s.name.toLowerCase()}${four ? 's' : ''}`); return; }
  client.placing=s.type; client.block=four;
  ui.banner.textContent=`Placing ${four ? 'four '+s.name.toLowerCase()+'s (2 by 2)' : 'a '+s.name.toLowerCase()}: click your land (over a building, it replaces it) · Esc to stop`; ui.banner.hidden=false;
  refreshBuildPanel();
}
export function stopPlacing(){
  if (!client.placing) return;
  client.placing=0; client.block=false; ui.banner.hidden=true; refreshBuildPanel();
}

/** Opens building menu `cat` (the last one, if none is named), closes the panel when `open` is false,
    or, with no `open` given, when that menu is already showing. */
export function toggleBuildPanel(open?: boolean, cat=category){
  const show: boolean = open===undefined ? (panel.hidden===true || cat!==category) : open;
  if (show) category=cat;
  panel.hidden=!show;
  const c=CATEGORIES.find(c => c.id===category)!;
  title.textContent=c.name;
  for (const [key,b] of rows) b.hidden=!c.types.includes(key>=BLOCK ? key-BLOCK : key);
  $('openResearch').hidden=c.id!=='society';   // (the research panel is a button away, not only a click on a station)
  for (const b of document.querySelectorAll<HTMLElement>('#tools .cat')) b.setAttribute('aria-expanded',String(show && b.dataset.cat===category));
  if (show) refreshBuildPanel(); else { tip.hidden=true; stopPlacing(); }
}

/** A click on the map while placing: build there if the plot is good. */
export function placeAt(t: number){
  const me=W.nations[PLAYER], s=structureOf(client.placing); if (!me || !s || t<0) return;
  const q=((t/TW|0)>>2)*PW+((t%TW)>>2);
  if (client.block){
    const plan=blockPlan(me,q,s.type,'any');
    if (plan.problem){ toast(plan.problem); if (plan.problem.startsWith('Not enough')) stopPlacing(); return; }
    queueCommand({ type:'build', nation:PLAYER, plot:q, kind:s.type, block:true });
    return;
  }
  const problem=placeProblem(me,q,s.type,'any');
  if (problem){ toast(problem); return; }
  if (!canAfford(me,s)){ toast(`Not enough resources for a ${s.name.toLowerCase()}`); stopPlacing(); return; }
  queueCommand({ type:'build', nation:PLAYER, plot:q, kind:s.type });
}

/** A click on your own land outside placing: a research
    station opens the research panel, a barracks its army's panel, and a builders guild or blacksmith
    says what its worker is up to. Returns true if it did. */
export function clickOwnBuilding(t: number){
  let q=((t/TW|0)>>2)*PW+((t%TW)>>2);
  if (pType[q]===B_PART) q=pMain[q];
  if (pType[q]===B_NAVAL && pOwner[q]===PLAYER){ closeNaval(); openNaval(q); return true; }   // (any part of the base, the piers over the water too)
  if (owner[t]!==PLAYER || pOwner[q]!==PLAYER) return false;
  const me=W.nations[PLAYER]!;
  if (pType[q]===B_RESEARCH){ openResearch(); return true; }
  if (pType[q]===B_BARRACKS){ closeNaval(); openArmy(q); return true; }
  if (pType[q]===B_NAVAL){ openNaval(q); return true; }
  if (pType[q]===B_SMITHY){
    const b=W.humans.find(h => h.work===q);
    toast(!b ? 'The blacksmith waits for a villager to take up the hammer' : me.tier[R_INFANTRY]<2 ? 'Your smith waits: research infantry to forge armour'
      : b.load>=2 ? 'Your smith carries armour to the barracks' : b.load===1 || b.task===TASK_FORGE ? 'Your smith is forging armour'
      : me.stock[2]<1 ? 'Your smith needs copper from the castle' : b.make ? 'Your smith fetches copper from the castle'
      : (units[PLAYER] ?? []).some(u => armorWanted(me,u,[0,0,0,0])) ? 'Your smith waits: no way over your own land to a barracks that wants armour' : 'Every armour rack is filled');
    return true;
  }
  if (pType[q]===B_HOSPITAL){
    const docs=W.humans.filter(h => h.work===q).length, beds=W.wounded.filter(w => w.hosp===q && w.bed>=0).length, out=W.wounded.filter(w => w.o===PLAYER && w.bed<0).length;
    toast(docs<2 ? `The hospital waits for ${2-docs} more villager${docs===1 ? '' : 's'} to become doctors` : beds ? `${beds} of 2 beds taken: the doctors tend ${beds===1 ? 'a wounded soldier' : 'two wounded soldiers'}` : out ? `Your doctors go out for ${out} wounded soldier${out===1 ? '' : 's'}` : 'Both beds are free: the doctors wait for the wounded');
    return true;
  }
  if (pType[q]===B_CARPENTER){
    const b=W.humans.find(h => h.work===q);
    toast(!b ? 'The carpenters wait for a villager to take up the saw' : b.home>=0 ? (b.task===TASK_HOME_GO ? 'Your carpenter walks to a site for a new house' : 'Your carpenter is building a new house (20 seconds each, for free)') : 'Your carpenter has no room left for houses, or your people have beds enough');
    return true;
  }
  if (pType[q]===B_GUILD){
    const b=W.humans.find(h => h.work===q);
    toast(!b ? 'The guild waits for a villager to take up the tools' : me.tier[R_HOUSING]<2 && !improvements(me).length ? 'Your builder waits: research housing to build better homes'
      : b.fix>=0 ? `Your builder is raising ${pType[b.fix]===B_TOWER ? 'a watchtower' : 'a house'} to tier ${pTier[b.fix]+1}`
      : improvements(me).length ? 'Your builder waits: there is no way over your own land to what is left' : 'Your builder has nothing left to improve');
    return true;
  }
  return false;
}
