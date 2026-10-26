/* ---------- people: outlined 4×8 pixel figures, made once per look and stamped each frame ----------
   Villagers wear their kingdom's colour. Soldiers come in three tiers: archaic (bare-headed, a
   tunic in the kingdom's colour and a wooden spear with a flint head), reinforced (mail under a
   tabard and a crested helmet) and heavy armour (plate, a closed helm with a plume, a kite shield
   in the kingdom's colours). They carry their spear upright and thrust it as they strike. Beggars hunch in grey rags. Everyone faces the way they walk, and is outlined
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
// soldiers by tier; near death (the second pair), the head sunk onto the chest
const ARCHAIC = [
  ['.hh.','hhse','.ss.','ttta','tttT','bbbT','.aa.','.ff.'],
  ['.hh.','hhse','.ss.','ttta','tttT','bbbT','a..a','f..f'],
  ['....','.hh.','hhse','ttta','tttT','bbbT','.aa.','.ff.'],
  ['....','.hh.','hhse','ttta','tttT','bbbT','a..a','f..f'],
];
const SOLDIER = [
  ['.mm.','mMse','.ss.','cttc','cttC','cbbC','.ll.','.ff.'],
  ['.mm.','mMse','.ss.','cttc','cttC','cbbC','l..l','f..f'],
  ['....','.mm.','mMse','cttc','cttC','cbbC','.ll.','.ff.'],
  ['....','.mm.','mMse','cttc','cttC','cbbC','l..l','f..f'],
];
const HEAVY = [
  ['.PP.','PPeQ','QPPQ','PttQ','PttQ','PPPQ','.PQ.','.ff.'],
  ['.PP.','PPeQ','QPPQ','PttQ','PttQ','PPPQ','P..Q','f..f'],
  ['....','.PP.','PPeQ','PttQ','PttQ','PPPQ','.PQ.','.ff.'],
  ['....','.PP.','PPeQ','PttQ','PttQ','PPPQ','P..Q','f..f'],
];
const TIERS = [SOLDIER, ARCHAIC, SOLDIER, HEAVY];
const BEGGAR = [
  ['....','.hh.','hse.','gggs','gGgg','gGg.','.l..','.ff.'],
  ['....','.hh.','hse.','gggs','gGgg','gGg.','.l.l','f..f'],
];
// sprite canvas: the body sits at columns 4..7, rows 4..11; the spear and crest rise above it
export const BODY_X = 4, FEET_Y = 11;
const CW = 13, CH = 15;

const cache = new Map<string, HTMLCanvasElement>();
const BLOOD='#9a1a14', BLOOD_D='#6a0f0c';
/** How badly hurt someone looks, by the share of their hit points left: soldiers 0 (two thirds
    and more), 1 hurt, 2 near death (under a third); villagers 0 or 1 (under 60%). */
export function woundStage(kind: number, hp: number, max: number){ const f=hp/max; return kind===1 ? (f>=0.67 ? 0 : f>=0.32 ? 1 : 2) : (f>=0.58 ? 0 : 1); }
/** The sprite for a person of kingdom o: kind 0 villager, 1 soldier, 2 beggar; frame 0 stand, 1 step, 2 strike;
    wound from woundStage; tier 1-3 for soldiers. */
