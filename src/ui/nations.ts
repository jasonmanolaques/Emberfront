/* ---------- choosing your country and your rivals, on the start card ----------
   A window lists the countries that can play on this map (on a real-world one, those whose
   capital is on it). Click one to play it; tick the ones you will face. On a real-world map
   everyone, you included, is founded at their real capital. Quick picks choose the nearest
   capitals to yours (at random on a generated map), all of them, or none. */
import { TW, kingdomLimit, isEurope } from '../core/constants';
import { COUNTRIES, MAJOR, countryByCode } from '../core/countries';
import { W } from '../sim/state';
import { capitalsOn } from '../sim/realmap';
import { client } from '../client';
import { flagCSS } from '../render/flags';
import { toast } from './hud';
import { $ } from './dom';

const win=$('nations'), list=$('nList'), search=$('nSearch') as HTMLInputElement;
const real = () => W.map!=='gen';

/** The countries that can play on this map, with their capital's tile (-1 on a generated map). */
export function available(){ return real() ? capitalsOn(W.map) : COUNTRIES.map(country => ({ country, tile:-1 })); }

const maxKingdoms = () => kingdomLimit(W.map);   // (30 on Europe: you and 29 at random)
const maxRivals = () => maxKingdoms()-1;
/** The rivals a quick pick chooses: the k capitals nearest yours (at random on a generated map), a
    full game (63, or 29 on Europe, at random if more could play), or none. */
function quick(kind: string, k=0): string[] {
  const av=available().filter(a => a.country.code!==client.me);
  if (kind==='none') return [];
  if (kind==='full') return av.map(a => a.country.code).sort(() => Math.random()-0.5).slice(0,maxRivals());
  const mine=available().find(a => a.country.code===client.me);
  if (real() && mine){
    const d=(t: number) => Math.hypot(t%TW-mine.tile%TW, ((t/TW)|0)-((mine.tile/TW)|0));
    return av.sort((a,b) => d(a.tile)-d(b.tile)).slice(0,k).map(a => a.country.code);
  }
  return av.map(a => a.country.code).sort(() => Math.random()-0.5).slice(0,k);
}

/** A new random draw of the rivals for a game (all the room the map has, out of the countries that could play: on Europe, 29 of the other 61). */
export function randomRivals(){ return quick('full'); }
/** Is the choice of rivals the player's own (made in the window)? Otherwise a map with a limit draws them afresh for each game. */
export const handPicked = () => !!client.choices[client.mapIndex]?.hand;

/** After the map changes: what was chosen on this map before, or (the first time) your country
    if it can play here, else one of the bigger ones, against the 9 nearest (or 9 at random). */
export function fitChoice(){
  const av=available(), codes=new Set(av.map(a => a.country.code)), saved=client.choices[client.mapIndex];
  if (saved){ client.me=saved.me; client.rivals=[...saved.rivals]; }
  else client.rivals=[];
  if (!codes.has(client.me)){
    const big=av.filter(a => MAJOR.has(a.country.code)), pool=big.length ? big : av;
    client.me=pool[(Math.random()*pool.length)|0].country.code;
  }
  client.rivals=client.rivals.filter(c => codes.has(c) && c!==client.me);
  if (!saved) client.rivals = isEurope(W.map) ? quick('full') : quick('near',9);
  keep();
  summary();
}
/** Remembers the choice for this map. */
const keep = (hand?: boolean) => { client.choices[client.mapIndex]={ me:client.me, rivals:[...client.rivals], hand:hand ?? client.choices[client.mapIndex]?.hand ?? false }; };

/** The start card's line: your flag and country, and how many rivals. */
function summary(){
  const k=countryByCode.get(client.me);
  $('pcFlag').style.cssText=k ? flagCSS(k.code) : '';
  $('pcName').textContent=k?.name ?? 'Choose your country';
  $('pcRivals').textContent=`${client.rivals.length} rival${client.rivals.length===1?'':'s'}`;
  const start=$('start') as HTMLButtonElement;
  start.textContent = real() ? `Start as ${k?.name ?? '…'}` : 'Choose your spawn';
  start.disabled=!client.rivals.length;
}

