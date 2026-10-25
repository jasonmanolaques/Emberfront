/* ---------- pixel sprites for buildings (drawn into the object layer) ----------
   A plot is PS×PS (16×16) pixels. Each building is drawn into a scratch canvas, outlined
   where it meets open ground, and stamped onto the map.
   Farms, barracks, watchtowers and coin minters are modular: each plot looks at its four
   neighbours, and plots of the same kind and owner join up, so fields merge into one farmland,
   barracks into one long hall, minters into one workshop, and towers link with walls. */
import { RW, RH, PW, PH, NP, PS, B_HOUSE, B_FARM, B_TOWER, B_MINE, B_CASTLE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_SITE, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_RESEARCH, B_GUILD } from '../core/constants';
import { pType, pOwner, pVar, pMain, pAband, pTier } from '../sim/state';
import { styleOf, type NationStyle } from './style';
import { rows, outline, type Pal } from './pixel';

export const objC = document.createElement('canvas'); objC.width = RW; objC.height = RH;
export const octx = objC.getContext('2d') as CanvasRenderingContext2D;
const tmp = document.createElement('canvas'); tmp.width = 2*PS; tmp.height = 2*PS;
const tctx = tmp.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
let G = tctx;   // where P and R draw: the scratch canvas, or an icon

function P(x: number, y: number, c: string){ G.fillStyle=c; G.fillRect(x,y,1,1); }
function R(x: number, y: number, w: number, h: number, c: string){ G.fillStyle=c; G.fillRect(x,y,w,h); }
const EDGE = 'rgba(30,20,14,0.9)';

/** Draws a w×h building at plot pixel (ox,oy) on the map: on scratch first, outlined, then stamped. */
function stamp(ox: number, oy: number, w: number, h: number, draw: () => void){
  G=tctx; tctx.clearRect(0,0,w,h); draw(); outline(tctx,0,0,w,h,EDGE);
  octx.clearRect(ox,oy,w,h); octx.drawImage(tmp,0,0,w,h,ox,oy,w,h);
}

