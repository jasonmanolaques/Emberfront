// Armies on the march: along the roads between regions, as a column at most 10 men across, over any ground, across water by boat;
// armies of every size get where they are sent, nobody is left behind, and an army is at most 100 men.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, PW, T_GRASS, T_WATER, T_MOUNT, T_FOREST, T_HILLS, B_BARRACKS } from '../src/core/constants';
import { W, isLand, terr, pBuild, type Army } from '../src/sim/state';
import { newWorld, startMatch, tick } from '../src/sim/sim';
import { census } from '../src/sim/census';
import { build, placeProblem } from '../src/sim/buildings';
import { labelWorld, allocIsles } from '../src/sim/naval';
import { H_SOLDIER, makeHuman } from '../src/sim/population';
import { units, MAX_ARMY } from '../src/sim/army';
import { RG, region, setRegions, cedeRegion, flagXY } from '../src/sim/regions';
import { moveArmy, armyOrder, ARMY_SP, MARCH_FILES, A_HOME, A_MARCH, A_HOLD } from '../src/sim/war';
import { findWay } from '../src/sim/roads';

const N = (i: number) => W.nations[i];
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
function until(ok: () => boolean, max: number){ for (let i=0;i<max;i++){ if (ok()) return i; tick(); } throw new Error('timed out'); }
const S = 40;
const regionAt = (bx: number, by: number) => by*10+bx+1;

/** A grass map cut into square regions, `shape` changing the ground first (water, mountains...), the player alone. */
function world(shape?: (x: number, y: number) => number | null){
  newWorld(7); W.rushUntil=0;
  isLand.fill(1); terr.fill(T_GRASS); pBuild.fill(1);
  if (shape) for (let y=0;y<TH;y++) for (let x=0;x<TW;x++){ const k=shape(x,y); if (k===null) continue; const t=y*TW+x; terr[t]=k; isLand[t]=k===T_WATER ? 0 : 1; }
  W.landTiles=Int32Array.from({ length: NT }, (_, i) => i).filter(t => isLand[t]); W.landCount=W.landTiles.length;
  labelWorld();
  if (!startMatch((TH/2)*TW+60, 0)) throw new Error('no spawn');
  allocIsles();
  N(1).humanProg=-1e9; N(1).gold=1e7;
  const names: string[]=[]; for (let by=0;by<7;by++) for (let bx=0;bx<10;bx++) names.push(`R${bx}.${by}`);
  setRegions(t => regionAt(((t%TW)/S)|0, (((t/TW)|0)/S)|0), names);
  const home=region[N(1).capTile]; cedeRegion(home,1); census();
  return home;
}
/** An army of k men for the player, its barracks side by side round plot `near` in the castle's region. */
function army(k: number): Army {
  const n=N(1), mods=Math.ceil(k/5), c=n.capPlot, plots: number[]=[];
  for (let r=2;plots.length<mods && r<12;r++) for (let dy=-r;dy<=r && plots.length<mods;dy++) for (let dx=-r;dx<=r && plots.length<mods;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    const q=c+dy*PW+dx; n.stock=[100,100,100];
    if (!placeProblem(n,q,B_BARRACKS) && (plots.length===0 || plots.some(p => Math.abs(p%PW-q%PW)+Math.abs(((p/PW)|0)-((q/PW)|0))===1)) && build(n,q,B_BARRACKS)) plots.push(q);
  }
  const [x,y]=[(plots[0]%PW)*8+4, ((plots[0]/PW)|0)*8+9];
  for (let i=0;i<k;i++) W.humans.push(makeHuman(n,H_SOLDIER,x+(i%7)-3,y+((i/7)|0)*0.5));
  n.soldierShare=1;
  run(3);
  const a=W.armies.filter(a => a.o===1).sort((p,q) => q.files.flat().length-p.files.flat().length)[0];
  if (!a) throw new Error('no army');
  return a;
}
/** Sends army a to (px,py); true once it holds there with every man of it close by. Fails if it takes more than `slack` times the time a straight march would. */
function march(a: Army, px: number, py: number, slack=3){
  const d=Math.hypot(px-a.x,py-a.y), max=Math.ceil(d/(ARMY_SP*0.1)*slack)+600;
  expect(moveArmy(1,a.id,px,py)).toBe(true);
  tick();   // (the phalanx forms its column)
  let wide=0, onWater=0;
  const t=until(() => { if (a.mode===A_MARCH) wide=Math.max(wide,a.files.length); for (const f of a.files) for (const id of f){ const h=W.humans.find(h => h.id===id); if (h && !isLand[((h.y/2)|0)*TW+((h.x/2)|0)]) onWater++; } return a.mode===A_HOLD; }, max);
  run(120);   // (the ranks close up)
  const men=a.files.flat().map(id => W.humans.find(h => h.id===id)!).filter(Boolean);
  const far=men.filter(h => Math.hypot(h.x-a.x,h.y-a.y)>45).length;
  return { ticks:t, max, far, men:men.length, wide, onWater, at:Math.hypot(a.x-px,a.y-py) };
}

