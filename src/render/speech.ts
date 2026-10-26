/* ---------- speech: little bubbles over people's heads ----------
   Purely for show, decided on this screen alone (never part of the simulation). Each situation
   has its lines; `chatter` picks who speaks up, `drawSpeech` draws the bubbles in screen space.
   Add a situation by adding lines to LINES and a rule to chatter. */
import { K } from '../core/constants';
import { W } from '../sim/state';
import { reduceMotion } from '../client';

export const LINES: Record<string, string[]> = {
  // soldiers marching in a counter-attack
  revenge: ['Once more into the breach!', 'They will pay for that mistake!', 'Now you will see our wrath!', "Gather up! It's time for revenge!"],
  // an army's leader giving his orders (sim order events)
  march: ['Form ranks! Forward, march!', 'Keep the line and follow me!', 'Banners high! On to their border!'],
  hold: ['Halt! We are too few.', 'Hold here until more men come up!', 'Not yet. We wait for reinforcements.'],
  assault: ['Charge!', 'Into their land! Break them!', 'Forward, all of you! Attack!', 'Now! For the crown!'],
  retreat: ['Fall back! Fall back!', 'Retreat to the border and regroup!', 'Pull back, we need more men!'],
  stand: ['No retreat! We fight to the last!', 'Stand your ground! To the death!', 'We will not run from them!'],
  regroup: ['Regroup here! Fresh men are coming.', 'Close ranks and catch your breath.', 'We wait here until we are strong again.'],
  home: ['No help is coming. Back home, all of you.', 'Enough. We march home.'],
};
const SHOW_MS = 2600, FADE_MS = 250;
interface Bubble { text: string; t0: number; }
const bubbles = new Map<number, Bubble>();   // person id -> what they are saying
let lastTalk = 0;

export const pick = <T,>(a: T[]) => a[(Math.random()*a.length)|0];
/** Person `id` says `text` for a couple of seconds. */
export function say(id: number, text: string, now=performance.now()){ bubbles.set(id,{ text, t0:now }); }

/** Who speaks up now: in a counter-attack on the march, a soldier or two at a time shout for revenge. */
export function chatter(now: number){
  if (now-lastTalk<450) return;
  lastTalk=now;
  for (const [id,b] of bubbles) if (now-b.t0>SHOW_MS) bubbles.delete(id);
  for (const c of W.campaigns){
    if (!c.inspired || c.phase===2 || !c.members.length) continue;
    let talking=0; for (const id of c.members) if (bubbles.has(id)) talking++;
    if (talking>=2 || Math.random()>0.45) continue;
    const id=pick(c.members); if (!bubbles.has(id)) say(id,pick(LINES.revenge),now);
  }
}

/** Draws every bubble whose speaker is on screen (screen space; zoom and camera in render pixels). */
export function drawSpeech(ctx: CanvasRenderingContext2D, now: number, camX: number, camY: number, zoom: number, dpr: number, w: number, h: number){
  if (!bubbles.size) return;
  const byId=new Map(W.humans.map(p => [p.id,p]));
  const fs=Math.round(12*dpr), pad=Math.round(4*dpr), tail=Math.round(4*dpr), lw=Math.max(1,Math.round(1.5*dpr));
  ctx.font=`600 ${fs}px "Pixelify Sans", ui-monospace, monospace`; ctx.textAlign='center'; ctx.textBaseline='middle';
  const placed: number[][]=[];   // bubbles drawn so far: one that would overlap rises above them
  for (const [id,b] of bubbles){
    const p=byId.get(id), age=now-b.t0;
    if (!p || p.hp<=0 || age>SHOW_MS){ bubbles.delete(id); continue; }
    const sx=(p.x*K-camX)*zoom, sy=(p.y*K-camY)*zoom-13*zoom-tail;
    if (sx<-150 || sx>w+150 || sy<-40 || sy>h+40) continue;
    const a=reduceMotion ? 1 : Math.min(1,age/FADE_MS,(SHOW_MS-age)/FADE_MS), lift=reduceMotion ? 0 : (1-Math.min(1,age/FADE_MS))*4*dpr;
    const tw=ctx.measureText(b.text).width, bw=Math.round(tw+pad*2), bh=Math.round(fs+pad*1.6), x0=Math.round(sx-bw/2);
    let y0=Math.round(sy-bh-lift);
    for (let moved=true; moved;){ moved=false; for (const [px,py,pw,ph] of placed) if (x0<px+pw+4 && x0+bw+4>px && y0<py+ph+4 && y0+bh+4>py){ y0=py-bh-4*dpr; moved=true; } }
    placed.push([x0,y0,bw,bh]);
    ctx.globalAlpha=a;
    ctx.fillStyle='rgba(8,14,22,.95)';                                   // the dark edge, then the paper
    ctx.fillRect(x0-lw,y0-lw,bw+lw*2,bh+lw*2);
    const raised=y0+bh<sy-lift-1;   // stacked above another: no tail, it would point at the wrong man
    if (!raised){ ctx.beginPath(); ctx.moveTo(sx-tail-lw,y0+bh); ctx.lineTo(sx+lw,y0+bh+tail+lw); ctx.lineTo(sx+tail/2+lw,y0+bh); ctx.fill(); }
    ctx.fillStyle='#fbf3df'; ctx.fillRect(x0,y0,bw,bh);
    if (!raised){ ctx.beginPath(); ctx.moveTo(sx-tail,y0+bh-1); ctx.lineTo(sx,y0+bh+tail-lw); ctx.lineTo(sx+tail/2,y0+bh-1); ctx.fill(); }
    ctx.fillStyle='#2a1a12'; ctx.fillText(b.text,sx,y0+bh/2+dpr*0.5);
  }
  ctx.globalAlpha=1;
}
export function resetSpeech(){ bubbles.clear(); }
