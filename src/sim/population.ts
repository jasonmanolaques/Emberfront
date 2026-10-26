/* ---------- population: humans leave the capital, work as villagers or serve as soldiers ----------
   The capital releases a new human every 10 seconds, sooner with each farm.
   Soldiers need a barracks: it trains them and is where they wait. Each kingdom keeps a requested
   soldier share. When it has too few soldiers, newcomers are born soldiers at the barracks and
   the nearest villagers walk there to train; with too many, the nearest soldiers walk in and
   come back out as villagers.
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
   Soldiers never gather. They wait at their barracks, or guard a watchtower that calls for
   them, until the kingdom sends them to war (sim/war.ts). */
import { TW, TH, PW, TICK, B_CASTLE, B_CPART, B_BARRACKS, B_TOWER, B_HOUSE, B_SITE, B_GUILD } from '../core/constants';
import { W, owner, occ, pType, pOwner, pBurn, pPrio, pAband, pCenter, pTimer, pTier, pHp, resType, resBusy, type Human, type Nation } from './state';
import { homeScore, startSite, cancelSite, finishHouse } from './buildings';
import { on } from './events';
import { GOOD_OF, YIELD, WORK_TICKS, available, harvest } from './resources';
import { updateWar, marchStep, guardStep, alarmStep, mayStand, spread } from './war';
import { HOUSE_BEDS, R_HOUSING, MAX_TIER } from './research';

export const H_VILLAGER = 0, H_SOLDIER = 1;
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
             TASK_FIX = 10;      // improving it
export const HUMAN_EVERY = 100;  // progress per new human: 100 ticks (10 s), each farm adds 5% speed
export const FARM_BONUS = 0.05;
const TRAIN_TICKS = 30;          // ticks inside the barracks to switch role (3 s)
const STORE_TICKS = 10;          // ticks inside the capital to store a load (1 s)
const PATROL_R = 36;             // pixels around the capital door soldiers patrol when there is no barracks
export const SOLDIER_HP = 11, VILLAGER_HP = 6;
export const HOME_PACE = 1.15;   // soldiers on their own kingdom's land move 15% faster
export const REGEN = 0.01;        // hit points everyone heals a tick (0.1 a second)
export const GARRISON = 5;       // soldiers a watchtower calls for
export const TOWER_RANGE = 32;   // pixels a watchtower can shoot
export const TOWER_RELOAD = 40;  // ticks between shots (4 s)
export const TOWER_DMG = 2;
const SEARCH_R = 40;             // tiles a villager looks around for work
export const BUILD_TICKS = 40;   // ticks to put up a house (4 s)
export const BEG_TICKS = 600;    // ticks homeless before a villager turns beggar (60 s)
export const ABANDON_TICKS = 200;// ticks with more houses than people before the extra ones stand empty (20 s)
export const FIX_TICKS = 50;     // ticks a builder works to raise a house a tier (5 s)
export const FIX_COST = [3,3,0]; // what each improvement costs: [wood, stone, copper]
export const REHIRE_TICKS = 50;  // ticks after a builder falls before another villager takes his place (5 s)
const MANOR_SHARE = 0.4;         // with manors allowed, the innermost 40% of houses become manors

/** Switching role: walking to a barracks for it, or inside training. */
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
    // on guard round a watchtower, waiting in front of the nearest barracks, or (with neither) patrolling the capital
    const b = h.post>=0 ? -1 : nearestPlot(barracksOf(n),h.x,h.y);
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
  if (h.guild>=0){ const [x,y]=frontOf(h.guild+(r()<0.5 ? 1 : 0)); bx=x; by=y; bd=0; }
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
  const far=(g: number)=>found[g].length<CANDIDATES ? Infinity : found[g][CANDIDATES-1][0];
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
  n.stock[h.carry]+=h.amount; on.stored(h.o,h.carry,h.amount);
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
  for (const [,q] of cands.slice(0,3)){
    const [x,y]=frontOf(q);
    h.tx=x; h.ty=y; h.task=TASK_HOME_GO;
    // a roof matters more than looks: a builder may cut across the castle, but never leaves the kingdom's land
    if (route(h)){ startSite(q,h.o); h.home=q; h.wait=0; housing[h.o].builders++; return true; }
  }
  h.task=TASK_ROAM;
  return false;
}

/** A villager between jobs decides what to do next: first a roof over everyone's head, then work. */
function think(h: Human){
  const n=W.nations[h.o];
  release(h); h.task=TASK_ROAM;
  if (h.beggar){ roamTarget(h); return; }   // beggars just drift about town
  if (h.guild>=0 && h.kind===H_VILLAGER){ if (!goImprove(h)) roamTarget(h); return; }   // builders improve houses, or wait by the guild
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
}

