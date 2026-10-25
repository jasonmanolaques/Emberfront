/* ---------- input: pointer, wheel, keys, buttons, tooltip ---------- */
import { TNAME, TMULT, PLAYER } from '../core/constants';
import { fmt } from '../core/util';
import { W, owner, occ, terr, isLand } from '../sim/state';
import { allied, atWar } from '../sim/war';
import { client } from '../client';
import { view, cam, clampCam, zoomAt, tileAt } from '../render/camera';
import { hover } from '../render/render';
import { ui, showHUD } from './hud';
import { $ } from './dom';
import { newGame, trySpawn, playerAttack, setRatio, setSoldierShare, centerHome, setPaused } from '../game';
import { placeAt, clickOwnBuilding, stopPlacing, toggleBuildPanel } from './build';
import { openDiplomacy, closeDiplomacy, diplomacyOpen, closePop } from './diplomacy';
import { researchOpen, closeResearch } from './research';

interface Drag { sx: number; sy: number; lx: number; ly: number; moved: boolean; button: number; }
const pointers=new Map<number,{x: number; y: number}>(); let drag: Drag | null=null, pinch: {d: number; mx: number; my: number} | null=null;
function devXY(e: MouseEvent): [number, number] { const r=view.getBoundingClientRect(); return [(e.clientX-r.left)*cam.dpr,(e.clientY-r.top)*cam.dpr]; }

function updateTip(e: PointerEvent){
  if (!hover.mouse || client.state!=='play' || hover.tile<0 || !isLand[hover.tile] || drag?.moved){ ui.tip.hidden=true; return; }
  const t=hover.tile, o=owner[t], tr=terr[t], landCount=W.landCount;
  let l1, l2;
  if (o){ const n=W.nations[o]; l1=n.name+(n.isPlayer?' (you)':''); l2=`Strength ${fmt(n.strength)} · ${(n.tiles/landCount*100).toFixed(1)}% of land`; }
  else { l1='Unclaimed land'; l2='1 gold a tile to settle'; }
  let l3=TNAME[tr]+(!o && TMULT[tr]>1.05?` · cost ×${TMULT[tr]}`:'');
  if (o && o!==PLAYER) l3+=allied(PLAYER,o) ? ' · your ally' : atWar(PLAYER,o) ? ' · at war with you' : ' · click for diplomacy';
  if (occ[t]) l3+=` · occupied by ${occ[t]===PLAYER ? 'you' : W.nations[occ[t]].name}`;
  ui.tip.innerHTML=`<span class="t1"></span><span class="t2"></span><span class="t2"></span>`;
  ui.tip.children[0].textContent=l1; ui.tip.children[1].textContent=l2; ui.tip.children[2].textContent=l3;
  ui.tip.hidden=false;
  const gr=$('game').getBoundingClientRect(), tw=ui.tip.offsetWidth, th=ui.tip.offsetHeight;
  let x=e.clientX-gr.left+16, y=e.clientY-gr.top+16;
  if (x+tw>gr.width-8) x=e.clientX-gr.left-tw-12; if (y+th>gr.height-8) y=e.clientY-gr.top-th-12;
  ui.tip.style.left=x+'px'; ui.tip.style.top=y+'px';
}

function endPointer(e: PointerEvent){
  pointers.delete(e.pointerId);
  if (pointers.size<2) pinch=null;
  if (pointers.size===1){ const p=[...pointers.values()][0]; drag={sx:p.x,sy:p.y,lx:p.x,ly:p.y,moved:true,button:0}; }
  if (pointers.size===0){
    if (drag && !drag.moved && drag.button===0 && e.type==='pointerup'){
      const [sx,sy]=devXY(e), t=tileAt(sx,sy);
      if (client.state==='spawn') trySpawn(t);
      else if (client.state==='play'){
        const o=t>=0 ? owner[t] : 0;
        if (client.placing) placeAt(t);
        else if (o && o!==PLAYER){ closeResearch(); openDiplomacy(o); }   // another kingdom: talk first
        else if (!clickOwnBuilding(t)){ if (researchOpen()) closeResearch(); else if (diplomacyOpen()) closeDiplomacy(); else playerAttack(t); }
      }
    }
    drag=null; view.classList.remove('dragging');
  }
}

