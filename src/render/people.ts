/* ---------- people: outlined 4×8 pixel figures, made once per look and stamped each frame ----------
   Villagers wear their kingdom's colour; soldiers wear mail under a tabard in their kingdom's
   colour and a helmet with a crest, and carry a spear, raised on the march and thrust forward
   as they strike. Beggars hunch in grey rags. Everyone faces the way they walk, and is outlined
   in a dark shade of their kingdom's colour, so mixed crowds stay apart. */
import { rows, sprite, flipped, type Pal } from './pixel';
import { styleOf } from './style';

const SKIN = ['#f1c9a5','#d9a679','#a8744f','#7a5236'];
const SKIN_D = ['#d8a988','#bb875d','#8a5c3b','#5e3e28'];
const HAIR = ['#3b2a1e','#7a4a24','#c9a060','#26262c'];

// the body: 4 wide, 8 tall (head 3, body 3, legs 2), facing right. Frames: standing, mid-step.
const VILLAGER = [
  ['.hh.','hhse','hss.','tttt','tttT','abbT','.ll.','.ff.'],
  ['.hh.','hhse','hss.','tttt','tttT','abbT','l..l','f..f'],
];
const SOLDIER = [
  ['.mm.','mMse','.ss.','cttc','cttC','cbbC','.ll.','.ff.'],
  ['.mm.','mMse','.ss.','cttc','cttC','cbbC','l..l','f..f'],
];
const BEGGAR = [
  ['....','.hh.','hse.','gggs','gGgg','gGg.','.l..','.ff.'],
  ['....','.hh.','hse.','gggs','gGgg','gGg.','.l.l','f..f'],
];
// sprite canvas: the body sits at columns 4..7, rows 4..11; the spear and crest rise above it
export const BODY_X = 4, FEET_Y = 11;
const CW = 13, CH = 15;

const cache = new Map<string, HTMLCanvasElement>();
/** The sprite for a person of kingdom o: kind 0 villager, 1 soldier, 2 beggar; frame 0 stand, 1 step, 2 strike. */
export function personSprite(o: number, kind: number, look: number, frame: number, left: boolean){
  const key=o+'|'+kind+'|'+look+'|'+frame+'|'+(+left);
  let c=cache.get(key);
  if (c) return c;
  if (left){ c=flipped(personSprite(o,kind,look,frame,false)); cache.set(key,c); return c; }
  const n=styleOf(o), skin=look&3, hair=(look>>2)&3;
  const pal: Pal = { h:HAIR[hair], s:SKIN[skin], a:SKIN_D[skin], e:'#2a1c14', t:n.roof, T:n.roofD, b:'#5a3c22', l:'#6a4a30', f:'#2e241c',
    m:'#aeb7c0', M:'#7d8790', c:'#8d949b', C:'#6c737a', g:'#8a8476', G:'#6a645a' };
  if (kind===2){ pal.s='#c7c49a'; pal.e='#4a4a3a'; pal.l='#5a5348'; }
  const body = kind===1 ? SOLDIER : kind===2 ? BEGGAR : VILLAGER;
  c=sprite(CW,CH,ctx=>{
    rows(ctx,BODY_X,FEET_Y-7,body[Math.min(frame,1)],pal);
    if (kind===1){
      // crest on the helmet
      ctx.fillStyle=n.roof; ctx.fillRect(BODY_X+1,FEET_Y-8,2,1);
      if (frame===2){
        // spear thrust forward at shoulder height
        ctx.fillStyle='#7a5634'; ctx.fillRect(BODY_X+3,FEET_Y-4,5,1);
        ctx.fillStyle='#e6e2d6'; ctx.fillRect(BODY_X+8,FEET_Y-4,1,1);
        ctx.fillStyle=pal.s; ctx.fillRect(BODY_X+3,FEET_Y-3,1,1);
      } else {
        // spear held upright
        ctx.fillStyle='#7a5634'; ctx.fillRect(BODY_X+4,FEET_Y-9,1,9);
        ctx.fillStyle='#e6e2d6'; ctx.fillRect(BODY_X+4,FEET_Y-11,1,2);
        ctx.fillStyle=pal.s; ctx.fillRect(BODY_X+4,FEET_Y-3,1,1);
      }
    }
  }, n.outline);
  // a soft shadow behind the feet
  const ctx=c.getContext('2d')!;
  ctx.globalCompositeOperation='destination-over'; ctx.fillStyle='rgba(12,22,6,0.32)';
  ctx.fillRect(BODY_X-1,FEET_Y+1,6,1); ctx.fillRect(BODY_X,FEET_Y+2,4,1);
  ctx.globalCompositeOperation='source-over';
  cache.set(key,c);
  return c;
}
export function resetPeople(){ cache.clear(); }
