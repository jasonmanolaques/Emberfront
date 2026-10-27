/* ---------- fronts: the line an attack is fought along ----------
   An attack is fought on a front: every tile of the defender's free land (not occupied) that
   touches the attacker's ground (its own land, and the defender's land it occupies). The tiles are
   put in order along the line by their bearing from the defender's castle and measured off, so men
   can be spaced evenly along all of it: the attacker's front rank a little behind the line on its
   side, the defender's on the line on its own, and on each side the men the line has no room for in
   ranks behind them, ready to step up. Nothing here changes the world: sim/war.ts moves the men
   and takes the ground. */
import { TW, TH, PW, B_CASTLE, B_CPART } from '../core/constants';
import { W, owner, occ, pType, pOwner, type Human } from './state';

export const MIN_GAP = 2;              // tiles between men of the front rank, shoulder to shoulder
export const RANK_GAP = 2;             // tiles between one rank and the next behind it
export const A_OFF = 2, D_OFF = 0.5;   // tiles from the line's tiles back to the attacker's front rank, and in to the defender's
const STEP_CAP = 3;                    // a break in the line (the sea, a castle) counts as at most this many tiles
const SMOOTH = 3;                      // tiles either way along the line that the way back is averaged over

export interface Front {
  a: number; d: number;
  tiles: number[];                     // the line, in order
  s: Float64Array;                     // how far along the line each one is (tiles, to its middle)
  len: number;                         // the line's length in tiles
  bx: Float32Array; by: Float32Array;  // at each, the way back to the attacker's side (unit)
}

/** Is tile t the attacker's ground in a's war on d: a's own land (unoccupied), or d's land a occupies? */
export const holds = (a: number, d: number, t: number) => (owner[t]===a && !occ[t]) || (owner[t]===d && occ[t]===a);
/** Is tile t part of d's free land (its own, unoccupied)? */
export const freeOf = (d: number, t: number) => owner[t]===d && !occ[t];
/** Is tile t under d's castle (which holds until it is broken)? */
export const underCastle = (d: number, t: number) => { const q=(((t/TW)|0)>>2)*PW+((t%TW)>>2); return (pType[q]===B_CASTLE || pType[q]===B_CPART) && pOwner[q]===d; };
/** The middle of d's castle in tiles, or of its land if it has none. */
export function originOf(d: number): [number, number] {
  const D=W.nations[d];
  return D.capTile>=0 ? [(D.capPlot%PW)*4+4, ((D.capPlot/PW)|0)*4+4] : [D.ltx+0.5, D.lty+0.5];
}

/** Works out the front of a's attack on d. The castle can't be taken, only broken: the line runs
    round it, until the castle stands cut off with no free ground of its own beside it (or is all that
    is left), and then its walls are part of the front too, ringed by men who break it. */
