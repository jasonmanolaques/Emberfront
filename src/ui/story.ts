/* ---------- story events in the message log (the simulation decides them: sim/story.ts) ----------
   Each story id has a line for when it happens to you, and one for when it happens to a kingdom
   whose people turn on yours. Others' stories pass unremarked. */
import { PLAYER } from '../core/constants';
import { W } from '../sim/state';
import { floats } from '../render/effects';
import { log } from './hud';

const name = (id: number) => W.nations[id]?.name ?? 'the enemy';
interface Telling { mine: (o: number, other: number) => string; theirs: (o: number, other: number) => string; shout: string; }
const TELLINGS: Record<string, Telling> = {
  mob: {
    mine: (_o,other) => `Your people won't stand by: a mob of villagers swarms the soldiers of ${name(other)}!`,
    theirs: (o) => `The villagers of ${name(o)} rise as a mob and swarm your soldiers`,
    shout: 'Mob!',
  },
};

export function onStory(id: string, o: number, x: number, y: number, other: number){
  const t=TELLINGS[id]; if (!t) return;
  if (o===PLAYER) log(t.mine(o,other),'good');
  else if (other===PLAYER) log(t.theirs(o,other),'bad');
  else return;
  floats.push({ x, y:y-6, text:t.shout, t0:performance.now(), c:o===PLAYER ? '#ffe27a' : '#ff9a8a' });
}
