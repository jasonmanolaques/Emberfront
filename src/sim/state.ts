/* ---------- world state ----------
   Everything the simulation decides lives here. Rendering and UI may read it but never write it. */
import { NT, NP, PW, TW, TH, setGrid } from '../core/constants';
import type { Rng } from '../core/rng';
import type { Field } from './field';

export interface Nation {
  id: number; name: string; hex: string; isPlayer: boolean;
  code: string;                      // the real country it is (core/countries.ts): its name, flag and colour
  gold: number; income: number;      // treasury and gold per second
  strength: number;                  // tiles + people + gold, weighted (STR_* in constants)
  tiles: number; alive: boolean; capTile: number; capPlot: number;
  plots: number[]; blds: number[]; bCount: number;
  houses: number; farms: number; towers: number; mines: number; barracks: number; minters: number;
  plantations: number; quarries: number; copperMines: number; labs: number; guilds: number; smithies: number; navals: number;   // labs: research stations; navals: naval bases
  fleet: number;                     // ships docked and ready (any naval base's: they are the kingdom's)
  beds: number;                      // people the houses can hold: a hovel 1, a stone house 2, a manor 3
  sumX: number; sumY: number; ltx: number; lty: number; peak: number;   // ltx/lty: where the kingdom's label sits
  expandAt: number; attackAt: number; ratio: number; nextThink: number;  // bot personality
  nextWar: number; nextOffer: number;   // bots: sim time before which they start no campaign, offer no peace
  mass: Map<number, { t: number; men: number }>;   // bots: the fronts they hold at the border to mass a second wave (by enemy): when, and the men left
  waved: Map<number, number>;        // bots: when the last second wave went in (by enemy)
  nextSea: number;                   // bots: sim time before which they don't look to the sea again (sim/botsea.ts)
  nextWave: number;                  // bots: sim time before which they send no more armies to a war under way
  hungry: number;                    // bots: sim time their beggar problem began (0: none)
  x0: number; y0: number; x1: number; y1: number;   // a box round every tile it has ever held (so its borders are found without searching the whole map)
  wallR: number; nextWall: number;   // bots: the ring of their town wall, in plots from the castle (0: none planned yet), and sim time of its next tower (sim/fort.ts)
  unpaid: number;                    // ticks the treasury has been below zero, soldiers unpaid
  invest: number;                    // city investment: share of the goods coming in (0..1) the builders may spend
  gain: number[]; spend: number[];   // goods in and goods spent by the builders and smiths, per second for the last minute: [second*3+good]
  soldierShare: number;              // share of the population the kingdom wants as soldiers (0..1)
  humanProg: number;                 // progress toward the next human; one arrives at HUMAN_EVERY (farms speed it up)
  villagers: number; soldiers: number; training: number;   // headcount, updated every tick; soldiers: everyone under arms (militia too); training = switching role
  wageS: number; wageM: number;      // what its soldiers and its called-up militia cost a second (by what each is doing: sim/war.ts wageOf)
  militia: number; called: number;   // of the soldiers, the militia, and of them those called up to a front (who are paid)
  beggars: number; homeless: number; taxpayers: number;     // villagers turned beggar; people without a home; housed working villagers
  stock: number[];                   // goods stored in the capital: [wood, stone, copper]
  abandoned: number;                 // houses standing empty
  surplusTicks: number;              // how long the kingdom has had more houses than people
  study: number;                     // research topic being studied (R_* in research.ts)
  tier: number[];                    // tier reached in each topic, 1..3: [housing, taxation]
  xp: number[];                      // research toward each topic's next tier, in tenths of a point
}
/** A person walking the map. Positions are in detail pixels (2 per tile). */
export interface Human {
  id: number; o: number;             // owning nation
  kind: number;                      // H_VILLAGER | H_SOLDIER
  militia: boolean;                  // soldiers: militia, trained at the capital beyond the barracks' room: unpaid at home, they patrol and guard watchtowers
  to: number;                        // switching role: what they come out as (T_* in population.ts)
  task: number;                      // TASK_* in population.ts
  x: number; y: number; tx: number; ty: number;
  path: number[];                    // waypoints before (tx,ty), flat x,y pairs: the way around the castle
  wait: number;                      // ticks left to idle, harvest, or spend inside the capital
  sp: number;                        // walking speed, pixels per second
  hp: number;                        // soldiers: hit points, lost to enemy watchtowers
  post: number;                      // soldiers: plot of the watchtower they guard, or -1 (waiting at a barracks)
  site: number;                      // plot of the barracks (or, for militia, the castle) they are heading to or training in, or -1
  home: number;                      // villagers: plot of the house they are building, or -1
  rest: number;                      // villagers: plot of the house they rest in (or are walking into), or -1
  duel: number;                      // the man he is fighting one to one (and who fights him), or -1
  housed: boolean;                   // has a home this tick (the longest-standing people get the houses)
  homeless: number;                  // ticks spent without a home
  beggar: boolean;                   // a villager homeless too long: idle, unrecruitable, pays no tax
  war: number;                       // soldiers: id of the campaign they march with, or -1
  foe: number;                       // soldiers: id of the enemy they are fighting, or -1
  aim: number;                       // soldiers: plot of the enemy building they are attacking, or -1
  cool: number;                      // ticks until they can strike again
  slot: number;                      // place in the campaign's formation, or the home guard's line
  dug: boolean;                      // entrenched: an army holding its border for 10 seconds hits 15% harder and has 15% more health until it is told to attack
  fury: boolean;                     // spawned in a siege, in the besieged capital: 25% more hit points and damage until the siege is over
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
  fk: number;                        // soldiers on a front (sim/front.ts): the offensive it belongs to (attacker*M+defender), or -1
  line: number;                      // ...their rank there: 0 the front rank, 1 the rank behind it, …
  fx: number; fy: number;            // ...and where they stand, in pixels (slot: how far along the line)
  boat: number;                      // soldiers of a naval invasion: the ship that carries them (they are out of sight while aboard), or -1
}
/** An army in the field: an attack (holding its part of a front, and pushing it on when the offensive
    is on), or an army defending a border. */