export function lineOf(a: number, d: number): Front {
  const D=W.nations[d], tw=TW, th=TH, own=owner, oc=occ, all: number[]=[];
  const held=(k: number) => (own[k]===a && !oc[k]) || (own[k]===d && oc[k]===a);
  // (only round d's land: every tile of it lies inside its box)
  for (let y=Math.max(0,D.y0);y<=Math.min(th-1,D.y1);y++) for (let x=Math.max(0,D.x0), t=y*tw+x;x<=Math.min(tw-1,D.x1);x++,t++){
    if (own[t]!==d || oc[t]) continue;
    if ((x>0 && held(t-1)) || (x<tw-1 && held(t+1)) || (y>0 && held(t-tw)) || (y<th-1 && held(t+tw))) all.push(t);
  }
  const open=all.filter(t => !underCastle(d,t)), walls=all.filter(t => underCastle(d,t));
  const island=walls.length>0 && D.capTile>=0 && (() => {   // nothing of theirs left beside the castle but the castle
    const q=D.capPlot, x0=(q%PW)*4, y0=((q/PW)|0)*4;
    for (let y=y0-1;y<=y0+8;y++) for (let x=x0-1;x<=x0+8;x++){
      if (x<0 || y<0 || x>=tw || y>=th || (x>=x0 && x<x0+8 && y>=y0 && y<y0+8)) continue;
      if (own[y*tw+x]===d && !oc[y*tw+x]) return false;
    }
    return true;
  })();
  const tiles=!open.length ? all : island ? open.concat(walls) : open;
  const n=tiles.length, F: Front={ a, d, tiles, s:new Float64Array(n), len:0, bx:new Float32Array(n), by:new Float32Array(n) };
  if (!n) return F;
  // put in order along the line: each stretch of it (tiles touching, corners too) is measured from one
  // end to the other the way a man would walk it, and the stretches follow one another across the
  // way the attack goes (from the attacker's castle to the defender's), from its left to its right,
  // so the order stays put as the line moves. A stretch ringing the castle is cut on the attacker's side.
  const [ox,oy]=originOf(d), [ax,ay]=originOf(a), idx=new Map<number, number>(), TAU=Math.PI*2;
  let vx=ox-ax, vy=oy-ay; const vl=Math.hypot(vx,vy); if (vl<1e-6){ vx=1; vy=0; } else { vx/=vl; vy/=vl; }
  tiles.forEach((t,i) => idx.set(t,i));
  const ang=new Float64Array(n), across=new Float64Array(n), toward=new Float64Array(n), from=Math.atan2(-vy,-vx);
  for (let i=0;i<n;i++){
    const t=tiles[i], x=t%tw+0.5, y=((t/tw)|0)+0.5;
    ang[i]=Math.atan2(y-oy,x-ox); across[i]=-(x-ox)*vy+(y-oy)*vx; toward[i]=(x-ox)*vx+(y-oy)*vy;
  }
  const round=(i: number) => { const r=ang[i]-from; return r<0 ? r+TAU : r>=TAU ? r-TAU : r; };   // bearing from the castle, measured round from the attacker's side
  const nbrs=(i: number) => {
    const t=tiles[i], x=t%tw, y=(t/tw)|0, out: number[]=[];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      if ((!dx && !dy) || x+dx<0 || y+dy<0 || x+dx>=tw || y+dy>=th) continue;
      const j=idx.get(t+dy*tw+dx); if (j!==undefined) out.push(j);
    }
    return out;
  };
  // the stretches
  const part=new Int32Array(n).fill(-1), parts: number[][]=[];
  for (let i=0;i<n;i++){
    if (part[i]>=0) continue;
    const L=[i]; part[i]=parts.length;
    for (let k=0;k<L.length;k++) for (const j of nbrs(L[k])) if (part[j]<0){ part[j]=parts.length; L.push(j); }
    parts.push(L);
  }
  // how far along its stretch each tile is, walking from `from` (a diagonal step is √2); with `cut`,
  // never across the line from the castle out through `from` (so a ring is walked one way round).
  // Returns the farthest tile.
  const dist=new Float64Array(n).fill(Infinity), heap: number[]=[];
  const walk=(from: number, cut: boolean) => {
    const L=parts[part[from]]; for (const i of L) dist[i]=Infinity;
    const rel=(i: number) => { let r=ang[i]-ang[from]; if (r>Math.PI) r-=TAU; else if (r<=-Math.PI) r+=TAU; return r; };
    const pop=() => { const top=heap[0], last=heap.pop()!; if (heap.length){ heap[0]=last; let k=0; for (;;){ const l=2*k+1, r=l+1; let m=k; if (l<heap.length && dist[heap[l]]<dist[heap[m]]) m=l; if (r<heap.length && dist[heap[r]]<dist[heap[m]]) m=r; if (m===k) break; [heap[k],heap[m]]=[heap[m],heap[k]]; k=m; } } return top; };
    const add=(i: number) => { heap.push(i); let k=heap.length-1; while (k>0){ const p=(k-1)>>1; if (dist[heap[p]]<=dist[heap[k]]) break; [heap[k],heap[p]]=[heap[p],heap[k]]; k=p; } };
    dist[from]=0; heap.length=0; add(from);
    let far=from;
    while (heap.length){
      const i=pop(), t=tiles[i];
      if (dist[i]>dist[far] || (dist[i]===dist[far] && i<far)) far=i;
      for (const j of nbrs(i)){
        if (cut){ const ri=rel(i), rj=rel(j); if ((ri<0)!==(rj<0) && Math.abs(ri)<Math.PI/2 && Math.abs(rj)<Math.PI/2) continue; }
        const q=tiles[j], w=(q%tw!==t%tw && ((q/tw)|0)!==((t/tw)|0)) ? Math.SQRT2 : 1, nd=dist[i]+w;
        if (nd<dist[j]-1e-9){ dist[j]=nd; add(j); }
      }
    }
    return far;
  };
  const runs=parts.map(L => {
    const r=L.map(round).sort((p,q) => p-q);
    let gap=r[0]+TAU-r[r.length-1]; for (let k=0;k+1<r.length;k++) gap=Math.max(gap,r[k+1]-r[k]);
    let start: number;
    if (L.length>8 && gap<0.6){   // a ring round the castle
      start=L.reduce((b,i) => round(i)<round(b) ? i : b); walk(start,true);
      // (a spur the cut kept the walk from: measured on from where it joins)
      const rest=L.filter(i => dist[i]===Infinity);
      for (let pass=0; rest.length && pass<rest.length; pass++) for (const i of rest) if (dist[i]===Infinity) for (const j of nbrs(i)) if (dist[j]<Infinity) dist[i]=Math.min(dist[i],dist[j]+1);
      for (const i of L) if (dist[i]===Infinity) dist[i]=0;
    }
    else {
      const e1=walk(L[0],false), e2=walk(e1,false);
      // from its left end, across the way the attack goes (or, end on, the one further on)
      start=Math.abs(across[e1]-across[e2])>0.5 ? (across[e1]<across[e2] ? e1 : e2) : (toward[e1]>=toward[e2] ? e1 : e2);
      if (start!==e1) walk(start,false);
    }
    let long=0; for (const i of L) long=Math.max(long,dist[i]);
    return { L, at:across[start], long };
  }).sort((p,q) => p.at-q.at);
  const sv=new Float64Array(n); let offset=0.5;
  for (const run of runs){ for (const i of run.L) sv[i]=offset+dist[i]; offset+=run.long+1+STEP_CAP; }
  const order=Array.from({ length: n }, (_, i) => i).sort((p,q) => sv[p]-sv[q] || tiles[p]-tiles[q]);
  F.tiles=order.map(i => tiles[i]);
  order.forEach((i,k) => { F.s[k]=sv[i]; });
  F.len=F.s[n-1]+0.5;
  const T=F.tiles;
  // the way back: toward the attacker's ground beside each tile, averaged along the line
  const rx=new Float32Array(n), ry=new Float32Array(n);
  for (let i=0;i<n;i++){
    const t=T[i], x=t%tw, y=(t/tw)|0; let vx=0, vy=0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      if ((!dx && !dy) || x+dx<0 || y+dy<0 || x+dx>=tw || y+dy>=th) continue;
      if (held(t+dy*tw+dx)){ const L=Math.hypot(dx,dy); vx+=dx/L; vy+=dy/L; }
    }
    if (!vx && !vy){ vx=x+0.5-ox; vy=y+0.5-oy; }
    const L=Math.hypot(vx,vy)||1; rx[i]=vx/L; ry[i]=vy/L;
  }
  // then square to the line itself, from a few tiles before to a few after (within its stretch, so
  // also at its ends), turned to the side the attacker's ground is on
  const run=new Int32Array(n);
  for (let i=1;i<n;i++) run[i]=F.s[i]-F.s[i-1]>=STEP_CAP-1e-6 ? run[i-1]+1 : run[i-1];
  for (let i=0;i<n;i++){
    let vx=0, vy=0, j0=i, j1=i;
    for (let j=Math.max(0,i-SMOOTH);j<=Math.min(n-1,i+SMOOTH);j++){ if (run[j]!==run[i]) continue; vx+=rx[j]; vy+=ry[j]; j0=Math.min(j0,j); j1=Math.max(j1,j); }
    const a=T[j0], b=T[j1], ux=b%tw-a%tw, uy=((b/tw)|0)-((a/tw)|0), U=Math.hypot(ux,uy);
    if (U>=2){ const s=(-uy*vx+ux*vy)>=0 ? 1 : -1; vx=-uy/U*s; vy=ux/U*s; }   // (along the line, turned a quarter toward the attacker)
    else { const L=Math.hypot(vx,vy); if (L<1e-3){ vx=rx[i]; vy=ry[i]; } else { vx/=L; vy/=L; } }
    F.bx[i]=vx; F.by[i]=vy;
  }
  return F;
}

