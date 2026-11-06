/* ---------- pixel sprites for buildings (drawn into the buildings canvas of the picture's tiles) ----------
   A plot is PS×PS (16×16) pixels. Each building is drawn into a scratch canvas, outlined
   where it meets open ground, and stamped onto every tile of the picture it falls in
   (render/tiles.ts); a tile made later stamps the buildings standing in it then.
   Farms, barracks, watchtowers and coin minters are modular: each plot looks at its four
   neighbours, and plots of the same kind and owner join up, so fields merge into one farmland,
   barracks into one long hall, minters into one workshop, and towers link with walls. */
import { PW, PH, NP, PS, B_HOUSE, B_FARM, B_TOWER, B_MINE, B_CASTLE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_SITE, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_RESEARCH, B_GUILD, B_SMITHY, B_HOSPITAL, B_CARPENTER, B_NAVAL, TW } from '../core/constants';
import { W, isLand, pType, pOwner, pVar, pMain, pAband, pTier, pBurn } from '../sim/state';
import { cultureOf, drawCapital, wearCapital } from './capitals';
import { styleOf, type NationStyle } from './style';
import { towerTier, castleTier, wear } from '../sim/defense';
import { dims } from '../sim/buildings';
import { rows, outline, type Pal } from './pixel';
import { CH, painters, tilesIn, objectsCtx, type Tile } from './tiles';
import { ovPlot } from './terrain';

let only: Tile | null = null;   // while a new tile is painted, the only one buildings are stamped on
/** The tiles of the picture the rectangle (render pixels) falls in: those made, or just the new one. */
const targets = (x: number, y: number, w: number, h: number) => only ? (only.x0<x+w && x<only.x0+CH && only.y0<y+h && y<only.y0+CH ? [only] : []) : tilesIn(x,y,w,h);
/** Clears a rectangle of the buildings, wherever it has been drawn. */
function clearAt(x: number, y: number, w: number, h: number){ for (const c of targets(x,y,w,h)) c.octx?.clearRect(x-c.x0,y-c.y0,w,h); }
/** Paints the buildings of a new tile of the picture: every building with a plot in it (each from
    its main plot, its top-left: those up to a plot above and left of the tile too). */
function objectsOf(c: Tile){
  const px0=Math.max(0,c.x0/PS-1), py0=Math.max(0,c.y0/PS-1), px1=Math.min(PW-1,(c.x0+CH)/PS-1), py1=Math.min(PH-1,(c.y0+CH)/PS-1);
  only=c;
  for (let y=py0;y<=py1;y++) for (let x=px0;x<=px1;x++){ const q=y*PW+x, ty=pType[q]; if (ty && ty!==B_PART && ty!==B_CPART) drawPlot(q); }
  only=null;
}
painters.objects=objectsOf;
const tmp = document.createElement('canvas'); tmp.width = 4*PS; tmp.height = 4*PS;   // (room for a naval base: 4×2 plots, or 2×4)
const tctx = tmp.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
let G = tctx;   // where P and R draw: the scratch canvas, or an icon

function P(x: number, y: number, c: string){ G.fillStyle=c; G.fillRect(x,y,1,1); }
function R(x: number, y: number, w: number, h: number, c: string){ G.fillStyle=c; G.fillRect(x,y,w,h); }
const EDGE = 'rgba(30,20,14,0.9)';

/** Draws a w×h building at plot pixel (ox,oy) on the map: on scratch first, outlined, then stamped. */
function stamp(ox: number, oy: number, w: number, h: number, draw: () => void){
  const to=targets(ox,oy,w,h); if (!to.length) return;   // (nowhere it can be seen yet)
  G=tctx; tctx.clearRect(0,0,w,h); draw(); outline(tctx,0,0,w,h,EDGE);
  for (const c of to){ const o=objectsCtx(c); o.clearRect(ox-c.x0,oy-c.y0,w,h); o.drawImage(tmp,0,0,w,h,ox-c.x0,oy-c.y0,w,h); }
}

export const MODULAR = [B_FARM, B_BARRACKS, B_TOWER, B_MINTER];
const N_=1, E_=2, S_=4, W_=8;
/** Which neighbours of plot q are the same kind of building with the same owner (N/E/S/W bits). */
function joins(q: number){
  const ty=pType[q], o=pOwner[q], x=q%PW, y=(q/PW)|0;
  const same=(k: number)=>pType[k]===ty && pOwner[k]===o && !(ty===B_TOWER && (pBurn[k]>0 || pBurn[q]>0));   // a fallen tower brings its walls down
  return (y>0&&same(q-PW)?N_:0) | (x<PW-1&&same(q+1)?E_:0) | (y<PH-1&&same(q+PW)?S_:0) | (x>0&&same(q-1)?W_:0);
}
const SH = 'rgba(14,24,8,.3)';
const K_MUD_L = '#b38a5c';
const C = {
  mud:'#957049', mudD:'#73543a', mudL:'#b38a5c', th:'#cfa24c', thD:'#a17a32', thL:'#e6c473', thS:'#86622a',
  post:'#5c432c', door:'#33241a', glow:'#ffcf6a', beam:'#4a3424',
  st:'#b7b1a4', stD:'#837d72', stL:'#d9d3c6', stS:'#6a655d',
  wood:'#9a6e42', woodD:'#6c4a2c', woodL:'#c2915c',
  slate:'#4f5a68', slateL:'#6a7685', slateD:'#38404b',
};

/* ---------- houses ---------- */
// three kinds of hovel; rows are 16 wide. r/R/l are the kingdom's colours.
const HOUSES = [
  ['................','................','................','.......yy.......','.....yyttt...p..','....ytttttT..prr',
   '...yttttttTT.pRr','..yttttttTTTTp..','..tttttttTTTTp..','...sTTTTTTTTsp..','...vwwwwwwwwWp..','...vwwddwwgwWp..',
   '...vwwddwwwwW...','...WWWddWWWWW...','..xxxxxxxxxxxx..','................'],
  ['................','................','................','.......y........','......yyt.......','.....yyttT......',
   '....yytttTT.....','...yytttttTT....','..yyttttttTTT...','..sssssssssss...','..vwwwwwwwwwW...','..vgwwwddwwgW...',
   '..vwwwwddwwwW...','..WWWWWddWWWW...','.xxxxxxxxxxxxx..','................'],
  ['................','................','................','................','..k.............','..krrll.........',
   '..krrrrlll......','..kRrrrrrrll....','..kRRRrrrrrrl...','...RRRRRRrrrrk..','...vwwwwwwwwWk..','...vwwwddwwWWk..',
   '...vwwwddwwWWp..','...WWWWddWWWWp..','..xxxxxxxxxxxx..','................'],
];
// a stone house (tier 2) and a manor (tier 3): stone below, the manor's upper floor timber-framed
const STONE_HOUSE = ['................','................','..........hh....','.......lr.hh....','......lrrRhh....','.....lrrrrRh....',
  '....lrrrrrrR....','...lrrrrrrrrR...','..lrrrrrrrrrrR..','.kkkkkkkkkkkkkk.','..abbbcbbbbcbb..','..abggbbddbggb..',
  '..abffbcddcffb..','..accbbcddbccc..','.xxxxxxxxxxxxxx.','................'];
const MANOR = ['.......lr.......','......lrrR..hh..','.....lrrrrR.hh..','....lrrrrrrRhh..','...lrrrrrrrrRR..','..lrrrrrrrrrrRR.',
  '.kkkkkkkkkkkkkk.','.ekggkeeeekggke.','.ekffkekkekffke.','.kkkkkkkkkkkkkk.','.abbcbbbbbbcbbc.','.abggbbddbbggbc.',
  '.abffbcddcbffbc.','.accbbcddcbbccc.','.xxxxxxxxxxxxxx.','................'];
