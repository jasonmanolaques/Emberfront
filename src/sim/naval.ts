/* ---------- the sea: naval bases, ships, colonies, and the groundwork of naval invasions ----------
   A naval base (sim/buildings.ts) is a harbour: 8 plots, a third of them at least on the water. Click
   it to build ships: 5 wood each, 15 seconds each (SHIP_TICKS), ready ships belonging to the kingdom
   rather than to a base. Ships only sail on water.
   - Naval settlement. The settle menu's naval option, then a click on unclaimed land: a ship of the
     fleet sails from a base to the coast nearest the click (an island: any distance; land joined to
     the mainland: within 10 tiles of the shore), puts one tile of border ashore there, and the gold
     chosen spreads the border from that tile as it would anywhere (Attack.seed), then the ship
     sails home. A sea lane (W.ferry) from the base
     to the island is then open to the kingdom's villagers, who cross it in small boats to build
     houses there. Once the kingdom has land on the island it is settled like the mainland.
   - Naval invasions (sim/war.ts declares them): ships of the fleet carry the armies, 5 men each, to a
     stretch of an enemy's coast and wait offshore in a line; at the word they land (row after row
     when the coast is short), occupying the landing zone, and sail home to be counted again.
   This file holds what needs no war: the land and the sea told apart, docks, routes over the water,
   ships, colonies, the landing zone a coast gives. */
import { TW, TH, NT, PW, B_NAVAL, B_CASTLE, B_CPART, GAME_SPEED } from '../core/constants';
import { W, owner, occ, isLand, isle, sea, ferry, pType, pOwner, pBurn, pSpan, type Nation, type Ship } from './state';
import { setOwner, launchOn } from './territory';
import { dims } from './buildings';
import { on } from './events';

export const SHIP_COST = [5,0,0];                  // [wood, stone, copper] a ship costs
export const SHIP_TICKS = 15*GAME_SPEED*10;        // ticks to build one: 15 seconds on the clock
export const SHIP_CAP = 5;                         // soldiers a ship carries
export const SHIP_FRONT = 2*SHIP_CAP;              // tiles of coast a ship's men take: a man every 2 tiles, as on any front
export const SHIP_SP = 0.6;                        // pixels a tick a ship sails (6 a second: 3 tiles)
export const FERRY_PACE = 4;                       // a villager in a boat goes this much faster than on foot
export const ROW_GAP = 3;                          // tiles between one row of ships and the next
export const LAND_DEPTH = 3;                       // tiles inland a landing zone reaches
export const SHIP_SAIL = 0, SHIP_WAIT = 1, SHIP_BACK = 2;   // ships: sailing out, waiting off a coast, sailing home
export const INV_SAIL = 0, INV_READY = 1, INV_LAND = 2, INV_DONE = 3;   // invasions: sailing, in line offshore, landing, landed

/* ---------- the land and the sea told apart ---------- */
let queue = new Int32Array(0);
/** Gives every landmass (4-connected land) and every body of water an id, from 1. Called once the map is made. */
export function labelWorld(){
  if (queue.length!==NT) queue=new Int32Array(NT);
  isle.fill(0); sea.fill(0);
  let ni=0, ns=0;
  for (let t0=0;t0<NT;t0++){
    const land=isLand[t0]===1, arr=land ? isle : sea;
    if (arr[t0]) continue;
    const id=land ? Math.min(65535,++ni) : Math.min(65535,++ns);
    let head=0, tail=0; arr[t0]=id; queue[tail++]=t0;
    while (head<tail){
      const t=queue[head++], x=t%TW;
      if (x>0 && arr[t-1]===0 && (isLand[t-1]===1)===land){ arr[t-1]=id; queue[tail++]=t-1; }
      if (x<TW-1 && arr[t+1]===0 && (isLand[t+1]===1)===land){ arr[t+1]=id; queue[tail++]=t+1; }
      if (t>=TW && arr[t-TW]===0 && (isLand[t-TW]===1)===land){ arr[t-TW]=id; queue[tail++]=t-TW; }
      if (t<NT-TW && arr[t+TW]===0 && (isLand[t+TW]===1)===land){ arr[t+TW]=id; queue[tail++]=t+TW; }
    }
  }
  W.isleCount=ni;
  W.isleOwn=new Int32Array(0);
}
/** Makes room to count each kingdom's tiles on each landmass (once the kingdoms are known). */
export function allocIsles(){
  W.isleOwn=new Int32Array((W.isleCount+1)*W.M);
  for (let t=0;t<NT;t++) if (isLand[t] && owner[t]) W.isleOwn[isle[t]*W.M+owner[t]]++;
}
/** Does kingdom o have land on the landmass of tile t? */
export const hasLandOn = (o: number, t: number) => isLand[t]===1 && W.isleOwn.length>0 && W.isleOwn[isle[t]*W.M+o]>0;

