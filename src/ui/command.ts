/* ---------- the armies panel, and orders on the map ----------
   One row for each army of ours (a barracks, or an order group of barracks: one phalanx). Clicking a
   row, or a soldier of the army on the map, takes the army in hand (its men ringed in gold). With an
   army in hand, a right-click on a region gives it its order there (sim/war.ts): a region claimed of an
   enemy, beside ground we hold, is attacked; one of ours claimed by an enemy is defended. Under the row,
   Retreat (break off and fall back to the nearest region we hold) and Home (back to the barracks, to heal). */
import { K, PLAYER } from '../core/constants';
import { W, type Army } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { armyProblem, armyOf, claimsOf, A_HOME } from '../sim/war';
import { region, regionName } from '../sim/regions';
import { units, unitAt, groupKeys, groupLead, MAX_MERGES } from '../sim/army';
import { client } from '../client';
import { cam, tileAt } from '../render/camera';
import { armyName, renameArmy } from './armies';
import { armyStatus } from './army';
import { toast } from './hud';
import { $ } from './dom';

const panel=$('command'), list=$('cmList'), count=$('cmCount'), fold=$('cmFold') as HTMLButtonElement, renameBtn=$('cmRename') as HTMLButtonElement, mergeBtn=$('cmMerge') as HTMLButtonElement;
let mode: 'list' | 'pick' | 'edit' | 'merge1' | 'merge2' = 'list', editKey=-1, focusEdit=false, mergeFirst=-1;
let folded=typeof innerWidth==='number' && innerWidth<=640, html='';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]!);
/** Our armies, by their lead barracks. */
const mine = () => W.armies.filter(x => x.o===PLAYER).sort((a,b) => a.id-b.id);
/** The army a row (a lead barracks' key) stands for. */
const armyFor = (key: number) => W.armies.find(x => x.o===PLAYER && x.plots.includes(key));
export const selectedArmy = () => { const x=client.selected>=0 ? armyOf(client.selected) : undefined; return x && x.o===PLAYER ? x : undefined; };

export function selectArmy(id: number){
  const x=armyOf(id); if (!x || x.o!==PLAYER) return;
  client.selected=x.id; folded=false; html=''; refreshCommand();
}
export function deselect(){ client.selected=-1; html=''; refreshCommand(); }

function rowName(x: Army){
  const u=unitAt(x.id) ?? x.plots.map(q => unitAt(q)).find(v => !!v), me=W.nations[PLAYER];
  return u ? armyName(me,u) : 'Army';
}
/** How many men the army has: in the field, and at its barracks. */
function strength(x: Army){
  let home=0, all=0;
  for (const k of groupKeys(PLAYER,x.id)){ const u=unitAt(k); if (!u) continue; all+=u.members.length; for (const h of u.members) if (h.war<0 && h.hp>0) home++; }
  return x.mode===A_HOME ? `${home} men` : `${x.men} out · ${home} at home`;
}
function status(x: Army){ return `${armyStatus(x)} · ${strength(x)}`; }
const btn = (act: string, label: string, attrs: string, opts: { off?: boolean; title?: string; cls?: string }={}) =>
  `<button class="ao ${opts.cls ?? ''}" data-act="${act}" ${attrs} ${opts.off ? 'disabled' : ''} ${opts.title ? `title="${esc(opts.title)}"` : ''}>${label}</button>`;

/** The orders under the open row. */
function orders(x: Army){
  const war=W.claims.size>0 && [...W.claims.keys()].some(k => W.wars[k] && (((k/W.M)|0)===PLAYER || k%W.M===PLAYER));
  const hint=war ? 'Right-click a claimed region on the map: theirs beside your land to attack it, yours to defend it.' : 'Armies are sent only in a war: to the regions claimed in it.';
  const ret=armyProblem(PLAYER,x.id,'retreat'), home=armyProblem(PLAYER,x.id,'return');
  return `<p class="dnote">${hint}</p><div class="ato2">${btn('retreat','↩ Retreat',`data-id="${x.id}"`,{ off:!!ret, title: ret ?? 'Break off and fall back to the nearest region you hold' })}${btn('home','🏠 Home',`data-id="${x.id}"`,{ off:!!home, title: home ?? 'Back to its barracks: its men heal, and are paid less' })}</div>`;
}
function members(ms: number[]){
  const lines=ms.map((k,i) => { const u=unitAt(k), me=W.nations[PLAYER];
    return `<div class="gm"><span class="an">${u ? esc(armyName(me,u)) : 'Army'}${i===0 ? ' <i class="grp">lead</i>' : ''}</span><span class="as">${u?.members.length ?? 0} men</span></div>`; }).join('');
  return `<div class="ato">Merged armies: one phalanx</div>${lines}${btn('unmerge','Unmerge armies',`data-k="${ms[0]}"`,{ title:'Take the armies apart (at home only): each is a phalanx of its own again' })}`;
}

