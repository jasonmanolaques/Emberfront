/* ---------- bots ---------- */
import { B_EMPTY, B_RUINS, B_FARM, B_TOWER, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_RESEARCH, B_GUILD, B_SMITHY, B_HOUSE, PW, PH, NP, WAGE } from '../core/constants';
import { W, pType, pOwner, pPrio, pAband, type Nation } from './state';
import { launch } from './territory';
import { grossIncome } from './sim';
import { R_HOUSING, R_TAXES, R_INFANTRY, R_TOWERS, R_CASTLE, R_GATHER, TOPICS, setStudy, maxed } from './research';
import { UNIT_SIZE, units } from './army';
import { STRUCTURES, canAfford, placeProblem, build, togglePriority, anyWithin, isEnemyLand, type Over } from './buildings';
import { plannedWall, wallPlots, townRing, ringOf, wallNeighbours, guardsOpening, standingTower, WALL_MAX } from './fort';
import { allied, atWar, ready, available, declare, intercept, routeOpen, raidTargets, endWar, offerPeace, refusePeace, makePeace, wantsPeace, outlook, warAge, setOffensive, menOn, stalled, defend, defendProblem, reservesOf, reservesProblem, callReserves, F_PUSH, F_HOLD } from './war';

const WALL = -1;   // a tower of the town wall, in a wishlist
const STALE = 1800;   // ticks a war's border may stand still (3 minutes) before a bot thinks of ending it
const LOPSIDED = 2;   // ...when one side has lost this many times the other's dead (and enough have died to tell)
/** Is n losing people to homelessness: a tenth of them or more without a home (on their way to
    begging, and to dying of want)? */
export function beggarProblem(n: Nation){
  const people=n.villagers+n.soldiers+n.beggars;
  return people>=8 && n.homeless>=3 && n.homeless>=people*0.1;
}
/** A beggar problem with no peaceful way out: no open land to settle, and its houses as good as its
    research and builders make them (or two minutes of trying). */
