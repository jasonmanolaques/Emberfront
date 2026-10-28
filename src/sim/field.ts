/* ---------- fields: steps to somewhere, over a box of the map ----------
   A path search (sim/war.ts) fills a field with the steps from each tile to the nearest of its
   goals. A field covers only the box of the map it is worked out over (the kingdoms concerned, and
   a margin round them), so the many fields the armies need cost little however big the map is;
   outside its box there is no way (-1). */
import { TW, TH } from '../core/constants';

export class Field {
  x0 = 0; y0 = 0; w = 0; h = 0;
  d = new Int16Array(0);   // the steps, row by row over the box, -1 where there is no way
  /** Covers tiles x0..x1, y0..y1 (clamped to the map), none with a way yet. */
  fit(x0: number, y0: number, x1: number, y1: number){
    x0=Math.max(0,x0|0); y0=Math.max(0,y0|0); x1=Math.min(TW-1,x1|0); y1=Math.min(TH-1,y1|0);
    const w=Math.max(0,x1-x0+1), h=Math.max(0,y1-y0+1), n=w*h;
    if (n>this.d.length || n<this.d.length>>2) this.d=new Int16Array(n);   // (shrinks when far too big, so a field doesn't hold on to room)
    this.x0=x0; this.y0=y0; this.w=w; this.h=h;
    this.d.fill(-1,0,n);
  }
  /** Where tile t is in d, or -1 outside the box. */
  idx(t: number){ const x=t%TW-this.x0, y=((t/TW)|0)-this.y0; return x<0 || y<0 || x>=this.w || y>=this.h ? -1 : y*this.w+x; }
  /** The steps from tile t, or -1 (no way, or outside the box). */
  at(t: number){ const i=this.idx(t); return i<0 ? -1 : this.d[i]; }
}
