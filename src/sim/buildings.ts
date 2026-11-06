/* ---------- buildings: villagers build their own houses; farms, barracks, watchtowers and coin
   minters are placed by each kingdom and paid for from its stockpile. Also roads, fire & ruins.
   Plantations, quarries and copper mines are placed one plot at a time. With resource gathering
   research at tier 2, two of a kind side by side join into one building of 2×1 plots (tier 2), and
   at tier 3 four of a kind in a square join into one of 2×2 (tier 3); a joined building makes far
   more than its parts did apart. ---------- */
import { plannedWall } from './fort';
import { TW, PW, PH, NP, T_FOREST, B_CARPENTER, B_EMPTY, B_HOUSE, B_FARM, B_TOWER, B_CASTLE, B_CPART, B_RUINS, B_BARRACKS, B_MINTER, B_SITE, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_RESEARCH, B_GUILD, B_SMITHY, B_HOSPITAL, B_NAVAL, TH, isStructure } from '../core/constants';
import { W, owner, occ, terr, isLand, isle, road, pType, pOwner, pVar, pBuild, pCenter, pBurn, pTimer, pAband, pMain, pHp, pTier, pSpan, pArmor, pIn, type Nation } from './state';
import { R_GATHER, hasMedics } from './research';
import { on } from './events';

function igniteOne(q: number){ if (pBurn[q]>0) return; pBurn[q]=2.5+W.srand()*2.5; W.burning.push(q); on.plotIgnited(q); }
/** Sets plot q on fire; a building that covers several plots goes up in flames all together. */
export function ignite(q: number){
  const main = pType[q]===B_PART ? pMain[q] : q;
  for (const k of cover(main)) igniteOne(k);
}
/** A building of the ground ceded in a peace deal goes with it to its new owner, as it stands (a house with nobody resting in it, a tower with no guard):
    the whole building, whichever of its plots the border ran across. */
export function captureBuilding(q: number, o: number){
  const main=pType[q]===B_PART ? pMain[q] : q, prev=pOwner[main]; if (prev===o || !prev) return;
  const P=W.nations[prev], N=W.nations[o];
  for (const k of cover(main)){ pOwner[k]=o; pIn[k]=0; on.plotChanged(k); }
  const i=P.blds.indexOf(main); if (i>=0) P.blds.splice(i,1);
  if (!N.blds.includes(main)) N.blds.push(main);
  for (const h of W.humans) if (h.o===prev){ if (h.rest===main) h.rest=-1; if (h.home===main) h.home=-1; if (h.work===main) h.work=-1; if (h.site===main) h.site=-1; if (h.post===main) h.post=-1; }
}
export function toRuins(q: number){ pSpan[q]=0; pType[q]=B_RUINS; pOwner[q]=0; pVar[q]=(W.srand()*8)|0; pBurn[q]=0; pTimer[q]=35+W.srand()*30; pAband[q]=0; pHp[q]=0; pTier[q]=0; pArmor[2][q]=pArmor[3][q]=0; on.plotChanged(q); }

export function isBld(ty: number){ return isStructure(ty) || ty===B_CASTLE || ty===B_CPART; }
function nbBuildings(q: number, id: number){
  const px=q%PW, py=(q/PW)|0; let c=0;
  for (let y=py-1;y<=py+1;y++) for (let x=px-1;x<=px+1;x++){
    if ((x===px&&y===py)||x<0||y<0||x>=PW||y>=PH) continue;
    const k=y*PW+x; if (isBld(pType[k]) && pOwner[k]===id && pBurn[k]<=0) c++;
  }
  return c;
}
function anyWithin(q: number, id: number, r: number, pred: (k: number, id: number) => boolean){
  const px=q%PW, py=(q/PW)|0;
  for (let y=Math.max(0,py-r);y<=Math.min(PH-1,py+r);y++) for (let x=Math.max(0,px-r);x<=Math.min(PW-1,px+r);x++){
    const k=y*PW+x; if (k!==q && pred(k,id)) return true; }
  return false;
}
const isOwnBld = (k: number, id: number) => isBld(pType[k]) && pOwner[k]===id;
export const isEnemyLand = (k: number, id: number) => { const o=owner[pCenter[k]]; return o!==0 && o!==id; };
export { anyWithin };

