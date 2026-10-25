export type RGB = number[];

export const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
export const hexRGB = (h: string): RGB => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
export const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
export const shade = (c: RGB, f: number) => f >= 0 ? mixc(c,[255,255,255],f) : mixc(c,[0,0,0],-f);
export const css = (c: RGB) => `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
export const pack = (r: number, g: number, b: number) => (255<<24 | clamp(b|0,0,255)<<16 | clamp(g|0,0,255)<<8 | clamp(r|0,0,255)) >>> 0;
export const fmt = (n: number) => { n = Math.max(0,n); return n >= 1e6 ? (n/1e6).toFixed(n >= 1e7 ? 0 : 1)+'M' : n >= 1e4 ? Math.round(n/1e3)+'k' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(Math.round(n)); };
export const fmtTime = (s: number) => { s = Math.floor(s); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
