/* ---------- war: claims on regions, phalanxes, battles, flags, and peace ----------
   A war is fought for regions (sim/regions.ts). It begins as a crisis: kingdom a claims a chain of
   regions controlled by d (the first beside a region a controls, each next one beside one already
   claimed). d answers: it gives them up (they are a's at once, with no blood shed), or refuses, and it
   is war (silence for CRISIS_TICKS is a refusal; bots answer within a few seconds).
   At war nothing moves on its own. Each army is a phalanx (the soldiers of a barracks, or of an
   order group of barracks, sim/army.ts) and is given orders one at a time:
     - attack (a's armies): march to the flag of a claimed region beside ground a holds, and hold it.
       Standing there alone, it lowers d's flag; once the flag is down the region is occupied, and the
       next claimed region beside it may be attacked. Regions not claimed can't be.
     - defend (d's armies): march to a claimed region and hold it. Standing there alone, it raises the
       flag again (an occupied region is won back when its flag is all the way up).
     - retreat: break off the fight and fall back to the nearest region its kingdom holds.
     - return: go home to the barracks, where the men heal and are paid less.
   One army per region and side. A defender's army holding a region whose neighbour is under attack
   with nobody of its own there marches in to defend it (the second wave). While two armies fight in a
   region its flag does not move.
   Two hostile armies that come close fight: the front ranks face each other and each man of the front
   rank fights the one opposite him, one on one (a duel: nobody joins in); when he falls, the man behind
   him in his file steps up. The army left with nobody standing has lost; its men at home are its depot.
   The war ends when a holds every region it claimed (they are its), or by peace: a's occupied regions
   are then its, the rest go back. A kingdom that loses the region of its castle falls to the winner. */
import { TW, TH, NT, NP, PW, TMULT, GAME_SPEED, WAGE, WAGE_IDLE, WAGE_ATTACK, B_CASTLE, B_CPART, isStructure } from '../core/constants';
import { W, owner, occ, terr, isLand, isle, pType, pOwner, pCenter, pHp, type Human, type Nation, type Army } from './state';
import { wear, CASTLE_MEND } from './defense';
import { on } from './events';
import { H_SOLDIER, indoors, switching, tileOf, pace, release, TASK_ROAM } from './population';
import { units, unitAt, groupKeys, groupLead, maxHp, SOLDIER_DMG, MILITIA_HIT, type Unit } from './army';
import { RG, region, holdsRegion, cedeRegion, occupyRegion, freeRegion, flagXY, CONTROL } from './regions';
import { ignite } from './buildings';
import { census } from './census';
import { setOwner } from './territory';

export const MELEE_R = 2.6;           // pixels: close enough to strike
export const HIT_TICKS = 10;          // ticks between blows (one a second)
const DUEL_R = 8;                     // pixels apart a duel holds: further, one has run and it is over
export const HIT_CHANCE = 0.7;
export const HIT_DMG = SOLDIER_DMG;   // a soldier's blow, by tier
export const MILITIA_DMG = 0.75;      // a villager with a pitchfork
export const STRIKE_SWING = 0.15;     // a blow that lands is -15%, 0 or +15% of its damage, at random
export const A_HOME = 0, A_MARCH = 1, A_HOLD = 2, A_BATTLE = 3;   // an army: at its barracks, marching, holding where it stands, fighting
export const O_NONE = 0, O_ATTACK = 1, O_DEFEND = 2, O_RETURN = 3, O_RETREAT = 4;
export const CRISIS_TICKS = 30*GAME_SPEED*10;     // the defender's time to answer claims: 30 s on the clock, then it is war
const BOT_ANSWER = 4*GAME_SPEED*10;               // a bot answers within 4 s
export const CAPTURE_TICKS = 40*GAME_SPEED*10;    // an army of CAPTURE_MEN lowers a flag in 40 s on the clock (more men faster, at most twice)
export const CAPTURE_MEN = 16;
export const MAX_CLAIMS = 4;                      // regions one crisis may claim
export const OFFER_TICKS = 300;                   // a peace offer stands 30 s
export const MAX_ALLIES = 3;
const GRUDGE_TICKS = 900;                         // a kingdom claimed on in the last 90 s won't ally with its claimant
const FILE_GAP = 2.8, RANK_GAP = 2.6;             // pixels between the files of a phalanx, and between its ranks
const ENGAGE_R = 26;                              // pixels between two hostile armies' front ranks at which they fight
const GAP = 2.2;                                  // pixels between the two front ranks in a fight
const FLAG_R = 16;                                // pixels from its flag an army holds a region
export const ARMY_SP = 4.2;                       // pixels a second a phalanx marches (on open ground)
const SAFE_TICKS = 40*GAME_SPEED*10;              // an army retreating or going home is let go for 40 s
const HEAL_TICKS = 30*GAME_SPEED*10;              // a wounded soldier at his barracks is whole again in 30 s

export const allied = (a: number, b: number) => a!==b && W.ally[a*W.M+b]===1;
export const atWar = (a: number, b: number) => W.atWar[a*W.M+b]===1;
export function alliesOf(a: number){ let k=0; for (let o=1;o<W.M;o++) if (allied(a,o)) k++; return k; }

/* ---------- per-tick lookups ---------- */
const byId = new Map<number, Human>();
const armyById = new Map<number, Army>();
let warring = new Uint8Array(1);                // per nation: at war with anyone
const led = new Set<number>();                  // soldiers moved by their army this tick
let soldiersOf: Human[][] = [];                 // per nation: soldiers out of doors and alive
export const armyOf = (id: number) => armyById.get(id);
/** Is h moved by his army (in its phalanx), not on his own? */
export const inPhalanx = (h: Human) => led.has(h.id);
/** Kingdom n's soldiers out of doors and alive, as of this tick. */
export const armiesOf = (n: number): readonly Human[] => soldiersOf[n] ?? [];
/** Is kingdom o at war with anyone? */
export const warringNow = (o: number) => warring[o]===1;

export function resetWar(M: number){
  const MM=M*M;
  W.ally=new Uint8Array(MM); W.atWar=new Uint8Array(MM); W.grudge=new Int32Array(MM).fill(-1e9); W.offers=new Int32Array(MM);
  W.wars=new Uint8Array(MM); W.aggr=new Uint8Array(MM); W.warSince=new Int32Array(MM); W.occCount=new Int32Array(MM); W.lost=new Uint8Array(MM); W.ready=new Int32Array(MM);
  W.siege=new Int32Array(M); W.siegeBy=new Uint8Array(M); W.offensive=new Uint8Array(MM); W.kills=new Int32Array(MM); W.stall=new Int32Array(MM); W.lastNet=new Int32Array(MM); W.crisisAt=new Int32Array(MM);
  W.occIsle=new Map(); W.armies=[]; W.claims=new Map();
  warring=new Uint8Array(M); soldiersOf=[]; byId.clear(); armyById.clear(); led.clear();
}

