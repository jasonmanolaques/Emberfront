/* ---------- army command: right-click an army's leader to take it in hand ----------
   While an army is selected its soldiers are ringed in gold, and a small panel says whether its
   leader decides (Automated) or the player does (Manual). Right-clicking open ground or your own
   land gathers it there in ranks; an enemy army, hunts it; an enemy kingdom's land, attacks there
   (sim/war.ts giveOrder). Esc, the ×, or right-clicking another leader lets go without an order.
   A leaderless army can't be selected, and losing the leader ends the selection. */
import { K, PLAYER } from '../core/constants';
import { W, owner, isLand, type Campaign } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { RANKS, O_MOVE, O_HUNT, O_LAND, orderKind, atWar } from '../sim/war';
import { unitAt } from '../sim/army';
import { tileOf } from '../sim/population';
import { client } from '../client';
import { cam } from '../render/camera';
import { armyName } from './armies';
import { toast } from './hud';
import { $ } from './dom';

const panel=$('command'), modeBtn=$('cmMode') as HTMLButtonElement;
/** Where the last order was given, for a moment's marker on the map (render.ts). */
export const orderPing={ x:0, y:0, t0:-1e9, kind:0 };

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

/** Keeps the panel in step with the army (each HUD refresh). */
export function refreshCommand(){
  if (client.selected<0) return;
  const c=selectedArmy();
  if (!c){ deselect(); return; }
  panel.hidden=false;
  const bar=$('bar'); panel.style.setProperty('--barH', (bar.hidden ? 0 : bar.offsetHeight)+'px');
  $('cmName').textContent=nameOf(c);
  const manual=c.manual>0;
  modeBtn.textContent=manual ? 'Manual' : 'Automated';
  modeBtn.setAttribute('aria-pressed',String(manual));
  modeBtn.title=manual ? 'You command this army. Click to hand it back to its leader.' : 'Its leader decides what it does. Give it an order to take command.';
  $('cmHint').textContent=!manual ? 'Right-click open ground or your land to gather there, an enemy army to hunt it, or enemy land to attack there. Esc lets go.'
    : !c.orderDone ? (c.manual===O_MOVE ? 'Marching to gather and form ranks there.' : c.manual===O_HUNT ? 'Hunting the enemy army.' : 'Attacking there.')
    : 'Order carried out: it holds there. On enemy land or under fire, its leader takes over after 3 seconds.';
}
modeBtn.addEventListener('click',() => { const c=selectedArmy(); if (c && c.manual) queueCommand({ type:'auto', nation:PLAYER, campaign:c.id }); });
$('cmClose').addEventListener('click',deselect);

/** A right-click on the map at device pixel (sx,sy): select a leader, or give the selected army an order. */
export function rightClick(sx: number, sy: number){
  const wx=(cam.x+sx/cam.zoom)/K, wy=(cam.y+sy/cam.zoom)/K, r=Math.max(3,16*cam.dpr/cam.zoom/K);
  const humans=new Map(W.humans.map(h => [h.id,h]));
  // one of our leaders: take that army in hand (or, if it has none, say so)
  let pick: Campaign | undefined, bd=(r*1.3)**2;
  for (const c of W.campaigns){
    if (c.a!==PLAYER || c.phase===2 || c.leader<0) continue;
    const l=humans.get(c.leader); if (!l) continue;
    const d=(l.x-wx)**2+(l.y-2-wy)**2; if (d<bd){ bd=d; pick=c; }
  }
  if (pick){ selectArmy(pick.id); return; }
  const c=selectedArmy();
  if (!c){
    // a soldier of a leaderless army of ours
    for (const h of W.humans) if (h.o===PLAYER && h.war>=0 && (h.x-wx)**2+(h.y-2-wy)**2<r*r){ const k=find(h.war); if (k && k.leader<0 && k.phase<2){ toast('Without its leader, this army fights on its own'); return; } }
    return;
  }
  // an enemy army under the cursor: hunt it
  let foe=-1; bd=r*r;
  for (const h of W.humans){
    if (h.war<0 || h.o===PLAYER || !atWar(PLAYER,h.o)) continue;
    const d=(h.x-wx)**2+(h.y-2-wy)**2; if (d<bd){ const E=find(h.war); if (E && E.hostile){ bd=d; foe=E.id; } }
  }
  const kind=orderKind(c,wx,wy,foe);
  if (!kind){
    const t=tileOf(wx,wy), o=t>=0 && wx>=0 && wy>=0 ? owner[t] : 0;
    toast(foe>=0 ? 'Raiders can only hunt the army of the kingdom they raid' : !isLand[t] ? 'Your army can\'t go there'
      : o ? `You are not at war with ${W.nations[o].name}` : 'Your army can\'t go there');
    return;
  }
  queueCommand({ type:'order', nation:PLAYER, campaign:c.id, x:wx, y:wy, foe: foe>=0 ? foe : undefined });
  orderPing.x=wx; orderPing.y=wy; orderPing.t0=performance.now(); orderPing.kind=kind;
}
