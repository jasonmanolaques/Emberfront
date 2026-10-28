/* ---------- terrain & territory: the ground of the map's tiles, and the overview ----------
   Each map tile is RS×RS (4×4) pixels. The look: a warm, slightly muted palette lit from the
   top-left, sea with wave dashes and a foam line, and kingdoms outlined by a double border:
   their colour on the edge and a softer line just inside. The ground is painted into the tiles of
   the picture that exist (render/tiles.ts), a map tile at a time as it changes; the overview, one
   pixel a map tile, shows the whole map when it is zoomed too far out for the detail: the ground's
   colours, the kingdoms and their borders, occupied land, roads and towns. */
import { TW, TH, NT, RS, PW, T_DEEP, T_WATER, T_SHALLOW, T_GRASS, T_DRY, T_FOREST, T_DESERT, T_HILLS, T_MOUNT, T_BEACH, T_SNOW, B_EMPTY, B_HOUSE, B_FARM, B_TOWER, B_CASTLE, B_CPART, B_RUINS, B_PART, B_SITE } from '../core/constants';
import { clamp, hexRGB, mixc, pack, type RGB } from '../core/util';
import { W, owner, occ, terr, isLand, elev, road, pType, pMain, pOwner } from '../sim/state';
import { styleOf } from './style';
import { CH, painters, resetTiles, tileOfPx, type Tile } from './tiles';

export const SEA = '#173a57';   // the deep sea, also the colour behind the map
const PAL = {
  deep:hexRGB(SEA), water:hexRGB('#1f5175'), shallow:hexRGB('#2c7896'), foam:hexRGB('#d6ece4'), surf:hexRGB('#5fa9b8'),
  beach:hexRGB('#e0c98c'), grass:hexRGB('#679c3f'), dry:hexRGB('#b0ad57'), forest:hexRGB('#3a6e33'), desert:hexRGB('#d6a95f'),
  hills:hexRGB('#849550'), mount:hexRGB('#8a8176'), snow:hexRGB('#e6edf0'), road:hexRGB('#b38a56'), roadD:hexRGB('#8d6a3f'), wetsand:hexRGB('#b19a68')
};
const TCOL = [PAL.deep,PAL.water,PAL.shallow,PAL.beach,PAL.grass,PAL.dry,PAL.forest,PAL.desert,PAL.hills,PAL.mount,PAL.snow];
const FLOWERS: RGB[] = [[250,246,232],[255,214,92],[232,128,170],[170,150,240]];

// the overview: one pixel a map tile
export const ovC = document.createElement('canvas'); ovC.width = TW; ovC.height = TH;
const ovctx = ovC.getContext('2d') as CanvasRenderingContext2D;
let ovImg = ovctx.createImageData(TW, TH);
export let ovBuf = new Uint32Array(ovImg.data.buffer);
let ovBase = new Uint32Array(NT);      // its ground, before the territory
let ox0=TW, oy0=TH, ox1=-1, oy1=-1;    // the part of it still to upload
const dirtyTiles = new Set<Tile>();    // tiles of the picture whose ground is still to upload
/** A new map: lets the picture's tiles go, and fits the overview to the map's size. */
export function sizeTerrain(){
  resetTiles(); dirtyTiles.clear();
  if (ovC.width===TW && ovC.height===TH) return;
  ovC.width=TW; ovC.height=TH;
  ovImg=ovctx.createImageData(TW,TH); ovBuf=new Uint32Array(ovImg.data.buffer); ovBase=new Uint32Array(NT);
}

/** Stable per-pixel hash for the current map (texture variation, tree placement). */
export function hash2(x: number, y: number){ let h=Math.imul(x,374761393)^Math.imul(y,668265263)^W.mapSeed; h=Math.imul(h^(h>>>13),1274126177); h^=h>>>16; return (h>>>0)/4294967296; }

