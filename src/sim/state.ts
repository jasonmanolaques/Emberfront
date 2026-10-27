/* ---------- world state ----------
   Everything the simulation decides lives here. Rendering and UI may read it but never write it. */
import { NT, NP, PW, TW, TH, setGrid } from '../core/constants';
import type { Rng } from '../core/rng';

export interface Nation {
  id: number; name: string; hex: string; isPlayer: boolean;
  code: string;                      // the real country it is (core/countries.ts): its name, flag and colour
  gold: number; income: number;      // treasury and gold per second
  strength: number;                  // tiles + people + gold, weighted (STR_* in constants)
  tiles: number; alive: boolean; capTile: number; capPlot: number;
  plots: number[]; blds: number[]; bCount: number;
  houses: number; farms: number; towers: number; mines: number; barracks: number; minters: number;
  plantations: number; quarries: number; copperMines: number; labs: number; guilds: number; smithies: number;   // labs: research stations
  beds: number;                      // people the houses can hold: a hovel 1, a stone house 2, a manor 3
  sumX: number; sumY: number; ltx: number; lty: number; peak: number;   // ltx/lty: where the kingdom's label sits
  expandAt: number; attackAt: number; ratio: number; nextThink: number;  // bot personality
  nextWar: number; nextOffer: number;   // bots: sim time before which they start no campaign, offer no peace
  nextWave: number;                  // bots: sim time before which they send no more armies to a war under way
  x0: number; y0: number; x1: number; y1: number;   // a box round every tile it has ever held (so its borders are found without searching the whole map)
  wallR: number; nextWall: number;   // bots: the ring of their town wall, in plots from the castle (0: none planned yet), and sim time of its next tower (sim/fort.ts)
  unpaid: number;                    // ticks the treasury has been below zero, soldiers unpaid
  invest: number;                    // city investment: share of the goods coming in (0..1) the builders may spend
  gain: number[]; spend: number[];   // goods in and goods spent by the builders and smiths, per second for the last minute: [second*3+good]
  soldierShare: number;              // share of the population the kingdom wants as soldiers (0..1)
  humanProg: number;                 // progress toward the next human; one arrives at HUMAN_EVERY (farms speed it up)
  villagers: number; soldiers: number; training: number;   // headcount, updated every tick; training = switching role
  beggars: number; homeless: number; taxpayers: number;     // villagers turned beggar; people without a home; housed working villagers
  stock: number[];                   // goods stored in the capital: [wood, stone, copper]
  abandoned: number;                 // houses standing empty
  resHere: number[];                 // trees, rocks and copper left on its land, by good (counted each census, and up as land is gained: never too few)
  surplusTicks: number;              // how long the kingdom has had more houses than people
  study: number;                     // research topic being studied (R_* in research.ts)
  tier: number[];                    // tier reached in each topic, 1..3: [housing, taxation]
  xp: number[];                      // research toward each topic's next tier, in tenths of a point
}
/** A person walking the map. Positions are in detail pixels (2 per tile). */
export interface Human {
  id: number; o: number;             // owning nation
  kind: number;                      // H_VILLAGER | H_SOLDIER
  task: number;                      // TASK_* in population.ts
  x: number; y: number; tx: number; ty: number;
  path: number[];                    // waypoints before (tx,ty), flat x,y pairs: the way around the castle
  wait: number;                      // ticks left to idle, harvest, or spend inside the capital
  sp: number;                        // walking speed, pixels per second
  res: number;                       // tile of the resource this villager has claimed, or -1
  carry: number; amount: number;     // good being hauled home (G_* in resources.ts, -1 = nothing) and how much
  hp: number;                        // soldiers: hit points, lost to enemy watchtowers
  post: number;                      // soldiers: plot of the watchtower they guard, or -1 (waiting at a barracks)
  site: number;                      // plot of the barracks they are heading to or training in, or -1
  home: number;                      // villagers: plot of the house they are building, or -1
  housed: boolean;                   // has a home this tick (the longest-standing people get the houses)
  homeless: number;                  // ticks spent without a home
  beggar: boolean;                   // a villager homeless too long: idle, unrecruitable, pays no tax
  war: number;                       // soldiers: id of the campaign they march with, or -1
  loot: boolean;                     // raiders: carrying plunder home (worth LOOT_GOLD)
  foe: number;                       // soldiers: id of the enemy they are fighting, or -1
  aim: number;                       // soldiers: plot of the enemy building they are attacking, or -1
  cool: number;                      // ticks until they can strike again
  slot: number;                      // place in the campaign's formation, or the home guard's line
  brave: number;                     // villagers with enemies near: -1 not yet decided, 0 running away, 1 fighting
  calm: number;                      // ticks since an enemy was last near
  work: number;                      // builders and blacksmiths: plot of the builders guild or smithy they work at, or -1
  fix: number;                       // builders: plot of the house they are improving, or -1
  tier: number;                      // soldiers: 1 archaic, 2 reinforced, 3 heavy armour (villagers 0)
  base: number;                      // soldiers: a plot of the barracks whose army they belong to, or -1 (patrolling the city)
  load: number;                      // blacksmiths: carrying 1 copper, or armour of tier 2 or 3 (0 = nothing)
  make: number;                      // blacksmiths: tier of the armour the current job is for (0 = no job)
  dest: number;                      // blacksmiths: plot of the barracks the armour is for, or -1
  lead: number;                      // soldiers leading an army: their rank (RANKS in war.ts), doubling their hit points each rank; 0 otherwise
}
/** An army in the field: a war (taking land, pushing for the capital) or a raid (burning buildings). */
export interface Campaign {
  id: number; a: number; d: number;  // attacker, defender
  raid: boolean;
  target: number;                    // intercepts: id of the enemy campaign they go after (-1 for raids and attacks)
  hostile: boolean;                  // still fighting: false once peace is made and the army walks home
  members: number[];                 // ids of the soldiers still in it, rebuilt each tick
  phase: number;                     // 0 mustering, 1 marching, 2 going home
  bx: number; by: number;            // the banner, in pixels
  dx: number; dy: number;            // marching direction (unit)
  rx: number; ry: number;            // rally point while mustering
  goal: number;                      // attacks: the tile the banner heads for (raids head for the nearest building)
  field: Int16Array; fieldAt: number;   // steps to the goal (or home) over land the army may cross, -1 = no way; tick it was worked out
  started: number; startSoldiers: number; startTiles: number;   // tick it began, with how many soldiers, and the defender's land then
  stall: number;                     // ticks the banner has waited for stragglers
  why: string;                       // why it is going home: 'recall', 'peace', 'cut', 'done', 'won'
  unit: number;                      // the barracks (a plot of it) whose army this is, or -1
  inspired: boolean;                 // a counter-attack: thirsty for revenge, it hits harder and marches faster
  leader: number;                    // id of the soldier leading it, or -1 (none for 5 or fewer, or he fell)
  rank: number;                      // the leader's rank by the army's size when it set out (RANKS in war.ts; 0 none)
  mode: number;                      // attacks: marching, holding at the border, assault, falling back, regrouping or charging leaderless (M_* in war.ts)
  stand: boolean;                    // its leader chose to fight to the death: no more retreats
  manual: number;                    // the player commands it (O_* in war.ts: gather, hunt an army, attack a place), or 0: its leader decides
  orderAt: number;                   // manual: the tile it was sent to; orderFoe: the enemy army it hunts (campaign id), or -1
  orderFoe: number;
  orderDone: boolean;                // manual: it got there, formed up, or the army it hunted is gone
  calm: number;                      // manual, order done: ticks on enemy land or under fire, until its leader takes over again
  hitAt: number;                     // tick one of its soldiers was last hit
}
export interface Attack { id: number; att: number; def: number; gold: number; front: number[]; done: boolean; }   // gold still to spend on this front