function buildRoad(a: number, b: number){
  let x0=a%TW, y0=(a/TW)|0; const x1=b%TW, y1=(b/TW)|0;
  const dx=Math.abs(x1-x0), dy=-Math.abs(y1-y0), sx=x0<x1?1:-1, sy=y0<y1?1:-1;
  let err=dx+dy; const path: number[]=[];
  for (let guard=0;guard<400;guard++){
    const t=y0*TW+x0; if (!isLand[t]) return; path.push(t);
    if (x0===x1 && y0===y1) break;
    const e2=2*err; if (e2>=dy){ err+=dy; x0+=sx; } if (e2<=dx){ err+=dx; y0+=sy; }
  }
  for (const t of path) if (!road[t]){ road[t]=1; on.roadBuilt(t); }
}
function connectRoad(q: number, id: number, far: boolean){
  const n=W.nations[id], px=q%PW, py=(q/PW)|0; let best=-1, bd=1e9;
  for (const k of n.blds){
    if (k===q) continue; const ty=pType[k]; if (ty===B_FARM || pOwner[k]!==id) continue;
    const d=Math.max(Math.abs(k%PW-px),Math.abs(((k/PW)|0)-py));
    if (d<bd){ bd=d; best=k; }
  }
  if (best<0 || bd>(far?16:3)) return;
  const target = (pType[best]===B_CASTLE||pType[best]===B_CPART) && n.capTile>=0 ? n.capTile : pCenter[best];
  buildRoad(pCenter[q], target);
}
function placeBuilding(q: number, id: number, type: number, isNew: boolean){
  if (type===B_EMPTY) return;
  pType[q]=type; pOwner[q]=id; pVar[q]=(W.srand()*(type===B_HOUSE ? 18 : 3))|0;   // (a house: one of 3 shapes, in one of 3 colourings)
   pTimer[q]=0; pAband[q]=0; pHp[q]=0; pTier[q]=type===B_HOUSE || type===B_TOWER ? 1 : 0; pSpan[q]=0; pArmor[2][q]=pArmor[3][q]=0;
  on.plotChanged(q);
  const n=W.nations[id]; n.bCount++;
  if (type!==B_FARM) connectRoad(q,id,isNew);
  n.blds.push(q);
  on.buildingPlaced(q,id,isNew);
}
/* ---------- houses: each villager builds one when the kingdom is short of homes ---------- */
/** How well plot q suits a new house: towns grow outward from their edges and along their roads,
    dense cores fill slowly, and open countryside now and then seeds a new village. 0 = unsuitable. */
