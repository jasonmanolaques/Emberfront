/* ---------- choosing your country and your rivals, on the start card ----------
   A window lists the countries that can play on this map (on a real-world one, those whose
   capital is on it). Click one to play it; tick the ones you will face. On a real-world map
   everyone, you included, is founded at their real capital. Quick picks choose the nearest
   capitals to yours (at random on a generated map), all of them, or none. */
import { TW, MAX_KINGDOMS } from '../core/constants';
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

const MAX_RIVALS = MAX_KINGDOMS-1;
/** The rivals a quick pick chooses: the k capitals nearest yours (at random on a generated map), a
    full game (63, at random if more could play), or none. */
function quick(kind: string, k=0): string[] {
  const av=available().filter(a => a.country.code!==client.me);
  if (kind==='none') return [];
  if (kind==='full') return av.map(a => a.country.code).sort(() => Math.random()-0.5).slice(0,MAX_RIVALS);
  const mine=available().find(a => a.country.code===client.me);
  if (real() && mine){
    const d=(t: number) => Math.hypot(t%TW-mine.tile%TW, ((t/TW)|0)-((mine.tile/TW)|0));
    return av.sort((a,b) => d(a.tile)-d(b.tile)).slice(0,k).map(a => a.country.code);
  }
  return av.map(a => a.country.code).sort(() => Math.random()-0.5).slice(0,k);
}

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
  if (!saved) client.rivals=quick('near',9);
  keep();
  summary();
}
/** Remembers the choice for this map. */
const keep = () => { client.choices[client.mapIndex]={ me:client.me, rivals:[...client.rivals] }; };

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
  $('nCount').textContent=`${client.rivals.length} rival${client.rivals.length===1?'':'s'} · ${client.rivals.length+1} of ${MAX_KINGDOMS} kingdoms`;
  $('nHint').textContent = real()
    ? 'Click a country to play it: you start at its real capital. Tick the countries you will face: each is founded at its own capital.'
    : 'Click a country to play it: you choose where to found it. Tick the countries you will face: they are founded around the map.';
  for (const b of win.querySelectorAll<HTMLButtonElement>('.nquick button[data-k]')) b.textContent=`${real() ? 'Nearest' : 'Random'} ${b.dataset.k}`;
  const full=win.querySelector<HTMLButtonElement>('.nquick button[data-q="full"]')!, n=Math.min(MAX_KINGDOMS, available().length);
  full.textContent = n<MAX_KINGDOMS ? `All · ${n}` : `Full game · ${MAX_KINGDOMS}`;
}

list.addEventListener('click', e => {
  const li=(e.target as HTMLElement).closest('li[data-code]') as HTMLElement | null; if (!li) return;
  const code=li.dataset.code!;
  if ((e.target as HTMLElement).closest('.play')){ client.me=code; client.rivals=client.rivals.filter(c => c!==code); render(); return; }
  if ((e.target as HTMLElement).closest('input')){
    const box=(e.target as HTMLInputElement);
    if (box.checked && client.rivals.length>=MAX_RIVALS){ box.checked=false; toast(`A game holds at most ${MAX_KINGDOMS} kingdoms`); return; }
    client.rivals = box.checked ? [...client.rivals.filter(c => c!==code), code] : client.rivals.filter(c => c!==code);
    render();
  }
});
search.addEventListener('input', render);
win.querySelector('.nquick')!.addEventListener('click', e => {
  const b=(e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b) return;
  client.rivals = b.dataset.k ? quick('near',+b.dataset.k) : quick(b.dataset.q!);
  render();
});
$('nDone').addEventListener('click', closeNations);
$('nClose').addEventListener('click', closeNations);
$('pickCountry').addEventListener('click', openNations);
