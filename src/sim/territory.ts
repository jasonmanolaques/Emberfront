/* ---------- territory & combat ---------- */
import { TW, TH, NT, PW, PH, TMULT, B_TOWER, B_CASTLE, B_CPART, GOLD_PER_TILE, isStructure } from '../core/constants';
import { W, owner, occ, terr, isLand, isle, frontMark, pType, pOwner, pBurn, type Attack } from './state';
import { on } from './events';
import { ignite } from './buildings';

export function touches(t: number, a: number){ const x=t%TW; return (x>0&&owner[t-1]===a)||(x<TW-1&&owner[t+1]===a)||(t>=TW&&owner[t-TW]===a)||(t<NT-TW&&owner[t+TW]===a); }
function nCount(t: number, a: number){ const x=t%TW; return +(x>0&&owner[t-1]===a)+ +(x<TW-1&&owner[t+1]===a)+ +(t>=TW&&owner[t-TW]===a)+ +(t<NT-TW&&owner[t+TW]===a); }

export function towerCover(d: number, t: number){
  const px=(t%TW)>>2, py=((t/TW)|0)>>2;
  for (let y=Math.max(0,py-2);y<=Math.min(PH-1,py+2);y++) for (let x=Math.max(0,px-2);x<=Math.min(PW-1,px+2);x++){
    const q=y*PW+x; if (pType[q]===B_TOWER && pOwner[q]===d && pBurn[q]<=0) return true; }
  return false;
}
/** Gold it costs nation a to take tile t from d. Unclaimed land is a flat price; another
    kingdom's land is dearer the stronger that kingdom is for its size, and near its watchtowers. */
export function tileCost(a: number, d: number, t: number){
  if (!d) return GOLD_PER_TILE;
  const D=W.nations[d], dens=D.strength/Math.max(1,D.tiles);
  let c=TMULT[terr[t]]*(1+0.5*dens);
  if (towerCover(d,t)) c*=1.5;
  return c;
}

/** Keeps the shared border counts (W.contact) up to date as tile t goes from prev to o: each land
    edge to a neighbour of another owner counts once for that pair. */
function recountEdges(t: number, prev: number, o: number){
  const M=W.M, C=W.contact, x=t%TW;
  const edge=(k: number) => {
    if (!isLand[k]) return; const n=owner[k];
    if (n!==prev){ C[prev*M+n]--; C[n*M+prev]--; }
    if (n!==o){ C[o*M+n]++; C[n*M+o]++; }
  };
  if (!isLand[t]) return;
  if (x>0) edge(t-1); if (x<TW-1) edge(t+1); if (t>=TW) edge(t-TW); if (t<NT-TW) edge(t+TW);
}
export function setOwner(t: number, o: number){
  const prev=owner[t]; if (prev===o) return;
  if (occ[t]){ W.occCount[prev*W.M+occ[t]]--; occ[t]=0; }   // changing hands ends any occupation
  recountEdges(t,prev,o);
  owner[t]=o;
  if (W.isleOwn.length && isLand[t]){ const i=isle[t]*W.M; W.isleOwn[i+prev]--; W.isleOwn[i+o]++; }   // (the tiles each kingdom has on each landmass)
  const x=t%TW, y=(t/TW)|0;
  if (prev){ const P=W.nations[prev]; P.tiles--; P.sumX-=x; P.sumY-=y; }
  if (o){ const n=W.nations[o]; n.tiles++; n.sumX+=x; n.sumY+=y; if (x<n.x0) n.x0=x; if (x>n.x1) n.x1=x; if (y<n.y0) n.y0=y; if (y>n.y1) n.y1=y;  }   // (contacts and sums are kept exact as tiles change: no scan of the map)
  on.tileChanged(t,o);
  if ((x&3)===2 && (y&3)===2){
    const q=(y>>2)*PW+(x>>2), ty=pType[q];
    if (isStructure(ty) && pOwner[q]!==o && pBurn[q]<=0) ignite(q);
  }
  if (prev){ const Pn=W.nations[prev]; if (t===Pn.capTile) capitalFalls(prev,o); if (Pn.tiles<=0 && Pn.alive) eliminate(prev,o); }
}

