/* ---------- game flow: ties the simulation to this browser's screen ---------- */
import { TW, PLAYER, PLAYER_COL, B_SMITHY, B_TOWER } from './core/constants';
import { clamp, fmt } from './core/util';
import { W, owner, isLand, pType } from './sim/state';
import { listen } from './sim/events';
import { newWorld, startMatch, bordersOn, queueCommand, tick } from './sim/sim';
import { client } from './client';
import { cam, fitCam, focusOn } from './render/camera';
import { buildBase, paintAll, paintRoad, paintTile, repaint } from './render/terrain';
import { drawPlotAndNeighbours } from './render/sprites';
import { drawNature, redrawNature } from './render/nature';
import { addFlash, fireBurst, gatePuff, addShot, addHit, dustPuff, addCorpse, floats, resetEffects } from './render/effects';
import { GOOD_NAME } from './sim/resources';
import { PW } from './core/constants';
import { resetStyles } from './render/style';
import { resetLabels, resetGhosts, noteBlow, noteSwing, noteArrow } from './render/render';
import { onStory } from './ui/story';
import { resetPeople } from './render/people';
import { resetSpeech } from './render/speech';
import { setupBuildPanel, toggleBuildPanel } from './ui/build';
import { ui, log, toast, showHUD, checkEnd, onEliminated, onCapitalFell, onBuildingPlaced } from './ui/hud';
import { setupDiplomacy, resetDiplomacy, noteDeath } from './ui/diplomacy';
import { refreshResearch, closeResearch } from './ui/research';
import { closeArmy } from './ui/army';
import { TIER_NAME } from './sim/army';
import { R_CASTLE } from './sim/research';
import { TOPIC_NAME } from './sim/research';
import { $ } from './ui/dom';

