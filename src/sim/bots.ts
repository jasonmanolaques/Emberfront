/* ---------- bots ---------- */
import { B_FARM, B_TOWER, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_RESEARCH, B_GUILD, B_SMITHY, PW, NP, WAGE } from '../core/constants';
import { W, pType, pOwner, pPrio, type Nation } from './state';
import { launch } from './territory';
import { grossIncome } from './sim';
import { R_HOUSING, R_TAXES, R_INFANTRY, R_TOWERS, R_CASTLE, R_GATHER, TOPICS, setStudy, maxed } from './research';
import { UNIT_SIZE, units } from './army';
import { STRUCTURES, canAfford, placeProblem, build, togglePriority, anyWithin, isEnemyLand } from './buildings';
import { plannedWall, wallPlots, townRing, ringOf, wallNeighbours, guardsOpening, standingTower, WALL_MAX } from './fort';
import { allied, atWar, ready, available, declare, intercept, routeOpen, raidTargets, endWar, offerPeace, refusePeace, makePeace, wantsPeace, outlook, warAge } from './war';

const WALL = -1;   // a tower of the town wall, in a wishlist
const TOWN = [B_BARRACKS, B_MINTER, B_RESEARCH, B_GUILD, B_SMITHY];   // workshops: inside the wall
/** What a bot would build next, most wanted first. */
function wishlist(n: Nation, exposed: boolean){
  const w: number[]=[];
  // soldiers left without room in a barracks guard the wall's openings
  let towers=0, outposts=0, gates=0;
  for (const q of n.blds) if (pType[q]===B_TOWER && pOwner[q]===n.id){ towers++; if (!wallNeighbours(q,n.id)) outposts++; else if (guardsOpening(n,q)) gates++; }
  const guards=Math.min(gates*2, n.soldiers>>2);
  if (!n.barracks && n.soldierShare>0) w.push(B_BARRACKS);
  // room in the barracks for the army it keeps (new modules join the old, making one bigger army)
  else if (n.soldiers-guards>n.barracks*UNIT_SIZE-2 && n.barracks<2+(n.tiles/400|0)) w.push(B_BARRACKS);
  // lone towers out on the border facing its neighbours: outposts
  if (exposed && outposts < 1+(n.tiles/900|0)) w.push(B_TOWER);
  if (n.farms < 1+(n.tiles/600|0)) w.push(B_FARM);
  if (wallDue(n,exposed)){
    // a wall is built of stone: quarries to feed it first
    if (n.quarries<3+(n.tiles/1000|0) && n.stock[1]<20) w.push(B_QUARRY);
    w.push(WALL);
  }
  if (n.minters < 1+(n.tiles/1500|0)) w.push(B_MINTER);
  // learning once the kingdom has found its feet, and a guild to build on what it learns
  if (n.farms && n.tiles>=300 && !TOPICS.every(t => maxed(n,t)) && n.labs < 1+(n.tiles/2500|0)) w.push(B_RESEARCH);
  if (n.tier[R_HOUSING]>=2 && n.guilds < 1+(n.tiles/4000|0)) w.push(B_GUILD);
  if (n.tier[R_INFANTRY]>=2 && n.barracks && n.smithies < 1+(n.barracks/6|0)) w.push(B_SMITHY);
  // a steady supply of whatever the land is poorest in
  const [wood,stone,copper]=n.stock, few=Math.min(wood,stone,copper);
  // one plot each, set side by side (pickPlot) so research can join them into bigger ones
  const enough=2+(n.tiles/700|0);
  if (copper===few && n.copperMines < enough) w.push(B_COPPERMINE);
  if (stone===few && n.quarries < enough) w.push(B_QUARRY);
  if (wood===few && n.plantations < enough) w.push(B_PLANTATION);
  return w;
}
/** How much danger a bot sees: 0 nobody next door, 1 neighbours, 2 at war, 3 at war and outnumbered. */
function danger(n: Nation, exposed: boolean){
  let war=false; for (let o=1;o<W.M;o++) if (o!==n.id && atWar(n.id,o)){ war=true; break; }
  return war ? (outnumbered(n) ? 3 : 2) : exposed ? 1 : 0;
}
const WALL_GAP = [45, 24, 10, 6];   // seconds between towers of the wall, by danger
/** Is it time for another tower of the town wall? Planning it first, once the town is worth guarding. */
function wallDue(n: Nation, exposed: boolean){
  if (n.capTile<0 || !n.farms || W.simTime<n.nextWall) return false;
  if (!n.wallR){
    if (n.tiles<(exposed ? 250 : 450) || n.bCount<6) return false;
    n.wallR=planRing(n,townRing(n));
  }
  return true;
}
/** Picks the ring for a town wall, from `from` out: the first where at least 60% of the line can
    hold a tower (free ground of ours, or a tower already), else the one where most can. */
