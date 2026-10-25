/* ---------- buildings: procedural towns, roads, fire & ruins ---------- */
import { TW, PW, PH, T_MOUNT, T_HILLS, T_GRASS, T_DRY, T_FOREST, B_EMPTY, B_HOUSE, B_FARM, B_TOWER, B_MINE, B_CASTLE, B_CPART, B_RUINS } from '../core/constants';
import { W, owner, terr, isLand, road, pType, pOwner, pVar, pBuild, pCenter, pBurn, pTimer } from './state';
import { on } from './events';

export function ignite(q: number){ if (pBurn[q]>0) return; pBurn[q]=2.5+W.srand()*2.5; W.burning.push(q); on.plotIgnited(q); }
export function toRuins(q: number){ pType[q]=B_RUINS; pOwner[q]=0; pVar[q]=(W.srand()*8)|0; pBurn[q]=0; pTimer[q]=35+W.srand()*30; on.plotChanged(q); }

export function isBld(ty: number){ return ty>=B_HOUSE && ty<=B_CPART; }
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
const isOwnTower = (k: number, id: number) => pType[k]===B_TOWER && pOwner[k]===id;
const isEnemyLand = (k: number, id: number) => { const o=owner[pCenter[k]]; return o!==0 && o!==id; };

function chooseType(q: number, id: number, nb: number){
  const t=terr[pCenter[q]], srand=W.srand;
  if (t===T_MOUNT) return nb>0 && srand()<0.5 ? B_MINE : B_EMPTY;
  if (anyWithin(q,id,2,isEnemyLand) && !anyWithin(q,id,3,isOwnTower) && srand()<0.75) return B_TOWER;
  if (t===T_HILLS) return nb>0 && srand()<0.45 ? B_MINE : B_HOUSE;
  if (nb>=2 && (t===T_GRASS||t===T_DRY) && srand()<0.32) return B_FARM;
  return B_HOUSE;
}

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
  pType[q]=type; pOwner[q]=id; pVar[q]=(W.srand()*3)|0; pTimer[q]=0;
  on.plotChanged(q);
  const n=W.nations[id]; n.bCount++;
  if (type!==B_FARM) connectRoad(q,id,isNew);
  n.blds.push(q);
  on.buildingPlaced(q,id,isNew);
}
export function growCities(){
  const N=W.nations, srand=W.srand;
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive || !n.plots.length) continue;
    if (n.bCount >= (n.plots.length*0.26|0)+4) continue;
    const tries=1+Math.min(4,(n.tiles/1500)|0);
    for (let k=0;k<tries;k++){
      let best=-1, bw=0, bnb=0;
      for (let s=0;s<12;s++){
        const q=n.plots[(srand()*n.plots.length)|0], ty=pType[q];
        if ((ty!==B_EMPTY && ty!==B_RUINS) || owner[pCenter[q]]!==n.id || !pBuild[q]) continue;
        const nb=nbBuildings(q,n.id);
        // towns grow outward from their edges; dense cores fill slowly; empty countryside seeds new villages
        let w = nb>0 ? (nb<=3 ? 1+nb*1.4 : nb<=5 ? 1.6 : 0.35) : n.bCount<2 ? 0.3 : (!anyWithin(q,n.id,5,isOwnBld) ? 0.9 : 0.03);
        if (ty===B_RUINS) w*=1.8;
        if (terr[pCenter[q]]===T_FOREST) w*=0.5;
        w*=0.5+srand();
        if (w>bw){ bw=w; best=q; bnb=nb; }
      }
      if (best<0) continue;
      placeBuilding(best,n.id,chooseType(best,n.id,bnb),bnb===0);
    }
  }
}
