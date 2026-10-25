/* ---------- pixel-art helpers: sprites from text grids, and automatic outlines ----------
   Every sprite in the game gets a thin dark outline where it meets empty space. That keeps
   buildings, trees and crowds of people readable against busy ground. */

export type Pal = Record<string, string>;

/** Draws a text grid at (x,y): each character is a pixel, '.' is empty, others look up `pal`. */
export function rows(ctx: CanvasRenderingContext2D, x: number, y: number, grid: string[], pal: Pal){
  for (let j=0;j<grid.length;j++){
    const r=grid[j];
    for (let i=0;i<r.length;i++){
      const ch=r[i]; if (ch==='.' || ch===' ') continue;
      const c=pal[ch]; if (!c) continue;
      ctx.fillStyle=c; ctx.fillRect(x+i,y+j,1,1);
    }
  }
}

/** Paints `color` on every empty pixel beside a solid one (4-neighbours), inside the w×h area at (x,y).
    Faint pixels (shadows, glows) neither get an outline nor cause one. */
export function outline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string){
  if (w<=0 || h<=0) return;
  const img=ctx.getImageData(x,y,w,h), d=img.data, solid=new Uint8Array(w*h);
  for (let i=0;i<w*h;i++) solid[i]=+(d[i*4+3]>=200);
  const [r,g,b,a]=parseColor(color);
  let changed=false;
  for (let j=0;j<h;j++) for (let i=0;i<w;i++){
    const k=j*w+i; if (d[k*4+3]!==0) continue;
    if ((i>0 && solid[k-1]) || (i<w-1 && solid[k+1]) || (j>0 && solid[k-w]) || (j<h-1 && solid[k+w])){
      d[k*4]=r; d[k*4+1]=g; d[k*4+2]=b; d[k*4+3]=a; changed=true;
    }
  }
  if (changed) ctx.putImageData(img,x,y);
}
const colorCache=new Map<string, number[]>();
function parseColor(c: string){
  let v=colorCache.get(c);
  if (!v){
    const cv=document.createElement('canvas'); cv.width=cv.height=1; const x=cv.getContext('2d')!;
    x.fillStyle=c; x.fillRect(0,0,1,1); v=Array.from(x.getImageData(0,0,1,1).data); colorCache.set(c,v);
  }
  return v;
}

/** A w×h sprite drawn by `draw`, then outlined. */
export function sprite(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, edge='rgba(26,18,12,0.92)'){
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d')!; draw(ctx); if (edge) outline(ctx,0,0,w,h,edge);
  return c;
}
/** The sprite mirrored left to right. */
export function flipped(src: HTMLCanvasElement){
  const c=document.createElement('canvas'); c.width=src.width; c.height=src.height;
  const ctx=c.getContext('2d')!; ctx.translate(src.width,0); ctx.scale(-1,1); ctx.drawImage(src,0,0);
  return c;
}
