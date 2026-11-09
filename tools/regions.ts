/* Draws the regions (provinces) of the real-world maps from Natural Earth's first-level
   administrative divisions (ne_10m_admin_1_states_provinces, public domain), into
   src/sim/regiondata.ts. Download that GeoJSON file from github.com/nvkelso/natural-earth-vector
   (geojson/) into a folder, then run:  node tools/regions.ts <that folder> [map ids]
   Each division is laid on the map's land, tile by tile. The divisions are very uneven (Slovenia
   has two hundred, Russia a few dozen the size of countries), so they are merged and split to a
   balanced size: small ones join their neighbours, the country's own first and those of the same
   historical region before others (so Italy's provinces gather into Tuscany, Lombardy, ...); big
   ones are cut into compact pieces named by their compass point. Desert and high mountains count
   for less, so the empty lands make bigger regions. Islands too small to be a region of their own
   belong to none. Each region gets a flag: on the tile furthest from its edge. The regions are
   stored per map: a run-length list of the region of each land tile, row by row (water tiles are
   skipped), then their names and the tiles of their flags. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { VIEWS, colOf, rowOf, type MapView } from '../src/sim/mapview.ts';
import { BALKANS, EUROPE, WORLD } from '../src/sim/maps.ts';

type Ring = number[][];
type Props = Record<string, unknown>;
type Geo = { features: { properties: Props; geometry: { type: string; coordinates: unknown } | null }[] };
const dir = process.argv[2];
if (!dir){ console.error('usage: node tools/regions.ts <natural-earth geojson folder> [map ids]'); process.exit(1); }
const geo=JSON.parse(readFileSync(`${dir}/ne_10m_admin_1_states_provinces.geojson`,'utf8')) as Geo;
const DATA: Record<string, string> = { balkans: BALKANS, europe: EUROPE, world: WORLD };
// how many regions each map is cut into (about: merging and splitting land near it)
const TARGET: Record<string, number> = { europe: 560, balkans: 90, world: 240 };
const C_RANGE=3, C_HIGH=4, C_DESERT=5;

function decodeRaw(s: string, n0: number){
  const code=new Uint8Array(n0); let t=0;
  for (const m of s.matchAll(/([A-H])([0-9a-z]+)/g)){ const k=m[1].charCodeAt(0)-65, n=parseInt(m[2],36); code.fill(k,t,t+n); t+=n; }
  return code;
}
function polygons(g: { type: string; coordinates: unknown } | null): Ring[][] {
  if (!g) return [];
  if (g.type==='Polygon') return [g.coordinates as Ring[]];
  if (g.type==='MultiPolygon') return g.coordinates as Ring[][];
  return [];
}
function bboxOf(g: { type: string; coordinates: unknown } | null){
  let x0=1e9, x1=-1e9, y0=1e9, y1=-1e9;
  for (const p of polygons(g)) for (const r of p) for (const [x,y] of r){ if (x<x0) x0=x; if (x>x1) x1=x; if (y<y0) y0=y; if (y>y1) y1=y; }
  return [x0,y0,x1,y1];
}
function fillPolygon(v: MapView, TW: number, TH: number, rings: Ring[], put: (t: number) => void){
  const wrap=v.lon1-v.lon0>=359.9, rows=new Map<number, number[]>();
  for (const ring of rings){
    for (let i=0;i+1<ring.length;i++){
      let l1=ring[i][0], l2=ring[i+1][0];
      if (wrap){ while (l1<v.lon0) l1+=360; while (l2<v.lon0) l2+=360; if (Math.abs(l2-l1)>180){ if (l2>l1) l2-=360; else l2+=360; } }
      const x1=colOf(v,l1,TW), y1=rowOf(v,ring[i][1],TH), x2=colOf(v,l2,TW), y2=rowOf(v,ring[i+1][1],TH);
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
/** A division's name made short: no 'Voivodeship', 'Oblast', 'Republic of' and the like. */
const tidy = (n: string) => n.replace(/^(Republic of|Autonomous Republic of) /,'').replace(/ (Voivodeship|Oblast|Krai|Autonomous Okrug|Republic|Province|County|Governorate|Region|District|Canton)$/,'').trim() || n;
const COMPASS: [number, number, string][] = [[0,-1,'Northern'],[0,1,'Southern'],[1,0,'Eastern'],[-1,0,'Western'],[0.7,-0.7,'North-eastern'],[-0.7,-0.7,'North-western'],[0.7,0.7,'South-eastern'],[-0.7,0.7,'South-western']];