/** How many buildings kingdom o has on landmass I, looked at every 10 seconds. */
const isleBuildings=new Map<number, [number, number]>();
function buildingsOnIsle(n: Nation, I: number){
  const key=n.id*65536+I; let c=isleBuildings.get(key);
  if (!c || W.tickN<c[0] || W.tickN-c[0]>=100){ c=[W.tickN, n.blds.reduce((k,q) => k+(isle[pCenter[q]]===I ? 1 : 0),0)]; isleBuildings.set(key,c); }
  return c[1];
}
export function resetHomes(){ isleBuildings.clear(); }
export function homeScore(n: Nation, q: number){
  if (plotProblem(n,q) || plannedWall(n,q)) return 0;   // a bot's houses keep off the line of its wall
  const nb=nbBuildings(q,n.id);
  let w = nb>0 ? (nb<=3 ? 1+nb*1.4 : nb<=5 ? 1.6 : 0.35) : n.bCount<2 ? 0.3 : (!anyWithin(q,n.id,5,isOwnBld) ? 0.9 : 0.03);
  // a colony with no building on its island yet: the people go over by boat to found its first village
  const I=isle[pCenter[q]];
  if (n.navals>0 && I && n.capTile>=0 && I!==isle[n.capTile] && buildingsOnIsle(n,I)===0) w=Math.max(w,3.5);
  if (pType[q]===B_RUINS) w*=1.8;   // rebuilding on the ashes
  if (terr[pCenter[q]]===T_FOREST) w*=0.5;
  // beside a road
  const px=(q%PW)*4, py=((q/PW)|0)*4;
  for (let i=-1;i<=4;i++) if (road[(py-1)*TW+px+i] || road[(py+4)*TW+px+i] || road[(py+i)*TW+px-1] || road[(py+i)*TW+px+4]){ w*=1.4; break; }
  return w;
}
/** Marks plot q as a house site: the frame goes up while a villager works on it. */
export function startSite(q: number, id: number){ pType[q]=B_SITE; pOwner[q]=id; pVar[q]=(W.srand()*3)|0; pAband[q]=0; on.plotChanged(q); }
export function cancelSite(q: number){ if (pType[q]!==B_SITE) return; pType[q]=B_EMPTY; pOwner[q]=0; on.plotChanged(q); }
export function finishHouse(q: number, id: number){
  const isNew=nbBuildings(q,id)===0;
  pType[q]=B_EMPTY;
  placeBuilding(q,id,B_HOUSE,isNew);
  W.nations[id].houses++; W.nations[id].beds++;   // count it right away rather than at the next census
}

