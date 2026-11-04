/* ---------- the armies panel: every army of ours, in peace and in war ----------
   One row for each barracks' army and one for the militia as a single army. Clicking a row opens its orders:
   at home, where to deploy it (to wait on a border, which is not a crisis, so that a crisis begun later needs no march);
   out on a border, which front it is on (when it meets the enemy on more than one landmass), and in a war whether it
   attacks or defends (sim/war.ts armyOrder), or, short of war, recall. Right-clicking an army's leader on the map opens
   its row. The row picked has its soldiers ringed in gold. */
import { K, PLAYER, GAME_SPEED } from '../core/constants';
import { W, type Campaign } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { F_GATHER, besieged, attacks, inCrisis, crisisWait, aboardOf, occOn, callableCount } from '../sim/war';
import { units, unitAt } from '../sim/army';
import { client } from '../client';
import { cam } from '../render/camera';
import { armyName, renameArmy } from './armies';
import { startAssign, placeName } from './assign';
import { SEC_SIEGE, SECTOR_NAMES } from '../sim/front';
import { toast } from './hud';
import { $ } from './dom';

const panel=$('command'), list=$('cmList'), count=$('cmCount'), fold=$('cmFold') as HTMLButtonElement, renameBtn=$('cmRename') as HTMLButtonElement;
let mode: 'list' | 'pick' | 'edit' = 'list', editKey=-1, focusEdit=false;   // the list, picking an army to rename, typing its new name
const MIL=-2;                       // the militia's row key
let sel=-1;                         // the row open (a unit's key, or MIL)
let folded=typeof innerWidth==='number' && innerWidth<=640, html='';   // (a small screen starts with the list folded)

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]!);
const nm = (o: number) => W.nations[o]?.name ?? 'the enemy';
const secs = (ticks: number) => Math.ceil(ticks/10/GAME_SPEED);

/** The army's campaign, if it is out: a barracks' by its key, the militia's. */
const campOf = (key: number) => W.campaigns.find(c => c.front && c.a===PLAYER && c.phase<2 && (key===MIL ? c.militia : c.unit===key && !c.militia));
const campById = (id: number) => W.campaigns.find(c => c.id===id);
export const selectedArmy = () => { const c=campById(client.selected); return c && c.a===PLAYER && c.phase<2 ? c : undefined; };

export function selectArmy(id: number){
  const c=campById(id); if (!c || c.a!==PLAYER) return;
  sel=c.militia ? MIL : c.unit; folded=false; client.selected=c.id; html=''; refreshCommand();
}
export function deselect(){ sel=-1; client.selected=-1; html=''; refreshCommand(); }

/** The row's name. */
function rowName(key: number){
  if (key===MIL) return 'Militia';
  const u=unitAt(key), me=W.nations[PLAYER];
  return u ? armyName(me,u) : 'Army';
}
/** What the row says it is doing (updated in place each refresh, so the buttons under it stay put). */
function status(key: number){
  const c=campOf(key);
  if (!c){
    if (key===MIL){ const k=callableCount(PLAYER); return k ? `${k} at home` : 'none at home'; }
    const u=unitAt(key); return u ? `At home · ${u.home}/${u.cap}` : '';
  }
  const foe=nm(c.d), M=W.M, pair=c.a*M+c.d, men=c.members.length;
  const part=c.sec===SEC_SIEGE ? `the capital of ${foe}` : c.sec ? `${foe}'s ${SECTOR_NAMES[c.sec]} sector` : foe;   // (what it fights along: all the border, a part of it, or the siege)
  if (aboardOf(c)){
    if (W.wars[pair]) return `${men} men · ${attacks(c) ? 'landing on' : 'off the coast of'} ${foe}${attacks(c) ? '' : ', waiting for the order to attack'}`;
    return `${men} men · sailing to ${foe}`;
  }
  if (W.wars[pair]){
    if (attacks(c)) return `${men} men · ${occOn(c.a,c.d,c.isle)>0 ? 'retaking your land' : c.sec===SEC_SIEGE ? (besieged(c.d) ? 'besieging '+part : 'marching on '+part) : 'attacking '+part}`;
    return `${men} men · defending against ${part}`;
  }
  if (inCrisis(c.a,c.d)){
    const w=crisisWait(c.a,c.d);
    return `${men} men · crisis with ${foe}${w>0 ? ` · war may begin in ${secs(w)} s` : ' · ready for the word'}`;
  }
  if (W.aggr[c.d*M+c.a]) return `${men} men · holding against ${foe}`;
  return `${men} men · ${W.offensive[pair]===F_GATHER ? 'gathering on' : 'deployed on'} the border of ${part}`;
}
const btn = (act: string, label: string, attrs: string, opts: { on?: boolean; off?: boolean; title?: string; cls?: string }={}) =>
  `<button class="ao ${opts.cls ?? ''}" data-act="${act}" ${attrs} ${opts.off ? 'disabled' : ''} aria-pressed="${!!opts.on}" ${opts.title ? `title="${esc(opts.title)}"` : ''}>${label}</button>`;