/* ---------- reset ---------- */
export function resetNaval(){
  laneBox.clear(); W.ships=[]; W.shipSeq=0; W.docks=new Map(); W.invasions=[]; W.invSeq=0; ferry.fill(0);
}

/* ---------- naval bases and their yards ---------- */
/** Kingdom n's naval bases standing (main plots). */
export const basesOf = (n: Nation) => n.blds.filter(q => pType[q]===B_NAVAL && pOwner[q]===n.id && pBurn[q]<=0);
/** The plots a naval base with main plot q covers. */
export function baseCover(q: number){
  const [w,h]=pSpan[q]===1 ? [2,4] : [4,2], out: number[]=[];
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) out.push(q+y*PW+x);
  return out;
}
/** The base's water tiles: where its piers reach out. */
export function baseWater(q: number){
  const out: number[]=[];
  for (const k of baseCover(q)){ const px=(k%PW)*4, py=((k/PW)|0)*4; for (let y=py;y<py+4;y++) for (let x=px;x<px+4;x++) if (!isLand[y*TW+x]) out.push(y*TW+x); }
  return out;
}
/** Where ships leave and come home: the base's water tile nearest its middle. */
export function dockTile(q: number): number {
  const w=baseWater(q); if (!w.length) return -1;
  const [bw,bh]=dims(q), cx=(q%PW)*4+bw*2, cy=((q/PW)|0)*4+bh*2;
  let best=w[0], bd=Infinity;
  for (const t of w){ const d=((t%TW)+0.5-cx)**2+(((t/TW)|0)+0.5-cy)**2; if (d<bd || (d===bd && t<best)){ bd=d; best=t; } }
  return best;
}
/** The yard of the naval base q (made when first asked for). */
export function dockOf(q: number){ let d=W.docks.get(q); if (!d){ d={ q, queued:0, prog:0 }; W.docks.set(q,d); } return d; }
/** Why n can't have a ship built at base q, or null. */
export function shipProblem(n: Nation, q: number): string | null {
  if (!n.alive || pType[q]!==B_NAVAL || pOwner[q]!==n.id || pBurn[q]>0) return 'That is not your naval base';
  if (n.stock[0]<SHIP_COST[0]) return 'A ship needs 5 wood';
  return null;
}
/** n pays for a ship at base q: it joins the yard's queue. */
export function queueShip(n: Nation, q: number){
  if (shipProblem(n,q)) return false;
  n.stock[0]-=SHIP_COST[0];
  dockOf(q).queued++;
  return true;
}
/** Ships under construction at n's naval bases. */
export const building = (n: Nation) => { let k=0; for (const q of basesOf(n)) k+=W.docks.get(q)?.queued ?? 0; return k; };

/* ---------- routes over the water ---------- */
let came = new Int32Array(0), mark = new Int32Array(0), markSeq = 0;
function fit(){ if (came.length!==NT){ came=new Int32Array(NT); mark=new Int32Array(NT); markSeq=0; } }
const isWater = (t: number) => isLand[t]===0;
/** From water tile `start`, the nearest tile `goal` accepts over the water (4-connected), with the way
    there as tiles, or null. `limit` caps how many tiles it will look at. */
