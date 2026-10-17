import { useLayoutEffect, useRef, useState } from 'react';

export interface Pt { x: number; y: number | null }

/** Small area/line chart in the reference's style: solid to the cursor, faded after it. */
export function MiniChart({ pts, cursor, color, kind = 'area', xTicks, yTicks, cursorY, fill, zero = true, bands = [], marks = [], label }: {
  zero?: boolean; pts: Pt[]; cursor?: number | null; color: string; kind?: 'area' | 'line'; xTicks: { x: number; label: string }[]; yTicks?: number[]; cursorY?: number | null; fill?: string;
  /** shaded x ranges drawn behind the series */ bands?: { x0: number; x1: number; color: string }[];
  /** labelled point markers on the x axis (e.g. the drone position) */ marks?: { x: number; label: string; color: string }[];
  /** accessible description of the chart */ label?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 260, h: 70 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const valid = pts.filter((p) => p.y != null) as { x: number; y: number }[];
  const L = 34, R = 6, T = 6, B = 14;
  const w = Math.max(10, size.w - L - R), h = Math.max(10, size.h - T - B);
  if (!pts.length) return <div className="cbody"><svg ref={ref} /></div>;
  const xs = pts.map((p) => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ys = valid.map((p) => p.y);
  const yt = yTicks ?? (zero ? niceTicks(Math.min(0, ...ys), Math.max(1e-9, ...ys)) : niceTicks(Math.min(...ys) - 1, Math.max(...ys) + 1));
  const y0 = Math.min(yt[0], ...ys), y1 = Math.max(yt[yt.length - 1], ...ys);
  const X = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * w;
  const Y = (y: number) => T + h - ((y - y0) / (y1 - y0 || 1)) * h;
  const path = (arr: { x: number; y: number }[]) => arr.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const cx = cursor != null ? X(cursor) : null;
  const past = cursor != null ? valid.filter((p) => p.x <= cursor) : valid;
  const future = cursor != null ? valid.filter((p) => p.x >= (past[past.length - 1]?.x ?? -Infinity)) : [];
  const base = zero ? Math.max(0, y0) : y0;
  const area = (arr: { x: number; y: number }[]) => (arr.length > 1 ? `${path(arr)}L${X(arr[arr.length - 1].x)},${Y(base)}L${X(arr[0].x)},${Y(base)}Z` : '');
  const cy = cursorY ?? (cursor != null ? interp(valid, cursor) : null);
  const gid = 'g' + color.replace(/[^a-z0-9]/gi, '');
  return (
    <div className="cbody"><svg ref={ref} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={fill ?? color} stopOpacity=".55" /><stop offset="1" stopColor={fill ?? color} stopOpacity=".12" /></linearGradient>
      </defs>
      {yt.map((v, i) => (
        <g key={i}><line x1={L} x2={L + w} y1={Y(v)} y2={Y(v)} stroke="#e2dbd0" strokeWidth={1} /><text x={L - 5} y={Y(v) + 3} textAnchor="end">{fmtTick(v)}</text></g>
      ))}
      {bands.map((b, i) => <rect key={'b' + i} x={X(Math.max(x0, b.x0))} y={T} width={Math.max(0, X(Math.min(x1, b.x1)) - X(Math.max(x0, b.x0)))} height={h} fill={b.color} />)}
      {/* first/last tick labels hug the plot edges so they never run into the y-axis labels */}
      {xTicks.map((t, i) => <text key={i} x={X(t.x)} y={T + h + 12} textAnchor={i === 0 && X(t.x) - L < 16 ? 'start' : i === xTicks.length - 1 && L + w - X(t.x) < 16 ? 'end' : 'middle'}>{t.label}</text>)}
      {kind === 'area' && <path d={area(past)} fill={`url(#${gid})`} />}
      {kind === 'area' && <path d={area(future)} fill={fill ?? color} opacity={0.12} />}
      <path d={path(past)} fill="none" stroke={color} strokeWidth={1.5} />
      <path d={path(future)} fill="none" stroke={color} strokeWidth={1.2} opacity={0.35} strokeDasharray={kind === 'line' ? '3 2' : undefined} />
      {marks.map((m, i) => <g key={'m' + i}><circle cx={X(m.x)} cy={T + h} r={3} fill={m.color} stroke="#fff" strokeWidth={1} /><text x={X(m.x)} y={T + 8} textAnchor={X(m.x) - L < 30 ? 'start' : L + w - X(m.x) < 30 ? 'end' : 'middle'} fill={m.color} style={{ fontWeight: 650 }}>{m.label}</text></g>)}
      {cx != null && (
        <g>
          <line x1={cx} x2={cx} y1={T - 4} y2={T + h} stroke="#3d3832" strokeWidth={1} />
          <circle cx={cx} cy={T - 4} r={2.5} fill="#fff" stroke="#3d3832" />
          {cy != null && <circle cx={cx} cy={Y(cy)} r={3.2} fill={color} stroke="#fff" strokeWidth={1.2} />}
          <circle cx={cx} cy={T + h} r={2.5} fill="#fff" stroke="#3d3832" />
        </g>
      )}
    </svg></div>
  );
}

function interp(p: { x: number; y: number }[], x: number) {
  if (!p.length) return null;
  if (x <= p[0].x) return p[0].y;
  for (let i = 1; i < p.length; i++) if (p[i].x >= x) { const a = p[i - 1], b = p[i], k = (x - a.x) / (b.x - a.x || 1); return a.y + (b.y - a.y) * k; }
  return p[p.length - 1].y;
}
export function niceTicks(lo: number, hi: number, n = 3) {
  const span = hi - lo || 1, step0 = span / n, pow = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= step0) ?? pow * 10;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(+v.toFixed(6));
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}
const fmtTick = (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(1)}`);
