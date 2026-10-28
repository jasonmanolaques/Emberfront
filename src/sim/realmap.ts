/* ---------- the real-world maps: Natural Earth's ground (sim/maps.ts) made into the game's terrain ----------
   The stored grid says where there is sea, land, a land bridge, a mountain range (or a high one),
   desert, plateau or hills. On Europe, drawn from real elevation, they are exact: high ground is
   snow and mountain, hills are hills. The rest comes from the place itself: the high ranges carry snow and the
   lesser ones are mountain with hills about them; deserts have dry fringes; and elsewhere the
   climate goes by latitude, by how far inland a place is, and by noise: rainforest near the
   equator, dry belts in the subtropics, grass and woods in the temperate lands, forest in the
   north, and tundra and ice beyond. Land bridges are sandbars. Elevation follows the terrain,
   for the map's shading. */
import { TW, TH, NT, NP, PW, T_DEEP, T_WATER, T_SHALLOW, T_BEACH, T_GRASS, T_DRY, T_FOREST, T_DESERT, T_HILLS, T_MOUNT, T_SNOW } from '../core/constants';
import { mulberry32, type Noise } from '../core/rng';
import { W, elev, moist, terr, isLand, pBuild, pCenter } from './state';
import { VIEWS, latOf, tileXY } from './mapview';
import { BALKANS, EUROPE, WORLD } from './maps';
import { COUNTRIES, type Country } from '../core/countries';

const C_BRIDGE=2, C_RANGE=3, C_HIGH=4, C_DESERT=5, C_PLATEAU=6, C_HILL=7;
const DATA: Record<string, string> = { balkans: BALKANS, europe: EUROPE, world: WORLD };
export const REAL_MAPS = Object.keys(DATA);