export function bindInput(){
  view.addEventListener('contextmenu',e=>e.preventDefault());
  view.addEventListener('pointerdown',e=>{
    if (e.button===2 && client.placing){ stopPlacing(); return; }   // right-click stops placing
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if (pointers.size===1) drag={sx:e.clientX,sy:e.clientY,lx:e.clientX,ly:e.clientY,moved:false,button:e.button};
    else if (pointers.size===2){
      const [a,b]=[...pointers.values()];
      pinch={d:Math.hypot(a.x-b.x,a.y-b.y),mx:(a.x+b.x)/2,my:(a.y+b.y)/2}; if (drag) drag.moved=true;
    }
  });
  view.addEventListener('pointermove',e=>{
    hover.mouse = e.pointerType==='mouse';
    const [sx,sy]=devXY(e); hover.sx=sx; hover.sy=sy; hover.tile=tileAt(sx,sy);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if (pinch && pointers.size>=2){
      const [a,b]=[...pointers.values()], d=Math.hypot(a.x-b.x,a.y-b.y), mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
      const r=view.getBoundingClientRect();
      cam.x-=(mx-pinch.mx)*cam.dpr/cam.zoom; cam.y-=(my-pinch.my)*cam.dpr/cam.zoom;
      zoomAt(d/Math.max(1,pinch.d),(mx-r.left)*cam.dpr,(my-r.top)*cam.dpr);
      pinch.d=d; pinch.mx=mx; pinch.my=my;
    } else if (drag){
      if (!drag.moved && Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)>6){ drag.moved=true; view.classList.add('dragging'); }
      if (drag.moved){ cam.x-=(e.clientX-drag.lx)*cam.dpr/cam.zoom; cam.y-=(e.clientY-drag.ly)*cam.dpr/cam.zoom; cam.anim=null; clampCam(); }
      drag.lx=e.clientX; drag.ly=e.clientY;
    }
    updateTip(e);
  });
  view.addEventListener('pointerup',endPointer);
  view.addEventListener('pointercancel',endPointer);
  view.addEventListener('pointerleave',()=>{ hover.tile=-1; ui.tip.hidden=true; });
  view.addEventListener('wheel',e=>{ e.preventDefault(); const [sx,sy]=devXY(e); zoomAt(Math.exp(-e.deltaY*0.0018),sx,sy); },{passive:false});

  const ratioEl=$('ratio') as HTMLInputElement;
  ratioEl.addEventListener('input',()=>setRatio(+ratioEl.value/100));
  setRatio(0.4);
  const soldiersEl=$('soldiers') as HTMLInputElement;
  soldiersEl.addEventListener('input',()=>setSoldierShare(+soldiersEl.value/100));

  $('zoomIn').onclick=()=>zoomAt(1.5,view.width/2,view.height/2);
  $('zoomOut').onclick=()=>zoomAt(1/1.5,view.width/2,view.height/2);
  $('home').onclick=centerHome;
  $('speed').onclick=()=>{ client.speed=client.speed>=3?1:client.speed+1; $('speed').textContent=client.speed+'×'; };
  $('pause').onclick=()=>setPaused(!client.paused);
  $('build').onclick=()=>toggleBuildPanel();
  $('start').onclick=()=>{ $('intro').hidden=true; $('scrim').hidden=true; client.state='spawn'; ui.banner.hidden=false; };
  $('newMap').onclick=()=>newGame();
  $('again').onclick=()=>{ $('over').hidden=true; $('scrim').hidden=true; showHUD(false); client.state='spawn'; newGame(); ui.banner.hidden=false; };
  $('watch').onclick=()=>{ $('over').hidden=true; $('scrim').hidden=true; };
  window.addEventListener('keydown',e=>{
    const tag=(e.target as HTMLElement).tagName;
    if (tag==='SELECT' || (tag==='INPUT' && e.key!=='Escape') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key>='1' && e.key<='9'){ setRatio(+e.key/10); }
    else if (e.key==='0'){ setRatio(1); }
    else if (e.key===' ' && client.state==='play'){ e.preventDefault(); centerHome(); }
    else if (e.key==='p' || e.key==='P'){ if (client.state==='play') setPaused(!client.paused); }
    else if (e.key==='b' || e.key==='B'){ if (client.state==='play') toggleBuildPanel(); }
    else if (e.key==='Escape'){ closePop(); if (client.placing) stopPlacing(); else if (researchOpen()) closeResearch(); else if (diplomacyOpen()) closeDiplomacy(); else toggleBuildPanel(false); }
    else if (e.key==='+' || e.key==='='){ zoomAt(1.3,view.width/2,view.height/2); }
    else if (e.key==='-'){ zoomAt(1/1.3,view.width/2,view.height/2); }
  });
}
