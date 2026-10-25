/* ---------- game flow: ties the simulation to this browser's screen ---------- */
import { TW, PLAYER, PLAYER_COL } from './core/constants';
import { clamp, fmt } from './core/util';
import { W, owner, isLand } from './sim/state';
import { listen } from './sim/events';
import { newWorld, startMatch, bordersOn, queueCommand, tick } from './sim/sim';
import { client } from './client';
import { cam, fitCam, focusOn } from './render/camera';
import { buildBase, paintAll, paintTile, paintRoad, repaint } from './render/terrain';
import { genObjects, drawPlot } from './render/sprites';
import { addFlash, fireBurst, gatePuff, floats, resetEffects } from './render/effects';
import { resetStyles } from './render/style';
import { resetLabels } from './render/render';
import { ui, log, toast, showHUD, checkEnd, onEliminated, onCapitalFell, onBuildingPlaced } from './ui/hud';
import { $ } from './ui/dom';

// what the simulation does, shown on screen
listen({
  tileChanged: (t,o) => { repaint(t); addFlash(t,o); },
  plotChanged: q => drawPlot(q),
  roadBuilt: t => { paintRoad(t); paintTile(t); },
  plotIgnited: q => fireBurst(q),
  buildingPlaced: onBuildingPlaced,
  capitalFell: onCapitalFell,
  eliminated: onEliminated,
  roleChanged: gatePuff,
});

export function newGame(seed?: number){
  newWorld(seed ?? (Math.random()*2147483647)|0);
  resetStyles(); resetLabels(); resetEffects();
  client.overShown=false; client.lastVillageLog=-99; client.paused=false; client.speed=1; $('speed').textContent='1×';
  setSoldierShare(0);
  buildBase(); paintAll(); genObjects();
  fitCam();
}

/** One simulation step plus the checks this client makes after it. */
export function step(){
  tick();
  if (W.tickN%10===5) checkEnd();
}

export function trySpawn(t: number){
  if (t<0) return;
  if (!startMatch(t, +($('rivals') as HTMLSelectElement).value)){ toast('Pick open land away from water and mountains'); return; }
  const me=W.nations[PLAYER];
  $('meName').textContent=me.name; $('meCrest').style.background=PLAYER_COL;
  client.state='play'; ui.banner.hidden=true; showHUD(true);
  focusOn(me.capTile, Math.max(cam.fitZ*2.2, 3.2*cam.dpr));
  log(`${me.name} is founded. Expand fast while the land is empty.`,'good');
}

export function playerAttack(t: number){
  const me=W.nations[PLAYER]; if (!me || !me.alive || t<0 || !isLand[t]) return;
  const o=owner[t]; if (o===PLAYER) return;
  // the order always goes to the simulation, which has the final say; the checks here are only for feedback
  queueCommand({ type:'attack', nation:PLAYER, tile:t, ratio:client.ratio });
  if (!bordersOn(PLAYER,o)){ toast(o ? `You don't share a border with ${W.nations[o].name}` : 'Your border no longer touches unclaimed land'); return; }
  const send=me.troops*client.ratio;
  if (send<20){ toast('Not enough troops yet'); return; }
  floats.push({x:(t%TW)*2+1, y:((t/TW)|0)*2, text:'−'+fmt(send), t0:performance.now(), c:o?'#ffb29e':'#ffe27a'});
}

/** Asks the kingdom to keep `v` (0..1) of its people as soldiers. */
export function setSoldierShare(v: number){
  v=clamp(v,0,1); soldiersEl.value=String(Math.round(v*100)); $('soldiersVal').textContent=Math.round(v*100)+'%'; soldiersEl.style.setProperty('--fill',(v*100)+'%');
  if (W.nations[PLAYER]) queueCommand({ type:'soldiers', nation:PLAYER, share:v });
}
const soldiersEl=$('soldiers') as HTMLInputElement;
const ratioEl=$('ratio') as HTMLInputElement;
export function setRatio(v: number){ client.ratio=clamp(v,0.05,1); ratioEl.value=String(Math.round(client.ratio*100)); $('ratioVal').textContent=Math.round(client.ratio*100)+'%'; ratioEl.style.setProperty('--fill',((client.ratio*100-5)/95*100)+'%'); }

export function centerHome(){ const me=W.nations[PLAYER]; if (!me) return; const t=me.capTile>=0?me.capTile:(me.lty*TW+me.ltx); focusOn(t,Math.max(cam.zoom,cam.fitZ*2.2)); }
export function setPaused(p: boolean){ client.paused=p; $('pause').innerHTML = p ? '<svg viewBox="0 0 9 9"><path fill="currentColor" d="M2 1h1v1h1v1h1v1h1v1H5v1H4v1H3v1H2z"/></svg>' : '<svg viewBox="0 0 9 9"><path fill="currentColor" d="M2 1h2v7H2zM5 1h2v7H5z"/></svg>'; $('pause').setAttribute('aria-label',p?'Resume':'Pause'); if (p) toast('Paused'); }
