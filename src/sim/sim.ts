/* ---------- simulation entry points: worlds, matches, commands, ticks ----------
   No DOM, no canvas: this runs the same in a browser, a server or a test. */
import { TW, TH, NT, PW, PH, TICK, T_MOUNT, T_SNOW, B_CASTLE, B_CPART, BOT_COLS, PLAYER_COL, GOLD_START, GOLD_PER_SEC, TAX_PER_VILLAGER, STR_TILE, STR_VILLAGER, STR_SOLDIER, STR_GOLD } from '../core/constants';
import { mulberry32 } from '../core/rng';
import { W, owner, isLand, terr, road, frontMark, pType, pOwner, pVar, pMain, pBurn, pTimer, pPrio, pAband, type Nation, type Command } from './state';
import { on } from './events';
import { genMap } from './mapgen';
import { setOwner, stepAttack, launch, touches } from './territory';
import { toRuins, build, togglePriority } from './buildings';
import { scanContacts, census } from './census';
import { botThink } from './bots';
import { updatePopulation } from './population';
import { genResources, clearPlot } from './resources';

const SYL1 = ['Val','Mor','Ost','Kar','Bre','Thal','Ves','Dun','Ard','Sel','Hal','Ner','Cor','Ith','Rav','Lun','Gor','Eld','Tor','Fen','Ash','Ul','Bel','Kes','Myr','Oak','Sar','Wen'];
const SYL2 = ['mark','heim','dor','gard','ia','or','wyn','vale','mere','rath','holm','ford','ain','esk','ora','burg','moor','reach','fell','haven'];

/* ---------- nations ---------- */
function blankNation(id: number, name: string, hex: string, isPlayer: boolean): Nation {
  return { id, name, hex, isPlayer,
    gold:0, income:0, strength:0, tiles:0, alive:false, capTile:-1, capPlot:-1,
    plots:[], blds:[], bCount:0, houses:0, farms:0, towers:0, mines:0, barracks:0, minters:0,
    sumX:0, sumY:0, ltx:0, lty:0, peak:0, expandAt:0, attackAt:0, ratio:0, nextThink:0,
    soldierShare:0, humanProg:0, villagers:0, soldiers:0, training:0, stock:[0,0,0], abandoned:0, surplusTicks:0 };
}
function makeNation(id: number, name: string, hex: string, isPlayer: boolean): Nation {
  const srand=W.srand;
  const n={ ...blankNation(id,name,hex,isPlayer), gold:GOLD_START, alive:true,
    expandAt:0.22+srand()*0.25, attackAt:0.5+srand()*0.3, ratio:0.3+srand()*0.25, nextThink:1+srand()*2 };
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
  for (const k of [q,q+1,q+PW,q+PW+1]){ pType[k]=B_CPART; pOwner[k]=n.id; pMain[k]=q; pBurn[k]=0; clearPlot(k); }
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
  owner.fill(0); road.fill(0); frontMark.fill(0);
  pType.fill(0); pOwner.fill(0); pBurn.fill(0); pTimer.fill(0); pVar.fill(0); pPrio.fill(0); pAband.fill(0); W.prioSeq=0;
  W.burning=[]; W.attacks=[]; W.attackSeq=0; W.commands.length=0;
  W.nations=[blankNation(0,'Unclaimed land','#cfc6a8',false)];
  W.M=1; W.contact=new Int32Array(1);
  W.simTime=0; W.tickN=0;
  W.humans=[]; W.humanSeq=0;
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
    const n=W.nations[c.nation]; if (!n || !n.alive || c.tile<0 || !isLand[c.tile]) return;
    const o=owner[c.tile]; if (o===c.nation) return;
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
  }
}

/* ---------- simulation tick ---------- */
export function tick(){
  if (W.commands.length){ for (const c of W.commands) applyCommand(c); W.commands.length=0; }
  W.simTime+=TICK; W.tickN++;
  const N=W.nations;
  // passive income plus each villager's tax; each coin minter adds 10% to the total
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive) continue;
    n.income=(GOLD_PER_SEC+TAX_PER_VILLAGER*n.villagers)*(1+0.1*n.minters); n.gold+=n.income*TICK;
  }
  for (const A of W.attacks) if (!A.done) stepAttack(A);
  if (W.tickN%2===0) W.attacks=W.attacks.filter(A=>!A.done);
  const burning=W.burning;
  for (let i=burning.length-1;i>=0;i--){ const q=burning[i]; pBurn[q]-=TICK; if (pBurn[q]<=0){ burning[i]=burning[burning.length-1]; burning.pop(); toRuins(q); } }
  if (W.tickN%10===0) census();
  for (let i=1;i<N.length;i++){ const n=N[i]; if (n.alive && !n.isPlayer && W.simTime>=n.nextThink) botThink(n); }
  updatePopulation();
  for (let i=1;i<N.length;i++){
    const n=N[i];
    n.strength = n.alive ? n.tiles*STR_TILE + n.villagers*STR_VILLAGER + n.soldiers*STR_SOLDIER + n.gold*STR_GOLD : 0;
  }
}
