/* ---------- simulation entry points: worlds, matches, commands, ticks ----------
   No DOM, no canvas: this runs the same in a browser, a server or a test. */
import { TW, TH, NT, PW, PH, GEN_W, GEN_H, TICK, T_MOUNT, T_SNOW, B_CASTLE, B_CPART, GOLD_START, GOLD_PER_SEC, TAX_PER_VILLAGER, WAGE, STR_TILE, STR_VILLAGER, STR_SOLDIER, STR_GOLD } from '../core/constants';
import { mulberry32 } from '../core/rng';
import { W, resizeGrid, owner, occ, isLand, terr, road, frontMark, pType, pOwner, pVar, pMain, pBurn, pTimer, pPrio, pAband, pHp, pTier, pSpan, pArmor, type Nation, type Command } from './state';
import { on } from './events';
import { genMap } from './mapgen';
import { genRealMap, capitalsOn, REAL_MAPS } from './realmap';
import { VIEWS } from './mapview';
import { COUNTRIES, MAJOR, countryByCode, colourGap, type Country } from '../core/countries';
import { setOwner, stepAttack, launch, touches } from './territory';
import { toRuins, build, togglePriority, produce } from './buildings';
import { scanContacts, census } from './census';
import { botThink } from './bots';
import { updatePopulation } from './population';
import { genResources, clearPlot } from './resources';
import { resetWar, declare, intercept, proposeAlliance, endWar, makePeace, giveOrder, handBack } from './war';
import { resetStories, updateStories } from './story';
import { R_HOUSING, R_TAXES, setStudy, updateResearch } from './research';
import { turnLedger, resetLedger } from './ledger';


/* ---------- nations ---------- */
function blankNation(id: number, name: string, hex: string, isPlayer: boolean, code=''): Nation {
  return { id, name, hex, isPlayer, code,
    gold:0, income:0, strength:0, tiles:0, alive:false, capTile:-1, capPlot:-1,
    plots:[], blds:[], bCount:0, houses:0, farms:0, towers:0, mines:0, barracks:0, minters:0, plantations:0, quarries:0, copperMines:0, labs:0, guilds:0, smithies:0, beds:0,
    sumX:0, sumY:0, ltx:0, lty:0, peak:0, expandAt:0, attackAt:0, ratio:0, nextThink:0, nextWar:0, nextOffer:0, nextWave:0, wallR:0, nextWall:0, unpaid:0,
    soldierShare:0, humanProg:0, villagers:0, soldiers:0, training:0, beggars:0, homeless:0, taxpayers:0, stock:[0,0,0], abandoned:0, surplusTicks:0,
    study:R_HOUSING, tier:[1,1,1,1,1,1], xp:[0,0,0,0,0,0], invest:0.5, gain:new Array(180).fill(0), spend:new Array(180).fill(0) };
}
function makeNation(id: number, k: Country, isPlayer: boolean): Nation {
  const srand=W.srand;
  const n={ ...blankNation(id,k.name,k.hex,isPlayer,k.code), gold:GOLD_START, alive:true,
    expandAt:0.22+srand()*0.25, attackAt:0.5+srand()*0.3, ratio:0.3+srand()*0.25, nextThink:1+srand()*2, nextWar:100+srand()*100 };
  // the player starts with no soldiers requested; bots keep a fixed share of their own
  n.soldierShare = isPlayer ? 0 : 0.15+W.prand()*0.35;
  return n;
}
/** A country for a new kingdom from `pool`, its colour far enough from those taken (less fussy if it must). */
function pickCountry(pool: Country[], taken: Country[]){
  for (const gap of [0.3, 0.18, 0]){
    const ok=pool.filter(k => !taken.includes(k) && taken.every(o => colourGap(o.hex,k.hex)>=gap));
    if (ok.length) return ok[(W.srand()*ok.length)|0];
  }
  return undefined;
}

