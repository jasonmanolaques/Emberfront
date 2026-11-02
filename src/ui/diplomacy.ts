/* ---------- diplomacy: click another kingdom to propose an alliance or go to war; the war chips
   (a crisis while armies mass on a border, then the war), the word under a chip (in a crisis, go to
   war; at war, attack along the front or hold it), the call-up of the militia
   reserves, and the menu under a chip for meeting an army coming at you (ask for peace, or hold your
   border against it) ---------- */
import { PLAYER, PW, TW, GAME_SPEED } from '../core/constants';
import { fmt } from '../core/util';
import { W, pType, pOwner, pBurn } from '../sim/state';
import { client } from '../client';
import { basesOf, dockTile, shipById, SHIP_CAP, SHIP_WAIT } from '../sim/naval';
import { queueCommand } from '../sim/sim';
import { S_BALANCED, S_BORDER, S_RUSH, allied, atWar, available, callable, allyProblem, warProblem, navalPlan, navalOf, defendProblem, reservesOf, reservesProblem, inCrisis, crisisWait, attacks, hasArmies, OFFER_TICKS, PRESENT, F_GATHER, F_READY, F_PUSH } from '../sim/war';
import type { Campaign, Human } from '../sim/state';
import { toast, ui } from './hud';
import { ArmyPicker, armyName, baseName } from './armies';
import { unitAt } from '../sim/army';
import { flagCSS } from '../render/flags';
import { $ } from './dom';

const panel=$('diplo'), talk=$('dTalk'), warView=$('dWarView'), wars=$('wars');
const pop=$('warPop'), popMenu=$('wpMenu'), popSend=$('wpSend');
const picker=new ArmyPicker($('dArmies'), () => refreshWar(false)), popPicker=new ArmyPicker($('wpArmies'), () => refreshPop());
let target=0;
let basesHtml='';
let navalOn=false, baseSel=-1;   // the war screen: planning a naval invasion, and from which naval base (a main plot)
let milOn=false, milPick=-1;   // the war screen: send militia too, and how many (-1: all of them, until moved)
let popFor=0, popCamp=-1;   // the enemy whose army the menu is about, and that army (-2: our border with them, to hold)
let popCounter=false;       // the menu is for our land being free again: counter-attack or peace

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
  picker.reset(); navalOn=false; baseSel=-1;
  milOn=!available(me).length && callable(PLAYER).length>0; milPick=-1;   // with no armies, the militia are all there is
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

