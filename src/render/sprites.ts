/* ---------- pixel sprites (drawn into the object layer) ----------
   Farms, barracks, watchtowers and coin minters are modular: each plot looks at its four
   neighbours, and plots of the same kind and owner join up, so fields merge into one farmland,
   barracks into one long hall, minters into one workshop, and towers link with walls. */
import { DW, DH, PW, PH, NP, B_HOUSE, B_FARM, B_TOWER, B_MINE, B_CASTLE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_SITE, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART } from '../core/constants';
import { pType, pOwner, pVar, pMain, pAband } from '../sim/state';
import { styleOf, type NationStyle } from './style';

export const objC = document.createElement('canvas'); objC.width = DW; objC.height = DH;
export const octx = objC.getContext('2d') as CanvasRenderingContext2D;
let G = octx;   // where P and R draw: the map, or an icon

function P(x: number, y: number, c: string){ G.fillStyle=c; G.fillRect(x,y,1,1); }
function R(x: number, y: number, w: number, h: number, c: string){ G.fillStyle=c; G.fillRect(x,y,w,h); }

export const MODULAR = [B_FARM, B_BARRACKS, B_TOWER, B_MINTER];
const N_=1, E_=2, S_=4, W_=8;
/** Which neighbours of plot q are the same kind of building with the same owner (N/E/S/W bits). */
function joins(q: number){
  const ty=pType[q], o=pOwner[q], x=q%PW, y=(q/PW)|0;
  const same=(k: number)=>pType[k]===ty && pOwner[k]===o;
  return (y>0&&same(q-PW)?N_:0) | (x<PW-1&&same(q+1)?E_:0) | (y<PH-1&&same(q+PW)?S_:0) | (x>0&&same(q-1)?W_:0);
}
const SH = 'rgba(16,28,8,.28)';

// smoke-hole above each hovel variant, where the cooking smoke rises
export const CHIMNEY = [[4,2],[4,1],[3,2]];
/** A rough, quickly built hovel: mud and wattle under uneven thatch, a rag in the kingdom's colour.
    Abandoned, it keeps its shape but greys and sags: holes in the thatch, a boarded door, weeds. */
