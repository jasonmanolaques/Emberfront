/* ---------- stationing an army on a border, the HOI4 way ----------
   The Armies panel's "Assign border" button starts it: the pointer then picks the stretch of border (a kingdom's, on one landmass)
   to send the army to; the stretch nearest the pointer is lit on the map, and a click sends the army there (sim/war.ts assignArmy), wherever
   it is now, in peace or in war. Right-click or Esc lets go. */
import { PLAYER, TW, RS } from '../core/constants';
import { W, owner } from '../sim/state';
import { queueCommand } from '../sim/sim';
import { bordersOf, frontInfo, SIEGE_RING, type Border } from '../sim/war';
import { originOf, SEC_SIEGE, SECTOR_NAMES } from '../sim/front';
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
/** "Norway · north-west sector", "Norway · siege of the capital", or just the kingdom when its border is one stretch. */
export function placeName(b: { d: number; isle: number; sec: number }){
  if (b.sec===SEC_SIEGE) return `${nm(b.d)} · siege of the capital`;
  const f=frontNames(b.d), parts=bordersOf(PLAYER).filter(x => x.d===b.d && x.sec!==SEC_SIEGE);
  const where=[f.size>1 ? f.get(b.isle) : '', b.sec ? SECTOR_NAMES[b.sec]+' sector' : ''].filter(Boolean).join(', ');
  return parts.length>1 && where ? `${nm(b.d)} · ${where}` : nm(b.d);
}
const HINT='click to send it there · shift-click for the whole border · right-click or Esc to cancel';

/** The army with key `key` (a barracks', or -2 for the militia) is to be sent: the map now picks its border. */
export function startAssign(key: number){
  client.assigning={ key, hot:null };
  client.placing=0; client.landing=null; client.settling=0;
  ui.banner.textContent=`Assigning ${armyLabel(key)}: point at a border (or at a capital, to besiege it) and ${HINT}`; ui.banner.hidden=false;
}
export function cancelAssign(){ if (!client.assigning) return; client.assigning=null; ui.banner.hidden=true; }

/** The pointer is at device pixel (sx,sy): light the part of the border it means. Near a capital it is the siege of it; on a neighbour's land that kingdom's
    nearest part; elsewhere the nearest one within a short reach. */
export function assignHover(sx: number, sy: number){
  const A=client.assigning; if (!A) return;
  const t=tileAt(sx,sy); let hot: Border | null=null;
  if (t>=0){
    const px=t%TW, py=(t/TW)|0, own=owner[t], onForeign=own!==0 && own!==PLAYER, reach=(56*cam.dpr)/(cam.zoom*RS), list=bordersOf(PLAYER);
    for (const b of list) if (b.sec===SEC_SIEGE){ const [cx,cy]=originOf(b.d); if (Math.hypot(px-cx,py-cy)<=SIEGE_RING+3){ hot=b; break; } }
    if (!hot){
      let best=Infinity;
      for (const b of list){
        if (b.sec===SEC_SIEGE || (onForeign && b.d!==own)) continue;
        for (const q of b.tiles){ const d=(q%TW-px)**2+(((q/TW)|0)-py)**2; if (d<best){ best=d; hot=b; } }
      }
      if (hot && !onForeign && best>reach*reach) hot=null;
    }
  }
  if (hot?.d!==A.hot?.d || hot?.isle!==A.hot?.isle || hot?.sec!==A.hot?.sec) ui.banner.textContent = hot
    ? `${armyLabel(A.key)} → ${placeName(hot)}: ${HINT}`
    : `Assigning ${armyLabel(A.key)}: point at a border (or at a capital, to besiege it) and ${HINT}`;
  A.hot=hot;
}

/** A click: send the army to the part of the border lit, if there is one (with shift, to the whole stretch of border on that landmass). */
export function assignClick(whole=false){
  const A=client.assigning; if (!A) return;
  if (!A.hot){ toast('Point at a border: it lights up'); return; }
  const sec=whole && A.hot.sec!==SEC_SIEGE ? 0 : A.hot.sec, label=whole && sec===0 ? nm(A.hot.d) : placeName(A.hot);
  queueCommand({ type:'assign', nation:PLAYER, army:A.key, target:A.hot.d, isle:A.hot.isle, sec });
  toast(`${armyLabel(A.key)} goes to ${label}`);
  cancelAssign();
}