export function refreshCommand(){
  const me=W.nations[PLAYER];
  const A=me ? mine() : [];
  if (!A.length || client.state!=='play'){ panel.hidden=true; return; }
  panel.hidden=false;
  if (client.selected>=0 && !A.some(x => x.id===client.selected)) client.selected=-1;
  count.textContent=String(A.length);
  fold.setAttribute('aria-expanded',String(!folded)); fold.textContent=folded ? '▸' : '▾';
  const U=(units[PLAYER] ?? []).slice().sort((a,b) => a.key-b.key);
  let next='';
  if (!folded){
    if (mode==='edit'){
      const u=unitAt(editKey), cur=u ? armyName(me,u) : 'Army';
      next=`<div class="rename"><p class="dnote">New name for ${esc(cur)}</p><input id="cmNameIn" maxlength="20" placeholder="Army" value="${esc(cur)}" aria-label="Army name"><div class="ato2"><button class="ao" data-act="save">Save</button><button class="ao" data-act="cancel">Cancel</button></div></div>`;
    } else if (mode==='pick') next=`<p class="dnote">Click the army to rename.</p>`+A.map(x => `<button class="ahead" data-act="pick" data-k="${x.id}"><span class="an">${esc(rowName(x))}</span></button>`).join('');
    else if (mode==='merge1') next=`<p class="dnote">Click the army that leads: the phalanx takes its name. Armies merge at home only.</p>`+A.filter(x => x.mode===A_HOME && groupKeys(PLAYER,x.id).length<=MAX_MERGES).map(x => `<button class="ahead" data-act="m1" data-k="${x.id}"><span class="an">${esc(rowName(x))}</span></button>`).join('');
    else if (mode==='merge2') next=`<p class="dnote">Click the army to merge into ${esc(rowName(armyOf(mergeFirst) ?? A[0]))}.</p>`+A.filter(x => x.id!==mergeFirst && x.mode===A_HOME && groupKeys(PLAYER,x.id).length===1).map(x => `<button class="ahead" data-act="m2" data-k="${x.id}"><span class="an">${esc(rowName(x))}</span></button>`).join('');
    else next=A.map(x => { const ms=groupKeys(PLAYER,groupLead(PLAYER,x.id)), open=x.id===client.selected;
      return `<div class="arow${open ? ' open' : ''}"><button class="ahead" data-act="sel" data-k="${x.id}" aria-expanded="${open}"><span class="an">${esc(rowName(x))}${ms.length>1 ? ` <i class="grp">+${ms.length-1}</i>` : ''}</span><span class="as" data-live="${x.id}"></span></button>${open ? orders(x)+(ms.length>1 ? members(ms) : '') : ''}</div>`; }).join('');
  }
  mergeBtn.setAttribute('aria-pressed',String(mode==='merge1' || mode==='merge2')); mergeBtn.hidden=U.length<2;
  renameBtn.setAttribute('aria-pressed',String(mode==='pick' || mode==='edit')); renameBtn.hidden=!U.length;
  if (next!==html){ html=next; list.innerHTML=next; }
  if (focusEdit && mode==='edit'){ focusEdit=false; const inp=$('cmNameIn') as HTMLInputElement | null; if (inp){ inp.focus(); inp.select(); } }
  for (const el of list.querySelectorAll<HTMLElement>('[data-live]')){ const x=armyOf(+el.dataset.live!); if (x) el.textContent=status(x); }
  for (const el of list.querySelectorAll<HTMLButtonElement>('button[data-act="retreat"]')){ const why=armyProblem(PLAYER,+el.dataset.id!,'retreat'); el.disabled=!!why; }
  for (const el of list.querySelectorAll<HTMLButtonElement>('button[data-act="home"]')){ const why=armyProblem(PLAYER,+el.dataset.id!,'return'); el.disabled=!!why; }
}

