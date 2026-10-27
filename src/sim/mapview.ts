/* ---------- the real-world maps' framing: which part of the globe, and how it is flattened ----------
   Shared by the game (capitals onto tiles, latitude for the climate) and by tools/realmaps.ts,
   which draws the maps from Natural Earth's coastlines, lakes, mountain ranges and deserts. */

export interface MapView {
  lon0: number; lon1: number;   // west and east edges (a whole turn of the globe wraps round)
  lat0: number; lat1: number;   // north and south edges
  proj: 'eq' | 'miller';        // plain latitude and longitude, or Miller's cylinder (the world)
  w: number; h: number;         // its size in tiles (bigger than a generated map's, so close capitals have room)
}
const RAD = Math.PI/180;
const millerY = (lat: number) => 1.25*Math.log(Math.tan(Math.PI/4+0.4*lat*RAD));
const millerLat = (y: number) => (2.5*Math.atan(Math.exp(0.8*y))-0.625*Math.PI)/RAD;

/** Longitude to a column (continuous, not wrapped). */
export const colOf = (v: MapView, lon: number, w: number) => (lon-v.lon0)/(v.lon1-v.lon0)*w;
/** Latitude to a row (continuous). */
export function rowOf(v: MapView, lat: number, h: number){
  if (v.proj==='miller'){ const a=millerY(v.lat0), b=millerY(v.lat1); return (a-millerY(lat))/(a-b)*h; }
  return (v.lat0-lat)/(v.lat0-v.lat1)*h;
}
/** The latitude of the middle of row y. */
export function latOf(v: MapView, y: number, h: number){
  if (v.proj==='miller'){ const a=millerY(v.lat0), b=millerY(v.lat1); return millerLat(a-(y+0.5)/h*(a-b)); }
  return v.lat0-(y+0.5)/h*(v.lat0-v.lat1);
}
/** A place on the globe to a tile column and row, or null if it is off this map. */
export function tileXY(v: MapView, lat: number, lon: number, w: number, h: number): [number, number] | null {
  let L=lon;
  if (v.lon1-v.lon0>=359.9){ while (L<v.lon0) L+=360; while (L>=v.lon0+360) L-=360; }
  const x=Math.floor(colOf(v,L,w)), y=Math.floor(rowOf(v,lat,h));
  return x<0 || y<0 || x>=w || y>=h ? null : [x,y];
}

export const VIEWS: Record<string, MapView> = {
  balkans: { lon0:12, lon1:46, lat0:49, lat1:33, proj:'eq', w:560, h:348 },
  europe: { lon0:-12, lon1:66, lat0:71, lat1:34.5, proj:'eq', w:600, h:372 },
  world: { lon0:-169, lon1:191, lat0:78, lat1:-56, proj:'miller', w:640, h:396 },   // cut through the Bering Strait
};
