/* ---------- population: humans leave the capital, work as villagers or serve as soldiers ----------
   The capital releases a new human every 10 seconds, sooner with each farm.
   Soldiers need a barracks: it trains them and is where they wait. Each kingdom keeps a requested
   share of its people under arms. The barracks' room is all the trained soldiers it can have: when it
   wants more, newcomers are born soldiers at a barracks with room and the nearest villagers walk there
   to train, and once the barracks are full the rest train at the castle as militia instead. Militia
   patrol the kingdom and guard its watchtowers; they pay no tax and draw no wages until they are
   called up to a front (sim/war.ts). Room in a barracks goes to militia first: one at a time, they
   walk over and train as soldiers. With too many under arms, the militia go back to work first.
   Every person needs a home. While the kingdom has fewer houses than people, a villager's next
   job is to pick a plot, walk there and build a hovel; once everyone is housed, villagers are the
   kingdom's workers: each one picks a resource, walks to it, harvests it, carries the load to the
   capital and stores it, then thinks about the next job. Houses nobody needs for a while stand
   empty, the outermost first, and fill again from the centre as the kingdom grows.
   The people who have lived in the kingdom longest get the houses. A villager left homeless for a
   minute turns beggar: he crawls about town, does no work, pays no tax and can't be recruited,
   until a home comes free for him.
   A builders guild takes one villager as its builder. Once housing research allows it, he walks
   from house to house, the castle's first, and rebuilds hovels as stone houses (room for 2) and
   then manors (room for 3), the manors in the old heart of town and stone houses further out.
   Each improvement costs 3 wood and 3 stone. He runs or fights like any villager, and if he
   falls another villager takes up his tools 5 seconds later.
   A blacksmith also takes one villager as its smith. Once infantry research allows it, he walks
   to the castle for a piece of copper, forges armour at his smithy for 5 seconds, and carries it
   to the barracks that needs it most nearly (sim/army.ts says which armour each one wants).
   Soldiers never gather. They wait at their barracks, or guard a watchtower that calls for
   them, until the kingdom sends them to war (sim/war.ts). */
import { TW, TH, PW, TICK, UNPAID_TICKS, DESERT_TICKS, SCRAP_GOLD, B_CASTLE, B_CPART, B_BARRACKS, B_TOWER, B_HOUSE, B_SITE, B_GUILD, B_SMITHY } from '../core/constants';
import { W, owner, occ, pType, pOwner, pBurn, pPrio, pAband, pCenter, pTimer, pTier, pHp, pArmor, resType, resBusy, type Human, type Nation } from './state';
import { homeScore, startSite, cancelSite, finishHouse } from './buildings';
import { on } from './events';
import { GOOD_OF, YIELD, WORK_TICKS, available, harvest } from './resources';
import { updateWar, reinforce, marchStep, guardStep, alarmStep, mayStand, spread } from './war';
import { HOUSE_BEDS, R_HOUSING, R_TOWERS, MAX_TIER } from './research';
import { gained, spent, mayInvest } from './ledger';
import { TOWER_COST } from './defense';
import { SOLDIER_HP, VILLAGER_HP, MILITIA_HP, maxHp, buildUnits, station, armUp, armorWanted, units, unitAt, type Unit } from './army';
export { SOLDIER_HP, VILLAGER_HP, MILITIA_HP, maxHp };

export const H_VILLAGER = 0, H_SOLDIER = 1;
// what someone switching role comes out as (Human.to)
export const T_VILLAGER = 0, T_SOLDIER = 1, T_MILITIA = 2;
const SPEED_UP = [0, 1, 0.5];    // walking speed added by each (villagers 3 to 5 pixels a second)
export const TASK_ROAM = 0,      // between jobs: villagers think or stroll between buildings, soldiers patrol
             TASK_TO_TRAIN = 1,  // walking to a barracks to switch role
             TASK_INSIDE = 2,    // inside the barracks, switching role
             TASK_GATHER = 3,    // walking to a claimed resource
             TASK_HARVEST = 4,   // working at it
             TASK_HAUL = 5,      // carrying the load home
             TASK_STORE = 6,     // inside the capital, putting the load away
             TASK_HOME_GO = 7,   // walking to the plot of the house they will build
             TASK_HOME_BUILD = 8,// building it
             TASK_FIX_GO = 9,    // builders: walking to the house they will improve
             TASK_FIX = 10,      // improving it
             TASK_SMITH_FETCH = 11,  // blacksmiths: walking to the castle for copper
             TASK_SMITH_BACK = 12,   // carrying it to the smithy
             TASK_FORGE = 13,        // forging armour
             TASK_SMITH_DELIVER = 14;// carrying the armour to a barracks
export const HUMAN_EVERY = 100;  // progress per new human: 100 ticks (10 s), each farm adds 5% speed
export const FARM_BONUS = 0.05;
const TRAIN_TICKS = 30;          // ticks inside the barracks to switch role (3 s)
const STORE_TICKS = 10;          // ticks inside the capital to store a load (1 s)
const PATROL_R = 36;             // pixels around the capital door soldiers patrol when there is no barracks
export const HOME_PACE = 1.15;   // soldiers on their own kingdom's land move 15% faster
export const REGEN = 0.01;        // hit points everyone heals a tick (0.1 a second)
export const GARRISON = 5;       // soldiers a watchtower calls for
export const TOWER_RANGE = 32;   // pixels a watchtower can shoot
const SEARCH_R = 40;             // tiles a villager looks around for work
export const BUILD_TICKS = 40;   // ticks to put up a house (4 s)
export const BEG_TICKS = 600;    // ticks homeless before a villager turns beggar (60 s)
export const ABANDON_TICKS = 200;// ticks with more houses than people before the extra ones stand empty (20 s)
export const FIX_TICKS = 50;     // ticks a builder works to raise a house a tier (5 s)
export const FIX_COST = [3,3,0]; // what each improvement costs: [wood, stone, copper]
export const REHIRE_TICKS = 50;  // ticks after a builder or smith falls before another villager takes his place (5 s)
export const FORGE_TICKS = 50;   // ticks a smith works on a piece of armour (5 s)
export const ARMOR_COPPER = 5;   // copper each piece takes
const MANOR_SHARE = 0.4;         // with manors allowed, the innermost 40% of houses become manors

/** Switching role: walking to a barracks (or the castle) for it, or inside training. */
export const switching = (h: Human) => h.task===TASK_TO_TRAIN || h.task===TASK_INSIDE;
/** Out of sight inside the capital or a barracks. */
export const indoors = (h: Human) => h.task===TASK_INSIDE || h.task===TASK_STORE;