function drawHouse(ox: number, oy: number, n: NationStyle, v: number, empty: boolean){
  const wall = empty ? '#6e6252' : '#8f6d48', wallD = empty ? '#5a5044' : '#74563a';
  const th = empty ? '#8c8160' : '#c9a24e', thD = empty ? '#726a50' : '#a8833a', thL = empty ? '#9c9272' : '#dcb866';
  const door = empty ? '#8a7a62' : '#3b2a1e', hole='#2a2420', post='#5e4630';
  R(ox+1,oy+7,6,1,SH);
  if (v===0){            // lean-to against a post
    R(ox+2,oy+5,4,2,wall); R(ox+5,oy+5,1,2,wallD);
    P(ox+3,oy+6,door);
    R(ox+1,oy+4,6,1,th); R(ox+2,oy+3,4,1,thD); P(ox+3,oy+2,th); P(ox+4,oy+2,thL);
    P(ox+1,oy+5,thL); P(ox+6,oy+3,thL);                    // straw sticking out
    if (!empty){ P(ox+6,oy+5,post); P(ox+6,oy+4,post); P(ox+6,oy+3,n.roof); }
    else { P(ox+4,oy+3,hole); P(ox+2,oy+4,hole); }
  } else if (v===1){     // round hut
    R(ox+2,oy+5,4,2,wall); P(ox+2,oy+6,wallD); P(ox+5,oy+5,wallD);
    P(ox+4,oy+6,door);
    R(ox+2,oy+3,4,2,th); R(ox+1,oy+4,6,1,thD); R(ox+3,oy+2,2,1,thL); P(ox+4,oy+1,thD);
    P(ox+6,oy+5,thL);
    if (!empty){ P(ox+2,oy+3,n.roof); P(ox+3,oy+3,n.roofD); }
    else { P(ox+3,oy+3,hole); P(ox+5,oy+4,hole); }
  } else {               // stick frame with a hide thrown over
    R(ox+2,oy+4,4,3,wall); R(ox+2,oy+6,4,1,wallD);
    P(ox+3,oy+5,door); P(ox+3,oy+6,door);
    R(ox+1,oy+3,6,1,thD); R(ox+2,oy+2,4,1,th); P(ox+1,oy+2,post); P(ox+6,oy+2,post); P(ox+1,oy+1,post);
    if (!empty){ P(ox+4,oy+2,n.roof); P(ox+5,oy+2,n.roofL); }
    else { P(ox+4,oy+2,hole); P(ox+2,oy+3,hole); }
  }
  if (empty){
    const nail='#4a4038'; P(ox+2+v%2,oy+5,nail);          // boards across the door
    P(ox+1,oy+6,'#5f8a3a'); P(ox+6,oy+6,'#6f9a44'); P(ox+5,oy+7,'#5f8a3a');   // weeds round the walls
  }
}
/** A house going up: stakes, a half-finished frame and a pile of sticks. */
function drawSite(ox: number, oy: number, n: NationStyle){
  const wood='#a07a4a', dark='#6e5034';
  R(ox+2,oy+4,1,3,dark); R(ox+5,oy+4,1,3,dark);           // corner posts
  R(ox+2,oy+4,4,1,wood); P(ox+3,oy+3,wood); P(ox+4,oy+3,wood);
  P(ox+1,oy+7,wood); P(ox+2,oy+7,dark); P(ox+6,oy+7,wood); // sticks on the ground
  P(ox+2,oy+3,n.roof);                                      // a marker in the kingdom's colour
}
function drawFarm(ox: number, oy: number, n: NationStyle, v: number, m: number){
  const crop=['#e3c45a','#9ccf4f','#cfd66a'][v], cropL=['#f6e08a','#c2ea78','#eef09a'][v];
  const rail='#a8834f', post='#6e4f2e', x0=m&W_?0:1, x1=m&E_?8:7;
  R(ox,oy,8,8,'#8a6a3e');                                    // tilled soil
  for (let y=1;y<8;y+=2) if (y<7 || m&S_) R(ox+x0,oy+y,x1-x0,1,crop);   // rows run on into the next field
  for (let k=0;k<3;k++) P(ox+x0+((k*5+(oy>>3)*3+(ox>>3))%(x1-x0)), oy+1+k*2, cropL);
  // a fence only where the farmland ends
  if (!(m&N_)) R(ox,oy,8,1,rail);
  if (!(m&S_)) R(ox,oy+7,8,1,rail);
  if (!(m&W_)) R(ox,oy,1,8,rail);
  if (!(m&E_)) R(ox+7,oy,1,8,rail);
  for (const [cx,cy,a,b] of [[0,0,N_,W_],[7,0,N_,E_],[0,7,S_,W_],[7,7,S_,E_]]) if (!(m&a) || !(m&b)) P(ox+cx,oy+cy,post);
  // a scarecrow in the kingdom's colours at the field's north-west corner
  if (!(m&N_) && !(m&W_)){ P(ox+3,oy+1,'#e9d7a0'); P(ox+2,oy+2,n.roof); P(ox+3,oy+2,n.roof); P(ox+4,oy+2,n.roof); P(ox+3,oy+3,post); }
}
function drawBarracks(ox: number, oy: number, n: NationStyle, m: number){
  const x0=m&W_?0:1, x1=m&E_?8:7, w=x1-x0, wall='#b59a72', beam='#7e6646', dark='#3b2a1e';
  R(ox+x0,oy+7,w,1,SH);
  R(ox+x0,oy+4,w,3,wall); R(ox+x0,oy+6,w,1,beam);           // timber hall, one long building when joined
  if (!(m&W_)) R(ox+x0,oy+4,1,3,beam);
  if (!(m&E_)) R(ox+x1-1,oy+4,1,3,beam);
  R(ox+x0,oy+3,w,1,n.roofD); R(ox+x0,oy+2,w,1,n.roof);
  R(ox+x0+(m&W_?0:1),oy+1,w-(m&W_?0:1)-(m&E_?0:1),1,n.roofL);
  R(ox+3,oy+5,2,2,dark);                                     // doors
  P(ox+1+(m&W_?0:1),oy+5,'#d9d0bc'); P(ox+6-(m&E_?0:1),oy+5,'#d9d0bc');   // shields on the wall
  if (!(m&W_)){ P(ox+1,oy,'#5a4030'); P(ox+2,oy,n.roof); P(ox+1,oy+1,'#5a4030'); }   // banner at the west end
}
function drawTower(ox: number, oy: number, n: NationStyle, m: number){
  const st='#b3aea3', sd='#7c776e', sl='#d6d1c5';
  // walls toward neighbouring towers, with battlements
  if (m&E_){ R(ox+5,oy+4,3,3,st); R(ox+5,oy+6,3,1,sd); P(ox+5,oy+3,st); P(ox+7,oy+3,st); }
  if (m&W_){ R(ox,oy+4,3,3,st); R(ox,oy+6,3,1,sd); P(ox,oy+3,st); P(ox+2,oy+3,st); }
  if (m&N_){ R(ox+3,oy,3,3,st); R(ox+5,oy,1,3,sd); }
  if (m&S_){ R(ox+3,oy+7,3,1,st); R(ox+5,oy+7,1,1,sd); }
  R(ox+3,oy+7,4,1,SH);
  R(ox+3,oy+3,3,4,st); R(ox+5,oy+3,1,4,sd); P(ox+3,oy+3,sl);
  R(ox+2,oy+2,5,1,st); P(ox+2,oy+1,st); P(ox+6,oy+1,st);
  P(ox+4,oy+5,'#3b2e24'); P(ox+4,oy+6,'#3b2e24');
  P(ox+4,oy+0,'#4a3a2a'); P(ox+4,oy+1,'#4a3a2a'); P(ox+5,oy+0,n.roof); P(ox+6,oy+0,n.roofD);
}
function drawMinter(ox: number, oy: number, n: NationStyle, m: number){
  const x0=m&W_?0:1, x1=m&E_?8:7, w=x1-x0;
  R(ox+x0,oy+7,w,1,SH);
  R(ox+x0,oy+4,w,3,'#a39e94'); R(ox+x0,oy+6,w,1,'#7c776e');  // stone workshop, one long building when joined
  R(ox+x0,oy+3,w,1,'#3f4854'); R(ox+x0,oy+2,w,1,'#55606e');  // slate roof
  R(ox+x0+(m&W_?0:1),oy+1,w-(m&W_?0:1)-(m&E_?0:1),1,n.roof); // ridge in the kingdom's colour
  P(ox+3,oy+5,'#ffb24a'); P(ox+3,oy+6,'#d9602a');            // furnace glow
  P(ox+5,oy+4,'#ffd23f'); P(ox+5,oy+5,'#c99a1c');            // coin sign
  if (!(m&E_)){ R(ox+6,oy,1,2,'#6e6a62'); P(ox+6,oy,'#4a4740'); }   // chimney at the east end
}
function drawMine(ox: number, oy: number, n: NationStyle){
  R(ox+1,oy+5,6,2,'#9a958b'); R(ox+2,oy+4,4,1,'#aca79c'); R(ox+1,oy+7,6,1,SH);
  R(ox+3,oy+5,2,2,'#2c231d');
  R(ox+2,oy+4,4,1,'#7a5432'); P(ox+2,oy+5,'#7a5432'); P(ox+5,oy+5,'#7a5432');
  P(ox+6,oy+6,'#f2d14b'); P(ox+1,oy+6,'#e0c04a');
  P(ox+6,oy+2,'#4a3a2a'); P(ox+6,oy+3,'#4a3a2a'); P(ox+7,oy+2,n.roof);
}
function drawCastle(ox: number, oy: number, n: NationStyle){
  const st='#bdb8ad', sd='#87827a', sl='#dcd7cc', dk='#3a2e26';
  R(ox+1,oy+15,15,1,SH);
  R(ox+2,oy+9,12,6,st); R(ox+2,oy+14,12,1,sd);
  for (let i=0;i<6;i++) P(ox+3+i*2,oy+8,st);
  R(ox+0,oy+6,3,9,st); R(ox+13,oy+6,3,9,st); R(ox+2,oy+6,1,9,sd); R(ox+15,oy+6,1,9,sd);
  R(ox+0,oy+5,3,1,n.roofD); P(ox+1,oy+4,n.roof); R(ox+13,oy+5,3,1,n.roofD); P(ox+14,oy+4,n.roof);
  R(ox+5,oy+3,6,8,sl); R(ox+10,oy+3,1,8,sd);
  R(ox+4,oy+2,8,1,n.roofD); R(ox+5,oy+1,6,1,n.roof); R(ox+6,oy+0,4,1,n.roofL);
  P(ox+7,oy+5,'#ffd86b'); P(ox+8,oy+5,'#ffd86b'); P(ox+7,oy+7,'#ffd86b'); P(ox+8,oy+7,'#ffd86b');
  R(ox+7,oy+11,2,4,dk);
  P(ox+5,oy+9,n.roof); P(ox+5,oy+10,n.roofD); P(ox+10,oy+9,n.roof); P(ox+10,oy+10,n.roofD);
}
function drawRuins(ox: number, oy: number, v: number){
  const cols=['#3b3430','#57504a','#7b746c','#2a2422'];
  let h=(v*97+13+ox*7+oy*13)>>>0;
  for (let k=0;k<10;k++){ h=(Math.imul(h,1103515245)+12345)>>>0; P(ox+1+((h>>>8)%6), oy+2+((h>>>16)%5), cols[(h>>>4)&3]); }
  R(ox+1,oy+7,6,1,'rgba(0,0,0,.16)');
}
/** Redraws whatever stands on building plot q. */
export function drawPlot(q: number){
  const ox=(q%PW)*8, oy=((q/PW)|0)*8, ty=pType[q];
  if (ty===B_CPART){ const m=pMain[q]; if (pType[m]===B_CASTLE){ drawPlot(m); return; } }
  if (ty===B_PART){ const m=pMain[q]; if (BIG[pType[m]]){ drawPlot(m); return; } octx.clearRect(ox,oy,8,8); return; }
  if (BIG[ty]){ const [w,h]=BIG[ty]; octx.clearRect(ox,oy,w*8,h*8); drawBig(ox,oy,ty,styleOf(pOwner[q])); return; }
  if (ty===B_CASTLE){ octx.clearRect(ox,oy,16,16); drawCastle(ox,oy,styleOf(pOwner[q])); return; }
  octx.clearRect(ox,oy,8,8);
  const n=styleOf(pOwner[q]), v=pVar[q]%3;
  if (ty===B_HOUSE) drawHouse(ox,oy,n,v,!!pAband[q]);
  else if (ty===B_SITE) drawSite(ox,oy,n);
  else if (ty===B_FARM) drawFarm(ox,oy,n,pOwner[q]%3,joins(q));   // one crop per kingdom, so joined fields match
  else if (ty===B_TOWER) drawTower(ox,oy,n,joins(q));
  else if (ty===B_BARRACKS) drawBarracks(ox,oy,n,joins(q));
  else if (ty===B_MINTER) drawMinter(ox,oy,n,joins(q));
  else if (ty===B_MINE) drawMine(ox,oy,n);
  else if (ty===B_RUINS) drawRuins(ox,oy,pVar[q]);
  else if (ty===B_CPART){ /* part of a burned castle still standing: leave */ }
}

