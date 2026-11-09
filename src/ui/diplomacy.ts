/* ---------- diplomacy: click another kingdom to propose an alliance or lay claims on its regions; the
   war bar at the top: each crisis (claims waiting for an answer) and each war, with its regions and
   what can be done about it ---------- */
import { PLAYER, GAME_SPEED } from '../core/constants';
import { fmt } from '../core/util';
import { W } from '../sim/state';
import { client } from '../client';
import { queueCommand } from '../sim/sim';
import { allied, atWar, allyProblem, warProblem, claimProblem, claimsProblem, claimable, inCrisis, crisisWait, claimsOf, attackerIn, began, menAgainst, OFFER_TICKS, MAX_CLAIMS, P_GOALS } from '../sim/war';
import { RG, region, regionName } from '../sim/regions';
import { toast } from './hud';
import { flagCSS } from '../render/flags';
import { $ } from './dom';

const panel=$('diplo'), wars=$('wars'), bar=$('claimBar');
let target=0;
const nameOf = (id: number) => id===PLAYER ? 'You' : W.nations[id].name;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]!);
const secs = (ticks: number) => Math.ceil(ticks/10/GAME_SPEED);

/** Opens diplomacy with kingdom o. */
export function openDiplomacy(o: number){
  const n=W.nations[o]; if (!n || !n.alive || o===PLAYER) return;
  target=o; panel.hidden=false;
  refreshDiplomacy();
}
export function closeDiplomacy(){ panel.hidden=true; target=0; }
export const diplomacyOpen = () => !panel.hidden;

/** Keeps the open panel in step with the match. */
export function refreshDiplomacy(){
  if (client.claiming) refreshClaimBar();
  if (panel.hidden) return;
  const me=W.nations[PLAYER], n=W.nations[target];
  if (!me || !n || !n.alive || !me.alive){ closeDiplomacy(); return; }
  $('dCrest').style.cssText=flagCSS(n.code);
  $('dName').textContent=n.name;
  $('dStrength').textContent=fmt(n.strength);
  $('dSoldiers').textContent=String(n.soldiers);
  let regs=0; for (let r=1;r<RG.n;r++) if (W.rOwner[r]===target) regs++;
  $('dLand').textContent=`${regs} region${regs===1 ? '' : 's'}`;
  const ally=allied(PLAYER,target), war=atWar(PLAYER,target), border=W.contact[PLAYER*W.M+target]>0;
  const rel=$('dRel');
  rel.textContent = ally ? 'Your ally' : war ? 'At war with you' : inCrisis(PLAYER,target) ? 'Your claims are on the table' : inCrisis(target,PLAYER) ? 'They have claims on you' : border ? 'Neutral · shares a border with you' : 'Neutral · no shared border';
  rel.className='drel'+(ally?' ally':war?' war':'');
  const allyBtn=$('dAlly') as HTMLButtonElement, no=allyProblem(PLAYER,target);
  allyBtn.disabled=!!no; allyBtn.title=no ?? 'Ask them for an alliance: allies never go to war with each other';
  const claimBtn=$('dWar') as HTMLButtonElement, why=warProblem(PLAYER,target) ?? (W.aggr[PLAYER*W.M+target] ? 'Your claims on them are already on the table' : W.aggr[target*W.M+PLAYER] ? 'They have claims on you: answer them first' : null);
  claimBtn.textContent = 'Claim regions…';
  claimBtn.disabled=!!why; claimBtn.title=why ?? 'Pick regions of theirs on the map, each beside the last: they give them up, or it is war';
  $('dNote').textContent = why && why!=='You are already at war' ? why : no && no!=='You are already allies' && no!=='Settle your quarrel first' ? no : '';
}

/* ---------- picking the regions to claim ---------- */
/** Begins picking regions of `o`'s to claim, on the map. */
export function startClaim(o: number){
  if (!o || warProblem(PLAYER,o)) return;
  client.claiming={ target:o, regions:[] };
  closeDiplomacy();
  bar.hidden=false; refreshClaimBar();
}
/** At war (attacking or defending), begins changing the player's claims on `o`: the regions claimed now are picked, and any of theirs can be added
    or let go (the war needs one claim on one side at least). */
