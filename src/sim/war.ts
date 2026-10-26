/* ---------- war: alliances, armies in the field, fighting, and the fall of kingdoms ----------
   Clicking another kingdom opens diplomacy: an alliance, or war. War sends out the armies of
   the kingdom's barracks (sim/army.ts), each one a campaign of its own that musters at its
   barracks; soldiers without room in a barracks stay home and only defend:
   - a raid crosses unclaimed or allied land to the target and burns its buildings, the
     outskirts first and on toward the centre. A raider who destroys a building carries a loot
     bag, worth LOOT_GOLD if he gets it home. If other kingdoms close every way through, the
     raid turns back.
   - an attack needs a shared border, and starts a war that lasts until peace. The army
     occupies the ground it marches over (burning what stands there) and pushes for the
     capital. Occupied land still belongs to its kingdom, but nobody lives or builds on it; at
     peace each side keeps what it occupies. Breaking the castle annexes the kingdom: its land,
     buildings and people go to the winner, and its gold and stockpile are lost.
   - an intercept sends soldiers after one enemy army, wherever it is, to fight it in the field.
   Two kingdoms are at war while a war between them lasts, or a raid between them is still
   out. A raid has no peace: it ends when the raiders are all dead or home. Recalled raiders
   stop burning and head straight home, but they are still the enemy until they get there:
   defenders fight them, towers shoot them, and an army can be sent after them. Only then do soldiers fight and watchtowers shoot (at enemies on their own land).
   An army of more than 5 has a leader, ranked by its size when it sets out (RANKS): he walks
   behind the last rank, fights only whoever comes at him, and his men go first for anyone on him.
   He decides an attack's course, measuring his army against its size when it set out: reaching the
   enemy's border with under 30% of it there, he halts until 60% have come up (giving up after two
   minutes and taking them home); in the assault he presses on until the army is down
   to 20%, then either falls back out of their land to regroup (3 times in 4: back in at 60%) or
   fights to the death. Soldiers of that barracks who are at home march out to join their army.
   If he falls, his barracks' army is leaderless for the rest of the war: its men, and every
   recruit after them, charge the enemy one by one, without formation.
   An army musters in a line behind a banner on its own border, then marches in formation: the
   banner waits for stragglers and for fights to finish, and soldiers break off for enemies and
   buildings near the line and come back to it. At home, when an enemy army comes near the
   border, idle soldiers form a line where it will cross and hold it, and villagers nearby
   either run or (half of them) take up arms and fall in behind the soldiers. Once the invaders
   are beaten the line moves on to the occupied land and takes it back; with all of it back,
   the army reports ready to counter-attack. Guards stay by their watchtowers, and the castle
   shoots too. Everyone heals slowly. Allies open their land to each other's armies. */
import { TW, TH, NT, NP, PW, PH, TICK, B_CASTLE, B_CPART, B_TOWER, B_HOUSE, B_FARM, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_MINE, B_RESEARCH, B_GUILD, isStructure } from '../core/constants';
import { W, owner, occ, isLand, pType, pOwner, pBurn, pMain, pHp, pPrio, pCenter, pTier, type Campaign, type Human, type Nation } from './state';
import { on } from './events';
import { setOwner } from './territory';
import { ignite, dims } from './buildings';
import { census } from './census';
import { BLD_HP, bldHp, wear, towerTier, castleTier, TOWER_RELOADS, TOWER_DMGS, CASTLE_MEND } from './defense';
import { SOLDIER_DMG, units, unitAt, type Unit } from './army';
import { H_SOLDIER, TASK_ROAM, TOWER_RANGE, maxHp, REGEN, pace, onCastle, release, backToRoam, frontOf, doorOf, barracksOf, switching, indoors, tileOf } from './population';

export const LOOT_GOLD = 50;          // a raider's loot bag, paid when he gets it home
export const MELEE_R = 2.6;           // pixels: close enough to strike
export const HIT_TICKS = 8;           // ticks between blows
export const HIT_CHANCE = 0.7;
export const HIT_DMG = SOLDIER_DMG;   // a soldier's blow, by tier (soldiers have SOLDIER_HP by tier)
export const MILITIA_DMG = 0.5;       // a villager with a pitchfork does half that
export const BLD_DMG = 1;             // a blow on a building
const ENGAGE_R = 16;                  // pixels around him a soldier in the field picks a fight...
const LEASH = 34;                     // ...with enemies this close to his banner
const RAID_R = 22;                    // pixels around the banner raiders spread out to burn
const GUARD_R = 26, BARRACKS_R = 30, CAPITAL_R = 40;   // pixels around their post soldiers at home defend
export const CASTLE_RANGE = 40;       // the castle shoots further than a watchtower (and twice as often: sim/defense.ts)
const THREAT_TILES = 12;              // an enemy banner this many tiles from our land, and the home guard turns out
const DEFEND_R = 30;                  // pixels around its line the home guard fights
export const DANGER_R = 26;           // pixels: an enemy this close alarms a villager
export const CALM_TICKS = 120;        // ticks without an enemy near before an alarmed villager goes back to work
const INTERCEPT_MUSTER = 60;          // interceptors form up quickly
const SPACING = 4;                    // pixels between soldiers in the line, and between ranks
const ROOM = 2.4;                     // pixels fighters keep between them, so a crowd can't pile onto one spot
const CROWD = 5;                      // a foe already fought by others counts this many pixels further away per fighter
export const MARCH_SP = 3.2;          // pixels a second the banner moves
export const CAPTURE_EVERY = 5;       // ticks between land grabs by each soldier of an attack
const CAPTURE_R = 2;                  // tiles around him
/** The ranks of an army's leader, by the army's size when it set out: none for 5 or fewer. */
export const RANKS = ['', 'Leader', 'General', 'Captain', 'Commander', 'Grand Marshal'];
export const rankFor = (size: number) => size<=5 ? 0 : size<=15 ? 1 : size<=30 ? 2 : size<=50 ? 3 : size<=80 ? 4 : 5;
// what an attacking army is doing (Campaign.mode)
export const M_MARCH=0, M_HOLD=1, M_ASSAULT=2, M_FALLBACK=3, M_REGROUP=4, M_BLIND=5;
export const HOLD_BELOW = 0.3, READY_AT = 0.6, BREAK_AT = 0.2, RETREAT_CHANCE = 0.75;   // shares of the barracks' army
const PRESENT_R = 40;                 // pixels around the banner a man counts as with his army
const PATIENCE = 1200;                // ticks a leader waits for reinforcements before he takes his army home (2 min)
export const REVENGE_DMG = 1.25, REVENGE_PACE = 1.1;   // a counter-attack's soldiers hit 25% harder and march 10% faster
const REFIELD = 20;                   // ticks between working out the way again (2 s)
export const MUSTER_TICKS = 200;      // longest an army waits at the muster point (20 s)
const STALL_TICKS = 60;               // longest the banner waits for stragglers and fights (6 s)...
const STRAGGLE_TICKS = 300;           // ...or, with most of the army still far behind, for it to catch up (30 s)
export const OFFER_TICKS = 300;       // a peace offer stands 30 s
export const MAX_ALLIES = 3;
const GRUDGE_TICKS = 900;             // a kingdom attacked in the last 90 s won't ally with its attacker
export { BLD_HP, bldHp };

export const allied = (a: number, b: number) => a!==b && W.ally[a*W.M+b]===1;
export const atWar = (a: number, b: number) => W.atWar[a*W.M+b]===1;
export function alliesOf(a: number){ let k=0; for (let o=1;o<W.M;o++) if (allied(a,o)) k++; return k; }

/* ---------- per-tick lookups ---------- */
const byId = new Map<number, Human>();
const camps = new Map<number, Campaign>();
const troops = new Map<number, Human[]>();      // campaign id → its soldiers
let armies: Human[][] = [];                     // per nation: soldiers out of doors and alive
let posts: [number, number][][] = [];           // per nation at war: barracks doorsteps
let warring = new Uint8Array(1);                // per nation: at war with anyone
/** Where a kingdom's home guard forms its line: facing an army about to cross the border, or on occupied land to take back. */
interface Rally { x: number; y: number; dx: number; dy: number; threat: boolean; n: number }
let rallies: (Rally | null)[] = [];
// per kingdom: steps to its rally over its own land, and the rally tile they were worked out for
let homeField: Int16Array[] = [], homeFieldFor: number[] = [];
const heldAt = new Int32Array(NT), heldBy = new Uint8Array(NT);   // tick a soldier last stood on or beside a tile his side holds, and whose
const queue = new Int32Array(NT), scratch = new Int16Array(NT);
const want = new Int32Array(NT); let wantSeq = 0;   // tiles a fill is looking for, stamped wantSeq
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

export function resetWar(M: number){
  W.campaigns=[]; W.campSeq=0;
  W.ally=new Uint8Array(M*M); W.atWar=new Uint8Array(M*M); W.offers=new Int32Array(M*M); W.grudge=new Int32Array(M*M).fill(-1e9);
  W.wars=new Uint8Array(M*M); W.warSince=new Int32Array(M*M); W.occCount=new Int32Array(M*M); W.lost=new Uint8Array(M*M); W.ready=new Int32Array(M*M); W.orphans=[];
  byId.clear(); camps.clear(); troops.clear(); armies=[]; posts=[]; warring=new Uint8Array(M); rallies=[]; homeField=[]; homeFieldFor=[]; heldAt.fill(0);
}

/* ---------- the way there ---------- */
const mainOf = (q: number) => pType[q]===B_PART || pType[q]===B_CPART ? pMain[q] : q;
/** The pixel rectangle a building covers, from its main plot. */
function rectOf(q: number): [number, number, number, number] {
  const [w,h]=dims(q), x=(q%PW)*8, y=((q/PW)|0)*8;
  return [x, y, x+w*8, y+h*8];
}
const clamp = (v: number, a: number, b: number) => v<a ? a : v>b ? b : v;