export const stuck = (n: Nation) => beggarProblem(n) && !W.contact[n.id*W.M] && ((maxed(n,R_HOUSING) && n.guilds>0) || W.simTime-n.hungry>120);
/** More homes than people: a house may come down for something the kingdom needs. */
const spareHomes = (n: Nation) => !beggarProblem(n) && (n.abandoned>0 || n.beds>=n.villagers+n.soldiers+n.beggars+3);
/** How many of n's plots stand empty. */
const emptyPlots = (n: Nation) => { let k=0; for (const q of n.plots) if (pType[q]===B_EMPTY || pType[q]===B_RUINS) k++; return k; };
const TOWN = [B_BARRACKS, B_MINTER, B_RESEARCH, B_GUILD, B_SMITHY];   // workshops: inside the wall
/** What a bot would build next, most wanted first. */
function wishlist(n: Nation, exposed: boolean){
  const w: number[]=[], hungry=beggarProblem(n);
  // beggars in the streets: better houses before anything else (a guild's builders raise them, once
  // housing research allows it; a research station to get there)
  if (hungry){
    if (n.tier[R_HOUSING]>=2 && n.guilds<1+(n.tiles/1500|0)) w.push(B_GUILD);
    else if (n.tier[R_HOUSING]<2 && !n.labs && n.tiles>=150) w.push(B_RESEARCH);
  }
  // soldiers left without room in a barracks guard the wall's openings
  let towers=0, outposts=0, gates=0;
  for (const q of n.blds) if (pType[q]===B_TOWER && pOwner[q]===n.id){ towers++; if (!wallNeighbours(q,n.id)) outposts++; else if (guardsOpening(n,q)) gates++; }
  const guards=Math.min(gates*2, n.soldiers>>2);
  if (!n.barracks && n.soldierShare>0) w.push(B_BARRACKS);
  // room in the barracks for the army it keeps (new modules join the old, making one bigger army)
  else if (n.soldiers-guards>n.barracks*UNIT_SIZE-2 && n.barracks<2+(n.tiles/400|0)) w.push(B_BARRACKS);
  // lone towers out on the border facing its neighbours: outposts
  if (exposed && outposts < 1+(n.tiles/900|0)) w.push(B_TOWER);
  // farms bring people faster: none while beggars crowd the streets; with land lying empty, more,
  // grown together into one big farmland
  if (!hungry && n.farms < 1+(n.tiles/600|0)) w.push(B_FARM);
  else if (!n.homeless && n.beds>=n.villagers+n.soldiers && n.plots.length>=20 && n.farms<1+(n.tiles/300|0) && emptyPlots(n)>n.plots.length*0.4) w.push(B_FARM);   // (only while everyone has a home)
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
  // short of homes and of room to build them: the free plots are kept for houses (but for what improves them)
  if (hungry && emptyPlots(n)<n.homeless*2) return w.filter(t => t===B_GUILD || t===B_RESEARCH);
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
    const fit=ring.filter(q => standingTower(q,n.id) || !placeProblem(n,q,B_TOWER,'houses')).length/ring.length;
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
    if (placeProblem(n,q,B_TOWER,'houses')) continue;   // a house in the way of the wall comes down
    const dx=q%PW+0.5-cx, dy=((q/PW)|0)+0.5-cy, L=Math.hypot(dx,dy)||1;
    const s=(wallNeighbours(q,n.id) ? 10 : 0)+8*(dx*tx+dy*ty)/(L*T)-(pType[q]===B_EMPTY || pType[q]===B_RUINS ? 0 : 3)+W.srand()*2;
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
    for (const p of u.plots) for (const q of [p-PW,p+1,p+PW,p-1]) if (q>=0 && q<NP && Math.abs(q%PW-p%PW)<=1 && !placeProblem(n,q,B_BARRACKS,'houses') && (best<0 || d(q)<d(best) || (d(q)===d(best) && q<best))) best=q;
    if (best>=0) return best;
  }
  return -1;
}
/** What a bot's new building of `type` may go over: workshops and towers a house, and anything a
    house while the kingdom has more homes than people; otherwise only bare ground. */
const over = (n: Nation, type: number): Over => TOWN.includes(type) || type===B_TOWER || spareHomes(n) ? 'houses' : 'none';
/** How many of plot q's neighbours (corners counting less) are farms of n's: fields grow together. */
function fieldNeighbours(q: number, id: number){
  const x=q%PW, y=(q/PW)|0; let s=0;
  for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
    if ((!dx && !dy) || x+dx<0 || y+dy<0 || x+dx>=PW || y+dy>=PH) continue;
    const k=q+dy*PW+dx; if (pType[k]===B_FARM && pOwner[k]===id) s+=dx && dy ? 1 : 3;
  }
  return s;
}
/** Picks a plot for `type`: towers go toward enemies; barracks join the biggest barracks; the rest
    gather next to their own kind, near the capital. */