// what the simulation does, shown on screen
listen({
  tileChanged: (t,o) => { repaint(t); addFlash(t,o); },
  plotChanged: q => drawPlotAndNeighbours(q),
  roadBuilt: paintRoad,
  plotIgnited: q => fireBurst(q),
  buildingPlaced: onBuildingPlaced,
  capitalFell: onCapitalFell,
  eliminated: onEliminated,
  roleChanged: gatePuff,
  resChanged: redrawNature,
  towerShot: (x0,y0,x1,y1,kill,victim) => { addShot(x0,y0,x1,y1,kill); noteArrow(victim,x0,y0,x1,y1); },
  // "+5 wood" over your own plantations, quarries and mines when they deliver
  produced: (q,id,good,amount) => { if (id===PLAYER) floats.push({ x:(q%PW)*8+8, y:((q/PW)|0)*8-1, text:`+${amount} ${GOOD_NAME[good]}`, t0:performance.now(), c:GOOD_COL[good] }); },
  // war
  hit: (x,y,kill,victim,attacker) => { addHit(x,y,kill); noteBlow(victim,attacker); },
  swing: noteSwing,
  story: onStory,
  died: (x,y,o,id,kind,tier) => { addCorpse(x,y,o,id,kind,tier); noteDeath(id,o,kind); },
  occupied: paintTile,
  bldHit: dustPuff,
  plunder: (id,x,y,gold) => { if (id===PLAYER) floats.push({ x, y:y-4, text:`+${gold} gold`, t0:performance.now(), c:'#ffe27a' }); },
  warBegan: (a,d,raid) => {
    if (a===PLAYER) log(`Your soldiers muster to ${raid?'raid':'attack'} ${nm(d)}`,'good');
    else if (d===PLAYER){ log(`${nm(a)} ${raid?'is raiding you':'has declared war on you'}!`,'bad'); toast(`${nm(a)} ${raid?'raids':'attacks'} you`); }
    else log(`${nm(a)} ${raid?'raids':'goes to war with'} ${nm(d)}`);
  },
  armyHome: (a,d,raid,why) => {
    if (d===PLAYER && raid && why==='recall'){ log(`${nm(a)} calls its raiders home: catch them before they get there`); return; }
    if (a!==PLAYER) return;
    if (why==='cut'){ log(`The way to ${nm(d)} is blocked: your ${raid?'raiders':'army'} turn back`,'bad'); toast(`Your ${raid?'raid':'attack'} on ${nm(d)} was cut off`); }
    else if (why==='done') log(`Nothing left to burn in ${nm(d)}: your raiders head home`,'good');
    else if (why==='recall') log(`Your raiders head home from ${nm(d)}: they can still be caught on the way`);
  },
  armyGone: (a,d,_raid,why) => { if (a===PLAYER && why==='lost') log(`Your army in ${nm(d)} has been wiped out`,'bad'); },
  peaceOffered: (from,to) => { if (to===PLAYER){ log(`${nm(from)} offers peace: click the war at the top to accept`,'good'); toast(`${nm(from)} offers peace`); } },
  peaceRefused: (from,to) => { if (from===PLAYER) toast(`${nm(to)} refuses peace: they think they can win`); },
  peaceMade: (a,b) => { if (a===PLAYER || b===PLAYER) log(`Peace with ${nm(a===PLAYER?b:a)}`,'good'); else log(`${nm(a)} and ${nm(b)} make peace`); },
  allied: (a,b) => { if (a===PLAYER || b===PLAYER){ const o=a===PLAYER?b:a; log(`${nm(o)} is now your ally: your soldiers may cross each other's land`,'good'); toast(`Alliance with ${nm(o)}`); } },
  allyRefused: (a,_b,why) => { if (a===PLAYER) toast(why); },
  allianceBroken: (a,b) => { if (b===PLAYER) log(`${nm(a)} broke your alliance`,'bad'); },
  counterReady: (o,e) => { if (o===PLAYER){ log(`Your land is free of ${nm(e)}: your army is ready to counter-attack`,'good'); toast('Ready to counter-attack'); } },
  intercepting: (o,e,k) => {
    if (o===PLAYER) log(`${k} of your soldiers march out to meet ${nm(e)}'s army`,'good');
    else if (e===PLAYER) log(`${nm(o)} sends ${k} soldiers to meet your army`,'bad');
  },
  // research and the builders guild
  researched: (o,topic,tier) => {
    if (topic===R_CASTLE){ const n=W.nations[o]; if (n.capTile>=0) drawPlotAndNeighbours(n.capPlot); }   // the castle is rebuilt at once
    if (o===PLAYER){ log(`Your scholars reach ${TOPIC_NAME[topic].toLowerCase()} tier ${tier}: ${TIER_NEWS[topic][tier]}`,'good'); toast(`${TOPIC_NAME[topic]} tier ${tier}`); } refreshResearch(); },
  upgraded: (q,o,tier) => { dustPuff(q); if (o===PLAYER) floats.push({ x:(q%PW)*8+4, y:((q/PW)|0)*8-1, text: tier===3 ? 'Manor' : 'Stone house', t0:performance.now(), c:'#f0e6c8' }); },
  builderHired: (q,o,replaced) => { if (o===PLAYER && replaced) log(pType[q]===B_SMITHY ? 'A villager takes up the fallen smith\'s hammer' : 'A villager takes up the fallen builder\'s tools at the guild'); },
  forged: (q,o,tier) => { if (o===PLAYER) floats.push({ x:(q%PW)*8+4, y:((q/PW)|0)*8-1, text:`Armour ${TIER_NAME[tier]}`, t0:performance.now(), c:'#dfe6ec' }); },
  deserted: (o,x,y,tier,gold) => {
    if (o!==PLAYER) return;
    log(gold ? `Unpaid, a soldier lays down his arms; his armour is scrapped for ${gold} gold` : 'Unpaid, a soldier lays down his arms and goes back to work','bad');
    floats.push({ x, y:y-6, text: gold ? `+${gold} gold` : 'Deserted', t0:performance.now(), c: gold ? '#ffe27a' : '#ff9a8a' });
  },
  armored: (id,x,y,tier) => { gatePuff(x,y-2,1); if (W.humans.find(h => h.id===id)?.o===PLAYER) floats.push({ x, y:y-6, text:`Armour ${TIER_NAME[tier]}`, t0:performance.now(), c:'#dfe6ec' }); },
  annexed: (loser,winner) => { if (winner===PLAYER){ log(`You took the castle of ${nm(loser)}: its land and people are yours`,'good'); toast(`${nm(loser)} is yours`); } },
});
const GOOD_COL=['#e9b26a','#dcd6cc','#ffa060'];
const TIER_NEWS=[['','','your builders guild can raise stone houses','your builders guild can raise manors'],['','','each villager pays 0.2 gold a second','each villager pays 0.3 gold a second'],
  ['','','your blacksmith can forge reinforced armour','your blacksmith can forge heavy armour'],
  ['','','your builders can rebuild watchtowers stronger','your builders can rebuild watchtowers into keeps'],
  ['','','your castle is rebuilt into a fortress','your castle is rebuilt into a citadel'],
  ['','','plantations, quarries and copper mines side by side join in pairs','plantations, quarries and copper mines join in squares of four']];