/** Pixel position just outside the capital's door. */
export function doorOf(n: Nation): [number, number] { const q=n.capPlot; return [(q%PW)*8+8, ((q/PW)|0)*8+15]; }
export const tileOf = (x: number, y: number) => ((y/2)|0)*TW+((x/2)|0);
/** True if pixel (x,y) is kingdom o's own land, not occupied by an enemy. */
const ownFree = (o: number, x: number, y: number) => { const t=tileOf(x,y); return owner[t]===o && !occ[t]; };
/** Pixel position at the front of building plot q (barracks door, foot of a watchtower). */
export const frontOf = (q: number): [number, number] => [(q%PW)*8+4, ((q/PW)|0)*8+7.5];
/** How fast h walks, pixels a second: soldiers are quicker at home, so defenders can catch invaders. */
export const pace = (h: Human) => h.kind===H_SOLDIER && owner[tileOf(h.x,h.y)]===h.o ? h.sp*HOME_PACE : h.sp;
const standing = (q: number, type: number, id: number) => pType[q]===type && pOwner[q]===id && pBurn[q]<=0;
/** Does the barracks (or castle) h is training at still stand? */
const siteStands = (h: Human) => { const n=W.nations[h.o]; return h.site>=0 && (standing(h.site,B_BARRACKS,h.o) || (h.site===n.capPlot && n.capTile>=0)); };
/** Is h a militiaman at home, free to be called up or to train as a soldier? */
export const homeMilitia = (h: Human) => h.kind===H_SOLDIER && h.militia && h.war<0 && h.hp>0 && !switching(h) && !indoors(h);
/** The kingdom's barracks, by plot. */
export const barracksOf = (n: Nation) => n.blds.filter(q => standing(q,B_BARRACKS,n.id));
function nearestPlot(plots: number[], x: number, y: number){
  let best=-1, bd=Infinity;
  for (const q of plots){ const [fx,fy]=frontOf(q), d=(fx-x)**2+(fy-y)**2; if (d<bd || (d===bd && q<best)){ bd=d; best=q; } }
  return best;
}
/** Where a villager stands to work the resource on tile t. */
export const workSpot = (t: number): [number, number] => [(t%TW)*2+1.5, ((t/TW)|0)*2+1.5];

// the castle covers a 16x16 pixel block; people walk around its walls, not across its roof.
// The row just below the walls, where the gate opens, stays walkable.
const wallX0=-0.5, wallX1=16.5, wallY0=-0.25, wallY1=14.5;   // the top edge stays clear of the doorstep of a building on the plot above
export function onCastle(n: Nation, x: number, y: number){
  if (n.capTile<0) return false;
  const q=n.capPlot, ox=(q%PW)*8, oy=((q/PW)|0)*8;
  return x>=ox+wallX0 && x<=ox+wallX1 && y>=oy+wallY0 && y<=oy+wallY1;
}
// does the segment a→b pass through the castle walls? (Liang–Barsky clip)
function crossesCastle(ox: number, oy: number, ax: number, ay: number, bx: number, by: number){
  const x0=ox+wallX0, x1=ox+wallX1, y0=oy+wallY0, y1=oy+wallY1, dx=bx-ax, dy=by-ay;
  let t0=0, t1=1;
  for (const [p,q] of [[-dx,ax-x0],[dx,x1-ax],[-dy,ay-y0],[dy,y1-ay]]){
    if (p===0){ if (q<0) return false; continue; }
    const r=q/p;
    if (p<0){ if (r>t1) return false; if (r>t0) t0=r; } else { if (r<t0) return false; if (r<t1) t1=r; }
  }
  return t1-t0>1e-9;
}
/** True if walking a→b stays inside kingdom o's borders. People never leave their own land:
    unclaimed ground can be taken by a neighbour at any moment, and anyone on it would die. */
function safeWalk(o: number, ax: number, ay: number, bx: number, by: number){
  // visit every tile the line touches, so a diagonal can't clip the corner of foreign ground
  const x0=ax/2, y0=ay/2, x1=bx/2, y1=by/2, dx=x1-x0, dy=y1-y0, sx=dx>0?1:-1, sy=dy>0?1:-1;
  let tx=Math.floor(x0), ty=Math.floor(y0); const ex=Math.floor(x1), ey=Math.floor(y1);
  const tdx=dx ? Math.abs(1/dx) : Infinity, tdy=dy ? Math.abs(1/dy) : Infinity;
  let tmx=dx ? (sx>0 ? tx+1-x0 : x0-tx)*tdx : Infinity, tmy=dy ? (sy>0 ? ty+1-y0 : y0-ty)*tdy : Infinity;
  for (let guard=0;guard<2000;guard++){
    const t=ty*TW+tx; if (owner[t]!==o || occ[t]) return false;   // occupied land is no place for daily life
    if (tx===ex && ty===ey) return true;
    if (tmx<tmy){ tmx+=tdx; tx+=sx; } else { tmy+=tdy; ty+=sy; }
  }
  return true;
}
/** Plans the walk to (tx,ty): straight if the castle isn't in the way, otherwise round its corners.
    A detour is only taken if it is safe; cutting across the walls beats walking into an enemy.
    Returns whether the walk stays inside the borders. With `picky`, a walk that could only cut
    across the walls also counts as failed, so a villager choosing a job can pick another one. */
function route(h: Human, picky=false){
  h.path=[];
  const n=W.nations[h.o], o=h.o, direct=safeWalk(o,h.x,h.y,h.tx,h.ty);
  const q=n.capPlot, ox=(q%PW)*8, oy=((q/PW)|0)*8;
  if (n.capTile>=0 && crossesCastle(ox,oy,h.x,h.y,h.tx,h.ty)){
    const P=[[h.x,h.y],[ox-2,oy-2],[ox+18,oy-2],[ox+18,oy+16],[ox-2,oy+16],[h.tx,h.ty]];
    const dist=P.map(()=>Infinity), prev=P.map(()=>-1), done=P.map(()=>false); dist[0]=0;
    for (;;){
      let u=-1; for (let i=0;i<P.length;i++) if (!done[i] && dist[i]<Infinity && (u<0||dist[i]<dist[u])) u=i;
      if (u<0 || u===5) break; done[u]=true;
      for (let v=0;v<P.length;v++){
        if (done[v] || crossesCastle(ox,oy,P[u][0],P[u][1],P[v][0],P[v][1]) || !safeWalk(o,P[u][0],P[u][1],P[v][0],P[v][1])) continue;
        const d=dist[u]+Math.sqrt((P[v][0]-P[u][0])**2+(P[v][1]-P[u][1])**2);
        if (d<dist[v]){ dist[v]=d; prev[v]=u; }
      }
    }
    if (prev[5]>=0){ const way: number[]=[]; for (let i=prev[5];i>0;i=prev[i]) way.unshift(P[i][0],P[i][1]); h.path=way; return true; }
    if (picky) return false;
    // a stroll is optional: rather than climb the castle, stay put
    if (h.task===TASK_ROAM){ h.tx=h.x; h.ty=h.y; return false; }
  }
  // likewise rather than step outside the borders
  if (!direct && h.task===TASK_ROAM){ h.tx=h.x; h.ty=h.y; }
  return direct;
}

