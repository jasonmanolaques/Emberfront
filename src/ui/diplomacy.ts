/* ---------- diplomacy: click another kingdom to propose an alliance or go to war; the war chips ---------- */
import { PLAYER } from '../core/constants';
import { fmt } from '../core/util';
import { W } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { allied, atWar, available, allyProblem, warProblem, OFFER_TICKS } from '../sim/war';
import { toast } from './hud';
import { $ } from './dom';

const panel=$('diplo'), talk=$('dTalk'), warView=$('dWarView'), wars=$('wars');
const commit=$('dCommit') as HTMLInputElement;
let target=0;
// raid routes take a search of the map: worked out at most once a second while the war screen is open
let raidWhy: string | null = null, raidAt = -1e9;

const nameOf = (id: number) => id===PLAYER ? 'You' : W.nations[id].name;

/** Opens diplomacy with kingdom o. */
export function openDiplomacy(o: number){
  const n=W.nations[o]; if (!n || !n.alive || o===PLAYER) return;
  target=o; talk.hidden=false; warView.hidden=true; panel.hidden=false;
  refreshDiplomacy(true);
}
export function closeDiplomacy(){ panel.hidden=true; target=0; }
export const diplomacyOpen = () => !panel.hidden;

function showWarView(){
  const me=W.nations[PLAYER]; if (!me) return;
  talk.hidden=true; warView.hidden=false;
  const pool=available(me).all.length;
  commit.max=String(pool); commit.value=String(pool); raidAt=-1e9;
  refreshDiplomacy(true);
  commit.focus();
}

/** Keeps the open panel in step with the match. */
export function refreshDiplomacy(force=false){
  if (panel.hidden) return;
  const me=W.nations[PLAYER], n=W.nations[target];
  if (!me || !n || !n.alive || !me.alive){ closeDiplomacy(); return; }
  $('dCrest').style.background=n.hex;
  $('dName').textContent=n.name;
  if (!warView.hidden){ refreshWar(force); return; }
  $('dStrength').textContent=fmt(n.strength);
  $('dSoldiers').textContent=String(n.soldiers);
  $('dLand').textContent=(n.tiles/W.landCount*100).toFixed(1)+'%';
  const ally=allied(PLAYER,target), war=atWar(PLAYER,target), border=W.contact[PLAYER*W.M+target]>0;
  const rel=$('dRel');
  rel.textContent = ally ? 'Your ally: their land is open to your soldiers' : war ? 'At war with you' : border ? 'Neutral · shares a border with you' : 'Neutral · no shared border';
  rel.className='drel'+(ally?' ally':war?' war':'');
  const allyBtn=$('dAlly') as HTMLButtonElement, no=allyProblem(PLAYER,target);
  allyBtn.disabled=!!no; allyBtn.title=no ?? 'Ask them to open borders to each other\'s soldiers';
  ($('dWar') as HTMLButtonElement).textContent = ally ? 'Break alliance and go to war…' : war ? 'Send more soldiers…' : 'Declare war…';
  $('dNote').textContent = no && no!=='You are already allies' ? no : '';
}

function refreshWar(force: boolean){
  const me=W.nations[PLAYER], pool=available(me), max=pool.all.length;
  if (+commit.max!==max){ const was=+commit.value; commit.max=String(max); commit.value=String(Math.min(was,max)); }
  const k=+commit.value, fromGuards=Math.max(0,k-pool.idle.length);
  commit.style.setProperty('--fill',(max ? k/max*100 : 0)+'%');
  $('dCommitVal').textContent=`${k} / ${max}`;
  $('dSplit').textContent = max ? `${pool.idle.length} idle at the barracks · ${pool.guards.length} guarding watchtowers` : 'No soldiers free: raise some with a barracks';
  const warn=$('dWarn'); warn.hidden=!fromGuards;
  warn.textContent = fromGuards>1 ? `${fromGuards} garrison soldiers will leave their watchtowers` : '1 garrison soldier will leave his watchtower';
  if (force || performance.now()-raidAt>1000){ raidAt=performance.now(); raidWhy=warProblem(PLAYER,target,true); }
  const attackWhy=warProblem(PLAYER,target,false);
  const raid=$('dRaid') as HTMLButtonElement, attack=$('dAttack') as HTMLButtonElement;
  raid.disabled=!!raidWhy || k<1; attack.disabled=!!attackWhy || k<1;
  const why: string[]=[];
  if (k<1 && max) why.push('Choose how many soldiers to send');
  if (raidWhy) why.push('Raid: '+raidWhy.toLowerCase());
  if (attackWhy) why.push('Attack: '+attackWhy.toLowerCase());
  $('dWhy').textContent=why.join(' · ');
}

