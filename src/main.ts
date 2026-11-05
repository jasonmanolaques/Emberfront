/* ---------- Emberfront: boot & main loop ---------- */
import { TW, TH, RW, RH, RS, NP, TICK, UI_SCALE } from './core/constants';
import { W, owner, isLand, terr, road, pType, pOwner, pVar, pBurn, pTimer, pHp } from './sim/state';
import { findBlock, queueCommand } from './sim/sim';
import { plotProblem, navalSite } from './sim/buildings';
import { client } from './client';
import { view, resize, cam } from './render/camera';
import { ovBuf } from './render/terrain';
import { drawPlotAndNeighbours } from './render/sprites';
import { render } from './render/render';
import { shots } from './render/effects';
import { updateHUD } from './ui/hud';
import { bindInput } from './ui/input';
import { refreshBuildPanel } from './ui/build';
import { $ } from './ui/dom';
import { openArmy } from './ui/army';
import { newGame, step, trySpawn, playerAttack, setInvest, setSoldierShare } from './game';

document.documentElement.style.setProperty('--ui',String(UI_SCALE));
let acc=0, last=performance.now(), hudAt=0;
const STEP_BUDGET = 10;   // milliseconds of each frame the simulation may take (a frame is 16.7)
/* A fault anywhere in a frame must not stop the game: the loop goes on, the fault is shown (once for each kind) in a bar at the foot of the screen with the
   details to copy, and the other parts of the frame still run (the map is still drawn if the simulation or the HUD failed). */
const crash=$('crash'), crashText=$('crashText');
let lastFault='';
function fault(where: string, e: unknown){
  const err=e instanceof Error ? e : new Error(String(e)), msg=`${where}: ${err.message}`;
  console.error(where,e);
  if (msg===lastFault) return;
  lastFault=msg; crashText.textContent=`Something broke (${msg}). The game carries on.`;
  crash.dataset.detail=`${msg}\n${err.stack ?? ''}\ntick ${W.tickN} · ${new Date().toISOString()}`; crash.hidden=false;
}
$('crashCopy').addEventListener('click',() => { try { navigator.clipboard.writeText(crash.dataset.detail ?? ''); } catch { /* no clipboard */ } });
$('crashX').addEventListener('click',() => { crash.hidden=true; });
window.addEventListener('error',e => fault('script',e.error ?? e.message));
window.addEventListener('unhandledrejection',e => fault('promise',e.reason));
function frame(now: number){
  requestAnimationFrame(frame);   // (first: whatever fails below, the next frame comes)
  const dt=Math.min(0.25,(now-last)/1000); last=now;
  const running = client.state==='play' && !client.paused;
  if (running){
    // the game's clock runs on as fast as the machine allows: ticks are run for at most STEP_BUDGET ms of the frame (always one, if one is due),
    // and a backlog the machine can't catch up on is let go, so a heavy late game runs slower rather than freezing the picture for a second
    acc+=dt*client.speed;
    const t0=performance.now(); let n=0;
    try { while (acc>=TICK && n<12 && (n===0 || performance.now()-t0<STEP_BUDGET)){ step(); acc-=TICK; n++; } } catch (e){ acc=0; fault('simulation',e); }
    if (acc>=TICK*2) acc=TICK*2;
  }
  try { render(now, running ? dt*client.speed : (client.state==='play' ? 0 : dt)); } catch (e){ fault('drawing',e); }
  if (now>hudAt && client.state==='play'){ try { updateHUD(now); refreshBuildPanel(); } catch (e){ fault('panels',e); } hudAt=now+200; }
}

bindInput();
new ResizeObserver(resize).observe(view);
resize();
newGame();
requestAnimationFrame(frame);

// test hook
function toSpawn(){ if (client.state!=='spawn'){ $('intro').hidden=true; $('scrim').hidden=true; client.state='spawn'; } }
(window as any).emberfront = { get TW(){return TW;}, get TH(){return TH;}, RS, get state(){return client.state;}, get nations(){return W.nations;}, get simTime(){return W.simTime;}, get landCount(){return W.landCount;},
  spawnAt:(tx: number,ty: number)=>{ if (client.state==="play") return; toSpawn(); trySpawn(ty*TW+tx); },   // (once a match is under way, no second founding)
  randomSpawn:()=>{ toSpawn(); for (let i=0;i<500 && client.state==='spawn';i++){ const t=W.landTiles[(Math.random()*W.landTiles.length)|0]; const b=findBlock(t%TW,(t/TW)|0,0); if (b) trySpawn(t); } },
  run:(n: number)=>{ for (let i=0;i<n;i++) step(); }, attack:(t: number, r?: number)=>playerAttack(t,r), setInvest, setSoldierShare, command:(c: unknown)=>queueCommand(c as never), get humans(){return W.humans;}, get cam(){return cam;},
  get campaigns(){return W.campaigns;}, get W(){return W;},
  get shots(){return shots;},
  setHp:(q: number, v: number)=>{ pHp[q]=v; }, redraw:(q: number)=>drawPlotAndNeighbours(q), openArmy,
  newWorld:(seed?: number)=>newGame(seed), loadMap:(i: number)=>{ client.mapIndex=i; newGame(); },
  navalSites:()=>{ const n=W.nations[1], out: number[]=[]; if (n) for (let q=0;q<NP;q++) if (navalSite(n,q).orient>=0) out.push(q); return out; },
  landing:(o: typeof client.landing)=>{ client.landing=o; },
  freePlots:()=>{ const n=W.nations[1], out: number[]=[]; if (n) for (let q=0;q<NP;q++) if (!plotProblem(n,q)) out.push(q); return out; },
  dump:()=>({ owner, isLand, terr, road, pType, pOwner, pVar, pBurn, pTimer, overview:ovBuf, attacks:W.attacks, campaigns:W.campaigns, tickN:W.tickN }) };