export function personSprite(o: number, kind: number, look: number, frame: number, left: boolean, wound=0, tier=1){
  const key=o+'|'+kind+'|'+look+'|'+frame+'|'+(+left)+'|'+wound+'|'+tier;
  let c=cache.get(key);
  if (c) return c;
  if (left){ c=flipped(personSprite(o,kind,look,frame,false,wound,tier)); cache.set(key,c); return c; }
  const n=styleOf(o), skin=look&3, hair=(look>>2)&3;
  const pal: Pal = { h:HAIR[hair], s:SKIN[skin], a:SKIN_D[skin], e:'#2a1c14', t:n.roof, T:n.roofD, b:'#5a3c22', l:'#6a4a30', f:'#2e241c',
    m:'#aeb7c0', M:'#7d8790', c:'#8d949b', C:'#6c737a', g:'#8a8476', G:'#6a645a', P:'#d4dbe1', Q:'#8e99a4' };
  if (kind===2){ pal.s='#c7c49a'; pal.e='#4a4a3a'; pal.l='#5a5348'; }
  if ((kind===1 && wound===2) || (kind!==1 && wound>0)){ pal.s='#d8b8a0'; }   // pale from losing blood
  const top = kind===1 && wound===2 ? 1 : 0;   // the dying soldier's head has sunk a row
  const body = kind===1 ? TIERS[tier] : kind===2 ? BEGGAR : VILLAGER;
  c=sprite(CW,CH,ctx=>{
    const P=(x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle=col; ctx.fillRect(BODY_X+x,FEET_Y-7+y,w,h); };
    if (kind===1 && tier===3){   // the kite shield, slung on the far arm
      P(-2,3+top,2,3,n.roof); P(-2,3+top,2,1,n.roofL); P(-1,6+top,1,1,n.roofD); P(-2,4+top,1,1,'#e8d27a');
    }
    rows(ctx,BODY_X,FEET_Y-7,body[Math.min(frame,1)+(top ? 2 : 0)],pal);
    const B=(x: number, y: number, col=BLOOD) => { ctx.fillStyle=col; ctx.fillRect(BODY_X+x,FEET_Y-7+y,1,1); };
    // on the grey mail, the face and bare skin, where blood shows whatever the kingdom's colour
    if (kind===1 && wound>=1){ B(3,4); B(3,5,BLOOD_D); B(1,top,'#5d656c'); B(0,3+top,pal.a); }   // a wound in the side, a dented helmet, torn mail
    if (kind===1 && wound===2){ B(0,4); B(0,5,BLOOD_D); B(2,2+top); B(1,6); B(2,7); }           // blood down the mail, on the face and legs
    if (kind!==1 && wound>=1){ B(2,2); B(1,1); B(0,5,BLOOD_D); B(3,4); B(1,6); }                  // a cut face, a bloody hand and shirt
    if (kind===1){
      // a crest on the helmet; the heavy helm's plume stands taller
      if (tier===2){ ctx.fillStyle=n.roof; ctx.fillRect(BODY_X+1,FEET_Y-8+top,2,1); }
      if (tier===3){ ctx.fillStyle=n.roof; ctx.fillRect(BODY_X+1,FEET_Y-9+top,2,2); ctx.fillStyle=n.roofL; ctx.fillRect(BODY_X+1,FEET_Y-9+top,1,1); }
      // archaic spears are a stick with a flint head; armoured ones carry steel
      const shaft=tier===1 ? '#8f6a3c' : '#7a5634', head=tier===1 ? '#a3988a' : tier===3 ? '#f4f6f8' : '#e6e2d6';
      if (frame===2){
        // spear thrust forward at shoulder height
        ctx.fillStyle=shaft; ctx.fillRect(BODY_X+3,FEET_Y-4,5,1);
        ctx.fillStyle=head; ctx.fillRect(BODY_X+8,FEET_Y-4,tier===3 ? 2 : 1,1);
        ctx.fillStyle=tier===3 ? pal.Q : pal.s; ctx.fillRect(BODY_X+3,FEET_Y-3,1,1);
      } else {
        // spear held upright
        ctx.fillStyle=shaft; ctx.fillRect(BODY_X+4,FEET_Y-9,1,9);
        ctx.fillStyle=head; ctx.fillRect(BODY_X+4,FEET_Y-11,1,2);
        if (tier===1){ ctx.fillStyle=head; ctx.fillRect(BODY_X+4,FEET_Y-12,1,1); }   // a long knapped point
        ctx.fillStyle=tier===3 ? pal.Q : pal.s; ctx.fillRect(BODY_X+4,FEET_Y-3,1,1);   // the hand (a gauntlet in plate)
        if (wound===2){ ctx.fillStyle=BLOOD; ctx.fillRect(BODY_X+4,FEET_Y-8,1,1); }
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
/** Someone who fell: the figure on its side, eyes to the sky. */
export function corpseSprite(o: number, kind: number, look: number, tier=1){
  const key='dead|'+o+'|'+kind+'|'+look+'|'+tier;
  let c=cache.get(key);
  if (c) return c;
  const s=personSprite(o,kind,look,0,false,kind===1 ? 2 : 1,tier);
  c=document.createElement('canvas'); c.width=s.height; c.height=s.width;
  const ctx=c.getContext('2d')!; ctx.translate(c.width,0); ctx.rotate(Math.PI/2); ctx.drawImage(s,0,0);
  cache.set(key,c);
  return c;
}
export function resetPeople(){ cache.clear(); }
