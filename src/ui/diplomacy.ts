/* ---------- diplomacy: click another kingdom to propose an alliance or go to war; the war chips,
   and the menu under a chip for meeting an army marching on you (ask for peace, or intercept it) ---------- */
import { PLAYER } from '../core/constants';
import { fmt } from '../core/util';
import { W } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { allied, atWar, available, allyProblem, warProblem, interceptProblem, OFFER_TICKS, LOOT_GOLD } from '../sim/war';
import type { Campaign, Human } from '../sim/state';
import { toast } from './hud';
import { $ } from './dom';

const panel=$('diplo'), talk=$('dTalk'), warView=$('dWarView'), wars=$('wars');
const commit=$('dCommit') as HTMLInputElement;
const pop=$('warPop'), popMenu=$('wpMenu'), popSend=$('wpSend'), popCount=$('wpCount') as HTMLInputElement;
let target=0;
let followMax=false;   // the war slider sits at "everyone", and keeps up as new soldiers are trained
let popFor=0, popCamp=-1;   // the enemy whose army the menu is about, and that army
// raid routes take a search of the map: worked out at most once a second while the war screen is open
let raidWhy: string | null = null, raidAt = -1e9;

const nameOf = (id: number) => id===PLAYER ? 'You' : W.nations[id].name;

/** Opens the war screen against o straight away (a counter-attack), with every free soldier. */
export function openCounter(o: number){ openDiplomacy(o); if (!panel.hidden) showWarView(); }
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
  commit.max=String(pool); commit.value=String(pool); raidAt=-1e9; followMax=true;
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
  if (+commit.max!==max){ const was=+commit.value; commit.max=String(max); commit.value=String(followMax ? max : Math.min(was,max)); }
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

/* ---------- war chips: one per enemy ---------- */
interface Front { o: number; a: number; d: number; war: boolean; myRaids: number; men: number; theyOffer: boolean; iOffer: boolean;
  incoming: Campaign[]; intercepting: number; ready: boolean; }
function fronts(){
  const M=W.M, map=new Map<number, Front>();
  const front=(o: number, a: number, d: number) => { let f=map.get(o); if (!f){ f={ o, a, d, war:!!W.wars[PLAYER*M+o], myRaids:0, men:0, theyOffer:false, iOffer:false, incoming:[], intercepting:0, ready:false }; map.set(o,f); } return f; };
  for (let o=1;o<M;o++) if (o!==PLAYER && W.wars[PLAYER*M+o] && W.nations[o].alive) front(o,PLAYER,o);
  for (const c of W.campaigns){
    if (!c.hostile || (c.a!==PLAYER && c.d!==PLAYER)) continue;
    const o=c.a===PLAYER ? c.d : c.a, f=front(o,c.a,c.d);
    if (c.a===PLAYER){ f.men+=c.members.length; if (c.raid && c.phase<2) f.myRaids++; if (c.target>=0 && c.phase<2) f.intercepting+=c.members.length; }
    else { if (c.phase<2 && c.target<0){ f.incoming.push(c); f.a=c.a; f.d=c.d; } }   // their army on the march names the front
  }
  for (const f of map.values()){
    const at=W.offers[f.o*M+PLAYER]; f.theyOffer=!!at && W.tickN-at<=OFFER_TICKS;
    f.iOffer=!!W.offers[PLAYER*M+f.o];
    f.ready=!!W.ready[PLAYER*M+f.o];
  }
  return [...map.values()];
}
/** The enemy army from o that most needs meeting: the biggest one marching on us that nobody is after yet. */
function incomingFrom(o: number){
  let best: Campaign | undefined;
  for (const c of W.campaigns) if (c.a===o && c.d===PLAYER && c.hostile && c.phase<2 && c.target<0 && !interceptProblem(PLAYER,c.id) && (!best || c.members.length>best.members.length)) best=c;
  return best;
}
/* ---------- the balance of power: everyone who has fought in the current battle with o, and the fallen ----------
   A battle starts when an army sets out between us after a lull, and counts everyone who joins
   it: the armies, and anyone else pulled into the fight. Side 0 is us, side 1 them. */
