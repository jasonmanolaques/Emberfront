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
}

const noop = () => {};
export const on: SimEvents = {
  tileChanged: noop, plotChanged: noop, roadBuilt: noop, plotIgnited: noop,
  buildingPlaced: noop, capitalFell: noop, eliminated: noop, roleChanged: noop,
  resChanged: noop, stored: noop,
};
export function listen(l: Partial<SimEvents>){ Object.assign(on, l); }