const mirror = (g: string[]) => g.map(r => [...r].reverse().join(''));
const TIERS = [STONE_HOUSE, mirror(STONE_HOUSE), MANOR, mirror(MANOR)];
// where cooking smoke rises from each kind of hovel, in plot pixels
const CHIMNEY = [[8,3],[8,3],[6,5]];
/** Where smoke rises from a house of `tier` and variant v, in plot pixels. */
export function chimneyOf(tier: number, v: number){
  if (tier<=1) return CHIMNEY[v%3];
  const [x,y] = tier===2 ? [10,1] : [12,0];
  return v&1 ? [14-x,y] : [x,y];
}
// holes in an abandoned house's roof
const HOLES = [[[6,6],[10,7],[5,8]],[[7,5],[10,8],[5,8]],[[5,6],[9,8],[7,7]]];
function drawHouse(ox: number, oy: number, n: NationStyle, v: number, empty: boolean, tier=1){
  if (tier>=2){ drawStoneHouse(ox,oy,n,v,empty,tier); return; }
  const shape=v%3, look=((v/3)|0)%3;   // (three shapes, each in one of three colourings)
  const walls=[[K_MUD_L,C.mud,C.mudD],['#f1ead8','#e2d8c0','#bfb294'],['#8a6a44','#6f5233','#52391f']][look];
  const thatch=[[C.thL,C.th,C.thD,C.thS],['#c9a35a','#a8843f','#7f6230','#6a4f26'],['#b9b27a','#9a9460','#76714a','#5b573a']][look];
  const pal: Pal = empty
    ? { y:'#9c9272', t:'#8c8160', T:'#726a50', s:'#5e5844', v:'#7d7262', w:'#6e6252', W:'#5a5044', d:'#7a6c58', g:'#4a4038', p:'#5a4a3a', k:'#4a4038', r:'#857a6a', R:'#6e6455', l:'#968a78', x:SH }
    : { y:thatch[0], t:thatch[1], T:thatch[2], s:thatch[3], v:walls[0], w:walls[1], W:walls[2], d:C.door, g:C.glow, p:C.post, k:C.beam, r:n.roof, R:n.roofD, l:n.roofL, x:SH };
  rows(G,ox,oy,HOUSES[shape],pal);
  if (empty){
    for (const [x,y] of HOLES[shape]) P(ox+x,oy+y,'#2a2420');
    const dx=shape===1?7:shape===2?7:6; R(ox+dx,oy+11,2,1,'#4a4038'); R(ox+dx,oy+13,2,1,'#4a4038');   // boards across the door
    P(ox+3,oy+13,'#5f8a3a'); P(ox+2,oy+12,'#6f9a44'); P(ox+12,oy+13,'#5f8a3a'); P(ox+13,oy+12,'#6f9a44');   // weeds
  }
}
/** A stone house or a manor; odd variants face the other way. */
function drawStoneHouse(ox: number, oy: number, n: NationStyle, v: number, empty: boolean, tier: number){
  const look=((v>>1)%3), wall=[[C.stL,C.st,'#8f897d',C.stD,'#eadfc4'],['#ecdcb8','#d4c196','#ae9a6c','#a89870','#f5ecd4'],['#d49a80','#bf7a5e','#9a5c44','#8a4e3a','#e8d6c4']][look];   // grey stone, warm limestone or red brick
  const pal: Pal = empty
    ? { l:'#968a78', r:'#857a6a', R:'#6e6455', k:'#4a4038', a:'#a29c90', b:'#8e887c', c:'#6e695f', g:'#3a332c', f:'#2e2824', d:'#4a4038', h:'#6e695f', e:'#a69c88', x:SH }
    : { l:n.roofL, r:n.roof, R:n.roofD, k:'#4a3424', a:wall[0], b:wall[1], c:wall[2], g:'#ffd86b', f:'#d99a3e', d:'#5a3c22', h:wall[3], e:wall[4], x:SH };
  const flip=v&1;
  rows(G,ox,oy,TIERS[(tier===3 ? 2 : 0)+flip],pal);
  const X=(x: number)=>ox+(flip ? 15-x : x);
  if (!empty){
    // flowers in a box under a downstairs window, and the kingdom's colour on the door
    if (tier===3){ R(Math.min(X(3),X(4)),oy+13,2,1,'#5f8a3a'); P(X(3),oy+13,'#e86a8a'); P(Math.min(X(8),X(9)),oy+11,n.roofL); }
    else { P(X(4),oy+13,'#5f8a3a'); P(X(5),oy+13,'#f2c84a'); }
    return;
  }
  const holes = tier===3 ? [[6,2],[10,4],[4,5]] : [[7,5],[10,7],[5,8]];
  for (const [x,y] of holes) P(X(x),oy+y,'#2a2420');
  R(Math.min(X(8),X(9)),oy+11,2,1,'#2e2824'); R(Math.min(X(8),X(9)),oy+13,2,1,'#2e2824');   // boards across the door
  P(X(2),oy+13,'#5f8a3a'); P(X(13),oy+12,'#6f9a44');   // weeds
}
/** A house going up: corner posts, a braced frame, sticks and a plank on the ground. */
function drawSite(ox: number, oy: number, n: NationStyle){
  R(ox+4,oy+5,1,9,C.woodD); R(ox+11,oy+5,1,9,C.woodD);
  R(ox+4,oy+5,8,1,C.wood); R(ox+5,oy+4,6,1,C.woodL);
  for (let i=0;i<5;i++){ P(ox+5+i,oy+6+i,C.wood); P(ox+10-i,oy+6+i,C.woodD); }   // cross braces
  R(ox+2,oy+14,4,1,C.woodL); R(ox+9,oy+14,5,1,C.wood); P(ox+3,oy+13,C.wood);
  R(ox+12,oy+4,2,2,n.roof); P(ox+12,oy+6,C.post);   // a marker in the kingdom's colour
  R(ox+3,oy+15,10,1,SH);
}

/* ---------- farms ---------- */
const CROPS = [['#d8b948','#f2db7c','#a88a2c'], ['#8dc24a','#b8e276','#5f9632'], ['#c8cf63','#e8ee98','#97a03c']];
function drawFarm(ox: number, oy: number, n: NationStyle, v: number, m: number){
  const [crop,tip,stem]=CROPS[v], rail=C.woodL, post=C.woodD;
  R(ox,oy,16,16,'#86643a');                                     // tilled soil
  const x0=m&W_?0:1, x1=m&E_?16:15;
  for (let y=2;y<16;y+=3){
    if (y>13 && !(m&S_)) break;
    R(ox+x0,oy+y+1,x1-x0,1,'#6f5230');                          // furrow
    for (let x=x0;x<x1;x++){ const k=(x+y+(ox>>4))%3; P(ox+x,oy+y,k===0?tip:crop); if (k!==1) P(ox+x,oy+y-1,k===0?crop:stem); }
  }
  // a fence only where the farmland ends
  if (!(m&N_)) R(ox,oy,16,1,rail);
  if (!(m&S_)) R(ox,oy+15,16,1,rail);
  if (!(m&W_)) R(ox,oy,1,16,rail);
  if (!(m&E_)) R(ox+15,oy,1,16,rail);
  for (const [px,py,a,b] of [[0,0,N_,W_],[15,0,N_,E_],[0,15,S_,W_],[15,15,S_,E_]]) if (!(m&a) || !(m&b)) P(ox+px,oy+py,post);
  if (!(m&N_)) for (const px of [5,10]) P(ox+px,oy,post);
  if (!(m&S_)) for (const px of [5,10]) P(ox+px,oy+15,post);
  // a scarecrow in the kingdom's colours where the field begins
  if (!(m&N_) && !(m&W_)){
    R(ox+4,oy+1,3,1,'#5a3c22'); P(ox+5,oy+2,'#e9d7a0');          // hat and face
    R(ox+3,oy+3,5,1,n.roof); R(ox+4,oy+4,3,2,n.roofD);           // coat, arms out
    R(ox+5,oy+6,1,3,post);
  }
}

/* ---------- barracks ---------- */
function drawBarracks(ox: number, oy: number, n: NationStyle, m: number){
  const x0=m&W_?0:1, x1=m&E_?16:15, w=x1-x0;
  R(ox+x0,oy+14,w,1,SH);
  R(ox+x0,oy+8,w,6,'#b39771'); R(ox+x0,oy+13,w,1,'#8c7452');      // timber hall, one long building when joined
  for (let x=x0+1;x<x1;x+=4) R(ox+x,oy+8,1,6,'#7e6646');           // posts
  R(ox+x0,oy+10,w,1,'#9a8060');                                    // rail
  if (!(m&W_)) R(ox+x0,oy+8,1,6,'#6e5638');
  if (!(m&E_)) R(ox+x1-1,oy+8,1,6,'#6e5638');
  // the roof in the kingdom's colours, tiled
  const r0=m&W_?0:1, r1=m&E_?0:1;
  R(ox+x0,oy+7,w,1,'#3b2a1e');
  R(ox+x0,oy+5,w,2,n.roofD); R(ox+x0,oy+4,w,1,n.roof); R(ox+x0+r0,oy+3,w-r0-r1,1,n.roof); R(ox+x0+r0+1-(m&W_?1:0),oy+2,w-r0-r1-2+(m&W_?1:0)+(m&E_?1:0),1,n.roofL);
  for (let x=x0+1;x<x1;x+=3) P(ox+x,oy+5,n.roof);
  R(ox+7,oy+10,2,4,C.door); P(ox+7,oy+10,'#4a3424');               // door
  for (const sx of [3,11]){ R(ox+sx,oy+9,2,2,n.roof); P(ox+sx,oy+9,n.roofL); P(ox+sx+1,oy+10,'#e8e0c8'); }   // shields on the wall
  if (!(m&W_)){ R(ox+1,oy,1,3,'#5a4030'); R(ox+2,oy,3,2,n.roof); P(ox+4,oy+1,n.roofD); }   // banner at the west end
  if (!(m&E_)){ for (const sx of [13,14]){ R(ox+sx,oy+9,1,5,C.woodD); P(ox+sx,oy+8,'#dcdcd0'); } }   // spears at the east end
}

