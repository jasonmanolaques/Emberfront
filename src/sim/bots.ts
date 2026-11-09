/* ---------- bots ---------- */
import { B_EMPTY, B_RUINS, B_FARM, B_TOWER, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_RESEARCH, B_GUILD, B_SMITHY, B_HOSPITAL, B_CARPENTER, B_HOUSE, B_ARCHERY, PW, PH, NP, WAGE } from '../core/constants';
import { W, isle, pType, pOwner, pAband, type Nation } from './state';
import { launch } from './territory';
import { grossIncome } from './sim';
import { R_HOUSING, R_TAXES, R_INFANTRY, R_TOWERS, R_CASTLE, R_GATHER, R_MEDICS, TOPICS, MAX_TIER, setStudy, maxed, hasMedics } from './research';
import { UNIT_SIZE, units } from './army';
import { STRUCTURES, GATHERERS, canAfford, costFor, placeProblem, build, anyWithin, isEnemyLand, structureOf, fortTier, fortProblem, buildFort, type Over } from './buildings';
import { plannedWall, wallPlots, townRing, ringOf, wallNeighbours, standingTower, WALL_MIN, WALL_MAX } from './fort';
import { waiting, FORT_UPKEEP } from './war';
import { allied, atWar, ready, endWar, refusePeace, acceptPeace, giveGoals, setClaims, P_GOALS, P_WHITE, wantsPeace, outlook, warAge, claim, claimable, claimsOf, attackerIn, began, besideHeld, armyOrder, armyProblem, armyMembers, armyOf, MAX_CLAIMS, A_HOME, A_HOLD, A_BATTLE, O_ATTACK, O_DEFEND, O_NONE, O_RETREAT } from './war';
import { RG, flagXY, holdsRegion, region } from './regions';
import type { Army } from './state';

const WALL = -1;   // a tower of the town wall, in a wishlist
const STALE = 1800;   // ticks a war's border may stand still (3 minutes) before a bot thinks of ending it
const STUCK = 600;   // ticks an attack may make no headway (a minute) before a bot pulls back to the border to mass a second wave
const MASS_WAIT = 1500;   // ...and the longest it waits there for the recruits
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
const TOWN = [B_BARRACKS, B_ARCHERY, B_MINTER, B_RESEARCH, B_GUILD, B_SMITHY, B_HOSPITAL, B_CARPENTER];   // workshops: inside the wall
/** What a bot builds before anything else, while it has too few: the stockpile only comes from the
    gathering buildings, so wood first (a plantation pays for itself in 2 and a half minutes), then
    stone and copper, and a research station to join them into bigger ones. It saves up for these. */
function groundwork(n: Nation){
  // the gatherers still short of their goal, the one whose good the stockpile is lowest in first (wood is what most is built of), so that
  // none is left for ever behind the others by the goods they take
  const want: [number, number, number, number][]=[[B_PLANTATION, n.plantations, 5+(n.tiles/900|0), n.stock[0]*0.5], [B_QUARRY, n.quarries, 3+(n.tiles/700|0), n.stock[1]*0.25], [B_COPPERMINE, n.copperMines, 1+(n.tiles/1400|0), n.stock[2]]];
  // (one that stands in an unfinished square of four goes on with it: they are built side by side, so research can join them)
  const w: number[]=want.filter(([,have,goal]) => have<goal).sort((a,b) => (a[1]%4===0 ? 1 : 0)-(b[1]%4===0 ? 1 : 0) || a[3]-b[3] || a[0]-b[0]).map(k => k[0]);
  if (!n.labs && n.plantations+n.quarries+n.copperMines>=3 && n.tier[R_GATHER]<MAX_TIER) w.push(B_RESEARCH);
  return w;
}
/** Has the kingdom the footing to build towers: a few plantations and quarries bringing in wood and stone? (At war it builds them regardless.) */
const footing = (n: Nation) => n.plantations>=3 && n.quarries>=2;
/** What comes before everything else, in order: the first plantation and the first quarry (wood and stone are what everything is built of, and nothing brings
    them in without one: a kingdom that spends its starting goods on farms first sits for ever with the rest too dear), then a farm while one is wanted, then
    the other gatherers. */
