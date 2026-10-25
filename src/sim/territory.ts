/* ---------- territory & combat ---------- */
import { TW, NT, PW, PH, TMULT, B_TOWER, B_CASTLE, B_CPART, GOLD_PER_TILE, isStructure } from '../core/constants';
import { W, owner, terr, isLand, frontMark, pType, pOwner, pBurn, type Attack } from './state';
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

export function setOwner(t: number, o: number){
  const prev=owner[t]; if (prev===o) return;
  owner[t]=o;
  if (prev) W.nations[prev].tiles--;
  if (o) W.nations[o].tiles++;
  on.tileChanged(t,o);
  const x=t%TW, y=(t/TW)|0;
  if ((x&3)===2 && (y&3)===2){
    const q=(y>>2)*PW+(x>>2), ty=pType[q];
    if (isStructure(ty) && pOwner[q]!==o && pBurn[q]<=0) ignite(q);
  }
  if (prev){ const Pn=W.nations[prev]; if (t===Pn.capTile) capitalFalls(prev,o); if (Pn.tiles<=0 && Pn.alive) eliminate(prev,o); }
}

function startAttack(a: number, d: number, gold: number){
  for (const A of W.attacks) if (!A.done && A.att===a && A.def===d){ A.gold+=gold; return A; }
  const id=++W.attackSeq, F: number[]=[];
  for (let t=0;t<NT;t++){ if (owner[t]!==d || !isLand[t]) continue; if (touches(t,a)){ F.push(t); frontMark[t]=id; } }
  const A: Attack={ id, att:a, def:d, gold, front:F, done:false };
  W.attacks.push(A); return A;
}
function finishAttack(A: Attack){ if (A.done) return; const n=W.nations[A.att]; if (n.alive) n.gold+=A.gold; A.gold=0; A.done=true; }   // unspent gold goes back
function pushF(A: Attack, t: number){ if (owner[t]===A.def && isLand[t] && frontMark[t]!==A.id){ frontMark[t]=A.id; A.front.push(t); } }

export function stepAttack(A: Attack){
  if (!W.nations[A.att].alive){ A.done=true; return; }
  if (A.def && !W.nations[A.def].alive){ finishAttack(A); return; }
  const F=A.front, srand=W.srand;
  let tries=Math.ceil(2+F.length*0.07);
  while (tries-- > 0){
    if (!F.length){ finishAttack(A); return; }
    const i=(srand()*F.length)|0, t=F[i];
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