interface Battle { side: Map<number, number>; total: number[]; soldiers: number[]; villagers: number[]; active: boolean; }
const battles=new Map<number, Battle>();
const between=(c: Campaign, o: number) => (c.a===PLAYER && c.d===o) || (c.a===o && c.d===PLAYER);
function track(o: number, byId: Map<number, Human>){
  const active=W.campaigns.some(c => between(c,o) && c.hostile && c.phase<2);
  let b=battles.get(o);
  if (!b || (active && !b.active)){ b={ side:new Map(), total:[0,0], soldiers:[0,0], villagers:[0,0], active }; battles.set(o,b); }
  b.active=active;
  const sideOf=(h: Human) => h.o===PLAYER ? 0 : h.o===o ? 1 : -1;
  const add=(h: Human) => { const s=sideOf(h); if (s<0 || b!.side.has(h.id)) return; b!.side.set(h.id,s); b!.total[s]++; };
  const ids=new Set(W.campaigns.filter(c => between(c,o)).map(c => c.id));
  for (const h of W.humans){
    if (h.o!==PLAYER && h.o!==o) continue;
    if (h.war>=0 && ids.has(h.war)) add(h);
    else if (h.foe>=0 && h.brave!==0){ const e=byId.get(h.foe); if (e && sideOf(e)===1-sideOf(h)){ add(h); add(e); } }   // pulled into the fight
  }
  return b;
}
/** Counts someone among the fallen of any battle they fought in. */
export function noteDeath(id: number, _o: number, kind: number){
  for (const b of battles.values()){
    const s=b.side.get(id); if (s===undefined) continue;
    (kind===1 ? b.soldiers : b.villagers)[s]++; b.side.delete(id);
  }
}
function lootOf(o: number){
  const ids=new Set(W.campaigns.filter(c => between(c,o)).map(c => c.id)), g=[0,0];
  for (const h of W.humans) if (h.loot && ids.has(h.war)) g[h.o===PLAYER ? 0 : 1]+=LOOT_GOLD;
  return g;
}
/** Two colours pushing against each other, as wide as each side's share of everyone in the fight;
    the fallen darken each side from its outer end, under a field of skulls. Then the numbers. */
function powerBar(f: Front, b: Battle){
  const all=b.total[0]+b.total[1]; if (!all) return '';
  const loot=lootOf(f.o), L=f.a===PLAYER ? 0 : 1, R=1-L, ids=[PLAYER,f.o];
  const seg=(s: number, cls: string) => {
    const dead=b.soldiers[s]+b.villagers[s];
    return `<i class="${cls}" style="width:${(b.total[s]/all*100).toFixed(1)}%;background:${W.nations[ids[s]].hex}"><s style="width:${b.total[s] ? (dead/b.total[s]*100).toFixed(1) : 0}%"></s></i>`;
  };
  const info=(s: number) => {
    const dead=b.soldiers[s]+b.villagers[s];
    return `<span><b style="color:${W.nations[ids[s]].hex}">${esc(nameOf(ids[s]))}</b> ${b.total[s]-dead} fighting`+
      `<br>Dead: ${b.soldiers[s]} soldier${b.soldiers[s]===1?'':'s'}, ${b.villagers[s]} villager${b.villagers[s]===1?'':'s'}`+
      (loot[s] ? `<br>Loot carried: ${loot[s]} gold` : '')+`</span>`;
  };
  return `<div class="pbar" title="Balance of power: everyone in the fight, the fallen under skulls">${seg(L,'l')}${seg(R,'r')}</div><div class="pinfo">${info(L)}${info(R)}</div>`;
}

let lastChips='';
export function updateWarChips(){
  const list=fronts(), byId=new Map<number, Human>();
  for (const h of W.humans) byId.set(h.id,h);
  const html=list.map(f => {
    const kind=f.war ? 'War' : 'Raid', open=incomingFrom(f.o);
    const [label, act, off] =
      f.theyOffer ? ['Accept peace', 'peace', false] :
      f.ready ? ['Counter-attack…', 'counter', false] :
      open ? ['Respond ▾', 'respond', false] :
      f.myRaids && !f.war ? ['Recall raid', 'end', false] :
      f.myRaids ? ['Recall raid · offer peace', 'end', f.iOffer] :
      f.iOffer ? ['Peace offered…', '', true] :
      !f.war && f.a===PLAYER ? ['Raiders heading home', '', true] :
      ['Offer peace', 'end', false];
    const inc=f.incoming.reduce((k,c)=>k+c.members.length,0);
    const men=(inc ? ` · ${inc} coming` : '')+(f.intercepting ? ` · ${f.intercepting} intercepting` : '')+(f.men-f.intercepting>0 ? ` · ${f.men-f.intercepting} out` : '');
    const chip=`<button class="chip war${f.theyOffer||f.ready?' offer':''}${open?' threat':''}" data-o="${f.o}" data-act="${act}" ${off||!act?'disabled':''}><i style="background:${W.nations[f.a].hex}"></i>${esc(nameOf(f.a))} – ${esc(nameOf(f.d))} · ${kind}${men}<b>${label}</b></button>`;
    return `<div class="front" data-o="${f.o}">${chip}${powerBar(f,track(f.o,byId))}</div>`;
  }).join('');
  if (html!==lastChips){ lastChips=html; wars.innerHTML=html; placePop(); }
  if (!pop.hidden){
    if (!incomingFrom(popFor) && popCamp<0) closePop(); else if (!popSend.hidden) refreshPop();
  }
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]!);

