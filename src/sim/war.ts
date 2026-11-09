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
import { TW, TH, NT, NP, PW, TMULT, GAME_SPEED, WAGE, WAGE_IDLE, WAGE_ATTACK, B_CASTLE, B_CPART, B_BARRACKS, isStructure } from '../core/constants';
import { W, owner, occ, terr, isLand, isle, pType, pOwner, pCenter, pHp, pMain, pBurn, type Human, type Nation, type Army } from './state';
import { wear, bldHp, CASTLE_MEND } from './defense';
import { on } from './events';
import { H_SOLDIER, indoors, switching, tileOf, pace, release, doorOf, TASK_ROAM } from './population';
import { units, unitAt, groupKeys, groupLead, maxHp, SOLDIER_DMG, MILITIA_HIT, ARCHER_SHARE, type Unit } from './army';
import { RG, region, holdsRegion, cedeRegion, occupyRegion, freeRegion, flagXY, CONTROL } from './regions';
import { ignite, fortTier, fortSpot, builtTier, capitalIn } from './buildings';
import { findWay } from './roads';
export { findWay };
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
export const CAPTURE_TICKS = 20*GAME_SPEED*10;    // an invader sitting alone in a region brings its flag down in 20 s on the clock; its owner's army raises it as fast (a capital's region has no flag: it is besieged)
export const ROLL_TICKS = 3*GAME_SPEED*10;        // every 3 s on the clock each side of a battle rolls a die for its line
export const ROLL_MOD = 0.2;                      // a 6 is +20% to the blows of its line, a 1 is -20%, a 3 even
export const BATTLE_DMG = 2;                      // blows in a battle line land twice as hard as a soldier's blow elsewhere: a line fight is brutal
export const FORT_SLOW = 0.4;                     // each tier of a region's fort makes its capture (and its retaking) 40% slower
export const FORT_DMG = [0, 2, 4, 8, 16];         // what a fort's shot does, by tier (one every ROLL_TICKS, at a man of an army attacking the region); 4: a capital's region
export const FORT_UPKEEP = 1.5;                   // gold a second a fort costs, a tier
export const P_WHITE = 1, P_GOALS = 2;            // peace offers: white peace (all back as it was), or the war goals (each side gets the claimed regions it holds)
export const MAX_CLAIMS = 4;                      // regions one crisis may claim
export const OFFER_TICKS = 300;                   // a peace offer stands 30 s
export const MAX_ALLIES = 3;
const GRUDGE_TICKS = 900;                         // a kingdom claimed on in the last 90 s won't ally with its claimant
const FILE_GAP = 2.8, RANK_GAP = 2.6;             // pixels between the files of a phalanx, and between its ranks
export const MARCH_FILES = 10;                    // a marching column is at most 10 men across, the rest in ranks behind
const HOLD_FILES = 14;                            // a phalanx standing or fighting is at most this wide
const MARCH_GAP = 2.4;                            // pixels between the files of a marching column
const ENGAGE_R = 26;                              // pixels between two hostile armies' front ranks at which they fight
const GAP = 2.2;                                  // pixels between the two front ranks in a fight
export const ARMY_SP = 6;                         // pixels a second an army marches (on open ground)
const SAFE_TICKS = 40*GAME_SPEED*10;              // an army retreating or going home is let go for 40 s
const HEAL_TICKS = 30*GAME_SPEED*10;              // a wounded soldier at his barracks is whole again in 30 s
export const ARROW_TICKS = 4*GAME_SPEED*10;       // an archer behind the front rank shoots an arrow every 4 s on the clock in a battle
export const ARROW_DMG = 1;                       // ...that does 1 damage
export const ARCHER_WAGE = 1.1;                   // an archer is paid a tenth more than a spearman (0.33 a second in the field)
export const RALLY_TICKS = 30*GAME_SPEED*10;      // an army that retreats rallies for 30 s on the clock, taking no orders

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
let upkeep=new Float64Array(1);                 // per nation: what its forts cost a second (worked out every 10 ticks)
/** What kingdom o's forts cost it a second: FORT_UPKEEP a tier. */
export const fortUpkeep = (o: number) => upkeep[o] ?? 0;
function countForts(){
  if (upkeep.length!==W.M) upkeep=new Float64Array(W.M); else upkeep.fill(0);
  for (let r=1;r<RG.n;r++){ const t=builtTier(r); if (!t) continue; const o=pOwner[fortSpot(r)]; if (o) upkeep[o]+=FORT_UPKEEP*t; }   // (a capital's defence costs nothing)
}
/** Is h moved by his army (in its phalanx), not on his own? */
export const inPhalanx = (h: Human) => led.has(h.id);
/** Kingdom n's soldiers out of doors and alive, as of this tick. */
export const armiesOf = (n: number): readonly Human[] => soldiersOf[n] ?? [];
/** Is kingdom o at war with anyone? */
export const warringNow = (o: number) => warring[o]===1;

export function resetWar(M: number){
  const MM=M*M;
  W.ally=new Uint8Array(MM); W.atWar=new Uint8Array(MM); W.grudge=new Int32Array(MM).fill(-1e9); W.offers=new Int32Array(MM); W.offerKind=new Uint8Array(MM);
  W.wars=new Uint8Array(MM); W.aggr=new Uint8Array(MM); W.warSince=new Int32Array(MM); W.began=new Uint8Array(MM); W.occCount=new Int32Array(MM); W.lost=new Uint8Array(MM); W.ready=new Int32Array(MM);
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
  const k=h.arch ? ARCHER_WAGE : 1;
  if (!a) return WAGE_IDLE*k;
  return (a.mode===A_BATTLE || a.order===O_ATTACK ? WAGE_ATTACK : WAGE)*k;
}