/** A new person of kingdom n standing at (x,y), with nothing to do yet. */
export function makeHuman(n: Nation, kind: number, x: number, y: number): Human {
  return { id:++W.humanSeq, o:n.id, kind, task:TASK_ROAM, x, y, tx:x, ty:y, path:[], wait:0, sp:(kind===H_SOLDIER?4:3)+W.prand()*2,
    res:-1, carry:-1, amount:0, hp:kind===H_SOLDIER?SOLDIER_HP:VILLAGER_HP, post:-1, site:-1, home:-1, housed:false, homeless:0, beggar:false,
    war:-1, loot:false, foe:-1, aim:-1, cool:0, slot:0, brave:-1, calm:0, guild:-1, fix:-1 };
}
/** A new villager walks out of the capital; a new soldier out of the barracks nearest the capital. */
function spawnHuman(n: Nation, kind: number, barracks: number[]){
  const [cx,cy]=doorOf(n), [x,y] = kind===H_SOLDIER ? frontOf(nearestPlot(barracks,cx,cy)) : [cx,cy];
  const h=makeHuman(n,kind,x,y);
  W.humans.push(h);
  if (housing[n.id]) housing[n.id].people++;   // counts himself before deciding whether he needs a home
  think(h); h.wait=0;
}

function sendToTrain(h: Human, barracks: number[]){
  release(h); h.post=-1;
  const b=nearestPlot(barracks,h.x,h.y), [x,y]=frontOf(b);
  h.site=b; h.task=TASK_TO_TRAIN; h.tx=x; h.ty=y; h.wait=0; route(h);
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

/** Moves the kingdom's headcount toward its requested soldier share. */
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
  // soldiers counted as they will be once everyone inside or on the way has switched
  let soldiers=0;
  for (const h of mine) soldiers += switching(h) ? +(h.kind===H_VILLAGER) : +(h.kind===H_SOLDIER);
  const target=Math.round(n.soldierShare*mine.length);
  let diff=target-soldiers;
  if (!diff) return;
  const want=diff>0 ? H_SOLDIER : H_VILLAGER, from=diff>0 ? H_VILLAGER : H_SOLDIER;
  diff=Math.abs(diff);
  // first turn back anyone still walking to switch the other way
  for (const h of mine){ if (!diff) return; if (h.task===TASK_TO_TRAIN && h.kind===want){ backToRoam(h); diff--; } }
  // then the people of the other role nearest a barracks; anyone carrying a load delivers it first
  const away=(h: Human)=>{ const [x,y]=frontOf(nearestPlot(barracks,h.x,h.y)); return (h.x-x)**2+(h.y-y)**2; };
  const cands=mine.filter(h=>!switching(h) && !h.beggar && h.task!==TASK_STORE && h.carry<0 && h.home<0 && h.war<0 && h.guild<0 && h.kind===from).sort((a,b)=>away(a)-away(b) || a.id-b.id);
  for (const h of cands){ if (!diff) return; sendToTrain(h,barracks); diff--; }
}

/** Shares out idle soldiers among the watchtowers calling for a garrison, one at a time in the
    order the towers called, so 5 soldiers for 2 towers go 3 and 2. */
function garrison(n: Nation, mine: Human[]){
  const towers=n.blds.filter(q => standing(q,B_TOWER,n.id) && pPrio[q]).sort((a,b) => pPrio[a]-pPrio[b]);
  const count=new Map(towers.map(q => [q,0]));
  for (const h of mine){
    if (h.kind!==H_SOLDIER || h.post<0) continue;
    if (count.has(h.post)) count.set(h.post, count.get(h.post)!+1);
    else { h.post=-1; if (!switching(h)) backToRoam(h); }   // that tower stopped asking or is gone: back to the barracks
  }
  const idle=mine.filter(h => h.kind===H_SOLDIER && h.post<0 && h.war<0 && !switching(h));
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
  return q>=0 && standing(q,B_HOUSE,n.id) && !occ[pCenter[q]] && pTier[q]<Math.min(n.tier[R_HOUSING],MAX_TIER);
}
/** The houses kingdom n's builders should improve, in order. The town is rebuilt from the castle
    outward: with manors allowed, the innermost houses (the edge a little ragged) are to become
    manors and the rest stone houses; the nearest house short of what it should be comes first. */