/** A field marshal's command: armies merged into one order group. Each member is the barracks plots of one army as last seen; the first is the lead, whose name the group takes. */
export interface Group { o: number; members: number[][]; }
export interface Campaign {
  id: number; a: number; d: number;  // attacker, defender
  hostile: boolean;                  // still fighting: false once peace is made and the army walks home
  members: number[];                 // ids of the soldiers still in it, rebuilt each tick
  front: boolean;                    // an attack, or an army defending a border: its men stand on the front of its kingdom's offensive (sim/front.ts)
  militia: boolean;                  // militia (no barracks of their own): sent with an attack, or called up as reserves to a front
  all: boolean;                      // militia on a front: every one at home was called up, and those raised meanwhile follow
  phase: number;                     // 0 mustering, 1 out (marching, or on the front), 2 going home
  bx: number; by: number;            // the banner, in pixels
  dx: number; dy: number;            // marching direction (unit)
  rx: number; ry: number;            // rally point while mustering
  goal: number;                      // the tile the banner heads for
  field: Field; fieldAt: number;     // steps to the goal (or home) over land the army may cross, -1 = no way (sim/field.ts); tick it was worked out
  started: number; startSoldiers: number; startTiles: number;   // tick it began, with how many soldiers, and the defender's land then
  stall: number;                     // ticks the banner has waited for stragglers
  why: string;                       // why it is going home: 'recall', 'peace', 'cut', 'done', 'won'
  unit: number;                      // the barracks (a plot of it) whose army this is, or -1
  inspired: boolean;                 // a counter-attack: thirsty for revenge, it hits harder and marches faster
  leader: number;                    // id of the soldier leading it, or -1 (none for 5 or fewer, or he fell)
  rank: number;                      // the leader's rank by the army's size when it set out (RANKS in war.ts; 0 none)
  mode: number;                      // its offensive's state (F_* in war.ts)
  naval: number;                     // an army put ashore from ships: the invasion it belongs to, else -1
  isle: number;                      // the landmass of the enemy's land it is on the front of (a landmass id: sim/naval.ts), or 0: the whole border
  dig: number;                       // ticks the army has held its place on defence, counting toward entrenching (DIG_TICKS)
  dug: boolean;                      // the army is entrenched: its men are too
  sec: number;                       // which part of that border: 0 all of it, 1-8 the compass sector (by bearing from their castle), 9 the siege of their capital (SEC_SIEGE in sim/front.ts)
  attack: boolean;                   // its order at war: attack (true) or defend (false: fall back out of reach of the enemy's towers and hold the line there)
  ordered: boolean;                  // the order was given by someone (not the default for the side it fights on)
  placed: number;                    // the line its men were last placed on: 0 none yet, 1 the attack line, 2 the line of the defence
  deployed: boolean;                 // put on the border in peacetime, as a precaution (a crisis called off leaves it there)
  waiting: number[];                 // an army whose front is across the sea: its new soldiers at the naval base, waiting for a ship with a full load
  hitAt: number;                     // tick one of its soldiers was last hit
}
export interface Attack { id: number; att: number; def: number; gold: number; front: number[]; done: boolean; isle?: number; seed?: number; }   // gold still to spend on this front (isle: a colony's, spent on that island's land only)
/** A ship at sea (sim/naval.ts): sailing out, waiting off a coast, or sailing home to its naval base. */
export interface Ship {
  id: number; o: number; base: number;   // its kingdom, and the main plot of the naval base it sails from and returns to
  x: number; y: number;                  // where it is, in pixels
  path: number[]; pi: number;            // waypoints (x,y pairs, pixels) and the next one
  mode: number;                          // SHIP_* in naval.ts
  inv: number;                           // the invasion it carries (-1 for a colony's ship)
  row: number; slot: number;             // in a landing: which row of ships, and its place along it
  face: number;                          // -1 heading west, 1 east
  colony: number;                        // a colony's ship: the island it settles (isle id), else -1
  gold: number;                          // a colony's ship: the gold it carries to spend settling
  lands: number;                         // a colony's ship: the tile it lands on
  back: number[];                        // the way home
  crew: number;                          // soldiers aboard (an invasion's ship)
  convoy: number;                        // a transport carrying an army's men across the sea: that army (campaign id), else -1
  fleet: boolean;                        // one of the kingdom's fleet (counted again when it docks), not a colony's
}
/** A naval base's yard: ships being built. */
export interface Dock { q: number; queued: number; prog: number; }
/** A landing from the sea, planned and under way. */
export interface Invasion {
  id: number; a: number; d: number; base: number;
  ships: number[]; camps: number[];      // the ships (ids) and the armies aboard them (campaign ids)
  zone: number[]; coast: number[];       // the landing zone (tiles of d's, coast first) and its coast tiles in order along it
  rows: number[];                        // ships in each row
  stage: number;                         // INV_* in naval.ts
  safe: boolean;                         // the coast is already held by a: no defence, no crisis
  landAt: number;                        // tick the next row lands
  row: number;                           // rows landed so far
}

