/* ---------- bots ---------- */
import { B_FARM, B_TOWER, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_RESEARCH, B_GUILD, B_SMITHY, PW, NP } from '../core/constants';
import { W, pType, pOwner, pPrio, type Nation } from './state';
import { launch } from './territory';
import { R_HOUSING, R_TAXES, R_INFANTRY, TOPICS, setStudy, maxed } from './research';
import { UNIT_SIZE, units } from './army';
import { STRUCTURES, canAfford, placeProblem, build, togglePriority, anyWithin, isEnemyLand } from './buildings';
import { allied, atWar, ready, declare, intercept, routeOpen, raidTargets, endWar, offerPeace, refusePeace, makePeace, wantsPeace, outlook, warAge } from './war';

/** What a bot would build next, most wanted first. */
function wishlist(n: Nation, exposed: boolean){
  const w: number[]=[];
  if (!n.barracks && n.soldierShare>0) w.push(B_BARRACKS);
  // room in the barracks for the army it keeps (new modules join the old, making one bigger army)
  else if (n.soldiers>n.barracks*UNIT_SIZE-2 && n.barracks<2+(n.tiles/400|0)) w.push(B_BARRACKS);
  if (exposed && n.towers < 1+(n.tiles/900|0)) w.push(B_TOWER);
  if (n.farms < 1+(n.tiles/600|0)) w.push(B_FARM);
  if (n.minters < 1+(n.tiles/1500|0)) w.push(B_MINTER);
  // learning once the kingdom has found its feet, and a guild to build on what it learns
  if (n.farms && n.tiles>=300 && !TOPICS.every(t => maxed(n,t)) && n.labs < 1+(n.tiles/2500|0)) w.push(B_RESEARCH);
  if (n.tier[R_HOUSING]>=2 && n.guilds < 1+(n.tiles/4000|0)) w.push(B_GUILD);
  if (n.tier[R_INFANTRY]>=2 && n.barracks && n.smithies < 1+(n.barracks/6|0)) w.push(B_SMITHY);
  // a steady supply of whatever the land is poorest in
  const [wood,stone,copper]=n.stock, few=Math.min(wood,stone,copper);
  if (copper===few && n.copperMines < 1+(n.tiles/2000|0)) w.push(B_COPPERMINE);
  if (stone===few && n.quarries < 1+(n.tiles/2000|0)) w.push(B_QUARRY);
  if (wood===few && n.plantations < 1+(n.tiles/2000|0)) w.push(B_PLANTATION);
  return w;
}
const sameNeighbour = (q: number, type: number, id: number) =>
  [q-1,q+1,q-PW,q+PW].some(k => k>=0 && pType[k]===type && pOwner[k]===id);

/** Where a new barracks module goes: beside the biggest barracks, so its army grows (the free
    plot nearest the castle); if it has no room, or there is none yet, anywhere. */
function barracksPlot(n: Nation){
  const U=(units[n.id] ?? []).slice().sort((a,b) => b.plots.length-a.plots.length || a.key-b.key), cap=n.capPlot;
  const d=(q: number) => (q%PW-cap%PW)**2+((q/PW|0)-(cap/PW|0))**2;
  for (const u of U){
    let best=-1;
    for (const p of u.plots) for (const q of [p-PW,p+1,p+PW,p-1]) if (q>=0 && q<NP && Math.abs(q%PW-p%PW)<=1 && !placeProblem(n,q,B_BARRACKS) && (best<0 || d(q)<d(best) || (d(q)===d(best) && q<best))) best=q;
    if (best>=0) return best;
  }
  return -1;
}
/** Picks a plot for `type`: towers go toward enemies; barracks join the biggest barracks; the rest
    gather next to their own kind, near the capital. */