/** How many militia the war screen sends: none unless chosen, else the slider's (all of them to start with). */
function milSent(){ const mil=callable(PLAYER).length; return milOn ? Math.min(mil, milPick<0 ? mil : milPick) : 0; }
function refreshWar(force: boolean){
  const me=W.nations[PLAYER], armies=available(me);
  picker.refresh();
  const soldiers=picker.count(), picked=picker.chosen().length;
  $('dCommitVal').textContent=`${soldiers} soldier${soldiers===1?'':'s'}`;
  // the militia at home (not the watchtowers' guards): a toggle, then a slider for how many
  const mil=callable(PLAYER).length, m=milSent(), slider=$('dMil') as HTMLInputElement, tog=$('dMilOn') as HTMLButtonElement;
  if (!mil) milOn=false;
  tog.disabled=!mil; tog.setAttribute('aria-pressed',String(milOn));
  $('dMilAt').textContent=mil ? `${milOn ? m+' of ' : ''}${mil} at home` : 'none at home';
  $('dMilBox').hidden=!milOn;
  slider.max=String(mil); if (document.activeElement!==slider) slider.value=String(m);
  slider.style.setProperty('--fill',(mil ? m/mil*100 : 0)+'%');
  $('dMilVal').textContent=String(m);
  const k=soldiers+m;
  $('dSplit').textContent = (picked || m ? `${picked ? `${picked} arm${picked===1?'y':'ies'}` : ''}${picked && m ? ' and ' : ''}${m ? `${m} militia` : ''} chosen. ` : '')
    + 'An attack masses them along the border (those already deployed there stay): a crisis, not yet a war. Both sides get 30 seconds to react before you can begin the offensive.'
    + (mil && !milOn ? ` You have ${mil} militia at home: use them too, or call them up from the war bar later.` : '');
  const attackWhy=warProblem(PLAYER,target);
  const attack=$('dAttack') as HTMLButtonElement;
  attack.disabled=!!attackWhy || (k<1 && !hasArmies(PLAYER,target));
  const why: string[]=[];
  if (k<1 && !hasArmies(PLAYER,target)) why.push(armies.length || mil ? 'Choose who to send' : 'No armies and no militia: raise some with the soldier slider');
  if (attackWhy) why.push('Attack: '+attackWhy.toLowerCase());
  $('dWhy').textContent=why.join(' · ');
  // the naval invasion: the naval bases, the ships, and what the armies chosen need
  const bases=basesOf(me), nv=$('dNaval') as HTMLButtonElement, box=$('dNavalBox'), need=Math.ceil(soldiers/SHIP_CAP);
  if (!bases.length) navalOn=false;
  nv.disabled=!bases.length; nv.setAttribute('aria-pressed',String(navalOn));
  nv.title = bases.length ? 'Land the armies chosen from the sea: ships carry them (5 men each) from a naval base to a stretch of their coast' : 'Build a naval base (in the military menu) to invade by sea';
  box.hidden=!navalOn;
  if (navalOn){
    if (!bases.includes(baseSel)) baseSel=bases.slice().sort((a,b) => dist2(a)-dist2(b))[0] ?? -1;
    $('dShips').textContent=`${me.fleet} ship${me.fleet===1 ? '' : 's'} ready`;
    const html=bases.map(q => `<button class="army" data-q="${q}" aria-pressed="${q===baseSel}"><span class="an">${baseName(me,q)}</span><span class="at">${me.fleet} ship${me.fleet===1 ? '' : 's'} ready</span></button>`).join('');
    if (html!==basesHtml){ basesHtml=html; $('dBases').innerHTML=html; }
    const short=me.fleet<need;
    $('dNavalInfo').textContent=(soldiers ? `${soldiers} soldier${soldiers===1 ? '' : 's'} need ${need} ship${need===1 ? '' : 's'} (5 men each); ${me.fleet} ready, from any harbour. ` : 'Choose the armies to send by sea. ')
      +(m ? 'Militia cannot sail: only soldiers of barracks go. ' : '')
      +'The ships sail from the base you pick to a line off their coast; it is a crisis until you give the word, then they land and the ships sail home to be counted again. An army landed from ships is never reinforced.';
    const go=$('dCoast') as HTMLButtonElement;
    go.disabled=!soldiers || short || baseSel<0;
    go.title = !soldiers ? 'Choose the armies to send' : short ? `You need ${need} ships: build them at a naval base` : 'Then point at the stretch of their coast to land on';
  } else basesHtml='';
}
/** Squared distance from a naval base to the target's capital: the nearest harbour is the one chosen to start with. */
function dist2(q: number){
  const D=W.nations[target]; if (!D || D.capTile<0) return 0;
  const [bx,by]=[(q%PW)*4+8,((q/PW)|0)*4+4];
  return (bx-D.capTile%TW)**2+(by-((D.capTile/TW)|0))**2;
}
/** The coast tile (click) of the target is chosen: the landing is planned, and the ships sail. */
export function chooseCoast(t: number){
  const L=client.landing; if (!L) return;
  const plan=navalPlan(PLAYER,L.target,L.units,L.base,t);
  if (typeof plan==='string'){ toast(plan); return; }
  queueCommand({ type:'war', nation:PLAYER, target:L.target, units:L.units, naval:{ base:L.base, coast:t } });
  cancelLanding();
}
export function cancelLanding(){ if (!client.landing) return; client.landing=null; ui.banner.hidden=true; }
function startLanding(){
  const units=picker.chosen(), soldiers=picker.count();
  if (!target || !units.length || baseSel<0) return;
  client.landing={ target, base:baseSel, units, men:soldiers };
  ui.banner.textContent=`Choose the coast of ${W.nations[target].name} to land on: point at it to see the landing zone, click to send the ships · Esc to cancel`; ui.banner.hidden=false;
  closeDiplomacy();
}