/* ---------- watchtowers ----------
   Tier 1 a plain stone tower; tier 2 taller, with a timber gallery and a pointed roof in the
   kingdom's colours; tier 3 a broad pale keep with a spire, banners and braziers. From half its
   blows a tower looks battered: battlements and roof knocked off, cracks, soot and rubble. */
function drawTower(ox: number, oy: number, n: NationStyle, m: number, tier=1, worn=0){
  const st=tier===3 ? '#cfc8ba' : C.st, sd=tier===3 ? '#9a9387' : C.stD, sl=tier===3 ? '#ebe5d8' : C.stL;
  // walls toward neighbouring towers, with battlements
  if (m&E_){ R(ox+10,oy+8,6,6,st); R(ox+10,oy+12,6,2,sd); for (let x=11;x<16;x+=2) R(ox+x,oy+6,1,2,st); R(ox+10,oy+8,6,1,sl); }
  if (m&W_){ R(ox,oy+8,6,6,st); R(ox,oy+12,6,2,sd); for (let x=0;x<5;x+=2) R(ox+x,oy+6,1,2,st); R(ox,oy+8,6,1,sl); }
  if (m&N_){ R(ox+6,oy,4,6,st); R(ox+9,oy,1,6,sd); }
  if (m&S_){ R(ox+6,oy+14,4,2,st); R(ox+9,oy+14,1,2,sd); }
  if (tier===1){
    R(ox+5,oy+14,7,1,SH);
    R(ox+5,oy+5,6,10,st); R(ox+5,oy+5,1,10,sl); R(ox+10,oy+5,1,10,sd);   // the tower, lit from the left
    for (let y=7;y<15;y+=3) R(ox+6,oy+y,4,1,'#a7a194');                    // courses of stone
    R(ox+4,oy+4,8,1,sd); R(ox+4,oy+3,8,1,st);                              // the platform
    for (const x of [4,6,9,11]) R(ox+x,oy+1,1,2,st);                       // battlements
    R(ox+7,oy+7,2,2,'#2a211b');                                            // arrow slit
    R(ox+7,oy+11,2,4,C.door);
    R(ox+8,oy-0,1,3,'#4a3a2a'); R(ox+9,oy,3,2,n.roof); P(ox+11,oy+1,n.roofD);   // flag
  } else if (tier===2){
    R(ox+4,oy+14,9,1,SH);
    R(ox+4,oy+6,8,9,st); R(ox+4,oy+6,1,9,sl); R(ox+11,oy+6,1,9,sd);
    for (let y=8;y<15;y+=3) R(ox+5,oy+y,6,1,'#a7a194');
    R(ox+3,oy+4,10,2,C.wood); for (let x=4;x<13;x+=2) P(ox+x,oy+5,C.woodD); R(ox+3,oy+4,10,1,C.woodL);   // the timber gallery
    R(ox+3,oy+3,10,1,n.roofD); R(ox+4,oy+2,8,1,n.roof); R(ox+5,oy+1,6,1,n.roof); R(ox+6,oy,4,1,n.roofL);   // a pointed roof
    P(ox+4,oy+2,n.roofL); P(ox+11,oy+3,'#3b2a1e');
    R(ox+6,oy+8,1,2,'#2a211b'); R(ox+9,oy+8,1,2,'#2a211b');                // two arrow slits
    R(ox+7,oy+11,2,4,C.door); P(ox+7,oy+11,'#4a3424');
  } else {
    R(ox+3,oy+14,11,1,SH);
    R(ox+3,oy+6,10,9,st); R(ox+3,oy+6,1,9,sl); R(ox+12,oy+6,1,9,sd);
    for (let y=9;y<15;y+=3) R(ox+4,oy+y,8,1,'#b9b2a4');
    R(ox+2,oy+5,12,1,sd); for (let x=2;x<14;x+=2) R(ox+x,oy+4,1,1,st);   // the corbelled walk and its battlements
    R(ox+5,oy+3,6,1,n.roofD); R(ox+6,oy+2,4,1,n.roof); R(ox+6,oy+1,4,1,n.roof); R(ox+7,oy,2,1,n.roofL); P(ox+6,oy+1,n.roofL);   // the spire
    P(ox+2,oy+3,'#ff9a3c'); P(ox+13,oy+3,'#ff9a3c');                       // braziers burning on the walk
    R(ox+4,oy+7,1,3,n.roof); P(ox+4,oy+10,n.roofD); R(ox+11,oy+7,1,3,n.roof); P(ox+11,oy+10,n.roofD);   // banners
    R(ox+7,oy+7,2,2,'#ffd86b'); P(ox+7,oy+7,'#fff1b0');                    // a lit window
    R(ox+6,oy+10,1,2,'#2a211b'); R(ox+9,oy+10,1,2,'#2a211b');
    R(ox+7,oy+11,2,4,C.door); R(ox+7,oy+11,2,1,'#e8c45a');                 // a gilded lintel
  }
  if (worn) batter(ox,oy,TOWER_SCARS[tier],[[6,9]],[[tier===3 ? 9 : 8,12-tier,2,2]]);
}
// what a battered tower has lost: [pixels knocked out], [crack], [rubble]
const TOWER_SCARS: number[][][][] = [[], 
  [[[4,1],[11,1],[11,2],[9,1],[10,4]], [[6,6],[7,7],[6,8],[7,9],[8,10]], [[3,14],[4,13],[12,14],[13,13]]],
  [[[10,1],[11,2],[10,2],[12,3],[9,0],[3,4]], [[5,7],[6,8],[5,9],[6,10],[9,10],[10,11]], [[2,14],[3,13],[13,14],[14,13]]],
  [[[11,4],[12,4],[13,4],[8,1],[9,2],[2,3]], [[4,8],[5,9],[4,10],[10,9],[11,10],[10,11],[11,12]], [[1,14],[2,13],[14,14],[15,13],[13,13]]],
];
/** Battle damage on a building drawn at (ox,oy): pixels knocked out of it, a crack, soot, rubble at
    its foot, and breaches [x, y, w, h] smashed into its walls. */
function batter(ox: number, oy: number, [gone, crack, rubble]: number[][][], soot: number[][]=[], breach: number[][]=[]){
  for (const [x,y] of gone) G.clearRect(ox+x,oy+y,1,1);
  for (const [x,y,w,h] of breach){ R(ox+x,oy+y,w,h,'#3a2e26'); R(ox+x,oy+y+h-1,w,1,'#241b16'); P(ox+x+w,oy+y+1,'#6f695f'); }
  for (const [x,y] of soot){ G.fillStyle='rgba(30,24,20,.4)'; G.fillRect(ox+x,oy+y,3,2); G.fillRect(ox+x+1,oy+y-1,1,1); }
  for (const [x,y] of crack){ P(ox+x,oy+y,'#5a5048'); }
  for (const [x,y] of rubble){ P(ox+x,oy+y,'#8d867b'); P(ox+x+1,oy+y,'#6f695f'); P(ox+x,oy+y-1,'#a49d90'); }
}

/* ---------- coin minters ---------- */
function drawMinter(ox: number, oy: number, n: NationStyle, m: number){
  const x0=m&W_?0:1, x1=m&E_?16:15, w=x1-x0;
  R(ox+x0,oy+14,w,1,SH);
  R(ox+x0,oy+8,w,6,'#a39e94'); R(ox+x0,oy+13,w,1,'#7c776e');          // stone workshop, one long building when joined
  for (let x=x0+((ox>>4)&1);x<x1;x+=3) P(ox+x,oy+10,'#8f8a80'); for (let x=x0+1;x<x1;x+=3) P(ox+x,oy+12,'#8f8a80');
  R(ox+x0,oy+7,w,1,C.slateD); R(ox+x0,oy+5,w,2,C.slate); R(ox+x0,oy+4,w,1,C.slateL);   // slate roof
  R(ox+x0+(m&W_?0:1),oy+3,w-(m&W_?0:1)-(m&E_?0:1),1,n.roof);          // ridge in the kingdom's colour
  R(ox+4,oy+10,2,4,'#d9602a'); R(ox+4,oy+10,2,2,'#ffb24a');           // furnace mouth
  R(ox+10,oy+9,3,3,'#ffd23f'); P(ox+11,oy+10,'#b8860b'); P(ox+10,oy+9,'#fff0a0');   // coin sign
  if (!(m&E_)){ R(ox+12,oy,2,4,'#6e6a62'); R(ox+12,oy,2,1,'#4a4740'); }   // chimney at the east end
}
function drawMine(ox: number, oy: number, n: NationStyle){
  R(ox+2,oy+9,12,5,'#9a958b'); R(ox+4,oy+7,8,2,'#aca79c'); R(ox+2,oy+14,12,1,SH);
  R(ox+6,oy+9,4,5,'#2c231d'); R(ox+5,oy+8,6,1,C.woodD); R(ox+5,oy+9,1,5,C.woodD); R(ox+10,oy+9,1,5,C.woodD);
  P(ox+12,oy+12,'#f2d14b'); P(ox+3,oy+12,'#e0c04a');
  R(ox+13,oy+3,1,5,'#4a3a2a'); R(ox+14,oy+3,2,2,n.roof);
}

