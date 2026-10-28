/* ---------- war: alliances, armies in the field, fighting, and the fall of kingdoms ----------
   Clicking another kingdom opens diplomacy: an alliance, or war. War sends out the armies of
   the kingdom's barracks (sim/army.ts); soldiers without room in a barracks stay home and only defend:
   - an attack needs a shared border. It begins as a crisis, not yet a war: the armies spread out
     along the whole border with the enemy (sim/front.ts), evenly, a little behind it, with the men
     the line has no room for in ranks behind them, and nobody fights. The defender may send armies
     to stand on its own side of the same border. Once the attacker's armies have gathered, its word
     to attack (bots give it at once, unless far more stand against them) turns the crisis into a war
     that lasts until peace; or it calls the crisis off and everyone goes home. At war, each side's
     front can attack or hold: attacking, its front rank pushes on, taking the enemy's ground before
     it (its own occupied land first) a strip at a time all along the line, as fast as the line is
     strong; holding, it stands where it is. Soldiers hold the ground about them, so the line has to
     fight them off it. Ground cut off behind the front falls to the side that cut it off. Every
     soldier the barracks raises joins its army there, filling the line where it is thinnest, and the
     reserves step up as the front rank falls. A kingdom may call its militia up to a front as
     reserves. Occupied land still belongs to its kingdom, but nobody lives or builds on it; at peace
     each side keeps what it occupies that joins on to its own land. Breaking the castle annexes the
     kingdom: its land, buildings and people go to the winner, and its gold and stockpile are lost.
   - a raid crosses unclaimed or allied land to the target's border, waits there for the word, then
     burns its buildings, the outskirts first and on toward the centre. A raider who destroys a
     building carries a loot bag, worth LOOT_GOLD if he gets it home. If other kingdoms close every
     way through, the raid turns back.
   - an intercept sends soldiers after a raiding army, wherever it is, to fight it in the field.
   Two kingdoms are at war while a war between them lasts, or a raid between them is still
   out (a crisis is not a war). A raid has no peace: it ends when the raiders are all dead or home. Recalled raiders
   stop burning and head straight home, but they are still the enemy until they get there:
   defenders fight them, towers shoot them, and an army can be sent after them. Only then do soldiers fight and watchtowers shoot (at enemies on their own land).
   An army of more than 5 has a leader, ranked by its size when it sets out (RANKS): he stands
   behind his men, fights only whoever comes at him, and his men go first for anyone on him. If he
   falls the army fights on without him. Raiders and interceptors march in formation behind a banner.
   At home, the idle soldiers of a kingdom at war that sent no army of its own to the border man its
   side of the front, as evenly, with reserves behind them, taking back any of their land the attacker
   doesn't hold; facing a raid they
   form a line where it will cross, and villagers nearby either run or (half of them) take up arms.
   Once the invaders are gone the guard takes the occupied land back; with all of it back, the army
   reports ready to counter-attack. Guards stay by their watchtowers, and the castle shoots too.
   Everyone heals slowly. Allies open their land to each other's armies. */
import { TW, TH, NT, NP, PW, PH, TICK, B_CASTLE, B_CPART, B_TOWER, B_HOUSE, B_FARM, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_MINE, B_RESEARCH, B_GUILD, isStructure } from '../core/constants';
import { W, owner, occ, isLand, pType, pOwner, pBurn, pMain, pHp, pPrio, pCenter, pTier, type Campaign, type Human, type Nation } from './state';
import { on } from './events';
import { setOwner } from './territory';
import { ignite, dims } from './buildings';
import { census } from './census';
import { BLD_HP, bldHp, wear, towerTier, castleTier, TOWER_RELOADS, TOWER_DMGS, CASTLE_MEND, wallOf, wallTower, walledFor, buildWalls, resetWalls } from './defense';
import { SOLDIER_DMG, MILITIA_HIT, units, unitAt, type Unit } from './army';
import { Field } from './field';
import { lineOf, deploy, placeAt, indexAt, holds, enemyOf, underCastle, type Front } from './front';
import { H_SOLDIER, TASK_ROAM, TOWER_RANGE, maxHp, REGEN, pace, onCastle, release, backToRoam, frontOf, doorOf, barracksOf, switching, indoors, tileOf, homeMilitia } from './population';

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
export const CAPTURE_EVERY = 5;       // ticks between a defender's taking back his occupied land about him
const CAPTURE_R = 2;                  // tiles around him
/** The ranks of an army's leader, by the army's size when it set out: none for 5 or fewer. */
export const RANKS = ['', 'Leader', 'General', 'Captain', 'Commander', 'Grand Marshal'];
export const rankFor = (size: number) => size<=5 ? 0 : size<=15 ? 1 : size<=30 ? 2 : size<=50 ? 3 : size<=80 ? 4 : 5;
// what a raid is doing (Campaign.mode): marching to the border, waiting there for the word, raiding
export const M_MARCH=0, M_HOLD=1, M_ASSAULT=2;
// an offensive (W.offensive[a*M+d], and the mode of its armies): gathering at the border, ready for
// the word, attacking, or holding where it stands
export const F_GATHER=0, F_READY=1, F_PUSH=2, F_HOLD=3;
const REFRONT = 5;                    // ticks between working out each front and everyone's place on it
export const ADVANCE_TICKS = 10;      // ticks between strips of ground taken by a front at full strength (1 s)
export const DENSE = 4;               // tiles of front each man of the front rank pushes at full speed; a thinner line is slower
export const PRESENT = 6;             // pixels from his place a man counts as there
export const GATHER_AT = 0.9;         // the offensive is ready when this share of its men are in place...
const GATHER_MAX = 400;               // ...or 40 s after it began
const REACH_PUSH = 10, REACH_HOLD = 5;   // pixels from his place a man of the front goes out to fight (attacking, holding)
const DEF_REACH = 8;                  // pixels from his place a defender on the front goes out to fight
export const ZOC = 2;                 // tiles round a soldier his side holds: nobody can take them from it
const LEVEL_PASSES = 3;               // tiles deep a corner where the line has fallen behind fills in, each strip
const STEP = 5;                       // a tile's length in the measure of how far the line has to go
const STRIP_DEEP = 3;                 // tiles deep one strip may go, where a stretch catches up
const NO_FRONT = 300;                 // ticks an offensive with no front left (no border) waits before going home
const STALL_EVERY = 300;              // ticks between looks at how a war's border has moved (30 s)...
const STALL_TILES = 25, STALL_SHARE = 0.03;   // ...and how far it must have moved (tiles, or this share of the smaller kingdom's land) not to count as stalled
const OUTMATCHED = 1;                 // a bot calls its crisis off when more than this, plus its temper (0.5 to 0.8), times its men stand against it
export const REVENGE_DMG = 1.25, REVENGE_PACE = 1.1;   // a counter-attack's soldiers hit 25% harder and march 10% faster
const REFIELD = 20;                   // ticks between working out the way again (2 s)
export const MUSTER_TICKS = 200;      // longest a raid or intercept waits at the muster point (20 s)
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
let homeField: (Field | undefined)[] = [], homeFieldFor: number[] = [];
let heldAt = new Int32Array(NT), heldBy = new Uint8Array(NT);   // tick a soldier last stood on or beside a tile his side holds, and whose
let queue = new Int32Array(NT);
const scratch = new Field();   // a field for a one-off search
let want = new Int32Array(NT), wantSeq = 0;   // tiles a fill is looking for, stamped wantSeq
let seen = new Int32Array(NT), seenSeq = 0;   // tiles a search has been to, stamped seenSeq
let came = new Int32Array(NT);                 // ...and the tile it came from
/** One kingdom's offensive against another: its attacking armies, all on one front. */
interface Offensive {
  key: number; a: number; d: number;
  F: Front | null;                // the front, worked out every REFRONT ticks
  walk: Field;                    // steps to the men's places, over ground they may cross
  k: number;                      // men in the front rank
  progress: number;               // toward the next strip of ground
  strips: number;                 // strips taken so far
  depth: Field | null;            // how far each tile of the defender's is from the line as the attack began (STEP a tile)
  since: number;                  // tick it began
  noFront: number;                // ticks it has had no front
  men: Human[]; camps: Campaign[];   // its men (leaders aside) and armies, this tick
}
const offensives = new Map<number, Offensive>();
let defended = new Uint8Array(1);              // per nation: some offensive against it has a front its guard stands on
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