/** May h stand on ground owned by o? People keep to their own land and unclaimed ground; an army in the field goes anywhere. */
export function mayStand(h: Human, o: number){
  if (o===0 || o===h.o) return true;
  return h.war>=0 && armyById.has(h.war);
}
/** What soldier h costs a second: at home 0.22, out with his army 0.3, attacking or in a battle 0.4; militia nothing. */
export function wageOf(h: Human){
  if (h.kind!==H_SOLDIER || h.militia) return 0;
  const a=h.war>=0 ? armyById.get(h.war) : undefined;
  if (!a) return WAGE_IDLE;
  return a.mode===A_BATTLE || a.order===O_ATTACK ? WAGE_ATTACK : WAGE;
}

/* ---------- claims and crises ---------- */
/** Is a's claim on d still a crisis: made, not yet answered? */
export const inCrisis = (a: number, d: number) => !!W.aggr[a*W.M+d] && !W.wars[a*W.M+d];
/** Ticks left before d's silence on a's claims means war. */
export const crisisWait = (a: number, d: number) => Math.max(0,CRISIS_TICKS-(W.tickN-W.crisisAt[a*W.M+d]));
/** The regions a claims of d's (in a crisis, or the war for them), or none. */
export const claimsOf = (a: number, d: number): number[] => W.claims.get(a*W.M+d) ?? [];
/** Is a the attacker in its war with d (the one that claimed)? */
export const attackerIn = (a: number, d: number) => W.claims.has(a*W.M+d) && !!W.wars[a*W.M+d];
/** Does region r border ground o holds (controls and nobody occupies, or occupies)? */
export const besideHeld = (o: number, r: number) => RG.adj[r]?.some(q => holdsRegion(o,q)) ?? false;
/** Why a can't claim these regions of d's, or null. */
export function claimProblem(a: number, d: number, regions: number[]): string | null {
  const A=W.nations[a], D=W.nations[d], M=W.M;
  if (!A?.alive || !D?.alive || !d || a===d) return 'That kingdom is gone';
  if (allied(a,d)) return 'You are allies';
  if (W.wars[a*M+d] || W.wars[d*M+a]) return 'You are already at war';
  if (W.aggr[a*M+d]) return 'Your claims on them are already on the table';
  if (W.aggr[d*M+a]) return 'They have claims on you: answer them first';
  if (!regions.length) return 'Pick a region to claim';
  if (regions.length>MAX_CLAIMS) return `At most ${MAX_CLAIMS} regions at a time`;
  if (new Set(regions).size!==regions.length) return 'A region is picked twice';
  for (const r of regions) if (!r || r>=RG.n || W.rOwner[r]!==d) return 'Only regions they control can be claimed';
  if (!RG.adj[regions[0]].some(q => W.rOwner[q]===a && !W.rOcc[q])) return 'The first region must border a region you control';
  for (let i=1;i<regions.length;i++) if (!regions.slice(0,i).some(p => RG.adj[p].includes(regions[i]))) return 'Each region must border one already claimed';
  return null;
}
/** a claims regions of d's: a crisis. d gives them up, or it is war. */
export function claim(a: number, d: number, regions: number[]){
  if (claimProblem(a,d,regions)) return false;
  const M=W.M;
  W.claims.set(a*M+d,regions.slice()); W.aggr[a*M+d]=1; W.crisisAt[a*M+d]=W.tickN; W.grudge[d*M+a]=W.tickN;
  W.offers[a*M+d]=W.offers[d*M+a]=0;
  on.crisis(a,d);
  return true;
}
/** d answers a's claims: gives the regions up (they are a's, no blood shed), or refuses (war). */
export function answer(d: number, a: number, accept: boolean){
  if (!inCrisis(a,d)) return false;
  if (accept){
    const regs=claimsOf(a,d), D=W.nations[d];
    W.claims.delete(a*W.M+d); W.aggr[a*W.M+d]=0;
    on.claimsAnswered(a,d,true);
    if (D.capTile>=0 && regs.includes(region[D.capTile])) annex(d,a);   // (its castle given up: the kingdom with it)
    else for (const r of regs) cedeRegion(r,a);
    return true;
  }
  startWar(a,d);
  on.claimsAnswered(a,d,false);
  return true;
}
/** a takes its claims on d back before d has answered. */
export function deescalate(a: number, d: number){
  if (!inCrisis(a,d)) return;
  W.claims.delete(a*W.M+d); W.aggr[a*W.M+d]=0;
  on.deescalated(a,d);
}
export const deescalateProblem = (a: number, d: number) => inCrisis(a,d) ? null : W.wars[a*W.M+d] ? 'It is war: only peace ends it now' : 'No claims to take back';
function startWar(a: number, d: number){
  const M=W.M;
  for (const k of [a*M+d, d*M+a]){ W.wars[k]=1; W.atWar[k]=1; W.warSince[k]=W.tickN; W.kills[k]=0; W.offers[k]=0; }
  W.aggr[a*M+d]=0;
  warring[a]=warring[d]=1;
  on.escalated(a,d);
}
/** Why a can't go to war on d at all (whatever it claims), or null: for the screen. */
export function warProblem(a: number, d: number): string | null {
  const A=W.nations[a], D=W.nations[d];
  if (!A?.alive || !D?.alive || a===d) return 'That kingdom is gone';
  if (allied(a,d)) return 'You are allies';
  if (W.wars[a*W.M+d]) return 'You are already at war';
  if (!claimable(a,d).length) return 'No region of theirs borders a region you control';
  return null;
}
/** The regions of d's that a could claim first: those beside a region a controls. */
export function claimable(a: number, d: number){
  const out: number[]=[];
  for (let r=1;r<RG.n;r++) if (W.rOwner[r]===d && RG.adj[r].some(q => W.rOwner[q]===a && !W.rOcc[q])) out.push(r);
  return out;
}

