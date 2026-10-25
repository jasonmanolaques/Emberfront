/* ---------- frame rendering: reads the simulation, never changes it ----------
   The world is drawn in render pixels (RS per tile, K per simulation pixel); the camera's zoom
   is screen pixels per render pixel. */
import { TW, PW, PH, PS, RS, K, PLAYER, PLAYER_COL, B_TOWER } from '../core/constants';
import { clamp, fmt } from '../core/util';
import { W, isLand, pType, pPrio, pTimer, pBurn, type Human } from '../sim/state';
import { findBlock } from '../sim/sim';
import { placeProblem, structureOf, canAfford, SIZE, PRODUCE_TICKS } from '../sim/buildings';
import { client, reduceMotion } from '../client';
import { view, ctx, cam, stepCamAnim } from './camera';
import { worldC, flushWorld, SEA } from './terrain';
import { objC, drawIcon, drawWorking, BIG } from './sprites';
import { natC } from './nature';
import { styleOf } from './style';
import { personSprite, corpseSprite, woundStage, BODY_X, FEET_Y } from './people';
import { FL, flT, flO, flTime, fx, ppx, ppy, plife, pmax, pkind, psize, floats, glints, shots, hits, corpses, drips, addDrip, CORPSE_MS, DRIP_MS, updateEffects } from './effects';
import { H_SOLDIER, TASK_HARVEST, TASK_HOME_GO, TASK_HOME_BUILD, indoors } from '../sim/population';
import { G_WOOD, G_STONE, G_COPPER } from '../sim/resources';
import { allied, atWar, HIT_TICKS } from '../sim/war';

const CARGO: string[][] = [];   // light, mid and dark of each good's load
CARGO[G_WOOD]=['#d09a58','#a8743c','#6e4a26']; CARGO[G_STONE]=['#dcd6cc','#b0aa9e','#7c766c']; CARGO[G_COPPER]=['#ffbe80','#e08a48','#9c5426'];
const INK='rgba(30,20,14,0.9)';

export const hover = { sx: -1, sy: -1, tile: -1, mouse: false };

// ghost previews of buildings while placing, in the player's colours
const ghosts = new Map<number, HTMLCanvasElement>();
function ghostOf(type: number){
  let c=ghosts.get(type);
  if (!c){ const [w,h]=SIZE[type] ?? [1,1]; c=document.createElement('canvas'); c.width=w*PS; c.height=h*PS; drawIcon(c.getContext('2d')!,type,styleOf(PLAYER)); ghosts.set(type,c); }
  return c;
}
export function resetGhosts(){ ghosts.clear(); }

// smoothed label positions per nation (they glide toward the census anchor)
const labX = new Float64Array(256).fill(-1), labY = new Float64Array(256);
export function resetLabels(){ labX.fill(-1); lastX.clear(); lastY.clear(); facing.clear(); bleeding.clear(); }

// where each person stood last frame, to tell walking from standing and which way they face
let lastX = new Map<number, number>(), lastY = new Map<number, number>();
const facing = new Map<number, boolean>();   // true = facing left
// the badly wounded leave a short trail of blood: when it started, and when the last drop fell
const bleeding = new Map<number, [number, number]>();
const TRAIL_MS=3500, DROP_MS=260;

/** A box with a dark edge: loads, bags and planks carried above the head. */
function box(x: number, y: number, w: number, h: number, c: string){ ctx.fillStyle=INK; ctx.fillRect(x-1,y-1,w+2,h+2); ctx.fillStyle=c; ctx.fillRect(x,y,w,h); }

