// A fixed, scripted match used to check that the simulation behaves identically
// across refactors. Works in the browser (script tag) and in Node (import).
// `api` is window.emberfront or the headless equivalent.
(function(){
  let TW = 0, TH = 0;

  function fnv(h, bytes){ for (let i=0;i<bytes.length;i++){ h^=bytes[i]; h=Math.imul(h,16777619); } return h>>>0; }
  function hashArr(a){ return fnv(2166136261, new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).toString(16); }
  function hashStr(s){ return fnv(2166136261, new TextEncoder().encode(s)).toString(16); }

  const NKEYS = ['troops','maxTroops','rate','tiles','alive','capTile','capPlot','houses','farms','towers','mines','bCount','peak','ltx','lty','expandAt','attackAt','ratio','nextThink'];
  function simPrint(api){
    const d = api.dump();
    const nat = api.nations.slice(1).map(n => NKEYS.map(k => String(n[k])).join(','));
    const att = d.attacks.map(A => [A.id,A.att,A.def,A.troops,A.front.length,A.done].join(','));
    return {
      tick: d.tickN,
      simTime: String(api.simTime),
      owner: hashArr(d.owner), road: hashArr(d.road), pType: hashArr(d.pType), pOwner: hashArr(d.pOwner),
      pVar: hashArr(d.pVar), pBurn: hashArr(d.pBurn), pTimer: hashArr(d.pTimer),
      nations: hashStr(nat.join('|')), attacks: hashStr(att.join('|')),
    };
  }
  function renderPrint(api){ const d = api.dump(); return { world: hashArr(d.wbuf), objects: hashArr(d.obj) }; }

  function pickTarget(d, preferEnemy){
    let enemy = -1, open = -1;
    for (let t=0;t<TW*TH;t++){
      const o = d.owner[t]; if (o===1 || !d.isLand[t]) continue;
      const x = t%TW;
      const adj = (x>0&&d.owner[t-1]===1)||(x<TW-1&&d.owner[t+1]===1)||(t>=TW&&d.owner[t-TW]===1)||(t<TW*TH-TW&&d.owner[t+TW]===1);
      if (!adj) continue;
      if (o && enemy<0) enemy = t; if (!o && open<0) open = t;
      if (enemy>=0 && open>=0) break;
    }
    return preferEnemy ? (enemy>=0 ? enemy : open) : (open>=0 ? open : enemy);
  }

  globalThis.efScenario = function(api, opts){
    const { seed, steps = 150, every = 20, render = false } = opts;
    TW = api.TW; TH = api.TH;
    api.newWorld(seed);
    // spawn at the first valid spot spiralling out from the map centre
    outer: for (let r=0;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
      if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      api.spawnAt(TW/2+dx*3, TH/2+dy*3); if (api.state==='play') break outer;
    }
    const out = { spawned: api.state==='play', checkpoints: [] };
    const ratios = [0.4,0.6,0.25,0.8];
    for (let s=0;s<steps;s++){
      api.run(every);
      // compare at tick boundaries: an order given now is applied at the start of the next tick
      if (s%10===9){ const cp = simPrint(api); if (render) Object.assign(cp, renderPrint(api)); out.checkpoints.push(cp); }
      const me = api.nations[1];
      if (me && me.alive){
        const t = pickTarget(api.dump(), s%3===0);
        if (t>=0){ api.setRatio(ratios[s%4]); api.attack(t); }
      }
    }
    return out;
  };
})();
