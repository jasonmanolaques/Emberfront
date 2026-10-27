/* ---------- capitals: each country's castle in its own tradition ----------
   The capital is a 32×32 pixel building. A country builds it in its region's style (CULTURE): the
   Western keep (sprites.ts drawCastle) or one drawn here: the baroque palaces of Central Europe,
   Hanseatic brick, Nordic timber halls, Mediterranean towers, Orthodox domes, Greek white and
   marble, the Kremlin, Ottoman domes and minarets, the Maghreb's kasbahs, Arabian mud forts,
   Mesopotamian ziggurats, Egypt's pylons and pyramids, Persian tilework, Mughal marble, the
   Sahel's mud mosques, Ethiopia's Gondar castles, the stone enclosures of southern Africa,
   Chinese gate towers, Japanese keeps, the temples of Southeast Asia and Java, the steppe's gers,
   Mesoamerican pyramids, Inca stonework, Spanish colonial cathedrals, the Capitol, and Gothic
   parliaments.
   Each grows with the castle's tier: bigger and taller at tier 2, grand and gilded at tier 3.
   Every one flies its country's flag. Battle damage (wearCapital) is worked out from the
   drawing itself, so it fits any shape: battlements and roofs knocked off, cracks, soot,
   breaches, fires and rubble. */
import { flagSmall } from '../core/countries';
import type { NationStyle } from './style';

/** Which tradition each country builds in (west: the Western keep, the default). */
export const CULTURE: Record<string, string> = {
  GB:'west', FR:'west', DE:'west', BE:'west', LU:'west', IE:'west', CH:'west',
  AT:'central', CZ:'central', SK:'central', HU:'central', PL:'central', SI:'central', HR:'central',
  NL:'hansa', EE:'hansa', LV:'hansa', LT:'hansa', LI:'central',
  AD:'med', MC:'med', SM:'med', VA:'med', LY:'maghreb', IL:'arab', PS:'arab', JO:'arab', KW:'arab',
  TM:'persian', UZ:'persian', TJ:'persian', KG:'steppe',
  NO:'nordic', SE:'nordic', FI:'nordic', IS:'nordic', DK:'nordic',
  ES:'med', PT:'med', IT:'med', MT:'med',
  BG:'orthodox', RS:'orthodox', ME:'orthodox', MK:'orthodox', RO:'orthodox', MD:'orthodox', GE:'orthodox', AM:'orthodox',
  GR:'greek', CY:'greek',
  RU:'kremlin', UA:'kremlin', BY:'kremlin',
  TR:'ottoman', AL:'ottoman', XK:'ottoman', BA:'ottoman', AZ:'ottoman',
  MA:'maghreb', DZ:'maghreb', TN:'maghreb',
  SA:'arab', SY:'arab', LB:'arab', IQ:'ziggurat',
  EG:'egypt', SD:'egypt',
  IR:'persian', AF:'persian', KZ:'steppe', MN:'steppe',
  IN:'mughal', PK:'mughal',
  ML:'sahel', NG:'sahel', ET:'gondar',
  ZA:'zimbabwe', KE:'zimbabwe', CD:'zimbabwe', AO:'zimbabwe',
  CN:'chinese', VN:'chinese', KR:'chinese', JP:'japanese',
  TH:'siam', MM:'siam', ID:'candi', PH:'colonial',
  MX:'meso', PE:'inca', BO:'inca',
  CO:'colonial', VE:'colonial', CU:'colonial', AR:'colonial', CL:'colonial', BR:'colonial',
  US:'capitol', CA:'parliament', AU:'parliament', NZ:'parliament',
};
export const cultureOf = (code: string) => CULTURE[code] ?? 'west';

let g: CanvasRenderingContext2D, X=0, Y=0, flagCode='';
const R = (x: number, y: number, w: number, h: number, c: string) => {   // (snapped to whole pixels)
  const x0=Math.round(x), y0=Math.round(y), w0=Math.round(x+w)-x0, h0=Math.round(y+h)-y0;
  if (w0<=0 || h0<=0) return; g.fillStyle=c; g.fillRect(X+x0,Y+y0,w0,h0);
};
const P = (x: number, y: number, c: string) => R(x,y,1,1,c);
const SH='rgba(14,24,8,.3)', GOLD='#e8c45a', GOLDL='#fff0a0', LIT='#ffd86b', DARK='#2e241c';
type Pal = [string, string, string];   // fill, lit side, shaded side

