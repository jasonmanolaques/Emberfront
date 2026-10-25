/* ---------- effects: conquest flashes, fire & smoke, villagers, sea glints, floating numbers ----------
   Cosmetic only. These use Math.random freely because they never feed back into the simulation. */
import { TW, NT, PW, PH, B_HOUSE } from '../core/constants';
import { W, owner, isLand, pType, pOwner, pBurn, pVar } from '../sim/state';
import { CHIMNEY } from './sprites';

const SKIN = ['#f1c9a5','#d9a679','#a8744f','#7a5236'];

export const FL=4096;
export const flT=new Int32Array(FL), flO=new Uint8Array(FL), flTime=new Float64Array(FL); let flHead=0;
export function addFlash(t: number, o: number){ flT[flHead]=t; flO[flHead]=o; flTime[flHead]=performance.now(); flHead=(flHead+1)&(FL-1); }

const MAXP=2600;
export const ppx=new Float32Array(MAXP), ppy=new Float32Array(MAXP), plife=new Float32Array(MAXP), pmax=new Float32Array(MAXP), pkind=new Uint8Array(MAXP);
const pvx=new Float32Array(MAXP), pvy=new Float32Array(MAXP);
export const fx = { pcount: 0 };
function emit(x: number, y: number, vx: number, vy: number, life: number, kind: number){ if (fx.pcount>=MAXP) return; const i=fx.pcount++; ppx[i]=x; ppy[i]=y; pvx[i]=vx; pvy[i]=vy; plife[i]=life; pmax[i]=life; pkind[i]=kind; }
function emitFire(ox: number, oy: number){ emit(ox+1+Math.random()*6, oy+2+Math.random()*5, (Math.random()-0.5)*2, -(5+Math.random()*7), 0.35+Math.random()*0.5, 0); }
function emitSmoke(x: number, y: number, kind: number){ emit(x,y, 0.8+Math.random()*1.2, -(2.5+Math.random()*2), kind===1?1.6+Math.random()*1.4:1.1+Math.random()*1.2, kind); }
export function fireBurst(q: number){ const ox=(q%PW)*8, oy=((q/PW)|0)*8; for (let i=0;i<10;i++) emitFire(ox,oy); }

/* villagers */
export interface Villager { x: number; y: number; tx: number; ty: number; o: number; w: number; sp: number; skin: string; }
export const vill: Villager[]=[];
const vcount=new Int32Array(256);   // villagers alive per nation
function pickTarget(v: Villager){
  const n=W.nations[v.o]; let bx=v.x, by=v.y, bd=1e9;
  for (let k=0;k<6;k++){ if (!n.blds.length) break; const q=n.blds[(Math.random()*n.blds.length)|0];
    const x=(q%PW)*8+4, y=((q/PW)|0)*8+7, d=Math.abs(x-v.x)+Math.abs(y-v.y);
    if (d>4 && d<60 && d<bd){ bd=d; bx=x; by=y; } }
  v.tx=bx+(Math.random()*4-2); v.ty=by+(Math.random()*2-1);
}
function updateVillagers(dt: number){
  const N=W.nations;
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive || !n.blds.length) continue;
    const want=Math.min(40,(n.houses*0.5)|0);
    if (vcount[i]<want && Math.random()<dt*3){
      const q=n.blds[(Math.random()*n.blds.length)|0];
      if (pType[q]===B_HOUSE && pOwner[q]===n.id && pBurn[q]<=0){
        const x=(q%PW)*8+4, y=((q/PW)|0)*8+7;
        const v: Villager={x,y,tx:x,ty:y,o:n.id,w:Math.random()*2,sp:3+Math.random()*3,skin:SKIN[(Math.random()*4)|0]};
        pickTarget(v); vill.push(v); vcount[i]++;
      }
    }
  }
  for (let i=vill.length-1;i>=0;i--){
    const v=vill[i], t=((v.y/2)|0)*TW+((v.x/2)|0);
    if (owner[t]!==v.o || !N[v.o].alive){ vcount[v.o]--; vill[i]=vill[vill.length-1]; vill.pop(); continue; }
    if (v.w>0){ v.w-=dt; continue; }
    const dx=v.tx-v.x, dy=v.ty-v.y, d=Math.hypot(dx,dy);
    if (d<0.6){ v.w=0.5+Math.random()*2.5; pickTarget(v); continue; }
    const st=Math.min(d,v.sp*dt); v.x+=dx/d*st; v.y+=dy/d*st;
  }
}

/** Advances particles and villagers; spawns fire, smoke and chimney puffs for what's on screen. */
export function updateEffects(dt: number, vx0: number, vy0: number, vx1: number, vy1: number, zc: number){
  for (const q of W.burning){
    const ox=(q%PW)*8, oy=((q/PW)|0)*8;
    if (ox<vx0-16||oy<vy0-16||ox>vx1+8||oy>vy1+8) continue;
    let k=26*dt; while (k>=1){ emitFire(ox,oy); k--; } if (Math.random()<k) emitFire(ox,oy);
    if (Math.random()<5*dt) emitSmoke(ox+2+Math.random()*4, oy+1, 1);
  }
  if (zc>=2){
    const qx0=Math.max(0,Math.floor(vx0/8)), qy0=Math.max(0,Math.floor(vy0/8)), qx1=Math.min(PW-1,Math.floor(vx1/8)), qy1=Math.min(PH-1,Math.floor(vy1/8));
    for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
      const q=y*PW+x; if (pType[q]!==B_HOUSE || pBurn[q]>0) continue;
      if (Math.random()<0.35*dt){ const c=CHIMNEY[pVar[q]%3]; emitSmoke(x*8+c[0]+0.5, y*8+c[1], 2); }
    }
  }
  for (let i=fx.pcount-1;i>=0;i--){
    plife[i]-=dt;
    if (plife[i]<=0){ const j=--fx.pcount; ppx[i]=ppx[j]; ppy[i]=ppy[j]; pvx[i]=pvx[j]; pvy[i]=pvy[j]; plife[i]=plife[j]; pmax[i]=pmax[j]; pkind[i]=pkind[j]; continue; }
    ppx[i]+=pvx[i]*dt; ppy[i]+=pvy[i]*dt; if (pkind[i]) pvx[i]+=0.4*dt;
  }
  updateVillagers(dt);
}

/* floating "−troops" numbers after an attack order */
export interface Float { x: number; y: number; text: string; t0: number; c: string; }
export const floats: Float[]=[];

/* sea glints */
export const glints = { x: new Float32Array(0), y: new Float32Array(0), ph: new Float32Array(0) };
function initGlints(){
  const sx: number[]=[], sy: number[]=[], sp: number[]=[];
  for (let i=0;i<1400 && sx.length<900;i++){ const t=(Math.random()*NT)|0; if (isLand[t]) continue; sx.push((t%TW)*2+(i&1)); sy.push(((t/TW)|0)*2+((i>>1)&1)); sp.push(Math.random()*6.28); }
  glints.x=Float32Array.from(sx); glints.y=Float32Array.from(sy); glints.ph=Float32Array.from(sp);
}

export function resetEffects(){
  vill.length=0; vcount.fill(0); fx.pcount=0; floats.length=0; flTime.fill(0);
  initGlints();
}