function blockOK(bx: number, by: number){
  if (bx<0||by<0||bx+1>=PW||by+1>=PH) return false;
  for (let y=by*4;y<by*4+8;y++) for (let x=bx*4;x<bx*4+8;x++){ const t=y*TW+x; if (!isLand[t]||terr[t]===T_MOUNT||terr[t]===T_SNOW||owner[t]) return false; }
  return true;
}
/** Nearest 2x2-plot block around tile (tx,ty) where a capital can be founded, or null. */
export function findBlock(tx: number, ty: number, maxR: number): [number, number] | null {
  const bx0=Math.round(tx/4)-1, by0=Math.round(ty/4)-1;
  for (let r=0;r<=maxR;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (blockOK(bx0+dx,by0+dy)) return [bx0+dx,by0+dy];
  }
  return null;
}
function spawnNation(n: Nation, bx: number, by: number){
  const cx=(bx+1)*4, cy=(by+1)*4; n.capTile=cy*TW+cx;
  for (let dy=-6;dy<=6;dy++) for (let dx=-6;dx<=6;dx++){
    if (dx*dx+dy*dy>40) continue; const x=cx+dx, y=cy+dy;
    if (x<0||y<0||x>=TW||y>=TH) continue; const t=y*TW+x;
    if (isLand[t] && !owner[t]) setOwner(t,n.id);
  }
  const q=by*PW+bx; n.capPlot=q;
  for (const k of [q,q+1,q+PW,q+PW+1]){ pType[k]=B_CPART; pOwner[k]=n.id; pMain[k]=q; pBurn[k]=0; pHp[k]=0; clearPlot(k); }
  pType[q]=B_CASTLE; on.plotChanged(q);
}

/* ---------- game flow ---------- */
/** Generates a fresh map from `seed` and clears all match state. */
export function newWorld(seed: number, map='gen'){
  W.mapSeed=seed; W.map=REAL_MAPS.includes(map) ? map : 'gen';
  W.srand=mulberry32(seed^0x5bd1e995);
  W.prand=mulberry32(seed^0x2f6b3a1d);
  if (W.map==='gen'){ resizeGrid(GEN_W,GEN_H); genMap(seed); }
  else { resizeGrid(VIEWS[W.map].w,VIEWS[W.map].h); genRealMap(W.map,7); }   // a real map's ground is the same every match
  genResources();
  owner.fill(0); occ.fill(0); road.fill(0); frontMark.fill(0);
  pType.fill(0); pOwner.fill(0); pBurn.fill(0); pTimer.fill(0); pVar.fill(0); pPrio.fill(0); pAband.fill(0); pHp.fill(0); pTier.fill(0); pSpan.fill(0); pArmor[2].fill(0); pArmor[3].fill(0); W.prioSeq=0;
  W.burning=[]; W.attacks=[]; W.attackSeq=0; W.commands.length=0;
  W.nations=[blankNation(0,'Unclaimed land','#cfc6a8',false)];
  W.M=1; W.contact=new Int32Array(1);
  W.simTime=0; W.tickN=0;
  W.humans=[]; W.humanSeq=0;
  resetWar(1); resetStories(1); resetLedger();
}

/** Founds the player's capital near tile t and places the bot kingdoms: `rivals` of them, countries
    picked at random, or the countries named (codes). Returns false if t has no room.
    Every kingdom is a real country: the player's is `me` (by default, on a real-world map the one
    whose capital is nearest t, else one at random). On a real-world map the bots are founded at
    their countries' real capitals. */
export function startMatch(t: number, rivals: number | string[], me?: string){
  if (t<0) return false;
  const b=findBlock(t%TW,(t/TW)|0,W.map==='gen' ? 4 : 6);   // (a real capital may sit between sea and mountains)
  if (!b) return false;
  if (W.map!=='gen') return startReal(b,rivals,me);
  const srand=W.srand, N=W.nations, taken: Country[]=[];
  const named=Array.isArray(rivals) ? rivals.map(c => countryByCode.get(c)).filter((k): k is Country => !!k && k.code!==me) : null;
  const add=(id: number, k: Country | undefined, player: boolean) => { k??=pickCountry(COUNTRIES,taken)!; taken.push(k); const n=makeNation(id,k,player); N.push(n); return n; };
  const mine=add(1,me ? countryByCode.get(me) : undefined,true);
  if (named) named.forEach((k,i) => add(i+2,k,false));
  else for (let i=0;i<(rivals as number);i++) add(i+2,undefined,false);
  if (named) tellApart(N);
  W.M=N.length; W.contact=new Int32Array(W.M*W.M);
  resetWar(W.M); resetStories(W.M);
  spawnNation(mine,b[0],b[1]);
  const caps=[mine.capTile];
  for (let i=2;i<W.M;i++){
    const n=N[i]; let placed=false, minD=34;
    for (let tries=0;tries<1500 && !placed;tries++){
      if (tries%120===119) minD=Math.max(12,minD-3);
      const lt=W.landTiles[(srand()*W.landTiles.length)|0], x=lt%TW, y=(lt/TW)|0;
      const bx=Math.round(x/4)-1, by=Math.round(y/4)-1;
      if (!blockOK(bx,by)) continue;
      const cx=(bx+1)*4, cy=(by+1)*4;
      if (caps.some(c=>Math.hypot(c%TW-cx,((c/TW)|0)-cy)<minD)) continue;
      spawnNation(n,bx,by); caps.push(n.capTile); placed=true;
    }
    if (!placed){ n.alive=false; }
  }
  census();
  return true;
}

