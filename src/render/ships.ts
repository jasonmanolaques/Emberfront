/* ---------- ships and boats ----------
   A ship is a longship with a square sail in its kingdom's colours, shields along the gunwale and
   up to five soldiers standing on deck, spears upright (a colony's ship carries two settlers
   instead, with no spears). Made once per kingdom, facing, crew and bob, and stamped each frame. A
   villager crossing a sea lane sits in a small boat. */
import { sprite, flipped } from './pixel';
import { styleOf } from './style';

const W = 40, H = 30;
const cache = new Map<string, HTMLCanvasElement>();

/** The ship of kingdom o facing right (`face` 1) or left, with `crew` men aboard (settlers if `settlers`), bobbing at `bob` (0 or 1). */
export function shipSprite(o: number, face: number, crew: number, settlers: boolean, bob: number){
  const key=`${o}|${face}|${crew}|${+settlers}|${bob}`;
  let c=cache.get(key);
  if (c) return c;
  const st=styleOf(o), by=bob;
  c=sprite(W,H,ctx => {
    const R=(x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle=col; ctx.fillRect(x,y+by,w,h); };
    // the hull: dark planks, a lighter strake, a prow and a stern curling up
    R(4,19,32,4,'#5a3d28'); R(6,23,28,2,'#4a3220'); R(8,25,24,1,'#3b2818');
    R(4,18,32,1,'#7a5634'); R(3,17,2,2,'#7a5634'); R(35,16,3,3,'#7a5634'); R(37,14,2,3,'#7a5634'); R(2,16,2,2,'#7a5634');
    R(6,21,28,1,'#7a5634');
    // shields along the gunwale
    for (let i=0;i<5;i++){ const x=7+i*6; R(x,19,4,3,st.roof); R(x,19,4,1,st.roofL); R(x+1,20,2,1,'#ece3c8'); }
    // the mast and the square sail
    R(19,3,2,17,'#6c4a2c'); R(18,3,4,1,'#8a6238');
    R(10,4,20,10,st.roof); R(10,4,20,1,st.roofL); R(10,13,20,1,st.roofD); R(19,4,2,10,'#ece3c8'); R(10,8,20,2,'#ece3c8');
    R(21,1,6,2,st.roofL); R(26,1,1,2,st.roofD);   // the pennant
    // the crew, along the deck between the shields and the mast
    const slots=[7,13,25,31,16];
    for (let i=0;i<Math.min(5,crew);i++){
      const x=slots[i];
      if (settlers){ R(x,13,3,2,'#c9a07a'); R(x,15,3,3,'#a9894f'); continue; }
      R(x,12,3,2,'#9aa0a6'); R(x,14,3,1,'#f1c9a5'); R(x,15,3,3,st.roof); R(x+1,15,1,3,st.roofL);   // helmet, face, tunic
      R(x+3,8,1,10,'#c2915c'); R(x+3,7,1,2,'#dfe5ea');                                              // a spear
    }
    // foam at the waterline
    ctx.fillStyle='rgba(235,245,250,.75)'; ctx.fillRect(3,25+by,5,1); ctx.fillRect(34,25+by,4,1); ctx.fillRect(12,26+by,6,1); ctx.fillRect(25,26+by,5,1);
  });
  if (face<0) c=flipped(c);
  cache.set(key,c);
  return c;
}
export const SHIP_W = W, SHIP_H = H;
export function resetShips(){ cache.clear(); }

/** A small boat under a villager (drawn at his feet, in render pixels). */
export function drawBoat(ctx: CanvasRenderingContext2D, x: number, y: number, face: number, bob: number){
  const R=(rx: number, ry: number, w: number, h: number, col: string) => { ctx.fillStyle=col; ctx.fillRect(x+rx,y+ry+bob,w,h); };
  R(-6,-1,13,1,'rgba(235,245,250,.7)');
  R(-6,-3,13,3,'#5a3d28'); R(-5,-4,11,1,'#7a5634'); R(-7,-5,2,2,'#7a5634'); R(6,-6,2,3,'#7a5634');
  R(-5,0,9,1,'#3b2818');
  R(face>0 ? -9 : 7,-5,3,1,'#8a6a40'); R(face>0 ? 7 : -9,-5,3,1,'#8a6a40');   // oars
}