export function seaNearest(start: number, goal: (t: number) => boolean, limit=Infinity): { tile: number; path: number[] } | null {
  fit(); if (start<0 || !isWater(start)) return null;
  const stamp=++markSeq; let head=0, tail=0;
  if (queue.length!==NT) queue=new Int32Array(NT);
  mark[start]=stamp; came[start]=-1; queue[tail++]=start;
  while (head<tail && head<limit){
    const t=queue[head++];
    if (goal(t)) return { tile:t, path:wayBack(t) };
    const x=t%TW;
    let n=t-1;  if (x>0 && mark[n]!==stamp && isWater(n)){ mark[n]=stamp; came[n]=t; queue[tail++]=n; }
    n=t+1;      if (x<TW-1 && mark[n]!==stamp && isWater(n)){ mark[n]=stamp; came[n]=t; queue[tail++]=n; }
    n=t-TW;     if (t>=TW && mark[n]!==stamp && isWater(n)){ mark[n]=stamp; came[n]=t; queue[tail++]=n; }
    n=t+TW;     if (t<NT-TW && mark[n]!==stamp && isWater(n)){ mark[n]=stamp; came[n]=t; queue[tail++]=n; }
  }
  return null;
}
/** The way from `start` of the last search to tile t, start first. */
function wayBack(t: number){ const out: number[]=[]; for (let k=t;k>=0;k=came[k]) out.push(k); return out.reverse(); }
/** Routes from water tile `start` to each of the `goals`, as tiles; goals with no way are left out. One search serves all. */
export function seaPaths(start: number, goals: number[]): Map<number, number[]> {
  const out=new Map<number, number[]>(); fit();
  if (start<0 || !isWater(start) || !goals.length) return out;
  const want=new Set(goals.filter(g => isWater(g)));
  const stamp=++markSeq; let head=0, tail=0, left=want.size;
  if (queue.length!==NT) queue=new Int32Array(NT);
  mark[start]=stamp; came[start]=-1; queue[tail++]=start;
  const found: number[]=[];
  while (head<tail && left>0){
    const t=queue[head++];
    if (want.has(t)){ found.push(t); left--; }
    const x=t%TW;
    let n=t-1;  if (x>0 && mark[n]!==stamp && isWater(n)){ mark[n]=stamp; came[n]=t; queue[tail++]=n; }
    n=t+1;      if (x<TW-1 && mark[n]!==stamp && isWater(n)){ mark[n]=stamp; came[n]=t; queue[tail++]=n; }
    n=t-TW;     if (t>=TW && mark[n]!==stamp && isWater(n)){ mark[n]=stamp; came[n]=t; queue[tail++]=n; }
    n=t+TW;     if (t<NT-TW && mark[n]!==stamp && isWater(n)){ mark[n]=stamp; came[n]=t; queue[tail++]=n; }
  }
  for (const g of found) out.set(g,wayBack(g));
  return out;
}
/** Is the straight line a→b (tile coordinates) all water? */
function clearSea(ax: number, ay: number, bx: number, by: number){
  const d=Math.hypot(bx-ax,by-ay), n=Math.max(1,Math.ceil(d*2));
  for (let i=1;i<n;i++){
    const x=ax+(bx-ax)*i/n, y=ay+(by-ay)*i/n;
    if (isLand[Math.floor(y)*TW+Math.floor(x)] || isLand[Math.floor(ay+(by-ay)*(i-0.5)/n)*TW+Math.floor(ax+(bx-ax)*(i-0.5)/n)]) return false;
  }
  return true;
}
/** A ship's waypoints (pixels) along a tile path: pulled straight wherever the water allows. */
export function waypoints(tiles: number[]): number[] {
  if (!tiles.length) return [];
  const px=(t: number) => (t%TW)+0.5, py=(t: number) => ((t/TW)|0)+0.5;
  const out: number[]=[], last=tiles.length-1; let i=0;
  while (i<last){
    let step=1, best=i+1;
    for (;;){ const j=Math.min(last,i+step); if (clearSea(px(tiles[i]),py(tiles[i]),px(tiles[j]),py(tiles[j]))){ best=j; if (j===last) break; step*=2; } else break; }
    let lo=best, hi=Math.min(last,i+step);
    while (hi-lo>1){ const mid=(lo+hi)>>1; if (clearSea(px(tiles[i]),py(tiles[i]),px(tiles[mid]),py(tiles[mid]))) lo=mid; else hi=mid; }
    i=lo; out.push(px(tiles[i])*2, py(tiles[i])*2);
  }
  if (!out.length) out.push(px(tiles[0])*2, py(tiles[0])*2);
  return out;
}

