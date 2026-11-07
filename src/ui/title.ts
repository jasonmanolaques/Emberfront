/* ---------- the title screen's wallpapers: ten scenes from the game, one every 5 seconds ----------
   Two layers cross-fade; the slideshow only runs while the title screen is up (the start, before a match). */
import { client } from '../client';
import w01 from '../assets/wall/01.webp?inline';
import w02 from '../assets/wall/02.webp?inline';
import w03 from '../assets/wall/03.webp?inline';
import w04 from '../assets/wall/04.webp?inline';
import w05 from '../assets/wall/05.webp?inline';
import w06 from '../assets/wall/06.webp?inline';
import w07 from '../assets/wall/07.webp?inline';
import w08 from '../assets/wall/08.webp?inline';
import w09 from '../assets/wall/09.webp?inline';
import w10 from '../assets/wall/10.webp?inline';
import { $ } from './dom';

export const WALLPAPERS = [w05, w01, w06, w03, w10, w02, w07, w09, w04, w08];
export const WALL_EVERY = 5000;   // milliseconds each scene stays

export function setupTitle(){
  const wall=$('wall'), layers=[...wall.querySelectorAll<HTMLElement>('.wp')];
  let shown=-1, front=0, at=0;
  const show=(i: number) => {
    const next=layers[1-front], old=layers[front];
    next.style.backgroundImage=`url("${WALLPAPERS[i]}")`;
    next.classList.remove('on'); void next.offsetWidth; next.classList.add('on');   // (the drift starts over)
    old.classList.remove('on');
    front=1-front; shown=i; at=performance.now();
  };
  setInterval(() => {
    const up=client.state==='intro';
    wall.hidden=!up;
    if (!up) return;
    if (shown<0) show(0);
    else if (performance.now()-at>=WALL_EVERY-50) show((shown+1)%WALLPAPERS.length);
  },250);
}
