import type { Incident } from '../api/types';

/**
 * Two kinds of incident share the app:
 *  · site     — a drone's view of a burn over minutes (Pinhão): seconds matter, the camera works in metres
 *  · regional — a whole wildfire over days (Larouco): hours matter, the camera works in kilometres
 */
export const isRegional = (i: Incident | null | undefined) => i?.scale === 'regional';

/** Playback speeds: real-time multiples for a recording, fire-time per second for a days-long fire. */
export const speedsFor = (i: Incident | null | undefined) => (isRegional(i) ? [900, 1800, 3600, 7200, 14400] : [1, 4, 8, 16, 32]);
export const defaultSpeed = (i: Incident | null | undefined) => (isRegional(i) ? 3600 : 8);
export const speedLabel = (s: number) => (s < 60 ? `${s}×` : s < 3600 ? `${s / 60} min/s` : `${s / 3600} h/s`);
/** Keyboard step on the timeline (ms): arrow, Shift+arrow. */
export const timeSteps = (i: Incident | null | undefined): [number, number] => (isRegional(i) ? [3600000, 6 * 3600000] : [8000, 60000]);