function roamTarget(h: Human){
  const n=W.nations[h.o], r=W.prand;
  if (h.kind===H_SOLDIER){
    // on guard round a watchtower, waiting in front of his army's barracks, or (with neither) patrolling the city
    const b = h.post>=0 ? -1 : h.base>=0 && standing(h.base,B_BARRACKS,h.o) ? h.base : -1;
    const [cx,cy] = h.post>=0 ? frontOf(h.post) : b>=0 ? frontOf(b) : n.capTile>=0 ? doorOf(n) : [h.x,h.y];
    const rx = h.post>=0 ? 10 : b>=0 ? 9 : PATROL_R, ry = h.post>=0 ? 8 : b>=0 ? 3 : PATROL_R*0.6, dy = b>=0 ? 3 : 0;
    h.tx=h.x; h.ty=h.y;
    for (let k=0;k<4;k++){
      const x=cx+(r()*2-1)*rx, y=cy+dy+(r()*2-1)*ry;
      if (ownFree(h.o,x,y) && !onCastle(n,x,y)){ h.tx=x; h.ty=y; break; }
    }
    h.wait=(b>=0 ? 3+r()*5 : 1+r()*3)/TICK; route(h); return;
  }
  // villagers with nothing to do: stroll to a nearby building of their own kingdom (builders wait by their guild)
  let bx=h.x, by=h.y, bd=1e9, gate=false;
  h.tx=h.x; h.ty=h.y;
  if (h.work>=0){ const [x,y]=frontOf(h.work+(pType[h.work]===B_GUILD && r()<0.5 ? 1 : 0)); bx=x; by=y; bd=0; }
  for (let k=0;k<6 && bd>0;k++){ if (!n.blds.length) break; const q=n.blds[(r()*n.blds.length)|0];
    const castle=pType[q]===B_CASTLE||pType[q]===B_CPART;
    if (castle && n.capTile<0) continue;
    const [x,y] = castle ? doorOf(n) : [(q%PW)*8+4, ((q/PW)|0)*8+7], d=Math.abs(x-h.x)+Math.abs(y-h.y);
    if (d>4 && d<60 && d<bd && ownFree(h.o,x,y)){ bd=d; bx=x; by=y; gate=castle; } }   // a house on the border may stand half on enemy ground
  // with no building in reach they just take a step or two where they stand
  const tx=bx+(r()*4-2), ty=by+(gate ? r()*1.5 : r()*2-1);   // at the gate, stand in front of it
  if (ownFree(h.o,tx,ty) && !onCastle(n,tx,ty)){ h.tx=tx; h.ty=ty; }
  h.wait=(0.5+r()*2.5)/TICK; route(h);
}

/* ---------- villager work ---------- */
/** Picks which good to fetch: the one the kingdom is shortest of, weighed against how far away
    the nearest one is. `have` counts goods stored plus those already on their way; `dist` is in
    pixels, Infinity when there is none in reach. Returns the good, or -1. */
export function chooseGood(have: number[], dist: number[]){
  const total=have[0]+have[1]+have[2];
  let best=-1, bc=Infinity;
  for (let g=0;g<3;g++){
    if (!(dist[g]<Infinity)) continue;
    const share = total>0 ? have[g]/total : 1/3;
    const need = 1.1-share;                        // 0.1 (we have nothing else) .. 1.1 (we have none of it)
    const cost = (dist[g]+8)/(need*need);          // 8 px of fixed overhead per trip
    if (cost<bc){ bc=cost; best=g; }
  }
  return best;
}

const pending: number[][]=[];   // per nation: goods already claimed or on their way home, updated each tick

const CANDIDATES = 3;   // spots remembered per good, nearest first, in case the nearest can't be reached
/** The nearest free resources of each good on the kingdom's own land, within SEARCH_R tiles. */
function nearestResources(h: Human){
  const found: [number, number][][]=[[],[],[]];   // per good: [distance, tile], nearest first
  const here=W.nations[h.o].resHere;   // a good the kingdom has none of left needn't be looked for
  const far=(g: number)=>!here[g] ? -1 : found[g].length<CANDIDATES ? Infinity : found[g][CANDIDATES-1][0];
  const cx=(h.x/2)|0, cy=(h.y/2)|0;
  for (let r=0;r<=SEARCH_R;r++){
    // a tile on ring r is at least 2r pixels away: stop once every good's list is closer than that
    if (far(0)<2*r && far(1)<2*r && far(2)<2*r) break;
    for (let dy=-r;dy<=r;dy++){
      const y=cy+dy; if (y<0||y>=TH) continue;
      const step = (dy===-r||dy===r) ? 1 : 2*r;
      for (let dx=-r;dx<=r;dx+=step || 1){
        const x=cx+dx; if (x<0||x>=TW) continue;
        const t=y*TW+x; if (owner[t]!==h.o || occ[t] || !available(t)) continue;
        const g=GOOD_OF[resType[t]], [sx,sy]=workSpot(t), d=Math.sqrt((sx-h.x)**2+(sy-h.y)**2), L=found[g];
        if (L.length===CANDIDATES && (d>L[CANDIDATES-1][0] || (d===L[CANDIDATES-1][0] && t>L[CANDIDATES-1][1]))) continue;
        let i=L.length; while (i>0 && (L[i-1][0]>d || (L[i-1][0]===d && L[i-1][1]>t))) i--;
        L.splice(i,0,[d,t]); if (L.length>CANDIDATES) L.pop();
      }
    }
  }
  return found;
}

export function release(h: Human){
  if (h.res>=0){ resBusy[h.res]=0; h.res=-1; }
  if (h.home>=0){ cancelSite(h.home); h.home=-1; }   // an unfinished house is given up
  h.fix=-1;
}
function store(h: Human){
  if (h.carry<0) return;
  const n=W.nations[h.o];
  n.stock[h.carry]+=h.amount; gained(n,h.carry,h.amount); on.stored(h.o,h.carry,h.amount);
  h.carry=-1; h.amount=0;
}

const housing: { people: number; builders: number }[]=[];   // per nation, updated each tick

/** Short of homes: more people than houses, counting the ones already being built. */
function needsHome(n: Nation){ const k=housing[n.id]; return !!k && k.people > n.beds + k.builders; }