/** May h stand on ground owned by o? People keep to their own land and unclaimed ground; an army
    may also cross its enemy's and its allies' land, and anything at all on the way home. */
export function mayStand(h: Human, o: number){
  if (o===0 || o===h.o) return true;
  const c = h.war>=0 ? camps.get(h.war) : undefined;
  return !!c && (c.phase===2 || o===c.d || allied(c.a,o));
}

/** Fills f with steps to the nearest of `src` over land a's army may cross on its way to d
    (with `any`, over all land), -1 where there is no way. It looks for the tiles `mark` stamps
    (each stamped tile counts once; one is enough if `first`), and stops `margin` steps past the
    last of them. Returns the first such tile reached, or -1. */
function fill(f: Int16Array, src: number[], a: number, d: number, any: boolean, mark: (stamp: number) => number, first: boolean, margin: number){
  const stamp=++wantSeq, wanted=mark(stamp);
  f.fill(-1);
  let head=0, tail=0, found=-1, left=wanted, until=32000;
  for (const s of src) if (f[s]<0){ f[s]=0; queue[tail++]=s; }
  // which owners' land the army may cross
  const pass=new Uint8Array(W.M); pass[0]=pass[a]=pass[d]=1;
  for (let o=1;o<W.M;o++) if (any || W.ally[a*W.M+o]) pass[o]=1;
  const tw=TW, nt=NT, land=isLand, own=owner, Q=queue, mk=want;   // local names: much faster in a hot loop than imports
  while (head<tail){
    const t=Q[head++], v=f[t];
    if (v>until) break;
    if (mk[t]===stamp){
      mk[t]=0; if (found<0) found=t;
      if (--left<=0 || first) until=Math.min(until,v+margin);
    }
    const x=t%tw, nv=v+1;
    let n=t-1;  if (x>0 && f[n]<0 && land[n] && pass[own[n]]){ f[n]=nv; Q[tail++]=n; }
    n=t+1;      if (x<tw-1 && f[n]<0 && land[n] && pass[own[n]]){ f[n]=nv; Q[tail++]=n; }
    n=t-tw;     if (t>=tw && f[n]<0 && land[n] && pass[own[n]]){ f[n]=nv; Q[tail++]=n; }
    n=t+tw;     if (t<nt-tw && f[n]<0 && land[n] && pass[own[n]]){ f[n]=nv; Q[tail++]=n; }
  }
  return found;
}
/** Stamps every tile of nation a as wanted. */
const ownLand = (a: number) => (stamp: number) => { const own=owner, mk=want, nt=NT; let k=0; for (let t=0;t<nt;t++) if (own[t]===a){ mk[t]=stamp; k++; } return k; };
/** Stamps the tiles under the banner and the soldiers. */
function armyTiles(c: Campaign, banner: boolean){
  return (stamp: number) => {
    let k=0; const add=(t: number) => { if (want[t]!==stamp){ want[t]=stamp; k++; } };
    if (banner) add(tileOf(c.bx,c.by));
    for (const id of c.members){ const h=byId.get(id); if (h) add(tileOf(h.x,h.y)); }
    return k;
  };
}
/** The centre of the next tile down the field from (x,y), or null with no way on. */
function downhill(f: Int16Array, x: number, y: number): [number, number] | null {
  const tx=(x/2)|0, ty=(y/2)|0, here=f[ty*TW+tx];
  let best=-1, bv = here<0 ? 32767 : here;
  for (const [ox,oy] of DIRS8){
    const nx=tx+ox, ny=ty+oy; if (nx<0||ny<0||nx>=TW||ny>=TH) continue;
    const k=ny*TW+nx, v=f[k]; if (v<0 || v>=bv) continue;
    if (ox && oy && (f[ty*TW+nx]<0 || f[ny*TW+tx]<0)) continue;   // no squeezing between two corners
    bv=v; best=k;
  }
  if (best<0) return here>=0 ? [tx*2+1, ty*2+1] : null;
  return [(best%TW)*2+1, ((best/TW)|0)*2+1];
}
/** True if the straight walk a→b only crosses tiles with a way in field f. */
function clearWay(f: Int16Array, ax: number, ay: number, bx: number, by: number){
  const x0=ax/2, y0=ay/2, x1=bx/2, y1=by/2, dx=x1-x0, dy=y1-y0, sx=dx>0?1:-1, sy=dy>0?1:-1;
  let tx=Math.floor(x0), ty=Math.floor(y0); const ex=Math.floor(x1), ey=Math.floor(y1);
  const tdx=dx ? Math.abs(1/dx) : Infinity, tdy=dy ? Math.abs(1/dy) : Infinity;
  let tmx=dx ? (sx>0 ? tx+1-x0 : x0-tx)*tdx : Infinity, tmy=dy ? (sy>0 ? ty+1-y0 : y0-ty)*tdy : Infinity;
  for (let guard=0;guard<2000;guard++){
    if (tx<0||ty<0||tx>=TW||ty>=TH || f[ty*TW+tx]<0) return false;
    if (tx===ex && ty===ey) return true;
    if (tmx<tmy){ tmx+=tdx; tx+=sx; } else { tmy+=tdy; ty+=sy; }
  }
  return true;
}

/** What a raid on d can burn: its standing buildings, castle aside. Main plots. */
export function raidTargets(d: number){
  const n=W.nations[d]; if (!n) return [];
  return n.blds.filter(q => pOwner[q]===d && pBurn[q]<=0 && isStructure(pType[q]) && pType[q]!==B_PART);
}
function nearestTile(d: number, x: number, y: number, by: number){
  let best=-1, bd=Infinity;
  for (let t=0;t<NT;t++){ if (owner[t]!==d || occ[t]===by) continue; const e=((t%TW)*2+1-x)**2+(((t/TW)|0)*2+1-y)**2; if (e<bd){ bd=e; best=t; } }
  return best;
}
/** Where the army is headed: a raid, every building it could burn; an attack, the capital; an
    intercept, the army it is after. */
function goalsOf(c: Campaign){
  if (c.raid) return raidTargets(c.d).map(q => pCenter[q]);
  if (c.target>=0){ const E=campaignById(c.target); if (!E || !E.hostile) return []; const [x,y]=armyAt(E); return [tileOf(x,y)]; }
  const D=W.nations[c.d];
  c.goal = D.capTile>=0 ? D.capTile : nearestTile(c.d,c.bx,c.by,c.a);
  if (c.goal<0 && D.alive){ annex(c.d,c.a); return []; }   // no capital and every last field occupied: the kingdom is ours
  return c.goal>=0 ? [c.goal] : [];
}
/** Where an army is: its banner on the march, the middle of its men on the way home. */
function armyAt(c: Campaign): [number, number] {
  if (c.phase<2) return [c.bx,c.by];
  let x=0, y=0, k=0; for (const id of c.members){ const h=byId.get(id); if (h){ x+=h.x; y+=h.y; k++; } }
  return k ? [x/k,y/k] : [c.bx,c.by];
}
const campaignById = (id: number) => camps.get(id) ?? W.campaigns.find(c => c.id===id);
/** True if a's army could reach something of d's to raid, crossing only unclaimed, allied or d's land. */
export function routeOpen(a: number, d: number){
  const src=raidTargets(d).map(q => pCenter[q]); if (!src.length) return false;
  return fill(scratch,src,a,d,false,ownLand(a),true,0)>=0;
}

/* ---------- declaring war ---------- */
/** n's armies ready to march: each barracks with the soldiers of its army who are at home. */
export function available(n: Nation){
  const out: { unit: Unit; men: Human[] }[]=[];
  for (const u of units[n.id] ?? []){
    const men=u.members.filter(h => h.war<0 && h.hp>0 && !switching(h)).sort((x,y)=>x.id-y.id);
    if (men.length) out.push({ unit:u, men });
  }
  return out;
}
/** How many of n's soldiers could march right now. */
export const ready = (n: Nation) => available(n).reduce((k,a) => k+a.men.length, 0);
/** The armies to send: the barracks named (any plot of each), or, for a number, the biggest armies
    first until that many soldiers are found (the last one sending only as many as are missing). */
function pickArmies(n: Nation, pick: number | number[]){
  const all=available(n);
  if (Array.isArray(pick)){ const want=new Set(pick.map(q => unitAt(q)?.key)); return all.filter(a => want.has(a.unit.key)); }
  all.sort((a,b) => b.men.length-a.men.length || a.unit.key-b.unit.key);
  const out: typeof all=[]; let left=Math.floor(pick);
  for (const a of all){ if (left<=0) break; const men=a.men.slice(0,left); left-=men.length; out.push({ unit:a.unit, men }); }
  return out;
}
/** Why a can't go to war on d this way, or null if it can. */
export function warProblem(a: number, d: number, raid: boolean): string | null {
  const A=W.nations[a], D=W.nations[d];
  if (!A?.alive || !D?.alive || !d || a===d) return 'That kingdom is gone';
  if (!raid && !W.contact[a*W.M+d]) return 'Needs a shared border';
  if (raid && !raidTargets(d).length) return 'They have nothing to raid';
  if (raid && !routeOpen(a,d)) return 'Other kingdoms block every way there';
  return null;
}

/** Sends a's armies against d: the barracks named, or armies enough for `pick` soldiers. Each
    army marches on its own. Returns false if none could go. */
