/* ---------- buildings: villagers build their own houses; farms, barracks, watchtowers and coin
   minters are placed by each kingdom and paid for from its stockpile. Also roads, fire & ruins. ---------- */
import { TW, PW, PH, NP, T_MOUNT, T_FOREST, B_EMPTY, B_HOUSE, B_FARM, B_TOWER, B_CASTLE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_SITE, isStructure } from '../core/constants';
import { W, owner, terr, isLand, road, pType, pOwner, pVar, pBuild, pCenter, pBurn, pTimer, pPrio, pAband, type Nation } from './state';
import { on } from './events';
import { clearPlot } from './resources';

export function ignite(q: number){ if (pBurn[q]>0) return; pBurn[q]=2.5+W.srand()*2.5; W.burning.push(q); on.plotIgnited(q); }
export function toRuins(q: number){ pType[q]=B_RUINS; pOwner[q]=0; pVar[q]=(W.srand()*8)|0; pBurn[q]=0; pTimer[q]=35+W.srand()*30; pPrio[q]=0; pAband[q]=0; on.plotChanged(q); }

export function isBld(ty: number){ return isStructure(ty) || ty===B_CASTLE || ty===B_CPART; }
function nbBuildings(q: number, id: number){
  const px=q%PW, py=(q/PW)|0; let c=0;
  for (let y=py-1;y<=py+1;y++) for (let x=px-1;x<=px+1;x++){
    if ((x===px&&y===py)||x<0||y<0||x>=PW||y>=PH) continue;
    const k=y*PW+x; if (isBld(pType[k]) && pOwner[k]===id && pBurn[k]<=0) c++;
  }
  return c;
}
function anyWithin(q: number, id: number, r: number, pred: (k: number, id: number) => boolean){
  const px=q%PW, py=(q/PW)|0;
  for (let y=Math.max(0,py-r);y<=Math.min(PH-1,py+r);y++) for (let x=Math.max(0,px-r);x<=Math.min(PW-1,px+r);x++){
    const k=y*PW+x; if (k!==q && pred(k,id)) return true; }
  return false;
}
const isOwnBld = (k: number, id: number) => isBld(pType[k]) && pOwner[k]===id;
export const isEnemyLand = (k: number, id: number) => { const o=owner[pCenter[k]]; return o!==0 && o!==id; };
export { anyWithin };

const houseFits = (q: number) => terr[pCenter[q]]!==T_MOUNT;

function buildRoad(a: number, b: number){
  let x0=a%TW, y0=(a/TW)|0; const x1=b%TW, y1=(b/TW)|0;
  const dx=Math.abs(x1-x0), dy=-Math.abs(y1-y0), sx=x0<x1?1:-1, sy=y0<y1?1:-1;
  let err=dx+dy; const path: number[]=[];
  for (let guard=0;guard<400;guard++){
    const t=y0*TW+x0; if (!isLand[t]) return; path.push(t);
    if (x0===x1 && y0===y1) break;
    const e2=2*err; if (e2>=dy){ err+=dy; x0+=sx; } if (e2<=dx){ err+=dx; y0+=sy; }
  }
  for (const t of path) if (!road[t]){ road[t]=1; on.roadBuilt(t); }
}
function connectRoad(q: number, id: number, far: boolean){
  const n=W.nations[id], px=q%PW, py=(q/PW)|0; let best=-1, bd=1e9;
  for (const k of n.blds){
    if (k===q) continue; const ty=pType[k]; if (ty===B_FARM || pOwner[k]!==id) continue;
    const d=Math.max(Math.abs(k%PW-px),Math.abs(((k/PW)|0)-py));
    if (d<bd){ bd=d; best=k; }
  }
  if (best<0 || bd>(far?16:3)) return;
  const target = (pType[best]===B_CASTLE||pType[best]===B_CPART) && n.capTile>=0 ? n.capTile : pCenter[best];
  buildRoad(pCenter[q], target);
}
function placeBuilding(q: number, id: number, type: number, isNew: boolean){
  if (type===B_EMPTY) return;
  pType[q]=type; pOwner[q]=id; pVar[q]=(W.srand()*3)|0; pTimer[q]=0; pPrio[q]=0; pAband[q]=0;
  clearPlot(q);
  on.plotChanged(q);
  const n=W.nations[id]; n.bCount++;
  if (type!==B_FARM) connectRoad(q,id,isNew);
  n.blds.push(q);
  on.buildingPlaced(q,id,isNew);
}
/* ---------- houses: each villager builds one when the kingdom is short of homes ---------- */
/** How well plot q suits a new house: towns grow outward from their edges and along their roads,
    dense cores fill slowly, and open countryside now and then seeds a new village. 0 = unsuitable. */
