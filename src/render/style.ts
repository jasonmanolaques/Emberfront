/* ---------- per-nation colours derived from the nation's hex ---------- */
import { hexRGB, shade, css, pack } from '../core/util';
import { W } from '../sim/state';

export interface NationStyle {
  roof: string; roofD: string; roofL: string; light: string;
  bp: number; bpIn: number;                     // packed border colour, and the paler line just inside it
  outline: string;                              // dark edge for sprites in this kingdom's colours
  ia: number; fr: number; fg: number; fb: number;   // territory tint: c*ia + f
}

const UNCLAIMED: NationStyle = { roof:'#888', roofD:'#888', roofL:'#888', light:'#ffffff', bp:0, bpIn:0, outline:'#222', ia:1, fr:0, fg:0, fb:0 };
let styles: NationStyle[] = [];

function makeStyle(hex: string): NationStyle {
  const c=hexRGB(hex), A=0.3, lt=shade(c,0.45);
  return { roof:hex, roofD:css(shade(c,-0.3)), roofL:css(shade(c,0.28)), light:css(shade(c,0.5)),
    bp:pack(c[0],c[1],c[2]), bpIn:pack(lt[0],lt[1],lt[2]), outline:css(shade(c,-0.72)), ia:1-A, fr:c[0]*A, fg:c[1]*A, fb:c[2]*A };
}
export function styleOf(id: number): NationStyle {
  if (!id) return UNCLAIMED;
  return styles[id] ??= makeStyle(W.nations[id].hex);
}
export function resetStyles(){ styles=[]; }