export function declare(a: number, d: number, raid: boolean, pick: number | number[]){
  if (warProblem(a,d,raid)) return false;
  const A=W.nations[a], D=W.nations[d];
  const M=W.M, counter=!raid && W.ready[a*M+d]>0;   // our land is back: this one is for revenge
  let sent=0, first: Campaign | undefined;
  for (const { unit, men } of pickArmies(A,pick)){
    const c=newCampaign(a,d,raid,-1,men.length,D.tiles,unit.key);
    c.inspired=counter;
    if (muster(c,men,unit)){ sent++; first??=c; }
  }
  if (!sent) return false;
  if (allied(a,d)){ W.ally[a*W.M+d]=W.ally[d*W.M+a]=0; on.allianceBroken(a,d); }
  W.grudge[d*W.M+a]=W.tickN;
  if (counter) on.story('revenge',a,first!.bx,first!.by,d);
  if (!raid){
    if (!W.wars[a*M+d]){ W.wars[a*M+d]=W.wars[d*M+a]=1; W.warSince[a*M+d]=W.warSince[d*M+a]=W.tickN; }
    W.ready[a*M+d]=0;   // the counter-attack it was ready for is under way
  }
  W.atWar[a*M+d]=W.atWar[d*M+a]=1;
  on.warBegan(a,d,raid);
  return true;
}
function newCampaign(a: number, d: number, raid: boolean, target: number, size: number, tiles: number, unit: number): Campaign {
  return { id:++W.campSeq, a, d, raid, target, hostile:true, members:[], phase:0, bx:0, by:0, dx:1, dy:0, rx:0, ry:0, goal:-1,
    field:new Int16Array(NT), fieldAt:W.tickN, started:W.tickN, startSoldiers:size, startTiles:tiles, stall:0, why:'', unit, inspired:false, leader:-1, rank:0, mode:M_MARCH, stand:false };
}
/** Works out the way and calls the soldiers to form up in front of their barracks (or, if the way
    can't reach it, on our own ground nearest the goal). */
function muster(c: Campaign, pool: Human[], u?: Unit){
  const A=W.nations[c.a];
  if (A.capTile>=0){ const [x,y]=doorOf(A); c.bx=x; c.by=y; }
  const home=u ? tileOf(u.x,u.y) : -1;
  let best=home>=0 ? fill(c.field,goalsOf(c),c.a,c.d,false,(st) => { want[home]=st; return 1; },true,2) : -1;
  if (best<0) best=fill(c.field,goalsOf(c),c.a,c.d,false,ownLand(c.a),true,80);
  if (best<0) return false;
  c.rx=c.bx=(best%TW)*2+1; c.ry=c.by=((best/TW)|0)*2+1;
  const s=downhill(c.field,c.bx,c.by);
  if (s && (s[0]!==c.bx || s[1]!==c.by)){ const L=Math.hypot(s[0]-c.bx,s[1]-c.by); c.dx=(s[0]-c.bx)/L; c.dy=(s[1]-c.by)/L; }
  W.campaigns.push(c); camps.set(c.id,c);
  pool.forEach((h,i) => enlist(c,h,i));
  // more than 5: the best armoured of them leads (the longest serving among equals)
  c.rank=c.mode===M_BLIND ? 0 : rankFor(pool.length);
  if (c.rank){ const l=pool.reduce((b,h) => h.tier>b.tier || (h.tier===b.tier && h.id<b.id) ? h : b); c.leader=l.id; l.slot=1e6; on.order('march',c.a,c.d,c.rank,l.id,l.x,l.y); }
  return true;
}
/** Soldier h joins army c (at the end of its line). */
function enlist(c: Campaign, h: Human, slot: number){
  release(h); h.post=-1; h.site=-1; h.war=c.id; h.foe=-1; h.aim=-1; h.slot=slot; h.task=TASK_ROAM; h.path=[]; h.wait=0; h.calm=0;
  if (!c.members.includes(h.id)) c.members.push(h.id);
}
/** Why n can't send soldiers after enemy army `id`, or null. */
export function interceptProblem(n: number, id: number): string | null {
  const E=campaignById(id);
  if (!E || !E.hostile || E.d!==n || E.target>=0) return 'That army is gone';   // raiders on their way home can still be caught
  if (W.campaigns.some(c => c.a===n && c.target===id && c.phase<2)) return 'You are already after that army';
  return null;
}
/** Sends n's armies (the barracks named, or enough for `pick` soldiers) after enemy army `id`. */
export function intercept(n: number, id: number, pick: number | number[]){
  if (interceptProblem(n,id)) return false;
  const E=campaignById(id)!;
  let sent=0;
  for (const { unit, men } of pickArmies(W.nations[n],pick)){
    const c=newCampaign(n,E.a,false,id,men.length,W.nations[E.a].tiles,unit.key);
    if (muster(c,men,unit)) sent+=men.length;
  }
  if (!sent) return false;
  on.intercepting(n,E.a,sent);
  return true;
}

/** Turns the army for home: recalled, cut off, at peace, or with its work done. */
function sendHome(c: Campaign, why: string, hostile=c.hostile){
  c.hostile=c.hostile && hostile;
  if (c.phase===2) return;
  c.phase=2; c.why=why;
  for (const id of c.members){ const h=byId.get(id); if (h){ h.foe=-1; h.aim=-1; } }
  refield(c);
  on.armyHome(c.a,c.d,c.raid,why);
}
function refield(c: Campaign){
  c.fieldAt=W.tickN;
  if (c.phase===2){
    const src: number[]=[]; for (let t=0;t<NT;t++) if (owner[t]===c.a) src.push(t);
    fill(c.field,src,c.a,c.d,true,armyTiles(c,false),false,12); return;
  }
  if (c.mode===M_FALLBACK){
    // falling back: the way out of their land, to the nearest ground that isn't theirs
    const src: number[]=[]; for (let t=0;t<NT;t++){ const o=owner[t]; if (isLand[t] && o!==c.d && (o===0 || o===c.a || allied(c.a,o))) src.push(t); }
    fill(c.field,src,c.a,c.d,false,armyTiles(c,true),false,12); return;
  }
  const src=goalsOf(c);
  if (!src.length){ if (c.phase<2) sendHome(c, c.raid || c.target>=0 ? 'done' : 'won', (c.raid || c.target>=0) && c.hostile); return; }
  fill(c.field,src,c.a,c.d,false,armyTiles(c,true),false,24);
  if (c.field[tileOf(c.bx,c.by)]<0) sendHome(c,'cut');   // other kingdoms have closed every way on
}

/* ---------- peace and alliances ---------- */
/** Kingdom `from` asks `to` for peace. Bots answer when they next think; the player from the war chip. */
export function offerPeace(from: number, to: number){
  if (!W.wars[from*W.M+to] || W.offers[from*W.M+to]) return;   // a raid has no peace to make: it ends when the raiders are gone
  W.offers[from*W.M+to]=W.tickN; on.peaceOffered(from,to);
}
export function refusePeace(from: number, to: number){ W.offers[from*W.M+to]=0; on.peaceRefused(from,to); }
export function makePeace(a: number, b: number){
  const M=W.M;
  for (const c of W.campaigns) if ((c.a===a && c.d===b) || (c.a===b && c.d===a)) sendHome(c,'peace',false);
  // each side keeps the land it occupies
  for (let t=0;t<NT;t++){ const o=occ[t]; if (o && ((o===a && owner[t]===b) || (o===b && owner[t]===a))) setOwner(t,o); }
  for (const i of [a*M+b, b*M+a]){ W.offers[i]=0; W.atWar[i]=0; W.wars[i]=0; W.lost[i]=0; W.ready[i]=0; }
  for (let i=W.orphans.length-3;i>=0;i-=3){ const o=W.orphans[i], d=W.orphans[i+2]; if ((o===a && d===b) || (o===b && d===a)) W.orphans.splice(i,3); }   // the war is over
  on.peaceMade(a,b);
}
/** n wants the fighting with t to end: its raids turn for home (still hostile until they get
    there), and a war gets a peace offer. */
export function endWar(n: number, t: number){
  for (const c of W.campaigns) if (c.hostile && c.a===n && c.d===t && c.raid && c.phase<2) sendHome(c,'recall');
  if (W.wars[n*W.M+t]) offerPeace(n,t);
}
/** How the fighting with o is going for n: above 0 winning, below 0 losing. */
export function outlook(n: Nation, o: number){
  const O=W.nations[o]; let gained=0, mine=0, theirs=0;
  for (const c of W.campaigns){
    if (!c.hostile) continue;
    if (c.a===n.id && c.d===o){ mine+=c.members.length; gained+=(c.startTiles-O.tiles)/Math.max(1,c.startTiles); }
    else if (c.a===o && c.d===n.id){ theirs+=c.members.length; gained-=(c.startTiles-n.tiles)/Math.max(1,c.startTiles); }
  }
  return 0.6*Math.log((n.soldiers+1)/(O.soldiers+1)) + 3*gained + (mine-theirs)/(mine+theirs+5);
}
/** Ticks since the fighting between a and b began (0 if they are at peace). */
export function warAge(a: number, b: number){
  let since=W.wars[a*W.M+b] ? W.warSince[a*W.M+b] : W.tickN;
  for (const c of W.campaigns) if (c.hostile && ((c.a===a && c.d===b) || (c.a===b && c.d===a))) since=Math.min(since,c.started);
  return W.tickN-since;
}
/** A bot weighing peace with o: it holds out while it thinks it can win, and gives in when it is
    in trouble; a long war wears it down. */