function send(raid: boolean){
  const k=+commit.value; if (!target || k<1) return;
  if (allied(PLAYER,target)) toast(`Your alliance with ${W.nations[target].name} is over`);
  queueCommand({ type:'war', nation:PLAYER, target, raid, soldiers:k });
  closeDiplomacy();
}

/* ---------- war chips: one per enemy, click to end it ---------- */
interface Front { o: number; a: number; d: number; war: boolean; myRaids: number; homeward: number; theyOffer: boolean; iOffer: boolean; men: number; }
function fronts(){
  const M=W.M, map=new Map<number, Front>();
  for (const c of W.campaigns){
    if (!c.hostile || (c.a!==PLAYER && c.d!==PLAYER)) continue;
    const o=c.a===PLAYER ? c.d : c.a;
    let f=map.get(o);
    if (!f){ f={ o, a:c.a, d:c.d, war:false, myRaids:0, homeward:0, theyOffer:false, iOffer:false, men:0 }; map.set(o,f); }
    if (!c.raid) f.war=true;
    if (c.a===PLAYER){ f.men+=c.members.length; if (c.raid && c.phase<2) f.myRaids++; if (c.phase===2) f.homeward++; }
    else if (!c.raid) { f.a=c.a; f.d=c.d; }   // their attack on us is what names the war
  }
  for (const f of map.values()){
    const at=W.offers[f.o*M+PLAYER]; f.theyOffer=!!at && W.tickN-at<=OFFER_TICKS;
    f.iOffer=!!W.offers[PLAYER*M+f.o];
  }
  return [...map.values()];
}
let lastChips='';
export function updateWarChips(){
  const list=fronts();
  const html=list.map(f => {
    const kind=f.war ? 'War' : 'Raid';
    const [label, act, off] =
      f.theyOffer ? ['Accept peace', 'peace', false] :
      f.myRaids && !f.war ? ['Recall raid', 'end', false] :
      f.myRaids ? ['Recall raid · offer peace', 'end', f.iOffer] :
      f.iOffer ? ['Peace offered…', '', true] :
      !f.war && f.a===PLAYER ? ['Raiders heading home', '', true] :
      ['Offer peace', 'end', false];
    const men=f.men ? ` · ${f.men} out` : '';
    return `<button class="chip war${f.theyOffer?' offer':''}" data-o="${f.o}" data-act="${act}" ${off||!act?'disabled':''}><i style="background:${W.nations[f.a].hex}"></i>${esc(nameOf(f.a))} – ${esc(nameOf(f.d))} · ${kind}${men}<b>${label}</b></button>`;
  }).join('');
  if (html!==lastChips){ lastChips=html; wars.innerHTML=html; }
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]!);

export function setupDiplomacy(){
  $('dClose').onclick=closeDiplomacy;
  $('dAlly').onclick=()=>{ if (target){ queueCommand({ type:'ally', nation:PLAYER, target }); } };
  $('dWar').onclick=showWarView;
  $('dBack').onclick=()=>{ talk.hidden=false; warView.hidden=true; refreshDiplomacy(true); };
  $('dRaid').onclick=()=>send(true);
  $('dAttack').onclick=()=>send(false);
  commit.addEventListener('input',()=>refreshWar(false));
  wars.addEventListener('click',e=>{
    const b=(e.target as HTMLElement).closest('button.chip') as HTMLButtonElement | null; if (!b || b.disabled) return;
    const o=+b.dataset.o!, act=b.dataset.act;
    if (act==='peace') queueCommand({ type:'peace', nation:PLAYER, target:o });
    else if (act==='end') queueCommand({ type:'endWar', nation:PLAYER, target:o });
    lastChips=''; b.disabled=true;
  });
}
export function resetDiplomacy(){ closeDiplomacy(); wars.innerHTML=''; lastChips=''; }