function send(){
  const units=picker.chosen(), militia=milSent(); if (!target || (!units.length && !militia && !hasArmies(PLAYER,target))) return;
  if (allied(PLAYER,target)) toast(`Your alliance with ${W.nations[target].name} is over`);
  queueCommand({ type:'war', nation:PLAYER, target, units, militia });
  closeDiplomacy();
}

/* ---------- war chips: one per enemy ---------- */
interface Front { o: number; a: number; d: number; war: boolean; crisis: number; men: number; theyOffer: boolean; iOffer: boolean;
  incoming: Campaign[]; ready: boolean; }
function fronts(){
  const M=W.M, map=new Map<number, Front>();
  const front=(o: number, a: number, d: number) => { let f=map.get(o); if (!f){ f={ o, a, d, war:!!W.wars[PLAYER*M+o], crisis:0, men:0, theyOffer:false, iOffer:false, incoming:[], ready:false }; map.set(o,f); } return f; };
  for (let o=1;o<M;o++){
    if (o===PLAYER || !W.nations[o].alive) continue;
    if (W.wars[PLAYER*M+o]){ const f=front(o,PLAYER,o); if (W.aggr[o*M+PLAYER] && !W.aggr[PLAYER*M+o]){ f.a=o; f.d=PLAYER; } }   // (named by who started it)
    // a crisis (1: we massed on their border, 2: they on ours) names the front by who started it
    else if (W.aggr[PLAYER*M+o]) front(o,PLAYER,o).crisis=1;
    else if (W.aggr[o*M+PLAYER]) front(o,o,PLAYER).crisis=2;
  }
  // (armies add to a war or a crisis that exists; armies deployed in peace, or on their way home, make no chip: a war that is over leaves nothing on the screen)
  for (const c of W.campaigns){
    if (!c.hostile || (c.a!==PLAYER && c.d!==PLAYER)) continue;
    const o=c.a===PLAYER ? c.d : c.a, f=map.get(o); if (!f) continue;
    if (c.a===PLAYER) f.men+=c.members.length;
    else if (c.phase<2) f.incoming.push(c);
  }
  for (const f of map.values()){
    const at=W.offers[f.o*M+PLAYER]; f.theyOffer=!!at && W.tickN-at<=OFFER_TICKS;
    f.iOffer=!!W.offers[PLAYER*M+f.o];
    f.ready=!!W.ready[PLAYER*M+f.o];
  }
  return [...map.values()];
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
    for (const id of c.members){
      const h=byId.get(id); if (!h) continue;
      // on a front, with the army means at his place in the line; on a march, near its banner
      if (c.front ? h.fk>=0 && (h.x-h.fx)**2+(h.y-h.fy)**2<(PRESENT*3)**2 : (h.x-c.bx)**2+(h.y-c.by)**2<40*40) here++; else coming++;
    }
    const u=unitAt(c.unit), n=W.nations[k];
    if (c.militia){ out.push(`<em title="Militia called up as reserves">Reserves ${here}${coming ? ` +${coming}` : ''}</em>`); continue; }
    const name=u && u.o===k ? armyName(n,u).replace(/ barracks$/i,' army').replace(/^Barracks$/,'Army') : 'Army';
    const tip=`${here} with the army, room for ${u?.cap ?? c.startSoldiers}`+(coming ? `, ${coming} reinforcement${coming===1?'':'s'} on the way` : '');
    out.push(`<em title="${tip}">${esc(name)} ${here}/${u && u.o===k ? u.cap : c.startSoldiers}${coming ? ` +${coming}` : ''}</em>`);
  }
  return out.length ? '<br>'+out.join(' · ') : '';
}
/** Two colours pushing against each other, as wide as each side's share of everyone in the fight;
    the fallen darken each side from its outer end, under a field of skulls. Then the numbers. */