/* ---------- claims and crises ---------- */
/** Is a's claim on d still a crisis: made, not yet answered? */
export const inCrisis = (a: number, d: number) => !!W.aggr[a*W.M+d] && !W.wars[a*W.M+d];
/** Ticks left before d's silence on a's claims means war. */
export const crisisWait = (a: number, d: number) => Math.max(0,CRISIS_TICKS-(W.tickN-W.crisisAt[a*W.M+d]));
/** The regions a claims of d's (in a crisis, or the war for them), or none. */
export const claimsOf = (a: number, d: number): number[] => W.claims.get(a*W.M+d) ?? [];
/** Does a have war goals in its war with d (regions of d's it claims)? Either side may: the one that began the war, and the defender too once it claims. */
export const attackerIn = (a: number, d: number) => W.claims.has(a*W.M+d) && !!W.wars[a*W.M+d];
/** Did a begin its war with d (its claims made the crisis)? */
export const began = (a: number, d: number) => !!W.began[a*W.M+d];
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
  if (accept && claimsCapital(a,d)) return false;   // (a capital's region is never given up: only taken)
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
/** Do a's claims on d include d's capital region (which d can't give up, in a crisis or a peace)? */
export const claimsCapital = (a: number, d: number) => { const D=W.nations[d]; return !!D && D.capTile>=0 && claimsOf(a,d).includes(region[D.capTile]); };
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
  W.aggr[a*M+d]=0; W.began[a*M+d]=1;
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
/** Kingdom `from` offers `to` peace: white peace (P_WHITE), or (a side with war goals) the war goals (P_GOALS: each side gets the claimed regions it holds). Bots answer when they next think; the player from the war bar. */
export function offerPeace(from: number, to: number, kind=P_WHITE){
  const M=W.M; if (!W.wars[from*M+to]) return;
  if (kind===P_GOALS && !attackerIn(from,to)) kind=P_WHITE;
  if (W.offers[from*M+to] && W.offerKind[from*M+to]===kind) return;
  W.offers[from*M+to]=Math.max(1,W.tickN); W.offerKind[from*M+to]=kind; on.peaceOffered(from,to);
}
export function refusePeace(from: number, to: number){ W.offers[from*W.M+to]=0; W.offerKind[from*W.M+to]=0; on.peaceRefused(from,to); }
/** `to` accepts the peace `from` offered (white peace, or the war goals). */
export function acceptPeace(to: number, from: number){
  const M=W.M; if (!W.wars[from*M+to] || !W.offers[from*M+to]) return false;
  makePeace(from,to,W.offerKind[from*M+to]===P_GOALS);
  return true;
}
/** Kingdom d gives a its war goals: every region a claims is a's (and d keeps the claimed regions of a's it holds), and it is peace. */
export function giveGoals(d: number, a: number){
  if (!attackerIn(a,d)) return false;
  makePeace(a,d,true,a); return true;
}
/** Peace between a and b. With `goals`, each side gets the regions it claimed of the other's that it holds (occupies), and the side `all`
    every region it claimed, held or not (the war goals given up to it); a kingdom whose castle region is among them falls to the other.
    Otherwise it is a white peace: every occupied region is free again and nothing changes hands. Their armies go home. */
export function makePeace(a: number, b: number, goals=false, all=0){
  const M=W.M, gains: [number, number, number[]][]=[];
  for (const [x,y] of [[a,b],[b,a]]){
    const regs=W.claims.get(x*M+y); if (!regs) continue;
    W.claims.delete(x*M+y);
    const Y=W.nations[y], capR=Y && Y.capTile>=0 ? region[Y.capTile] : -1;   // (a capital's region is never given up: it changes hands only if taken)
    if (goals) gains.push([x,y,regs.filter(r => W.rOwner[r]===y && ((x===all && r!==capR) || W.rOcc[r]===x))]);
  }
  for (const [x,y,won] of gains){
    for (const r of won) if (W.rOcc[r]) freeRegion(r);
    const Y=W.nations[y];
    if (Y.alive && Y.capTile>=0 && won.includes(region[Y.capTile])){ for (const [x2,,w2] of gains) if (x2!==x) for (const r of w2) cedeRegion(r,x2); endWarState(a,b); annex(y,x); on.peaceMade(a,b); return; }
    for (const r of won) cedeRegion(r,x);
  }
  for (let r=1;r<RG.n;r++) if ((W.rOcc[r]===a && W.rOwner[r]===b) || (W.rOcc[r]===b && W.rOwner[r]===a)) freeRegion(r);
  endWarState(a,b);
  on.peaceMade(a,b);
}
function endWarState(a: number, b: number){
  const M=W.M;
  for (const i of [a*M+b, b*M+a]){ W.offers[i]=0; W.offerKind[i]=0; W.atWar[i]=0; W.wars[i]=0; W.aggr[i]=0; W.began[i]=0; W.stall[i]=0; W.lost[i]=0; W.ready[i]=0; }
  for (const x of W.armies) if ((x.o===a && x.enemy===b) || (x.o===b && x.enemy===a)) sendHome(x);
  for (const o of [a,b]){ let any=0; for (let k=1;k<M;k++) if (W.wars[o*M+k]) any=1; warring[o]=any; }
}
/** At war, a's claims on d made anew (either side's: the defender may claim too, to win regions of the attacker's): any regions d controls.
    The war needs a claim on one side at least, so a side may let all of its own go only while the other claims something. Why not, or null. */
export function claimsProblem(a: number, d: number, regions: number[]): string | null {
  if (!W.wars[a*W.M+d]) return 'Only at war can war goals be changed';
  if (!regions.length && !claimsOf(d,a).length) return 'Keep at least one claim: the war needs one';
  if (new Set(regions).size!==regions.length) return 'A region is picked twice';
  for (const r of regions) if (!r || r>=RG.n || W.rOwner[r]!==d) return 'Only regions they control can be claimed';
  return null;
}
export function setClaims(a: number, d: number, regions: number[]){
  if (claimsProblem(a,d,regions)) return false;
  for (const r of claimsOf(a,d)) if (!regions.includes(r) && W.rOcc[r]===a) freeRegion(r);
  if (regions.length) W.claims.set(a*W.M+d,regions.slice()); else W.claims.delete(a*W.M+d);
  W.offers[a*W.M+d]=0; W.offers[d*W.M+a]=0;   // (the terms changed: offers made are off)
  on.claimsChanged(a,d);
  checkVictory(a,d);
  return true;
}
/** n wants the fighting with t to end: a war gets a peace offer. */
export function endWar(n: number, t: number, kind=P_WHITE){ if (W.wars[n*W.M+t]) offerPeace(n,t,kind); }
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
    if (pType[q]===B_BARRACKS){ ignite(q); continue; }   // (its barracks burn: the winner's army is only what its own barracks raise)
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
      if (!x){ x={ id:u.key, o:n.id, plots, x:u.x, y:u.y+4, fx:0, fy:1, mode:A_HOME, order:O_NONE, goal:0, enemy:0, path:[], foe:-1, files:[], men:0, safe:0, stand:false, hitAt:-1e9, leader:-1, trail:[], stuck:0, near:Infinity, roll:0, rollAt:0, coming:[], via:[], viaAt:-1e9, rally:0, next:null }; }
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
const filesFor = (n: number, marching=false) => n<=0 ? 0 : Math.max(1,Math.min(n,marching ? MARCH_FILES : HOLD_FILES,Math.round(Math.sqrt(n*2.2))));
/** Keeps x's files to its men: the fallen leave their file (the man behind steps up), newcomers join the shortest file at its back, and the files stay even.
    Spearmen hold the front and archers stand behind them: the spearmen are spread evenly over the files, each file has its spearmen at its head,
    and a file whose spearmen have all fallen takes one over from a file with more (a man changes places with an archer), so archers come to the
    front only when there are no spearmen left to stand there. With few spearmen the phalanx is narrower and deeper (as wide as its spearmen,
    but no less than half its usual width), so archers stand behind a front of spears. */
