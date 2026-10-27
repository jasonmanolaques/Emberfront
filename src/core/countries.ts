/* ---------- countries: the kingdoms are real countries, each with its flag and capital ----------
   A flag is painted on a 12×8 grid of pixels by a few strokes (stripes, a cross, a disc...);
   its kingdom colour is taken from the flag. The capital (latitude, longitude) is where the
   kingdom is founded on the real-world maps (sim/realmap.ts). */

export const FLAG_W = 12, FLAG_H = 8;

/** A flag being painted: 12×8 colours, row by row. */
export class FlagGrid {
  px: string[] = new Array(FLAG_W*FLAG_H).fill('#ffffff');
  set(c: string, x: number, y: number){ if (x>=0 && y>=0 && x<FLAG_W && y<FLAG_H) this.px[y*FLAG_W+x]=c; }
  rect(c: string, x: number, y: number, w: number, h: number){ for (let j=y;j<y+h;j++) for (let i=x;i<x+w;i++) this.set(c,i,j); }
  fill(c: string){ this.rect(c,0,0,FLAG_W,FLAG_H); return this; }
  /** Horizontal stripes, top to bottom (with weights, unequal ones). */
  h(cols: string[], w: number[]=cols.map(() => 1)){ const W=w.reduce((a,b) => a+b,0); let acc=0;
    cols.forEach((c,i) => { const y0=Math.round(acc/W*FLAG_H); acc+=w[i]; this.rect(c,0,y0,FLAG_W,Math.round(acc/W*FLAG_H)-y0); }); return this; }
  /** Vertical stripes, hoist to fly. */
  v(cols: string[], w: number[]=cols.map(() => 1)){ const W=w.reduce((a,b) => a+b,0); let acc=0;
    cols.forEach((c,i) => { const x0=Math.round(acc/W*FLAG_W); acc+=w[i]; this.rect(c,x0,0,Math.round(acc/W*FLAG_W)-x0,FLAG_H); }); return this; }
  /** A Scandinavian cross (with a narrower one of another colour inside). */
  nordic(bg: string, cross: string, inner?: string){
    this.fill(bg); this.rect(cross,3,0,3,FLAG_H); this.rect(cross,0,2,FLAG_W,3);
    if (inner){ this.rect(inner,4,0,1,FLAG_H); this.rect(inner,0,3,FLAG_W,1); }
    return this;
  }
  disc(c: string, cx: number, cy: number, r: number){ for (let y=0;y<FLAG_H;y++) for (let x=0;x<FLAG_W;x++) if ((x+0.5-cx)**2+(y+0.5-cy)**2<=r*r) this.set(c,x,y); return this; }
  /** A triangle from the hoist, reaching `w` pixels in. */
  tri(c: string, w: number){ for (let y=0;y<FLAG_H;y++){ const d=Math.min(y+0.5,FLAG_H-y-0.5)/(FLAG_H/2); this.rect(c,0,y,Math.round(w*d),1); } return this; }
  /** A centred cross (the Swiss kind). */
  plus(c: string, cx=6, cy=4, a=2){ this.rect(c,cx-1,cy-a,2,a*2); this.rect(c,cx-a,cy-1,a*2,2); return this; }
  /** A diagonal cross, corner to corner. */
  saltire(c: string){ for (let x=0;x<FLAG_W;x++){ const y=Math.floor(x*FLAG_H/FLAG_W); this.set(c,x,y); this.set(c,x,FLAG_H-1-y); } return this; }
  /** A small star: a dot with arms. */
  star(c: string, x: number, y: number, big=false){ this.set(c,x,y); if (big){ this.set(c,x+1,y); this.set(c,x,y+1); this.set(c,x+1,y+1); } return this; }
  /** The crescent and star of the Turkish kind, centred at (cx,cy). */
  crescent(c: string, bg: string, cx: number, cy: number, star=true){
    this.disc(c,cx,cy,2.4); this.disc(bg,cx+0.9,cy,1.9);
    if (star){ this.set(c,cx+2,cy-1); this.set(c,cx+2,cy); this.set(c,cx+3,cy-1); this.set(c,cx+3,cy); }
    return this;
  }
  /** The Union Jack, in a canton w×h (the whole flag by default). */
  union(w=FLAG_W, h=FLAG_H){
    const B='#012169', Wt='#ffffff', R='#c8102e';
    this.rect(B,0,0,w,h);
    for (let x=0;x<w;x++){ const y=Math.floor(x*h/w); this.set(Wt,x,y); this.set(Wt,x,h-1-y); }
    for (let x=0;x<w;x+=2){ const y=Math.floor(x*h/w); this.set(R,x,y); this.set(R,x,h-1-y); }
    const cx=Math.floor(w/2), cy=Math.floor(h/2);
    this.rect(Wt,cx-2,0,4,h); this.rect(Wt,0,cy-2,w,4);
    this.rect(R,cx-1,0,2,h); this.rect(R,0,cy-1,w,2);
    return this;
  }
}

