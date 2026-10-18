const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** All wall-clock times are rendered in UTC (Portugal is UTC+0 in March). */
export const fmtDate = (ms: number) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
export const fmtDay = (ms: number) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
export const fmtClock = (ms: number, sec = true) => new Date(ms).toISOString().slice(11, sec ? 19 : 16);
export const fmtDayClock = (ms: number) => `${fmtDay(ms)}, ${fmtClock(ms)}`;
/** Incidents that last days show the date with every time (set once the incident is loaded). */
let multiDay = false;
export const setMultiDay = (v: boolean) => { multiDay = v; };
export const isMultiDay = () => multiDay;
/** Short time for lists, ticks and labels: "12:35" in a recording, "Aug 16 22:00" in a days-long fire. */
export const fmtWhen = (ms: number) => (multiDay ? `${fmtDay(ms)} ${fmtClock(ms, false)}` : fmtClock(ms, false));
/** The time bubble: seconds in a recording, minutes in a days-long fire. */
export const fmtNow = (ms: number) => (multiDay ? `${fmtDay(ms)}, ${fmtClock(ms, false)}` : fmtDayClock(ms));
export const fmtVideo = (s: number) => { const t = Math.max(0, s); const m = Math.floor(t / 60), r = Math.floor(t % 60); return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; };
export const fmtNum = (v: number | null | undefined, d = 0) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const fmtArea = (m2: number | null | undefined) => {
  if (m2 == null || !isFinite(m2)) return { v: '—', u: '' };
  if (Math.abs(m2) >= 10000) return { v: fmtNum(m2 / 10000, 2), u: 'ha' };
  return { v: fmtNum(m2, 0), u: 'm²' };
};

/** Length of an incident: "15 min", "9 h", "14 days". */
export const fmtSpan = (ms: number) => (ms < 2 * 3600000 ? `${Math.round(ms / 60000)} min` : ms < 2 * 86400000 ? `${Math.round(ms / 3600000)} h` : `${Math.round(ms / 86400000)} days`);
