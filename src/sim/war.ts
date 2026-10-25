/* ---------- war: alliances, armies in the field, fighting, and the fall of kingdoms ----------
   Clicking another kingdom opens diplomacy: an alliance, or war. War sends some of the
   kingdom's soldiers out as a campaign, idle soldiers first, then watchtower guards:
   - a raid crosses unclaimed or allied land to the target and burns its buildings, the
     outskirts first and on toward the centre. A raider who destroys a building carries a loot
     bag, worth LOOT_GOLD if he gets it home. If other kingdoms close every way through, the
     raid turns back.
   - an attack needs a shared border. The army takes the ground it marches over (burning what
     stands there) and pushes for the capital. Breaking the castle annexes the kingdom: its land,
     buildings and people go to the winner, and its gold and stockpile are lost.
   Two kingdoms are at war while a campaign between them is still fighting. Only then do
   soldiers fight and watchtowers shoot (soldiers first, then villagers). A raid can be
   recalled; a war ends when the other side accepts peace, or when the army is gone.
   An army musters in a line behind a banner on its own border, then marches in formation: the
   banner waits for stragglers and for fights to finish, and soldiers break off for enemies and
   buildings near the line and come back to it. At home, soldiers fight enemies who come near
   their watchtower or barracks, but never leave their own land; when an army closes on the
   capital, every soldier not on guard rallies to it, and the castle shoots too. Allies open
   their land to each other's armies. */
import { TW, TH, NT, NP, PW, PH, TICK, B_CASTLE, B_CPART, B_TOWER, B_HOUSE, B_FARM, B_BARRACKS, B_MINTER, B_PLANTATION, B_QUARRY, B_COPPERMINE, B_PART, B_MINE, isStructure } from '../core/constants';
import { W, owner, isLand, pType, pOwner, pBurn, pMain, pHp, pPrio, pCenter, type Campaign, type Human, type Nation } from './state';
import { on } from './events';
import { setOwner } from './territory';
import { ignite, SIZE } from './buildings';
import { census } from './census';
import { H_SOLDIER, TASK_ROAM, TOWER_RANGE, TOWER_RELOAD, release, backToRoam, frontOf, doorOf, barracksOf, switching, indoors, tileOf } from './population';

export const LOOT_GOLD = 50;          // a raider's loot bag, paid when he gets it home
export const MELEE_R = 2.6;           // pixels: close enough to strike
export const HIT_TICKS = 8;           // ticks between blows
export const HIT_CHANCE = 0.7;
export const HIT_DMG = 2;             // soldiers have SOLDIER_HP (10)
export const BLD_DMG = 1;             // a blow on a building
const ENGAGE_R = 16;                  // pixels around him a soldier in the field picks a fight...
const LEASH = 34;                     // ...with enemies this close to his banner
const RAID_R = 22;                    // pixels around the banner raiders spread out to burn
const GUARD_R = 26, BARRACKS_R = 30, CAPITAL_R = 40;   // pixels around their post soldiers at home defend
export const SIEGE_R = 56;            // pixels from the castle: an enemy banner this close and the kingdom rallies to it
export const CASTLE_RANGE = 30, CASTLE_RELOAD = 8;   // the castle shoots further and faster than a watchtower
const SPACING = 4;                    // pixels between soldiers in the line, and between ranks
export const MARCH_SP = 3.2;          // pixels a second the banner moves
export const CAPTURE_EVERY = 5;       // ticks between land grabs by each soldier of an attack
const CAPTURE_R = 2;                  // tiles around him
const REFIELD = 20;                   // ticks between working out the way again (2 s)
export const MUSTER_TICKS = 200;      // longest an army waits at the muster point (20 s)
const STALL_TICKS = 60;               // longest the banner waits for stragglers and fights (6 s)...
const STRAGGLE_TICKS = 300;           // ...or, with most of the army still far behind, for it to catch up (30 s)
export const OFFER_TICKS = 300;       // a peace offer stands 30 s
export const MAX_ALLIES = 3;
const GRUDGE_TICKS = 900;             // a kingdom attacked in the last 90 s won't ally with its attacker
/** Blows a building takes before it burns; the castle's are what stands between a kingdom and annexation. */
export const BLD_HP: Record<number, number> = { [B_HOUSE]: 6, [B_FARM]: 5, [B_TOWER]: 16, [B_BARRACKS]: 12, [B_MINTER]: 10,
  [B_PLANTATION]: 10, [B_QUARRY]: 10, [B_COPPERMINE]: 10, [B_MINE]: 8, [B_CASTLE]: 400 };

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
let besieged = new Uint8Array(1);               // per nation: an enemy army is closing on its capital
const held = new Int32Array(NT);                // tick a soldier last stood on or beside this tile of his own land: it can't be taken
const queue = new Int32Array(NT), scratch = new Int16Array(NT);
const want = new Int32Array(NT); let wantSeq = 0;   // tiles a fill is looking for, stamped wantSeq
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