function powerBar(f: Front, b: Battle, byId: Map<number, Human>){
  const all=b.total[0]+b.total[1]; if (!all) return '';
  const L=f.a===PLAYER ? 0 : 1, R=1-L, ids=[PLAYER,f.o];
  const seg=(s: number, cls: string) => {
    const dead=b.soldiers[s]+b.villagers[s];
    return `<i class="${cls}" style="width:${(b.total[s]/all*100).toFixed(1)}%;background:${W.nations[ids[s]].hex}"><s style="width:${b.total[s] ? (dead/b.total[s]*100).toFixed(1) : 0}%"></s></i>`;
  };
  const info=(s: number) => {
    const dead=b.soldiers[s]+b.villagers[s];
    return `<span><b style="color:${W.nations[ids[s]].hex}">${esc(nameOf(ids[s]))}</b> ${b.total[s]-dead} fighting`+
      `<br>Dead: ${b.soldiers[s]} soldier${b.soldiers[s]===1?'':'s'}, ${b.villagers[s]} villager${b.villagers[s]===1?'':'s'}`+
      groupsOf(f.o,s,byId)+`</span>`;
  };
  return `<div class="pbar" title="Balance of power: everyone in the fight, the fallen under skulls">${seg(L,'l')}${seg(R,'r')}</div><div class="pinfo">${info(L)}${info(R)}</div>`;
}

let lastChips='';
/** Can we send armies to hold our border with o: they are massing on it, or at war with us? */
const canDefend = (o: number) => !defendProblem(PLAYER,o);
export function updateWarChips(){
  const list=fronts(), byId=new Map<number, Human>();
  for (const h of W.humans) byId.set(h.id,h);
  const html=list.map(f => {
    const kind=f.war ? 'War' : 'Crisis', open=(f.crisis===2 || f.war) && canDefend(f.o) && W.campaigns.some(c => c.front && c.a===f.o && c.d===PLAYER && c.phase<2);
    const [label, act, off] =
      f.theyOffer ? ['Accept peace', 'peace', false] :
      f.ready ? ['Counter-attack or peace ▾', 'counter', false] :
      f.crisis===1 ? ['De-escalate', 'calm', false] :
      open ? ['Respond ▾', 'respond', false] :
      f.crisis===2 ? ['Crisis', '', true] :
      f.iOffer ? ['Peace offered…', '', true] :
      ['Offer peace', 'end', false];
    const massed=f.incoming.reduce((k,c)=>k+c.members.length,0);
    const men=(massed ? ` · ${massed} ${f.a===PLAYER ? 'holding their border' : 'on your border'}` : '')+(f.men>0 ? ` · ${f.men} out` : '');
    const chip=`<button class="chip war${f.theyOffer||f.ready?' offer':''}${open?' threat':''}" data-o="${f.o}" data-act="${act}" ${off||!act?'disabled':''}><i class="flag" style="${flagCSS(W.nations[f.a].code)}"></i>${esc(nameOf(f.a))} – ${esc(nameOf(f.d))} · ${kind}${men}<b>${label}</b></button>`;
    return `<div class="front" data-o="${f.o}">${chip}${word(f.o,byId)}${stances(f.o)}${powerBar(f,track(f.o,byId),byId)}${reserves(f.o)}</div>`;
  }).join('');
  if (html!==lastChips){ lastChips=html; wars.innerHTML=html; placePop(); }
  if (!pop.hidden){
    if (!popCounter && !list.some(f => f.o===popFor)) closePop();   // (the war is over: the menu goes with it)
    else if (popCounter){ if (!W.ready[PLAYER*W.M+popFor]) closePop(); }
    else if (!canDefend(popFor)) closePop(); else if (!popSend.hidden) refreshPop();
  }
}
/** Under the chip, the word for our armies against o: gathering on the border (and how many are in
    place), then a button to attack all along the front, to hold it, and to attack again. For o's
    offensive against us, how it stands. */