export const MODULAR = [B_FARM, B_BARRACKS, B_TOWER, B_MINTER];
const N_=1, E_=2, S_=4, W_=8;
/** Which neighbours of plot q are the same kind of building with the same owner (N/E/S/W bits). */
function joins(q: number){
  const ty=pType[q], o=pOwner[q], x=q%PW, y=(q/PW)|0;
  const same=(k: number)=>pType[k]===ty && pOwner[k]===o;
  return (y>0&&same(q-PW)?N_:0) | (x<PW-1&&same(q+1)?E_:0) | (y<PH-1&&same(q+PW)?S_:0) | (x>0&&same(q-1)?W_:0);
}
const SH = 'rgba(14,24,8,.3)';
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
  const pal: Pal = empty
    ? { y:'#9c9272', t:'#8c8160', T:'#726a50', s:'#5e5844', v:'#7d7262', w:'#6e6252', W:'#5a5044', d:'#7a6c58', g:'#4a4038', p:'#5a4a3a', k:'#4a4038', r:'#857a6a', R:'#6e6455', l:'#968a78', x:SH }
    : { y:C.thL, t:C.th, T:C.thD, s:C.thS, v:C.mudL, w:C.mud, W:C.mudD, d:C.door, g:C.glow, p:C.post, k:C.beam, r:n.roof, R:n.roofD, l:n.roofL, x:SH };
  rows(G,ox,oy,HOUSES[v],pal);
  if (empty){
    for (const [x,y] of HOLES[v]) P(ox+x,oy+y,'#2a2420');
    const dx=v===1?7:v===2?7:6; R(ox+dx,oy+11,2,1,'#4a4038'); R(ox+dx,oy+13,2,1,'#4a4038');   // boards across the door
    P(ox+3,oy+13,'#5f8a3a'); P(ox+2,oy+12,'#6f9a44'); P(ox+12,oy+13,'#5f8a3a'); P(ox+13,oy+12,'#6f9a44');   // weeds
  }
}
/** A stone house or a manor; odd variants face the other way. */
function drawStoneHouse(ox: number, oy: number, n: NationStyle, v: number, empty: boolean, tier: number){
  const pal: Pal = empty
    ? { l:'#968a78', r:'#857a6a', R:'#6e6455', k:'#4a4038', a:'#a29c90', b:'#8e887c', c:'#6e695f', g:'#3a332c', f:'#2e2824', d:'#4a4038', h:'#6e695f', e:'#a69c88', x:SH }
    : { l:n.roofL, r:n.roof, R:n.roofD, k:'#4a3424', a:C.stL, b:C.st, c:'#8f897d', g:'#ffd86b', f:'#d99a3e', d:'#5a3c22', h:C.stD, e:'#eadfc4', x:SH };
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

/* ---------- watchtowers ---------- */
function drawTower(ox: number, oy: number, n: NationStyle, m: number){
  const st=C.st, sd=C.stD, sl=C.stL;
  // walls toward neighbouring towers, with battlements
  if (m&E_){ R(ox+10,oy+8,6,6,st); R(ox+10,oy+12,6,2,sd); for (let x=11;x<16;x+=2) R(ox+x,oy+6,1,2,st); R(ox+10,oy+8,6,1,sl); }
  if (m&W_){ R(ox,oy+8,6,6,st); R(ox,oy+12,6,2,sd); for (let x=0;x<5;x+=2) R(ox+x,oy+6,1,2,st); R(ox,oy+8,6,1,sl); }
  if (m&N_){ R(ox+6,oy,4,6,st); R(ox+9,oy,1,6,sd); }
  if (m&S_){ R(ox+6,oy+14,4,2,st); R(ox+9,oy+14,1,2,sd); }
  R(ox+5,oy+14,7,1,SH);
  R(ox+5,oy+5,6,10,st); R(ox+5,oy+5,1,10,sl); R(ox+10,oy+5,1,10,sd);   // the tower, lit from the left
  for (let y=7;y<15;y+=3) R(ox+6,oy+y,4,1,'#a7a194');                    // courses of stone
  R(ox+4,oy+4,8,1,sd); R(ox+4,oy+3,8,1,st);                              // the platform
  for (const x of [4,6,9,11]) R(ox+x,oy+1,1,2,st);                       // battlements
  R(ox+7,oy+7,2,2,'#2a211b');                                            // arrow slit
  R(ox+7,oy+11,2,4,C.door);
  R(ox+8,oy-0,1,3,'#4a3a2a'); R(ox+9,oy,3,2,n.roof); P(ox+11,oy+1,n.roofD);   // flag
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

/* ---------- builders guild (2×1 plots): a workshop and its yard of timber and stone ---------- */
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

/* ---------- the castle (2×2 plots) ---------- */
function drawCastle(ox: number, oy: number, n: NationStyle){
  const st=C.st, sd=C.stD, sl=C.stL, dk='#2e241c';
  R(ox+2,oy+30,28,1,SH);
  // curtain wall with battlements
  R(ox+4,oy+18,24,12,st); R(ox+4,oy+28,24,2,sd); R(ox+4,oy+18,24,1,sl);
  for (let x=5;x<27;x+=2) R(ox+x,oy+16,1,2,st);
  for (let y=21;y<28;y+=3) R(ox+6,oy+y,20,1,'#a7a194');
  // corner towers with pointed roofs
  for (const tx of [0,25]){
    R(ox+tx,oy+11,7,19,st); R(ox+tx,oy+11,1,19,sl); R(ox+tx+6,oy+11,1,19,sd);
    R(ox+tx,oy+10,7,1,sd);
    R(ox+tx+1,oy+8,5,2,n.roofD); R(ox+tx+2,oy+6,3,2,n.roof); P(ox+tx+3,oy+5,n.roofL); P(ox+tx+3,oy+4,'#4a3a2a');
    R(ox+tx+3,oy+14,1,2,dk); R(ox+tx+3,oy+22,1,2,dk);
  }
  // the keep
  R(ox+10,oy+6,12,16,sl); R(ox+10,oy+6,1,16,'#ece7dc'); R(ox+21,oy+6,1,16,sd);
  for (let y=10;y<22;y+=4) R(ox+11,oy+y,10,1,'#c8c2b6');
  R(ox+9,oy+5,14,1,sd);
  R(ox+10,oy+3,12,2,n.roofD); R(ox+11,oy+2,10,1,n.roof); R(ox+12,oy+1,8,1,n.roof); R(ox+13,oy,6,1,n.roofL);
  for (const [x,y] of [[13,8],[18,8],[13,13],[18,13]]){ R(ox+x,oy+y,2,3,'#ffd86b'); P(ox+x,oy+y,'#fff1b0'); }
  // gate
  R(ox+13,oy+22,6,8,dk); R(ox+14,oy+21,4,1,dk);
  for (let x=14;x<18;x+=2) R(ox+x,oy+22,1,7,'#5a4a3a');
  R(ox+13,oy+25,6,1,'#5a4a3a');
  // hanging banners
  for (const bx of [7,23]){ R(ox+bx,oy+19,2,5,n.roof); P(ox+bx,oy+24,n.roofD); P(ox+bx+1,oy+24,n.roofD); P(ox+bx,oy+19,n.roofL); }
}

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
  const ox=(q%PW)*PS, oy=((q/PW)|0)*PS, ty=pType[q];
  if (ty===B_CPART){ const m=pMain[q]; if (pType[m]===B_CASTLE){ drawPlot(m); return; } }
  if (ty===B_PART){ const m=pMain[q]; if (BIG[pType[m]]){ drawPlot(m); return; } octx.clearRect(ox,oy,PS,PS); return; }
  const n=styleOf(pOwner[q]);
  if (BIG[ty]){ const [w,h]=BIG[ty]; stamp(ox,oy,w*PS,h*PS,()=>drawBig(0,0,ty,n)); return; }
  if (ty===B_CASTLE){ stamp(ox,oy,2*PS,2*PS,()=>drawCastle(0,0,n)); return; }
  const v=pVar[q]%3;
  if (ty===B_HOUSE){ const t=pTier[q]; stamp(ox,oy,PS,PS,()=>drawHouse(0,0,n,t>=2 ? pVar[q] : v,!!pAband[q],t)); }
  else if (ty===B_RESEARCH) stamp(ox,oy,PS,PS,()=>drawResearch(0,0,n));
  else if (ty===B_SITE) stamp(ox,oy,PS,PS,()=>drawSite(0,0,n));
  else if (ty===B_FARM){ const m=joins(q); stamp(ox,oy,PS,PS,()=>drawFarm(0,0,n,pOwner[q]%3,m)); }   // one crop per kingdom, so joined fields match
  else if (ty===B_TOWER){ const m=joins(q); stamp(ox,oy,PS,PS,()=>drawTower(0,0,n,m)); }
  else if (ty===B_BARRACKS){ const m=joins(q); stamp(ox,oy,PS,PS,()=>drawBarracks(0,0,n,m)); }
  else if (ty===B_MINTER){ const m=joins(q); stamp(ox,oy,PS,PS,()=>drawMinter(0,0,n,m)); }
  else if (ty===B_MINE) stamp(ox,oy,PS,PS,()=>drawMine(0,0,n));
  else if (ty===B_RUINS) stamp(ox,oy,PS,PS,()=>drawRuins(0,0,pVar[q]));
  else if (ty===B_CPART){ /* part of a burned castle still standing: leave */ }
  else octx.clearRect(ox,oy,PS,PS);
}

/** Redraws plot q and any modular neighbours whose joins it may have changed. */
export function drawPlotAndNeighbours(q: number){
  drawPlot(q);
  const x=q%PW;
  for (const k of [q-PW, x<PW-1?q+1:-1, q+PW, x>0?q-1:-1]) if (k>=0 && k<NP && MODULAR.includes(pType[k])) drawPlot(k);
}

/** Draws a building's sprite into an icon (one plot is 16×16, unjoined) in the given kingdom colours. */
export function drawIcon(ctx: CanvasRenderingContext2D, type: number, n: NationStyle){
  const prev=G; G=ctx; ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  if (type===B_FARM) drawFarm(0,0,n,1,0); else if (type===B_BARRACKS) drawBarracks(0,0,n,0);
  else if (type===B_TOWER) drawTower(0,0,n,0); else if (type===B_MINTER) drawMinter(0,0,n,0);
  else if (type===B_HOUSE) drawHouse(0,0,n,0,false);
  else if (type===B_RESEARCH) drawResearch(0,0,n);
  else if (BIG[type]){ drawBig(0,0,type,n); drawWorking(ctx,type,0,0,0.99,0); }
  outline(ctx,0,0,ctx.canvas.width,ctx.canvas.height,EDGE);
  G=prev;
}

/* ---------- production buildings: 2x2 or 2x1 plots, a static base here plus live work drawn each frame ---------- */
export const BIG: Record<number, [number, number]> = { [B_PLANTATION]: [2,2], [B_QUARRY]: [2,2], [B_COPPERMINE]: [2,1], [B_GUILD]: [2,1] };
// where the four saplings stand in a plantation
const SLOTS = [[8,11],[24,11],[8,27],[24,27]];
function drawBig(ox: number, oy: number, type: number, n: NationStyle){
  if (type===B_GUILD){ drawGuild(ox,oy,n); return; }
  if (type===B_PLANTATION){
    R(ox,oy,32,32,'#7a5c36');                                      // turned earth
    for (let y=3;y<32;y+=4) R(ox+1,oy+y,30,1,'#8e6c40');
    for (const [x,y] of SLOTS){ R(ox+x-3,oy+y+1,7,2,'#5e4428'); R(ox+x-2,oy+y+1,5,1,'#4e3820'); }   // a dug bed under each sapling
    const rail=C.woodL;
    R(ox,oy,32,1,rail); R(ox,oy+31,32,1,rail); R(ox,oy,1,32,rail); R(ox+31,oy,1,32,rail);
    for (const p of [0,10,21,31]){ P(ox+p,oy,C.woodD); P(ox+p,oy+31,C.woodD); P(ox,oy+p,C.woodD); P(ox+31,oy+p,C.woodD); }
    R(ox+2,oy+2,1,4,C.woodD); R(ox+3,oy+2,3,2,n.roof);                // the kingdom's marker post
  } else if (type===B_QUARRY){
    // a stepped pit cut into the ground, the deepest step darkest
    R(ox,oy+4,32,27,'#a49d90'); R(ox+4,oy+8,24,20,'#8d867b'); R(ox+8,oy+12,16,12,'#6f695f'); R(ox+12,oy+16,8,6,'#4a4640');
    R(ox,oy+4,32,1,'#c4beb4'); R(ox+4,oy+8,24,1,'#a49d90'); R(ox+8,oy+12,16,1,'#8d867b');   // lit lips of the steps
    R(ox,oy+31,32,1,SH);
    for (const [x,y] of [[2,6],[26,10],[6,26],[22,24],[28,20],[14,9]]){ R(ox+x,oy+y,2,1,'#c4beb4'); P(ox+x,oy+y+1,'#7c766c'); }   // loose blocks
    // the pulley frame over the pit
    R(ox+6,oy+2,2,18,C.woodD); R(ox+24,oy+2,2,18,C.woodD); R(ox+6,oy+2,20,2,C.wood); R(ox+6,oy+2,20,1,C.woodL);
    R(ox+15,oy+4,3,3,'#3b2a1e'); P(ox+16,oy+5,C.woodL);              // the wheel
    R(ox+26,oy+24,4,4,'#bdb6aa'); R(ox+26,oy+24,4,1,'#d6d1c5'); R(ox+27,oy+22,3,2,'#bdb6aa');   // a stack of cut stone
    R(ox+3,oy+1,1,5,C.woodD); R(ox+4,oy+1,3,2,n.roof);
  } else if (type===B_COPPERMINE){
    // a rocky mound with a timbered shaft; the glow is drawn live
    R(ox+2,oy+4,28,11,'#8d867b'); R(ox+6,oy+2,20,2,'#a49d90'); R(ox+4,oy+4,6,4,'#a49d90'); R(ox+22,oy+4,6,4,'#a49d90');
    R(ox+6,oy+2,20,1,'#bdb6aa'); P(ox+3,oy+5,'#bdb6aa'); R(ox+26,oy+8,3,2,'#6f695f'); R(ox+6,oy+12,3,1,'#6f695f');
    R(ox+12,oy+6,8,9,'#1c1410');                                   // the dark entrance
    R(ox+10,oy+6,2,9,C.woodD); R(ox+20,oy+6,2,9,C.woodD); R(ox+10,oy+4,12,2,C.wood); R(ox+10,oy+4,12,1,C.woodL);   // timber frame
    R(ox,oy+15,32,1,SH);
    R(ox+4,oy+12,3,2,'#d9823e'); P(ox+5,oy+12,'#f2a35e'); R(ox+25,oy+11,3,2,'#e08a48'); P(ox+26,oy+11,'#ffc080');   // ore by the door
    R(ox+28,oy,1,5,C.woodD); R(ox+29,oy,3,2,n.roof);
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
      if (k<0.2){ P(x,y,'#7fb34c'); P(x,y-1,'#b2d86c'); }
      else if (k<0.45){ R(x,y-2,1,3,'#6e4b2c'); R(x-1,y-3,3,1,'#7fb34c'); P(x+1,y-2,'#4f8a37'); P(x,y-4,'#b2d86c'); }
      else if (k<0.75){ R(x,y-3,1,4,'#6b4a2c'); R(x-2,y-6,5,3,'#4f8a37'); R(x-1,y-7,3,1,'#7fb34c'); P(x-2,y-6,'#7fb34c'); P(x+2,y-4,'#2e5b2a'); }
      else { R(x,y-3,1,4,'#6b4a2c'); R(x-3,y-8,7,5,'#4f8a37'); R(x-2,y-9,5,1,'#7fb34c'); R(x-3,y-8,2,2,'#7fb34c'); P(x-1,y-9,'#b2d86c'); R(x+2,y-6,2,3,'#2e5b2a'); R(x-2,y-4,5,1,'#2e5b2a'); }
    }
  } else if (type===B_QUARRY){
    // a block rides the rope up from the pit floor and back, ten times a cycle
    const f=(k*10)%1, up=f<0.5 ? f*2 : 2-f*2, by=oy+20-Math.round(up*13);
    R(ox+16,oy+6,1,Math.max(0,by-oy-6),'#c9b48a');   // the rope
    R(ox+14,by,5,3,'#bdb6aa'); R(ox+14,by,5,1,'#d6d1c5'); R(ox+18,by,1,3,'#8d867b');
  } else if (type===B_GUILD){
    // a block of stone swings gently on the crane's rope
    const sway=Math.round(Math.sin(now/700)), x=ox+27+sway;
    R(x,oy+2,1,4,'#c9b48a'); R(x-1,oy+6,3,2,'#bdb6aa'); R(x-1,oy+6,3,1,'#d6d1c5');
  } else if (type===B_COPPERMINE){
    const glow=0.55+0.45*Math.sin(now/180)*Math.sin(now/67+1);
    ctx.globalAlpha=0.55+0.4*glow; R(ox+14,oy+9,4,6,'#ff8a2b'); ctx.globalAlpha=0.35+0.3*glow; R(ox+12,oy+11,8,4,'#ffb24a'); ctx.globalAlpha=1;
  }
  G=prev;
}
