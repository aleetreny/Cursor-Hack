// Local geodesy helpers. World space: origin at incident center, x = east (m), z = -north (m), y = up (m).
export interface GeoFrame { lon0: number; lat0: number; mLon: number; mLat: number }

export function makeFrame(lon0: number, lat0: number): GeoFrame {
  return { lon0, lat0, mLat: 111320, mLon: 111320 * Math.cos((lat0 * Math.PI) / 180) };
}
export const toXZ = (f: GeoFrame, lon: number, lat: number): [number, number] => [(lon - f.lon0) * f.mLon, -(lat - f.lat0) * f.mLat];
export const toLonLat = (f: GeoFrame, x: number, z: number): [number, number] => [f.lon0 + x / f.mLon, f.lat0 - z / f.mLat];

// Slippy-map tile math (Web Mercator)
export const lonToTileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const latToTileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

export function formatDMS(v: number, pos: string, neg: string) {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${v >= 0 ? pos : neg}`;
}
export const formatLat = (v: number) => formatDMS(v, 'N', 'S');
export const formatLon = (v: number) => formatDMS(v, 'E', 'W');
export const aspectName = (deg: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