/** Redraws plot q and any modular neighbours whose joins it may have changed. */
export function drawPlotAndNeighbours(q: number){
  drawPlot(q);
  const x=q%PW;
  for (const k of [q-PW, x<PW-1?q+1:-1, q+PW, x>0?q-1:-1]) if (k>=0 && k<NP && MODULAR.includes(pType[k])) drawPlot(k);
}

/** Draws a building's sprite into an icon (one plot is 8x8, unjoined) in the given kingdom colours. */
export function drawIcon(ctx: CanvasRenderingContext2D, type: number, n: NationStyle){
  G=ctx; ctx.clearRect(0,0,16,16);
  if (type===B_FARM) drawFarm(0,0,n,1,0); else if (type===B_BARRACKS) drawBarracks(0,0,n,0);
  else if (type===B_TOWER) drawTower(0,0,n,0); else if (type===B_MINTER) drawMinter(0,0,n,0);
  else if (BIG[type]){ drawBig(0,0,type,n); drawWorking(ctx,type,0,0,0.99,0); }
  G=octx;
}

/* ---------- production buildings: 2x2 or 2x1 plots, a static base here plus live work drawn each frame ---------- */
export const BIG: Record<number, [number, number]> = { [B_PLANTATION]: [2,2], [B_QUARRY]: [2,2], [B_COPPERMINE]: [2,1] };
// where the four saplings stand in a plantation
const SLOTS = [[4,5],[12,5],[4,13],[12,13]];
function drawBig(ox: number, oy: number, type: number, n: NationStyle){
  if (type===B_PLANTATION){
    R(ox,oy,16,16,'#7a5c36');                                    // turned earth
    for (let y=2;y<16;y+=4) R(ox+1,oy+y,14,1,'#8e6c40');
    for (const [x,y] of SLOTS){ R(ox+x-2,oy+y+1,4,1,'#5e4428'); }   // a dug bed under each sapling
    const rail='#a8834f';
    R(ox,oy,16,1,rail); R(ox,oy+15,16,1,rail); R(ox,oy,1,16,rail); R(ox+15,oy,1,16,rail);
    for (const [x,y] of [[0,0],[15,0],[0,15],[15,15],[7,0],[7,15]]) P(ox+x,oy+y,'#6e4f2e');
    P(ox+1,oy+1,n.roof); P(ox+1,oy+2,'#6e4f2e');                // the kingdom's marker post
  } else if (type===B_QUARRY){
    // a stepped pit cut into the ground, the deepest step darkest
    R(ox,oy+2,16,14,'#a49d90'); R(ox+2,oy+4,12,10,'#8d867b'); R(ox+4,oy+6,8,6,'#6f695f'); R(ox+6,oy+8,4,3,'#4a4640');
    R(ox,oy+15,16,1,SH);
    for (const [x,y] of [[1,3],[13,5],[3,13],[11,12],[14,10]]) P(ox+x,oy+y,'#c4beb4');   // loose blocks on the steps
    // the pulley frame over the pit
    R(ox+3,oy+1,1,9,'#6e5034'); R(ox+12,oy+1,1,9,'#6e5034'); R(ox+3,oy+1,10,1,'#8a6a40');
    P(ox+8,oy+2,'#3b2a1e');                                       // the wheel
    R(ox+13,oy+12,2,2,'#bdb6aa'); P(ox+13,oy+12,'#d6d1c5');      // a stack of cut stone
    P(ox+2,oy+1,n.roof); P(ox+2,oy+2,'#6e5034');
  } else if (type===B_COPPERMINE){
    // a rocky mound with a timbered shaft; the glow is drawn live
    R(ox+1,oy+2,14,6,'#8d867b'); R(ox+3,oy+1,10,1,'#a49d90'); R(ox+2,oy+2,3,2,'#a49d90'); R(ox+11,oy+2,3,2,'#a49d90');
    P(ox+1,oy+2,'#bdb6aa'); P(ox+14,oy+3,'#6f695f'); P(ox+4,oy+6,'#6f695f'); P(ox+12,oy+6,'#6f695f');
    R(ox+6,oy+3,4,5,'#1c1410');                                   // the dark entrance
    R(ox+5,oy+3,1,5,'#6e5034'); R(ox+10,oy+3,1,5,'#6e5034'); R(ox+5,oy+2,6,1,'#8a6a40');   // timber frame
    R(ox,oy+7,16,1,SH);
    P(ox+2,oy+6,'#d9823e'); P(ox+3,oy+6,'#b8642a'); P(ox+13,oy+5,'#e08a48');            // ore by the door
    P(ox+14,oy+1,n.roof); P(ox+14,oy+2,'#6e5034');
  }
}
/** The moving part of a production building, drawn over its base each frame. k = progress through
    the 30-second cycle (0..1), now = milliseconds for the looping bits. */
