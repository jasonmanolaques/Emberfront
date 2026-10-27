/* ---------- buildings: villagers build their own houses; farms, barracks, watchtowers and coin
   minters are placed by each kingdom and paid for from its stockpile. Also roads, fire & ruins.
   Plantations, quarries and copper mines are placed one plot at a time. With resource gathering
   research at tier 2, two of a kind side by side join into one building of 2×1 plots (tier 2), and
   at tier 3 four of a kind in a square join into one of 2×2 (tier 3); a joined building makes far
   more than its parts did apart. ---------- */
import { plannedWall } from './fort';
import { TW, PW, PH, NP, T_MOUNT, T_FOREST, B_EMPTY, B_HOUSE, B_FARM, B_TOWER, B_CASTLE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_SITE, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_RESEARCH, B_GUILD, B_SMITHY, isStructure } from '../core/constants';
import { W, owner, occ, terr, isLand, road, pType, pOwner, pVar, pBuild, pCenter, pBurn, pTimer, pPrio, pAband, pMain, pHp, pTier, pSpan, pArmor, type Nation } from './state';
import { R_GATHER } from './research';
import { on } from './events';
import { clearPlot } from './resources';
import { gained } from './ledger';

function igniteOne(q: number){ if (pBurn[q]>0) return; pBurn[q]=2.5+W.srand()*2.5; W.burning.push(q); on.plotIgnited(q); }
/** Sets plot q on fire; a building that covers several plots goes up in flames all together. */
export function ignite(q: number){
  const main = pType[q]===B_PART ? pMain[q] : q;
  for (const k of cover(main)) igniteOne(k);
}
export function toRuins(q: number){ pSpan[q]=0; pType[q]=B_RUINS; pOwner[q]=0; pVar[q]=(W.srand()*8)|0; pBurn[q]=0; pTimer[q]=35+W.srand()*30; pPrio[q]=0; pAband[q]=0; pHp[q]=0; pTier[q]=0; pArmor[2][q]=pArmor[3][q]=0; on.plotChanged(q); }

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
  pType[q]=type; pOwner[q]=id; pVar[q]=(W.srand()*3)|0; pTimer[q]=0; pPrio[q]=0; pAband[q]=0; pHp[q]=0; pTier[q]=type===B_HOUSE || type===B_TOWER ? 1 : 0; pSpan[q]=0; pArmor[2][q]=pArmor[3][q]=0;
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
  if (plotProblem(n,q) || !houseFits(q) || plannedWall(n,q)) return 0;   // a bot's houses keep off the line of its wall
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
  W.nations[id].houses++; W.nations[id].beds++;   // count it right away rather than at the next census
}