function startAttack(a: number, d: number, gold: number, onIsle=0, seed=-1){
  for (const A of W.attacks) if (!A.done && A.att===a && A.def===d && (A.isle ?? 0)===onIsle && (A.seed ?? -1)===seed){ A.gold+=gold; return A; }
  const id=++W.attackSeq, F: number[]=[], A0=W.nations[a];
  // the front: d's land touching a's, looked for only round a's land
  const x0=Math.max(0,A0.x0-1), x1=Math.min(TW-1,A0.x1+1), y0=Math.max(0,A0.y0-1), y1=Math.min(TH-1,A0.y1+1);
  if (seed>=0){ const x=seed%TW; for (const t of [x>0 ? seed-1 : -1, x<TW-1 ? seed+1 : -1, seed>=TW ? seed-TW : -1, seed<NT-TW ? seed+TW : -1]) if (t>=0 && owner[t]===d && isLand[t]){ F.push(t); frontMark[t]=id; } }   // (a landing: it spreads from that tile only)
  else for (let y=y0;y<=y1;y++) for (let t=y*TW+x0, e=y*TW+x1;t<=e;t++){ if (owner[t]!==d || !isLand[t] || (onIsle && isle[t]!==onIsle)) continue; if (touches(t,a)){ F.push(t); frontMark[t]=id; } }
  const A: Attack={ id, att:a, def:d, gold, front:F, done:false }; if (onIsle) A.isle=onIsle; if (seed>=0) A.seed=seed;
  W.attacks.push(A); return A;
}
function finishAttack(A: Attack){ if (A.done) return; const n=W.nations[A.att]; if (n.alive) n.gold+=A.gold; A.gold=0; A.done=true; }   // unspent gold goes back
function pushF(A: Attack, t: number){ if (owner[t]===A.def && isLand[t] && frontMark[t]!==A.id && (!A.isle || isle[t]===A.isle)){ frontMark[t]=A.id; A.front.push(t); } }

export function stepAttack(A: Attack){
  if (!W.nations[A.att].alive){ A.done=true; return; }
  if (A.def && !W.nations[A.def].alive){ finishAttack(A); return; }
  const F=A.front, srand=W.srand;
  let tries=Math.ceil(2+F.length*0.07);
  while (tries-- > 0){
    if (!F.length){ finishAttack(A); return; }
    // the front takes a tile at random, those with more of the border about them a little sooner: ground the border has wound round fills in as it goes, rather than staying empty
    let i=(srand()*F.length)|0, k=nCount(F[i],A.att);
    for (let r=0;r<4;r++){ const j=(srand()*F.length)|0, kj=nCount(F[j],A.att); if (kj>k){ i=j; k=kj; } }
    const t=F[i];
    if (owner[t]!==A.def || !touches(t,A.att)){ F[i]=F[F.length-1]; F.pop(); frontMark[t]=0; continue; }
    const tm=TMULT[terr[t]];
    if (tm>1.05 && srand()>1.15/tm) continue;           // rough terrain slows the front
    if (nCount(t,A.att)===1 && srand()<0.45) continue;   // keeps fronts rounded instead of spiky
    const c=tileCost(A.att,A.def,t);
    if (A.gold<c){ finishAttack(A); return; }
    A.gold-=c;
    if (A.def){ const D=W.nations[A.def]; D.gold=Math.max(0,D.gold-c*0.35); }   // war drains the defender's treasury too
    F[i]=F[F.length-1]; F.pop();
    setOwner(t,A.att);
    if (A.done) return;
    const x=t%TW;
    if (x>0) pushF(A,t-1); if (x<TW-1) pushF(A,t+1); if (t>=TW) pushF(A,t-TW); if (t<NT-TW) pushF(A,t+TW);
  }
}

/** A landing's gold, already paid, spent spreading the border from tile `seed` of landmass `onIsle`. */
export function launchOn(a: number, gold: number, onIsle: number, seed: number){ startAttack(a,0,gold,onIsle,seed); }
/** Sends `gold` from nation a's treasury to push its border into d's land (0 = unclaimed). */
export function launch(a: number, d: number, gold: number){ const n=W.nations[a]; gold=Math.min(gold,n.gold); if (gold<GOLD_PER_TILE*2) return false; n.gold-=gold; startAttack(a,d,gold); return true; }

function eliminate(id: number, by: number){
  const n=W.nations[id]; n.alive=false; n.gold=0;
  for (const A of W.attacks) if (A.att===id) A.done=true;
  on.eliminated(id,by);
}
function capitalFalls(id: number, by: number){
  const n=W.nations[id]; n.capTile=-1; n.gold*=0.75; const q=n.capPlot;   // the treasury is plundered
  for (const k of [q,q+1,q+PW,q+PW+1]) if (pType[k]===B_CASTLE||pType[k]===B_CPART) ignite(k);
  on.capitalFell(id,by);
}
