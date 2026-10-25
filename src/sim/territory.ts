/* ---------- territory & combat ---------- */
import { TW, NT, PW, PH, TMULT, B_HOUSE, B_MINE, B_TOWER, B_CASTLE, B_CPART } from '../core/constants';
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
export function tileCost(a: number, d: number, t: number){
  const tm=TMULT[terr[t]];
  if (!d) return 4*tm;
  const D=W.nations[d], dens=D.troops/Math.max(1,D.tiles);
  let c=tm*(5+1.2*dens);
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
    if (ty>=B_HOUSE && ty<=B_MINE && pOwner[q]!==o && pBurn[q]<=0) ignite(q);
  }
  if (prev){ const Pn=W.nations[prev]; if (t===Pn.capTile) capitalFalls(prev,o); if (Pn.tiles<=0 && Pn.alive) eliminate(prev,o); }
}

function startAttack(a: number, d: number, troops: number){
  for (const A of W.attacks) if (!A.done && A.att===a && A.def===d){ A.troops+=troops; return A; }
  const id=++W.attackSeq, F: number[]=[];
  for (let t=0;t<NT;t++){ if (owner[t]!==d || !isLand[t]) continue; if (touches(t,a)){ F.push(t); frontMark[t]=id; } }
  const A: Attack={ id, att:a, def:d, troops, front:F, done:false };
  W.attacks.push(A); return A;
}
function finishAttack(A: Attack){ if (A.done) return; const n=W.nations[A.att]; if (n.alive) n.troops+=A.troops; A.troops=0; A.done=true; }
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
    if (A.troops<c){ finishAttack(A); return; }
    A.troops-=c;
    if (A.def){ const D=W.nations[A.def]; D.troops=Math.max(0,D.troops-c*0.35); }
    F[i]=F[F.length-1]; F.pop();
    setOwner(t,A.att);
    if (A.done) return;
    const x=t%TW;
    if (x>0) pushF(A,t-1); if (x<TW-1) pushF(A,t+1); if (t>=TW) pushF(A,t-TW); if (t<NT-TW) pushF(A,t+TW);
  }
}

export function launch(a: number, d: number, troops: number){ const n=W.nations[a]; troops=Math.min(troops,n.troops); if (troops<10) return false; n.troops-=troops; startAttack(a,d,troops); return true; }

function eliminate(id: number, by: number){
  const n=W.nations[id]; n.alive=false; n.troops=0;
  for (const A of W.attacks) if (A.att===id) A.done=true;
  on.eliminated(id,by);
}
function capitalFalls(id: number, by: number){
  const n=W.nations[id]; n.capTile=-1; n.troops*=0.75; const q=n.capPlot;
  for (const k of [q,q+1,q+PW,q+PW+1]) if (pType[k]===B_CASTLE||pType[k]===B_CPART) ignite(k);
  on.capitalFell(id,by);
}