export function editClaims(o: number){
  if (!W.wars[PLAYER*W.M+o]) return;
  client.claiming={ target:o, regions:claimsOf(PLAYER,o).slice(), war:true };
  closeDiplomacy();
  bar.hidden=false; refreshClaimBar();
}
export function cancelClaim(){ client.claiming=null; bar.hidden=true; }
/** A click on map tile t while picking: the region there is added (or, if it is picked already, it and those after it are let go). */
export function claimClick(t: number){
  const C=client.claiming; if (!C) return;
  const r=t>=0 ? region[t] : 0;
  if (!r){ toast('That land is in no region'); return; }
  const i=C.regions.indexOf(r);
  if (C.war){   // (at war: any region of theirs, added or let go one by one; one at least stays)
    if (i>=0){ if (C.regions.length<=1 && !claimsOf(C.target,PLAYER).length){ toast('Keep at least one claim: the war needs one'); return; } C.regions.splice(i,1); }
    else { if (W.rOwner[r]!==C.target){ toast(`${regionName(r)} is not ${W.nations[C.target].name}'s`); return; } C.regions.push(r); }
    refreshClaimBar(); return;
  }
  if (i>=0){ C.regions.splice(i); refreshClaimBar(); return; }
  const next=[...C.regions,r], why=claimProblem(PLAYER,C.target,next);
  if (why){ toast(W.rOwner[r]!==C.target ? `${regionName(r)} is not ${W.nations[C.target].name}'s` : why); return; }
  C.regions=next; refreshClaimBar();
}
export function confirmClaim(){
  const C=client.claiming; if (!C || (!C.regions.length && !C.war)) return;
  if (C.war){ const why=claimsProblem(PLAYER,C.target,C.regions); if (why){ toast(why); return; } queueCommand({ type:'claims', nation:PLAYER, target:C.target, regions:C.regions.slice() }); cancelClaim(); return; }
  const why=claimProblem(PLAYER,C.target,C.regions); if (why){ toast(why); return; }
  if (allied(PLAYER,C.target)) return;
  queueCommand({ type:'claim', nation:PLAYER, target:C.target, regions:C.regions.slice() });
  cancelClaim();
}
function refreshClaimBar(){
  const C=client.claiming; if (!C){ bar.hidden=true; return; }
  const n=W.nations[C.target]; if (!n?.alive){ cancelClaim(); return; }
  const first=claimable(PLAYER,C.target).length;
  if (C.war){
    $('cbText').innerHTML=`War goals against ${esc(n.name)}: <b>${C.regions.map(r => esc(regionName(r))).join(', ') || 'none'}</b> · click any region of theirs to add it, a claimed one to let it go`;
    ($('cbGo') as HTMLButtonElement).textContent='Set war goals'; ($('cbGo') as HTMLButtonElement).disabled=!C.regions.length && !claimsOf(C.target,PLAYER).length; return;
  }
  ($('cbGo') as HTMLButtonElement).textContent='Claim';
  $('cbText').innerHTML = C.regions.length
    ? `Claim of ${esc(n.name)}: <b>${C.regions.map(r => esc(regionName(r))).join(', ')}</b>${C.regions.length<MAX_CLAIMS ? ' · click a region beside these to add it' : ''}`
    : first ? `Click a region of ${esc(n.name)}'s beside one of yours (lit in gold) to claim it` : `${esc(n.name)} has no region beside one you control`;
  ($('cbGo') as HTMLButtonElement).disabled=!C.regions.length;
}

