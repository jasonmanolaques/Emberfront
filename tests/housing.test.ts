// Homes: villagers build a hovel when the kingdom is short of houses; spare houses stand empty.
import { describe, it, expect } from 'vitest';
import { TW, TH, NT, NP, PW, B_HOUSE, B_SITE, B_EMPTY, B_MINTER, GOLD_PER_SEC, TAX_PER_VILLAGER } from '../src/core/constants';
import { W, owner, isLand, pType, pOwner, pAband, pCenter, pBuild } from '../src/sim/state';
import { newWorld, startMatch, queueCommand, tick } from '../src/sim/sim';
import { build, plotProblem } from '../src/sim/buildings';
import { H_VILLAGER, H_SOLDIER, TASK_ROAM, TASK_HOME_GO, TASK_HOME_BUILD, TASK_GATHER, BUILD_TICKS, ABANDON_TICKS, BEG_TICKS, STARVE_TICKS } from '../src/sim/population';
import { listen } from '../src/sim/events';
import { B_BARRACKS } from '../src/core/constants';

const me = () => W.nations[1];
const mine = () => W.humans.filter(h => h.o === 1);
const run = (n: number) => { for (let i=0;i<n;i++) tick(); };
const houses = () => { const out: number[]=[]; for (let q=0;q<NP;q++) if (pType[q]===B_HOUSE && pOwner[q]===1) out.push(q); return out; };
const building = () => mine().filter(h => h.task===TASK_HOME_GO || h.task===TASK_HOME_BUILD);
function start(seed: number, rivals: number){
  newWorld(seed);
  for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
    if (startMatch((TH/2+dy*3)*TW + TW/2+dx*3, rivals)) return;
  }
  throw new Error('no spawn spot');
}
function expand(rounds: number){
  for (let r=0;r<rounds;r++){
    let t=-1;
    for (let i=0;i<NT && t<0;i++) if (!owner[i] && isLand[i] && [i-1,i+1,i-TW,i+TW].some(k => owner[k]===1)) t=i;
    W.nations[1].gold+=400;   // plenty of room to build in
    if (t>=0) queueCommand({ type: 'attack', nation: 1, tile: t, ratio: 0.8 });
    run(40);
  }
}
/** Removes a person the way the game does when someone dies (their claims are let go). */
const kill = (h: { hp: number }) => { h.hp=0; tick(); };
/** Ticks until `ok` holds, failing the test rather than hanging if it never does. */
function until(ok: () => boolean, max = 6000){ for (let i=0;i<max;i++){ if (ok()) return; tick(); } throw new Error('condition never met'); }
const fromCapital = (q: number) => { const c=me().capTile; return Math.hypot((pCenter[q]%TW)-(c%TW), ((pCenter[q]/TW)|0)-((c/TW)|0)); };