export function resetWar(M: number){
  W.campaigns=[]; W.campSeq=0;
  W.ally=new Uint8Array(M*M); W.atWar=new Uint8Array(M*M); W.offers=new Int32Array(M*M); W.grudge=new Int32Array(M*M).fill(-1e9);
  byId.clear(); camps.clear(); troops.clear(); armies=[]; posts=[]; warring=new Uint8Array(M); besieged=new Uint8Array(M); held.fill(0);
}

/* ---------- the way there ---------- */
const mainOf = (q: number) => pType[q]===B_PART || pType[q]===B_CPART ? pMain[q] : q;
/** The pixel rectangle a building covers, from its main plot. */
function rectOf(q: number): [number, number, number, number] {
  const [w,h] = pType[q]===B_CASTLE ? [2,2] : SIZE[pType[q]] ?? [1,1], x=(q%PW)*8, y=((q/PW)|0)*8;
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
function nearestTile(d: number, x: number, y: number){
  let best=-1, bd=Infinity;
  for (let t=0;t<NT;t++){ if (owner[t]!==d) continue; const e=((t%TW)*2+1-x)**2+(((t/TW)|0)*2+1-y)**2; if (e<bd){ bd=e; best=t; } }
  return best;
}
/** Where the army is headed: a raid, every building it could burn; an attack, the capital. */
function goalsOf(c: Campaign){
  if (c.raid) return raidTargets(c.d).map(q => pCenter[q]);
  const D=W.nations[c.d];
  c.goal = D.capTile>=0 ? D.capTile : nearestTile(c.d,c.bx,c.by);
  return c.goal>=0 ? [c.goal] : [];
}
/** True if a's army could reach something of d's to raid, crossing only unclaimed, allied or d's land. */
export function routeOpen(a: number, d: number){
  const src=raidTargets(d).map(q => pCenter[q]); if (!src.length) return false;
  return fill(scratch,src,a,d,false,ownLand(a),true,0)>=0;
}

/* ---------- declaring war ---------- */
/** a's soldiers free to march: idle ones first, then watchtower guards. */
export function available(n: Nation){
  const idle: Human[]=[], guards: Human[]=[];
  for (const h of W.humans) if (h.o===n.id && h.kind===H_SOLDIER && h.war<0 && h.hp>0 && !switching(h)) (h.post>=0 ? guards : idle).push(h);
  idle.sort((x,y)=>x.id-y.id); guards.sort((x,y)=>x.id-y.id);
  return { idle, guards, all: [...idle, ...guards] };
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

/** Sends `count` of a's soldiers against d. Returns false if it can't. */
export function declare(a: number, d: number, raid: boolean, count: number){
  if (warProblem(a,d,raid)) return false;
  const A=W.nations[a], D=W.nations[d], pool=available(A).all.slice(0,Math.max(0,Math.floor(count)));
  if (!pool.length) return false;
  const c: Campaign={ id:++W.campSeq, a, d, raid, hostile:true, members:[], phase:0, bx:0, by:0, dx:1, dy:0, rx:0, ry:0, goal:-1,
    field:new Int16Array(NT), fieldAt:W.tickN, started:W.tickN, startSoldiers:pool.length, startTiles:D.tiles, stall:0, why:'' };
  if (A.capTile>=0){ const [x,y]=doorOf(A); c.bx=x; c.by=y; }
  // muster on our own ground nearest the goal, by the way the army will walk
  const best=fill(c.field,goalsOf(c),a,d,false,ownLand(a),true,80);
  if (best<0) return false;
  c.rx=c.bx=(best%TW)*2+1; c.ry=c.by=((best/TW)|0)*2+1;
  const s=downhill(c.field,c.bx,c.by);
  if (s && (s[0]!==c.bx || s[1]!==c.by)){ const L=Math.hypot(s[0]-c.bx,s[1]-c.by); c.dx=(s[0]-c.bx)/L; c.dy=(s[1]-c.by)/L; }
  if (allied(a,d)){ W.ally[a*W.M+d]=W.ally[d*W.M+a]=0; on.allianceBroken(a,d); }
  W.grudge[d*W.M+a]=W.tickN;
  W.campaigns.push(c); camps.set(c.id,c);
  pool.forEach((h,i) => { release(h); h.post=-1; h.site=-1; h.war=c.id; h.foe=-1; h.aim=-1; h.slot=i; h.task=TASK_ROAM; h.path=[]; h.wait=0; });
  c.members=pool.map(h => h.id);
  W.atWar[a*W.M+d]=W.atWar[d*W.M+a]=1;
  on.warBegan(a,d,raid);
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
  const src=goalsOf(c);
  if (!src.length){ sendHome(c, c.raid ? 'done' : 'won', c.raid && c.hostile); return; }
  fill(c.field,src,c.a,c.d,false,armyTiles(c,true),false,24);
  if (c.field[tileOf(c.bx,c.by)]<0) sendHome(c,'cut');   // other kingdoms have closed every way on
}

/* ---------- peace and alliances ---------- */
/** Kingdom `from` asks `to` for peace. Bots answer when they next think; the player from the war chip. */
export function offerPeace(from: number, to: number){
  if (!atWar(from,to) || W.offers[from*W.M+to]) return;
  W.offers[from*W.M+to]=W.tickN; on.peaceOffered(from,to);
}
export function refusePeace(from: number, to: number){ W.offers[from*W.M+to]=0; on.peaceRefused(from,to); }
export function makePeace(a: number, b: number){
  for (const c of W.campaigns) if ((c.a===a && c.d===b) || (c.a===b && c.d===a)) sendHome(c,'peace',false);
  W.offers[a*W.M+b]=W.offers[b*W.M+a]=0;
  W.atWar[a*W.M+b]=W.atWar[b*W.M+a]=0;
  on.peaceMade(a,b);
}
/** n wants the fighting with t to end: its raids turn for home, and any war gets a peace offer. */
export function endWar(n: number, t: number){
  let war=false;
  for (const c of W.campaigns){
    if (!c.hostile) continue;
    if (c.a===n && c.d===t && c.raid){ if (c.phase<2) sendHome(c,'recall'); }
    else if ((c.a===n && c.d===t) || (c.a===t && c.d===n)) war=true;
  }
  if (war) offerPeace(n,t);
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
  let since=W.tickN;
  for (const c of W.campaigns) if (c.hostile && ((c.a===a && c.d===b) || (c.a===b && c.d===a))) since=Math.min(since,c.started);
  return W.tickN-since;
}
/** A bot weighing peace with o: it holds out while it thinks it can win, and gives in when it is
    in trouble; a long war wears it down. */
export function wantsPeace(n: Nation, o: number){
  return outlook(n,o) + (W.srand()-0.5)*0.5 - Math.min(0.4,warAge(n.id,o)/3000) < 0;
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
    release(h); h.carry=-1; h.amount=0; h.o=winner; h.post=-1; h.site=-1; h.war=-1; h.foe=-1; h.aim=-1; h.loot=false;
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
  for (let o=1;o<W.M;o++){ const i=loser*W.M+o, j=o*W.M+loser; W.ally[i]=W.ally[j]=W.offers[i]=W.offers[j]=W.atWar[i]=W.atWar[j]=0; }
  for (let t=0;t<NT;t++) if (owner[t]===loser) setOwner(t,winner);   // the last tile eliminates it
  census();
  on.annexed(loser,winner);
}

/* ---------- the armies, each tick ---------- */
function slotPos(c: Campaign, i: number, n: number): [number, number] {
  const cols=Math.max(4,Math.min(12,Math.ceil(Math.sqrt(n*2.5)))), rank=(i/cols)|0, col=i%cols, inRank=Math.min(cols,n-rank*cols);
  const across=(col-(inRank-1)/2)*SPACING, back=rank*SPACING+1.5;
  return [c.bx - c.dy*across - c.dx*back, c.by + c.dx*across - c.dy*back];
}
function advance(c: Campaign){
  const f=c.field, here=f[tileOf(c.bx,c.by)];
  if (here<0) return;
  if (here<=1){ if (!c.raid && W.nations[c.d].capTile<0) c.fieldAt=-1e9; return; }   // there: siege, burn, or (no capital) find more land
  const s=downhill(f,c.bx,c.by); if (!s) return;
  const dx=s[0]-c.bx, dy=s[1]-c.by, d=Math.hypot(dx,dy); if (d<1e-6) return;
  const st=Math.min(d,MARCH_SP*TICK); c.bx+=dx/d*st; c.by+=dy/d*st;
  // the line turns gradually toward where it is going
  c.dx+=(dx/d-c.dx)*0.08; c.dy+=(dy/d-c.dy)*0.08; const L=Math.hypot(c.dx,c.dy)||1; c.dx/=L; c.dy/=L;
}
function runCampaign(c: Campaign, men: Human[]){
  if (!men.length){ W.campaigns.splice(W.campaigns.indexOf(c),1); camps.delete(c.id); on.armyGone(c.a,c.d,c.raid,c.phase===2 ? c.why : 'lost'); return; }
  // the line keeps its order and closes its gaps
  men.sort((x,y)=>x.slot-y.slot || x.id-y.id); men.forEach((h,i) => h.slot=i);
  c.members=men.map(h => h.id);
  if (c.phase<2 && !W.nations[c.d].alive){ sendHome(c,'won',false); return; }
  if (W.tickN-c.fieldAt>=REFIELD) refield(c);
  if (c.phase===2) return;
  let inPlace=0, near=0, busy=false;
  for (const h of men){
    const [sx,sy]=slotPos(c,h.slot,men.length), d2=(h.x-sx)**2+(h.y-sy)**2;
    if (d2<25) inPlace++; if (d2<400) near++; if (h.foe>=0) busy=true;
  }
  if (c.phase===0){ if (inPlace>=men.length*0.7 || W.tickN-c.started>=MUSTER_TICKS){ c.phase=1; c.stall=0; } return; }
  // the banner waits for stragglers and for fights to end, but not for ever
  const wait=busy || inPlace<men.length*0.6;
  if (wait && c.stall<(near<men.length*0.5 ? STRAGGLE_TICKS : STALL_TICKS)){ c.stall++; return; }
  if (!wait) c.stall=0;
  advance(c);
}

export function updateWar(){
  const M=W.M, N=W.nations, H=W.humans;
  byId.clear(); camps.clear(); troops.clear();
  for (const h of H) byId.set(h.id,h);
  for (const c of W.campaigns){ camps.set(c.id,c); troops.set(c.id,[]); }
  for (const h of H) if (h.war>=0){ const men=troops.get(h.war); if (men) men.push(h); else { h.war=-1; backToRoam(h); } }
  for (const c of [...W.campaigns]) if (camps.has(c.id)) runCampaign(c, troops.get(c.id)!);
  // kingdoms at war: an army between them is still fighting
  W.atWar.fill(0);
  for (const c of W.campaigns) if (c.hostile){ W.atWar[c.a*M+c.d]=1; W.atWar[c.d*M+c.a]=1; }
  if (warring.length!==M){ warring=new Uint8Array(M); besieged=new Uint8Array(M); } else { warring.fill(0); besieged.fill(0); }
  for (const c of W.campaigns) if (c.hostile){
    warring[c.a]=1; warring[c.d]=1;
    const D=N[c.d];
    if (!c.raid && c.phase===1 && D.capTile>=0){ const q=D.capPlot, x=(q%PW)*8+8, y=((q/PW)|0)*8+8; if ((c.bx-x)**2+(c.by-y)**2<SIEGE_R*SIEGE_R) besieged[c.d]=1; }
  }
  for (let i=0;i<W.offers.length;i++) if (W.offers[i] && (W.tickN-W.offers[i]>OFFER_TICKS || !W.atWar[i])) W.offers[i]=0;
  armies=N.map(() => []);
  for (const h of H) if (h.kind===H_SOLDIER && h.hp>0 && !indoors(h)){
    armies[h.o].push(h);
    // a soldier holds the ground he stands on and next to
    const t=tileOf(h.x,h.y);
    if (owner[t]===h.o) for (let dy=-TW;dy<=TW;dy+=TW) for (let dx=-1;dx<=1;dx++){ const k=t+dy+dx; if (k>=0 && k<NT) held[k]=W.tickN; }
  }
  posts=N.map(n => warring[n.id] ? barracksOf(n).map(frontOf) : []);
  towersFire();
}

/** Every watchtower of a kingdom at war shoots the nearest enemy soldier in range, or else the
    nearest enemy villager, once per reload; so does the castle, further and faster. */
function towersFire(){
  const N=W.nations, M=W.M;
  const shoot=(i: number, x: number, y: number, range: number) => {
    let target: Human | null=null, bd=Infinity, soldier=false;
    for (const h of W.humans){
      if (h.hp<=0 || !W.atWar[i*M+h.o] || indoors(h)) continue;
      const d=(h.x-x)**2+(h.y-y)**2; if (d>range*range) continue;
      const s=h.kind===H_SOLDIER;
      if ((s && !soldier) || (s===soldier && (d<bd || (d===bd && target!==null && h.id<target.id)))){ target=h; bd=d; soldier=s; }
    }
    if (target){ target.hp--; on.towerShot(x,y,target.x,target.y-2,target.hp<=0); }
  };
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive || !warring[i]) continue;
    for (const q of n.blds){
      if ((q+W.tickN)%TOWER_RELOAD || pType[q]!==B_TOWER || pOwner[q]!==i || pBurn[q]>0) continue;
      shoot(i,(q%PW)*8+4,((q/PW)|0)*8+1,TOWER_RANGE);
    }
    const q=n.capPlot;
    if (n.capTile>=0 && (q+W.tickN)%CASTLE_RELOAD===0 && pBurn[q]<=0) shoot(i,(q%PW)*8+8,((q/PW)|0)*8+2,CASTLE_RANGE);
  }
}

