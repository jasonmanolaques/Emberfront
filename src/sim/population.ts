/* ---------- population: humans leave the capital, work as villagers or serve as soldiers ----------
   Each kingdom keeps a requested soldier share. When it has too few soldiers, newcomers are
   born soldiers and the nearest villagers walk into the capital to train; with too many, the
   nearest soldiers walk in and come back out as villagers. */
import { TW, PW, TICK, B_CASTLE, B_CPART } from '../core/constants';
import { W, owner, pType, type Human, type Nation } from './state';
import { on } from './events';

export const H_VILLAGER = 0, H_SOLDIER = 1;
export const TASK_ROAM = 0,      // villagers walk between buildings, soldiers patrol near the capital
             TASK_TO_CAP = 1,    // walking to the capital door to switch role
             TASK_INSIDE = 2;    // inside the capital, switching role
export const HUMAN_EVERY = 100;  // ticks between new humans (10 s)
const TRAIN_TICKS = 30;          // ticks inside the capital to switch role (3 s)
const PATROL_R = 24;             // pixels around the capital door soldiers patrol

/** Pixel position just outside the capital's door. */
export function doorOf(n: Nation): [number, number] { const q=n.capPlot; return [(q%PW)*8+8, ((q/PW)|0)*8+15]; }
const tileOf = (x: number, y: number) => ((y/2)|0)*TW+((x/2)|0);
// the castle covers a 16x16 pixel block; people walk around its walls, not across its roof.
// The row just below the walls, where the gate opens, stays walkable.
const wallX0=-0.5, wallX1=16.5, wallY0=-1, wallY1=14.5;
function onCastle(n: Nation, x: number, y: number){
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
    if (owner[ty*TW+tx]!==o) return false;
    if (tx===ex && ty===ey) return true;
    if (tmx<tmy){ tmx+=tdx; tx+=sx; } else { tmy+=tdy; ty+=sy; }
  }
  return true;
}
/** Plans the walk to (tx,ty): straight if the castle isn't in the way, otherwise round its corners.
    A detour is only taken if it is safe; cutting across the walls beats walking into an enemy. */
function route(h: Human){
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
    if (prev[5]>=0){ const way: number[]=[]; for (let i=prev[5];i>0;i=prev[i]) way.unshift(P[i][0],P[i][1]); h.path=way; return; }
  }
  // roaming is optional: rather than step outside the borders, stay put
  if (!direct && h.task===TASK_ROAM){ h.tx=h.x; h.ty=h.y; }
}

function roamTarget(h: Human){
  const n=W.nations[h.o], r=W.prand;
  if (h.kind===H_SOLDIER){
    const [cx,cy] = n.capTile>=0 ? doorOf(n) : [h.x,h.y];
    for (let k=0;k<4;k++){
      const x=cx+(r()*2-1)*PATROL_R, y=cy+(r()*2-1)*PATROL_R*0.6;
      if (owner[tileOf(x,y)]===h.o && !onCastle(n,x,y)){ h.tx=x; h.ty=y; break; }
    }
    h.wait=(1+r()*3)/TICK; route(h); return;
  }
  // villagers: head for a nearby building of their own kingdom
  let bx=h.x, by=h.y, bd=1e9, gate=false;
  for (let k=0;k<6;k++){ if (!n.blds.length) break; const q=n.blds[(r()*n.blds.length)|0];
    const castle=pType[q]===B_CASTLE||pType[q]===B_CPART;
    if (castle && n.capTile<0) continue;
    const [x,y] = castle ? doorOf(n) : [(q%PW)*8+4, ((q/PW)|0)*8+7], d=Math.abs(x-h.x)+Math.abs(y-h.y);
    if (d>4 && d<60 && d<bd && owner[tileOf(x,y)]===h.o){ bd=d; bx=x; by=y; gate=castle; } }   // a house on the border may stand half on enemy ground
  // with no building in reach they just take a step or two where they stand
  const tx=bx+(r()*4-2), ty=by+(gate ? r()*1.5 : r()*2-1);   // at the gate, stand in front of it
  if (owner[tileOf(tx,ty)]===h.o && !onCastle(n,tx,ty)){ h.tx=tx; h.ty=ty; }
  h.wait=(0.5+r()*2.5)/TICK; route(h);
}

function spawnHuman(n: Nation, kind: number){
  const r=W.prand, [x,y]=doorOf(n);
  const h: Human={ id:++W.humanSeq, o:n.id, kind, task:TASK_ROAM, x, y, tx:x, ty:y, path:[], wait:0, sp:(kind===H_SOLDIER?4:3)+r()*2 };
  roamTarget(h); h.wait=0;
  W.humans.push(h);
}

