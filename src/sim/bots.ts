/* ---------- bots ---------- */
import { B_FARM, B_TOWER, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, PW } from '../core/constants';
import { W, pType, pOwner, pPrio, type Nation } from './state';
import { launch } from './territory';
import { STRUCTURES, canAfford, placeProblem, build, togglePriority, anyWithin, isEnemyLand } from './buildings';
import { allied, atWar, available, declare, routeOpen, raidTargets, endWar, refusePeace, makePeace, wantsPeace, outlook, warAge } from './war';

/** What a bot would build next, most wanted first. */
function wishlist(n: Nation, exposed: boolean){
  const w: number[]=[];
  if (!n.barracks && n.soldierShare>0) w.push(B_BARRACKS);
  if (exposed && n.towers < 1+(n.tiles/900|0)) w.push(B_TOWER);
  if (n.farms < 1+(n.tiles/600|0)) w.push(B_FARM);
  if (n.minters < 1+(n.tiles/1500|0)) w.push(B_MINTER);
  // a steady supply of whatever the land is poorest in
  const [wood,stone,copper]=n.stock, few=Math.min(wood,stone,copper);
  if (copper===few && n.copperMines < 1+(n.tiles/2000|0)) w.push(B_COPPERMINE);
  if (stone===few && n.quarries < 1+(n.tiles/2000|0)) w.push(B_QUARRY);
  if (wood===few && n.plantations < 1+(n.tiles/2000|0)) w.push(B_PLANTATION);
  return w;
}
const sameNeighbour = (q: number, type: number, id: number) =>
  [q-1,q+1,q-PW,q+PW].some(k => k>=0 && pType[k]===type && pOwner[k]===id);

/** Picks a plot for `type`: towers go toward enemies; the rest gather next to their own kind, near the capital. */
function pickPlot(n: Nation, type: number){
  const srand=W.srand, cap=n.capPlot; let best=-1, bs=-Infinity;
  for (let k=0;k<24 && n.plots.length;k++){
    const q=n.plots[(srand()*n.plots.length)|0];
    if (placeProblem(n,q,type)) continue;
    const d=Math.hypot(q%PW-cap%PW, ((q/PW)|0)-((cap/PW)|0));
    let s = type===B_TOWER ? (anyWithin(q,n.id,2,isEnemyLand) ? 20 : 0) - d*0.2 : -d + (sameNeighbour(q,type,n.id) ? 12 : 0);
    s += srand()*3;
    if (s>bs){ bs=s; best=q; }
  }
  return best;
}

function botBuild(n: Nation, exposed: boolean){
  for (const type of wishlist(n,exposed)){
    const s=STRUCTURES.find(s=>s.type===type)!;
    if (!canAfford(n,s)) continue;
    const q=pickPlot(n,type);
    if (q>=0 && build(n,q,type)){
      // a tower facing an enemy usually calls for a garrison
      if (type===B_TOWER && n.barracks && anyWithin(q,n.id,2,isEnemyLand) && W.srand()<0.6 && !pPrio[q]) togglePriority(n,q);
      return;
    }
  }
}

/** What stands against an army: soldiers (some of them away or elsewhere), and watchtowers that shoot. */
const defence = (D: Nation) => 0.7*D.soldiers + 2*D.towers + 2;

/** War for a bot: answer peace offers, bring raids home and end wars that go badly, and now and
    then send its free soldiers against the weakest kingdom in reach, at war if it shares a
    border, raiding if not. Its personality (attackAt) sets how big an edge it wants. */
function botWar(n: Nation){
  const srand=W.srand, M=W.M, id=n.id;
  for (let o=1;o<M;o++){
    if (!W.offers[o*M+id]) continue;
    if (wantsPeace(n,o)) makePeace(id,o); else refusePeace(o,id);
  }
  let busy=false;
  for (const c of W.campaigns){
    if (c.a!==id || c.phase===2) continue;
    busy=true;
    const left=c.members.length/c.startSoldiers, age=W.tickN-c.started;
    if (c.raid && (left<0.5 || age>900)) endWar(id,c.d);   // bled too much, or long enough at it
  }
  if (W.simTime>=n.nextOffer) for (let o=1;o<M;o++){
    if (o===id || !atWar(id,o) || W.offers[id*M+o] || warAge(id,o)<300 || outlook(n,o)>-0.4) continue;
    endWar(id,o); n.nextOffer=W.simTime+30;   // losing for a while: raids turn home and wars get a peace offer, at most every 30 s
  }
  // after a campaign it rests a while (the bold less), so a winner digests its gains first
  if (busy){ n.nextWar=Math.max(n.nextWar, W.simTime+50+(0.8-n.attackAt)*150); return; }
  if (W.simTime<n.nextWar) return;
  const pool=available(n).all.length; if (pool<6) return;
  const need=1.4-(n.attackAt-0.5)*2;   // 1.4 for the cautious, 0.8 for the bold
  // a kingdom two armies are already on is left to them
  const beset=new Uint8Array(M); for (const c of W.campaigns) if (c.hostile && c.phase<2) beset[c.d]++;
  let best=0, bs=need, raid=false;
  for (let o=1;o<M;o++){
    const D=W.nations[o]; if (o===id || !D.alive || allied(id,o) || beset[o]>=2) continue;
    const border=W.contact[id*M+o]>0;
    if (!border && Math.hypot(D.ltx-n.ltx,D.lty-n.lty)>110) continue;   // too far to raid
    const s=pool/defence(D)*(border ? 1 : 0.75)*(0.8+srand()*0.4);
    if (s>bs){ bs=s; best=o; raid=!border; }
  }
  if (!best || (raid && (!raidTargets(best).length || !routeOpen(id,best)))) return;
  const send=raid ? Math.max(4,Math.ceil(pool*(0.4+srand()*0.3))) : Math.ceil(pool*(0.7+srand()*0.3));
  declare(id,best,raid,send);
}

export function botThink(n: Nation){
  const srand=W.srand, M=W.M, contact=W.contact;
  n.nextThink=W.simTime+1.1+srand()*2.4;
  const b=n.id*M;
  let exposed=false; for (let o=1;o<M;o++) if (o!==n.id && contact[b+o] && W.nations[o].alive){ exposed=true; break; }
  botBuild(n,exposed);
  botWar(n);
  let active=0; for (const A of W.attacks) if (!A.done && A.att===n.id) active++;
  if (active>=2) return;
  // personality: how much gold it lets pile up before settling more land
  const g=n.gold, expandAt=20+n.expandAt*200;
  if (contact[b]>0 && g>expandAt) launch(n.id,0,g*n.ratio);
}