/* ---------- ships ---------- */
/** Called by war.ts: what to do with the soldiers aboard a ship that has come home. */
export const navalHooks: { docked: (s: Ship) => void } = { docked: () => {} };
/** A new ship of kingdom o, from base q, at its dock, sailing `tiles` (the way, as tiles). */
export function launchShip(o: number, q: number, tiles: number[], extra: Partial<Ship>={}): Ship {
  const d=tiles[0] ?? dockTile(q), s: Ship={
    id:++W.shipSeq, o, base:q, x:(d%TW)*2+1, y:((d/TW)|0)*2+1, path:waypoints(tiles), pi:0, mode:SHIP_SAIL, inv:-1, row:0, slot:0, face:1,
    colony:-1, gold:0, lands:-1, back:[], crew:0, convoy:-1, fleet:false,
    ...extra };
  // the way home: the waypoints in reverse
  for (let i=s.path.length-2;i>=0;i-=2) s.back.push(s.path[i],s.path[i+1]);
  s.back.push((d%TW)*2+1, ((d/TW)|0)*2+1);
  W.ships.push(s);
  return s;
}
/** Sends ship s home by the way it came. */
export function recall(s: Ship){
  if (s.mode===SHIP_BACK) return;
  s.mode=SHIP_BACK; s.path=s.back.slice(); s.pi=0;
  // from where it is: the first waypoints of the way back may be behind it
  s.path.unshift(s.x,s.y);
}
const shipById = (id: number) => W.ships.find(s => s.id===id);
export { shipById };

/** Ships sail along their waypoints; a ship home is docked (and counts as ready again), a colony's ship that has arrived
    founds its colony. Docks build ships. */
export function updateNaval(){
  // yards
  for (const [q,d] of [...W.docks]){
    const o=pOwner[q];
    if (pType[q]!==B_NAVAL || pBurn[q]>0 || !W.nations[o]?.alive){ W.docks.delete(q); continue; }
    if (d.queued>0){
      if (++d.prog>=SHIP_TICKS){ d.prog=0; d.queued--; W.nations[o].fleet++; on.shipBuilt(o,q); }
    } else d.prog=0;
  }
  // ships
  for (let i=W.ships.length-1;i>=0;i--){
    const s=W.ships[i];
    if (s.mode===SHIP_WAIT) continue;
    let left=SHIP_SP;
    while (left>0 && s.pi<s.path.length){
      const gx=s.path[s.pi], gy=s.path[s.pi+1], dx=gx-s.x, dy=gy-s.y, d=Math.hypot(dx,dy);
      if (d<1e-6){ s.pi+=2; continue; }
      if (dx) s.face=dx<0 ? -1 : 1;
      if (d<=left){ s.x=gx; s.y=gy; s.pi+=2; left-=d; } else { s.x+=dx/d*left; s.y+=dy/d*left; left=0; }
    }
    if (s.pi<s.path.length) continue;
    // arrived
    if (s.mode===SHIP_BACK){ dock(s); W.ships.splice(i,1); continue; }
    if (s.colony>=0){ landColony(s); recall(s); continue; }
    s.mode=SHIP_WAIT;   // (an invasion's ship: in line off the coast, waiting for the word)
  }
}
/** Ship s is home: if it was one of the fleet it is ready again (at its base, or the kingdom's nearest if that is gone). */
function dock(s: Ship){
  navalHooks.docked(s);
  if (!s.fleet) return;   // (a colony's ship was never counted)
  const n=W.nations[s.o]; if (n?.alive) n.fleet++;
}

