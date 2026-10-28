/* ---------- resources: trees, rocks and copper scattered by terrain ----------
   Every region has its own advantage: forests are full of timber, mountains of stone,
   deserts hold the copper. Placement comes from the map seed alone, so every client agrees.
   Nothing grows back: a tree felled or a rock used up is gone, and once a region is stripped, a
   kingdom has to expand to find more. */
import { TW, TH, NT, NP, PW, T_MOUNT } from '../core/constants';
import { W, terr, isLand, owner, resType, resLeft, resBusy } from './state';
import { on } from './events';

export const R_NONE=0, R_TREE=1, R_TWIG=2, R_STONE=3, R_COPPER=4;   // what stands on a tile
export const G_WOOD=0, G_STONE=1, G_COPPER=2;                       // what goes in the stockpile
export const GOOD_NAME = ['wood','stone','copper'];
export const GOOD_OF   = [-1, G_WOOD, G_WOOD, G_STONE, G_COPPER];
export const YIELD     = [0, 1, 1, 1, 1];        // goods per harvest: every tree, rock or copper vein gives 1
const CHARGES          = [0, 1, 1, 3, 3];        // harvests before it is gone: trees are felled, rocks last 3
export const WORK_TICKS= [0, 40, 25, 40, 50];    // how long one harvest takes

// chance per tile, by terrain:          deep wat shal beach grass dry   forest desert hills mount snow
// (all at half the density they once were: wild ground is thinner, so plantations, quarries and mines matter)
export const DENSITY = 0.5;
const P_COPPER = [0,0,0, 0.002, 0.003, 0.006, 0.002, 0.030, 0.006, 0.010, 0.002].map(p => p*DENSITY);
const P_STONE  = [0,0,0, 0.004, 0.006, 0.010, 0.004, 0.012, 0.060, 0.250, 0.050].map(p => p*DENSITY);
const P_TWIG   = [0,0,0, 0.010, 0.000, 0.050, 0.000, 0.025, 0.020, 0.000, 0.000].map(p => p*DENSITY);
const P_TREE   = [0,0,0, 0.000, 0.030, 0.000, 0.600, 0.000, 0.070, 0.000, 0.030].map(p => p*DENSITY);
const NEAR_MOUNTAIN_STONE = 0.05*DENSITY;   // extra stone within 3 tiles of a mountain

function rhash(x: number, y: number, salt: number){
  let h=Math.imul(x,0x27d4eb2d)^Math.imul(y,0x165667b1)^Math.imul(W.mapSeed^salt,0x9e3779b1);
  h=Math.imul(h^(h>>>15),0x85ebca6b); h=Math.imul(h^(h>>>13),0xc2b2ae35); h^=h>>>16;
  return (h>>>0)/4294967296;
}

export function genResources(){
  resType.fill(0); resLeft.fill(0); resBusy.fill(0);
  const tw=TW, th=TH, tr0=terr;
  // tiles within 3 of a mountain (a 7×7 square), found row by row and then column by column
  const across=new Uint8Array(NT), near=new Uint8Array(NT);
  for (let y=0;y<th;y++){ let last=-99; for (let x=0;x<tw;x++){ if (tr0[y*tw+x]===T_MOUNT) last=x; if (x-last<=3) across[y*tw+x]=1; }
    last=1e9; for (let x=tw-1;x>=0;x--){ if (tr0[y*tw+x]===T_MOUNT) last=x; if (last-x<=3) across[y*tw+x]=1; } }
  for (let x=0;x<tw;x++){ let last=-99; for (let y=0;y<th;y++){ if (across[y*tw+x]) last=y; if (y-last<=3) near[y*tw+x]=1; }
    last=1e9; for (let y=th-1;y>=0;y--){ if (across[y*tw+x]) last=y; if (last-y<=3) near[y*tw+x]=1; } }
  for (let y=0;y<th;y++) for (let x=0;x<tw;x++){
    const t=y*tw+x; if (!isLand[t]) continue;
    const tr=tr0[t], nearMount=tr!==T_MOUNT && near[t]===1;
    const pc=P_COPPER[tr], ps=P_STONE[tr]+(nearMount?NEAR_MOUNTAIN_STONE:0), pw=P_TWIG[tr], pt=P_TREE[tr];
    const r=rhash(x,y,0x51ed);
    const type = r<pc ? R_COPPER : r<pc+ps ? R_STONE : r<pc+ps+pw ? R_TWIG : r<pc+ps+pw+pt ? R_TREE : R_NONE;
    if (type){ resType[t]=type; resLeft[t]=CHARGES[type]; }
  }
  freeIn=new Uint16Array(NP);
  for (let t=0;t<NT;t++) if (resLeft[t]>0) freeIn[plotOf(t)]++;
}

/** True if tile t has something to harvest that nobody has claimed. */
export const available = (t: number) => resLeft[t]>0 && !resBusy[t];
/** How many tiles of each building plot (4x4 tiles) have something nobody has claimed: a villager's
    search for work skips the empty plots. */
export let freeIn = new Uint16Array(0);
const plotOf = (t: number) => ((((t/TW)|0)>>2)*PW)+((t%TW)>>2);
/** Changes tile t (claims it, harvests it, clears it) by `change`, keeping freeIn right. */
function counted(t: number, change: () => void){
  const was=available(t); change();
  const now=available(t); if (was!==now) freeIn[plotOf(t)]+=now ? 1 : -1;
}
/** A villager claims tile t to harvest, or lets it go. */
export function claim(t: number){ counted(t,() => { resBusy[t]=1; }); }
export function unclaim(t: number){ counted(t,() => { resBusy[t]=0; }); }

/** One harvest at tile t. Returns the goods gained. */
export function harvest(t: number){
  const type=resType[t]; if (!type || !resLeft[t]) return 0;
  counted(t,() => {
    if (--resLeft[t]<=0){   // used up: it is gone, nothing is left standing there
      const o=owner[t]; if (o) W.nations[o].resHere[GOOD_OF[type]]--;
      resType[t]=0; resBusy[t]=0;
    }
  });
  on.resChanged(t);
  return YIELD[type];
}

/** Building on a plot clears the trees and rocks on it for good. */
export function clearPlot(q: number){
  const px=(q%PW)*4, py=((q/PW)|0)*4;
  for (let y=py;y<py+4;y++) for (let x=px;x<px+4;x++){
    const t=y*TW+x; if (!resType[t]) continue;
    if (resLeft[t]>0 && owner[t]) W.nations[owner[t]].resHere[GOOD_OF[resType[t]]]--;
    counted(t,() => { resType[t]=0; resLeft[t]=0; resBusy[t]=0; }); on.resChanged(t);
  }
}

/** How many resource tiles of each type (R_*) sit on each terrain (T_*). For tests and tuning. */
export function resourceCensus(): number[][] {
  const out=Array.from({length:11},()=>[0,0,0,0,0]);
  for (let t=0;t<NT;t++) if (resType[t]) out[terr[t]][resType[t]]++;
  return out;
}
