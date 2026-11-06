// The real-world maps, and kingdoms as real countries with their flags and capitals.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, T_SNOW, T_MOUNT, MAX_KINGDOMS, EUROPE_KINGDOMS, kingdomLimit } from '../src/core/constants';
import { W, isLand, terr } from '../src/sim/state';
import { newWorld, startMatch } from '../src/sim/sim';
import { capitalsOn, REAL_MAPS } from '../src/sim/realmap';
import { VIEWS, tileXY } from '../src/sim/mapview';
import { COUNTRIES, countryByCode, flagPixels, flagSmall, colourGap } from '../src/core/countries';
import { cultureOf, TRADITIONS } from '../src/render/capitals';
import { EUROPE } from '../src/sim/maps';

/** The land tiles of the landmass tile s is on, 4-connected. */
function landmass(s: number){
  const seen=new Uint8Array(NT), q=[s], out: number[]=[]; seen[s]=1;
  while (q.length){ const c=q.pop()!, x=c%TW; out.push(c);
    for (const k of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (k>=0 && k<NT && isLand[k] && !seen[k]){ seen[k]=1; q.push(k); } }
  return out;
}
/** Land tiles reachable from the first one, 4-connected. */
function reach(){
  const seen=new Uint8Array(NT), q=[W.landTiles[0]]; seen[q[0]]=1; let n=0;
  while (q.length){ const c=q.pop()!, x=c%TW; n++;
    for (const k of [x>0?c-1:-1, x<TW-1?c+1:-1, c-TW, c+TW]) if (k>=0 && k<NT && isLand[k] && !seen[k]){ seen[k]=1; q.push(k); } }
  return n;
}
const near = (a: number, b: number) => Math.hypot(a%TW-b%TW, ((a/TW)|0)-((b/TW)|0));

describe('the real-world maps', () => {
  it('are the Balkans and Anatolia, Europe and the world: the first and last one landmass every kingdom can cross', () => {
    expect(REAL_MAPS).toEqual(['balkans','europe','europe-s','world']);
    for (const m of REAL_MAPS){
      newWorld(5,m);
      expect(W.map).toBe(m);
      expect(W.landCount).toBeGreaterThan(NT*0.15);
      if (m!=='europe' && m!=='europe-s') expect(reach()).toBe(W.landCount);   // straits are bridged, stray islets dropped
      let mount=0; for (let t=0;t<NT;t++) if (terr[t]===T_MOUNT || terr[t]===T_SNOW) mount++;
      expect(mount).toBeGreaterThan(200);   // real ranges
    }
  });

  it('draw Europe at twice the scale, with the sea as it is: islands stand alone, and the mountains are where the ground is high', () => {
    newWorld(5,'europe');
    expect([TW,TH]).toEqual([1824,1488]);   // a tile is about 3 km, from Iceland to Azerbaijan
    expect(EUROPE.includes('C')).toBe(false);   // no land bridges
    const at=(lat: number, lon: number) => { const p=tileXY(VIEWS.europe,lat,lon,TW,TH)!; return p[1]*TW+p[0]; };
    // the islands, apart from the mainland (and from each other)
    const mainland=landmass(at(48.86,2.35)), main=new Set(mainland);
    for (const [lat,lon] of [[52.5,-1.5],[53.4,-8.0],[64.9,-18.5],[37.5,14.2],[40.1,9.0],[42.1,9.1],[35.2,24.9],[35.0,33.2]]){
      const t=at(lat,lon); expect(isLand[t]).toBe(1); expect(main.has(t)).toBe(false);   // Britain, Ireland, Iceland, Sicily, Sardinia, Corsica, Crete, Cyprus
    }
    expect(landmass(at(52.5,-1.5)).includes(at(53.4,-8.0))).toBe(false);   // (Britain and Ireland too)
    // small islands with a capital on them are kept: Malta
    const valletta=capitalsOn('europe').find(c => c.country.code==='MT');
    expect(valletta).toBeDefined();
    // snow and rock on the Alps, the Caucasus and Norway's fjells; none on the plains
    const high=(lat: number, lon: number, r: number) => { let k=0; const c=at(lat,lon); for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){ const tr=terr[c+dy*TW+dx]; if (tr===T_MOUNT || tr===T_SNOW) k++; } return k; };
    expect(high(45.9,7.6,6)).toBeGreaterThan(40);    // the Alps by Monte Rosa
    expect(high(43.2,42.5,6)).toBeGreaterThan(40);   // the Caucasus
    expect(high(61.6,8.3,6)).toBeGreaterThan(40);    // Jotunheimen
    expect(high(47.0,19.8,8)).toBe(0);               // the Hungarian plain
    expect(high(52.2,5.3,8)).toBe(0);                // the Netherlands
    expect(high(55.5,37.5,8)).toBe(0);               // round Moscow
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
      expect(near(n.capTile,caps.get(n.code)!)).toBeLessThan(26);   // at (or as near as the ground allows) the real capital
      expect(n.name).toBe(countryByCode.get(n.code)!.name);
      expect(n.hex).toBe(countryByCode.get(n.code)!.hex);
    }
    expect(new Set(N.slice(1).map(n => n.code)).size).toBe(10);   // no country twice
  });

  it('play the country chosen from its capital, against exactly the countries chosen, each at its own capital', () => {
    newWorld(3,'europe');
    const caps=new Map(capitalsOn('europe').map(c => [c.country.code, c.tile]));
    const rivals=['IT','AL','MK','BG','RS','TR','RO','HU','AT','SK','CZ','PL','DE','FR','ES','PT','GB','IE','NL','BE'];
    expect(startMatch(caps.get('GR')!,rivals,'GR')).toBe(true);
    const N=W.nations;
    expect(N[1].code).toBe('GR');
    expect(near(N[1].capTile,caps.get('GR')!)).toBeLessThan(8);   // Athens
    expect(N.slice(2).map(n => n.code)).toEqual(rivals);
    for (const n of N.slice(2)){ expect(n.alive).toBe(true); expect(near(n.capTile,caps.get(n.code)!)).toBeLessThan(26); }
    // close neighbours with near-identical flag colours are told apart
    for (let i=1;i<N.length;i++) for (let j=i+1;j<N.length;j++) expect(colourGap(N[i].hex,N[j].hex)).toBeGreaterThanOrEqual(0.05);
  });

  it('hold a full game on Europe: 24 kingdoms (you and 23 of the 61 other countries with a capital on it), each at its real capital', () => {
    newWorld(2,'europe');
    expect([TW,TH]).toEqual([1824,1488]);
    const caps=capitalsOn('europe'), codes=caps.map(c => c.country.code);
    expect(codes.length).toBeGreaterThanOrEqual(60);
    for (const k of ['IS','PT','GB','FR','DE','IT','PL','RU','TR','EG','AZ','AD','VA','LI']) expect(codes).toContain(k);
    expect(startMatch(caps.find(c => c.country.code==='FR')!.tile,codes.filter(c => c!=='FR'),'FR')).toBe(true);
    expect(W.nations.length-1).toBe(EUROPE_KINGDOMS);   // the limit, though every country was asked for
    expect(W.nations.slice(1).every(n => n.alive)).toBe(true);
    const at=new Map(caps.map(c => [c.country.code, c.tile]));
    for (const n of W.nations.slice(1)) expect(near(n.capTile,at.get(n.code)!)).toBeLessThan(30);
    expect(W.landCount/EUROPE_KINGDOMS).toBeGreaterThan(25000);   // room to grow: far more land each than a generated game of 10
  });

  it('are bigger than a generated map, so close capitals have room', () => {
    newWorld(3,'world'); expect([TW,TH]).toEqual([640,396]);
    newWorld(3,'balkans'); expect([TW,TH]).toEqual([560,348]);
    newWorld(3); expect([TW,TH]).toEqual([400,248]);
    expect(isLand.length).toBe(400*248);
  });
});