/** Kingdoms whose flags give nearly the same colour: each later one a shade lighter or darker. */
function tellApart(N: Nation[]){
  for (let i=2;i<N.length;i++){
    const clash=(hex: string) => N.slice(1,i).some(o => colourGap(o.hex,hex)<0.1);
    if (!clash(N[i].hex)) continue;
    for (const f of [0.72,1.3,0.55,1.5]){ const h=shade(N[i].hex,f); if (!clash(h)){ N[i].hex=h; break; } }
  }
}
const shade = (hex: string, f: number) => '#'+[1,3,5].map(i => Math.max(0,Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*f))).toString(16).padStart(2,'0')).join('');

/** startMatch on a real-world map: the player founded at block b; the bots at their real capitals,
    either the countries named, or (a number of them) as far apart as the map allows, in colours
    that tell them apart. */
function startReal(b: [number, number], rivals: number | string[], me?: string){
  const N=W.nations, caps=capitalsOn(W.map), cx=(b[0]+1)*4, cy=(b[1]+1)*4;
  const near=caps.slice().sort((p,q) => Math.hypot(p.tile%TW-cx,((p.tile/TW)|0)-cy)-Math.hypot(q.tile%TW-cx,((q.tile/TW)|0)-cy));
  const mine=(me ? countryByCode.get(me) : undefined) ?? near[0]?.country ?? pickCountry(COUNTRIES,[])!;
  const meN=makeNation(1,mine,true); N.push(meN);
  const chosen: { country: Country; tile: number }[]=[];
  if (Array.isArray(rivals)){
    // the countries named, at their capitals (those this map has)
    for (const code of rivals){ const p=caps.find(c => c.country.code===code); if (p && p.country!==mine && !chosen.some(c => c.country===p.country)) chosen.push(p); }
  } else {
    // the bots' countries: capitals far enough apart, colours distinct, in a shuffled order
    const pool=caps.filter(p => p.country!==mine);
    for (let i=pool.length-1;i>0;i--){ const j=(W.srand()*(i+1))|0; [pool[i],pool[j]]=[pool[j],pool[i]]; }
    // on the world map, the great powers first, and only then the rest
    const groups=W.map==='world' ? [pool.filter(p => MAJOR.has(p.country.code)), pool.filter(p => !MAJOR.has(p.country.code))] : [pool];
    const placed=[[cx,cy]], taken=[mine];
    for (const group of groups) for (const [minD, gap] of [[24,0.3],[24,0.18],[16,0.12],[11,0]] as const){
      for (const p of group){
        if (chosen.length>=rivals) break;
        if (chosen.some(c => c.country===p.country)) continue;
        const x=p.tile%TW, y=(p.tile/TW)|0;
        if (placed.some(([px,py]) => Math.hypot(px-x,py-y)<minD) || taken.some(o => colourGap(o.hex,p.country.hex)<gap)) continue;
        if (!findBlock(x,y,3)) continue;
        chosen.push(p); placed.push([x,y]); taken.push(p.country);
      }
    }
  }
  chosen.forEach((c,i) => N.push(makeNation(i+2,c.country,false)));
  if (Array.isArray(rivals)) tellApart(N);
  W.M=N.length; W.contact=new Int32Array(W.M*W.M);
  resetWar(W.M); resetStories(W.M);
  spawnNation(meN,b[0],b[1]);
  // each at its capital, or as near it as there is room (close capitals push each other apart)
  chosen.forEach((c,i) => { const n=N[i+2], blk=findBlock(c.tile%TW,(c.tile/TW)|0,6); if (blk) spawnNation(n,blk[0],blk[1]); else n.alive=false; });
  census();
  return true;
}