export function wantsPeace(n: Nation, o: number){
  return outlook(n,o) + (W.srand()-0.5)*0.5 - Math.min(1,warAge(n.id,o)/6000) < 0;
}
/** Why a can't propose an alliance to b, or null. */
export function allyProblem(a: number, b: number): string | null {
  const A=W.nations[a], B=W.nations[b];
  if (!A?.alive || !B?.alive || !b || a===b) return 'That kingdom is gone';
  if (allied(a,b)) return 'You are already allies';
  if (atWar(a,b)) return 'Make peace first';
  if (alliesOf(a)>=MAX_ALLIES) return `You already have ${MAX_ALLIES} allies`;
  return null;
}
/** What b says to an alliance with a: null if it agrees, otherwise why not. */
export function allyAnswer(a: number, b: number): string | null {
  const A=W.nations[a], B=W.nations[b];
  if (alliesOf(b)>=MAX_ALLIES) return `${B.name} has all the allies it wants`;
  if (W.tickN-W.grudge[b*W.M+a] < GRUDGE_TICKS) return `${B.name} has not forgotten your attack`;
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
/** The loser's castle is broken: its land, buildings and people go to the winner; its gold and goods are lost. */
export function annex(loser: number, winner: number){
  const L=W.nations[loser], cap=L.capTile>=0 ? L.capPlot : -1;
  L.capTile=-1;   // so taking the ground below doesn't count as an ordinary sack
  for (const h of W.humans){
    if (h.o!==loser) continue;
    release(h); h.carry=-1; h.amount=0; h.o=winner; h.post=-1; h.site=-1; h.war=-1; h.foe=-1; h.aim=-1; h.loot=false; h.brave=-1; h.calm=0; h.work=-1;
    h.task=TASK_ROAM; h.path=[]; h.wait=0; h.tx=h.x; h.ty=h.y;
  }
  // buildings change hands before the ground does, so they don't burn
  for (let q=0;q<NP;q++){
    if (pOwner[q]!==loser) continue;
    if (pType[q]===B_CASTLE || pType[q]===B_CPART) continue;
    if (isStructure(pType[q])){ pOwner[q]=winner; pPrio[q]=0; on.plotChanged(q); }
  }
  if (cap>=0) for (const k of [cap,cap+1,cap+PW,cap+PW+1]) ignite(k);
  // the loser's armies scatter; armies sent against it turn for home
  W.campaigns=W.campaigns.filter(c => c.a!==loser);
  for (const c of W.campaigns) if (c.d===loser) sendHome(c,'won',false);
  L.gold=0; L.stock=[0,0,0];
  for (let t=0;t<NT;t++) if (occ[t]===loser) liberate(t);   // what it held of others' land is free again
  for (let o=1;o<W.M;o++){ const i=loser*W.M+o, j=o*W.M+loser; W.ally[i]=W.ally[j]=W.offers[i]=W.offers[j]=W.atWar[i]=W.atWar[j]=W.wars[i]=W.wars[j]=W.lost[i]=W.lost[j]=W.ready[i]=W.ready[j]=0; }
  for (let t=0;t<NT;t++) if (owner[t]===loser) setOwner(t,winner);   // the last tile eliminates it
  census();
  on.annexed(loser,winner);
}

/* ---------- fighters keep their room ---------- */
const fighting = new Map<number, number>();   // enemy id -> how many are fighting him, rebuilt each tick
/** How many others are already fighting e (not counting h). */
const crowdOn = (e: Human, h: Human) => (fighting.get(e.id) ?? 0) - (h.foe===e.id ? 1 : 0);
/** In kingdoms at war, soldiers (and armed villagers) closer than ROOM to a comrade step apart, each where he may
    stand, so a crowd spreads into ranks rather than piling onto one spot. */
export function spread(){
  const cell=new Map<number, Human[]>(), key=(x: number, y: number) => ((y/4)|0)*1000+((x/4)|0);
  const fights=(h: Human) => h.hp>0 && !indoors(h) && warring[h.o]===1 && (h.kind===H_SOLDIER || h.brave>=1);
  for (const h of W.humans){
    if (!fights(h)) continue;
    const k=key(h.x,h.y); let L=cell.get(k); if (!L){ L=[]; cell.set(k,L); } L.push(h);
  }
  for (const h of W.humans){
    if (!fights(h)) continue;
    let px=0, py=0;
    const cx=(h.x/4)|0, cy=(h.y/4)|0;
    for (let y=cy-1;y<=cy+1;y++) for (let x=cx-1;x<=cx+1;x++) for (const e of cell.get(y*1000+x) ?? []){
      if (e===h || e.o!==h.o) continue;
      let dx=h.x-e.x, dy=h.y-e.y; const d=Math.hypot(dx,dy); if (d>=ROOM) continue;
      if (d<1e-3){ const a=((h.id*2654435761)>>>0)/4294967296*6.283; dx=Math.cos(a); dy=Math.sin(a); } else { dx/=d; dy/=d; }   // exactly on top: apart along a fixed way
      px+=dx*(ROOM-d)*0.5; py+=dy*(ROOM-d)*0.5;
    }
    if (!px && !py) continue;
    const L=Math.hypot(px,py), m=Math.min(L,0.6)/L, nx=h.x+px*m, ny=h.y+py*m, t=tileOf(nx,ny);
    if (nx<0 || ny<0 || nx>=TW*2 || ny>=TH*2 || !isLand[t] || (owner[t] && onCastle(W.nations[owner[t]],nx,ny))) continue;
    if (h.war>=0 ? mayStand(h,owner[t]) : owner[t]===h.o){ h.x=nx; h.y=ny; }   // armies where they may go, everyone else at home
  }
}

/* ---------- the armies, each tick ---------- */
/** Where soldier h of army c belongs: his place in the line, or the leader's, behind the last rank. */
function placeOf(c: Campaign, h: Human): [number, number] {
  const n=c.members.length-(c.leader>=0 ? 1 : 0);
  if (h.id!==c.leader) return slotPos(c,h.slot,n);
  const cols=Math.max(4,Math.min(12,Math.ceil(Math.sqrt(n*2.5)))), back=Math.ceil(n/cols)*SPACING+1.5+SPACING*0.8;
  return [c.bx-c.dx*back, c.by-c.dy*back];
}
function slotPos(c: Campaign, i: number, n: number): [number, number] {
  const cols=Math.max(4,Math.min(12,Math.ceil(Math.sqrt(n*2.5)))), rank=(i/cols)|0, col=i%cols, inRank=Math.min(cols,n-rank*cols);
  const across=(col-(inRank-1)/2)*SPACING, back=rank*SPACING+1.5;
  return [c.bx - c.dy*across - c.dx*back, c.by + c.dx*across - c.dy*back];
}
function advance(c: Campaign){
  const f=c.field, here=f[tileOf(c.bx,c.by)];
  if (here<0) return;
  if (c.mode!==M_FALLBACK && here<=(c.target>=0 ? 3 : 1)){ if (!c.raid && c.target<0 && W.nations[c.d].capTile<0) c.fieldAt=-1e9; return; }   // there: siege, burn, close with the enemy, or (no capital) find more land
  const s=downhill(f,c.bx,c.by); if (!s) return;
  const dx=s[0]-c.bx, dy=s[1]-c.by, d=Math.hypot(dx,dy); if (d<1e-6) return;
  const st=Math.min(d,MARCH_SP*(c.inspired ? REVENGE_PACE : 1)*TICK); c.bx+=dx/d*st; c.by+=dy/d*st;
  // the line turns gradually toward where it is going
  c.dx+=(dx/d-c.dx)*0.08; c.dy+=(dy/d-c.dy)*0.08; const L=Math.hypot(c.dx,c.dy)||1; c.dx/=L; c.dy/=L;
}
function runCampaign(c: Campaign, men: Human[]){
  if (!men.length){ if (c.leader>=0) leaderGone(c); W.campaigns.splice(W.campaigns.indexOf(c),1); camps.delete(c.id); on.armyGone(c.a,c.d,c.raid,c.phase===2 ? c.why : 'lost'); return; }
  // the line keeps its order and closes its gaps (the leader stays behind it)
  men.sort((x,y)=>x.slot-y.slot || x.id-y.id); men.forEach((h,i) => h.slot=h.id===c.leader ? 1e6 : i);
  c.members=men.map(h => h.id);
  if (c.leader>=0 && !men.some(h => h.id===c.leader)) leaderGone(c);
  if (c.phase<2 && !W.nations[c.d].alive){ sendHome(c,'won',false); return; }
  if (c.phase<2 && c.target>=0){ const E=campaignById(c.target); if (!E || !E.hostile){ sendHome(c,'done',false); return; } }   // they are beaten, home, or at peace
  if (W.tickN-c.fieldAt>=(c.target>=0 ? REFIELD/2 : REFIELD)) refield(c);
  if (c.phase===2) return;
  if (c.mode===M_BLIND){ c.phase=1; followFront(c,men); return; }
  let inPlace=0, near=0, busy=false;
  for (const h of men){
    const [sx,sy]=placeOf(c,h), d2=(h.x-sx)**2+(h.y-sy)**2;
    if (d2<25) inPlace++; if (d2<400) near++; if (h.foe>=0) busy=true;
  }
  if (c.phase===0){ if (inPlace>=men.length*0.7 || W.tickN-c.started>=(c.target>=0 ? INTERCEPT_MUSTER : MUSTER_TICKS)){ c.phase=1; c.stall=0; } return; }
  if (!c.raid && c.target<0 && command(c,men)) return;   // an attack: its leader decides whether it moves on
  // the banner waits for fights to end and (on the march) for stragglers, but not for ever
  const marching=c.raid || c.target>=0 || c.mode===M_MARCH;
  const wait=busy || (marching && inPlace<men.length*0.6);
  if (wait && c.stall<(marching && near<men.length*0.5 ? STRAGGLE_TICKS : STALL_TICKS)){ c.stall++; return; }
  if (!wait) c.stall=0;
  advance(c);
}

/* ---------- leaders ---------- */
/** An attack's leader sizes up his army and gives his orders. Returns true if the banner stays put
    this tick (holding at the border, regrouping). */
function command(c: Campaign, men: Human[]){
  const ref=Math.max(1,c.startSoldiers);   // the army as it set out
  const present=men.filter(h => (h.x-c.bx)**2+(h.y-c.by)**2<PRESENT_R*PRESENT_R).length/ref, strength=men.length/ref;
  const order=(kind: string) => { const l=byId.get(c.leader); if (l) on.order(kind,c.a,c.d,c.rank,l.id,l.x,l.y); };
  const lead=c.leader>=0;
  if (c.mode===M_MARCH){
    // at the enemy's border: is the army fit to go in?
    const s=downhill(c.field,c.bx,c.by), at=owner[tileOf(c.bx,c.by)]===c.d || (!!s && owner[tileOf(s[0],s[1])]===c.d);
    if (!at) return false;
    if (lead && present<HOLD_BELOW){ c.mode=M_HOLD; c.stall=0; order('hold'); return true; }
    c.mode=M_ASSAULT; c.stall=0; if (lead) order('assault');
    return false;
  }
  if (c.mode===M_HOLD || c.mode===M_REGROUP){
    if (present<READY_AT){   // waiting for reinforcements, but not for ever
      if (++c.stall>=PATIENCE){ order('home'); sendHome(c,'done'); }
      return true;
    }
    c.mode=M_ASSAULT; c.stall=0; c.fieldAt=-1e9; order('assault');
    return false;
  }
  if (c.mode===M_ASSAULT && lead && !c.stand && strength<=BREAK_AT){
    // bled white: fall back and make good the losses, or fight on to the last
    if (W.prand()<RETREAT_CHANCE){ c.mode=M_FALLBACK; c.stall=0; for (const h of men){ h.foe=-1; h.aim=-1; } refield(c); order('retreat'); }
    else { c.stand=true; order('stand'); }
    return false;
  }
  if (c.mode===M_FALLBACK && owner[tileOf(c.bx,c.by)]!==c.d){ c.mode=M_REGROUP; c.stall=0; c.fieldAt=-1e9; order('regroup'); return true; }   // out of their land
  return false;
}
/** The leader is no longer with army c: home ahead of it, or fallen. */
function leaderGone(c: Campaign){ const l=byId.get(c.leader); if (l && l.hp>0) c.leader=-1; else leaderFell(c); }
/** The leader of army c is dead: an attack goes on leaderless, every man for himself, and so does
    every man its barracks sends for the rest of the war. */
function leaderFell(c: Campaign){
  const attack=!c.raid && c.target<0;
  on.order(attack ? 'fell' : 'slain',c.a,c.d,c.rank,c.leader,c.bx,c.by);
  c.leader=-1;
  if (!attack) return;
  c.mode=M_BLIND;
  if (c.unit>=0 && !orphaned(c.a,c.unit,c.d)) W.orphans.push(c.a,c.unit,c.d);
}
/** The war in which barracks `unit` of kingdom o lost its leader (its new men charge on their own), or -1. */
export function leaderlessIn(o: number, unit: number){ const O=W.orphans; for (let i=0;i<O.length;i+=3) if (O[i]===o && O[i+1]===unit) return O[i+2]; return -1; }
const orphaned = (o: number, unit: number, d: number) => { const O=W.orphans; for (let i=0;i<O.length;i+=3) if (O[i]===o && O[i+1]===unit && O[i+2]===d) return true; return false; };
/** A leaderless army has no line: its banner is simply wherever its foremost man has got to. */
function followFront(c: Campaign, men: Human[]){
  let best: Human | undefined, bv=1e9;
  for (const h of men){ const v=c.field[tileOf(h.x,h.y)]; if (v>=0 && (v<bv || (v===bv && best && h.id<best.id))){ bv=v; best=h; } }
  if (best){ c.bx=best.x; c.by=best.y; }
}
/** Soldiers at home join their barracks' army out on an attack; a leaderless barracks' new men set
    off on their own, for as long as its war lasts. Called once the soldiers are stationed. */
export function reinforce(){
  const O=W.orphans;
  for (let i=O.length-3;i>=0;i-=3) if (!W.wars[O[i]*W.M+O[i+2]] || !W.nations[O[i]].alive) O.splice(i,3);   // that war is over
  for (const c of W.campaigns){
    if (c.raid || c.target>=0 || !c.hostile || c.phase===2 || c.unit<0) continue;
    const u=unitAt(c.unit); if (!u || u.o!==c.a) continue;
    let added=false;
    for (const h of u.members) if (h.war<0 && h.hp>0 && !switching(h) && !indoors(h)){ enlist(c,h,1e5); added=true; }
    if (added) c.fieldAt=-1e9;   // work out the way again, so it reaches them
  }
  for (let i=0;i<O.length;i+=3){
    const o=O[i], key=O[i+1], d=O[i+2];
    if (W.campaigns.some(c => c.a===o && c.d===d && c.unit===key && c.hostile && c.phase<2 && !c.raid && c.target<0)) continue;
    const u=unitAt(key); if (!u || u.o!==o) continue;
    const men=u.members.filter(h => h.war<0 && h.hp>0 && !switching(h) && !indoors(h)); if (!men.length) continue;
    const c=newCampaign(o,d,false,-1,men.length,W.nations[d].tiles,key); c.mode=M_BLIND;
    muster(c,men,u);
  }
}

export function updateWar(){
  const M=W.M, N=W.nations, H=W.humans;
  byId.clear(); camps.clear(); troops.clear();
  for (const h of H){
    byId.set(h.id,h);
    const max=maxHp(h);
    if (h.hp<max) h.hp=Math.min(max,h.hp+REGEN);   // everyone heals, slowly
  }
  for (const c of W.campaigns){ camps.set(c.id,c); troops.set(c.id,[]); }
  for (const h of H) if (h.war>=0){ const men=troops.get(h.war); if (men) men.push(h); else { h.war=-1; backToRoam(h); } }
  for (const c of [...W.campaigns]) if (camps.has(c.id)) runCampaign(c, troops.get(c.id)!);
  // kingdoms at war: a war between them, or a raid still out
  W.atWar.fill(0);
  for (let i=0;i<M*M;i++) if (W.wars[i]) W.atWar[i]=1;
  for (const c of W.campaigns) if (c.hostile){ W.atWar[c.a*M+c.d]=1; W.atWar[c.d*M+c.a]=1; }
  if (warring.length!==M) warring=new Uint8Array(M); else warring.fill(0);
  for (let a=1;a<M;a++) for (let b=1;b<M;b++) if (W.atWar[a*M+b]){ warring[a]=1; break; }
  for (let i=0;i<W.offers.length;i++) if (W.offers[i] && (W.tickN-W.offers[i]>OFFER_TICKS || !W.atWar[i])) W.offers[i]=0;
  // who can be fought: soldiers out of doors, and villagers who took up arms
  armies=N.map(() => []);
  for (const h of H){
    if (h.hp<=0 || indoors(h)) continue;
    if (h.kind===H_SOLDIER){
      armies[h.o].push(h);
      // a soldier holds the ground he stands on and next to, if it is his side's
      const t=tileOf(h.x,h.y);
      if ((owner[t]===h.o && !occ[t]) || occ[t]===h.o) for (let dy=-TW;dy<=TW;dy+=TW) for (let dx=-1;dx<=1;dx++){ const k=t+dy+dx; if (k>=0 && k<NT){ heldAt[k]=W.tickN; heldBy[k]=h.o; } }
    } else if (h.brave>=1) armies[h.o].push(h);   // armed villagers, and the mob
  }
  fighting.clear();
  for (const h of H) if (h.foe>=0 && h.hp>0) fighting.set(h.foe,(fighting.get(h.foe) ?? 0)+1);
  posts=N.map(n => warring[n.id] ? barracksOf(n).map(frontOf) : []);
  if (W.tickN%5===0) findRallies();
  lineUp();
  if (W.tickN%10===0) checkReconquest();
  towersFire();
}

/* ---------- the home guard ---------- */
/** For each kingdom at war: where its home guard should stand. Facing the nearest enemy army
    within THREAT_TILES of its land; else on its occupied land, the part nearest the capital. */
function findRallies(){
  const N=W.nations, M=W.M;
  if (rallies.length!==M) rallies=new Array(M).fill(null);
  for (let o=1;o<M;o++){
    const n=N[o];
    if (!warring[o] || !n.alive){ rallies[o]=null; continue; }
    let best: Rally | null=null, bd=Infinity;
    for (const c of W.campaigns){
      if (!c.hostile || c.a===o || !W.atWar[c.a*M+o] || (c.phase===2 && !c.raid)) continue;
      const [ax,ay]=armyAt(c), bx=(ax/2)|0, by=(ay/2)|0;
      for (let y=Math.max(0,by-THREAT_TILES);y<=Math.min(TH-1,by+THREAT_TILES);y++) for (let x=Math.max(0,bx-THREAT_TILES);x<=Math.min(TW-1,bx+THREAT_TILES);x++){
        if (owner[y*TW+x]!==o) continue;
        const d=(x-bx)**2+(y-by)**2;
        if (d<bd){ bd=d; const px=x*2+1, py=y*2+1, L=Math.hypot(ax-px,ay-py)||1; best={ x:px, y:py, dx:(ax-px)/L, dy:(ay-py)/L, threat:true, n:0 }; }
      }
    }
    if (!best && W.tickN%20===0){
      let lost=0; for (let b=1;b<M;b++) lost+=W.occCount[o*M+b];
      if (lost){
        const cx=n.capTile>=0 ? n.capTile%TW : n.ltx, cy=n.capTile>=0 ? (n.capTile/TW)|0 : n.lty;
        // what the guard can walk to from the heart of the kingdom; pockets cut off from it, and
        // from the enemy's army, can't be held by anyone and fall back to us
        fillOwn(scratch,cy*TW+cx,o);
        // a tile the guard can reach and stand on to take t back (within reclaim reach), or -1
        const standFor=(t: number) => { const x=t%TW, y=(t/TW)|0; let bs=-1, bk=99;
          for (let dy=-CAPTURE_R;dy<=CAPTURE_R;dy++) for (let dx=-CAPTURE_R;dx<=CAPTURE_R;dx++){
            const k=Math.abs(dx)+Math.abs(dy), xx=x+dx, yy=y+dy;
            if (k>CAPTURE_R+1 || xx<0||yy<0||xx>=TW||yy>=TH || scratch[yy*TW+xx]<0 || k>=bk) continue;
            bk=k; bs=yy*TW+xx; }
          return bs; };
        for (let t=0;t<NT;t++){
          if (owner[t]!==o || !occ[t]) continue;
          const at=standFor(t);
          if (at<0){ if (!(heldAt[t]===W.tickN && heldBy[t]===occ[t])) liberate(t); continue; }
          const x=t%TW, y=(t/TW)|0, d=(x-cx)**2+(y-cy)**2;
          if (d<bd){ bd=d; const L=Math.hypot(x-cx,y-cy)||1; best={ x:(at%TW)*2+1, y:((at/TW)|0)*2+1, dx:(x-cx)/L, dy:(y-cy)/L, threat:false, n:0 }; }
        }
      }
    } else if (!best && rallies[o] && !rallies[o]!.threat){ best=rallies[o]; }   // keep marching on the occupied land between searches
    rallies[o]=best;
    if (best){
      const t=tileOf(best.x,best.y);
      if (homeFieldFor[o]!==t){ homeFieldFor[o]=t; fillOwn(homeField[o] ??= new Int16Array(NT), t, o); }
    }
  }
}
/** Steps to tile `src` over kingdom o's own land only. */
function fillOwn(f: Int16Array, src: number, o: number){
  f.fill(-1); f[src]=0;
  const Q=queue, own=owner, tw=TW, nt=NT; let head=0, tail=0; Q[tail++]=src;
  while (head<tail){
    const t=Q[head++], nv=f[t]+1, x=t%tw;
    let n=t-1;  if (x>0 && f[n]<0 && own[n]===o){ f[n]=nv; Q[tail++]=n; }
    n=t+1;      if (x<tw-1 && f[n]<0 && own[n]===o){ f[n]=nv; Q[tail++]=n; }
    n=t-tw;     if (t>=tw && f[n]<0 && own[n]===o){ f[n]=nv; Q[tail++]=n; }
    n=t+tw;     if (t<nt-tw && f[n]<0 && own[n]===o){ f[n]=nv; Q[tail++]=n; }
  }
}
/** Walks a home-guard member toward his place: along his land's way to the rally while far, straight once close. */
function walkToLine(h: Human, gx: number, gy: number){
  const f=homeField[h.o];
  if (f && Math.hypot(gx-h.x,gy-h.y)>6 && f[tileOf(h.x,h.y)]>2){
    const s=downhill(f,h.x,h.y);
    if (s){ stepHome(h,s[0],s[1],0); return; }
  }
  stepHome(h,gx,gy,0.3);
}
/** Gives the home guard its places in the line: idle soldiers in front, armed villagers behind. */
function lineUp(){
  const lines=new Map<number, Human[][]>();
  for (const h of W.humans){
    const r=rallies[h.o]; if (!r || h.hp<=0 || indoors(h) || switching(h)) continue;
    const guard = h.kind===H_SOLDIER ? h.war<0 && h.post<0 : h.brave===1;
    if (!guard) continue;
    let L=lines.get(h.o); if (!L){ L=[[],[]]; lines.set(h.o,L); }
    L[h.kind===H_SOLDIER ? 0 : 1].push(h);
  }
  for (const [o,[sol,vil]] of lines){
    sol.sort((a,b)=>a.id-b.id); vil.sort((a,b)=>a.id-b.id);
    const all=[...sol,...vil]; all.forEach((h,i) => h.slot=i);
    rallies[o]!.n=all.length;
  }
}
function linePos(r: Rally, i: number): [number, number] {
  const n=r.n, cols=Math.max(4,Math.min(12,Math.ceil(Math.sqrt(n*2.5)))), rank=(i/cols)|0, col=i%cols, inRank=Math.min(cols,n-rank*cols);
  const across=(col-(inRank-1)/2)*SPACING, back=rank*SPACING+1.5;
  return [r.x - r.dy*across - r.dx*back, r.y + r.dx*across - r.dy*back];
}
/** With all its land back from b after b had taken some, o's army is ready to counter-attack. */
function checkReconquest(){
  const M=W.M;
  for (let o=1;o<M;o++) for (let b=1;b<M;b++){
    const i=o*M+b;
    if (!W.lost[i] || W.occCount[i]>0 || !W.wars[i]) continue;
    if (W.campaigns.some(c => c.a===b && c.d===o && c.phase<2 && c.hostile)) continue;   // the invaders are still about
    W.lost[i]=0; W.ready[i]=W.tickN;
    on.counterReady(o,b);
  }
}

/* ---------- occupation ---------- */
/** Tile t, of owner[t]'s land, is occupied by `by`; what stands at a plot's heart there burns. */
function occupy(t: number, by: number){
  const o=owner[t], prev=occ[t], M=W.M;
  if (prev===by || !o) return;
  if (prev) W.occCount[o*M+prev]--;
  occ[t]=by; W.occCount[o*M+by]++; W.lost[o*M+by]=1;
  on.occupied(t);
}   // what stands on it isn't burnt by marching over it: the army has to break it (targetable)
function liberate(t: number){
  const prev=occ[t]; if (!prev) return;
  W.occCount[owner[t]*W.M+prev]--; occ[t]=0;
  on.occupied(t);
}
/** An attacking soldier occupies the enemy's ground around him, unless a defender holds it. The castle holds until it is broken. */
function capture(h: Human, c: Campaign){
  const cx=(h.x/2)|0, cy=(h.y/2)|0, now=W.tickN;
  for (let dy=-CAPTURE_R;dy<=CAPTURE_R;dy++) for (let dx=-CAPTURE_R;dx<=CAPTURE_R;dx++){
    if (Math.abs(dx)+Math.abs(dy)>CAPTURE_R+1) continue;
    const x=cx+dx, y=cy+dy; if (x<0||y<0||x>=TW||y>=TH) continue;
    const t=y*TW+x; if (owner[t]!==c.d || (occ[t] && occ[t]!==c.a) || occ[t]===c.a || (heldAt[t]===now && heldBy[t]!==c.a)) continue;
    const q=(y>>2)*PW+(x>>2); if ((pType[q]===B_CASTLE || pType[q]===B_CPART) && pOwner[q]===c.d) continue;
    occupy(t,c.a);
  }
}
/** A soldier on his kingdom's occupied land takes it back around him, unless the occupier holds it. */
function reclaim(h: Human){
  if ((h.id+W.tickN)%CAPTURE_EVERY) return;
  const cx=(h.x/2)|0, cy=(h.y/2)|0, now=W.tickN;
  for (let dy=-CAPTURE_R;dy<=CAPTURE_R;dy++) for (let dx=-CAPTURE_R;dx<=CAPTURE_R;dx++){
    if (Math.abs(dx)+Math.abs(dy)>CAPTURE_R+1) continue;
    const x=cx+dx, y=cy+dy; if (x<0||y<0||x>=TW||y>=TH) continue;
    const t=y*TW+x; if (owner[t]!==h.o || !occ[t] || (heldAt[t]===now && heldBy[t]===occ[t])) continue;
    liberate(t);
  }
}

/** Every watchtower of a kingdom at war shoots the nearest enemy soldier on its kingdom's land and
    in range, or else the nearest enemy villager there, once per reload; so does the castle. */
function towersFire(){
  const N=W.nations, M=W.M;
  for (let i=1;i<N.length;i++){
    const n=N[i], q=n.capPlot; if (!n.alive || n.capTile<0 || pHp[q]<=0) continue;
    const was=wear(q); pHp[q]=Math.max(0,pHp[q]-CASTLE_MEND); if (wear(q)!==was) on.plotChanged(q);
  }
  const shoot=(i: number, x: number, y: number, range: number, dmg: number) => {
    let target: Human | null=null, bd=Infinity, soldier=false;
    for (const h of W.humans){
      if (h.hp<=0 || !W.atWar[i*M+h.o] || indoors(h)) continue;
      const d=(h.x-x)**2+(h.y-y)**2; if (d>range*range) continue;
      if (owner[tileOf(h.x,h.y)]!==i) continue;   // only at those who have come onto our land
      const s=h.kind===H_SOLDIER;
      if ((s && !soldier) || (s===soldier && (d<bd || (d===bd && target!==null && h.id<target.id)))){ target=h; bd=d; soldier=s; }
    }
    if (target){ target.hp-=dmg; on.towerShot(x,y,target.x,target.y-2,target.hp<=0,target.id); }
  };
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive || !warring[i]) continue;
    for (const q of n.blds){
      if (pType[q]!==B_TOWER || pOwner[q]!==i || pBurn[q]>0) continue;
      const t=towerTier(q); if ((q+W.tickN)%TOWER_RELOADS[t]) continue;
      shoot(i,(q%PW)*8+4,((q/PW)|0)*8+1,TOWER_RANGE,TOWER_DMGS[t]);
    }
    // the castle mends itself; it shoots like two towers of its tier: twice as often, as hard
    const q=n.capPlot, ct=castleTier(i), cr=TOWER_RELOADS[ct], t=q+W.tickN;
    if (n.capTile>=0 && pBurn[q]<=0 && (t%cr===0 || (t+(cr>>1))%cr===0)) shoot(i,(q%PW)*8+8,((q/PW)|0)*8+2,CASTLE_RANGE,TOWER_DMGS[ct]);
  }
}