/* ---------- naval settlement ---------- */
export const COAST_REACH = 10;   // tiles from the shore that land on the mainland may be sent a ship to
/** Where a ship sent to the unclaimed land at tile t would land: the base to sail from, the water it comes to, the tile it
    puts ashore, and the way; or why not. On a landmass the kingdom has no land on (an island) the ship lands at the coast
    nearest the click; on one it has, the click must be within COAST_REACH tiles of a coast. */
export interface SettlePlan { base: number; water: number; lands: number; path: number[]; }
export function settlePlan(n: Nation, t: number): SettlePlan | string {
  if (t<0 || !isLand[t] || owner[t]) return 'Click unclaimed land';
  const bases=basesOf(n);
  if (!bases.length) return 'Build a naval base to settle by sea';
  if (n.fleet<1) return 'You need a ship: build one at a naval base';
  const seas=new Set<number>(); for (const q of bases){ const d=dockTile(q); if (d>=0) seas.add(sea[d]); }
  if (!seas.size) return 'Your naval base has no water';
  const present=hasLandOn(n.id,t), I=isle[t];
  // the nearest coast to the click, over the free land of that landmass
  fit(); if (queue.length!==NT) queue=new Int32Array(NT);
  const stamp=++markSeq; let head=0, tail=0, lands=-1, water=-1; const depth=new Map<number, number>();
  mark[t]=stamp; queue[tail++]=t; depth.set(t,0);
  while (head<tail && lands<0){
    const c=queue[head++], x=c%TW, d=depth.get(c)!;
    for (const w of [x>0 ? c-1 : -1, x<TW-1 ? c+1 : -1, c>=TW ? c-TW : -1, c<NT-TW ? c+TW : -1]) if (w>=0 && !isLand[w] && seas.has(sea[w])){ lands=c; water=w; break; }
    if (lands>=0) break;
    if (present && d>=COAST_REACH) continue;
    for (const k of [x>0 ? c-1 : -1, x<TW-1 ? c+1 : -1, c>=TW ? c-TW : -1, c<NT-TW ? c+TW : -1]){
      if (k<0 || mark[k]===stamp || !isLand[k] || isle[k]!==I || owner[k]) continue;
      mark[k]=stamp; depth.set(k,d+1); queue[tail++]=k;
    }
  }
  if (lands<0) return present ? 'Too far from the coast: click within 10 tiles of the shore' : 'No sea route to that land';
  let best: SettlePlan | null=null;
  for (const q of bases){
    const dock=dockTile(q); if (dock<0 || sea[dock]!==sea[water]) continue;
    const path=seaPaths(dock,[water]).get(water);
    if (path && (!best || path.length<best.path.length)) best={ base:q, water, lands, path };
  }
  return best ?? 'No sea route to that land';
}
/** Kingdom n sends one of its ships, with `gold`, to settle at the unclaimed land of tile t: where it lands the border begins, and the gold spreads it from there. */
export function colonize(n: Nation, t: number, gold: number){
  const plan=settlePlan(n,t);
  if (typeof plan==='string' || gold<2 || n.gold<gold) return false;
  n.gold-=gold; n.fleet--;
  launchShip(n.id,plan.base,plan.path,{ colony:isle[t], gold, lands:plan.lands, fleet:true });
  on.colonyBound(n.id,t);
  return true;
}
/** A settlers' ship has come ashore: its one tile of beach becomes the kingdom's, the sea lane opens, and the gold spreads the border from there as it would anywhere. */
function landColony(s: Ship){
  const n=W.nations[s.o]; if (!n?.alive){ return; }
  const I=s.colony, t0=s.lands;
  if (t0<0 || owner[t0] || isle[t0]!==I){ n.gold+=s.gold; s.gold=0; s.colony=-1; return; }   // (taken meanwhile: the gold comes home)
  setOwner(t0,n.id);
  openLane(s);
  launchOn(n.id,s.gold,I,t0);
  on.colonyFounded(n.id,t0);
  s.gold=0; s.colony=-1;
}
/** The sea lane between the naval base and the new colony: its water tiles open to the kingdom's villagers, in boats. */
function openLane(s: Ship){
  const q=s.base, o=s.o;
  const mark=(t: number) => { ferry[t]=o; const x=t%TW, y=(t/TW)|0, b=laneBox.get(o); if (!b) laneBox.set(o,[x,y,x,y]); else { b[0]=Math.min(b[0],x); b[1]=Math.min(b[1],y); b[2]=Math.max(b[2],x); b[3]=Math.max(b[3],y); } };
  for (const t of baseWater(q)) mark(t);
  const dock=dockTile(q); if (dock<0) return;
  // the way the ship came, as tiles: from the dock to the water beside the landing
  const near=(w: number) => { const x=w%TW; return w+1===s.lands && x<TW-1 || w-1===s.lands && x>0 || w+TW===s.lands || w-TW===s.lands; };
  const way=seaNearest(dock,near);
  if (way) for (const t of way.path) mark(t);
}
/** The box (tiles x0,y0,x1,y1) round each kingdom's sea lanes. */
export const laneBox = new Map<number, [number, number, number, number]>();
/** Is tile t a sea lane of kingdom o's? */
export const laneOf = (t: number, o: number) => ferry[t]===o;