function drawPeople(now: number, vx0: number, vy0: number, vx1: number, vy1: number){
  const byId = new Map<number, Human>(); for (const p of W.humans) byId.set(p.id,p);
  const nextX = new Map<number, number>(), nextY = new Map<number, number>();
  const step = reduceMotion ? 0 : ((now/170)|0)&1;
  // draw from the back row forward, so people nearer the bottom of the screen stand in front
  const list = W.humans.filter(p => !indoors(p) && p.x*K>=vx0-8 && p.y*K>=vy0-4 && p.x*K<=vx1+8 && p.y*K<=vy1+16).sort((a,b) => a.y-b.y || a.id-b.id);
  for (const p of list){
    const rx=p.x*K, ry=p.y*K, ox=lastX.get(p.id), oy=lastY.get(p.id);
    nextX.set(p.id,rx); nextY.set(p.id,ry);
    const dx = ox===undefined ? 0 : rx-ox, moving = ox!==undefined && Math.abs(dx)+Math.abs(ry-(oy ?? ry))>0.01;
    let left = facing.get(p.id) ?? (p.id&1)===1;
    const foe = p.foe>=0 ? byId.get(p.foe) : undefined;
    if (foe) left = foe.x<p.x;               // fighters face their enemy
    else if (Math.abs(dx)>0.02) left = dx<0;
    facing.set(p.id,left);
    const kind = p.beggar ? 2 : p.kind===H_SOLDIER ? 1 : 0;
    const striking = (kind===1 || p.brave===1) && p.cool>HIT_TICKS-3 && p.foe>=0 || (kind===1 && p.cool>HIT_TICKS-3 && p.aim>=0);
    const frame = striking && kind===1 ? 2 : moving ? (step ^ (p.id&1)) : 0;
    const look = ((p.id*7)&3) | (((p.id*13)%4)<<2);
    const wound = woundStage(kind===1 ? 1 : 0, p.hp);
    // near death, a trail of blood for a few seconds as they stagger on
    if (wound===(kind===1 ? 2 : 1)){
      let b=bleeding.get(p.id); if (!b){ b=[now,0]; bleeding.set(p.id,b); }
      if (moving && now-b[0]<TRAIL_MS && now-b[1]>DROP_MS){ b[1]=now; addDrip(p.x+(Math.random()-0.5)*0.8,p.y); }
    } else bleeding.delete(p.id);
    const spr = personSprite(p.o,kind,look,frame,left,wound);
    const bx = Math.round(rx)-2, fy = Math.floor(ry)+1;   // body's left column, and its feet row
    const sx = left ? bx-(spr.width-BODY_X-4) : bx-BODY_X;
    ctx.drawImage(spr, sx, fy-FEET_Y);
    if (kind!==0) { if (p.loot) drawLoot(bx,fy); continue; }
    if (p.brave===1){   // up in arms: a pitchfork
      const tx=left ? bx-1 : bx+4; ctx.fillStyle=INK; ctx.fillRect(tx-1,fy-9,3,9);
      ctx.fillStyle='#8a6a40'; ctx.fillRect(tx,fy-7,1,7); ctx.fillStyle='#c9cdd1'; ctx.fillRect(tx,fy-8,1,1); ctx.fillRect(tx-1,fy-9,1,1); ctx.fillRect(tx+1,fy-9,1,1);
      continue;
    }
    // working: a tool swings beside them
    if (p.task===TASK_HARVEST || p.task===TASK_HOME_BUILD){
      const up=reduceMotion ? 0 : ((now/220+p.id)|0)&1, tx=left ? bx-2 : bx+4;
      ctx.fillStyle=INK; ctx.fillRect(tx-1,fy-6+up,3,5);
      ctx.fillStyle='#7a5634'; ctx.fillRect(tx,fy-5+up,1,3);
      ctx.fillStyle='#c9cdd1'; ctx.fillRect(tx,fy-6+up,1,1); ctx.fillRect(left ? tx-1 : tx+1,fy-6+up,1,1);
    }
    // hauling: the load held up above the head (builders on their way carry a plank)
    if (p.carry>=0){ const c=CARGO[p.carry]; box(bx,fy-11,4,3,c[1]); ctx.fillStyle=c[0]; ctx.fillRect(bx,fy-11,4,1); ctx.fillStyle=c[2]; ctx.fillRect(bx,fy-9,4,1); }
    else if (p.task===TASK_HOME_GO){ box(bx-1,fy-10,6,1,CARGO[G_WOOD][0]); }
  }
  lastX=nextX; lastY=nextY;
}
/** Pools of blood under the fallen and the drops the wounded left, then the bodies themselves. */
function drawFallen(now: number, vx0: number, vy0: number, vx1: number, vy1: number){
  while (drips.length && now-drips[0].t0>DRIP_MS) drips.shift();
  while (corpses.length && now-corpses[0].t0>CORPSE_MS) corpses.shift();
  for (const d of drips){
    const x=Math.floor(d.x*K), y=Math.floor(d.y*K)+1; if (x<vx0||y<vy0||x>vx1||y>vy1) continue;
    const age=(now-d.t0)/DRIP_MS; ctx.globalAlpha=age<0.6 ? 0.85 : 0.85*(1-age)/0.4;
    ctx.fillStyle='#7e1410'; ctx.fillRect(x,y,1,1); if ((x+y)&1) ctx.fillRect(x+1,y,1,1);
  }
  for (const c of corpses){
    const x=Math.round(c.x*K), y=Math.floor(c.y*K)+1; if (x<vx0-10||y<vy0-8||x>vx1+10||y>vy1+8) continue;
    const age=now-c.t0, fade=age>CORPSE_MS-5000 ? (CORPSE_MS-age)/5000 : 1, grow=Math.min(1,age/1600);
    // the pool spreads for a moment and then stays, dark and wide
    ctx.globalAlpha=0.8*fade; ctx.fillStyle='#6e100c';
    const rx=Math.round(2+grow*4), ry=Math.round(1+grow*2);
    for (let j=-ry;j<=ry;j++){ const w=Math.round(rx*Math.sqrt(1-(j/(ry+0.5))**2)); ctx.fillRect(x-w,y+j,w*2+1,1); }
    ctx.fillStyle='#9a1a14'; ctx.fillRect(x-Math.max(1,rx-2),y-Math.max(0,ry-1),Math.max(1,rx-2)*2,1);
    ctx.globalAlpha=fade;
    const s=corpseSprite(c.o,c.kind,c.look); ctx.drawImage(s,x-7,y-7);
  }
  ctx.globalAlpha=1;
}
/** A raider's plunder: a sack over his shoulder, tied with a gold cord. */
function drawLoot(bx: number, fy: number){
  const x=bx+1, y=fy-12;
  ctx.fillStyle=INK; ctx.fillRect(x-1,y,6,5); ctx.fillRect(x,y-1,4,1);
  ctx.fillStyle='#8a5a2e'; ctx.fillRect(x,y+1,4,3); ctx.fillStyle='#a8743c'; ctx.fillRect(x,y+1,2,1);
  ctx.fillStyle='#ffd23f'; ctx.fillRect(x+1,y,2,1);
}

