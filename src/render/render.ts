/* ---------- frame rendering: reads the simulation, never changes it ---------- */
import { TW, PW, PH, PLAYER, PLAYER_COL, B_TOWER } from '../core/constants';
import { clamp, fmt } from '../core/util';
import { W, isLand, pType, pPrio, pTimer, pBurn } from '../sim/state';
import { findBlock } from '../sim/sim';
import { placeProblem, structureOf, canAfford, SIZE, PRODUCE_TICKS } from '../sim/buildings';
import { client, reduceMotion } from '../client';
import { view, ctx, cam, stepCamAnim } from './camera';
import { worldC, flushWorld } from './terrain';
import { objC, drawIcon, drawWorking, BIG } from './sprites';
import { natC } from './nature';
import { styleOf } from './style';
import { FL, flT, flO, flTime, fx, ppx, ppy, plife, pmax, pkind, floats, glints, shots, hits, updateEffects } from './effects';
import { allied, atWar } from '../sim/war';
import { H_SOLDIER, TASK_HARVEST, TASK_HOME_GO, TASK_HOME_BUILD, indoors } from '../sim/population';
import { G_WOOD, G_STONE, G_COPPER } from '../sim/resources';

const SKIN = ['#f1c9a5','#d9a679','#a8744f','#7a5236'];
const HAIR = ['#3b2a1e','#7a4a24','#c9a060'];
const CARGO: string[][] = [];   // top and bottom row of each good's load
CARGO[G_WOOD]=['#b07a40','#7a4a24']; CARGO[G_STONE]=['#c4beb4','#8d867b']; CARGO[G_COPPER]=['#f0a060','#b8642a'];

export const hover = { sx: -1, sy: -1, tile: -1, mouse: false };

// ghost previews of buildings while placing, in the player's colours
const ghosts = new Map<number, HTMLCanvasElement>();
function ghostOf(type: number){
  let c=ghosts.get(type);
  if (!c){ const [w,h]=SIZE[type] ?? [1,1]; c=document.createElement('canvas'); c.width=w*8; c.height=h*8; drawIcon(c.getContext('2d')!,type,styleOf(PLAYER)); ghosts.set(type,c); }
  return c;
}
export function resetGhosts(){ ghosts.clear(); }

// smoothed label positions per nation (they glide toward the census anchor)
const labX = new Float64Array(256).fill(-1), labY = new Float64Array(256);
export function resetLabels(){ labX.fill(-1); }