/** A player action. Actions are queued and applied at the start of the next tick, so every
    client that receives the same actions in the same ticks runs the same game. */
export type Command =
  | { type: 'attack'; nation: number; tile: number; ratio: number }
  | { type: 'soldiers'; nation: number; share: number }
  | { type: 'build'; nation: number; plot: number; kind: number; block?: boolean }     // kind: B_FARM, B_BARRACKS, B_TOWER or B_MINTER; block: four farms or towers on the 2 by 2 plots from `plot`
  | { type: 'priority'; nation: number; plot: number }                // toggle a watchtower's call for a garrison
  | { type: 'colonize'; nation: number; tile: number; ratio: number }   // send a ship to colonize the landmass of this unclaimed tile, with this share of the treasury
  | { type: 'ship'; nation: number; plot: number }                   // build a ship at this naval base
  | { type: 'ally'; nation: number; target: number }                  // propose an alliance
  | { type: 'war'; nation: number; target: number; naval?: { base: number; coast: number }; soldiers?: number; units?: number[]; militia?: number; isle?: number }   // units: barracks plots, each army marches on its own; militia: how many of the militia at home go too
  | { type: 'endWar'; nation: number; target: number }                // offer peace
  | { type: 'peace'; nation: number; target: number }                 // accept the target's peace offer
  | { type: 'research'; nation: number; topic: number }               // study this topic next (R_* in research.ts)
  | { type: 'invest'; nation: number; share: number }                // city investment (0..1)
  | { type: 'offensive'; nation: number; target: number; go: boolean }   // attack along the front (in a crisis: go to war), or hold the front
  | { type: 'deescalate'; nation: number; target: number }            // call off the crisis our massed armies started: everyone goes home
  | { type: 'deploy'; nation: number; target: number; units?: number[]; militia?: number; isle?: number }   // put armies on the border in peace, ready for a crisis
  | { type: 'order'; nation: number; camp: number; go: boolean }   // an army at war attacks (go) or defends
  | { type: 'front'; nation: number; camp: number; isle: number }   // an army goes to the border on that landmass
  | { type: 'redirect'; nation: number; camp: number; target: number; isle?: number }   // an army out on a border, not committed, goes to another kingdom's border
  | { type: 'merge'; nation: number; a: number; b: number }   // army b (a barracks' key) joins army a's order group; a leads and gives it its name
  | { type: 'unmerge'; nation: number; key: number }          // army key's order group is dissolved
  | { type: 'assign'; nation: number; army: number; target: number; isle?: number; sec?: number; go?: boolean }   // station an army (a barracks' key, or -2 for the militia) on the border with a kingdom, wherever it is now
  | { type: 'recall'; nation: number; camp: number }   // an army at the border in peace or crisis goes home
  | { type: 'defend'; nation: number; target: number; units: number[]; isle?: number }   // send armies to stand on our side of the border with target
  | { type: 'reserves'; nation: number; target: number; call: boolean };  // call the militia up to the front against target, or send them home

