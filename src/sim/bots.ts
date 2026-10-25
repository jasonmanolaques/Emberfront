/* ---------- bots ---------- */
import { B_FARM, B_TOWER, B_BARRACKS, B_MINTER, PW } from '../core/constants';
import { W, pType, pOwner, pPrio, type Nation } from './state';
import { launch } from './territory';
import { STRUCTURES, canAfford, plotProblem, build, togglePriority, anyWithin, isEnemyLand } from './buildings';

/** What a bot would build next, most wanted first. */
function wishlist(n: Nation, atWar: boolean){
  const w: number[]=[];
  if (!n.barracks && n.soldierShare>0) w.push(B_BARRACKS);
  if (atWar && n.towers < 1+(n.tiles/900|0)) w.push(B_TOWER);
  if (n.farms < 1+(n.tiles/600|0)) w.push(B_FARM);
  if (n.minters < 1+(n.tiles/1500|0)) w.push(B_MINTER);
  return w;
}
const sameNeighbour = (q: number, type: number, id: number) =>
  [q-1,q+1,q-PW,q+PW].some(k => k>=0 && pType[k]===type && pOwner[k]===id);

/** Picks a plot for `type`: towers go toward enemies; the rest gather next to their own kind, near the capital. */
function pickPlot(n: Nation, type: number){
  const srand=W.srand, cap=n.capPlot; let best=-1, bs=-Infinity;
  for (let k=0;k<24 && n.plots.length;k++){
    const q=n.plots[(srand()*n.plots.length)|0];
    if (plotProblem(n,q)) continue;
    const d=Math.hypot(q%PW-cap%PW, ((q/PW)|0)-((cap/PW)|0));
    let s = type===B_TOWER ? (anyWithin(q,n.id,2,isEnemyLand) ? 20 : 0) - d*0.2 : -d + (sameNeighbour(q,type,n.id) ? 12 : 0);
    s += srand()*3;
    if (s>bs){ bs=s; best=q; }
  }
  return best;
}

function botBuild(n: Nation, atWar: boolean){
  for (const type of wishlist(n,atWar)){
    const s=STRUCTURES.find(s=>s.type===type)!;
    if (!canAfford(n,s)) continue;
    const q=pickPlot(n,type);
    if (q>=0 && build(n,q,type)){
      // a tower facing an enemy usually calls for a garrison
      if (type===B_TOWER && n.barracks && anyWithin(q,n.id,2,isEnemyLand) && W.srand()<0.6 && !pPrio[q]) togglePriority(n,q);
      return;
    }
  }
}

export function botThink(n: Nation){
  const srand=W.srand, M=W.M, contact=W.contact;
  n.nextThink=W.simTime+1.1+srand()*2.4;
  const b=n.id*M;
  let atWar=false; for (let o=1;o<M;o++) if (o!==n.id && contact[b+o] && W.nations[o].alive){ atWar=true; break; }
  botBuild(n,atWar);
  let active=0; for (const A of W.attacks) if (!A.done && A.att===n.id) active++;
  if (active>=2) return;
  // personality: how much gold it lets pile up before expanding, and before picking a fight
  const g=n.gold, expandAt=20+n.expandAt*200, attackAt=80+n.attackAt*500;
  if (contact[b]>0 && g>expandAt && (srand()<0.8 || g<attackAt)){ launch(n.id,0,g*n.ratio); return; }
  if (g<attackAt) return;
  let best=0, bs=0;
  for (let o=1;o<M;o++){
    if (o===n.id) continue; const c=contact[b+o]; if (!c) continue; const D=W.nations[o]; if (!D.alive) continue;
    const dens=D.strength/Math.max(1,D.tiles), gain=g*n.ratio/((1+0.5*dens)*1.25);
    if (gain<25) continue;
    const sc=gain*(0.6+srand()*0.8)*(1+Math.min(c,300)/300);
    if (sc>bs){ bs=sc; best=o; }
  }
  if (best) launch(n.id,best,g*n.ratio);
}
