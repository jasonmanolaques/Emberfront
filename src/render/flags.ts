/* ---------- flags: each kingdom's banner, from its country (core/countries.ts) ----------
   Drawn as pixels on the map (a leader's standard, an army's banner) and as little images in the
   panels (`flagURL`, for a CSS background). */
import { FLAG_W, FLAG_H, flagPixels, flagSmall } from '../core/countries';

const urls = new Map<string, string>();
/** A data URL of the country's flag, for the panels (crisp when scaled up: image-rendering pixelated). */
export function flagURL(code: string){
  let u=urls.get(code);
  if (!u){
    const c=document.createElement('canvas'); c.width=FLAG_W; c.height=FLAG_H;
    const x=c.getContext('2d')!, p=flagPixels(code);
    for (let i=0;i<p.length;i++){ x.fillStyle=p[i]; x.fillRect(i%FLAG_W,(i/FLAG_W)|0,1,1); }
    u=c.toDataURL(); urls.set(code,u);
  }
  return u;
}
/** CSS for an element showing the flag. */
export const flagCSS = (code: string) => `background:url(${flagURL(code)}) center/100% 100% no-repeat;image-rendering:pixelated`;

/** Paints the flag 6×4 at (x,y) on a canvas, mirrored if it flies to the left of its pole. */
export function paintSmallFlag(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, mirror=false){
  const p=flagSmall(code);
  for (let j=0;j<4;j++) for (let i=0;i<6;i++){ ctx.fillStyle=p[j*6+(mirror ? 5-i : i)]; ctx.fillRect(x+i,y+j,1,1); }
}
const imgs = new Map<string, HTMLCanvasElement>();
/** The full flag as a 12×8 canvas, to draw scaled. */
export function flagImage(code: string){
  let c=imgs.get(code);
  if (!c){ c=document.createElement('canvas'); c.width=FLAG_W; c.height=FLAG_H; const x=c.getContext('2d')!, p=flagPixels(code); for (let i=0;i<p.length;i++){ x.fillStyle=p[i]; x.fillRect(i%FLAG_W,(i/FLAG_W)|0,1,1); } imgs.set(code,c); }
  return c;
}