/* ---------- buildings a kingdom places ---------- */
export interface Structure { type: number; name: string; cost: number[]; info: string; }   // cost: [wood, stone, copper]
// buildings placed bigger than one plot: [width, height] in plots
export const SIZE: Record<number, [number, number]> = { [B_GUILD]: [2,1], [B_HOSPITAL]: [2,1], [B_NAVAL]: [4,2] };
/** The plots a building of `type` placed with its top-left on plot q covers (a naval base is 4×2, or, turned, 2×4). */
export function footprint(q: number, type: number, orient=0){ return rect(q, type===B_NAVAL && orient ? [2,4] : SIZE[type] ?? [1,1]); }
const rect = (q: number, [w,h]: number[]) => { const out: number[]=[]; for (let y=0;y<h;y++) for (let x=0;x<w;x++) out.push(q+y*PW+x); return out; };
// plantations, quarries and copper mines: their size (pSpan) is their tier
export const GATHERERS = [B_PLANTATION, B_QUARRY, B_COPPERMINE];
export const isGatherer = (ty: number) => ty===B_PLANTATION || ty===B_QUARRY || ty===B_COPPERMINE;
/** Buildings that join up with their own kind (the gatherers as far as research allows, and blacksmiths always, for looks alone). */
const joinsUp = (ty: number) => isGatherer(ty) || ty===B_SMITHY;
const SPANS = [[1,1],[2,1],[2,2]];
/** [width, height] in plots of the building whose main plot is q. */
export function dims(q: number): [number, number] {
  const ty=pType[q];
  if (ty===B_CASTLE) return [2,2];
  if (ty===B_NAVAL) return pSpan[q]===1 ? [2,4] : [4,2];
  if (joinsUp(ty)){ const [w,h]=SPANS[pSpan[q]]; return [w,h]; }
  return SIZE[ty] ?? [1,1];
}
/** The plots the building whose main plot is q covers. */
export const cover = (q: number) => rect(q, dims(q));
/** A plantation, quarry or copper mine's tier: 1 alone, 2 two joined, 3 four joined. */
export const gatherTier = (q: number) => pSpan[q]+1;
// production buildings: what they make every PRODUCE_TICKS, by type: [good, amount by tier]
export const PRODUCE_TICKS = 300;   // 30 s
export const PRODUCES: Record<number, [number, number[]]> = { [B_PLANTATION]: [0,[0,2,5,15]], [B_QUARRY]: [1,[0,2,5,15]], [B_COPPERMINE]: [2,[0,1,3,10]] };
export const STRUCTURES: Structure[] = [
  { type: B_FARM,     name: 'Farm',        cost: [5,2,0], info: 'Each farm brings new villagers 3% sooner, and makes the next farm 5% dearer.' },
  { type: B_BARRACKS, name: 'Barracks',    cost: [5,5,0], info: 'Trains soldiers and houses an army of 5, with 5 armour racks. Barracks side by side join into one bigger army: four together march as one army of 20. Soldiers without room patrol the city and only defend. Click a barracks to see its army.' },
  { type: B_TOWER,    name: 'Watchtower',  cost: [2,5,1], info: 'While you are at war, shoots enemy soldiers that come near, and their villagers. Click a placed tower to call up to 5 soldiers to guard it.' },
  { type: B_MINTER,   name: 'Coin minter', cost: [5,5,5], info: 'Raises your gold income by 5%. Each coin minter you own makes the next 10% dearer.' },
  { type: B_PLANTATION, name: 'Plantation', cost: [10,0,0], info: 'Saplings growing into trees: +2 wood every 30 seconds. With resource gathering research, two side by side join (+5), then four in a square (+15). Each plantation you own makes the next 10% dearer.' },
  { type: B_QUARRY,     name: 'Stone quarry', cost: [5,10,0], info: 'A pit with a pulley hauling stone up: +2 stone every 30 seconds. With resource gathering research, two side by side join (+5), then four in a square (+15). Each quarry you own makes the next 10% dearer.' },
  { type: B_COPPERMINE, name: 'Copper mine', cost: [10,10,0], info: 'A shaft into the rock with the furnace glowing inside: +1 copper every 30 seconds. With resource gathering research, two side by side join (+3), then four in a square (+10). Each copper mine you own makes the next 10% dearer.' },
  { type: B_RESEARCH,   name: 'Research station', cost: [15,15,10], info: 'A villager becomes the scholar of each station, and the station earns 1 research point a second; more stations, faster research (two side by side are drawn as one), and each station you own makes the next 20% dearer. Click a placed station, or use the button on this tab, to choose what to study.' },
  { type: B_GUILD,      name: 'Builders guild', cost: [10,50,10], info: 'The city\'s investment: one villager becomes its builder, and as research allows he raises houses and watchtowers a tier for free, non-stop: 20 seconds from tier 1 to 2, 40 from 2 to 3. He takes whichever job costs the least time, walk included, so the lowest buildings come first. More guilds, more builders. Takes 2×1 plots. Each guild you own makes the next 10% dearer.' },
  { type: B_NAVAL,      name: 'Naval base', cost: [15,5,0], info: 'A harbour on the coast: 8 plots (4×2 or 2×4), at least a third of them on the water. Click it to build ships (5 wood each). Settle islands from the settle menu: a ship takes your gold to the coast you point at and the border spreads from there; villagers cross by boat to build. Ships carry 5 soldiers each, for naval invasions.' },
  { type: B_SMITHY,     name: 'Blacksmith', cost: [10,15,5], info: 'One villager becomes its smith. With infantry research he fetches 5 copper from the castle, forges armour for 5 seconds and carries it to the barracks: reinforced armour for every rack, then heavy armour.' },
];
export const HOSPITAL_STRUCTURE: Structure = { type: B_HOSPITAL, name: 'Hospital', cost: [15,25,10], info: 'Two villagers become doctors. With field medics research, some of the soldiers who fall are only wounded: a doctor runs out (50% faster) to carry each to the hospital, which has two beds, and heals him in 7 seconds before he goes back to the field. A wounded man bleeds out in 45 seconds if no doctor comes.' };
STRUCTURES.push(HOSPITAL_STRUCTURE);
export const CARPENTER_STRUCTURE: Structure = { type: B_CARPENTER, name: 'Carpenters', cost: [50,20,5], info: 'One villager becomes a carpenter and builds additional hovels (tier 1 houses) for free, one every 20 seconds, wherever there is room on your land, to raise how many your kingdom can house. The builders guild can raise them like any other house. Each carpenters you own makes the next 10% dearer.' };
STRUCTURES.push(CARPENTER_STRUCTURE);
export const structureOf = (type: number) => STRUCTURES.find(s => s.type===type);
const countOf = (n: Nation, ty: number) => ty===B_PLANTATION ? n.plantations : ty===B_QUARRY ? n.quarries : n.copperMines;
/** How much dearer each building of a kind its kingdom already has makes the next one (a share of the base price). */
export const RISE: Record<number, number> = { [B_FARM]: 0.05, [B_TOWER]: 0.05, [B_MINTER]: 0.1, [B_GUILD]: 0.1, [B_RESEARCH]: 0.2, [B_BARRACKS]: 0.05, [B_SMITHY]: 0.05, [B_NAVAL]: 0.1, [B_CARPENTER]: 0.1, [B_PLANTATION]: 0.1, [B_QUARRY]: 0.1, [B_COPPERMINE]: 0.1 };
/** How many of kingdom n's buildings of `type` there are for pricing: gathering buildings count by the plots they cover (four joined are four). */
function ownedFor(n: Nation, type: number){
  if (type===B_FARM) return n.farms;
  if (type===B_MINTER) return n.minters;
  if (type===B_TOWER) return n.towers;
  if (type===B_GUILD) return n.guilds;
  if (type===B_NAVAL) return n.navals;
  if (type===B_BARRACKS) return n.barracks;
  let k=0; for (const q of n.blds) if (pType[q]===type) k+=[1,2,4][pSpan[q]] ?? 1;
  return Math.max(k,countOf(n,type));
}
/** The first plantation and the first quarry a kingdom builds cost nothing, so that every kingdom can start its stockpile; the copper mine is paid for. */
const FIRST_FREE = [B_PLANTATION, B_QUARRY];
/** What a structure costs kingdom n: the first plantation and quarry it builds are
    free (the map has nothing to gather, so they start its stockpile), and each building of a kind it
    owns makes the next one dearer (RISE: 5% of the base price for farms and watchtowers, 10% for the others). */
