import { GAME_SPEED } from './core/constants';
/* ---------- client state: this browser's view of the match, not part of the simulation ---------- */
export type Phase = 'intro' | 'spawn' | 'play';

export const client = {
  state: 'intro' as Phase,
  paused: false,
  speed: GAME_SPEED,
  overShown: false,
  lastVillageLog: -99,
  block: false,          // the building being placed goes four at a time (a 2 by 2 block of plots)
  placing: 0,            // building type being placed from the buildings panel, 0 when not placing
  selected: -1,
  settling: 0,           // a naval settlement is chosen (1; 0 when not choosing): the next click on land picks where the ship lands
  assigning: null as null | { key: number; hot: null | { d: number; isle: number; tiles: number[] } },   // choosing the border to station an army on (a barracks' key, or -2 for the militia); `hot` is the stretch lit under the pointer
  landing: null as null | { target: number; base: number; units: number[]; men: number },   // choosing the coast of `target` to land `units` (men of them) on from naval base `base`
  mapIndex: 0,           // which of MAPS (game.ts) is being played
  me: '',                // the country the player chose (core/countries.ts code)
  placement: 'real' as 'real' | 'random' | 'near',   // where the rivals are founded on a real map: at their capitals, at random, or at random but near each other
  rivals: [] as string[],   // the countries chosen to play against
  choices: {} as Record<number, { me: string; rivals: string[]; hand?: boolean }>,   // what was chosen on each map (by MAPS index)          // the army (campaign id) the player has taken in hand with a right-click, or -1
};
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