/** True if nation a shares a land border with nation o (0 = unclaimed land). Read-only. */
export function bordersOn(a: number, o: number){
  for (let t=0;t<NT;t++) if (owner[t]===o && isLand[t] && touches(t,a)) return true;
  return false;
}

/* ---------- commands ---------- */
export function queueCommand(c: Command){ W.commands.push(c); }

// The simulation is the authority: a command is re-checked here, whatever the client saw.
function applyCommand(c: Command){
  if (c.type==='attack'){
    // gold settles unclaimed land; another kingdom's land is taken only by war (sim/war.ts)
    const n=W.nations[c.nation]; if (!n || !n.alive || c.tile<0 || !isLand[c.tile]) return;
    const o=owner[c.tile]; if (o!==0) return;
    scanContacts(false);
    if (!W.contact[c.nation*W.M+o]) return;
    const send=n.gold*c.ratio;
    if (send<2) return;
    launch(c.nation,o,send);
  } else if (c.type==='soldiers'){
    const n=W.nations[c.nation]; if (!n || !n.alive) return;
    n.soldierShare=Math.min(1,Math.max(0,c.share));
  } else if (c.type==='build'){
    const n=W.nations[c.nation]; if (n) build(n,c.plot,c.kind);
  } else if (c.type==='priority'){
    const n=W.nations[c.nation]; if (n && n.alive) togglePriority(n,c.plot);
  } else if (c.type==='ally'){
    proposeAlliance(c.nation,c.target);
  } else if (c.type==='war'){
    scanContacts(false);
    declare(c.nation,c.target,c.raid,c.units ?? c.soldiers ?? 0);
  } else if (c.type==='intercept'){
    intercept(c.nation,c.campaign,c.units ?? c.soldiers ?? 0);
  } else if (c.type==='order'){
    giveOrder(c.nation,c.campaign,c.x,c.y,c.foe ?? -1);
  } else if (c.type==='auto'){
    handBack(c.nation,c.campaign);
  } else if (c.type==='endWar'){
    endWar(c.nation,c.target);
  } else if (c.type==='peace'){
    const M=W.M; if (c.target>0 && c.target<M && W.offers[c.target*M+c.nation]) makePeace(c.nation,c.target);
  } else if (c.type==='invest'){
    const n=W.nations[c.nation]; if (n && n.alive) n.invest=Math.min(1,Math.max(0,c.share));
  } else if (c.type==='research'){
    const n=W.nations[c.nation]; if (n && n.alive) setStudy(n,c.topic);
  }
}

/* ---------- simulation tick ---------- */
/** Gold a second before wages: the passive income and the villagers' tax, with the minters' share. */
export const grossIncome = (n: Nation) => (GOLD_PER_SEC+TAX_PER_VILLAGER*n.tier[R_TAXES]*n.taxpayers)*(1+0.1*n.minters);
export function tick(){
  if (W.commands.length){ for (const c of W.commands) applyCommand(c); W.commands.length=0; }
  W.simTime+=TICK; W.tickN++;
  turnLedger();
  const N=W.nations;
  // passive income plus each villager's tax (more with taxation research), each coin minter adding
  // 10% to that, less the soldiers' wages; the treasury can go below zero
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive) continue;
    n.income=grossIncome(n)-WAGE*n.soldiers; n.gold+=n.income*TICK;   // only housed, working villagers pay
  }
  for (const A of W.attacks) if (!A.done) stepAttack(A);
  if (W.tickN%2===0) W.attacks=W.attacks.filter(A=>!A.done);
  const burning=W.burning;
  for (let i=burning.length-1;i>=0;i--){ const q=burning[i]; pBurn[q]-=TICK; if (pBurn[q]<=0){ burning[i]=burning[burning.length-1]; burning.pop(); toRuins(q); } }
  if (W.tickN%10===0) census();
  for (let i=1;i<N.length;i++){ const n=N[i]; if (n.alive && !n.isPlayer && W.simTime>=n.nextThink) botThink(n); }
  produce();
  updateResearch();
  updatePopulation();
  updateStories();
  for (let i=1;i<N.length;i++){
    const n=N[i];
    n.strength = n.alive ? n.tiles*STR_TILE + n.villagers*STR_VILLAGER + n.soldiers*STR_SOLDIER + Math.max(0,n.gold)*STR_GOLD : 0;
  }
}