const isArcher = (id: number) => byId.get(id)?.arch===true;
function tidyFiles(x: Army, men: Human[]){
  const ids=new Set<number>(); for (const h of men) ids.add(h.id);
  const placed=new Set<number>();
  for (let i=0;i<x.files.length;i++){ x.files[i]=x.files[i].filter(id => ids.has(id) && !placed.has(id)); for (const id of x.files[i]) placed.add(id); }
  x.files=x.files.filter(f => f.length);
  const loose: number[]=[]; for (const h of men) if (!placed.has(h.id)) loose.push(h.id);
  let spears=0; for (const h of men) if (!h.arch) spears++;
  let F=filesFor(men.length,x.mode===A_MARCH);
  if (spears>0 && spears<men.length && spears<F) F=Math.max(spears,Math.ceil(F/2));
  while (x.files.length>F){ const f=x.files.length%2 ? x.files.pop()! : x.files.shift()!; loose.push(...f); }
  while (x.files.length<F) if (x.files.length%2) x.files.push([]); else x.files.unshift([]);
  const spearsIn=(f: number[]) => { let k=0; for (const id of f) if (!isArcher(id)) k++; return k; };
  loose.sort((a,b) => +isArcher(a)-+isArcher(b));   // (spearmen placed first)
  for (const id of loose){
    let s=0;
    if (isArcher(id)){ for (let i=1;i<x.files.length;i++) if (x.files[i].length<x.files[s].length) s=i; }
    else { for (let i=1;i<x.files.length;i++){ const a=spearsIn(x.files[i]), b=spearsIn(x.files[s]); if (a<b || (a===b && x.files[i].length<x.files[s].length)) s=i; } }
    x.files[s].push(id);
  }
  for (let k=0;k<50 && x.files.length>1;k++){
    let lo=0, hi=0; for (let i=1;i<x.files.length;i++){ if (x.files[i].length<x.files[lo].length) lo=i; if (x.files[i].length>x.files[hi].length) hi=i; }
    if (x.files[hi].length-x.files[lo].length<2) break;
    const f=x.files[hi]; let j=f.length-1; for (let t=f.length-1;t>=0;t--) if (isArcher(f[t])){ j=t; break; }   // (an archer moves over if there is one)
    x.files[lo].push(f.splice(j,1)[0]);
  }
  if (spears && spears<men.length){
    // the spearmen spread evenly over the files: a spearman changes places with an archer of the file shortest of them
    for (let k=0;k<60;k++){
      let lo=0, hi=0, slo=Infinity, shi=-1;
      for (let i=0;i<x.files.length;i++){ const c=spearsIn(x.files[i]); if (c<slo){ slo=c; lo=i; } if (c>shi){ shi=c; hi=i; } }
      if (shi-slo<2) break;
      const A=x.files[hi], B=x.files[lo];
      let si=-1; for (let t=A.length-1;t>=0;t--) if (!isArcher(A[t])){ si=t; break; }
      const ai=B.findIndex(isArcher);
      if (ai>=0){ const s=A[si]; A[si]=B[ai]; B[ai]=s; } else B.push(A.splice(si,1)[0]);
    }
    // in each file the spearmen stand at its head, the archers behind (each keeping his order)
    for (let i=0;i<x.files.length;i++){ const f=x.files[i]; let sorted=true; for (let t=1;t<f.length;t++) if (isArcher(f[t-1]) && !isArcher(f[t])){ sorted=false; break; } if (!sorted) x.files[i]=[...f.filter(id => !isArcher(id)), ...f.filter(isArcher)]; }
  }
  x.men=men.length;
}
/** The place of the man in file i, rank j of army x, in pixels: a phalanx standing square, or a marching column whose ranks follow the trail of its head. */
function slotOf(x: Army, i: number, j: number): [number, number] {
  const F=x.files.length;
  if (x.mode===A_MARCH && ranksAt.length>j){
    const [px,py,dx,dy]=ranksAt[j], s=(i-(F-1)/2)*MARCH_GAP;
    return [px-dy*s, py+dx*s];
  }
  const rx=-x.fy, ry=x.fx, s=(i-(F-1)/2)*FILE_GAP, b=j*RANK_GAP;
  return [x.x+rx*s-x.fx*b, x.y+ry*s-x.fy*b];
}
/** Where each rank of a marching column stands, and the way it faces: along the trail its head has left, a rank every RANK_GAP behind. (Worked out once a tick for the army being moved.) */
let ranksAt: [number, number, number, number][]=[];
function columnRanks(x: Army, ranks: number){
  ranksAt=[];
  const T=x.trail; let px=x.x, py=x.y, dx=x.fx, dy=x.fy, i=0, left=0;
  for (let j=0;j<ranks;j++){
    let need=j===0 ? 0 : RANK_GAP;
    // walk back along the trail `need` pixels
    while (need>1e-6){
      if (left<=1e-6){
        if (i+1>=T.length){ px-=dx*need; py-=dy*need; need=0; break; }   // (the trail runs out: straight back)
        const qx=T[i], qy=T[i+1]; i+=2;
        const L=Math.hypot(px-qx,py-qy); if (L<1e-6) continue;
        dx=(px-qx)/L; dy=(py-qy)/L; left=L;
      }
      const st=Math.min(left,need); px-=dx*st; py-=dy*st; left-=st; need-=st;
    }
    ranksAt.push([px,py,dx,dy]);
  }
}
/** Is pixel (x,y) on a castle (its walls: nobody walks across them)? */
function onCastle(x: number, y: number){
  if (x<0 || y<0 || x>=TW*2 || y>=TH*2) return false;
  const q=((y/8)|0)*PW+((x/8)|0), ty=pType[q]; return ty===B_CASTLE || ty===B_CPART;
}
/** A man walks to (gx,gy) at his pace (quicker if he has fallen behind), over land and water (he rows), and round a castle's walls: when they
    stand in his way he heads for the corner of the castle that makes the shortest way round, so he never dithers along a wall. */
