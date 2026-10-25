/* ---------- map & simulation constants ---------- */
export const TW = 400, TH = 248;          // map size in tiles (multiples of 4: building plots are 4x4)
export const S = 2;                       // detail pixels per tile (sprites are drawn at this resolution)
export const DW = TW * S, DH = TH * S;
export const PW = TW >> 2, PH = TH >> 2;  // building plots are 4x4 tiles
export const NT = TW * TH, NP = PW * PH;
export const TICK = 0.1;                  // simulation step in seconds

export const T_DEEP=0,T_WATER=1,T_SHALLOW=2,T_BEACH=3,T_GRASS=4,T_DRY=5,T_FOREST=6,T_DESERT=7,T_HILLS=8,T_MOUNT=9,T_SNOW=10;
export const TNAME = ['Deep sea','Sea','Shallows','Beach','Grassland','Savanna','Forest','Desert','Hills','Mountains','Snowfield'];
export const TMULT = [0,0,0,1.1,1,1,1.4,1.2,1.8,3,2.4];   // attack cost multiplier by terrain
export const B_EMPTY=0,B_HOUSE=1,B_FARM=2,B_TOWER=3,B_MINE=4,B_CASTLE=5,B_CPART=6,B_RUINS=7,B_BARRACKS=8,B_MINTER=9,B_SITE=10;   // B_SITE: a house being built
/** Anything standing on a plot that a kingdom owns and that burns when the ground is taken. */
export const isStructure = (ty: number) => ty===B_HOUSE || ty===B_FARM || ty===B_TOWER || ty===B_MINE || ty===B_BARRACKS || ty===B_MINTER;

/* ---------- economy ---------- */
export const GOLD_START = 250;            // gold each kingdom starts with
export const GOLD_PER_SEC = 5;            // base income; each coin minter adds 10% to the total
export const TAX_PER_VILLAGER = 0.1;      // gold a second each villager pays (soldiers pay none)
export const GOLD_PER_TILE = 1;           // cost of settling one unclaimed tile
// kingdom strength: what the leaderboard and labels show, and what makes land costly to take
export const STR_TILE = 1, STR_VILLAGER = 50, STR_SOLDIER = 100, STR_GOLD = 3;

export const PLAYER = 1;                  // nation id of the local player
export const PLAYER_COL = '#ffd23f';
export const BOT_COLS = ['#e5483b','#3d7fe0','#9a5fe0','#ec63a3','#f08a2c','#2ec4e6','#f4f0e6','#94562f','#cf45dc','#2c49b0','#16907f','#2b2b35'];
