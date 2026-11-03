/* ---------- bots at sea: harbours, ships, colonies and landings ----------
   A bot looks to the sea by its priorities: the more it has used up its room to grow on the mainland (no unclaimed land at its border:
   an island kingdom like Britain), the more it wants a naval base, a few ships, colonies on the land across the water and, when there is
   nobody to attack by land, a landing on a coast of a kingdom it has no land border with. A bold or restless temper looks sooner and
   more often; a kingdom with room to spare, with beggars to house or an army to feed hardly at all. All of it goes through the same
   rules as the player's (sim/naval.ts, sim/war.ts). */
import { PW, B_NAVAL } from '../core/constants';
import { W, owner, isLand, type Nation } from './state';
import { build, navalSite, structureOf, canAfford } from './buildings';
import { basesOf, queueShip, shipProblem, settlePlan, colonize, building } from './naval';
import { navalPlan, declareNaval, navalOf, available, allied } from './war';
import { TW } from '../core/constants';

/** How much the sea matters to n now, 0 to 1: all of it with no unclaimed land at its border, a little otherwise, by temper. */
export function seaDrive(n: Nation){
  const exhausted = W.contact[n.id*W.M]===0;   // (nothing unclaimed touches its land)
  return (exhausted ? 0.9 : 0.12) * (0.55+0.45*(n.expandAt+n.attackAt)/2+0.2);
}
const homeless = (n: Nation) => n.homeless>=3 && n.homeless>=(n.villagers+n.soldiers+n.beggars)*0.1;

/** The harbour, the fleet and the colonies of bot n; looked at now and then (every 12 to 25 seconds). */
export function botSea(n: Nation){
  if (W.simTime<n.nextSea || n.capTile<0) return;
  const srand=W.srand; n.nextSea=W.simTime+12+srand()*13;
  const drive=seaDrive(n);
  if (srand()>drive || homeless(n)) return;
  // a naval base, once the kingdom has found its feet (a town to defend, farms to feed it)
  const bases=basesOf(n);
  if (!bases.length){
    if (n.tiles<150 || !n.farms) return;
    const s=structureOf(B_NAVAL)!; if (!canAfford(n,s)) return;
    const plots=n.plots, tries=Math.min(plots.length,220);
    for (let i=0;i<tries;i++){
      const q=plots[(srand()*plots.length)|0];
      if (navalSite(n,q).orient>=0 && build(n,q,B_NAVAL)) return;
    }
    return;
  }
  // a few ships: enough to carry its biggest army and a colony or two
  const army=available(n).reduce((k,a) => Math.max(k,a.men.length),0), want=Math.max(2,Math.min(8,Math.ceil(army/5)+1));
  if (n.fleet+building(n)<want){ for (const q of bases) if (!shipProblem(n,q)){ queueShip(n,q); break; } }
  // a colony: the nearest land across the water that nobody holds, when its own border has run out of room
  if (n.fleet<1 || W.contact[n.id*W.M]!==0 || W.ships.some(s => s.o===n.id && s.colony>=0)) return;
  const spend=n.gold*Math.max(0.3,n.ratio);
  if (spend<40) return;
  let best=-1, bl=Infinity;
  for (let i=0;i<30;i++){
    const t=W.landTiles[(srand()*W.landTiles.length)|0];
    if (owner[t]) continue;
    const plan=settlePlan(n,t);
    if (typeof plan!=='string' && plan.path.length<bl){ bl=plan.path.length; best=t; }
  }
  if (best>=0) colonize(n,best,spend);
}

/** A landing for bot n (no land target was to be had): the weakest kingdom it has no land border with whose coast its ships can reach,
    if its army is big enough against it. `need` is the edge its temper wants. Returns true if it sailed. */
export function navalAttack(n: Nation, pool: number, need: number, defenceOf: (o: number) => number){
  if (!n.navals || n.fleet<2 || seaDrive(n)<0.3) return false;
  const bases=basesOf(n); if (!bases.length) return false;
  const arm=available(n).sort((x,y) => y.men.length-x.men.length || x.unit.key-y.unit.key)[0]; if (!arm || arm.men.length<5) return false;
  const srand=W.srand, M=W.M, id=n.id;
  const beset=new Uint8Array(M); for (const c of W.campaigns) if (c.hostile && c.phase<2) beset[c.d]++;
  let best=0, bs=need*1.1, bc=-1, bb=-1;
  for (let o=1;o<M;o++){
    const D=W.nations[o];
    if (o===id || !D.alive || allied(id,o) || beset[o]>=2 || W.contact[id*M+o] || navalOf(id,o) || D.capTile<0) continue;
    const s=pool/defenceOf(o)*(W.atWar[id*M+o] ? 1.4 : 1)*(0.8+srand()*0.4);
    if (s<=bs) continue;
    // a coast of theirs the ships can reach
    for (let i=0;i<120;i++){
      const x=D.x0+((srand()*(D.x1-D.x0+1))|0), y=D.y0+((srand()*(D.y1-D.y0+1))|0), t=y*TW+x;
      if (owner[t]!==o || !isLand[t] || (isLand[t-1] && isLand[t+1] && isLand[t-TW] && isLand[t+TW])) continue;
      const base=bases[(srand()*bases.length)|0], plan=navalPlan(id,o,[arm.unit.key],base,t);
      if (typeof plan==='object'){ best=o; bs=s; bc=t; bb=base; break; }
    }
  }
  if (!best) return false;
  return declareNaval(id,best,[arm.unit.key],bb,bc);
}
void PW;
