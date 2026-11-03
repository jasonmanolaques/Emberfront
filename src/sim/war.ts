/* ---------- war: alliances, armies in the field, fighting, and the fall of kingdoms ----------
   Clicking another kingdom opens diplomacy: an alliance, or war. War sends out the armies of
   the kingdom's barracks (sim/army.ts); soldiers without room in a barracks stay home and only defend:
   - an attack needs a shared border (or, by sea, a naval invasion: sim/naval.ts). It begins as a
     crisis, not yet a war: the armies spread out
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
   Two kingdoms are at war while a war between them lasts (a crisis is not a war). An army of more
   than 5 has a leader, ranked by its size when it sets out (RANKS): he stands
   behind his men, fights only whoever comes at him, and his men go first for anyone on him. If he
   falls the army fights on without him.
   At home, the idle soldiers of a kingdom at war that sent no army of its own to the border man its
   side of the front, as evenly, with reserves behind them, taking back any of their land the attacker
   doesn't hold; villagers nearby either run or (half of them) take up arms.
   Once the invaders are gone the guard takes the occupied land back; with all of it back, the army
   reports ready to counter-attack. Guards stay by their watchtowers, and the castle shoots too.
   Everyone heals slowly. Allies open their land to each other's armies. */
import { TW, TH, NT, NP, PW, PH, TICK, GAME_SPEED, WAGE, WAGE_IDLE, WAGE_ATTACK, MIL_WAGE, MIL_ATTACK, B_CASTLE, B_CPART, B_TOWER, B_HOUSE, B_FARM, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_MINE, B_RESEARCH, B_GUILD, B_NAVAL, isStructure } from '../core/constants';
import { W, owner, occ, isLand, isle, sea, pType, pOwner, pBurn, pMain, pHp, pPrio, pCenter, pTier, pIn, type Campaign, type Human, type Nation, type Invasion } from './state';
import { on } from './events';
import { setOwner, occIsleAdd } from './territory';
import { ignite, dims } from './buildings';
import { census } from './census';
import { BLD_HP, bldHp, wear, towerTier, castleTier, TOWER_RELOADS, TOWER_DMGS, CASTLE_MEND, wallOf, wallTower, walledFor, buildWalls, resetWalls } from './defense';
import { SOLDIER_DMG, MILITIA_HIT, units, unitAt, type Unit } from './army';
import { Field } from './field';
import { lineOf, deploy, placeAt, indexAt, holds, enemyOf, underCastle, castleCutOff, type Front } from './front';
import { landingZone, offshore, landingTile, seaPaths, seaNearest, dockTile, shipById, launchShip, recall, navalHooks, basesOf, SHIP_CAP, INV_SAIL, INV_READY, INV_LAND, INV_DONE, SHIP_WAIT, SHIP_BACK } from './naval';
import { H_SOLDIER, TASK_ROAM, TASK_BOAT, TOWER_RANGE, maxHp, REGEN, pace, onCastle, release, backToRoam, frontOf, doorOf, barracksOf, switching, indoors, tileOf, homeMilitia } from './population';

export const MELEE_R = 2.6;           // pixels: close enough to strike
export const HIT_TICKS = 10;          // ticks between blows (one a second)
const DUEL_R = 8;                     // pixels apart a duel holds: further, one has run and it is over
export const HIT_CHANCE = 0.7;
export const HIT_DMG = SOLDIER_DMG;   // a soldier's blow, by tier (soldiers have SOLDIER_HP by tier)
export const MILITIA_DMG = 0.5;       // a villager with a pitchfork does half that
export const BLD_DMG = 1;             // a blow on a building
const GUARD_R = 26, BARRACKS_R = 30, CAPITAL_R = 40;   // pixels around their post soldiers at home defend
export const CASTLE_RANGE = 40;       // the castle shoots further than a watchtower (and twice as often: sim/defense.ts)
const DEFEND_R = 30;                  // pixels around its line the home guard fights
export const DANGER_R = 26;           // pixels: an enemy this close alarms a villager
export const CALM_TICKS = 120;        // ticks without an enemy near before an alarmed villager goes back to work
const ROOM = 2.4;                     // pixels fighters keep between them, so a crowd can't pile onto one spot
const CROWD = 5;                      // a foe already fought by others counts this many pixels further away per fighter
export const CAPTURE_EVERY = 5;       // ticks between a defender's taking back his occupied land about him
const CAPTURE_R = 2;                  // tiles around him
/** The ranks of an army's leader, by the army's size when it set out: none for 5 or fewer. */
export const RANKS = ['', 'Leader', 'General', 'Captain', 'Commander', 'Grand Marshal'];
export const rankFor = (size: number) => size<=5 ? 0 : size<=15 ? 1 : size<=30 ? 2 : size<=50 ? 3 : size<=80 ? 4 : 5;
// an offensive (W.offensive[a*M+d], and the mode of its armies): gathering at the border, ready for
// the word, attacking, or holding where it stands
export const F_GATHER=0, F_READY=1, F_PUSH=2, F_HOLD=3;
const EVAC_TICKS = 600;               // ticks soldiers landed by sea take to come home by ship (1 minute)
const ROW_TICKS = 60;                 // ticks between one row of ships landing and the next
const REFRONT = 5;                    // ticks between working out each front and everyone's place on it
export const ADVANCE_TICKS = 20;      // ticks between strips of ground taken by a front at full strength (2 s: an invasion is slow)
export const INVADE_SLOW = 0.5;              // an army's pace on enemy ground it has not yet occupied
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
let beach = new Uint8Array(NT);   // tiles put ashore from the sea: whose landing they were (they need no land of the invader's beside them)
const scratch = new Field();   // a field for a one-off search
let want = new Int32Array(NT), wantSeq = 0;   // tiles a fill is looking for, stamped wantSeq
let seen = new Int32Array(NT), seenSeq = 0;   // tiles a search has been to, stamped seenSeq
let came = new Int32Array(NT);                 // ...and the tile it came from
/** One kingdom's offensive against another: its attacking armies, all on one front. */
interface Offensive {
  id: number; key: number; a: number; d: number;   // id: this front (the pair's key and the landmass); key: the pair a*M+d, which the war arrays are indexed by
  isle: number;                   // the landmass of d's land this front is on (0: the whole border between them)
  st: number;                     // its state: gathering, ready, attacking or holding (F_*): attacking while an army of its attacks
  F: Front | null;                // the front, worked out every REFRONT ticks
  walk: Field;                    // steps to the men's places, over ground they may cross
  k: number;                      // men in the front rank
  progress: number;               // toward the next strip of ground
  strips: number;                 // strips taken so far
  depth: Field | null;            // how far each tile of the defender's is from the line as the attack began (STEP a tile)
  since: number;                  // tick it began
  noFront: number;                // ticks it has had no front
  liberating: boolean;            // its own land is occupied by the enemy: its armies take it back first, and may not attack
  Fd: Front | null;               // the line its defending armies hold: the edge of the ground no enemy tower reaches (null: the front's own line)
  safeAt: number;                 // tick Fd was worked out
  men: Human[]; atk: Human[]; def: Human[]; camps: Campaign[];   // its men (leaders aside), those of its attacking and of its defending armies, and its armies, this tick
}
const offensives = new Map<number, Offensive>();   // by id
const ofId = (pair: number, isle: number) => pair*65536+isle;
/** The fronts a's offensive against d has (one for each landmass its armies are sent to). */
const frontsOf = (pair: number) => { const out: Offensive[]=[]; for (const o of offensives.values()) if (o.key===pair) out.push(o); return out; };
/** The id (a man's h.fk) of a's front against d on its biggest landmass: the one with most men, else the biggest stretch of border. */
export function frontKey(a: number, d: number){
  let best: Offensive | undefined;
  for (const o of frontsOf(a*W.M+d)) if (!best || o.men.length>best.men.length) best=o;
  return best ? best.id : ofId(a*W.M+d,frontIsles(a,d)[0] ?? 0);
}
/** What soldier h costs a second by what he is doing: idle at home 0.22, on a border (deployed in peace, or defending) 0.3, on the offensive 0.4;
    militia are unpaid until called up, then 0.1 on a border or defending and 0.2 on the offensive. */
export function wageOf(h: Human){
  if (h.kind!==H_SOLDIER) return 0;
  const c=h.war>=0 ? camps.get(h.war) : undefined;
  if (!c) return h.militia ? 0 : WAGE_IDLE;
  if (c.phase===2) return h.militia ? MIL_WAGE : WAGE_IDLE;
  const hit=!!W.wars[c.a*W.M+c.d] && attacks(c);
  return h.militia ? (hit ? MIL_ATTACK : MIL_WAGE) : (hit ? WAGE_ATTACK : WAGE);
}
/** The landmass of the pixel (x,y). */
const tileIsle = (x: number, y: number) => isle[tileOf(x,y)];
/** The ids (men's h.fk) of all the fronts of a's offensive against d. */
export const frontIds = (a: number, d: number) => frontsOf(a*W.M+d).map(o => o.id);
const frontOfC = (c: Campaign) => offensives.get(ofId(c.a*W.M+c.d,c.isle));
/** Tiles of a's land on landmass `isle` that d occupies. */
export const occOn = (a: number, d: number, isle: number) => W.occIsle.get((isle*W.M+a)*W.M+d) ?? 0;
/** Does army c attack (push its front on, or take its kingdom's land back on that landmass) or defend? As it was ordered; else
    the side that began the crisis attacks, and the other defends, but takes back what the enemy holds of its land. */
export const attacks = (c: Campaign) => c.ordered ? c.attack : !!W.aggr[c.a*W.M+c.d] || occOn(c.a,c.d,c.isle)>0;
/** One stretch of border between two kingdoms: its landmass, its length in tiles, and where its middle is (in tiles). */
export interface FrontInfo { isle: number; tiles: number; x: number; y: number; }
const borderCache = new Map<number, { at: number; list: FrontInfo[] }>();
/** Where a and d meet, by landmass: the tiles of d's ground that touch a's (and a's own land that d holds), worked out again every 2 s. Longest first. */
export function frontInfo(a: number, d: number): FrontInfo[] {
  const key=a*W.M+d; let c=borderCache.get(key);
  if (!c || W.tickN<c.at || W.tickN-c.at>=20){
    const by=new Map<number, FrontInfo>(), D=W.nations[d], tw=TW, th=TH;
    const add = (t: number) => { const i=isle[t]; let f=by.get(i); if (!f){ f={ isle:i, tiles:0, x:0, y:0 }; by.set(i,f); } f.tiles++; f.x+=t%tw; f.y+=(t/tw)|0; };
    if (D){
      for (let y=Math.max(0,D.y0);y<=Math.min(th-1,D.y1);y++) for (let x=Math.max(0,D.x0), t=y*tw+x;x<=Math.min(tw-1,D.x1);x++,t++){
        if (owner[t]!==d || !isLand[t]) continue;
        if ((x>0 && owner[t-1]===a) || (x<tw-1 && owner[t+1]===a) || (y>0 && owner[t-tw]===a) || (y<th-1 && owner[t+tw]===a)) add(t);
      }
    }
    // (and the land of a's that d holds, on landmasses where that is all there is)
    for (const [k,v] of W.occIsle){ const b=k%W.M, o=((k/W.M)|0)%W.M, i=(k/(W.M*W.M))|0; if (o===a && b===d && !by.has(i)){ const f: FrontInfo={ isle:i, tiles:v, x:0, y:0 }; by.set(i,f); } }
    const list=[...by.values()].map(f => ({ ...f, x:f.x/Math.max(1,f.tiles), y:f.y/Math.max(1,f.tiles) })).sort((p,q) => q.tiles-p.tiles || p.isle-q.isle);
    c={ at:W.tickN, list }; borderCache.set(key,c);
  }
  return c.list;
}
/** The landmasses a and d meet on, longest border first. */
export const frontIsles = (a: number, d: number) => frontInfo(a,d).map(f => f.isle);
let defended = new Uint8Array(1);              // per nation: some offensive against it has a front its guard stands on
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