/* ---------- soldiers ---------- */
function strike(h: Human, e: Human){
  if (h.cool>0) return;
  h.cool=HIT_TICKS;
  on.swing(h.id,e.id);
  if (W.prand()<HIT_CHANCE){ e.hp-=(h.kind===H_SOLDIER ? HIT_DMG[h.tier] : MILITIA_DMG)*(revenge(h) ? REVENGE_DMG : 1); on.hit(e.x,e.y-2,e.hp<=0,e.id,h.id); }
  if (e.foe<0 && (e.kind===H_SOLDIER || e.brave>=1)) e.foe=h.id;   // he turns to fight back
}
/** Steps toward (gx,gy): straight if the way is open, otherwise along the army's way. */
/** Is h marching in a counter-attack? */
const revenge = (h: Human) => h.war>=0 && !!camps.get(h.war)?.inspired;
/** How fast h marches with his army: a counter-attack's men a little faster. */
const marchPace = (h: Human, c: Campaign) => pace(h)*(c.inspired ? REVENGE_PACE : 1);
/** Steps toward (gx,gy): straight if the way is open, otherwise along the army's way. Going back to
    his place in the line (`toLine`), he heads for his own army's banner instead, and if he has got
    ahead of it he waits for his army to come up rather than march on alone. */
function moveTo(h: Human, c: Campaign, gx: number, gy: number, stop=0, toLine=false){
  let dx=gx-h.x, dy=gy-h.y, d=Math.hypot(dx,dy);
  if (d<=stop+0.05) return;
  if (d>2 && !clearWay(c.field,h.x,h.y,gx,gy)){
    const here=c.field[tileOf(h.x,h.y)], flag=c.field[tileOf(c.bx,c.by)];
    if (toLine && Math.hypot(c.bx-h.x,c.by-h.y)>2 && clearWay(c.field,h.x,h.y,c.bx,c.by)){ dx=c.bx-h.x; dy=c.by-h.y; d=Math.hypot(dx,dy); stop=0; }
    else if (toLine && here>=0 && flag>=0 && here<flag) return;
    else {
      const s=downhill(c.field,h.x,h.y);
      if (s){ dx=s[0]-h.x; dy=s[1]-h.y; d=Math.hypot(dx,dy); stop=0; if (d<1e-6) return; }
    }
  }
  const st=Math.min(d-stop,marchPace(h,c)*TICK); h.x+=dx/d*st; h.y+=dy/d*st;
}
/** Steps toward (gx,gy) without leaving his own kingdom's land (sidestepping a corner if he can). */
function stepHome(h: Human, gx: number, gy: number, stop: number, sp=pace(h)){
  const dx=gx-h.x, dy=gy-h.y, d=Math.hypot(dx,dy);
  if (d<=stop+0.05) return;
  const st=Math.min(d-stop,sp*TICK), a=Math.atan2(dy,dx);
  for (const turn of [0,0.7,-0.7,1.5,-1.5]){
    const nx=h.x+Math.cos(a+turn)*st, ny=h.y+Math.sin(a+turn)*st;
    if (owner[tileOf(nx,ny)]===h.o){ h.x=nx; h.y=ny; return; }
  }
}
/** Can c's soldiers attack building q? Raids burn anything but the castle; an attack goes for
    watchtowers, whatever stands on the ground it holds, and at the end the castle; interceptors
    only fight. */
