import { useMemo } from 'react';
import { useStore } from '../state/store';
import { fmtNum } from '../lib/format';

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const dir = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const diff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Spread vs wind: which way the visible front is moving (measured from the burned outlines) against which way the
 * ERA5 wind blows, at the timeline cursor. Sized by the parent to the space left in the Layers tab.
 */
export function SpreadWindCard({ height }: { height: number }) {
  const { timeline, time, weather } = useStore();
  const frames = timeline?.frames ?? [];
  const now = useMemo(() => {
    let best = frames[0];
    for (const f of frames) if (Date.parse(f.timestamp) <= time) best = f; else break;
    return best;
  }, [frames, time]);
  // whole-recording direction: rate-weighted vector mean of the per-frame bearings
  const overall = useMemo(() => {
    let x = 0, y = 0;
    for (const f of frames) { const b = f.front_bearing_deg?.value, v = f.front_advance_m_min?.value; if (b != null && v) { x += Math.sin((b * Math.PI) / 180) * v; y += Math.cos((b * Math.PI) / 180) * v; } }
    return Math.hypot(x, y) > 0 ? (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 : null;
  }, [frames]);
  const wx = useMemo(() => {
    const h = weather?.hourly ?? [];
    return h.length ? h.reduce((a, b) => (Math.abs(Date.parse(b.timestamp) - time) < Math.abs(Date.parse(a.timestamp) - time) ? b : a)) : null;
  }, [weather, time]);
  if (!now?.front_bearing_deg || !wx || wx.wind_dir_deg == null) return null;
  const front = now.front_bearing_deg.value, ros = now.front_advance_m_min?.value ?? null;
  const windTo = (wx.wind_dir_deg + 180) % 360;
  const ref = front ?? overall;
  const d = ref != null ? diff(ref, windTo) : null;
  const verdict = d == null ? '' : d < 30 ? 'with the wind' : d < 70 ? 'at an angle to the wind' : d < 120 ? 'across the wind' : 'against the wind';
  const compact = height < 170, tiny = height < 112, micro = height < 86;
  const tall = height >= 330;   // compass above the text
  const S = tall ? Math.min(230, height - 200) : Math.max(30, Math.min(132, height - (compact ? 38 : 66)));
  const arrow = (deg: number, len: number, color: string, w: number, dash?: string) => {
    const a = (deg * Math.PI) / 180, x = Math.sin(a) * len, y = -Math.cos(a) * len, h = 7, ax = Math.sin(a), ay = -Math.cos(a);
    return (
      <g stroke={color} strokeWidth={w} strokeLinecap="round" fill="none">
        <line x1={-x * 0.15} y1={-y * 0.15} x2={x} y2={y} strokeDasharray={dash} />
        <path d={`M${x - ax * h - ay * h * 0.6},${y - ay * h + ax * h * 0.6} L${x},${y} L${x - ax * h + ay * h * 0.6},${y - ay * h - ax * h * 0.6}`} strokeLinejoin="round" />
      </g>
    );
  };
  return (
    <div className="section spread-card" style={{ height }}>
      <div className="section-h"><span>Spread vs wind <small>(at cursor)</small></span><span className="prov derived">derived</span></div>
      <div className={'sw-body' + (tall ? ' tall' : '')}>
        <svg width={S} height={S} viewBox="-60 -60 120 120" role="img" aria-label={`Front moving ${front != null ? dir(front) : 'not measurable'}, wind blowing toward ${dir(windTo)}`}>
          <circle r={50} fill="none" stroke="var(--line)" strokeWidth={1.2} />
          <circle r={25} fill="none" stroke="var(--line-2)" strokeWidth={1} />
          {[0, 90, 180, 270].map((t) => <line key={t} x1={0} y1={-50} x2={0} y2={-44} stroke="var(--muted)" strokeWidth={1.2} transform={`rotate(${t})`} />)}
          {(['N', 'E', 'S', 'W'] as const).map((l, i) => <text key={l} x={[0, 56, 0, -56][i]} y={[-52, 3.5, 59, 3.5][i]} textAnchor="middle" fontSize={10} fontWeight={650} fill="var(--muted)">{l}</text>)}
          {arrow(windTo, 40, '#3b82c4', 3)}
          {overall != null && arrow(overall, 30, '#e8742c', 1.8, '3 3')}
          {front != null && arrow(front, 44, '#d2402a', 3.4)}
          <circle r={3} fill="var(--ink)" />
        </svg>
        {micro ? (
          <div className="sw-text compact">
            <div className="sw-line"><span className="sw-key fire" /><b>{front != null ? `${dir(front)} ${front}°` : 'still'}</b> <span className="sw-key wind" style={{ marginLeft: 8 }} /><b>{dir(windTo)} {Math.round(windTo)}°</b>{d != null && <span className="muted"> · {Math.round(d)}° off</span>}</div>
          </div>
        ) : compact ? (
          <div className="sw-text compact">
            <div className="sw-line"><span className="sw-key fire" />Front <b>{front != null ? `${dir(front)} ${front}°` : 'still'}</b>{!tiny && ros != null && front != null && <span className="muted"> · {fmtNum(ros, 1)} m/min</span>}</div>
            <div className="sw-line"><span className="sw-key wind" />Wind to <b>{dir(windTo)} {Math.round(windTo)}°</b>{!tiny && <span className="muted"> · {fmtNum(wx.wind_kmh, 1)} km/h</span>}</div>
            {d != null && <div className="sw-line sw-verdict"><b>{Math.round(d)}°</b> off the wind</div>}
          </div>
        ) : (
          <div className="sw-text">
            <div className="sw-item"><span className="sw-key fire" /><span className="lab">Front moving toward</span><b>{front != null ? `${dir(front)} ${front}°` : 'not advancing'}{ros != null && front != null && <span className="muted"> · {fmtNum(ros, 1)} m/min</span>}</b></div>
            <div className="sw-item"><span className="sw-key wind" /><span className="lab">Wind blowing toward</span><b>{dir(windTo)} {Math.round(windTo)}°<span className="muted"> · {fmtNum(wx.wind_kmh, 1)} km/h</span></b></div>
            {overall != null && <div className="sw-item"><span className="sw-key dash" /><span className="lab">Front, whole recording</span><b>{dir(overall)} {Math.round(overall)}°</b></div>}
            {verdict && <div className="sw-verdict">{front != null ? 'Moving' : 'Overall it moved'} <b>{verdict}</b> ({Math.round(d!)}° off).</div>}
          </div>
        )}
      </div>
      {!compact && <div className="muted sw-note">Front direction from the burned outlines (visible part only); wind from the ERA5 reanalysis.</div>}
    </div>
  );
}
