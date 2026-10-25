/* ---------- pixel sprites (drawn into the object layer) ---------- */
import { DW, DH, PW, B_HOUSE, B_FARM, B_TOWER, B_MINE, B_CASTLE, B_CPART, B_RUINS } from '../core/constants';
import { pType, pOwner, pVar, pMain } from '../sim/state';
import { styleOf, type NationStyle } from './style';

export const objC = document.createElement('canvas'); objC.width = DW; objC.height = DH;
export const octx = objC.getContext('2d') as CanvasRenderingContext2D;

function P(x: number, y: number, c: string){ octx.fillStyle=c; octx.fillRect(x,y,1,1); }
function R(x: number, y: number, w: number, h: number, c: string){ octx.fillStyle=c; octx.fillRect(x,y,w,h); }
const SH = 'rgba(16,28,8,.28)';

export const CHIMNEY = [[5,0],[1,1],[5,0]];
function drawHouse(ox: number, oy: number, n: NationStyle, v: number){
  const W1='#eadfc4', W2='#c9b490', DR='#5b3b24', WI='#8fd3ff';
  if (v===0){
    R(ox+2,oy+7,5,1,SH);
    R(ox+2,oy+4,4,3,W1); R(ox+6,oy+4,1,3,W2);
    P(ox+3,oy+5,DR); P(ox+3,oy+6,DR); P(ox+5,oy+5,WI);
    R(ox+2,oy+1,4,1,n.roofL); R(ox+1,oy+2,6,1,n.roof); R(ox+1,oy+3,7,1,n.roofD);
    P(ox+5,oy+0,'#8b4a3a');
  } else if (v===1){
    R(ox+1,oy+7,7,1,SH);
    R(ox+1,oy+4,6,3,W2); R(ox+6,oy+4,1,3,'#a8936f');
    P(ox+2,oy+5,DR); P(ox+2,oy+6,DR); P(ox+4,oy+5,WI); P(ox+5,oy+5,WI);
    R(ox+1,oy+2,6,1,n.roofL); R(ox+0,oy+3,8,1,n.roof);
    P(ox+1,oy+1,'#8b4a3a');
  } else {
    R(ox+2,oy+7,5,1,SH);
    R(ox+2,oy+3,4,4,W1); R(ox+5,oy+3,1,4,W2);
    P(ox+3,oy+4,WI); P(ox+4,oy+4,WI); P(ox+3,oy+6,DR); P(ox+4,oy+6,DR);
    R(ox+3,oy+0,2,1,n.roofL); R(ox+2,oy+1,4,1,n.roof); R(ox+1,oy+2,6,1,n.roofD);
    P(ox+5,oy+0,'#8b4a3a');
  }
}
function drawFarm(ox: number, oy: number, n: NationStyle, v: number){
  const crop = v===0?'#e3c45a':v===1?'#9ccf4f':'#cfd66a', cropL = v===0?'#f6e08a':'#c2ea78';
  R(ox+1,oy+1,6,6,'#8a6a3e');
  for (let r=0;r<3;r++) R(ox+1,oy+1+r*2,6,1,crop);
  for (let k=0;k<4;k++) P(ox+1+((v*3+k*5)%6), oy+1+((k*2)%6), cropL);
  const post='#6e4f2e'; P(ox,oy,post); P(ox+7,oy,post); P(ox,oy+7,post); P(ox+7,oy+7,post);
  P(ox+7,oy+1,n.roof);
}
function drawTower(ox: number, oy: number, n: NationStyle){
  const st='#b3aea3', sd='#7c776e', sl='#d6d1c5';
  R(ox+3,oy+7,4,1,SH);
  R(ox+3,oy+3,3,4,st); R(ox+5,oy+3,1,4,sd); P(ox+3,oy+3,sl);
  R(ox+2,oy+2,5,1,st); P(ox+2,oy+1,st); P(ox+6,oy+1,st);
  P(ox+4,oy+5,'#3b2e24'); P(ox+4,oy+6,'#3b2e24');
  P(ox+4,oy+0,'#4a3a2a'); P(ox+4,oy+1,'#4a3a2a'); P(ox+5,oy+0,n.roof); P(ox+6,oy+0,n.roofD);
}
function drawMine(ox: number, oy: number, n: NationStyle){
  R(ox+1,oy+5,6,2,'#9a958b'); R(ox+2,oy+4,4,1,'#aca79c'); R(ox+1,oy+7,6,1,SH);
  R(ox+3,oy+5,2,2,'#2c231d');
  R(ox+2,oy+4,4,1,'#7a5432'); P(ox+2,oy+5,'#7a5432'); P(ox+5,oy+5,'#7a5432');
  P(ox+6,oy+6,'#f2d14b'); P(ox+1,oy+6,'#e0c04a');
  P(ox+6,oy+2,'#4a3a2a'); P(ox+6,oy+3,'#4a3a2a'); P(ox+7,oy+2,n.roof);
}
function drawCastle(ox: number, oy: number, n: NationStyle){
  const st='#bdb8ad', sd='#87827a', sl='#dcd7cc', dk='#3a2e26';
  R(ox+1,oy+15,15,1,SH);
  R(ox+2,oy+9,12,6,st); R(ox+2,oy+14,12,1,sd);
  for (let i=0;i<6;i++) P(ox+3+i*2,oy+8,st);
  R(ox+0,oy+6,3,9,st); R(ox+13,oy+6,3,9,st); R(ox+2,oy+6,1,9,sd); R(ox+15,oy+6,1,9,sd);
  R(ox+0,oy+5,3,1,n.roofD); P(ox+1,oy+4,n.roof); R(ox+13,oy+5,3,1,n.roofD); P(ox+14,oy+4,n.roof);
  R(ox+5,oy+3,6,8,sl); R(ox+10,oy+3,1,8,sd);
  R(ox+4,oy+2,8,1,n.roofD); R(ox+5,oy+1,6,1,n.roof); R(ox+6,oy+0,4,1,n.roofL);
  P(ox+7,oy+5,'#ffd86b'); P(ox+8,oy+5,'#ffd86b'); P(ox+7,oy+7,'#ffd86b'); P(ox+8,oy+7,'#ffd86b');
  R(ox+7,oy+11,2,4,dk);
  P(ox+5,oy+9,n.roof); P(ox+5,oy+10,n.roofD); P(ox+10,oy+9,n.roof); P(ox+10,oy+10,n.roofD);
}
function drawRuins(ox: number, oy: number, v: number){
  const cols=['#3b3430','#57504a','#7b746c','#2a2422'];
  let h=(v*97+13+ox*7+oy*13)>>>0;
  for (let k=0;k<10;k++){ h=(Math.imul(h,1103515245)+12345)>>>0; P(ox+1+((h>>>8)%6), oy+2+((h>>>16)%5), cols[(h>>>4)&3]); }
  R(ox+1,oy+7,6,1,'rgba(0,0,0,.16)');
}
/** Redraws whatever stands on building plot q. */
export function drawPlot(q: number){
  const ox=(q%PW)*8, oy=((q/PW)|0)*8, ty=pType[q];
  if (ty===B_CPART){ const m=pMain[q]; if (pType[m]===B_CASTLE){ drawPlot(m); return; } }
  if (ty===B_CASTLE){ octx.clearRect(ox,oy,16,16); drawCastle(ox,oy,styleOf(pOwner[q])); return; }
  octx.clearRect(ox,oy,8,8);
  const n=styleOf(pOwner[q]), v=pVar[q]%3;
  if (ty===B_HOUSE) drawHouse(ox,oy,n,v);
  else if (ty===B_FARM) drawFarm(ox,oy,n,v);
  else if (ty===B_TOWER) drawTower(ox,oy,n);
  else if (ty===B_MINE) drawMine(ox,oy,n);
  else if (ty===B_RUINS) drawRuins(ox,oy,pVar[q]);
  else if (ty===B_CPART){ /* part of a burned castle still standing: leave */ }
}