function pickPlot(n: Nation, type: number){
  if (type===B_BARRACKS){ const q=barracksPlot(n); if (q>=0) return q; }
  const srand=W.srand, cap=n.capPlot; let best=-1, bs=-Infinity;
  for (let k=0;k<24 && n.plots.length;k++){
    const q=n.plots[(srand()*n.plots.length)|0];
    // workshops and towers may go over a house where they are wanted (its people build another)
    if (placeProblem(n,q,type,over(n,type)) || plannedWall(n,q)) continue;   // the line of the wall is kept clear
    const d=Math.hypot(q%PW-cap%PW, ((q/PW)|0)-((cap/PW)|0));
    // bare ground first, then an empty house, and a lived-in one last
    let s = (pType[q]===B_EMPTY || pType[q]===B_RUINS ? 0 : pType[q]===B_HOUSE && pAband[q] ? -1 : -6)
      + (type===B_TOWER ? (anyWithin(q,n.id,2,isEnemyLand) ? 20 : 0) - d*0.2
        : type===B_FARM ? -d*0.4 + 4*fieldNeighbours(q,n.id)   // fields together, in one big farmland
        : -d + (sameNeighbour(q,type,n.id) ? 12 : 0));
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
  if (beggarProblem(n) && !maxed(n,R_HOUSING)){ setStudy(n,R_HOUSING); return; }   // room for the beggars first
  const order=exposed ? [R_TOWERS, R_GATHER, R_HOUSING, R_INFANTRY, R_CASTLE, R_TAXES] : [R_GATHER, R_HOUSING, R_INFANTRY, R_TOWERS, R_CASTLE, R_TAXES];
  let best=order[0]; for (const t of order) if (n.tier[t]<n.tier[best]) best=t;
  setStudy(n,best);
}

function botBuild(n: Nation, exposed: boolean){
  botStudy(n,exposed);
  garrisonGates(n);
  n.invest=beggarProblem(n) ? 1 : 0.4+n.expandAt*0.8;   // the builders may spend 58% to 78% of the goods coming in, by temper (all of it, with beggars to house)
  let saving=false;   // threatened and short of a wall tower: lesser works don't get its stone
  for (const type of wishlist(n,exposed)){
    const s=STRUCTURES.find(s=>s.type===(type===WALL ? B_TOWER : type))!;
    if (saving && s.cost[1]>0) continue;
    if (!canAfford(n,s)){ if (type===WALL && danger(n,exposed)) saving=true; continue; }
    if (type===WALL){
      const q=wallPlot(n);
      if (q>=0 && build(n,q,B_TOWER,'houses')){ n.nextWall=W.simTime+(WALL_GAP[danger(n,exposed)]+W.srand()*5)*(n.stock[1]>40 ? 0.5 : 1); return; }   // faster with stone to spare
      // the ring is done (or can't be built further): a new one further out once the town outgrows it,
      // or sooner if this one could hardly be built at all
      const R=townRing(n), ring=wallPlots(n), built=ring.filter(k => standingTower(k,n.id)).length;
      if (q<0 && (R>n.wallR+1 || built<ring.length*0.6) && n.wallR<WALL_MAX) n.wallR=planRing(n,Math.max(R,n.wallR+1));
      else n.nextWall=W.simTime+30;
      continue;
    }
    const q=pickPlot(n,type);
    if (q>=0 && build(n,q,type,over(n,type))) return;
  }
}

/** What stands against an army: soldiers (some of them away or elsewhere), and watchtowers that shoot. */
const defence = (D: Nation) => 0.7*D.soldiers + 2*D.towers + 2;

/** The share of its people a bot wants under arms: few in peace, so it grows; more with a much
    stronger army next door; many at war, and nearly everyone when an enemy far outnumbers it. */
function armyShare(n: Nation){ const want=wantedShare(n); return Math.min(want, affordable(n, want>=0.45)); }
const WAR_CHEST = 90;   // seconds a bot at war spreads its treasury over, paying wages beyond its tax
const WAR_PLAN = 120;   // seconds of a war's extra wages a bot saves up before it starts one
const PLAN_AHEAD = 60;  // seconds before it means to go to war that a bot starts saving (settling less)
/** The treasury a bot wants before it starts a war: two minutes of what an army for it would cost
    beyond its tax (60% of its people under arms, and the tax of the villagers who take them up lost). */
export function warChest(n: Nation){
  const people=n.villagers+n.soldiers; if (!people) return 0;
  const armed=Math.max(n.soldiers, 0.6*people), recruits=armed-n.soldiers;
  const tax=grossIncome(n)*Math.max(0,1-recruits/Math.max(1,n.villagers));
  return Math.max(0,WAGE*armed-tax)*WAR_PLAN;
}
/** Is bot n saving up for a war it means to start soon? Only with an army ready to send, and
    everyone housed: room for its people comes first. */
const saving = (n: Nation) => W.simTime>=n.nextWar-PLAN_AHEAD && n.homeless<=2 && !beggarProblem(n) && ready(n)>=5;
/** The share of its people a bot can pay as soldiers: wages up to 85% of its tax (more while its
    treasury is full, none to spare while it is empty), and at war the treasury too, spent down
    over a minute and a half (tax alone keeps only about a third of a kingdom under arms). */
function affordable(n: Nation, war: boolean){
  const people=n.villagers+n.soldiers+n.beggars; if (!people) return 1;
  const budget=grossIncome(n)*(n.gold<0 ? 0.6 : n.gold>400 ? 1.3 : 0.85) + (war && n.gold>0 ? n.gold/WAR_CHEST : 0);
  return budget/WAGE/people;
}
function wantedShare(n: Nation){
  const M=W.M, id=n.id, peace=0.12+(n.attackAt-0.5)*0.5;   // 12% to 27% by temper
  let enemies=0, war=false, incoming=0;
  for (let o=1;o<M;o++) if (o!==id && (atWar(id,o) || W.aggr[id*M+o] || W.aggr[o*M+id]) && W.nations[o].alive){ war=true; enemies+=W.nations[o].soldiers; }   // (a crisis counts)
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

/** Who stands against a's front on d: d's armies on its own front against a, and d's guard on a's. */
const facing = (a: number, d: number) => { let k=menOn(d,a); const key=a*W.M+d; for (const h of W.humans) if (h.o===d && h.fk===key && h.war<0) k++; return k; };

/** War for a bot: answer peace offers, send armies to hold its border against armies massing on it
    and idle soldiers to meet raiders, call up its militia when its armies on a front are badly
    outnumbered, counter-attack once its land is back (or sue for peace if it can't), bring raids home
    and end wars that go badly, and now and then send its free soldiers against the weakest kingdom in
    reach: an attack if it shares a border (a crisis first), raiding if not. Its personality
    (attackAt) sets how big an edge it wants. */
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
  // armies massing on our border, or on a front against us: about as many of ours on our side of it
  for (let o=1;o<M;o++){
    if (o===id || !W.nations[o].alive || defendProblem(id,o)) continue;
    const theirs=menOn(o,id), mine=menOn(id,o);
    if (!theirs || mine>=theirs*1.2) continue;
    const pool=available(n).sort((x,y) => y.men.length-x.men.length || x.unit.key-y.unit.key), send: number[]=[];
    for (let got=mine, i=0; i<pool.length && got<theirs*1.2; i++){ send.push(pool[i].unit.key); got+=pool[i].men.length; }
    if (send.length) defend(id,o,send);
  }
  // the militia, called up only when our armies on a front are badly outnumbered (they pay no tax and
  // die easily, and called up they are paid); home again once the front is safe
  const out=reservesOf(id);
  for (let o=1;o<M;o++){
    if (o===id || !(W.wars[id*M+o] || W.aggr[id*M+o] || W.aggr[o*M+id])) continue;
    const theirs=facing(id,o), mine=menOn(id,o)-(out && out.d===o ? out.members.length : 0);
    const need = W.wars[id*M+o] ? theirs>mine*1.3 && (W.occCount[id*M+o]>0 || theirs>mine*2) : !!W.aggr[o*M+id] && theirs>(mine+ready(n))*1.5;
    if (!out && need && !reservesProblem(id,o,true)){ callReserves(id,o,true); break; }
    if (out && out.d===o && mine>=theirs*1.2 && !W.occCount[id*M+o]) callReserves(id,o,false);
  }
  // raiders are coming: meet them with about as many idle soldiers, if there are enough to matter
  for (const E of W.campaigns){
    if (E.d!==id || E.phase===2 || !E.hostile || E.target>=0 || !E.raid) continue;
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
  // on the front: a war it started, hold while the line is badly outnumbered by those facing it and
  // attack again once it is not; defending, hold, and strike back once it clearly has the upper hand
  for (let o=1;o<M;o++){
    const st=W.offensive[id*M+o]; if ((st!==F_PUSH && st!==F_HOLD) || !W.wars[id*M+o]) continue;
    const mine=menOn(id,o), theirs=facing(id,o), aggr=!!W.aggr[id*M+o];
    if (st===F_PUSH && mine<theirs*(aggr ? 0.5 : 0.8)) setOffensive(id,o,false);
    else if (st===F_HOLD && mine>=Math.max(3,theirs*(aggr ? 0.8 : 1.3))) setOffensive(id,o,true);
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
  // a war that has stalled, its border hardly moving for minutes while one side bleeds far more than
  // the other (or for twice as long, whatever the dead): no more armies thrown at it, the front holds,
  // the reserves go home, and it offers peace
  for (let o=1;o<M;o++){
    if (o===id || !W.wars[id*M+o] || stalled(id,o)<STALE) continue;
    const lost=W.kills[o*M+id], killed=W.kills[id*M+o];
    if (!(lost+killed>=20 && (lost>killed*LOPSIDED || killed>lost*LOPSIDED)) && stalled(id,o)<STALE*2) continue;
    if (W.offensive[id*M+o]===F_PUSH) setOffensive(id,o,false);
    const out=reservesOf(id); if (out && out.d===o) callReserves(id,o,false);
    if (!W.offers[id*M+o] && W.simTime>=n.nextOffer){ endWar(id,o); n.nextOffer=W.simTime+30; }
  }
  // an attack under way gets the next army as a wave, one at a time, while the war goes its way (not once it has stalled)
  if (W.simTime>=n.nextWave && !dug){
    const front=W.campaigns.find(c => c.a===id && c.front && !c.militia && c.hostile && c.phase===1 && W.wars[id*M+c.d] && W.aggr[id*M+c.d] && stalled(id,c.d)<STALE);   // (a war under way that it started)
    const army=front ? biggest(n) : -1;
    if (front && army>=0 && outlook(n,front.d)>-0.3){ declare(id,front.d,false,[army]); n.nextWave=W.simTime+waveGap(n); }
  }
  // after a campaign it rests a while (the bold less), so a winner digests its gains first
  // beggars it can't house any other way: war is the way out (the dead leave homes behind), so it rests
  // less between wars and takes worse odds
  const desperate=stuck(n);
  if (busy){ n.nextWar=Math.max(n.nextWar, W.simTime+(desperate ? 20 : 50+(0.8-n.attackAt)*150)); return; }
  if (W.simTime<n.nextWar || dug) return;   // badly outnumbered: stay home and hold
  const pool=ready(n); if (pool<5) return;
  if (n.gold<warChest(n)*(desperate ? 0.5 : 1)) return;   // not before there is money to pay for it
  const need=(1.4-(n.attackAt-0.5)*2)*(desperate ? 0.6 : 1);   // 1.4 for the cautious, 0.8 for the bold
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
  const hungry=beggarProblem(n);
  if (!hungry) n.hungry=0; else if (!n.hungry) n.hungry=W.simTime;
  botBuild(n,exposed);
  botWar(n);
  let active=0; for (const A of W.attacks) if (!A.done && A.att===n.id) active++;
  if (active>=2) return;
  // personality: how much gold it lets pile up before settling more land (little, with beggars to find room for)
  // (saving for a war: only what is beyond the war chest)
  const g=n.gold-(saving(n) ? warChest(n) : 0), expandAt=hungry ? 20 : 20+n.expandAt*200;
  if (contact[b]>0 && g>expandAt) launch(n.id,0,g*(hungry ? Math.max(n.ratio,0.6) : n.ratio));
}
