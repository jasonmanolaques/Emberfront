/* ---------- the map's picture in tiles ----------
   The ground (terrain and territory), the nature on it (trees, rocks) and the buildings are drawn
   into square tiles of the map, CH render pixels a side, each with three small canvases. A tile
   is made, and painted from the simulation's state, only when it comes into view, and the tiles
   seen longest ago are let go once there are more than MAX_TILES, so a map of any size costs
   about what the screen shows. Changes (a tile changing hands, a tree felled, a house built) are
   painted into the tiles that exist; a tile made later is painted as things are then.
   (render/terrain.ts, render/nature.ts and render/sprites.ts paint them; render/render.ts draws them.) */
import { RW, RH } from '../core/constants';

export const CH = 256;             // render pixels a side of a tile (64 map tiles, 16 plots)
const MAX_TILES = 100;             // tiles kept before the least recently seen are let go
export const MAKE_PER_FRAME = 4;   // tiles made a frame at most (the rest show the overview until their turn)

export interface Tile {
  cx: number; cy: number;          // its place in the grid of tiles
  x0: number; y0: number;          // its top-left corner, in render pixels
  ground: HTMLCanvasElement; gctx: CanvasRenderingContext2D;
  img: ImageData; buf: Uint32Array;   // the ground's pixels, uploaded when dirty
  base: Uint32Array;               // the terrain and roads, before the territory's tint
  dirty: boolean;
  nature: HTMLCanvasElement | null; nctx: CanvasRenderingContext2D | null;   // made when something stands there
  objects: HTMLCanvasElement | null; octx: CanvasRenderingContext2D | null;
  seen: number;                    // the frame it was last drawn
}

let cols = 0, rows = 0, grid: (Tile | undefined)[] = [], count = 0;
export let frame = 0;
/** What paints a new tile: its ground, its nature and its buildings (set by the modules that draw them). */
export const painters = { ground: (_t: Tile) => {}, nature: (_t: Tile) => {}, objects: (_t: Tile) => {} };

/** Lets every tile go and fits the grid to the map's size (a new map). */
export function resetTiles(){ cols=Math.ceil(RW/CH); rows=Math.ceil(RH/CH); grid=new Array(cols*rows); count=0; }
export const tileCols = () => cols, tileRows = () => rows;
/** The tile at (cx,cy), if it has been made. */
export const tileAt = (cx: number, cy: number) => cx<0 || cy<0 || cx>=cols || cy>=rows ? undefined : grid[cy*cols+cx];
/** Every tile made that overlaps the rectangle (render pixels). */
export function tilesIn(x: number, y: number, w: number, h: number): Tile[] {
  const out: Tile[]=[];
  const cx0=Math.max(0,Math.floor(x/CH)), cy0=Math.max(0,Math.floor(y/CH)), cx1=Math.min(cols-1,Math.floor((x+w-1)/CH)), cy1=Math.min(rows-1,Math.floor((y+h-1)/CH));
  for (let cy=cy0;cy<=cy1;cy++) for (let cx=cx0;cx<=cx1;cx++){ const t=grid[cy*cols+cx]; if (t) out.push(t); }
  return out;
}
/** The tile holding render pixel (x,y), if it has been made. */
export const tileOfPx = (x: number, y: number) => tileAt(Math.floor(x/CH), Math.floor(y/CH));

const canvas = (w: number, h: number) => { const c=document.createElement('canvas'); c.width=w; c.height=h; return c; };
/** Makes tile (cx,cy) and paints it. */
export function makeTile(cx: number, cy: number): Tile {
  const ground=canvas(CH,CH), gctx=ground.getContext('2d') as CanvasRenderingContext2D, img=gctx.createImageData(CH,CH);
  const t: Tile={ cx, cy, x0:cx*CH, y0:cy*CH, ground, gctx, img, buf:new Uint32Array(img.data.buffer), base:new Uint32Array(CH*CH), dirty:true,
    nature:null, nctx:null, objects:null, octx:null, seen:frame };
  grid[cy*cols+cx]=t; count++;
  painters.ground(t); painters.nature(t); painters.objects(t);
  if (count>MAX_TILES) letGo();
  return t;
}
/** A tile's nature or buildings canvas, made the first time something is drawn there. */
export function natureCtx(t: Tile){
  if (!t.nctx){ t.nature=canvas(CH,CH); t.nctx=t.nature.getContext('2d') as CanvasRenderingContext2D; }
  return t.nctx;
}
export function objectsCtx(t: Tile){
  if (!t.octx){ t.objects=canvas(CH,CH); t.octx=t.objects.getContext('2d') as CanvasRenderingContext2D; }
  return t.octx;
}
/** Lets the tiles seen longest ago go, down to three quarters of MAX_TILES (never one seen this frame). */
function letGo(){
  const made=grid.filter((t): t is Tile => !!t && t.seen<frame).sort((a,b) => a.seen-b.seen);
  for (const t of made){ if (count<=MAX_TILES*0.75) break; grid[t.cy*cols+t.cx]=undefined; count--; }
}
/** A new frame: tiles drawn from now on count as seen in it. */
export function nextFrame(){ frame++; }