/** The index of the line's tile at distance u along it (the last one at or before it). */
export function indexAt(F: Front, u: number){
  let lo=0, hi=F.tiles.length-1;
  while (lo<hi){ const m=(lo+hi+1)>>1; if (F.s[m]<=u) lo=m; else hi=m-1; }
  return lo;
}
/** The point on the line at distance u along it, in tiles, and the way back there: [x, y, bx, by]. */
export function pointAt(F: Front, u: number): [number, number, number, number] {
  const T=F.tiles, i=indexAt(F,u), t=T[i], x=t%TW+0.5, y=((t/TW)|0)+0.5;
  if (i+1>=T.length || u<=F.s[i]) return [x, y, F.bx[i], F.by[i]];
  const q=T[i+1], qx=q%TW+0.5, qy=((q/TW)|0)+0.5, step=F.s[i+1]-F.s[i], k=(u-F.s[i])/step;
  if (step>=STEP_CAP-1e-6) return k<0.5 ? [x, y, F.bx[i], F.by[i]] : [qx, qy, F.bx[i+1], F.by[i+1]];   // across a break: the nearer end
  const vx=F.bx[i]+(F.bx[i+1]-F.bx[i])*k, vy=F.by[i]+(F.by[i+1]-F.by[i])*k, L=Math.hypot(vx,vy)||1;
  return [x+(qx-x)*k, y+(qy-y)*k, vx/L, vy/L];
}