/* ---------- the landing zone a coast gives ---------- */
export interface Zone { coast: number[]; zone: number[]; rows: number[]; sea: number; cap: number; safe: boolean; }
const NB8: [number, number][]=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
/** The water tile of body `seaId` beside land tile t, or -1. */
function waterBeside(t: number, seaId: number){
  const x=t%TW;
  if (x>0 && !isLand[t-1] && sea[t-1]===seaId) return t-1;
  if (x<TW-1 && !isLand[t+1] && sea[t+1]===seaId) return t+1;
  if (t>=TW && !isLand[t-TW] && sea[t-TW]===seaId) return t-TW;
  if (t<NT-TW && !isLand[t+TW] && sea[t+TW]===seaId) return t+TW;
  return -1;
}
const underCastleOf = (d: number, t: number) => { const q=(((t/TW)|0)>>2)*PW+((t%TW)>>2); return (pType[q]===B_CASTLE || pType[q]===B_CPART) && pOwner[q]===d; };
/** Is land tile t d's, and on the coast of water body seaId (and not under its castle)? */
export const isCoast = (d: number, t: number, seaId: number) => isLand[t]===1 && owner[t]===d && !underCastleOf(d,t) && waterBeside(t,seaId)>=0;
/** The landing zone for an army of `men` put ashore on d's coast near tile t0 from water body `seaId`: the stretch
    of coast (a man every 2 tiles, in order along it), the ground inland of it, and how the ships fall in rows. null if there
    is no coast near. `a` is the invader (a coast it holds already is safe). */