/** A lit block: light on its left, shade on its right. */
function block(x: number, y: number, w: number, h: number, [c,l,d]: Pal){ R(x,y,w,h,c); R(x,y,1,h,l); R(x+w-1,y,1,h,d); }
/** A pointed roof w wide at its base row `base`, rising h rows. */
function cone(x: number, w: number, base: number, h: number, [c,l,d]: Pal){
  for (let i=0;i<h;i++){ const k=Math.round(i*(w/2)/h), ww=w-2*k; if (ww<=0) break; R(x+k,base-i,ww,1,c); P(x+k,base-i,l); P(x+k+ww-1,base-i,d); }
}
/** An onion dome of half-width hw sitting on row `base`, with a spire (or a cross). */
function onion(cx: number, base: number, hw: number, [c,l,d]: Pal, tip: string, cross=false){
  const prof=[hw-1,hw,hw+1,hw+1,hw,hw-1,Math.max(1,hw-2),1].filter(h => h>0);
  prof.forEach((h,i) => { const y=base-i; R(cx-h,y,h*2,1,c); P(cx-h,y,l); P(cx+h-1,y,d); if (i===2) P(cx-h+1,y,l); });
  const top=base-prof.length;
  if (cross){ R(cx-1,top-3,1,4,tip); R(cx-2,top-2,3,1,tip); } else { R(cx-1,top-1,2,2,tip); P(cx-1,top-2,tip); }
}
/** A dome of radius r on row `base`. */
function dome(cx: number, base: number, r: number, [c,l,d]: Pal){
  for (let dy=0;dy<=r;dy++){ const h=Math.round(Math.sqrt(r*r-dy*dy)); if (!h) continue; R(cx-h,base-dy,h*2,1,c); P(cx-h,base-dy,l); P(cx+h-1,base-dy,d); }
}
/** A roof with upturned eaves (East Asia), w wide at row y, rising 3 rows. */
function eave(x: number, w: number, y: number, [c,l,d]: Pal){
  R(x,y,w,1,d); P(x,y-1,c); P(x+w-1,y-1,c); R(x+1,y-1,w-2,1,c); R(x+2,y-2,w-4,1,c); R(x+3,y-3,w-6,1,l);
}
/** An arched doorway, its sill on row `bottom`. */
function door(x: number, w: number, bottom: number, h: number, c=DARK, pointed=false){
  R(x,bottom-h+2,w,h-2,c); R(x+1,bottom-h+1,w-2,1,c); if (pointed && w>2) P(x+((w-1)>>1),bottom-h,c);
}
const win = (x: number, y: number, c=LIT, h=2) => { R(x,y,1,h,c); };
/** Merlons along row y. */
function crenels(x: number, y: number, w: number, c: string, step=2){ for (let i=0;i<w;i+=step) P(x+i,y,c); }
/** The country's flag on a pole whose top is (x,y). */
function flag(x: number, y: number){
  R(x,y,1,6,'#4a3a2a'); P(x,y-1,GOLD);
  const p=flagSmall(flagCode); for (let j=0;j<4;j++) for (let i=0;i<6;i++) P(x+1+i,y+j,p[j*6+i]);
}
const shade = (hex: string, f: number) => '#'+[1,3,5].map(i => Math.max(0,Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*f))).toString(16).padStart(2,'0')).join('');
const pal = (hex: string): Pal => [hex, shade(hex,1.18), shade(hex,0.78)];