export let elev = new Float32Array(NT), moist = new Float32Array(NT);
// resources: at most one per tile (R_* in resources.ts), harvests left, claimed by a villager
export let terr = new Uint8Array(NT), isLand = new Uint8Array(NT), owner = new Uint8Array(NT), road = new Uint8Array(NT);
export let frontMark = new Int32Array(NT);
export let isle = new Uint16Array(NT);   // each landmass (4-connected land) has an id from 1; 0 for water
export let sea = new Uint16Array(NT);    // each body of water has an id from 1; 0 for land
export let ferry = new Uint8Array(NT);   // sea lanes a kingdom's villagers cross by boat: the kingdom's id, or 0
export let pType = new Uint8Array(NP), pOwner = new Uint8Array(NP), pVar = new Uint8Array(NP), pBuild = new Uint8Array(NP);
export let pMain = new Int32Array(NP), pCenter = new Int32Array(NP), pBurn = new Float32Array(NP), pTimer = new Float32Array(NP);
export let pAband = new Uint8Array(NP);   // houses standing empty, run down
export let pIn = new Uint8Array(NP);      // houses: villagers resting inside, or on their way in (smoke rises from the chimney)
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

  terr=new Uint8Array(NT); isLand=new Uint8Array(NT); owner=new Uint8Array(NT); road=new Uint8Array(NT); frontMark=new Int32Array(NT); occ=new Uint8Array(NT); isle=new Uint16Array(NT); sea=new Uint16Array(NT); ferry=new Uint8Array(NT);
  pType=new Uint8Array(NP); pOwner=new Uint8Array(NP); pVar=new Uint8Array(NP); pBuild=new Uint8Array(NP);
  pMain=new Int32Array(NP); pCenter=new Int32Array(NP); pBurn=new Float32Array(NP); pTimer=new Float32Array(NP);
  pAband=new Uint8Array(NP); pIn=new Uint8Array(NP); pHp=new Float32Array(NP); pArmor=[new Uint8Array(0), new Uint8Array(0), new Uint8Array(NP), new Uint8Array(NP)];
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
  wars: new Uint8Array(1),           // [a*M+b] 1 while a and b are at war: from the first attack until peace, whatever the armies do
  aggr: new Uint8Array(1),           // [a*M+b] a has massed an attack on b's border: a crisis until a attacks (then a war), or calls it off
  warSince: new Int32Array(1),       // [a*M+b] tick that war began
  occCount: new Int32Array(1),       // [o*M+b] tiles of o's that b occupies
  lost: new Uint8Array(1),           // [o*M+b] b has occupied some of o's land in this war (cleared when o has it all back)
  ready: new Int32Array(1),          // [o*M+b] tick o's army took all its land back from b and stands ready to counter-attack (0 = not)
  siege: new Int32Array(1),          // [d] the tick d's capital was encircled (the siege is on), or 0
  siegeBy: new Uint8Array(1),        // [d] the kingdom that besieges it
  offensive: new Uint8Array(1),      // [a*M+d] a's offensive against d: gathering at the border, ready, attacking or holding (F_* in war.ts)
  kills: new Int32Array(1),          // [a*M+b] people of b's that a has killed in their war (since it began)
  stall: new Int32Array(1),          // [a*M+b] ticks their war has gone without the border between them moving much (both ways)
  lastNet: new Int32Array(1),        // [a*M+b] land a held of b's, less b's of a's, when it was last looked at
  crisisAt: new Int32Array(1),       // [a*M+d] tick a's crisis against d began (the word to attack comes CRISIS_TICKS after it)
  occIsle: new Map<number, number>(),   // ((isle*M+o)*M+b) → tiles of o's on that landmass that b occupies
  ships: [] as Ship[], shipSeq: 0,   // ships at sea
  docks: new Map<number, Dock>(),    // naval base (main plot) → its yard
  invasions: [] as Invasion[], invSeq: 0,
  groups: [] as Group[],             // armies merged into order groups (sim/army.ts)
  isleOwn: new Int32Array(0),        // [isle*M+o] tiles of o's on that island (and every landmass: sim/naval.ts)
  isleCount: 0,
};
