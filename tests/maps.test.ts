// The real-world maps, and kingdoms as real countries with their flags and capitals.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, T_SNOW, T_MOUNT } from '../src/core/constants';
import { W, isLand, terr } from '../src/sim/state';
import { newWorld, startMatch } from '../src/sim/sim';
import { capitalsOn, REAL_MAPS } from '../src/sim/realmap';
import { VIEWS, tileXY } from '../src/sim/mapview';
import { COUNTRIES, countryByCode, flagPixels, flagSmall, colourGap } from '../src/core/countries';

/** Land tiles reachable from the first one, 4-connected. */
function reach(){
  const seen=new Uint8Array(NT), q=[W.landTiles[0]]; seen[q[0]]=1; let n=0;
  while (q.length){ const c=q.pop()!, x=c%TW; n++;
    for (const k of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (k>=0 && k<NT && isLand[k] && !seen[k]){ seen[k]=1; q.push(k); } }
  return n;
}
const near = (a: number, b: number) => Math.hypot(a%TW-b%TW, ((a/TW)|0)-((b/TW)|0));

describe('the real-world maps', () => {
  it('are the Balkans and Anatolia, Europe and the world, each one landmass every kingdom can cross', () => {
    expect(REAL_MAPS).toEqual(['balkans','europe','world']);
    for (const m of REAL_MAPS){
      newWorld(5,m);
      expect(W.map).toBe(m);
      expect(W.landCount).toBeGreaterThan(NT*0.15);
      expect(reach()).toBe(W.landCount);   // straits are bridged, stray islets dropped
      let mount=0; for (let t=0;t<NT;t++) if (terr[t]===T_MOUNT || terr[t]===T_SNOW) mount++;
      expect(mount).toBeGreaterThan(200);   // real ranges
    }
  });

  it('put places where they are: Ankara and Athens on land, the Black Sea at sea', () => {
    newWorld(5,'balkans');
    const at=(lat: number, lon: number) => { const p=tileXY(VIEWS.balkans,lat,lon,TW,TH)!; return p[1]*TW+p[0]; };
    expect(isLand[at(39.93,32.86)]).toBe(1);   // Ankara
    expect(isLand[at(43.4,34.0)]).toBe(0);     // the middle of the Black Sea
    expect(isLand[at(35.0,20.0)]).toBe(0);     // the Ionian Sea
    const caps=capitalsOn('balkans').map(c => c.country.code);
    for (const k of ['TR','GR','BG','RS','RO','HU','HR','AL','MK']) expect(caps).toContain(k);
    expect(caps).not.toContain('FR');
  });

  it('found the bots at their countries\' real capitals, and make the player the country whose capital is nearest', () => {
    newWorld(11,'balkans');
    const ankara=capitalsOn('balkans').find(c => c.country.code==='TR')!.tile;
    expect(startMatch(ankara+6,9)).toBe(true);
    const N=W.nations;
    expect(N[1].code).toBe('TR');
    expect(N[1].name).toBe('Turkey');
    expect(N.length).toBe(11);
    const caps=new Map(capitalsOn('balkans').map(c => [c.country.code, c.tile]));
    for (const n of N.slice(2)){
      expect(caps.has(n.code)).toBe(true);
      expect(near(n.capTile,caps.get(n.code)!)).toBeLessThan(16);   // at (or as near as the ground allows) the real capital
      expect(n.name).toBe(countryByCode.get(n.code)!.name);
      expect(n.hex).toBe(countryByCode.get(n.code)!.hex);
    }
    expect(new Set(N.slice(1).map(n => n.code)).size).toBe(10);   // no country twice
  });
});

describe('countries', () => {
  it('name every kingdom, on generated maps too, in colours that tell them apart', () => {
    newWorld(4242);
    let t=-1; for (let r=0;r<60 && t<0;r++) for (let dy=-r;dy<=r && t<0;dy++) for (let dx=-r;dx<=r;dx++){ const k=(TH/2+dy*3)*TW+TW/2+dx*3; if (startMatch(k,9)){ t=k; break; } }
    const N=W.nations.slice(1);
    for (const n of N) expect(countryByCode.get(n.code)?.name).toBe(n.name);
    for (let i=0;i<N.length;i++) for (let j=i+1;j<N.length;j++) expect(colourGap(N[i].hex,N[j].hex)).toBeGreaterThan(0.1);
  });

  it('each have a 12 by 8 flag (6 by 4 for a standard) and a capital', () => {
    expect(COUNTRIES.length).toBeGreaterThan(60);
    for (const k of COUNTRIES){
      const p=flagPixels(k.code);
      expect(p).toHaveLength(96);
      expect(new Set(p).size).toBeGreaterThan(1);   // more than a plain sheet
      expect(flagSmall(k.code)).toHaveLength(24);
      expect(Math.abs(k.cap[0])).toBeLessThan(70);
    }
    expect(new Set(COUNTRIES.map(k => k.code)).size).toBe(COUNTRIES.length);
  });
});