function planRing(n: Nation, from: number){
  let best=from, bf=-1;
  for (let R=from;R<=WALL_MAX;R++){
    const ring=wallPlots(n,R); if (!ring.length) continue;
    const fit=ring.filter(q => standingTower(q,n.id) || !placeProblem(n,q,B_TOWER)).length/ring.length;
    if (fit>=0.6) return R;
    if (fit>bf){ bf=fit; best=R; }
  }
  return best;
}
/** Where the next tower of the wall goes: on the planned ring, beside one already standing where it
    can, facing the neighbours first. -1 if the ring has nowhere left to build. */
function wallPlot(n: Nation){
  const cx=n.capPlot%PW+1, cy=((n.capPlot/PW)|0)+1, M=W.M;   // (the castle's middle, in plots)
  let tx=0, ty=0;
  for (let o=1;o<M;o++){
    const D=W.nations[o]; if (o===n.id || !D.alive || D.capTile<0 || !W.contact[n.id*M+o] || allied(n.id,o)) continue;
    const dx=D.capPlot%PW-cx, dy=((D.capPlot/PW)|0)-cy, L=Math.hypot(dx,dy)||1, k=(atWar(n.id,o) ? 3 : 1)*(D.strength+1)/(n.strength+1);
    tx+=dx/L*k; ty+=dy/L*k;
  }
  const T=Math.hypot(tx,ty)||1;
  let best=-1, bs=-Infinity;
  for (const q of wallPlots(n)){
    if (placeProblem(n,q,B_TOWER)) continue;
    const dx=q%PW+0.5-cx, dy=((q/PW)|0)+0.5-cy, L=Math.hypot(dx,dy)||1;
    const s=(wallNeighbours(q,n.id) ? 10 : 0)+8*(dx*tx+dy*ty)/(L*T)+W.srand()*2;
    if (s>bs){ bs=s; best=q; }
  }
  return best;
}
/** The towers flanking the wall's openings call for a garrison; the rest, outposts included, don't. */
function garrisonGates(n: Nation){
  for (const q of n.blds){
    if (pType[q]!==B_TOWER || pOwner[q]!==n.id) continue;
    const want=n.barracks>0 && guardsOpening(n,q);
    if (!!pPrio[q]!==want) togglePriority(n,q);
  }
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
    if (placeProblem(n,q,type) || plannedWall(n,q)) continue;   // the line of the wall is kept clear
    const d=Math.hypot(q%PW-cap%PW, ((q/PW)|0)-((cap/PW)|0));
    let s = type===B_TOWER ? (anyWithin(q,n.id,2,isEnemyLand) ? 20 : 0) - d*0.2 : -d + (sameNeighbour(q,type,n.id) ? 12 : 0);
    // with a wall planned, a proper town: fields outside it, workshops inside
    if (n.wallR && type!==B_TOWER){ const inside=ringOf(n,q)<n.wallR; s += type===B_FARM ? (inside ? -8 : 6) : TOWN.includes(type) ? (inside ? 8 : -4) : 0; }
    s += srand()*3;
    if (s>bs){ bs=s; best=q; }
  }
  return best;
}

/** Bots study whichever topic is furthest behind: housing first, then infantry, the watchtowers,
    the castle and taxation; a kingdom with enemies on its border puts its towers before its houses. */
