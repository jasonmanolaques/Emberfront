/* ---------- diplomacy: click another kingdom to propose an alliance or go to war; the war chips,
   and the menu under a chip for meeting an army marching on you (ask for peace, or intercept it) ---------- */
import { PLAYER } from '../core/constants';
import { fmt } from '../core/util';
import { W } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { allied, atWar, available, allyProblem, warProblem, interceptProblem, OFFER_TICKS, LOOT_GOLD } from '../sim/war';
import type { Campaign, Human } from '../sim/state';
import { toast } from './hud';
import { ArmyPicker, armyName } from './armies';
import { unitAt } from '../sim/army';
import { flagCSS } from '../render/flags';
import { $ } from './dom';

const panel=$('diplo'), talk=$('dTalk'), warView=$('dWarView'), wars=$('wars');
const pop=$('warPop'), popMenu=$('wpMenu'), popSend=$('wpSend');
const picker=new ArmyPicker($('dArmies'), () => refreshWar(false)), popPicker=new ArmyPicker($('wpArmies'), () => refreshPop());
let target=0;
let popFor=0, popCamp=-1;   // the enemy whose army the menu is about, and that army
let popCounter=false;       // the menu is for our land being free again: counter-attack or peace
// raid routes take a search of the map: worked out at most once a second while the war screen is open
let raidWhy: string | null = null, raidAt = -1e9;

const nameOf = (id: number) => id===PLAYER ? 'You' : W.nations[id].name;

/** Opens the war screen against o straight away (a counter-attack), with every army. */
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
  picker.reset(); raidAt=-1e9;
  refreshDiplomacy(true);
}

/** Keeps the open panel in step with the match. */
export function refreshDiplomacy(force=false){
  if (panel.hidden) return;
  const me=W.nations[PLAYER], n=W.nations[target];
  if (!me || !n || !n.alive || !me.alive){ closeDiplomacy(); return; }
  $('dCrest').style.cssText=flagCSS(n.code);
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
  const me=W.nations[PLAYER], armies=available(me);
  picker.refresh();
  const k=picker.count(), picked=picker.chosen().length;
  $('dCommitVal').textContent=`${k} soldier${k===1?'':'s'}`;
  $('dSplit').textContent = armies.length ? `${picked} arm${picked===1?'y':'ies'} chosen: each marches on its own. Soldiers without room in a barracks stay home to defend.` : '';
  if (force || performance.now()-raidAt>1000){ raidAt=performance.now(); raidWhy=warProblem(PLAYER,target,true); }
  const attackWhy=warProblem(PLAYER,target,false);
  const raid=$('dRaid') as HTMLButtonElement, attack=$('dAttack') as HTMLButtonElement;
  raid.disabled=!!raidWhy || k<1; attack.disabled=!!attackWhy || k<1;
  const why: string[]=[];
  if (k<1 && armies.length) why.push('Choose the armies to send');
  if (raidWhy) why.push('Raid: '+raidWhy.toLowerCase());
  if (attackWhy) why.push('Attack: '+attackWhy.toLowerCase());
  $('dWhy').textContent=why.join(' · ');
}

function send(raid: boolean){
  const units=picker.chosen(); if (!target || !units.length) return;
  if (allied(PLAYER,target)) toast(`Your alliance with ${W.nations[target].name} is over`);
  queueCommand({ type:'war', nation:PLAYER, target, raid, units });
  closeDiplomacy();
}

/* ---------- war chips: one per enemy ---------- */
interface Front { o: number; a: number; d: number; war: boolean; myRaids: number; men: number; theyOffer: boolean; iOffer: boolean;
  incoming: Campaign[]; fleeing: number; intercepting: number; ready: boolean; }
function fronts(){
  const M=W.M, map=new Map<number, Front>();
  const front=(o: number, a: number, d: number) => { let f=map.get(o); if (!f){ f={ o, a, d, war:!!W.wars[PLAYER*M+o], myRaids:0, men:0, theyOffer:false, iOffer:false, incoming:[], fleeing:0, intercepting:0, ready:false }; map.set(o,f); } return f; };
  for (let o=1;o<M;o++) if (o!==PLAYER && W.wars[PLAYER*M+o] && W.nations[o].alive) front(o,PLAYER,o);
  for (const c of W.campaigns){
    if (!c.hostile || (c.a!==PLAYER && c.d!==PLAYER)) continue;
    const o=c.a===PLAYER ? c.d : c.a, f=front(o,c.a,c.d);
    if (c.a===PLAYER){ f.men+=c.members.length; if (c.raid && c.phase<2) f.myRaids++; if (c.target>=0 && c.phase<2) f.intercepting+=c.members.length; }
    else if (c.target<0){
      if (c.phase<2){ f.incoming.push(c); f.a=c.a; f.d=c.d; }   // their army on the march names the front
      else if (c.raid){ f.fleeing+=c.members.length; if (!f.incoming.length){ f.a=c.a; f.d=c.d; } }   // recalled raiders, still the enemy
    }
  }
  for (const f of map.values()){
    const at=W.offers[f.o*M+PLAYER]; f.theyOffer=!!at && W.tickN-at<=OFFER_TICKS;
    f.iOffer=!!W.offers[PLAYER*M+f.o];
    f.ready=!!W.ready[PLAYER*M+f.o];
  }
  return [...map.values()];
}
/** The enemy army from o that most needs meeting: the biggest one marching on us that nobody is
    after yet, or else raiders on their way home with our loot. */