/* ---------- peace and alliances ---------- */
/** Kingdom `from` asks `to` for peace. Bots answer when they next think; the player from the war chip. */
export function offerPeace(from: number, to: number){
  if (!W.wars[from*W.M+to] || W.offers[from*W.M+to]) return;
  W.offers[from*W.M+to]=W.tickN; on.peaceOffered(from,to);
}
export function refusePeace(from: number, to: number){ W.offers[from*W.M+to]=0; on.peaceRefused(from,to); }
/** Peace between a and b: what the attacker occupies of its claims is its; the rest is free again. Their armies go home. */
export function makePeace(a: number, b: number){
  const M=W.M;
  for (const [x,y] of [[a,b],[b,a]]){
    const regs=W.claims.get(x*M+y); if (!regs) continue;
    W.claims.delete(x*M+y);
    const won=regs.filter(r => W.rOcc[r]===x && W.rOwner[r]===y);
    for (const r of regs) if (W.rOcc[r] && !won.includes(r)) freeRegion(r);
    const Y=W.nations[y];
    if (Y.alive && Y.capTile>=0 && won.includes(region[Y.capTile])){ endWarState(a,b); annex(y,x); on.peaceMade(a,b); return; }
    for (const r of won) cedeRegion(r,x);
  }
  endWarState(a,b);
  on.peaceMade(a,b);
}
function endWarState(a: number, b: number){
  const M=W.M;
  for (const i of [a*M+b, b*M+a]){ W.offers[i]=0; W.atWar[i]=0; W.wars[i]=0; W.aggr[i]=0; W.stall[i]=0; W.lost[i]=0; W.ready[i]=0; }
  for (const x of W.armies) if ((x.o===a && x.enemy===b) || (x.o===b && x.enemy===a)) sendHome(x);
  for (const o of [a,b]){ let any=0; for (let k=1;k<M;k++) if (W.wars[o*M+k]) any=1; warring[o]=any; }
}
/** n wants the fighting with t to end: a war gets a peace offer. */
export function endWar(n: number, t: number){ if (W.wars[n*W.M+t]) offerPeace(n,t); }
/** Men of o's armies out against `vs` (or all of them in the field). */
export function menAgainst(o: number, vs?: number){ let k=0; for (const a of W.armies) if (a.o===o && a.mode!==A_HOME && (vs===undefined || a.enemy===vs)) k+=a.men; return k; }
/** How the fighting with o is going for n: above 0 winning, below 0 losing. */
export function outlook(n: Nation, o: number){
  const M=W.M, mine=claimsOf(n.id,o), theirs=claimsOf(o,n.id);
  let gained=0; for (const r of mine) if (W.rOcc[r]===n.id) gained++; for (const r of theirs) if (W.rOcc[r]===o) gained--;
  const field=menAgainst(n.id,o), other=menAgainst(o,n.id);
  return 0.6*Math.log((n.soldiers+1)/(W.nations[o].soldiers+1)) + gained/Math.max(1,mine.length+theirs.length) + (field-other)/(field+other+5) - (W.kills[o*M+n.id]-W.kills[n.id*M+o])/(W.kills[o*M+n.id]+W.kills[n.id*M+o]+10);
}
/** Ticks since the war between a and b began (0 at peace). */
export const warAge = (a: number, b: number) => W.wars[a*W.M+b] ? W.tickN-W.warSince[a*W.M+b] : 0;
/** A bot weighing peace with o: it holds out while it thinks it can win, and gives in when it is in trouble; a long war wears it down. */
export function wantsPeace(n: Nation, o: number){
  return outlook(n,o) + (W.srand()-0.5)*0.5 - Math.min(1,warAge(n.id,o)/6000) < 0;
}
/** Why a can't propose an alliance to b, or null. */
export function allyProblem(a: number, b: number): string | null {
  const A=W.nations[a], B=W.nations[b];
  if (!A?.alive || !B?.alive || !b || a===b) return 'That kingdom is gone';
  if (allied(a,b)) return 'You are already allies';
  if (atWar(a,b) || inCrisis(a,b) || inCrisis(b,a)) return 'Settle your quarrel first';
  if (alliesOf(a)>=MAX_ALLIES) return `You already have ${MAX_ALLIES} allies`;
  return null;
}
/** What b says to an alliance with a: null if it agrees, otherwise why not. */
export function allyAnswer(a: number, b: number): string | null {
  const A=W.nations[a], B=W.nations[b];
  if (alliesOf(b)>=MAX_ALLIES) return `${B.name} has all the allies it wants`;
  if (W.tickN-W.grudge[b*W.M+a] < GRUDGE_TICKS) return `${B.name} has not forgotten your claims`;
  if (A.strength < B.strength*0.4) return `${B.name} thinks you too weak to be worth it`;
  return null;
}
export function proposeAlliance(a: number, b: number){
  if (allyProblem(a,b)) return;
  const no=allyAnswer(a,b);
  if (no){ on.allyRefused(a,b,no); return; }
  W.ally[a*W.M+b]=W.ally[b*W.M+a]=1;
  on.allied(a,b);
}

/* ---------- a kingdom falls ---------- */
/** The loser's castle is lost: its land, buildings and people go to the winner; its gold and goods are lost. */
export function annex(loser: number, winner: number){
  const L=W.nations[loser], cap=L.capTile>=0 ? L.capPlot : -1;
  L.capTile=-1;   // so taking the ground below doesn't count as an ordinary sack
  for (const h of W.humans){
    if (h.o!==loser) continue;
    release(h); h.o=winner; h.post=-1; h.site=-1; h.war=-1; h.boat=-1; h.foe=-1; h.aim=-1; h.brave=-1; h.calm=0; h.work=-1; h.base=-1; h.duel=-1;
    h.task=TASK_ROAM; h.path=[]; h.wait=0; h.tx=h.x; h.ty=h.y;
  }
  for (let q=0;q<NP;q++){
    if (pOwner[q]!==loser) continue;
    if (pType[q]===B_CASTLE || pType[q]===B_CPART) continue;
    if (isStructure(pType[q])) pOwner[q]=winner;
    on.plotChanged(q);
  }
  if (cap>=0) for (const k of [cap,cap+1,cap+PW,cap+PW+1]) ignite(k);
  W.armies=W.armies.filter(x => x.o!==loser);
  for (const x of W.armies) if (x.enemy===loser) sendHome(x);
  W.ships=W.ships.filter(s => s.o!==loser); W.invasions=W.invasions.filter(i => i.a!==loser);
  L.gold=0; L.stock=[0,0,0];
  for (let r=1;r<RG.n;r++) if (W.rOcc[r]===loser) freeRegion(r);
  const M=W.M;
  for (let o=1;o<M;o++){ W.claims.delete(loser*M+o); W.claims.delete(o*M+loser); const i=loser*M+o, j=o*M+loser; W.ally[i]=W.ally[j]=W.offers[i]=W.offers[j]=W.atWar[i]=W.atWar[j]=W.wars[i]=W.wars[j]=W.aggr[i]=W.aggr[j]=W.lost[i]=W.lost[j]=W.ready[i]=W.ready[j]=0; }
  for (let t=0;t<NT;t++) if (owner[t]===loser) setOwner(t,winner,true);   // the last tile eliminates it
  for (let o=1;o<M;o++){ let any=0; for (let k=1;k<M;k++) if (W.wars[o*M+k]) any=1; warring[o]=any; }
  census();
  on.annexed(loser,winner);
}

/* ---------- the armies ---------- */
/** Where army x stands at home, and the way it faces: beside its lead barracks, on the first side (south, north, east, west) where the
    whole phalanx stands on open ground of its own (not on the castle or another building); in front of it if none is clear. */
