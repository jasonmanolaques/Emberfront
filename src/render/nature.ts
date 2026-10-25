/* ---------- nature layer: the trees, rocks and copper the simulation placed, plus cacti ----------
   Drawn into its own canvas under the buildings, and redrawn locally whenever a resource is
   harvested, used up, grows back or is cleared for a building. */
import { TW, TH, DW, DH, T_FOREST, T_HILLS, T_MOUNT, T_DESERT, T_SNOW } from '../core/constants';
import { terr, isLand, resType, resLeft } from '../sim/state';
import { R_TREE, R_TWIG, R_STONE, R_COPPER } from '../sim/resources';
import { hash2 } from './terrain';

export const natC = document.createElement('canvas'); natC.width = DW; natC.height = DH;
const nctx = natC.getContext('2d') as CanvasRenderingContext2D;
function P(x: number, y: number, c: string){ nctx.fillStyle=c; nctx.fillRect(x,y,1,1); }

function drawTree(x: number, y: number, k: number, h: number){
  if (k===0){
    const L=h<0.3?'#7cc954':'#6dbb47', Mi='#4c9a34', D='#2f6e25';
    P(x+1,y,L); P(x,y+1,L); P(x+1,y+1,Mi); P(x+2,y+1,D); P(x,y+2,Mi); P(x+1,y+2,D); P(x+2,y+2,D); P(x+1,y+3,'#6a4528'); P(x+2,y+3,'rgba(0,0,0,.2)');
  } else {
    const A=k===2?'#e9f2f5':'#4f9a58', B=k===2?'#3f7c55':'#2f7440', C='#1f5531';
    P(x+1,y,A); P(x,y+1,B); P(x+1,y+1,A); P(x+2,y+1,C); P(x,y+2,B); P(x+1,y+2,B); P(x+2,y+2,C); P(x+1,y+3,'#5a3c22');
  }
}
// a dry, twiggy tree: bare branches with a few olive tufts
function drawTwig(x: number, y: number){
  P(x,y,'#9c9a4a'); P(x+2,y,'#8a6a40');
  P(x,y+1,'#7d5a35'); P(x+1,y+1,'#7d5a35'); P(x+2,y+1,'#9c9a4a');
  P(x+1,y+2,'#6e4b2c');
  P(x+1,y+3,'#5a3c22'); P(x+2,y+3,'rgba(0,0,0,.2)');
}
function drawStump(x: number, y: number, small: boolean){ P(x+1,y+3,'#6a4528'); if (!small) P(x+1,y+2,'#b08a5a'); }
function drawRock(x: number, y: number){ P(x,y,'#bdb6aa'); P(x+1,y,'#8d867b'); P(x+1,y+1,'#5f5a52'); }
function drawBoulder(x: number, y: number){
  P(x,y,'#c9c2b6'); P(x+1,y,'#bdb6aa'); P(x+2,y,'#8d867b');
  P(x,y+1,'#8d867b'); P(x+1,y+1,'#6f695f'); P(x+2,y+1,'#5f5a52');
}
function drawCopper(x: number, y: number){
  P(x+1,y-1,'#f2b27a');
  P(x,y,'#8f857a'); P(x+1,y,'#d9823e');
  P(x,y+1,'#c8743a'); P(x+1,y+1,'#6d5f55');
}
function drawCactus(x: number, y: number){ P(x,y+1,'#5f9a3c'); P(x,y+2,'#4c8030'); P(x,y+3,'#4c8030'); P(x-1,y+2,'#5f9a3c'); P(x+1,y+1,'#5f9a3c'); }

function drawTile(x: number, y: number){
  const t=y*TW+x; if (!isLand[t]) return;
  const tr=terr[t], h=hash2(x*3+17,y*5+3), X=x*2-1+((h*997|0)&1), Y=y*2-2, type=resType[t], left=resLeft[t]>0;
  if (type===R_TREE){
    if (!left){ drawStump(X,Y,false); return; }
    drawTree(X,Y, tr===T_SNOW ? 2 : tr===T_HILLS || (tr===T_FOREST && h<0.15) ? 1 : 0, h);
  }
  else if (type===R_TWIG){ if (left) drawTwig(X,Y); else drawStump(X,Y,true); }
  else if (type===R_STONE){ if (left){ if (tr===T_MOUNT) drawBoulder(X,Y+2); else drawRock(X+1,Y+2); } else P(X+1,Y+3,'rgba(150,144,134,.6)'); }
  else if (type===R_COPPER){ if (left) drawCopper(X+1,Y+2); else P(X+1,Y+3,'rgba(160,110,80,.6)'); }
  else if (tr===T_DESERT && hash2(x*7+5,y*11+1)<0.007) drawCactus(X+1,Y);
}

export function drawNature(){
  nctx.clearRect(0,0,DW,DH);
  for (let y=1;y<TH;y++) for (let x=0;x<TW;x++) drawTile(x,y);
}

/** Redraws the few pixels around tile t, keeping the overlap order of neighbouring sprites. */
export function redrawNature(t: number){
  const x=t%TW, y=(t/TW)|0, rx=x*2-2, ry=y*2-3;
  nctx.save(); nctx.beginPath(); nctx.rect(rx,ry,7,6); nctx.clip();
  nctx.clearRect(rx,ry,7,6);
  for (let yy=Math.max(1,y-2);yy<=Math.min(TH-1,y+3);yy++) for (let xx=Math.max(0,x-3);xx<=Math.min(TW-1,x+3);xx++) drawTile(xx,yy);
  nctx.restore();
}