/* ---------- the war bar: one chip per crisis or war ---------- */
interface Row { o: number; a: number; d: number; war: boolean; crisis: boolean; theyOffer: boolean; iOffer: boolean; theyGoals: boolean; myGoals: boolean; }
function rows(){
  const M=W.M, out: Row[]=[];
  for (let o=1;o<M;o++){
    if (o===PLAYER || !W.nations[o].alive) continue;
    const war=!!W.wars[PLAYER*M+o];
    let a=0, d=0;
    if (war){ if (began(PLAYER,o)){ a=PLAYER; d=o; } else { a=o; d=PLAYER; } }
    else if (inCrisis(PLAYER,o)){ a=PLAYER; d=o; }
    else if (inCrisis(o,PLAYER)){ a=o; d=PLAYER; }
    else continue;
    const at=W.offers[o*M+PLAYER];
    out.push({ o, a, d, war, crisis:!war, theyOffer:!!at && W.tickN-at<=OFFER_TICKS, iOffer:!!W.offers[PLAYER*M+o], theyGoals:W.offerKind[o*M+PLAYER]===P_GOALS, myGoals:W.offerKind[PLAYER*M+o]===P_GOALS });
  }
  return out;
}
let lastChips='';
const dismissed=new Set<number>();
export function updateWarChips(){
  const all=rows();
  for (const o of [...dismissed]) if (!all.some(f => f.o===o)) dismissed.delete(o);
  const html=all.filter(f => !dismissed.has(f.o)).map(f => {
    const regs=claimsOf(f.a,f.d), names=regs.map(r => esc(regionName(r))).join(', ');
    let line: string, acts: string;
    if (f.crisis && f.a===PLAYER){
      line=`You claim ${names} of ${esc(nameOf(f.d))} · they answer within ${secs(crisisWait(f.a,f.d))} s`;
      acts=`<button class="fword" data-o="${f.o}" data-act="calm" title="Take your claims back">Take back</button>`;
    } else if (f.crisis){
      line=`${esc(nameOf(f.a))} claims your ${names} · ${secs(crisisWait(f.a,f.d))} s to answer`;
      acts=`<button class="fword" data-o="${f.o}" data-act="give" title="Give the regions up: they are theirs at once, with no blood shed">Give up</button><button class="fword go" data-o="${f.o}" data-act="refuse" title="Refuse: it is war for these regions">Refuse · war</button>`;
    } else {
      // both sides may have war goals: the player's on them, and theirs on the player
      const mine=claimsOf(PLAYER,f.o), theirs=claimsOf(f.o,PLAYER), held=(o: number, regs: number[]) => regs.filter(r => W.rOcc[r]===o).length;
      const goals=(o: number, regs: number[]) => regs.length ? `${regs.map(r => esc(regionName(r))).join(', ')} (${held(o,regs)}/${regs.length} taken)` : 'none';
      line=`War with ${esc(nameOf(f.o))} · your goals: ${goals(PLAYER,mine)} · theirs: ${goals(f.o,theirs)} · ${menAgainst(PLAYER,f.o)} of yours in the field, ${menAgainst(f.o,PLAYER)} of theirs`;
      const b=(act: string, label: string, title: string, cls='') => `<button class="fword ${cls}" data-o="${f.o}" data-act="${act}" title="${title}">${label}</button>`;
      const split='each side gets the claimed regions it holds now';
      const offer=f.theyOffer ? (f.theyGoals ? b('peace','Accept their war goals',`Peace: ${split} (you ${held(PLAYER,mine)}, they ${held(f.o,theirs)})`,'go') : b('peace','Accept white peace','Peace as it was before the war: every occupied region is free again, nothing changes hands','go')) : '';
      const offered=f.iOffer ? `<button class="fword" disabled>${f.myGoals ? 'War goals demanded…' : 'White peace offered…'}</button>` : '';
      acts=offer+b('claims','✎ War goals',mine.length ? 'Add claims on any of their regions to attack them, or let claims go' : 'Claim regions of theirs: then your armies can attack them (whether or not they hold regions of yours)')
        +(offered || ((mine.length ? b('goals','Demand war goals',`Peace: ${split}`) : '')
        +(theirs.length ? b('givegoals','Give war goals',`Peace: ${esc(nameOf(f.o))} gets every region it claims${mine.length ? ', you keep the claimed regions you hold' : ''}`) : '')
        +b('white','Offer white peace','Peace as it was before the war: every occupied region is free again')));
    }
    return `<div class="front" data-o="${f.o}"><div class="fhead"><span class="chip war${f.theyOffer || (f.crisis && f.d===PLAYER) ? ' offer' : ''}"><i class="flag" style="${flagCSS(W.nations[f.a].code)}"></i>${line}</span><button class="x fclose" data-o="${f.o}" aria-label="Close this bar" title="Close this bar (it comes back with the next war or crisis)">×</button></div><div class="fwords">${acts}</div></div>`;
  }).join('');
  if (html!==lastChips){ lastChips=html; wars.innerHTML=html; }
}
export function closePop(){}
/** (The fallen are counted by the simulation: W.kills.) */
export function noteDeath(_id: number, _o: number, _kind: number){}
export function setupDiplomacy(){
  $('dClose').onclick=closeDiplomacy;
  $('dAlly').onclick=()=>{ if (target) queueCommand({ type:'ally', nation:PLAYER, target }); };
  $('dWar').onclick=()=>{ if (target) startClaim(target); };
  $('cbGo').onclick=confirmClaim;
  $('cbCancel').onclick=cancelClaim;
  wars.addEventListener('click',e=>{
    const x=(e.target as HTMLElement).closest('button.fclose') as HTMLButtonElement | null;
    if (x){ dismissed.add(+x.dataset.o!); lastChips='\0'; updateWarChips(); return; }
    const b=(e.target as HTMLElement).closest('button.fword') as HTMLButtonElement | null; if (!b || b.disabled) return;
    const o=+b.dataset.o!, act=b.dataset.act;
    if (act==='calm') queueCommand({ type:'deescalate', nation:PLAYER, target:o });
    else if (act==='give') queueCommand({ type:'answer', nation:PLAYER, target:o, accept:true });
    else if (act==='refuse') queueCommand({ type:'answer', nation:PLAYER, target:o, accept:false });
    else if (act==='peace') queueCommand({ type:'peace', nation:PLAYER, target:o });
    else if (act==='white') queueCommand({ type:'endWar', nation:PLAYER, target:o, kind:'white' });
    else if (act==='goals') queueCommand({ type:'endWar', nation:PLAYER, target:o, kind:'goals' });
    else if (act==='givegoals') queueCommand({ type:'giveGoals', nation:PLAYER, target:o });
    else if (act==='claims'){ editClaims(o); return; }
    lastChips=''; b.disabled=true;
  });
}
export function resetDiplomacy(){ dismissed.clear(); closeDiplomacy(); cancelClaim(); wars.innerHTML=''; lastChips=''; }
