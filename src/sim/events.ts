/* ---------- simulation events ----------
   The simulation announces what happened; rendering and UI subscribe. With no listeners
   (a server, a test) the simulation runs exactly the same, just without visuals. */
export interface SimEvents {
  tileChanged(t: number, o: number): void;      // tile t now belongs to nation o (0 = unclaimed)
  plotChanged(q: number): void;                 // building plot q changed type or owner
  roadBuilt(t: number): void;
  plotIgnited(q: number): void;                 // building on plot q caught fire
  buildingPlaced(q: number, id: number, isNew: boolean): void;   // isNew: it seeded a new village
  capitalFell(id: number, by: number): void;
  eliminated(id: number, by: number): void;
  roleChanged(x: number, y: number, kind: number): void;   // someone left the capital as a villager or soldier
  resChanged(t: number): void;                  // the tree or rock on tile t appeared, was harvested or cleared
  stored(id: number, good: number, amount: number): void;   // a villager delivered goods to the capital
  towerShot(x0: number, y0: number, x1: number, y1: number, killed: boolean, victim: number): void;   // a watchtower or castle hit someone
  produced(q: number, id: number, good: number, amount: number): void;   // a plantation, quarry or copper mine delivered
  warBegan(a: number, d: number, raid: boolean): void;         // a sent an army against d
  armyHome(a: number, d: number, raid: boolean, why: string): void;   // a's army turned for home: 'recall', 'cut', 'done', 'peace' or 'won'
  armyGone(a: number, d: number, raid: boolean, why: string): void;   // the last of it is home or dead ('lost': all fell)
  peaceOffered(from: number, to: number): void;
  peaceRefused(from: number, to: number): void;
  peaceMade(a: number, b: number): void;
  allied(a: number, b: number): void;
  allyRefused(a: number, b: number, why: string): void;
  allianceBroken(a: number, b: number): void;                  // a declared war on its ally b
  annexed(loser: number, winner: number): void;                // the loser's castle was broken
  plunder(id: number, x: number, y: number, gold: number): void;   // a raider got his loot home
  hit(x: number, y: number, killed: boolean, victim: number, attacker: number): void;   // a blow landed in a fight (ids)
  swing(attacker: number, victim: number): void;               // someone struck at someone, hit or miss
  bldHit(q: number): void;                                     // a soldier struck the building on plot q
  died(x: number, y: number, o: number, id: number, kind: number, tier: number): void;   // someone fell (kind 0 villager, 1 soldier, 2 beggar; soldiers' tier)
  occupied(t: number): void;                                   // tile t was occupied or freed
  counterReady(o: number, enemy: number): void;                // o's army has won its land back and is ready to counter-attack
  intercepting(o: number, enemy: number, soldiers: number): void;   // o sent soldiers after an army of enemy's
  story(id: string, o: number, x: number, y: number, other: number): void;   // a story event in kingdom o at (x,y), sim/story.ts
  researched(o: number, topic: number, tier: number): void;    // kingdom o reached `tier` in a research topic
  upgraded(q: number, o: number, tier: number): void;          // a builder raised the house on plot q to `tier`
  builderHired(q: number, o: number, replaced: boolean): void; // a villager took up the tools at the builders guild or blacksmith on plot q
  forged(q: number, o: number, tier: number): void;            // a blacksmith left armour of `tier` at the barracks plot q
  armored(id: number, x: number, y: number, tier: number): void;   // soldier id put on armour of `tier`
  order(kind: string, a: number, d: number, rank: number, leader: number, x: number, y: number): void;   // an army's leader gives an order ('march', 'hold', 'assault', 'retreat', 'stand', 'regroup', 'home') or falls ('fell' on an attack, leaving his barracks leaderless; 'slain' on a raid or intercept)
  deserted(o: number, x: number, y: number, tier: number, gold: number): void;   // an unpaid soldier of tier `tier` went back to work; his armour scrapped for `gold`
}

const noop = () => {};
export const on: SimEvents = {
  tileChanged: noop, plotChanged: noop, roadBuilt: noop, plotIgnited: noop,
  buildingPlaced: noop, capitalFell: noop, eliminated: noop, roleChanged: noop,
  resChanged: noop, stored: noop, towerShot: noop, produced: noop,
  warBegan: noop, armyHome: noop, armyGone: noop, peaceOffered: noop, peaceRefused: noop, peaceMade: noop,
  allied: noop, allyRefused: noop, allianceBroken: noop, annexed: noop, plunder: noop, hit: noop, bldHit: noop,
  died: noop, occupied: noop, counterReady: noop, intercepting: noop, swing: noop, story: noop, researched: noop, upgraded: noop, builderHired: noop, forged: noop, armored: noop, deserted: noop, order: noop,
};
export function listen(l: Partial<SimEvents>){ Object.assign(on, l); }
