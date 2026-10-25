/* ---------- map generation ---------- */
import { TW, TH, NT, NP, PW, T_DEEP, T_WATER, T_SHALLOW, T_BEACH, T_GRASS, T_DRY, T_FOREST, T_DESERT, T_HILLS, T_MOUNT, T_SNOW } from '../core/constants';
import { smooth } from '../core/util';
import { mulberry32, makeNoise, fbm } from '../core/rng';
import { W, elev, moist, terr, isLand, pBuild, pCenter } from './state';

function nearWater(t: number, r: number){ const x=t%TW, y=(t/TW)|0;
  for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){ const X=x+dx, Y=y+dy; if (X<0||Y<0||X>=TW||Y>=TH) return true; if (!isLand[Y*TW+X]) return true; }
  return false; }

export function genMap(seed: number){
  const r = mulberry32(seed);
  const nE=makeNoise((r()*4294967296)>>>0), nR=makeNoise((r()*4294967296)>>>0), nM=makeNoise((r()*4294967296)>>>0), nW=makeNoise((r()*4294967296)>>>0);
  const sc = 3.1/TH, ox = r()*200, oy = r()*200, elong = 0.72 + r()*0.3;
  for (let y=0;y<TH;y++) for (let x=0;x<TW;x++){
    const u=x*sc+ox, v=y*sc+oy;
    const wx=fbm(nW,u*0.7,v*0.7,3)-0.5, wy=fbm(nW,u*0.7+31.7,v*0.7+11.3,3)-0.5;
    const h=fbm(nE,u+wx*1.6,v+wy*1.6,6);
    const rg=1-Math.abs(fbm(nR,u*1.2+wx*2,v*1.2+wy*2,4)*2-1);
    const dx=(x/TW-0.5)*2, dy=(y/TH-0.5)*2, d=Math.sqrt(dx*dx*elong+dy*dy);
    const mask=1-smooth(0.42,1.0,d), t=y*TW+x;
    elev[t]=h*0.62+mask*0.55+rg*rg*rg*0.26*mask;
    moist[t]=fbm(nM,u*0.7+50,v*0.7+50,4)+(h-0.5)*0.12;
  }
  const sorted = Float32Array.from(elev).sort();
  const sea = sorted[(NT*0.54)|0];
  for (let t=0;t<NT;t++){ const x=t%TW, y=(t/TW)|0; isLand[t] = elev[t]>sea && x>1 && y>1 && x<TW-2 && y<TH-2 ? 1 : 0; }

  // keep only the largest landmass so every kingdom can reach every other one
  const comp = new Int32Array(NT).fill(-1), qu = new Int32Array(NT); let best=-1, bestN=0;
  for (let s=0;s<NT;s++){
    if (!isLand[s] || comp[s]!==-1) continue;
    let h=0, tl=0; qu[tl++]=s; comp[s]=s;
    while (h<tl){ const c=qu[h++], x=c%TW;
      if (x>0 && isLand[c-1] && comp[c-1]===-1){ comp[c-1]=s; qu[tl++]=c-1; }
      if (x<TW-1 && isLand[c+1] && comp[c+1]===-1){ comp[c+1]=s; qu[tl++]=c+1; }
      if (c>=TW && isLand[c-TW] && comp[c-TW]===-1){ comp[c-TW]=s; qu[tl++]=c-TW; }
      if (c<NT-TW && isLand[c+TW] && comp[c+TW]===-1){ comp[c+TW]=s; qu[tl++]=c+TW; }
    }
    if (tl>bestN){ bestN=tl; best=s; }
  }
  for (let t=0;t<NT;t++) if (isLand[t] && comp[t]!==best){ isLand[t]=0; elev[t]=Math.min(elev[t],sea-0.002); }

  const le: number[]=[], lm: number[]=[], we: number[]=[];
  for (let t=0;t<NT;t++){ if (isLand[t]){ le.push(elev[t]); lm.push(moist[t]); } else we.push(sea-elev[t]); }
  const asc=(a: number,b: number)=>a-b; le.sort(asc); lm.sort(asc); we.sort(asc);
  const Q=(a: number[],p: number)=>a[Math.min(a.length-1,Math.max(0,(a.length*p)|0))];
  const eB=Q(le,0.05), eH=Q(le,0.76), eM=Q(le,0.89), eS=Q(le,0.967);
  const m1=Q(lm,0.10), m2=Q(lm,0.30), m3=Q(lm,0.63);
  const w1=Q(we,0.2), w2=Q(we,0.55);
  const lt: number[]=[];
  for (let t=0;t<NT;t++){
    const e=elev[t];
    if (!isLand[t]){ const d=sea-e; terr[t] = d<w1 ? T_SHALLOW : d<w2 ? T_WATER : T_DEEP; continue; }
    lt.push(t);
    if (e>eS) terr[t]=T_SNOW; else if (e>eM) terr[t]=T_MOUNT; else if (e>eH) terr[t]=T_HILLS;
    else { const m=moist[t];
      if (e<eB && nearWater(t,2)) terr[t]=T_BEACH;
      else if (m<m1) terr[t]=T_DESERT; else if (m<m2) terr[t]=T_DRY; else if (m<m3) terr[t]=T_GRASS; else terr[t]=T_FOREST; }
  }
  W.landTiles = Int32Array.from(lt); W.landCount = lt.length;
  W.seaLevel = sea; W.heightRange = Math.max(1e-4, eS-sea);

  for (let q=0;q<NP;q++){
    const px=q%PW, py=(q/PW)|0; let land=0;
    for (let y=py*4;y<py*4+4;y++) for (let x=px*4;x<px*4+4;x++) land+=isLand[y*TW+x];
    const c=pCenter[q];
    pBuild[q] = land>=12 && isLand[c] && terr[c]!==T_SNOW ? 1 : 0;
  }
}