function homeSpot(x: Army): [number, number, number, number] {
  const u=unitAt(x.id) ?? x.plots.map(q => unitAt(q)).find(v => !!v);
  if (!u) return [x.x, x.y, 0, 1];
  const F=Math.max(1,x.files.length), ranks=Math.max(1,Math.ceil(Math.max(1,x.men)/F)), half=(F-1)/2*FILE_GAP+1.5, deep=(ranks-1)*RANK_GAP;
  const xs=u.plots.map(q => (q%PW)*8), ys=u.plots.map(q => ((q/PW)|0)*8);
  const left=Math.min(...xs), right=Math.max(...xs)+8, top=Math.min(...ys), bottom=Math.max(...ys)+8, mx=(left+right)/2, my=(top+bottom)/2;
  // [front-rank middle x, y, facing x, y]: the ranks stand behind the front, toward the barracks
  const sides: [number, number, number, number][]=[[mx,bottom+3+deep,0,1],[mx,top-3-deep,0,-1],[right+3+deep,my,1,0],[left-3-deep,my,-1,0]];
  const clear=(c: [number, number, number, number]) => {
    const [fx,fy,dx,dy]=c, rx=-dy, ry=dx;
    for (const a of [-half,0,half]) for (const b of [0,deep]){
      const px=fx+rx*a-dx*b, py=fy+ry*a-dy*b, t=tileOf(px,py);
      if (px<0 || py<0 || px>=TW*2 || py>=TH*2 || !isLand[t] || owner[t]!==x.o) return false;
      const q=((py/8)|0)*PW+((px/8)|0), ty=pType[q]; if (ty===B_CASTLE || ty===B_CPART || (isStructure(ty) && !u.plots.includes(q))) return false;
    }
    return true;
  };
  return sides.find(clear) ?? sides[0];
}
/** The armies follow the barracks: one for each order group (or barracks on its own), found again by any of its plots. */
function syncArmies(){
  const byPlot=new Map<number, Army>(); for (const x of W.armies) for (const q of x.plots) byPlot.set(q,x);
  const seen=new Set<Army>(), keep: Army[]=[];
  for (const n of W.nations){
    if (!n.alive) continue;
    for (const u of units[n.id] ?? []){
      if (groupLead(n.id,u.key)!==u.key) continue;
      const us=groupKeys(n.id,u.key).map(k => unitAt(k)).filter((v): v is Unit => !!v), plots=us.flatMap(v => v.plots);
      let x: Army | undefined;
      for (const q of u.plots){ const y=byPlot.get(q); if (y && !seen.has(y) && y.o===n.id){ x=y; break; } }
      if (!x) for (const q of plots){ const y=byPlot.get(q); if (y && !seen.has(y) && y.o===n.id){ x=y; break; } }
      if (!x){ x={ id:u.key, o:n.id, plots, x:u.x, y:u.y+4, fx:0, fy:1, mode:A_HOME, order:O_NONE, goal:0, enemy:0, path:[], foe:-1, files:[], men:0, safe:0, stand:false, hitAt:-1e9, leader:-1 }; }
      if (W.armies.some(y => y!==x && y.id===x!.id && seen.has(y))) x.id=u.key;   // (two with one name: the new one takes its lead's)
      x.plots=plots; seen.add(x); keep.push(x);
    }
  }
  for (const x of W.armies) if (!seen.has(x)){ for (const h of W.humans) if (h.war===x.id && h.o===x.o) h.war=-1; }   // (its barracks are gone: its men are on their own)
  W.armies=keep.sort((a,b) => a.o-b.o || a.id-b.id);
  armyById.clear(); for (const x of W.armies) armyById.set(x.id,x);
}
/** The soldiers of army x: everyone of its barracks. */
function membersOf(x: Army): Human[] {
  const out: Human[]=[], done=new Set<Unit>();
  for (const q of x.plots){ const u=unitAt(q); if (!u || done.has(u)) continue; done.add(u); for (const h of u.members) out.push(h); }
  return out;
}
const fit = (h: Human) => h.hp>0 && !indoors(h) && !switching(h) && h.boat<0;
/** How many files a phalanx of n men has: wide and shallow. */
const filesFor = (n: number) => n<=0 ? 0 : Math.max(1,Math.min(n,Math.round(Math.sqrt(n*2.2))));
/** Keeps x's files to its men: the fallen leave their file (the man behind steps up), newcomers join the shortest file at its back, and the files stay even. */
function tidyFiles(x: Army, men: Human[]){
  const ids=new Set<number>(); for (const h of men) ids.add(h.id);
  const placed=new Set<number>();
  for (let i=0;i<x.files.length;i++){ x.files[i]=x.files[i].filter(id => ids.has(id) && !placed.has(id)); for (const id of x.files[i]) placed.add(id); }
  x.files=x.files.filter(f => f.length);
  const loose: number[]=[]; for (const h of men) if (!placed.has(h.id)) loose.push(h.id);
  const F=filesFor(men.length);
  while (x.files.length>F){ const f=x.files.length%2 ? x.files.pop()! : x.files.shift()!; loose.push(...f); }
  while (x.files.length<F) if (x.files.length%2) x.files.push([]); else x.files.unshift([]);
  for (const id of loose){ let s=0; for (let i=1;i<x.files.length;i++) if (x.files[i].length<x.files[s].length) s=i; x.files[s].push(id); }
  for (let k=0;k<50 && x.files.length>1;k++){
    let lo=0, hi=0; for (let i=1;i<x.files.length;i++){ if (x.files[i].length<x.files[lo].length) lo=i; if (x.files[i].length>x.files[hi].length) hi=i; }
    if (x.files[hi].length-x.files[lo].length<2) break;
    x.files[lo].push(x.files[hi].pop()!);
  }
  x.men=men.length;
}
/** The place of the man in file i, rank j of army x, in pixels. */
function slotOf(x: Army, i: number, j: number): [number, number] {
  const F=x.files.length, rx=-x.fy, ry=x.fx, s=(i-(F-1)/2)*FILE_GAP, b=j*RANK_GAP;
  return [x.x+rx*s-x.fx*b, x.y+ry*s-x.fy*b];
}
/** Is pixel (x,y) on a castle (its walls: nobody walks across them)? */
function onCastle(x: number, y: number){
  if (x<0 || y<0 || x>=TW*2 || y>=TH*2) return false;
  const q=((y/8)|0)*PW+((x/8)|0), ty=pType[q]; return ty===B_CASTLE || ty===B_CPART;
}
/** A man walks to (gx,gy) at his pace (quicker if he has fallen behind), over land and round a castle's walls. */
function walk(h: Human, gx: number, gy: number, quick=1){
  const dx=gx-h.x, dy=gy-h.y, d=Math.hypot(dx,dy); if (d<0.05) return;
  const sp=pace(h)*(d>6 ? 1.6 : 1.1)*quick, st=Math.min(d,sp*0.1), ux=dx/d, uy=dy/d;
  // straight on, or (a wall in the way) along it: sideways, whichever way gets him nearer
  for (const [vx,vy] of [[ux,uy],[ux,0],[0,uy],[-uy,ux],[uy,-ux]]){
    const L=Math.hypot(vx,vy); if (L<1e-6) continue;
    const nx=h.x+vx/L*st, ny=h.y+vy/L*st;
    if (onCastle(nx,ny) && !onCastle(h.x,h.y)) continue;
    const t=tileOf(nx,ny); if (!isLand[t] && isLand[tileOf(h.x,h.y)]) continue;   // (a place over the water: he waits on the shore)
    if (!mayStand(h,owner[t])) continue;
    h.x=nx; h.y=ny; return;
  }
}