const R1=RS-1;
/** Distance in pixels from (sx,sy) inside a tile to the nearest side or corner whose neighbour differs. */
function edgeDist(sx: number, sy: number, l: boolean, r: boolean, u: boolean, d: boolean, ul: boolean, ur: boolean, dl: boolean, dr: boolean){
  let e=9;
  if (l) e=Math.min(e,sx); if (r) e=Math.min(e,R1-sx); if (u) e=Math.min(e,sy); if (d) e=Math.min(e,R1-sy);
  if (ul) e=Math.min(e,Math.max(sx,sy)); if (ur) e=Math.min(e,Math.max(R1-sx,sy));
  if (dl) e=Math.min(e,Math.max(sx,R1-sy)); if (dr) e=Math.min(e,Math.max(R1-sx,R1-sy));
  return e;
}
const landAt = (x: number, y: number) => x<0||y<0||x>=TW||y>=TH ? 0 : isLand[y*TW+x];

const px: RGB[] = Array.from({ length: RS*RS }, () => [0,0,0]);
/** Paints the ground of tile (x,y), without roads, into px. */
function terrainOf(x: number, y: number){
    const k = 1/W.heightRange;
    const t=y*TW+x, tr=terr[t], land=isLand[t], c=TCOL[tr], h=hash2(x*5+3,y*7+11);
    let s=0;
    if (land){
      const a=elev[x>0&&y>0?t-TW-1:t], b=elev[x<TW-1&&y<TH-1?t+TW+1:t];
      const K = tr>=T_HILLS ? 7 : 3.5;
      s = Math.round(clamp((a-b)*k*K,-0.3,0.3)*24)/24;
      if (tr<T_HILLS) s += (elev[t]-W.seaLevel)*k*0.08;
    }
    // neighbours of the other kind (land beside water, water beside land), for coasts
    const o=(dx: number, dy: number) => landAt(x+dx,y+dy)!==land;
    const L=o(-1,0), Rt=o(1,0), U=o(0,-1), D=o(0,1), UL=o(-1,-1), UR=o(1,-1), DL=o(-1,1), DR=o(1,1);
    const patch=(hash2(x>>1,y>>1)-0.5)*0.05;   // slow variation across a few tiles
    for (let sy=0;sy<RS;sy++) for (let sx=0;sx<RS;sx++){
      const X=x*RS+sx, Y=y*RS+sy, j=hash2(X,Y), e=edgeDist(sx,sy,L,Rt,U,D,UL,UR,DL,DR);
      let col=c, f=1+s+patch+(j-0.5)*0.06;
      if (!land){
        if (e===0) { col=PAL.foam; f=1+(j-0.5)*0.05; }
        else if (e===1) col=mixc(c,PAL.surf,0.55);
        else if (e===2 && tr!==T_DEEP) col=mixc(c,PAL.surf,0.2);
        else if ((tr===T_DEEP || tr===T_WATER) && hash2((X>>1)*3+((Y*5)&15),Y)<0.016) col=mixc(c,PAL.surf,tr===T_DEEP?0.4:0.5);   // wave dashes
      } else {
        if (e===0 && (tr===T_BEACH||tr===T_DESERT||tr===T_GRASS||tr===T_DRY)) col=mixc(c,PAL.wetsand,0.6);
        else if (e===0) col=mixc(c,[60,56,50],0.25);
        else if (tr===T_GRASS || tr===T_FOREST){ if (j<0.05) col=mixc(c,[150,200,96],0.45); else if (j>0.93) col=mixc(c,[30,52,24],0.35); }
        else if (tr===T_DRY && j<0.06) col=mixc(c,[214,196,110],0.5);
        else if (tr===T_DESERT){ if (((X+((Y*3)>>1)+((h*8)|0))%9)===0) col=mixc(c,[184,138,72],0.35); else if (j<0.05) col=mixc(c,[244,214,150],0.6); }
        else if (tr===T_HILLS && j>0.94) col=mixc(c,[80,90,50],0.45);
        else if (tr===T_MOUNT){ f+= (sx===0||sy===0 ? 0.05 : sx===R1||sy===R1 ? -0.05 : 0) + (j-0.5)*0.08; }
        else if (tr===T_SNOW){ if (j<0.06) col=[255,255,255]; else if (j>0.95) col=[196,212,222]; }
      }
      const p=px[sy*RS+sx]; p[0]=col[0]*f; p[1]=col[1]*f; p[2]=col[2]*f;
    }
    if (land && tr<T_HILLS && tr!==T_BEACH){
      // a tuft of grass or a flower here and there, two pixels tall
      if ((tr===T_GRASS || tr===T_DRY || tr===T_FOREST) && h<0.22){
        const tx=1+((h*97|0)&1)+((h*31|0)%2), ty=2;
        const dk=mixc(c,[24,46,20],0.4), lt=mixc(c,[176,214,110],0.35);
        px[ty*RS+tx]=dk; px[(ty-1)*RS+tx]=lt;
      } else if (tr===T_GRASS && h>0.985){ px[RS+1+((h*1e5|0)&1)]=FLOWERS[(h*1e6|0)%FLOWERS.length]; }
    }
}
/** The overview's colour for the ground of tile t: its terrain lit by its slope, the sea paler by
    the coast, a road its road. */
