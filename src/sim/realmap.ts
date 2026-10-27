/* ---------- the real-world maps: Natural Earth's ground (sim/maps.ts) made into the game's terrain ----------
   The stored grid says where there is sea, land, a land bridge, a mountain range (or a high one),
   desert or plateau. The rest comes from the place itself: the high ranges carry snow and the
   lesser ones are mountain with hills about them; deserts have dry fringes; and elsewhere the
   climate goes by latitude, by how far inland a place is, and by noise: rainforest near the
   equator, dry belts in the subtropics, grass and woods in the temperate lands, forest in the
   north, and tundra and ice beyond. Land bridges are sandbars. Elevation follows the terrain,
   for the map's shading. */
import { TW, TH, NT, NP, PW, T_DEEP, T_WATER, T_SHALLOW, T_BEACH, T_GRASS, T_DRY, T_FOREST, T_DESERT, T_HILLS, T_MOUNT, T_SNOW } from '../core/constants';
import { mulberry32, makeNoise, fbm } from '../core/rng';
import { W, elev, moist, terr, isLand, pBuild, pCenter } from './state';
import { VIEWS, latOf, tileXY } from './mapview';
import { BALKANS, EUROPE, WORLD } from './maps';
import { COUNTRIES, type Country } from '../core/countries';

const C_BRIDGE=2, C_RANGE=3, C_HIGH=4, C_DESERT=5, C_PLATEAU=6;
const DATA: Record<string, string> = { balkans: BALKANS, europe: EUROPE, world: WORLD };
export const REAL_MAPS = Object.keys(DATA);

/** The stored grid of map `id`: the kind of ground on each tile. */
function decode(id: string){
  const code=new Uint8Array(NT), s=DATA[id]; let t=0;
  for (const m of s.matchAll(/([A-G])([0-9a-z]+)/g)){ const k=m[1].charCodeAt(0)-65, n=parseInt(m[2],36); code.fill(k,t,t+n); t+=n; }
  return code;
}
/** Steps (4-connected) from the nearest tile where `src` holds, up to `cap`, over tiles where `walk` holds. */
function distance(src: (t: number) => boolean, walk: (t: number) => boolean, cap: number){
  const d=new Int16Array(NT).fill(cap), q=new Int32Array(NT); let h=0, n=0;
  for (let t=0;t<NT;t++) if (src(t)){ d[t]=0; q[n++]=t; }
  while (h<n){
    const c=q[h++], x=c%TW; if (d[c]>=cap-1) continue;
    for (const k of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (k>=0 && k<NT && d[k]>d[c]+1 && walk(k)){ d[k]=d[c]+1; q[n++]=k; }
  }
  return d;
}

export function genRealMap(id: string, seed: number){
  const v=VIEWS[id], code=decode(id), r=mulberry32(seed);
  const nE=makeNoise((r()*4294967296)>>>0), nM=makeNoise((r()*4294967296)>>>0), sc=7/TH;
  for (let t=0;t<NT;t++) isLand[t]=code[t] ? 1 : 0;
  const land=(t: number) => code[t]>0, water=(t: number) => !code[t], ranged=(t: number) => code[t]===C_RANGE || code[t]===C_HIGH;
  const inland=distance(water,land,40), depth=distance(land,water,40);
  const rangeIn=distance((t) => land(t) && !ranged(t),ranged,10), nearRange=distance(ranged,(t) => land(t) && !ranged(t),5);
  const sea=0.4; let top=sea+0.01;
  for (let y=0;y<TH;y++){
    const a=Math.abs(latOf(v,y,TH));
    // wetter at the equator and in the north, dry in the subtropics, tundra past the Arctic circle
    const climate = a<10 ? 0.22 : a<20 ? 0.02 : a<32 ? -0.12 : a<40 ? -0.03 : a<56 ? 0.06 : a<66 ? 0.16 : -0.06;
    for (let x=0;x<TW;x++){
      const t=y*TW+x, k=code[t], n=fbm(nE,x*sc,y*sc,4), m=fbm(nM,x*sc+40,y*sc+40,4);
      moist[t]=m;
      if (!k){ const d=depth[t]; terr[t]=d<=1 ? T_SHALLOW : d<=4 ? T_WATER : T_DEEP; elev[t]=sea-0.004*Math.min(d,30)-0.002; continue; }
      const dl=inland[t];
      let tr: number;
      if (k===C_BRIDGE) tr=T_BEACH;
      else if (k===C_RANGE || k===C_HIGH){
        const rd=rangeIn[t];
        tr = (k===C_HIGH && rd>=2 && n>0.42) || (a>62 && rd>=2) ? T_SNOW : rd>=2 || n>0.55 ? T_MOUNT : T_HILLS;
      }
      else if (k===C_DESERT) tr = n>0.84 ? T_HILLS : n>0.74 || m>0.68 ? T_DRY : T_DESERT;
      else if (k===C_PLATEAU) tr = n>0.64 ? T_HILLS : m<0.52 ? T_DRY : T_GRASS;
      else if (nearRange[t]<=2 && n>0.6) tr=T_HILLS;
      else if (a>=72 && n>0.38) tr=T_SNOW;
      else {
        const wet=m+climate+(dl<=3 ? 0.07 : dl>25 ? -0.08 : 0);
        tr = a>=66 && wet<0.5 ? T_DRY : wet<0.3 ? T_DESERT : wet<0.42 ? T_DRY : wet<0.63 ? T_GRASS : T_FOREST;
      }
      if (dl===1 && (tr===T_GRASS || tr===T_DRY || tr===T_DESERT) && n<0.36) tr=T_BEACH;
      terr[t]=tr;
      const e = tr===T_BEACH ? 0.006 : tr===T_SNOW ? 0.45+0.05*n : tr===T_MOUNT ? 0.28+0.03*Math.min(rangeIn[t],6)+0.05*n
        : tr===T_HILLS ? 0.16+0.06*n : 0.02+0.07*Math.min(dl,20)/20+0.03*n;
      elev[t]=sea+e; if (sea+e>top) top=sea+e;
    }
  }
  const lt: number[]=[]; for (let t=0;t<NT;t++) if (isLand[t]) lt.push(t);
  W.landTiles=Int32Array.from(lt); W.landCount=lt.length;
  W.seaLevel=sea; W.heightRange=top-sea;
  for (let q=0;q<NP;q++){
    const px=q%PW, py=(q/PW)|0; let n=0;
    for (let y=py*4;y<py*4+4;y++) for (let x=px*4;x<px*4+4;x++) n+=isLand[y*TW+x];
    const c=pCenter[q];
    pBuild[q] = n>=12 && isLand[c] && terr[c]!==T_SNOW ? 1 : 0;
  }
}

/** The countries whose capital lies on land of map `id`, with the tile it stands on. */
export function capitalsOn(id: string): { country: Country; tile: number }[] {
  const v=VIEWS[id], out: { country: Country; tile: number }[]=[];
  for (const k of COUNTRIES){
    const p=tileXY(v,k.cap[0],k.cap[1],TW,TH); if (!p) continue;
    const t=p[1]*TW+p[0];
    // a capital on the coast may fall a tile into the sea: the nearest land, close by
    let best=-1, bd=9;
    for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++){ const X=p[0]+dx, Y=p[1]+dy; if (X<0||Y<0||X>=TW||Y>=TH) continue; const k2=Y*TW+X, d=dx*dx+dy*dy; if (isLand[k2] && d<bd){ bd=d; best=k2; } }
    if (best>=0) out.push({ country:k, tile: isLand[t] ? t : best });
  }
  return out;
}
