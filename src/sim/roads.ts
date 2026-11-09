/* ---------- the ways armies march ----------
   An army's way: the regions it goes through are picked by a search over the region map (a third
   kingdom's regions dearer), then the way is found over the tiles of those regions and their
   neighbours only, and pulled straight (no zigzag from flag to flag, no going back). Water is never a wall: it is dear to cross, and soldiers cross
   it in small boats (a strait, a bay in the way, a way home from an island), so every way exists and
   no army is ever stuck on a shore. */
import { TW, TH, NT, TMULT } from '../core/constants';
import { W, owner, terr, isLand } from './state';
import { RG, region } from './regions';

const WATER_COST = 7;            // a tile of water costs this much (soldiers row across)
const THIRD_COST = 3;            // a third kingdom's ground (neither ours, an ally's nor an enemy's) costs this much more

let gCost=new Float32Array(0), gSeen=new Int32Array(0), gFrom=new Int32Array(0), gSeq=0;
let heap=new Int32Array(0), heapK=new Float32Array(0);
function fit(){ if (gCost.length!==NT){ gCost=new Float32Array(NT); gSeen=new Int32Array(NT); gFrom=new Int32Array(NT); heap=new Int32Array(NT); heapK=new Float32Array(NT); } }

/** The best way over tiles from s to g (A*, a little greedy), within the box, only over the regions of `lane` (water always) if given;
    the ground of a kingdom `o` is neither at war with nor allied to costs more (o 0: no one's ground is dearer). Tiles from s to g, or null. */
function search(o: number, s: number, g: number, x0: number, y0: number, x1: number, y1: number, lane: Uint8Array | null, cap=300000): number[] | null {
  fit();
  const stamp=++gSeq, gx=g%TW, gy=(g/TW)|0, M=W.M;
  const cost=(t: number) => {
    if (!isLand[t]) return WATER_COST;
    let c=TMULT[terr[t]] || 1;
    if (o){ const w=owner[t]; if (w && w!==o && !W.atWar[o*M+w] && !W.ally[o*M+w]) c*=THIRD_COST; }
    return c;
  };
  const h=(t: number) => { const dx=Math.abs(t%TW-gx), dy=Math.abs(((t/TW)|0)-gy); return (dx+dy-0.59*Math.min(dx,dy))*1.3; };
  let n=0;
  const push=(t: number, k: number) => { if (n>=heap.length) return; let i=n++; while (i>0){ const p=(i-1)>>1; if (heapK[p]<=k) break; heap[i]=heap[p]; heapK[i]=heapK[p]; i=p; } heap[i]=t; heapK[i]=k; };
  const pop=() => { const top=heap[0], lt=heap[--n], lk=heapK[n]; let i=0; for (;;){ let c=2*i+1; if (c>=n) break; if (c+1<n && heapK[c+1]<heapK[c]) c++; if (heapK[c]>=lk) break; heap[i]=heap[c]; heapK[i]=heapK[c]; i=c; } heap[i]=lt; heapK[i]=lk; return top; };
  gSeen[s]=stamp; gCost[s]=0; gFrom[s]=-1; push(s,h(s));
  let found=false, steps=0;
  while (n>0 && steps++<cap){
    const c=pop(); if (c===g){ found=true; break; }
    const cx=c%TW, cy=(c/TW)|0, base=gCost[c];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      if (!dx && !dy) continue;
      const nx=cx+dx, ny=cy+dy; if (nx<x0 || ny<y0 || nx>x1 || ny>y1) continue;
      const k=ny*TW+nx;
      if (lane && isLand[k] && !lane[region[k]] && k!==g) continue;
      if (dx && dy && isLand[c]!==isLand[k] && (isLand[cy*TW+nx]!==isLand[k] || isLand[ny*TW+cx]!==isLand[k])) continue;   // (no slipping between land and sea across a corner)
      const ng=base+(cost(k)+cost(c))*0.5*(dx && dy ? 1.414 : 1);
      if (gSeen[k]===stamp && gCost[k]<=ng+1e-3) continue;   // (costs are kept in single precision: a way no better than the one known is no better)
      gSeen[k]=stamp; gCost[k]=ng; gFrom[k]=c; push(k,ng+h(k));
    }
  }
  if (!found) return null;
  const tiles: number[]=[]; for (let t=g; t>=0; t=gFrom[t]) tiles.push(t);
  return tiles.reverse();
}
/** A way from tile s to tile g over the regions of `lane` (and the water), else in the box round the two; a long way the box search can't
    find quickly (across a sea, round a great bay) is found on a coarse grid of 4×4 tiles over the whole map, which always finds one. */