function word(o: number, byId: Map<number, Human>){
  const M=W.M, key=PLAYER*M+o, st=W.offensive[key];
  const mine=W.campaigns.filter(c => c.a===PLAYER && c.d===o && c.phase<2 && c.hostile);
  if (mine.some(c => c.front)){
    let men=0, here=0;
    for (const c of mine) if (c.front) for (const id of c.members){
      const h=byId.get(id); if (!h || h.id===c.leader) continue;
      men++; if (h.fk>=0 && (h.x-h.fx)**2+(h.y-h.fy)**2<=(PRESENT*2)**2) here++;
    }
    const nm=esc(W.nations[o].name);
    const inv=navalOf(PLAYER,o);   // a landing from the sea whose ships are not yet in
    const wait=inCrisis(PLAYER,o) ? crisisWait(PLAYER,o) : 0, secs=Math.ceil(wait/10/GAME_SPEED);
    if (inv){
      const lined=inv.ships.filter(id => shipById(id)?.mode===SHIP_WAIT).length;
      if (inv.stage===0) return `<button class="fword" disabled title="Your ships are sailing to a line off their coast, the armies aboard">⚓ Sailing to ${nm} · ${lined}/${inv.ships.length} ships in line</button>`;
      if (inCrisis(PLAYER,o)){
        if (wait>0) return `<button class="fword" disabled title="Both sides have 30 seconds to react, and to call it off">⏳ Time to talk · ${secs} s before the landing</button>`;
        return `<button class="fword go" data-o="${o}" data-go="1" title="Begin the offensive: the ships put your armies ashore on their coast, row after row, and sail home">⚔ Begin offensive · land!</button>`;
      }
    }
    if (inCrisis(PLAYER,o)){
      if (wait>0) return `<button class="fword" disabled title="A crisis runs 30 seconds before the offensive can begin: time for both sides to react, to de-escalate or to answer">⏳ Time to talk · ${secs} s · ${here}/${men} in place</button>`;
      if (st===F_GATHER) return `<button class="fword" disabled title="Your armies are taking their places along the border">Gathering on the border · ${here}/${men} in place</button>`;
      return `<button class="fword go" data-o="${o}" data-go="1" title="Begin the offensive: every army of yours on the border attacks (set an army to defend on the armies list to keep it back)">⚔ Begin offensive</button>`;
    }
    if (!W.wars[key]) return '';
    // at war: the word for every army at once; each can be set apart on the armies list
    const all=mine.filter(c => c.front && c.naval<0).length, atk=armiesAttacking(o);
    if (!all) return '';
    return `<div class="fwords"><button class="fword go" data-o="${o}" data-go="1" ${atk===all ? 'disabled' : ''} title="Every army on this war attacks">⚔ Attack all</button><button class="fword hold" data-o="${o}" data-go="" ${atk===0 ? 'disabled' : ''} title="Every army falls back to the closest ground of yours that no enemy tower reaches, and defends there">🛡 Defend all</button></div>`;
  }
  const theirs=o*M+PLAYER;
  if (W.campaigns.some(c => c.front && c.a===o && c.d===PLAYER && c.phase<2)){
    const s=W.offensive[theirs];
    return `<button class="fword them" disabled>${inCrisis(o,PLAYER) ? 'Their army masses on your border · not yet war' : s===F_PUSH ? 'Their army attacks along the front' : s===F_GATHER || s===F_READY ? 'Their army masses on your border' : 'Their army holds the front'}</button>`;
  }
  return '';
}
/** How many of our armies on the war with o attack (rather than defend). */
const armiesAttacking = (o: number) => W.campaigns.filter(c => c.front && c.a===PLAYER && c.d===o && c.phase<2 && c.naval<0 && attacks(c)).length;
const STANCE_TIPS = [
  'Balanced: the armies take the border all along the front, and bring down watchtowers as they meet them',
  'Border capture: the armies take as much ground as they can and keep out of reach of crowded watchtowers, to lose fewer men',
  'Capital rush: the armies push straight for their capital, and bring down only the watchtowers by the way, to end the war quickly',
];
/** The stance buttons under the chip, while our armies stand on the front against o: how they fight. */
function stances(o: number){
  if (!W.campaigns.some(c => c.a===PLAYER && c.d===o && c.front && c.phase<2 && c.hostile)) return '';
  const cur=W.stance[PLAYER*W.M+o];
  const names=['Balanced','Border capture','Capital rush'];
  return `<div class="fstances" role="group" aria-label="How your armies fight">${[S_BALANCED,S_BORDER,S_RUSH].map(s => `<button class="fst" data-o="${o}" data-st="${s}" aria-pressed="${cur===s}" title="${esc(STANCE_TIPS[s])}">${names[s]}</button>`).join('')}</div>`;
}
/** The militia on the war with o: call up those at home (all of them, or the rest of them when some
    went with the attack), or send them home. */
