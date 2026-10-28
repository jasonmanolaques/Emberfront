/* ---------- census: contacts, counts, labels (once per second) ---------- */
import { TW, TH, NP, B_EMPTY, B_HOUSE, B_FARM, B_TOWER, B_MINE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_RESEARCH, B_GUILD, B_SMITHY } from '../core/constants';
import { W, owner, occ, isLand, resType, resLeft, pType, pOwner, pBuild, pCenter, pBurn, pTimer, pTier } from './state';
import { HOUSE_BEDS } from './research';
import { on } from './events';
import { isBld, joinGatherers } from './buildings';
import { GOOD_OF } from './resources';

/** Counts shared border edges between every pair of nations into W.contact[a*M+b], each kingdom's
    tile sums and what is left to gather on its land, from scratch (at the start of a match: from
    then on setOwner and harvest keep them up to date). */
export function scanContacts(withSums: boolean){
  const N=W.nations, M=W.M, contact=W.contact, land=isLand, own=owner, tw=TW, th=TH;   // (locals: a hot loop over the whole map)
  contact.fill(0);
  const sx=new Float64Array(M), sy=new Float64Array(M);
  for (let y=0;y<th;y++){ let t=y*tw; for (let x=0;x<tw;x++,t++){
    if (!land[t]) continue; const o=own[t];
    if (o){ sx[o]+=x; sy[o]+=y; }
    if (x+1<tw && land[t+1]){ const o2=own[t+1]; if (o2!==o){ contact[o*M+o2]++; contact[o2*M+o]++; } }
    if (y+1<th && land[t+tw]){ const o2=own[t+tw]; if (o2!==o){ contact[o*M+o2]++; contact[o2*M+o]++; } }
  } }
  if (withSums) for (let i=1;i<N.length;i++){ N[i].sumX=sx[i]; N[i].sumY=sy[i]; }
  if (withSums){   // what is left to gather on each kingdom's land
    for (const n of N) n.resHere=[0,0,0];
    const rt=resType, rl=resLeft;
    for (let t=0;t<tw*th;t++){ const o=own[t]; if (o && rl[t]>0) N[o].resHere[GOOD_OF[rt[t]]]++; }
  }
}
export function census(){
  const N=W.nations;
  for (const n of N){ n.plots.length=0; n.blds.length=0; n.houses=n.farms=n.towers=n.mines=n.barracks=n.minters=n.plantations=n.quarries=n.copperMines=n.labs=n.guilds=n.smithies=n.beds=0; n.bCount=0; }
  for (let q=0;q<NP;q++){
    const o=owner[pCenter[q]]; if (o && pBuild[q] && !occ[pCenter[q]]) N[o].plots.push(q);   // nobody builds on occupied ground
    const ty=pType[q];
    if (ty===B_RUINS){ pTimer[q]-=1; if (pTimer[q]<=0){ pType[q]=B_EMPTY; pOwner[q]=0; on.plotChanged(q); } continue; }
    if (isBld(ty) && pBurn[q]<=0){
      const n=N[pOwner[q]]; if (!n || !n.alive) continue;
      n.bCount++; if (ty!==B_CPART && ty!==B_PART) n.blds.push(q);
      if (ty===B_HOUSE){ n.houses++; n.beds+=HOUSE_BEDS[pTier[q]]; } else if (ty===B_FARM) n.farms++; else if (ty===B_TOWER) n.towers++; else if (ty===B_MINE) n.mines++;
      else if (ty===B_BARRACKS) n.barracks++; else if (ty===B_MINTER) n.minters++;
      else if (ty===B_PLANTATION) n.plantations++; else if (ty===B_QUARRY) n.quarries++; else if (ty===B_COPPERMINE) n.copperMines++;
      else if (ty===B_RESEARCH) n.labs++; else if (ty===B_GUILD) n.guilds++; else if (ty===B_SMITHY) n.smithies++;
    }
  }
  for (let i=1;i<N.length;i++) if (N[i].alive) joinGatherers(N[i]);   // what research now lets join up
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
