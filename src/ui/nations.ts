/* ---------- choosing your country and your rivals, on the start card ----------
   A window lists every country. None is chosen for you: click one to play it; tick the ones you will
   face, or let the standard match draw them at random. Nobody starts at a real capital: when the game
   begins every kingdom has 15 seconds to choose the region it starts in (sim/pick.ts). Quick picks draw
   5, 10 or 20 at random, the standard match, a full game, or none. */
import { TW, kingdomLimit, isEurope, standardKingdoms } from '../core/constants';
import { COUNTRIES, MAJOR, countryByCode } from '../core/countries';
import { W } from '../sim/state';
import { capitalsOn } from '../sim/realmap';
import { client } from '../client';
import { flagCSS } from '../render/flags';
import { toast } from './hud';
import { $ } from './dom';

const win=$('nations'), list=$('nList'), search=$('nSearch') as HTMLInputElement;
const real = () => W.map!=='gen';

/** The countries that can play on this map: all of them, with their capital's tile where it lies on a real-world map (-1 for those with none there, and on a generated map: they are founded at random places). */
export function available(){
  const caps=real() ? new Map(capitalsOn(W.map).map(a => [a.country.code,a.tile])) : null;
  return COUNTRIES.map(country => ({ country, tile: caps?.get(country.code) ?? -1 }));
}

const maxKingdoms = () => kingdomLimit(W.map);   // (64 on Europe)
const maxRivals = () => maxKingdoms()-1;
/** The rivals a quick pick chooses: the k capitals nearest yours (at random on a generated map), a
    full game (63, or 29 on Europe, at random if more could play), or none. */
function quick(kind: string, k=0): string[] {
  const av=available().filter(a => a.country.code!==client.me);
  if (kind==='none') return [];
  if (kind==='full') return av.map(a => a.country.code).sort(() => Math.random()-0.5).slice(0,maxRivals());
  if (kind==='standard'){   // (64 kingdoms on Europe, 24 elsewhere, the rivals drawn at random from every country)
    const pool=av.sort(() => Math.random()-0.5);
    return pool.slice(0,Math.min(standardKingdoms(W.map),maxKingdoms())-1).map(a => a.country.code);
  }
  return av.map(a => a.country.code).sort(() => Math.random()-0.5).slice(0,k);
}

/** A new random draw of the rivals for a standard game: 63 of the countries that could play on Europe, 23 elsewhere. */
export function randomRivals(){ return quick('standard'); }
/** Is the choice of rivals the player's own (made in the window)? Otherwise a map with a limit draws them afresh for each game. */
export const handPicked = () => !!client.choices[client.mapIndex]?.hand;

/** After the map changes: what was chosen on this map before, or (the first time) your country
    if it can play here, else one of the bigger ones, against the 9 nearest (or 9 at random). */
export function fitChoice(){
  const av=available(), codes=new Set(av.map(a => a.country.code)), saved=client.choices[client.mapIndex];
  if (saved){ client.me=saved.me; client.rivals=[...saved.rivals]; }
  else client.rivals=[];
  if (!codes.has(client.me)) client.me='';   // (no country chosen for you: you choose one)
  client.rivals=client.rivals.filter(c => codes.has(c) && c!==client.me);
  if (!saved) client.rivals = quick('standard');   // (the standard match: 64 kingdoms on Europe, 24 on the other maps)
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
  start.textContent = k ? `Start as ${k.name}` : 'Choose your country';
  start.disabled=!k || !client.rivals.length;
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
  $('nHint').textContent='Click a country to play it. Tick the countries you will face (or let the standard match draw them at random). When the game begins, everyone has 15 seconds to choose the region they start in.';
  const full=win.querySelector<HTMLButtonElement>('.nquick button[data-q="full"]')!, n=Math.min(maxKingdoms(), available().length);
  full.hidden = n<=standardKingdoms(W.map);   // (on Europe the standard match is all the room there is)
  full.textContent = isEurope(W.map) ? `Random ${n-1}` : n<maxKingdoms() ? `All · ${n}` : `Full game · ${maxKingdoms()}`;
  const std=win.querySelector<HTMLButtonElement>('.nquick button[data-q="standard"]')!, k=Math.min(standardKingdoms(W.map),n);
  std.textContent=`Standard · ${k}`;
  std.title=`The standard match: ${k} kingdoms, you and ${k-1} rivals drawn at random${real() ? ', founded where "Rivals start" says (at their capitals, or at random places)' : ', founded at random places'}; a fresh draw for each game unless you choose your own`;
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
$('nDone').addEventListener('click', closeNations);
$('nClose').addEventListener('click', closeNations);
$('pickCountry').addEventListener('click', openNations);