/** The orders under an open row: where it is sent (the border is picked on the map), what it does there, and recall. */
function orders(key: number){
  const c=campOf(key);
  const home = key===MIL ? callableCount(PLAYER)>0 : (unitAt(key)?.home ?? 0)>0;
  const where=btn('assign',c ? '📍 Assign to another border' : '📍 Assign border',`data-k="${key}"`,{ cls:'assign', off:!c && !home, title: !c && !home ? 'Nobody of it is at home' : 'Then point at the border to send it to, on the map: it travels there from wherever it is (by boat between naval bases where there is no land way), in peace or in war' });
  if (!c) return where+'<p class="dnote">At home. Assign it to a border, or leave it as the guard.</p>';
  const M=W.M, pair=c.a*M+c.d, war=!!W.wars[pair], lib=occOn(c.a,c.d,c.isle)>0, go=attacks(c), out=[where];
  if (c.naval<0 || war){
    const act = war ? 'order' : 'stance';
    out.push(`<div class="ato2">${btn(act,'⚔ Attack',`data-camp="${c.id}" data-k="${key}" data-go="1"`,{ on:go, cls:'atk', title: lib ? 'Take your land back on this front' : 'Push into their land all along this front'+(war ? '' : ' (kept for when war begins)') })}${btn(act,'🛡 Defend',`data-camp="${c.id}" data-k="${key}" data-go=""`,{ on:!go, cls:'def', title:'Fall back to the closest ground of ours that no enemy tower reaches, and hold a line there'+(war ? '; attack again when ordered to' : ' (kept for when war begins)') })}</div>`);
  }
  if (!war){
    const mine=inCrisis(c.a,c.d) && !c.deployed;
    out.push(btn('recall','Recall',`data-camp="${c.id}"`,{ off:mine, title: mine ? 'It is part of the crisis: de-escalate from the war bar to call it off' : 'Send it home' }));
  }
  return out.join('');
}

/** Brings the panel up to date (each HUD refresh): the rows and orders when they change, the words in place. */
export function refreshCommand(){
  const me=W.nations[PLAYER];
  const U=me ? (units[PLAYER] ?? []).slice().sort((a,b) => a.key-b.key) : [];
  const mil=me ? callableCount(PLAYER)>0 || W.campaigns.some(c => c.a===PLAYER && c.militia && c.phase<2) : false;
  const keys=[...U.map(u => u.key), ...(mil ? [MIL] : [])];
  if (!keys.length || client.state!=='play'){ panel.hidden=true; return; }
  panel.hidden=false;
  if (sel>=0 && !unitAt(sel)) sel=-1;
  if (sel===MIL && !mil) sel=-1;
  // the ring on the map follows the army picked, if it is out
  const open=sel!==-1 ? campOf(sel) : undefined;
  client.selected=open ? open.id : -1;
  count.textContent=String(keys.length);
  fold.setAttribute('aria-expanded',String(!folded)); fold.textContent=folded ? '▸' : '▾';
  let next='';
  if (!folded){
    if (mode==='edit'){
      const u=unitAt(editKey), cur=u ? armyName(me,u) : 'Militia';
      next=`<div class="rename"><p class="dnote">New name for ${esc(cur)}</p><input id="cmNameIn" maxlength="20" placeholder="${esc(editKey===MIL ? 'Militia' : 'Army')}" value="${esc(cur)}" aria-label="Army name"><div class="ato2"><button class="ao" data-act="save">Save</button><button class="ao" data-act="cancel">Cancel</button></div></div>`;
    } else if (mode==='pick') next=`<p class="dnote">Click the army to rename.</p>`+keys.filter(k => k!==MIL).map(k => `<button class="ahead" data-act="pick" data-k="${k}"><span class="an">${esc(rowName(k))}</span></button>`).join('');
    else next=keys.map(k => `<div class="arow${k===sel ? ' open' : ''}"><button class="ahead" data-act="sel" data-k="${k}" aria-expanded="${k===sel}"><span class="an">${esc(rowName(k))}</span><span class="as" data-live="${k}"></span></button>${k===sel ? `<div class="aorders">${orders(k)}</div>` : ''}</div>`).join('');
  }
  renameBtn.setAttribute('aria-pressed',String(mode!=='list')); renameBtn.hidden=!U.length;
  if (next!==html){ html=next; list.innerHTML=next; }
  if (focusEdit && mode==='edit'){ focusEdit=false; const inp=$('cmNameIn') as HTMLInputElement | null; if (inp){ inp.focus(); inp.select(); } }
  for (const el of list.querySelectorAll<HTMLElement>('[data-live]')) el.textContent=status(+el.dataset.live!);
}

