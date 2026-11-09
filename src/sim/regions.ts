/* ---------- regions: the provinces the land is divided into ----------
   Every land tile belongs to a region (a real province on the real maps, from tools/regions.ts; a
   region grown at random on a generated map), or to none (islands too small to matter). A kingdom
   that owns more than 60% of a region's land takes it all: the other kingdoms' ground there is
   pushed out (their buildings on it burn), its flag goes up in the region's middle, and nobody else
   can settle any of it. A region with another kingdom's castle in it can't be taken from that kingdom.
   Wars are fought for regions (sim/war.ts): an army that stands in an enemy region alone lowers its
   flag, and once the flag is down the region is occupied (its ground stays its owner's, held by the
   occupier); a peace hands occupied regions over.
   The static map of the regions lives here; what changes in a match (who controls each region, how
   high its flag stands, who occupies it, and how much of it each kingdom owns) lives in W. */
import { TW, TH, NT } from '../core/constants';
import { mulberry32 } from '../core/rng';
import { W, owner, occ, isLand, isle } from './state';
import { VIEWS } from './mapview';
import { DATA, decodeRaw } from './realmap';
import { REGION_DATA } from './regiondata';
import { on } from './events';

export const CONTROL = 0.6;   // share of a region's land a kingdom must own to take the whole of it

export let region = new Uint16Array(NT);   // the region of each tile (0: none)
/** The regions of the map: index 0 is "none". */
export const RG = {
  n: 1,                                   // regions, plus one for "none"
  names: [''] as string[],
  flag: new Int32Array(1),                // the tile of each region's flag
  land: new Int32Array(1),                // land tiles in each region
  start: new Int32Array(2),               // each region's tiles are tiles[start[r] .. start[r+1])
  tiles: new Int32Array(0),
  adj: [[]] as number[][],                // the regions each one borders on land
  isle: new Int32Array(1),                // the landmass each region's flag stands on
};