/* ---------- the menu under a chip: ask for peace, or intercept the army ---------- */
function placePop(){
  if (pop.hidden) return;
  const chip=wars.querySelector(`.front[data-o="${popFor}"]`) as HTMLElement | null;
  if (!chip){ closePop(); return; }
  const g=$('game').getBoundingClientRect(), r=chip.getBoundingClientRect();
  pop.style.left=Math.max(8,Math.min(g.width-pop.offsetWidth-8,r.left-g.left+r.width/2-pop.offsetWidth/2))+'px';
  pop.style.top=(r.bottom-g.top+6)+'px';
}
function openPop(o: number){
  popFor=o; popCamp=-1; pop.hidden=false; popMenu.hidden=false; popSend.hidden=true;
  ($('wpTitle')).textContent=`${W.nations[o].name}'s army is coming`;
  placePop();
}
export function closePop(){ pop.hidden=true; popFor=0; popCamp=-1; }
function showIntercept(){
  const E=incomingFrom(popFor), me=W.nations[PLAYER]; if (!E || !me){ closePop(); return; }
  popCamp=E.id; popMenu.hidden=true; popSend.hidden=false;
  const pool=available(me);
  // as many as they send, if the barracks can spare them; watchtower guards only if the player says so
  popCount.max=String(pool.all.length); popCount.value=String(Math.min(E.members.length,pool.idle.length));
  refreshPop(); placePop();
}
function refreshPop(){
  const me=W.nations[PLAYER], E=W.campaigns.find(c => c.id===popCamp);
  if (!me || !E || E.phase===2){ closePop(); return; }
  const pool=available(me), max=pool.all.length;
  if (+popCount.max!==max){ popCount.max=String(max); if (+popCount.value>max) popCount.value=String(max); }
  const k=+popCount.value, fromGuards=Math.max(0,k-pool.idle.length);
  popCount.style.setProperty('--fill',(max ? k/max*100 : 0)+'%');
  $('wpVal').textContent=`${k} / ${max}`;
  $('wpSplit').textContent=`They send ${E.members.length} · you have ${pool.idle.length} idle, ${pool.guards.length} on guard`;
  const warn=$('wpWarn'); warn.hidden=!fromGuards;
  warn.textContent = fromGuards>1 ? `${fromGuards} garrison soldiers will leave their watchtowers` : '1 garrison soldier will leave his watchtower';
  ($('wpGo') as HTMLButtonElement).disabled=k<1;
}

export function setupDiplomacy(){
  $('dClose').onclick=closeDiplomacy;
  $('dAlly').onclick=()=>{ if (target){ queueCommand({ type:'ally', nation:PLAYER, target }); } };
  $('dWar').onclick=showWarView;
  $('dBack').onclick=()=>{ talk.hidden=false; warView.hidden=true; refreshDiplomacy(true); };
  $('dRaid').onclick=()=>send(true);
  $('dAttack').onclick=()=>send(false);
  commit.addEventListener('input',()=>{ followMax=+commit.value===+commit.max; refreshWar(false); });
  wars.addEventListener('click',e=>{
    const b=(e.target as HTMLElement).closest('button.chip') as HTMLButtonElement | null; if (!b || b.disabled) return;
    const o=+b.dataset.o!, act=b.dataset.act;
    if (act==='respond'){ if (!pop.hidden && popFor===o) closePop(); else openPop(o); return; }
    if (act==='counter'){ openCounter(o); return; }
    if (act==='peace') queueCommand({ type:'peace', nation:PLAYER, target:o });
    else if (act==='end') queueCommand({ type:'endWar', nation:PLAYER, target:o });
    lastChips=''; b.disabled=true;
  });
  $('wpPeace').onclick=()=>{ if (popFor){ queueCommand({ type:'endWar', nation:PLAYER, target:popFor }); toast(`You ask ${W.nations[popFor].name} for peace`); } closePop(); };
  $('wpIntercept').onclick=showIntercept;
  $('wpBack').onclick=()=>{ popCamp=-1; popMenu.hidden=false; popSend.hidden=true; placePop(); };
  $('wpClose').onclick=closePop;
  popCount.addEventListener('input',refreshPop);
  $('wpGo').onclick=()=>{
    const k=+popCount.value; if (popCamp<0 || k<1) return;
    queueCommand({ type:'intercept', nation:PLAYER, campaign:popCamp, soldiers:k });
    closePop();
  };
}
export function resetDiplomacy(){ closeDiplomacy(); closePop(); wars.innerHTML=''; lastChips=''; battles.clear(); }