/** Each army's banner on a pole, in its kingdom's colours; a raid flies a black mark. */
function drawBanners(now: number, vx0: number, vy0: number, vx1: number, vy1: number){
  const wave=reduceMotion ? 0 : ((now/260)|0)%3;
  for (const c of W.campaigns){
    const x=Math.round(c.bx*K), y=Math.round(c.by*K);
    if (c.phase===2 || x<vx0-10||y<vy0||x>vx1+10||y>vy1+20) continue;
    const st=styleOf(c.a);
    ctx.fillStyle='rgba(12,22,6,.35)'; ctx.fillRect(x-2,y+1,5,1);
    ctx.fillStyle=INK; ctx.fillRect(x-1,y-16,3,18); ctx.fillRect(x+1,y-16,8,7);
    ctx.fillStyle='#5a4030'; ctx.fillRect(x,y-15,1,16);
    ctx.fillStyle='#d8c890'; ctx.fillRect(x,y-16,1,1);
    // the cloth ripples: the trailing edge shifts as it waves
    ctx.fillStyle=st.roof; ctx.fillRect(x+1,y-15,6,5);
    ctx.fillStyle=st.roofL; ctx.fillRect(x+1,y-15,6,1);
    ctx.fillStyle=st.roofD; ctx.fillRect(x+1,y-11,6,1);
    ctx.fillStyle=INK; ctx.fillRect(x+7,y-15+wave,1,1); ctx.fillRect(x+7,y-13+(wave>>1),1,1);
    if (c.raid){ ctx.fillStyle='#16110d'; ctx.fillRect(x+3,y-14,2,2); ctx.fillRect(x+3,y-12,1,1); ctx.fillRect(x+4,y-12,1,1); }
  }
}