/* ---------- the way there ---------- */
let gCost=new Float32Array(0), gSeen=new Int32Array(0), gFrom=new Int32Array(0), gSeq=0;
let heap=new Int32Array(0), heapK=new Float32Array(0);
/** A way for kingdom o's army from pixel (sx,sy) to (gx,gy) over land: its own, unclaimed, its enemies' and allies' ground (a third kingdom's only if there is no other way); waypoints in pixels. */
export function findWay(o: number, sx: number, sy: number, gx: number, gy: number): number[] {
  const s=tileOf(sx,sy), g=tileOf(gx,gy);
  if (gCost.length!==NT){ gCost=new Float32Array(NT); gSeen=new Int32Array(NT); gFrom=new Int32Array(NT); heap=new Int32Array(NT); heapK=new Float32Array(NT); }
  // first the regions it passes through (a search over a few hundred regions), then the way over the tiles of those regions and their neighbours only
  if (isle[s] && isle[g] && isle[s]!==isle[g]) return [gx,gy];   // (no way on foot)
  const lane=corridor(o,region[s],region[g]);
  if (lane){ const way=astar(o,s,g,0,0,TW-1,TH-1,lane); if (way) return way.concat([gx,gy]); }
  for (const margin of [60, 1e9]){
    const x0=Math.max(0,Math.min(s%TW,g%TW)-margin), x1=Math.min(TW-1,Math.max(s%TW,g%TW)+margin), y0=Math.max(0,Math.min((s/TW)|0,(g/TW)|0)-margin), y1=Math.min(TH-1,Math.max((s/TW)|0,(g/TW)|0)+margin);
    const way=astar(o,s,g,x0,y0,x1,y1,null);
    if (way) return way.concat([gx,gy]);
  }
  return [gx,gy];
}
/** The regions on the way from region a to region b for o's army (Dijkstra between their flags, a third kingdom's regions dearer), with their neighbours: or null. */
function corridor(o: number, a: number, b: number): Uint8Array | null {
  if (!a || !b) return null;
  const n=RG.n, M=W.M, dist=new Float64Array(n).fill(Infinity), from=new Int32Array(n).fill(-1), done=new Uint8Array(n);
  const fx=(r: number) => RG.flag[r]%TW, fy=(r: number) => (RG.flag[r]/TW)|0;
  dist[a]=0;
  for (;;){
    let u=-1, bd=Infinity; for (let r=1;r<n;r++) if (!done[r] && dist[r]<bd){ bd=dist[r]; u=r; }
    if (u<0 || u===b) break;
    done[u]=1;
    for (const v of RG.adj[u]){
      const w=W.rOwner[v], third=w && w!==o && !W.atWar[o*M+w] && !W.ally[o*M+w] ? 3 : 1;
      const nd=dist[u]+Math.hypot(fx(u)-fx(v),fy(u)-fy(v))*third;
      if (nd<dist[v]){ dist[v]=nd; from[v]=u; }
    }
  }
  if (!isFinite(dist[b])) return null;
  const lane=new Uint8Array(n);
  for (let r=b; r>=0; r=from[r]){ lane[r]=1; for (const q of RG.adj[r]) lane[q]=1; if (r===a) break; }
  return lane;
}
function astar(o: number, s: number, g: number, x0: number, y0: number, x1: number, y1: number, lane: Uint8Array | null): number[] | null {
  const stamp=++gSeq, gx=g%TW, gy=(g/TW)|0, M=W.M;
  const cost=(t: number) => { const w=owner[t]; let c=TMULT[terr[t]] || 1; if (w && w!==o && !W.atWar[o*M+w] && !W.ally[o*M+w]) c*=3; return c; };
  const h=(t: number) => { const dx=Math.abs(t%TW-gx), dy=Math.abs(((t/TW)|0)-gy); return (dx+dy-0.59*Math.min(dx,dy))*1.5; };   // (weighted: a little longer than the best way, found far quicker)
  let n=0;
  const push=(t: number, k: number) => { let i=n++; while (i>0){ const p=(i-1)>>1; if (heapK[p]<=k) break; heap[i]=heap[p]; heapK[i]=heapK[p]; i=p; } heap[i]=t; heapK[i]=k; };
  const pop=() => { const top=heap[0], lt=heap[--n], lk=heapK[n]; let i=0; for (;;){ let c=2*i+1; if (c>=n) break; if (c+1<n && heapK[c+1]<heapK[c]) c++; if (heapK[c]>=lk) break; heap[i]=heap[c]; heapK[i]=heapK[c]; i=c; } heap[i]=lt; heapK[i]=lk; return top; };
  gSeen[s]=stamp; gCost[s]=0; gFrom[s]=-1; push(s,h(s));
  let found=false, steps=0;
  while (n>0 && steps++<250000){
    const c=pop(); if (c===g){ found=true; break; }
    const cx=c%TW, cy=(c/TW)|0, base=gCost[c];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
      if (!dx && !dy) continue;
      const nx=cx+dx, ny=cy+dy; if (nx<x0 || ny<y0 || nx>x1 || ny>y1) continue;
      const k=ny*TW+nx; if (!isLand[k] && k!==g) continue;
      if (lane && !lane[region[k]] && k!==g) continue;
      if (dx && dy && (!isLand[cy*TW+nx] || !isLand[ny*TW+cx])) continue;   // (no cutting a corner of the sea)
      const ng=base+cost(k)*(dx && dy ? 1.414 : 1);
      if (gSeen[k]===stamp && gCost[k]<=ng) continue;
      gSeen[k]=stamp; gCost[k]=ng; gFrom[k]=c; push(k,ng+h(k));
    }
  }
  if (!found) return null;
  const tiles: number[]=[]; for (let t=g; t>=0; t=gFrom[t]) tiles.push(t);
  tiles.reverse();
  const out: number[]=[]; for (let i=4;i<tiles.length-1;i+=4) out.push((tiles[i]%TW)*2+1, ((tiles[i]/TW)|0)*2+1);
  return out;
}