function reserves(o: number){
  const out=reservesOf(PLAYER,o), k=callable(PLAYER).length;
  const home=out ? `<button class="fres out" data-o="${o}" data-call="" title="Your militia go home: no more wages, and they go back to patrolling">Send ${out.all ? 'reserves' : 'militia'} home · ${out.members.length} militia</button>` : '';
  if (out?.all) return home;
  const why=reservesProblem(PLAYER,o,true);
  if (why==='No crisis or war with them' || why==='Needs a shared border' || !k) return home;
  const call=`<button class="fres" data-o="${o}" data-call="1" ${why?'disabled':''} title="${why ? esc(why) : `Every militiaman at home (but the watchtowers' guards) joins this front${out ? `, beside the ${out.members.length} already there` : ''}. Called up they are paid a soldier's wage, and they die easily`}">${out ? 'Call the rest' : 'Call reserves'} · ${k} militia</button>`;
  return home ? `<div class="fresrow">${call}${home}</div>` : call;
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]!);

/* ---------- the menu under a chip: ask for peace, or hold the border ---------- */
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
  const war=!!W.wars[PLAYER*W.M+o], crisis=inCrisis(o,PLAYER) && !war, hold=!counter && canDefend(o);
  ($('wpTitle')).textContent = counter ? `Your land is free of ${W.nations[o].name}`
    : crisis ? `${W.nations[o].name} masses on your border` : `${W.nations[o].name}'s army is coming`;
  $('wpPeace').textContent = counter ? 'Offer peace' : 'Request peace';
  $('wpCounter').hidden=!counter;
  $('wpPeace').hidden=!war;   // (a crisis isn't a war yet)
  $('wpDefend').hidden=!hold;
  $('wpDefend').textContent = crisis ? 'Hold the border…' : 'Send armies to the front…';
  popMenu.classList.toggle('one',[$('wpPeace'),$('wpCounter'),$('wpDefend')].filter(b => !b.hidden).length<2);
  placePop();
}
export function closePop(){ pop.hidden=true; popFor=0; popCamp=-1; popCounter=false; }
/** The armies to send to our side of the border with popFor: all of them, to start with. */
function showDefend(){
  if (!canDefend(popFor)){ closePop(); return; }
  popCamp=-2; popMenu.hidden=true; popSend.hidden=false;
  popPicker.reset();
  $('wpGo').textContent=inCrisis(popFor,PLAYER) && !W.wars[PLAYER*W.M+popFor] ? 'Hold the border' : 'To the front';
  refreshPop(); placePop();
}
/** Their men massed on (or fighting along) our border. */
const massed = (o: number) => W.campaigns.reduce((k,c) => k+(c.front && c.a===o && c.d===PLAYER && c.phase<2 ? c.members.length : 0),0);
function refreshPop(){
  const me=W.nations[PLAYER]; if (!me){ closePop(); return; }
  const ready=available(me).reduce((s,a) => s+a.men.length,0), mil=callable(PLAYER).length;
  if (!canDefend(popFor)){ closePop(); return; }
  const theirs=massed(popFor);
  popPicker.refresh();
  const k=popPicker.count();
  $('wpVal').textContent=`${k} soldier${k===1?'':'s'}`;
  $('wpSplit').textContent=`They have ${theirs} · you have ${ready} ready in your barracks`+(mil ? `, and ${mil} militia in reserve` : '')
    +(!W.wars[PLAYER*W.M+popFor] ? '. In a crisis they hold your side of the border and fight only if it comes to war.' : '');
  ($('wpGo') as HTMLButtonElement).disabled=k<1;
}