export function render(now: number, dt: number){
  stepCamAnim(now);
  flushWorld();
  const w=view.width, h=view.height, zoom=cam.zoom, camX=cam.x, camY=cam.y, dpr=cam.dpr, zs=zoom*K/dpr;
  const vx0=camX, vy0=camY, vx1=camX+w/zoom, vy1=camY+h/zoom;
  updateEffects(dt, vx0,vy0,vx1,vy1, zs);

  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle=SEA; ctx.fillRect(0,0,w,h);
  ctx.imageSmoothingEnabled=false;
  ctx.setTransform(zoom,0,0,zoom,-camX*zoom,-camY*zoom);
  ctx.drawImage(worldC,0,0);

  // sea glints: a short sparkle on the waves
  if (!reduceMotion){
    ctx.fillStyle='rgba(225,245,240,.8)'; const tt=now*0.0017, spX=glints.x, spY=glints.y, spPh=glints.ph;
    for (let i=0;i<spX.length;i++){ const x=spX[i], y=spY[i]; if (x<vx0||y<vy0||x>vx1||y>vy1) continue; const s=Math.sin(tt*(0.7+(i%5)*0.15)+spPh[i]); if (s>0.93) ctx.fillRect(x,y,s>0.975?3:2,1); }
  }
  // conquest flashes
  for (let i=0;i<FL;i++){
    const age=now-flTime[i]; if (age>420||age<0) continue;
    const t=flT[i], x=(t%TW)*RS, y=((t/TW)|0)*RS; if (x<vx0-RS||y<vy0-RS||x>vx1||y>vy1) continue;
    if (!W.nations[flO[i]]) continue;
    ctx.globalAlpha=0.8*(1-age/420); ctx.fillStyle=flO[i]?styleOf(flO[i]).light:'#ffffff'; ctx.fillRect(x,y,RS,RS);
  }
  ctx.globalAlpha=1;
  ctx.drawImage(natC,0,0);
  ctx.drawImage(objC,0,0);

  // production buildings at work: saplings growing, the quarry pulley, the mine's glow
  {
    const qx0=Math.max(0,Math.floor(vx0/PS)-1), qy0=Math.max(0,Math.floor(vy0/PS)-1), qx1=Math.min(PW-1,Math.floor(vx1/PS)), qy1=Math.min(PH-1,Math.floor(vy1/PS));
    for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
      const q=y*PW+x, ty=pType[q]; if (!BIG[ty] || pBurn[q]>0) continue;
      drawWorking(ctx,ty,x*PS,y*PS,pTimer[q]/PRODUCE_TICKS,reduceMotion?0:now);
    }
  }

  // people and armies, once close enough to tell them apart
  if (zs>=1.5){ drawFallen(now,vx0,vy0,vx1,vy1); drawPeople(now,vx0,vy0,vx1,vy1); drawBanners(now,vx0,vy0,vx1,vy1); }

  // particles
  for (let i=0;i<fx.pcount;i++){
    const f=plife[i]/pmax[i], k=pkind[i], s=psize[i];
    if (k===0) ctx.fillStyle = f>0.7?'#fff4c0':f>0.45?'#ffc845':f>0.22?'#ff6e2e':'#a8341c';
    else if (k===1) ctx.fillStyle = f>0.6?'rgba(58,52,50,.72)':f>0.3?'rgba(84,78,76,.5)':'rgba(112,106,104,.26)';
    else if (k===3) ctx.fillStyle = f>0.5?'rgba(200,215,230,.85)':'rgba(200,215,230,.4)';   // gate dust, soldier out
    else ctx.fillStyle = f>0.5?'rgba(235,232,224,.55)':'rgba(235,232,224,.25)';
    const sz = k===0 && f<0.4 ? 1 : s;
    ctx.fillRect(Math.floor(ppx[i]),Math.floor(ppy[i]),sz,sz);
  }
  // watchtowers calling for a garrison carry a "!"
  {
    const qx0=Math.max(0,Math.floor(vx0/PS)), qy0=Math.max(0,Math.floor(vy0/PS)), qx1=Math.min(PW-1,Math.floor(vx1/PS)), qy1=Math.min(PH-1,Math.floor((vy1+PS)/PS));
    const bob=reduceMotion ? 0 : ((now/400)|0)&1;
    for (let y=qy0;y<=qy1;y++) for (let x=qx0;x<=qx1;x++){
      const q=y*PW+x; if (pType[q]!==B_TOWER || !pPrio[q]) continue;
      const ex=x*PS+7, ey=y*PS-12-bob;
      ctx.fillStyle=INK; ctx.fillRect(ex-2,ey-2,6,13);
      ctx.fillStyle='#ffd23f'; ctx.fillRect(ex,ey,2,6); ctx.fillRect(ex,ey+7,2,2);
    }
  }
  // arrows from watchtowers and castles: a flash on the battlements, a bright bolt arcing over
  // with a fading streak behind it, and a burst where it hits
  for (let i=shots.length-1;i>=0;i--){
    const s=shots[i], age=now-s.t0;
    const x0=s.x0*K, y0=s.y0*K, x1=s.x1*K, y1=s.y1*K, L=Math.hypot(x1-x0,y1-y0)||1, fly=Math.min(700,220+L*6);
    if (age>fly+260 || age<0){ shots.splice(i,1); continue; }
    if (age<120){ ctx.globalAlpha=1-age/120; ctx.fillStyle='#fff2b0'; ctx.fillRect(Math.floor(x0)-1,Math.floor(y0)-1,3,3); ctx.globalAlpha=1; }
    if (age<fly){
      const at=(k: number): [number, number] => [x0+(x1-x0)*k, y0+(y1-y0)*k-Math.sin(k*Math.PI)*Math.min(14,L*0.25)];
      const k=age/fly;
      for (let j=9;j>=1;j--){ const kk=k-j*0.03; if (kk<0) continue; const [tx,ty]=at(kk); ctx.globalAlpha=0.75*(1-j/10); ctx.fillStyle=j<4 ? '#ffe08a' : '#ff9a3c'; ctx.fillRect(Math.floor(tx),Math.floor(ty),2,2); }
      ctx.globalAlpha=1;
      const [x,y]=at(k), X=Math.floor(x)-1, Y=Math.floor(y)-1;
      ctx.fillStyle=INK; ctx.fillRect(X-1,Y-1,5,5);
      ctx.fillStyle='#ffd45a'; ctx.fillRect(X,Y,3,3);
      ctx.fillStyle='#fffbe8'; ctx.fillRect(X+1,Y+1,1,1);
    } else {
      const a=(age-fly)/260; ctx.globalAlpha=1-a; ctx.fillStyle=s.kill?'#ff3b2b':'#ffb07a';
      const r=Math.round(1+a*3)+(s.kill?1:0), cx=Math.floor(x1), cy=Math.floor(y1);
      ctx.fillRect(cx-r,cy,1,1); ctx.fillRect(cx+r,cy,1,1); ctx.fillRect(cx,cy-r,1,1); ctx.fillRect(cx,cy+r,1,1); ctx.fillRect(cx,cy,1,1);
      ctx.globalAlpha=1;
    }
  }
  // blows landing in a fight: a white spark, red when it kills
  for (let i=hits.length-1;i>=0;i--){
    const s=hits[i], age=now-s.t0; if (age>280 || age<0){ hits.splice(i,1); continue; }
    ctx.globalAlpha=1-age/280; ctx.fillStyle=s.kill?'#ff3b2b':'#fff4d0';
    const x=Math.floor(s.x*K), y=Math.floor(s.y*K), r=age<140 ? 2 : 1;
    ctx.fillRect(x,y,1,1); ctx.fillRect(x-r,y-r,1,1); ctx.fillRect(x+r,y-r,1,1); ctx.fillRect(x-r,y+r,1,1); ctx.fillRect(x+r,y+r,1,1);
    if (s.kill && age<140){ ctx.fillRect(x-1,y,3,1); ctx.fillRect(x,y-1,1,3); }
    ctx.globalAlpha=1;
  }
  // hover marker / spawn ghost / building preview
  if (hover.tile>=0 && hover.mouse){
    const hx=hover.tile%TW, hy=(hover.tile/TW)|0;
    if (client.state==='play' && client.placing){
      const q=(hy>>2)*PW+(hx>>2), me=W.nations[PLAYER], s=structureOf(client.placing);
      const ok=!!me && !!s && canAfford(me,s) && !placeProblem(me,q,client.placing), [fw,fh]=SIZE[client.placing] ?? [1,1];
      ctx.globalAlpha=0.7; ctx.drawImage(ghostOf(client.placing),(hx>>2)*PS,(hy>>2)*PS); ctx.globalAlpha=1;
      ctx.strokeStyle=ok?'rgba(143,227,155,.95)':'rgba(255,90,70,.9)'; ctx.lineWidth=2*dpr/zoom;
      ctx.strokeRect((hx>>2)*PS,(hy>>2)*PS,fw*PS,fh*PS);
    } else if (client.state==='spawn'){
      const b=findBlock(hx,hy,0), bx=Math.round(hx/4)-1, by=Math.round(hy/4)-1;
      ctx.strokeStyle=b?'rgba(255,230,120,.95)':'rgba(255,90,70,.9)'; ctx.lineWidth=2*dpr/zoom;
      ctx.strokeRect(bx*PS,by*PS,2*PS,2*PS);
      if (b){ ctx.globalAlpha=0.25; ctx.fillStyle=PLAYER_COL; ctx.beginPath(); ctx.arc(bx*PS+PS,by*PS+PS,26,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; }
    } else if (isLand[hover.tile]){ ctx.fillStyle='rgba(255,255,255,.35)'; ctx.fillRect(hx*RS,hy*RS,RS,RS); }
  }

  // labels and floating numbers (screen space)
  ctx.setTransform(1,0,0,1,0,0);
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
  const N=W.nations;
  for (let i=1;i<N.length;i++){
    const n=N[i]; if (!n.alive || n.tiles<10) continue;
    if (labX[i]<0){ labX[i]=n.ltx; labY[i]=n.lty; } else { const k=Math.min(1,dt*2.5); labX[i]+=(n.ltx-labX[i])*k; labY[i]+=(n.lty-labY[i])*k; }
    const lx=labX[i], ly=labY[i];
    const size=clamp(Math.sqrt(n.tiles)*0.5,3.2,20)*zoom*K; if (size<7*dpr) continue;
    const fs=Math.min(size,30*dpr);
    // lift the label off the castle while the kingdom is still small
    const nearCap = n.capTile>=0 && Math.abs(lx-n.capTile%TW)<7 && Math.abs(ly-((n.capTile/TW)|0))<7;
    const sx=((lx*RS+RS/2)-camX)*zoom, sy=((ly*RS+RS/2)-camY)*zoom-(nearCap?13*K*zoom:0);
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
    const sx=(f.x*K-camX)*zoom, sy=(f.y*K-camY)*zoom-age*36*dpr, fs=(16*dpr)|0;
    ctx.globalAlpha=1-age/1.3; ctx.font=`700 ${fs}px "Pixelify Sans", ui-monospace, monospace`;
    ctx.lineWidth=3*dpr; ctx.strokeStyle='rgba(8,14,22,.9)'; ctx.fillStyle=f.c;
    ctx.strokeText(f.text,sx,sy); ctx.fillText(f.text,sx,sy);
  }
  ctx.globalAlpha=1;
}