describe('building homes', () => {
  it('starts with no houses; the first villager builds one before anything else', () => {
    start(12345, 0);
    expect(houses()).toHaveLength(0);
    until(() => mine().length>0);
    const h=mine()[0], seen=[h.task];
    expect(h.task).toBe(TASK_HOME_GO);
    expect(pType[h.home]).toBe(B_SITE);   // the site is marked out straight away
    const site=h.home;
    for (let i=0;i<1000 && seen.length<4;i++){ tick(); if (seen.at(-1)!==h.task) seen.push(h.task); }
    expect(seen.slice(0,3)).toEqual([TASK_HOME_GO, TASK_HOME_BUILD, seen[2]]);
    expect(seen[2]).not.toBe(TASK_HOME_BUILD);
    expect(pType[site]).toBe(B_HOUSE);
    expect(me().houses).toBeGreaterThanOrEqual(1);
    expect(fromCapital(site)).toBeLessThan(16);   // next to the town, not out in the wilds
  });

  it('takes BUILD_TICKS to put a house up', () => {
    start(12345, 0);
    // catch a builder the tick he arrives and starts work
    let h; for (let i=0;i<3000 && !h;i++){ const going=new Set(mine().filter(x => x.task===TASK_HOME_GO).map(x => x.id)); tick(); h=mine().find(x => x.task===TASK_HOME_BUILD && going.has(x.id)); }
    if (!h) throw new Error('nobody started building');
    const site=h.home;
    run(BUILD_TICKS-1); expect(pType[site]).toBe(B_SITE);
    run(1);             expect(pType[site]).toBe(B_HOUSE);
  });

  it('keeps one house per person as the kingdom grows', () => {
    start(987654321, 0); expand(12); run(3000);
    const people=mine().length, b=building().length, n=me();
    expect(people).toBeGreaterThan(25);
    expect(n.houses + b).toBe(people);
    expect(new Set(mine().filter(h => h.home>=0).map(h => h.home)).size).toBe(b);   // no two build the same house
  });

  it('sends a newcomer straight to work when a house is free', () => {
    start(12345, 0); expand(6);
    until(() => me().houses>=6 && !building().length);
    // two people die; their houses stay
    const h0=houses().length;
    for (const h of mine().slice(0,2)) h.hp=0;
    tick();
    const before=new Set(mine().map(h => h.id));
    until(() => mine().some(h => !before.has(h.id)));
    const newcomer=mine().find(h => !before.has(h.id))!;
    expect(newcomer.kind).toBe(H_VILLAGER);
    expect([TASK_HOME_GO, TASK_HOME_BUILD]).not.toContain(newcomer.task);
    expect(houses()).toHaveLength(h0);
  });

  it('counts soldiers as people who need a home too', () => {
    start(12345, 0); expand(6);
    run(1200);
    expect(me().houses + building().length).toBe(mine().length);
    void H_SOLDIER;
  });

  it('gives up a half-built house when the builder is gone, and clears the site', () => {
    start(12345, 0); expand(4);
    until(() => building().length>0);
    const h=building()[0], site=h.home;
    expect(pType[site]).toBe(B_SITE);
    kill(h);
    expect(pType[site]).toBe(B_EMPTY);
  });
});

describe('empty houses', () => {
  it('leaves the outermost spare houses empty after a while, and fills the innermost first again', () => {
    start(987654321, 0); expand(10);
    until(() => me().houses>=16);
    me().humanProg=-1e9;                      // no newcomers for now
    until(() => !building().length);
    // six people die
    for (const h of mine().filter(h => h.home<0).slice(0,6)) h.hp=0;
    tick();
    const spare=houses().length-mine().length;
    expect(spare).toBeGreaterThanOrEqual(6);
    run(ABANDON_TICKS-20);
    expect(houses().filter(q => pAband[q])).toHaveLength(0);   // not yet: it takes a while
    run(40);
    const empty=houses().filter(q => pAband[q]), lived=houses().filter(q => !pAband[q]);
    expect(empty).toHaveLength(spare);
    expect(me().abandoned).toBe(spare);
    expect(Math.min(...empty.map(fromCapital))).toBeGreaterThanOrEqual(Math.max(...lived.map(fromCapital)) - 1e-9);   // the outskirts
    // two newcomers: the two innermost empty houses come back to life
    // nearest first, exact squared distance in tiles with ties by plot, as the game ranks them
    const c=me().capTile, d2=(q: number)=>((pCenter[q]%TW)-(c%TW))**2+(((pCenter[q]/TW)|0)-((c/TW)|0))**2;
    const innermost=[...empty].sort((a,b) => d2(a)-d2(b) || a-b).slice(0,2);
    me().humanProg=0; const target=mine().length+2;
    until(() => mine().length>=target);
    run(10);
    expect(houses().filter(q => pAband[q])).toHaveLength(spare-2);
    for (const q of innermost) expect(pAband[q]).toBe(0);
    expect(building()).toHaveLength(0);       // they moved in rather than building
  });
});

describe('tax', () => {
  it('adds 0.1 gold a second for each villager, nothing for soldiers, and minters add 10% on top', () => {
    start(12345, 0); expand(6); run(1200);
    const n=me();
    expect(n.villagers).toBeGreaterThan(5);
    tick();
    expect(n.income).toBeCloseTo((GOLD_PER_SEC + TAX_PER_VILLAGER*n.taxpayers)*(1+0.1*n.minters), 9);
    // two minters on top
    for (let k=0;k<2;k++){ let q=-1; for (let p=0;p<NP && q<0;p++) if (!plotProblem(n,p)) q=p; n.stock=[5,5,5]; build(n,q,B_MINTER); }
    tick();
    expect(n.income).toBeCloseTo((GOLD_PER_SEC + TAX_PER_VILLAGER*n.taxpayers)*1.2, 9);
    void B_EMPTY;
  });
});