/** A player action. Actions are queued and applied at the start of the next tick, so every
    client that receives the same actions in the same ticks runs the same game. */
export type Command =
  | { type: 'attack'; nation: number; tile: number; ratio: number }
  | { type: 'soldiers'; nation: number; share: number }
  | { type: 'build'; nation: number; plot: number; kind: number }     // kind: B_FARM, B_BARRACKS, B_TOWER or B_MINTER
  | { type: 'priority'; nation: number; plot: number }                // toggle a watchtower's call for a garrison
  | { type: 'ally'; nation: number; target: number }                  // propose an alliance
  | { type: 'war'; nation: number; target: number; raid: boolean; soldiers?: number; units?: number[] }   // units: barracks plots, each army marches on its own
  | { type: 'endWar'; nation: number; target: number }                // recall a raid, or offer peace
  | { type: 'intercept'; nation: number; campaign: number; soldiers?: number; units?: number[] }   // send armies after an enemy army
  | { type: 'peace'; nation: number; target: number }                 // accept the target's peace offer
  | { type: 'research'; nation: number; topic: number }               // study this topic next (R_* in research.ts)
  | { type: 'invest'; nation: number; share: number }                // city investment (0..1)
  | { type: 'order'; nation: number; campaign: number; x: number; y: number; foe?: number }   // take command of an army: gather at (x,y), attack there, or hunt army `foe`
  | { type: 'auto'; nation: number; campaign: number };              // hand an army back to its leader