function overviewGround(t: number){
  const x=t%TW, y=(t/TW)|0, tr=terr[t];
  if (road[t]===1) return pack(PAL.road[0],PAL.road[1],PAL.road[2]);
  let c=TCOL[tr], f=1;
  if (isLand[t]){
    const a=elev[x>0&&y>0?t-TW-1:t], b=elev[x<TW-1&&y<TH-1?t+TW+1:t];
    f+=clamp((a-b)/W.heightRange*(tr>=T_HILLS ? 7 : 0.8),-0.3,0.3);   // (lowland barely: at a pixel a tile its gentle slope only streaks)
  } else if (landAt(x-1,y) || landAt(x+1,y) || landAt(x,y-1) || landAt(x,y+1)) c=mixc(c,PAL.surf,0.5);
  else if (tr===T_SHALLOW) c=mixc(c,PAL.surf,0.15);
  return pack(c[0]*f,c[1]*f,c[2]*f);
}
/** Works out the overview's ground for the whole map (a new map). */
export function buildBase(){ for (let t=0;t<NT;t++) ovBase[t]=overviewGround(t); }
/** The ground of picture tile c, terrain and roads, before the territory: painted map tile by map tile. */
function groundOf(c: Tile){
  const tx0=c.x0/RS, ty0=c.y0/RS, tx1=Math.min(TW,tx0+CH/RS), ty1=Math.min(TH,ty0+CH/RS);
  for (let y=ty0;y<ty1;y++) for (let x=tx0;x<tx1;x++){
    const t=y*TW+x;
    if (road[t]===1){ roadBase(c,t); continue; }
    terrainOf(x,y);
    const i0=(y*RS-c.y0)*CH+x*RS-c.x0;
    for (let sy=0;sy<RS;sy++) for (let sx=0;sx<RS;sx++){ const p=px[sy*RS+sx]; c.base[i0+sy*CH+sx]=pack(p[0],p[1],p[2]); }
  }
  for (let y=ty0;y<ty1;y++) for (let x=tx0;x<tx1;x++) paintIn(c,y*TW+x);
}
painters.ground=groundOf;

/** A road tile, in picture tile c: a two-pixel track of packed earth from the tile's middle toward
    each road tile around it (diagonals too, so slanting roads stay joined), with a worn verge either side. */