export function setupDiplomacy(){
  $('dClose').onclick=closeDiplomacy;
  $('dAlly').onclick=()=>{ if (target){ queueCommand({ type:'ally', nation:PLAYER, target }); } };
  $('dWar').onclick=showWarView;
  $('dBack').onclick=()=>{ talk.hidden=false; warView.hidden=true; refreshDiplomacy(true); };
  $('dNaval').onclick=()=>{ navalOn=!navalOn; refreshWar(false); };
  $('dBases').addEventListener('click',e => { const b=(e.target as HTMLElement).closest('button.army') as HTMLButtonElement | null; if (b){ baseSel=+b.dataset.q!; basesHtml=''; refreshWar(false); } });
  $('dCoast').onclick=startLanding;
  $('dMilOn').onclick=()=>{ milOn=!milOn; refreshWar(false); };
  $('dMil').oninput=e=>{ milPick=+(e.target as HTMLInputElement).value; refreshWar(false); };
  $('dAttack').onclick=()=>send();
  wars.addEventListener('click',e=>{
    const w=(e.target as HTMLElement).closest('button.fword') as HTMLButtonElement | null;
    if (w){ if (!w.disabled){ queueCommand({ type:'offensive', nation:PLAYER, target:+w.dataset.o!, go:!!w.dataset.go }); lastChips=''; w.disabled=true; } return; }
    const st=(e.target as HTMLElement).closest('button.fst') as HTMLButtonElement | null;
    if (st){ queueCommand({ type:'stance', nation:PLAYER, target:+st.dataset.o!, stance:+st.dataset.st! }); lastChips=''; return; }
    const r=(e.target as HTMLElement).closest('button.fres') as HTMLButtonElement | null;
    if (r){ if (!r.disabled){ queueCommand({ type:'reserves', nation:PLAYER, target:+r.dataset.o!, call:!!r.dataset.call }); lastChips=''; r.disabled=true; } return; }
    const b=(e.target as HTMLElement).closest('button.chip') as HTMLButtonElement | null; if (!b || b.disabled) return;
    const o=+b.dataset.o!, act=b.dataset.act;
    if (act==='respond'){ if (!pop.hidden && popFor===o) closePop(); else openPop(o); return; }
    if (act==='counter'){ if (!pop.hidden && popFor===o) closePop(); else openPop(o,true); return; }
    if (act==='peace') queueCommand({ type:'peace', nation:PLAYER, target:o });
    else if (act==='calm') queueCommand({ type:'deescalate', nation:PLAYER, target:o });
    else if (act==='end') queueCommand({ type:'endWar', nation:PLAYER, target:o });
    lastChips=''; b.disabled=true;
  });
  $('wpPeace').onclick=()=>{ if (popFor){ queueCommand({ type:'endWar', nation:PLAYER, target:popFor }); toast(`You ask ${W.nations[popFor].name} for peace`); } closePop(); };
  $('wpCounter').onclick=()=>{ const o=popFor; closePop(); openCounter(o); };
  $('wpDefend').onclick=showDefend;
  $('wpBack').onclick=()=>{ popCamp=-1; popMenu.hidden=false; popSend.hidden=true; placePop(); };
  $('wpClose').onclick=closePop;
  $('wpGo').onclick=()=>{
    const units=popPicker.chosen(); if (popCamp===-1 || !units.length) return;
    queueCommand({ type:'defend', nation:PLAYER, target:popFor, units });
    closePop();
  };
}
export function resetDiplomacy(){ closeDiplomacy(); closePop(); wars.innerHTML=''; lastChips=''; battles.clear(); }