/** Where a man stands at distance u along the line, in pixels: `side` 1 for the attacker (behind
    the line on its ground), -1 for the defender (on it, then in toward its castle); `rank` 0 the
    front rank. If the spot is somewhere he can't stand (`ok`, by tile), he stands nearer the line. */
export function placeAt(F: Front, u: number, side: number, rank: number, ok: (t: number) => boolean): [number, number] {
  const [x,y,bx,by]=pointAt(F,u), base=side>0 ? A_OFF : D_OFF;
  for (let off=base+rank*RANK_GAP; off>=0.3; off-=0.5){
    const px=x+side*bx*off, py=y+side*by*off;
    if (px<0 || py<0 || px>=TW || py>=TH) continue;
    if (ok(((py|0)*TW+(px|0)))) return [px*2, py*2];
  }
  return [(x+side*bx*0.3)*2, (y+side*by*0.3)*2];
}

/** How many men a line of F's length takes in its front rank, out of n: one every MIN_GAP tiles at
    most, all of them if there are fewer. */
export const frontRank = (F: Front, n: number) => !n || !F.tiles.length ? 0 : Math.max(1, Math.min(n, Math.round(F.len/MIN_GAP)));

/** Gives `men` their places along front F, on `side`: k of them (frontRank) in the front rank,
    evenly spaced along the whole line, the rest in ranks behind them, as evenly. They keep the order
    along the line they had at the last deployment on this front (`key`); newcomers go in where they
    are nearest the line. In each place the man who held its front rank keeps it if he is still
    there, else the man nearest it steps up. Sets each man's h.fk (key), h.slot (how far along the
    line his place is), h.line (0 the front rank, 1 the rank behind it, …) and h.fx, h.fy (where he
    stands). Returns k. */
export function deploy(F: Front, men: Human[], side: number, key: number, ok: (t: number) => boolean){
  const n=men.length, k=frontRank(F,n);
  if (!k) return 0;
  const T=F.tiles, along=new Map<number, number>();
  for (const h of men){
    if (h.fk===key && h.slot>=0){ along.set(h.id, Math.min(F.len, h.slot)); continue; }
    // a newcomer: where he is nearest the line
    let bi=0, bd=Infinity; const hx=h.x/2, hy=h.y/2;
    for (let i=0;i<T.length;i++){ const t=T[i], e=(t%TW+0.5-hx)**2+(((t/TW)|0)+0.5-hy)**2; if (e<bd){ bd=e; bi=i; } }
    along.set(h.id, F.s[bi]);
  }
  const order=men.slice().sort((p,q) => along.get(p.id)!-along.get(q.id)! || (p.fk===key ? p.line : 99)-(q.fk===key ? q.line : 99) || p.id-q.id);
  const gap=F.len/k;
  for (let i=0, at=0;i<k;i++){
    const size=Math.floor((i+1)*n/k)-Math.floor(i*n/k), group=order.slice(at,at+size); at+=size;
    const u=(i+0.5)*gap, [fx,fy]=placeAt(F,u,side,0,ok);
    // the front rank: whoever held it here, else the nearest; the rest behind him, nearest first
    const dist=(h: Human) => (h.x-fx)**2+(h.y-fy)**2;
    group.sort((p,q) => (p.fk===key && p.line===0 ? 0 : 1)-(q.fk===key && q.line===0 ? 0 : 1) || dist(p)-dist(q) || p.id-q.id);
    // the reserves in ranks behind him: one file, or (more than a few) a block as wide as it is deep
    const files=size<=5 ? 1 : Math.ceil(Math.sqrt(size-1)), [,,bx,by]=pointAt(F,u);
    group.forEach((h,r) => {
      let [x,y]=r ? placeAt(F,u,side,1+((r-1)/files|0),ok) : [fx,fy];
      if (r && files>1){
        const across=((r-1)%files-(files-1)/2)*RANK_GAP*2, nx=x-by*across, ny=y+bx*across;   // (pixels, square to the way back)
        if (nx>=0 && ny>=0 && nx<TW*2 && ny<TH*2 && ok(((ny/2)|0)*TW+((nx/2)|0))){ x=nx; y=ny; }
      }
      h.fk=key; h.slot=u; h.line=r ? 1+((r-1)/files|0) : 0; h.fx=x; h.fy=y;
    });
  }
  return k;
}