const nm = (id: number) => W.nations[id]?.name ?? 'Someone';
export function newGame(seed?: number){
  newWorld(seed ?? (Math.random()*2147483647)|0);
  resetStyles(); resetLabels(); resetEffects(); resetGhosts(); resetPeople(); resetSpeech();
  toggleBuildPanel(false); resetDiplomacy(); closeResearch(); closeArmy();
  client.overShown=false; client.lastVillageLog=-99; client.paused=false; client.speed=1; $('speed').textContent='1×';
  setSoldierShare(0); setInvest(0.5);
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
  focusOn(me.capTile, Math.max(cam.fitZ*2.2, 1.8*cam.dpr));
  log(`${me.name} is founded. Expand fast while the land is empty.`,'good');
}

/** Settling unclaimed land: spend `ratio` of the treasury pushing the border toward tile t.
    (Other kingdoms' land opens diplomacy.) */
export function playerAttack(t: number, ratio=0.4){
  const me=W.nations[PLAYER]; if (!me || !me.alive || t<0 || !isLand[t] || owner[t]) return;
  // the order always goes to the simulation, which has the final say; the checks here are only for feedback
  queueCommand({ type:'attack', nation:PLAYER, tile:t, ratio });
  if (!bordersOn(PLAYER,0)){ toast('Your border no longer touches unclaimed land'); return; }
  const send=me.gold*ratio;
  if (send<2){ toast('Not enough gold yet'); return; }
  floats.push({x:(t%TW)*2+1, y:((t/TW)|0)*2, text:'−'+fmt(send)+' gold', t0:performance.now(), c:'#ffe27a'});
}

/** Asks the kingdom to keep `v` (0..1) of its people as soldiers. */
export function setSoldierShare(v: number){
  v=clamp(v,0,1); soldiersEl.value=String(Math.round(v*100)); $('soldiersVal').textContent=Math.round(v*100)+'%'; soldiersEl.style.setProperty('--fill',(v*100)+'%');
  if (W.nations[PLAYER]) queueCommand({ type:'soldiers', nation:PLAYER, share:v });
}
const soldiersEl=$('soldiers') as HTMLInputElement;
const investEl=$('invest') as HTMLInputElement;
/** City investment: the share (0..1) of the goods coming in that the builders may spend. */
export function setInvest(v: number){
  v=clamp(v,0,1); investEl.value=String(Math.round(v*100)); $('investVal').textContent=Math.round(v*100)+'%'; investEl.style.setProperty('--fill',(v*100)+'%');
  if (W.nations[PLAYER]) queueCommand({ type:'invest', nation:PLAYER, share:v });
}

export function centerHome(){ const me=W.nations[PLAYER]; if (!me) return; const t=me.capTile>=0?me.capTile:(me.lty*TW+me.ltx); focusOn(t,Math.max(cam.zoom,cam.fitZ*2.2)); }
export function setPaused(p: boolean){ client.paused=p; $('pause').innerHTML = p ? '<svg viewBox="0 0 9 9"><path fill="currentColor" d="M2 1h1v1h1v1h1v1h1v1H5v1H4v1H3v1H2z"/></svg>' : '<svg viewBox="0 0 9 9"><path fill="currentColor" d="M2 1h2v7H2zM5 1h2v7H5z"/></svg>'; $('pause').setAttribute('aria-label',p?'Resume':'Pause'); if (p) toast('Paused'); }