/* ---------- research station: a scholars' hall with an observatory dome ---------- */
function drawResearch(ox: number, oy: number, n: NationStyle){
  const st=C.st, sd=C.stD, sl=C.stL, dome='#5c9e93', domeL='#8cc8bc', domeD='#3c6f68', brass='#d6ad4c';
  R(ox+1,oy+14,14,1,SH);
  // the hall, plastered, under a roof in the kingdom's colours
  R(ox+1,oy+9,8,5,'#e3d7bc'); R(ox+1,oy+13,8,1,'#b9ab8c'); R(ox+1,oy+9,1,5,'#f1e8d2');
  R(ox+1,oy+8,8,1,'#3b2a1e'); R(ox+1,oy+6,8,2,n.roofD); R(ox+2,oy+5,6,1,n.roof); R(ox+3,oy+4,4,1,n.roofL);
  R(ox+3,oy+10,2,2,'#ffd86b'); P(ox+3,oy+10,'#fff1b0'); R(ox+3,oy+12,2,1,'#6b4a2c');   // a lit window over a shelf of books
  P(ox+3,oy+12,'#c0503a'); P(ox+4,oy+12,'#3d6fb0');
  R(ox+6,oy+10,2,4,C.door);
  // the round tower, its dome open to the sky, a telescope looking out
  R(ox+9,oy+6,6,8,st); R(ox+9,oy+6,1,8,sl); R(ox+14,oy+6,1,8,sd);
  for (let y=8;y<14;y+=3) R(ox+10,oy+y,4,1,'#a7a194');
  R(ox+11,oy+10,2,2,'#7fd0ff'); P(ox+11,oy+10,'#d8f2ff');   // the lens room's window
  R(ox+9,oy+5,6,1,sd);
  R(ox+10,oy+2,4,3,dome); R(ox+9,oy+3,6,2,dome); R(ox+10,oy+2,2,1,domeL); P(ox+9,oy+3,domeL); R(ox+13,oy+3,1,2,domeD); P(ox+14,oy+4,domeD);
  R(ox+12,oy+2,1,3,'#2a2420');   // the slit
  P(ox+12,oy+1,brass); P(ox+13,oy,brass); P(ox+14,oy,'#f2d27a');   // the telescope
}

/* ---------- blacksmith: a stone forge open at the front, its hearth glowing, an anvil outside ---------- */
function drawSmithy(ox: number, oy: number, n: NationStyle){
  const st=C.st, sd=C.stD, sl=C.stL;
  R(ox+1,oy+14,14,1,SH);
  R(ox+1,oy+7,10,7,st); R(ox+1,oy+7,1,7,sl); R(ox+10,oy+7,1,7,sd);       // stone walls
  for (let y=9;y<14;y+=2) R(ox+2,oy+y,8,1,'#a7a194');
  R(ox+1,oy+6,10,1,'#3b2a1e'); R(ox+1,oy+4,10,2,n.roofD); R(ox+2,oy+3,8,1,n.roof); R(ox+3,oy+2,6,1,n.roofL);   // the roof
  R(ox+8,oy,2,4,sd); R(ox+8,oy,2,1,'#4a4740');                            // the chimney
  R(ox+3,oy+9,5,5,'#2a1d16'); R(ox+4,oy+11,3,2,'#ff8a2b'); R(ox+4,oy+11,3,1,'#ffd27a'); P(ox+5,oy+10,'#ff6a1c');   // the hearth
  R(ox+12,oy+11,3,1,'#4a4f55'); R(ox+13,oy+12,1,2,'#3a3e43'); R(ox+11,oy+11,1,1,'#6c737a');   // the anvil
  R(ox+12,oy+8,2,1,'#8d949b'); P(ox+12,oy+9,'#6c737a'); P(ox+13,oy+9,n.roof);               // a helm hung up, in the kingdom's colours
}

/** Carpenters: a timber workshop under a roof in the kingdom's colour, planks stacked beside it, a sawhorse with a board on it and a saw on the wall. */
function drawCarpenter(ox: number, oy: number, n: NationStyle){
  R(ox+1,oy+14,14,1,SH);
  R(ox+2,oy+7,9,7,'#9a6e42'); R(ox+2,oy+7,9,1,'#c2915c'); for (let x=4;x<11;x+=2) R(ox+x,oy+8,1,6,'#7d5632');   // plank walls
  R(ox+1,oy+5,11,2,n.roofD); R(ox+2,oy+3,9,2,n.roof); R(ox+3,oy+2,7,1,n.roofL); R(ox+1,oy+6,11,1,'#3b2a1e');       // the roof
  R(ox+3,oy+9,4,5,'#33241a'); R(ox+8,oy+9,2,2,'#ffcf6a');                                                           // door and window
  R(ox+8,oy+12,3,1,'#bfc6cc'); P(ox+8,oy+11,'#8a9399'); P(ox+10,oy+11,'#8a9399');                                  // a saw on the wall
  R(ox+12,oy+8,3,6,'#d9b27a'); R(ox+12,oy+8,3,1,'#ecd2a0'); R(ox+12,oy+10,3,1,'#b08850'); R(ox+12,oy+12,3,1,'#b08850'); // stacked planks
  R(ox+12,oy+5,1,3,'#6c4a2c'); R(ox+13,oy+5,2,2,n.roof);                                                           // the kingdom's pennant
}

/** Blacksmiths joined side by side (2×1) or four together (2×2): the forges in a row, their roofs bridged over the seams. Looks only. */
function drawSmithyBig(ox: number, oy: number, n: NationStyle, w: number, h: number){
  for (let r=0;r<h;r++) for (let c=0;c<w;c++) drawSmithy(ox+c*16,oy+r*16,n);
  for (let r=0;r<h-1;r++){   // a trodden yard between the rows of forges
    const y=oy+r*16+14; R(ox+1,y,w*16-2,2,'#7d6a4a'); R(ox+1,y,w*16-2,1,'#8d7a58');
    for (let x=2;x<w*16-2;x+=5) P(ox+x,y+1,'#6a5a3e');
  }
  for (let r=0;r<h;r++) for (let c=0;c<w-1;c++){
    const x=ox+c*16+11, y=oy+r*16;
    R(x,y+6,6,1,'#3b2a1e'); R(x,y+4,6,2,n.roofD); R(x+1,y+3,4,1,n.roof); R(x+2,y+2,2,1,n.roofL);   // the roof carried across
  }
}