export function resetWar(M: number){
  W.campaigns=[]; W.campSeq=0;
  W.ally=new Uint8Array(M*M); W.atWar=new Uint8Array(M*M); W.offers=new Int32Array(M*M); W.grudge=new Int32Array(M*M).fill(-1e9);
  W.wars=new Uint8Array(M*M); W.aggr=new Uint8Array(M*M); W.warSince=new Int32Array(M*M); W.occCount=new Int32Array(M*M); W.lost=new Uint8Array(M*M); W.ready=new Int32Array(M*M); W.offensive=new Uint8Array(M*M); W.kills=new Int32Array(M*M); W.stall=new Int32Array(M*M); W.lastNet=new Int32Array(M*M);
  if (queue.length!==NT){ heldAt=new Int32Array(NT); heldBy=new Uint8Array(NT); queue=new Int32Array(NT); want=new Int32Array(NT); wantSeq=0; seen=new Int32Array(NT); seenSeq=0; came=new Int32Array(NT); }   // the map changed size
  byId.clear(); camps.clear(); troops.clear(); armies=[]; posts=[]; warring=new Uint8Array(M); rallies=[]; homeField=[]; homeFieldFor=[]; heldAt.fill(0); resetWalls();
  offensives.clear(); defended=new Uint8Array(M);
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
    (with `any`, over all land), -1 where there is no way, within the box round a's and d's land (and
    the sources), FIELD_MARGIN tiles wider. It looks for the tiles `mark` stamps (each stamped tile
    counts once; one is enough if `first`), and stops `margin` steps past the last of them. Returns
    the first such tile reached, or -1. */
let breach=false;   // fill straight through enemy walls (when they leave no way round)
function fill(f: Field, src: number[], a: number, d: number, any: boolean, mark: (stamp: number) => number, first: boolean, margin: number){
  const stamp=++wantSeq, wanted=mark(stamp);
  fitBox(f,[a,d],src);
  const F=f.d, w=f.w, h=f.h, x0=f.x0, y0=f.y0;
  let head=0, tail=0, found=-1, left=wanted, until=32000;
  for (const s of src){ const l=f.idx(s); if (l>=0 && F[l]<0){ F[l]=0; queue[tail++]=l; } }
  // which owners' land the army may cross
  const pass=new Uint8Array(W.M); pass[0]=pass[a]=pass[d]=1;
  for (let o=1;o<W.M;o++) if (any || W.ally[a*W.M+o]) pass[o]=1;
  // whose walls stop it (none of them when breaching)
  const wall=new Uint8Array(W.M); if (!breach) for (let o=1;o<W.M;o++) wall[o]=o!==a && !W.ally[a*W.M+o] ? 1 : 0;
  const tw=TW, land=isLand, own=owner, Q=queue, mk=want, wo=wallOf;   // local names: much faster in a hot loop than imports
  while (head<tail){
    const l=Q[head++], v=F[l], lx=l%w, ly=(l/w)|0, t=(ly+y0)*tw+lx+x0;   // (l in the box, t on the map)
    if (v>until) break;
    if (mk[t]===stamp){
      mk[t]=0; if (found<0) found=t;
      if (--left<=0 || first) until=Math.min(until,v+margin);
    }
    const nv=v+1;
    let n=t-1;  if (lx>0 && F[l-1]<0 && land[n] && pass[own[n]] && !wall[wo[n]]){ F[l-1]=nv; Q[tail++]=l-1; }
    n=t+1;      if (lx<w-1 && F[l+1]<0 && land[n] && pass[own[n]] && !wall[wo[n]]){ F[l+1]=nv; Q[tail++]=l+1; }
    n=t-tw;     if (ly>0 && F[l-w]<0 && land[n] && pass[own[n]] && !wall[wo[n]]){ F[l-w]=nv; Q[tail++]=l-w; }
    n=t+tw;     if (ly<h-1 && F[l+w]<0 && land[n] && pass[own[n]] && !wall[wo[n]]){ F[l+w]=nv; Q[tail++]=l+w; }
  }
  return found;
}
const FIELD_MARGIN = 24;   // tiles a field reaches past the kingdoms it is worked out for
/** Fits field f to the box round the land of kingdoms `ids` (every tile they ever held lies in their
    boxes) and tiles `extra`, FIELD_MARGIN tiles wider. */
function fitBox(f: Field, ids: number[], extra: number[]){
  let x0=TW, y0=TH, x1=-1, y1=-1;
  for (const id of ids){ const n=W.nations[id]; if (!id || !n || n.x1<0) continue; x0=Math.min(x0,n.x0); y0=Math.min(y0,n.y0); x1=Math.max(x1,n.x1); y1=Math.max(y1,n.y1); }
  for (const t of extra){ const x=t%TW, y=(t/TW)|0; x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y); }
  if (x1<0){ f.fit(0,0,-1,-1); return; }
  f.fit(x0-FIELD_MARGIN,y0-FIELD_MARGIN,x1+FIELD_MARGIN,y1+FIELD_MARGIN);
}
/** Like fill, but if walls leave no way to what it looks for (`ok`), straight through them: the
    army will have to knock down a tower. */