/** Picks a plot for a new house and sets off to build it. Returns false if there is nowhere suitable. */
function goBuildHome(h: Human){
  const n=W.nations[h.o], r=W.prand; if (!n.plots.length) return false;
  const cands: [number, number][]=[];
  for (let k=0;k<20;k++){
    const q=n.plots[(r()*n.plots.length)|0], w=homeScore(n,q)*(0.5+r());
    if (w>0 && !cands.some(c=>c[1]===q)) cands.push([w,q]);
  }
  cands.sort((a,b)=>b[0]-a[0] || a[1]-b[1]);
  // the best he can walk to round the castle; failing that, a roof matters more than looks: a builder
  // may cut across the castle, but never leaves the kingdom's land
  for (const picky of [true,false]) for (const [,q] of cands.slice(0,8)){
    const [x,y]=frontOf(q);
    h.tx=x; h.ty=y; h.task=TASK_HOME_GO;
    if (route(h,picky)){ startSite(q,h.o); h.home=q; h.wait=0; housing[h.o].builders++; return true; }
  }
  h.task=TASK_ROAM;
  return false;
}

/** A villager between jobs decides what to do next: first a roof over everyone's head, then work. */
function think(h: Human){
  const n=W.nations[h.o];
  release(h); h.task=TASK_ROAM;
  if (h.beggar){ roamTarget(h); return; }   // beggars just drift about town
  if (h.work>=0 && h.kind===H_VILLAGER){ if (!(pType[h.work]===B_SMITHY ? goForge(h) : goImprove(h))) roamTarget(h); return; }   // builders and smiths work, or wait at their workshop
  if (h.kind===H_VILLAGER && needsHome(n) && goBuildHome(h)) return;
  if (h.kind!==H_VILLAGER || n.capTile<0){ roamTarget(h); return; }   // nowhere to store anything without a capital
  const found=nearestResources(h), have=n.stock.map((s,g)=>s+(pending[h.o]?.[g] ?? 0));
  for (let tries=0;tries<3*CANDIDATES;tries++){
    const g=chooseGood(have,found.map(L=>L.length ? L[0][0] : Infinity)); if (g<0) break;
    const t=found[g].shift()![1], [sx,sy]=workSpot(t);
    // the load has to come home too, so check the way back to the gate as well
    const [dx,dy]=doorOf(n), back: Human={ ...h, x:sx, y:sy, tx:dx, ty:dy, path:[], task:TASK_HAUL };
    h.tx=sx; h.ty=sy; h.task=TASK_GATHER;
    if (route(back,true) && route(h,true)){ h.res=t; resBusy[t]=1; h.wait=0; return; }
    // can't get there and back without leaving our land or climbing the castle: try the next spot
  }
  h.task=TASK_ROAM; roamTarget(h);
  if (!found[0].length && !found[1].length && !found[2].length) h.wait=Math.max(h.wait,(4+W.prand()*4)/TICK);   // nothing to gather in reach: idle a while before looking again
}

/** A new person of kingdom n standing at (x,y), with nothing to do yet. */
export function makeHuman(n: Nation, kind: number, x: number, y: number): Human {
  return { id:++W.humanSeq, o:n.id, kind, militia:false, to:0, task:TASK_ROAM, x, y, tx:x, ty:y, path:[], wait:0, sp:(kind===H_SOLDIER?4:3)+W.prand()*2,
    res:-1, carry:-1, amount:0, hp:kind===H_SOLDIER?SOLDIER_HP[1]:VILLAGER_HP, post:-1, site:-1, home:-1, housed:false, homeless:0, beggar:false,
    war:-1, loot:false, foe:-1, aim:-1, cool:0, slot:0, brave:-1, calm:0, work:-1, fix:-1, lead:0, fk:-1, line:-1, fx:x, fy:y,
    tier:kind===H_SOLDIER?1:0, base:-1, load:0, make:0, dest:-1 };
}
/** A new villager or militiaman walks out of the capital; a new soldier out of the barracks nearest the capital. */
function spawnHuman(n: Nation, kind: number, barracks: number[], militia=false){
  const [cx,cy]=doorOf(n), [x,y] = kind===H_SOLDIER && !militia ? frontOf(nearestPlot(barracks,cx,cy)) : [cx,cy];
  const h=makeHuman(n,kind,x,y);
  if (militia){ h.militia=true; h.hp=MILITIA_HP; h.sp-=SPEED_UP[T_SOLDIER]-SPEED_UP[T_MILITIA]; }
  W.humans.push(h);
  if (housing[n.id]) housing[n.id].people++;   // counts himself before deciding whether he needs a home
  think(h); h.wait=0;
}

/** Sends h to plot b (a barracks, or the castle for militia) to come out as `to` (T_*). A soldier who
    can't get there without leaving the kingdom or climbing the castle stays where he is (returns false). */
function sendToTrain(h: Human, b: number, to: number){
  const n=W.nations[h.o], [x,y]=pType[b]===B_CASTLE ? doorOf(n) : frontOf(b), was=[h.task,h.tx,h.ty,h.wait] as const, path=h.path;
  h.task=TASK_TO_TRAIN; h.tx=x; h.ty=y;
  const picky=h.kind===H_SOLDIER && !h.militia;   // (militia go the way villagers do)
  if (!route(h,picky) && picky){ [h.task,h.tx,h.ty,h.wait]=was; h.path=path; return false; }   // a soldier out on patrol can wait for a better moment
  release(h); h.post=-1; h.site=b; h.to=to; h.wait=0;
  return true;
}
/** Back out into the world: soldiers resume their patrol, villagers pause a moment and think. */
export { think };
export function backToRoam(h: Human){
  release(h); h.task=TASK_ROAM; h.path=[]; h.site=-1;
  if (h.kind===H_SOLDIER){ roamTarget(h); h.wait=0; }
  else { h.tx=h.x; h.ty=h.y; h.wait=(0.3+W.prand()*0.7)/TICK; }
}

// nearest candidates first, ties by id, so every client picks the same people
function nearest(list: Human[], cx: number, cy: number){
  return list.sort((a,b)=>((a.x-cx)**2+(a.y-cy)**2)-((b.x-cx)**2+(b.y-cy)**2) || a.id-b.id);
}

/** Under arms: soldiers and militia, counting those on their way to switch as what they will be. */
const armed = (mine: Human[]) => { let k=0; for (const h of mine) k += switching(h) ? +(h.to!==T_VILLAGER) : +(h.kind===H_SOLDIER); return k; };
/** Free places in each of n's barracks: its room, less its soldiers and those on their way to train there.
    (Counted from the soldiers themselves: the barracks are only told who is theirs later in the tick.) */
function roomIn(n: Nation, mine: Human[]){
  const room=new Map<Unit, number>();
  for (const u of units[n.id] ?? []) room.set(u,u.cap);
  for (const h of mine){
    const q = h.kind===H_SOLDIER && !h.militia && h.base>=0 ? h.base : switching(h) && h.to===T_SOLDIER ? h.site : -1;
    const u=q>=0 ? unitAt(q) : undefined; if (u && room.has(u)) room.set(u,room.get(u)!-1);
  }
  return room;
}
/** True while n's militia are called up to a front: they fight as they are, and nobody fills the barracks from them. */
const reservesOut = (n: Nation) => W.campaigns.some(c => c.militia && c.a===n.id && c.phase<2);

