/* ---------- diplomacy: click another kingdom to propose an alliance or lay claims on its regions; the
   war bar at the top: each crisis (claims waiting for an answer) and each war, with its regions and
   what can be done about it ---------- */
import { PLAYER, GAME_SPEED } from '../core/constants';
import { fmt } from '../core/util';
import { W } from '../sim/state';
import { client } from '../client';
import { queueCommand } from '../sim/sim';
import { allied, atWar, allyProblem, warProblem, claimProblem, claimable, inCrisis, crisisWait, claimsOf, attackerIn, menAgainst, OFFER_TICKS, MAX_CLAIMS } from '../sim/war';
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
export function cancelClaim(){ client.claiming=null; bar.hidden=true; }
/** A click on map tile t while picking: the region there is added (or, if it is picked already, it and those after it are let go). */
export function claimClick(t: number){
  const C=client.claiming; if (!C) return;
  const r=t>=0 ? region[t] : 0;
  if (!r){ toast('That land is in no region'); return; }
  const i=C.regions.indexOf(r);
  if (i>=0){ C.regions.splice(i); refreshClaimBar(); return; }
  const next=[...C.regions,r], why=claimProblem(PLAYER,C.target,next);
  if (why){ toast(W.rOwner[r]!==C.target ? `${regionName(r)} is not ${W.nations[C.target].name}'s` : why); return; }
  C.regions=next; refreshClaimBar();
}
export function confirmClaim(){
  const C=client.claiming; if (!C || !C.regions.length) return;
  const why=claimProblem(PLAYER,C.target,C.regions); if (why){ toast(why); return; }
  if (allied(PLAYER,C.target)) return;
  queueCommand({ type:'claim', nation:PLAYER, target:C.target, regions:C.regions.slice() });
  cancelClaim();
}
function refreshClaimBar(){
  const C=client.claiming; if (!C){ bar.hidden=true; return; }
  const n=W.nations[C.target]; if (!n?.alive){ cancelClaim(); return; }
  const first=claimable(PLAYER,C.target).length;
  $('cbText').innerHTML = C.regions.length
    ? `Claim of ${esc(n.name)}: <b>${C.regions.map(r => esc(regionName(r))).join(', ')}</b>${C.regions.length<MAX_CLAIMS ? ' · click a region beside these to add it' : ''}`
    : first ? `Click a region of ${esc(n.name)}'s beside one of yours (lit in gold) to claim it` : `${esc(n.name)} has no region beside one you control`;
  ($('cbGo') as HTMLButtonElement).disabled=!C.regions.length;
}

/* ---------- the war bar: one chip per crisis or war ---------- */
interface Row { o: number; a: number; d: number; war: boolean; crisis: boolean; theyOffer: boolean; iOffer: boolean; }
function rows(){
  const M=W.M, out: Row[]=[];
  for (let o=1;o<M;o++){
    if (o===PLAYER || !W.nations[o].alive) continue;
    const war=!!W.wars[PLAYER*M+o];
    let a=0, d=0;
    if (war){ if (attackerIn(PLAYER,o)){ a=PLAYER; d=o; } else { a=o; d=PLAYER; } }
    else if (inCrisis(PLAYER,o)){ a=PLAYER; d=o; }
    else if (inCrisis(o,PLAYER)){ a=o; d=PLAYER; }
    else continue;
    const at=W.offers[o*M+PLAYER];
    out.push({ o, a, d, war, crisis:!war, theyOffer:!!at && W.tickN-at<=OFFER_TICKS, iOffer:!!W.offers[PLAYER*M+o] });
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
      const held=regs.filter(r => W.rOcc[r]===f.a).length, mine=menAgainst(PLAYER,f.o), theirs=menAgainst(f.o,PLAYER);
      line=`War with ${esc(nameOf(f.o))} for ${names} · ${held}/${regs.length} taken · ${mine} of yours in the field, ${theirs} of theirs`;
      acts = f.theyOffer ? `<button class="fword go" data-o="${f.o}" data-act="peace" title="Accept their peace: what ${f.a===PLAYER ? 'you' : 'they'} hold of the claims is ${f.a===PLAYER ? 'yours' : 'theirs'}, the rest goes back">Accept peace</button>`
        : f.iOffer ? `<button class="fword" disabled>Peace offered…</button>`
        : `<button class="fword" data-o="${f.o}" data-act="end" title="Offer peace: the regions taken stay with whoever took them">Offer peace</button>`;
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
    else if (act==='end') queueCommand({ type:'endWar', nation:PLAYER, target:o });
    lastChips=''; b.disabled=true;
  });
}
export function resetDiplomacy(){ dismissed.clear(); closeDiplomacy(); cancelClaim(); wars.innerHTML=''; lastChips=''; }