function botStudy(n: Nation, exposed: boolean){
  const order=exposed ? [R_TOWERS, R_GATHER, R_HOUSING, R_INFANTRY, R_CASTLE, R_TAXES] : [R_GATHER, R_HOUSING, R_INFANTRY, R_TOWERS, R_CASTLE, R_TAXES];
  let best=order[0]; for (const t of order) if (n.tier[t]<n.tier[best]) best=t;
  setStudy(n,best);
}

function botBuild(n: Nation, exposed: boolean){
  botStudy(n,exposed);
  garrisonGates(n);
  n.invest=0.4+n.expandAt*0.8;   // the builders may spend 58% to 78% of the goods coming in, by temper
  let saving=false;   // threatened and short of a wall tower: lesser works don't get its stone
  for (const type of wishlist(n,exposed)){
    const s=STRUCTURES.find(s=>s.type===(type===WALL ? B_TOWER : type))!;
    if (saving && s.cost[1]>0) continue;
    if (!canAfford(n,s)){ if (type===WALL && danger(n,exposed)) saving=true; continue; }
    if (type===WALL){
      const q=wallPlot(n);
      if (q>=0 && build(n,q,B_TOWER)){ n.nextWall=W.simTime+(WALL_GAP[danger(n,exposed)]+W.srand()*5)*(n.stock[1]>40 ? 0.5 : 1); return; }   // faster with stone to spare
      // the ring is done (or can't be built further): a new one further out once the town outgrows it,
      // or sooner if this one could hardly be built at all
      const R=townRing(n), ring=wallPlots(n), built=ring.filter(k => standingTower(k,n.id)).length;
      if (q<0 && (R>n.wallR+1 || built<ring.length*0.6) && n.wallR<WALL_MAX) n.wallR=planRing(n,Math.max(R,n.wallR+1));
      else n.nextWall=W.simTime+30;
      continue;
    }
    const q=pickPlot(n,type);
    if (q>=0 && build(n,q,type)) return;
  }
}

/** What stands against an army: soldiers (some of them away or elsewhere), and watchtowers that shoot. */
const defence = (D: Nation) => 0.7*D.soldiers + 2*D.towers + 2;

/** The share of its people a bot wants under arms: few in peace, so it grows; more with a much
    stronger army next door; many at war, and nearly everyone when an enemy far outnumbers it. */
function armyShare(n: Nation){ return Math.min(wantedShare(n), affordable(n)); }
/** The share of its people a bot can pay as soldiers: wages up to 85% of its income (more while its
    treasury is full, none to spare while it is empty). */
function affordable(n: Nation){
  const people=n.villagers+n.soldiers+n.beggars; if (!people) return 1;
  const budget=grossIncome(n)*(n.gold<0 ? 0.6 : n.gold>400 ? 1.3 : 0.85);
  return budget/WAGE/people;
}
function wantedShare(n: Nation){
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

const MIN_ARMY = 3;   // bots don't send out an army smaller than this
/** The bot's biggest army at home (as a barracks plot), or -1 if none is worth sending. */
function biggest(n: Nation){
  let best=-1, bk=MIN_ARMY-1;
  for (const a of available(n)) if (a.men.length>bk){ bk=a.men.length; best=a.unit.key; }
  return best;
}
/** Seconds between the armies a bot sends to a war under way: the bold sooner. */
const waveGap = (n: Nation) => 18+(1-n.attackAt)*30+W.srand()*10;

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
    const army=biggest(n);
    if (pool>=5 && army>=0 && !dug && outlook(n,o)>-0.3 && W.contact[id*M+o]){ declare(id,o,false,[army]); n.nextWave=W.simTime+waveGap(n); }
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
  // an attack under way gets the next army as a wave, one at a time, while the war goes its way
  if (W.simTime>=n.nextWave && !dug){
    const front=W.campaigns.find(c => c.a===id && !c.raid && c.target<0 && c.hostile && c.phase===1);
    const army=front ? biggest(n) : -1;
    if (front && army>=0 && outlook(n,front.d)>-0.3){ declare(id,front.d,false,[army]); n.nextWave=W.simTime+waveGap(n); }
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
  // the biggest army goes first (a raid sends just that one); the rest follow in waves
  const army=biggest(n); if (army<0) return;
  declare(id,best,raid,[army]); n.nextWave=W.simTime+waveGap(n);
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
