/* Draws the real-world maps (src/sim/maps.ts) from Natural Earth (public domain).
   Download these GeoJSON files from github.com/nvkelso/natural-earth-vector (geojson/) into one
   folder, then run:  node tools/realmaps.ts <that folder>
     ne_10m_land, ne_50m_land, ne_50m_lakes, ne_10m_geography_regions_polys
   Each map is a grid of the game's tiles, each one of: sea, land, a land bridge across a strait,
   a mountain range, a high range, desert or plateau. Islands too small to matter are dropped; the
   rest are joined to the mainland by bridges across the straits (and a few drawn by hand), so
   every kingdom can reach every other. The grid is stored run-length encoded. */
import { readFileSync, writeFileSync } from 'node:fs';
import { VIEWS, colOf, rowOf, type MapView } from '../src/sim/mapview.ts';

const TW = 400, TH = 248, NT = TW*TH;
export const C_SEA=0, C_LAND=1, C_BRIDGE=2, C_RANGE=3, C_HIGH=4, C_DESERT=5, C_PLATEAU=6;

type Ring = number[][];
type Geo = { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }[] };
const dir = process.argv[2];
if (!dir){ console.error('usage: node tools/realmaps.ts <natural-earth geojson folder>'); process.exit(1); }
const load = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.geojson`,'utf8')) as Geo;

/** The polygons of a feature, each a list of rings (outer first, then holes). */
function polygons(g: { type: string; coordinates: unknown } | null): Ring[][] {
  if (!g) return [];
  if (g.type==='Polygon') return [g.coordinates as Ring[]];
  if (g.type==='MultiPolygon') return g.coordinates as Ring[][];
  return [];
}
/** Fills, through `put`, every tile whose middle lies inside the polygon (even-odd, all its rings). */
function fillPolygon(v: MapView, rings: Ring[], put: (t: number) => void){
  const wrap=v.lon1-v.lon0>=359.9, rows=new Map<number, number[]>();
  for (const ring of rings){
    for (let i=0;i+1<ring.length;i++){
      const x1=colOf(v,ring[i][0],TW), y1=rowOf(v,ring[i][1],TH), x2=colOf(v,ring[i+1][0],TW), y2=rowOf(v,ring[i+1][1],TH);
      if (y1===y2) continue;
      const lo=Math.min(y1,y2), hi=Math.max(y1,y2);
      for (let r=Math.max(0,Math.ceil(lo-0.5));r<=Math.min(TH-1,Math.floor(hi-0.5));r++){
        const yc=r+0.5; if (yc<lo || yc>=hi) continue;
        const x=x1+(yc-y1)/(y2-y1)*(x2-x1);
        let a=rows.get(r); if (!a){ a=[]; rows.set(r,a); } a.push(x);
      }
    }
  }
  for (const [r,xs] of rows){
    xs.sort((a,b) => a-b);
    for (const shift of wrap ? [-TW,0,TW] : [0]) for (let i=0;i+1<xs.length;i+=2){
      const a=xs[i]+shift, b=xs[i+1]+shift;
      for (let c=Math.max(0,Math.ceil(a-0.5));c<=Math.min(TW-1,Math.ceil(b-0.5)-1);c++) put(r*TW+c);
    }
  }
}
function fillLayer(v: MapView, geo: Geo, keep: (p: Record<string, unknown>) => boolean, put: (t: number, p: Record<string, unknown>) => void){
  for (const f of geo.features) if (keep(f.properties)) for (const poly of polygons(f.geometry)) fillPolygon(v,poly,(t) => put(t,f.properties));
}

/** Tiles of each 4-connected landmass. */
function components(code: Uint8Array){
  const comp=new Int32Array(NT).fill(-1), sizes: number[]=[], q=new Int32Array(NT);
  for (let s=0;s<NT;s++){
    if (!code[s] || comp[s]>=0) continue;
    const id=sizes.length; let h=0, t=0; q[t++]=s; comp[s]=id;
    while (h<t){ const c=q[h++], x=c%TW;
      for (const n of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (n>=0 && n<NT && code[n] && comp[n]<0){ comp[n]=id; q[t++]=n; } }
    sizes.push(t);
  }
  return { comp, sizes };
}
/** Joins every landmass of at least `minKeep` tiles within `maxGap` tiles of water of the mainland
    to it by a bridge, nearest first; drops the rest. */
function bridge(code: Uint8Array, minKeep: number, maxGap: number){
  for (;;){
    const { comp, sizes }=components(code);
    const main=sizes.indexOf(Math.max(...sizes));
    // from the mainland out over the water, as far as maxGap
    const dist=new Int16Array(NT).fill(-1), prev=new Int32Array(NT).fill(-1), q=new Int32Array(NT); let h=0, t=0;
    for (let i=0;i<NT;i++) if (comp[i]===main){ dist[i]=0; q[t++]=i; }
    let hit=-1, from=-1;
    while (h<t && hit<0){
      const c=q[h++], x=c%TW;
      for (const n of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]){
        if (n<0 || n>=NT || dist[n]>=0) continue;
        if (code[n]){ if (comp[n]!==main && sizes[comp[n]]>=minKeep){ hit=n; from=c; break; } continue; }
        if (dist[c]>=maxGap) continue;
        dist[n]=dist[c]+1; prev[n]=c; q[t++]=n;
      }
    }
    if (hit<0) break;
    // the bridge: the way back to the mainland, two tiles wide
    for (let c=from;c>=0 && !code[c];c=prev[c]){ code[c]=C_BRIDGE; const side=c+1; if (c%TW<TW-1 && !code[side]) code[side]=C_BRIDGE; }
  }
  const { comp, sizes }=components(code), main=sizes.indexOf(Math.max(...sizes));
  for (let i=0;i<NT;i++) if (code[i] && comp[i]!==main) code[i]=C_SEA;
}
/** A bridge drawn by hand along a line of places (latitude, longitude), two tiles wide. */
function drawBridge(v: MapView, code: Uint8Array, pts: [number, number][]){
  for (let k=0;k+1<pts.length;k++){
    const x1=colOf(v,pts[k][1],TW), y1=rowOf(v,pts[k][0],TH), x2=colOf(v,pts[k+1][1],TW), y2=rowOf(v,pts[k+1][0],TH);
    const n=Math.ceil(Math.hypot(x2-x1,y2-y1)*2)+1;
    for (let i=0;i<=n;i++){
      const x=Math.floor(x1+(x2-x1)*i/n), y=Math.floor(y1+(y2-y1)*i/n);
      for (const [dx,dy] of [[0,0],[1,0],[0,1]]){ const X=x+dx, Y=y+dy; if (X>=0 && Y>=0 && X<TW && Y<TH && !code[Y*TW+X]) code[Y*TW+X]=C_BRIDGE; }
    }
  }
}
/** Run-length code: a letter for the kind (A sea, B land...), then the run in base 36. */
function encode(code: Uint8Array){
  let out='', i=0;
  while (i<NT){ let j=i; while (j<NT && code[j]===code[i]) j++; out+=String.fromCharCode(65+code[i])+(j-i).toString(36); i=j; }
  return out;
}

interface Spec { id: string; land: string; minKeep: number; maxGap: number; bridges?: [number, number][][] }
const SPECS: Spec[] = [
  { id:'balkans', land:'ne_10m_land', minKeep:150, maxGap:5 },
  { id:'europe', land:'ne_10m_land', minKeep:60, maxGap:6 },
  { id:'world', land:'ne_50m_land', minKeep:14, maxGap:5,
    // the North Atlantic: Baffin Island to Greenland, Greenland to Iceland, Iceland by the Faroes to Scotland;
    // and Java along the Lesser Sunda Islands and Timor to Australia
    bridges:[ [[66.6,-61.8],[66.2,-53.6]], [[68.3,-26.5],[66.4,-22.9]], [[64.9,-13.6],[62.1,-7.0],[58.6,-5.0]],
      [[-8.2,114.2],[-8.6,116.4],[-8.5,119.0],[-8.6,122.5],[-9.3,124.6],[-12.2,130.8]] ] },
];
const land10=load('ne_10m_land'), land50=load('ne_50m_land'), lakes=load('ne_50m_lakes'), regions=load('ne_10m_geography_regions_polys');
let ts=`/* ---------- the real-world maps, drawn by tools/realmaps.ts from Natural Earth (public domain) ----------
   Each is the game's grid of tiles, run-length encoded: a letter for the kind of ground
   (A sea, B land, C a land bridge across a strait, D a mountain range, E a high range, F desert,
   G plateau) followed by the length of the run in base 36. Generated: do not edit. */