export const nationsOpen = () => !win.hidden;
export function openNations(){ win.hidden=false; search.value=''; render(); $('intro').hidden=true; search.focus({ preventScroll:true }); }
export function closeNations(){ win.hidden=true; $('intro').hidden=false; keep(); summary(); }

function render(){
  const q=search.value.trim().toLowerCase(), picked=new Set(client.rivals);
  const rows=available().slice().sort((a,b) => a.country.name.localeCompare(b.country.name))
    .filter(a => !q || a.country.name.toLowerCase().includes(q));
  list.innerHTML=rows.map(({ country:k }) => {
    const me=k.code===client.me;
    return `<li class="${me ? 'me' : picked.has(k.code) ? 'on' : ''}" data-code="${k.code}">`
      +`<button class="play" title="Play as ${k.name}"><i class="flag" style="${flagCSS(k.code)}"></i><span>${k.name}</span></button>`
      +(me ? `<span class="you">You</span>` : `<label class="riv"><input type="checkbox" ${picked.has(k.code) ? 'checked' : ''}>Rival</label>`)+`</li>`;
  }).join('') || '<li class="none">No country by that name on this map</li>';
  $('nCount').textContent=`${client.rivals.length} rival${client.rivals.length===1?'':'s'} · ${client.rivals.length+1} of ${maxKingdoms()} kingdoms`;
  $('nHint').textContent = real()
    ? 'Click a country to play it: you start at its real capital. Tick the countries you will face: each is founded at its own capital.'
    : 'Click a country to play it: you choose where to found it. Tick the countries you will face: they are founded around the map.';
  $('nPlace').hidden=!real();
  for (const b of $('nPlace').querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed',String(b.dataset.p===client.placement));
  for (const b of win.querySelectorAll<HTMLButtonElement>('.nquick button[data-k]')) b.textContent=`${real() ? 'Nearest' : 'Random'} ${b.dataset.k}`;
  const full=win.querySelector<HTMLButtonElement>('.nquick button[data-q="full"]')!, n=Math.min(maxKingdoms(), available().length);
  full.textContent = isEurope(W.map) ? `Random ${n-1}` : n<maxKingdoms() ? `All · ${n}` : `Full game · ${maxKingdoms()}`;
  full.title = isEurope(W.map) ? `${n} kingdoms: you and ${n-1} rivals drawn at random from the other countries; a fresh draw for each game unless you choose your own` : `${maxKingdoms()} kingdoms: you and ${maxKingdoms()-1} rivals, at random if more countries could play`;
}

list.addEventListener('click', e => {
  const li=(e.target as HTMLElement).closest('li[data-code]') as HTMLElement | null; if (!li) return;
  const code=li.dataset.code!;
  if ((e.target as HTMLElement).closest('.play')){ client.me=code; client.rivals=client.rivals.filter(c => c!==code); render(); return; }
  if ((e.target as HTMLElement).closest('input')){
    const box=(e.target as HTMLInputElement);
    if (box.checked && client.rivals.length>=maxRivals()){ box.checked=false; toast(`A game on this map holds at most ${maxKingdoms()} kingdoms`); return; }
    client.rivals = box.checked ? [...client.rivals.filter(c => c!==code), code] : client.rivals.filter(c => c!==code);
    keep(true); render();
  }
});
search.addEventListener('input', render);
win.querySelector('.nquick')!.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
  client.rivals = b.dataset.k ? quick('near',+b.dataset.k) : quick(b.dataset.q!);
  keep(!!b.dataset.k);   // (a random draw stays a random draw: it is made afresh for each game)
  render();
});
$('nPlace').addEventListener('click', e => { const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return; client.placement=b.dataset.p as typeof client.placement; render(); });
$('nDone').addEventListener('click', closeNations);
$('nClose').addEventListener('click', closeNations);
$('pickCountry').addEventListener('click', openNations);