function foundations(n: Nation){
  const g=groundwork(n), must=g.filter(t => (t===B_PLANTATION && n.plantations<1) || (t===B_QUARRY && n.quarries<1)), rest=g.filter(t => !must.includes(t));
  if (!earlyFarm(n)) return [...must, ...rest];
  return [...must, B_FARM, ...rest];
}
function earlyFarm(n: Nation){
  if (beggarProblem(n) || n.capTile<0) return false;
  return n.farms<Math.min(2+Math.ceil((n.plantations+n.quarries+n.copperMines)*0.25),3+(n.tiles/60|0));
}
/** What a bot would build next, most wanted first. */
function wishlist(n: Nation, exposed: boolean){
  const w: number[]=foundations(n), hungry=beggarProblem(n);
  // beggars in the streets: better houses before anything else (a guild's builders raise them, once
  // housing research allows it; a research station to get there)
  if (hungry){
    if (n.tier[R_HOUSING]>=2 && n.guilds<1+(n.tiles/1500|0)) w.push(B_GUILD);
    else if (n.tier[R_HOUSING]<2 && !n.labs && n.tiles>=150) w.push(B_RESEARCH);
  }
  // soldiers left without room in a barracks guard the wall's openings
  let outposts=0;
  for (const q of n.blds) if (pType[q]===B_TOWER && pOwner[q]===n.id && !wallNeighbours(q,n.id)) outposts++;
  if (!n.barracks && n.soldierShare>0) w.push(B_BARRACKS);
  // room in the barracks for the army it keeps (new modules join the old, making one bigger army)
  else if (n.soldiers>n.barracks*UNIT_SIZE-2 && n.barracks<2+(n.tiles/400|0)) w.push(n.archeries*3<n.barracks-1 ? B_ARCHERY : B_BARRACKS);   // (about one module in three for archers, beside the spearmen's)
  // the capital is the heart of a kingdom: its wall of watchtowers comes first, and only once that
  // stands (adequately) does a bot spread towers to its borders, as lone outposts facing its neighbours
  // (watchtowers are off for now: no wall, no outposts)
  void outposts; void wallDue; void capitalSafe;
  // farms bring people faster: none while beggars crowd the streets; with land lying empty, more,
  // grown together into one big farmland
  // (farms are the foundation: more people, more taxes. Each is 5% dearer than the last, so the want is a steady one)
  if (!hungry && n.farms < 3+(n.tiles/250|0)) w.push(B_FARM);
  else if (!n.homeless && n.beds>=n.villagers+n.soldiers && n.plots.length>=12 && n.farms<3+(n.tiles/120|0) && emptyPlots(n)>n.plots.length*0.3) w.push(B_FARM);   // (only while everyone has a home)
  if (n.minters < 1+(n.tiles/1500|0)) w.push(B_MINTER);
  // learning once the kingdom has found its feet, and a guild to build on what it learns
  if (n.farms && n.tiles>=300 && !TOPICS.every(t => maxed(n,t)) && n.labs < 1+(n.tiles/2500|0)) w.push(B_RESEARCH);
  // carpenters add hovels for nothing: for a bot with people short of homes
  if ((hungry || n.homeless>2) && n.carpenters < 1+(n.tiles/1500|0)) w.push(B_CARPENTER);
  if (n.tier[R_HOUSING]>=2 && n.guilds < 1+(n.tiles/4000|0)) w.push(B_GUILD);
  if (n.tier[R_INFANTRY]>=2 && n.barracks && n.smithies < 1+(n.barracks/6|0)) w.push(B_SMITHY);
  // a hospital (more with a bigger army and a bigger land) once field medics are learned: fewer soldiers lost for good
  if (hasMedics(n) && n.soldiers>=10 && n.hospitals < Math.min(1+(n.soldiers/30|0),1+(n.tiles/800|0))) w.push(B_HOSPITAL);
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
/** Is the capital adequately guarded: its town wall planned and at least 70% of it standing? */
export function capitalSafe(n: Nation){
  if (!n.wallR || n.capTile<0) return false;
  for (let R=WALL_MIN;R<=n.wallR;R++){   // (a ring the town has outgrown, standing as an inner wall, counts)
    const ring=wallPlots(n,R); if (!ring.length) continue;
    if (ring.filter(q => standingTower(q,n.id)).length >= ring.length*0.7) return true;
  }
  return false;
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
const sameNeighbour = (q: number, type: number, id: number) =>
  [q-1,q+1,q-PW,q+PW].some(k => k>=0 && pType[k]===type && pOwner[k]===id);
/** The most of a 2×2 square's other three plots, round q, that already hold a building of `type`
    of n's: three means q completes a square (four of a kind in a square join into one, with research). */
function squareFill(q: number, type: number, id: number){
  const x=q%PW, y=(q/PW)|0; let best=0;
  for (const [sx,sy] of [[-1,-1],[0,-1],[-1,0],[0,0]]){
    let k=0;
    for (let dy=0;dy<2;dy++) for (let dx=0;dx<2;dx++){
      const px=x+sx+dx, py=y+sy+dy; if ((px===x && py===y) || px<0 || py<0 || px>=PW || py>=PH) continue;
      const m=py*PW+px; if (pType[m]===type && pOwner[m]===id) k++;
    }
    if (k>best) best=k;
  }
  return best;
}

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
/** Where a new plantation, quarry or copper mine goes: next to the ones it has of its kind, the spot
    that completes (or most fills) a 2×2 square; -1 if it has none or no room beside them. */
function gathererPlot(n: Nation, type: number){
  let best=-1, bs=0;
  const mine=n.blds.filter(q => pType[q]===type && pOwner[q]===n.id).slice(0,40), cap=n.capPlot;
  for (const p of mine){
    for (const q of [p-PW,p+1,p+PW,p-1,p-PW-1,p-PW+1,p+PW-1,p+PW+1]){
      if (q<0 || q>=NP || Math.abs(q%PW-p%PW)>1 || placeProblem(n,q,type,'none') || plannedWall(n,q)) continue;   // (the line of the wall is kept clear)
      const s=squareFill(q,type,n.id)*10 + (sameNeighbour(q,type,n.id) ? 6 : 0) - Math.hypot(q%PW-cap%PW,((q/PW)|0)-((cap/PW)|0))*0.05;
      if (s>bs){ bs=s; best=q; }
    }
  }
  return best;
}
function pickPlot(n: Nation, type: number){
  if (type===B_BARRACKS || type===B_ARCHERY){ const q=barracksPlot(n); if (q>=0) return q; }
  if (GATHERERS.includes(type)){ const q=gathererPlot(n,type); if (q>=0) return q; }
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
        : GATHERERS.includes(type) ? -d*0.3 + (sameNeighbour(q,type,n.id) ? 12 : 0) + 8*squareFill(q,type,n.id)   // side by side, then in squares: research joins them
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
  // with two or more gathering buildings, joining them is the next thing to learn (but for towers, on the border)
  if (n.plantations+n.quarries+n.copperMines>=2 && n.tier[R_GATHER]<MAX_TIER){ setStudy(n,R_GATHER); return; }
  // a kingdom with an army and the means to spare learns field medics, to keep its soldiers alive
  if (!hasMedics(n) && n.soldiers>=12 && n.gold>500 && n.tier[R_INFANTRY]>=2 && !beggarProblem(n)){ setStudy(n,R_MEDICS); return; }
  if (hasMedics(n) && !maxed(n,R_MEDICS) && n.hospitals>0 && n.soldiers>=20 && n.gold>800 && !beggarProblem(n)){ setStudy(n,R_MEDICS); return; }   // better care, once the hospitals stand and the army is big
  const order=exposed ? [R_INFANTRY, R_GATHER, R_HOUSING, R_TAXES] : [R_GATHER, R_HOUSING, R_INFANTRY, R_TAXES];   // (watchtowers and the castle's guns are off for now)
  void R_TOWERS; void R_CASTLE;
  let best=order[0]; for (const t of order) if (n.tier[t]<n.tier[best]) best=t;
  setStudy(n,best);
}

function botBuild(n: Nation, exposed: boolean){
  botStudy(n,exposed);
  let saving=false;   // threatened and short of a wall tower: lesser works don't get its stone
  const first=foundations(n), hold=[false,false,false];   // (short of a gathering building: lesser works don't get the goods it needs)
  for (const type of wishlist(n,exposed)){
    const s=STRUCTURES.find(s=>s.type===(type===WALL ? B_TOWER : type))!;
    if (saving && s.cost[1]>0) continue;
    if (type!==B_BARRACKS && type!==B_ARCHERY && type!==WALL && s.cost.some((c,g) => c>0 && hold[g])) continue;   // (barracks and the capital's wall are never put off for the gatherers: they are cheap; any gatherer waits for the one before it)
    if (!canAfford(n,s)){
      if (type===WALL && danger(n,exposed)) saving=true;
      if (first.includes(type)) costFor(n,s).forEach((c,g) => { if (c>0) hold[g]=true; });
      continue;
    }
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
  for (const x of W.armies) if (x.enemy===id && x.mode!==A_HOME) incoming+=x.men;
  if (!war){
    let worst=0; for (let o=1;o<M;o++) if (o!==id && W.contact[id*M+o] && !allied(id,o) && W.nations[o].alive) worst=Math.max(worst,W.nations[o].soldiers);
    const rich=n.gold>warChest(n)*2 ? 0.1 : 0;   // (a treasury to spare: a bigger army in peace too)
    return worst>n.soldiers*1.5+5 ? Math.max(peace+rich,0.35) : peace+rich;
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
/** The share of army x's men still standing in the field, of all its men. */
const strengthOf = (x: Army) => x.men/Math.max(1,armyMembers(x).length);
/** Men at home in army x. */
const homeMen = (x: Army) => armyMembers(x).filter(h => h.war<0 && h.hp>0).length;
/** An army of n's free for an order: at home with enough men, or holding in the field with nothing to do. */
function idle(x: Army){
  if (x.mode===A_HOME) return homeMen(x)>=MIN_ARMY;
  return x.mode===A_HOLD && (x.order===O_NONE || (x.order===O_ATTACK && W.rOcc[x.goal]===x.o) || (x.order===O_DEFEND && !x.enemy));   // (stationed in a region of its own, with no war to defend it in)
}
const distTo = (x: Army, r: number) => { const [fx,fy]=flagXY(r); return Math.hypot(fx-x.x,fy-x.y); };
/** In a fight it is losing badly, or worn down in the field with nothing to do: an army falls back, or goes home to heal. */
function husband(id: number){
  for (const x of W.armies){
    if (x.o!==id || x.mode===A_HOME) continue;
    if (x.mode===A_BATTLE){
      const f=x.foe>=0 ? armyOf(x.foe) : undefined;
      if (f && f.men>=4 && x.men<f.men*0.45 && x.order!==O_RETREAT) armyOrder(id,x.id,'retreat');
      continue;
    }
    if (x.mode===A_HOLD && strengthOf(x)<0.35 && (x.order!==O_DEFEND || x.men<MIN_ARMY) && waiting(x)<MIN_ARMY) armyOrder(id,x.id,'return');
    else if (x.enemy && waiting(x)>=MIN_ARMY && !x.coming.length) armyOrder(id,x.id,'reinforce');   // (at war: the men waiting at the barracks go up to it)
    if (x.mode===A_HOLD && x.order===O_NONE && x.enemy===0 && !W.armies.some(y => y.o===id && y.enemy) ) armyOrder(id,x.id,'return');
  }
}
/** Attacking d: every free army goes for the nearest claimed region that can be attacked and has no army of ours sent to it. A defender striking
    back (`counter`) also sends the armies holding its regions while none of d's is in the field against it. */
function attackOrders(n: Nation, d: number, counter=false){
  const id=n.id, regs=claimsOf(id,d);
  const quiet=counter && !W.armies.some(y => y.o===d && y.mode!==A_HOME && y.men>0 && y.enemy===id);
  for (const x of W.armies){
    if (x.o!==id || !(idle(x) || (quiet && x.mode===A_HOLD && x.order===O_DEFEND && x.enemy===d))) continue;
    if (x.mode!==A_HOME && strengthOf(x)<0.35) continue;
    let best=0, bd=Infinity;
    for (const r of regs){
      if (W.rOcc[r]===id || !besideHeld(id,r) || armyProblem(id,x.id,'attack',r)) continue;
      const dd=distTo(x,r); if (dd<bd){ bd=dd; best=r; }
    }
    if (best) armyOrder(id,x.id,'attack',best);
  }
}
/** Defending against a: one army in each claimed region, the ones under attack (or taken) first, then those an attack can reach next, then the rest as a reserve. */
function defendOrders(n: Nation, a: number){
  const id=n.id, regs=claimsOf(a,id).filter(r => W.rOwner[r]===id);
  const threat=(r: number) => W.armies.some(x => x.o===a && x.goal===r && x.mode!==A_HOME) ? 3 : W.rOcc[r]===a ? 2 : besideHeld(a,r) ? 1 : 0;
  const order=regs.slice().sort((p,q) => threat(q)-threat(p) || p-q);
  for (const r of order){
    if (W.armies.some(x => x.o===id && x.goal===r && x.order===O_DEFEND && (x.men>0 || x.mode!==A_HOME))) continue;
    let best: Army | undefined, bd=Infinity;
    for (const x of W.armies){
      if (x.o!==id || !idle(x) || armyProblem(id,x.id,'defend',r)) continue;
      const dd=distTo(x,r); if (dd<bd){ bd=dd; best=x; }
    }
    if (best) armyOrder(id,best.id,'defend',r);
  }
}
/** The regions bot n would claim of d's: a chain from one beside its own, a few long by its temper and d's weakness. */
function claimsFor(n: Nation, d: number){
  const first=claimable(n.id,d); if (!first.length) return [];
  const srand=W.srand, D=W.nations[d];
  const want=Math.max(1,Math.min(MAX_CLAIMS,1+Math.round(n.attackAt*2*srand()+(n.strength>D.strength*2 ? 1 : 0))));
  const chain=[first[(srand()*first.length)|0]];
  while (chain.length<want){
    const next: number[]=[]; for (const r of chain) for (const q of RG.adj[r]) if (W.rOwner[q]===d && !chain.includes(q) && !next.includes(q)) next.push(q);
    if (!next.length) break;
    chain.push(next[(srand()*next.length)|0]);
  }
  return chain;
}

/** War for a bot: answer peace offers, give its armies their orders in the wars it fights (attacking the
    regions it claimed one after another, or defending those claimed of it, a region an army), bring
    beaten armies home to heal, end wars that go badly, and now and then lay claims on the weakest
    neighbour (one it has a region beside): its temper (attackAt) sets how big an edge it wants. */
function botWar(n: Nation){
  const srand=W.srand, M=W.M, id=n.id;
  // raise or stand down the army as the times demand (quickly up, slowly down)
  const want=armyShare(n), d=want-n.soldierShare;
  n.soldierShare=Math.min(1,Math.max(0,n.soldierShare+Math.max(-0.04,Math.min(0.1,d))));
  // peace offered: white peace is taken by a defender that holds none of its own war goals, and by anyone losing; war goals (each side gets
  // the claimed regions it holds) by one losing badly, or losing while they hold half of theirs, or one that gets at least as much as it gives
  for (let o=1;o<M;o++){
    if (!W.offers[o*M+id] || !W.wars[id*M+o]) continue;
    const goals=W.offerKind[o*M+id]===P_GOALS, held=heldShare(o,id), look=outlook(n,o);
    const yes = goals ? look<-0.6 || (held>=0.5 && look<0) || taken(id,o)>taken(o,id) || (look<0.2 && taken(id,o)>=taken(o,id))
      : (began(o,id) && !taken(id,o)) || wantsPeace(n,o);
    if (yes) acceptPeace(id,o); else refusePeace(o,id);
  }
  husband(id);
  deploy(n);
  fortify(n);
  let busy=false;
  for (let o=1;o<M;o++){
    if (o===id || !W.nations[o].alive) continue;
    if (W.aggr[id*M+o] || W.aggr[o*M+id]) busy=true;
    if (!W.wars[id*M+o]) continue;
    busy=true;
    // (the side that began attacks first; a defender holds its claimed regions first and sends what is left against the regions it claims back)
    if (began(id,o)){ attackOrders(n,o); if (attackerIn(o,id)) defendOrders(n,o); }
    else { if (attackerIn(o,id)) defendOrders(n,o); if (attackerIn(id,o)) attackOrders(n,o,true); }
  }
  // ending a war (at most every 30 s): an attacker holding most of what it claimed demands it; one losing offers white peace.
  // A defender losing badly gives the war goals up; one losing for a while offers white peace. A winning attacker may claim more.
  if (W.simTime>=n.nextOffer) for (let o=1;o<M;o++){
    if (o===id || !atWar(id,o) || W.offers[id*M+o]) continue;
    const look=outlook(n,o), age=warAge(id,o);
    if (began(id,o)){
      const held=heldShare(id,o);
      if (attackerIn(o,id) && (look<-0.9 || heldShare(o,id)>=0.75)){ giveGoals(id,o); continue; }   // (the defender's counter-attack goes badly for it)
      if (held>=0.6 && look>-0.2){ endWar(id,o,P_GOALS); n.nextOffer=W.simTime+30; }
      else if (age>=600 && look<-0.4){ endWar(id,o,P_WHITE); n.nextOffer=W.simTime+30; }
      else if (look>0.5 && held>=0.5 && srand()<0.3){ const more=moreClaims(id,o); if (more) setClaims(id,o,[...claimsOf(id,o),more]); }
    } else {
      if (attackerIn(o,id) && (look<-0.9 || heldShare(o,id)>=0.75)){ giveGoals(id,o); continue; }
      if (counter(n,o,look,age)) continue;
      if (age>=600 && look<-0.3 && !taken(id,o)){ endWar(id,o,P_WHITE); n.nextOffer=W.simTime+30; }
    }
  }
  // after a war it rests a while (the bold less), so a winner digests its gains first
  const desperate=stuck(n);
  if (busy){ n.nextWar=Math.max(n.nextWar, W.simTime+(desperate ? 20 : 50+(0.8-n.attackAt)*150)); return; }
  if (W.simTime<n.nextWar || outnumbered(n)) return;
  const pool=ready(n); if (pool<5) return;
  if (n.gold<warChest(n)*(desperate ? 0.5 : 1)) return;   // not before there is money to pay for it
  const need=(1.4-(n.attackAt-0.5)*2)*(desperate ? 0.6 : 1);   // 1.4 for the cautious, 0.8 for the bold
  let best=0, bs=need;
  for (let o=1;o<M;o++){
    const D=W.nations[o]; if (o===id || !D.alive || allied(id,o) || !W.contact[id*M+o]) continue;
    if (!claimable(id,o).length) continue;
    const s=pool/defence(D)*(0.8+srand()*0.4);
    if (s>bs){ bs=s; best=o; }
  }
  if (!best){ n.nextWar=W.simTime+60+srand()*60; return; }
  const regs=claimsFor(n,best);
  if (regs.length && claim(id,best,regs)) n.nextWar=W.simTime+120;
}
void O_NONE;
/** A bot fortifies its border: now and then, with the stone and the income for it, a fort in a region of its own beside a neighbour that is not its ally
    (one claimed of it in a war first, then those facing the strongest neighbour), one region in four at most. */
function fortify(n: Nation){
  const id=n.id, M=W.M;
  if (W.tickN%300!==(id*11)%300) return;
  const s=structureOf(B_TOWER)!, cost=costFor(n,s);
  if (!canAfford(n,s) || n.stock[1]<cost[1]+10 || n.income<FORT_UPKEEP*2) return;
  let mine=0, forts=0; for (let r=1;r<RG.n;r++) if (W.rOwner[r]===id){ mine++; if (fortTier(r)) forts++; }
  if (forts>=Math.max(1,Math.floor(mine/4))) return;
  const claimed=new Set<number>(); for (const [k,regs] of W.claims) if (k%M===id) for (const r of regs) claimed.add(r);
  let best=0, bs=-1;
  for (let r=1;r<RG.n;r++){
    if (W.rOwner[r]!==id || W.rOcc[r] || fortTier(r) || fortProblem(n,r)) continue;
    let s2=0; for (const q of RG.adj[r]){ const o=W.rOwner[q]; if (o && o!==id && !allied(id,o)) s2=Math.max(s2,1+W.nations[o].strength/Math.max(1,n.strength)); }
    if (!s2) continue;
    if (claimed.has(r)) s2+=10;
    if (s2>bs){ bs=s2; best=r; }
  }
  if (best) buildFort(n,best);
}
/** How many of a's claims on d a occupies. */
const taken = (a: number, d: number) => { let k=0; for (const r of claimsOf(a,d)) if (W.rOcc[r]===a) k++; return k; };
/** A defending bot whose defence holds (it is winning, and the attacker holds under half its goals) strikes back: it claims a region of the
    attacker's on the border, one at a time (the next once the last is taken), until it holds as many as its temper wants (1 to 3); then it
    offers peace for the war goals (each side keeping the claimed regions it holds). True when it did something. */
function counter(n: Nation, a: number, look: number, age: number){
  const id=n.id, mine=claimsOf(id,a), got=taken(id,a), want=1+Math.round(n.attackAt*2);
  if (got>=want || (got && look<0)){ endWar(id,a,P_GOALS); n.nextOffer=W.simTime+30; return true; }
  if (look<0.15 || heldShare(a,id)>=0.5 || age<600) return false;
  if (mine.some(r => W.rOcc[r]!==id)) return false;   // (the one claimed last is not taken yet)
  let best=0, bs=-Infinity;
  for (let r=1;r<RG.n;r++){
    if (W.rOwner[r]!==a || W.rOcc[r] || mine.includes(r) || !besideHeld(id,r)) continue;
    const A=W.nations[a]; if (A.capTile>=0 && region[A.capTile]===r && want<3) continue;   // (its castle region only for the boldest)
    let s2=0; for (const q of RG.adj[r]) if (holdsRegion(id,q)) s2++;
    s2+=W.srand()*0.5;
    if (s2>bs){ bs=s2; best=r; }
  }
  if (!best) return false;
  setClaims(id,a,[...mine,best]); n.nextOffer=W.simTime+20;
  return true;
}
/** The share of a's claims on d that a occupies. */
function heldShare(a: number, d: number){ const regs=claimsOf(a,d); return regs.length ? regs.filter(r => W.rOcc[r]===a).length/regs.length : 0; }
/** One more region of d's for a winning attacker a to claim: beside its claims or ground it holds; 0 if none (or it claims 6 already). */
function moreClaims(a: number, d: number){
  const regs=claimsOf(a,d); if (regs.length>=6) return 0;
  for (const r of regs) for (const q of RG.adj[r]) if (W.rOwner[q]===d && !regs.includes(q)) return q;
  return 0;
}
/** In peace a bot with two armies or more stations those beyond the first in its regions on the border with the strongest neighbour, a region each, for a quick answer
    to a war there (they march in as a second wave when a region beside them is attacked). */
function deploy(n: Nation){
  const id=n.id, M=W.M;
  if (W.tickN%150!==(id*7)%150) return;
  for (let o=1;o<M;o++) if (W.wars[id*M+o]) return;
  const home=W.armies.filter(x => x.o===id && x.mode===A_HOME && homeMen(x)>=MIN_ARMY).sort((a,b) => a.id-b.id);
  const all=W.armies.filter(x => x.o===id).length; if (all<2 || !home.length) return;
  if (home.length===all) home.shift();   // (one stays at home)
  // the neighbour to watch: the strongest kingdom with a region beside one of ours
  let foe=0, fs=-1;
  for (let o=1;o<M;o++){ const D=W.nations[o]; if (o===id || !D.alive || allied(id,o) || !W.contact[id*M+o]) continue; if (D.strength>fs){ fs=D.strength; foe=o; } }
  if (!foe) return;
  const border: number[]=[]; for (let r=1;r<RG.n;r++) if (W.rOwner[r]===id && RG.adj[r].some(q => W.rOwner[q]===foe)) border.push(r);
  for (const x of home){
    const r=border.find(r => !armyProblem(id,x.id,'station',r)); if (!r) return;
    armyOrder(id,x.id,'station',r);
  }
}

import { botSea } from './botsea';
export function botThink(n: Nation){
  const srand=W.srand, M=W.M, contact=W.contact;
  n.nextThink=W.simTime+1.1+srand()*2.4;
  const b=n.id*M;
  let exposed=false; for (let o=1;o<M;o++) if (o!==n.id && contact[b+o] && W.nations[o].alive){ exposed=true; break; }
  const hungry=beggarProblem(n);
  if (!hungry) n.hungry=0; else if (!n.hungry) n.hungry=W.simTime;
  botBuild(n,exposed);
  botWar(n);
  botSea(n);
  let active=0; for (const A of W.attacks) if (!A.done && A.att===n.id) active++;
  if (active>=2) return;
  // personality: how much gold it lets pile up before settling more land (little, with beggars to find room for)
  // (saving for a war: only what is beyond the war chest)
  const g=n.gold-(saving(n) ? warChest(n) : 0), expandAt=hungry ? 20 : 20+n.expandAt*200;
  if (contact[b]>0 && g>expandAt) launch(n.id,0,g*(hungry ? Math.max(n.ratio,0.6) : n.ratio));
}