export let elev = new Float32Array(NT), moist = new Float32Array(NT);
// resources: at most one per tile (R_* in resources.ts), harvests left, claimed by a villager
export let resType = new Uint8Array(NT), resLeft = new Uint8Array(NT), resBusy = new Uint8Array(NT);
export let terr = new Uint8Array(NT), isLand = new Uint8Array(NT), owner = new Uint8Array(NT), road = new Uint8Array(NT);
export let frontMark = new Int32Array(NT);
export let pType = new Uint8Array(NP), pOwner = new Uint8Array(NP), pVar = new Uint8Array(NP), pBuild = new Uint8Array(NP);
export let pMain = new Int32Array(NP), pCenter = new Int32Array(NP), pBurn = new Float32Array(NP), pTimer = new Float32Array(NP);
export let pAband = new Uint8Array(NP);   // houses standing empty, run down
export let occ = new Uint8Array(NT);      // a kingdom's land held by an enemy at war: the occupier (0 = free); the owner stays
export let pHp = new Float32Array(NP);     // damage a building has taken (multi-plot buildings keep theirs on the main plot)
export let pArmor = [new Uint8Array(0), new Uint8Array(0), new Uint8Array(NP), new Uint8Array(NP)];   // barracks: armour of tier 2 and 3 stored there
export let pTier = new Uint8Array(NP);   // houses: 1 hovel, 2 stone house, 3 manor; watchtowers 1-3 (0 for anything else)
export let pSpan = new Uint8Array(NP);   // plantations, quarries, copper mines (main plot): 0 one plot, 1 two side by side, 2 a 2×2 block
export let pPrio = new Int32Array(NP);   // watchtowers calling for a garrison: order they asked in (0 = not asking)
function placeCentres(){ for (let q=0;q<NP;q++){ const px=q%PW, py=(q/PW)|0; pCenter[q]=(py*4+2)*TW+px*4+2; } }
placeCentres();
/** Makes the map w×h tiles: every array sized by the map is made anew (empty). */
export function resizeGrid(w: number, h: number){
  if (w===TW && h===TH) return;
  setGrid(w,h);
  elev=new Float32Array(NT); moist=new Float32Array(NT);
  resType=new Uint8Array(NT); resLeft=new Uint8Array(NT); resBusy=new Uint8Array(NT);
  terr=new Uint8Array(NT); isLand=new Uint8Array(NT); owner=new Uint8Array(NT); road=new Uint8Array(NT); frontMark=new Int32Array(NT); occ=new Uint8Array(NT);
  pType=new Uint8Array(NP); pOwner=new Uint8Array(NP); pVar=new Uint8Array(NP); pBuild=new Uint8Array(NP);
  pMain=new Int32Array(NP); pCenter=new Int32Array(NP); pBurn=new Float32Array(NP); pTimer=new Float32Array(NP);
  pAband=new Uint8Array(NP); pHp=new Float32Array(NP); pArmor=[new Uint8Array(0), new Uint8Array(0), new Uint8Array(NP), new Uint8Array(NP)];
  pTier=new Uint8Array(NP); pSpan=new Uint8Array(NP); pPrio=new Int32Array(NP);
  placeCentres();
}

export const W = {
  map: 'gen',   // 'gen' for a generated map, else a real-world one (sim/realmap.ts)
  mapSeed: 1, srand: Math.random as Rng, seaLevel: 0, heightRange: 1, landCount: 1, landTiles: new Int32Array(0),
  nations: [] as Nation[], M: 1, contact: new Int32Array(1), attacks: [] as Attack[], burning: [] as number[], attackSeq: 0,
  commands: [] as Command[], simTime: 0, tickN: 0,
  prand: Math.random as Rng,         // separate stream for people, so they never shift the territory game's randomness
  humans: [] as Human[], humanSeq: 0,
  prioSeq: 0,
  campaigns: [] as Campaign[], campSeq: 0,
  ally: new Uint8Array(1),           // [a*M+b] 1 if allied (both ways)
  atWar: new Uint8Array(1),          // [a*M+b] 1 while any campaign runs between them, rebuilt each tick
  grudge: new Int32Array(1),         // [a*M+b] tick b last went to war against a
  offers: new Int32Array(1),         // [a*M+b] tick a offered b peace (0 = none)
  wars: new Uint8Array(1),           // [a*M+b] 1 while a and b are at war: from an attack until peace, whatever the armies do
  warSince: new Int32Array(1),       // [a*M+b] tick that war began
  occCount: new Int32Array(1),       // [o*M+b] tiles of o's that b occupies
  lost: new Uint8Array(1),           // [o*M+b] b has occupied some of o's land in this war (cleared when o has it all back)
  ready: new Int32Array(1),          // [o*M+b] tick o's army took all its land back from b and stands ready to counter-attack (0 = not)
  orphans: [] as number[],           // barracks whose army lost its leader in a war still going: flat [kingdom, barracks plot, enemy]
};
