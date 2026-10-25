/* ---------- game flow: ties the simulation to this browser's screen ---------- */
import { TW, PLAYER, PLAYER_COL } from './core/constants';
import { clamp, fmt } from './core/util';
import { W, owner, isLand } from './sim/state';
import { listen } from './sim/events';
import { newWorld, startMatch, bordersOn, queueCommand, tick } from './sim/sim';
import { client } from './client';
import { cam, fitCam, focusOn } from './render/camera';
import { buildBase, paintAll, paintTile, paintRoad, repaint } from './render/terrain';
import { drawPlotAndNeighbours } from './render/sprites';
import { drawNature, redrawNature } from './render/nature';
import { addFlash, fireBurst, gatePuff, addShot, addHit, dustPuff, floats, resetEffects } from './render/effects';
import { GOOD_NAME } from './sim/resources';
import { PW } from './core/constants';
import { resetStyles } from './render/style';
import { resetLabels, resetGhosts } from './render/render';
import { setupBuildPanel, toggleBuildPanel } from './ui/build';
import { ui, log, toast, showHUD, checkEnd, onEliminated, onCapitalFell, onBuildingPlaced } from './ui/hud';
import { setupDiplomacy, resetDiplomacy } from './ui/diplomacy';
import { $ } from './ui/dom';

// what the simulation does, shown on screen
listen({
  tileChanged: (t,o) => { repaint(t); addFlash(t,o); },
  plotChanged: q => drawPlotAndNeighbours(q),
  roadBuilt: t => { paintRoad(t); paintTile(t); },
  plotIgnited: q => fireBurst(q),
  buildingPlaced: onBuildingPlaced,
  capitalFell: onCapitalFell,
  eliminated: onEliminated,
  roleChanged: gatePuff,
  resChanged: redrawNature,
  towerShot: addShot,
  // "+5 wood" over your own plantations, quarries and mines when they deliver
  produced: (q,id,good,amount) => { if (id===PLAYER) floats.push({ x:(q%PW)*8+8, y:((q/PW)|0)*8-1, text:`+${amount} ${GOOD_NAME[good]}`, t0:performance.now(), c:GOOD_COL[good] }); },
  // war
  hit: addHit,
  bldHit: dustPuff,
  plunder: (id,x,y,gold) => { if (id===PLAYER) floats.push({ x, y:y-4, text:`+${gold} gold`, t0:performance.now(), c:'#ffe27a' }); },
  warBegan: (a,d,raid) => {
    if (a===PLAYER) log(`Your soldiers muster to ${raid?'raid':'attack'} ${nm(d)}`,'good');
    else if (d===PLAYER){ log(`${nm(a)} ${raid?'is raiding you':'has declared war on you'}!`,'bad'); toast(`${nm(a)} ${raid?'raids':'attacks'} you`); }
    else log(`${nm(a)} ${raid?'raids':'goes to war with'} ${nm(d)}`);
  },
  armyHome: (a,d,raid,why) => {
    if (a!==PLAYER) return;
    if (why==='cut'){ log(`The way to ${nm(d)} is blocked: your ${raid?'raiders':'army'} turn back`,'bad'); toast(`Your ${raid?'raid':'attack'} on ${nm(d)} was cut off`); }
    else if (why==='done') log(`Nothing left to burn in ${nm(d)}: your raiders head home`,'good');
    else if (why==='recall') log(`Your raiders head home from ${nm(d)}`);
  },
  armyGone: (a,d,_raid,why) => { if (a===PLAYER && why==='lost') log(`Your army in ${nm(d)} has been wiped out`,'bad'); },
  peaceOffered: (from,to) => { if (to===PLAYER){ log(`${nm(from)} offers peace: click the war at the top to accept`,'good'); toast(`${nm(from)} offers peace`); } },
  peaceRefused: (from,to) => { if (from===PLAYER) toast(`${nm(to)} refuses peace: they think they can win`); },
  peaceMade: (a,b) => { if (a===PLAYER || b===PLAYER) log(`Peace with ${nm(a===PLAYER?b:a)}`,'good'); else log(`${nm(a)} and ${nm(b)} make peace`); },
  allied: (a,b) => { if (a===PLAYER || b===PLAYER){ const o=a===PLAYER?b:a; log(`${nm(o)} is now your ally: your soldiers may cross each other's land`,'good'); toast(`Alliance with ${nm(o)}`); } },
  allyRefused: (a,_b,why) => { if (a===PLAYER) toast(why); },
  allianceBroken: (a,b) => { if (b===PLAYER) log(`${nm(a)} broke your alliance`,'bad'); },
  annexed: (loser,winner) => { if (winner===PLAYER){ log(`You took the castle of ${nm(loser)}: its land and people are yours`,'good'); toast(`${nm(loser)} is yours`); } },
});
const GOOD_COL=['#e9b26a','#dcd6cc','#ffa060'];
const nm = (id: number) => W.nations[id]?.name ?? 'Someone';
export function newGame(seed?: number){
  newWorld(seed ?? (Math.random()*2147483647)|0);
  resetStyles(); resetLabels(); resetEffects(); resetGhosts();
  toggleBuildPanel(false); resetDiplomacy();
  client.overShown=false; client.lastVillageLog=-99; client.paused=false; client.speed=1; $('speed').textContent='1×';
  setSoldierShare(0);
  buildBase(); paintAll(); drawNature();
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
  setupBuildPanel(); setupDiplomacy();
  focusOn(me.capTile, Math.max(cam.fitZ*2.2, 3.2*cam.dpr));
  log(`${me.name} is founded. Expand fast while the land is empty.`,'good');
}

/** A click on unclaimed land: spend gold to push the border there. (Other kingdoms' land opens diplomacy.) */
export function playerAttack(t: number){
  const me=W.nations[PLAYER]; if (!me || !me.alive || t<0 || !isLand[t] || owner[t]) return;
  // the order always goes to the simulation, which has the final say; the checks here are only for feedback
  queueCommand({ type:'attack', nation:PLAYER, tile:t, ratio:client.ratio });
  if (!bordersOn(PLAYER,0)){ toast('Your border no longer touches unclaimed land'); return; }
  const send=me.gold*client.ratio;
  if (send<2){ toast('Not enough gold yet'); return; }
  floats.push({x:(t%TW)*2+1, y:((t/TW)|0)*2, text:'−'+fmt(send)+' gold', t0:performance.now(), c:'#ffe27a'});
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