/* ---------- orders ---------- */
/** Why army `id` of kingdom o can't take this order, or null. */
export function armyProblem(o: number, id: number, order: string, r=0): string | null {
  const x=armyById.get(id); if (!x || x.o!==o) return 'That army is gone';
  if (order==='return'){ if (x.mode===A_HOME) return 'It is at home'; return null; }
  if (order==='retreat'){ if (x.mode===A_HOME) return 'It is at home'; if (x.order===O_RETREAT) return 'It is retreating'; return null; }
  if (x.mode===A_BATTLE) return 'It is fighting: it can only retreat or go home';
  if (x.mode===A_HOME && !membersOf(x).some(fit)) return 'Nobody of it is at home';
  if (!r || r>=RG.n) return 'Pick a region';
  if (isle[tileOf(...homeOrHere(x))]!==RG.isle[r]) return 'It can\'t get there by land';
  const M=W.M, d=W.rOwner[r];
  if (W.armies.some(y => y!==x && y.o===o && y.goal===r && (y.order===O_ATTACK || y.order===O_DEFEND) && (y.men>0 || y.mode===A_MARCH))) return 'One army per region: another of yours is there';
  if (order==='attack'){
    if (!d || !W.wars[o*M+d] || !claimsOf(o,d).includes(r)) return 'Only the regions you claimed in a war can be attacked';
    if (W.rOcc[r]===o) return 'You hold it already';
    if (!besideHeld(o,r)) return 'Take the claimed region before it first: it must border ground you hold';

    return null;
  }
  if (order==='defend'){
    if (d!==o) return 'Only your own regions can be defended';
    let claimed=false; for (let a=1;a<M;a++) if (W.wars[a*M+o] && claimsOf(a,o).includes(r)) claimed=true;
    if (!claimed) return 'Only regions claimed in a war on you can be defended';
    return null;
  }
  return 'Unknown order';
}
/** Where x stands: in the field, or (at home) at its barracks' door. */
function homeOrHere(x: Army): [number, number] { if (x.mode!==A_HOME) return [x.x, x.y]; const u=unitAt(x.id) ?? x.plots.map(q => unitAt(q)).find(v => !!v); return u ? [u.x, u.y-2] : [x.x, x.y]; }
/** Gives army `id` of kingdom o an order (see the top of this file). */
export function armyOrder(o: number, id: number, order: string, r=0){
  if (armyProblem(o,id,order,r)) return false;
  const x=armyById.get(id)!;
  if (order==='return'){ sendHome(x); return true; }
  if (order==='retreat'){ retreat(x); return true; }
  const M=W.M, d=W.rOwner[r];
  let enemy=0;
  if (order==='attack') enemy=d;
  else for (let a=1;a<M;a++) if (W.wars[a*M+o] && claimsOf(a,o).includes(r)){ enemy=a; break; }
  sendOut(x,r,order==='attack' ? O_ATTACK : O_DEFEND,enemy);
  on.armyOrdered(o,x.id,order,r);
  return true;
}
/** x marches for region r's flag. */
function sendOut(x: Army, r: number, order: number, enemy: number){
  if (x.mode===A_HOME){
    let k=0;
    for (const h of membersOf(x)) if (fit(h) && h.war<0){ h.war=x.id; h.foe=-1; h.duel=-1; h.path=[]; h.task=TASK_ROAM; k++; }
    x.men=k;
  }
  x.order=order; x.goal=r; x.enemy=enemy; x.foe=-1; x.safe=0;
  const [fx,fy]=flagXY(r);
  x.path=findWay(x.o,x.x,x.y,fx,fy); x.mode=A_MARCH;
}
/** x goes home to its barracks. */
function sendHome(x: Army){
  if (x.mode===A_HOME) return;
  breakOff(x);
  const [hx,hy]=homeSpot(x);
  x.order=O_RETURN; x.goal=0; x.enemy=0; x.safe=W.tickN+SAFE_TICKS;
  x.path=findWay(x.o,x.x,x.y,hx,hy); x.mode=A_MARCH;
}
/** x breaks off its fight and falls back to the nearest region its kingdom holds (not occupied). */
function retreat(x: Army){
  breakOff(x);
  let best=0, bd=Infinity;
  for (let r=1;r<RG.n;r++){ if (W.rOwner[r]!==x.o || W.rOcc[r] || RG.flag[r]<0) continue; const [fx,fy]=flagXY(r), d=(fx-x.x)**2+(fy-x.y)**2; if (d<bd && region[tileOf(x.x,x.y)]!==r){ bd=d; best=r; } }
  if (!best){ sendHome(x); return; }
  const [fx,fy]=flagXY(best);
  x.order=O_RETREAT; x.goal=best; x.enemy=0; x.safe=W.tickN+SAFE_TICKS;
  x.path=findWay(x.o,x.x,x.y,fx,fy); x.mode=A_MARCH;
  on.armyOrdered(x.o,x.id,'retreat',best);
}
/** x's fight is over for it: its foe goes back to what it was doing. */
function breakOff(x: Army){
  const f=x.foe>=0 ? armyById.get(x.foe) : undefined;
  if (f && f.foe===x.id){ f.foe=-1; f.mode=f.path.length ? A_MARCH : f.mode===A_BATTLE ? A_HOLD : f.mode; }
  x.foe=-1;
  if (x.mode===A_BATTLE) x.mode=x.path.length ? A_MARCH : A_HOLD;
  for (const id of x.files.flat()){ const h=byId.get(id); if (h){ h.duel=-1; h.foe=-1; } }
}