export function costFor(n: Nation, s: Structure): number[] {
  if (FIRST_FREE.includes(s.type) && countOf(n,s.type)===0) return [0,0,0];
  const rise=RISE[s.type];
  if (rise) { const k=ownedFor(n,s.type); return s.cost.map(c => c ? Math.round(c*(1+rise*k)) : 0); }
  return s.cost;
}
export const canAfford = (n: Nation, s: Structure) => costFor(n,s).every((c,g) => n.stock[g]>=c);

/** What a new building may replace: nothing ('none'), a house or the frame of one ('houses': what bots
    clear for a wall tower or a workshop), or any building of the kingdom's but its castle ('any': the player). */
export type Over = 'none' | 'houses' | 'any';
const mainOf = (q: number) => pType[q]===B_PART ? pMain[q] : q;
/** Could a new building go over what stands on plot q (as far as `over` allows)? */
function replaceable(n: Nation, q: number, over: Over){
  const ty=pType[q], m=mainOf(q);
  if (over==='none' || pOwner[m]!==n.id || pBurn[m]>0 || ty===B_CASTLE || ty===B_CPART) return false;
  return over==='any' ? isStructure(pType[m]) || ty===B_SITE : ty===B_HOUSE || ty===B_SITE;
}
/** Why kingdom n can't build on plot q, or null if it can. */
export function plotProblem(n: Nation, q: number, over: Over='none'): string | null {
  if (q<0 || q>=NP || !pBuild[q]) return 'There is no room to build there';
  if (owner[pCenter[q]]!==n.id) return 'Build on your own land';
  if (occ[pCenter[q]]) return 'The enemy holds that ground';
  if (((pType[q]!==B_EMPTY && pType[q]!==B_RUINS) || pBurn[q]>0) && !replaceable(n,q,over)) return 'Something already stands there';
  const px=(q%PW)*4, py=((q/PW)|0)*4;
  for (let y=py;y<py+4;y++) for (let x=px;x<px+4;x++){ const o=owner[y*TW+x]; if (o && o!==n.id) return 'Too close to the border'; }
  return null;
}