/** Moves the kingdom's headcount toward its requested share under arms. Free places in the barracks
    go to militia first, one at a time to each barracks; then to villagers; once the barracks are
    full, villagers train at the castle as militia. With too many under arms, militia stand down first. */
function balance(n: Nation, mine: Human[], barracks: number[]){
  if (n.capTile<0){
    // no capital: nowhere to store anything, so loads are dropped and gathering stops
    for (const h of mine) if (h.kind===H_VILLAGER && h.task>=TASK_GATHER && h.task<=TASK_STORE){ h.carry=-1; h.amount=0; backToRoam(h); }
  }
  if (!barracks.length){
    // no barracks: nobody can train; anyone on the way turns back, anyone inside walks back out
    for (const h of mine) if (switching(h)) backToRoam(h);
    return;
  }
  const room=roomIn(n,mine);
  // militia at home (not on guard at a watchtower) take the free places, one walking to each barracks at a time
  const militia=reservesOut(n) ? [] : mine.filter(h => homeMilitia(h) && h.post<0);
  let forMilitia=0;
  if (militia.length){
    const busy=new Set<Unit>(); for (const h of mine) if (switching(h) && h.militia && h.to===T_SOLDIER){ const u=unitAt(h.site); if (u) busy.add(u); }
    let left=militia.length;
    for (const [u,k] of room){
      if (k<=0) continue;
      forMilitia+=Math.min(k,left); left=Math.max(0,left-k);
      if (busy.has(u)) continue;
      const pick=nearest(militia.filter(h => !switching(h)),u.x,u.y)[0];
      if (pick && sendToTrain(pick,nearestPlot(u.plots,pick.x,pick.y),T_SOLDIER)) room.set(u,k-1);
    }
  }
  let spare=0; for (const k of room.values()) spare+=Math.max(0,k);
  spare=Math.max(0,spare-forMilitia);   // what is left once the militia have their places
  let diff=Math.round(n.soldierShare*mine.length)-armed(mine);
  if (!diff) return;
  if (diff>0 && n.gold<0) return;   // nobody signs up while there is no money for wages
  // first turn back anyone still walking to switch the other way
  for (const h of mine){ if (!diff) return; if (h.task===TASK_TO_TRAIN && (diff>0 ? h.to===T_VILLAGER : h.kind===H_VILLAGER)){ backToRoam(h); diff+=diff>0 ? -1 : 1; } }
  const away=(h: Human)=>{ const [x,y]=frontOf(nearestPlot(barracks,h.x,h.y)); return (h.x-x)**2+(h.y-y)**2; };
  const free=(h: Human) => !switching(h) && !h.beggar && h.task!==TASK_STORE && h.carry<0 && h.home<0 && h.war<0 && h.work<0;
  if (diff>0){
    // villagers nearest a barracks: into its free places while there are any, else to the castle as militia
    const cands=mine.filter(h => free(h) && h.kind===H_VILLAGER).sort((a,b) => away(a)-away(b) || a.id-b.id);
    for (const h of cands){
      if (!diff) return;
      let plot=-1;
      if (spare>0){ let bd=Infinity; for (const [u,k] of room) if (k>0){ const q=nearestPlot(u.plots,h.x,h.y), [x,y]=frontOf(q), e=(h.x-x)**2+(h.y-y)**2; if (e<bd){ bd=e; plot=q; } } }
      if (plot>=0){ if (sendToTrain(h,plot,T_SOLDIER)){ const u=unitAt(plot)!; room.set(u,room.get(u)!-1); spare--; diff--; } }
      else if (n.capTile>=0 && sendToTrain(h,n.capPlot,T_MILITIA)) diff--;
    }
    return;
  }
  // too many: militia go back to work first (at the castle), then soldiers (at a barracks), the least armoured first
  diff=-diff;
  const cands=mine.filter(h => free(h) && h.kind===H_SOLDIER).sort((a,b)=>(+b.militia - +a.militia) || a.tier-b.tier || away(a)-away(b) || a.id-b.id);
  for (const h of cands){ if (!diff) return; if (h.militia ? n.capTile>=0 && sendToTrain(h,n.capPlot,T_VILLAGER) : sendToTrain(h,nearestPlot(barracks,h.x,h.y),T_VILLAGER)) diff--; }
}
/** Trained soldiers at home with no place in a barracks (theirs fell, or shrank) serve on as militia. */
function demote(mine: Human[]){
  for (const h of mine){
    if (h.kind!==H_SOLDIER || h.militia || h.base>=0 || h.war>=0 || h.hp<=0 || switching(h)) continue;
    h.militia=true; h.tier=1; h.sp-=SPEED_UP[T_SOLDIER]-SPEED_UP[T_MILITIA]; h.hp=Math.min(h.hp,maxHp(h));   // (his armour is lost with his barracks)
  }
}

/** Shares out idle soldiers among the watchtowers calling for a garrison, one at a time in the
    order the towers called, so 5 soldiers for 2 towers go 3 and 2. */
function garrison(n: Nation, mine: Human[]){
  const towers=n.blds.filter(q => standing(q,B_TOWER,n.id) && pPrio[q]).sort((a,b) => pPrio[a]-pPrio[b]);
  const count=new Map(towers.map(q => [q,0]));
  for (const h of mine){
    if (h.kind!==H_SOLDIER || h.post<0) continue;
    if (h.base>=0){ h.post=-1; continue; }   // he has joined an army
    if (count.has(h.post)) count.set(h.post, count.get(h.post)!+1);
    else { h.post=-1; if (!switching(h)) backToRoam(h); }   // that tower stopped asking or is gone: back to the barracks
  }
  const idle=mine.filter(h => h.kind===H_SOLDIER && h.post<0 && h.base<0 && h.war<0 && !switching(h));   // only soldiers with no room in a barracks guard towers
  for (let progress=true; progress && idle.length;){
    progress=false;
    for (const q of towers){
      if (!idle.length) break;
      if (count.get(q)!>=GARRISON) continue;
      const [x,y]=frontOf(q), h=nearest(idle,x,y).shift()!;
      h.post=q; count.set(q, count.get(q)!+1); backToRoam(h); progress=true;
    }
  }
}

/** Hands out the houses, longest-standing people first, and turns long-homeless villagers into beggars. */
function house(n: Nation, mine: Human[]){
  let free=n.beds;
  for (const h of [...mine].sort((a,b)=>a.id-b.id)){
    h.housed = free>0; if (h.housed) free--;
    if (h.housed){
      h.homeless=0;
      if (h.beggar){ h.beggar=false; h.sp=3+W.prand()*2; think(h); }   // a home at last: back to work
    } else if (h.kind===H_VILLAGER && !h.beggar && ++h.homeless>=BEG_TICKS){
      // a minute without a roof: he gives up work, drops what he carries, and begs
      h.carry=-1; h.amount=0; release(h); h.beggar=true; h.sp=1; h.task=TASK_ROAM; h.path=[]; roamTarget(h);
    }
  }
}

