/* ---------- terrain & territory layer (one pixel buffer, repainted per tile) ---------- */
import { TW, TH, DW, DH, NT, T_DEEP, T_GRASS, T_DRY, T_FOREST, T_DESERT, T_HILLS, T_BEACH, T_SNOW } from '../core/constants';
import { clamp, hexRGB, mixc, pack, type RGB } from '../core/util';
import { W, owner, terr, isLand, elev } from '../sim/state';
import { styleOf, type NationStyle } from './style';

const PAL = {
  deep:hexRGB('#1d4f86'), water:hexRGB('#2766a6'), shallow:hexRGB('#3a8dc8'), foam:hexRGB('#a6d8ef'),
  beach:hexRGB('#e6d394'), grass:hexRGB('#5aa83c'), dry:hexRGB('#a9b84e'), forest:hexRGB('#367a2d'), desert:hexRGB('#dcb466'),
  hills:hexRGB('#7e9a4c'), mount:hexRGB('#8c857b'), snow:hexRGB('#edf2f6'), road:hexRGB('#b98f58'), wetsand:hexRGB('#c9b37a')
};
const TCOL = [PAL.deep,PAL.water,PAL.shallow,PAL.beach,PAL.grass,PAL.dry,PAL.forest,PAL.desert,PAL.hills,PAL.mount,PAL.snow];
const FLOWERS: RGB[] = [[255,255,255],[255,221,92],[240,122,172]];

export const worldC = document.createElement('canvas'); worldC.width = DW; worldC.height = DH;
const wctx = worldC.getContext('2d') as CanvasRenderingContext2D;
const worldImg = wctx.createImageData(DW, DH);
export const wbuf = new Uint32Array(worldImg.data.buffer);
const base = new Uint32Array(DW*DH);   // terrain without territory tint
let dx0=DW, dy0=DH, dx1=-1, dy1=-1;    // dirty rectangle still to upload

/** Stable per-pixel hash for the current map (texture variation, tree placement). */
export function hash2(x: number, y: number){ let h=Math.imul(x,374761393)^Math.imul(y,668265263)^W.mapSeed; h=Math.imul(h^(h>>>13),1274126177); h^=h>>>16; return (h>>>0)/4294967296; }

export function buildBase(){
  const k = 1/W.heightRange;
  for (let y=0;y<TH;y++) for (let x=0;x<TW;x++){
    const t=y*TW+x, tr=terr[t], land=isLand[t], c=TCOL[tr];
    let s=0;
    if (land){
      const a=elev[x>0&&y>0?t-TW-1:t], b=elev[x<TW-1&&y<TH-1?t+TW+1:t];
      const K = tr>=T_HILLS ? 7 : 3.5;
      s = Math.round(clamp((a-b)*k*K,-0.32,0.32)*20)/20;
      if (tr<T_HILLS) s += (elev[t]-W.seaLevel)*k*0.1;
    }
    const up = y>0 ? isLand[t-TW] : 0, dn = y<TH-1 ? isLand[t+TW] : 0, lf = x>0 ? isLand[t-1] : 0, rt = x<TW-1 ? isLand[t+1] : 0;
    for (let sy=0;sy<2;sy++) for (let sx=0;sx<2;sx++){
      const X=x*2+sx, Y=y*2+sy, j=hash2(X,Y);
      let col=c; const f=1+s+(j-0.5)*0.07;
      const sideL = (sx===0&&lf)||(sx===1&&rt)||(sy===0&&up)||(sy===1&&dn);
      if (!land){
        if (sideL) col=mixc(c,PAL.foam,0.5);
        else if (tr===T_DEEP && j<0.015) col=mixc(c,PAL.water,0.6);
      } else {
        const sideW = (sx===0&&!lf)||(sx===1&&!rt)||(sy===0&&!up)||(sy===1&&!dn);
        if (sideW && (tr===T_BEACH||tr===T_DESERT||tr===T_GRASS||tr===T_DRY)) col=mixc(c,PAL.wetsand,0.55);
        else if (tr===T_GRASS||tr===T_FOREST){ if (j<0.045) col=mixc(c,[124,196,88],0.5); else if (tr===T_GRASS && j>0.996) col=FLOWERS[(j*1e6|0)%3]; }
        else if (tr===T_DESERT && j<0.06) col=mixc(c,[244,214,140],0.6);
        else if (tr===T_SNOW && j<0.05) col=[255,255,255];
      }
      base[Y*DW+X]=pack(col[0]*f,col[1]*f,col[2]*f);
    }
  }
}

export function paintRoad(t: number){
  const x=t%TW, y=(t/TW)|0, c=PAL.road;
  for (let sy=0;sy<2;sy++) for (let sx=0;sx<2;sx++){ const X=x*2+sx, Y=y*2+sy, f=0.93+hash2(X+911,Y+37)*0.13; base[Y*DW+X]=pack(c[0]*f,c[1]*f,c[2]*f); }
}

function tint(c: number, n: NationStyle){ const r=c&255, g=(c>>>8)&255, b=(c>>>16)&255; return pack(r*n.ia+n.fr, g*n.ia+n.fg, b*n.ia+n.fb); }
export function paintTile(t: number){
  const x=t%TW, y=(t/TW)|0, o=owner[t], i=y*2*DW+x*2;
  if (!o){ wbuf[i]=base[i]; wbuf[i+1]=base[i+1]; wbuf[i+DW]=base[i+DW]; wbuf[i+DW+1]=base[i+DW+1]; }
  else {
    const n=styleOf(o);
    const up=y===0||owner[t-TW]!==o, dn=y===TH-1||owner[t+TW]!==o, lf=x===0||owner[t-1]!==o, rt=x===TW-1||owner[t+1]!==o;
    wbuf[i]       = (up||lf) ? n.bp : tint(base[i],n);
    wbuf[i+1]     = (up||rt) ? n.bp : tint(base[i+1],n);
    wbuf[i+DW]    = (dn||lf) ? n.bp : tint(base[i+DW],n);
    wbuf[i+DW+1]  = (dn||rt) ? n.bp : tint(base[i+DW+1],n);
  }
  const X=x*2, Y=y*2; if (X<dx0) dx0=X; if (Y<dy0) dy0=Y; if (X+1>dx1) dx1=X+1; if (Y+1>dy1) dy1=Y+1;
}
export function repaint(t: number){ paintTile(t); const x=t%TW; if (x>0) paintTile(t-1); if (x<TW-1) paintTile(t+1); if (t>=TW) paintTile(t-TW); if (t<NT-TW) paintTile(t+TW); }
export function paintAll(){ for (let t=0;t<NT;t++) paintTile(t); dx0=0; dy0=0; dx1=DW-1; dy1=DH-1; }
/** Uploads the changed part of the pixel buffer to the world canvas. */
export function flushWorld(){ if (dx1>=0){ wctx.putImageData(worldImg,0,0,dx0,dy0,dx1-dx0+1,dy1-dy0+1); dx0=DW; dy0=DH; dx1=-1; dy1=-1; } }