/* ---------- the traditions ---------- */
type Draw = (t: number, n: NationStyle) => void;
const STYLES: Record<string, Draw> = {
  // Central Europe: a baroque palace in ochre, green copper roofs, an onion cupola
  central(t){
    const wall=pal('#e3c78a'), cop=pal('#5fa58a'), trim='#f6efe0';
    if (t>=2){ block(1,15,8,15,wall); block(23,15,8,15,wall); cone(0,10,14,4,cop); cone(22,10,14,4,cop); for (const x of [3,6,25,28]) win(x,19); }
    block(6,17,20,13,wall); R(6,17,20,1,trim); R(6,23,20,1,trim);
    R(5,14,22,3,cop[0]); R(6,13,20,1,cop[1]); R(5,16,22,1,cop[2]);
    for (const x of [8,11,20,23]){ win(x,19); win(x,25); }
    block(12,8,8,9,wall); win(15,10); win(16,10); R(12,8,8,1,trim);
    onion(16,7,t===3 ? 4 : 3,t===3 ? pal(GOLD) : cop,t===3 ? GOLDL : GOLD);
    door(14,4,29,5);
    if (t===3){ R(6,22,20,1,GOLD); for (const x of [7,11,15,19,23]) P(x,12,'#f4f0e6'); R(1,14,8,1,GOLD); R(23,14,8,1,GOLD); }
    flag(t>=2 ? 4 : 1,t>=2 ? 4 : 7);
  },
  // the Hanseatic towns: red brick, stepped gables, a tall church spire
  hansa(t){
    const brick=pal('#a8503a'), slate=pal('#4d5866');
    const gables = t===1 ? [6,17] : [1,9,17,24];
    for (const gx of gables){ block(gx,16,7,14,brick); for (let i=0;i<3;i++) R(gx+i,13-i*2+3,7-i*2,2,brick[0]); win(gx+3,19,'#ffe7a0'); win(gx+3,24,'#ffe7a0'); R(gx,16,7,1,'#e7d9c4'); }
    block(13,8,6,22,brick); cone(12,8,8,t===3 ? 8 : 6,t===3 ? pal('#5aa58a') : slate); win(15,12); win(15,18);
    if (t===3){ P(15,0,GOLD); R(13,15,6,1,GOLD); }
    door(14,4,29,5);
    flag(t===1 ? 22 : 25,t===1 ? 9 : 5);
  },
  // the North: a timber hall under steep shingle roofs, dragon heads at the gables; a stave church
  nordic(t){
    const wood=pal('#6b4a2c'), roof=pal('#3d3329'), cop=pal('#5c9b84');
    block(4,20,24,10,wood); for (let x=6;x<27;x+=3) R(x,20,1,10,'#5a3d24');
    cone(2,28,19,7,t===3 ? cop : roof); P(2,13,'#c9a76a'); P(29,13,'#c9a76a'); P(1,12,'#c9a76a'); P(30,12,'#c9a76a');
    if (t>=2){ block(12,6,8,8,wood); cone(10,12,6,4,roof); cone(12,8,3,3,roof); R(15,0,2,1,'#c9a76a'); }
    if (t===3){ R(4,19,24,1,GOLD); P(16,0,GOLD); }
    door(14,4,29,5); win(8,23,'#ffcf6a'); win(23,23,'#ffcf6a');
    flag(t>=2 ? 23 : 21,t>=2 ? 6 : 8);
  },
  // the Mediterranean: warm stone, terracotta tiles, a campanile; a dome at the last
  med(t){
    const stone=pal('#d8c49a'), tile=pal('#c0603a');
    block(3,19,26,11,stone); R(2,17,28,2,tile[0]); R(3,16,26,1,tile[1]);
    for (const x of [6,10,21,25]) win(x,22);
    block(1,13,7,17,stone); cone(0,9,12,4,tile); win(4,16);
    if (t>=2){ block(23,6,6,24,stone); R(22,5,8,1,tile[2]); cone(22,8,4,4,tile); R(25,9,1,2,DARK); R(25,13,1,2,DARK); }
    if (t===3){ block(11,12,10,6,stone); dome(16,11,6,pal('#c86a42')); R(15,4,2,2,GOLD); P(16,3,GOLD); R(3,19,26,1,GOLD); }
    door(14,4,29,6);
    flag(t===3 ? 3 : 9,t===3 ? 3 : 9);
  },
  // the Orthodox lands: banded brick and stone, domes on drums with crosses
  orthodox(t){
    const band=pal('#d9c4a2'), brick='#a65a3c', lead=t===3 ? pal(GOLD) : pal('#5f8a78');
    block(5,17,22,13,band); for (let y=19;y<29;y+=3) R(5,y,22,1,brick);
    block(12,10,8,7,band); R(12,12,8,1,brick); win(15,12); win(16,12);
    onion(16,9,4,lead,GOLD,true);
    if (t>=2){ block(5,13,5,4,band); onion(8,12,3,lead,GOLD,true); block(22,13,5,4,band); onion(25,12,3,lead,GOLD,true); }
    if (t===3){ R(5,17,22,1,GOLD); }
    door(14,4,29,6,DARK); win(8,21); win(23,21);
    flag(t>=2 ? 0 : 2,t>=2 ? 1 : 9);
  },
  // Greece: whitewash and blue domes; at the last a marble temple
  greek(t){
    const white=pal('#f2f0ea'), blue=pal('#2f6fd6'), marble=pal('#e9e3d4');
    if (t===3){
      R(2,27,28,3,marble[2]); R(3,26,26,1,marble[0]);
      for (let x=4;x<28;x+=3) block(x,15,2,11,marble);
      R(2,13,28,2,marble[0]); R(2,14,28,1,GOLD); cone(2,28,12,5,marble);
      P(16,8,GOLD);
      flag(24,1);
      return;
    }
    block(5,18,22,12,white); block(11,11,10,7,white);
    dome(16,10,5,blue); P(16,4,GOLD); R(15,3,2,1,GOLD);
    if (t===2){ block(23,9,5,9,white); dome(25,8,2,blue); R(24,11,3,3,'#3b4a5a'); block(4,14,6,4,white); dome(7,13,3,blue); }
    for (const x of [8,23]) R(x,21,2,3,'#2f6fd6');
    door(14,4,29,6,'#2a4f8f');
    flag(t===2 ? 1 : 3,t===2 ? 8 : 12);
  },
  // Russia: red brick walls with swallowtail merlons, green tent roofs, painted onion domes
  kremlin(t){
    const brick=pal('#b23a2c'), tentC=pal('#3f7a5a'), white='#efe8dc';
    block(2,20,28,10,brick); for (let x=2;x<30;x+=3){ P(x,19,brick[0]); P(x+1,19,brick[0]); P(x,18,brick[0]); }
    block(1,14,6,16,brick); cone(0,8,13,6,tentC); P(4,6,GOLD);
    block(25,14,6,16,brick); cone(24,8,13,6,tentC); P(28,6,GOLD);
    if (t>=2){
      block(11,11,10,9,pal(white)); onion(13,10,2,pal('#d9443a'),GOLD); onion(19,10,2,pal('#3f8fd0'),GOLD);
      onion(16,8,3,t===3 ? pal(GOLD) : pal('#46a05a'),GOLD,true);
    } else { block(12,14,8,6,pal(white)); onion(16,13,3,pal('#46a05a'),GOLD,true); }
    if (t===3){ onion(10,13,2,pal('#e0a030'),GOLD); onion(22,13,2,pal('#9a4fc0'),GOLD); R(2,24,28,1,'#e8d9b0'); }
    door(14,4,29,6); win(5,22); win(26,22);
    flag(4,0);
  },
  // the Ottomans: a great lead dome with half-domes, slender minarets with crescents
  ottoman(t){
    const stone=pal('#e2ddd0'), lead=pal('#8f99a3');
    block(5,19,22,11,stone); block(9,15,14,4,stone);
    dome(16,14,t===1 ? 6 : 7,t===3 ? pal('#9aa7b2') : lead); R(15,5,2,2,GOLD); P(16,4,GOLD);
    if (t>=2){ dome(8,18,3,lead); dome(24,18,3,lead); }
    const mins = t===1 ? [3] : t===2 ? [2,29] : [1,5,26,30];
    for (const mx of mins){ block(mx,6,2,24,pal('#f1ede4')); R(mx-1,13,4,1,stone[2]); R(mx,3,2,3,lead[0]); P(mx,2,lead[0]); P(mx,1,GOLD); }
    for (const x of [9,13,19,23]) win(x,22,'#9ad0e8');
    door(14,4,29,6,DARK,true);
    if (t===3){ R(5,19,22,1,GOLD); }
    flag(t===1 ? 23 : 21,t===1 ? 13 : 12);
  },
  // the Maghreb: a kasbah of rammed earth, pointed merlons, a square minaret with green tiles
  maghreb(t){
    const earth=pal('#c98a54'), tileG='#2f8a5a';
    block(2,19,28,11,earth); for (let x=2;x<30;x+=3){ P(x+1,18,earth[0]); P(x+1,17,earth[0]); R(x,18,3,1,earth[0]); }
    block(1,15,6,15,earth); block(25,15,6,15,earth); for (const x of [1,25]){ P(x+1,14,earth[0]); P(x+4,14,earth[0]); }
    const mh = t===1 ? 9 : t===2 ? 5 : 2;
    block(13,mh,7,19-mh,pal('#d8a06a')); R(13,mh,7,2,tileG); R(14,mh+4,5,1,tileG); win(16,mh+6,'#3a2a1e',3);
    R(15,mh-2,3,2,t===3 ? GOLD : '#d8a06a'); P(16,mh-3,GOLD);
    if (t===3){ for (let x=3;x<29;x+=4) P(x,22,tileG); R(2,26,28,1,tileG); }
    door(13,6,29,6,'#3a2a1e',true); R(13,23,6,1,tileG);
    flag(3,8);
  },
  // Arabia and the Levant: a mud-brick fort, triangular merlons, tapering round towers
  arab(t){
    const mud=pal('#c7a578'), white=pal('#efe8da');
    block(3,18,26,12,mud); for (let x=3;x<29;x+=3){ P(x+1,17,mud[0]); P(x+1,16,mud[1]); }
    for (const tx of [1,25]){ block(tx,12,6,18,mud); R(tx+1,11,4,1,mud[0]); P(tx+1,10,mud[0]); P(tx+4,10,mud[0]); }
    if (t>=2){ block(11,10,10,8,mud); R(12,9,8,1,mud[1]); win(14,12,'#3a2a1e',3); win(17,12,'#3a2a1e',3); }
    if (t===3){ block(10,10,12,8,white); dome(16,9,5,pal(GOLD)); R(15,3,2,1,GOLDL); R(3,18,26,1,GOLD); }
    R(5,23,1,3,'#3a2a1e'); R(26,23,1,3,'#3a2a1e');
    door(14,4,29,7,'#4a3020');
    flag(26,4);
  },
  // Mesopotamia: a stepped ziggurat of mud brick with a shrine on top
  ziggurat(t){
    const mud=pal('#bf9a64');
    const steps = t===1 ? [[3,24,26,6],[7,19,18,5],[11,15,10,4]] : t===2 ? [[1,25,30,5],[4,20,24,5],[8,15,16,5],[11,11,10,4]] : [[0,26,32,4],[3,22,26,4],[6,18,20,4],[9,14,14,4],[12,10,8,4]];
    for (const [x,y,w,h] of steps){ block(x,y,w,h,mud); R(x,y,w,1,mud[1]); }
    const top=steps[steps.length-1];
    R(14,top[1],4,30-top[1],'#9c7a4c'); for (let y=top[1]+1;y<30;y+=2) R(14,y,4,1,'#b8935e');   // the great stair
    block(13,top[1]-4,6,4,t===3 ? pal('#2f6fd6') : mud); if (t===3) R(13,top[1]-5,6,1,GOLD);
    flag(24,(steps[1][1])-6);
  },
  // Egypt and Nubia: a temple pylon with obelisks; pyramids behind
  egypt(t){
    const sand=pal('#d9b878'), dark='#a07c44';
    if (t>=2){ cone(t===3 ? 2 : 6,t===3 ? 28 : 20,22,t===3 ? 18 : 12,pal('#d2b070')); if (t===3) R(15,4,2,2,GOLD); }
    for (const px of [3,19]){ for (let i=0;i<14;i++) R(px+Math.floor(i/5),16+i,10-2*Math.floor(i/5),1,sand[0]); R(px,16,10,1,sand[1]); for (let y=19;y<29;y+=3) R(px+2,y,6,1,dark); }
    R(13,20,6,10,DARK); R(12,18,8,2,sand[0]);
    for (const ox of [1,30]){ R(ox,12,1,18,sand[0]); P(ox,11,t===3 ? GOLD : sand[1]); }
    if (t===3){ R(3,16,10,1,GOLD); R(19,16,10,1,GOLD); }
    flag(23,9);
  },
  // Persia: an iwan portal faced in blue tiles, a turquoise dome, tiled minarets
  persian(t){
    const brick=pal('#c8a882'), blue=pal('#2a74b8'), turq=pal('#3fb2c0');
    block(4,18,24,12,brick); block(10,12,12,18,brick);
    R(12,14,8,16,blue[0]); R(13,16,6,14,DARK); R(13,15,6,1,turq[0]); P(15,14,turq[1]); P(16,14,turq[1]);
    for (let y=19;y<29;y+=3) R(4,y,6,1,blue[2]); for (let y=19;y<29;y+=3) R(22,y,6,1,blue[2]);
    if (t>=2) dome(16,11,6,t===3 ? pal(GOLD) : turq);
    if (t>=2) for (const mx of [7,24]){ block(mx,7,2,11,blue); R(mx-1,6,4,1,turq[0]); R(mx,4,2,2,turq[1]); }
    if (t===3){ R(15,4,2,1,GOLDL); P(16,3,GOLDL); R(10,12,12,1,GOLD); }
    flag(t>=2 ? 25 : 24,t>=2 ? 0 : 11);
  },
  // the Mughals: a red sandstone fort, then white marble domes and minarets
  mughal(t){
    const red=pal('#b0503a'), marble=pal('#f1ede6'), w=t===3 ? marble : red;
    block(2,20,28,10,red); crenels(2,19,28,red[0]);
    for (const tx of [1,26]){ block(tx,15,5,15,red); dome(tx+2.5,14,2.5,marble); P(tx+2,11,GOLD); }
    if (t>=2){ block(9,13,14,7,w); dome(16,12,5,marble); R(15,5,2,2,GOLD); P(16,4,GOLD); dome(11,12,2,marble); dome(21,12,2,marble); }
    else { block(10,15,12,5,red); dome(16,14,3,marble); P(16,10,GOLD); }
    if (t===3) for (const mx of [7,24]){ block(mx,9,2,11,marble); R(mx-1,8,4,1,marble[2]); dome(mx+1,7,1.5,marble); }
    door(13,6,29,7,DARK,true); R(13,22,6,1,t===3 ? GOLD : '#e8c89a');
    flag(t===3 ? 3 : 4,t===3 ? 4 : 5);
  },
  // the Sahel: a mud mosque with wooden beams jutting out and rounded pinnacles
  sahel(t){
    const mud=pal('#a8703e'), beam='#5a3a20';
    block(2,17,28,13,mud);
    const towers = t===1 ? [14] : t===2 ? [5,14,23] : [2,8,14,20,26];
    for (const tx of towers){ const h=tx===14 ? (t===3 ? 2 : 6) : 10; block(tx,h,5,17-h,mud); cone(tx,5,h,3,mud); P(tx+2,h-3,t===3 ? '#f2eee4' : mud[1]); for (let y=h+3;y<17;y+=4){ P(tx-1,y,beam); P(tx+5,y,beam); } }
    for (let x=3;x<29;x+=3) P(x,21,beam);
    door(14,4,29,6,'#3a2414');
    if (t===3) R(2,17,28,1,GOLD);
    flag(26,t===3 ? 5 : 8);
  },
  // Ethiopia: a Gondar castle of brown stone with domed round towers
  gondar(t){
    const stone=pal('#8a6a4c'), cap=pal('#6e5440');
    block(5,15,22,15,stone); crenels(5,14,22,stone[0]);
    for (const tx of [2,24]){ block(tx,12,6,18,stone); dome(tx+3,11,3,t===3 ? pal(GOLD) : cap); }
    if (t>=2){ block(12,7,8,8,stone); dome(16,6,4,cap); R(15,1,2,1,GOLD); P(16,0,GOLD); }
    for (const x of [9,13,19,23]) win(x,18,'#ffcf6a');
    door(14,4,29,6,'#2a1e14');
    if (t===3) R(5,22,22,1,GOLD);
    flag(t>=2 ? 23 : 13,t>=2 ? 2 : 6);
  },
  // southern Africa: curved granite walls in courses with a chevron frieze, a conical tower, thatched huts
  zimbabwe(t){
    const gran=pal('#9c9284'), thatch=pal('#c9a050'), mud=pal('#a87a50');
    R(2,20,28,10,gran[0]); R(2,20,28,1,gran[1]); for (let y=22;y<30;y+=2) R(2,y,28,1,gran[2]);
    for (let x=3;x<29;x+=2) P(x,21+((x>>1)&1),'#6e665a');
    R(1,21,1,9,gran[1]); R(30,21,1,9,gran[2]);
    const huts = t===1 ? [8] : t===2 ? [5,21] : [3,12,21];
    for (const hx of huts){ block(hx,15,7,5,mud); cone(hx-1,9,14,5,thatch); }
    if (t>=2){ block(15,9,4,11,gran); cone(15,4,8,3,gran); }
    if (t===3){ R(15,8,4,1,GOLD); P(16,5,GOLD); R(2,20,28,1,GOLD); }
    door(14,4,29,6,'#3a2a1e');
    flag(25,t>=2 ? 10 : 12);
  },
  // China, Vietnam, Korea: red walls on a stone base, gate towers under eaved roofs
  chinese(t, n){
    const code=flagCode, roofC = code==='VN' ? pal('#8a4a30') : code==='KR' ? pal('#4c5a68') : pal('#e0b12a');
    const red=pal(code==='KR' ? '#c4483a' : '#b8282a'), base=pal('#9a948a');
    block(1,22,30,8,base); R(13,24,6,6,DARK); R(14,23,4,1,DARK);
    block(4,17,24,5,red); for (let x=6;x<27;x+=3) R(x,17,1,5,'#7a1a1a');
    eave(1,30,17,roofC);
    if (t>=2){ block(8,10,16,4,red); eave(5,22,10,roofC); }
    if (t===3){ block(11,5,10,2,red); eave(9,14,5,roofC); R(15,0,2,2,GOLD); P(10,4,GOLD); P(21,4,GOLD); }
    if (code==='KR') for (let x=3;x<29;x+=4) P(x,16,'#3f9a7a');
    void n;
    flag(t===3 ? 2 : 3,t===3 ? 8 : t===2 ? 6 : 9);
  },
  // Japan: a white keep on a battered stone base, stacked curved roofs, gilded fish at the last
  japanese(t){
    const plaster=pal('#f2efe8'), roof=pal('#4a5560'), stone=pal('#8f8a80');
    for (let i=0;i<7;i++) R(3+Math.floor(i/3),23+i,26-2*Math.floor(i/3),1,i%2 ? stone[0] : stone[2]);
    const floors = t+1;
    let y=23;
    for (let f=0;f<floors;f++){
      const w=22-f*5, x=16-w/2, h=f===0 ? 5 : 4;
      block(x,y-h,w,h,plaster); for (let wx=x+2;wx<x+w-2;wx+=3) win(wx,y-h+1,DARK,2);
      y-=h; eave(x-2,w+4,y,roof); y-=3;
    }
    if (t===3){ P(13,y+1,GOLD); P(18,y+1,GOLD); P(13,y,GOLD); P(18,y,GOLD); }
    flag(27,5);
  },
  // Siam and Burma: tiered red and green roofs with gilded spires; a golden stupa
  siam(t){
    const white=pal('#f0ece2'), red=pal('#b8322a'), green=pal('#2f8a4a'), gold=pal(GOLD);
    if (flagCode==='MM' || t===3){ cone(t===3 ? 18 : 10,12,26,t===3 ? 22 : 18,gold); R(t===3 ? 21 : 13,27,6,3,gold[2]); }
    block(3,20,18,10,white); for (const x of [6,10,14,17]) win(x,23,'#c9a040');
    eave(1,22,20,red); eave(4,16,16,green); if (t>=2) eave(7,10,12,red);
    R(11,t>=2 ? 4 : 8,2,t>=2 ? 5 : 5,GOLD); P(11,t>=2 ? 3 : 7,GOLDL);
    door(10,4,29,5,'#5a2a1a');
    flag(26,t===3 ? 0 : 6);
  },
  // Java: a candi, a stepped stone temple crowned with stupas
  candi(t){
    const stone=pal('#7c7a72');
    const k = t+2;
    for (let i=0;i<k;i++){ const w=30-i*6, x=16-w/2, y=27-i*4; block(x,y,w,4,stone); R(x,y,w,1,stone[1]); for (let sx=x+2;sx<x+w-2;sx+=4){ P(sx,y-1,stone[0]); P(sx,y-2,stone[1]); } }
    const top=27-k*4;
    dome(16,top+1,3,t===3 ? pal(GOLD) : stone); R(15,top-4,2,3,t===3 ? GOLD : stone[1]);
    R(14,24,4,6,DARK);
    flag(26,12);
  },
  // the steppe: white felt gers with painted doors; a great palace ger
  steppe(t, n){
    const felt=pal('#efe9dc'), roofC=t===3 ? pal(GOLD) : pal('#d9d0bc'), trimC=n.roof;
    const gers = t===1 ? [[9,14]] : t===2 ? [[2,9],[14,12],[23,8]] : [[1,8],[10,14],[23,8]];
    for (const [gx,gw] of gers){
      const h=Math.round(gw*0.55); block(gx,30-h,gw,h,felt); R(gx,30-h+2,gw,1,trimC);
      dome(gx+gw/2,30-h,gw/2,roofC); R(gx+gw/2-1,30-h-gw/2-1,2,1,'#6a4a2c');
      R(gx+gw/2-1,26,2,4,'#c03a2a'); P(gx+gw/2-1,26,'#e8c45a');
    }
    if (t===3){ block(26,10,3,20,pal('#efe9dc')); dome(27.5,9,3,pal(GOLD)); }
    flag(t===1 ? 23 : 18,t===1 ? 14 : 2);
  },
  // Mesoamerica: a stepped pyramid with a stair and a temple on top
  meso(t){
    const stone=pal('#a39a86'), temple=pal('#c4483a');
    const k = t+2;
    for (let i=0;i<k;i++){ const w=30-i*5, x=Math.round(16-w/2), y=27-i*4; block(x,y,w,4,stone); R(x,y,w,1,stone[1]); }
    const top=27-k*4;
    R(14,top+2,4,28-top,'#8a826e'); for (let y=top+3;y<30;y+=2) R(14,y,4,1,'#b8ae98');
    block(12,top-3,8,5,temple); R(11,top-4,10,1,temple[2]); R(14,top-1,4,3,DARK);
    if (t===3){ R(11,top-5,10,1,GOLD); R(4,26,24,1,'#2f9a8a'); }
    flag(26,t===3 ? 12 : 16);
  },
  // the Andes: Inca walls of fitted stone, trapezoid doorways, steep thatch
  inca(t){
    const stone=pal('#9a9080'), thatch=pal('#b89a50');
    block(2,19,28,11,stone); for (let y=21;y<30;y+=3) for (let x=2+(y%2)*2;x<30;x+=4) P(x,y,stone[2]);
    for (const dx of [6,22]){ R(dx,22,3,7,DARK); R(dx+1,21,1,1,DARK); }
    const halls = t===1 ? [[9,14]] : t===2 ? [[3,10],[17,12]] : [[2,9],[12,9],[22,9]];
    for (const [hx,hw] of halls){ block(hx,14,hw,5,stone); cone(hx-1,hw+2,13,6,thatch); }
    if (t===3){ R(2,19,28,1,GOLD); dome(16,9,2,pal(GOLD)); }
    door(14,4,29,6,DARK);
    flag(25,t===2 ? 4 : 7);
  },
  // the Spanish and Portuguese colonies: a white cathedral front between two bell towers
  colonial(t){
    const white=pal('#efe8da'), tile=pal('#c0603a'), stone=pal('#d8cdb4');
    block(8,14,16,16,white); cone(7,18,13,5,tile); for (const x of [11,20]) win(x,18);
    door(14,4,29,7,'#4a3020');
    const tw = t===1 ? [3] : [2,25];
    for (const tx of tw){ block(tx,8,6,22,stone); R(tx+2,11,2,3,DARK); dome(tx+3,7,3,t===3 ? pal(GOLD) : tile); P(tx+3,3,GOLD); }
    if (t>=2){ dome(16,8,3,t===3 ? pal(GOLD) : pal('#3f7ac0')); R(15,3,2,2,GOLD); }
    if (t===3) R(8,14,16,1,GOLD);
    flag(t===1 ? 24 : 19,t===1 ? 9 : 14);
  },
  // the United States: a white house; then a Capitol dome on its drum
  capitol(t){
    const white=pal('#f4f1ea');
    block(2,19,28,11,white); for (let x=4;x<29;x+=3) R(x,21,1,8,'#d8d2c4'); R(2,18,28,1,'#d8d2c4');
    for (const x of [6,25]) win(x,23,'#a8c0d8',3);
    if (t===1){ cone(10,12,18,4,white); flag(15,7); }
    else {
      block(10,12,12,6,white); for (let x=11;x<21;x+=2) R(x,13,1,5,'#d8d2c4');
      dome(16,11,t===3 ? 7 : 5,white); R(15,t===3 ? 3 : 5,2,2,white[1]); P(16,t===3 ? 1 : 4,t===3 ? GOLD : white[2]);
      if (t===3) R(10,12,12,1,GOLD);
      flag(26,9);
    }
    door(14,4,29,5,'#3a3a44');
  },
  // the Commonwealth: Gothic sandstone with green copper roofs and a clock tower
  parliament(t){
    const sand=pal('#cdbb90'), cop=pal('#5fa58a');
    block(2,18,28,12,sand); cone(1,30,17,4,cop); for (let x=4;x<29;x+=4) win(x,21,'#ffe7a0',3);
    block(12,t===1 ? 9 : 5,8,22-(t===1 ? 9 : 5),sand); cone(11,10,t===1 ? 8 : 4,5,cop);
    R(14,t===1 ? 12 : 8,4,4,'#f6f0dc'); P(15,t===1 ? 13 : 9,DARK); P(16,t===1 ? 14 : 10,DARK);   // the clock
    if (t>=2){ block(3,13,4,6,sand); cone(2,6,12,4,cop); block(25,13,4,6,sand); cone(24,6,12,4,cop); }
    if (t===3){ R(12,16,8,1,GOLD); P(15,0,GOLD); }
    door(14,4,29,6,'#3a2a1e');
    flag(t>=2 ? 24 : 4,t>=2 ? 2 : 10);
  },
};