`;
for (const s of SPECS){
  const v=VIEWS[s.id], code=new Uint8Array(NT);
  fillLayer(v, s.land==='ne_10m_land' ? land10 : land50, () => true, (t) => { code[t]=C_LAND; });
  fillLayer(v, lakes, () => true, (t) => { code[t]=C_SEA; });
  for (const b of s.bridges ?? []) drawBridge(v,code,b);
  bridge(code,s.minKeep,s.maxGap);
  const kind=(p: Record<string, unknown>) => p.FEATURECLA as string;
  fillLayer(v, regions, (p) => kind(p)==='Plateau', (t) => { if (code[t]===C_LAND) code[t]=C_PLATEAU; });
  fillLayer(v, regions, (p) => kind(p)==='Desert', (t) => { if (code[t]===C_LAND || code[t]===C_PLATEAU) code[t]=C_DESERT; });
  fillLayer(v, regions, (p) => kind(p)==='Range/mtn', (t, p) => { if (code[t] && code[t]!==C_BRIDGE && code[t]!==C_HIGH) code[t]=(p.SCALERANK as number)<=2 ? C_HIGH : C_RANGE; });
  const counts=[0,0,0,0,0,0,0]; for (const k of code) counts[k]++;
  const data=encode(code);
  console.log(s.id, 'sea/land/bridge/range/high/desert/plateau', counts.join('/'), 'bytes', data.length);
  ts+=`export const ${s.id.toUpperCase()} = '${data}';\n`;
}
writeFileSync(new URL('../src/sim/maps.ts', import.meta.url), ts);