/* ---------- soldiers ---------- */
function strike(h: Human, e: Human){
  if (h.cool>0) return;
  h.cool=HIT_TICKS;
  if (W.prand()<HIT_CHANCE){ e.hp-=HIT_DMG; on.hit(e.x,e.y-2,e.hp<=0); }
  if (e.foe<0 && e.kind===H_SOLDIER) e.foe=h.id;   // he turns to fight back
}
/** Steps toward (gx,gy): straight if the way is open, otherwise along the army's way. */
function moveTo(h: Human, c: Campaign, gx: number, gy: number, stop=0){
  let dx=gx-h.x, dy=gy-h.y, d=Math.hypot(dx,dy);
  if (d<=stop+0.05) return;
  if (d>2 && !clearWay(c.field,h.x,h.y,gx,gy)){
    const s=downhill(c.field,h.x,h.y);
    if (s){ dx=s[0]-h.x; dy=s[1]-h.y; d=Math.hypot(dx,dy); stop=0; if (d<1e-6) return; }
  }
  const st=Math.min(d-stop,h.sp*TICK); h.x+=dx/d*st; h.y+=dy/d*st;
}
/** Can c's soldiers attack building q? Raids burn anything but the castle; an attack goes for
    watchtowers and, at the end, the castle. */
function targetable(q: number, c: Campaign){
  const ty=pType[q];
  if (pOwner[q]!==c.d || pBurn[q]>0) return false;
  return ty===B_CASTLE ? !c.raid : isStructure(ty) && ty!==B_PART && (c.raid || ty===B_TOWER);
}
function pickBuilding(h: Human, c: Campaign){
  const D=W.nations[c.d];
  if (!c.raid && D.capTile>=0){
    const q=D.capPlot, cx=(q%PW)*8+8, cy=((q/PW)|0)*8+8;
    if ((c.bx-cx)**2+(c.by-cy)**2<24*24 && targetable(q,c)) return q;   // the army stands before the castle
  }
  const R=c.raid ? RAID_R : TOWER_RANGE+4;
  const qx0=Math.max(0,Math.floor((c.bx-R)/8)), qx1=Math.min(PW-1,Math.floor((c.bx+R)/8)), qy0=Math.max(0,Math.floor((c.by-R)/8)), qy1=Math.min(PH-1,Math.floor((c.by+R)/8));
  let best=-1, bs=Infinity;
  for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
    const q=mainOf(y*PW+x); if (!targetable(q,c) || pType[q]===B_CASTLE) continue;
    const [x0,y0,x1,y1]=rectOf(q), d=Math.hypot(clamp(h.x,x0,x1)-h.x, clamp(h.y,y0,y1)-h.y);
    if (d>ENGAGE_R+8) continue;
    const s=d-(pType[q]===B_TOWER ? 10 : 0);   // towers first: they are shooting at us
    if (s<bs || (s===bs && q<best)){ bs=s; best=q; }
  }
  return best;
}
/** A soldier in the field looks around: an enemy soldier nearby (sooner one fighting a comrade), else a building to attack. */
function choose(h: Human, c: Campaign){
  let best: Human | undefined, bs=Infinity;
  for (let o=1;o<W.M;o++){
    if (!W.atWar[c.a*W.M+o]) continue;
    for (const e of armies[o] ?? []){
      if (e.hp<=0) continue;
      const d=Math.hypot(e.x-h.x,e.y-h.y); if (d>ENGAGE_R || (e.x-c.bx)**2+(e.y-c.by)**2>LEASH*LEASH) continue;
      const s=d-(e.foe>=0 && byId.get(e.foe)?.war===c.id ? 6 : 0);
      if (s<bs || (s===bs && best && e.id<best.id)){ bs=s; best=e; }
    }
  }
  if (best){ h.foe=best.id; h.aim=-1; return; }
  h.foe=-1;
  if (h.aim>=0 && targetable(h.aim,c)) return;
  h.aim=pickBuilding(h,c);
}
function hitBuilding(h: Human, c: Campaign){
  if (h.cool>0) return;
  h.cool=HIT_TICKS;
  const q=h.aim, ty=pType[q];
  pHp[q]+=BLD_DMG; on.bldHit(q);
  if (pHp[q]<(BLD_HP[ty] ?? 8)) return;
  h.aim=-1;
  if (ty===B_CASTLE){ annex(c.d,c.a); return; }
  ignite(q);
  if (c.raid) h.loot=true;   // plunder: one bag each
}
/** An attacking soldier takes the enemy's ground around him, unless a defender holds it. The castle holds until it is broken. */
function capture(h: Human, c: Campaign){
  const cx=(h.x/2)|0, cy=(h.y/2)|0;
  for (let dy=-CAPTURE_R;dy<=CAPTURE_R;dy++) for (let dx=-CAPTURE_R;dx<=CAPTURE_R;dx++){
    if (Math.abs(dx)+Math.abs(dy)>CAPTURE_R+1) continue;
    const x=cx+dx, y=cy+dy; if (x<0||y<0||x>=TW||y>=TH) continue;
    const t=y*TW+x; if (owner[t]!==c.d || held[t]===W.tickN) continue;
    const q=(y>>2)*PW+(x>>2); if ((pType[q]===B_CASTLE || pType[q]===B_CPART) && pOwner[q]===c.d) continue;
    setOwner(t,c.a);
  }
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
  const st=Math.min(d,h.sp*TICK); h.x+=dx/d*st; h.y+=dy/d*st;
}
/** One tick for a soldier in a campaign. */
export function marchStep(h: Human){
  const c=camps.get(h.war); if (!c){ h.war=-1; backToRoam(h); return; }
  if (h.cool>0) h.cool--;
  if (c.phase===2){ homeward(h,c); return; }
  if (!c.raid && c.phase===1 && (h.id+W.tickN)%CAPTURE_EVERY===0) capture(h,c);
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
  const [sx,sy]=slotPos(c,h.slot,c.members.length);
  moveTo(h,c,sx,sy);
}

