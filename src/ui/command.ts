/* ---------- the armies panel: every army of ours, in peace and in war ----------
   One row for each barracks' army and one for the militia as a single army. Clicking a row opens its orders:
   at home, where to deploy it (to wait on a border, which is not a crisis, so that a crisis begun later needs no march);
   out on a border, which front it is on (when it meets the enemy on more than one landmass), and in a war whether it
   attacks or defends (sim/war.ts armyOrder), or, short of war, recall. Right-clicking an army's leader on the map opens
   its row. The row picked has its soldiers ringed in gold. */
import { K, PLAYER, TW, GAME_SPEED } from '../core/constants';
import { W, type Campaign } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { F_GATHER, attacks, inCrisis, crisisWait, navalOf, frontInfo, occOn, callable, allied, warProblem } from '../sim/war';
import { units, unitAt } from '../sim/army';
import { client } from '../client';
import { cam } from '../render/camera';
import { flagCSS } from '../render/flags';
import { armyName } from './armies';
import { toast } from './hud';
import { $ } from './dom';

const panel=$('command'), list=$('cmList'), count=$('cmCount'), fold=$('cmFold') as HTMLButtonElement;
const MIL=-2;                       // the militia's row key
let sel=-1;                         // the row open (a unit's key, or MIL)
let folded=typeof innerWidth==='number' && innerWidth<=640, html='';   // (a small screen starts with the list folded)

const DIRS = ['east','south-east','south','south-west','west','north-west','north','north-east'];
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
  return u ? armyName(me,u).replace(/ barracks$/i,' army').replace(/^Barracks$/,'Army') : 'Army';
}
/** The stretches of border with o, named by where they lie from our castle ("North-east front"; one border alone is just "Border"). */
function frontNames(o: number){
  const me=W.nations[PLAYER], out=new Map<number, string>(), used=new Map<string, number>(), fs=frontInfo(PLAYER,o);
  const [px,py]=me.capTile>=0 ? [me.capTile%TW, (me.capTile/TW)|0] : [fs[0]?.x ?? 0, fs[0]?.y ?? 0];
  for (const f of fs){
    const dir=DIRS[(Math.round(Math.atan2(f.y-py,f.x-px)/(Math.PI/4))+8)%8], k=(used.get(dir) ?? 0)+1; used.set(dir,k);
    out.set(f.isle,fs.length>1 ? `${dir[0].toUpperCase()+dir.slice(1)} front${k>1 ? ' '+k : ''}` : 'Border');
  }
  return out;
}
/** What the row says it is doing (updated in place each refresh, so the buttons under it stay put). */
function status(key: number){
  const c=campOf(key);
  if (!c){
    if (key===MIL){ const k=callable(PLAYER).length; return k ? `${k} at home` : 'none at home'; }
    const u=unitAt(key); return u ? `At home · ${u.home}/${u.cap}` : '';
  }
  const foe=nm(c.d), M=W.M, pair=c.a*M+c.d, men=c.members.length;
  if (c.naval>=0 && navalOf(c.a,c.d)) return `${men} men · sailing to ${foe}`;
  if (W.wars[pair]){
    if (attacks(c)) return `${men} men · ${occOn(c.a,c.d,c.isle)>0 ? 'retaking your land' : 'attacking '+foe}`;
    return `${men} men · defending against ${foe}`;
  }
  if (inCrisis(c.a,c.d)){
    const w=crisisWait(c.a,c.d);
    return `${men} men · crisis with ${foe}${w>0 ? ` · war may begin in ${secs(w)} s` : ' · ready for the word'}`;
  }
  if (W.aggr[c.d*M+c.a]) return `${men} men · holding against ${foe}`;
  return `${men} men · ${W.offensive[pair]===F_GATHER ? 'gathering on' : 'deployed on'} the border of ${foe}`;
}
/** The nations whose border we share (and are not allied with): where an army at home could go. */
function neighbours(){
  const out: number[]=[];
  for (let o=1;o<W.M;o++) if (o!==PLAYER && W.nations[o].alive && W.contact[PLAYER*W.M+o]>0 && !allied(PLAYER,o)) out.push(o);
  return out;
}
const btn = (act: string, label: string, attrs: string, opts: { on?: boolean; off?: boolean; title?: string; cls?: string }={}) =>
  `<button class="ao ${opts.cls ?? ''}" data-act="${act}" ${attrs} ${opts.off ? 'disabled' : ''} aria-pressed="${!!opts.on}" ${opts.title ? `title="${esc(opts.title)}"` : ''}>${label}</button>`;