/* ---------- builders guild (2×1 plots): a workshop and its yard of timber and stone ---------- */
const woundedList = () => W.wounded;   // (drawWorking has a W of its own)
/* ---------- the hospital (2×1 plots): a medieval infirmary with an open ward, two beds, and a red cross over the door ---------- */
/** Where the two beds' heads lie in the 32×16 picture. */
export const HOSPITAL_BEDS = [[7,10],[21,10]];
function drawHospital(ox: number, oy: number, n: NationStyle){
  R(ox+1,oy+14,30,1,SH);
  // the hall: pale plaster with a timber frame, a steep tiled roof in the kingdom's colour and a little bell turret
  R(ox+1,oy+6,30,8,'#efe6d0'); R(ox+1,oy+13,30,1,'#c9bd9f');
  for (const x of [1,10,15,16,21,30]) R(ox+x,oy+6,1,8,'#5a3e28');
  R(ox+1,oy+6,30,1,'#5a3e28');
  R(ox,oy+4,32,2,n.roofD); R(ox+1,oy+3,30,1,n.roof); R(ox+3,oy+2,26,1,n.roof); R(ox+5,oy+1,22,1,n.roofL);
  for (let x=2;x<30;x+=3) P(ox+x,oy+4,n.roof);
  R(ox+14,oy-1,4,3,'#d8cdb0'); R(ox+15,oy,2,2,'#3b2a1e'); R(ox+15,oy-2,2,1,'#6b4a2c');   // the bell turret
  // two open arched wards: a bed in each (a white sheet, a pillow, a wooden frame)
  for (const [bx] of HOSPITAL_BEDS){
    R(ox+bx-4,oy+7,9,6,'#3a2a1c'); R(ox+bx-3,oy+7,7,1,'#4a382a');       // the alcove
    R(ox+bx-4,oy+11,9,1,C.woodL); R(ox+bx-4,oy+12,1,2,C.woodD); R(ox+bx+4,oy+12,1,2,C.woodD);   // the bed frame and its legs
    R(ox+bx-3,oy+10,7,1,'#f4f1ea'); R(ox+bx-3,oy+9,3,1,'#fbfaf5');       // the sheet and the pillow
    P(ox+bx-4,oy+7,'#5a3e28'); P(ox+bx+4,oy+7,'#5a3e28');
  }
  R(ox+13,oy+9,6,5,'#3a2a1c'); R(ox+16,oy+9,1,5,'#5a4030');            // the door between them
  R(ox+13,oy+8,6,1,'#5a3e28');
  // the red cross on a white board over the door
  R(ox+13,oy+5,6,3,'#fbfaf5'); R(ox+15,oy+5,2,3,'#c0302a'); R(ox+14,oy+6,4,1,'#c0302a');
  R(ox+29,oy,1,4,'#4a3a2a'); R(ox+30,oy,2,2,n.roof);                     // the pennant
}
function drawGuild(ox: number, oy: number, n: NationStyle){
  R(ox+1,oy+14,30,1,SH);
  // the workshop, half-timbered, with a wide door and the guild's hammer sign
  R(ox+1,oy+8,16,6,'#e6dabd'); R(ox+1,oy+13,16,1,'#b9ab8c');
  for (const x of [1,6,11,16]) R(ox+x,oy+8,1,6,'#5a3e28');
  R(ox+1,oy+10,16,1,'#5a3e28');
  R(ox+1,oy+7,16,1,'#3b2a1e'); R(ox+1,oy+5,16,2,n.roofD); R(ox+2,oy+4,14,1,n.roof); R(ox+3,oy+3,12,1,n.roof); R(ox+4,oy+2,10,1,n.roofL);
  for (let x=3;x<16;x+=3) P(ox+x,oy+5,n.roof);
  R(ox+7,oy+11,4,3,'#3a2a1c'); R(ox+9,oy+11,1,3,'#5a4030');   // the open door
  R(ox+2,oy+11,3,2,'#ffcf6a'); P(ox+2,oy+11,'#fff0b0');       // a lit window
  R(ox+12,oy+11,4,2,'#d8c9a4'); R(ox+13,oy+11,1,2,'#6b4a2c'); R(ox+12,oy+11,3,1,'#9aa0a6');   // the sign: a hammer
  R(ox+14,oy,2,3,C.stD); R(ox+14,oy,2,1,'#4a4740');           // the forge chimney
  // the yard: a stack of planks, a pile of cut stone, and a crane
  R(ox+18,oy+11,6,3,C.wood); R(ox+18,oy+11,6,1,C.woodL); R(ox+18,oy+13,6,1,C.woodD); P(ox+18,oy+12,C.woodD); P(ox+23,oy+12,C.woodD);
  R(ox+25,oy+11,5,3,C.st); R(ox+25,oy+11,5,1,C.stL); R(ox+27,oy+12,1,2,C.stD); R(ox+26,oy+9,3,2,C.st); R(ox+26,oy+9,3,1,C.stL);
  R(ox+20,oy+1,1,10,C.woodD); R(ox+20,oy+1,9,1,C.wood); P(ox+21,oy+2,C.woodD); P(ox+22,oy+3,C.woodD);   // the crane's mast, jib and brace
  R(ox+29,oy,1,3,'#4a3a2a'); R(ox+30,oy,2,2,n.roof);         // the guild's pennant
}

/* ---------- the naval base (4×2 plots, or 2×4): a yard on the shore and piers over the water ----------
   Drawn tile by tile (4×4 pixels each): flagstones where there is land, a plank quay along the
   shore, piers running out from it, a warehouse on the yard, a crane and a pennant. */
function drawNaval(ox: number, oy: number, n: NationStyle, w: number, h: number, q: number){
  const TX=w*4, TY=h*4, px0=q>=0 ? (q%PW)*4 : 0, py0=q>=0 ? ((q/PW)|0)*4 : 0;
  const wet=(tx: number, ty: number) => tx<0||ty<0||tx>=TX||ty>=TY ? false : q>=0 ? !isLand[(py0+ty)*TW+px0+tx] : (w>=h ? tx>=Math.round(TX*0.62) : ty>=Math.round(TY*0.62));
  // how far each water tile is from the yard, and which way the shore runs (a horizontal or vertical step away from it)
  const dist=new Int8Array(TX*TY).fill(-1), axis=new Int8Array(TX*TY), Q: number[]=[];
  for (let ty=0;ty<TY;ty++) for (let tx=0;tx<TX;tx++) if (!wet(tx,ty)){ dist[ty*TX+tx]=0; Q.push(ty*TX+tx); }
  for (let i=0;i<Q.length;i++){
    const k=Q[i], tx=k%TX, ty=(k/TX)|0;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=tx+dx, y=ty+dy; if (x<0||y<0||x>=TX||y>=TY||dist[y*TX+x]>=0) continue;
      dist[y*TX+x]=dist[k]+1; axis[y*TX+x]=dist[k]===0 ? (dx ? 0 : 1) : axis[k]; Q.push(y*TX+x);
    }
  }
  for (let ty=0;ty<TY;ty++) for (let tx=0;tx<TX;tx++){
    const k=ty*TX+tx, x=ox+tx*4, y=oy+ty*4, d=dist[k];
    if (d===0){   // the yard: flagstones
      R(x,y,4,4,'#b3ab98'); R(x,y+3,4,1,'#9b937f'); R(x+((tx+ty)&1 ? 2 : 0),y,1,3,'#9b937f'); P(x+1,y+1,'#c6bfae');
    } else if (d>0){
      const lateral=axis[k]===0 ? ty : tx;
      if (d===1 || (d<=6 && lateral%6===2)){   // the quay along the shore, and piers out from it
        R(x,y,4,4,'#9b6b3f');
        if (axis[k]===0){ R(x,y,4,1,'#b98650'); R(x,y+2,4,1,'#7d5430'); } else { R(x,y,1,4,'#b98650'); R(x+2,y,1,4,'#7d5430'); }
        if (d===1 && lateral%6===2) P(x+1,y+1,'#4a3220');   // a mooring post
      } else if (d<=5 && ((tx+ty)%7===3)){ P(x+1,y+1,'#4a3220'); P(x+1,y+2,'#7a5634'); }   // a pile standing in the water
    }
  }
  // the warehouse: on the yard where a 3×2 block of land lies nearest its middle
  let best=-1, bd=1e9;
  for (let ty=0;ty<=TY-2;ty++) for (let tx=0;tx<=TX-3;tx++){
    let ok=true; for (let j=0;j<2 && ok;j++) for (let i=0;i<3;i++) if (dist[(ty+j)*TX+tx+i]!==0){ ok=false; break; }
    if (!ok) continue;
    const dd=(tx+1.5-TX/2)**2+(ty+1-TY/2)**2; if (dd<bd){ bd=dd; best=ty*TX+tx; }
  }
  if (best>=0){
    const bx=ox+(best%TX)*4, by=oy+((best/TX)|0)*4;
    R(bx,by+3,12,5,'#e6dabd'); R(bx,by+7,12,1,'#b9ab8c'); R(bx+3,by+3,1,5,'#5a3e28'); R(bx+8,by+3,1,5,'#5a3e28');
    R(bx-1,by+2,14,1,'#3b2a1e'); R(bx-1,by,14,2,n.roofD); R(bx,by-1,12,1,n.roof); R(bx+2,by-2,8,1,n.roofL);
    R(bx+4,by+4,4,4,'#3a2a1c'); R(bx+6,by+4,1,4,'#5a4030');
    R(bx+10,by-1,1,2,'#4a3a2a'); R(bx+11,by-2,2,2,n.roof);   // a pennant
    // crates and a barrel by the door
    R(bx-4,by+5,3,3,C.wood); R(bx-4,by+5,3,1,C.woodL); P(bx-3,by+6,C.woodD);
    R(bx+13,by+4,3,4,'#7a5634'); R(bx+13,by+5,3,1,'#4a3220'); R(bx+13,by+7,3,1,'#4a3220');
  }
  // a crane at the quay: a mast on the yard, a jib over the water
  for (let ty=0;ty<TY;ty++) for (let tx=0;tx<TX;tx++){
    if (dist[ty*TX+tx]!==0) continue;
    const e=dist[ty*TX+tx+1]===1 && tx+1<TX ? 0 : dist[(ty+1)*TX+tx]===1 && ty+1<TY ? 1 : -1;
    if (e<0 || (tx+ty)%6!==1) continue;
    const x=ox+tx*4, y=oy+ty*4;
    R(x+1,y-6,1,9,C.woodD); if (e===0){ R(x+1,y-6,7,1,C.wood); P(x+7,y-5,'#c9b48a'); R(x+7,y-4,1,3,'#c9b48a'); } else { R(x-5,y-6,7,1,C.wood); P(x-4,y-5,'#c9b48a'); R(x-4,y-4,1,3,'#c9b48a'); }
    break;
  }
}