/** The traditions drawn here (besides the Western keep). */
export const TRADITIONS = Object.keys(STYLES);

/** Draws country `code`'s capital (not in the Western style) of tier t at (ox,oy) on ctx. */
export function drawCapital(ctx: CanvasRenderingContext2D, ox: number, oy: number, n: NationStyle, code: string, t: number){
  g=ctx; X=ox; Y=oy; flagCode=code;
  R(1,30,30,1,SH);
  (STYLES[cultureOf(code)] ?? STYLES.central)(Math.max(1,Math.min(3,t)),n);
}

/** Battle damage on whatever capital is drawn at (ox,oy): from the top of its outline down,
    knocked-off pixels, cracks and soot; badly damaged, breaches, fires and more rubble. */
export function wearCapital(ctx: CanvasRenderingContext2D, ox: number, oy: number, worn: number, seed: number){
  if (!worn) return;
  g=ctx; X=ox; Y=oy;
  const img=ctx.getImageData(ox,oy,32,32).data, solid=(x: number, y: number) => x>=0 && y>=0 && x<32 && y<32 && img[(y*32+x)*4+3]>0;
  let h=(seed*2654435761)>>>0; const rnd=(k: number) => { h=(Math.imul(h^(h>>>15),2246822519)+k)>>>0; return h%1000/1000; };
  const tops: number[]=[]; for (let x=0;x<32;x++){ let y=0; while (y<30 && !solid(x,y)) y++; tops.push(y); }
  // the outline knocked about
  const knocks=worn===1 ? 9 : 22;
  for (let i=0;i<knocks;i++){ const x=(rnd(i)*32)|0, y=tops[x]; if (y>=29) continue; const d=worn===1 ? 1 : 1+((rnd(i+7)*3)|0); g.clearRect(X+x,Y+y,1,d); }
  // cracks wandering down the walls
  const cracks=worn===1 ? 3 : 7;
  for (let i=0;i<cracks;i++){
    let x=2+((rnd(i+31)*28)|0), y=tops[x]+2+((rnd(i+41)*6)|0);
    for (let k=0;k<(worn===1 ? 4 : 7) && y<29;k++){ if (solid(x,y)) P(x,y,'#4a4038'); y++; x+=rnd(k+i)<0.5 ? -1 : 1; }
  }
  // soot, and rubble at the foot
  for (let i=0;i<(worn===1 ? 2 : 5);i++){ const x=2+((rnd(i+61)*27)|0), y=Math.min(27,tops[x]+3+((rnd(i+71)*8)|0)); if (solid(x,y)){ g.fillStyle='rgba(30,24,20,.45)'; g.fillRect(X+x,Y+y,3,2); } }
  for (let i=0;i<(worn===1 ? 4 : 10);i++){ const x=1+((rnd(i+81)*29)|0); P(x,29+(i&1),'#8d867b'); P(x+1,29+(i&1),'#6f695f'); }
  if (worn<2) return;
  // breaches and fires
  for (let i=0;i<3;i++){ const x=4+((rnd(i+91)*22)|0), y=Math.min(26,tops[x]+5+((rnd(i+95)*5)|0)); if (solid(x,y) && solid(x+2,y+2)){ R(x,y,3,3,'#3a2e26'); R(x,y+2,3,1,'#241b16'); } }
  for (let i=0;i<4;i++){ const x=3+((rnd(i+101)*26)|0), y=tops[x]+1; if (y<28 && solid(x,y+1)){ P(x,y,'#ff9a3c'); P(x,y-1,'#ffd27a'); P(x+1,y,'#e0602a'); P(x,y-2,'#fff0a0'); } }
}