function targetable(q: number, c: Campaign){
  const ty=pType[q];
  if (c.target>=0 || pOwner[q]!==c.d || pBurn[q]>0) return false;
  if (ty===B_CASTLE) return !c.raid;
  return isStructure(ty) && ty!==B_PART && (c.raid || ty===B_TOWER || occ[pCenter[q]]===c.a);
}
function pickBuilding(h: Human, c: Campaign){
  if (c.target>=0) return -1;
  const D=W.nations[c.d];
  if (!c.raid && D.capTile>=0){
    const q=D.capPlot, cx=(q%PW)*8+8, cy=((q/PW)|0)*8+8;
    if ((c.bx-cx)**2+(c.by-cy)**2<24*24 && targetable(q,c)) return q;   // the army stands before the castle
  }
  const R=c.raid ? RAID_R : TOWER_RANGE+4, [bx,by]=c.mode===M_BLIND ? [h.x,h.y] : [c.bx,c.by];   // a leaderless man looks about himself
  const qx0=Math.max(0,Math.floor((bx-R)/8)), qx1=Math.min(PW-1,Math.floor((bx+R)/8)), qy0=Math.max(0,Math.floor((by-R)/8)), qy1=Math.min(PH-1,Math.floor((by+R)/8));
  let best=-1, bs=Infinity;
  for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
    const q=mainOf(y*PW+x); if (!targetable(q,c) || pType[q]===B_CASTLE) continue;
    const [x0,y0,x1,y1]=rectOf(q), d=Math.hypot(clamp(h.x,x0,x1)-h.x, clamp(h.y,y0,y1)-h.y), tower=pType[q]===B_TOWER;
    if (d>(tower ? TOWER_RANGE+4 : ENGAGE_R+8)) continue;
    const s=d-(tower ? 40 : 0);   // a tower that can shoot us comes first: it bleeds the whole army while it stands
    if (s<bs || (s===bs && q<best)){ bs=s; best=q; }
  }
  return best;
}
/** A soldier in the field looks around: an enemy nearby (sooner one fighting a comrade), else a building to attack. */
/** A soldier in the field picks his enemy: one near his own place in the line (or one on him),
    the nearest first, but one his comrades are already fighting counts as further off, so the
    line meets the enemy along its front instead of piling onto one man. */