function sendToCapital(h: Human){ const [x,y]=doorOf(W.nations[h.o]); h.task=TASK_TO_CAP; h.tx=x; h.ty=y; h.wait=0; route(h); }
function backToRoam(h: Human){ h.task=TASK_ROAM; roamTarget(h); h.wait=0; }

// nearest candidates first, ties by id, so every client picks the same people
function nearest(list: Human[], n: Nation){
  const [cx,cy]=doorOf(n);
  return list.sort((a,b)=>((a.x-cx)**2+(a.y-cy)**2)-((b.x-cx)**2+(b.y-cy)**2) || a.id-b.id);
}

/** Moves the kingdom's headcount toward its requested soldier share. */
function balance(n: Nation, mine: Human[]){
  if (n.capTile<0){
    // no capital: nobody can train; anyone inside walks back out unchanged
    for (const h of mine) if (h.task!==TASK_ROAM) backToRoam(h);
    return;
  }
  // soldiers counted as they will be once everyone inside or on the way has switched
  let soldiers=0;
  for (const h of mine) soldiers += h.task===TASK_ROAM ? +(h.kind===H_SOLDIER) : +(h.kind===H_VILLAGER);
  const target=Math.round(n.soldierShare*mine.length);
  let diff=target-soldiers;
  if (!diff) return;
  const want=diff>0 ? H_SOLDIER : H_VILLAGER, from=diff>0 ? H_VILLAGER : H_SOLDIER;
  diff=Math.abs(diff);
  // first turn back anyone still walking to switch the other way
  for (const h of mine){ if (!diff) return; if (h.task===TASK_TO_CAP && h.kind===want){ backToRoam(h); diff--; } }
  for (const h of nearest(mine.filter(h=>h.task===TASK_ROAM && h.kind===from), n)){ if (!diff) return; sendToCapital(h); diff--; }
}

function step(h: Human){
  if (h.task===TASK_INSIDE){
    if (--h.wait<=0){ h.kind^=1; h.sp+=h.kind===H_SOLDIER?1:-1; backToRoam(h); on.roleChanged(h.x,h.y,h.kind); }
    return;
  }
  if (h.wait>0){ h.wait--; return; }
  const way=h.path.length>0, gx=way?h.path[0]:h.tx, gy=way?h.path[1]:h.ty;
  const dx=gx-h.x, dy=gy-h.y, d=Math.sqrt(dx*dx+dy*dy);
  if (d<0.6 && way){ h.path.splice(0,2); return; }
  if (d<0.6){
    if (h.task===TASK_TO_CAP){ h.task=TASK_INSIDE; h.x=h.tx; h.y=h.ty; h.wait=TRAIN_TICKS; return; }
    roamTarget(h); return;
  }
  const st=Math.min(d,h.sp*TICK); h.x+=dx/d*st; h.y+=dy/d*st;
}

export function updatePopulation(){
  const N=W.nations, H=W.humans;
  // people die when their kingdom falls or the ground under them is taken by another kingdom
  for (let i=H.length-1;i>=0;i--){
    const h=H[i], o=owner[tileOf(h.x,h.y)];
    if (!N[h.o].alive || (o!==0 && o!==h.o)){ H[i]=H[H.length-1]; H.pop(); }
  }
  const groups: Human[][]=N.map(()=>[]);
  for (const h of H) groups[h.o].push(h);
  for (let i=1;i<N.length;i++){
    const n=N[i], mine=groups[i];
    if (n.alive && n.capTile>=0 && W.tickN>=n.nextHuman){
      n.nextHuman+=HUMAN_EVERY;
      // newcomers fill the ranks first while the kingdom is short of soldiers
      let soldiers=0;
      for (const h of mine) soldiers += h.task===TASK_ROAM ? +(h.kind===H_SOLDIER) : +(h.kind===H_VILLAGER);
      spawnHuman(n, soldiers<Math.round(n.soldierShare*(mine.length+1)) ? H_SOLDIER : H_VILLAGER);
      mine.push(H[H.length-1]);
    }
    if (n.alive) balance(n, mine);
  }
  for (const h of H) step(h);
  // headcount after everyone has moved, so it matches what is on the map this tick
  for (const n of N){ n.villagers=0; n.soldiers=0; n.training=0; }
  for (const h of H){ const n=N[h.o]; if (h.kind===H_SOLDIER) n.soldiers++; else n.villagers++; if (h.task!==TASK_ROAM) n.training++; }
}
