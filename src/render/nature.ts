/* ---------- nature: the trees, rocks and copper the simulation placed, plus cacti ----------
   Drawn into the nature canvas of each tile of the picture under its buildings (render/tiles.ts)
   when the tile is made, and redrawn locally whenever a resource is harvested, used up or cleared
   for a building. Sprites are small outlined pixel drawings, made once and stamped. */
import { TW, TH, RS, T_FOREST, T_HILLS, T_MOUNT, T_DESERT, T_SNOW } from '../core/constants';
import { terr, isLand, resType, resLeft } from '../sim/state';
import { R_TREE, R_TWIG, R_STONE, R_COPPER } from '../sim/resources';
import { hash2 } from './terrain';
import { rows, sprite, type Pal } from './pixel';
import { CH, painters, natureCtx, tilesIn, type Tile } from './tiles';

let nctx!: CanvasRenderingContext2D;   // the tile being drawn in, set up to take map render pixels
function into(c: Tile){ nctx=natureCtx(c); nctx.setTransform(1,0,0,1,-c.x0,-c.y0); }

const LEAF: Pal = { h:'#b2d86c', l:'#7fb34c', m:'#4f8a37', d:'#2e5b2a', t:'#6b4a2c', T:'#4a321e' };
const LEAF2: Pal = { h:'#c6d66a', l:'#93b04a', m:'#5f8c36', d:'#365e29', t:'#6b4a2c', T:'#4a321e' };   // a yellower crown
const PINE: Pal = { h:'#78ad6a', l:'#4f8c55', m:'#336d43', d:'#1f4a33', t:'#5a3c22', T:'#3e2916' };
const SNOWPINE: Pal = { h:'#ffffff', l:'#e6eff2', m:'#3b6e50', d:'#244b3a', t:'#5a3c22', T:'#3e2916' };
const ROCK: Pal = { h:'#dcd6ca', l:'#bdb6aa', m:'#99928a', d:'#6c665d' };
const ORE: Pal = { ...ROCK, g:'#ffe1ae', c:'#cf7a38', o:'#f0a45e' };
const DRY: Pal = { o:'#a7a24e', O:'#c2bb5e', b:'#7d5a35', B:'#5a3c22' };
const STUMP: Pal = { w:'#c79c64', b:'#6b4a2c', B:'#4a321e' };
const CACTUS: Pal = { g:'#79b04c', G:'#4c7f33', f:'#f2d36b' };

const OAK = [['..hll..','.hlllm.','hllmmmd','llmmmdd','lmmmddd','.mmddd.','..dtd..','...t...','...T...'],
             ['.hll..','hllmm.','lmmmdd','mmmddd','.mddd.','..tt..','..tT..'],
             ['..hl.ll.','.hllmllm','hllmmmmd','lmmmmddd','.mmmddd.','...td...','...tT...']];
const FIR = ['...h...','..hlm..','..lmd..','.hlmmd.','..lmmd.','.llmmdd','hlmmmdd','..mdd..','...t...','...T...'];
const TWIG = ['O.....o','.b..O.b','..b.bb.','...bb..','...b...','...b...','...B...'];
const STUMPG = ['.ww.','bwwb','bBBb'];
const STONE = ['.hl.','hlmd','.md.'];
const BOULDER = ['.hll.','hllmd','lmmdd','.mdd.'];
const COPPER = ['..g..','.lco.','lmocd','moddc','.mdd.'];
const CACT = ['..g..','..gG.','g.gG.','gGgGg','.ggGG','..gG.','..gG.'];
const SOFT='rgba(22,30,14,0.62)';   // a softer edge for plants, so forests don't turn to ink

const cache=new Map<string, HTMLCanvasElement>();
function spr(key: string, grid: string[], pal: Pal, edge=SOFT){
  let c=cache.get(key);
  if (!c){ const w=Math.max(...grid.map(r=>r.length)); c=sprite(w+2,grid.length+2,ctx=>rows(ctx,1,1,grid,pal),edge); cache.set(key,c); }
  return c;
}
/** Stamps a sprite standing with its bottom row on pixel row `by`, centred on column `cx`. */
function stand(c: HTMLCanvasElement, cx: number, by: number){ nctx.drawImage(c, cx-(c.width>>1), by-c.height+2); }