/** Why a naval base can't stand with its top-left on plot q turned `orient` (0: 4×2, 1: 2×4), or null. Its plots may lie
    on the water, but every bit of land in it must be the kingdom's own; a third of it at least is water, and some is land. */
export function navalProblem(n: Nation, q: number, orient: number, over: Over='none'): string | null {
  const [w,h]=orient ? [2,4] : [4,2];
  if (q<0 || q%PW+w>PW || ((q/PW)|0)+h>PH) return 'There is no room to build there';
  let water=0, land=0;
  for (const k of rect(q,[w,h])){
    if (((pType[k]!==B_EMPTY && pType[k]!==B_RUINS) || pBurn[k]>0) && !replaceable(n,k,over)) return 'Something already stands there';
    const px=(k%PW)*4, py=((k/PW)|0)*4;
    for (let y=py;y<py+4;y++) for (let x=px;x<px+4;x++){
      const t=y*TW+x;
      if (!isLand[t]){ water++; continue; }
      land++;
      if (owner[t]!==n.id) return owner[t] ? 'Too close to the border' : 'Build on your own land';
      if (occ[t]) return 'The enemy holds that ground';
    }
  }
  if (water*3<w*h*16) return 'At least a third of a naval base must be on the water';
  if (land<16) return 'A naval base needs some of your land beside the water';
  return null;
}
/** How a naval base goes with its top-left on plot q: the way it is turned (-1 if it can't stand there), and why not. */
export function navalSite(n: Nation, q: number, over: Over='none'): { orient: number; problem: string | null } {
  const p0=navalProblem(n,q,0,over); if (!p0) return { orient:0, problem:null };
  const p1=navalProblem(n,q,1,over); if (!p1) return { orient:1, problem:null };
  return { orient:-1, problem: p0==='There is no room to build there' ? p1 : p0 };
}

/** Why kingdom n can't put a `type` building with its top-left on plot q, or null if it can. With
    `over`, it may go over buildings of the kingdom's (they are pulled down), but not over one just like it. */
export function placeProblem(n: Nation, q: number, type: number, over: Over='none'): string | null {
  if (type===B_NAVAL) return navalSite(n,q,over).problem;
  if (type===B_HOSPITAL && !hasMedics(n)) return 'Research field medics first';
  const [w,h]=SIZE[type] ?? [1,1];
  if (q<0 || q%PW+w>PW || ((q/PW)|0)+h>PH) return 'There is no room to build there';
  for (const k of footprint(q,type)){ const p=plotProblem(n,k,over); if (p) return w*h>1 && p==='Something already stands there' ? `Needs ${w}×${h} free plots` : p; }
  if (w*h===1 && pType[q]===type) return 'One already stands there';
  return null;
}
/** The buildings a `type` building placed on plot q would pull down (main plots). */
export function underneath(q: number, type: number, orient=0){
  const out: number[]=[];
  for (const k of footprint(q,type,orient)){ const ty=pType[k]; if ((isStructure(ty) || ty===B_SITE) && !out.includes(mainOf(k))) out.push(mainOf(k)); }
  return out;
}
/** Pulls down the building on plot q (all of it, if it covers several plots): its plots are left bare. */
export function demolish(q: number){
  const m=mainOf(q), ty=pType[m], o=pOwner[m], n=W.nations[o];
  const plots=ty===B_SITE ? [m] : cover(m);
  for (const k of plots){
    pType[k]=B_EMPTY; pOwner[k]=0; pMain[k]=0; pTimer[k]=0; pAband[k]=0; pHp[k]=0; pTier[k]=0; pSpan[k]=0; pArmor[2][k]=pArmor[3][k]=0;
    on.plotChanged(k);
  }
  if (!n) return;
  if (!isStructure(ty)) return;   // (a house frame isn't counted)
  const i=n.blds.indexOf(m); if (i>=0) n.blds.splice(i,1);
  n.bCount=Math.max(0,n.bCount-1);
  countDown(n,ty);
}

