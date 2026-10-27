/* ---------- view canvas & camera ---------- */
import { TW, TH, RW, RH, RS } from '../core/constants';
import { clamp } from '../core/util';
import { client, reduceMotion } from '../client';

export const view = document.getElementById('view') as HTMLCanvasElement;
export const ctx = view.getContext('2d') as CanvasRenderingContext2D;

interface CamAnim { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t0: number; d: number; }
export const cam = { dpr: 1, x: 0, y: 0, zoom: 1, fitZ: 1, anim: null as CamAnim | null };

// the camera works in render pixels (RS per tile); zoom is screen pixels per render pixel
export function fitCam(){ const w=view.width, h=view.height; cam.fitZ=Math.min(w/RW,h/RH); cam.zoom=cam.fitZ*1.02; cam.x=(RW-w/cam.zoom)/2; cam.y=(RH-h/cam.zoom)/2; }
function maxZ(){ return 8*cam.dpr; }
/** Keeps the map on screen: little sea past its edges, and centred along a side it doesn't fill. */
export function clampCam(){
  const w=view.width/cam.zoom, h=view.height/cam.zoom, mx=w*0.06, my=h*0.06;
  cam.x = w>=RW ? (RW-w)/2 : clamp(cam.x,-mx,RW-w+mx);
  cam.y = h>=RH ? (RH-h)/2 : clamp(cam.y,-my,RH-h+my);
}
export function zoomAt(f: number, sx: number, sy: number){ const nz=clamp(cam.zoom*f,cam.fitZ,maxZ()); const wx=cam.x+sx/cam.zoom, wy=cam.y+sy/cam.zoom; cam.zoom=nz; cam.x=wx-sx/cam.zoom; cam.y=wy-sy/cam.zoom; cam.anim=null; clampCam(); }
export function focusOn(t: number, z: number){
  z=clamp(z,cam.fitZ,maxZ());
  const tx=(t%TW)*RS+RS/2, ty=((t/TW)|0)*RS+RS/2, x1=tx-view.width/z/2, y1=ty-view.height/z/2;
  if (reduceMotion){ cam.zoom=z; cam.x=x1; cam.y=y1; return; }
  cam.anim={x0:cam.x,y0:cam.y,z0:cam.zoom,x1,y1,z1:z,t0:performance.now(),d:750};
}
export function stepCamAnim(now: number){
  const a=cam.anim; if (!a) return;
  const k=clamp((now-a.t0)/a.d,0,1), e=k<0.5?2*k*k:1-Math.pow(-2*k+2,2)/2, w=view.width, h=view.height;
  const c0x=a.x0+w/a.z0/2, c0y=a.y0+h/a.z0/2, c1x=a.x1+w/a.z1/2, c1y=a.y1+h/a.z1/2;
  cam.zoom=a.z0*Math.pow(a.z1/a.z0,e); cam.x=c0x+(c1x-c0x)*e-w/cam.zoom/2; cam.y=c0y+(c1y-c0y)*e-h/cam.zoom/2;
  if (k>=1) cam.anim=null;
}
export function resize(){
  const oldW=view.width, oldH=view.height;
  cam.dpr=Math.min(2,window.devicePixelRatio||1);
  const r=view.getBoundingClientRect();
  view.width=Math.max(1,Math.round(r.width*cam.dpr)); view.height=Math.max(1,Math.round(r.height*cam.dpr));
  const cx=cam.x+oldW/cam.zoom/2, cy=cam.y+oldH/cam.zoom/2;
  cam.fitZ=Math.min(view.width/RW,view.height/RH);
  if (client.state==='intro' || client.state==='spawn' || oldW<=1) fitCam();
  else { cam.zoom=clamp(cam.zoom,cam.fitZ,maxZ()); cam.x=cx-view.width/cam.zoom/2; cam.y=cy-view.height/cam.zoom/2; clampCam(); }
}
/** Map tile under a point in device pixels, or -1. */
export function tileAt(sx: number, sy: number){ const X=Math.floor((cam.x+sx/cam.zoom)/RS), Y=Math.floor((cam.y+sy/cam.zoom)/RS); if (X<0||Y<0||X>=TW||Y>=TH) return -1; return Y*TW+X; }