/* ---------- each tick ---------- */
export function updateWar(){
  const N=W.nations, M=W.M;
  byId.clear(); for (const h of W.humans) byId.set(h.id,h);
  soldiersOf=N.map(() => []);
  for (const h of W.humans) if (h.kind===H_SOLDIER && h.hp>0 && !indoors(h)) soldiersOf[h.o].push(h);
  warring.fill(0); for (let a=1;a<M;a++) for (let b=1;b<M;b++) if (W.wars[a*M+b]){ warring[a]=1; break; }
  // crises: a bot answers within seconds, silence is a refusal
  for (const [k] of W.claims){
    const a=(k/M)|0, d=k%M; if (!inCrisis(a,d)) continue;
    const age=W.tickN-W.crisisAt[k], D=N[d];
    if (!D.isPlayer && age>=BOT_ANSWER) answer(d,a,botAccepts(D,a));
    else if (age>=CRISIS_TICKS) answer(d,a,false);
  }
  // each castle mends itself, 2 blows a second
  for (let i=1;i<N.length;i++){ const n=N[i], q=n.capPlot; if (!n.alive || n.capTile<0 || pHp[q]<=0) continue; const was=wear(q); pHp[q]=Math.max(0,pHp[q]-CASTLE_MEND); if (wear(q)!==was) on.plotChanged(q); }
  syncArmies();
  led.clear();
  for (const x of W.armies) stepArmy(x);
  if (W.tickN%5===0) engage();
  for (const x of W.armies) if (x.mode===A_BATTLE && x.foe>=0 && x.id<x.foe){ const y=armyById.get(x.foe); if (y) fight(x,y); }
  for (const x of W.armies) if (x.mode===A_BATTLE && (x.foe<0 || !armyById.has(x.foe))){ x.foe=-1; x.mode=x.path.length ? A_MARCH : A_HOLD; }
  if (W.tickN%5===0) flags();
  if (W.tickN%20===7) secondWave();
}
/** A bot answers claims on it: it gives up the regions only to a kingdom far stronger than it, and only a few of them. */
function botAccepts(D: Nation, a: number){
  const A=W.nations[a], regs=claimsOf(a,D.id).length;
  return A.strength>D.strength*(2+regs*0.4) && W.srand()<0.8;
}
/** One tick of army x: the men of its phalanx to their places, and the phalanx on its way. */
function stepArmy(x: Army){
  const all=membersOf(x);
  const men=x.mode===A_HOME ? all.filter(h => fit(h) && h.war<0) : all.filter(h => h.war===x.id && h.hp>0 && !indoors(h));
  tidyFiles(x,men);
  if (x.mode!==A_HOME && !men.length){ lost(x); return; }
  if (x.mode===A_HOME){
    const [hx,hy,fx,fy]=homeSpot(x); x.x=hx; x.y=hy; x.fx=fx; x.fy=fy;
    const heal=1/HEAL_TICKS;
    for (const h of men){ if (h.hp<maxHp(h)) h.hp=Math.min(maxHp(h),h.hp+maxHp(h)*heal); }
  } else if (x.mode===A_MARCH){
    march(x,men);
  }
  // the men to their places (in a battle, the front rank's fighters are moved by the fight)
  const busy=x.mode===A_BATTLE;
  for (let i=0;i<x.files.length;i++){
    const f=x.files[i];
    for (let j=0;j<f.length;j++){
      const h=byId.get(f[j]); if (!h) continue;
      led.add(h.id);
      if (h.cool>0) h.cool--;
      if (j>0 && h.duel>=0){ const p=byId.get(h.duel); if (p && p.duel===h.id) p.duel=-1; h.duel=-1; }   // (only the front rank fights: a man who is no longer in it is out of his duel)
      if (busy && j===0) continue;
      const [sx,sy]=slotOf(x,i,j);
      walk(h,sx,sy);
    }
  }
}
/** The phalanx marches along its way, as fast as its men keep up. */
function march(x: Army, men: Human[]){
  if (!x.path.length){ arrive(x); return; }
  const gx=x.path[0], gy=x.path[1], dx=gx-x.x, dy=gy-x.y, d=Math.hypot(dx,dy);
  // how far its men are from their places: a phalanx waits for its stragglers
  let lag=0, k=0; for (let i=0;i<x.files.length;i++){ const h=byId.get(x.files[i][0]); if (h){ const [sx,sy]=slotOf(x,i,0); lag+=Math.hypot(h.x-sx,h.y-sy); k++; } }
  lag/=Math.max(1,k);
  const t=tileOf(x.x,x.y), tm=TMULT[terr[t]] || 1, sp=ARMY_SP/Math.sqrt(tm)*(lag>14 ? 0.25 : lag>7 ? 0.6 : 1)*0.1;
  if (d<=sp || d<0.01){ x.x=gx; x.y=gy; x.path.splice(0,2); if (!x.path.length) arrive(x); return; }
  const ux=dx/d, uy=dy/d;
  x.x+=ux*sp; x.y+=uy*sp;
  // it turns toward its way, a little at a time
  const nx=x.fx*0.85+ux*0.15, ny=x.fy*0.85+uy*0.15, L=Math.hypot(nx,ny)||1; x.fx=nx/L; x.fy=ny/L;
  void men;
}
/** x has reached the end of its way. */
function arrive(x: Army){
  if (x.order===O_RETURN){
    x.mode=A_HOME; x.order=O_NONE; x.goal=0; x.enemy=0; x.foe=-1; x.safe=0;
    for (const h of membersOf(x)) if (h.war===x.id){ h.war=-1; h.foe=-1; h.duel=-1; }
    return;
  }
  x.mode=A_HOLD;
  if (x.order===O_RETREAT){ x.order=O_NONE; x.goal=0; }
}
/** An army with nobody left in the field: it has lost (its men at home stay its depot). */
function lost(x: Army){
  breakOff(x);
  const was=x.goal;
  x.mode=A_HOME; x.order=O_NONE; x.goal=0; x.enemy=0; x.path=[]; x.files=[]; x.men=0; x.safe=0;
  on.armyLost(x.o,x.id,was);
}
/** Hostile armies close enough take each other on (one fight each: an army already fighting is left to it). */
function engage(){
  const A=W.armies, M=W.M, now=W.tickN;
  for (let i=0;i<A.length;i++){
    const x=A[i]; if (x.mode===A_HOME || x.mode===A_BATTLE || x.safe>now || !x.men) continue;
    let best: Army | undefined, bd=ENGAGE_R*ENGAGE_R;
    for (let j=0;j<A.length;j++){
      const y=A[j]; if (y===x || y.mode===A_HOME || y.mode===A_BATTLE || y.safe>now || !y.men || !W.atWar[x.o*M+y.o]) continue;
      const d=(x.x-y.x)**2+(x.y-y.y)**2; if (d<bd){ bd=d; best=y; }
    }
    if (!best) continue;
    const y=best;
    x.stand=x.mode===A_HOLD; y.stand=y.mode===A_HOLD;
    x.mode=y.mode=A_BATTLE; x.foe=y.id; y.foe=x.id;
    on.battle(x.o,y.o,(x.x+y.x)/2,(x.y+y.y)/2);
  }
}
/** One tick of the fight between x and y: the phalanxes close, and the front ranks fight man to man. */
function fight(x: Army, y: Army){
  let dx=y.x-x.x, dy=y.y-x.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
  x.fx=dx; x.fy=dy; y.fx=-dx; y.fy=-dy;
  // the one holding its ground stays; the other comes up to it (both, if both or neither held)
  const step=ARMY_SP*0.1;
  const close=(m: Army, tx: number, ty: number) => { const ex=tx-m.x, ey=ty-m.y, e=Math.hypot(ex,ey); if (e<=step){ m.x=tx; m.y=ty; } else { m.x+=ex/e*step; m.y+=ey/e*step; } };
  if (x.stand && !y.stand) close(y,x.x+dx*GAP,x.y+dy*GAP);
  else if (y.stand && !x.stand) close(x,y.x-dx*GAP,y.y-dy*GAP);
  else { const mx=(x.x+y.x)/2, my=(x.y+y.y)/2; close(x,mx-dx*GAP/2,my-dy*GAP/2); close(y,mx+dx*GAP/2,my+dy*GAP/2); }
  // the front ranks: each man faces the one opposite him (lined up across, from the middle out)
  const rx=-dy, ry=dx;
  const front=(m: Army) => { const out: { h: Human; s: number }[]=[]; for (const f of m.files){ const h=byId.get(f[0]); if (h) out.push({ h, s:(h.x-x.x)*rx+(h.y-x.y)*ry }); } return out.sort((p,q) => p.s-q.s); };
  const fa=front(x), fb=front(y), off=(fa.length-fb.length)/2;
  for (let i=0;i<fa.length;i++){
    const j=Math.round(i-off), h=fa[i].h, e=j>=0 && j<fb.length ? fb[j].h : undefined;
    if (!e){ const k=x.files.findIndex(f => f[0]===h.id); const [sx,sy]=slotOf(x,k,0); walk(h,sx,sy); continue; }
    duelStep(h,e);
  }
  for (let j=0;j<fb.length;j++){
    const i=Math.round(j+off); if (i>=0 && i<fa.length) continue;
    const h=fb[j].h, k=y.files.findIndex(f => f[0]===h.id); const [sx,sy]=slotOf(y,k,0); walk(h,sx,sy);
  }
}
/** Two men of the front ranks fight: each steps up to the other and strikes when he can reach. */
function duelStep(h: Human, e: Human){
  const d=Math.hypot(e.x-h.x,e.y-h.y);
  if (d>MELEE_R*0.85){ walk(h,e.x,e.y); walk(e,h.x,h.y); }
  if (Math.hypot(e.x-h.x,e.y-h.y)<=MELEE_R){ strike(h,e); strike(e,h); }
}

