/* ---------- game flow: ties the simulation to this browser's screen ---------- */
import { TW, PLAYER, B_SMITHY, B_TOWER } from './core/constants';
import { flagCSS } from './render/flags';
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
import { resetSpeech, say, pick, LINES } from './render/speech';
import { RANKS } from './sim/war';
import { setupBuildPanel, toggleBuildPanel } from './ui/build';
import { ui, log, toast, showHUD, checkEnd, onEliminated, onCapitalFell, onBuildingPlaced } from './ui/hud';
import { setupDiplomacy, resetDiplomacy, noteDeath } from './ui/diplomacy';
import { refreshResearch, closeResearch } from './ui/research';
import { closeArmy } from './ui/army';
import { deselect } from './ui/command';
import { TIER_NAME } from './sim/army';
import { R_CASTLE } from './sim/research';
import { TOPIC_NAME } from './sim/research';
import { $ } from './ui/dom';

// what the simulation does, shown on screen
listen({
  tileChanged: (t,o) => { repaint(t); addFlash(t,o); },
  plotChanged: q => drawPlotAndNeighbours(q),
  roadBuilt: paintRoad,
  plotIgnited: q => { fireBurst(q); if (pType[q]===B_TOWER) drawPlotAndNeighbours(q); },   // its walls come down
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
  // an army's leader gives his orders aloud, and the log tells of those that matter to you
  order: (kind,a,d,rank,id,x,y) => {
    const r=RANKS[rank].toLowerCase();
    if (kind==='fell' || kind==='slain'){
      // whoever is nearest cries it out
      let best=-1, bd=40*40; for (const h of W.humans) if (h.o===a && h.kind===1 && h.hp>0 && h.id!==id){ const e=(h.x-x)**2+(h.y-y)**2; if (e<bd){ bd=e; best=h.id; } }
      if (best>=0) say(best,`The ${r} has fallen!`);
    } else if (LINES[kind]) say(id,pick(LINES[kind]));
    const t=ORDER_LOG[kind]; if (!t) return;
    if (a===PLAYER){ const [text,mood]=t.mine(r,nm(d)); log(text,mood); if (kind==='fell' || kind==='slain' || kind==='retreat') toast(text.split(':')[0]); }
    else if (d===PLAYER && t.theirs){ const [text,mood]=t.theirs(r,nm(a)); log(text,mood); }
  },
  annexed: (loser,winner) => { if (winner===PLAYER){ log(`You took the castle of ${nm(loser)}: its land and people are yours`,'good'); toast(`${nm(loser)} is yours`); } },
});
const GOOD_COL=['#e9b26a','#dcd6cc','#ffa060'];
type Mood = 'good' | 'bad' | undefined;
const ORDER_LOG: Record<string, { mine: (r: string, foe: string) => [string, Mood]; theirs?: (r: string, foe: string) => [string, Mood] }> = {
  hold: { mine: (r,f) => [`Your ${r} halts at the border of ${f}: too few men to attack, he waits for reinforcements`,'bad'],
          theirs: (r,f) => [`The ${r} of ${f}'s army halts at your border, waiting for reinforcements`,'good'] },
  assault: { mine: (r,f) => [`Your ${r} gives the order: into ${f}, attack!`,'good'],
             theirs: (r,f) => [`An army of ${f} under its ${r} crosses into your land`,'bad'] },
  retreat: { mine: (r,f) => [`Your army in ${f} is bled white: its ${r} falls back to make good the losses`,'bad'],
             theirs: (r,f) => [`${f}'s army falls back from your land to regroup`,'good'] },
  stand: { mine: (r,f) => [`Your ${r} refuses to retreat: your army in ${f} fights to the death!`,'good'],
           theirs: (r,f) => [`${f}'s ${r} refuses to retreat: his army fights to the death`,'bad'] },
  regroup: { mine: (r,f) => [`Your ${r} regroups outside ${f}: he attacks again once 60% of his army is back`,undefined],
             theirs: (_r,f) => [`${f}'s army regroups at your border`,'bad'] },
  home: { mine: (r,f) => [`No reinforcements came: your ${r} takes the army home from ${f}`,'bad'],
          theirs: (_r,f) => [`${f}'s army gives up and goes home`,'good'] },
  fell: { mine: (r,f) => [`Your ${r} has fallen: for the rest of the war with ${f}, his barracks' soldiers charge leaderless, one by one`,'bad'],
          theirs: (r,f) => [`You killed the ${r} of ${f}'s army: its soldiers fight on leaderless`,'good'] },
  resume: { mine: (r,_f) => [`Your ${r} takes charge of his army again`,undefined] },
  slain: { mine: (r,f) => [`Your ${r} has fallen fighting ${f}`,'bad'],
           theirs: (r,f) => [`You killed the ${r} of ${f}'s army`,'good'] },
};
const TIER_NEWS=[['','','your builders guild can raise stone houses','your builders guild can raise manors'],['','','each villager pays 0.2 gold a second','each villager pays 0.3 gold a second'],
  ['','','your blacksmith can forge reinforced armour','your blacksmith can forge heavy armour'],
  ['','','your builders can rebuild watchtowers stronger','your builders can rebuild watchtowers into keeps'],
  ['','','your castle is rebuilt into a fortress','your castle is rebuilt into a citadel'],
  ['','','plantations, quarries and copper mines side by side join in pairs','plantations, quarries and copper mines join in squares of four']];
const nm = (id: number) => W.nations[id]?.name ?? 'Someone';
/** The maps, in the order New map goes through them: three generated ones, then three of the real world. */
export const MAPS: { name: string; map: string; seed?: number }[] = [
  { name:'Emberland', map:'gen', seed:4242 },
  { name:'Greywater', map:'gen', seed:987654321 },
  { name:'Highmarch', map:'gen', seed:12345 },
  { name:'Balkans & Anatolia', map:'balkans' },
  { name:'Europe', map:'europe' },
  { name:'The World', map:'world' },
];
/** Starts afresh on the current map (MAPS), or with `seed`, on a map generated from it. */
export function newGame(seed?: number){
  const m=MAPS[client.mapIndex];
  if (seed!==undefined) newWorld(seed);
  else newWorld(m.seed ?? (Math.random()*2147483647)|0, m.map);
  $('mapName').textContent=`${m.name} · ${client.mapIndex+1}/${MAPS.length}`;
  ui.banner.textContent = W.map==='gen' ? 'Tap open land to found your capital' : 'Tap open land to found your capital: you play the country whose capital is nearest';
  resetStyles(); resetLabels(); resetEffects(); resetGhosts(); resetPeople(); resetSpeech();
  toggleBuildPanel(false); resetDiplomacy(); closeResearch(); closeArmy(); deselect();
  client.overShown=false; client.lastVillageLog=-99; client.paused=false; client.speed=1; $('speed').textContent='1×';
  setSoldierShare(0); setInvest(0.5);
  buildBase(); paintAll(); drawNature();
  fitCam();
}

/** On to the next map of MAPS. */
export function nextMap(){ client.mapIndex=(client.mapIndex+1)%MAPS.length; newGame(); }

/** One simulation step plus the checks this client makes after it. */
export function step(){
  tick();
  if (W.tickN%10===5) checkEnd();
}

export function trySpawn(t: number){
  if (t<0) return;
  if (!startMatch(t, +($('rivals') as HTMLSelectElement).value)){ toast('Pick open land away from water and mountains'); return; }
  const me=W.nations[PLAYER];
  $('meName').textContent=me.name; $('meCrest').style.cssText=flagCSS(me.code);
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
