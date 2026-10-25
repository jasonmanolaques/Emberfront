/* ---------- seeded randomness & noise ---------- */
export type Rng = () => number;
export type Noise = (x: number, y: number) => number;

export function mulberry32(a: number): Rng { return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
export function makeNoise(seed: number): Noise {
  const r = mulberry32(seed), p = new Uint8Array(256);
  for (let i=0;i<256;i++) p[i]=i;
  for (let i=255;i>0;i--){ const j=(r()*(i+1))|0, t=p[i]; p[i]=p[j]; p[j]=t; }
  const perm = new Uint8Array(512); for (let i=0;i<512;i++) perm[i]=p[i&255];
  const val = new Float32Array(256); for (let i=0;i<256;i++) val[i]=r();
  return (x,y) => {
    const xi=Math.floor(x), yi=Math.floor(y), xf=x-xi, yf=y-yi, X=xi&255, Y=yi&255;
    const a=val[perm[X+perm[Y]]], b=val[perm[X+1+perm[Y]]], c=val[perm[X+perm[Y+1]]], d=val[perm[X+1+perm[Y+1]]];
    const u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf);
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
  };
}
export function fbm(n: Noise, x: number, y: number, oct: number){ let s=0,a=1,f=1,t=0; for(let i=0;i<oct;i++){ s+=a*n(x*f,y*f); t+=a; a*=0.5; f*=2.03; } return s/t; }