list.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || b.disabled) return;
  const act=b.dataset.act;
  if (act==='sel'){ const k=+b.dataset.k!; sel=sel===k ? -1 : k; html=''; refreshCommand(); return; }
  if (act==='pick'){ editKey=+b.dataset.k!; mode='edit'; focusEdit=true; html=''; refreshCommand(); return; }
  if (act==='cancel'){ mode='list'; html=''; refreshCommand(); return; }
  if (act==='save'){ saveName(); return; }
  if (act==='assign'){ startAssign(+b.dataset.k!); return; }
  const camp=+b.dataset.camp!;
  if (act==='order') queueCommand({ type:'order', nation:PLAYER, camp, go:!!b.dataset.go });
  else if (act==='stance'){ const c=campById(camp); if (c) queueCommand({ type:'assign', nation:PLAYER, army:+b.dataset.k!, target:c.d, isle:c.isle, sec:c.sec, go:!!b.dataset.go }); }
  else if (act==='recall') queueCommand({ type:'recall', nation:PLAYER, camp });
  html='';
});
/** The new name typed is kept (an empty one gives the army its number back): names change only by the player's hand. */
function saveName(){
  const inp=$('cmNameIn') as HTMLInputElement | null, u=unitAt(editKey);
  if (inp && u) renameArmy(u,inp.value);
  mode='list'; html=''; refreshCommand();
}
renameBtn.addEventListener('click',() => { mode=mode==='list' ? 'pick' : 'list'; folded=false; html=''; refreshCommand(); });
list.addEventListener('keydown', e => { if ((e.target as HTMLElement).id!=='cmNameIn') return; if (e.key==='Enter'){ e.preventDefault(); saveName(); } else if (e.key==='Escape'){ e.stopPropagation(); mode='list'; html=''; refreshCommand(); } });
fold.addEventListener('click',() => { folded=!folded; html=''; refreshCommand(); });

/** A right-click on the map at device pixel (sx,sy): open the row of the army whose leader is there, or let go. */
export function rightClick(sx: number, sy: number){
  const wx=(cam.x+sx/cam.zoom)/K, wy=(cam.y+sy/cam.zoom)/K, r=Math.max(3,16*cam.dpr/cam.zoom/K);
  const humans=new Map(W.humans.map(h => [h.id,h]));
  let pick: Campaign | undefined, bd=(r*1.3)**2;
  for (const c of W.campaigns){
    if (c.a!==PLAYER || c.phase===2 || c.leader<0) continue;
    const l=humans.get(c.leader); if (!l) continue;
    const d=(l.x-wx)**2+(l.y-2-wy)**2; if (d<bd){ bd=d; pick=c; }
  }
  if (pick){ selectArmy(pick.id); return; }
  for (const h of W.humans) if (h.o===PLAYER && h.war>=0 && (h.x-wx)**2+(h.y-2-wy)**2<r*r){ const k=campById(h.war); if (k && k.phase<2){ selectArmy(k.id); toast('This army has no leader: give it orders from the armies list'); return; } }
  if (sel!==-1) deselect();
}