describe('marching', () => {
  for (const k of [5, 20, 50, 100]) it(`an army of ${k} crosses open ground in good time, a column at most ${MARCH_FILES} across, and nobody falls behind`, () => {
    world(); const a=army(k);
    expect(a.files.flat().length).toBe(k);
    const r=march(a,a.x+300,a.y);
    expect(r.at).toBeLessThan(1);
    expect(r.ticks).toBeLessThan(300/(ARMY_SP*0.1)*1.6+200);   // (a 100-man column waits a little for its rear at the start)
    expect(r.wide).toBeLessThanOrEqual(MARCH_FILES);
    expect(r.far).toBe(0);
    expect(r.men).toBe(k);
  });

  it('goes round a bay or rows across it, and over mountains, hills and forest: it always arrives', () => {
    // a bay of sea between the castle's region and the east, a band of mountains, forest and hills beyond
    const home=world((x,y) => x>=110 && x<150 && y>=40 && y<220 ? T_WATER : x>=170 && x<180 ? T_MOUNT : x>=200 && x<230 ? T_FOREST : x>=250 && x<270 ? T_HILLS : null);
    void home;
    for (const k of [10, 60]){
      const a=army(k);
      const r=march(a,300*2,124*2,4);
      expect(r.at).toBeLessThan(1);
      expect(r.far).toBe(0);
      moveArmy(1,a.id,a.x-400,a.y);   // (out of the way of the next)
      run(5);
    }
  });

  it('crosses the sea by boat to an island, and comes home again', () => {
    // the player's land on the west; an island in the east, beyond 30 tiles of sea
    world((x,y) => x>=200 && x<230 ? T_WATER : (x>=230 && (y<60 || y>190 || x>330)) ? T_WATER : null);
    const a=army(30);
    const r=march(a,280*2,124*2,4);
    expect(r.at).toBeLessThan(1);
    expect(r.onWater).toBeGreaterThan(0);   // (they rowed)
    expect(r.far).toBe(0);
    expect(armyOrder(1,a.id,'return')).toBe(true);
    until(() => a.mode===A_HOME, 6000);
  });

  it('takes a smooth way across the regions: no zigzag between their flags, never back the way it came', () => {
    world(); const a=army(10);
    const [bx,by]=[((N(1).capTile%TW)/S)|0, ((((N(1).capTile/TW)|0))/S)|0];
    const far=regionAt(bx+4,by+1), [fx,fy]=flagXY(far), way=findWay(1,a.x,a.y,fx,fy);
    // on flat ground: every step of the way is nearer the goal than the last, and the way is hardly longer than a straight line
    let len=0, px=a.x, py=a.y;
    for (let i=0;i<way.length;i+=2){ const d0=Math.hypot(fx-px,fy-py), d1=Math.hypot(fx-way[i],fy-way[i+1]); expect(d1).toBeLessThanOrEqual(d0+1e-6); len+=Math.hypot(way[i]-px,way[i+1]-py); px=way[i]; py=way[i+1]; }
    expect(len).toBeLessThan(Math.hypot(fx-a.x,fy-a.y)*1.05);
    const r=march(a,fx,fy);
    expect(r.at).toBeLessThan(1); expect(r.far).toBe(0);
  });

});

describe('the size of an army', () => {
  it('is at most 100 men: barracks side by side beyond 20 modules make a second army', () => {
    world();
    const n=N(1), c=n.capPlot, built: number[]=[];
    for (let dy=3;dy<9;dy++) for (let dx=-3;dx<3;dx++){ const q=c+dy*PW+dx; n.stock=[100,100,100]; if (!placeProblem(n,q,B_BARRACKS) && build(n,q,B_BARRACKS)) built.push(q); }
    expect(built.length).toBeGreaterThan(20);
    tick();
    const caps=units[1].map(u => u.cap).sort((a,b) => b-a);
    expect(caps[0]).toBe(MAX_ARMY);
    expect(caps.reduce((k,v) => k+v,0)).toBe(built.length*5);
  });
});

describe('on the map of Europe', () => {
  it('an army marches from its capital to far regions, across straits and seas, and arrives', () => {
    newWorld(3,'europe-s'); W.rushUntil=0;
    // France's capital: a long way to the south of Italy, Britain across the Channel, Africa across the sea
    let ok=false;
    for (const [lat,lon] of [[48.86,2.35]] as [number, number][]){
      const x=Math.floor((lon+25)/76*TW), y=Math.floor((71.5-lat)/42.5*TH);
      for (let r=0;r<20 && !ok;r++) ok=startMatch(y*TW+x+r,0,'FR');
    }
    expect(ok).toBe(true);
    N(1).humanProg=-1e9; N(1).gold=1e7;
    const a=army(20);
    const named=(n: string) => { const r=RG.names.indexOf(n); expect(r).toBeGreaterThan(0); return r; };
    for (const name of ['Sicily','Crete','Toscana']){
      const r=named(name), [fx,fy]=flagXY(r);
      const res=march(a,fx,fy,5);
      expect(res.at).toBeLessThan(1);
      expect(res.far).toBe(0);
    }
  }, 240000);

  it('marches from one capital to regions all over the map (ten picked evenly), and arrives at every one', () => {
    newWorld(3,'europe-s'); W.rushUntil=0;
    const x=Math.floor((2.35+25)/76*TW), y=Math.floor((71.5-48.86)/42.5*TH);
    let ok=false; for (let r=0;r<20 && !ok;r++) ok=startMatch(y*TW+x+r,0,'FR');
    expect(ok).toBe(true);
    N(1).humanProg=-1e9; N(1).gold=1e7;
    const a=army(15);
    for (let i=1;i<=10;i++){
      const r=Math.floor(i*(RG.n-1)/11), [fx,fy]=flagXY(r);
      const res=march(a,fx,fy,5);
      expect(res.at, RG.names[r]).toBeLessThan(1);
      expect(res.far, RG.names[r]).toBe(0);
    }
  }, 600000);
});