describe('countries', () => {
  it('name every kingdom on generated maps too, chosen or at random, in colours that tell them apart', () => {
    newWorld(4242);
    let s=-1; for (let r=0;r<60 && s<0;r++) for (let dy=-r;dy<=r && s<0;dy++) for (let dx=-r;dx<=r;dx++){ const k=(TH/2+dy*3)*TW+TW/2+dx*3; if (startMatch(k,['FR','DE','JP'],'BR')){ s=k; break; } }
    expect(W.nations.slice(1).map(n => n.code)).toEqual(['BR','FR','DE','JP']);
    newWorld(4242);
    let t=-1; for (let r=0;r<60 && t<0;r++) for (let dy=-r;dy<=r && t<0;dy++) for (let dx=-r;dx<=r;dx++){ const k=(TH/2+dy*3)*TW+TW/2+dx*3; if (startMatch(k,9)){ t=k; break; } }
    const N=W.nations.slice(1);
    for (const n of N) expect(countryByCode.get(n.code)?.name).toBe(n.name);
    for (let i=0;i<N.length;i++) for (let j=i+1;j<N.length;j++) expect(colourGap(N[i].hex,N[j].hex)).toBeGreaterThan(0.1);
  });

  it('each build their capital in their own tradition, from two dozen', () => {
    const used=new Set(COUNTRIES.map(k => cultureOf(k.code)));
    for (const c of used) expect(c==='west' || TRADITIONS.includes(c)).toBe(true);
    expect(TRADITIONS.length).toBeGreaterThanOrEqual(24);
    expect(TRADITIONS.every(t => used.has(t))).toBe(true);   // every tradition has a country
    expect([cultureOf('TR'), cultureOf('GR'), cultureOf('RU'), cultureOf('CN'), cultureOf('JP'), cultureOf('US'), cultureOf('FR')]).toEqual(['ottoman','greek','kremlin','chinese','japanese','capitol','west']);
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

  it('Europe holds 24 kingdoms: you and 23 rivals, however many are asked for, out of all the countries that could play', () => {
    expect([kingdomLimit('europe'), EUROPE_KINGDOMS, kingdomLimit('balkans'), kingdomLimit('gen')]).toEqual([24, 24, MAX_KINGDOMS, MAX_KINGDOMS]);
    newWorld(5,'europe');
    const all=capitalsOn('europe');
    expect(all.length).toBeGreaterThan(61);   // (more than 29 could be drawn from)
    const me=all.find(c => c.country.code==='GR')!;
    const rivals=all.map(c => c.country.code).filter(c => c!=='GR');
    expect(startMatch(me.tile,rivals,'GR')).toBe(true);
    expect(W.nations.length-1).toBe(24);
    expect(W.nations[1].code).toBe('GR');
  });

  it('have a small Europe for testing: the same Europe at two thirds of the size each way, with its own limit of 16 kingdoms', () => {
    newWorld(5,'europe-s');
    expect([TW,TH]).toEqual([1216,992]);
    const big=capitalsOn('europe').length, small=capitalsOn('europe-s').length;
    expect(small).toBeGreaterThan(big*0.85);               // nearly every capital is still on land
    const at=(lat: number, lon: number) => { const p=tileXY(VIEWS['europe-s'],lat,lon,TW,TH)!; return p[1]*TW+p[0]; };
    expect(isLand[at(48.86,2.35)]).toBe(1);                // Paris
    expect(isLand[at(52.5,-1.5)]).toBe(1);                 // Britain
    expect(isLand[at(45,-1.5)]).toBe(0);                   // the Bay of Biscay
    expect(W.landCount).toBeGreaterThan(NT*0.2);
    expect(kingdomLimit('europe-s')).toBe(16);
    const me=capitalsOn('europe-s').find(c => c.country.code==='FR')!;
    const rivals=capitalsOn('europe-s').map(c => c.country.code).filter(c => c!=='FR');
    expect(startMatch(me.tile,rivals,'FR')).toBe(true);
    expect(W.nations.length-1).toBe(16);
  });

  it('lets a country with no capital on the map play there all the same, founded at a random place', () => {
    newWorld(5,'europe-s');
    const on=new Set(capitalsOn('europe-s').map(c => c.country.code)), away=COUNTRIES.find(k => !on.has(k.code))!;
    expect(away).toBeDefined();
    const all=capitalsOn('europe-s'), me=all.find(c => c.country.code==='DE')!;
    expect(startMatch(me.tile,[away.code,'FR','IT'],'DE')).toBe(true);
    const n=W.nations.find(k => k.code===away.code)!;
    expect(n).toBeDefined(); expect(n.alive).toBe(true); expect(n.capTile).toBeGreaterThanOrEqual(0);
  });

  it('can found the rivals at random places, or at random places that keep near each other, each still its own country', () => {
    const run=(placement: 'real' | 'random' | 'near') => {
      newWorld(5,'europe-s');
      const all=capitalsOn('europe-s'), me=all.find(c => c.country.code==='DE')!;
      const rivals=all.map(c => c.country.code).filter(c => c!=='DE').slice(0,15);
      expect(startMatch(me.tile,rivals,'DE',placement)).toBe(true);
      const ns=W.nations.slice(1).filter(n => n.alive);
      return { ns, real:new Map(all.map(c => [c.country.code, c.tile])) };
    };
    const real=run('real'); expect(real.ns.length).toBe(16);
    for (const n of real.ns) expect(near(n.capTile,real.real.get(n.code)!)).toBeLessThan(30);   // (each at its capital)
    const rnd=run('random'); expect(rnd.ns.length).toBe(16);
    expect(rnd.ns.filter(n => near(n.capTile,rnd.real.get(n.code)!)>60).length).toBeGreaterThan(8);   // (most are far from their capitals)
    expect(new Set(rnd.ns.map(n => n.code)).size).toBe(16);
    const nr=run('near'); expect(nr.ns.length).toBe(16);
    const far=TW*0.07*1.7, close=nr.ns.filter(n => nr.ns.some(o => o!==n && near(n.capTile,o.capTile)<far)).length;
    expect(close).toBeGreaterThanOrEqual(15);                 // everyone has another kingdom within reach
  });
});