export function drawWorking(ctx: CanvasRenderingContext2D, type: number, ox: number, oy: number, k: number, now: number){
  const prev=G; G=ctx;
  if (type===B_PLANTATION){
    // each bed grows a tree from a sprout to a full tree over the cycle
    for (const [sx,sy] of SLOTS){
      const x=ox+sx, y=oy+sy;
      if (k<0.2){ P(x,y,'#7cc954'); }
      else if (k<0.45){ P(x,y,'#6e4b2c'); P(x,y-1,'#7cc954'); P(x-1,y-1,'#6dbb47'); }
      else if (k<0.75){ P(x,y,'#6a4528'); P(x,y-1,'#6e4b2c'); R(x-1,y-2,3,1,'#6dbb47'); P(x,y-3,'#7cc954'); P(x+1,y-1,'#4c9a34'); }
      else { P(x,y,'#6a4528'); P(x,y-1,'#6a4528'); R(x-1,y-3,3,2,'#4c9a34'); R(x-2,y-2,5,1,'#6dbb47'); P(x,y-4,'#7cc954'); P(x+1,y-2,'#2f6e25'); P(x-1,y-4,'#6dbb47'); P(x+1,y-4,'#4c9a34'); }
    }
  } else if (type===B_QUARRY){
    // a block rides the rope up from the pit floor and back, ten times a cycle
    const f=(k*10)%1, up=f<0.5 ? f*2 : 2-f*2, by=oy+10-Math.round(up*7);
    R(ox+8,oy+2,1,Math.max(0,by-oy-2),'#c9b48a');   // the rope
    R(ox+7,by,3,2,'#bdb6aa'); P(ox+7,by,'#d6d1c5');
  } else if (type===B_COPPERMINE){
    const glow=0.55+0.45*Math.sin(now/180)*Math.sin(now/67+1);
    ctx.globalAlpha=0.55+0.4*glow; R(ox+7,oy+5,2,3,'#ff8a2b'); ctx.globalAlpha=0.35+0.3*glow; R(ox+6,oy+6,4,2,'#ffb24a'); ctx.globalAlpha=1;
  }
  G=prev;
}