/* ---------- buildings a kingdom places ---------- */
export interface Structure { type: number; name: string; cost: number[]; info: string; }   // cost: [wood, stone, copper]
// buildings placed bigger than one plot: [width, height] in plots
export const SIZE: Record<number, [number, number]> = { [B_GUILD]: [2,1] };
/** The plots a building of `type` placed with its top-left on plot q covers. */
export function footprint(q: number, type: number){ return rect(q, SIZE[type] ?? [1,1]); }
const rect = (q: number, [w,h]: number[]) => { const out: number[]=[]; for (let y=0;y<h;y++) for (let x=0;x<w;x++) out.push(q+y*PW+x); return out; };
// plantations, quarries and copper mines: their size (pSpan) is their tier
export const GATHERERS = [B_PLANTATION, B_QUARRY, B_COPPERMINE];
export const isGatherer = (ty: number) => ty===B_PLANTATION || ty===B_QUARRY || ty===B_COPPERMINE;
const SPANS = [[1,1],[2,1],[2,2]];
/** [width, height] in plots of the building whose main plot is q. */
export function dims(q: number): [number, number] {
  const ty=pType[q];
  if (ty===B_CASTLE) return [2,2];
  if (isGatherer(ty)){ const [w,h]=SPANS[pSpan[q]]; return [w,h]; }
  return SIZE[ty] ?? [1,1];
}
/** The plots the building whose main plot is q covers. */
export const cover = (q: number) => rect(q, dims(q));
/** A plantation, quarry or copper mine's tier: 1 alone, 2 two joined, 3 four joined. */
export const gatherTier = (q: number) => pSpan[q]+1;
// production buildings: what they make every PRODUCE_TICKS, by type: [good, amount by tier]
export const PRODUCE_TICKS = 300;   // 30 s
export const PRODUCES: Record<number, [number, number[]]> = { [B_PLANTATION]: [0,[0,2,5,15]], [B_QUARRY]: [1,[0,1,3,10]], [B_COPPERMINE]: [2,[0,1,3,10]] };
export const STRUCTURES: Structure[] = [
  { type: B_FARM,     name: 'Farm',        cost: [5,2,0], info: 'Each farm brings new villagers 5% sooner.' },
  { type: B_BARRACKS, name: 'Barracks',    cost: [5,5,0], info: 'Trains soldiers and houses an army of 5, with 5 armour racks. Barracks side by side join into one bigger army: four together march as one army of 20. Soldiers without room patrol the city and only defend. Click a barracks to see its army.' },
  { type: B_TOWER,    name: 'Watchtower',  cost: [2,5,1], info: 'While you are at war, shoots enemy soldiers that come near, and their villagers. Click a placed tower to call up to 5 soldiers to guard it.' },
  { type: B_MINTER,   name: 'Coin minter', cost: [5,5,5], info: 'Raises your gold income by 10%.' },
  { type: B_PLANTATION, name: 'Plantation', cost: [10,0,0], info: 'Saplings growing into trees: +2 wood every 30 seconds. With resource gathering research, two side by side join (+5), then four in a square (+15).' },
  { type: B_QUARRY,     name: 'Stone quarry', cost: [3,5,0], info: 'A pit with a pulley hauling stone up: +1 stone every 30 seconds. With resource gathering research, two side by side join (+3), then four in a square (+10).' },
  { type: B_COPPERMINE, name: 'Copper mine', cost: [10,10,0], info: 'A shaft into the rock with the furnace glowing inside: +1 copper every 30 seconds. With resource gathering research, two side by side join (+3), then four in a square (+10).' },
  { type: B_RESEARCH,   name: 'Research station', cost: [15,15,10], info: 'Scholars earn 1 research point a second; more stations, faster research. Click a placed station to choose what to study.' },
  { type: B_GUILD,      name: 'Builders guild', cost: [10,20,5], info: 'One villager becomes its builder. As research allows, he rebuilds watchtowers (10 stone and 4 wood, then 20 and 8) and turns hovels into stone houses and manors (3 wood and 3 stone a tier), spending what the city investment slider lets him. Takes 2×1 plots.' },
  { type: B_SMITHY,     name: 'Blacksmith', cost: [10,15,5], info: 'One villager becomes its smith. With infantry research he fetches 5 copper from the castle, forges armour for 5 seconds and carries it to the barracks: reinforced armour for every rack, then heavy armour.' },
];
export const structureOf = (type: number) => STRUCTURES.find(s => s.type===type);
export const canAfford = (n: Nation, s: Structure) => s.cost.every((c,g) => n.stock[g]>=c);

/** Why kingdom n can't build on plot q, or null if it can. */
export function plotProblem(n: Nation, q: number): string | null {
  if (q<0 || q>=NP || !pBuild[q]) return 'There is no room to build there';
  if (owner[pCenter[q]]!==n.id) return 'Build on your own land';
  if (occ[pCenter[q]]) return 'The enemy holds that ground';
  if ((pType[q]!==B_EMPTY && pType[q]!==B_RUINS) || pBurn[q]>0) return 'Something already stands there';
  const px=(q%PW)*4, py=((q/PW)|0)*4;
  for (let y=py;y<py+4;y++) for (let x=px;x<px+4;x++){ const o=owner[y*TW+x]; if (o && o!==n.id) return 'Too close to the border'; }
  return null;
}

/** Why kingdom n can't put a `type` building with its top-left on plot q, or null if it can. */
export function placeProblem(n: Nation, q: number, type: number): string | null {
  const [w,h]=SIZE[type] ?? [1,1];
  if (q<0 || q%PW+w>PW || ((q/PW)|0)+h>PH) return 'There is no room to build there';
  for (const k of footprint(q,type)){ const p=plotProblem(n,k); if (p) return w*h>1 && p==='Something already stands there' ? `Needs ${w}×${h} free plots` : p; }
  return null;
}

