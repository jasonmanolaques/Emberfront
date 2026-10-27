/* ---------- client state: this browser's view of the match, not part of the simulation ---------- */
export type Phase = 'intro' | 'spawn' | 'play';

export const client = {
  state: 'intro' as Phase,
  paused: false,
  speed: 1,
  overShown: false,
  lastVillageLog: -99,
  placing: 0,            // building type being placed from the buildings panel, 0 when not placing
  selected: -1,
  mapIndex: 0,           // which of MAPS (game.ts) is being played
  me: '',                // the country the player chose (core/countries.ts code)
  rivals: [] as string[],   // the countries chosen to play against
  choices: {} as Record<number, { me: string; rivals: string[] }>,   // what was chosen on each map (by MAPS index)          // the army (campaign id) the player has taken in hand with a right-click, or -1
};
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
