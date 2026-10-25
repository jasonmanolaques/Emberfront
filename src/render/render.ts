/* ---------- frame rendering: reads the simulation, never changes it ---------- */
import { TW, PLAYER_COL } from '../core/constants';
import { clamp, fmt } from '../core/util';
import { W, isLand } from '../sim/state';
import { findBlock } from '../sim/sim';
import { client, reduceMotion } from '../client';
import { view, ctx, cam, stepCamAnim } from './camera';
import { worldC, flushWorld } from './terrain';
import { objC } from './sprites';
import { styleOf } from './style';
import { FL, flT, flO, flTime, fx, ppx, ppy, plife, pmax, pkind, vill, floats, glints, updateEffects } from './effects';

export const hover = { sx: -1, sy: -1, tile: -1, mouse: false };

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
  ctx.drawImage(objC,0,0);

  // villagers
  if (zc>=2.2){
    for (const v of vill){ if (v.x<vx0||v.y<vy0||v.x>vx1||v.y>vy1) continue; const x=Math.floor(v.x), y=Math.floor(v.y);
      ctx.fillStyle=styleOf(v.o).roof; ctx.fillRect(x,y,1,1); ctx.fillStyle=v.skin; ctx.fillRect(x,y-1,1,1); }
  }
  // particles
  for (let i=0;i<fx.pcount;i++){
    const f=plife[i]/pmax[i], k=pkind[i];
    if (k===0) ctx.fillStyle = f>0.65?'#fff3b0':f>0.4?'#ffc23d':f>0.2?'#ff6a2b':'#b8381f';
    else if (k===1) ctx.fillStyle = f>0.6?'rgba(64,58,54,.75)':f>0.3?'rgba(84,78,74,.5)':'rgba(110,104,100,.28)';
    else ctx.fillStyle = f>0.5?'rgba(235,235,235,.55)':'rgba(235,235,235,.25)';
    ctx.fillRect(Math.floor(ppx[i]),Math.floor(ppy[i]),1,1);
  }
  // hover marker / spawn ghost
  if (hover.tile>=0 && hover.mouse){
    const hx=hover.tile%TW, hy=(hover.tile/TW)|0;
    if (client.state==='spawn'){
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
    ctx.lineWidth=Math.max(2,fs*0.2); ctx.strokeStyle='rgba(8,14,22,.85)'; ctx.fillStyle=n.isPlayer?'#ffe27a':'#ffffff';
    ctx.strokeText(n.name,sx,sy-fs*0.35); ctx.fillText(n.name,sx,sy-fs*0.35);
    const ts=(fs*0.72)|0; ctx.font=`500 ${ts}px "Pixelify Sans", ui-monospace, monospace`; ctx.lineWidth=Math.max(2,ts*0.22);
    ctx.fillStyle=n.isPlayer?'#ffe27a':'#e9eef3';
    ctx.strokeText(fmt(n.troops),sx,sy+fs*0.55); ctx.fillText(fmt(n.troops),sx,sy+fs*0.55);
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