/* ---------- the castle (2×2 plots) ----------
   Tier 1 a keep within a curtain wall; tier 2 a fortress, its corner towers taller and roofed,
   a turret rising from the keep; tier 3 a pale citadel trimmed in gold, a spire on the keep and
   banners on every tower. Damaged, it loses battlements and cracks; badly damaged, its roofs are
   broken, fires burn in it and rubble lies at its feet. */
function drawCastle(ox: number, oy: number, n: NationStyle, tier=1, worn=0){
  const pale=tier===3, st=pale ? '#d8d1c3' : C.st, sd=pale ? '#a39c8f' : C.stD, sl=pale ? '#f1ebdf' : C.stL, course=pale ? '#c4bdaf' : '#a7a194';
  const dk='#2e241c', gold='#e8c45a', lit='#ffd86b';
  R(ox+2,oy+30,28,1,SH);
  // curtain wall with battlements (a gilded string course on the citadel)
  const wallTop=tier===1 ? 18 : 17;
  R(ox+4,oy+wallTop,24,30-wallTop,st); R(ox+4,oy+28,24,2,sd); R(ox+4,oy+wallTop,24,1,sl);
  for (let x=5;x<27;x+=2) R(ox+x,oy+wallTop-2,1,2,st);
  for (let y=wallTop+3;y<28;y+=3) R(ox+6,oy+y,20,1,course);
  if (pale) R(ox+4,oy+wallTop+1,24,1,gold);
  // corner towers: pointed roofs; taller and crenellated for a fortress; flags on the citadel's
  const tTop=tier===1 ? 11 : 9;
  for (const tx of [0,25]){
    R(ox+tx,oy+tTop,7,30-tTop,st); R(ox+tx,oy+tTop,1,30-tTop,sl); R(ox+tx+6,oy+tTop,1,30-tTop,sd);
    R(ox+tx,oy+tTop-1,7,1,sd);
    if (tier===1){ R(ox+tx+1,oy+8,5,2,n.roofD); R(ox+tx+2,oy+6,3,2,n.roof); P(ox+tx+3,oy+5,n.roofL); P(ox+tx+3,oy+4,'#4a3a2a'); }
    else {
      R(ox+tx,oy+6,7,1,n.roofD); R(ox+tx+1,oy+4,5,2,n.roofD); R(ox+tx+2,oy+2,3,2,n.roof); P(ox+tx+3,oy+1,n.roofL); P(ox+tx+2,oy+3,n.roofL);
      for (const bx of [0,2,4,6]) P(ox+tx+bx,oy+tTop-2,st);
      if (pale){ R(ox+tx,oy+7,7,1,gold); P(ox+tx+3,oy,gold); }
    }
    R(ox+tx+3,oy+14,1,2,dk); R(ox+tx+3,oy+22,1,2,dk);
  }
  // the keep
  const kTop=tier===1 ? 6 : 8;
  R(ox+10,oy+kTop,12,22-kTop,sl); R(ox+10,oy+kTop,1,22-kTop,pale ? '#fbf8f1' : '#ece7dc'); R(ox+21,oy+kTop,1,22-kTop,sd);
  for (let y=kTop+4;y<22;y+=4) R(ox+11,oy+y,10,1,pale ? '#ddd6c8' : '#c8c2b6');
  R(ox+9,oy+kTop-1,14,1,sd);
  if (tier===1){
    R(ox+10,oy+3,12,2,n.roofD); R(ox+11,oy+2,10,1,n.roof); R(ox+12,oy+1,8,1,n.roof); R(ox+13,oy,6,1,n.roofL);
    for (const [x,y] of [[13,8],[18,8],[13,13],[18,13]]){ R(ox+x,oy+y,2,3,lit); P(ox+x,oy+y,'#fff1b0'); }
  } else {
    for (let x=9;x<23;x+=2) P(ox+x,oy+kTop-2,sl);                         // the keep's battlements
    // a turret rising from the keep, roofed (a spire on the citadel)
    R(ox+13,oy+3,6,kTop-3,sl); R(ox+18,oy+3,1,kTop-3,sd); R(ox+15,oy+4,2,2,lit);
    R(ox+12,oy+2,8,1,n.roofD); R(ox+13,oy+1,6,1,n.roof); R(ox+14,oy,4,1,n.roofL);
    if (pale){ R(ox+12,oy+3,8,1,gold); P(ox+15,oy,gold); P(ox+16,oy,gold); }
    for (const [x,y] of [[12,10],[18,10],[12,15],[18,15]]){ R(ox+x,oy+y,2,3,lit); P(ox+x,oy+y,'#fff1b0'); }
    if (pale) for (const [x,y] of [[15,11],[15,16]]){ R(ox+x,oy+y,2,2,lit); }
  }
  // gate
  R(ox+13,oy+22,6,8,dk); R(ox+14,oy+21,4,1,dk);
  for (let x=14;x<18;x+=2) R(ox+x,oy+22,1,7,tier===1 ? '#5a4a3a' : '#6a5a42');
  R(ox+13,oy+25,6,1,'#5a4a3a');
  if (tier>=2){ R(ox+12,oy+21,1,9,sd); R(ox+19,oy+21,1,9,sd); }
  if (pale) R(ox+13,oy+20,6,1,gold);
  // hanging banners
  const bh=tier===1 ? 5 : 7;
  for (const bx of [7,23]){ R(ox+bx,oy+19,2,bh,n.roof); P(ox+bx,oy+19+bh,n.roofD); P(ox+bx+1,oy+19+bh,n.roofD); P(ox+bx,oy+19,n.roofL); if (pale) R(ox+bx,oy+18,2,1,gold); }
  if (worn===1) batter(ox,oy,CASTLE_SCARS[tier][0],[[19,12],[6,22]],[[24,21,2,2]]);
  if (worn===2){
    batter(ox,oy,CASTLE_SCARS[tier][1],[[12,12],[20,18],[5,22],[24,24],[15,7]],[[24,20,3,3],[5,23,2,3],[19,13,2,2]]);
    G.clearRect(ox+25,oy+1,4,4); G.clearRect(ox+20,oy+kTop-2,3,2);   // a tower's roof and part of the keep's top gone
    for (const [x,y] of [[11,8],[26,11],[3,20],[20,kTop]]){ P(ox+x,oy+y,'#ff9a3c'); P(ox+x,oy+y-1,'#ffd27a'); P(ox+x+1,oy+y,'#e0602a'); P(ox+x,oy+y-2,'#fff0a0'); }   // fires burning in the breaches
  }
}
// damaged and badly damaged, by tier: [pixels knocked out], [cracks], [rubble]
const CASTLE_SCARS: number[][][][][] = [[],
  [ [[[6,16],[9,16],[25,16],[27,11],[16,1]], [[14,9],[15,10],[14,11],[15,12],[7,20],[8,21],[7,22]], [[1,30],[29,30]]],
    [[[6,16],[9,16],[13,16],[21,16],[25,16],[27,11],[1,8],[2,9],[3,10],[16,0],[17,1],[18,2],[19,3],[20,3]], [[14,9],[15,10],[14,11],[15,12],[14,13],[7,20],[8,21],[7,22],[8,23],[24,21],[23,22],[24,23],[19,14],[20,15]], [[1,30],[3,29],[28,30],[29,29],[10,30],[21,30]]] ],
  [ [[[5,15],[9,15],[27,7],[16,0],[1,7]], [[13,11],[14,12],[13,13],[7,19],[8,20],[7,21]], [[1,30],[29,30]]],
    [[[5,15],[9,15],[13,15],[21,15],[25,15],[27,7],[29,4],[28,5],[1,7],[2,6],[16,0],[17,0],[18,1],[19,2],[13,3]], [[13,11],[14,12],[13,13],[14,14],[7,19],[8,20],[7,21],[8,22],[24,20],[23,21],[24,22],[19,16],[20,17]], [[1,30],[3,29],[28,30],[29,29],[10,30],[21,30]]] ],
  [ [[[5,15],[9,15],[27,7],[15,0],[1,7]], [[13,11],[14,12],[13,13],[7,19],[8,20],[7,21]], [[1,30],[29,30]]],
    [[[5,15],[9,15],[13,15],[21,15],[25,15],[27,7],[29,4],[28,5],[1,7],[2,6],[15,0],[16,0],[18,1],[19,2],[13,3],[12,2]], [[13,11],[14,12],[13,13],[14,14],[7,19],[8,20],[7,21],[8,22],[24,20],[23,21],[24,22],[19,16],[20,17]], [[1,30],[3,29],[28,30],[29,29],[10,30],[21,30]]] ],
];

