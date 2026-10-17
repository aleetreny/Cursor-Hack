// Rate of spread of the visible front, from the georeferenced burned-area outlines (used by export-static.mjs).
// For each frame: take the outline vertices that lie outside the outline ~60 s earlier, measure how far they are from it,
// and keep the 90th percentile (the leading edge) divided by the elapsed minutes → metres per minute.
const M_LAT = 111320;
const ringsOf = (g) => (g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);

function local(rings, lon0, lat0) {
  const mLon = M_LAT * Math.cos((lat0 * Math.PI) / 180);
  return rings.map((r) => r.map(([lon, lat]) => [(lon - lon0) * mLon, (lat - lat0) * M_LAT]));
}
function inside([x, y], rings) {          // even-odd over all rings (holes included)
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distTo([x, y], rings) {
  let d = Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i++) {
    const [ax, ay] = r[i - 1], [bx, by] = r[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
}

/** @returns Map timestamp → { value: m/min | null } for every burned_area frame */
export function frontAdvance(features, { window = 60, pct = 0.9 } = {}) {
  const burn = features.filter((f) => f.properties.classification === 'burned_area').sort((a, b) => a.properties.video_seconds - b.properties.video_seconds);
  if (!burn.length) return new Map();
  const [lon0, lat0] = ringsOf(burn[0].geometry)[0][0];
  const geo = burn.map((f) => ({ t: f.properties.video_seconds, ts: f.properties.timestamp, rings: local(ringsOf(f.geometry), lon0, lat0) }));
  const raw = geo.map((g, i) => {
    const prev = [...geo.slice(0, i)].reverse().find((p) => g.t - p.t >= window - 0.5);
    if (!prev) return null;
    const ds = [];
    for (const r of g.rings) for (const pt of r) if (!inside(pt, prev.rings)) ds.push(distTo(pt, prev.rings));
    if (!ds.length) return 0;
    ds.sort((a, b) => a - b);
    return ds[Math.min(ds.length - 1, Math.floor(ds.length * pct))] / ((g.t - prev.t) / 60);
  });
  // median of 3 against single-frame segmentation jitter
  const out = new Map();
  geo.forEach((g, i) => {
    const w = [raw[i - 1], raw[i], raw[i + 1]].filter((v) => v != null).sort((a, b) => a - b);
    out.set(g.ts, raw[i] == null ? null : +w[Math.floor(w.length / 2)].toFixed(2));
  });
  return out;
}
