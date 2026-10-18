import * as THREE from 'three';

/**
 * Where the sun is, and what the light looks like, at a given time and place.
 * Solar position: the low-precision algorithm of the Astronomical Almanac (good to ~0.01°, far below what the
 * lighting needs). Light curves: night below −6° (civil twilight), warm low sun up to ~25°, full day above.
 */
const RAD = Math.PI / 180;

export function sunPosition(ms: number, lat: number, lon: number): { elevation: number; azimuth: number } {
  const d = ms / 86400000 - 10957.5;                                   // days since J2000.0 (2000-01-01 12:00 UTC)
  const g = (357.529 + 0.98560028 * d) * RAD;                          // mean anomaly
  const q = 280.459 + 0.98564736 * d;                                  // mean longitude (deg)
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;  // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD;                           // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24; // hours
  const H = (gmst * 15 + lon) * RAD - ra;                              // local hour angle
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { elevation: alt / RAD, azimuth: ((az / RAD) + 360) % 360 };
}

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a: THREE.Color, b: THREE.Color, k: number) => a.clone().lerp(b, k);
const C = (h: string) => new THREE.Color(h);

export interface Lighting {
  dir: THREE.Vector3; sunColor: THREE.Color; sunIntensity: number; shadows: boolean;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiIntensity: number;
  skyTop: THREE.Color; skyBottom: THREE.Color; fog: THREE.Color; exposure: number;
  /** 0 = full day, 1 = night: fire reads stronger, smoke darker */
  night: number;
}

/** Light for a sun elevation/azimuth (deg). World axes: x east, y up, z south. */
export function lightingFor(elevation: number, azimuth: number): Lighting {
  const day = ss(-6, 10, elevation), low = 1 - ss(2, 28, elevation), sunUp = ss(-1.5, 4, elevation);
  const el = Math.max(elevation, 3) * RAD, az = azimuth * RAD;         // keep the shading direction above the horizon
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  const twilight = ss(-8, 0, elevation) * (1 - ss(0, 10, elevation));  // the orange band around sunrise/sunset
  return {
    dir,
    sunColor: mix(C('#ffe9cc'), C('#ff9a55'), low),
    sunIntensity: 3.3 * sunUp * (0.55 + 0.45 * ss(4, 30, elevation)),
    shadows: elevation > 1,
    hemiSky: mix(C('#6a7fb2'), C('#dfe6ef'), day),           // night: moonlight-level blue, enough to read the relief
    hemiGround: mix(C('#1c1814'), C('#6e5440'), day),
    hemiIntensity: 0.7 + 0.15 * day,
    skyTop: mix(C('#0a1022'), C('#aebccb'), day),
    skyBottom: mix(mix(C('#1f2738'), C('#dedfd9'), day), C('#e9a46e'), twilight * 0.75),
    fog: mix(mix(C('#1a2130'), C('#d9dcd8'), day), C('#c99a7a'), twilight * 0.5),
    exposure: 1.05 + 0.45 * (1 - day),
    night: 1 - day,
  };
}
