/* ---------- army command: right-click an army's leader to see it, and give its war the word ----------
   While an army is selected its soldiers are ringed in gold, and a small panel says what it is
   doing: gathering on the front, ready, attacking or holding; a raid marching to the border,
   waiting there or raiding. Its button gives the word for its war (sim/war.ts setOffensive), the
   same as the button under the war chip: attack all along the front, or hold where it stands; a
   raid waiting at the border, go in. Esc, the × or right-clicking elsewhere lets go. A leaderless
   army can't be selected, and losing the leader ends the selection. */
import { K, PLAYER } from '../core/constants';
import { W, type Campaign } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { RANKS, F_READY, F_PUSH, F_HOLD, M_MARCH, M_HOLD } from '../sim/war';
import { unitAt } from '../sim/army';
import { client } from '../client';
import { cam } from '../render/camera';
import { armyName } from './armies';
import { toast } from './hud';
import { $ } from './dom';

const panel=$('command'), modeBtn=$('cmMode') as HTMLButtonElement;

const find = (id: number) => W.campaigns.find(c => c.id===id);
/** Can the player take this army in hand? */
const commandable = (c: Campaign | undefined): c is Campaign => !!c && c.a===PLAYER && c.phase<2 && c.hostile && c.leader>=0;
export const selectedArmy = () => { const c=find(client.selected); return commandable(c) ? c : undefined; };

export function selectArmy(id: number){ client.selected=id; refreshCommand(); }
export function deselect(){ client.selected=-1; panel.hidden=true; }

/** The army's name: its barracks' quarter and its leader's rank. */
function nameOf(c: Campaign){
  const n=W.nations[c.a], u=unitAt(c.unit);
  const base=u && u.o===c.a ? armyName(n,u).replace(/barracks$/i,'army').replace(/^Barracks$/,'Army') : 'Army';
  return `${base} · ${RANKS[c.rank]} · ${c.members.length} men`;
}
/** What the army's button does now: [label, go, enabled, hint]. */
function word(c: Campaign): [string, boolean, boolean, string] {
  const foe=W.nations[c.d]?.name ?? 'the enemy';
  if (c.raid){
    if (c.go) return ['Raiding', true, false, c.mode===M_MARCH ? `Marching to the border of ${foe}: it goes straight in.` : `Burning ${foe}'s buildings for loot. Recall it from the war bar.`];
    return c.mode===M_HOLD ? ['Start the raid', true, true, `Waiting at the border of ${foe} for your word.`]
      : ['Raid on arrival', true, true, `Marching to the border of ${foe}, where it waits for your word (or give it now).`];
  }
  const st=W.offensive[c.a*W.M+c.d];
  if (st===F_PUSH) return ['Hold the front', false, true, `Attacking ${foe} all along the front. Hold, and it stands where it is.`];
  if (st===F_HOLD) return ['Attack', true, true, `Holding the front against ${foe}.`];
  if (st===F_READY) return ['Attack', true, true, `In place on the border of ${foe}: give the word to attack.`];
  return ['Attack', true, true, `Gathering on the border of ${foe}. You can give the word before everyone is in place.`];
}

/** Keeps the panel in step with the army (each HUD refresh). */
export function refreshCommand(){
  if (client.selected<0) return;
  const c=selectedArmy();
  if (!c){ deselect(); return; }
  panel.hidden=false;
  const bar=$('bar'); panel.style.setProperty('--barH', (bar.hidden ? 0 : bar.offsetHeight)+'px');
  $('cmName').textContent=nameOf(c);
  const [label,go,enabled,hint]=word(c);
  modeBtn.textContent=label; modeBtn.disabled=!enabled; modeBtn.dataset.go=go ? '1' : '';
  modeBtn.setAttribute('aria-pressed',String(!c.raid && W.offensive[c.a*W.M+c.d]===F_PUSH));
  modeBtn.title=hint;
  $('cmHint').textContent=hint;
}
modeBtn.addEventListener('click',() => {
  const c=selectedArmy(); if (!c || modeBtn.disabled) return;
  queueCommand({ type:'offensive', nation:PLAYER, target:c.d, go:!!modeBtn.dataset.go });
});
$('cmClose').addEventListener('click',deselect);

/** A right-click on the map at device pixel (sx,sy): select the leader there, or let go. */
export function rightClick(sx: number, sy: number){
  const wx=(cam.x+sx/cam.zoom)/K, wy=(cam.y+sy/cam.zoom)/K, r=Math.max(3,16*cam.dpr/cam.zoom/K);
  const humans=new Map(W.humans.map(h => [h.id,h]));
  let pick: Campaign | undefined, bd=(r*1.3)**2;
  for (const c of W.campaigns){
    if (c.a!==PLAYER || c.phase===2 || c.leader<0) continue;
    const l=humans.get(c.leader); if (!l) continue;
    const d=(l.x-wx)**2+(l.y-2-wy)**2; if (d<bd){ bd=d; pick=c; }
  }
  if (pick){ selectArmy(pick.id); return; }
  // a soldier of an army of ours without a leader
  for (const h of W.humans) if (h.o===PLAYER && h.war>=0 && (h.x-wx)**2+(h.y-2-wy)**2<r*r){ const k=find(h.war); if (k && k.leader<0 && k.phase<2){ toast('This army has no leader: give its war the word from the war bar'); return; } }
  if (selectedArmy()) deselect();
}