/* ---------- ruins ---------- */
function drawRuins(ox: number, oy: number, v: number){
  const cols=['#3b3430','#57504a','#7b746c','#2a2422','#4a3a2c'];
  let h=(v*97+13+ox*7+oy*13)>>>0;
  const rnd=()=>{ h=(Math.imul(h,1103515245)+12345)>>>0; return h>>>8; };
  R(ox+2,oy+13,12,2,'rgba(40,34,30,.35)');                         // ash
  for (let k=0;k<9;k++){ const x=2+rnd()%11, y=5+rnd()%9, c=cols[rnd()%5]; R(ox+x,oy+y,1+rnd()%2,1+rnd()%2,c); }
  for (let k=0;k<2;k++){ const x=3+rnd()%8, y=6+rnd()%5; for (let i=0;i<4;i++) P(ox+x+i,oy+y+(i>>1),'#2a1e16'); }   // charred beams
}

/** Redraws whatever stands on building plot q. */
export function drawPlot(q: number){
  if (!only) ovPlot(q);   // (the overview shows towns too)
  const ox=(q%PW)*PS, oy=((q/PW)|0)*PS, ty=pType[q];
  if (ty===B_CPART){ const m=pMain[q]; if (pType[m]===B_CASTLE){ drawPlot(m); return; } }
  if (ty===B_PART){ const m=pMain[q]; if (BIG[pType[m]] || pType[m]===B_NAVAL || pType[m]===B_SMITHY){ drawPlot(m); return; } clearAt(ox,oy,PS,PS); return; }
  const n=styleOf(pOwner[q]);
  if (ty===B_NAVAL){ const [w,h]=dims(q); stamp(ox,oy,w*PS,h*PS,()=>drawNaval(0,0,n,w,h,q)); return; }
  if (BIG[ty]){ const [w,h]=dims(q); stamp(ox,oy,w*PS,h*PS,()=>drawBig(0,0,ty,n,w,h)); return; }
  if (ty===B_SMITHY){ const [w,h]=dims(q); stamp(ox,oy,w*PS,h*PS,()=>drawSmithyBig(0,0,n,w,h)); return; }
  if (ty===B_CASTLE){
    // each country builds its capital in its own tradition (render/capitals.ts); the West, a keep
    const t=castleTier(pOwner[q]), w=wear(q), code=W.nations[pOwner[q]]?.code ?? '';
    if (cultureOf(code)==='west') stamp(ox,oy,2*PS,2*PS,()=>drawCastle(0,0,n,t,w));
    else stamp(ox,oy,2*PS,2*PS,()=>{ drawCapital(G,0,0,n,code,t); wearCapital(G,0,0,w,q+t*7); });
    return;
  }
  const v=pVar[q]%3;
  if (ty===B_HOUSE){ const t=pTier[q]; stamp(ox,oy,PS,PS,()=>drawHouse(0,0,n,pVar[q],!!pAband[q],t)); }
  else if (ty===B_RESEARCH) stamp(ox,oy,PS,PS,()=>drawResearch(0,0,n));
  else if (ty===B_SITE) stamp(ox,oy,PS,PS,()=>drawSite(0,0,n));
  else if (ty===B_FARM){ const m=joins(q); stamp(ox,oy,PS,PS,()=>drawFarm(0,0,n,pOwner[q]%3,m)); }   // one crop per kingdom, so joined fields match
  else if (ty===B_TOWER){ const m=joins(q), t=towerTier(q), w=wear(q); stamp(ox,oy,PS,PS,()=>drawTower(0,0,n,m,t,w)); }
  else if (ty===B_BARRACKS){ const m=joins(q); stamp(ox,oy,PS,PS,()=>drawBarracks(0,0,n,m)); }
  else if (ty===B_MINTER){ const m=joins(q); stamp(ox,oy,PS,PS,()=>drawMinter(0,0,n,m)); }
  else if (ty===B_CARPENTER) stamp(ox,oy,PS,PS,()=>drawCarpenter(0,0,n));
  else if (ty===B_MINE) stamp(ox,oy,PS,PS,()=>drawMine(0,0,n));
  else if (ty===B_RUINS) stamp(ox,oy,PS,PS,()=>drawRuins(0,0,pVar[q]));
  else if (ty===B_CPART){ /* part of a burned castle still standing: leave */ }
  else clearAt(ox,oy,PS,PS);
}

/** Redraws plot q and any modular neighbours whose joins it may have changed. */
export function drawPlotAndNeighbours(q: number){
  drawPlot(q);
  const x=q%PW;
  for (const k of [q-PW, x<PW-1?q+1:-1, q+PW, x>0?q-1:-1]) if (k>=0 && k<NP && MODULAR.includes(pType[k])) drawPlot(k);
}

/** Draws a building's sprite into an icon (one plot is 16×16, unjoined) in the given kingdom colours. */
export function drawIcon(ctx: CanvasRenderingContext2D, type: number, n: NationStyle, orient=0){
  const prev=G; G=ctx; ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  if (type===B_FARM) drawFarm(0,0,n,1,0); else if (type===B_BARRACKS) drawBarracks(0,0,n,0);
  else if (type===B_TOWER) drawTower(0,0,n,0); else if (type===B_MINTER) drawMinter(0,0,n,0);
  else if (type===B_HOUSE) drawHouse(0,0,n,0,false);
  else if (type===B_RESEARCH) drawResearch(0,0,n);
  else if (type===B_SMITHY) drawSmithy(0,0,n);
  else if (type===B_CARPENTER) drawCarpenter(0,0,n);
  else if (type===B_NAVAL) drawNaval(0,0,n,orient ? 2 : 4,orient ? 4 : 2,-1);
  else if (BIG[type]){ drawBig(0,0,type,n); drawWorking(ctx,type,0,0,0.99,0); }
  outline(ctx,0,0,ctx.canvas.width,ctx.canvas.height,EDGE);
  G=prev;
}

/* ---------- production buildings: a static base here plus live work drawn each frame ----------
   Plantations, quarries and copper mines are drawn at their size: one plot (tier 1), two side by
   side (tier 2) or a 2×2 block (tier 3); the builders guild is always 2×1. */