function choose(h: Human, c: Campaign){
  let best: Human | undefined, bs=Infinity;
  const blind=c.mode===M_BLIND, leader=h.id===c.leader, falling=c.mode===M_FALLBACK;
  const [sx,sy]=blind ? [h.x,h.y] : placeOf(c,h);
  for (let o=1;o<W.M;o++){
    if (!W.atWar[c.a*W.M+o]) continue;
    for (const e of armies[o] ?? []){
      if (e.hp<=0) continue;
      const d=Math.hypot(e.x-h.x,e.y-h.y), onMe=e.foe===h.id, onLeader=c.leader>=0 && e.foe===c.leader;
      if (leader || falling){ if (!onMe && !(leader && d<MELEE_R*2)) continue; }   // the leader, and an army falling back, fight only whoever is on them
      else if (!onMe && !onLeader && (Math.hypot(e.x-sx,e.y-sy)>ENGAGE_R || (!blind && (e.x-c.bx)**2+(e.y-c.by)**2>LEASH*LEASH))) continue;
      else if (onLeader && (e.x-c.bx)**2+(e.y-c.by)**2>(LEASH*1.4)**2) continue;
      const s=d+CROWD*crowdOn(e,h)-(onMe ? 4 : 0)-(onLeader ? 20 : 0);   // anyone on the leader first
      if (s<bs || (s===bs && best && e.id<best.id)){ bs=s; best=e; }
    }
  }
  if (best){ h.foe=best.id; h.aim=-1; return; }
  h.foe=-1;
  if (leader || falling){ h.aim=-1; return; }   // he leads; they are getting out
  if (h.aim>=0 && targetable(h.aim,c) && pType[h.aim]===B_TOWER) return;   // busy with a tower: stay on it
  const q=pickBuilding(h,c);
  if (q>=0 || !(h.aim>=0 && targetable(h.aim,c))) h.aim=q;   // a tower in reach takes over from anything else
}
function hitBuilding(h: Human, c: Campaign){
  if (h.cool>0) return;
  h.cool=HIT_TICKS;
  const q=h.aim, ty=pType[q];
  const was=wear(q);
  pHp[q]+=BLD_DMG; on.bldHit(q);
  if (pHp[q]<bldHp(q)){ if (wear(q)!==was) on.plotChanged(q); return; }   // it looks the worse for it
  h.aim=-1;
  if (ty===B_CASTLE){ annex(c.d,c.a); return; }
  ignite(q);
  if (c.raid) h.loot=true;   // plunder: one bag each
}
function comeHome(h: Human){
  if (h.loot){ h.loot=false; W.nations[h.o].gold+=LOOT_GOLD; on.plunder(h.o,h.x,h.y,LOOT_GOLD); }
  h.war=-1; h.foe=-1; h.aim=-1; h.slot=0;
  backToRoam(h);
}
/** On the way home: raiders keep out of fights, striking back only at whoever is on them. */
function homeward(h: Human, c: Campaign){
  if (owner[tileOf(h.x,h.y)]===h.o){ comeHome(h); return; }
  if (c.hostile) for (let o=1;o<W.M;o++){
    if (!W.atWar[c.a*W.M+o]) continue;
    for (const e of armies[o] ?? []) if (e.foe===h.id && e.hp>0 && (e.x-h.x)**2+(e.y-h.y)**2<=MELEE_R*MELEE_R){ strike(h,e); return; }
  }
  const s=downhill(c.field,h.x,h.y), n=W.nations[h.o];
  const [gx,gy] = s ?? (n.capTile>=0 ? doorOf(n) : [n.ltx*2+1, n.lty*2+1]);
  const dx=gx-h.x, dy=gy-h.y, d=Math.hypot(dx,dy); if (d<1e-6) return;
  const st=Math.min(d,pace(h)*TICK); h.x+=dx/d*st; h.y+=dy/d*st;
}
/** One tick for a soldier in a campaign. */
export function marchStep(h: Human){
  const c=camps.get(h.war); if (!c){ h.war=-1; backToRoam(h); return; }
  if (h.cool>0) h.cool--;
  if (c.phase===2){ homeward(h,c); return; }
  if (!c.raid && c.target<0 && c.phase===1 && (h.id+W.tickN)%CAPTURE_EVERY===0) capture(h,c);
  reclaim(h);   // passing by our own occupied land
  if ((h.id+W.tickN)%4===0) choose(h,c);
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  if (foe && (foe.hp<=0 || !atWar(h.o,foe.o) || indoors(foe) || (c.mode!==M_BLIND && (foe.x-c.bx)**2+(foe.y-c.by)**2>(LEASH*1.4)**2))){ foe=undefined; h.foe=-1; }
  if (foe){
    if ((foe.x-h.x)**2+(foe.y-h.y)**2<=MELEE_R*MELEE_R) strike(h,foe); else moveTo(h,c,foe.x,foe.y,1.6);
    return;
  }
  if (h.aim>=0 && !targetable(h.aim,c)) h.aim=-1;
  if (h.aim>=0){
    const [x0,y0,x1,y1]=rectOf(h.aim);
    if (h.x>=x0-1.5 && h.x<=x1+1.5 && h.y>=y0-1.5 && h.y<=y1+1.5) hitBuilding(h,c);
    else moveTo(h,c,clamp(h.x,x0-1,x1+1),clamp(h.y,y0-1,y1+1));
    return;
  }
  if (c.mode===M_BLIND){   // no line to keep: straight on at the enemy
    const s=downhill(c.field,h.x,h.y); if (s) moveTo(h,c,s[0],s[1]);
    return;
  }
  const [sx,sy]=placeOf(c,h);
  moveTo(h,c,sx,sy,0,true);
}