function wayTiles(o: number, s: number, g: number, lane: Uint8Array | null): number[] {
  const sx=s%TW, sy=(s/TW)|0, gx=g%TW, gy=(g/TW)|0;
  for (const [m, useLane, cap] of [[40, true, 120000], [40, false, 60000]] as [number, boolean, number][]){
    if (useLane && !lane) continue;
    const t=search(o,s,g,Math.max(0,Math.min(sx,gx)-m),Math.max(0,Math.min(sy,gy)-m),Math.min(TW-1,Math.max(sx,gx)+m),Math.min(TH-1,Math.max(sy,gy)+m),useLane ? lane : null,cap);
    if (t) return t;
  }
  return coarse(s,g);
}
/** The way from tile s to tile g on blocks of 4×4 tiles (land or water by the tile in the middle of each), as the tiles in the middle of the blocks. */
function coarse(s: number, g: number): number[] {
  fit();
  const BW=Math.ceil(TW/4), BH=Math.ceil(TH/4), mid=(b: number) => Math.min(TH-1,((b/BW)|0)*4+2)*TW+Math.min(TW-1,(b%BW)*4+2);
  const bs=(((s/TW)|0)>>2)*BW+((s%TW)>>2), bg=(((g/TW)|0)>>2)*BW+((g%TW)>>2), gx=bg%BW, gy=(bg/BW)|0;
  const cost=(b: number) => { const t=mid(b); return isLand[t] ? TMULT[terr[t]] || 1 : WATER_COST; };
  const h=(b: number) => { const dx=Math.abs(b%BW-gx), dy=Math.abs(((b/BW)|0)-gy); return (dx+dy-0.59*Math.min(dx,dy))*1.2; };
  const stamp=++gSeq; let n=0;
  const push=(t: number, k: number) => { if (n>=heap.length) return; let i=n++; while (i>0){ const p=(i-1)>>1; if (heapK[p]<=k) break; heap[i]=heap[p]; heapK[i]=heapK[p]; i=p; } heap[i]=t; heapK[i]=k; };
  const pop=() => { const top=heap[0], lt=heap[--n], lk=heapK[n]; let i=0; for (;;){ let c=2*i+1; if (c>=n) break; if (c+1<n && heapK[c+1]<heapK[c]) c++; if (heapK[c]>=lk) break; heap[i]=heap[c]; heapK[i]=heapK[c]; i=c; } heap[i]=lt; heapK[i]=lk; return top; };
  gSeen[bs]=stamp; gCost[bs]=0; gFrom[bs]=-1; push(bs,h(bs));
  let found=false, it=0;
  while (n>0 && it++<2000000){
    const c=pop(); if (c===bg){ found=true; break; }
    const cx=c%BW, cy=(c/BW)|0, base=gCost[c];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      if (!dx && !dy) continue;
      const nx=cx+dx, ny=cy+dy; if (nx<0 || ny<0 || nx>=BW || ny>=BH) continue;
      const k=ny*BW+nx, ng=base+(cost(k)+cost(c))*0.5*(dx && dy ? 1.414 : 1);
      if (gSeen[k]===stamp && gCost[k]<=ng+1e-3) continue;   // (costs are kept in single precision: a way no better than the one known is no better)
      gSeen[k]=stamp; gCost[k]=ng; gFrom[k]=c; push(k,ng+h(k));
    }
  }
  if (!found) return [s,g];
  const blocks: number[]=[]; for (let b=bg; b>=0; b=gFrom[b]) blocks.push(b);
  blocks.reverse();
  const out=[s]; for (let i=1;i<blocks.length-1;i++) out.push(mid(blocks[i])); out.push(g);
  return out;
}