export interface Country {
  code: string; name: string;
  hex: string;                        // the kingdom's colour, from its flag
  cap: [number, number];              // its capital: latitude, longitude
  flag: (g: FlagGrid) => void;
}

const R='#d52b1e', Wh='#ffffff', B='#0039a6', G='#009246', Y='#fcd116', K='#1a1a1a', N='#012169';
const c = (code: string, name: string, hex: string, lat: number, lon: number, flag: (g: FlagGrid) => void): Country => ({ code, name, hex, cap:[lat,lon], flag });

export const COUNTRIES: Country[] = [
  // the Balkans, Anatolia and their neighbours
  c('TR','Turkey','#e0262e',39.93,32.86, g => g.fill('#e30a17').crescent(Wh,'#e30a17',4,4)),
  c('GR','Greece','#3d8ee0',37.98,23.73, g => { for (let y=0;y<8;y++) g.rect(y%2 ? Wh : '#0d5eaf',0,y,12,1); g.rect('#0d5eaf',0,0,5,5); g.rect(Wh,2,0,1,5); g.rect(Wh,0,2,5,1); }),
  c('BG','Bulgaria','#1f9d6b',42.70,23.32, g => g.h([Wh,'#00966e','#d62612'])),
  c('RS','Serbia','#2f4fa0',44.82,20.46, g => { g.h(['#c6363c','#0c4076',Wh]); g.rect('#c6363c',2,2,3,4); g.rect(Wh,3,3,1,2); g.set('#e6b422',3,2); }),
  c('RO','Romania','#f2c81f',44.43,26.10, g => g.v(['#002b7f','#fcd116','#ce1126'])),
  c('HU','Hungary','#3f8a45',47.50,19.04, g => g.h(['#ce2939',Wh,'#477050'])),
  c('HR','Croatia','#2f55b8',45.81,15.98, g => { g.h(['#ff0000',Wh,'#171796']); for (let y=2;y<6;y++) for (let x=5;x<7;x++) g.set((x+y)%2 ? Wh : '#ff0000',x,y); }),
  c('SI','Slovenia','#4f9be0',46.05,14.51, g => { g.h([Wh,'#005ce5','#ed1c24']); g.rect('#005ce5',2,1,3,4); g.set(Wh,3,3); g.set('#ed1c24',2,4); g.set('#ed1c24',4,4); g.set('#fcd116',3,1); }),
  c('BA','Bosnia and Herzegovina','#2b4fbf',43.86,18.41, g => { g.fill('#002395'); for (let y=0;y<8;y++){ const x0=3+Math.round(y*0.75); g.rect('#fecb00',x0,y,10-x0,1); if (y%2===0) g.set(Wh,x0-1,y); } }),
  c('ME','Montenegro','#d4a12a',42.44,19.26, g => { g.fill('#d4af37'); g.rect('#c40308',1,1,10,6); g.rect('#d4af37',5,2,2,4); g.set('#d4af37',4,2); g.set('#d4af37',7,2); }),
  c('AL','Albania','#b0182a',41.33,19.82, g => { g.fill('#e41e20'); g.rect(K,5,1,2,6); g.rect(K,3,2,6,2); g.set(K,2,1); g.set(K,9,1); g.set(K,4,6); g.set(K,7,6); }),
  c('MK','North Macedonia','#f0a81a',42.00,21.43, g => { g.fill('#d20000'); g.saltire('#ffe600'); g.rect('#ffe600',5,0,2,8); g.rect('#ffe600',0,3,12,2); g.disc('#ffe600',6,4,2); }),
  c('XK','Kosovo','#3a64c8',42.67,21.17, g => { g.fill('#244aa5'); g.rect('#d0a650',4,3,4,3); g.set('#d0a650',8,4); for (let k=0;k<6;k++) g.set(Wh,3+k,1); }),
  c('MD','Moldova','#3a6cc9',47.01,28.86, g => { g.v(['#0046ae','#ffd200','#cc092f']); g.rect('#8a5a2b',5,3,2,2); }),
  c('AT','Austria','#e04848',48.21,16.37, g => g.h(['#ed2939',Wh,'#ed2939'])),
  c('SK','Slovakia','#3a63c4',48.15,17.11, g => { g.h([Wh,'#0b4ea2','#ee1c25']); g.rect('#ee1c25',2,2,3,4); g.rect(Wh,3,2,1,3); g.rect(Wh,2,3,3,1); g.rect('#0b4ea2',2,5,3,1); }),
  c('IT','Italy','#2a9a4a',41.90,12.50, g => g.v(['#009246',Wh,'#ce2b37'])),
  c('GE','Georgia','#ece6dc',41.72,44.79, g => { g.fill(Wh); g.rect('#ff0000',5,0,2,8); g.rect('#ff0000',0,3,12,2); for (const [x,y] of [[2,1],[9,1],[2,6],[9,6]]) g.plus('#ff0000',x,y,1); }),
  c('AM','Armenia','#f08a2c',40.18,44.51, g => g.h(['#d90012','#0033a0','#f2a800'])),
  c('SY','Syria','#3c3c44',33.51,36.29, g => { g.h(['#ce1126',Wh,K]); g.set('#007a3d',4,3); g.set('#007a3d',7,3); }),
  c('LB','Lebanon','#2d9a4e',33.89,35.50, g => { g.h(['#ed1c24',Wh,'#ed1c24'],[1,2,1]); g.rect('#00a651',5,2,2,4); g.rect('#00a651',4,3,4,2); }),
  c('CY','Cyprus','#d6823a',35.17,33.36, g => { g.fill(Wh); g.rect('#d57800',3,2,6,2); g.rect('#d57800',2,3,3,1); g.set('#4e5b31',4,6); g.set('#4e5b31',7,6); g.set('#4e5b31',5,5); g.set('#4e5b31',6,5); }),
  c('IQ','Iraq','#4c9a40',33.31,44.37, g => { g.h(['#ce1126',Wh,K]); g.rect('#007a3d',3,3,6,1); g.set('#007a3d',4,4); g.set('#007a3d',8,4); }),
  c('UA','Ukraine','#2e6fd1',50.45,30.52, g => g.h(['#0057b7','#ffd700'])),
  c('AZ','Azerbaijan','#22a6c9',40.41,49.87, g => { g.h(['#0092bc','#e4002b','#00af66']); g.crescent(Wh,'#e4002b',5,4,true); }),
  // the rest of Europe
  c('PT','Portugal','#1f7a3a',38.72,-9.14, g => { g.v(['#006600','#ff0000'],[2,3]); g.disc('#ffe900',5,4,2); g.disc('#ff0000',5,4,1.2); g.set(Wh,5,4); }),
  c('ES','Spain','#e8b51a',40.42,-3.70, g => { g.h(['#aa151b','#f1bf00','#aa151b'],[1,2,1]); g.rect('#aa151b',3,3,1,2); g.set('#ad8a00',2,3); g.set('#ad8a00',4,3); }),
  c('FR','France','#2f5fc0',48.86,2.35, g => g.v(['#002395',Wh,'#ed2939'])),
  c('GB','United Kingdom','#24408f',51.51,-0.13, g => g.union()),
  c('IE','Ireland','#2aa65e',53.35,-6.26, g => g.v(['#169b62',Wh,'#ff883e'])),
  c('BE','Belgium','#3a3a3e',50.85,4.35, g => g.v([K,'#fae042','#ed2939'])),
  c('NL','Netherlands','#c0392b',52.37,4.90, g => g.h(['#ae1c28',Wh,'#21468b'])),
  c('LU','Luxembourg','#33a8dd',49.61,6.13, g => g.h(['#ed2939',Wh,'#00a1de'])),
  c('DE','Germany','#d4302c',52.52,13.40, g => g.h([K,'#dd0000','#ffce00'])),
  c('DK','Denmark','#c8102e',55.68,12.57, g => g.nordic('#c8102e',Wh)),
  c('NO','Norway','#b3243a',59.91,10.75, g => g.nordic('#ba0c2f',Wh,'#00205b')),
  c('SE','Sweden','#2a72b5',59.33,18.07, g => g.nordic('#006aa7','#fecc00')),
  c('FI','Finland','#2c5ba8',60.17,24.94, g => g.nordic(Wh,'#003580')),
  c('IS','Iceland','#2e5fb5',64.15,-21.94, g => g.nordic('#02529c',Wh,'#dc1e35')),
  c('EE','Estonia','#2d82d4',59.44,24.75, g => g.h(['#0072ce',K,Wh])),
  c('LV','Latvia','#9e3039',56.95,24.11, g => g.h(['#9e3039',Wh,'#9e3039'],[2,1,2])),
  c('LT','Lithuania','#e3a818',54.69,25.28, g => g.h(['#fdb913','#006a44','#c1272d'])),
  c('PL','Poland','#dc3c4c',52.23,21.01, g => g.h([Wh,'#dc143c'])),
  c('CZ','Czechia','#2d55a0',50.08,14.44, g => { g.h([Wh,'#d7141a']); g.tri('#11457e',6); }),
  c('CH','Switzerland','#d8382a',46.95,7.45, g => { g.fill('#d52b1e'); g.plus(Wh); }),
  c('BY','Belarus','#c8313e',53.90,27.57, g => { g.h(['#c8313e','#4aa657'],[2,1]); g.rect(Wh,0,0,2,8); for (let y=0;y<8;y+=2) g.set('#c8313e',1,y); }),
  c('RU','Russia','#4a6cc4',55.76,37.62, g => g.h([Wh,'#0039a6','#d52b1e'])),
  c('DZ','Algeria','#1f7d45',36.75,3.06, g => { g.v(['#006233',Wh]); g.crescent('#d21034',Wh,6,4); }),
  c('TN','Tunisia','#d7262f',36.81,10.18, g => { g.fill('#e70013'); g.disc(Wh,6,4,2.8); g.crescent('#e70013',Wh,6,4); }),
  c('MA','Morocco','#b0242d',34.02,-6.84, g => { g.fill('#c1272d'); g.rect('#006233',5,2,2,4); g.rect('#006233',4,3,4,1); g.set('#006233',4,5); g.set('#006233',7,5); }),
  c('MT','Malta','#e9e3d8',35.90,14.51, g => { g.v([Wh,'#cf142b']); g.set('#a7a7a7',1,1); }),
  // the world
  c('US','United States','#b23a48',38.90,-77.04, g => { for (let y=0;y<8;y++) g.rect(y%2 ? Wh : '#b22234',0,y,12,1); g.rect('#3c3b6e',0,0,5,4); for (let y=0;y<4;y++) for (let x=y%2;x<5;x+=2) g.set(Wh,x,y); }),
  c('CA','Canada','#d23434',45.42,-75.70, g => { g.v(['#d52b1e',Wh,'#d52b1e'],[1,2,1]); g.rect('#d52b1e',5,2,2,4); g.rect('#d52b1e',4,3,4,1); g.set('#d52b1e',4,2); g.set('#d52b1e',7,2); }),
  c('MX','Mexico','#1f8a4f',19.43,-99.13, g => { g.v(['#006847',Wh,'#ce1126']); g.rect('#8c5a2b',5,3,2,2); g.set('#006847',5,5); g.set('#006847',6,5); }),
  c('BR','Brazil','#2ea24a',-15.79,-47.88, g => { g.fill('#009c3b'); for (let y=0;y<8;y++){ const w=Math.round((1-Math.abs(y+0.5-4)/4)*10); g.rect('#ffdf00',6-w/2|0,y,w,1); } g.disc('#002776',6,4,2); }),
  c('AR','Argentina','#6fa8dc',-34.60,-58.38, g => { g.h(['#74acdf',Wh,'#74acdf']); g.disc('#f6b40e',6,4,1.2); }),
  c('CO','Colombia','#f0c419',4.71,-74.07, g => g.h(['#fcd116','#003893','#ce1126'],[2,1,1])),
  c('PE','Peru','#d22030',-12.05,-77.04, g => g.v(['#d91023',Wh,'#d91023'])),
  c('CL','Chile','#2b50a8',-33.45,-70.67, g => { g.h([Wh,'#d52b1e']); g.rect('#0039a6',0,0,4,4); g.set(Wh,2,2); }),
  c('VE','Venezuela','#f4c51a',10.48,-66.90, g => { g.h(['#ffcc00','#00247d','#cf142b']); for (const x of [3,4,5,6,7,8]) g.set(Wh,x,x===3||x===8 ? 4 : 3); }),
  c('CU','Cuba','#2c58b0',23.11,-82.37, g => { for (let y=0;y<8;y++) g.rect(Math.floor(y/1.6)%2 ? Wh : '#002a8f',0,y,12,1); g.tri('#cf142b',5); g.set(Wh,1,3); g.set(Wh,1,4); }),
  c('NG','Nigeria','#1e8a52',9.08,7.40, g => g.v(['#008751',Wh,'#008751'])),
  c('ET','Ethiopia','#3a9440',9.03,38.74, g => { g.h(['#078930','#fcdd09','#da121a']); g.disc('#0f47af',6,4,1.8); g.set('#fcdd09',6,4); }),
  c('ZA','South Africa','#1a8a5a',-25.75,28.19, g => { g.h(['#e03c31','#001489']); for (const [x,y] of [[0,0],[1,1],[2,2],[0,7],[1,6],[2,5],[0,1],[1,2],[0,6],[1,5]]) g.set('#007749',x,y); g.rect('#007749',2,3,10,2); g.tri('#ffb612',4); g.tri(K,3); }),
  c('KE','Kenya','#a52a2a',-1.29,36.82, g => { g.h([K,Wh,'#bb0000',Wh,'#006600'],[3,1,4,1,3]); g.rect('#bb0000',5,1,2,6); g.rect(K,5,3,2,2); }),
  c('CD','DR Congo','#2a8ff0',-4.32,15.31, g => { g.fill('#007fff'); for (let x=0;x<12;x++){ const y=7-Math.floor(x*8/12); g.set('#f7d618',x,y-1); g.set('#ce1021',x,y); g.set('#f7d618',x,y+1); } g.set('#f7d618',1,1); g.set('#f7d618',2,1); }),
  c('EG','Egypt','#c9a23a',30.04,31.24, g => { g.h(['#ce1126',Wh,K]); g.rect('#c09300',5,3,2,2); }),
  c('SA','Saudi Arabia','#1f7f42',24.71,46.68, g => { g.fill('#006c35'); g.rect(Wh,2,2,8,2); g.rect(Wh,3,5,6,1); }),
  c('IR','Iran','#2aa046',35.69,51.39, g => { g.h(['#239f40',Wh,'#da0000']); g.rect('#da0000',5,3,2,2); }),
  c('PK','Pakistan','#1d6b3a',33.69,73.06, g => { g.v([Wh,'#01411c'],[1,3]); g.crescent(Wh,'#01411c',7,4); }),
  c('IN','India','#ff9933',28.61,77.21, g => { g.h(['#ff9933',Wh,'#138808']); g.disc('#000080',6,4,1.2); g.set(Wh,6,4); }),
  c('CN','China','#de2910',39.90,116.41, g => { g.fill('#de2910'); g.star('#ffde00',2,2,true); g.set('#ffde00',5,1); g.set('#ffde00',6,2); g.set('#ffde00',6,4); g.set('#ffde00',5,5); }),
  c('MN','Mongolia','#c4272f',47.92,106.92, g => { g.v(['#c4272f','#015197','#c4272f']); g.rect('#f9cf02',1,2,2,4); g.set('#f9cf02',1,1); }),
  c('JP','Japan','#f2ece2',35.68,139.69, g => g.fill(Wh).disc('#bc002d',6,4,2.4)),
  c('KR','South Korea','#cd2e3a',37.57,126.98, g => { g.fill(Wh); g.disc('#cd2e3a',6,4,2.2); g.rect('#0047a0',4,4,5,2); g.set('#0047a0',5,6); g.set(K,1,1); g.set(K,10,1); g.set(K,1,6); g.set(K,10,6); g.set(K,2,1); g.set(K,9,6); }),
  c('ID','Indonesia','#d22a2a',-6.21,106.85, g => g.h(['#ce1126',Wh])),
  c('PH','Philippines','#2c4fb0',14.60,120.98, g => { g.h(['#0038a8','#ce1126']); g.tri(Wh,6); g.disc('#fcd116',2,4,1); }),
  c('VN','Vietnam','#da3a2a',21.03,105.85, g => { g.fill('#da251d'); g.rect('#ffff00',5,3,2,2); g.set('#ffff00',6,2); g.set('#ffff00',4,4); g.set('#ffff00',7,4); g.set('#ffff00',5,5); g.set('#ffff00',6,5); }),
  c('TH','Thailand','#2d3a8c',13.76,100.50, g => g.h(['#a51931',Wh,'#2d2a4a',Wh,'#a51931'],[1,1,2,1,1])),
  c('KZ','Kazakhstan','#1fb2c8',51.17,71.45, g => { g.fill('#00afca'); g.disc('#fec50c',6,3.5,1.6); g.rect('#fec50c',0,0,1,8); }),
  c('AU','Australia','#22409a',-35.28,149.13, g => { g.fill('#012169'); g.union(6,4); g.set(Wh,2,6); g.set(Wh,9,1); g.set(Wh,10,4); g.set(Wh,8,3); g.set(Wh,9,6); }),
  c('AF','Afghanistan','#2b2b2b',34.53,69.17, g => g.v([K,'#be0000','#009900'])),
  c('MM','Myanmar','#f0c61e',19.76,96.08, g => { g.h(['#fecb00','#34b233','#ea2839']); g.disc(Wh,6,4,1.6); }),
  c('NZ','New Zealand','#1f3a85',-41.29,174.78, g => { g.fill('#012169'); g.union(6,4); for (const [x,y] of [[9,2],[8,4],[10,4],[9,6]]) g.set('#c8102e',x,y); }),
  c('SD','Sudan','#c03a3a',15.50,32.56, g => { g.h(['#d21034',Wh,K]); g.tri('#007229',5); }),
  c('AO','Angola','#c41e30',-8.84,13.23, g => { g.h(['#cc092f',K]); g.rect('#ffcb00',5,3,2,2); }),
  c('ML','Mali','#14b53a',12.64,-8.00, g => g.v(['#14b53a','#fcd116','#ce1126'])),
  c('BO','Bolivia','#d8a51a',-16.49,-68.12, g => g.h(['#d52b1e','#f9e300','#007934'])),
];