function walk(h: Human, gx: number, gy: number, quick=1){
  let dx=gx-h.x, dy=gy-h.y, d=Math.hypot(dx,dy); if (d<0.05) return;
  const sp=pace(h)*(d>6 ? 1.6 : 1.1)*quick, st=Math.min(d,sp*0.1);
  let nx=h.x+dx/d*st, ny=h.y+dy/d*st;
  if (onCastle(nx,ny) && !onCastle(h.x,h.y)){
    const q=((ny/8)|0)*PW+((nx/8)|0), main=pType[q]===B_CASTLE ? q : pMain[q], e=1.2;
    const X0=(main%PW)*8-e, Y0=((main/PW)|0)*8-e, X1=X0+16+2*e, Y1=Y0+16+2*e;
    const corners: [number, number][]=[];
    if (h.y<=Y0+e) corners.push([X0,Y0],[X1,Y0]);
    if (h.y>=Y1-e) corners.push([X0,Y1],[X1,Y1]);
    if (h.x<=X0+e) corners.push([X0,Y0],[X0,Y1]);
    if (h.x>=X1-e) corners.push([X1,Y0],[X1,Y1]);
    if (!corners.length) corners.push([X0,Y0],[X1,Y0],[X0,Y1],[X1,Y1]);
    let cx=corners[0][0], cy=corners[0][1], best=Infinity;
    for (const [x,y] of corners){ const c=Math.hypot(x-h.x,y-h.y)+Math.hypot(gx-x,gy-y); if (c<best){ best=c; cx=x; cy=y; } }
    dx=cx-h.x; dy=cy-h.y; d=Math.hypot(dx,dy);
    if (d<0.05) return;
    const s2=Math.min(d,st); nx=h.x+dx/d*s2; ny=h.y+dy/d*s2;
    if (onCastle(nx,ny)) return;
  }
  if (!mayStand(h,owner[tileOf(nx,ny)])) return;
  h.x=nx; h.y=ny;
}

/* ---------- orders ---------- */
/** Where an army sent to region r goes: its flag, or in a capital's region (which has none) before the castle's gate. */
export function siteOf(r: number): [number, number] {
  const c=capitalIn(r); if (!c) return flagXY(r);
  const [gx,gy]=doorOf(W.nations[c]); return [gx,gy+6];
}
/** The army of o's other than x sent to hold region r (attacking or defending it), if any. */
const holderOf = (o: number, x: Army, r: number) => W.armies.find(y => y!==x && y.o===o && y.goal===r && (y.order===O_ATTACK || y.order===O_DEFEND) && (y.men>0 || y.mode===A_MARCH));
/** Armies on standby: each waits while the army of its kingdom's fighting in its region fights on; once that one is beaten or falls back it
    marches in with its order, and once that one has won, it stands down. */
function standby(){
  for (const x of W.armies){
    const q=x.next; if (!q || x.mode===A_BATTLE) continue;
    const busy=holderOf(x.o,x,q.r);
    if (busy && busy.mode===A_BATTLE) continue;
    x.next=null;
    if (busy || armyProblem(x.o,x.id,q.order,q.r)){ on.armyOrdered(x.o,x.id,'stand down',q.r); continue; }
    armyOrder(x.o,x.id,q.order,q.r);
  }
}
/** Army x's archers behind the front rank shoot: each every ARROW_TICKS (each at his own moment), at a man of the army x is fighting picked at
    random, the front ranks a little likelier (the first rank three times, the second twice as likely as those behind). */
