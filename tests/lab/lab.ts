// The front lab: builds borders of every shape, sends armies to fight along them, and measures how the men behave.
import { TW, TH, NT, NP, PW, T_GRASS, B_BARRACKS } from '../../src/core/constants';
import { W, owner, occ, isLand, terr, pBuild, pType, type Human, type Nation } from '../../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../../src/sim/sim';
import { listen, on } from '../../src/sim/events';
import { setOwner } from '../../src/sim/territory';
import { census } from '../../src/sim/census';
import { build, plotProblem } from '../../src/sim/buildings';
import { H_SOLDIER, makeHuman, doorOf, switching } from '../../src/sim/population';
import { UNIT_SIZE, buildUnits, station, unitAt } from '../../src/sim/army';
import { declare, defend, inCrisis, CRISIS_TICKS, F_READY, F_PUSH, offensiveFront } from '../../src/sim/war';
import { holds, enemyOf, freeOf } from '../../src/sim/front';

export let TRACE=false; export const trace=(v: boolean)=>{ TRACE=v; };
export const N = (i: number) => W.nations[i];
export const tileOf = (h: { x: number; y: number }) => ((h.y/2)|0)*TW+((h.x/2)|0);

export function world(rivals: number, seed=7){
  newWorld(seed); W.rushUntil=0;
  isLand.fill(1); terr.fill(T_GRASS); pBuild.fill(1);
  W.landTiles=Int32Array.from({ length: NT }, (_, i) => i); W.landCount=NT;
  if (!startMatch((TH/2)*TW+TW/2, rivals)) throw new Error('no spawn');
  for (const n of W.nations.slice(2)){ n.nextThink=1e9; n.nextWar=1e9; }
  listen({ warBegan(){}, armyHome(){}, armyGone(){}, peaceOffered(){}, peaceRefused(){}, peaceMade(){}, allied(){}, allyRefused(){}, allianceBroken(){}, annexed(){}, hit(){}, bldHit(){} });
}
/** Land is given out by `who(x,y)` (0 leaves it unclaimed) over a box about the middle between the two capitals. */
export function shape(who: (x: number, y: number, mx: number, my: number) => number){
  const [ax,ay]=[N(1).capTile%TW,(N(1).capTile/TW)|0], [bx,by]=[N(2).capTile%TW,(N(2).capTile/TW)|0];
  const mx=(ax+bx)/2, my=(ay+by)/2;
  for (let y=Math.round(my-70);y<Math.round(my+70);y++) for (let x=Math.round(mx-110);x<Math.round(mx+110);x++){ const o=who(x,y,mx,my); if (o) setOwner(y*TW+x,o); }
  census();
  return { mx, my };
}
/** k soldiers of n at its castle door, as the army of a barracks beside it. */
export function soldiers(n: Nation, k: number){
  const [x,y]=doorOf(n), out: Human[]=[];
  for (let i=0;i<k;i++){ const h=makeHuman(n,H_SOLDIER,x+(i%5)-2,y+((i/5)|0)*0.5); W.humans.push(h); out.push(h); }
  const m=Math.ceil(k/UNIT_SIZE), cap=n.capPlot, d=(q: number) => (q%PW-cap%PW)**2+((q/PW|0)-(cap/PW|0))**2, mods: number[]=[];
  const stock=n.stock; n.stock=[1000,1000,1000];
  while (mods.length<m){
    const near=mods.length ? mods.flatMap(q => [q-PW,q+1,q+PW,q-1]) : Array.from({ length: NP }, (_, q) => q);
    const q=near.filter(q => q>=0 && q<NP && !mods.includes(q) && !plotProblem(n,q)).sort((a,b) => d(a)-d(b) || a-b)[0];
    if (q===undefined) break;
    build(n,q,B_BARRACKS); mods.push(q);
  }
  n.stock=stock; buildUnits(); const u=unitAt(mods[0])!;
  out.forEach((h,i) => { h.base=u.plots[i%u.plots.length]; });
  station(n, W.humans.filter(h => h.o===n.id), switching);
  const mine=W.humans.filter(h => h.o===n.id); n.soldierShare=Math.max(n.soldierShare, mine.filter(h => h.kind===H_SOLDIER).length/mine.length);
  return out;
}
export const noDraft = (o: number) => { W.humans=W.humans.filter(h => h.o!==o || h.kind===H_SOLDIER); N(o).soldierShare=1; N(o).humanProg=-1e9; N(o).gold=1e6; };