export const BIG: Record<number, [number, number]> = { [B_PLANTATION]: [1,1], [B_QUARRY]: [1,1], [B_COPPERMINE]: [1,1], [B_GUILD]: [2,1], [B_HOSPITAL]: [2,1] };
/** Where the trees of a plantation (a sawmill yard) of w×h plots stand, by the foot of the trunk: one beside the shed in a single plot, more in the bigger yards. */
const slots = (w: number, h: number) => {
  const W=w*16, H=h*16;
  if (w===1) return [[W-4,H-3]];
  const out=[[W-7,10],[W-14,12]]; if (h===2) out.push([6,21]);
  return out;
};
/** A cheap fixed 0..1 scatter from two numbers, so the dirt of a yard is speckled the same way every time. */
const speck = (a: number, b: number) => { let h=(Math.imul(a|0,374761393)+Math.imul(b|0,668265263)+1013904223)|0; h=Math.imul(h^(h>>>15),2246822519); h=Math.imul(h^(h>>>13),3266489917); h^=h>>>16; return (h>>>0)/4294967296; };
/** A copper mine's shafts by size: [centre x, width]. */
const shafts = (w: number, h: number) => w===1 ? [[8,4]] : h===1 ? [[16,8]] : [[9,6],[23,6]];
function drawBig(ox: number, oy: number, type: number, n: NationStyle, w=BIG[type][0], h=BIG[type][1]){
  const W=w*16, H=h*16;
  if (type===B_GUILD){ drawGuild(ox,oy,n); return; }
  if (type===B_HOSPITAL){ drawHospital(ox,oy,n); return; }
  if (type===B_PLANTATION){
    // a sawmill yard: trodden earth, a shed with a saw, planks and logs stacked, a stump; the trees growing by it are drawn live
    R(ox,oy,W,H,'#8a6f45'); for (let i=0;i<W*H/7;i++) P(ox+((speck(i,3)*W)|0),oy+((speck(i,4)*H)|0),'#9b8052');
    const sw=Math.min(W-6,16);
    R(ox+2,oy+2,sw,7,'#8a5a32'); R(ox+2,oy+2,sw,1,'#c2915c'); R(ox+2,oy+8,sw,1,'#6c4a2c');   // the shed's wall
    R(ox+1,oy,sw+2,3,n.roof); R(ox+1,oy,sw+2,1,n.roofL); R(ox+1,oy+2,sw+2,1,n.roofD);
    R(ox+2+sw-6,oy+4,5,5,'#2a1a10');                                  // its open front
    R(ox+5,oy+5,5,5,'#bfc6cc'); R(ox+6,oy+4,3,7,'#bfc6cc'); P(ox+7,oy+6,'#555'); P(ox+5,oy+5,'#8a9399'); P(ox+9,oy+9,'#8a9399');   // the saw
    for (let i=0,n6=W>=32 ? 6 : 3;i<n6;i++){ const lx=ox+2+(i%3)*5, ly=oy+H-4-((i/3)|0)*3; R(lx,ly,6,3,'#9a6e42'); R(lx,ly,6,1,'#c2915c'); R(lx+5,ly,1,3,'#d9b27a'); P(lx+5,ly+1,'#8a5f38'); }   // logs
    if (h>=2){ R(ox+W-12,oy+H-8,9,5,'#d9b27a'); R(ox+W-12,oy+H-8,9,1,'#ecd2a0'); R(ox+W-12,oy+H-5,9,1,'#b08850'); R(ox+W-11,oy+H-11,7,3,'#d9b27a'); R(ox+W-11,oy+H-11,7,1,'#ecd2a0'); }   // planks
    R(ox+W-6,oy+H-3,4,2,'#9a6e42'); R(ox+W-6,oy+H-3,4,1,'#d9b27a'); R(ox+W-5,oy+H-1,2,1,'#6c4a2c');   // a stump
    R(ox+W-5,oy+2,1,4,C.woodD); R(ox+W-4,oy+2,3,2,n.roof);                                       // the kingdom's marker post
  } else if (type===B_QUARRY){
    // a stepped pit cut into the ground, the deepest step darkest
    const cols=['#a49d90','#8d867b','#6f695f','#4a4640'], lips=['#c4beb4','#a49d90','#8d867b'];
    for (let i=0,x=0,y=4,ww=W,hh=H-5;i<4 && ww>=4 && hh>=3;i++,x+=4,y+=4,ww-=8,hh-=8){ R(ox+x,oy+y,ww,hh,cols[i]); if (i<3) R(ox+x,oy+y,ww,1,lips[i]); }
    R(ox,oy+H-1,W,1,SH);
    for (const [x,y] of [[2,6],[26,10],[6,26],[22,24],[28,20],[14,9]]) if (x+2<W && y+2<H){ R(ox+x,oy+y,2,1,'#c4beb4'); P(ox+x,oy+y+1,'#7c766c'); }   // loose blocks
    // the pulley frame over the pit
    const p1=Math.round(W*0.19), p2=W-p1-2, ph=Math.round(H*0.56);
    R(ox+p1,oy+2,2,ph,C.woodD); R(ox+p2,oy+2,2,ph,C.woodD); R(ox+p1,oy+2,p2-p1+2,2,C.wood); R(ox+p1,oy+2,p2-p1+2,1,C.woodL);
    R(ox+W/2-1,oy+4,3,3,'#3b2a1e'); P(ox+W/2,oy+5,C.woodL);         // the wheel
    if (W>=32){ const y=H-8; R(ox+26,oy+y,4,4,'#bdb6aa'); R(ox+26,oy+y,4,1,'#d6d1c5'); R(ox+27,oy+y-2,3,2,'#bdb6aa'); }   // a stack of cut stone
    R(ox+1,oy+1,1,5,C.woodD); R(ox+2,oy+1,3,2,n.roof);
  } else if (type===B_COPPERMINE){
    // a rocky mound with timbered shafts; the glow is drawn live
    const top=H-12;
    if (h===2){ R(ox+3,oy+3,W-6,top-2,'#7c766c'); R(ox+5,oy+2,W-10,2,'#a49d90'); R(ox+5,oy+2,W-10,1,'#bdb6aa'); R(ox+9,oy+8,3,2,'#6f695f'); R(ox+20,oy+6,4,2,'#d9823e'); }   // the mountain behind
    R(ox+2,oy+top,W-4,11,'#8d867b'); R(ox+Math.min(6,W/4),oy+top-2,W-2*Math.min(6,W/4),2,'#a49d90'); R(ox+Math.min(6,W/4),oy+top-2,W-2*Math.min(6,W/4),1,'#bdb6aa');
    P(ox+3,oy+top+1,'#bdb6aa'); R(ox+W-6,oy+top+4,3,2,'#6f695f');
    for (const [cx,ew] of shafts(w,h)){
      const x=cx-ew/2, pw=ew>4 ? 2 : 1;
      R(ox+x,oy+H-10,ew,9,'#1c1410');                                // the dark entrance
      R(ox+x-pw,oy+H-10,pw,9,C.woodD); R(ox+x+ew,oy+H-10,pw,9,C.woodD); R(ox+x-pw,oy+H-12,ew+2*pw,2,C.wood); R(ox+x-pw,oy+H-12,ew+2*pw,1,C.woodL);
    }
    R(ox,oy+H-1,W,1,SH);
    R(ox+2,oy+H-4,3,2,'#d9823e'); P(ox+3,oy+H-4,'#f2a35e'); if (W>=32){ R(ox+W-7,oy+H-5,3,2,'#e08a48'); P(ox+W-6,oy+H-5,'#ffc080'); }   // ore by the door
    if (h===2){ R(ox+W-9,oy+1,3,9,C.stD); R(ox+W-9,oy+1,3,1,'#4a4740'); }   // the smelter's chimney
    R(ox+W-4,oy+top-6,1,5,C.woodD); R(ox+W-3,oy+top-6,3,2,n.roof);
  }
}
/** The moving part of a production building, drawn over its base each frame. k = progress through
    the 30-second cycle (0..1), now = milliseconds for the looping bits. */
export function drawWorking(ctx: CanvasRenderingContext2D, type: number, ox: number, oy: number, k: number, now: number, w=BIG[type][0], h=BIG[type][1], q=-1){
  const prev=G; G=ctx;
  const W=w*16, H=h*16;
  if (type===B_HOSPITAL){   // a wounded soldier lies in each bed that has one: a head on the pillow, a blanket over him
    if (q>=0) for (const wd of woundedList()) if (wd.hosp===q && wd.bed>=0){
      const [bx]=HOSPITAL_BEDS[wd.bed];
      R(ox+bx-3,oy+9,3,2,'#e0b894'); R(ox+bx-3,oy+8,3,1,'#6b4a2c');                      // head and hair
      R(ox+bx,oy+10,4,1,styleOf(wd.o).roof); R(ox+bx,oy+9,3,1,styleOf(wd.o).roofL);       // the blanket, in his kingdom's colour
    }
  }
  if (type===B_PLANTATION){
    const f=((now/110)|0)&1; P(ox+5+f*4,oy+5,'#eef2f5'); P(ox+9-f*4,oy+9,'#eef2f5');   // the saw's teeth flicker round
    // each tree by the yard grows from a sprout to a full tree over the cycle
    for (const [sx,sy] of slots(w,h)){
      const x=ox+sx, y=oy+sy;
      if (k<0.2){ P(x,y,'#7fb34c'); P(x,y-1,'#b2d86c'); }
      else if (k<0.45){ R(x,y-2,1,3,'#6e4b2c'); R(x-1,y-3,3,1,'#7fb34c'); P(x+1,y-2,'#4f8a37'); P(x,y-4,'#b2d86c'); }
      else if (k<0.75){ R(x,y-3,1,4,'#6b4a2c'); R(x-2,y-6,5,3,'#4f8a37'); R(x-1,y-7,3,1,'#7fb34c'); P(x-2,y-6,'#7fb34c'); P(x+2,y-4,'#2e5b2a'); }
      else { R(x,y-3,1,4,'#6b4a2c'); R(x-3,y-8,7,5,'#4f8a37'); R(x-2,y-9,5,1,'#7fb34c'); R(x-3,y-8,2,2,'#7fb34c'); P(x-1,y-9,'#b2d86c'); R(x+2,y-6,2,3,'#2e5b2a'); R(x-2,y-4,5,1,'#2e5b2a'); }
    }
  } else if (type===B_QUARRY){
    // a block rides the rope up from the pit floor and back, ten times a cycle
    const f=(k*10)%1, up=f<0.5 ? f*2 : 2-f*2, low=Math.round(H*0.62), by=oy+low-Math.round(up*(low-7)), x=ox+W/2;
    R(x,oy+6,1,Math.max(0,by-oy-6),'#c9b48a');   // the rope
    R(x-2,by,5,3,'#bdb6aa'); R(x-2,by,5,1,'#d6d1c5'); R(x+2,by,1,3,'#8d867b');
  } else if (type===B_GUILD){
    // a block of stone swings gently on the crane's rope
    const sway=Math.round(Math.sin(now/700)), x=ox+27+sway;
    R(x,oy+2,1,4,'#c9b48a'); R(x-1,oy+6,3,2,'#bdb6aa'); R(x-1,oy+6,3,1,'#d6d1c5');
  } else if (type===B_COPPERMINE){
    const glow=0.55+0.45*Math.sin(now/180)*Math.sin(now/67+1);
    for (const [cx,ew] of shafts(w,h)){
      const x=ox+cx-ew/2;
      ctx.globalAlpha=0.55+0.4*glow; R(x+Math.max(1,ew/4),oy+H-7,Math.max(2,ew/2),6,'#ff8a2b'); ctx.globalAlpha=0.35+0.3*glow; R(x,oy+H-5,ew,4,'#ffb24a');
    }
    if (h===2){ ctx.globalAlpha=0.5+0.4*glow; P(ox+W-8,oy,'#ffb24a'); }   // sparks over the smelter
    ctx.globalAlpha=1;
  }
  G=prev;
}
