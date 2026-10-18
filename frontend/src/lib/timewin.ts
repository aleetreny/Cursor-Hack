import { useStore } from '../state/store';
import { sunPosition } from '../scene/sun';

/**
 * The visible time window of the timeline and charts (null = the whole incident). A two-week fire needs it: an hour
 * is a few pixels otherwise. Zoom keeps the time under the pointer fixed; the window never leaves [t0, t1].
 */
type S = ReturnType<typeof useStore.getState>;
export const getWin = (s: Pick<S, 't0' | 't1' | 'win'>): [number, number] => s.win ?? [s.t0, s.t1];
const minWidth = (s: S) => (s.incident?.scale === 'regional' ? 3 * 3600000 : 45000);

function setWin(a: number, w: number) {
  const s = useStore.getState(), full = s.t1 - s.t0;
  if (w >= full * 0.999) { s.set({ win: null }); return; }
  const a2 = Math.min(s.t1 - w, Math.max(s.t0, a));
  s.set({ win: [a2, a2 + w] });
}
/** Zoom by `factor` (< 1 zooms in) around time `at`. */
export function zoomAround(at: number, factor: number) {
  const s = useStore.getState(), [a, b] = getWin(s), w = b - a;
  const nw = Math.min(s.t1 - s.t0, Math.max(minWidth(s), w * factor));
  setWin(at - (at - a) * (nw / w), nw);
}
export function panBy(dt: number) { const s = useStore.getState(), [a, b] = getWin(s); setWin(a + dt, b - a); }
export const resetWin = () => useStore.getState().set({ win: null });
/** Keep the cursor inside the window while playing or seeking (it slides, keeping its width). */
export function follow(t: number) {
  const s = useStore.getState();
  if (!s.win) return;
  const [a, b] = s.win, w = b - a;
  if (t < a || t > b) setWin(t - w * 0.15, w);
}

/** Night intervals (sun below −6°: civil twilight) at the incident, for shading the timeline and charts. */
const cache = new Map<string, { x0: number; x1: number }[]>();
export function nights(t0: number, t1: number, lon: number, lat: number) {
  const key = `${t0}|${t1}|${lon}|${lat}`;
  if (cache.has(key)) return cache.get(key)!;
  const out: { x0: number; x1: number }[] = [], step = 600000;
  let start: number | null = null;
  for (let t = t0; t <= t1 + step; t += step) {
    const dark = sunPosition(Math.min(t, t1), lat, lon).elevation < -6;
    if (dark && start == null) start = t;
    if ((!dark || t >= t1) && start != null) { out.push({ x0: start, x1: Math.min(t, t1) }); start = null; }
  }
  cache.set(key, out);
  return out;
}