function roadBase(pic: Tile, t: number){
  const base=pic.base, x=t%TW, y=(t/TW)|0, c=PAL.road;
  const r=(dx: number, dy: number) => { const xx=x+dx, yy=y+dy; return xx>=0 && yy>=0 && xx<TW && yy<TH && road[yy*TW+xx]===1; };
  const N=r(0,-1), S=r(0,1), Wd=r(-1,0), E=r(1,0), NE=r(1,-1), NW=r(-1,-1), SE=r(1,1), SW=r(-1,1);
  const on=(sx: number, sy: number) => {
    if (sx<0||sy<0||sx>R1||sy>R1) return false;
    const mx=sx>=1&&sx<=2, my=sy>=1&&sy<=2;
    return (mx&&my) || (E&&my&&sx>=1) || (Wd&&my&&sx<=2) || (N&&mx&&sy<=2) || (S&&mx&&sy>=1)
      || (NE&&sx>=2&&sy<=1) || (NW&&sx<=1&&sy<=1) || (SE&&sx>=2&&sy>=2) || (SW&&sx<=1&&sy>=2);
  };
  terrainOf(x,y);   // the ground under the road
  const soil=(sx: number, sy: number) => { const p=px[sy*RS+sx]; return pack(p[0],p[1],p[2]); };
  for (let sy=0;sy<RS;sy++) for (let sx=0;sx<RS;sx++){
    const X=x*RS+sx, Y=y*RS+sy, i=(Y-pic.y0)*CH+X-pic.x0, j=hash2(X+911,Y+37);
    if (on(sx,sy)){ const col=j<0.08 ? [206,182,142] : c, f=0.93+j*0.12; base[i]=pack(col[0]*f,col[1]*f,col[2]*f); }
    else if (on(sx-1,sy)||on(sx+1,sy)||on(sx,sy-1)||on(sx,sy+1)){ const g=soil(sx,sy), d=PAL.roadD; base[i]=pack((g&255)*0.6+d[0]*0.4, ((g>>>8)&255)*0.6+d[1]*0.4, ((g>>>16)&255)*0.6+d[2]*0.4); }
    else base[i]=soil(sx,sy);
  }
}
/** Lays road on tile t, and redraws the road tiles around it so the tracks join. */
export function paintRoad(t: number){
  const x=t%TW, y=(t/TW)|0;
  for (let yy=Math.max(0,y-1);yy<=Math.min(TH-1,y+1);yy++) for (let xx=Math.max(0,x-1);xx<=Math.min(TW-1,x+1);xx++){
    const k=yy*TW+xx; if (!road[k]) continue;
    ovBase[k]=overviewGround(k);
    const c=tileOfPx(xx*RS,yy*RS); if (c) roadBase(c,k);
    paintTile(k);
  }
}

function tint(c: number, ia: number, fr: number, fg: number, fb: number){ const r=c&255, g=(c>>>8)&255, b=(c>>>16)&255; return pack(r*ia+fr, g*ia+fg, b*ia+fb); }
function mixP(a: number, b: number, t: number){
  const u=1-t; return pack((a&255)*u+(b&255)*t, ((a>>>8)&255)*u+((b>>>8)&255)*t, ((a>>>16)&255)*u+((b>>>16)&255)*t);
}
/** Paints tile t's ground, in the overview and in its picture tile if that has been made. */
export function paintTile(t: number){
  ovPaint(t);
  const c=tileOfPx((t%TW)*RS,((t/TW)|0)*RS); if (c) paintIn(c,t);
}
/** The overview's colour for a building on plot q: a house its kingdom's roof, a field its crop,
    stone its stone. */
function bldColour(q: number){
  const m=pType[q]===B_PART || pType[q]===B_CPART ? pMain[q] : q, ty=pType[m];
  if (ty===B_FARM) return pack(201,180,82);
  if (ty===B_TOWER || ty===B_CASTLE) return pack(207,200,187);
  if (ty===B_RUINS) return pack(74,64,56);
  if (ty===B_SITE) return pack(154,122,80);
  const n=styleOf(pOwner[m]), r=hexRGB(ty===B_HOUSE ? n.roof : n.roofD);
  return pack(r[0],r[1],r[2]);
}
/** Paints tile t's pixel of the overview: the ground, tinted by its kingdom, its border, the
    occupier's colour over occupied land, and the middle of each plot a building stands on. */
