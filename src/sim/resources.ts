/* ---------- resources: trees, rocks and copper scattered by terrain ----------
   Every region has its own advantage: forests are full of timber, mountains of stone,
   deserts hold the copper. Placement comes from the map seed alone, so every client agrees.
   Nothing grows back: once a region is stripped, a kingdom has to expand to find more. */
import { TW, TH, NT, PW, T_MOUNT } from '../core/constants';
import { W, terr, isLand, resType, resLeft, resBusy } from './state';
import { on } from './events';

export const R_NONE=0, R_TREE=1, R_TWIG=2, R_STONE=3, R_COPPER=4;   // what stands on a tile
export const G_WOOD=0, G_STONE=1, G_COPPER=2;                       // what goes in the stockpile
export const GOOD_NAME = ['wood','stone','copper'];
export const GOOD_OF   = [-1, G_WOOD, G_WOOD, G_STONE, G_COPPER];
export const YIELD     = [0, 3, 1, 1, 1];        // goods per harvest: a healthy tree gives 3, a dry twiggy one 1
const CHARGES          = [0, 1, 1, 3, 3];        // harvests before it is gone: trees are felled, rocks last 3
export const WORK_TICKS= [0, 40, 25, 40, 50];    // how long one harvest takes

// chance per tile, by terrain:          deep wat shal beach grass dry   forest desert hills mount snow
const P_COPPER = [0,0,0, 0.002, 0.003, 0.006, 0.002, 0.030, 0.006, 0.010, 0.002];
const P_STONE  = [0,0,0, 0.004, 0.006, 0.010, 0.004, 0.012, 0.060, 0.250, 0.050];
const P_TWIG   = [0,0,0, 0.010, 0.000, 0.050, 0.000, 0.025, 0.020, 0.000, 0.000];
const P_TREE   = [0,0,0, 0.000, 0.030, 0.000, 0.600, 0.000, 0.070, 0.000, 0.030];
const NEAR_MOUNTAIN_STONE = 0.05;   // extra stone within 3 tiles of a mountain

function rhash(x: number, y: number, salt: number){
  let h=Math.imul(x,0x27d4eb2d)^Math.imul(y,0x165667b1)^Math.imul(W.mapSeed^salt,0x9e3779b1);
  h=Math.imul(h^(h>>>15),0x85ebca6b); h=Math.imul(h^(h>>>13),0xc2b2ae35); h^=h>>>16;
  return (h>>>0)/4294967296;
}

export function genResources(){
  resType.fill(0); resLeft.fill(0); resBusy.fill(0);
  for (let y=0;y<TH;y++) for (let x=0;x<TW;x++){
    const t=y*TW+x; if (!isLand[t]) continue;
    const tr=terr[t];
    let nearMount=false;
    if (tr!==T_MOUNT) for (let dy=-3;dy<=3 && !nearMount;dy++) for (let dx=-3;dx<=3;dx++){
      const X=x+dx, Y=y+dy; if (X>=0 && Y>=0 && X<TW && Y<TH && terr[Y*TW+X]===T_MOUNT){ nearMount=true; break; } }
    const pc=P_COPPER[tr], ps=P_STONE[tr]+(nearMount?NEAR_MOUNTAIN_STONE:0), pw=P_TWIG[tr], pt=P_TREE[tr];
    const r=rhash(x,y,0x51ed);
    const type = r<pc ? R_COPPER : r<pc+ps ? R_STONE : r<pc+ps+pw ? R_TWIG : r<pc+ps+pw+pt ? R_TREE : R_NONE;
    if (type){ resType[t]=type; resLeft[t]=CHARGES[type]; }
  }
}

/** True if tile t has something to harvest that nobody has claimed. */
export const available = (t: number) => resLeft[t]>0 && !resBusy[t];

/** One harvest at tile t. Returns the goods gained. */
export function harvest(t: number){
  const type=resType[t]; if (!type || !resLeft[t]) return 0;
  resLeft[t]--;   // at 0 a stump or bare gravel is left behind
  on.resChanged(t);
  return YIELD[type];
}

/** Building on a plot clears the trees and rocks on it for good. */
export function clearPlot(q: number){
  const px=(q%PW)*4, py=((q/PW)|0)*4;
  for (let y=py;y<py+4;y++) for (let x=px;x<px+4;x++){
    const t=y*TW+x; if (!resType[t]) continue;
    resType[t]=0; resLeft[t]=0; resBusy[t]=0; on.resChanged(t);
  }
}

/** How many resource tiles of each type (R_*) sit on each terrain (T_*). For tests and tuning. */
export function resourceCensus(): number[][] {
  const out=Array.from({length:11},()=>[0,0,0,0,0]);
  for (let t=0;t<NT;t++) if (resType[t]) out[terr[t]][resType[t]]++;
  return out;
}