/** The orders under an open row. */
function orders(key: number){
  const c=campOf(key);
  if (!c){
    // at home: deploy on a border (in peace this is a precaution, not a crisis), or join a crisis or war that has begun
    const out: string[]=[];
    const ready = key===MIL ? callable(PLAYER).length>0 : (unitAt(key)?.home ?? 0)>0;
    for (const o of neighbours()){
      const why=warProblem(PLAYER,o), fs=frontNames(o), isles=[...fs.keys()];
      const flag=`<i class="flag" style="${flagCSS(W.nations[o].code)}"></i>`;
      const joining=W.wars[PLAYER*W.M+o] || W.aggr[PLAYER*W.M+o] || W.aggr[o*W.M+PLAYER];
      const rows=(isles.length ? isles : [0]).map(isle => {
        const where=isles.length>1 ? ` · ${fs.get(isle)}` : '';
        const label=joining ? `Send to the front${where}` : `Deploy on the border${where}`;
        return btn('deploy',label,`data-o="${o}" data-k="${key}" data-isle="${isle}"`,{ off:!!why || !ready, title: why ?? (!ready ? 'Nobody of it is at home' : joining ? 'Join the fighting' : 'Gather on the border as a precaution: not a crisis, and a crisis begun later needs no march') });
      });
      out.push(`<div class="ato">${flag}<span>${esc(nm(o))}</span></div>${rows.join('')}`);
    }
    return out.join('') || '<p class="dnote">No kingdom borders yours.</p>';
  }
  const M=W.M, pair=c.a*M+c.d, war=!!W.wars[pair], o=c.d, out: string[]=[];
  const fs=frontNames(o);
  if (fs.size>1 && c.naval<0 && !war){
    out.push(`<div class="ato">Front</div>`+[...fs].map(([isle,name]) => btn('front',esc(name),`data-camp="${c.id}" data-isle="${isle}"`,{ on:c.isle===isle, title:`Stand on the border with ${nm(o)} ${name.toLowerCase()}` })).join(''));
  } else if (fs.size>1) out.push(`<div class="ato">${esc(fs.get(c.isle) ?? 'Front')}</div>`);
  if (fs.size>1 && war && c.naval<0) out.push([...fs].map(([isle,name]) => btn('front',esc(name),`data-camp="${c.id}" data-isle="${isle}"`,{ on:c.isle===isle, title:`Fight on the border with ${nm(o)} ${name.toLowerCase()}` })).join(''));
  if (war){
    const go=attacks(c), lib=occOn(c.a,c.d,c.isle)>0;
    out.push(`<div class="ato2">${btn('order','⚔ Attack',`data-camp="${c.id}" data-go="1"`,{ on:go, cls:'atk', title: lib ? 'Take your land back on this front' : 'Push into their land all along this front' })}${btn('order','🛡 Defend',`data-camp="${c.id}" data-go=""`,{ on:!go, cls:'def', title:'Fall back to the closest ground of ours that no enemy tower reaches, and hold a line there; attack again when ordered to' })}</div>`);
  } else {
    const mine=inCrisis(c.a,c.d) && !c.deployed;
    out.push(btn('recall','Recall',`data-camp="${c.id}"`,{ off:mine, title: mine ? 'It is part of the crisis: de-escalate from the war bar to call it off' : 'Send it home' }));
  }
  return out.join('');
}

/** Brings the panel up to date (each HUD refresh): the rows and orders when they change, the words in place. */
export function refreshCommand(){
  const me=W.nations[PLAYER];
  const U=me ? (units[PLAYER] ?? []).slice().sort((a,b) => a.key-b.key) : [];
  const mil=me ? callable(PLAYER).length>0 || W.campaigns.some(c => c.a===PLAYER && c.militia && c.phase<2) : false;
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
  const next = folded ? '' : keys.map(k => `<div class="arow${k===sel ? ' open' : ''}"><button class="ahead" data-act="sel" data-k="${k}" aria-expanded="${k===sel}"><span class="an">${esc(rowName(k))}</span><span class="as" data-live="${k}"></span></button>${k===sel ? `<div class="aorders">${orders(k)}</div>` : ''}</div>`).join('');
  if (next!==html){ html=next; list.innerHTML=next; }
  for (const el of list.querySelectorAll<HTMLElement>('[data-live]')) el.textContent=status(+el.dataset.live!);
}

list.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || b.disabled) return;
  const act=b.dataset.act;
  if (act==='sel'){ const k=+b.dataset.k!; sel=sel===k ? -1 : k; html=''; refreshCommand(); return; }
  if (act==='deploy'){
    const k=+b.dataset.k!, o=+b.dataset.o!, isle=+b.dataset.isle!;
    const M=W.M;
    if (W.wars[PLAYER*M+o] || W.aggr[PLAYER*M+o]) queueCommand({ type:'war', nation:PLAYER, target:o, units:k===MIL ? [] : [k], militia:k===MIL ? callable(PLAYER).length : 0, isle });
    else if (W.aggr[o*M+PLAYER]) queueCommand({ type:'defend', nation:PLAYER, target:o, units:k===MIL ? [] : [k], isle });
    else queueCommand({ type:'deploy', nation:PLAYER, target:o, units:k===MIL ? [] : [k], militia:k===MIL ? callable(PLAYER).length : 0, isle });
    html=''; return;
  }
  const camp=+b.dataset.camp!;
  if (act==='order') queueCommand({ type:'order', nation:PLAYER, camp, go:!!b.dataset.go });
  else if (act==='front') queueCommand({ type:'front', nation:PLAYER, camp, isle:+b.dataset.isle! });
  else if (act==='recall') queueCommand({ type:'recall', nation:PLAYER, camp });
  html='';
});
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
