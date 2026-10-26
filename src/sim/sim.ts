/* ---------- simulation entry points: worlds, matches, commands, ticks ----------
   No DOM, no canvas: this runs the same in a browser, a server or a test. */
import { TW, TH, NT, PW, PH, TICK, T_MOUNT, T_SNOW, B_CASTLE, B_CPART, BOT_COLS, PLAYER_COL, GOLD_START, GOLD_PER_SEC, TAX_PER_VILLAGER, WAGE, STR_TILE, STR_VILLAGER, STR_SOLDIER, STR_GOLD } from '../core/constants';
import { mulberry32 } from '../core/rng';
import { W, owner, occ, isLand, terr, road, frontMark, pType, pOwner, pVar, pMain, pBurn, pTimer, pPrio, pAband, pHp, pTier, pSpan, pArmor, type Nation, type Command } from './state';
import { on } from './events';
import { genMap } from './mapgen';
import { setOwner, stepAttack, launch, touches } from './territory';
import { toRuins, build, togglePriority, produce } from './buildings';
import { scanContacts, census } from './census';
import { botThink } from './bots';
import { updatePopulation } from './population';
import { genResources, clearPlot } from './resources';
import { resetWar, declare, intercept, proposeAlliance, endWar, makePeace } from './war';
import { resetStories, updateStories } from './story';
import { R_HOUSING, R_TAXES, setStudy, updateResearch } from './research';
import { turnLedger, resetLedger } from './ledger';

const SYL1 = ['Val','Mor','Ost','Kar','Bre','Thal','Ves','Dun','Ard','Sel','Hal','Ner','Cor','Ith','Rav','Lun','Gor','Eld','Tor','Fen','Ash','Ul','Bel','Kes','Myr','Oak','Sar','Wen'];
const SYL2 = ['mark','heim','dor','gard','ia','or','wyn','vale','mere','rath','holm','ford','ain','esk','ora','burg','moor','reach','fell','haven'];

/* ---------- nations ---------- */
function blankNation(id: number, name: string, hex: string, isPlayer: boolean): Nation {
  return { id, name, hex, isPlayer,
    gold:0, income:0, strength:0, tiles:0, alive:false, capTile:-1, capPlot:-1,
    plots:[], blds:[], bCount:0, houses:0, farms:0, towers:0, mines:0, barracks:0, minters:0, plantations:0, quarries:0, copperMines:0, labs:0, guilds:0, smithies:0, beds:0,
    sumX:0, sumY:0, ltx:0, lty:0, peak:0, expandAt:0, attackAt:0, ratio:0, nextThink:0, nextWar:0, nextOffer:0, nextWave:0, unpaid:0,
    soldierShare:0, humanProg:0, villagers:0, soldiers:0, training:0, beggars:0, homeless:0, taxpayers:0, stock:[0,0,0], abandoned:0, surplusTicks:0,
    study:R_HOUSING, tier:[1,1,1,1,1,1], xp:[0,0,0,0,0,0], invest:0.5, gain:new Array(180).fill(0), spend:new Array(180).fill(0) };
}
function makeNation(id: number, name: string, hex: string, isPlayer: boolean): Nation {
  const srand=W.srand;
  const n={ ...blankNation(id,name,hex,isPlayer), gold:GOLD_START, alive:true,
    expandAt:0.22+srand()*0.25, attackAt:0.5+srand()*0.3, ratio:0.3+srand()*0.25, nextThink:1+srand()*2, nextWar:100+srand()*100 };
  // the player starts with no soldiers requested; bots keep a fixed share of their own
  n.soldierShare = isPlayer ? 0 : 0.15+W.prand()*0.35;
  return n;
}
function nameGen(used: Set<string>){
  const srand=W.srand;
  for (let i=0;i<60;i++){ const n=SYL1[(srand()*SYL1.length)|0]+SYL2[(srand()*SYL2.length)|0]; if (!used.has(n)){ used.add(n); return n; } }
  return 'Realm '+used.size;
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
export function newWorld(seed: number){
  W.mapSeed=seed;
  W.srand=mulberry32(seed^0x5bd1e995);
  W.prand=mulberry32(seed^0x2f6b3a1d);
  genMap(seed);
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

/** Founds the player's capital near tile t and places `rivals` bot kingdoms. Returns false if t has no room. */
export function startMatch(t: number, rivals: number){
  if (t<0) return false;
  const b=findBlock(t%TW,(t/TW)|0,4);
  if (!b) return false;
  const srand=W.srand, N=W.nations, used=new Set<string>();
  const me=makeNation(1,nameGen(used),PLAYER_COL,true);
  N.push(me);
  for (let i=0;i<rivals;i++) N.push(makeNation(i+2,nameGen(used),BOT_COLS[i%BOT_COLS.length],false));
  W.M=N.length; W.contact=new Int32Array(W.M*W.M);
  resetWar(W.M); resetStories(W.M);
  spawnNation(me,b[0],b[1]);
  const caps=[me.capTile];
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