/** The stored grid of map `id`: the kind of ground on each tile. */
function decode(id: string){
  const code=new Uint8Array(NT), s=DATA[id]; let t=0;
  for (const m of s.matchAll(/([A-H])([0-9a-z]+)/g)){ const k=m[1].charCodeAt(0)-65, n=parseInt(m[2],36); code.fill(k,t,t+n); t+=n; }
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

/** Gradient (Perlin) noise from 0 to 1: unlike value noise, a threshold through it cuts curves,
    not the straight edges and wedges of its grid. */
function perlin(seed: number): Noise {
  const r=mulberry32(seed), p=new Uint8Array(512), gx=new Float32Array(256), gy=new Float32Array(256);
  for (let i=0;i<256;i++){ p[i]=i; const a=r()*Math.PI*2; gx[i]=Math.cos(a); gy[i]=Math.sin(a); }
  for (let i=255;i>0;i--){ const j=(r()*(i+1))|0, t=p[i]; p[i]=p[j]; p[j]=t; }
  for (let i=0;i<256;i++) p[i+256]=p[i];
  const fade=(t: number) => t*t*t*(t*(t*6-15)+10);
  return (x,y) => {
    const xi=Math.floor(x), yi=Math.floor(y), xf=x-xi, yf=y-yi, X=xi&255, Y=yi&255;
    const g=(h: number, dx: number, dy: number) => gx[h]*dx+gy[h]*dy;
    const a=g(p[X+p[Y]],xf,yf), b=g(p[X+1+p[Y]],xf-1,yf), c=g(p[X+p[Y+1]],xf,yf-1), d=g(p[X+1+p[Y+1]],xf-1,yf-1);
    const u=fade(xf), v=fade(yf), ab=a+(b-a)*u, cd=c+(d-c)*u;
    return 0.5+(ab+(cd-ab)*v)*0.75;
  };
}
/** Fractal noise, each octave turned a little from the last, so no grid lines up from one to the next. */
function swirl(n: Noise, x: number, y: number, oct: number){
  let s=0, a=1, f=1, t=0, c=1, sn=0;
  for (let i=0;i<oct;i++){
    s+=a*n((x*c-y*sn)*f+i*17.31, (x*sn+y*c)*f+i*31.77); t+=a; a*=0.5; f*=2.03;
    const c2=c*0.825-sn*0.565; sn=sn*0.825+c*0.565; c=c2;   // (about 34 degrees an octave)
  }
  return s/t;
}
// the climate by latitude (degrees from the equator): wetter at the equator and in the north, dry
// in the subtropics, tundra past the Arctic circle; in between it changes gradually
const CLIMATE: [number, number][] = [[0,0.22],[10,0.22],[16,0.02],[26,-0.12],[36,-0.04],[46,0.06],[58,0.12],[63,0.16],[68,-0.06],[90,-0.06]];
function climateAt(a: number){
  for (let i=1;i<CLIMATE.length;i++){ const [a1,c1]=CLIMATE[i]; if (a<=a1){ const [a0,c0]=CLIMATE[i-1]; return c0+(c1-c0)*(a-a0)/(a1-a0); } }
  return CLIMATE[CLIMATE.length-1][1];
}

export function genRealMap(id: string, seed: number){
  const v=VIEWS[id], code=decode(id), r=mulberry32(seed);
  // (the ground's patchwork keeps the same size in tiles on a bigger map: Europe, twice the scale, has twice as many patches across)
  const nE=perlin((r()*4294967296)>>>0), nM=perlin((r()*4294967296)>>>0), sc=7/Math.min(TH,744);
  for (let t=0;t<NT;t++) isLand[t]=code[t] ? 1 : 0;
  const land=(t: number) => code[t]>0, water=(t: number) => !code[t], ranged=(t: number) => code[t]===C_RANGE || code[t]===C_HIGH;
  const inland=distance(water,land,40), depth=distance(land,water,40);
  const rangeIn=distance((t) => land(t) && !ranged(t),ranged,10), nearRange=distance(ranged,(t) => land(t) && !ranged(t),5);
  const desertIn=distance((t) => land(t) && code[t]!==C_DESERT,(t) => code[t]===C_DESERT,12);   // (the deserts' drawn outlines fray into dry land at their edges)
  const sea=0.4; let top=sea+0.01;
  for (let y=0;y<TH;y++){
    const a=Math.abs(latOf(v,y,TH)), climate=climateAt(a);
    for (let x=0;x<TW;x++){
      const t=y*TW+x, k=code[t], n=swirl(nE,x*sc,y*sc,5), m=swirl(nM,x*sc+40,y*sc+40,5);
      moist[t]=m;
      if (!k){ const d=depth[t]; terr[t]=d<=1 ? T_SHALLOW : d<=4 ? T_WATER : T_DEEP; elev[t]=sea-0.004*Math.min(d,30)-0.002; continue; }
      const dl=inland[t];
      let tr: number;
      const wet=m+climate+(dl<=3 ? 0.07 : dl>25 ? -0.08 : 0);
      // (where the deserts are is known on Europe: elsewhere the driest ground there is dry grassland)
      const low=() => a>=66 && wet<0.5 ? T_DRY : wet<0.3 ? (v.dem && a>=36 ? T_DRY : T_DESERT) : wet<0.42 ? T_DRY : wet<0.63 ? T_GRASS : T_FOREST;
      if (k===C_BRIDGE) tr=T_BEACH;
      else if (v.dem && (k===C_RANGE || k===C_HIGH)){
        // from real elevation: high ground is snow inside and mountain at its edge; the ranges are mountain, hills at their foot
        const rd=rangeIn[t];
        tr = k===C_HIGH ? (rd>=1 ? T_SNOW : T_MOUNT) : rd>=1 || n>0.55 ? T_MOUNT : T_HILLS;
      }
      else if (k===C_RANGE || k===C_HIGH){
        const rd=rangeIn[t];
        tr = (k===C_HIGH && rd>=2 && n>0.42) || (a>62 && rd>=2) ? T_SNOW : rd>=2 || n>0.55 ? T_MOUNT : T_HILLS;
      }
      else if (k===C_HILL) tr = n>0.3 ? T_HILLS : low();
      else if (k===C_DESERT) tr = n>0.84 ? T_HILLS : n>0.74 || m>0.68 || m+(10-Math.min(10,desertIn[t]))*0.035>0.66 ? T_DRY : T_DESERT;
      else if (k===C_PLATEAU) tr = n>0.64 ? T_HILLS : m<0.52 ? T_DRY : T_GRASS;
      else if (nearRange[t]<=2 && n>0.6) tr=T_HILLS;
      else if (a>=72 && n>0.38) tr=T_SNOW;
      else tr=low();
      if (dl===1 && (tr===T_GRASS || tr===T_DRY || tr===T_DESERT) && n<0.36) tr=T_BEACH;
      terr[t]=tr;
      const e = tr===T_BEACH ? 0.006 : tr===T_SNOW ? 0.45+0.05*n : tr===T_MOUNT ? 0.28+0.03*Math.min(rangeIn[t],6)+0.05*n
        : tr===T_HILLS ? 0.16+0.06*n : 0.02+0.07*Math.min(dl,20)/20+0.03*n;
      elev[t]=sea+e; if (sea+e>top) top=sea+e;
    }
  }
  // capitals lie in valleys and on plains: the ranges' coarse outlines give way around each one
  for (const k of COUNTRIES){
    const p=tileXY(v,k.cap[0],k.cap[1],TW,TH); if (!p) continue;
    for (let dy=-9;dy<=9;dy++) for (let dx=-9;dx<=9;dx++){
      const X: number=p[0]+dx, Y: number=p[1]+dy, d=Math.hypot(dx,dy); if (X<0||Y<0||X>=TW||Y>=TH || d>9) continue;
      const t=Y*TW+X; if (!isLand[t]) continue;
      if (terr[t]===T_SNOW || terr[t]===T_MOUNT){ terr[t] = d<6.5 ? T_GRASS : T_HILLS; elev[t]=sea+(d<6.5 ? 0.06 : 0.16); }
      else if (terr[t]===T_HILLS && d<5) { terr[t]=T_GRASS; elev[t]=sea+0.06; }
    }
  }
  // a capital by the sea with no room for a castle at hand gets a harbour: the nearest block that is
  // mostly land is filled in
  for (const k of COUNTRIES){
    const p=tileXY(v,k.cap[0],k.cap[1],TW,TH); if (!p) continue;
    const bx0=Math.round(p[0]/4)-1, by0=Math.round(p[1]/4)-1;
    const fits=(bx: number, by: number, need: number) => {
      if (bx<0 || by<0 || bx+2>PW || by+2>(TH>>2)) return false;
      let land=0; for (let y=by*4;y<by*4+8;y++) for (let x=bx*4;x<bx*4+8;x++){ const t=y*TW+x; if (terr[t]===T_MOUNT || terr[t]===T_SNOW) return false; land+=isLand[t]; }
      return land>=need;
    };
    let room=false; for (let dy=-1;dy<=1 && !room;dy++) for (let dx=-1;dx<=1;dx++) if (fits(bx0+dx,by0+dy,64)){ room=true; break; }
    if (room) continue;
    let best: [number, number] | null=null, bd=1e9;
    for (const need of [30,16]) if (!best) for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++){ const d=dx*dx+dy*dy; if (d<bd && fits(bx0+dx,by0+dy,need)){ bd=d; best=[bx0+dx,by0+dy]; } }   // (a thin island too)
    if (!best) continue;
    for (let y=best[1]*4;y<best[1]*4+8;y++) for (let x=best[0]*4;x<best[0]*4+8;x++){ const t=y*TW+x; if (!isLand[t]){ isLand[t]=1; terr[t]=T_GRASS; elev[t]=sea+0.02; } }
  }
  const lt: number[]=[]; for (let t=0;t<NT;t++) if (isLand[t]) lt.push(t);
  W.landTiles=Int32Array.from(lt); W.landCount=lt.length;
  W.seaLevel=sea; W.heightRange=top-sea;
  for (let q=0;q<NP;q++){
    const px=q%PW, py=(q/PW)|0; let n=0;
    for (let y=py*4;y<py*4+4;y++) for (let x=px*4;x<px*4+4;x++) n+=isLand[y*TW+x];
    const c=pCenter[q];
    pBuild[q] = n>=12 && isLand[c] ? 1 : 0;   // mountains and snowfields too: any ground with room
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
