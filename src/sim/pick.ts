/* ---------- the start: choosing a region ----------
   A match begins with 15 seconds (on the clock) in which every kingdom, the player's and the bots', chooses
   the region it will start in. A region is one province of the map; one kingdom a region. Clicking a free
   region claims it (its land is drawn in the kingdom's colour at once); clicking another moves the claim
   there, so a kingdom can be pushed out of its first choice, or push another out of its plans. Whatever
   region a kingdom holds when the time is up is where it starts: it owns the whole of it, its castle
   standing in it (on a block of open ground near its middle), and spreads out from there. A region with
   no room for a castle can't be chosen.
   The bots choose too, and keep looking: every second or three each weighs its region against a few
   free ones and moves to a better one, better meaning more room round it (the nearest other kingdom's
   region far off, up to about the spacing the map allows everyone) and, a little, more land. So they
   spread over the map, and a crowded corner empties as the time runs down. A kingdom that chose nothing
   (the player who let the time run out) is given the best free region left. */
import { GAME_SPEED, TW, PW, PH, B_EMPTY, T_MOUNT, T_SNOW } from '../core/constants';
import { W, isLand, terr, owner, pType } from './state';
import { COUNTRIES, countryByCode, type Country } from '../core/countries';
import { setOwner } from './territory';
import { RG, region, resetRegions, cedeRegion } from './regions';
import { makeNation, tellApart, placeCastle } from './sim';
import { resetWar } from './war';
import { resetStories } from './story';
import { allocIsles } from './naval';
import { scanContacts, census } from './census';
import { on } from './events';

export const PICK_TICKS = 15*GAME_SPEED*10;   // the time to choose: 15 seconds on the clock
const MIN_LAND = 40;                         // tiles a region needs to be chosen (with a castle's block among them)

interface PickState {
  t: number;                      // ticks since the choosing began
  holder: Int32Array;             // by region: the kingdom that has claimed it (0 none)
  of: Int32Array;                 // by kingdom: the region it has claimed (0 none)
  spot: Map<number, [number, number]>;   // by region that can be chosen: its castle's block (top-left plot x, y)
  open: number[];                 // the regions that can be chosen
  next: Int32Array;               // by kingdom: the tick a bot looks again
  ideal: number;                  // the spacing, in tiles, that would give every kingdom the same room
}
export let picking: PickState | null = null;

/** The block of open ground for a castle in region r nearest its flag, or null if it has none (all its 8×8 tiles land of the region, no mountains, nothing built). */
function castleSpot(r: number): [number, number] | null {
  const f=RG.flag[r]; if (f<0) return null;
  const bx0=Math.round((f%TW)/4)-1, by0=Math.round(((f/TW)|0)/4)-1;
  const fits=(bx: number, by: number) => {
    if (bx<0 || by<0 || bx+1>=PW || by+1>=PH) return false;
    for (const q of [by*PW+bx, by*PW+bx+1, (by+1)*PW+bx, (by+1)*PW+bx+1]) if (pType[q]!==B_EMPTY) return false;   // (a region's works stand round its flag)
    for (let y=by*4;y<by*4+8;y++) for (let x=bx*4;x<bx*4+8;x++){ const t=y*TW+x; if (!isLand[t] || terr[t]===T_MOUNT || terr[t]===T_SNOW || region[t]!==r) return false; }
    return true;
  };
  for (let d=0;d<=12;d++) for (let dy=-d;dy<=d;dy++) for (let dx=-d;dx<=d;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==d) continue;
    if (fits(bx0+dx,by0+dy)) return [bx0+dx,by0+dy];
  }
  return null;
}

/** The choosing begins: the kingdoms are made (the player's `me`, and the rivals named, or `rivals` of them drawn at random), none of them
    founded yet. Returns false if `me` is no country. */
export function beginPick(me: string, rivals: string[] | number): boolean {
  const mine=countryByCode.get(me); if (!mine) return false;
  const N=W.nations, taken: Country[]=[mine];
  N.length=1;   // (index 0 is unclaimed land: newWorld made it)
  N.push(makeNation(1,mine,true));
  const named=Array.isArray(rivals) ? rivals.map(c => countryByCode.get(c)).filter((k): k is Country => !!k && k.code!==me) : [];
  if (!Array.isArray(rivals)){
    const pool=COUNTRIES.filter(k => k.code!==me);
    for (let i=pool.length-1;i>0;i--){ const j=(W.srand()*(i+1))|0; [pool[i],pool[j]]=[pool[j],pool[i]]; }
    named.push(...pool.slice(0,rivals));
  }
  for (const k of named){ if (taken.includes(k)) continue; taken.push(k); N.push(makeNation(N.length,k,false)); }
  tellApart(N);
  W.M=N.length; W.contact=new Int32Array(W.M*W.M);
  resetWar(W.M); resetStories(W.M); allocIsles(); resetRegions(W.M);
  const spot=new Map<number, [number, number]>(), open: number[]=[];
  let land=0;
  for (let r=1;r<RG.n;r++){ if (!RG.land[r]) continue; land+=RG.land[r]; if (RG.land[r]<MIN_LAND) continue; const s=castleSpot(r); if (s){ spot.set(r,s); open.push(r); } }
  const next=new Int32Array(W.M); for (let i=2;i<W.M;i++) next[i]=1+((W.srand()*60)|0);   // (the bots make their first choice in the first three seconds)
  picking={ t:0, holder:new Int32Array(RG.n), of:new Int32Array(W.M), spot, open, next, ideal:Math.sqrt(land/Math.max(1,W.M-1)) };
  return true;
}