function ovPaint(t: number){
  const x=t%TW, y=(t/TW)|0, o=owner[t];
  let c=ovBase[t];
  const q=(y>>2)*PW+(x>>2), inner=(x&3)>=1 && (x&3)<=2 && (y&3)>=1 && (y&3)<=2;
  if (inner && pType[q]!==B_EMPTY) c=bldColour(q);
  else if (o){
    const n=styleOf(o), f=(dx: number, dy: number) => { const xx=x+dx, yy=y+dy; return xx<0||yy<0||xx>=TW||yy>=TH || owner[yy*TW+xx]!==o; };
    if (f(-1,0) || f(1,0) || f(0,-1) || f(0,1)) c=n.bp;
    else { c=tint(c,n.ia,n.fr,n.fg,n.fb); if (occ[t]) c=mixP(c,styleOf(occ[t]).bp,0.45); }
  }
  ovBuf[t]=c;
  if (x<ox0) ox0=x; if (x>ox1) ox1=x; if (y<oy0) oy0=y; if (y>oy1) oy1=y;
}
/** Repaints the overview pixels of building plot q (a building went up or came down). */
export function ovPlot(q: number){
  const x0=(q%PW)*4, y0=((q/PW)|0)*4;
  for (let y=y0;y<y0+4 && y<TH;y++) for (let x=x0;x<x0+4 && x<TW;x++) ovPaint(y*TW+x);
}
/** Paints tile t's ground into picture tile c. */
function paintIn(c: Tile, t: number){
  const x=t%TW, y=(t/TW)|0, o=owner[t], i0=(y*RS-c.y0)*CH+x*RS-c.x0, base=c.base, wbuf=c.buf, RW=CH;
  dirtyTiles.add(c);
  if (!o){ for (let sy=0;sy<RS;sy++){ const i=i0+sy*RW; for (let sx=0;sx<RS;sx++) wbuf[i+sx]=base[i+sx]; } }
  else {
    const n=styleOf(o);
    const f=(dx: number, dy: number) => { const xx=x+dx, yy=y+dy; return xx<0||yy<0||xx>=TW||yy>=TH || owner[yy*TW+xx]!==o; };
    const L=f(-1,0), Rt=f(1,0), U=f(0,-1), D=f(0,1), UL=f(-1,-1), UR=f(1,-1), DL=f(-1,1), DR=f(1,1);
    // occupied by an enemy: hatched with "/" lines in the occupier's colour
    const oc=occ[t], hatch=oc ? styleOf(oc).bp : 0;
    for (let sy=0;sy<RS;sy++){
      const i=i0+sy*RW, Y=y*RS+sy;
      for (let sx=0;sx<RS;sx++){
        const e=edgeDist(sx,sy,L,Rt,U,D,UL,UR,DL,DR); let c=tint(base[i+sx],n.ia,n.fr,n.fg,n.fb);
        if (oc){ c = ((x*RS+sx+Y)&3)===0 ? mixP(c,hatch,0.8) : mixP(c,0xff000000,0.12); }
        wbuf[i+sx] = e===0 ? n.bp : e===1 ? mixP(c,n.bpIn,0.45) : c;
      }
    }
  }
}
/** Repaints tile t and its eight neighbours (their borders depend on it). */
export function repaint(t: number){
  const x=t%TW, y=(t/TW)|0;
  for (let yy=Math.max(0,y-1);yy<=Math.min(TH-1,y+1);yy++) for (let xx=Math.max(0,x-1);xx<=Math.min(TW-1,x+1);xx++) paintTile(yy*TW+xx);
}
/** Paints the whole overview (a new map: the picture's tiles are painted as they are made). */
export function paintAll(){ for (let t=0;t<NT;t++) ovPaint(t); }
/** Uploads what changed: the overview's changed part, and the ground of each tile that changed. */
export function flushWorld(){
  if (ox1>=0){ ovctx.putImageData(ovImg,0,0,ox0,oy0,ox1-ox0+1,oy1-oy0+1); ox0=TW; oy0=TH; ox1=-1; oy1=-1; }
  for (const c of dirtyTiles) c.gctx.putImageData(c.img,0,0);
  dirtyTiles.clear();
}