export const countryByCode = new Map(COUNTRIES.map(c => [c.code, c]));
/** The great powers and the biggest countries of each continent: on the world map, bots are these first. */
export const MAJOR = new Set(['US','CA','MX','BR','AR','CO','PE','CL','VE','GB','FR','ES','DE','IT','PL','SE','RU','UA','TR','EG','NG','ET','ZA','KE','CD','DZ','SA','IR','PK','IN','CN','MN','JP','KR','ID','AU','VN','TH','KZ','AF','SD','AO']);
const flagCache = new Map<string, string[]>();
/** The 12×8 pixels of a country's flag (colours, row by row). */
export function flagPixels(code: string): string[] {
  let p=flagCache.get(code);
  if (!p){ const g=new FlagGrid(), k=countryByCode.get(code); if (k) k.flag(g); p=g.px; flagCache.set(code,p); }
  return p;
}
/** The flag at half size, 6×4: each pixel the commonest of the 2×2 it stands for (top-left on a tie). */
export function flagSmall(code: string): string[] {
  const p=flagPixels(code), out: string[]=[];
  for (let y=0;y<4;y++) for (let x=0;x<6;x++){
    const q=[p[(2*y)*12+2*x], p[(2*y)*12+2*x+1], p[(2*y+1)*12+2*x], p[(2*y+1)*12+2*x+1]];
    let best=q[0], bc=0; for (const v of q){ const k=q.filter(u => u===v).length; if (k>bc){ bc=k; best=v; } }
    out.push(best);
  }
  return out;
}

/** How far apart two colours look (0 the same, about 1.7 black to white). */
export function colourGap(a: string, b: string){
  const p=(h: string, i: number) => parseInt(h.slice(1+i*2,3+i*2),16)/255;
  const dr=p(a,0)-p(b,0), dg=p(a,1)-p(b,1), db=p(a,2)-p(b,2), rm=(p(a,0)+p(b,0))/2;
  return Math.sqrt((2+rm)*dr*dr+4*dg*dg+(3-rm)*db*db)/1.73;
}