/** Why kingdom o can't claim region r now, or null if it can. */
export function pickProblem(o: number, r: number): string | null {
  const P=picking; if (!P) return 'The game has begun';
  if (!r || !RG.land[r]) return 'Choose a region on land';
  if (!P.spot.has(r)) return 'That region has no room for a castle';
  if (P.holder[r] && P.holder[r]!==o) return `${W.nations[P.holder[r]].name} has claimed that region`;
  return null;
}
/** Kingdom o claims region r (its land is o's at once), giving up the region it had. True if it could. */
export function claimRegion(o: number, r: number): boolean {
  const P=picking; if (!P || pickProblem(o,r)) return false;
  const was=P.of[o]; if (was===r) return true;
  P.holder[r]=o; P.of[o]=r;
  for (let i=RG.start[r];i<RG.start[r+1];i++){ const t=RG.tiles[i]; if (isLand[t]) setOwner(t,o); }   // (the new region first, so o is never left with no land)
  if (was){ P.holder[was]=0; for (let i=RG.start[was];i<RG.start[was+1];i++){ const t=RG.tiles[i]; if (owner[t]===o) setOwner(t,0); } }
  const n=W.nations[o], f=RG.flag[r]; n.ltx=f%TW; n.lty=(f/TW)|0;   // (its name is shown over the region)
  on.regionPicked(o,r,was);
  return true;
}

/** How good region r is for kingdom o: the room round it (how far the nearest region another kingdom has claimed lies, up to a little more
    than the even spacing), and a little for the land it has. */
function worth(o: number, r: number){
  const P=picking!, f=RG.flag[r], x=f%TW, y=(f/TW)|0, cap=P.ideal*1.6;
  let near=cap;
  for (let i=1;i<W.M;i++){ if (i===o) continue; const q=P.of[i]; if (!q) continue; const g=RG.flag[q], d=Math.hypot(g%TW-x,((g/TW)|0)-y); if (d<near) near=d; }
  return near+Math.sqrt(RG.land[r])*0.4;
}
/** A bot looks again: its region against a dozen and a half free ones, picked at random; it moves to the best if that is clearly better. */
function botLook(o: number){
  const P=picking!, srand=W.srand, cur=P.of[o];
  let best=cur, bs=cur ? worth(o,cur) : -Infinity;
  const margin=cur ? P.ideal*0.12 : 0;
  for (let k=0;k<18 && P.open.length;k++){
    const r=P.open[(srand()*P.open.length)|0]; if (P.holder[r]) continue;
    const s=worth(o,r)+(srand()-0.5)*P.ideal*0.1;
    if (s>bs+margin){ bs=s; best=r; }
  }
  if (best && best!==cur) claimRegion(o,best);
}
/** One tick of the choosing (20 a second on the clock): the bots whose time it is look again. True once the time is up. */
export function pickTick(): boolean {
  const P=picking; if (!P) return true;
  P.t++;
  for (let o=2;o<W.M;o++){
    if (P.t<P.next[o]) continue;
    botLook(o);
    P.next[o]=P.t+20+((W.srand()*40)|0);   // (again in one to three seconds)
  }
  return P.t>=PICK_TICKS;
}
/** The ticks left to choose. */
export const pickLeft = () => picking ? Math.max(0,PICK_TICKS-picking.t) : 0;

/** The time is up: every kingdom is founded in the region it holds (one that holds none, in the best free one left; with none left, it
    doesn't play), owning the whole of it, its castle near the region's middle. */
export function endPick(){
  const P=picking; if (!P) return;
  for (let o=1;o<W.M;o++){
    if (P.of[o]) continue;
    let best=0, bs=-Infinity; for (const r of P.open){ if (P.holder[r]) continue; const s=worth(o,r); if (s>bs){ bs=s; best=r; } }
    if (best) claimRegion(o,best); else W.nations[o].alive=false;
  }
  for (let o=1;o<W.M;o++){
    const r=P.of[o], n=W.nations[o]; if (!r || !n.alive) continue;
    const [bx,by]=P.spot.get(r)!;
    placeCastle(n,bx,by);
    cedeRegion(r,o);   // (the whole region, its flag its castle's)
  }
  picking=null;
  scanContacts(true); census();
}
/** Drops a choosing under way (a new map). */
export const cancelPick = () => { picking=null; };