function draw(id: string){
  const v=VIEWS[id], TW=v.w, TH=v.h, NT=TW*TH, code=decodeRaw(DATA[id],NT);
  const wOf=(t: number) => code[t]===C_DESERT ? 0.3 : code[t]===C_HIGH ? 0.8 : 1;
  let land=0, weight=0; for (let t=0;t<NT;t++) if (code[t]){ land++; weight+=wOf(t); }
  const A=weight/TARGET[id];
  // 1. every land tile to the division it lies in (the nearest one for coast tiles the outlines miss)
  const unit=new Int32Array(NT).fill(-1), feats=geo.features;
  const wrap=v.lon1-v.lon0>=359.9;
  feats.forEach((f,fi) => {
    const [x0,y0,x1,y1]=bboxOf(f.geometry);
    if (!wrap && (x1<v.lon0 || x0>v.lon1)) return;
    if (y1<v.lat1 || y0>v.lat0) return;
    for (const poly of polygons(f.geometry)) fillPolygon(v,TW,TH,poly,(t) => { if (code[t] && unit[t]<0) unit[t]=fi; });
  });
  {
    const q=new Int32Array(NT); let h=0, n=0;
    for (let t=0;t<NT;t++) if (unit[t]>=0) q[n++]=t;
    while (h<n){ const c=q[h++], x=c%TW;
      for (const k of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (k>=0 && k<NT && code[k] && unit[k]<0){ unit[k]=unit[c]; q[n++]=k; } }
  }
  // 2. the pieces: each division's 4-connected parts
  const part=new Int32Array(NT).fill(-1), pUnit: number[]=[], pW: number[]=[], pN: number[]=[], pSX: number[]=[], pSY: number[]=[];
  {
    const q=new Int32Array(NT);
    for (let s=0;s<NT;s++){
      if (unit[s]<0 || part[s]>=0) continue;
      const pid=pUnit.length, u=unit[s]; let h=0, n=0, w=0, sx=0, sy=0; q[n++]=s; part[s]=pid;
      while (h<n){ const c=q[h++], x=c%TW; w+=wOf(c); sx+=x; sy+=(c/TW)|0;
        for (const k of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (k>=0 && k<NT && unit[k]===u && part[k]<0){ part[k]=pid; q[n++]=k; } }
      pUnit.push(u); pW.push(w); pN.push(n); pSX.push(sx); pSY.push(sy);
    }
  }
  const P=pUnit.length;
  // shared edges between pieces
  const adj: Map<number, number>[]=Array.from({ length:P }, () => new Map());
  for (let t=0;t<NT;t++){
    const a=part[t]; if (a<0) continue; const x=t%TW;
    for (const k of [x<TW-1 ? t+1 : -1, t+TW<NT ? t+TW : -1]){ if (k<0) continue; const b=part[k]; if (b<0 || b===a) continue; adj[a].set(b,(adj[a].get(b) ?? 0)+1); adj[b].set(a,(adj[b].get(a) ?? 0)+1); }
  }
  // 3. merging: union-find over pieces, the smallest group first into its best neighbour
  const up=Int32Array.from({ length:P }, (_,i) => i), gW=pW.slice(), gAdj=adj.map(m => new Map(m)), alive=new Uint8Array(P).fill(1);
  const find=(i: number): number => { while (up[i]!==i){ up[i]=up[up[i]]; i=up[i]; } return i; };
  const props=(i: number) => feats[pUnit[i]].properties;
  const country=(i: number) => String(props(i).adm0_a3 ?? '');
  const histo=(i: number) => String(props(i).region ?? '');
  const gCountry: string[]=Array.from({ length:P }, (_,i) => country(i)), gRegion: string[]=Array.from({ length:P }, (_,i) => histo(i));
  for (;;){
    let s=-1, sw=Infinity;
    for (let i=0;i<P;i++) if (alive[i] && gW[i]<A*0.55 && gAdj[i].size && gW[i]<sw){ sw=gW[i]; s=i; }
    if (s<0) break;
    let best=-1, bs=Infinity, per=0; for (const e of gAdj[s].values()) per+=e;
    for (const [b,e] of gAdj[s]){
      const same=gCountry[b]===gCountry[s], reg=same && gRegion[b]!=='' && gRegion[b]===gRegion[s];
      const sc=(gW[s]+gW[b])/A+(same ? 0 : 3)+(reg ? -0.4 : 0)-0.6*e/per;
      if (sc<bs){ bs=sc; best=b; }
    }
    // join s into best
    const b=best; up[s]=b; alive[s]=0; gW[b]+=gW[s];
    if (gRegion[b]!==gRegion[s]) gRegion[b]='';
    for (const [k,e] of gAdj[s]){ if (k===b) continue; gAdj[b].set(k,(gAdj[b].get(k) ?? 0)+e); const m=gAdj[k]; m.delete(s); m.set(b,(m.get(b) ?? 0)+e); }
    gAdj[b].delete(s); gAdj[s].clear();
  }
  // islands too small to be a region belong to none
  const dropped=new Uint8Array(P);
  for (let i=0;i<P;i++) if (alive[i] && !gAdj[i].size && gW[i]<A*0.09) dropped[i]=1;
  // 4. the groups' tiles, and the big ones cut into pieces about A each
  const gTiles=new Map<number, number[]>();
  for (let t=0;t<NT;t++){ if (part[t]<0) continue; const g=find(part[t]); if (dropped[g]) continue; let a=gTiles.get(g); if (!a){ a=[]; gTiles.set(g,a); } a.push(t); }
  const regionOf=new Int32Array(NT).fill(0), names: string[]=[''];
  const nameOfGroup=(g: number) => {
    // the members' divisions: the heaviest one names it, unless all share a historical region
    const w=new Map<number, number>(); for (let i=0;i<P;i++) if (find(i)===g) w.set(pUnit[i],(w.get(pUnit[i]) ?? 0)+pW[i]);
    const us=[...w.keys()];
    const regs=new Set(us.map(u => String(feats[u].properties.region ?? '')));
    if (us.length>2 && regs.size===1 && [...regs][0]) return tidy([...regs][0]);
    let bu=us[0]; for (const u of us) if ((w.get(u) ?? 0)>(w.get(bu) ?? 0)) bu=u;
    const p=feats[bu].properties; return tidy(String(p.name_en || p.name || p.gn_name || 'Region'));
  };
  const seq=[...gTiles.keys()].sort((a,b) => gTiles.get(a)![0]-gTiles.get(b)![0]);
  for (const g of seq){
    const T=gTiles.get(g)!, base=nameOfGroup(g);
    let W=0; for (const t of T) W+=wOf(t);
    const k=W>A*1.7 ? Math.round(W/A) : 1;
    if (k<=1){ names.push(base); const r=names.length-1; for (const t of T) regionOf[t]=r; continue; }
    // seeds by farthest-point sampling, then a few rounds of weighted k-means, then grown over the land from them (so each piece is all of a piece)
    const xs=T.map(t => t%TW), ys=T.map(t => (t/TW)|0);
    let cx=0, cy=0; for (let i=0;i<T.length;i++){ cx+=xs[i]; cy+=ys[i]; } cx/=T.length; cy/=T.length;
    const seeds: [number, number][]=[]; { let bi=0, bd=-1; for (let i=0;i<T.length;i++){ const d=(xs[i]-cx)**2+(ys[i]-cy)**2; if (d>bd){ bd=d; bi=i; } } seeds.push([xs[bi],ys[bi]]); }
    const dmin=new Float64Array(T.length).fill(Infinity);
    while (seeds.length<k){ const [sx,sy]=seeds[seeds.length-1]; let bi=0, bd=-1; for (let i=0;i<T.length;i++){ const d=(xs[i]-sx)**2+(ys[i]-sy)**2; if (d<dmin[i]) dmin[i]=d; if (dmin[i]>bd){ bd=dmin[i]; bi=i; } } seeds.push([xs[bi],ys[bi]]); }
    const lab=new Int32Array(T.length);
    for (let it=0;it<10;it++){
      const sx=new Float64Array(k), sy=new Float64Array(k), sw=new Float64Array(k);
      for (let i=0;i<T.length;i++){ let bj=0, bd=Infinity; for (let j=0;j<k;j++){ const d=(xs[i]-seeds[j][0])**2+(ys[i]-seeds[j][1])**2; if (d<bd){ bd=d; bj=j; } } lab[i]=bj; const w=wOf(T[i]); sx[bj]+=xs[i]*w; sy[bj]+=ys[i]*w; sw[bj]+=w; }
      for (let j=0;j<k;j++) if (sw[j]>0) seeds[j]=[sx[j]/sw[j],sy[j]/sw[j]];
    }
    // grow from the tile of the group nearest each centre
    const inG=new Map<number, number>(); T.forEach((t,i) => inG.set(t,i));
    const got=new Int32Array(T.length).fill(-1), q: number[]=[];
    for (let j=0;j<k;j++){ let bi=-1, bd=Infinity; for (let i=0;i<T.length;i++){ if (got[i]>=0) continue; const d=(xs[i]-seeds[j][0])**2+(ys[i]-seeds[j][1])**2; if (d<bd){ bd=d; bi=i; } } if (bi>=0){ got[bi]=j; q.push(bi); } }
    for (let h=0;h<q.length;h++){ const i=q[h], t=T[i], x=t%TW;
      for (const n of [x>0?t-1:-1, x<TW-1?t+1:-1, t-TW, t+TW]){ const m=inG.get(n); if (m!==undefined && got[m]<0){ got[m]=got[i]; q.push(m); } } }
    const first=names.length;
    for (let j=0;j<k;j++){
      let dx=seeds[j][0]-cx, dy=seeds[j][1]-cy; const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
      let bn='Central', bd=-2; if (L>3) for (const [ux,uy,nm] of COMPASS){ const d=dx*ux+dy*uy; if (d>bd){ bd=d; bn=nm; } }
      names.push(`${bn} ${base}`);
    }
    for (let i=0;i<T.length;i++) regionOf[T[i]]=got[i]>=0 ? first+got[i] : first;
  }
  // a piece of a cut region that came out tiny (a sliver the growing missed) joins the neighbour it touches most
  // names made unique
  const seen=new Map<string, number>();
  for (let r=1;r<names.length;r++){ const n=names[r]; const c=(seen.get(n) ?? 0)+1; seen.set(n,c); if (c>1) names[r]=`${n} ${['','','II','III','IV','V','VI','VII','VIII'][c] ?? c}`; }
  const R=names.length;
  // 5. flags: the tile of each region furthest from its edge (water or another region), ties to the one nearest its middle
  const dist=new Int32Array(NT).fill(-1), q=new Int32Array(NT); let h=0, n=0;
  for (let t=0;t<NT;t++){
    const r=regionOf[t]; if (!r) continue; const x=t%TW;
    let edge=false; for (const k of [x>0?t-1:-1, x<TW-1?t+1:-1, t-TW, t+TW]) if (k<0 || k>=NT || regionOf[k]!==r){ edge=true; break; }
    if (edge){ dist[t]=0; q[n++]=t; }
  }
  while (h<n){ const c=q[h++], x=c%TW; for (const k of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (k>=0 && k<NT && regionOf[k]===regionOf[c] && dist[k]<0){ dist[k]=dist[c]+1; q[n++]=k; } }
  const sx=new Float64Array(R), sy=new Float64Array(R), sn=new Float64Array(R), size=new Int32Array(R);
  for (let t=0;t<NT;t++){ const r=regionOf[t]; if (r){ sx[r]+=t%TW; sy[r]+=(t/TW)|0; sn[r]++; size[r]++; } }
  const flag=new Int32Array(R).fill(-1), fs=new Float64Array(R).fill(-1);
  for (let t=0;t<NT;t++){ const r=regionOf[t]; if (!r) continue; const s=dist[t]*4-Math.hypot(t%TW-sx[r]/sn[r],((t/TW)|0)-sy[r]/sn[r])*0.15; if (s>fs[r]){ fs[r]=s; flag[r]=t; } }
  // 6. stored: runs over the land tiles in reading order
  const runs: string[]=[]; let cur=-1, len=0;
  for (let t=0;t<NT;t++){ if (!code[t]) continue; const r=regionOf[t]; if (r===cur){ len++; continue; } if (len) runs.push(len>1 ? `${cur.toString(36)}*${len.toString(36)}` : cur.toString(36)); cur=r; len=1; }
  if (len) runs.push(len>1 ? `${cur.toString(36)}*${len.toString(36)}` : cur.toString(36));
  const sizes=[...size.slice(1)].sort((a,b) => a-b);
  console.log(`${id}: ${R-1} regions over ${land} land tiles (A ${A.toFixed(0)}); sizes min ${sizes[0]} median ${sizes[sizes.length>>1]} max ${sizes[sizes.length-1]}; ${runs.join(',').length} chars`);
  return { grid: runs.join(','), names: names.slice(1).join('|'), flags: [...flag.slice(1)].map(f => f.toString(36)).join(',') };
}

const want=process.argv.slice(3);
const out='src/sim/regiondata.ts';
const old: Record<string, { grid: string; names: string; flags: string }> = {};
if (existsSync(out)){ const m=readFileSync(out,'utf8').match(/export const REGION_DATA[^=]*= (\{[\s\S]*\});/); if (m) Object.assign(old,JSON.parse(m[1])); }
for (const id of Object.keys(TARGET)) if (!want.length || want.includes(id)) old[id]=draw(id);
writeFileSync(out,`/* ---------- the regions of the real-world maps, drawn by tools/regions.ts from Natural Earth's provinces (public domain) ----------
   Per map: grid, the region of each land tile in reading order (water skipped), as runs "region*count" (base 36, a lone
   region for a run of one); names, the regions' names (region 1 first); flags, the tile of each region's flag (base 36).
   Generated: do not edit. */
export const REGION_DATA: Record<string, { grid: string; names: string; flags: string }> = ${JSON.stringify(old)};
`);
