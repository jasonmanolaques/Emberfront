/* ---------- census: contacts, counts, labels (once per second) ---------- */
import { TW, TH, NP, B_EMPTY, B_HOUSE, B_FARM, B_TOWER, B_MINE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_RESEARCH, B_GUILD, B_SMITHY, B_NAVAL } from '../core/constants';
import { W, owner, occ, isLand, pType, pOwner, pBuild, pCenter, pBurn, pTimer, pTier } from './state';
import { HOUSE_BEDS } from './research';
import { on } from './events';
import { isBld, joinGatherers } from './buildings';

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
}
/** One nation's building tally, built while the count is under way. */
interface Tally { plots: number[]; blds: number[]; houses: number; farms: number; towers: number; mines: number; barracks: number; minters: number; plantations: number; quarries: number; copperMines: number; labs: number; guilds: number; smithies: number; navals: number; beds: number; bCount: number; }
const newTally = (): Tally => ({ plots:[], blds:[], houses:0, farms:0, towers:0, mines:0, barracks:0, minters:0, plantations:0, quarries:0, copperMines:0, labs:0, guilds:0, smithies:0, navals:0, beds:0, bCount:0 });
let tallies: Tally[] = [];
/** The plots from q0 up to (not including) q1: each owner's plots to build on, and its buildings, into the tallies. */
function tally(q0: number, q1: number){
  const N=W.nations;
  for (let q=q0;q<q1;q++){
    const o=owner[pCenter[q]]; if (o && pBuild[q] && !occ[pCenter[q]]) tallies[o].plots.push(q);   // nobody builds on occupied ground
    const ty=pType[q];
    if (ty===B_RUINS){ pTimer[q]-=1; if (pTimer[q]<=0){ pType[q]=B_EMPTY; pOwner[q]=0; on.plotChanged(q); } continue; }
    if (isBld(ty) && pBurn[q]<=0){
      const n=N[pOwner[q]]; if (!n || !n.alive) continue;
      const T=tallies[pOwner[q]];
      T.bCount++; if (ty!==B_CPART && ty!==B_PART) T.blds.push(q);
      if (ty===B_HOUSE){ T.houses++; T.beds+=HOUSE_BEDS[pTier[q]]; } else if (ty===B_FARM) T.farms++; else if (ty===B_TOWER) T.towers++; else if (ty===B_MINE) T.mines++;
      else if (ty===B_BARRACKS) T.barracks++; else if (ty===B_MINTER) T.minters++;
      else if (ty===B_PLANTATION) T.plantations++; else if (ty===B_QUARRY) T.quarries++; else if (ty===B_COPPERMINE) T.copperMines++;
      else if (ty===B_RESEARCH) T.labs++; else if (ty===B_GUILD) T.guilds++; else if (ty===B_SMITHY) T.smithies++; else if (ty===B_NAVAL) T.navals++;
    }
  }
}
/** Counts every kingdom's plots and buildings from scratch, all at once (the start of a match, or when a test needs the counts now). */
export function census(){
  tallies=W.nations.map(() => newTally());
  tally(0,NP);
  commit();
}
/** The same count spread over ten ticks (`k`, 0 to 9, is the tick's place in the ten): a tenth of the plots each, so no one tick pays for
    all of it. The kingdoms' counts are those of the last whole pass. */
export function censusStep(k: number){
  const N=W.nations;
  if (k===0) tallies=N.map(() => newTally());
  else if (tallies.length!==N.length) return;   // (a new match began part way through: wait for the next pass)
  tally(Math.floor(NP*k/10), Math.floor(NP*(k+1)/10));
  if (k===9) commit();
}
/** A whole pass is done: its tallies become the kingdoms' counts, and what follows from them is worked out. */
function commit(){
  const N=W.nations;
  for (let i=1;i<N.length;i++){
    const n=N[i], T=tallies[i];
    [n.plots,T.plots]=[T.plots,n.plots]; [n.blds,T.blds]=[T.blds,n.blds];
    n.houses=T.houses; n.farms=T.farms; n.towers=T.towers; n.mines=T.mines; n.barracks=T.barracks; n.minters=T.minters; n.plantations=T.plantations; n.quarries=T.quarries; n.copperMines=T.copperMines; n.labs=T.labs; n.guilds=T.guilds; n.smithies=T.smithies; n.navals=T.navals; n.beds=T.beds; n.bCount=T.bCount;
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
