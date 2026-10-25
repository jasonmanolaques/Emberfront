/* ---------- effects: conquest flashes, fire & smoke, sea glints, floating numbers ----------
   Cosmetic only. These use Math.random freely because they never feed back into the simulation.
   Particles live in render pixels; shots, hits and floats keep the simulation's pixels they came in. */
import { TW, NT, PW, PH, PS, RS, K, B_HOUSE } from '../core/constants';
import { W, isLand, pType, pBurn, pVar, pAband } from '../sim/state';
import { CHIMNEY } from './sprites';

export const FL=4096;
export const flT=new Int32Array(FL), flO=new Uint8Array(FL), flTime=new Float64Array(FL); let flHead=0;
export function addFlash(t: number, o: number){ flT[flHead]=t; flO[flHead]=o; flTime[flHead]=performance.now(); flHead=(flHead+1)&(FL-1); }

const MAXP=5000;
export const ppx=new Float32Array(MAXP), ppy=new Float32Array(MAXP), plife=new Float32Array(MAXP), pmax=new Float32Array(MAXP), pkind=new Uint8Array(MAXP), psize=new Uint8Array(MAXP);
const pvx=new Float32Array(MAXP), pvy=new Float32Array(MAXP);
export const fx = { pcount: 0 };
function emit(x: number, y: number, vx: number, vy: number, life: number, kind: number, size=1){ if (fx.pcount>=MAXP) return; const i=fx.pcount++; ppx[i]=x; ppy[i]=y; pvx[i]=vx; pvy[i]=vy; plife[i]=life; pmax[i]=life; pkind[i]=kind; psize[i]=size; }
function emitFire(ox: number, oy: number){ emit(ox+2+Math.random()*12, oy+4+Math.random()*10, (Math.random()-0.5)*4, -(10+Math.random()*14), 0.35+Math.random()*0.5, 0, Math.random()<0.35 ? 2 : 1); }
function emitSmoke(x: number, y: number, kind: number){ emit(x,y, 1.6+Math.random()*2.4, -(5+Math.random()*4), kind===1?1.6+Math.random()*1.4:1.1+Math.random()*1.2, kind, kind===1 && Math.random()<0.5 ? 2 : 1); }
/** A puff of dust at the capital gate as someone walks out with a new role (simulation pixels). */
export function gatePuff(x: number, y: number, kind: number){
  for (let i=0;i<8;i++) emit(x*K-2+Math.random()*4, y*K-1, (Math.random()-0.5)*8, -(3+Math.random()*5), 0.5+Math.random()*0.4, kind ? 3 : 2);
}
export function fireBurst(q: number){ const ox=(q%PW)*PS, oy=((q/PW)|0)*PS; for (let i=0;i<20;i++) emitFire(ox,oy); }
/** Splinters and dust where a soldier strikes the building on plot q. */
export function dustPuff(q: number){
  const ox=(q%PW)*PS, oy=((q/PW)|0)*PS;
  for (let i=0;i<4;i++) emit(ox+2+Math.random()*12, oy+6+Math.random()*8, (Math.random()-0.5)*12, -(4+Math.random()*6), 0.4+Math.random()*0.3, 2);
}

/** Advances particles; spawns fire, smoke and chimney puffs for what's on screen (view in render
    pixels; zs = screen pixels per simulation pixel). */
export function updateEffects(dt: number, vx0: number, vy0: number, vx1: number, vy1: number, zs: number){
  for (const q of W.burning){
    const ox=(q%PW)*PS, oy=((q/PW)|0)*PS;
    if (ox<vx0-32||oy<vy0-32||ox>vx1+16||oy>vy1+16) continue;
    let k=40*dt; while (k>=1){ emitFire(ox,oy); k--; } if (Math.random()<k) emitFire(ox,oy);
    if (Math.random()<6*dt) emitSmoke(ox+4+Math.random()*8, oy+2, 1);
  }
  if (zs>=2){
    const qx0=Math.max(0,Math.floor(vx0/PS)), qy0=Math.max(0,Math.floor(vy0/PS)), qx1=Math.min(PW-1,Math.floor(vx1/PS)), qy1=Math.min(PH-1,Math.floor(vy1/PS));
    for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
      const q=y*PW+x; if (pType[q]!==B_HOUSE || pBurn[q]>0 || pAband[q]) continue;   // empty houses are cold
      if (Math.random()<0.35*dt){ const c=CHIMNEY[pVar[q]%3]; emitSmoke(x*PS+c[0]+0.5, y*PS+c[1], 2); }
    }
  }
  for (let i=fx.pcount-1;i>=0;i--){
    plife[i]-=dt;
    if (plife[i]<=0){ const j=--fx.pcount; ppx[i]=ppx[j]; ppy[i]=ppy[j]; pvx[i]=pvx[j]; pvy[i]=pvy[j]; plife[i]=plife[j]; pmax[i]=pmax[j]; pkind[i]=pkind[j]; psize[i]=psize[j]; continue; }
    ppx[i]+=pvx[i]*dt; ppy[i]+=pvy[i]*dt; if (pkind[i]) pvx[i]+=0.8*dt;
  }
}

/* watchtower arrows */
export interface Shot { x0: number; y0: number; x1: number; y1: number; t0: number; kill: boolean; }
export const shots: Shot[]=[];
export function addShot(x0: number, y0: number, x1: number, y1: number, kill: boolean){ shots.push({x0,y0,x1,y1,t0:performance.now(),kill}); if (shots.length>300) shots.shift(); }

/* blows landing in a fight */
export interface Hit { x: number; y: number; t0: number; kill: boolean; }
export const hits: Hit[]=[];
export function addHit(x: number, y: number, kill: boolean){ hits.push({x,y,t0:performance.now(),kill}); if (hits.length>300) hits.shift(); }

/* floating "−gold" numbers after an attack order */
export interface Float { x: number; y: number; text: string; t0: number; c: string; }
export const floats: Float[]=[];

/* sea glints */
export const glints = { x: new Float32Array(0), y: new Float32Array(0), ph: new Float32Array(0) };
function initGlints(){
  const sx: number[]=[], sy: number[]=[], sp: number[]=[];
  for (let i=0;i<1600 && sx.length<1000;i++){ const t=(Math.random()*NT)|0; if (isLand[t]) continue; sx.push((t%TW)*RS+(i&1)); sy.push(((t/TW)|0)*RS+((i>>1)&3)); sp.push(Math.random()*6.28); }
  glints.x=Float32Array.from(sx); glints.y=Float32Array.from(sy); glints.ph=Float32Array.from(sp);
}

export function resetEffects(){
  fx.pcount=0; floats.length=0; flTime.fill(0); shots.length=0; hits.length=0;
  initGlints();
}