describe('homeless people and beggars', () => {
  /** A town of 8 housed people, then no room left to build and two houses gone: the two newest are homeless. */
  function crowded(){
    start(12345, 0); expand(6);
    until(() => me().houses>=8 && !building().length);
    me().humanProg=-1e9;
    until(() => !building().length);
    pBuild.fill(0);   // no room left anywhere to build another house
    const hs=houses(); for (const q of hs.slice(-2)){ pType[q]=B_EMPTY; pOwner[q]=0; }
    me().houses-=2; me().beds-=2;
    tick();
  }

  it('leaves the newest arrivals homeless, and they pay no tax', () => {
    crowded();
    const people=[...mine()].sort((a,b) => a.id-b.id), homeless=people.filter(h => !h.housed);
    expect(homeless.length).toBe(people.length-me().houses);
    expect(homeless.map(h => h.id)).toEqual(people.slice(-homeless.length).map(h => h.id));
    expect(me().homeless).toBe(homeless.length);
    const villagers=mine().filter(h => h.kind===H_VILLAGER && !h.beggar).length;
    expect(me().taxpayers).toBe(villagers-homeless.filter(h => h.kind===H_VILLAGER).length);
    tick();   // income is worked out at the start of a tick, from the last tick's head count
    expect(me().income).toBeCloseTo((GOLD_PER_SEC + TAX_PER_VILLAGER*me().taxpayers)*(1+0.1*me().minters), 9);
  });

  it('turns a villager homeless for a minute into a beggar who does no work', () => {
    crowded();
    const h=mine().filter(h => !h.housed && h.kind===H_VILLAGER)[0];
    run(BEG_TICKS-5); expect(h.beggar).toBe(false);
    run(10);          expect(h.beggar).toBe(true);
    expect(me().beggars).toBeGreaterThan(0);
    for (let i=0;i<300;i++){ tick(); expect(h.task).toBe(TASK_ROAM); expect(h.carry).toBe(-1); expect(h.res).toBe(-1); expect(h.home).toBe(-1); }
    expect(h.sp).toBeLessThanOrEqual(1);   // crawls
  });

  it('never recruits a beggar', () => {
    crowded();
    const plots=[]; for (let q=0;q<NP;q++) if (pType[q]===0 && owner[pCenter[q]]===1) plots.push(q);
    pBuild.fill(1); me().stock=[5,5,0]; expect(build(me(), plots.find(q => !plotProblem(me(),q))!, B_BARRACKS)).toBe(true); pBuild.fill(0);
    run(BEG_TICKS+10);
    const beggars=mine().filter(h => h.beggar);
    expect(beggars.length).toBeGreaterThan(0);
    queueCommand({ type: 'soldiers', nation: 1, share: 1 }); run(200);   // (before they die of want)
    for (const h of beggars) expect(W.humans.includes(h) && h.kind===H_VILLAGER && h.beggar).toBe(true);
  });

  it('lets a beggar homeless for a minute and a half die of want: he drops where he stands, unwounded', () => {
    crowded(); run(BEG_TICKS+10);
    const b=mine().find(h => h.beggar)!, died: unknown[][]=[];
    listen({ died: (...a: unknown[]) => { died.push(a); } });
    expect(STARVE_TICKS).toBe(900);
    while (b.homeless<STARVE_TICKS-1){ expect(W.humans.includes(b)).toBe(true); tick(); }
    run(2);
    expect(W.humans.includes(b)).toBe(false);
    const d=died.find(a => a[3]===b.id)!;
    expect([d[4], d[6]]).toEqual([2, true]);   // a beggar, dead of want (no blood)
    listen({ died: () => {} });
  });

  it('pays no tax on beggars', () => {
    crowded(); run(BEG_TICKS+10);
    expect(me().beggars).toBeGreaterThan(0);
    expect(me().taxpayers).toBe(mine().filter(h => h.kind===H_VILLAGER && h.housed && !h.beggar).length);
  });

  it('takes a beggar off the street once a home comes free', () => {
    crowded(); run(BEG_TICKS+10);
    const b=mine().find(h => h.beggar)!;
    // a housed person dies: the longest-homeless (the beggar) moves in and goes back to work
    kill(mine().filter(h => h.housed)[0]);
    run(2);
    expect(b.housed).toBe(true);
    expect(b.beggar).toBe(false);
    expect(b.sp).toBeGreaterThan(1);
  });
});