/** Pays for and places a building, pulling down what it goes over (as far as `over` allows).
    Returns false if it can't be afforded or placed. */
export function build(n: Nation, q: number, type: number, over: Over='none'){
  const s=structureOf(type);
  if (!s || !n.alive || !canAfford(n,s) || placeProblem(n,q,type,over)) return false;
  costFor(n,s).forEach((c,g) => n.stock[g]-=c);
  const orient=type===B_NAVAL ? navalSite(n,q,over).orient : 0;
  for (const m of underneath(q,type,orient)) demolish(m);
  for (const k of footprint(q,type,orient).slice(1)){ pType[k]=B_PART; pOwner[k]=n.id; pMain[k]=q; pBurn[k]=0; pAband[k]=0; }
  placeBuilding(q,n.id,type,false);
  if (type===B_NAVAL) pSpan[q]=orient;
  // count it right away rather than at the next census, so its effect starts now
  countUp(n,type);
  if (joinsUp(type)) joinGatherers(n);
  return true;
}
/* ---------- four at a time ----------
   A farm or a watchtower can be placed as a block of four: a square of 2 by 2 plots, built as four single ones in turn (each dearer than the last by
   the usual rise), all or none. */
export const BLOCKABLE=[B_FARM, B_TOWER];
export const blockPlots = (q: number) => [q, q+1, q+PW, q+PW+1];
/** What four of `type` cost one after the other (each farm or tower owned makes the next dearer), and why not, if they can't go on the block of plots at q. */
export function blockPlan(n: Nation, q: number, type: number, over: Over='any'): { cost: number[]; problem: string | null } {
  const s=structureOf(type), cost=[0,0,0];
  if (!s || !BLOCKABLE.includes(type)) return { cost, problem:'Not a building that goes four at a time' };
  const stock=n.stock.slice(); let problem: string | null=null, k=0;
  const plots = q%PW>=PW-1 || q+PW>=NP ? [] : blockPlots(q);
  if (!plots.length) problem='No room for four here';
  for (const p of plots){
    const w=placeProblem(n,p,type,over); if (w && !problem) problem=w;
    const c=costFor(n,s); c.forEach((v,g) => { cost[g]+=v; stock[g]-=v; });
    countUp(n,type); k++;
  }
  for (;k>0;k--) countDown(n,type);
  if (!problem && stock.some(v => v<0)) problem='Not enough materials for four';
  return { cost, problem };
}
/** Four of `type` on the block of plots at q, as if placed one by one; all or none. */
export function buildBlock(n: Nation, q: number, type: number, over: Over='any'){
  if (!n.alive || blockPlan(n,q,type,over).problem) return false;
  for (const p of blockPlots(q)) build(n,p,type,over);
  return true;
}
function countDown(n: Nation, type: number){
  if (type===B_HOUSE){ n.houses=Math.max(0,n.houses-1); n.beds=Math.max(0,n.beds-1); }   // (the census counts beds exactly, once a second)
  else if (type===B_FARM) n.farms--; else if (type===B_BARRACKS) n.barracks--; else if (type===B_TOWER) n.towers--; else if (type===B_MINTER) n.minters--;
  else if (type===B_PLANTATION) n.plantations--; else if (type===B_QUARRY) n.quarries--; else if (type===B_COPPERMINE) n.copperMines--;
  else if (type===B_RESEARCH) n.labs--; else if (type===B_GUILD) n.guilds--; else if (type===B_SMITHY) n.smithies--; else if (type===B_HOSPITAL) n.hospitals--; else if (type===B_CARPENTER) n.carpenters--; else if (type===B_NAVAL) n.navals--;
}
export function countUp(n: Nation, type: number){
  if (type===B_FARM) n.farms++; else if (type===B_BARRACKS) n.barracks++; else if (type===B_TOWER) n.towers++; else if (type===B_MINTER) n.minters++;
  else if (type===B_PLANTATION) n.plantations++; else if (type===B_QUARRY) n.quarries++; else if (type===B_COPPERMINE) n.copperMines++;
  else if (type===B_RESEARCH) n.labs++; else if (type===B_GUILD) n.guilds++; else if (type===B_SMITHY) n.smithies++; else if (type===B_HOSPITAL) n.hospitals++; else if (type===B_CARPENTER) n.carpenters++; else if (type===B_NAVAL) n.navals++;
}

