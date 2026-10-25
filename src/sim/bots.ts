/* ---------- bots ---------- */
import { W, type Nation } from './state';
import { launch } from './territory';

export function botThink(n: Nation){
  const srand=W.srand, M=W.M, contact=W.contact;
  n.nextThink=W.simTime+1.1+srand()*2.4;
  let active=0; for (const A of W.attacks) if (!A.done && A.att===n.id) active++;
  if (active>=2) return;
  const fill=n.troops/n.maxTroops, b=n.id*M;
  if (contact[b]>0 && fill>n.expandAt && (srand()<0.8 || fill<n.attackAt)){ launch(n.id,0,n.troops*n.ratio); return; }
  if (fill<n.attackAt) return;
  let best=0, bs=0;
  for (let o=1;o<M;o++){
    if (o===n.id) continue; const c=contact[b+o]; if (!c) continue; const D=W.nations[o]; if (!D.alive) continue;
    const dens=D.troops/Math.max(1,D.tiles), gain=n.troops*n.ratio/((5+1.2*dens)*1.25);
    if (gain<25) continue;
    const sc=gain*(0.6+srand()*0.8)*(1+Math.min(c,300)/300);
    if (sc>bs){ bs=sc; best=o; }
  }
  if (best) launch(n.id,best,n.troops*n.ratio);
}