/* ---------- the way of an army ---------- */
/** The region of tile t, or (in none: on the water, a small island) the nearest region within a few tiles. */
function regionNear(t: number){
  if (region[t]) return region[t];
  const x0=t%TW, y0=(t/TW)|0;
  for (let r=1;r<=8;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    const x=x0+dx, y=y0+dy; if (x<0||y<0||x>=TW||y>=TH) continue;
    const k=region[y*TW+x]; if (k) return k;
  }
  return 0;
}
/** The regions kingdom o's army goes through from region a to region b: a search over the region map between flags, a third kingdom's regions dearer; [] if there is no way by land. */
function regionsBetween(o: number, a: number, b: number): number[] {
  const n=RG.n, M=W.M, dist=new Float64Array(n).fill(Infinity), from=new Int32Array(n).fill(-1), done=new Uint8Array(n);
  const fx=(r: number) => RG.flag[r]%TW, fy=(r: number) => (RG.flag[r]/TW)|0;
  dist[a]=0;
  for (;;){
    let u=-1, bd=Infinity; for (let r=1;r<n;r++) if (!done[r] && dist[r]<bd){ bd=dist[r]; u=r; }
    if (u<0 || u===b) break;
    done[u]=1;
    for (const v of RG.adj[u]){
      const w=W.rOwner[v], third=o && w && w!==o && !W.atWar[o*M+w] && !W.ally[o*M+w] ? THIRD_COST : 1;
      const nd=dist[u]+Math.hypot(fx(u)-fx(v),fy(u)-fy(v))*third;
      if (nd<dist[v]){ dist[v]=nd; from[v]=u; }
    }
  }
  if (!isFinite(dist[b])) return [];
  const out: number[]=[]; for (let r=b; r>=0; r=from[r]){ out.push(r); if (r===a) break; }
  return out.reverse();
}
/** The way for kingdom o's army from pixel (sx,sy) to (gx,gy): to the flag of the next region on its route, along the roads from flag to flag, and on to (gx,gy).
    Waypoints in pixels, ending at (gx,gy). Water is crossed where it must be (by boat). */
export function findWay(o: number, sx: number, sy: number, gx: number, gy: number): number[] {
  const s=tileOf(sx,sy), g=tileOf(gx,gy), a=regionNear(s), b=regionNear(g);
  // the regions on the way (a search over the region map), and one search over their tiles and their neighbours' from where it stands to where it goes
  const chain=a && b && a!==b ? regionsBetween(o,a,b) : a && a===b ? [a] : [];
  let lane: Uint8Array | null=null;
  if (chain.length){ lane=new Uint8Array(RG.n); for (const r of chain){ lane[r]=1; for (const q of RG.adj[r]) lane[q]=1; } }
  const tiles=straighten(wayTiles(o,s,g,lane));
  const out: number[]=[];
  for (let i=1;i<tiles.length;i++) out.push((tiles[i]%TW)*2+1, ((tiles[i]/TW)|0)*2+1);
  if (out.length) out.length-=2;   // (the last tile's middle: the goal itself instead)
  out.push(gx,gy);
  return out;
}
/** A way over tiles pulled straight: from each point it goes on to the furthest point after it that a straight line reaches over ground no worse
    (no water where the way had none, nothing rougher than the way crossed there), looking up to 160 tiles ahead: no zigzags, no going back. */
function straighten(tiles: number[]): number[] {
  if (tiles.length<3) return tiles;
  const out=[tiles[0]];
  let i=0;
  while (i<tiles.length-1){
    let best=i+1;
    let wet=false, rough=1;
    for (let j=i+1;j<tiles.length && j<=i+160;j++){
      const t=tiles[j]; if (!isLand[t]) wet=true; else rough=Math.max(rough,TMULT[terr[t]] || 1);
      if (clear(tiles[i],t,wet,rough)) best=j;
    }
    out.push(tiles[best]); i=best;
  }
  return out;
}
/** Does a straight line from tile a to tile b cross only ground the way allows (water only if `wet`, nothing rougher than `rough`)? */
function clear(a: number, b: number, wet: boolean, rough: number){
  const ax=a%TW+0.5, ay=((a/TW)|0)+0.5, bx=b%TW+0.5, by=((b/TW)|0)+0.5, n=Math.ceil(Math.hypot(bx-ax,by-ay)*2);
  for (let k=1;k<n;k++){
    const t=((ay+(by-ay)*k/n)|0)*TW+((ax+(bx-ax)*k/n)|0);
    if (!isLand[t]){ if (!wet) return false; continue; }
    if ((TMULT[terr[t]] || 1)>rough+1e-6) return false;
  }
  return true;
}
const tileOf = (x: number, y: number) => Math.max(0,Math.min(NT-1,((y/2)|0)*TW+((x/2)|0)));
