/* ---------- Emberfront: boot & main loop ---------- */
import { TW, TH, RW, RH, NP, TICK } from './core/constants';
import { W, owner, isLand, terr, road, pType, pOwner, pVar, pBurn, pTimer, pHp } from './sim/state';
import { findBlock, queueCommand } from './sim/sim';
import { plotProblem } from './sim/buildings';
import { client } from './client';
import { view, resize, cam } from './render/camera';
import { wbuf } from './render/terrain';
import { octx, drawPlotAndNeighbours } from './render/sprites';
import { render } from './render/render';
import { shots } from './render/effects';
import { updateHUD } from './ui/hud';
import { bindInput } from './ui/input';
import { refreshBuildPanel } from './ui/build';
import { $ } from './ui/dom';
import { openArmy } from './ui/army';
import { newGame, step, trySpawn, playerAttack, setInvest, setSoldierShare } from './game';

let acc=0, last=performance.now(), hudAt=0;
function frame(now: number){
  const dt=Math.min(0.25,(now-last)/1000); last=now;
  const running = client.state==='play' && !client.paused;
  if (running){ acc+=dt*client.speed; let n=0; while (acc>=TICK && n<12){ step(); acc-=TICK; n++; } if (n>=12) acc=0; }
  render(now, running ? dt*client.speed : (client.state==='play' ? 0 : dt));
  if (now>hudAt && client.state==='play'){ updateHUD(now); refreshBuildPanel(); hudAt=now+200; }
  requestAnimationFrame(frame);
}

bindInput();
new ResizeObserver(resize).observe(view);
resize();
newGame();
requestAnimationFrame(frame);

// test hook
function toSpawn(){ if (client.state!=='spawn'){ $('intro').hidden=true; $('scrim').hidden=true; client.state='spawn'; } }
(window as any).emberfront = { TW, TH, get state(){return client.state;}, get nations(){return W.nations;}, get simTime(){return W.simTime;}, get landCount(){return W.landCount;},
  spawnAt:(tx: number,ty: number)=>{ toSpawn(); trySpawn(ty*TW+tx); },
  randomSpawn:()=>{ toSpawn(); for (let i=0;i<500 && client.state==='spawn';i++){ const t=W.landTiles[(Math.random()*W.landTiles.length)|0]; const b=findBlock(t%TW,(t/TW)|0,0); if (b) trySpawn(t); } },
  run:(n: number)=>{ for (let i=0;i<n;i++) step(); }, attack:(t: number, r?: number)=>playerAttack(t,r), setInvest, setSoldierShare, command:(c: unknown)=>queueCommand(c as never), get humans(){return W.humans;}, get cam(){return cam;},
  get campaigns(){return W.campaigns;}, get W(){return W;},
  get shots(){return shots;},
  setHp:(q: number, v: number)=>{ pHp[q]=v; }, redraw:(q: number)=>drawPlotAndNeighbours(q), openArmy,
  newWorld:(seed?: number)=>newGame(seed), loadMap:(i: number)=>{ client.mapIndex=i; newGame(); },
  freePlots:()=>{ const n=W.nations[1], out: number[]=[]; if (n) for (let q=0;q<NP;q++) if (!plotProblem(n,q)) out.push(q); return out; },
  dump:()=>({ owner, isLand, terr, road, pType, pOwner, pVar, pBurn, pTimer, wbuf, obj:octx.getImageData(0,0,RW,RH).data, attacks:W.attacks, campaigns:W.campaigns, tickN:W.tickN }) };