/** Houses beyond what the people need stand empty after a while, the outermost first; as the
    kingdom grows again, the innermost empty ones are lived in first. */
function upkeepHouses(n: Nation, people: number){
  const houses=n.blds.filter(q => standing(q,B_HOUSE,n.id));
  const c = n.capTile>=0 ? n.capTile : n.lty*TW+n.ltx, cx=c%TW, cy=(c/TW)|0;
  const away=(q: number)=>((pCenter[q]%TW)-cx)**2+(((pCenter[q]/TW)|0)-cy)**2;
  houses.sort((a,b)=>away(a)-away(b) || a-b);   // innermost first
  // the innermost houses with room for everyone are lived in; the rest are spare
  let lived=0; for (let room=0; lived<houses.length && room<people; lived++) room+=HOUSE_BEDS[pTier[houses[lived]]];
  const excess=houses.length-lived;
  let empty=houses.filter(q => pAband[q]).length;
  // someone moved in: the innermost empty houses come back to life
  for (const q of houses){ if (empty<=excess) break; if (pAband[q]){ pAband[q]=0; empty--; on.plotChanged(q); } }
  if (excess>empty){
    n.surplusTicks+=10;
    if (n.surplusTicks>=ABANDON_TICKS)
      for (let i=houses.length-1;i>=0 && empty<excess;i--){ const q=houses[i]; if (!pAband[q]){ pAband[q]=1; empty++; on.plotChanged(q); } }
  } else n.surplusTicks=0;
  n.abandoned=empty;
}

/* ---------- builders ---------- */
const jitter = (q: number) => 0.8+0.4*((Math.imul(q,2654435761)>>>0)%1000)/1000;   // a fixed wobble per plot
/** True if the house on plot q can still be raised a tier by kingdom n's builders. */
function improvable(n: Nation, q: number){
  if (q<0 || occ[pCenter[q]]) return false;
  if (standing(q,B_HOUSE,n.id)) return pTier[q]<Math.min(n.tier[R_HOUSING],MAX_TIER);
  if (standing(q,B_TOWER,n.id)) return pTier[q]<Math.min(n.tier[R_TOWERS],MAX_TIER);
  return false;
}
/** What rebuilding the house or watchtower on plot q a tier up costs: [wood, stone, copper]. */
export const upgradeCost = (q: number) => pType[q]===B_TOWER ? TOWER_COST[pTier[q]] : FIX_COST;
/** The buildings kingdom n's builders should improve, in order: its watchtowers first (the nearest
    the castle first), then its houses. The town is rebuilt from the castle outward: with manors
    allowed, the innermost houses (the edge a little ragged) are to become manors and the rest stone
    houses; the nearest house short of what it should be comes first. */
export function improvements(n: Nation){
  const c = n.capTile>=0 ? n.capTile : n.lty*TW+n.ltx, cx=c%TW, cy=(c/TW)|0;
  const dist=(q: number)=>Math.sqrt(((pCenter[q]%TW)-cx)**2+(((pCenter[q]/TW)|0)-cy)**2);
  const towers=n.blds.filter(q => improvable(n,q) && pType[q]===B_TOWER).sort((a,b) => dist(a)-dist(b) || a-b);
  const top=Math.min(n.tier[R_HOUSING],MAX_TIER); if (top<2) return towers;
  const houses=n.blds.filter(q => standing(q,B_HOUSE,n.id) && !pAband[q] && !occ[pCenter[q]]);
  const d=new Map(houses.map(q => [q,dist(q)*jitter(q)]));
  houses.sort((a,b)=>d.get(a)!-d.get(b)! || a-b);
  const manors = top>=3 ? Math.ceil(houses.length*MANOR_SHARE) : 0;
  return [...towers, ...houses.filter((q,i) => pTier[q] < (i<manors ? 3 : 2))];
}
/** A builder sets off to improve the next building on the list that the kingdom can pay for, and
    whose cost the city investment allows (sim/ledger.ts). */
function goImprove(h: Human){
  const n=W.nations[h.o];
  const taken=new Set<number>(); for (const o of W.humans) if (o.o===h.o && o.fix>=0) taken.add(o.fix);
  let tries=0;
  for (const q of improvements(n)){
    if (taken.has(q)) continue;
    const cost=upgradeCost(q);
    if (!cost.every((c,g) => n.stock[g]>=c) || !mayInvest(n,cost)) continue;
    const [x,y]=frontOf(q); h.tx=x; h.ty=y; h.task=TASK_FIX_GO;
    if (route(h,true)){ h.fix=q; h.wait=0; return true; }
    if (++tries>=3) break;
  }
  h.task=TASK_ROAM;
  return false;
}
/** The builder finishes: the building goes up a tier, as good as new, if the kingdom can still pay. */
function improve(n: Nation, q: number){
  const cost=upgradeCost(q);
  if (!cost.every((c,g) => n.stock[g]>=c)) return;
  cost.forEach((c,g) => { n.stock[g]-=c; if (c) spent(n,g,c); });
  pTier[q]++; pHp[q]=0;
  if (pType[q]===B_HOUSE) n.beds+=HOUSE_BEDS[pTier[q]]-HOUSE_BEDS[pTier[q]-1];
  on.plotChanged(q); on.upgraded(q,n.id,pTier[q]);
}
/** Every builders guild has one builder and every blacksmith one smith. A workshop without its
    worker takes the villager nearest it, straight away when it is new, a while after he fell. */
const workshop = (q: number, id: number) => standing(q,B_GUILD,id) || standing(q,B_SMITHY,id);
function staffGuilds(n: Nation, mine: Human[]){
  const staffed=new Set<number>();
  for (const h of mine){
    if (h.work<0) continue;
    if (!workshop(h.work,n.id) || h.kind!==H_VILLAGER || h.beggar || staffed.has(h.work)){
      const busy=h.fix>=0 || h.make>0 || h.load>0;
      h.work=-1; h.load=0; h.make=0; h.dest=-1; if (busy) backToRoam(h); continue;   // whatever he carried is lost
    }
    staffed.add(h.work);
  }
  if (staffed.size===n.guilds+n.smithies) return;
  let free: Human[] | null=null;
  for (const q of n.blds){
    if (staffed.has(q) || !workshop(q,n.id)) continue;
    if (pTimer[q]>1){ pTimer[q]--; continue; }   // his replacement is on the way
    free ??= mine.filter(h => h.kind===H_VILLAGER && h.work<0 && !h.beggar && !switching(h) && h.brave<0 && h.carry<0 && h.home<0 && h.task!==TASK_STORE);
    const [x,y]=frontOf(q), h=nearest(free,x,y).shift(); if (!h) return;
    const replaced=pTimer[q]===1; pTimer[q]=0;
    release(h); h.work=q; think(h); h.wait=0;
    on.builderHired(q,n.id,replaced);
  }
}