/* ---------- the map of the regions ---------- */
function decodeGrid(id: string, w: number, h: number){
  const code=decodeRaw(DATA[id],w*h), out=new Uint16Array(w*h), d=REGION_DATA[id];
  if (!d) return { code, out, flags: [] as number[], names: [] as string[] };
  const runs=d.grid.split(','); let ri=0, left=0, cur=0;
  for (let t=0;t<w*h;t++){
    if (!code[t]) continue;
    if (!left){ const s=runs[ri++] ?? '0'; const k=s.indexOf('*'); cur=parseInt(k<0 ? s : s.slice(0,k),36); left=k<0 ? 1 : parseInt(s.slice(k+1),36); }
    out[t]=cur; left--;
  }
  return { code, out, flags: d.flags.split(',').map(s => parseInt(s,36)), names: d.names.split('|') };
}
/** The regions of a real-world map, drawn from its stored grid (a smaller drawing of another map samples that one's). */
function realRegions(id: string){
  const v=VIEWS[id], of=v.of ?? id, big=VIEWS[of], g=decodeGrid(of,big.w,big.h);
  const flags=new Int32Array(g.names.length+1).fill(-1);
  if (!v.of){ region.set(g.out); g.flags.forEach((f,i) => flags[i+1]=f); return { names: g.names, flags }; }
  const sw=big.w, sh=big.h;
  for (let y=0;y<TH;y++) for (let x=0;x<TW;x++){
    const x0=Math.floor(x*sw/TW), x1=Math.max(x0,Math.ceil((x+1)*sw/TW)-1), y0=Math.floor(y*sh/TH), y1=Math.max(y0,Math.ceil((y+1)*sh/TH)-1);
    let r=g.out[((y0+y1)>>1)*sw+((x0+x1)>>1)];
    if (!r) for (let yy=y0;yy<=y1 && !r;yy++) for (let xx=x0;xx<=x1 && !r;xx++) r=g.out[yy*sw+xx];
    region[y*TW+x]=r;
  }
  g.flags.forEach((f,i) => { const x=Math.floor((f%sw)*TW/sw), y=Math.floor(((f/sw)|0)*TH/sh); flags[i+1]=y*TW+x; });
  return { names: g.names, flags };
}
const SYL = ['ar','bel','cor','dan','el','fen','gar','hal','ist','kar','lor','mar','nor','or','pel','quen','ros','sar','tal','ul','var','wen','yr','zan','bre','cal','dor','eth','fal','gil','hen','ith','jor','kel','lun','mer','nal','oss','pra','rin','sel','tor','und','vel'];
const END = ['ia','or','en','um','ar','is','os','ea','an','ys'];
/** Regions grown on a generated map: seeds about one region's size apart on each landmass big enough, each grown out over the land at random. */
function genRegions(seed: number){
  const r=mulberry32(seed^0x51ed270b), A=1100, lt=W.landTiles;
  region.fill(0);
  // the landmasses and their sizes
  const sizes=new Map<number, number>(); for (const t of lt) sizes.set(isle[t],(sizes.get(isle[t]) ?? 0)+1);
  const seeds: number[]=[];
  for (const [i,n] of sizes){
    if (n<A*0.25) continue;
    const k=Math.max(1,Math.round(n/A)), on: number[]=[]; for (const t of lt) if (isle[t]===i) on.push(t);
    // farthest-point seeds: spread out over the landmass
    let s=on[(r()*on.length)|0]; const dmin=new Float64Array(on.length).fill(Infinity), picked=[s];
    while (picked.length<k){ const sx=s%TW, sy=(s/TW)|0; let bi=0, bd=-1; for (let j=0;j<on.length;j++){ const t=on[j], d=(t%TW-sx)**2+(((t/TW)|0)-sy)**2; if (d<dmin[j]) dmin[j]=d; const v=dmin[j]*(0.7+0.6*r()); if (v>bd){ bd=v; bi=j; } } s=on[bi]; picked.push(s); }
    seeds.push(...picked);
  }
  const front: number[]=[];
  seeds.forEach((s,i) => { region[s]=i+1; front.push(s); });
  while (front.length){
    const i=(r()*front.length)|0, t=front[i], x=t%TW, rg=region[t];
    let grew=false;
    for (const k of [x>0?t-1:-1, x<TW-1?t+1:-1, t-TW, t+TW]) if (k>=0 && k<NT && isLand[k] && !region[k]){ region[k]=rg; front.push(k); grew=true; break; }
    if (!grew){ front[i]=front[front.length-1]; front.pop(); }
  }
  const names: string[]=[], used=new Set<string>();
  for (let i=0;i<seeds.length;i++){
    let n='';
    for (let tries=0;tries<20;tries++){ const a=SYL[(r()*SYL.length)|0], b=SYL[(r()*SYL.length)|0], e=END[(r()*END.length)|0]; n=(a+b+e); n=n[0].toUpperCase()+n.slice(1); if (!used.has(n)) break; }
    used.add(n); names.push(n);
  }
  return { names, flags: new Int32Array(seeds.length+1).fill(-1) };
}