export function landingZone(a: number, d: number, t0: number, men: number, seaId: number): Zone | null {
  if (t0<0 || seaId<=0 || men<1) return null;
  // the coast tile nearest the pointer
  let start=-1;
  if (isCoast(d,t0,seaId)) start=t0;
  else {
    const x0=t0%TW, y0=(t0/TW)|0; let bd=Infinity;
    for (let y=y0-5;y<=y0+5;y++) for (let x=x0-5;x<=x0+5;x++){
      if (x<0||y<0||x>=TW||y>=TH) continue; const t=y*TW+x, dd=(x-x0)**2+(y-y0)**2;
      if (dd<bd && isCoast(d,t,seaId)){ bd=dd; start=t; }
    }
  }
  if (start<0) return null;
  // the stretch: coast tiles joined to it (corners too), nearest first, as many as there are men
  const want=Math.max(SHIP_FRONT,men*2), seen=new Set<number>([start]), coast: number[]=[start];
  for (let i=0;i<coast.length && coast.length<want;i++){
    const t=coast[i], x=t%TW, y=(t/TW)|0;
    for (const [ox,oy] of NB8){
      const nx=x+ox, ny=y+oy; if (nx<0||ny<0||nx>=TW||ny>=TH) continue;
      const k=ny*TW+nx; if (seen.has(k) || !isCoast(d,k,seaId)) continue;
      seen.add(k); coast.push(k); if (coast.length>=want) break;
    }
  }
  // along the coast: by position on the stretch's longer way
  let sx=0, sy=0; for (const t of coast){ sx+=t%TW; sy+=(t/TW)|0; }
  const mx=sx/coast.length, my=sy/coast.length; let cxx=0, cyy=0, cxy=0;
  for (const t of coast){ const dx=(t%TW)-mx, dy=((t/TW)|0)-my; cxx+=dx*dx; cyy+=dy*dy; cxy+=dx*dy; }
  const ang=0.5*Math.atan2(2*cxy,cxx-cyy), ux=Math.cos(ang), uy=Math.sin(ang);
  coast.sort((p,q) => ((p%TW)*ux+((p/TW)|0)*uy)-((q%TW)*ux+((q/TW)|0)*uy) || p-q);
  // inland: the ground within LAND_DEPTH steps of the coast
  const zone=coast.slice(), inZone=new Set<number>(coast); let frontier=coast.slice();
  for (let depth=0;depth<LAND_DEPTH;depth++){
    const next: number[]=[];
    for (const t of frontier){
      const x=t%TW;
      for (const k of [x>0 ? t-1 : -1, x<TW-1 ? t+1 : -1, t>=TW ? t-TW : -1, t<NT-TW ? t+TW : -1]){
        if (k<0 || inZone.has(k) || !isLand[k] || owner[k]!==d || underCastleOf(d,k)) continue;
        inZone.add(k); zone.push(k); next.push(k);
      }
    }
    frontier=next;
  }
  const ships=Math.ceil(men/SHIP_CAP), cap=Math.max(1,Math.floor(coast.length/SHIP_FRONT)), rows: number[]=[];
  for (let left=ships;left>0;left-=cap) rows.push(Math.min(cap,left));
  return { coast, zone, rows, sea:seaId, cap, safe:coast.every(t => occ[t]===a) };
}
/** Where ship `slot` of a row of `count` ships, in row `row`, waits off the coast: the water tile (index) beside the coast
    it lies before, then out to sea by the row. */
export function offshore(z: Zone, row: number, slot: number, count: number): number {
  const ci=Math.min(z.coast.length-1,Math.floor((slot+0.5)*z.coast.length/count)), c=z.coast[ci], w=waterBeside(c,z.sea);
  if (w<0) return c;
  const dx=(w%TW)-(c%TW), dy=((w/TW)|0)-((c/TW)|0);
  let t=w;
  for (let k=0;k<row*ROW_GAP;k++){ const nx=(t%TW)+dx, ny=((t/TW)|0)+dy; if (nx<0||ny<0||nx>=TW||ny>=TH) break; const n=ny*TW+nx; if (isLand[n] || sea[n]!==z.sea) break; t=n; }
  return t;
}
/** Which landing tile, in the zone's coast, a ship `slot` of `count` puts its men on. */
export function landingTile(z: Zone, slot: number, count: number): number {
  return z.coast[Math.min(z.coast.length-1,Math.floor((slot+0.5)*z.coast.length/count))];
}
export { waterBeside };
