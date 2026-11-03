/* ---------- stationing an army on a border, the HOI4 way ----------
   The Armies panel's "Assign border" button starts it: the pointer then picks the stretch of border (a kingdom's, on one landmass)
   to send the army to; the stretch nearest the pointer is lit on the map, and a click sends the army there (sim/war.ts assignArmy), wherever
   it is now, in peace or in war. Right-click or Esc lets go. */
import { PLAYER, TW, RS } from '../core/constants';
import { W, owner } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { bordersOf, frontInfo, type Border } from '../sim/war';
import { unitAt } from '../sim/army';
import { client } from '../client';
import { cam, tileAt } from '../render/camera';
import { armyName } from './armies';
import { ui, toast } from './hud';

const DIRS = ['east','south-east','south','south-west','west','north-west','north','north-east'];
const MIL=-2;
const nm = (o: number) => W.nations[o]?.name ?? 'the enemy';

/** The stretches of border with o, named by where they lie from our castle ("North-east front"; one border alone is just "Border"), by landmass. */
export function frontNames(o: number){
  const me=W.nations[PLAYER], out=new Map<number, string>(), used=new Map<string, number>(), fs=frontInfo(PLAYER,o);
  const [px,py]=me.capTile>=0 ? [me.capTile%TW, (me.capTile/TW)|0] : [fs[0]?.x ?? 0, fs[0]?.y ?? 0];
  for (const f of fs){
    const dir=DIRS[(Math.round(Math.atan2(f.y-py,f.x-px)/(Math.PI/4))+8)%8], k=(used.get(dir) ?? 0)+1; used.set(dir,k);
    out.set(f.isle,fs.length>1 ? `${dir[0].toUpperCase()+dir.slice(1)} front${k>1 ? ' '+k : ''}` : 'Border');
  }
  return out;
}
const armyLabel = (key: number) => { if (key===MIL) return 'Militia'; const u=unitAt(key); return u ? armyName(W.nations[PLAYER],u) : 'Army'; };
const placeName = (b: Border) => { const f=frontNames(b.d); return f.size>1 ? `${nm(b.d)} · ${f.get(b.isle)}` : nm(b.d); };

/** The army with key `key` (a barracks', or -2 for the militia) is to be sent: the map now picks its border. */
export function startAssign(key: number){
  client.assigning={ key, hot:null };
  client.placing=0; client.landing=null; client.settling=0;
  ui.banner.textContent=`Assigning ${armyLabel(key)}: point at a border and click to send it there · right-click or Esc to cancel`; ui.banner.hidden=false;
}
export function cancelAssign(){ if (!client.assigning) return; client.assigning=null; ui.banner.hidden=true; }

/** The pointer is at device pixel (sx,sy): light the stretch of border it means. On a neighbour's land it is that kingdom's nearest stretch;
    elsewhere the nearest one within a short reach. */
export function assignHover(sx: number, sy: number){
  const A=client.assigning; if (!A) return;
  const t=tileAt(sx,sy); let hot: Border | null=null;
  if (t>=0){
    const px=t%TW, py=(t/TW)|0, own=owner[t], onForeign=own!==0 && own!==PLAYER, reach=(56*cam.dpr)/(cam.zoom*RS);
    let best=Infinity;
    for (const b of bordersOf(PLAYER)){
      if (onForeign && b.d!==own) continue;
      for (const q of b.tiles){ const d=(q%TW-px)**2+(((q/TW)|0)-py)**2; if (d<best){ best=d; hot=b; } }
    }
    if (hot && !onForeign && best>reach*reach) hot=null;
  }
  if (hot?.d!==A.hot?.d || hot?.isle!==A.hot?.isle) ui.banner.textContent = hot
    ? `${armyLabel(A.key)} → ${placeName(hot)}: click to send it there · right-click or Esc to cancel`
    : `Assigning ${armyLabel(A.key)}: point at a border and click to send it there · right-click or Esc to cancel`;
  A.hot=hot;
}

/** A click: send the army to the border lit, if there is one. */
export function assignClick(){
  const A=client.assigning; if (!A) return;
  if (!A.hot){ toast('Point at a border: it lights up'); return; }
  queueCommand({ type:'assign', nation:PLAYER, army:A.key, target:A.hot.d, isle:A.hot.isle });
  toast(`${armyLabel(A.key)} goes to ${placeName(A.hot)}`);
  cancelAssign();
}