/** The post a soldier at home defends, and how far around it. With an army at the gates,
    everyone not on guard defends the capital. */
function postOf(h: Human): [number, number, number] {
  if (h.post>=0){ const [x,y]=frontOf(h.post); return [x,y,GUARD_R]; }
  const home=W.nations[h.o];
  if (besieged[h.o] && home.capTile>=0){ const q=home.capPlot; return [(q%PW)*8+8,((q/PW)|0)*8+8,SIEGE_R]; }
  let best: [number, number] | null=null, bd=Infinity;
  for (const p of posts[h.o] ?? []){ const d=(p[0]-h.x)**2+(p[1]-h.y)**2; if (d<bd){ bd=d; best=p; } }
  if (best) return [best[0],best[1],BARRACKS_R];
  return home.capTile>=0 ? [...doorOf(home),CAPITAL_R] : [h.x,h.y,20];
}
/** The enemy soldier a defender goes for: the nearest near his post, sooner one attacking our buildings or people. */
function threat(h: Human, ax: number, ay: number, R: number){
  let best: Human | undefined, bs=Infinity;
  for (let o=1;o<W.M;o++){
    if (!W.atWar[h.o*W.M+o]) continue;
    for (const e of armies[o] ?? []){
      if (e.hp<=0 || (e.x-ax)**2+(e.y-ay)**2>R*R) continue;
      const d=Math.hypot(e.x-h.x,e.y-h.y);
      const s=d-(e.aim>=0 && pOwner[e.aim]===h.o ? 8 : 0)-(e.foe>=0 && byId.get(e.foe)?.o===h.o ? 4 : 0);
      if (s<bs || (s===bs && best && e.id<best.id)){ bs=s; best=e; }
    }
  }
  return best;
}
/** A soldier at home while his kingdom is at war: fights enemies who come near his post, never
    leaving his own land. Returns true while he is fighting (his normal routine waits). */
export function guardStep(h: Human): boolean {
  if (!warring[h.o] || switching(h) || indoors(h)){ h.foe=-1; return false; }
  if (h.cool>0) h.cool--;
  const [ax,ay,R]=postOf(h);
  let foe=h.foe>=0 ? byId.get(h.foe) : undefined;
  if (foe && (foe.hp<=0 || !atWar(h.o,foe.o) || indoors(foe) || (foe.x-ax)**2+(foe.y-ay)**2>(R*1.4)**2)) foe=undefined;
  if (!foe && (h.id+W.tickN)%3===0) foe=threat(h,ax,ay,R);
  if (!foe){ if (h.foe>=0){ h.foe=-1; backToRoam(h); } return false; }
  h.foe=foe.id; h.path=[]; h.wait=0;
  const dx=foe.x-h.x, dy=foe.y-h.y, d=Math.hypot(dx,dy);
  if (d<=MELEE_R){ strike(h,foe); return true; }
  const st=Math.min(d-1.6,h.sp*TICK);
  if (st>0){ const nx=h.x+dx/d*st, ny=h.y+dy/d*st; if (owner[tileOf(nx,ny)]===h.o){ h.x=nx; h.y=ny; } }
  return true;
}