/** Production buildings fill the stockpile every 30 seconds by their tier; pTimer counts their
    progress. One standing on ground the enemy holds makes nothing. */
export function produce(){
  const N=W.nations;
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive) continue;
    for (const q of n.blds){
      const out=PRODUCES[pType[q]]; if (!out || pOwner[q]!==n.id || pBurn[q]>0 || occ[pCenter[q]]) continue;
      if (++pTimer[q]>=PRODUCE_TICKS){ const k=out[1][gatherTier(q)]; pTimer[q]=0; n.stock[out[0]]+=k; on.produced(q,n.id,out[0],k); }
    }
  }
}

/** Plantations, quarries and copper mines of kingdom n join up as far as its research allows:
    at tier 3 any four of a kind filling a 2×2 square (whatever they were before) become one; at
    tier 2 two single ones of a kind side by side become one. The joined building keeps the most
    advanced of its parts' work in progress. */
export function joinGatherers(n: Nation){
  const id=n.id, mainOf=(k: number) => pType[k]===B_PART ? pMain[k] : k;
  const topFor=(ty: number) => ty===B_SMITHY ? 3 : n.tier[R_GATHER];   // (blacksmiths join up whatever is researched: they are only prettier for it)
  const kind=(k: number) => { const m=mainOf(k); return pOwner[m]===id && pBurn[m]<=0 && joinsUp(pType[m]) ? pType[m] : -1; };
  const join=(q: number, span: number, ty: number) => {
    const cells=rect(q,SPANS[span]); let timer=0, hp=0;
    for (const k of cells){ const m=mainOf(k); timer=Math.max(timer,pTimer[m]); hp=Math.max(hp,pHp[m]); }
    for (const k of cells){ pType[k]=B_PART; pMain[k]=q; pOwner[k]=id; pSpan[k]=0; pTimer[k]=0; pHp[k]=0; }
    pType[q]=ty; pSpan[q]=span; pTimer[q]=timer; pHp[q]=hp;
    for (const k of cells) on.plotChanged(k);
  };
  if (n.tier[R_GATHER]<2 && !n.smithies) return;
  const plots=n.blds.slice().sort((a,b) => a-b);   // main plots, top-left first
  for (let i=0;i<plots.length;i++){
    const q=plots[i], ty=pType[q]; if (!joinsUp(ty) || topFor(ty)<3 || pOwner[q]!==id || pSpan[q]===2 || mainOf(q)!==q) continue;
    if (q%PW+1>=PW || ((q/PW)|0)+1>=PH) continue;
    const sq=rect(q,[2,2]);
    if (!sq.every(k => kind(k)===ty && cover(mainOf(k)).every(c => sq.includes(c)))) continue;
    join(q,2,ty);
  }
  for (let i=0;i<plots.length;i++){
    const q=plots[i], ty=pType[q]; if (!joinsUp(ty) || topFor(ty)<2 || pOwner[q]!==id || pSpan[q]!==0 || mainOf(q)!==q || q%PW+1>=PW) continue;
    const r=q+1; if (pType[r]!==ty || pOwner[r]!==id || pSpan[r]!==0 || pBurn[r]>0) continue;
    join(q,1,ty);
  }
}