/* ---------- wages ---------- */
/** With the treasury below zero for 10 seconds, unpaid soldiers start laying down their arms where
    they stand, one every 3 seconds: the least armoured first, those at home before those away.
    A deserter's armour is scrapped, and the kingdom gets 30 gold for each tier of it. */
function payroll(n: Nation, mine: Human[]){
  if (n.gold>=0){ n.unpaid=0; return; }
  if (++n.unpaid<UNPAID_TICKS || (n.unpaid-UNPAID_TICKS)%DESERT_TICKS) return;
  const home=(h: Human) => owner[tileOf(h.x,h.y)]===h.o ? 0 : 1;
  const h=mine.filter(h => h.kind===H_SOLDIER && (!h.militia || h.war>=0) && h.hp>0 && !indoors(h)).sort((a,b) => a.tier-b.tier || home(a)-home(b) || a.id-b.id)[0];
  if (!h) return;
  const tier=h.tier, gold=tier>=2 ? SCRAP_GOLD*tier : 0, f=h.hp/maxHp(h);
  n.gold+=gold;
  release(h); h.sp-=SPEED_UP[h.militia ? T_MILITIA : T_SOLDIER]; h.kind=H_VILLAGER; h.militia=false; h.tier=0; h.base=-1; h.post=-1; h.site=-1; h.war=-1; h.foe=-1; h.aim=-1; h.loot=false; h.slot=0; h.brave=-1; h.calm=0;
  h.hp=Math.max(0.5,VILLAGER_HP*f);
  backToRoam(h);
  on.deserted(n.id,h.x,h.y,tier,gold);
}

/* ---------- blacksmiths ---------- */
/** Pieces of armour kingdom n's smiths are already making, per barracks: [_, _, tier 2, tier 3]. */
function forging(n: Nation){
  const out=new Map<Unit, number[]>();
  for (const s of W.humans){
    if (s.o!==n.id || s.make<2) continue;
    const u=unitAt(s.dest); if (!u) continue;
    let p=out.get(u); if (!p){ p=[0,0,0,0]; out.set(u,p); } p[s.make]++;
  }
  return out;
}
/** A smith between jobs: carries on with what he holds, or takes the next piece the barracks want. */
function goForge(h: Human){
  const n=W.nations[h.o];
  if (h.load===1){   // copper in hand: back to the forge
    const [x,y]=frontOf(h.work); h.tx=x; h.ty=y; h.task=TASK_SMITH_BACK; route(h); h.wait=0; return true;
  }
  if (h.load>=2){    // armour in hand: to the barracks it was made for, or the nearest one left
    let u=unitAt(h.dest);
    if (!u || u.o!==h.o){ const U=units[h.o] ?? []; u=U.slice().sort((a,b)=>((a.x-h.x)**2+(a.y-h.y)**2)-((b.x-h.x)**2+(b.y-h.y)**2) || a.key-b.key)[0]; }
    if (!u) return false;   // no barracks at all: he waits with it
    if (unitAt(h.dest)!==u) h.dest=nearestPlot(u.plots,h.x,h.y);
    const [x,y]=frontOf(h.dest); h.tx=x; h.ty=y; h.task=TASK_SMITH_DELIVER; route(h); h.wait=0; return true;
  }
  if (n.capTile<0 || n.stock[2]<ARMOR_COPPER) return false;
  // the barracks nearest the smithy that still wants armour
  const made=forging(n), [sx,sy]=frontOf(h.work);
  let best: Unit | undefined, tier=0, bd=Infinity;
  for (const u of units[h.o] ?? []){
    const t=armorWanted(n,u,made.get(u) ?? [0,0,0,0]); if (!t) continue;
    const d=(u.x-sx)**2+(u.y-sy)**2; if (d<bd){ bd=d; best=u; tier=t; }
  }
  if (!best) return false;
  h.make=tier; h.dest=nearestPlot(best.plots,sx,sy);
  const [x,y]=doorOf(n); h.tx=x; h.ty=y; h.task=TASK_SMITH_FETCH; h.wait=0;
  if (!route(h)){ h.make=0; h.dest=-1; h.task=TASK_ROAM; return false; }
  return true;
}