/** Draws the regions of the map just made (sim.ts newWorld): `map` a real-world map's id, or 'gen'. */
export function buildRegions(map: string, seed: number){
  if (region.length!==NT) region=new Uint16Array(NT);
  const g=map==='gen' || !VIEWS[map] ? genRegions(seed) : realRegions(map);
  finishRegions(g.names,g.flags);
}
/** Lays regions out by hand (tests): `of(t)` the region of each land tile (0 none), named by `names` (region 1 first). */
export function setRegions(of: (t: number) => number, names: string[]){
  if (region.length!==NT) region=new Uint16Array(NT);
  for (let t=0;t<NT;t++) region[t]=isLand[t] ? of(t) : 0;
  finishRegions(names,new Int32Array(names.length+1).fill(-1));
  resetRegions(W.M);
  for (let t=0;t<NT;t++) if (owner[t]) regionTile(t,0,owner[t]);
}
function finishRegions(names: string[], flags: Int32Array){
  const g={ names, flags };
  const n=g.names.length+1;
  // land the stored grid knew as water (a capital's harbour) joins the region beside it; land tiles that lost theirs (a smaller drawing) too, a step or two out
  { const q: number[]=[]; for (let t=0;t<NT;t++) if (isLand[t] && region[t]) q.push(t);
    const dist=new Uint8Array(NT);
    for (let h=0;h<q.length;h++){ const t=q[h], x=t%TW; if (dist[t]>=3) continue;
      for (const k of [x>0?t-1:-1, x<TW-1?t+1:-1, t-TW, t+TW]) if (k>=0 && k<NT && isLand[k] && !region[k]){ region[k]=region[t]; dist[k]=dist[t]+1; q.push(k); } } }
  for (let t=0;t<NT;t++) if (!isLand[t]) region[t]=0;
  // the tiles of each region, together
  const land=new Int32Array(n); for (let t=0;t<NT;t++) if (region[t]) land[region[t]]++;
  const start=new Int32Array(n+1); for (let r=1;r<n;r++) start[r+1]=start[r]+land[r];
  const tiles=new Int32Array(start[n]), at=start.slice(0,n);
  for (let t=0;t<NT;t++){ const r=region[t]; if (r) tiles[at[r]++]=t; }
  // neighbours on land
  const adj: Set<number>[]=Array.from({ length:n }, () => new Set());
  for (let t=0;t<NT;t++){
    const a=region[t]; if (!a) continue; const x=t%TW;
    for (const k of [x<TW-1 ? t+1 : -1, t+TW<NT ? t+TW : -1]){ if (k<0) continue; const b=region[k]; if (b && b!==a){ adj[a].add(b); adj[b].add(a); } }
  }
  // the flags: the stored one if it lies in the region, else the tile of the region furthest from its edge
  const flag=new Int32Array(n).fill(-1);
  const need: number[]=[];
  for (let r=1;r<n;r++){ const f=g.flags[r] ?? -1; if (f>=0 && f<NT && region[f]===r) flag[r]=f; else if (land[r]) need.push(r); }
  if (need.length){
    const want=new Uint8Array(n); for (const r of need) want[r]=1;
    const dist=new Int32Array(NT).fill(-1), q=new Int32Array(NT); let h=0, m=0;
    for (let t=0;t<NT;t++){ const r=region[t]; if (!r || !want[r]) continue; const x=t%TW;
      let edge=false; for (const k of [x>0?t-1:-1, x<TW-1?t+1:-1, t-TW, t+TW]) if (k<0 || k>=NT || region[k]!==r){ edge=true; break; }
      if (edge){ dist[t]=0; q[m++]=t; } }
    while (h<m){ const c=q[h++], x=c%TW; for (const k of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (k>=0 && k<NT && region[k]===region[c] && dist[k]<0){ dist[k]=dist[c]+1; q[m++]=k; } }
    const best=new Int32Array(n).fill(-1);
    for (let t=0;t<NT;t++){ const r=region[t]; if (r && want[r] && dist[t]>best[r]){ best[r]=dist[t]; flag[r]=t; } }
  }
  RG.n=n; RG.names=['',...g.names]; RG.flag=flag; RG.land=land; RG.start=start; RG.tiles=tiles;
  RG.adj=adj.map(s => [...s].sort((a,b) => a-b));
  RG.isle=new Int32Array(n); for (let r=1;r<n;r++) if (flag[r]>=0) RG.isle[r]=isle[flag[r]];
}

/** Clears who holds what (a new match, or the kingdoms counted again: sim.ts). */
export function resetRegions(M: number){
  const n=RG.n;
  W.rOwner=new Uint8Array(n); W.rFlag=new Float32Array(n); W.rOcc=new Uint8Array(n); W.rCount=new Int32Array(n*M);
  dirty=new Uint8Array(n); dirtyList=[];
}
let dirty=new Uint8Array(1), dirtyList: number[]=[];

/** Tile t went from prev to o (territory.ts setOwner): the counts follow, and its region is looked at again. */
export function regionTile(t: number, prev: number, o: number){
  const r=region[t]; if (!r || !W.rCount.length) return;
  const M=W.M;
  if (prev) W.rCount[r*M+prev]--;
  if (o) W.rCount[r*M+o]++;
  if (!dirty[r]){ dirty[r]=1; dirtyList.push(r); }
}
export const regionName = (r: number) => RG.names[r] ?? '';
/** The kingdom whose castle stands in region r, or 0. */
function castleIn(r: number){
  for (let o=1;o<W.M;o++){ const n=W.nations[o]; if (n?.alive && n.capTile>=0 && region[n.capTile]===r) return o; }
  return 0;
}
/** Each tick: the regions whose ground changed hands are looked at again. One a kingdom now owns more than 60% of is its (the others pushed out). */
export function updateRegions(){
  if (!dirtyList.length) return;
  const list=dirtyList; dirtyList=[];
  for (const r of list){ dirty[r]=0; check(r); }
}
function check(r: number){
  const M=W.M, base=r*M, cur=W.rOwner[r];
  if (cur && W.rCount[base+cur]<=0){ W.rOwner[r]=0; W.rFlag[r]=0; W.rOcc[r]=0; on.regionChanged(r,0,cur); }
  if (W.rOwner[r]) return;   // (a region controlled stays so: it changes hands only whole, by a war, or when its kingdom falls)
  let best=0; for (let o=1;o<M;o++) if (W.rCount[base+o]>RG.land[r]*CONTROL){ best=o; break; }
  if (!best) return;
  const c=castleIn(r); if (c && c!==best) return;   // (another's castle stands in it: that one keeps its hold)
  take(r,best);
}
/** Kingdom o takes region r: all its land is o's (anyone else's there is pushed out, their buildings burn), its flag goes up. */
function take(r: number, o: number){
  const prev=W.rOwner[r];
  W.rOwner[r]=o; W.rFlag[r]=1; W.rOcc[r]=0;
  for (let i=RG.start[r];i<RG.start[r+1];i++){ const t=RG.tiles[i]; if (owner[t]!==o) setOwnerHook(t,o,false); }
  on.regionChanged(r,o,prev);
}
/** Region r goes over to o whole (a peace, or claims given up): its ground is o's, the buildings on it too. */
export function cedeRegion(r: number, o: number){
  freeRegion(r);
  const prev=W.rOwner[r];
  W.rOwner[r]=o; W.rFlag[r]=1; W.rOcc[r]=0;
  for (let i=RG.start[r];i<RG.start[r+1];i++){ const t=RG.tiles[i]; if (owner[t]!==o) setOwnerHook(t,o,true); }
  on.regionChanged(r,o,prev);
}
/** Region r is occupied by a: its owner's ground there is held by a (it pays its owner no tax). */
export function occupyRegion(r: number, a: number){
  const d=W.rOwner[r]; W.rOcc[r]=a; W.rFlag[r]=0;
  for (let i=RG.start[r];i<RG.start[r+1];i++){ const t=RG.tiles[i]; if (owner[t]===d && occ[t]!==a){ if (occ[t]) W.occCount[d*W.M+occ[t]]--; occ[t]=a; W.occCount[d*W.M+a]++; on.occupied(t); } }
  on.regionChanged(r,d,d);
}
/** Region r is free of its occupier again. */
export function freeRegion(r: number){
  const a=W.rOcc[r]; if (!a) return;
  W.rOcc[r]=0;
  for (let i=RG.start[r];i<RG.start[r+1];i++){ const t=RG.tiles[i]; if (occ[t]){ W.occCount[owner[t]*W.M+occ[t]]--; occ[t]=0; on.occupied(t); } }
  on.regionChanged(r,W.rOwner[r],W.rOwner[r]);
}
/** Set by territory.ts (it owns setOwner): kept as a hook so this module needs nothing of it. */
export const regionHooks: { setOwner: (t: number, o: number, keep: boolean) => void } = { setOwner: () => {} };
const setOwnerHook = (t: number, o: number, keep: boolean) => regionHooks.setOwner(t,o,keep);

/** Does o hold region r for a war's purposes: controls it and it is not occupied, or occupies it? */
export const holdsRegion = (o: number, r: number) => (W.rOwner[r]===o && !W.rOcc[r]) || W.rOcc[r]===o;
/** The regions o controls. */
export function regionsOf(o: number){ const out: number[]=[]; for (let r=1;r<RG.n;r++) if (W.rOwner[r]===o) out.push(r); return out; }
/** The pixel the flag of region r stands on. */
export const flagXY = (r: number): [number, number] => { const f=RG.flag[r]; return [(f%TW)*2+1, ((f/TW)|0)*2+1]; };