export function render(now: number, dt: number){
  stepCamAnim(now);
  flushWorld();
  const w=view.width, h=view.height, zoom=cam.zoom, camX=cam.x, camY=cam.y, dpr=cam.dpr, zc=zoom/dpr;
  const vx0=camX, vy0=camY, vx1=camX+w/zoom, vy1=camY+h/zoom;
  updateEffects(dt, vx0,vy0,vx1,vy1, zc);

  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle='#1b4a80'; ctx.fillRect(0,0,w,h);
  ctx.imageSmoothingEnabled=false;
  ctx.setTransform(zoom,0,0,zoom,-camX*zoom,-camY*zoom);
  ctx.drawImage(worldC,0,0);

  // sea glints
  if (!reduceMotion){
    ctx.fillStyle='rgba(255,255,255,.75)'; const tt=now*0.0017, spX=glints.x, spY=glints.y, spPh=glints.ph;
    for (let i=0;i<spX.length;i++){ const x=spX[i], y=spY[i]; if (x<vx0||y<vy0||x>vx1||y>vy1) continue; if (Math.sin(tt*(0.7+(i%5)*0.15)+spPh[i])>0.94) ctx.fillRect(x,y,1,1); }
  }
  // conquest flashes
  for (let i=0;i<FL;i++){
    const age=now-flTime[i]; if (age>420||age<0) continue;
    const t=flT[i], x=(t%TW)*2, y=((t/TW)|0)*2; if (x<vx0-2||y<vy0-2||x>vx1||y>vy1) continue;
    if (!W.nations[flO[i]]) continue;
    ctx.globalAlpha=0.85*(1-age/420); ctx.fillStyle=flO[i]?styleOf(flO[i]).light:'#ffffff'; ctx.fillRect(x,y,2,2);
  }
  ctx.globalAlpha=1;
  ctx.drawImage(natC,0,0);
  ctx.drawImage(objC,0,0);

  // production buildings at work: saplings growing, the quarry pulley, the mine's glow
  {
    const qx0=Math.max(0,Math.floor(vx0/8)-1), qy0=Math.max(0,Math.floor(vy0/8)-1), qx1=Math.min(PW-1,Math.floor(vx1/8)), qy1=Math.min(PH-1,Math.floor(vy1/8));
    for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
      const q=y*PW+x, ty=pType[q]; if (!BIG[ty] || pBurn[q]>0) continue;
      drawWorking(ctx,ty,x*8,y*8,pTimer[q]/PRODUCE_TICKS,reduceMotion?0:now);
    }
  }

  // people, 2x4 pixels standing on (x,y): villagers in their kingdom's colour,
  // soldiers in a darker tunic with a helmet and a spear
  if (zc>=1.5){
    for (const p of W.humans){
      if (indoors(p) || p.x<vx0-3||p.y<vy0||p.x>vx1+3||p.y>vy1+7) continue;
      const x=Math.round(p.x)-1, y=Math.floor(p.y), st=styleOf(p.o), skin=SKIN[(p.id*7)&3];
      ctx.fillStyle='rgba(16,28,8,.35)'; ctx.fillRect(x,y+1,3,1);
      if (p.beggar){
        // hunched in rags, pale and sickly, shuffling along
        const lean=reduceMotion ? 0 : ((now/600+p.id)|0)&1;
        ctx.fillStyle='#a8b68a'; ctx.fillRect(x+1+lean,y-2,1,1);
        ctx.fillStyle='#6f675a'; ctx.fillRect(x,y-1,2,1);
        ctx.fillStyle='#5a5348'; ctx.fillRect(x,y,1,1);
        ctx.fillStyle='#c9c2a8'; ctx.fillRect(x+1,y,1,1);
        continue;
      }
      if (p.kind===H_SOLDIER){
        ctx.fillStyle='#aeb7c0'; ctx.fillRect(x,y-3,2,1);
        ctx.fillStyle=skin;      ctx.fillRect(x,y-2,2,1);
        ctx.fillStyle=st.roofD;  ctx.fillRect(x,y-1,2,1);
        ctx.fillStyle='#3b3330'; ctx.fillRect(x,y,1,1); ctx.fillRect(x+1,y,1,1);
        ctx.fillStyle='#6e5034'; ctx.fillRect(x+2,y-3,1,4);
        ctx.fillStyle='#e4e0d4'; ctx.fillRect(x+2,y-4,1,1);
      } else {
        ctx.fillStyle=HAIR[(p.id*13)%3]; ctx.fillRect(x,y-3,2,1);
        ctx.fillStyle=skin;      ctx.fillRect(x,y-2,2,1);
        ctx.fillStyle=st.roof;   ctx.fillRect(x,y-1,2,1);
        ctx.fillStyle='#5a3c22'; ctx.fillRect(x,y,1,1); ctx.fillRect(x+1,y,1,1);
        // working: a tool swings up and down beside them
        if (p.task===TASK_HARVEST || p.task===TASK_HOME_BUILD){ const up=((now/220+p.id)|0)&1; ctx.fillStyle='#6e5034'; ctx.fillRect(x+2,y-2+up,1,2); ctx.fillStyle='#c9cdd1'; ctx.fillRect(x+2,y-3+up,1,1); }
        // hauling: the load held up above the head (builders on their way carry a plank)
        if (p.carry>=0 || p.task===TASK_HOME_GO){ const c=CARGO[p.carry>=0 ? p.carry : G_WOOD]; ctx.fillStyle=c[0]; ctx.fillRect(x,y-5,2,1); ctx.fillStyle=c[1]; ctx.fillRect(x,y-4,2,1); }
      }
      // a raider with plunder: a loot bag over his shoulder, tied with a gold cord
      if (p.loot){ ctx.fillStyle='#7a5228'; ctx.fillRect(x-1,y-6,3,2); ctx.fillRect(x,y-7,1,1); ctx.fillStyle='#ffd23f'; ctx.fillRect(x,y-6,1,1); }
    }
    // each army's banner on a pole, in its kingdom's colours
    const wave=reduceMotion ? 0 : ((now/300)|0)&1;
    for (const c of W.campaigns){
      if (c.phase===2 || c.bx<vx0-4||c.by<vy0||c.bx>vx1+4||c.by>vy1+9) continue;
      const st=styleOf(c.a), x=Math.round(c.bx), y=Math.round(c.by);
      ctx.fillStyle='rgba(16,28,8,.35)'; ctx.fillRect(x-1,y+1,3,1);
      ctx.fillStyle='#4a3626'; ctx.fillRect(x,y-8,1,9);
      ctx.fillStyle=st.roof; ctx.fillRect(x+1,y-8,3,2); ctx.fillRect(x+1+wave,y-6,3-wave,1);
      ctx.fillStyle=st.roofD; ctx.fillRect(x+1,y-6,1,1);
      if (c.raid){ ctx.fillStyle='#1a1410'; ctx.fillRect(x+2,y-7,1,1); }   // a raid flies a black mark
    }
  }
  // particles
  for (let i=0;i<fx.pcount;i++){
    const f=plife[i]/pmax[i], k=pkind[i];
    if (k===0) ctx.fillStyle = f>0.65?'#fff3b0':f>0.4?'#ffc23d':f>0.2?'#ff6a2b':'#b8381f';
    else if (k===1) ctx.fillStyle = f>0.6?'rgba(64,58,54,.75)':f>0.3?'rgba(84,78,74,.5)':'rgba(110,104,100,.28)';
    else if (k===3) ctx.fillStyle = f>0.5?'rgba(200,215,230,.85)':'rgba(200,215,230,.4)';   // gate dust, soldier out
    else ctx.fillStyle = f>0.5?'rgba(235,235,235,.55)':'rgba(235,235,235,.25)';
    ctx.fillRect(Math.floor(ppx[i]),Math.floor(ppy[i]),1,1);
  }
  // watchtowers calling for a garrison carry a "!"
  {
    const qx0=Math.max(0,Math.floor(vx0/8)), qy0=Math.max(0,Math.floor(vy0/8)), qx1=Math.min(PW-1,Math.floor(vx1/8)), qy1=Math.min(PH-1,Math.floor((vy1+8)/8));
    const bob=reduceMotion ? 0 : ((now/400)|0)&1;
    for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
      const q=y*PW+x; if (pType[q]!==B_TOWER || !pPrio[q]) continue;
      const ex=x*8+4, ey=y*8-7-bob;
      ctx.fillStyle='rgba(20,12,8,.85)'; ctx.fillRect(ex-1,ey-1,3,7);
      ctx.fillStyle='#ffd23f'; ctx.fillRect(ex,ey,1,3); ctx.fillRect(ex,ey+4,1,1);
    }
  }
  // watchtower arrows in flight, and a red flash where they hit
  for (let i=shots.length-1;i>=0;i--){
    const s=shots[i], age=now-s.t0; if (age>450 || age<0){ shots.splice(i,1); continue; }
    if (age<250){ const k=age/250, x=s.x0+(s.x1-s.x0)*k, y=s.y0+(s.y1-s.y0)*k, dx=(s.x1-s.x0), dy=(s.y1-s.y0), L=Math.hypot(dx,dy)||1;
      ctx.fillStyle='#f4e6c8'; ctx.fillRect(Math.floor(x),Math.floor(y),1,1); ctx.fillStyle='#8a6a40'; ctx.fillRect(Math.floor(x-dx/L*1.5),Math.floor(y-dy/L*1.5),1,1); }
    else { ctx.globalAlpha=1-(age-250)/200; ctx.fillStyle=s.kill?'#ff3b2b':'#ff8a6a'; ctx.fillRect(Math.floor(s.x1)-1,Math.floor(s.y1)-1,s.kill?3:2,s.kill?3:2); ctx.globalAlpha=1; }
  }
  // blows landing in a fight: a white spark, red when it kills
  for (let i=hits.length-1;i>=0;i--){
    const s=hits[i], age=now-s.t0; if (age>260 || age<0){ hits.splice(i,1); continue; }
    ctx.globalAlpha=1-age/260; ctx.fillStyle=s.kill?'#ff3b2b':'#fff4d0';
    const x=Math.floor(s.x), y=Math.floor(s.y);
    ctx.fillRect(x,y,1,1); if (age<120){ ctx.fillRect(x-1,y-1,1,1); ctx.fillRect(x+1,y-1,1,1); ctx.fillRect(x-1,y+1,1,1); ctx.fillRect(x+1,y+1,1,1); }
    ctx.globalAlpha=1;
  }
  // hover marker / spawn ghost / building preview
  if (hover.tile>=0 && hover.mouse){
    const hx=hover.tile%TW, hy=(hover.tile/TW)|0;
    if (client.state==='play' && client.placing){
      const q=(hy>>2)*PW+(hx>>2), me=W.nations[PLAYER], s=structureOf(client.placing);
      const ok=!!me && !!s && canAfford(me,s) && !placeProblem(me,q,client.placing), [fw,fh]=SIZE[client.placing] ?? [1,1];
      ctx.globalAlpha=0.7; ctx.drawImage(ghostOf(client.placing),(hx>>2)*8,(hy>>2)*8); ctx.globalAlpha=1;
      ctx.strokeStyle=ok?'rgba(143,227,155,.95)':'rgba(255,90,70,.9)'; ctx.lineWidth=2*dpr/zoom;
      ctx.strokeRect((hx>>2)*8,(hy>>2)*8,fw*8,fh*8);
    } else if (client.state==='spawn'){
      const b=findBlock(hx,hy,0), bx=Math.round(hx/4)-1, by=Math.round(hy/4)-1;
      ctx.strokeStyle=b?'rgba(255,230,120,.95)':'rgba(255,90,70,.9)'; ctx.lineWidth=2*dpr/zoom;
      ctx.strokeRect(bx*8,by*8,16,16);
      if (b){ ctx.globalAlpha=0.25; ctx.fillStyle=PLAYER_COL; ctx.beginPath(); ctx.arc(bx*8+8,by*8+8,13,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; }
    } else if (isLand[hover.tile]){ ctx.fillStyle='rgba(255,255,255,.4)'; ctx.fillRect(hx*2,hy*2,2,2); }
  }

  // labels and floating numbers (screen space)
  ctx.setTransform(1,0,0,1,0,0);
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
  const N=W.nations;
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive || n.tiles<10) continue;
    if (labX[i]<0){ labX[i]=n.ltx; labY[i]=n.lty; } else { const k=Math.min(1,dt*2.5); labX[i]+=(n.ltx-labX[i])*k; labY[i]+=(n.lty-labY[i])*k; }
    const lx=labX[i], ly=labY[i];
    const size=clamp(Math.sqrt(n.tiles)*0.5,3.2,20)*zoom; if (size<7*dpr) continue;
    const fs=Math.min(size,30*dpr);
    // lift the label off the castle while the kingdom is still small
    const nearCap = n.capTile>=0 && Math.abs(lx-n.capTile%TW)<7 && Math.abs(ly-((n.capTile/TW)|0))<7;
    const sx=((lx*2+1)-camX)*zoom, sy=((ly*2+1)-camY)*zoom-(nearCap?13*zoom:0);
    if (sx<-100||sy<-50||sx>w+100||sy>h+50) continue;
    ctx.font=`600 ${fs|0}px "Pixelify Sans", ui-monospace, monospace`;
    // your name in gold, allies in green, kingdoms at war with you in red
    const rel=allied(PLAYER,i) ? '#8fe39b' : atWar(PLAYER,i) ? '#ff9a8a' : null;
    ctx.lineWidth=Math.max(2,fs*0.2); ctx.strokeStyle='rgba(8,14,22,.85)'; ctx.fillStyle=n.isPlayer?'#ffe27a':rel ?? '#ffffff';
    ctx.strokeText(n.name,sx,sy-fs*0.35); ctx.fillText(n.name,sx,sy-fs*0.35);
    const ts=(fs*0.72)|0; ctx.font=`500 ${ts}px "Pixelify Sans", ui-monospace, monospace`; ctx.lineWidth=Math.max(2,ts*0.22);
    ctx.fillStyle=n.isPlayer?'#ffe27a':rel ?? '#e9eef3';
    ctx.strokeText(fmt(n.strength),sx,sy+fs*0.55); ctx.fillText(fmt(n.strength),sx,sy+fs*0.55);
  }
  for (let i=floats.length-1;i>=0;i--){
    const f=floats[i], age=(now-f.t0)/1000; if (age>1.3){ floats.splice(i,1); continue; }
    const sx=(f.x-camX)*zoom, sy=(f.y-camY)*zoom-age*36*dpr, fs=(16*dpr)|0;
    ctx.globalAlpha=1-age/1.3; ctx.font=`700 ${fs}px "Pixelify Sans", ui-monospace, monospace`;
    ctx.lineWidth=3*dpr; ctx.strokeStyle='rgba(8,14,22,.9)'; ctx.fillStyle=f.c;
    ctx.strokeText(f.text,sx,sy); ctx.fillText(f.text,sx,sy);
  }
  ctx.globalAlpha=1;
}