function step(h: Human){
  const n=W.nations[h.o];
  if (switching(h) && !siteStands(h)){ backToRoam(h); return; }   // the barracks was lost
  if (h.task===TASK_INSIDE){
    if (--h.wait<=0){
      const to=h.to, was=h.kind!==H_SOLDIER ? T_VILLAGER : h.militia ? T_MILITIA : T_SOLDIER;
      h.sp+=SPEED_UP[to]-SPEED_UP[was];
      if (to===T_VILLAGER){ if (was===T_SOLDIER && h.tier>=2) pArmor[h.tier][h.site]++; h.kind=H_VILLAGER; h.militia=false; h.tier=0; h.base=-1; }   // his armour goes back on the racks
      else { h.kind=H_SOLDIER; h.militia=to===T_MILITIA; h.tier=1; h.base=to===T_SOLDIER ? h.site : -1; }   // a new soldier takes the place he trained for
      h.to=T_VILLAGER; h.hp=maxHp(h); backToRoam(h); on.roleChanged(h.x,h.y,h.kind);
    }
    return;
  }
  if (h.kind===H_SOLDIER ? guardStep(h) : alarmStep(h)) return;   // at war: soldiers defend, villagers run or fight
  if (h.task===TASK_STORE){ if (--h.wait<=0){ store(h); backToRoam(h); } return; }
  if (h.task===TASK_HARVEST){
    if (owner[h.res]!==h.o || !resType[h.res]){ think(h); return; }   // the ground was lost or built over
    if (--h.wait<=0){
      const t=h.res, good=GOOD_OF[resType[t]], got=harvest(t);
      release(h);
      if (!got){ think(h); return; }
      h.carry=good; h.amount=got;
      const [x,y]=doorOf(n); h.task=TASK_HAUL; h.tx=x; h.ty=y; route(h);
    }
    return;
  }
  if (h.task===TASK_GATHER && (owner[h.res]!==h.o || !resType[h.res])){ think(h); return; }
  if ((h.task===TASK_HOME_GO || h.task===TASK_HOME_BUILD) && (pType[h.home]!==B_SITE || owner[pCenter[h.home]]!==h.o)){ think(h); return; }   // the site was lost
  if (h.task===TASK_HOME_BUILD){
    if (--h.wait<=0){ const q=h.home; h.home=-1; finishHouse(q,h.o); think(h); }
    return;
  }
  if (h.task===TASK_FORGE){
    if (--h.wait<=0){ h.load=h.make; think(h); }   // the armour is done: off to the barracks with it
    return;
  }
  if ((h.task===TASK_FIX_GO || h.task===TASK_FIX) && !improvable(n,h.fix)){ think(h); return; }   // the house burned, was lost or is done
  if (h.task===TASK_FIX){
    if (--h.wait<=0){ improve(n,h.fix); think(h); }
    return;
  }
  if (h.wait>0){ h.wait--; return; }
  const way=h.path.length>0, gx=way?h.path[0]:h.tx, gy=way?h.path[1]:h.ty;
  const dx=gx-h.x, dy=gy-h.y, d=Math.sqrt(dx*dx+dy*dy);
  // on arrival, step exactly onto the spot: every leg was checked from there
  if (d<0.6 && way){ h.x=gx; h.y=gy; h.path.splice(0,2); return; }
  if (d<0.6){
    h.x=gx; h.y=gy;
    if (h.task===TASK_TO_TRAIN){ h.task=TASK_INSIDE; h.wait=TRAIN_TICKS; return; }
    if (h.task===TASK_GATHER){ h.task=TASK_HARVEST; h.wait=WORK_TICKS[resType[h.res]]; return; }
    if (h.task===TASK_HOME_GO){ h.task=TASK_HOME_BUILD; h.wait=BUILD_TICKS; return; }
    if (h.task===TASK_FIX_GO){ h.task=TASK_FIX; h.wait=FIX_TICKS; return; }
    if (h.task===TASK_SMITH_FETCH){
      if (n.stock[2]>=ARMOR_COPPER){ n.stock[2]-=ARMOR_COPPER; spent(n,2,ARMOR_COPPER); h.load=1; } else h.make=0;   // no copper in store: the job is off
      think(h); return;
    }
    if (h.task===TASK_SMITH_BACK){ h.task=TASK_FORGE; h.wait=FORGE_TICKS; return; }
    if (h.task===TASK_SMITH_DELIVER){
      if (standing(h.dest,B_BARRACKS,h.o)){ pArmor[h.load][h.dest]++; const u=unitAt(h.dest); if (u) u.stored[h.load]++; on.forged(h.dest,h.o,h.load); h.load=0; h.make=0; h.dest=-1; }   // on the racks at once, so the next job counts it
      think(h); return;
    }
    if (h.task===TASK_HAUL){ h.task=TASK_STORE; h.x=h.tx; h.y=h.ty; h.wait=STORE_TICKS; return; }
    think(h); return;
  }
  const sp=h.carry>=0 ? h.sp*0.85 : pace(h);   // a little slower under a load
  const st=Math.min(d,sp*TICK); h.x+=dx/d*st; h.y+=dy/d*st;
}

export function updatePopulation(){
  const N=W.nations, H=W.humans;
  // people die when their kingdom falls, the ground under them is taken, or they fall in battle
  for (let i=H.length-1;i>=0;i--){
    const h=H[i];
    if (!N[h.o].alive || !mayStand(h,owner[tileOf(h.x,h.y)]) || h.hp<=0){
      if (h.hp<=0 && N[h.o].alive) on.died(h.x,h.y,h.o,h.id,h.kind===H_SOLDIER ? 1 : h.beggar ? 2 : 0,h.militia ? 0 : h.tier);   // they drop where they fell
      if (h.work>=0 && (pType[h.work]===B_GUILD || pType[h.work]===B_SMITHY)) pTimer[h.work]=REHIRE_TICKS+1;   // the workshop waits a while for a new hand
      release(h); H[i]=H[H.length-1]; H.pop();
    }
  }
  buildUnits();  // which barracks stand, and their armies
  updateWar();   // armies, watchtowers and who is fighting whom
  const groups: Human[][]=N.map(()=>[]);
  for (const h of H) groups[h.o].push(h);
  for (let i=1;i<N.length;i++){
    const n=N[i], mine=groups[i];
    // goods already promised to this kingdom, so villagers spread over what it lacks
    const p=pending[i] ??= [0,0,0]; p[0]=p[1]=p[2]=0;
    for (const h of mine){
      if (h.carry>=0) p[h.carry]+=h.amount;
      else if (h.res>=0) p[GOOD_OF[resType[h.res]]]+=YIELD[resType[h.res]];
    }
    if (!n.alive) continue;
    const k=housing[i] ??= { people:0, builders:0 };
    k.people=mine.length; k.builders=0; for (const h of mine) if (h.home>=0) k.builders++;
    if (W.tickN%10===3) upkeepHouses(n, mine.length);
    house(n, mine);
    const barracks=barracksOf(n);
    if (n.capTile>=0 && (n.humanProg+=1+FARM_BONUS*n.farms)>=HUMAN_EVERY){
      n.humanProg-=HUMAN_EVERY;
      // newcomers fill the ranks first while the kingdom is short of soldiers (if it has a barracks):
      // a soldier while a barracks has room the militia aren't taking, else a militiaman
      const soldier = barracks.length>0 && n.gold>=0 && armed(mine)<Math.round(n.soldierShare*(mine.length+1));
      let room=0; if (soldier){ for (const k of roomIn(n,mine).values()) room+=Math.max(0,k); if (!reservesOut(n)) room-=mine.filter(h => homeMilitia(h) && h.post<0).length; }
      spawnHuman(n, soldier ? H_SOLDIER : H_VILLAGER, barracks, soldier && room<=0);
      mine.push(H[H.length-1]);
    }
    payroll(n, mine);
    balance(n, mine, barracks);
    for (const h of station(n, mine, switching)) if (!indoors(h) && !switching(h) && h.task===TASK_ROAM) backToRoam(h);   // off to his barracks
    demote(mine);
    armUp(n, switching);
    garrison(n, mine);
    staffGuilds(n, mine);
  }
  if (W.tickN%10===5) reinforce();   // soldiers at their barracks join its army in the field
  for (const h of H) if (h.war>=0) marchStep(h); else step(h);
  spread();   // fighters keep a little room between them
  // headcount after everyone has moved, so it matches what is on the map this tick
  for (const n of N){ n.villagers=0; n.soldiers=0; n.militia=0; n.called=0; n.training=0; n.beggars=0; n.homeless=0; n.taxpayers=0; }
  for (const h of H){
    const n=N[h.o];
    if (h.kind===H_SOLDIER){ n.soldiers++; if (h.militia){ n.militia++; if (h.war>=0) n.called++; } } else if (h.beggar) n.beggars++; else { n.villagers++; if (h.housed) n.taxpayers++; }
    if (!h.housed) n.homeless++;
    if (switching(h)) n.training++;
  }
}