function pickPlot(n: Nation, type: number){
  if (type===B_BARRACKS){ const q=barracksPlot(n); if (q>=0) return q; }
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

/** Bots study whichever topic is furthest behind: housing first, then infantry, then taxation. */
function botStudy(n: Nation){
  let best=R_HOUSING; for (const t of [R_HOUSING, R_INFANTRY, R_TAXES]) if (n.tier[t]<n.tier[best]) best=t;
  setStudy(n,best);
}

function botBuild(n: Nation, exposed: boolean){
  botStudy(n);
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

/** The share of its people a bot wants under arms: few in peace, so it grows; more with a much
    stronger army next door; many at war, and nearly everyone when an enemy far outnumbers it. */
function armyShare(n: Nation){
  const M=W.M, id=n.id, peace=0.12+(n.attackAt-0.5)*0.5;   // 12% to 27% by temper
  let enemies=0, war=false, incoming=0;
  for (let o=1;o<M;o++) if (o!==id && atWar(id,o) && W.nations[o].alive){ war=true; enemies+=W.nations[o].soldiers; }
  for (const c of W.campaigns) if (c.d===id && c.hostile && c.phase<2) incoming+=c.members.length;
  if (!war){
    let worst=0; for (let o=1;o<M;o++) if (o!==id && W.contact[id*M+o] && !allied(id,o) && W.nations[o].alive) worst=Math.max(worst,W.nations[o].soldiers);
    return worst>n.soldiers*1.5+5 ? Math.max(peace,0.35) : peace;
  }
  const odds=(enemies+incoming)/(n.soldiers+2);
  return Math.min(0.85,0.45+0.2*Math.min(2,odds));
}
/** True when the enemies n is at war with field far more soldiers than it does: time to dig in. */
function outnumbered(n: Nation){
  let enemies=0; for (let o=1;o<W.M;o++) if (o!==n.id && atWar(n.id,o)) enemies+=W.nations[o].soldiers;
  return enemies>1.8*(n.soldiers+2);
}

/** War for a bot: answer peace offers, send idle soldiers to meet armies marching on it, counter-
    attack once its land is back (or sue for peace if it can't), bring raids home and end wars that
    go badly, and now and then send its free soldiers against the weakest kingdom in reach: at war
    if it shares a border, raiding if not. Its personality (attackAt) sets how big an edge it wants. */
function botWar(n: Nation){
  const srand=W.srand, M=W.M, id=n.id;
  // raise or stand down the army as the times demand (quickly up, slowly down)
  const want=armyShare(n), d=want-n.soldierShare;
  n.soldierShare=Math.min(1,Math.max(0,n.soldierShare+Math.max(-0.04,Math.min(0.1,d))));
  const dug=outnumbered(n);
  for (let o=1;o<M;o++){
    if (!W.offers[o*M+id]) continue;
    if (wantsPeace(n,o)) makePeace(id,o); else refusePeace(o,id);
  }
  // an army is coming: meet it with about as many idle soldiers, if there are enough to matter
  for (const E of W.campaigns){
    if (E.d!==id || E.phase===2 || !E.hostile || E.target>=0) continue;
    if (W.campaigns.some(c => c.a===id && c.target===E.id && c.phase<2)) continue;
    const idle=ready(n), need=E.members.length;
    if (idle>=3 && idle>=need*(dug ? 1 : 0.6)) intercept(id,E.id,Math.min(idle,need+2));   // outnumbered, only a fair fight
  }
  // our land is back: strike back while the enemy is weak, or make peace
  for (let o=1;o<M;o++){
    if (!W.ready[id*M+o] || !atWar(id,o)) continue;
    W.ready[id*M+o]=0;
    const pool=ready(n);
    if (pool>=5 && !dug && outlook(n,o)>-0.3 && W.contact[id*M+o]) declare(id,o,false,pool);
    else offerPeace(id,o);
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
  if (W.simTime<n.nextWar || dug) return;   // badly outnumbered: stay home and hold
  const pool=ready(n); if (pool<5) return;
  const need=1.4-(n.attackAt-0.5)*2;   // 1.4 for the cautious, 0.8 for the bold
  // a kingdom two armies are already on is left to them
  const beset=new Uint8Array(M); for (const c of W.campaigns) if (c.hostile && c.phase<2) beset[c.d]++;
  let best=0, bs=need, raid=false;
  for (let o=1;o<M;o++){
    const D=W.nations[o]; if (o===id || !D.alive || allied(id,o) || beset[o]>=2) continue;
    const border=W.contact[id*M+o]>0;
    if (!border && Math.hypot(D.ltx-n.ltx,D.lty-n.lty)>110) continue;   // too far to raid
    const s=pool/defence(D)*(border ? 1 : 0.75)*(atWar(id,o) ? 1.4 : 1)*(0.8+srand()*0.4);   // an old enemy first
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