export function resetWar(M: number){
  W.campaigns=[]; W.campSeq=0;
  W.ally=new Uint8Array(M*M); W.atWar=new Uint8Array(M*M); W.offers=new Int32Array(M*M); W.grudge=new Int32Array(M*M).fill(-1e9);
  W.wars=new Uint8Array(M*M); W.aggr=new Uint8Array(M*M); W.warSince=new Int32Array(M*M); W.occCount=new Int32Array(M*M); W.lost=new Uint8Array(M*M); W.ready=new Int32Array(M*M); W.offensive=new Uint8Array(M*M); W.stance=new Uint8Array(M*M); W.kills=new Int32Array(M*M); W.stall=new Int32Array(M*M); W.lastNet=new Int32Array(M*M);
  if (queue.length!==NT){ heldAt=new Int32Array(NT); heldBy=new Uint8Array(NT); queue=new Int32Array(NT); want=new Int32Array(NT); wantSeq=0; seen=new Int32Array(NT); seenSeq=0; came=new Int32Array(NT); }   // the map changed size
  byId.clear(); camps.clear(); troops.clear(); armies=[]; posts=[]; warring=new Uint8Array(M); rallies=[]; homeField=[]; homeFieldFor=[]; heldAt.fill(0); resetWalls();
  offensives.clear(); dockQ.clear(); lanes.clear(); lanesAt.clear(); defended=new Uint8Array(M); massCache=new Map(); borderCache.clear(); W.occIsle=new Map(); W.crisisAt=new Int32Array(M*M);
  if (beach.length!==NT) beach=new Uint8Array(NT); else beach.fill(0);
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

/** Is kingdom o at war (or a party to one)? Its militia stand out of their houses while it is. */
export const warringNow = (o: number) => warring[o]===1;

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


/* ---------- declaring war ---------- */
/** Is campaign c not committed to an aggression: out on a border (deployed in peace, or standing against someone else's crisis), not in a war
    and not part of a crisis its kingdom began? Its men may be sent elsewhere. */
export const freeArmy = (c: Campaign) => c.front && c.phase===1 && c.naval<0 && c.hostile && !W.wars[c.a*W.M+c.d] && !W.aggr[c.a*W.M+c.d];
/** n's armies ready to march: each barracks with the soldiers of its army who are at home. With `free`, armies out on a border
    but not committed (freeArmy) are listed too, with their men and the campaign (`out`) they would be taken from. */
export function available(n: Nation, free=false){
  const out: { unit: Unit; men: Human[]; out?: Campaign }[]=[];
  for (const u of units[n.id] ?? []){
    const c=free ? W.campaigns.find(k => k.a===n.id && k.unit===u.key && !k.militia && freeArmy(k)) : undefined;
    const men=(c ? u.members.filter(h => h.war===c.id) : u.members.filter(h => h.war<0 && !switching(h))).filter(h => h.hp>0).sort((x,y)=>x.id-y.id);
    if (men.length) out.push(c ? { unit:u, men, out:c } : { unit:u, men });
  }
  return out;
}
/** How many of n's soldiers could march right now. */
export const ready = (n: Nation) => available(n).reduce((k,a) => k+a.men.length, 0);
/** An army taken off its border: its men are free, where they stand (to be sent somewhere else at once). */
function unhitch(c: Campaign){
  for (const id of c.members){ const h=byId.get(id) ?? W.humans.find(k => k.id===id); if (h){ h.war=-1; h.foe=-1; h.aim=-1; h.fk=-1; h.line=-1; unlead(h); } }
  const i=W.campaigns.indexOf(c); if (i>=0) W.campaigns.splice(i,1);
  camps.delete(c.id); troops.delete(c.id);
}
/** The armies to send: the barracks named (any plot of each, and those out on a border but not committed), or, for a number, the biggest armies
    first until that many soldiers are found (the last one sending only as many as are missing). */
function pickArmies(n: Nation, pick: number | number[]){
  const all=available(n,Array.isArray(pick));
  if (Array.isArray(pick)){ const want=new Set(pick.map(q => unitAt(q)?.key)); return all.filter(a => want.has(a.unit.key)); }
  all.sort((a,b) => b.men.length-a.men.length || a.unit.key-b.unit.key);
  const out: typeof all=[]; let left=Math.floor(pick);
  for (const a of all){ if (left<=0) break; const men=a.men.slice(0,left); left-=men.length; out.push({ unit:a.unit, men }); }
  return out;
}
/** Why a can't go to war on d this way, or null if it can. */
export function warProblem(a: number, d: number): string | null {
  const A=W.nations[a], D=W.nations[d];
  if (!A?.alive || !D?.alive || !d || a===d) return 'That kingdom is gone';
  if (!W.contact[a*W.M+d]) return 'Needs a shared border';
  return null;
}

/** Seconds on the clock (30) a crisis must run before the word to attack can be given: time for both sides to react, and to call it off. */
export const CRISIS_TICKS = 30*GAME_SPEED*10;
/** Ticks left before a's crisis with d may become a war (0 once it may). */
export const crisisWait = (a: number, d: number) => Math.max(0,CRISIS_TICKS-(W.tickN-W.crisisAt[a*W.M+d]));
/** Sends a's armies to d's border (landmass `isle`, 0 for the whole of it): the barracks named, or armies enough for `pick`
    soldiers, and `militia` of its militia at home (the nearest the castle first) as one band of their own. Each army
    marches on its own; one already out against d stays where it is. Returns how many armies were sent (an army already there counts as none). */
function sendArmies(a: number, d: number, pick: number | number[], militia: number, isle: number, counter: boolean){
  const A=W.nations[a], D=W.nations[d];
  let sent=0;
  isle=isle || (frontIsles(a,d)[0] ?? 0);
  for (const { unit, men, out } of pickArmies(A,pick)){
    if (onFront(a,d,unit.key)) continue;   // its army is there already: its men join it (reinforce)
    if (isle && !crossable(a,tileIsle(unit.x,unit.y),isle)) continue;
    if (out) unhitch(out);   // (out on another border: it comes away)   // (its front is across the sea, with no naval base to sail from)
    const c=newCampaign(a,d,men.length,D.tiles,unit.key,isle);
    c.inspired=counter;
    if (muster(c,men,unit)) sent++;
  }
  const mil=militiaFor(a,militia);
  if (mil.length){
    const out=reservesOf(a,d);
    if (out) for (const h of mil) enlist(out,h,1e5);   // more of them, to the militia already on that front
    else {
      const c=newCampaign(a,d,mil.length,D.tiles,-1,isle);
      c.militia=true; c.inspired=counter;
      if (muster(c,mil)) sent++;
    }
    if (out) sent++;
  }
  return sent;
}
/** Is any army of a out against d (on a border, or on its way, in peace or crisis or war)? */
export const hasArmies = (a: number, d: number) => W.campaigns.some(c => c.front && c.a===a && c.d===d && c.phase<2 && c.hostile);
/** a's armies chosen (and those it has deployed on d's border already) begin a crisis with d: the armies mass on the border
    and nobody fights until a gives the word, CRISIS_TICKS later at the soonest (escalate). Armies already deployed there
    stay where they are, and only the further ones chosen march. Returns false if there is nothing to send and nothing deployed. */
export function declare(a: number, d: number, pick: number | number[], militia=0, isle=0){
  if (warProblem(a,d)) return false;
  const M=W.M, counter=W.ready[a*M+d]>0;   // our land is back: this one is for revenge
  const sent=sendArmies(a,d,pick,militia,isle,counter);
  if (!sent && !hasArmies(a,d)) return false;
  return begin(a,d,counter);
}
/** The diplomacy of an attack beginning, with its armies out: alliance broken, a grudge, a crisis (or, in a war already, more armies). */
function begin(a: number, d: number, counter: boolean){
  const M=W.M, first=W.campaigns.find(c => c.front && c.a===a && c.d===d && c.phase<2);
  if (allied(a,d)){ W.ally[a*M+d]=W.ally[d*M+a]=0; on.allianceBroken(a,d); }
  W.grudge[d*M+a]=W.tickN;
  if (counter && first) on.story('revenge',a,first.bx,first.by,d);
  W.ready[a*M+d]=0;   // the counter-attack it was ready for is under way
  const crisis=!W.wars[a*M+d] && !W.aggr[a*M+d];
  if (crisis){
    W.aggr[a*M+d]=1; W.crisisAt[a*M+d]=W.tickN;
    on.crisis(a,d); return true;
  }
  W.aggr[a*M+d]=1;
  W.atWar[a*M+d]=W.atWar[d*M+a]=1;
  on.warBegan(a,d);
  return true;
}
/** Puts a's armies on d's border in peace, as a precaution: they gather there, not a crisis, and ready to be there if one begins
    (a crisis started with them needs no march, and calling it off leaves them in place). Returns how many armies were sent. */
export function deployArmies(a: number, d: number, pick: number | number[], militia=0, isle=0){
  if (warProblem(a,d)) return 0;
  const sent=sendArmies(a,d,pick,militia,isle,false);
  if (!sent) return 0;
  for (const c of W.campaigns) if (c.front && c.a===a && c.d===d && c.phase<2 && c.naval<0 && !c.deployed && W.tickN-c.started<=1 && !W.aggr[a*W.M+d] && !W.wars[a*W.M+d]) c.deployed=true;
  if (W.wars[a*W.M+d]) W.atWar[a*W.M+d]=W.atWar[d*W.M+a]=1;
  return sent;
}
/** A crisis with nothing left of it (every army that massed is gone, and no landing is under way) is over. */
function endDeadCrises(){
  const M=W.M;
  for (let a=1;a<M;a++) for (let d=1;d<M;d++){
    const k=a*M+d; if (!W.aggr[k] || W.wars[k]) continue;
    if (W.campaigns.some(c => c.front && c.a===a && c.d===d && c.phase<2) || W.invasions.some(i => i.a===a && i.d===d && i.stage<INV_DONE)) continue;
    W.aggr[k]=0; W.crisisAt[k]=0;
  }
}
/** Is a's attack on d still a crisis: massed on the border, but not yet at war? */
export const inCrisis = (a: number, d: number) => !!W.aggr[a*W.M+d] && !W.wars[a*W.M+d];
/** a gives the word on its crisis with d: it is war. Each of a's armies on d's border attacks or defends as it was ordered
    (an attacker's attack, unless told otherwise); d's armies there defend, unless told otherwise. Not before the crisis has run
    CRISIS_TICKS (`force`: the tests, which have no time to wait). */
export function escalate(a: number, d: number, force=false){
  const M=W.M; if (!inCrisis(a,d)) return false;
  if (!force && crisisWait(a,d)>0) return false;
  W.wars[a*M+d]=W.wars[d*M+a]=1; W.warSince[a*M+d]=W.warSince[d*M+a]=W.tickN;
  W.atWar[a*M+d]=W.atWar[d*M+a]=1; W.crisisAt[a*M+d]=0;
  for (const i of [a*M+d, d*M+a]){ W.kills[i]=0; W.stall[i]=0; W.lastNet[i]=0; }   // this war's dead and its border, counted afresh
  for (const k of [a*M+d, d*M+a]) for (const o of frontsOf(k)) o.F=null;   // (every front is laid out again: its armies attack or defend)
  on.escalated(a,d);
  return true;
}
/** Why a can't call off its crisis with d, or null. */
export const deescalateProblem = (a: number, d: number) => inCrisis(a,d) ? null : W.wars[a*W.M+d] ? 'It is war: only peace ends it now' : 'No crisis to call off';
/** a calls off its crisis with d: its armies go home (those it had deployed on the border in peace stay there), and so do those
    d sent to the border against them (unless d has massed an attack of its own). */
export function deescalate(a: number, d: number){
  if (deescalateProblem(a,d)) return false;
  const M=W.M;
  W.aggr[a*M+d]=0; W.crisisAt[a*M+d]=0;
  for (const c of W.campaigns){
    if (c.phase===2 || !c.front) continue;
    if (c.deployed && c.a===a && c.d===d) continue;
    if ((c.a===a && c.d===d) || (c.a===d && c.d===a && !W.aggr[d*M+a])) sendHome(c,'calm',false);
  }
  on.deescalated(a,d);
  return true;
}


/* ---------- convoys ----------
   An army whose front is on another landmass than its men (a colony across the sea) is carried over: the men walk to a naval
   base of their kingdom on their own landmass and wait at its door; a transport of the fleet sails only when it is full (5 men),
   to a coast of the kingdom's on the front's landmass, and puts them ashore there to march to the front. Reinforcements go the same way. */
const dockQ = new Map<number, number[]>();   // naval base -> the soldiers waiting at its door for a ship
interface Lane { base: number; path: number[]; land: number; at: number; }
const lanes = new Map<number, Lane | null>();   // by (army, landmass its men are on): the way over, worked out again every 10 seconds
const LANE_EVERY = 100;
/** The own land beside water tile t on landmass `on`, or -1. */
function landBeside(a: number, on: number, t: number){
  const x=t%TW;
  for (const n of [x>0 ? t-1 : -1, x<TW-1 ? t+1 : -1, t>=TW ? t-TW : -1, t<NT-TW ? t+TW : -1]) if (n>=0 && isLand[n] && owner[n]===a && !occ[n] && isle[n]===on) return n;
  return -1;
}
/** Where soldiers wait for a ship at naval base q: the land of its kingdom nearest its dock (pixels), and the landmass that is on. */
function baseSpot(q: number): { x: number; y: number; isle: number } {
  const dk=dockTile(q), o=pOwner[q];
  if (dk<0) return { x:0, y:0, isle:0 };
  const cx=dk%TW, cy=(dk/TW)|0; let best=-1, bd=Infinity;
  for (let y=Math.max(0,cy-10);y<=Math.min(TH-1,cy+10);y++) for (let x=Math.max(0,cx-10);x<=Math.min(TW-1,cx+10);x++){
    const t=y*TW+x; if (!isLand[t] || owner[t]!==o) continue;
    const d=(x-cx)**2+(y-cy)**2; if (d<bd){ bd=d; best=t; }
  }
  return best<0 ? { x:0, y:0, isle:0 } : { x:(best%TW)*2+1, y:((best/TW)|0)*2+1, isle:isle[best] };
}
/** The way for a's men on landmass `from` to cross to its own coast on landmass `to`: from the nearest of its naval bases there; or null. */
function laneBetween(a: number, from: number, to: number): Lane | null {
  let best: Lane | null=null;
  for (const q of basesOf(W.nations[a])){
    if (baseSpot(q).isle!==from) continue;
    const dk=dockTile(q); if (dk<0) continue;
    const r=seaNearest(dk,t => landBeside(a,to,t)>=0,60000);
    if (r && (!best || r.path.length<best.path.length)) best={ base:q, path:r.path, land:landBeside(a,to,r.tile), at:W.tickN };
  }
  return best;
}
const lanesAt = new Map<number, number>();
const laneFor = (c: Campaign, from: number) => {
  const k=c.id*65536+from, at=lanesAt.get(k) ?? -1e9;
  if (W.tickN-at>=(lanes.get(k) ? LANE_EVERY*30 : LANE_EVERY)){ lanes.set(k,laneBetween(c.a,from,c.isle)); lanesAt.set(k,W.tickN); }
  return lanes.get(k) ?? null;
};
/** Can a's men on landmass `from` get to its front on landmass `to` (the same one, or across the sea from a naval base)? */
export const crossable = (a: number, from: number, to: number) => from===to || !!laneBetween(a,from,to);
/** A man whose army's front is on another landmass: he goes to the naval base's door and waits there for a ship. True while he is at it. */
function ferryMan(h: Human, c: Campaign){
  const lane=laneFor(c,isle[tileOf(h.x,h.y)]); if (!lane) return false;
  const { x:dx, y:dy }=baseSpot(lane.base);
  if ((h.x-dx)**2+(h.y-dy)**2>36){ stepHome(h,dx,dy,2); return true; }
  let q=dockQ.get(lane.base); if (!q){ q=[]; dockQ.set(lane.base,q); }
  if (!q.includes(h.id)) q.push(h.id);
  return true;
}
/** Transports sail when full, and put their men ashore on arrival; one whose army is gone turns back. */
function ferryShips(){
  for (const [base,ids] of [...dockQ]){
    const buckets=new Map<number, Human[]>(), spot=baseSpot(base);   // the waiting, by landmass they cross to
    const stay: number[]=[];
    for (const id of ids){
      const h=byId.get(id), c=h && camps.get(h.war);
      if (!h || h.hp<=0 || !c || c.phase!==1 || h.boat>=0 || h.task===TASK_BOAT || (h.x-spot.x)**2+(h.y-spot.y)**2>64) continue;
      stay.push(id);
      let L=buckets.get(c.isle); if (!L){ L=[]; buckets.set(c.isle,L); } L.push(h);
    }
    const A=W.nations[pOwner[base]];
    for (const [to,men] of buckets){
      while (men.length>=SHIP_CAP && A?.alive && A.fleet>0){
        const crew=men.splice(0,SHIP_CAP), c=camps.get(crew[0].war)!, lane=laneFor(c,spot.isle);
        if (!lane || lane.base!==base) break;
        A.fleet--;
        const s=launchShip(A.id,base,lane.path,{ fleet:true, convoy:c.id, lands:lane.land });
        for (const h of crew){ h.boat=s.id; h.task=TASK_BOAT; h.x=s.x; h.y=s.y; h.fx=h.x; h.fy=h.y; s.crew++; stay.splice(stay.indexOf(h.id),1); }
      }
    }
    if (stay.length) dockQ.set(base,stay); else dockQ.delete(base);
  }
  for (const s of W.ships){
    if (s.convoy<0 || s.mode===SHIP_BACK) continue;
    const c=camps.get(s.convoy);
    if (!c || c.phase!==1){ recall(s); continue; }   // the army was called off: the men sail home
    if (s.mode!==SHIP_WAIT) continue;
    const t=s.lands, bx=(t%TW)*2+1, by=((t/TW)|0)*2+1;
    for (const h of W.humans) if (h.boat===s.id){ h.x=bx+(h.id%5)-2; h.y=by+((h.id>>3)%3)-1; h.boat=-1; h.task=TASK_ROAM; h.fk=-1; h.line=-1; h.path=[]; }
    s.crew=0; recall(s);
  }
}

/* ---------- naval invasions ----------
   An army put ashore from the sea: the barracks chosen, a naval base, and a stretch of the enemy's
   coast. The ships of the fleet (5 soldiers each) sail from the base to a line off that coast and wait
   there, the armies aboard: it is a crisis (the defender may send its own armies to the landing zone),
   until the word; then the zone is occupied, the ships land row after row (as many to a row as the
   coast has room for) and sail home, to count again when they dock. Landing on a coast the invader
   already holds needs no word and has no defender. An army put ashore is never reinforced. */
/** The landing a has planned against d that has not yet put its men ashore. */
export const navalOf = (a: number, d: number) => W.invasions.find(i => i.a===a && i.d===d && i.stage<INV_LAND);
/** Is a landing from the sea coming at d from a (to a coast it does not hold)? */
export const landingOn = (a: number, d: number) => W.invasions.some(i => i.a===a && i.d===d && i.stage<INV_LAND && !i.safe);
/** Where armies could land: the zone for `men` on d's coast near tile `coastTile`, from naval base `base`, and the ships it takes; or why not. */
export function navalPlan(a: number, d: number, pick: number | number[], base: number, coastTile: number){
  const A=W.nations[a], D=W.nations[d];
  if (!A?.alive || !D?.alive || !d || a===d) return 'That kingdom is gone';
  if (pType[base]!==B_NAVAL || pOwner[base]!==a || pBurn[base]>0) return 'Choose one of your naval bases';
  const picked=pickArmies(A,pick).filter(p => !onFront(a,d,p.unit.key));
  const men=picked.reduce((k,p) => k+p.men.length,0);
  if (!men) return 'Choose who to send';
  const dock=dockTile(base); if (dock<0) return 'That base has no water';
  const zone=landingZone(a,d,coastTile,men,sea[dock]);
  if (!zone) return 'No coast of theirs there that your ships can reach';
  const ships=zone.rows.reduce((k,r) => k+r,0);
  if (A.fleet<ships) return `That needs ${ships} ship${ships===1 ? '' : 's'}: you have ${A.fleet} ready`;
  return { zone, picked, men, ships };
}
/** a sends the armies chosen by sea against d: ships from naval base `base` carry them to d's coast near `coastTile`. */
export function declareNaval(a: number, d: number, pick: number | number[], base: number, coastTile: number){
  const plan=navalPlan(a,d,pick,base,coastTile); if (typeof plan==='string') return false;
  const { zone:z, picked, ships }=plan, A=W.nations[a], D=W.nations[d], M=W.M;
  // the ships' stations: a row off the coast for each row of ships
  const dock=dockTile(base), targets: { row: number; slot: number; tile: number }[]=[];
  z.rows.forEach((count,row) => { for (let slot=0;slot<count;slot++) targets.push({ row, slot, tile:offshore(z,row,slot,count) }); });
  const paths=seaPaths(dock,targets.map(t => t.tile));
  if (targets.some(t => !paths.get(t.tile))) return false;
  const inv: Invasion={ id:++W.invSeq, a, d, base, ships:[], camps:[], zone:z.zone, coast:z.coast, rows:z.rows, stage:INV_SAIL, safe:z.safe, landAt:0, row:0 };
  const counter=W.ready[a*M+d]>0, crew: Human[]=[];
  for (const { unit, men } of picked){
    const c=newCampaign(a,d,men.length,D.tiles,unit.key,isle[z.coast[0]] ?? 0);
    c.naval=inv.id; c.inspired=counter;
    if (muster(c,men,unit)){ inv.camps.push(c.id); crew.push(...men); }
  }
  if (!crew.length) return false;
  A.fleet-=ships;
  const boats=targets.map(t => { const s=launchShip(a,base,paths.get(t.tile)!,{ inv:inv.id, row:t.row, slot:t.slot, fleet:true }); inv.ships.push(s.id); return s; });
  crew.forEach((h,i) => { const s=boats[Math.min(boats.length-1,(i/SHIP_CAP)|0)]; h.boat=s.id; h.task=TASK_BOAT; h.x=s.x; h.y=s.y; h.fx=h.x; h.fy=h.y; s.crew++; });
  W.invasions.push(inv);
  if (allied(a,d)){ W.ally[a*M+d]=W.ally[d*M+a]=0; on.allianceBroken(a,d); }
  W.grudge[d*M+a]=W.tickN; W.ready[a*M+d]=0;
  const crisis=!W.wars[a*M+d] && !W.aggr[a*M+d];
  W.aggr[a*M+d]=1; if (crisis) W.crisisAt[a*M+d]=W.tickN;
  on.invasionSails(a,d,ships);
  if (crisis){ on.crisis(a,d); return true; }
  W.atWar[a*M+d]=W.atWar[d*M+a]=1;
  on.warBegan(a,d);
  return true;
}
/** A soldier at sea: he rides with his ship, and when it has gone (or he is sent home from the beach) comes home by the capital's gate. */
function boatStep(h: Human){
  if (h.boat>=0){ const s=shipById(h.boat); if (s){ h.x=s.x; h.y=s.y; return; } h.boat=-2; h.wait=1; }
  if (--h.wait>0) return;
  const n=W.nations[h.o];
  if (n.capTile>=0){ const [x,y]=doorOf(n); h.x=x+(h.id%5)-2; h.y=y+1; }
  h.boat=-1; comeHome(h);
}
navalHooks.docked = (s) => {
  for (const h of W.humans) if (h.boat===s.id){ const [x,y]=frontOf(s.base); h.x=x+(h.id%5)-2; h.y=y+1; h.boat=-1; comeHome(h); }   // home from a called-off crisis: ashore at the base
};
/** The invasions, each tick: the ships' arrival, the word, the landing row by row, and the end. */
function stepInvasions(){
  const M=W.M;
  for (let i=W.invasions.length-1;i>=0;i--){
    const inv=W.invasions[i], A=W.nations[inv.a], D=W.nations[inv.d];
    const ships=inv.ships.map(shipById).filter((s): s is NonNullable<typeof s> => !!s);
    const camps_=inv.camps.map(id => camps.get(id)).filter((c): c is Campaign => !!c && c.phase<2);
    if (inv.stage<INV_LAND){
      // the whole thing is off: the attacker or the defender fell, or every army was called home
      if (!A.alive || !D.alive || !camps_.length){ for (const s of ships) recall(s); inv.stage=INV_DONE; }
      else if (inv.stage===INV_SAIL && ships.length && ships.every(s => s.mode===SHIP_WAIT)){
        inv.stage=INV_READY;
        for (const c of camps_) tell(c,'ready');
      }
      // the word (or a coast already ours, or a war already on): ashore
      if (inv.stage===INV_READY && W.wars[inv.a*M+inv.d]){ inv.stage=INV_LAND; inv.landAt=W.tickN; inv.row=0; }
    }
    if (inv.stage===INV_LAND && W.tickN>=inv.landAt){
      landRow(inv,inv.row);
      inv.row++; inv.landAt=W.tickN+ROW_TICKS;
      if (inv.row>=inv.rows.length) inv.stage=INV_DONE;
    }
    if (inv.stage===INV_DONE && !ships.length) W.invasions.splice(i,1);
  }
}
/** Row `row` of invasion inv goes ashore: the first row takes the landing zone (occupying it), each ship puts its
    men on the coast before it, and sails home. */
function landRow(inv: Invasion, row: number){
  const a=inv.a, d=inv.d;
  if (row===0){
    for (const t of inv.zone) if (owner[t]===d && occ[t]!==a && !underCastle(d,t)){ occupy(t,a); beach[t]=a; }
    for (const id of inv.camps){ const c=camps.get(id); if (c && c.phase<2){ c.mode=W.offensive[a*W.M+d]; tell(c,'assault'); } }
  }
  const count=inv.rows[row] ?? 1;
  for (const id of inv.ships){
    const s=shipById(id); if (!s || s.row!==row || s.mode===2) continue;
    const t=inv.coast[Math.min(inv.coast.length-1,Math.floor((s.slot+0.5)*inv.coast.length/count))];
    for (const h of W.humans) if (h.boat===s.id){
      h.boat=-1; h.task=TASK_ROAM; h.path=[]; h.wait=0; h.foe=-1; h.aim=-1; h.fk=-1; h.line=-1;
      h.x=(t%TW)*2+1+((h.id*7)%5-2)*0.35; h.y=((t/TW)|0)*2+1+((h.id*3)%5-2)*0.35; h.fx=h.x; h.fy=h.y;
    }
    s.crew=0; recall(s);
  }
}

/** Is the army of barracks `unit` out on a's front against d? */
const onFront = (a: number, d: number, unit: number) => W.campaigns.some(c => c.front && c.naval<0 && c.a===a && c.d===d && c.unit===unit && c.phase<2);   // (an army put ashore by ships is never reinforced: the barracks' new soldiers may go again)
/** Men of a's armies on its front against d (leaders and militia called up too). */
export function menOn(a: number, d: number){ let k=0; for (const c of W.campaigns) if (c.front && c.a===a && c.d===d && c.phase<2) k+=c.members.length; return k; }
/** Why n can't send armies to stand on its side of the border with o, or null. */
export function defendProblem(n: number, o: number): string | null {
  const M=W.M, N=W.nations[n], O=W.nations[o];
  if (!N?.alive || !O?.alive || !o || n===o) return 'That kingdom is gone';
  if (!W.wars[n*M+o] && !W.aggr[o*M+n]) return 'They are not massing against you';
  if (!W.contact[n*M+o] && !landingOn(o,n) && !(W.occCount[n*M+o]>0)) return 'Needs a shared border';   // (a landing from the sea, or land of ours they hold, will do)
  if (!ready(N) && !available(N,true).some(a => a.out)) return 'No soldiers in your barracks';
  return null;
}
/** n sends its armies (the barracks named, or enough for `pick` soldiers) to stand on its side of
    the border with o: in a crisis they hold it, not fighting unless it comes to war; at war they make
    a front of its own, which can hold or attack. Returns false if none could go. */
export function defend(n: number, o: number, pick: number | number[], isle=0){
  if (defendProblem(n,o)) return false;
  let sent=0;
  for (const { unit, men, out } of pickArmies(W.nations[n],pick)){
    if (onFront(n,o,unit.key)) continue;   // its army is there already: its men join it (reinforce)
    if (out) unhitch(out);
    const c=newCampaign(n,o,men.length,W.nations[o].tiles,unit.key,isle);
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
let ccAt=-1, ccFor=0, ccN=0;
/** How many militia n has at home (for the screen: counted once a tick, however often it is asked). */
export function callableCount(n: number){
  if (ccAt!==W.tickN || ccFor!==n){ ccAt=W.tickN; ccFor=n; ccN=callable(n).length; }
  return ccN;
}
/** The k of n's militia at home nearest its castle, to send with an attack. */
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
    const c=newCampaign(n,o,men.length,W.nations[o].tiles,-1);
    c.militia=true; c.all=true;
    muster(c,men);
  }
  if (W.wars[n*W.M+o]) W.atWar[n*W.M+o]=W.atWar[o*W.M+n]=1;
  on.reserves(n,o,men.length,true);
  return true;
}
function newCampaign(a: number, d: number, size: number, tiles: number, unit: number, isle=0): Campaign {
  if (!isle) isle=frontIsles(a,d)[0] ?? 0;   // (the biggest stretch of border they share)
  return { id:++W.campSeq, a, d, hostile:true, front:true, militia:false, all:false, members:[], phase:0, bx:0, by:0, dx:1, dy:0, rx:0, ry:0, goal:-1,
    field:offensiveOf(a,d,isle).walk, fieldAt:W.tickN, started:W.tickN, startSoldiers:size, startTiles:tiles, stall:0, why:'', unit, inspired:false, leader:-1, rank:0,
    mode:W.offensive[a*W.M+d], naval:-1, isle, attack:true, ordered:false, deployed:false, placed:0, waiting:[], hitAt:-1e9 };
}
/** The offensive of a against d on landmass `isle` (0: the whole border), begun (gathering at the border) if there was none. */
function offensiveOf(a: number, d: number, isle=0){
  const key=a*W.M+d, id=ofId(key,isle);
  let o=offensives.get(id);
  if (!o){
    if (!frontsOf(key).length) W.offensive[key]=F_GATHER;
    o={ id, key, a, d, isle, st:W.offensive[key], F:null, walk:new Field(), k:0, progress:0, strips:0, depth:null, since:W.tickN, noFront:0, liberating:false, Fd:null, safeAt:-1e9, men:[], atk:[], def:[], camps:[] };
    offensives.set(id,o);
  }
  return o;
}
/** An army's men set off for the front at once (its way there is its offensive's). */
function muster(c: Campaign, pool: Human[], u?: Unit){
  const A=W.nations[c.a];
  if (A.capTile>=0){ const [x,y]=doorOf(A); c.bx=x; c.by=y; }
  if (u){ c.bx=u.x; c.by=u.y; }
  c.rx=c.bx; c.ry=c.by; c.phase=1;
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

/** Turns the army for home: recalled, cut off, at peace, or with its work done. */
function sendHome(c: Campaign, why: string, hostile=c.hostile){
  c.hostile=c.hostile && hostile;
  if (c.phase===2) return;
  c.phase=2; c.why=why;
  for (const id of c.members){ const h=byId.get(id); if (h){ h.foe=-1; h.aim=-1; h.fk=-1; h.line=-1; if (c.naval>=0 && h.boat<0 && h.task!==TASK_BOAT){ h.task=TASK_BOAT; h.boat=-2; h.wait=EVAC_TICKS; } } }   // (men landed from ships go home by sea: out of sight until they are)
  if (c.front) c.field=new Field();   // (it shared its offensive's way to the front)
  refield(c);
  on.armyHome(c.a,c.d,why);
}
function refield(c: Campaign){
  c.fieldAt=W.tickN;
  if (c.phase===2){
    const A=W.nations[c.a], src: number[]=[];
    for (let y=Math.max(0,A.y0);y<=Math.min(TH-1,A.y1);y++) for (let t=y*TW+Math.max(0,A.x0), e=y*TW+Math.min(TW-1,A.x1);t<=e;t++) if (owner[t]===c.a) src.push(t);   // (its land lies in its box)
    fillOrBreach(c.field,src,c.a,c.d,true,armyTiles(c,false),false,12,(b) => b>=0); return;
  }
  // (on the way to the front, its offensive works out the way)
}

/* ---------- peace and alliances ---------- */
/** Kingdom `from` asks `to` for peace. Bots answer when they next think; the player from the war chip. */
export function offerPeace(from: number, to: number){
  if (!W.wars[from*W.M+to] || W.offers[from*W.M+to]) return;
  W.offers[from*W.M+to]=W.tickN; on.peaceOffered(from,to);
}
export function refusePeace(from: number, to: number){ W.offers[from*W.M+to]=0; on.peaceRefused(from,to); }
export function makePeace(a: number, b: number){
  const M=W.M;
  for (const c of W.campaigns) if ((c.a===a && c.d===b) || (c.a===b && c.d===a)) sendHome(c,'peace',false);
  // each side keeps the land it occupies that joins on to its own; pockets cut off inside the other's
  // borders go back to their owner, so the new border has no islands in it
  giveRoom(a,b); giveRoom(b,a);
  cede(a,b); cede(b,a);
  for (const i of [a*M+b, b*M+a]){ W.offers[i]=0; W.atWar[i]=0; W.wars[i]=0; W.aggr[i]=0; W.stall[i]=0; W.lost[i]=0; W.ready[i]=0; }
  on.peaceMade(a,b);
}
/** A kingdom whose castle stands cut off, with all the ground round it occupied by the other side, gets
    room to rebuild when peace is made: whatever of its land that side holds within CAPITAL_ROOM tiles of the castle goes back. */
export const CAPITAL_ROOM = 16;
function giveRoom(o: number, d: number){
  const D=W.nations[d]; if (!D.alive || D.capTile<0 || !castleCutOff(d)) return;
  const cx=(D.capPlot%PW)*4+4, cy=((D.capPlot/PW)|0)*4+4, R=CAPITAL_ROOM+4;
  for (let y=Math.max(0,cy-R);y<=Math.min(TH-1,cy+R);y++) for (let x=Math.max(0,cx-R);x<=Math.min(TW-1,cx+R);x++){
    const t=y*TW+x;
    if (owner[t]===d && occ[t]===o && (x+0.5-cx)**2+(y+0.5-cy)**2<=R*R) liberate(t);
  }
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
/** n wants the fighting with t to end: a war gets a peace offer. */
export function endWar(n: number, t: number){
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
    release(h); h.o=winner; h.post=-1; h.site=-1; h.war=-1; h.boat=-1; h.foe=-1; h.aim=-1; h.brave=-1; h.calm=0; h.work=-1;
    h.task=TASK_ROAM; h.path=[]; h.wait=0; h.tx=h.x; h.ty=h.y;
  }
  // buildings change hands before the ground does, so they don't burn
  for (let q=0;q<NP;q++){
    if (pOwner[q]!==loser) continue;
    if (pType[q]===B_CASTLE || pType[q]===B_CPART) continue;
    if (isStructure(pType[q])){ pOwner[q]=winner; pPrio[q]=0; on.plotChanged(q); }
  }
  if (cap>=0) for (const k of [cap,cap+1,cap+PW,cap+PW+1]) ignite(k);
  // the loser's armies scatter, and its ships and landings with them; armies sent against it turn for home
  W.campaigns=W.campaigns.filter(c => c.a!==loser);
  W.ships=W.ships.filter(s => s.o!==loser); W.invasions=W.invasions.filter(i => i.a!==loser);
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

function runCampaign(c: Campaign, men: Human[]){
  if (!men.length){
    // an attack's army lives on while its war does and its barracks stands: every man the barracks raises joins it at the front
    if (c.phase<2 && c.naval<0 && W.wars[c.a*W.M+c.d] && W.nations[c.d].alive && unitAt(c.unit)?.o===c.a){ if (c.leader>=0) leaderGone(c); c.members=[]; return; }
    if (c.leader>=0) leaderGone(c);
    W.campaigns.splice(W.campaigns.indexOf(c),1); camps.delete(c.id); on.armyGone(c.a,c.d,c.phase===2 ? c.why : 'lost'); return;
  }
  // (on a front, its offensive places the men)
  c.members=men.map(h => h.id);
  if (c.leader>=0 && !men.some(h => h.id===c.leader)) leaderGone(c);
  if (c.phase<2 && !W.nations[c.d].alive){ sendHome(c,'won',false); return; }
  if (c.phase===2 && W.tickN-c.fieldAt>=REFIELD) refield(c);
}
/** Army c's leader gives an order aloud (an army without one: from its banner). */
function tell(c: Campaign, kind: string){
  const l=byId.get(c.leader);
  if (l) on.order(kind,c.a,c.d,c.rank,l.id,l.x,l.y); else on.order(kind,c.a,c.d,0,-1,c.bx,c.by);
}

/* ---------- the word: attack, or hold ---------- */
/** a's armies on d's border (all landmasses). */
const armiesOn = (a: number, d: number) => W.campaigns.filter(c => c.front && c.a===a && c.d===d && c.phase<2);
/** Why a can't give the word to attack d (`go`: every army attacks) or to hold (every army defends), or null if it can. */
export function offensiveProblem(a: number, d: number, go: boolean): string | null {
  const key=a*W.M+d, cs=armiesOn(a,d);
  if (!cs.length) return 'No army on the border';
  if (go && !W.wars[key]){
    if (!inCrisis(a,d)) return 'They have not attacked: your armies hold the border';
    const w=crisisWait(a,d); if (w>0) return `Time to talk: ${Math.ceil(w/10/GAME_SPEED)} s before war may begin`;
    return null;
  }
  if (!W.wars[key]) return 'No war to fight';
  return cs.some(c => attacks(c)!==go) ? null : go ? 'Every army attacks already' : 'Every army defends already';
}
/** Records in W.offensive what a's armies on d's border are doing at war, as the orders stand: attacking if any of them is. */
const regroup = (a: number, d: number) => { const key=a*W.M+d; if (W.wars[key]) W.offensive[key]=armiesOn(a,d).some(attacks) ? F_PUSH : F_HOLD; };
/** a gives the word to every army on d's border: attack (in a crisis: war, once its time is up), or defend. Returns true if anything changed. */
export function setOffensive(a: number, d: number, go: boolean){
  if (offensiveProblem(a,d,go)) return false;
  const key=a*W.M+d;
  if (go && !W.wars[key]){ for (const c of armiesOn(a,d)){ c.ordered=true; c.attack=true; } return escalate(a,d); }
  let done=false;
  for (const c of armiesOn(a,d)) if (attacks(c)!==go){ c.ordered=true; c.attack=go; done=true; }
  regroup(a,d);
  return done;
}
/** Why army `id` of nation a can't be told to attack or defend, or null. */
export function armyProblem(a: number, id: number, go: boolean): string | null {
  const c=camps.get(id);
  if (!c || c.a!==a || !c.front || c.phase===2 || c.naval>=0) return 'That army is gone';
  if (!W.wars[c.a*W.M+c.d]) return go ? 'It is not war yet: the word is given in the crisis' : 'It is not war';
  return attacks(c)===go ? (go ? 'It attacks already' : 'It defends already') : null;
}
/** Orders army `id` of a to attack (take the ground before it, or its kingdom's land back) or to defend (fall back to the line no tower reaches). */
export function armyOrder(a: number, id: number, go: boolean){
  if (armyProblem(a,id,go)) return false;
  const c=camps.get(id)!; c.ordered=true; c.attack=go;
  regroup(c.a,c.d);
  return true;
}
/** Sends army `id` of a to the border with its enemy on landmass `isle` (one of frontIsles). */
export function armyFront(a: number, id: number, isle: number){
  const c=camps.get(id);
  if (!c || c.a!==a || !c.front || c.phase===2 || c.naval>=0 || c.isle===isle || !frontIsles(a,c.d).includes(isle)) return false;
  c.isle=isle; c.field=offensiveOf(c.a,c.d,isle).walk; c.fieldAt=W.tickN; c.placed=0;
  for (const id2 of c.members){ const h=byId.get(id2); if (h){ h.fk=-1; h.line=-1; h.slot=-1; } }
  return true;
}
/** Sends army `id` of a (out on a border but not committed: freeArmy), militia included, to the border with d (landmass `isle`): it goes on from where it stands. */
export function armyRedirect(a: number, id: number, d: number, isle=0){
  const c=camps.get(id);
  if (!c || c.a!==a || c.d===d || c.naval>=0 || !c.front || c.phase!==1 || !freeArmy(c) || warProblem(a,d)) return false;
  const men=c.members.map(k => byId.get(k)).filter((h): h is Human => !!h && h.hp>0);
  if (!men.length) return false;
  isle=isle || (frontIsles(a,d)[0] ?? 0);
  if (isle && !crossable(a,tileIsle(men[0].x,men[0].y),isle)) return false;
  const unit=c.unit, mil=c.militia, all=c.all;
  unhitch(c);
  const nc=newCampaign(a,d,men.length,W.nations[d].tiles,unit,isle);
  nc.militia=mil; nc.all=all;
  muster(nc,men,unit>=0 ? unitAt(unit) : undefined);
  if (W.wars[a*W.M+d]) W.atWar[a*W.M+d]=W.atWar[d*W.M+a]=1;
  if (W.aggr[d*W.M+a] || W.wars[a*W.M+d]) on.defending(a,d,men.length);
  else nc.deployed=true;   // (a precaution, not a crisis)
  return true;
}
/** a recalls army `id`: it goes home (an army at war can't be recalled). */
export function armyRecall(a: number, id: number){
  const c=camps.get(id);
  if (!c || c.a!==a || !c.front || c.phase===2 || c.naval>=0 || W.wars[c.a*W.M+c.d] || (W.aggr[c.a*W.M+c.d] && !c.deployed)) return false;
  sendHome(c,'calm',false);
  return true;
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
    if (!c.front || !c.hostile || c.phase===2 || c.naval>=0) continue;
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
    REFRONT ticks); gathered, it is ready for the word (at war, each army attacks or defends as it was ordered); attacking, it pushes on.
    A bot that massed an attack goes to war as soon as it is ready and its time is up (or calls it off, outmatched);
    at war, a bot's armies that started it attack at once, and the ones defending hold (sim/bots.ts decides from there). */
function runOffensives(){
  const M=W.M, now=W.tickN, live=new Map<number, Campaign[]>();
  for (const c of W.campaigns) if (c.front && c.phase<2){ const k=ofId(c.a*M+c.d,c.isle); let L=live.get(k); if (!L){ L=[]; live.set(k,L); } L.push(c); }
  for (const [id,o] of [...offensives]) if (!live.has(id)) endOffensive(o);
  const pairs=new Map<number, number>();   // each pair's fronts, together: pushing, holding, or (before the word) the least ready
  const note = (key: number, war: boolean, st: number) => { const was=pairs.get(key); pairs.set(key,was===undefined ? st : war ? (was===F_PUSH || st===F_PUSH ? F_PUSH : F_HOLD) : Math.min(was,st)); };
  for (const [id,cs] of live){
    const o=offensiveOf(cs[0].a,cs[0].d,cs[0].isle), key=o.key, war=!!W.wars[key]; o.camps=cs; o.men=[]; o.atk=[]; o.def=[];
    for (const c of cs){
      c.field=o.walk;
      const hold=war && !attacks(c);
      for (const m of c.members){ const h=byId.get(m); if (h && h.id!==c.leader && h.task!==TASK_BOAT){ o.men.push(h); (hold ? o.def : o.atk).push(h); } }
    }
    // a landing from the sea, its ships not yet in: no front on the land. The armies wait aboard, in line off the coast, until the word
    const inv=navalOf(o.a,o.d);
    if (inv){
      o.noFront=0;
      if (o.st===F_GATHER && inv.stage>=INV_READY){ o.st=F_READY; for (const c of cs) tell(c,'ready'); }
      if (war) o.st=F_PUSH;   // (the word is given: they land and fight on)
      for (const c of cs) c.mode=o.st;
      note(key,war,o.st); continue;
    }
    if (!o.F || (now+id)%REFRONT===0) redeploy(o);
    if (!o.F!.tiles.length){   // no border left to fight on: the armies wait, and in the end are unassigned (back at their barracks)
      if (++o.noFront>=NO_FRONT) for (const c of cs) sendHome(c,'done');
      note(key,war,o.st); continue;
    }
    o.noFront=0;
    // its own land taken by the enemy on this landmass: the armies that attack take it back first (and nothing else: no counter-charge until then)
    const lib=war && occOn(o.a,o.d,o.isle)>0;
    if (lib!==o.liberating){ o.liberating=lib; o.F=null; redeploy(o); }
    if (!war){
      if (o.st===F_GATHER){
        let present=0; for (const h of o.men) if (h.fk===id && (h.x-h.fx)**2+(h.y-h.fy)**2<=PRESENT*PRESENT) present++;
        if (present && (present>=o.men.length*GATHER_AT || now-o.since>=GATHER_MAX)){ o.st=F_READY; for (const c of cs) tell(c, W.aggr[key] ? 'ready' : 'guard'); }
      }
      if (o.st===F_READY && W.aggr[key] && !W.nations[o.a].isPlayer && !crisisWait(o.a,o.d)) botCrisis(o);
      if (!offensives.has(id)) continue;
      for (const c of cs) c.mode=o.st;
    } else {
      let push=false;
      for (const c of cs){
        const go=attacks(c), m=go ? F_PUSH : F_HOLD;
        if (c.mode!==m){ c.mode=m; tell(c, go ? 'assault' : 'hold'); }
        if (c.placed!==(go ? 1 : 2)) o.F=null;   // (laid out again, on the other line)
        push||=go;
      }
      o.st=push ? F_PUSH : F_HOLD;
      if (!o.F) redeploy(o);
    }
    note(key,war,o.st);
    if (o.st===F_PUSH && o.atk.length){
      if (!o.depth) o.depth=depths(o);
      if ((now+id)%(W.stance[key]===S_RUSH ? ADVANCE_TICKS/RUSH_PACE : ADVANCE_TICKS)===0) push(o);   // (a rush's strips come twice as often)
      if ((now+id)%20===10 && !o.liberating) encircle(o);   // (a kingdom retaking its land takes none of the enemy's)
    }
  }
  for (const [key,st] of pairs) W.offensive[key]=st;
}
/** A bot's armies have massed on d's border: it goes to war, unless far more stand against them on
    the border (and half the soldiers d has at home besides), when it calls it off; the bolder the bot,
    the worse the odds it takes. */
function botCrisis(o: Offensive){
  const mine=menOn(o.a,o.d), theirs=menOn(o.d,o.a)+0.5*W.humans.filter(h => h.o===o.d && h.kind===H_SOLDIER && !h.militia && h.war<0).length;
  if (theirs>mine*(OUTMATCHED+W.nations[o.a].attackAt)) deescalate(o.a,o.d); else escalate(o.a,o.d);
}
/* ---------- stances: how the armies on a front fight ---------- */
export const S_BALANCED = 0, S_BORDER = 1, S_RUSH = 2;
export const STANCES = ['Balanced', 'Border capture', 'Capital rush'];
const MASS_TOWERS = 3;        // watchtowers within reach of each other that make a heavily defended area
const RUSH_WIDTH = 14;        // tiles either side of the way to the capital a rush keeps to
const RUSH_PACE = 2;          // a rush's strips come twice as often: its men are all on the one way
const RUSH_TOWER = 20;        // pixels from the way to the capital a watchtower still counts as in it
/** Sets how a's armies fight on the front against d. */
export function setStance(a: number, d: number, st: number){
  if (!W.nations[a]?.alive || !W.nations[d]?.alive || !(st>=0 && st<STANCES.length)) return false;
  W.stance[a*W.M+d]=st; return true;
}
const stanceOf = (a: number, d: number) => W.stance[a*W.M+d];
/** Watchtowers of d's that stand among at least MASS_TOWERS (themselves included), within shooting reach of each other. */
function massedTowers(d: number){
  const T=W.nations[d].blds.filter(q => pType[q]===B_TOWER && pOwner[q]===d && pBurn[q]<=0), out: number[]=[];
  for (const q of T){
    let k=0; for (const r of T) if (Math.abs((q%PW)-(r%PW))<=4 && Math.abs(((q/PW)|0)-((r/PW)|0))<=4) k++;
    if (k>=MASS_TOWERS) out.push(q);
  }
  return out;
}
let massCache=new Map<number, { at: number; set: Set<number> }>();
/** d's massed watchtowers, worked out again every two seconds. */
function massedSet(d: number){
  let m=massCache.get(d);
  if (!m || W.tickN<m.at || W.tickN-m.at>=20){ m={ at:W.tickN, set:new Set(massedTowers(d)) }; massCache.set(d,m); }
  return m.set;
}
/** Is watchtower q close to the way c's army takes to d's capital (or by the capital)? */
function inRushWay(q: number, c: Campaign){
  const D=W.nations[c.d]; if (D.capTile<0) return true;
  const [gx,gy]=doorOf(D), x=(q%PW)*8+4, y=((q/PW)|0)*8+4;
  return toSegment(x,y,c.bx,c.by,gx,gy)<=RUSH_TOWER || Math.hypot(x-gx,y-gy)<=RUSH_WIDTH*3;
}
/** Distance in pixels from point (x,y) to the segment (ax,ay)-(bx,by). */
function toSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number){
  const dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy, u=L ? clamp(((x-ax)*dx+(y-ay)*dy)/L,0,1) : 0;
  return Math.hypot(x-(ax+u*dx), y-(ay+u*dy));
}
/** Where a rush against d heads: d's gate, and from where (the middle of a's front). */
function rushWay(o: Offensive): [number, number, number, number] | null {
  const D=W.nations[o.d]; if (D.capTile<0 || !o.camps.length) return null;
  let x=0, y=0, k=0; for (const c of o.camps){ x+=c.bx; y+=c.by; k++; }
  const [gx,gy]=doorOf(D); return [x/k, y/k, gx, gy];
}
/** a's offensive against d, as it stands: the front of its biggest landmass (null before it is first worked out) and how many men hold its front rank. */
export function offensiveFront(a: number, d: number): { F: Front | null; k: number } | undefined {
  let best: Offensive | undefined;
  for (const o of frontsOf(a*W.M+d)) if (!best || o.men.length>best.men.length) best=o;
  return best && { F:best.F, k:best.k };
}
/** An offensive with no armies left is over; the guard that stood against it stands down. */
function endOffensive(o: Offensive){
  offensives.delete(o.id);
  if (!frontsOf(o.key).length) W.offensive[o.key]=F_GATHER;
  for (const h of W.humans) if (h.fk===o.id && h.o===o.d){ h.fk=-1; h.line=-1; }
}
/** The line the defending armies of offensive o fall back to: the edge of the ground a holds on this landmass (its own, and d's that
    it occupies) that no tower of the enemy reaches, beside the enemy's ground (or ground in reach of its towers): the closest
    place to the enemy where nobody can shoot at them. Empty if there is none. */
function safeLine(o: Offensive): number[] {
  const a=o.a, d=o.d, tw=TW, th=TH, out: number[]=[];
  const free=(t: number) => holds(a,d,t) && isle[t]===o.isle && !walledFor(a,t);
  const danger=(t: number) => enemyOf(a,d,t) || (holds(a,d,t) && walledFor(a,t));
  for (const K of [W.nations[a], W.nations[d]])
    for (let y=Math.max(0,K.y0);y<=Math.min(th-1,K.y1);y++) for (let x=Math.max(0,K.x0), t=y*tw+x;x<=Math.min(tw-1,K.x1);x++,t++){
      if (!free(t) || owner[t]!==K.id || underCastle(a,t)) continue;
      if ((x>0 && danger(t-1)) || (x<tw-1 && danger(t+1)) || (y>0 && danger(t-tw)) || (y<th-1 && danger(t+tw))) out.push(t);
    }
  return out;
}
/** Works out offensive o's front again and gives its men their places on it, each leader his behind
    the middle of his men, a rank behind the last, and (every other time) the way there. The armies that attack stand on the
    line as it is; those that defend (at war) fall back to the line no enemy tower reaches. */
function redeploy(o: Offensive){
  const coming=W.invasions.find(i => i.a===o.d && i.d===o.a && i.stage<INV_LAND && !i.safe);   // (a landing coming at us from the sea: our front is the coast it will land on)
  const F=o.F=coming ? lineOf(o.a,o.d,false,coming.coast.filter(t => owner[t]===o.a)) : lineOf(o.a,o.d,false,undefined,o.isle), id=o.id, ok=standsFor(o.a,o.d);
  let Fd: Front | null=null;
  if (o.def.length){
    if (W.tickN-o.safeAt>=20 || !o.Fd){ o.safeAt=W.tickN; const line=safeLine(o); o.Fd=line.length ? lineOf(o.a,o.d,false,line) : null; }
    Fd=o.Fd;
  } else o.Fd=null;
  if (!F.tiles.length){ o.k=0; return; }
  const place=(men: Human[], L: Front) => deploy(L,men,1,id,ok);
  // (an army put on the other line starts there afresh)
  for (const c of o.camps){
    const want=o.def.length && Fd && W.wars[o.key] && !attacks(c) ? 2 : 1;
    if (c.placed!==want){ c.placed=want; for (const m of c.members){ const h=byId.get(m); if (h){ h.fk=-1; h.slot=-1; h.line=-1; } } }
  }
  o.k=place(o.atk,F);
  if (Fd && o.def.length) place(o.def,Fd); else if (o.def.length) place(o.def,F);
  const srcs: number[]=[];
  for (const h of o.men) srcs.push(tileOf(h.fx,h.fy));
  for (const c of o.camps){
    const mine: Human[]=[];
    for (const m of c.members){ const h=byId.get(m); if (h && h.id!==c.leader && h.fk===id) mine.push(h); }
    if (!mine.length) continue;
    mine.sort((p,q) => p.slot-q.slot || p.line-q.line || p.id-q.id);
    let x=0, y=0, deep=0; for (const h of mine){ x+=h.fx; y+=h.fy; deep=Math.max(deep,h.line); }
    c.bx=x/mine.length; c.by=y/mine.length;   // where the army is, for anyone looking for it
    const l=byId.get(c.leader); if (!l) continue;
    const L=c.placed===2 && Fd ? Fd : F, u=mine[mine.length>>1].slot, [lx,ly]=placeAt(L,u,1,deep+1,ok);
    l.fk=id; l.slot=u; l.line=deep+1; l.fx=lx; l.fy=ly; srcs.push(tileOf(lx,ly));
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
  const stance=stanceOf(o.a,o.d);
  o.progress+=Math.min(1,DENSE/gap); if (o.progress<1) return;
  o.progress-=1;
  // what the stance leaves alone: a border capture keeps out of the reach of massed watchtowers; a
  // rush keeps to the way to the capital, and the ground about the capital
  let allowed: ((t: number) => boolean) | null=null;
  const lib=o.liberating;
  if (lib) allowed=t => owner[t]===o.a;   // only its own land, taken back
  else if (stance===S_BORDER){
    const R=(TOWER_RANGE+8)/2, mass=massedTowers(o.d).map(q => [((q%PW)*8+4)/2, (((q/PW)|0)*8+4)/2]);   // (in tiles)
    if (mass.length) allowed=t => { const x=t%TW, y=(t/TW)|0; for (const [mx,my] of mass) if ((x-mx)**2+(y-my)**2<=R*R) return false; return true; };
  } else if (stance===S_RUSH){
    const way=rushWay(o);
    if (way){ const [ax,ay,bx,by]=way; allowed=t => { const x=(t%TW)*2+1, y=((t/TW)|0)*2+1; return toSegment(x,y,ax,ay,bx,by)<=RUSH_WIDTH*2 || Math.hypot(x-bx,y-by)<=RUSH_WIDTH*3; }; }
  }
  const takeIt=(t: number, a: number, d: number) => (!allowed || allowed(t)) && takeTile(t,a,d);
  const T=F.tiles, take=new Uint8Array(T.length), a=o.a, d=o.d, tw=TW, R2=(PRESENT*2+gap)**2;   // (pixels: a little more room for a thin line, whose men have further to go when it closes up)
  for (const h of o.atk){
    if (h.fk!==o.id || h.line!==0 || (h.x-h.fx)**2+(h.y-h.fy)**2>R2 || partner(h)) continue;   // (a man in a duel holds his ground: the line takes none before him)
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
      if (!takeIt(t,a,d)) continue;
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
      if (!behind(t,a,d) || !takeIt(t,a,d)) continue;
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
  const capIsle=isle[D.capTile];   // (only on the landmass of its castle: land of theirs across the sea is no pocket of it, and is taken by the army sent there)
  const tw=TW, th=TH, now=W.tickN, first=seenSeq+1;
  const nbrs=(t: number) => { const x=t%tw; return [x>0 ? t-1 : -1, x<tw-1 ? t+1 : -1, t>=tw ? t-tw : -1, t<NT-tw ? t+tw : -1]; };
  const pockets: { tiles: number[]; closed: boolean; held: boolean }[]=[];
  const boxes=W.occCount[a*W.M+d]>0 ? [D,A] : [D];
  for (const K of boxes) for (let y=Math.max(0,K.y0);y<=Math.min(th-1,K.y1);y++) for (let x=Math.max(0,K.x0);x<=Math.min(tw-1,K.x1);x++){
    const t0=y*tw+x; if (seen[t0]>=first || isle[t0]!==capIsle || !enemyOf(a,d,t0)) continue;
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
    if (!o.F || !o.F.tiles.length || !W.wars[o.key] || frontsOf(o.d*W.M+o.a).length) continue;   // (in a crisis nobody turns out; with its own front there, its armies hold it)
    let L=byD.get(o.d); if (!L){ L=[]; byD.set(o.d,L); } L.push(o);
  }
  for (const [d,list] of byD){
    defended[d]=1;
    const guard=W.humans.filter(h => h.o===d && h.kind===H_SOLDIER && !h.militia && h.war<0 && h.post<0 && h.hp>0 && !indoors(h) && !switching(h));
    let total=0; for (const o of list) total+=o.men.length+1;
    let rest=guard;
    list.forEach((o,i) => {
      const F=o.F!, [cx,cy]=placeAt(F,F.len/2,-1,0,() => true), share=i===list.length-1 ? rest.length : Math.min(rest.length,Math.round(guard.length*(o.men.length+1)/total));
      rest=rest.slice().sort((p,q) => (p.fk===o.id ? 0 : 1)-(q.fk===o.id ? 0 : 1) || Math.hypot(p.x-cx,p.y-cy)-Math.hypot(q.x-cx,q.y-cy) || p.id-q.id);
      deploy(F,rest.slice(0,share),-1,o.id,(t) => owner[t]===d);
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
  // kingdoms at war: a war between them (armies massed in a crisis aren't at war)
  W.atWar.fill(0);
  for (let i=0;i<M*M;i++) if (W.wars[i]) W.atWar[i]=1;
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
  if (W.tickN%20===7) returnIslands();
  stepInvasions();
  runOffensives();
  ferryShips();
  if (W.tickN%10===4) endDeadCrises();
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
/** For each kingdom at war: where its home guard should stand: on its occupied land, the part nearest the capital. */
function findRallies(){
  const N=W.nations, M=W.M;
  if (rallies.length!==M) rallies=new Array(M).fill(null);
  for (let o=1;o<M;o++){
    const n=N[o];
    if (!warring[o] || !n.alive){ rallies[o]=null; continue; }
    let best: Rally | null=null, bd=Infinity;
    // (a kingdom whose guard is on a front takes its land back from there: only the pockets, now and then)
    if (!best && W.tickN%(defended[o] ? 100 : 20)===0){
      let lost=0; for (let b=1;b<M;b++) lost+=W.occCount[o*M+b];
      if (lost){
        const cx=n.capTile>=0 ? n.capTile%TW : n.ltx, cy=n.capTile>=0 ? (n.capTile/TW)|0 : n.lty;
        // what the guard can walk to from the heart of the kingdom (land cut off from it is never
        // handed back: occupied ground stays occupied until a liberating army arrives)
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
          if (at<0) continue;   // (out of the guard's reach: it stays occupied until somebody comes to take it back, or peace)
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
  if (prev){ W.occCount[o*M+prev]--; occIsleAdd(t,o,prev,-1); }
  occ[t]=by; W.occCount[o*M+by]++; occIsleAdd(t,o,by,1); W.lost[o*M+by]=1;
  on.occupied(t);
}   // what stands on it isn't burnt by marching over it: the army has to break it (targetable)
function liberate(t: number){
  const prev=occ[t]; if (!prev) return;
  W.occCount[owner[t]*W.M+prev]--; occIsleAdd(t,owner[t],prev,-1); occ[t]=0; beach[t]=0;
  on.occupied(t);
}
/** There is one general front between two kingdoms at war, and the ground a has taken of d's is all
    one piece joined to a's own land. A pocket of it cut off from that (by the defenders retaking the
    ground between) goes back to d at once. */
function returnIslands(){
  const M=W.M, N=W.nations;
  for (let d=1;d<M;d++){
    const D=N[d]; if (!D.alive) continue;
    for (let a=1;a<M;a++){
      if (a===d || W.occCount[d*M+a]<=0) continue;
      // the ground of d's that a occupies, in d's box; the pieces that touch a's own land (or a's allies' ... just a's) are the front's
      const stamp=++seenSeq, Q=queue, tw=TW, th=TH; let head=0, tail=0, mine=0;
      const x0=Math.max(0,D.x0), x1=Math.min(tw-1,D.x1), y0=Math.max(0,D.y0), y1=Math.min(th-1,D.y1);
      for (let y=y0;y<=y1;y++) for (let t=y*tw+x0, e=y*tw+x1;t<=e;t++){
        if (owner[t]!==d || occ[t]!==a) continue;
        mine++; const x=t%tw;
        if (beach[t]===a || (x>0 && owner[t-1]===a && !occ[t-1]) || (x<tw-1 && owner[t+1]===a && !occ[t+1]) || (t>=tw && owner[t-tw]===a && !occ[t-tw]) || (t<NT-tw && owner[t+tw]===a && !occ[t+tw])){ seen[t]=stamp; Q[tail++]=t; }
      }
      if (!mine) continue;
      while (head<tail){
        const t=Q[head++], x=t%tw;
        for (const k of [x>0 ? t-1 : -1, x<tw-1 ? t+1 : -1, t>=tw ? t-tw : -1, t<NT-tw ? t+tw : -1])
          if (k>=0 && seen[k]!==stamp && owner[k]===d && occ[k]===a){ seen[k]=stamp; Q[tail++]=k; }
      }
      if (tail===mine) continue;
      for (let y=y0;y<=y1;y++) for (let t=y*tw+x0, e=y*tw+x1;t<=e;t++) if (owner[t]===d && occ[t]===a && seen[t]!==stamp) liberate(t);
    }
  }
}
/** The general fronts of the wars on the map, one for each pair of kingdoms: the offensive of the one
    that attacked (or, if it has none, the other's), as the line of tiles and which kingdom holds the front. */
export function frontLines(): { a: number; d: number; tiles: number[]; state: number }[] {
  const M=W.M, out: { a: number; d: number; tiles: number[]; state: number }[]=[], done=new Set<number>();
  const list=[...offensives.values()].filter(o => o.F && o.F.tiles.length).sort((p,q) => (+!!W.aggr[q.key])-(+!!W.aggr[p.key]) || p.id-q.id);
  for (const o of list){
    const pair=Math.min(o.a,o.d)*M+Math.max(o.a,o.d); if (done.has(pair)) continue;
    done.add(pair); out.push({ a:o.a, d:o.d, tiles:o.F!.tiles, state:W.offensive[o.key] });
  }
  return out;
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
/** The man h is in a duel with, while it lasts: both alive, still close, each the other's. */
export function partner(h: Human): Human | undefined {
  if (h.duel<0) return undefined;
  const p=byId.get(h.duel);
  if (!p || p.hp<=0 || p.duel!==h.id || (p.x-h.x)**2+(p.y-h.y)**2>DUEL_R*DUEL_R || indoors(p)){ if (p && p.duel===h.id) p.duel=-1; h.duel=-1; return undefined; }
  return p;
}
/** Is the fight between h and e not for them: one of them is in a duel with somebody else? A duel is
    one against one, nobody joins in, and another only takes a place when its man has fallen. */
function locked(h: Human, e: Human){
  const pe=partner(e); if (pe && pe!==h) return true;
  const ph=partner(h); return !!ph && ph!==e;
}
function strike(h: Human, e: Human){
  if (h.cool>0 || h.beggar) return;   // a beggar strikes no blow: he only stands in the way
  if (locked(h,e)) return;            // (a duel is one on one)
  h.duel=e.id; e.duel=h.id;
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
/** Pace of h marching with c: a counter-attack a little faster, an army on enemy ground not yet occupied half as fast (ground already occupied crosses at full pace). */
export function marchPace(h: Human, c: Campaign){
  const t=tileOf(h.x,h.y);
  return pace(h)*(c.inspired ? REVENGE_PACE : 1)*(c.front && owner[t]===c.d && !occ[t] ? INVADE_SLOW : 1);
}
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
  if (w>=0 && h.foe<0 && h.aim<0 && h.id!==c.leader && targetable(wallTower[w],c) && (!c.front || (c.mode===F_PUSH && !frontOfC(c)?.liberating))) h.aim=wallTower[w];
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
/** Can c's soldiers attack building q? An attack goes for watchtowers, whatever stands on the
    ground it holds, and at the end the castle. */
function targetable(q: number, c: Campaign){
  const ty=pType[q];
  if (pOwner[q]!==c.d || pBurn[q]>0) return false;
  if (ty===B_CASTLE) return true;
  if (!isStructure(ty) || ty===B_PART) return false;
  if (c.front){   // the stance: a rush goes for watchtowers in its way only; a border capture leaves the massed ones be
    const st=stanceOf(c.a,c.d);
    if (st===S_RUSH) return ty===B_TOWER && inRushWay(q,c);
    if (st===S_BORDER && ty===B_TOWER && massedSet(c.d).has(q)) return false;
  }
  return (ty===B_TOWER || occ[pCenter[q]]===c.a || (ty===B_HOUSE && pIn[q]>0));   // (a house with people resting inside draws them in)
}
/** House q is broken open: the people resting inside come out of the rubble and, with the enemy
    upon them, fight. */
function evict(q: number){
  const x=(q%PW)*8+4, y=((q/PW)|0)*8+5, o=pOwner[q];
  for (const h of W.humans) if (h.rest===q){ release(h); h.x=x+W.prand()*2-1; h.y=y; backToRoam(h); }
  if (o) raiseMob(o,x,y,6);
}
/** A soldier in the field looks around: an enemy nearby (sooner one fighting a comrade), else a building to attack. */
function hitBuilding(h: Human, c: Campaign){
  if (h.cool>0) return;
  h.cool=HIT_TICKS;
  const q=h.aim, ty=pType[q];
  const was=wear(q);
  pHp[q]+=BLD_DMG; on.bldHit(q);
  if (pHp[q]<bldHp(q)){ if (wear(q)!==was) on.plotChanged(q); return; }   // it looks the worse for it
  h.aim=-1;
  if (ty===B_CASTLE){ annex(c.d,c.a); return; }
  if (ty===B_HOUSE && pIn[q]) evict(q);
  ignite(q);
}
function comeHome(h: Human){
  h.war=-1; h.foe=-1; h.aim=-1; h.slot=0;
  backToRoam(h);
}
/** On the way home: soldiers keep out of fights, striking back only at whoever is on them. */
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
  const c=camps.get(h.war); if (!c){ if (h.task===TASK_BOAT){ boatStep(h); return; } h.war=-1; backToRoam(h); return; }
  if (h.task===TASK_BOAT){ boatStep(h); return; }   // aboard a ship, or on his way home by sea
  if (h.cool>0) h.cool--;
  if (c.phase===2){ homeward(h,c); return; }
  reclaim(h);   // passing by our own occupied land
  frontStep(h,c);
}
/** One tick for a man of an army on a front: fight an enemy who comes at him or at his place (any
    near it while attacking; while holding, those who come onto his side's ground), break what stands
    by his place while attacking, and otherwise go to his place and stand there. Its leader fights
    only whoever is on him. */
function frontStep(h: Human, c: Campaign){
  if (c.naval<0 && c.isle && isLand[tileOf(h.x,h.y)] && isle[tileOf(h.x,h.y)]!==c.isle && ferryMan(h,c)) return;   // (its front is across the sea: he waits for a ship)
  const key=c.a*W.M+c.d, pushing=c.mode===F_PUSH, retaking=pushing && !!frontOfC(c)?.liberating, invading=pushing && !retaking, leader=h.id===c.leader;
  if ((h.id+W.tickN)%4===0) chooseOnFront(h,c,invading,retaking,leader);
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  const R=(pushing ? REACH_PUSH : REACH_HOLD)*1.6;
  // (an army that is not invading never goes out after a man onto the enemy's own ground: only one within his blow's reach)
  if (foe && (foe.hp<=0 || !atWar(h.o,foe.o) || indoors(foe) || locked(h,foe) || (foe.foe!==h.id && (foe.x-h.fx)**2+(foe.y-h.fy)**2>R*R) || (!invading && !stayOut(h,foe,c)))){ foe=undefined; h.foe=-1; }
  if (foe){
    if ((foe.x-h.x)**2+(foe.y-h.y)**2<=MELEE_R*MELEE_R) strike(h,foe); else moveTo(h,c,foe.x,foe.y,1.6);
    return;
  }
  if (h.aim>=0 && (!invading || !targetable(h.aim,c) || !byPlace(h,h.aim,1.5))) h.aim=-1;   // (the front has moved on from it)
  if (h.aim>=0){
    const [x0,y0,x1,y1]=rectOf(h.aim);
    if (h.x>=x0-1.5 && h.x<=x1+1.5 && h.y>=y0-1.5 && h.y<=y1+1.5) hitBuilding(h,c);
    else moveTo(h,c,clamp(h.x,x0-1,x1+1),clamp(h.y,y0-1,y1+1));
    return;
  }
  if (h.fk<0){ const s=downhill(c.field,h.x,h.y); if (s) moveTo(h,c,s[0],s[1]); return; }   // no place yet: on toward the front
  moveTo(h,c,h.fx,h.fy,0.2);
}
/** May h, whose army is not invading, deal with e: not while e stands on the enemy's own ground, further than a blow's reach (he would have to go out there after him)? */
function stayOut(h: Human, e: Human, c: Campaign){
  const t=tileOf(e.x,e.y);
  return !(owner[t]===c.d && !occ[t]) || (e.x-h.x)**2+(e.y-h.y)**2<=MELEE_R*MELEE_R;
}
/** A man of the front picks his enemy: one on him or on his leader, or one near his place (while
    holding, only one who has come onto his side's ground), the nearest first, but one his comrades are
    already fighting counts as further off, so the line meets the enemy all along. With nobody to fight
    while attacking, he goes for a building by his place: a watchtower, the castle, or what stands on
    ground his side has taken. */
function chooseOnFront(h: Human, c: Campaign, invading: boolean, retaking: boolean, leader: boolean){
  let best: Human | undefined, bs=Infinity;
  const R=invading || retaking ? REACH_PUSH : REACH_HOLD, M=W.M;
  for (let o=1;o<M;o++){
    if (!W.atWar[c.a*M+o]) continue;
    for (const e of armies[o] ?? []){
      if (e.hp<=0 || locked(h,e)) continue;
      const d=Math.hypot(e.x-h.x,e.y-h.y), onMe=e.foe===h.id, onLeader=c.leader>=0 && e.foe===c.leader;
      if (leader){ if (!onMe && d>=MELEE_R*2) continue; }
      else if (!onMe){
        if (!(onLeader && d<R*1.5) && (e.x-h.fx)**2+(e.y-h.fy)**2>R*R) continue;
        if (!invading && !onLeader && d>MELEE_R*1.5 && !(retaking ? owner[tileOf(e.x,e.y)]===c.a : holds(c.a,c.d,tileOf(e.x,e.y)))) continue;   // (not invading: only those on his own side's ground, occupied or not)
      }
      if (!invading && !stayOut(h,e,c)) continue;
      const s=d+CROWD*crowdOn(e,h)-(onMe ? 4 : 0)-(onLeader ? 20 : 0);
      if (s<bs || (s===bs && best && e.id<best.id)){ bs=s; best=e; }
    }
  }
  if (best){ h.foe=best.id; h.aim=-1; return; }
  h.foe=-1;
  if (leader || !invading || h.fk<0){ h.aim=-1; return; }
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
      if (e.hp<=0 || locked(h,e) || (e.x-ax)**2+(e.y-ay)**2>R*R) continue;
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
const valid = (h: Human, e: Human | undefined): e is Human => !!e && e.hp>0 && !indoors(e) && atWar(h.o,e.o) && !locked(h,e);
/** A place in the home guard's line: hold it, and fight enemies who come within reach of the line.
    Armed villagers only fight whoever is on them; soldiers go out to meet the enemy near the line. */
function holdLine(h: Human, r: Rally){
  const soldier=h.kind===H_SOLDIER;
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  if (!valid(h,foe) || (foe.x-r.x)**2+(foe.y-r.y)**2>(DEFEND_R*1.5)**2) foe=undefined;
  if (!foe && (h.id+W.tickN)%3===0) foe=threat(h,r.x,r.y,DEFEND_R,soldier ? Infinity : 4);
  if (foe){ engage(h,foe); return; }
  h.foe=-1;
  // taking land back: a tight knot on the spot
  const [sx,sy]=[r.x+Math.cos(h.slot*2.4)*Math.min(2,h.slot*0.4), r.y+Math.sin(h.slot*2.4)*Math.min(2,h.slot*0.4)];
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
        if (e.hp<=0 || locked(h,e)) continue;
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
function nearestEnemy(h: Human, r: number, anyone=false){
  let best: Human | undefined, bd=r*r;
  for (let o=1;o<W.M;o++){
    if (!W.atWar[h.o*W.M+o]) continue;
    for (const e of armies[o] ?? []){ if (e.hp<=0 || (!anyone && locked(h,e))) continue; const d=(e.x-h.x)**2+(e.y-h.y)**2; if (d<bd || (d===bd && best && e.id<best.id)){ bd=d; best=e; } }
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
    if (h.brave<0 || h.brave===0){ release(h); h.task=TASK_ROAM; h.path=[]; h.wait=0; }
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
    const e=nearestEnemy(h,h.brave===MOB ? MOB_R : DANGER_R,true);   // (danger is danger, duel or not)
    if (e){
      h.calm=0;
      if (h.brave<0){
        h.brave = h.beggar || W.prand()<0.5 ? 1 : 0;   // beggars always stand in the way
        release(h); h.task=TASK_ROAM; h.path=[]; h.wait=0;   // whatever he was doing, he drops it
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
