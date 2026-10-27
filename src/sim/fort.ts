/* ---------- bots' town walls ----------
   A bot fortifies by degrees, so a strong attack doesn't wipe it out at a stroke and an enemy pays
   dearly for every push. Once it has a town worth guarding it plans a wall: a square ring of
   watchtowers round the castle (towers side by side are joined by walls, sim/defense.ts),
   far enough out to enclose most of the town (where the ring runs clear of buildings, water and
   other kingdoms' land), with a gate left open in the middle of each side.
   It raises the towers one at a time, sooner the more danger it is in, those facing its
   neighbours first and each beside the last where it can. Its other buildings keep off the line
   of the wall, the town's workshops gather inside it and its fields outside. When the town has
   outgrown the wall and the ring is done, it plans a new one further out; the old one stays as
   an inner wall.
   Towers at the end of a stretch of wall flank an opening (a gate, or a gap still to be built)
   and call for a garrison; a lone tower out on the border is an outpost and doesn't.
   The bots' side of it is in sim/bots.ts. */
import { PW, PH, B_TOWER, B_HOUSE, B_BARRACKS, B_MINTER, B_RESEARCH, B_GUILD, B_SMITHY, B_SITE } from '../core/constants';
import { pType, pOwner, pBurn, type Nation } from './state';

export const WALL_MIN = 3, WALL_MAX = 8;   // the ring of a town wall, in plots out from the castle
const CORE = [B_HOUSE, B_BARRACKS, B_MINTER, B_RESEARCH, B_GUILD, B_SMITHY, B_SITE];   // what a wall is built to enclose

/** Which ring round n's castle plot q lies on: 1 for the castle's own plots, 2 just outside it, and so on. */
export function ringOf(n: Nation, q: number){
  const cx=n.capPlot%PW, cy=(n.capPlot/PW)|0, x=q%PW, y=(q/PW)|0;
  return Math.max(x<=cx ? cx-x+1 : x-cx, y<=cy ? cy-y+1 : y-cy);
}
/** Is plot q a gate of n's wall: the middle of a side of its ring, left open? */
export function isGate(n: Nation, q: number){
  const cx=n.capPlot%PW, cy=(n.capPlot/PW)|0, x=q%PW, y=(q/PW)|0, R=ringOf(n,q);
  const dx=x<=cx ? cx-x+1 : x-cx, dy=y<=cy ? cy-y+1 : y-cy;
  return (dy===R && dx<R && x===cx) || (dx===R && dy<R && y===cy);
}
/** Is plot q on the line of n's planned wall, kept for a tower? */
export const plannedWall = (n: Nation, q: number) => n.wallR>0 && n.capTile>=0 && ringOf(n,q)===n.wallR && !isGate(n,q);

/** The plots of n's planned wall (or of ring R), gates left out. */
export function wallPlots(n: Nation, R=n.wallR){
  const out: number[]=[]; if (!R || n.capTile<0) return out;
  const cx=n.capPlot%PW, cy=(n.capPlot/PW)|0;
  for (let y=cy-R+1;y<=cy+R;y++) for (let x=cx-R+1;x<=cx+R;x++){
    if (x<0 || y<0 || x>=PW || y>=PH) continue;
    const q=y*PW+x; if (ringOf(n,q)===R && !isGate(n,q)) out.push(q);
  }
  return out;
}
/** The ring that would enclose three quarters of n's town (houses and workshops). */
export function townRing(n: Nation){
  const d=n.blds.filter(q => CORE.includes(pType[q])).map(q => ringOf(n,q)).sort((a,b) => a-b);
  const p=d.length ? d[Math.min(d.length-1,Math.floor(d.length*0.75))] : 1;
  return Math.max(WALL_MIN, Math.min(WALL_MAX, p+1));
}
export const standingTower = (q: number, o: number) => q>=0 && pType[q]===B_TOWER && pOwner[q]===o && pBurn[q]<=0;
/** Towers joined to plot q's tower by walls (its neighbours east, west, north and south). */
export function wallNeighbours(q: number, o: number){
  const x=q%PW, y=(q/PW)|0;
  return +(x>0 && standingTower(q-1,o)) + +(x<PW-1 && standingTower(q+1,o)) + +(y>0 && standingTower(q-PW,o)) + +(y<PH-1 && standingTower(q+PW,o));
}
/** Should n's tower on plot q call for a garrison? It ends a stretch of wall, flanking an opening. */
export const guardsOpening = (n: Nation, q: number) => standingTower(q,n.id) && wallNeighbours(q,n.id)===1;