export function homeScore(n: Nation, q: number){
  if (plotProblem(n,q) || !houseFits(q)) return 0;
  const nb=nbBuildings(q,n.id);
  let w = nb>0 ? (nb<=3 ? 1+nb*1.4 : nb<=5 ? 1.6 : 0.35) : n.bCount<2 ? 0.3 : (!anyWithin(q,n.id,5,isOwnBld) ? 0.9 : 0.03);
  if (pType[q]===B_RUINS) w*=1.8;   // rebuilding on the ashes
  if (terr[pCenter[q]]===T_FOREST) w*=0.5;
  // beside a road
  const px=(q%PW)*4, py=((q/PW)|0)*4;
  for (let i=-1;i<=4;i++) if (road[(py-1)*TW+px+i] || road[(py+4)*TW+px+i] || road[(py+i)*TW+px-1] || road[(py+i)*TW+px+4]){ w*=1.4; break; }
  return w;
}
/** Marks plot q as a house site: the frame goes up while a villager works on it. */
export function startSite(q: number, id: number){ pType[q]=B_SITE; pOwner[q]=id; pVar[q]=(W.srand()*3)|0; pAband[q]=0; clearPlot(q); on.plotChanged(q); }
export function cancelSite(q: number){ if (pType[q]!==B_SITE) return; pType[q]=B_EMPTY; pOwner[q]=0; on.plotChanged(q); }
export function finishHouse(q: number, id: number){
  const isNew=nbBuildings(q,id)===0;
  pType[q]=B_EMPTY;
  placeBuilding(q,id,B_HOUSE,isNew);
  W.nations[id].houses++;   // count it right away rather than at the next census
}

/* ---------- buildings a kingdom places ---------- */
export interface Structure { type: number; name: string; cost: number[]; info: string; }   // cost: [wood, stone, copper]
export const STRUCTURES: Structure[] = [
  { type: B_FARM,     name: 'Farm',        cost: [5,2,0], info: 'Each farm brings new villagers 5% sooner.' },
  { type: B_BARRACKS, name: 'Barracks',    cost: [5,5,0], info: 'Trains your soldiers and is where they wait. You need one before you can raise an army.' },
  { type: B_TOWER,    name: 'Watchtower',  cost: [2,5,1], info: 'Shoots enemy soldiers that come near and makes the land around it costlier to take. Click a placed tower to call up to 5 soldiers to guard it.' },
  { type: B_MINTER,   name: 'Coin minter', cost: [5,5,5], info: 'Raises your gold income by 10%.' },
];
export const structureOf = (type: number) => STRUCTURES.find(s => s.type===type);
export const canAfford = (n: Nation, s: Structure) => s.cost.every((c,g) => n.stock[g]>=c);

/** Why kingdom n can't build on plot q, or null if it can. */
export function plotProblem(n: Nation, q: number): string | null {
  if (q<0 || q>=NP || !pBuild[q]) return 'There is no room to build there';
  if (owner[pCenter[q]]!==n.id) return 'Build on your own land';
  if ((pType[q]!==B_EMPTY && pType[q]!==B_RUINS) || pBurn[q]>0) return 'Something already stands there';
  const px=(q%PW)*4, py=((q/PW)|0)*4;
  for (let y=py;y<py+4;y++) for (let x=px;x<px+4;x++){ const o=owner[y*TW+x]; if (o && o!==n.id) return 'Too close to the border'; }
  return null;
}

/** Pays for and places a building. Returns false if it can't be afforded or placed. */
export function build(n: Nation, q: number, type: number){
  const s=structureOf(type);
  if (!s || !n.alive || !canAfford(n,s) || plotProblem(n,q)) return false;
  s.cost.forEach((c,g) => n.stock[g]-=c);
  placeBuilding(q,n.id,type,false);
  // count it right away rather than at the next census, so its effect starts now
  if (type===B_FARM) n.farms++; else if (type===B_BARRACKS) n.barracks++; else if (type===B_TOWER) n.towers++; else if (type===B_MINTER) n.minters++;
  return true;
}

/** Watchtowers calling for a garrison are numbered in the order they asked. */
export function togglePriority(n: Nation, q: number){
  if (pType[q]!==B_TOWER || pOwner[q]!==n.id || pBurn[q]>0) return;
  pPrio[q] = pPrio[q] ? 0 : ++W.prioSeq;
  on.plotChanged(q);
}
