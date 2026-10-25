/* ---------- client state: this browser's view of the match, not part of the simulation ---------- */
export type Phase = 'intro' | 'spawn' | 'play';

export const client = {
  state: 'intro' as Phase,
  paused: false,
  speed: 1,
  ratio: 0.4,            // share of troops each attack sends
  overShown: false,
  lastVillageLog: -99,
};
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
