/* ---------- research panel: opened by clicking a research station ----------
   One button per topic with its tier and a progress bar below; the topic being studied is lit.
   Clicking the other topic switches to it (progress made on each is kept). */
import { PLAYER, PS, B_RESEARCH } from '../core/constants';
import { W } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { R_HOUSING, R_TAXES, R_INFANTRY, R_TOWERS, R_CASTLE, R_GATHER, TOPIC_NAME, MAX_TIER, XP_PER_STATION, xpNeeded, maxed } from '../sim/research';
import { drawIcon } from '../render/sprites';
import { styleOf } from '../render/style';
import { closeDiplomacy, diplomacyOpen } from './diplomacy';
import { $ } from './dom';

const panel=$('research'), rate=$('rRate');
// what each tier brings, by topic and tier
const NEXT = [
  ['', '', 'Stone houses: room for 2 people, 3× as hard to burn. Needs a builders guild.', 'Manors: room for 3 people, 6× as hard to burn as a hovel.'],
  ['', '', 'Each villager pays 0.2 gold a second.', 'Each villager pays 0.3 gold a second.'],
  ['', '', 'Reinforced soldiers: 10 hit points, 1.5 damage. Needs a blacksmith.', 'Heavy armour: 15 hit points, 2 damage.'],
  ['', '', 'Builders can rebuild watchtowers to shoot every 3.5 s for 3 damage and take 30 blows (10 stone, 4 wood).', 'Builders can rebuild them to shoot every 3 s for 4 damage and take 40 blows (20 stone, 8 wood).'],
  ['', '', 'The castle shoots twice every 3.5 s for 3 damage and takes 200 blows.', 'The castle shoots twice every 3 s for 4 damage and takes 300 blows.'],
  ['', '', 'Plantations, quarries and copper mines side by side join in pairs: +5 wood, +3 stone, +3 copper.', 'Four in a square join into one: +15 wood, +10 stone, +10 copper.'],
];
const ROWS: Record<number, string> = { [R_HOUSING]:'rHousing', [R_INFANTRY]:'rInfantry', [R_TOWERS]:'rTowers', [R_CASTLE]:'rCastle', [R_GATHER]:'rGather', [R_TAXES]:'rTaxes' };
const topics=[R_HOUSING, R_INFANTRY, R_TOWERS, R_CASTLE, R_GATHER, R_TAXES].map(t => {
  const root=$(ROWS[t]);
  const button=root.querySelector('button')!, tier=root.querySelector('.ttier') as HTMLElement, bar=root.querySelector('.tbar i') as HTMLElement,
    count=root.querySelector('.tbar span') as HTMLElement, note=root.querySelector('.tnote') as HTMLElement;
  button.addEventListener('click', () => { queueCommand({ type:'research', nation:PLAYER, topic:t }); });
  return { t, root, button, tier, bar, count, note };
});

export const researchOpen = () => !panel.hidden;
export function openResearch(){
  const c=$('rIcon') as HTMLCanvasElement; c.width=PS; c.height=PS; drawIcon(c.getContext('2d')!,B_RESEARCH,styleOf(PLAYER));
  if (diplomacyOpen()) closeDiplomacy();
  $('army').hidden=true;
  panel.hidden=false; refreshResearch();
}
export function closeResearch(){ panel.hidden=true; }
$('rClose').addEventListener('click', closeResearch);

/** Brings the panel up to date with the player's research (cheap; skipped while it is closed). */
export function refreshResearch(){
  const me=W.nations[PLAYER]; if (panel.hidden || !me) return;
  const pts=me.labs*XP_PER_STATION;
  rate.textContent = me.labs ? `${me.labs} station${me.labs>1?'s':''} · ${pts} point${pts>1?'s':''} a second` : 'No research station standing: research has stopped';
  for (const o of topics){
    const done=maxed(me,o.t), need=xpNeeded(me,o.t), have=me.xp[o.t]/10, on=me.study===o.t && !done;
    o.root.classList.toggle('on', on); o.root.classList.toggle('done', done);
    o.button.setAttribute('aria-pressed', String(on)); o.button.disabled=done;
    o.button.querySelector('.tname')!.textContent=TOPIC_NAME[o.t];
    o.tier.textContent='Tier '+me.tier[o.t]+(done ? ' · complete' : on ? ' · studying' : '');
    o.bar.style.width=(done ? 100 : Math.min(100,have/need*100))+'%';
    o.count.textContent = done ? `Tier ${MAX_TIER} reached` : `${Math.floor(have)} / ${need}`;
    o.note.textContent = done ? 'Fully researched.' : `Next: ${NEXT[o.t][me.tier[o.t]+1]}`;
  }
}