list.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || b.disabled) return;
  const act=b.dataset.act;
  if (act==='sel'){ const k=+b.dataset.k!; client.selected=client.selected===k ? -1 : k; html=''; refreshCommand(); return; }
  if (act==='pick'){ editKey=+b.dataset.k!; mode='edit'; focusEdit=true; html=''; refreshCommand(); return; }
  if (act==='cancel'){ mode='list'; html=''; refreshCommand(); return; }
  if (act==='save'){ saveName(); return; }
  if (act==='m1'){ mergeFirst=+b.dataset.k!; mode='merge2'; html=''; refreshCommand(); return; }
  if (act==='m2'){ queueCommand({ type:'merge', nation:PLAYER, a:mergeFirst, b:+b.dataset.k! }); client.selected=mergeFirst; mode='list'; mergeFirst=-1; html=''; refreshCommand(); return; }
  if (act==='unmerge'){ queueCommand({ type:'unmerge', nation:PLAYER, key:+b.dataset.k! }); html=''; return; }
  if (act==='retreat') queueCommand({ type:'army', nation:PLAYER, army:+b.dataset.id!, order:'retreat' });
  else if (act==='home') queueCommand({ type:'army', nation:PLAYER, army:+b.dataset.id!, order:'return' });
  html='';
});
function saveName(){
  const inp=$('cmNameIn') as HTMLInputElement | null, x=armyOf(editKey), u=x ? unitAt(x.id) ?? x.plots.map(q => unitAt(q)).find(v => !!v) : undefined;
  if (inp && u) renameArmy(u,inp.value);
  mode='list'; html=''; refreshCommand();
}
renameBtn.addEventListener('click',() => { mode=mode==='pick' ? 'list' : 'pick'; folded=false; html=''; refreshCommand(); });
mergeBtn.addEventListener('click',() => { mode=mode==='merge1' || mode==='merge2' ? 'list' : 'merge1'; mergeFirst=-1; folded=false; html=''; refreshCommand(); });
list.addEventListener('keydown', e => { if ((e.target as HTMLElement).id!=='cmNameIn') return; if (e.key==='Enter'){ e.preventDefault(); saveName(); } else if (e.key==='Escape'){ e.stopPropagation(); mode='list'; html=''; refreshCommand(); } });
fold.addEventListener('click',() => { folded=!folded; html=''; refreshCommand(); });

/** The army of ours with a man near device pixel (sx,sy), if any. */
export function armyAt(sx: number, sy: number): Army | undefined {
  const wx=(cam.x+sx/cam.zoom)/K, wy=(cam.y+sy/cam.zoom)/K, r=Math.max(2.5,8*cam.dpr/cam.zoom/K);
  let best: Army | undefined, bd=r*r;
  const byId=new Map(W.humans.map(h => [h.id,h]));
  for (const x of mine()){
    for (const f of x.files) for (const id of f){ const h=byId.get(id); if (!h) continue; const d=(h.x-wx)**2+(h.y-2-wy)**2; if (d<bd){ bd=d; best=x; } }
  }
  return best;
}
/** A right-click on the map at device pixel (sx,sy): with an army in hand, its order for the region there; else the army there is taken in hand. */
export function rightClick(sx: number, sy: number){
  const x=selectedArmy();
  if (!x){ const y=armyAt(sx,sy); if (y) selectArmy(y.id); return; }
  const t=tileAt(sx,sy), r=t>=0 ? region[t] : 0;
  if (!r){ const y=armyAt(sx,sy); if (y) selectArmy(y.id); else deselect(); return; }
  const d=W.rOwner[r];
  const order=d && d!==PLAYER && claimsOf(PLAYER,d).includes(r) ? 'attack' : 'defend';
  const why=armyProblem(PLAYER,x.id,order,r);
  if (why){ const y=armyAt(sx,sy); if (y && y!==x){ selectArmy(y.id); return; } toast(why); return; }
  queueCommand({ type:'army', nation:PLAYER, army:x.id, order, region:r });
  toast(`${rowName(x)}: ${order==='attack' ? 'attack' : 'defend'} ${regionName(r)}`);
}
