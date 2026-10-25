/* ---------- census: contacts, counts, labels (once per second) ---------- */
import { TW, TH, NP, B_EMPTY, B_HOUSE, B_FARM, B_TOWER, B_MINE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART } from '../core/constants';
import { W, owner, isLand, pType, pOwner, pBuild, pCenter, pBurn, pTimer } from './state';
import { on } from './events';
import { isBld } from './buildings';

/** Counts shared border edges between every pair of nations into W.contact[a*M+b]. */
export function scanContacts(withSums: boolean){
  const N=W.nations, M=W.M, contact=W.contact;
  contact.fill(0);
  if (withSums) for (const n of N){ n.sumX=0; n.sumY=0; }
  for (let y=0;y<TH;y++){ let t=y*TW; for (let x=0;x<TW;x++,t++){
    if (!isLand[t]) continue; const o=owner[t];
    if (withSums && o){ const n=N[o]; n.sumX+=x; n.sumY+=y; }
    if (x+1<TW && isLand[t+1]){ const o2=owner[t+1]; if (o2!==o){ contact[o*M+o2]++; contact[o2*M+o]++; } }
    if (y+1<TH && isLand[t+TW]){ const o2=owner[t+TW]; if (o2!==o){ contact[o*M+o2]++; contact[o2*M+o]++; } }
  } }
}
export function census(){
  const N=W.nations;
  scanContacts(true);
  for (const n of N){ n.plots.length=0; n.blds.length=0; n.houses=n.farms=n.towers=n.mines=n.barracks=n.minters=n.plantations=n.quarries=n.copperMines=0; n.bCount=0; }
  for (let q=0;q<NP;q++){
    const o=owner[pCenter[q]]; if (o && pBuild[q]) N[o].plots.push(q);
    const ty=pType[q];
    if (ty===B_RUINS){ pTimer[q]-=1; if (pTimer[q]<=0){ pType[q]=B_EMPTY; pOwner[q]=0; on.plotChanged(q); } continue; }
    if (isBld(ty) && pBurn[q]<=0){
      const n=N[pOwner[q]]; if (!n || !n.alive) continue;
      n.bCount++; if (ty!==B_CPART && ty!==B_PART) n.blds.push(q);
      if (ty===B_HOUSE) n.houses++; else if (ty===B_FARM) n.farms++; else if (ty===B_TOWER) n.towers++; else if (ty===B_MINE) n.mines++;
      else if (ty===B_BARRACKS) n.barracks++; else if (ty===B_MINTER) n.minters++;
      else if (ty===B_PLANTATION) n.plantations++; else if (ty===B_QUARRY) n.quarries++; else if (ty===B_COPPERMINE) n.copperMines++;
    }
  }
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive) continue;
    const pct=n.tiles/W.landCount; if (pct>n.peak) n.peak=pct;
    let lx=Math.round(n.sumX/Math.max(1,n.tiles)), ly=Math.round(n.sumY/Math.max(1,n.tiles));
    if (owner[ly*TW+lx]!==n.id){
      let bd=1e9; for (const q of n.plots){ const c=pCenter[q], cx=c%TW, cy=(c/TW)|0, d=(cx-lx)**2+(cy-ly)**2; if (d<bd){ bd=d; n.ltx=cx; n.lty=cy; } }
      if (bd===1e9 && n.capTile>=0){ n.ltx=n.capTile%TW; n.lty=(n.capTile/TW)|0; }
    } else { n.ltx=lx; n.lty=ly; }
  }
}
