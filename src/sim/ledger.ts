/* ---------- the ledger: goods coming in and goods spent, over the last minute ----------
   Every good a kingdom gains (villagers bringing it home, plantations, quarries and mines) and
   every good its builders and smiths spend is written into a bucket for the second it happened in;
   sixty buckets make a running minute. The city investment slider says what share of the goods
   coming in the builders may spend: a builder only starts on another improvement while what has
   been spent this past minute, plus its cost, stays within that share of what came in. */
import { W, type Nation } from './state';

let lastSec = -1;
const bucket = () => Math.floor(W.simTime)%60;
/** Clears the bucket for a new second (call once a tick). */
export function turnLedger(){
  const s=bucket(); if (s===lastSec) return;
  lastSec=s;
  for (const n of W.nations) for (let g=0;g<3;g++){ n.gain[s*3+g]=0; n.spend[s*3+g]=0; }
}
export function resetLedger(){ lastSec=-1; }
export const gained = (n: Nation, g: number, k: number) => { n.gain[bucket()*3+g]+=k; };
export const spent = (n: Nation, g: number, k: number) => { n.spend[bucket()*3+g]+=k; };
/** Goods per minute, by good: [wood, stone, copper], coming in and spent. */
export function perMinute(n: Nation){
  const gain=[0,0,0], spend=[0,0,0];
  for (let i=0;i<180;i++){ gain[i%3]+=n.gain[i]; spend[i%3]+=n.spend[i]; }
  return { gain, spend };
}
/** May the builders spend `cost` ([wood, stone, copper]) now, within the city investment? */
export function mayInvest(n: Nation, cost: number[]){
  const { gain, spend }=perMinute(n);
  return cost.every((c,g) => !c || spend[g]+c<=n.invest*gain[g]+1e-9);
}