/** The post a soldier at home defends, and how far around it. */
function postOf(h: Human): [number, number, number] {
  if (h.post>=0){ const [x,y]=frontOf(h.post); return [x,y,GUARD_R]; }
  const home=W.nations[h.o];
  let best: [number, number] | null=null, bd=Infinity;
  for (const p of posts[h.o] ?? []){ const d=(p[0]-h.x)**2+(p[1]-h.y)**2; if (d<bd){ bd=d; best=p; } }
  if (best) return [best[0],best[1],BARRACKS_R];
  return home.capTile>=0 ? [...doorOf(home),CAPITAL_R] : [h.x,h.y,20];
}
/** The enemy a defender goes for: the nearest near (ax,ay), sooner one attacking our buildings or people. */
function threat(h: Human, ax: number, ay: number, R: number, reach=Infinity){
  let best: Human | undefined, bs=Infinity;
  for (let o=1;o<W.M;o++){
    if (!W.atWar[h.o*W.M+o]) continue;
    for (const e of armies[o] ?? []){
      if (e.hp<=0 || (e.x-ax)**2+(e.y-ay)**2>R*R) continue;
      const d=Math.hypot(e.x-h.x,e.y-h.y); if (d>reach && e.foe!==h.id) continue;
      const s=d-(e.aim>=0 && pOwner[e.aim]===h.o ? 8 : 0)-(e.foe>=0 && byId.get(e.foe)?.o===h.o ? 4 : 0)+CROWD*crowdOn(e,h);
      if (s<bs || (s===bs && best && e.id<best.id)){ bs=s; best=e; }
    }
  }
  return best;
}
/** Fights foe if he is close enough, else closes in on him without leaving home ground. */
function engage(h: Human, foe: Human){
  h.foe=foe.id; h.path=[]; h.wait=0;
  const d=Math.hypot(foe.x-h.x,foe.y-h.y);
  if (d<=MELEE_R) strike(h,foe); else stepHome(h,foe.x,foe.y,1.6);
}
const valid = (h: Human, e: Human | undefined): e is Human => !!e && e.hp>0 && !indoors(e) && atWar(h.o,e.o);
/** A place in the home guard's line: hold it, and fight enemies who come within reach of the line.
    Armed villagers only fight whoever is on them; soldiers go out to meet the enemy near the line. */
function holdLine(h: Human, r: Rally){
  const soldier=h.kind===H_SOLDIER;
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  if (!valid(h,foe) || (foe.x-r.x)**2+(foe.y-r.y)**2>(DEFEND_R*1.5)**2) foe=undefined;
  if (!foe && (h.id+W.tickN)%3===0) foe=threat(h,r.x,r.y,DEFEND_R,soldier ? Infinity : 4);
  if (foe){ engage(h,foe); return; }
  h.foe=-1;
  // facing an army: a line; taking land back: a tight knot on the spot
  const [sx,sy]=r.threat ? linePos(r,h.slot) : [r.x+Math.cos(h.slot*2.4)*Math.min(2,h.slot*0.4), r.y+Math.sin(h.slot*2.4)*Math.min(2,h.slot*0.4)];
  walkToLine(h,sx,sy);
}
/** A soldier at home while his kingdom is at war. Idle soldiers turn out as the home guard when
    an army nears the border or land is occupied; guards fight near their tower. Never leaves
    his own land. Returns true while he is busy with it (his normal routine waits). */
export function guardStep(h: Human): boolean {
  if (!warring[h.o] || switching(h) || indoors(h)){
    h.foe=-1;
    if (h.calm){ h.calm=0; if (!switching(h) && !indoors(h)) backToRoam(h); }   // the war is over: back to the barracks
    return false;
  }
  if (h.cool>0) h.cool--;
  reclaim(h);   // any of our occupied land within reach
  const r = h.post<0 ? rallies[h.o] : null;
  if (r){ h.calm=1; holdLine(h,r); return true; }
  if (h.calm){ h.calm=0; h.foe=-1; backToRoam(h); return false; }   // the line is stood down
  const [ax,ay,R]=postOf(h);
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  if (!valid(h,foe) || (foe.x-ax)**2+(foe.y-ay)**2>(R*1.4)**2) foe=undefined;
  if (!foe && (h.id+W.tickN)%3===0) foe=threat(h,ax,ay,R);
  if (!foe){ if (h.foe>=0){ h.foe=-1; backToRoam(h); } return false; }
  engage(h,foe);
  return true;
}

/* ---------- villagers in danger ---------- */
/** The nearest enemy within r pixels of h. */
function nearestEnemy(h: Human, r: number){
  let best: Human | undefined, bd=r*r;
  for (let o=1;o<W.M;o++){
    if (!W.atWar[h.o*W.M+o]) continue;
    for (const e of armies[o] ?? []){ if (e.hp<=0) continue; const d=(e.x-h.x)**2+(e.y-h.y)**2; if (d<bd || (d===bd && best && e.id<best.id)){ bd=d; best=e; } }
  }
  return best;
}
function calmDown(h: Human){ h.brave=-1; h.calm=0; h.foe=-1; backToRoam(h); }
export const MOB = 2;                // h.brave for a villager swept up in a mob
const MOB_R = 60;                     // pixels around a mob's rallying point its villagers look for the enemy
/** The villagers of kingdom o within `r` pixels of (x,y) rise as a mob and swarm the enemy (sim/story.ts
    decides when). Returns how many; with `dry`, only counts them. */
export function raiseMob(o: number, x: number, y: number, r: number, dry=false){
  let k=0;
  for (const h of W.humans){
    if (h.o!==o || h.kind===H_SOLDIER || h.hp<=0 || indoors(h) || switching(h) || (h.x-x)**2+(h.y-y)**2>r*r) continue;
    if (dry){ k++; continue; }
    if (h.brave<0 || h.brave===0){ release(h); h.carry=-1; h.amount=0; h.task=TASK_ROAM; h.path=[]; h.wait=0; }
    h.brave=MOB; h.calm=0; h.foe=-1; k++;
  }
  return k;
}
/** A villager of a kingdom at war with enemies close: the first time, he decides (even odds)
    to run or to fight. Runners flee away from the danger, staying on their land; fighters join
    the home guard's line, or go for the nearest enemy if there is no line; a mob goes straight
    for the nearest enemy. After a while with no enemy near, he goes back to work. Returns true
    while he is caught up in it. */
export function alarmStep(h: Human): boolean {
  if (indoors(h) || switching(h)) return false;
  if (!warring[h.o]){ if (h.brave>=0) calmDown(h); return false; }
  if (h.cool>0) h.cool--;
  if ((h.id+W.tickN)%4===0){
    const e=nearestEnemy(h,h.brave===MOB ? MOB_R : DANGER_R);
    if (e){
      h.calm=0;
      if (h.brave<0){
        h.brave = h.beggar ? 0 : W.prand()<0.5 ? 1 : 0;
        release(h); h.carry=-1; h.amount=0; h.task=TASK_ROAM; h.path=[]; h.wait=0;   // whatever he was doing, he drops it
      }
      if (h.brave===0) h.foe=e.id;   // the one he is running from
    } else if (h.brave>=0) h.calm+=4;
  }
  if (h.brave<0) return false;
  if (h.calm>CALM_TICKS){ calmDown(h); return false; }
  if (h.brave===0){
    const e=h.foe>=0 ? byId.get(h.foe) : undefined;
    if (e){ const dx=h.x-e.x, dy=h.y-e.y, L=Math.hypot(dx,dy)||1; stepHome(h,h.x+dx/L*8,h.y+dy/L*8,0,h.sp*1.25); }
    return true;
  }
  const r=rallies[h.o];
  if (r && h.brave!==MOB){ holdLine(h,r); return true; }
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  if (!valid(h,foe) || (h.brave===MOB && (h.id+W.tickN)%6===0)) foe=nearestEnemy(h,h.brave===MOB ? MOB_R : DANGER_R) ?? (valid(h,foe) ? foe : undefined);
  if (foe) engage(h,foe); else h.foe=-1;
  return true;
}