export function improvements(n: Nation){
  const top=Math.min(n.tier[R_HOUSING],MAX_TIER); if (top<2) return [];
  const houses=n.blds.filter(q => standing(q,B_HOUSE,n.id) && !pAband[q] && !occ[pCenter[q]]);
  const c = n.capTile>=0 ? n.capTile : n.lty*TW+n.ltx, cx=c%TW, cy=(c/TW)|0;
  const away=(q: number)=>Math.sqrt(((pCenter[q]%TW)-cx)**2+(((pCenter[q]/TW)|0)-cy)**2)*jitter(q);
  const d=new Map(houses.map(q => [q,away(q)]));
  houses.sort((a,b)=>d.get(a)!-d.get(b)! || a-b);
  const manors = top>=3 ? Math.ceil(houses.length*MANOR_SHARE) : 0;
  return houses.filter((q,i) => pTier[q] < (i<manors ? 3 : 2));
}
/** A builder sets off to improve the next house on the list, if the kingdom can pay for it. */
function goImprove(h: Human){
  const n=W.nations[h.o];
  if (!FIX_COST.every((c,g) => n.stock[g]>=c)) return false;
  const taken=new Set<number>(); for (const o of W.humans) if (o.o===h.o && o.fix>=0) taken.add(o.fix);
  let tries=0;
  for (const q of improvements(n)){
    if (taken.has(q)) continue;
    const [x,y]=frontOf(q); h.tx=x; h.ty=y; h.task=TASK_FIX_GO;
    if (route(h,true)){ h.fix=q; h.wait=0; return true; }
    if (++tries>=3) break;
  }
  h.task=TASK_ROAM;
  return false;
}
/** The builder finishes: the house goes up a tier, as good as new, if the kingdom can still pay. */
function improve(n: Nation, q: number){
  if (!FIX_COST.every((c,g) => n.stock[g]>=c)) return;
  FIX_COST.forEach((c,g) => n.stock[g]-=c);
  pTier[q]++; pHp[q]=0; n.beds+=HOUSE_BEDS[pTier[q]]-HOUSE_BEDS[pTier[q]-1];
  on.plotChanged(q); on.upgraded(q,n.id,pTier[q]);
}
/** Every builders guild has one builder. A guild without one takes the villager nearest it,
    straight away when it is new, a while after its builder fell. */
function staffGuilds(n: Nation, mine: Human[]){
  const staffed=new Set<number>();
  for (const h of mine){
    if (h.guild<0) continue;
    if (!standing(h.guild,B_GUILD,n.id) || h.kind!==H_VILLAGER || h.beggar || staffed.has(h.guild)){ h.guild=-1; if (h.fix>=0) backToRoam(h); continue; }
    staffed.add(h.guild);
  }
  if (staffed.size===n.guilds) return;
  let free: Human[] | null=null;
  for (const q of n.blds){
    if (staffed.has(q) || !standing(q,B_GUILD,n.id)) continue;
    if (pTimer[q]>1){ pTimer[q]--; continue; }   // his replacement is on the way
    free ??= mine.filter(h => h.kind===H_VILLAGER && h.guild<0 && !h.beggar && !switching(h) && h.brave<0 && h.carry<0 && h.home<0 && h.task!==TASK_STORE);
    const [x,y]=frontOf(q), h=nearest(free,x,y).shift(); if (!h) return;
    const replaced=pTimer[q]===1; pTimer[q]=0;
    release(h); h.guild=q; think(h); h.wait=0;
    on.builderHired(q,n.id,replaced);
  }
}

function step(h: Human){
  const n=W.nations[h.o];
  if (switching(h) && !standing(h.site,B_BARRACKS,h.o)){ backToRoam(h); return; }   // the barracks was lost
  if (h.task===TASK_INSIDE){
    if (--h.wait<=0){ h.kind^=1; h.sp+=h.kind===H_SOLDIER?1:-1; h.hp=h.kind===H_SOLDIER?SOLDIER_HP:VILLAGER_HP; backToRoam(h); on.roleChanged(h.x,h.y,h.kind); }
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
      if (h.hp<=0 && N[h.o].alive) on.died(h.x,h.y,h.o,h.id,h.kind===H_SOLDIER ? 1 : h.beggar ? 2 : 0);   // they drop where they fell
      if (h.guild>=0 && pType[h.guild]===B_GUILD) pTimer[h.guild]=REHIRE_TICKS+1;   // the guild waits a while for a new builder
      release(h); H[i]=H[H.length-1]; H.pop();
    }
  }
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
      // newcomers fill the ranks first while the kingdom is short of soldiers (if it has a barracks)
      let soldiers=0;
      for (const h of mine) soldiers += switching(h) ? +(h.kind===H_VILLAGER) : +(h.kind===H_SOLDIER);
      const soldier = barracks.length>0 && soldiers<Math.round(n.soldierShare*(mine.length+1));
      spawnHuman(n, soldier ? H_SOLDIER : H_VILLAGER, barracks);
      mine.push(H[H.length-1]);
    }
    balance(n, mine, barracks);
    garrison(n, mine);
    staffGuilds(n, mine);
  }
  for (const h of H) if (h.war>=0) marchStep(h); else step(h);
  spread();   // fighters keep a little room between them
  // headcount after everyone has moved, so it matches what is on the map this tick
  for (const n of N){ n.villagers=0; n.soldiers=0; n.training=0; n.beggars=0; n.homeless=0; n.taxpayers=0; }
  for (const h of H){
    const n=N[h.o];
    if (h.kind===H_SOLDIER) n.soldiers++; else if (h.beggar) n.beggars++; else { n.villagers++; if (h.housed) n.taxpayers++; }
    if (!h.housed) n.homeless++;
    if (switching(h)) n.training++;
  }
}
