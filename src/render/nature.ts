/* ---------- nature: cacti in the deserts ----------
   Nothing else grows on the map (the goods come from the buildings), so this is all there is: a few
   cacti, drawn into the nature canvas of each tile of the picture under its buildings
   (render/tiles.ts) when the tile is made. Sprites are small outlined pixel drawings, made once and stamped. */
import { TW, TH, RS, T_DESERT } from '../core/constants';
import { terr, isLand } from '../sim/state';
import { hash2 } from './terrain';
import { rows, sprite, type Pal } from './pixel';
import { CH, painters, natureCtx, type Tile } from './tiles';

let nctx!: CanvasRenderingContext2D;   // the tile being drawn in, set up to take map render pixels
function into(c: Tile){ nctx=natureCtx(c); nctx.setTransform(1,0,0,1,-c.x0,-c.y0); }

const CACTUS: Pal = { g:'#79b04c', G:'#4c7f33', f:'#f2d36b' };
const CACT = ['..g..','..gG.','g.gG.','gGgGg','.ggGG','..gG.','..gG.'];
const SOFT='rgba(22,30,14,0.62)';   // a softer edge for plants

let cactus: HTMLCanvasElement | undefined;
function cactusSprite(){
  if (!cactus){ const w=Math.max(...CACT.map(r=>r.length)); cactus=sprite(w+2,CACT.length+2,ctx=>rows(ctx,1,1,CACT,CACTUS),SOFT); }
  return cactus;
}
/** Is there a cactus on tile (x,y)? A few in the desert. */
const cactusAt = (x: number, y: number) => isLand[y*TW+x]===1 && terr[y*TW+x]===T_DESERT && hash2(x*7+5,y*11+1)<0.007;

/** Paints the cacti of picture tile c: every map tile whose sprite may reach into it. A tile with
    none gets no canvas. */
function natureOf(c: Tile){
  const tx0=Math.max(0,c.x0/RS-2), ty0=Math.max(1,c.y0/RS), tx1=Math.min(TW-1,(c.x0+CH)/RS+1), ty1=Math.min(TH-1,(c.y0+CH)/RS+3);
  let any=false;
  for (let y=ty0;y<=ty1 && !any;y++) for (let x=tx0;x<=tx1;x++) if (cactusAt(x,y)){ any=true; break; }
  if (!any) return;
  into(c);
  const spr=cactusSprite();
  for (let y=ty0;y<=ty1;y++) for (let x=tx0;x<=tx1;x++) if (cactusAt(x,y)){
    const h=hash2(x*3+17,y*5+3), cx=x*RS+1+((h*997|0)%3), by=y*RS+RS-1;
    nctx.drawImage(spr, cx-(spr.width>>1), by-spr.height+2);
  }
}
painters.nature=natureOf;