function incomingFrom(o: number){
  let best: Campaign | undefined;
  const rank=(c: Campaign) => (c.phase<2 ? 1e6 : 0)+c.members.length;
  for (const c of W.campaigns) if (c.a===o && c.d===PLAYER && c.hostile && c.target<0 && !interceptProblem(PLAYER,c.id) && (!best || rank(c)>rank(best))) best=c;
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
/** Each side's armies in this fight: "West army 4/10 +1", the men with it out of its barracks'
    room, and reinforcements on their way to it. */
function groupsOf(o: number, side: number, byId: Map<number, Human>){
  const k=side===0 ? PLAYER : o, out: string[]=[];
  for (const c of W.campaigns){
    if (c.a!==k || !between(c,o) || c.phase===2) continue;
    let here=0, coming=0;
    for (const id of c.members){ const h=byId.get(id); if (!h) continue; if ((h.x-c.bx)**2+(h.y-c.by)**2<40*40) here++; else coming++; }
    const u=unitAt(c.unit), n=W.nations[k];
    const name=u && u.o===k ? armyName(n,u).replace(/ barracks$/i,' army').replace(/^Barracks$/,'Army') : 'Army';
    const tip=`${here} with the army, room for ${u?.cap ?? c.startSoldiers}`+(coming ? `, ${coming} reinforcement${coming===1?'':'s'} on the way` : '');
    out.push(`<em title="${tip}">${esc(name)} ${here}/${u && u.o===k ? u.cap : c.startSoldiers}${coming ? ` +${coming}` : ''}</em>`);
  }
  return out.length ? '<br>'+out.join(' · ') : '';
}
function lootOf(o: number){
  const ids=new Set(W.campaigns.filter(c => between(c,o)).map(c => c.id)), g=[0,0];
  for (const h of W.humans) if (h.loot && ids.has(h.war)) g[h.o===PLAYER ? 0 : 1]+=LOOT_GOLD;
  return g;
}
/** Two colours pushing against each other, as wide as each side's share of everyone in the fight;
    the fallen darken each side from its outer end, under a field of skulls. Then the numbers. */
function powerBar(f: Front, b: Battle, byId: Map<number, Human>){
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
      (loot[s] ? `<br>Loot carried: ${loot[s]} gold` : '')+groupsOf(f.o,s,byId)+`</span>`;
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
      f.ready ? ['Counter-attack or peace ▾', 'counter', false] :
      open ? ['Respond ▾', 'respond', false] :
      f.myRaids && !f.war ? ['Recall raid', 'end', false] :
      f.myRaids ? ['Recall raid · offer peace', 'end', f.iOffer] :
      f.iOffer ? ['Peace offered…', '', true] :
      // a raid has no peace: it is over when the raiders are dead or home
      !f.war ? [f.a===PLAYER ? 'Raiders heading home' : f.fleeing ? 'Raiders fleeing' : 'Under attack', '', true] :
      ['Offer peace', 'end', false];
    const inc=f.incoming.reduce((k,c)=>k+c.members.length,0);
    const men=(inc ? ` · ${inc} coming` : '')+(f.fleeing ? ` · ${f.fleeing} fleeing` : '')+(f.intercepting ? ` · ${f.intercepting} intercepting` : '')+(f.men-f.intercepting>0 ? ` · ${f.men-f.intercepting} out` : '');
    const chip=`<button class="chip war${f.theyOffer||f.ready?' offer':''}${open?' threat':''}" data-o="${f.o}" data-act="${act}" ${off||!act?'disabled':''}><i class="flag" style="${flagCSS(W.nations[f.a].code)}"></i>${esc(nameOf(f.a))} – ${esc(nameOf(f.d))} · ${kind}${men}<b>${label}</b></button>`;
    return `<div class="front" data-o="${f.o}">${chip}${powerBar(f,track(f.o,byId),byId)}</div>`;
  }).join('');
  if (html!==lastChips){ lastChips=html; wars.innerHTML=html; placePop(); }
  if (!pop.hidden){
    if (popCounter){ if (!W.ready[PLAYER*W.M+popFor]) closePop(); }
    else if (!incomingFrom(popFor) && popCamp<0) closePop(); else if (!popSend.hidden) refreshPop();
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
function openPop(o: number, counter=false){
  popFor=o; popCamp=-1; popCounter=counter; pop.hidden=false; popMenu.hidden=false; popSend.hidden=true;
  const E=incomingFrom(o), war=!!W.wars[PLAYER*W.M+o];
  ($('wpTitle')).textContent = counter ? `Your land is free of ${W.nations[o].name}`
    : !E || E.phase<2 ? `${W.nations[o].name}'s ${E?.raid ? 'raiders are' : 'army is'} coming` : `${W.nations[o].name}'s raiders are fleeing`;
  $('wpPeace').textContent = counter ? 'Offer peace' : 'Request peace';
  $('wpIntercept').textContent = counter ? 'Counter-attack…' : 'Intercept…';
  $('wpIntercept').title = counter ? 'Strike back with your armies: your troops are thirsty for revenge, and hit harder' : 'Send armies out to meet their army in the field';
  $('wpPeace').hidden=!war;   // raiders can't be bargained with, only fought
  popMenu.classList.toggle('one',!war);
  placePop();
}
export function closePop(){ pop.hidden=true; popFor=0; popCamp=-1; popCounter=false; }
function showIntercept(){
  const E=incomingFrom(popFor), me=W.nations[PLAYER]; if (!E || !me){ closePop(); return; }
  popCamp=E.id; popMenu.hidden=true; popSend.hidden=false;
  popPicker.reset(E.members.length);   // the biggest armies, until they match what they send
  refreshPop(); placePop();
}
function refreshPop(){
  const me=W.nations[PLAYER], E=W.campaigns.find(c => c.id===popCamp);
  if (!me || !E || interceptProblem(PLAYER,E.id)){ closePop(); return; }
  popPicker.refresh();
  const k=popPicker.count();
  $('wpVal').textContent=`${k} soldier${k===1?'':'s'}`;
  $('wpSplit').textContent=`They send ${E.members.length} · you have ${available(me).reduce((s,a) => s+a.men.length,0)} ready in your barracks`;
  ($('wpGo') as HTMLButtonElement).disabled=k<1;
}

export function setupDiplomacy(){
  $('dClose').onclick=closeDiplomacy;
  $('dAlly').onclick=()=>{ if (target){ queueCommand({ type:'ally', nation:PLAYER, target }); } };
  $('dWar').onclick=showWarView;
  $('dBack').onclick=()=>{ talk.hidden=false; warView.hidden=true; refreshDiplomacy(true); };
  $('dRaid').onclick=()=>send(true);
  $('dAttack').onclick=()=>send(false);
  wars.addEventListener('click',e=>{
    const b=(e.target as HTMLElement).closest('button.chip') as HTMLButtonElement | null; if (!b || b.disabled) return;
    const o=+b.dataset.o!, act=b.dataset.act;
    if (act==='respond'){ if (!pop.hidden && popFor===o) closePop(); else openPop(o); return; }
    if (act==='counter'){ if (!pop.hidden && popFor===o) closePop(); else openPop(o,true); return; }
    if (act==='peace') queueCommand({ type:'peace', nation:PLAYER, target:o });
    else if (act==='end') queueCommand({ type:'endWar', nation:PLAYER, target:o });
    lastChips=''; b.disabled=true;
  });
  $('wpPeace').onclick=()=>{ if (popFor){ queueCommand({ type:'endWar', nation:PLAYER, target:popFor }); toast(`You ask ${W.nations[popFor].name} for peace`); } closePop(); };
  $('wpIntercept').onclick=()=>{ if (popCounter){ const o=popFor; closePop(); openCounter(o); } else showIntercept(); };
  $('wpBack').onclick=()=>{ popCamp=-1; popMenu.hidden=false; popSend.hidden=true; placePop(); };
  $('wpClose').onclick=closePop;
  $('wpGo').onclick=()=>{
    const units=popPicker.chosen(); if (popCamp<0 || !units.length) return;
    queueCommand({ type:'intercept', nation:PLAYER, campaign:popCamp, units });
    closePop();
  };
}
export function resetDiplomacy(){ closeDiplomacy(); closePop(); wars.innerHTML=''; lastChips=''; battles.clear(); }
