/* ---------- map & simulation constants ---------- */
// The map's size changes with the map (the real-world ones are bigger): these are live bindings,
// set by setGrid (sim/state.ts resizeGrid reallocates everything sized by them).
export let TW = 400, TH = 248;            // map size in tiles (multiples of 4: building plots are 4x4)
export const GEN_W = 400, GEN_H = 248;    // the generated maps' size
export const S = 2;                       // simulation pixels per tile: where people stand, in sim units
export let DW = TW * S, DH = TH * S;
// rendering draws everything at twice that detail: 4 screen-art pixels per tile, 16 per building plot
export const K = 2;                       // render pixels per simulation pixel
export const RS = S * K, PS = 4 * RS;     // render pixels per tile, per building plot
export let RW = TW * RS, RH = TH * RS;    // size of the rendered world
export let PW = TW >> 2, PH = TH >> 2;    // building plots are 4x4 tiles
export let NT = TW * TH, NP = PW * PH;
/** Sets the map's size in tiles (multiples of 4). */
export function setGrid(w: number, h: number){
  TW=w; TH=h; DW=TW*S; DH=TH*S; RW=TW*RS; RH=TH*RS; PW=TW>>2; PH=TH>>2; NT=TW*TH; NP=PW*PH;
}
export const TICK = 0.1;                  // simulation step in seconds

export const T_DEEP=0,T_WATER=1,T_SHALLOW=2,T_BEACH=3,T_GRASS=4,T_DRY=5,T_FOREST=6,T_DESERT=7,T_HILLS=8,T_MOUNT=9,T_SNOW=10;
export const TNAME = ['Deep sea','Sea','Shallows','Beach','Grassland','Savanna','Forest','Desert','Hills','Mountains','Snowfield'];
// how much harder rough ground is to settle, by terrain: a fifth of what it once was (beach 1.1, forest 1.4,
// desert 1.2, hills 1.8, mountains 3, snow 2.4), so every kind of ground is worth settling
export const TMULT = [0,0,0,1.1,1,1,1.4,1.2,1.8,3,2.4].map(m => m && +(1+(m-1)*0.2).toFixed(3));
export const B_EMPTY=0,B_HOUSE=1,B_FARM=2,B_TOWER=3,B_MINE=4,B_CASTLE=5,B_CPART=6,B_RUINS=7,B_BARRACKS=8,B_MINTER=9,B_SITE=10;   // B_SITE: a house being built
// buildings bigger than one plot: the top-left plot holds the type, the others are B_PART pointing at it (pMain)
export const B_PLANTATION=11, B_QUARRY=12, B_COPPERMINE=13, B_PART=14;
export const B_RESEARCH=15, B_GUILD=16, B_SMITHY=17;   // research station, builders guild, blacksmith
/** Anything standing on a plot that a kingdom owns and that burns when the ground is taken. */
export const isStructure = (ty: number) => ty===B_HOUSE || ty===B_FARM || ty===B_TOWER || ty===B_MINE || ty===B_BARRACKS || ty===B_MINTER
  || ty===B_PLANTATION || ty===B_QUARRY || ty===B_COPPERMINE || ty===B_PART || ty===B_RESEARCH || ty===B_GUILD || ty===B_SMITHY;

/* ---------- economy ---------- */
export const GOLD_START = 250;            // gold each kingdom starts with
export const GOLD_PER_SEC = 5;            // base income; each coin minter adds 10% to the total
export const WAGE = 0.2;                  // gold a second each soldier is paid
export const UNPAID_TICKS = 100;          // ticks below zero gold before unpaid soldiers start to desert (10 s)
export const DESERT_TICKS = 30;           // then one deserts every 3 s, the least armoured first
export const SCRAP_GOLD = 30;             // gold back per tier of a deserter's armour, scrapped
export const TAX_PER_VILLAGER = 0.1;      // gold a second each villager pays per taxation tier (soldiers pay none)
export const GOLD_PER_TILE = 1;           // cost of settling one unclaimed tile
// kingdom strength: what the leaderboard and labels show, and what makes land costly to take
export const STR_TILE = 1, STR_VILLAGER = 50, STR_SOLDIER = 100, STR_GOLD = 3;

export const PLAYER = 1;                  // nation id of the local player
export const MAX_KINGDOMS = 64;           // kingdoms in one game at most, the player's included (a full game)
export const PLAYER_COL = '#ffd23f';     // the player's highlight (kingdoms take their colours from their flags: core/countries.ts)