export interface Stat { n: number; sum: number; max: number; }
const stat = (): Stat => ({ n:0, sum:0, max:0 });
const add = (s: Stat, v: number) => { s.n++; s.sum+=v; if (v>s.max) s.max=v; };
export interface Report {
  name: string; ticks: number;
  atkInPlace: number;        // share of attacking front men within PRESENT of their place (averaged over samples, once the push began)
  atkOutside: number;        // share of attacking men standing on the enemy's free ground
  defOutside: number;        // share of defending soldiers (of an army) standing on ground the enemy occupies
  crossings: number;         // times a man's tile went between his side's ground and the enemy's, per man
  fightFar: number;          // share of blows struck more than 4 tiles from the front line
  placeOut: number;          // share of the places given to front men that lie on the enemy's free ground
  clump: number;             // share of front-rank pairs closer than ROOM
  spacingCv: number;         // coefficient of variation of the spacing along the line (front rank)
  gained: number;            // tiles occupied at the end
  defNear: number;           // share of defender soldiers within 6 tiles of the line
  odd: string;
}
/** Runs the war of nation 1 against 2 with the given armies for `ticks` ticks and reports. */
export function fight(name: string, A: number, D: number, ticks=3000, opt: { aOrder?: boolean } = {}): Report {
  const atk=soldiers(N(1),A), def=D>0 ? soldiers(N(2),D) : [];
  noDraft(1); noDraft(2); tick();
  declare(1,2,A);
  if (D>0) defend(2,1,D);
  const t0=W.tickN;
  for (let i=0;i<4000 && W.offensive[1*W.M+2]!==F_READY && !(W.wars[1*W.M+2]);i++) tick();
  if (inCrisis(1,2)) W.crisisAt[1*W.M+2]-=CRISIS_TICKS;
  queueCommand({ type:'offensive', nation:1, target:2, go:true }); tick();
  const blows: number[]=[];
  listen({ swing: (a: number, b: number) => { const h=W.humans.find(x => x.id===a), e=W.humans.find(x => x.id===b); if (h && e) blows.push(distToLine((h.x+e.x)/4,(h.y+e.y)/4)); } } as never);
  let maxOcc=0, placeOut=0, placeN=0, samples=0, inPlace=0, atkOut=0, defOut=0, clump=0, clumpN=0, defNear=0, defNearN=0, inPlaceN=0, outN=0, defOutN=0;
  const trace: string[]=[]; (globalThis as any).__trace=0; const tr={ id:0, lines: [] as string[] }; const why: Record<string, number>={}; const cv: number[]=[]; const last=new Map<number, number>(); let cross=0;
  for (let i=0;i<ticks;i++){
    tick();
    if (i%10) continue;
    const F=offensiveFront(1,2)?.F; if (!F || !F.tiles.length) continue;
    curLine=F.tiles;
    samples++; { let oc=0; for (let t=0;t<NT;t++) if (occ[t]===1) oc++; if (oc>maxOcc) maxOcc=oc; }
    const A1=W.humans.filter(h => h.o===1 && h.kind===H_SOLDIER && h.war>=0 && h.hp>0);
    const front=A1.filter(h => h.fk>=0);
    for (const h of front){
      placeN++; if (enemyOf(1,2,((h.fy/2)|0)*TW+((h.fx/2)|0))) placeOut++;
      inPlaceN++; if ((h.x-h.fx)**2+(h.y-h.fy)**2<=36) inPlace++;
      const t=tileOf(h); outN++; if (enemyOf(1,2,t)){ atkOut++; if (TRACE){ if (!tr.id) tr.id=h.id; if (tr.id===h.id) tr.lines.push(`t${i} pos ${(h.x/2).toFixed(1)},${(h.y/2).toFixed(1)} place ${(h.fx/2).toFixed(1)},${(h.fy/2).toFixed(1)} foe ${h.foe} line ${h.line} own ${owner[t]} occ ${occ[t]} hp ${h.hp.toFixed(1)} duel ${h.duel} aim ${h.aim}`); } if (!(globalThis as any).__trace){ (globalThis as any).__trace=h.id; } if ((globalThis as any).__trace===h.id) trace.push(`t${i} pos ${h.x.toFixed(1)},${h.y.toFixed(1)} place ${h.fx.toFixed(1)},${h.fy.toFixed(1)} foe ${h.foe} line ${h.line} ownerTile ${owner[t]} occ ${occ[t]} hp ${h.hp.toFixed(1)} cool ${h.cool} duel ${h.duel}`); const away=Math.hypot(h.x-h.fx,h.y-h.fy); const wasSt=last.get(h.id); const placeHeld=holds(1,2,((h.fy/2)|0)*TW+((h.fx/2)|0)); const key=(h.foe>=0 ? 'foe' : 'nofoe')+(away>3 ? '+away' : '+atPlace')+(placeHeld ? '+placeHeld' : '+placeNotHeld')+(wasSt===2 ? '+wasOutBefore' : wasSt===1 ? '+wasInBefore' : ''); why[key]=(why[key]||0)+1; }
      const st=holds(1,2,t) ? 1 : enemyOf(1,2,t) ? 2 : 0, was=last.get(h.id);
      if (was!==undefined && st && was && st!==was) cross++; if (st) last.set(h.id,st);
    }
    const D1=W.humans.filter(h => h.o===2 && h.kind===H_SOLDIER && h.hp>0 && h.war>=0);
    for (const h of D1){ defOutN++; if (occ[tileOf(h)]===1) defOut++; }
    const D2=W.humans.filter(h => h.o===2 && h.kind===H_SOLDIER && h.hp>0);
    for (const h of D2){ defNearN++; if (distToLine(h.x/2,h.y/2)<=6) defNear++; }
    // clumping in the front rank, and its spacing along the line
    const rank=front.filter(h => h.line===0).sort((p,q) => p.slot-q.slot);
    for (let a=0;a<rank.length;a++) for (let b=a+1;b<rank.length;b++){ clumpN++; if (Math.hypot(rank[a].x-rank[b].x,rank[a].y-rank[b].y)<2.4) clump++; }
    if (rank.length>2){ const gaps=rank.slice(1).map((h,k) => h.slot-rank[k].slot), m=gaps.reduce((s,v) => s+v,0)/gaps.length; if (m>0) cv.push(Math.sqrt(gaps.reduce((s,v) => s+(v-m)**2,0)/gaps.length)/m); }
  }
  const occN=maxOcc; const ended=N(2).alive ? '' : ' ANNEXED';
  const far=blows.filter(d => d>4).length;
  return { name, ticks, placeOut:placeOut/Math.max(1,placeN), atkInPlace:inPlace/Math.max(1,inPlaceN), atkOutside:atkOut/Math.max(1,outN), defOutside:defOut/Math.max(1,defOutN), crossings:cross/Math.max(1,A), fightFar:far/Math.max(1,blows.length), clump:clump/Math.max(1,clumpN), spacingCv: cv.length ? cv.reduce((s,v) => s+v,0)/cv.length : 0, gained:occN, defNear:defNear/Math.max(1,defNearN), odd:`blows ${blows.length}${ended}`+(TRACE ? '\n'+tr.lines.slice(0,40).join('\n') : '') };
}
let curLine: number[]=[];
/** Distance in tiles from a point (tile coordinates) to the nearest tile of the front line. */
function distToLine(x: number, y: number){ let best=Infinity; const T=curLine, step=Math.max(1,T.length>>8); for (let k=0;k<T.length;k+=step){ const e=Math.hypot(T[k]%TW+0.5-x,((T[k]/TW)|0)+0.5-y); if (e<best) best=e; } return best; }
export const fmt = (r: Report) => `${r.name.padEnd(26)} inPlace ${(r.atkInPlace*100).toFixed(0).padStart(3)}%  atkOutside ${(r.atkOutside*100).toFixed(1).padStart(5)}% placeOut ${(r.placeOut*100).toFixed(1).padStart(5)}%  defInZone ${(r.defOutside*100).toFixed(1).padStart(5)}%  cross/man ${r.crossings.toFixed(1).padStart(5)}  blowsFar ${(r.fightFar*100).toFixed(0).padStart(3)}%  clump ${(r.clump*100).toFixed(1).padStart(5)}%  cv ${r.spacingCv.toFixed(2)}  defNear ${(r.defNear*100).toFixed(0).padStart(3)}%  gained ${String(r.gained).padStart(5)} ${r.odd}`;
