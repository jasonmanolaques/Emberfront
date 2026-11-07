/* ---------- automatic settlement: a toggle on the kingdom card ----------
   While it is on, every 5 seconds the kingdom pushes its border into unclaimed land with 25% of its gold,
   as if the player had clicked and chosen 25%. When no unclaimed land touches the kingdom's any more it
   switches itself off. */
import { W, owner, isLand } from '../sim/state';
import { PLAYER, TW, TH, GAME_SPEED } from '../core/constants';
import { playerAttack } from '../game';
import { toast } from './hud';
import { $ } from './dom';

export const AUTO_TICKS = 5*GAME_SPEED*10;   // 5 seconds on the clock
export const AUTO_SHARE = 0.25;
let on=false, next=0;
const btn=() => $('autoSettle');

export const autoSettling = () => on;
export function setAutoSettle(v: boolean){
  on=v; next=W.tickN+AUTO_TICKS;
  const b=btn(); b.setAttribute('aria-pressed',String(on)); b.textContent=on ? 'Auto-settle: on' : 'Auto-settle: off';
}
/** An unclaimed land tile beside the kingdom's land (the one nearest its capital), or -1 if there is none. */
export function settleTarget(): number {
  const me=W.nations[PLAYER]; if (!me || !me.alive) return -1;
  const c=me.capTile, cx=c%TW, cy=(c/TW)|0; let best=-1, bd=Infinity;
  for (let y=Math.max(0,me.y0-1);y<=Math.min(TH-1,me.y1+1);y++) for (let x=Math.max(0,me.x0-1);x<=Math.min(TW-1,me.x1+1);x++){
    const t=y*TW+x; if (owner[t] || !isLand[t]) continue;
    if (!((x>0 && owner[t-1]===PLAYER) || (x<TW-1 && owner[t+1]===PLAYER) || (y>0 && owner[t-TW]===PLAYER) || (y<TH-1 && owner[t+TW]===PLAYER))) continue;
    const d=(x-cx)**2+(y-cy)**2; if (d<bd){ bd=d; best=t; }
  }
  return best;
}
/** Called a few times a second: settles when its 5 seconds are up. */
let kingdom: unknown=null;
export function updateAutoSettle(){
  const me=W.nations[PLAYER];
  if (me!==kingdom){ kingdom=me; if (on) setAutoSettle(false); }   // (a new match starts with it off)
  if (!on) return;
  if (!me || !me.alive){ setAutoSettle(false); return; }
  if (W.tickN<next) return;
  next=W.tickN+AUTO_TICKS;
  const t=settleTarget();
  if (t<0){ setAutoSettle(false); toast('Auto-settle off: no land left to settle'); return; }
  if (me.gold*AUTO_SHARE<2) return;   // (not enough gold this time: try again in 5 seconds)
  playerAttack(t,AUTO_SHARE);
}
export function setupAutoSettle(){ btn().addEventListener('click',() => setAutoSettle(!on)); }