function volley(x: Army){
  const y=armyById.get(x.foe); if (!y) return;
  let pool: Human[] | null=null, weight: number[]=[], total=0;
  for (const f of x.files) for (let j=1;j<f.length;j++){
    const h=byId.get(f[j]); if (!h || !h.arch || h.hp<=0 || (W.tickN+h.id*7)%ARROW_TICKS) continue;
    if (!pool){
      pool=[];
      for (const g of y.files) for (let k=0;k<g.length;k++){ const e=byId.get(g[k]); if (!e || e.hp<=0) continue; const w=k===0 ? 3 : k===1 ? 2 : 1; pool.push(e); weight.push(w); total+=w; }
    }
    if (!total) return;
    let pick=W.prand()*total, i=0; while (i<pool.length-1 && pick>=weight[i]){ pick-=weight[i]; i++; }
    const e=pool[i]; if (e.hp<=0) continue;
    e.hp-=ARROW_DMG; e.by=x.o;
    if (e.hp<=0){ W.kills[x.o*W.M+e.o]++; y.hitAt=W.tickN; }
    on.arrowShot(h.x,h.y-3,e.x,e.y-2,e.hp<=0,e.id);
  }
}
/** Why army `id` of kingdom o can't take this order, or null. */
export function armyProblem(o: number, id: number, order: string, r=0): string | null {
  const x=armyById.get(id); if (!x || x.o!==o) return 'That army is gone';
  if (x.rally>W.tickN) return `It is rallying after its retreat: ${Math.ceil((x.rally-W.tickN)/(GAME_SPEED*10))} s before it takes orders`;
  if (order==='return'){ if (x.mode===A_HOME && !x.men) return 'It is at home'; return null; }
  if (order==='retreat'){ if (x.mode===A_HOME) return 'It is at home'; if (x.order===O_RETREAT) return 'It is retreating'; return null; }
  if (order==='reinforce'){ if (x.mode===A_HOME) return 'It is at home: its men are all with it'; if (!waiting(x)) return 'Nobody of it waits at its barracks'; return null; }
  if (x.mode===A_BATTLE) return 'It is fighting: it can only retreat or go home';
  if (x.mode===A_HOME && !membersOf(x).some(fit)) return 'Nobody of it is at home';
  if (!r || r>=RG.n) return 'Pick a region';
  const M=W.M, d=W.rOwner[r];
  const busy=holderOf(o,x,r);
  if (busy && busy.mode!==A_BATTLE) return 'One army per region: another of yours is there';   // (one fighting there: this one waits on standby)
  if (order==='attack'){
    if (!d || !W.wars[o*M+d] || !claimsOf(o,d).includes(r)) return 'Only the regions you claimed in a war can be attacked';
    if (W.rOcc[r]===o) return 'You hold it already: station an army there to keep it';
    if (!besideHeld(o,r)) return 'Take the claimed region before it first: it must border ground you hold';
    return null;
  }
  if (order==='defend' || order==='station'){
    if (!d) return 'Nobody holds that region: armies are stationed in regions of yours (or your allies\')';
    if (d!==o && !allied(o,d) && W.rOcc[r]!==o) return 'Armies are stationed only in regions of yours (or your allies\'), and in regions you occupy';
    return null;
  }
  return 'Unknown order';
}
/** Gives army `id` of kingdom o an order (see the top of this file). */
export function armyOrder(o: number, id: number, order: string, r=0){
  if (armyProblem(o,id,order,r)) return false;
  const x=armyById.get(id)!;
  if (order==='return'){ sendHome(x); return true; }
  if (order==='retreat'){ retreat(x); x.rally=W.tickN+RALLY_TICKS; return true; }   // (its morale broken: it takes no orders while it rallies)
  if (order==='reinforce'){ reinforce(x); return true; }
  x.next=null;
  if (holderOf(o,x,r)){ x.next={ order, r }; on.armyOrdered(o,x.id,'standby',r); return true; }   // (another of ours is fighting there: this one stands by to take its place)
  const M=W.M, d=W.rOwner[r];
  let enemy=0;
  if (order==='attack' || W.rOcc[r]===o) enemy=d;   // (stationed in a region it occupies: it keeps it from its owner)
  else for (let a=1;a<M;a++) if (W.wars[a*M+d] && claimsOf(a,d).includes(r)){ enemy=a; break; }
  sendOut(x,r,order==='attack' ? O_ATTACK : O_DEFEND,enemy);
  on.armyOrdered(o,x.id,order==='attack' ? 'attack' : 'defend',r);
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
  const [fx,fy]=siteOf(r);
  x.path=findWay(x.o,x.x,x.y,fx,fy); startMarch(x);
}
/** x sets off along its new way: a column, its trail begun where it stands. */
function startMarch(x: Army){ x.mode=A_MARCH; x.stuck=0; x.near=Infinity; if (!x.trail.length) x.trail=[x.x,x.y]; }
/** Army `id` of kingdom o marches to pixel (x,y) and holds there, at peace or at war (tests, and the debug hook: no order of the game's does this). */
export function moveArmy(o: number, id: number, px: number, py: number){
  const x=armyById.get(id); if (!x || x.o!==o) return false;
  if (x.mode===A_HOME){ let k=0; for (const h of membersOf(x)) if (fit(h) && h.war<0){ h.war=x.id; h.foe=-1; h.duel=-1; h.path=[]; h.task=TASK_ROAM; k++; } x.men=k; }
  breakOff(x);
  x.order=O_RETREAT; x.goal=0; x.enemy=0; x.path=findWay(o,x.x,x.y,px,py); startMarch(x);
  return true;
}
/** x goes home to its barracks. */
function sendHome(x: Army){
  if (x.mode===A_HOME) return;
  breakOff(x);
  const [hx,hy]=homeSpot(x);
  x.order=O_RETURN; x.goal=0; x.enemy=0; x.safe=W.tickN+SAFE_TICKS;
  x.path=findWay(x.o,x.x,x.y,hx,hy); startMarch(x);
}
/** x breaks off its fight and falls back to the nearest region its kingdom holds (not occupied). */
function retreat(x: Army){
  breakOff(x);
  let best=0, bd=Infinity;
  for (let r=1;r<RG.n;r++){ if (W.rOwner[r]!==x.o || W.rOcc[r] || RG.flag[r]<0) continue; const [fx,fy]=flagXY(r), d=(fx-x.x)**2+(fy-x.y)**2; if (d<bd && region[tileOf(x.x,x.y)]!==r){ bd=d; best=r; } }
  if (!best){ sendHome(x); return; }
  const [fx,fy]=flagXY(best);
  x.order=O_RETREAT; x.goal=best; x.enemy=0; x.safe=W.tickN+SAFE_TICKS;
  x.path=findWay(x.o,x.x,x.y,fx,fy); startMarch(x);
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
  if (W.tickN%10===1) countForts();
  syncArmies();
  findSieges();
  led.clear();
  for (const x of W.armies) stepArmy(x);
  if (W.tickN%5===0) engage();
  for (const x of W.armies) if (x.mode===A_BATTLE && x.foe>=0 && x.id<x.foe){ const y=armyById.get(x.foe); if (y) fight(x,y); }
  for (const x of W.armies) if (x.mode===A_BATTLE && x.foe>=0) volley(x);
  for (const x of W.armies) if (x.mode===A_BATTLE && (x.foe<0 || !armyById.has(x.foe))){ x.foe=-1; x.mode=x.path.length ? A_MARCH : A_HOLD; }
  if (W.tickN%10===3) standby();
  if (W.tickN%5===0) flags();
  if (W.tickN%ROLL_TICKS===11) fortsFire();
  if (W.tickN%20===7) secondWave();
}
/** A bot answers claims on it: it gives up the regions only to a kingdom far stronger than it, and only a few of them. */
function botAccepts(D: Nation, a: number){
  const A=W.nations[a], regs=claimsOf(a,D.id).length;
  if (claimsCapital(a,D.id)) return false;
  return A.strength>D.strength*(2+regs*0.4) && W.srand()<0.8;
}
/** One tick of army x: the men of its phalanx to their places, and the phalanx on its way. */
function stepArmy(x: Army){
  const all=membersOf(x);
  if (x.coming.length) bringUp(x);
  const coming=new Set(x.coming);
  const men=x.mode===A_HOME ? all.filter(h => fit(h) && h.war<0) : all.filter(h => h.war===x.id && h.hp>0 && !indoors(h) && !coming.has(h.id));
  tidyFiles(x,men);
  if (x.mode!==A_HOME && !men.length){ if (x.coming.length) breakOff(x); else { lost(x); return; } }   // (nobody left in the ranks, but more on the way: it waits for them)
  if (x.mode===A_HOME){
    const [hx,hy,fx,fy]=homeSpot(x); x.x=hx; x.y=hy; x.fx=fx; x.fy=fy; x.trail.length=0;
    const heal=1/HEAL_TICKS;
    for (const h of men){ if (h.hp<maxHp(h)) h.hp=Math.min(maxHp(h),h.hp+maxHp(h)*heal); }
  } else if (x.mode===A_MARCH){
    let ranks=0; for (const f of x.files) ranks=Math.max(ranks,f.length); columnRanks(x,ranks);
    march(x,men);
  }
  if (x.mode===A_MARCH){ let ranks=0; for (const f of x.files) ranks=Math.max(ranks,f.length); columnRanks(x,ranks); }
  if (besieging(x)){ for (const f of x.files) for (const id of f){ const h=byId.get(id); if (h){ led.add(h.id); if (h.cool>0) h.cool--; } } siegeStep(x); return; }
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
/** The reinforcements of army x on their way: each follows the way from the barracks to the army (worked out again, for all of them, every few
    seconds once a man has come to its end with the army moved on); one who reaches it joins its ranks at the back, a fight or not. */
function bringUp(x: Army){
  if (x.mode===A_HOME){ for (const id of x.coming){ const h=byId.get(id); if (h && h.war===x.id){ h.war=-1; h.path=[]; } } x.coming=[]; return; }   // (the army is home: they are too)
  const keep: number[]=[];
  for (const id of x.coming){
    const h=byId.get(id); if (!h || h.hp<=0 || h.war!==x.id || indoors(h)) continue;
    led.add(h.id); if (h.cool>0) h.cool--;
    if (Math.hypot(h.x-x.x,h.y-x.y)<18){ h.path=[]; continue; }   // (there: into the ranks)
    if (!h.path.length){
      if (!x.via.length || W.tickN-x.viaAt>60 || Math.hypot(x.via[x.via.length-2]-x.x,x.via[x.via.length-1]-x.y)>20){ x.via=findWay(x.o,h.x,h.y,x.x,x.y); x.viaAt=W.tickN; }
      h.path=x.via.slice();
    }
    const tx=h.path[0], ty=h.path[1];
    if (Math.hypot(tx-h.x,ty-h.y)<1.2) h.path.splice(0,2); else walk(h,tx,ty,1.8);   // (on horseback: quicker than the march)
    keep.push(id);
  }
  x.coming=keep;
}
/** Army x's men waiting at its barracks set out to join it where it is. */
function reinforce(x: Army){
  for (const h of membersOf(x)) if (fit(h) && h.war<0){ h.war=x.id; h.foe=-1; h.duel=-1; h.path=[]; h.task=TASK_ROAM; x.coming.push(h.id); }
  x.via=[]; x.viaAt=-1e9;
  on.armyOrdered(x.o,x.id,'reinforce',x.goal);
}
/** How many of army x's men wait at its barracks (they would answer a reinforce order). */
export const waiting = (x: Army) => x.mode===A_HOME ? 0 : membersOf(x).filter(h => fit(h) && h.war<0).length;
/** The column marches along its way, as fast as its men keep up; its head leaves a trail the ranks behind follow. A column that gets no nearer
    its next waypoint for a while looks for its way again from where it stands. */
function march(x: Army, men: Human[]){
  if (!x.path.length){ arrive(x); return; }
  const gx=x.path[0], gy=x.path[1], dx=gx-x.x, dy=gy-x.y, d=Math.hypot(dx,dy);
  // how far the heads of its files are from their places: a column waits a little for its stragglers, never stops for them
  let lag=0, k=0; for (let i=0;i<x.files.length;i++){ const h=byId.get(x.files[i][0]); if (h && ranksAt.length){ const [sx,sy]=slotOf(x,i,0); lag+=Math.hypot(h.x-sx,h.y-sy); k++; } }
  lag/=Math.max(1,k);
  const t=tileOf(x.x,x.y), tm=isLand[t] ? TMULT[terr[t]] || 1 : 1.6, sp=ARMY_SP/Math.sqrt(tm)*(lag>16 ? 0.5 : lag>8 ? 0.75 : 1)*0.1;
  if (d<x.near-0.02){ x.near=d; x.stuck=0; } else if (++x.stuck>120){   // (no nearer for 12 s: the way is looked for again)
    const fx=x.path[x.path.length-2], fy=x.path[x.path.length-1];
    x.path=findWay(x.o,x.x,x.y,fx,fy); x.stuck=0; x.near=Infinity; return;
  }
  if (d<=sp || d<0.01){ x.x=gx; x.y=gy; x.path.splice(0,2); x.near=Infinity; x.stuck=0; trail(x); if (!x.path.length) arrive(x); return; }
  const ux=dx/d, uy=dy/d;
  x.x+=ux*sp; x.y+=uy*sp;
  x.fx=ux; x.fy=uy;
  trail(x);
  void men;
}
/** The head of x's column marks where it has been (a point every pixel), as far back as its last rank needs. */
function trail(x: Army){
  const T=x.trail;
  if (!T.length || Math.hypot(T[0]-x.x,T[1]-x.y)>=1){ T.unshift(x.x,x.y); }
  let ranks=0; for (const f of x.files) ranks=Math.max(ranks,f.length);
  const keep=Math.ceil(ranks*RANK_GAP+8)*2+4; if (T.length>keep) T.length=keep;
}
/** x has reached the end of its way. */
function arrive(x: Army){
  if (x.order===O_RETURN){
    x.mode=A_HOME; x.order=O_NONE; x.goal=0; x.enemy=0; x.foe=-1; x.safe=0;
    for (const h of membersOf(x)) if (h.war===x.id){ h.war=-1; h.foe=-1; h.duel=-1; h.path=[]; }
    x.coming=[];
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
    x.mode=y.mode=A_BATTLE; x.foe=y.id; y.foe=x.id; x.roll=y.roll=0;   // (each line rolls its first die as the fight begins)
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
  // every 3 s each line rolls its die
  for (const m of [x,y]) if (!m.roll || W.tickN-m.rollAt>=ROLL_TICKS){ m.roll=1+((W.prand()*6)|0); m.rollAt=W.tickN; on.battleRoll(m.o,m.id,m.roll); }
  // the front ranks: each man faces the one opposite him (lined up across, from the middle out); a man of the wider front with nobody
  // opposite goes for the nearest enemy nobody is fighting yet (round the flank, the ranks behind): the whole line fights, each man one on one
  const rx=-dy, ry=dx;
  const front=(m: Army) => { const out: { h: Human; s: number }[]=[]; for (const f of m.files){ const h=byId.get(f[0]); if (h) out.push({ h, s:(h.x-x.x)*rx+(h.y-x.y)*ry }); } return out.sort((p,q) => p.s-q.s); };
  const fa=front(x), fb=front(y), off=(fa.length-fb.length)/2, taken=new Set<number>(), spare: Human[]=[];
  for (let i=0;i<fa.length;i++){
    const j=Math.round(i-off), h=fa[i].h, e=j>=0 && j<fb.length ? fb[j].h : undefined;
    if (e){ taken.add(e.id); taken.add(h.id); bind(h,e); duelStep(h,e,true); } else spare.push(h);
  }
  for (let j=0;j<fb.length;j++){ const h=fb[j].h; if (!taken.has(h.id)) spare.push(h); }
  for (const h of spare){
    const foe=h.o===x.o ? y : x, own=h.o===x.o ? x : y;
    const p=partner(h);
    let e: Human | undefined=p && !taken.has(p.id) ? p : undefined;
    if (!e){ let bd=Infinity; for (const f of foe.files) for (const id of f){ if (taken.has(id)) continue; const c=byId.get(id); if (!c || c.hp<=0 || partner(c)) continue; const dd=(c.x-h.x)**2+(c.y-h.y)**2; if (dd<bd){ bd=dd; e=c; } } }
    if (e){ taken.add(e.id); taken.add(h.id); bind(h,e); duelStep(h,e,foe.files.some(f => f[0]===e!.id)); }
    else { unbind(h); const k=own.files.findIndex(f => f[0]===h.id); const [sx,sy]=slotOf(own,k,0); walk(h,sx,sy); }
  }
}
/** The fight pairs h with e, one on one: any duel either was in with somebody else is over (the pairing of the lines is what counts, so nobody
    stands idle held by a duel that has moved on). */
function bind(h: Human, e: Human){
  for (const [m,o] of [[h,e],[e,h]] as [Human, Human][]){ if (m.duel>=0 && m.duel!==o.id){ const p=byId.get(m.duel); if (p && p.duel===m.id) p.duel=-1; } m.duel=o.id; }
}
function unbind(h: Human){ if (h.duel<0) return; const p=byId.get(h.duel); if (p && p.duel===h.id) p.duel=-1; h.duel=-1; }
/** Two men fight: each steps up to the other (a man taken on in the ranks behind holds his place) and strikes when he can reach. */
function duelStep(h: Human, e: Human, both=true){
  const d=Math.hypot(e.x-h.x,e.y-h.y);
  if (d>MELEE_R*0.85){ walk(h,e.x,e.y,1.4); if (both) walk(e,h.x,h.y,1.4); }
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
    if (x.mode!==A_HOLD) continue;   // (an army sitting anywhere in the region)
    let a=at.get(r); if (!a){ a=[]; at.set(r,a); } a.push(x);
  }
  for (const [r,list] of at){
    if (fighting.has(r) || capitalIn(r)) continue;   // (a capital's region has no flag: it is taken by a siege of its castle)
    const d=W.rOwner[r]; if (!d) continue;
    const own=list.filter(x => x.o===d), foes=list.filter(x => x.o!==d && W.atWar[x.o*W.M+d] && claimsOf(x.o,d).includes(r));
    if (own.length && foes.length) continue;
    const tier=fortTier(r), holder=W.rOcc[r] || d;   // (a fort works for whoever holds the region: its occupier too)
    const rate=(_men: number, side=0) => 5/CAPTURE_TICKS/(side!==holder ? 1+FORT_SLOW*tier : 1);
    if (foes.length){
      const a=foes[0].o; if (W.rOcc[r]===a) continue;
      let men=0; for (const x of foes) men+=x.men;
      W.rFlag[r]-=rate(men,a);
      if (W.rFlag[r]<=0){ W.rFlag[r]=0; razeBarracks(r,d); occupyRegion(r,a); on.regionTaken(r,a,d); checkVictory(a,d); }
    } else if (own.length){
      let men=0; for (const x of own) men+=x.men;
      W.rFlag[r]=Math.min(1,W.rFlag[r]+rate(men,d));
      if (W.rFlag[r]>=1 && W.rOcc[r]){ const a=W.rOcc[r]; freeRegion(r); W.rFlag[r]=1; on.regionTaken(r,d,a); }
    }
  }
  // a flag nobody stands at, half lowered, slowly goes back up
  for (let r=1;r<RG.n;r++) if (!W.rOcc[r] && W.rOwner[r] && W.rFlag[r]<1 && !at.has(r) && !fighting.has(r)) W.rFlag[r]=Math.min(1,W.rFlag[r]+1/CAPTURE_TICKS);
}
/** Every ROLL_TICKS each region's fort shoots a man, picked at random, of the armies in the region at war with whoever holds it. */
function fortsFire(){
  const M=W.M, targets=new Map<number, Human[]>();
  for (const x of W.armies){
    if (x.mode===A_HOME || !x.men) continue;
    const r=region[tileOf(x.x,x.y)]; if (!r) continue;
    const holder=W.rOcc[r] || W.rOwner[r]; if (!holder || !W.atWar[x.o*M+holder] || !fortTier(r)) continue;
    let t=targets.get(r); if (!t){ t=[]; targets.set(r,t); }
    for (const f of x.files) for (const id of f){ const h=byId.get(id); if (h && h.hp>0) t.push(h); }
  }
  for (const [r,t] of targets){
    if (!t.length) continue;
    const e=t[(W.prand()*t.length)|0], tier=fortTier(r), cap=capitalIn(r), q=cap ? W.nations[cap].capPlot : fortSpot(r), holder=W.rOcc[r] || W.rOwner[r];   // (a capital's arrows fly from its castle)
    const was=e.hp; e.hp-=FORT_DMG[tier] ?? 2; e.by=holder;
    if (was>0 && e.hp<=0) W.kills[holder*M+e.o]++;
    on.towerShot((q%PW)*8+8,((q/PW)|0)*8+4,e.x,e.y-2,e.hp<=0,e.id);
  }
}
/* ---------- sieges: a capital's region has no flag; its castle is stormed ----------
   An army attacking a capital's region marches to the castle's gate and, standing there with no battle on, storms it: its spearmen
   spread round the walls and strike them all at once (the castle is the one enemy many men fight together, not one on one), its
   archers shoot the castle's defenders, or the walls. The castle shoots back as a fort of tier 4, and mends 2 blows a second.
   While a capital is besieged every newcomer comes out of its gate as a militiaman, to fight the besiegers (sim/population.ts);
   the militia kept round the castle at war fight too (guardStep). When its blows are spent the castle falls, and the kingdom
   with it, to the besieger. */
export const SIEGE_R = 30;   // pixels from the castle's middle within which an attacker counts as besieging it
const castleXY = (n: Nation): [number, number] => { const q=n.capPlot; return [(q%PW)*8+8, ((q/PW)|0)*8+8]; };
/** Is army x storming a castle: attacking a capital's region, standing before its castle, with no battle on? */
function besieging(x: Army){
  if (x.mode!==A_HOLD || x.order!==O_ATTACK || !x.men) return false;
  const c=capitalIn(x.goal); if (!c || !W.atWar[x.o*W.M+c]) return false;
  const [cx,cy]=castleXY(W.nations[c]); return Math.hypot(x.x-cx,x.y-cy)<SIEGE_R;
}
/** Which kingdoms' capitals are under siege this tick, and by whom (W.siege: the besieger's id, 0 none): an army at war with a kingdom,
    in its capital's region and near its castle, fighting or storming. */
function findSieges(){
  W.siege.fill(0);
  for (const x of W.armies){
    if (x.mode===A_HOME || x.mode===A_MARCH || !x.men) continue;
    const r=region[tileOf(x.x,x.y)], c=capitalIn(r); if (!c || c===x.o || !W.atWar[x.o*W.M+c]) continue;
    const [cx,cy]=castleXY(W.nations[c]); if (Math.hypot(x.x-cx,x.y-cy)<SIEGE_R*1.5) W.siege[c]=x.o;
  }
}
/** One tick of army x storming the castle: each spearman goes to his place round the walls (or fights the militiaman who has taken him on)
    and strikes; the archers stand back and shoot, every ARROW_TICKS, at a defender near the castle or else the walls. */
function siegeStep(x: Army){
  const c=capitalIn(x.goal), C=W.nations[c], q=C.capPlot, [cx,cy]=castleXY(C);
  const men: Human[]=[]; for (const f of x.files) for (const id of f){ const h=byId.get(id); if (h && h.hp>0) men.push(h); }
  const spears=men.filter(h => !h.arch), archers=men.filter(h => h.arch);
  const foes=(soldiersOf[c] ?? []).filter(e => e.hp>0 && e.war<0 && Math.hypot(e.x-cx,e.y-cy)<SIEGE_R*1.5);
  const ring=(i: number, n: number, R: number): [number, number] => {   // a place on a square round the castle, i of n
    const t=(i+0.5)/n*4, side=t|0, f=t-side, a=-R+2*R*f;
    return side===0 ? [cx+a,cy-R] : side===1 ? [cx+R,cy+a] : side===2 ? [cx-a,cy+R] : [cx-R,cy-a];
  };
  for (let i=0;i<spears.length;i++){
    const h=spears[i];
    const p=h.duel>=0 ? byId.get(h.duel) : undefined;
    if (p && p.hp>0 && p.duel===h.id && Math.hypot(p.x-h.x,p.y-h.y)<DUEL_R){ duelStep(h,p,false); continue; }   // (a defender has taken him on: one on one)
    if (h.duel>=0) unbind(h);
    const [sx,sy]=ring(i,spears.length,9.5); walk(h,sx,sy);
    if (Math.hypot(sx-h.x,sy-h.y)<2 && h.cool<=0){
      h.cool=HIT_TICKS; on.swing(h.id,-1);
      if (W.prand()<HIT_CHANCE){ pHp[q]+=HIT_DMG[h.tier]*(1+((W.prand()*3|0)-1)*STRIKE_SWING); on.hit(sx+(cx-sx)*0.3,sy+(cy-sy)*0.3-2,false,-1,h.id); }
    }
  }
  for (let i=0;i<archers.length;i++){
    const h=archers[i], [sx,sy]=ring(i,archers.length,17); walk(h,sx,sy);
    if ((W.tickN+h.id*7)%ARROW_TICKS) continue;
    const e=foes.length ? foes[(W.prand()*foes.length)|0] : undefined;
    if (e){ e.hp-=ARROW_DMG; e.by=x.o; if (e.hp<=0) W.kills[x.o*W.M+e.o]++; on.arrowShot(h.x,h.y-3,e.x,e.y-2,e.hp<=0,e.id); }
    else { pHp[q]+=ARROW_DMG; on.arrowShot(h.x,h.y-3,cx+(W.prand()-0.5)*10,cy-4,false,-1); }
  }
  if (W.tickN%10===0) on.plotChanged(q);
  if (pHp[q]>=bldHp(q)) castleFalls(c,x.o);
}
/** The castle of kingdom d is stormed by a: the war is won, and the kingdom falls to a. */
function castleFalls(d: number, a: number){
  on.warWon(a,d);
  annex(d,a);
  on.peaceMade(a,d);
}
/** Kingdom o's soldiers outside an army (militia): with its capital besieged, each goes for the nearest besieger nobody of his is fighting
    (one on one) and fights him; at war otherwise, they keep round the castle (their roaming does). True while he is busy with it. */
export function guardStep(h: Human): boolean {
  const a=W.siege[h.o]; if (!a || h.war>=0 || h.hp<=0) return false;
  const n=W.nations[h.o]; if (n.capTile<0) return false;
  const [cx,cy]=castleXY(n);
  let e=h.duel>=0 ? byId.get(h.duel) : undefined;
  if (!e || e.hp<=0 || e.duel!==h.id){
    if (h.duel>=0) unbind(h);
    e=undefined; let bd=Infinity;
    for (const c of soldiersOf[a] ?? []){
      if (c.hp<=0 || c.war<0 || Math.hypot(c.x-cx,c.y-cy)>SIEGE_R*1.6) continue;
      const p=partner(c); if (p && p!==h) continue;
      const d=(c.x-h.x)**2+(c.y-h.y)**2; if (d<bd){ bd=d; e=c; }
    }
    if (!e) return false;
    bind(h,e);
  }
  duelStep(h,e,false);
  return true;
}
/** The barracks of o's in region r burn (a region taken: its barracks are lost, so nobody's army grows from what it captures). */
export function razeBarracks(r: number, o: number){
  const seen=new Set<number>();
  for (let i=RG.start[r];i<RG.start[r+1];i++){
    const t=RG.tiles[i], x=t%TW, y=(t/TW)|0, q=(y>>2)*PW+(x>>2);
    if (seen.has(q)) continue; seen.add(q);
    if (pType[q]===B_BARRACKS && pOwner[q]===o && pBurn[q]<=0 && region[pCenter[q]]===r) ignite(q);
  }
}
/** a holds every region it claimed of d's: the war is won, and they are its. */
function checkVictory(a: number, d: number){
  const regs=claimsOf(a,d); if (!regs.length || !regs.every(r => W.rOcc[r]===a) || !W.wars[a*W.M+d]) return;
  on.warWon(a,d);
  makePeace(a,d,true,a);
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
/** What a line's roll of the die does to its blows: 1 -20%, 2 -10%, 3 even, 4 +6.7%, 5 +13.3%, 6 +20%. */
export const diceFactor = (roll: number) => 1+(roll<=3 ? (roll-3)*ROLL_MOD/2 : (roll-3)*ROLL_MOD/3);
export function strike(h: Human, e: Human){
  if (h.cool>0 || h.beggar || h.hp<=0 || e.hp<=0) return;
  if (locked(h,e)) return;            // (a duel is one on one)
  h.duel=e.id; e.duel=h.id;
  h.cool=HIT_TICKS;
  on.swing(h.id,e.id);
  if (W.prand()<HIT_CHANCE){
    const was=e.hp;
    const roll=1+((W.prand()*3|0)-1)*STRIKE_SWING;
    const line=h.war>=0 ? armyById.get(h.war) : undefined, fighting=line && line.mode===A_BATTLE;
    const dice=fighting && line.roll ? diceFactor(line.roll) : 1;
    e.hp-=(h.kind!==H_SOLDIER ? MILITIA_DMG : h.militia ? MILITIA_HIT : h.arch ? HIT_DMG[1]*ARCHER_SHARE : HIT_DMG[h.tier])*roll*dice*(fighting ? BATTLE_DMG : 1);
    e.by=h.o; if (was>0 && e.hp<=0){ W.kills[h.o*W.M+e.o]++; const x=e.war>=0 ? armyById.get(e.war) : undefined; if (x) x.hitAt=W.tickN; }
    on.hit(e.x,e.y-2,e.hp<=0,e.id,h.id);
  }
}
/** The villagers of kingdom o near (x,y) rising as a mob: there are no mobs in this war (sim/story.ts asks). */
export function raiseMob(_o: number, _x: number, _y: number, _r: number, _dry=false){ return 0; }
/** A soldier not in a phalanx (militia) or a villager: nothing to do in a war of armies. */
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