/** Pays for and places a building. Returns false if it can't be afforded or placed. */
export function build(n: Nation, q: number, type: number){
  const s=structureOf(type);
  if (!s || !n.alive || !canAfford(n,s) || placeProblem(n,q,type)) return false;
  s.cost.forEach((c,g) => n.stock[g]-=c);
  for (const k of footprint(q,type).slice(1)){ pType[k]=B_PART; pOwner[k]=n.id; pMain[k]=q; pBurn[k]=0; pAband[k]=0; pPrio[k]=0; clearPlot(k); }
  placeBuilding(q,n.id,type,false);
  // count it right away rather than at the next census, so its effect starts now
  countUp(n,type);
  if (isGatherer(type)) joinGatherers(n);
  return true;
}
export function countUp(n: Nation, type: number){
  if (type===B_FARM) n.farms++; else if (type===B_BARRACKS) n.barracks++; else if (type===B_TOWER) n.towers++; else if (type===B_MINTER) n.minters++;
  else if (type===B_PLANTATION) n.plantations++; else if (type===B_QUARRY) n.quarries++; else if (type===B_COPPERMINE) n.copperMines++;
  else if (type===B_RESEARCH) n.labs++; else if (type===B_GUILD) n.guilds++; else if (type===B_SMITHY) n.smithies++;
}

/** Production buildings fill the stockpile every 30 seconds by their tier; pTimer counts their
    progress. One standing on ground the enemy holds makes nothing. */
export function produce(){
  const N=W.nations;
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive) continue;
    for (const q of n.blds){
      const out=PRODUCES[pType[q]]; if (!out || pOwner[q]!==n.id || pBurn[q]>0 || occ[pCenter[q]]) continue;
      if (++pTimer[q]>=PRODUCE_TICKS){ const k=out[1][gatherTier(q)]; pTimer[q]=0; n.stock[out[0]]+=k; gained(n,out[0],k); on.produced(q,n.id,out[0],k); }
    }
  }
}

/** Plantations, quarries and copper mines of kingdom n join up as far as its research allows:
    at tier 3 any four of a kind filling a 2×2 square (whatever they were before) become one; at
    tier 2 two single ones of a kind side by side become one. The joined building keeps the most
    advanced of its parts' work in progress. */
export function joinGatherers(n: Nation){
  const top=n.tier[R_GATHER]; if (top<2) return;
  const id=n.id, mainOf=(k: number) => pType[k]===B_PART ? pMain[k] : k;
  const kind=(k: number) => { const m=mainOf(k); return pOwner[m]===id && pBurn[m]<=0 && isGatherer(pType[m]) ? pType[m] : -1; };
  const join=(q: number, span: number, ty: number) => {
    const cells=rect(q,SPANS[span]); let timer=0, hp=0;
    for (const k of cells){ const m=mainOf(k); timer=Math.max(timer,pTimer[m]); hp=Math.max(hp,pHp[m]); }
    for (const k of cells){ pType[k]=B_PART; pMain[k]=q; pOwner[k]=id; pSpan[k]=0; pTimer[k]=0; pHp[k]=0; }
    pType[q]=ty; pSpan[q]=span; pTimer[q]=timer; pHp[q]=hp;
    for (const k of cells) on.plotChanged(k);
  };
  const plots=n.blds.slice().sort((a,b) => a-b);   // main plots, top-left first
  if (top>=3) for (let i=0;i<plots.length;i++){
    const q=plots[i], ty=pType[q]; if (!isGatherer(ty) || pOwner[q]!==id || pSpan[q]===2 || mainOf(q)!==q) continue;
    if (q%PW+1>=PW || ((q/PW)|0)+1>=PH) continue;
    const sq=rect(q,[2,2]);
    if (!sq.every(k => kind(k)===ty && cover(mainOf(k)).every(c => sq.includes(c)))) continue;
    join(q,2,ty);
  }
  for (let i=0;i<plots.length;i++){
    const q=plots[i], ty=pType[q]; if (!isGatherer(ty) || pOwner[q]!==id || pSpan[q]!==0 || mainOf(q)!==q || q%PW+1>=PW) continue;
    const r=q+1; if (pType[r]!==ty || pOwner[r]!==id || pSpan[r]!==0 || pBurn[r]>0) continue;
    join(q,1,ty);
  }
}

/** Watchtowers calling for a garrison are numbered in the order they asked. */
export function togglePriority(n: Nation, q: number){
  if (pType[q]!==B_TOWER || pOwner[q]!==n.id || pBurn[q]>0) return;
  pPrio[q] = pPrio[q] ? 0 : ++W.prioSeq;
  on.plotChanged(q);
}