function fillOrBreach(f: Field, src: number[], a: number, d: number, any: boolean, mark: (stamp: number) => number, first: boolean, margin: number, ok: (found: number) => boolean){
  let found=fill(f,src,a,d,any,mark,first,margin);
  if (!ok(found)){ breach=true; found=fill(f,src,a,d,any,mark,first,margin); breach=false; }
  return found;
}
/** Stamps every tile of nation a as wanted. */
const ownLand = (a: number) => (stamp: number) => {
  const own=owner, mk=want, A=W.nations[a]; let k=0;
  for (let y=Math.max(0,A.y0);y<=Math.min(TH-1,A.y1);y++) for (let t=y*TW+Math.max(0,A.x0), e=y*TW+Math.min(TW-1,A.x1);t<=e;t++) if (own[t]===a){ mk[t]=stamp; k++; }   // (its land lies in its box)
  return k;
};
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
function downhill(f: Field, x: number, y: number): [number, number] | null {
  const tx=(x/2)|0, ty=(y/2)|0, here=f.at(ty*TW+tx);
  let best=-1, bv = here<0 ? 32767 : here;
  for (const [ox,oy] of DIRS8){
    const nx=tx+ox, ny=ty+oy; if (nx<0||ny<0||nx>=TW||ny>=TH) continue;
    const k=ny*TW+nx, v=f.at(k); if (v<0 || v>=bv) continue;
    if (ox && oy && (f.at(ty*TW+nx)<0 || f.at(ny*TW+tx)<0)) continue;   // no squeezing between two corners
    bv=v; best=k;
  }
  if (best<0) return here>=0 ? [tx*2+1, ty*2+1] : null;
  return [(best%TW)*2+1, ((best/TW)|0)*2+1];
}
/** True if the straight walk a→b only crosses tiles with a way in field f. */
function clearWay(f: Field, ax: number, ay: number, bx: number, by: number){
  const x0=ax/2, y0=ay/2, x1=bx/2, y1=by/2, dx=x1-x0, dy=y1-y0, sx=dx>0?1:-1, sy=dy>0?1:-1;
  let tx=Math.floor(x0), ty=Math.floor(y0); const ex=Math.floor(x1), ey=Math.floor(y1);
  const tdx=dx ? Math.abs(1/dx) : Infinity, tdy=dy ? Math.abs(1/dy) : Infinity;
  let tmx=dx ? (sx>0 ? tx+1-x0 : x0-tx)*tdx : Infinity, tmy=dy ? (sy>0 ? ty+1-y0 : y0-ty)*tdy : Infinity;
  for (let guard=0;guard<2000;guard++){
    if (tx<0||ty<0||tx>=TW||ty>=TH || f.at(ty*TW+tx)<0) return false;
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
/** Where an army is: its banner on the march (on a front, the middle of its men's places), the middle of its men on the way home. */
function armyAt(c: Campaign): [number, number] {
  if (c.phase<2) return [c.bx,c.by];
  let x=0, y=0, k=0; for (const id of c.members){ const h=byId.get(id); if (h){ x+=h.x; y+=h.y; k++; } }
  return k ? [x/k,y/k] : [c.bx,c.by];
}
const campaignById = (id: number) => camps.get(id) ?? W.campaigns.find(c => c.id===id);
/** True if a's army could reach something of d's to raid, crossing only unclaimed, allied or d's land. */
export function routeOpen(a: number, d: number){
  const src=raidTargets(d).map(q => pCenter[q]); if (!src.length) return false;
  breach=true; const ok=fill(scratch,src,a,d,false,ownLand(a),true,0)>=0; breach=false;   // walls can be broken
  return ok;
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

/** Sends a's armies against d: the barracks named, or armies enough for `pick` soldiers, and
    `militia` of its militia at home (the nearest the castle first) as one band of their own. Each
    army marches on its own. An attack on a kingdom it is not at war with begins a crisis: its armies
    mass on the border and nobody fights until it gives the word (escalate). Returns false if none could go. */
export function declare(a: number, d: number, raid: boolean, pick: number | number[], militia=0){
  if (warProblem(a,d,raid)) return false;
  const A=W.nations[a], D=W.nations[d];
  const M=W.M, counter=!raid && W.ready[a*M+d]>0;   // our land is back: this one is for revenge
  let sent=0, first: Campaign | undefined;
  for (const { unit, men } of pickArmies(A,pick)){
    if (!raid && onFront(a,d,unit.key)) continue;   // its army is there already: its men join it (reinforce)
    const c=newCampaign(a,d,raid,-1,men.length,D.tiles,unit.key);
    c.inspired=counter;
    if (muster(c,men,unit)){ sent++; first??=c; }
  }
  const mil=militiaFor(a,militia);
  if (mil.length){
    const out=raid ? undefined : reservesOf(a,d);
    if (out) for (const h of mil) enlist(out,h,1e5);   // more of them, to the militia already on that front
    else {
      const c=newCampaign(a,d,raid,-1,mil.length,D.tiles,-1);
      c.militia=true; c.inspired=counter;
      if (muster(c,mil)){ sent++; first??=c; }
    }
    if (!first) first=out;
  }
  if (!first) return false;
  if (allied(a,d)){ W.ally[a*W.M+d]=W.ally[d*W.M+a]=0; on.allianceBroken(a,d); }
  W.grudge[d*W.M+a]=W.tickN;
  if (counter) on.story('revenge',a,first!.bx,first!.by,d);
  if (!raid){
    W.ready[a*M+d]=0;   // the counter-attack it was ready for is under way
    const crisis=!W.wars[a*M+d] && !W.aggr[a*M+d];
    W.aggr[a*M+d]=1;
    if (crisis){ on.crisis(a,d); return true; }
  }
  W.atWar[a*M+d]=W.atWar[d*M+a]=1;
  on.warBegan(a,d,raid);
  return true;
}
/** Is a's attack on d still a crisis: massed on the border, but not yet at war? */
export const inCrisis = (a: number, d: number) => !!W.aggr[a*W.M+d] && !W.wars[a*W.M+d];
/** a gives the word on its crisis with d: it is war. a's front attacks; d's, if it has one, holds. */
export function escalate(a: number, d: number){
  const M=W.M; if (!inCrisis(a,d)) return false;
  W.wars[a*M+d]=W.wars[d*M+a]=1; W.warSince[a*M+d]=W.warSince[d*M+a]=W.tickN;
  W.atWar[a*M+d]=W.atWar[d*M+a]=1;
  for (const i of [a*M+d, d*M+a]){ W.kills[i]=0; W.stall[i]=0; W.lastNet[i]=0; }   // this war's dead and its border, counted afresh
  for (const [k,st] of [[a*M+d,F_PUSH],[d*M+a,F_HOLD]]){
    if (!offensives.has(k)) continue;
    W.offensive[k]=st;
    for (const c of W.campaigns) if (c.front && c.a*M+c.d===k && c.phase<2){ c.mode=st; tell(c, st===F_PUSH ? 'assault' : 'hold'); }
  }
  on.escalated(a,d);
  return true;
}
/** Why a can't call off its crisis with d, or null. */
export const deescalateProblem = (a: number, d: number) => inCrisis(a,d) ? null : W.wars[a*W.M+d] ? 'It is war: only peace ends it now' : 'No crisis to call off';
/** a calls off its crisis with d: its armies go home, and so do those d sent to the border against
    them (unless d has massed an attack of its own). */
export function deescalate(a: number, d: number){
  if (deescalateProblem(a,d)) return false;
  const M=W.M;
  W.aggr[a*M+d]=0;
  for (const c of W.campaigns){
    if (c.phase===2 || !c.front) continue;
    if ((c.a===a && c.d===d) || (c.a===d && c.d===a && !W.aggr[d*M+a])) sendHome(c,'calm',false);
  }
  on.deescalated(a,d);
  return true;
}

/** Is the army of barracks `unit` out on a's front against d? */
const onFront = (a: number, d: number, unit: number) => W.campaigns.some(c => c.front && c.a===a && c.d===d && c.unit===unit && c.phase<2);
/** Men of a's armies on its front against d (leaders and militia called up too). */
export function menOn(a: number, d: number){ let k=0; for (const c of W.campaigns) if (c.front && c.a===a && c.d===d && c.phase<2) k+=c.members.length; return k; }
/** Why n can't send armies to stand on its side of the border with o, or null. */
export function defendProblem(n: number, o: number): string | null {
  const M=W.M, N=W.nations[n], O=W.nations[o];
  if (!N?.alive || !O?.alive || !o || n===o) return 'That kingdom is gone';
  if (!W.wars[n*M+o] && !W.aggr[o*M+n]) return 'They are not massing against you';
  if (!W.contact[n*M+o]) return 'Needs a shared border';
  if (!ready(N)) return 'No soldiers in your barracks';
  return null;
}
/** n sends its armies (the barracks named, or enough for `pick` soldiers) to stand on its side of
    the border with o: in a crisis they hold it, not fighting unless it comes to war; at war they make
    a front of its own, which can hold or attack. Returns false if none could go. */
export function defend(n: number, o: number, pick: number | number[]){
  if (defendProblem(n,o)) return false;
  let sent=0;
  for (const { unit, men } of pickArmies(W.nations[n],pick)){
    if (onFront(n,o,unit.key)) continue;   // its army is there already: its men join it (reinforce)
    const c=newCampaign(n,o,false,-1,men.length,W.nations[o].tiles,unit.key);
    if (muster(c,men,unit)) sent+=men.length;
  }
  if (!sent) return false;
  if (W.wars[n*W.M+o]) W.atWar[n*W.M+o]=W.atWar[o*W.M+n]=1;
  on.defending(n,o,sent);
  return true;
}

/** n's militia on a front (against o, if given), if they are out. */
export const reservesOf = (n: number, o?: number) => W.campaigns.find(c => c.militia && c.front && c.a===n && (o===undefined || c.d===o) && c.phase<2);
/** Militia of n's at home who would answer a call-up: all but the watchtowers' guards. */
export const callable = (n: number) => W.humans.filter(h => h.o===n && homeMilitia(h) && h.post<0);
/** The k of n's militia at home nearest its castle, to send with an attack or a raid. */
function militiaFor(n: number, k: number){
  k=Math.floor(k); if (k<=0) return [];
  const N=W.nations[n], [x,y]=N.capTile>=0 ? doorOf(N) : [0,0];
  return callable(n).sort((a,b) => ((a.x-x)**2+(a.y-y)**2)-((b.x-x)**2+(b.y-y)**2) || a.id-b.id).slice(0,k);
}
/** Why n can't call its militia up against o (or, `call` false, send them home), or null. A front
    that has some of them (sent with the attack) can still call up the rest. */
export function reservesProblem(n: number, o: number, call: boolean): string | null {
  const M=W.M, out=reservesOf(n,o);
  if (!call) return out ? null : 'Your reserves are at home';
  if (!W.nations[o]?.alive || !(W.wars[n*M+o] || W.aggr[n*M+o] || W.aggr[o*M+n])) return 'No crisis or war with them';
  if (out?.all) return 'Your reserves are already on that front';
  const all=W.campaigns.find(c => c.militia && c.front && c.all && c.a===n && c.phase<2);
  if (all) return 'Your reserves are on another front';
  if (!W.contact[n*M+o]) return 'Needs a shared border';
  if (!callable(n).length) return 'You have no militia at home';
  return null;
}
/** n calls its militia up to the front against o, every one at home but the watchtowers' guards (and
    those it raises while they are out follow), paying them a soldier's wage; or sends them home. */
export function callReserves(n: number, o: number, call: boolean){
  if (reservesProblem(n,o,call)) return false;
  if (!call){ sendHome(reservesOf(n,o)!,'recall'); on.reserves(n,o,0,false); return true; }
  const men=callable(n), out=reservesOf(n,o);
  if (out){ for (const h of men) enlist(out,h,1e5); out.all=true; }   // the rest join those sent with the attack
  else {
    const c=newCampaign(n,o,false,-1,men.length,W.nations[o].tiles,-1);
    c.militia=true; c.all=true;
    muster(c,men);
  }
  if (W.wars[n*W.M+o]) W.atWar[n*W.M+o]=W.atWar[o*W.M+n]=1;
  on.reserves(n,o,men.length,true);
  return true;
}
function newCampaign(a: number, d: number, raid: boolean, target: number, size: number, tiles: number, unit: number): Campaign {
  const front=!raid && target<0;   // an attack: its men go to the front (its way there is its offensive's)
  return { id:++W.campSeq, a, d, raid, target, hostile:true, front, militia:false, all:false, members:[], phase:0, bx:0, by:0, dx:1, dy:0, rx:0, ry:0, goal:-1,
    field:front ? offensiveOf(a,d).walk : new Field(), fieldAt:W.tickN, started:W.tickN, startSoldiers:size, startTiles:tiles, stall:0, why:'', unit, inspired:false, leader:-1, rank:0,
    mode:front ? W.offensive[a*W.M+d] : M_MARCH, go:false, hitAt:-1e9 };
}
/** The offensive of a against d, begun (gathering at the border) if there was none. */
function offensiveOf(a: number, d: number){
  const key=a*W.M+d;
  let o=offensives.get(key);
  if (!o){ o={ key, a, d, F:null, walk:new Field(), k:0, progress:0, strips:0, depth:null, since:W.tickN, noFront:0, men:[], camps:[] }; offensives.set(key,o); W.offensive[key]=F_GATHER; }
  return o;
}
/** Works out the way and calls the soldiers to form up in front of their barracks (or, if the way
    can't reach it, on our own ground nearest the goal). An attack's men set off for the front at once. */
function muster(c: Campaign, pool: Human[], u?: Unit){
  const A=W.nations[c.a];
  if (A.capTile>=0){ const [x,y]=doorOf(A); c.bx=x; c.by=y; }
  if (c.front){
    if (u){ c.bx=u.x; c.by=u.y; }
    c.rx=c.bx; c.ry=c.by; c.phase=1;
    W.campaigns.push(c); camps.set(c.id,c);
    pool.forEach((h,i) => enlist(c,h,i));
    lead(c,pool);
    return true;
  }
  const home=u ? tileOf(u.x,u.y) : -1;
  const goals=goalsOf(c), found=(b: number) => b>=0;
  let best=home>=0 ? fillOrBreach(c.field,goals,c.a,c.d,false,(st) => { want[home]=st; return 1; },true,2,found) : -1;
  if (best<0) best=fillOrBreach(c.field,goals,c.a,c.d,false,ownLand(c.a),true,80,found);
  if (best<0) return false;
  c.rx=c.bx=(best%TW)*2+1; c.ry=c.by=((best/TW)|0)*2+1;
  const s=downhill(c.field,c.bx,c.by);
  if (s && (s[0]!==c.bx || s[1]!==c.by)){ const L=Math.hypot(s[0]-c.bx,s[1]-c.by); c.dx=(s[0]-c.bx)/L; c.dy=(s[1]-c.by)/L; }
  W.campaigns.push(c); camps.set(c.id,c);
  pool.forEach((h,i) => enlist(c,h,i));
  lead(c,pool);
  return true;
}
/** More than 5: the best armoured of them leads army c (the longest serving among equals). Militia have no leader. */
function lead(c: Campaign, pool: Human[]){
  c.rank=c.militia ? 0 : rankFor(pool.length);
  if (!c.rank) return;
  const l=pool.reduce((b,h) => h.tier>b.tier || (h.tier===b.tier && h.id<b.id) ? h : b);
  c.leader=l.id; l.slot=1e6; l.lead=c.rank; l.hp*=2**c.rank;   // the better protected, the higher his rank
  on.order('march',c.a,c.d,c.rank,l.id,l.x,l.y);
}
/** Soldier h joins army c (at the end of its line). */
function enlist(c: Campaign, h: Human, slot: number){
  release(h); h.post=-1; h.site=-1; h.war=c.id; h.foe=-1; h.aim=-1; h.slot=c.front ? -1 : slot; h.task=TASK_ROAM; h.path=[]; h.wait=0; h.calm=0;
  h.fk=-1; h.line=-1; h.fx=h.x; h.fy=h.y;   // (on a front, his place is given at the next deployment)
  if (!c.members.includes(h.id)) c.members.push(h.id);
}
/** Why n can't send soldiers after enemy army `id`, or null. */
export function interceptProblem(n: number, id: number): string | null {
  const E=campaignById(id);
  if (!E || !E.hostile || E.d!==n || E.target>=0) return 'That army is gone';   // raiders on their way home can still be caught
  if (E.front) return 'Send armies to hold your border against that army';
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
  for (const id of c.members){ const h=byId.get(id); if (h){ h.foe=-1; h.aim=-1; h.fk=-1; h.line=-1; } }
  if (c.front) c.field=new Field();   // (it shared its offensive's way to the front)
  refield(c);
  on.armyHome(c.a,c.d,c.raid,why);
}
function refield(c: Campaign){
  c.fieldAt=W.tickN;
  if (c.phase===2){
    const A=W.nations[c.a], src: number[]=[];
    for (let y=Math.max(0,A.y0);y<=Math.min(TH-1,A.y1);y++) for (let t=y*TW+Math.max(0,A.x0), e=y*TW+Math.min(TW-1,A.x1);t<=e;t++) if (owner[t]===c.a) src.push(t);   // (its land lies in its box)
    fillOrBreach(c.field,src,c.a,c.d,true,armyTiles(c,false),false,12,(b) => b>=0); return;
  }
  if (c.front) return;   // its offensive works out the way to the front
  const src=goalsOf(c);
  if (!src.length){ if (c.phase<2) sendHome(c, c.raid || c.target>=0 ? 'done' : 'won', (c.raid || c.target>=0) && c.hostile); return; }
  const banner=tileOf(c.bx,c.by);
  fillOrBreach(c.field,src,c.a,c.d,false,armyTiles(c,true),false,24,() => c.field.at(banner)>=0);
  if (c.field.at(banner)>=0) return;
  sendHome(c,'cut');   // other kingdoms have closed every way on
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
  // each side keeps the land it occupies that joins on to its own; pockets cut off inside the other's
  // borders go back to their owner, so the new border has no islands in it
  cede(a,b); cede(b,a);
  for (const i of [a*M+b, b*M+a]){ W.offers[i]=0; W.atWar[i]=0; W.wars[i]=0; W.aggr[i]=0; W.stall[i]=0; W.lost[i]=0; W.ready[i]=0; }
  on.peaceMade(a,b);
}
/** At peace, the land o occupies of d's becomes o's where it joins on to o's own land (through
    other ground o occupies); the rest, landlocked in d's borders, is d's again. */
function cede(o: number, d: number){
  const held=(t: number) => occ[t]===o && owner[t]===d, tw=TW, nt=NT, Q=queue;
  const keep=new Uint8Array(NT); let head=0, tail=0;
  for (let t=0;t<nt;t++){
    if (!held(t)) continue;
    const x=t%tw;
    if ((x>0 && owner[t-1]===o && !occ[t-1]) || (x<tw-1 && owner[t+1]===o && !occ[t+1]) || (t>=tw && owner[t-tw]===o && !occ[t-tw]) || (t<nt-tw && owner[t+tw]===o && !occ[t+tw])){ keep[t]=1; Q[tail++]=t; }
  }
  while (head<tail){
    const t=Q[head++], x=t%tw;
    for (const n of [x>0 ? t-1 : -1, x<tw-1 ? t+1 : -1, t>=tw ? t-tw : -1, t<nt-tw ? t+tw : -1]) if (n>=0 && !keep[n] && held(n)){ keep[n]=1; Q[tail++]=n; }
  }
  for (let t=0;t<nt;t++) if (held(t)){ if (keep[t]) setOwner(t,o); else liberate(t); }
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
    in trouble; a long war wears it down, and one whose border has stopped moving all the more. */
export function wantsPeace(n: Nation, o: number){
  return outlook(n,o) + (W.srand()-0.5)*0.5 - Math.min(1,warAge(n.id,o)/6000) - Math.min(1.5,stalled(n.id,o)/2400) < 0;
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
  for (let o=1;o<W.M;o++){ const i=loser*W.M+o, j=o*W.M+loser; W.ally[i]=W.ally[j]=W.offers[i]=W.offers[j]=W.atWar[i]=W.atWar[j]=W.wars[i]=W.wars[j]=W.aggr[i]=W.aggr[j]=W.lost[i]=W.lost[j]=W.ready[i]=W.ready[j]=0; }
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
/** Moves the banner on along the way. Returns the tile of an enemy wall that stops it, or -1. */
function advance(c: Campaign){
  const f=c.field, here=f.at(tileOf(c.bx,c.by));
  if (here<0) return -1;
  if (here<=(c.target>=0 ? 3 : 1)) return -1;   // there: burn, or close with the enemy
  const s=downhill(f,c.bx,c.by); if (!s) return -1;
  const w=tileOf(s[0],s[1]); if (walledFor(c.a,w) && !walledFor(c.a,tileOf(c.bx,c.by))) return w;
  const dx=s[0]-c.bx, dy=s[1]-c.by, d=Math.hypot(dx,dy); if (d<1e-6) return -1;
  const st=Math.min(d,MARCH_SP*(c.inspired ? REVENGE_PACE : 1)*TICK); c.bx+=dx/d*st; c.by+=dy/d*st;
  // the line turns gradually toward where it is going
  c.dx+=(dx/d-c.dx)*0.08; c.dy+=(dy/d-c.dy)*0.08; const L=Math.hypot(c.dx,c.dy)||1; c.dx/=L; c.dy/=L;
  return -1;
}
function runCampaign(c: Campaign, men: Human[]){
  if (!men.length){
    // an attack's army lives on while its war does and its barracks stands: every man the barracks raises joins it at the front
    if (c.front && c.phase<2 && W.wars[c.a*W.M+c.d] && W.nations[c.d].alive && unitAt(c.unit)?.o===c.a){ if (c.leader>=0) leaderGone(c); c.members=[]; return; }
    if (c.leader>=0) leaderGone(c);
    W.campaigns.splice(W.campaigns.indexOf(c),1); camps.delete(c.id); on.armyGone(c.a,c.d,c.raid,c.phase===2 ? c.why : 'lost'); return;
  }
  // the line keeps its order and closes its gaps (the leader stays behind it); on a front, its offensive places the men
  if (!c.front){ men.sort((x,y)=>x.slot-y.slot || x.id-y.id); men.forEach((h,i) => h.slot=h.id===c.leader ? 1e6 : i); }
  c.members=men.map(h => h.id);
  if (c.leader>=0 && !men.some(h => h.id===c.leader)) leaderGone(c);
  if (c.phase<2 && !W.nations[c.d].alive){ sendHome(c,'won',false); return; }
  if (c.phase<2 && c.target>=0){ const E=campaignById(c.target); if (!E || !E.hostile){ sendHome(c,'done',false); return; } }   // they are beaten, home, or at peace
  if (c.front){ if (c.phase===2 && W.tickN-c.fieldAt>=REFIELD) refield(c); return; }   // on the front, its offensive moves it
  if (W.tickN-c.fieldAt>=(c.target>=0 ? REFIELD/2 : REFIELD)) refield(c);
  if (c.phase===2) return;
  let inPlace=0, near=0, busy=false;
  for (const h of men){
    const [sx,sy]=placeOf(c,h), d2=(h.x-sx)**2+(h.y-sy)**2;
    if (d2<25) inPlace++; if (d2<400) near++; if (h.foe>=0) busy=true;
  }
  if (c.phase===0){ if (inPlace>=men.length*0.7 || W.tickN-c.started>=(c.target>=0 ? INTERCEPT_MUSTER : MUSTER_TICKS)){ c.phase=1; c.stall=0; } return; }
  if (c.raid && c.mode!==M_ASSAULT && atBorder(c,men,inPlace)) return;   // raiders wait at the border for the word
  // the banner waits for fights to end and for stragglers, but not for ever
  const wait=busy || inPlace<men.length*0.6;
  if (wait && c.stall<(near<men.length*0.5 ? STRAGGLE_TICKS : STALL_TICKS)){ c.stall++; return; }
  if (!wait) c.stall=0;
  const w=advance(c);
  if (w>=0){   // a wall in the way and no way round: knock down a tower holding it up
    const q=wallTower[w];
    if (targetable(q,c)) for (const h of men) if (h.id!==c.leader && h.foe<0 && h.aim<0) h.aim=q;
  }
}
/** A raid on the march halts at its target's border, forms up there and waits for the word (bots
    give it at once); then, with most of its men up, it goes in. Returns true while it waits. */
function atBorder(c: Campaign, men: Human[], inPlace: number){
  if (c.mode===M_MARCH){
    const s=downhill(c.field,c.bx,c.by);
    if (owner[tileOf(c.bx,c.by)]!==c.d && (!s || owner[tileOf(s[0],s[1])]!==c.d)) return false;   // not there yet
    c.mode=M_HOLD; c.stall=0; tell(c,'ready');
    if (!W.nations[c.a].isPlayer) c.go=true;
  }
  if (!c.go){ c.stall=0; return true; }
  if (inPlace<men.length*0.6 && ++c.stall<STRAGGLE_TICKS) return true;
  c.mode=M_ASSAULT; c.stall=0; tell(c,'assault');
  return false;
}
/** Army c's leader gives an order aloud (an army without one: from its banner). */
function tell(c: Campaign, kind: string){
  const l=byId.get(c.leader);
  if (l) on.order(kind,c.a,c.d,c.rank,l.id,l.x,l.y); else on.order(kind,c.a,c.d,0,-1,c.bx,c.by);
}

/* ---------- the word: attack, or hold ---------- */
/** Why a can't give the word to attack d (`go`) or to hold, or null if it can. */
export function offensiveProblem(a: number, d: number, go: boolean): string | null {
  const key=a*W.M+d, st=W.offensive[key], front=offensives.has(key);
  if (go && front && !W.wars[key] && !W.aggr[key]) return 'They have not attacked: your armies hold the border';
  if (go) return (front && st!==F_PUSH) || W.campaigns.some(c => c.a===a && c.d===d && c.raid && c.phase<2 && !c.go) ? null : 'No army waits for the word';
  return front && st===F_PUSH ? null : 'No offensive under way';
}
/** a gives the word: its offensive against d attacks all along the front, and its raiders go in as
    soon as they reach d's border; or (`go` false) the offensive holds where it stands. Returns true
    if anything changed. */
export function setOffensive(a: number, d: number, go: boolean){
  const key=a*W.M+d, o=offensives.get(key), st=W.offensive[key];
  let done=false;
  if (go) for (const c of W.campaigns) if (c.a===a && c.d===d && c.raid && c.phase<2 && !c.go){ c.go=true; done=true; }
  if (o && go && !W.wars[key]) return escalate(a,d) || done;   // in a crisis, the word is war (and only the side that massed first can give it)
  if (o && (go ? st!==F_PUSH : st===F_PUSH)){
    const now=go ? F_PUSH : F_HOLD; W.offensive[key]=now; done=true;
    for (const c of W.campaigns) if (c.front && c.a===a && c.d===d && c.phase<2){ c.mode=now; tell(c, go ? 'assault' : 'hold'); }
  }
  return done;
}

/* ---------- leaders ---------- */
/** The leader is no longer with army c: home ahead of it, or fallen. */
function leaderGone(c: Campaign){ const l=byId.get(c.leader); if (l && l.hp>0){ c.leader=-1; unlead(l); } else leaderFell(c); }
/** A leader no longer leading: back to a soldier's hit points. */
function unlead(h: Human){ if (!h.lead) return; h.lead=0; h.hp=Math.min(h.hp,maxHp(h)); }
/** The leader of army c is dead: the army fights on without him. */
function leaderFell(c: Campaign){
  on.order(c.front ? 'fell' : 'slain',c.a,c.d,c.rank,c.leader,c.bx,c.by);
  c.leader=-1;
}
/** Soldiers at home join their barracks' army out on a front, and militia their called-up reserves. Called once the soldiers are stationed. */
export function reinforce(){
  for (const c of W.campaigns){
    if (!c.front || !c.hostile || c.phase===2) continue;
    if (c.militia){ if (c.all) for (const h of callable(c.a)) enlist(c,h,1e5); continue; }
    if (c.unit<0) continue;
    const u=unitAt(c.unit); if (!u || u.o!==c.a) continue;
    for (const h of u.members) if (h.war<0 && h.hp>0 && !switching(h) && !indoors(h)) enlist(c,h,1e5);
  }
}

/* ---------- fronts ---------- */
/** Where a's men may stand on its front against d: its own ground, short of any enemy wall. */
const standsFor = (a: number, d: number) => (t: number) => holds(a,d,t) && !walledFor(a,t);
/** Each offensive, once a tick: its men take their places on the front (worked out again every
    REFRONT ticks); gathered, it is ready for the word; attacking, it pushes on. A bot that massed an
    attack goes to war as soon as it is ready (or calls it off, outmatched); at war, a bot's front that
    started it attacks at once, and one defending holds (sim/bots.ts decides from there). */
function runOffensives(){
  const M=W.M, now=W.tickN, live=new Map<number, Campaign[]>();
  for (const c of W.campaigns) if (c.front && c.phase<2){ const k=c.a*M+c.d; let L=live.get(k); if (!L){ L=[]; live.set(k,L); } L.push(c); }
  for (const [key,o] of [...offensives]) if (!live.has(key)) endOffensive(o);
  for (const [key,cs] of live){
    const o=offensiveOf(cs[0].a,cs[0].d); o.camps=cs; o.men=[];
    for (const c of cs){ c.field=o.walk; for (const id of c.members){ const h=byId.get(id); if (h && h.id!==c.leader) o.men.push(h); } }
    if (!o.F || (now+key)%REFRONT===0) redeploy(o);
    if (!o.F!.tiles.length){   // no border left to fight on: the armies wait, and in the end go home
      if (++o.noFront>=NO_FRONT) for (const c of cs) sendHome(c,'cut');
      continue;
    }
    o.noFront=0;
    let st=W.offensive[key];
    const war=!!W.wars[key];
    if (st===F_GATHER){
      let present=0; for (const h of o.men) if (h.fk===key && (h.x-h.fx)**2+(h.y-h.fy)**2<=PRESENT*PRESENT) present++;
      if (present && (present>=o.men.length*GATHER_AT || now-o.since>=GATHER_MAX)){ st=W.offensive[key]=F_READY; for (const c of cs) tell(c, war || W.aggr[key] ? 'ready' : 'guard'); }
    }
    if (st===F_READY && !W.nations[o.a].isPlayer){
      if (!war){ if (W.aggr[key]){ botCrisis(o); st=W.offensive[key]; } }
      else { st=W.offensive[key]=W.aggr[key] ? F_PUSH : F_HOLD; for (const c of cs) tell(c, st===F_PUSH ? 'assault' : 'hold'); }
    }
    if (!offensives.has(key)) continue;
    for (const c of cs) c.mode=st;
    if (st===F_PUSH){
      if (!o.depth) o.depth=depths(o);
      if ((now+key)%ADVANCE_TICKS===0) push(o);
      if ((now+key)%20===10) encircle(o);
    }
  }
}
/** A bot's armies have massed on d's border: it goes to war, unless far more stand against them on
    the border (and half the soldiers d has at home besides), when it calls it off; the bolder the bot,
    the worse the odds it takes. */
function botCrisis(o: Offensive){
  const mine=menOn(o.a,o.d), theirs=menOn(o.d,o.a)+0.5*W.humans.filter(h => h.o===o.d && h.kind===H_SOLDIER && !h.militia && h.war<0).length;
  if (theirs>mine*(OUTMATCHED+W.nations[o.a].attackAt)) deescalate(o.a,o.d); else escalate(o.a,o.d);
}
/** a's offensive against d, as it stands: its front (null before it is first worked out) and how many men hold its front rank. */
export function offensiveFront(a: number, d: number): { F: Front | null; k: number } | undefined { const o=offensives.get(a*W.M+d); return o && { F:o.F, k:o.k }; }
/** An offensive with no armies left is over; the guard that stood against it stands down. */
function endOffensive(o: Offensive){
  offensives.delete(o.key); W.offensive[o.key]=F_GATHER;
  for (const h of W.humans) if (h.fk===o.key && h.o===o.d){ h.fk=-1; h.line=-1; }
}
/** Works out offensive o's front again and gives its men their places on it, each leader his behind
    the middle of his men, a rank behind the last, and (every other time) the way there. */
function redeploy(o: Offensive){
  const F=o.F=lineOf(o.a,o.d), key=o.key, ok=standsFor(o.a,o.d);
  if (!F.tiles.length){ o.k=0; return; }
  o.k=deploy(F,o.men,1,key,ok);
  const srcs: number[]=[];
  for (const h of o.men) srcs.push(tileOf(h.fx,h.fy));
  for (const c of o.camps){
    const mine: Human[]=[];
    for (const id of c.members){ const h=byId.get(id); if (h && h.id!==c.leader && h.fk===key) mine.push(h); }
    if (!mine.length) continue;
    mine.sort((p,q) => p.slot-q.slot || p.line-q.line || p.id-q.id);
    let x=0, y=0, deep=0; for (const h of mine){ x+=h.fx; y+=h.fy; deep=Math.max(deep,h.line); }
    c.bx=x/mine.length; c.by=y/mine.length;   // where the army is, for anyone looking for it
    const l=byId.get(c.leader); if (!l) continue;
    const u=mine[mine.length>>1].slot, [lx,ly]=placeAt(F,u,1,deep+1,ok);
    l.fk=key; l.slot=u; l.line=deep+1; l.fx=lx; l.fy=ly; srcs.push(tileOf(lx,ly));
  }
  if (!srcs.length || srcs.every(t => o.walk.at(t)===0)) return;   // (the way there still leads to everyone's place)
  const men=o.men.concat(o.camps.map(c => byId.get(c.leader)).filter((h): h is Human => !!h));
  const mark=(stamp: number) => { let k=0; for (const h of men){ const t=tileOf(h.x,h.y); if (want[t]!==stamp){ want[t]=stamp; k++; } } return k; };
  fillOrBreach(o.walk,srcs,o.a,o.d,false,mark,false,8,(b) => b>=0);
}
/** The front pushes on, a strip at a time at the pace the line's strength allows (a strip a second
    with a man every DENSE tiles or closer, slower as it thins). Each man of the front rank in his place
    takes the stretch of the line before him and DENSE tiles either side of it (so a line closes over a
    man who is not there), but not what a defender holds: the ground from the line up to a tile further
    from where the attack began (o.depth) than the last strip took. So the line moves on as one, a tile a
    strip, as straight as it started at any slant; a stretch that was held up takes the ground it is
    behind on, up to STRIP_DEEP tiles a strip, until it is level again. A tile of the line with more of
    the attacker's ground about it than a straight line has (a corner where it has fallen behind round a
    defender) goes too, so the line stays smooth. */
function push(o: Offensive){
  const F=o.F; if (!F || !F.tiles.length || !o.k) return;
  const gap=F.len/o.k;
  o.progress+=Math.min(1,DENSE/gap); if (o.progress<1) return;
  o.progress-=1;
  const T=F.tiles, take=new Uint8Array(T.length), a=o.a, d=o.d, tw=TW, R2=(PRESENT*2+gap)**2;   // (pixels: a little more room for a thin line, whose men have further to go when it closes up)
  for (const h of o.men){
    if (h.fk!==o.key || h.line!==0 || (h.x-h.fx)**2+(h.y-h.fy)**2>R2) continue;
    const lo=h.slot-gap/2-DENSE, hi=h.slot+gap/2+DENSE;
    let i=indexAt(F,lo); if (F.s[i]<lo) i++;
    let e=indexAt(F,hi); if (F.s[e]>=hi) e--;
    for (;i<=e;i++) take[i]=1;
  }
  // the strip: from the line before each man, the free ground no further from where the attack began
  // than is due by now, a few tiles deep at most
  const D=o.depth!, due=++o.strips*STEP, taken: number[]=[];
  let layer: number[]=[];
  for (let i=0;i<T.length;i++) if (take[i] && (D.at(T[i])<0 || D.at(T[i])<=due)) layer.push(T[i]);
  for (let deep=0; deep<STRIP_DEEP && layer.length; deep++){
    const next: number[]=[];
    for (const t of layer){
      if (!takeTile(t,a,d)) continue;
      taken.push(t);
      const x=t%tw;
      for (const m of [x>0 ? t-1 : -1, x<tw-1 ? t+1 : -1, t>=tw ? t-tw : -1, t<NT-tw ? t+tw : -1]) if (m>=0 && D.at(m)>=0 && D.at(m)<=due && enemyOf(a,d,m)) next.push(m);
    }
    layer=next;
  }
  // where the line has fallen behind round a defender, the corner fills in, a few tiles deep a strip
  let check=T.filter((_,i) => !take[i]);
  for (const t of taken){ const x=t%tw; for (const m of [x>0 ? t-1 : -1, x<tw-1 ? t+1 : -1, t>=tw ? t-tw : -1, t<NT-tw ? t+tw : -1]) if (m>=0) check.push(m); }
  for (let pass=0; pass<LEVEL_PASSES && check.length; pass++){
    const next: number[]=[], stamp=++seenSeq;
    for (const t of check){
      if (seen[t]===stamp || !enemyOf(a,d,t)) continue;
      seen[t]=stamp;
      if (!behind(t,a,d) || !takeTile(t,a,d)) continue;
      const x=t%tw; for (const m of [x>0 ? t-1 : -1, x<tw-1 ? t+1 : -1, t>=tw ? t-tw : -1, t<NT-tw ? t+tw : -1]) if (m>=0) next.push(m);
    }
    check=next;
  }
}
/** How far in each tile of d's ground (its free land, and a's it occupies) is from o's line as it stood when the attack began (STEP a
    tile): straight in from the stretch of the line nearest it, square to that stretch, so ground off
    the end of the line counts as the line carried on, and the line moves on as straight as it stood.
    -1 for ground the line can't reach. The nearest stretch is found walking over d's free land (a
    diagonal step 1.4 tiles), the castle no part of the way. */
let dDist=new Int32Array(0), dFrom=new Int32Array(0);   // depths' working room, kept between calls
function depths(o: Offensive){
  const a=o.a, d=o.d, D=new Field(), F=o.F, tw=TW, th=TH;
  fitBox(D, W.occCount[a*W.M+d]>0 ? [d,a] : [d], []);   // (d's ground lies in its box, and a's in a's)
  if (!F) return D;
  const n=D.w*D.h; if (dDist.length<n){ dDist=new Int32Array(n); dFrom=new Int32Array(n); }
  const dist=dDist, from=dFrom, ring: number[][]=Array.from({ length: 8 }, () => []), V=D.d;
  dist.fill(0x7fffffff,0,n);
  const open=(t: number) => enemyOf(a,d,t) && !underCastle(d,t) && D.idx(t)>=0;
  let waiting=0;
  F.tiles.forEach((t,i) => { if (open(t)){ const l=D.idx(t); dist[l]=0; from[l]=i; ring[0].push(t); waiting++; } });
  for (let cur=0; waiting>0; cur++){
    const B=ring[cur&7];
    while (B.length){
      const t=B.pop()!, l=D.idx(t); waiting--;
      if (dist[l]!==cur) continue;   // (a shorter way was found)
      const i=from[l], f=F.tiles[i], x=t%tw, y=(t/tw)|0;
      V[l]=Math.max(0,Math.min(32767,Math.round(-((x-f%tw)*F.bx[i]+(y-((f/tw)|0))*F.by[i])*STEP)));   // (the way back is out of their land: in is the other way)
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){
        if ((!dx && !dy) || x+dx<0 || y+dy<0 || x+dx>=tw || y+dy>=th) continue;
        const m=t+dy*tw+dx; if (!open(m)) continue;
        if (dx && dy && (!open(t+dx) || !open(t+dy*tw))) continue;   // no slipping between two corners
        const nd=cur+(dx && dy ? 7 : 5), lm=D.idx(m);
        if (nd<dist[lm]){ dist[lm]=nd; from[lm]=i; ring[nd&7].push(m); waiting++; }
      }
    }
  }
  return D;
}
/** Is tile t (of d's free land) in a corner where the line has fallen behind: more of a's ground
    about it than any straight line has (which, at any slant, never has more than half)? */
function behind(t: number, a: number, d: number){
  const x=t%TW, y=(t/TW)|0; let ours=0, all=0;
  for (let yy=Math.max(0,y-2);yy<=Math.min(TH-1,y+2);yy++) for (let xx=Math.max(0,x-2);xx<=Math.min(TW-1,x+2);xx++){ const k=yy*TW+xx; if (k===t || !isLand[k]) continue; all++; if (holds(a,d,k)) ours++; }
  return ours>all*0.55;
}
/** a takes tile t of d's ground (occupying it, or freeing its own), unless a soldier of d's holds it, an enemy wall stands on it, or it is under the castle. */
function takeTile(t: number, a: number, d: number){
  if (!enemyOf(a,d,t) || (heldAt[t]===W.tickN && heldBy[t]!==a) || walledFor(a,t) || underCastle(d,t)) return false;
  if (owner[t]===a) liberate(t); else occupy(t,a);
  return true;
}
/** Pockets of the defender's ground cut off by the front (its free land, or the attacker's it
    occupies), with nothing but the attacker's ground about them (and the sea, and unclaimed land),
    fall to the attacker, unless a defender holds some of it. Its castle's patch and its biggest one
    are never pockets. */
function encircle(o: Offensive){
  const a=o.a, d=o.d, D=W.nations[d], A=W.nations[a]; if (D.capTile<0) return;
  const tw=TW, th=TH, now=W.tickN, first=seenSeq+1;
  const nbrs=(t: number) => { const x=t%tw; return [x>0 ? t-1 : -1, x<tw-1 ? t+1 : -1, t>=tw ? t-tw : -1, t<NT-tw ? t+tw : -1]; };
  const pockets: { tiles: number[]; closed: boolean; held: boolean }[]=[];
  const boxes=W.occCount[a*W.M+d]>0 ? [D,A] : [D];
  for (const K of boxes) for (let y=Math.max(0,K.y0);y<=Math.min(th-1,K.y1);y++) for (let x=Math.max(0,K.x0);x<=Math.min(tw-1,K.x1);x++){
    const t0=y*tw+x; if (seen[t0]>=first || !enemyOf(a,d,t0)) continue;
    const stamp=++seenSeq, patch=[t0]; seen[t0]=stamp;
    let closed=true, held=false;
    for (let i=0;i<patch.length;i++){
      const t=patch[i]; if (heldAt[t]===now && heldBy[t]===d) held=true;
      for (const n of nbrs(t)){
        if (n<0 || seen[n]===stamp) continue;
        if (enemyOf(a,d,n)){ seen[n]=stamp; patch.push(n); }
        else if (isLand[n] && owner[n] && !holds(a,d,n)) closed=false;
      }
    }
    pockets.push({ tiles:patch, closed, held });
  }
  if (pockets.length<2) return;
  let big=pockets[0]; for (const p of pockets) if (p.tiles.length>big.tiles.length) big=p;
  for (const p of pockets) if (p!==big && p.closed && !p.held && !p.tiles.includes(D.capTile)) for (const t of p.tiles) takeTile(t,a,d);
}
/** The guard of every kingdom at war that has no army of its own on the border mans its side of each
    front against it: its trained soldiers at home (not militia, who wait to be called up), shared
    between the fronts by the size of the armies on them, the nearest to each, spread evenly along the
    line with reserves behind; and the way to their places. */
function deployGuards(){
  defended.fill(0);
  const byD=new Map<number, Offensive[]>();
  for (const o of offensives.values()){
    if (!o.F || !o.F.tiles.length || !W.wars[o.key] || offensives.has(o.d*W.M+o.a)) continue;   // (in a crisis nobody turns out; with its own front there, its armies hold it)
    let L=byD.get(o.d); if (!L){ L=[]; byD.set(o.d,L); } L.push(o);
  }
  for (const [d,list] of byD){
    defended[d]=1;
    const guard=W.humans.filter(h => h.o===d && h.kind===H_SOLDIER && !h.militia && h.war<0 && h.post<0 && h.hp>0 && !indoors(h) && !switching(h));
    let total=0; for (const o of list) total+=o.men.length+1;
    let rest=guard;
    list.forEach((o,i) => {
      const F=o.F!, [cx,cy]=placeAt(F,F.len/2,-1,0,() => true), share=i===list.length-1 ? rest.length : Math.min(rest.length,Math.round(guard.length*(o.men.length+1)/total));
      rest=rest.slice().sort((p,q) => (p.fk===o.key ? 0 : 1)-(q.fk===o.key ? 0 : 1) || Math.hypot(p.x-cx,p.y-cy)-Math.hypot(q.x-cx,q.y-cy) || p.id-q.id);
      deploy(F,rest.slice(0,share),-1,o.key,(t) => owner[t]===d);
      rest=rest.slice(share);
    });
    for (const h of rest){ h.fk=-1; h.line=-1; }
    const srcs: number[]=[]; for (const h of guard) if (h.fk>=0) srcs.push(tileOf(h.fx,h.fy));
    if (srcs.length){ fillOwnFrom(homeField[d] ??= new Field(), srcs, d); homeFieldFor[d]=-1; }
  }
}
/** Steps to the nearest of `srcs` over kingdom o's own land only. */
function fillOwnFrom(f: Field, srcs: number[], o: number){
  const n=W.nations[o];
  f.fit(n.x0,n.y0,n.x1,n.y1);   // (every tile it holds lies in its box)
  const F=f.d, w=f.w, h=f.h, x0=f.x0, y0=f.y0, Q=queue, own=owner, tw=TW; let head=0, tail=0;
  for (const s of srcs){ const l=f.idx(s); if (l>=0 && F[l]<0){ F[l]=0; Q[tail++]=l; } }
  while (head<tail){
    const l=Q[head++], nv=F[l]+1, lx=l%w, ly=(l/w)|0, t=(ly+y0)*tw+lx+x0;
    if (lx>0 && F[l-1]<0 && own[t-1]===o){ F[l-1]=nv; Q[tail++]=l-1; }
    if (lx<w-1 && F[l+1]<0 && own[t+1]===o){ F[l+1]=nv; Q[tail++]=l+1; }
    if (ly>0 && F[l-w]<0 && own[t-tw]===o){ F[l-w]=nv; Q[tail++]=l-w; }
    if (ly<h-1 && F[l+w]<0 && own[t+tw]===o){ F[l+w]=nv; Q[tail++]=l+w; }
  }
}

export function updateWar(){
  const M=W.M, N=W.nations, H=W.humans;
  byId.clear(); camps.clear(); troops.clear();
  buildWalls();
  for (const h of H){
    byId.set(h.id,h);
    if (h.lead && h.war<0) unlead(h);
    const max=maxHp(h);
    if (h.hp<max) h.hp=Math.min(max,h.hp+REGEN);   // everyone heals, slowly
  }
  for (const c of W.campaigns){ camps.set(c.id,c); troops.set(c.id,[]); }
  for (const h of H) if (h.war>=0){ const men=troops.get(h.war); if (men) men.push(h); else { h.war=-1; backToRoam(h); } }
  for (const c of [...W.campaigns]) if (camps.has(c.id)) runCampaign(c, troops.get(c.id)!);
  // kingdoms at war: a war between them, or a raid still out
  W.atWar.fill(0);
  for (let i=0;i<M*M;i++) if (W.wars[i]) W.atWar[i]=1;
  for (const c of W.campaigns) if (c.hostile && (!c.front || W.wars[c.a*M+c.d])){ W.atWar[c.a*M+c.d]=1; W.atWar[c.d*M+c.a]=1; }   // (armies massed in a crisis aren't at war)
  if (warring.length!==M) warring=new Uint8Array(M); else warring.fill(0);
  for (let a=1;a<M;a++) for (let b=1;b<M;b++) if (W.atWar[a*M+b]){ warring[a]=1; break; }
  for (let o=1;o<M;o++) if (!warring[o] && homeField[o]){ homeField[o]=undefined; homeFieldFor[o]=-1; }   // (at peace: no guard to lead)
  for (let i=0;i<W.offers.length;i++) if (W.offers[i] && (W.tickN-W.offers[i]>OFFER_TICKS || !W.atWar[i])) W.offers[i]=0;
  // who can be fought: soldiers out of doors, and villagers who took up arms
  armies=N.map(() => []);
  const now=W.tickN, own=owner, oc=occ, tw=TW, th=TH;
  for (const h of H){
    if (h.hp<=0 || indoors(h)) continue;
    if (h.kind===H_SOLDIER){
      armies[h.o].push(h);
      if (!warring[h.o]) continue;
      // a soldier holds his side's ground about him: nobody takes it while he stands there
      const t=tileOf(h.x,h.y), x=t%tw, y=(t/tw)|0, o=h.o;
      for (let yy=Math.max(0,y-ZOC);yy<=Math.min(th-1,y+ZOC);yy++) for (let xx=Math.max(0,x-ZOC), k=yy*tw+xx;xx<=Math.min(tw-1,x+ZOC);xx++,k++){
        if ((own[k]===o && !oc[k]) || oc[k]===o){ heldAt[k]=now; heldBy[k]=o; }
      }
    } else if (h.brave>=1) armies[h.o].push(h);   // armed villagers, and the mob
  }
  fighting.clear();
  for (const h of H) if (h.foe>=0 && h.hp>0) fighting.set(h.foe,(fighting.get(h.foe) ?? 0)+1);
  runOffensives();
  if (now%REFRONT===2) deployGuards();
  posts=N.map(n => warring[n.id] ? barracksOf(n).map(frontOf) : []);
  if (W.tickN%5===0) findRallies();
  lineUp();
  if (W.tickN%10===0) checkReconquest();
  if (W.tickN%STALL_EVERY===STALL_EVERY>>1) watchBorders();
  towersFire();
}
/** Every STALL_EVERY ticks, for each war: has the border between them moved (the land each holds of
    the other's, taken together) by more than a little? If not, the war has stalled that much longer. */
function watchBorders(){
  const M=W.M, N=W.nations;
  for (let a=1;a<M;a++) for (let b=a+1;b<M;b++){
    const i=a*M+b, j=b*M+a; if (!W.wars[i]) continue;
    const net=W.occCount[b*M+a]-W.occCount[a*M+b], tol=Math.max(STALL_TILES, STALL_SHARE*Math.min(N[a].tiles,N[b].tiles));
    if (Math.abs(net-W.lastNet[i])<tol) W.stall[i]=W.stall[j]=W.stall[i]+STALL_EVERY; else W.stall[i]=W.stall[j]=0;
    W.lastNet[i]=net; W.lastNet[j]=-net;
  }
}
/** Ticks the war between a and b has gone without its border moving much. */
export const stalled = (a: number, b: number) => W.stall[a*W.M+b];

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
      if (!c.hostile || c.front || c.a===o || !W.atWar[c.a*M+o] || (c.phase===2 && !c.raid)) continue;
      const [ax,ay]=armyAt(c), bx=(ax/2)|0, by=(ay/2)|0;
      for (let y=Math.max(0,by-THREAT_TILES);y<=Math.min(TH-1,by+THREAT_TILES);y++) for (let x=Math.max(0,bx-THREAT_TILES);x<=Math.min(TW-1,bx+THREAT_TILES);x++){
        if (owner[y*TW+x]!==o) continue;
        const d=(x-bx)**2+(y-by)**2;
        if (d<bd){ bd=d; const px=x*2+1, py=y*2+1, L=Math.hypot(ax-px,ay-py)||1; best={ x:px, y:py, dx:(ax-px)/L, dy:(ay-py)/L, threat:true, n:0 }; }
      }
    }
    // (a kingdom whose guard is on a front takes its land back from there: only the pockets, now and then)
    if (!best && W.tickN%(defended[o] ? 100 : 20)===0){
      let lost=0; for (let b=1;b<M;b++) lost+=W.occCount[o*M+b];
      if (lost){
        const cx=n.capTile>=0 ? n.capTile%TW : n.ltx, cy=n.capTile>=0 ? (n.capTile/TW)|0 : n.lty;
        // what the guard can walk to from the heart of the kingdom; pockets cut off from it, and
        // from the enemy's army, can't be held by anyone and fall back to us
        const reach=reachOwn(cy*TW+cx,o);
        // a tile the guard can reach and stand on to take t back (within reclaim reach), or -1
        const standFor=(t: number) => { const x=t%TW, y=(t/TW)|0; let bs=-1, bk=99;
          for (let dy=-CAPTURE_R;dy<=CAPTURE_R;dy++) for (let dx=-CAPTURE_R;dx<=CAPTURE_R;dx++){
            const k=Math.abs(dx)+Math.abs(dy), xx=x+dx, yy=y+dy;
            if (k>CAPTURE_R+1 || xx<0||yy<0||xx>=TW||yy>=TH || seen[yy*TW+xx]!==reach || k>=bk) continue;
            bk=k; bs=yy*TW+xx; }
          return bs; };
        for (let y=Math.max(0,n.y0);y<=Math.min(TH-1,n.y1);y++) for (let t=y*TW+Math.max(0,n.x0), e=y*TW+Math.min(TW-1,n.x1);t<=e;t++){
          if (owner[t]!==o || !occ[t]) continue;
          const at=standFor(t);
          if (at<0){ if (!(heldAt[t]===W.tickN && heldBy[t]===occ[t])) liberate(t); continue; }
          const x=t%TW, y=(t/TW)|0, d=(x-cx)**2+(y-cy)**2;
          if (d<bd){ bd=d; const L=Math.hypot(x-cx,y-cy)||1; best={ x:(at%TW)*2+1, y:((at/TW)|0)*2+1, dx:(x-cx)/L, dy:(y-cy)/L, threat:false, n:0 }; }
        }
      }
    } else if (!best && rallies[o] && !rallies[o]!.threat){ best=rallies[o]; }   // keep marching on the occupied land between searches
    if (defended[o] && best && !best.threat) best=null;   // its guard is on the front: the land comes back from there
    rallies[o]=best;
    if (best){
      const t=tileOf(best.x,best.y);
      if (homeFieldFor[o]!==t){ homeFieldFor[o]=t; fillOwn(homeField[o] ??= new Field(), t, o); }
    }
  }
}
/** Stamps (in `seen`) every tile of kingdom o's own land reachable from tile `src` over it; returns the stamp. */
function reachOwn(src: number, o: number){
  const stamp=++seenSeq, Q=queue, own=owner, tw=TW, nt=NT, S=seen; let head=0, tail=0;
  S[src]=stamp; Q[tail++]=src;
  while (head<tail){
    const t=Q[head++], x=t%tw;
    let n=t-1;  if (x>0 && S[n]!==stamp && own[n]===o){ S[n]=stamp; Q[tail++]=n; }
    n=t+1;      if (x<tw-1 && S[n]!==stamp && own[n]===o){ S[n]=stamp; Q[tail++]=n; }
    n=t-tw;     if (t>=tw && S[n]!==stamp && own[n]===o){ S[n]=stamp; Q[tail++]=n; }
    n=t+tw;     if (t<nt-tw && S[n]!==stamp && own[n]===o){ S[n]=stamp; Q[tail++]=n; }
  }
  return stamp;
}
/** Steps to tile `src` over kingdom o's own land only. */
function fillOwn(f: Field, src: number, o: number){ fillOwnFrom(f,[src],o); }
/** Walks a home-guard member toward his place: along his land's way to the rally while far, straight once close. */
function walkToLine(h: Human, gx: number, gy: number){
  const f=homeField[h.o];
  if (f && Math.hypot(gx-h.x,gy-h.y)>6 && f.at(tileOf(h.x,h.y))>2){
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
    const guard = h.kind===H_SOLDIER ? h.war<0 && h.post<0 && h.fk<0 : h.brave===1;   // (not those on a front)
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
    if (W.campaigns.some(c => c.a===b && c.d===o && c.phase<2 && c.hostile && c.members.length)) continue;   // the invaders are still about
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
  // only at those who have come onto our land: each kingdom's intruders, found once
  const intruders: Human[][]=N.map(() => []);
  for (const h of W.humans){
    if (h.hp<=0 || indoors(h)) continue;
    const o=owner[tileOf(h.x,h.y)]; if (o && o!==h.o && warring[o] && W.atWar[o*M+h.o]) intruders[o].push(h);
  }
  const shoot=(i: number, x: number, y: number, range: number, dmg: number) => {
    let target: Human | null=null, bd=Infinity, soldier=false;
    for (const h of intruders[i]){
      if (h.hp<=0) continue;
      const d=(h.x-x)**2+(h.y-y)**2; if (d>range*range) continue;
      const s=h.kind===H_SOLDIER;
      if ((s && !soldier) || (s===soldier && (d<bd || (d===bd && target!==null && h.id<target.id)))){ target=h; bd=d; soldier=s; }
    }
    if (target){ const was=target.hp; target.hp-=dmg; underFire(target); if (was>0 && target.hp<=0) W.kills[i*W.M+target.o]++; on.towerShot(x,y,target.x,target.y-2,target.hp<=0,target.id); }
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
/** Notes that soldier h's army has come under attack. */
function underFire(h: Human){ if (h.war>=0){ const c=camps.get(h.war); if (c) c.hitAt=W.tickN; } }
function strike(h: Human, e: Human){
  if (h.cool>0 || h.beggar) return;   // a beggar strikes no blow: he only stands in the way
  h.cool=HIT_TICKS;
  on.swing(h.id,e.id);
  if (W.prand()<HIT_CHANCE){
    const was=e.hp;
    e.hp-=(h.kind!==H_SOLDIER ? MILITIA_DMG : h.militia ? MILITIA_HIT : HIT_DMG[h.tier])*(revenge(h) ? REVENGE_DMG : 1); underFire(e);
    if (was>0 && e.hp<=0) W.kills[h.o*W.M+e.o]++;
    on.hit(e.x,e.y-2,e.hp<=0,e.id,h.id);
  }
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
    const here=c.field.at(tileOf(h.x,h.y)), flag=c.field.at(tileOf(c.bx,c.by));
    if (toLine && Math.hypot(c.bx-h.x,c.by-h.y)>2 && clearWay(c.field,h.x,h.y,c.bx,c.by)){ dx=c.bx-h.x; dy=c.by-h.y; d=Math.hypot(dx,dy); stop=0; }
    else if (toLine && here>=0 && flag>=0 && here<flag) return;
    else {
      const s=downhill(c.field,h.x,h.y);
      if (s){ dx=s[0]-h.x; dy=s[1]-h.y; d=Math.hypot(dx,dy); stop=0; if (d<1e-6) return; }
    }
  }
  const st=Math.min(d-stop,marchPace(h,c)*TICK), w=wallStep(h,h.x+dx/d*st,h.y+dy/d*st);
  // stopped by a wall: break it down (a tower holding it up), unless he leads or his front is holding
  if (w>=0 && h.foe<0 && h.aim<0 && h.id!==c.leader && targetable(wallTower[w],c) && (!c.front || W.offensive[c.a*W.M+c.d]===F_PUSH)) h.aim=wallTower[w];
}
/** Steps h to (nx,ny) unless an enemy wall is in the way, sliding along it if he can. Returns the
    wall's tile if one stopped him (in either direction), or -1. Someone already on a wall walks off it freely. */
function wallStep(h: Human, nx: number, ny: number){
  const t=tileOf(nx,ny);
  if (!walledFor(h.o,t) || walledFor(h.o,tileOf(h.x,h.y))){ h.x=nx; h.y=ny; return -1; }
  if (!walledFor(h.o,tileOf(nx,h.y))) h.x=nx;
  else if (!walledFor(h.o,tileOf(h.x,ny))) h.y=ny;
  return t;
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
  // raiders burn what is near their banner; anyone goes for a tower that can shoot them
  const R=c.raid ? RAID_R : TOWER_RANGE+4, S=Math.max(R,TOWER_RANGE+4), bx=c.bx, by=c.by;
  const qx0=Math.max(0,Math.floor((bx-S)/8)), qx1=Math.min(PW-1,Math.floor((bx+S)/8)), qy0=Math.max(0,Math.floor((by-S)/8)), qy1=Math.min(PH-1,Math.floor((by+S)/8));
  let best=-1, bs=Infinity;
  for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
    const q=mainOf(y*PW+x); if (!targetable(q,c) || pType[q]===B_CASTLE) continue;
    const [x0,y0,x1,y1]=rectOf(q), d=Math.hypot(clamp(h.x,x0,x1)-h.x, clamp(h.y,y0,y1)-h.y), tower=pType[q]===B_TOWER;
    if (d>(tower ? TOWER_RANGE+4 : ENGAGE_R+8)) continue;
    if (!tower && Math.hypot(clamp(bx,x0,x1)-bx, clamp(by,y0,y1)-by)>R) continue;
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
  const leader=h.id===c.leader, [sx,sy]=placeOf(c,h);
  for (let o=1;o<W.M;o++){
    if (!W.atWar[c.a*W.M+o]) continue;
    for (const e of armies[o] ?? []){
      if (e.hp<=0) continue;
      const d=Math.hypot(e.x-h.x,e.y-h.y), onMe=e.foe===h.id, onLeader=c.leader>=0 && e.foe===c.leader;
      if (leader){ if (!onMe && d>=MELEE_R*2) continue; }   // the leader fights only whoever is on him
      else if (!onMe && !onLeader && (Math.hypot(e.x-sx,e.y-sy)>ENGAGE_R || (e.x-c.bx)**2+(e.y-c.by)**2>LEASH*LEASH)) continue;
      else if (onLeader && (e.x-c.bx)**2+(e.y-c.by)**2>(LEASH*1.4)**2) continue;
      const s=d+CROWD*crowdOn(e,h)-(onMe ? 4 : 0)-(onLeader ? 20 : 0);   // anyone on the leader first
      if (s<bs || (s===bs && best && e.id<best.id)){ bs=s; best=e; }
    }
  }
  if (best){ h.foe=best.id; h.aim=-1; return; }
  h.foe=-1;
  if (leader){ h.aim=-1; return; }   // he leads
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
  const st=Math.min(d,pace(h)*TICK); wallStep(h,h.x+dx/d*st,h.y+dy/d*st);
}
/** One tick for a soldier in a campaign. */
export function marchStep(h: Human){
  const c=camps.get(h.war); if (!c){ h.war=-1; backToRoam(h); return; }
  if (h.cool>0) h.cool--;
  if (c.phase===2){ homeward(h,c); return; }
  reclaim(h);   // passing by our own occupied land
  if (c.front){ frontStep(h,c); return; }
  if ((h.id+W.tickN)%4===0) choose(h,c);
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  if (foe && (foe.hp<=0 || !atWar(h.o,foe.o) || indoors(foe) || (foe.x-c.bx)**2+(foe.y-c.by)**2>(LEASH*1.4)**2)){ foe=undefined; h.foe=-1; }
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
  const [sx,sy]=placeOf(c,h);
  moveTo(h,c,sx,sy,0,true);
}
/** One tick for a man of an army on a front: fight an enemy who comes at him or at his place (any
    near it while attacking; while holding, those who come onto his side's ground), break what stands
    by his place while attacking, and otherwise go to his place and stand there. Its leader fights
    only whoever is on him. */
function frontStep(h: Human, c: Campaign){
  const pushing=W.offensive[c.a*W.M+c.d]===F_PUSH, leader=h.id===c.leader;
  if ((h.id+W.tickN)%4===0) chooseOnFront(h,c,pushing,leader);
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  const R=(pushing ? REACH_PUSH : REACH_HOLD)*1.6;
  if (foe && (foe.hp<=0 || !atWar(h.o,foe.o) || indoors(foe) || (foe.foe!==h.id && (foe.x-h.fx)**2+(foe.y-h.fy)**2>R*R))){ foe=undefined; h.foe=-1; }
  if (foe){
    if ((foe.x-h.x)**2+(foe.y-h.y)**2<=MELEE_R*MELEE_R) strike(h,foe); else moveTo(h,c,foe.x,foe.y,1.6);
    return;
  }
  if (h.aim>=0 && (!pushing || !targetable(h.aim,c) || !byPlace(h,h.aim,1.5))) h.aim=-1;   // (the front has moved on from it)
  if (h.aim>=0){
    const [x0,y0,x1,y1]=rectOf(h.aim);
    if (h.x>=x0-1.5 && h.x<=x1+1.5 && h.y>=y0-1.5 && h.y<=y1+1.5) hitBuilding(h,c);
    else moveTo(h,c,clamp(h.x,x0-1,x1+1),clamp(h.y,y0-1,y1+1));
    return;
  }
  if (h.fk<0){ const s=downhill(c.field,h.x,h.y); if (s) moveTo(h,c,s[0],s[1]); return; }   // no place yet: on toward the front
  moveTo(h,c,h.fx,h.fy,0.2);
}
/** A man of the front picks his enemy: one on him or on his leader, or one near his place (while
    holding, only one who has come onto his side's ground), the nearest first, but one his comrades are
    already fighting counts as further off, so the line meets the enemy all along. With nobody to fight
    while attacking, he goes for a building by his place: a watchtower, the castle, or what stands on
    ground his side has taken. */
function chooseOnFront(h: Human, c: Campaign, pushing: boolean, leader: boolean){
  let best: Human | undefined, bs=Infinity;
  const R=pushing ? REACH_PUSH : REACH_HOLD, M=W.M;
  for (let o=1;o<M;o++){
    if (!W.atWar[c.a*M+o]) continue;
    for (const e of armies[o] ?? []){
      if (e.hp<=0) continue;
      const d=Math.hypot(e.x-h.x,e.y-h.y), onMe=e.foe===h.id, onLeader=c.leader>=0 && e.foe===c.leader;
      if (leader){ if (!onMe && d>=MELEE_R*2) continue; }
      else if (!onMe){
        if (!(onLeader && d<R*1.5) && (e.x-h.fx)**2+(e.y-h.fy)**2>R*R) continue;
        if (!pushing && !onLeader && !holds(c.a,c.d,tileOf(e.x,e.y))) continue;
      }
      const s=d+CROWD*crowdOn(e,h)-(onMe ? 4 : 0)-(onLeader ? 20 : 0);
      if (s<bs || (s===bs && best && e.id<best.id)){ bs=s; best=e; }
    }
  }
  if (best){ h.foe=best.id; h.aim=-1; return; }
  h.foe=-1;
  if (leader || !pushing || h.fk<0){ h.aim=-1; return; }
  if (h.aim>=0 && targetable(h.aim,c) && byPlace(h,h.aim,1.5)) return;   // busy with one
  const S=12, x=h.fx, y=h.fy;
  const qx0=Math.max(0,Math.floor((x-S)/8)), qx1=Math.min(PW-1,Math.floor((x+S)/8)), qy0=Math.max(0,Math.floor((y-S)/8)), qy1=Math.min(PH-1,Math.floor((y+S)/8));
  let q=-1, qs=Infinity;
  for (let py=qy0;py<=qy1;py++) for (let px=qx0;px<=qx1;px++){
    const m=mainOf(py*PW+px); if (!targetable(m,c) || !byPlace(h,m,1)) continue;
    const [x0,y0,x1,y1]=rectOf(m), s=Math.hypot(clamp(x,x0,x1)-x, clamp(y,y0,y1)-y)-(pType[m]===B_TOWER ? 20 : 0);
    if (s<qs || (s===qs && m<q)){ qs=s; q=m; }
  }
  h.aim=q;
}
/** Is building q by the place of h on the front (times `k`)? A watchtower within 12 pixels of it, the
    castle within 8, anything else within 5. */
function byPlace(h: Human, q: number, k: number){
  const [x0,y0,x1,y1]=rectOf(q), ty=pType[q];
  return Math.hypot(clamp(h.fx,x0,x1)-h.fx, clamp(h.fy,y0,y1)-h.fy)<=(ty===B_TOWER ? 12 : ty===B_CASTLE ? 8 : 5)*k;
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
/** A defender's place on the front: hold it, and fight enemies who come onto his land near it (or at
    him); never leaves his land. */
function holdFront(h: Human){
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  if (!valid(h,foe) || (foe.foe!==h.id && (foe.x-h.fx)**2+(foe.y-h.fy)**2>(DEF_REACH*1.5)**2)) foe=undefined;
  if (!foe && (h.id+W.tickN)%3===0){
    let bs=Infinity;
    for (let o=1;o<W.M;o++){
      if (!W.atWar[h.o*W.M+o]) continue;
      for (const e of armies[o] ?? []){
        if (e.hp<=0) continue;
        const onMe=e.foe===h.id;
        if (!onMe && ((e.x-h.fx)**2+(e.y-h.fy)**2>DEF_REACH*DEF_REACH || owner[tileOf(e.x,e.y)]!==h.o)) continue;
        const s=Math.hypot(e.x-h.x,e.y-h.y)+CROWD*crowdOn(e,h)-(onMe ? 4 : 0);
        if (s<bs || (s===bs && foe && e.id<foe.id)){ bs=s; foe=e; }
      }
    }
  }
  if (foe){ engage(h,foe); h.path=[]; return; }
  h.foe=-1;
  // close by, straight there; further, along a way over his own land (worked out again when his place moves on)
  const d=Math.hypot(h.fx-h.x,h.fy-h.y);
  if (d<=6){ h.path=[]; stepHome(h,h.fx,h.fy,0.3); return; }
  const n=h.path.length;
  if (!n || Math.hypot(h.path[n-2]-h.fx,h.path[n-1]-h.fy)>4) h.path=routeHome(h,h.fx,h.fy);
  if (!h.path.length){ walkToLine(h,h.fx,h.fy); return; }
  if (Math.hypot(h.path[0]-h.x,h.path[1]-h.y)<1.2 && h.path.length>2) h.path.splice(0,2);
  stepHome(h,h.path[0],h.path[1],0);
}
/** A way for h over his own kingdom's land to (gx,gy): waypoints (x,y pairs, pixels) every few tiles,
    ending there; [] if there is none within a margin round the two. */
function routeHome(h: Human, gx: number, gy: number): number[] {
  const o=h.o, s=tileOf(h.x,h.y), g=tileOf(gx,gy), tw=TW, M=24;
  if (owner[g]!==o) return [];
  const x0=Math.max(0,Math.min(s%tw,g%tw)-M), x1=Math.min(tw-1,Math.max(s%tw,g%tw)+M), y0=Math.max(0,Math.min((s/tw)|0,(g/tw)|0)-M), y1=Math.min(TH-1,Math.max((s/tw)|0,(g/tw)|0)+M);
  const stamp=++seenSeq, Q=queue; let head=0, tail=0, found=false;
  seen[g]=stamp; came[g]=-1; Q[tail++]=g;   // from the goal back to him, so the way runs forward along `came`
  while (head<tail && !found){
    const t=Q[head++], x=t%tw, y=(t/tw)|0;
    for (const n of [x>x0 ? t-1 : -1, x<x1 ? t+1 : -1, y>y0 ? t-tw : -1, y<y1 ? t+tw : -1]){
      if (n<0 || seen[n]===stamp || owner[n]!==o) continue;
      seen[n]=stamp; came[n]=t; Q[tail++]=n;
      if (n===s){ found=true; break; }
    }
  }
  if (!found) return [];
  const out: number[]=[];
  for (let t=came[s], k=0; t>=0; t=came[t], k++) if (came[t]<0 || k%3===2) out.push((t%tw)*2+1, ((t/tw)|0)*2+1);
  out.push(gx,gy);
  return out;
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
  if (h.fk>=0){
    const o=offensives.get(h.fk);
    if (o && o.d===h.o && defended[h.o] && h.post<0){ h.calm=1; holdFront(h); return true; }
    h.fk=-1; h.line=-1;   // that front is gone
  }
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
    for the nearest enemy. Beggars always go, but strike no blow: they only stand in the enemy's way,
    to be cut down instead of someone else. After a while with no enemy near, he goes back to work.
    Returns true while he is caught up in it. */
export function alarmStep(h: Human): boolean {
  if (indoors(h) || switching(h)) return false;
  if (!warring[h.o]){ if (h.brave>=0) calmDown(h); return false; }
  if (h.cool>0) h.cool--;
  if ((h.id+W.tickN)%4===0){
    const e=nearestEnemy(h,h.brave===MOB ? MOB_R : DANGER_R);
    if (e){
      h.calm=0;
      if (h.brave<0){
        h.brave = h.beggar || W.prand()<0.5 ? 1 : 0;   // beggars always stand in the way
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