/* ---------- the flags ---------- */
/** Every 5 ticks: an army alone at a region's flag lowers it (an enemy's) or raises it (its own); a fight there stops it. */
function flags(){
  const at=new Map<number, Army[]>(), fighting=new Set<number>();
  for (const x of W.armies){
    if (x.mode===A_HOME || !x.men) continue;
    const r=region[tileOf(x.x,x.y)]; if (!r) continue;
    if (x.mode===A_BATTLE){ fighting.add(r); continue; }
    if (x.mode!==A_HOLD) continue;
    const [fx,fy]=flagXY(r); if ((fx-x.x)**2+(fy-x.y)**2>FLAG_R*FLAG_R) continue;
    let a=at.get(r); if (!a){ a=[]; at.set(r,a); } a.push(x);
  }
  for (const [r,list] of at){
    if (fighting.has(r)) continue;
    const d=W.rOwner[r]; if (!d) continue;
    const own=list.filter(x => x.o===d), foes=list.filter(x => x.o!==d && W.atWar[x.o*W.M+d] && claimsOf(x.o,d).includes(r));
    if (own.length && foes.length) continue;
    const rate=(men: number) => 5/CAPTURE_TICKS*Math.max(0.5,Math.min(2,men/CAPTURE_MEN));
    if (foes.length){
      const a=foes[0].o; if (W.rOcc[r]===a) continue;
      let men=0; for (const x of foes) men+=x.men;
      W.rFlag[r]-=rate(men);
      if (W.rFlag[r]<=0){ W.rFlag[r]=0; occupyRegion(r,a); on.regionTaken(r,a,d); checkVictory(a,d); }
    } else if (own.length){
      let men=0; for (const x of own) men+=x.men;
      W.rFlag[r]=Math.min(1,W.rFlag[r]+rate(men));
      if (W.rFlag[r]>=1 && W.rOcc[r]){ const a=W.rOcc[r]; freeRegion(r); W.rFlag[r]=1; on.regionTaken(r,d,a); }
    }
  }
  // a flag nobody stands at, half lowered, slowly goes back up
  for (let r=1;r<RG.n;r++) if (!W.rOcc[r] && W.rOwner[r] && W.rFlag[r]<1 && !at.has(r) && !fighting.has(r)) W.rFlag[r]=Math.min(1,W.rFlag[r]+1/CAPTURE_TICKS);
}
/** a holds every region it claimed of d's: the war is won, and they are its. */
function checkVictory(a: number, d: number){
  const regs=claimsOf(a,d); if (!regs.length || !regs.every(r => W.rOcc[r]===a)) return;
  on.warWon(a,d);
  makePeace(a,d);
}
/** The second wave: a defender's army holding a claimed region, with the region beside it under attack and nobody of its own there, marches in to defend it. */
function secondWave(){
  const M=W.M;
  for (const [k,regs] of W.claims){
    const a=(k/M)|0, d=k%M; if (!W.wars[k]) continue;
    for (const r of regs){
      if (W.rOwner[r]!==d) continue;
      const threat=W.armies.some(x => x.o===a && x.goal===r && x.men>0 && x.mode!==A_HOME);
      if (!threat) continue;
      if (W.armies.some(x => x.o===d && x.goal===r && x.men>0 && (x.order===O_DEFEND))) continue;
      let best: Army | undefined, bd=Infinity; const [fx,fy]=flagXY(r);
      for (const x of W.armies){
        if (x.o!==d || x.order!==O_DEFEND || x.mode!==A_HOLD || !x.men || !x.goal || x.goal===r || !RG.adj[r].includes(x.goal)) continue;
        if (W.armies.some(y => y.o===a && y.goal===x.goal && y.men>0 && y.mode!==A_HOME)) continue;   // (its own region is under attack too)
        const dd=(x.x-fx)**2+(x.y-fy)**2; if (dd<bd){ bd=dd; best=x; }
      }
      if (best){ sendOut(best,r,O_DEFEND,a); on.armyOrdered(d,best.id,'defend',r); }
    }
  }
}

/* ---------- soldiers ---------- */
/** The man h is in a duel with, while it lasts: both alive, still close, each the other's. */
export function partner(h: Human): Human | undefined {
  if (h.duel<0) return undefined;
  const p=byId.get(h.duel);
  if (!p || p.hp<=0 || p.duel!==h.id || (p.x-h.x)**2+(p.y-h.y)**2>DUEL_R*DUEL_R || indoors(p)){ if (p && p.duel===h.id) p.duel=-1; h.duel=-1; return undefined; }
  return p;
}
/** Is the fight between h and e not for them: one of them is in a duel with somebody else? */
function locked(h: Human, e: Human){
  const pe=partner(e); if (pe && pe!==h) return true;
  const ph=partner(h); return !!ph && ph!==e;
}
export function strike(h: Human, e: Human){
  if (h.cool>0 || h.beggar || h.hp<=0 || e.hp<=0) return;
  if (locked(h,e)) return;            // (a duel is one on one)
  h.duel=e.id; e.duel=h.id;
  h.cool=HIT_TICKS;
  on.swing(h.id,e.id);
  if (W.prand()<HIT_CHANCE){
    const was=e.hp;
    const roll=1+((W.prand()*3|0)-1)*STRIKE_SWING;
    e.hp-=(h.kind!==H_SOLDIER ? MILITIA_DMG : h.militia ? MILITIA_HIT : HIT_DMG[h.tier])*roll;
    e.by=h.o; if (was>0 && e.hp<=0){ W.kills[h.o*W.M+e.o]++; const x=e.war>=0 ? armyById.get(e.war) : undefined; if (x) x.hitAt=W.tickN; }
    on.hit(e.x,e.y-2,e.hp<=0,e.id,h.id);
  }
}
/** The villagers of kingdom o near (x,y) rising as a mob: there are no mobs in this war (sim/story.ts asks). */
export function raiseMob(_o: number, _x: number, _y: number, _r: number, _dry=false){ return 0; }
/** A soldier not in a phalanx (militia) or a villager: nothing to do in a war of armies. */
export function guardStep(_h: Human): boolean { return false; }
export function alarmStep(_h: Human): boolean { return false; }
/** How many of o's soldiers would answer a call: none (militia stay at home). */
export const callableCount = (_n: number) => 0;
/** Soldiers ready to march: the men at home in o's armies. */
export function ready(n: Nation){ let k=0; for (const x of W.armies) if (x.o===n.id) for (const h of membersOf(x)) if (h.war<0 && h.hp>0) k++; return k; }
/** n's armies, each with its men at home and in the field. */
export function armiesOfNation(o: number){ return W.armies.filter(x => x.o===o).map(x => ({ army:x, home: membersOf(x).filter(h => h.war<0 && h.hp>0).length })); }
export { membersOf as armyMembers };
export const regionsClaimedOn = (d: number) => { const out: number[]=[]; for (const [k,regs] of W.claims) if (k%W.M===d) out.push(...regs); return out; };
void CONTROL;