function drawTile(x: number, y: number){
  const t=y*TW+x; if (!isLand[t]) return;
  const tr=terr[t], h=hash2(x*3+17,y*5+3), type=resType[t], left=resLeft[t]>0;
  const cx=x*RS+1+((h*997|0)%3), by=y*RS+RS-1;
  if (type===R_TREE){
    if (!left){ stand(spr('stump',STUMPG,STUMP),cx,by); return; }
    if (tr===T_SNOW) stand(spr('snowpine',FIR,SNOWPINE),cx,by);
    else if (tr===T_HILLS || (tr===T_FOREST && h<0.22)) stand(spr('pine',FIR,PINE),cx,by);
    else { const v=(h*7919|0)%3; stand(spr('oak'+v+(h<0.5?'a':'b'),OAK[v],h<0.5?LEAF:LEAF2),cx,by); }
  }
  else if (type===R_TWIG){ stand(left ? spr('twig',TWIG,DRY) : spr('stump',STUMPG,STUMP),cx,by); }
  else if (type===R_STONE){
    if (left) stand(tr===T_MOUNT ? spr('boulder',BOULDER,ROCK,'rgba(40,36,30,0.55)') : spr('stone',STONE,ROCK,'rgba(40,36,30,0.55)'),cx,by);
    else { nctx.fillStyle='rgba(150,144,134,.7)'; nctx.fillRect(cx-1,by,2,1); nctx.fillRect(cx+1,by-1,1,1); }
  }
  else if (type===R_COPPER){
    if (left) stand(spr('copper',COPPER,ORE,'rgba(26,18,12,0.85)'),cx,by);
    else { nctx.fillStyle='rgba(170,110,70,.7)'; nctx.fillRect(cx-1,by,2,1); }
  }
  else if (tr===T_DESERT && hash2(x*7+5,y*11+1)<0.007) stand(spr('cactus',CACT,CACTUS),cx,by);
}

/** Is there anything of nature to draw on tile t? */
const natural = (t: number) => isLand[t]===1 && (resType[t]>0 || terr[t]===T_DESERT);
/** Paints the nature of picture tile c: every map tile whose sprite may reach into it (they stand
    up to three tiles tall and lean a little either side), in rows from the back. A tile with
    nothing on it gets no canvas. */
function natureOf(c: Tile){
  const tx0=Math.max(0,c.x0/RS-2), ty0=Math.max(1,c.y0/RS), tx1=Math.min(TW-1,(c.x0+CH)/RS+1), ty1=Math.min(TH-1,(c.y0+CH)/RS+3);
  let any=false;
  for (let y=ty0;y<=ty1 && !any;y++) for (let x=tx0;x<=tx1;x++) if (natural(y*TW+x)){ any=true; break; }
  if (!any) return;
  into(c);
  for (let y=ty0;y<=ty1;y++) for (let x=tx0;x<=tx1;x++) drawTile(x,y);
}
painters.nature=natureOf;

/** Redraws the pixels around tile t, in each tile of the picture they fall in, keeping the overlap
    order of neighbouring sprites. */
export function redrawNature(t: number){
  const x=t%TW, y=(t/TW)|0, rx=x*RS-5, ry=y*RS-9, w=RS+11, h=RS+12;
  for (const c of tilesIn(rx,ry,w,h)){
    if (!c.nctx && !natural(t)) continue;   // (nothing was there, and nothing is)
    into(c);
    nctx.save(); nctx.beginPath(); nctx.rect(rx,ry,w,h); nctx.clip();
    nctx.clearRect(rx,ry,w,h);
    for (let yy=Math.max(1,y-2);yy<=Math.min(TH-1,y+3);yy++) for (let xx=Math.max(0,x-3);xx<=Math.min(TW-1,x+3);xx++) drawTile(xx,yy);
    nctx.restore();
  }
}
