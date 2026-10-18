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
/** Distance to the nearest point of the outline, and the vector from that point (east, north). */
function nearest([x, y], rings) {
  let d = Infinity, vx = 0, vy = 0;
  for (const r of rings) for (let i = 1; i < r.length; i++) {
    const [ax, ay] = r[i - 1], [bx, by] = r[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    const ex = x - ax - t * dx, ey = y - ay - t * dy, dd = Math.hypot(ex, ey);
    if (dd < d) { d = dd; vx = ex; vy = ey; }
  }
  return { d, vx, vy };
}

/** @returns Map timestamp → { value: m/min | null, bearing: degrees from north the leading edge moved toward | null } */
export function frontAdvance(features, { window = 60, pct = 0.9 } = {}) {
  const burn = features.filter((f) => f.properties.classification === 'burned_area').sort((a, b) => a.properties.video_seconds - b.properties.video_seconds);
  if (!burn.length) return new Map();
  const [lon0, lat0] = ringsOf(burn[0].geometry)[0][0];
  const geo = burn.map((f) => ({ t: f.properties.video_seconds, ts: f.properties.timestamp, rings: local(ringsOf(f.geometry), lon0, lat0) }));
  const raw = geo.map((g, i) => {
    const prev = [...geo.slice(0, i)].reverse().find((p) => g.t - p.t >= window - 0.5);
    if (!prev) return null;
    const ns = [];
    for (const r of g.rings) for (const pt of r) if (!inside(pt, prev.rings)) ns.push(nearest(pt, prev.rings));
    if (!ns.length) return { v: 0, ex: 0, ny: 0 };
    ns.sort((a, b) => a.d - b.d);
    const k = Math.min(ns.length - 1, Math.floor(ns.length * pct));
    // direction: the displacement of the leading quarter of the new outline, weighted by distance
    let ex = 0, ny = 0;
    for (const n of ns.slice(Math.floor(ns.length * 0.75))) { ex += n.vx; ny += n.vy; }
    return { v: ns[k].d / ((g.t - prev.t) / 60), ex, ny };
  });
  // rate: median of 3 against single-frame segmentation jitter; direction: vector sum over ±2 frames
  const out = new Map();
  geo.forEach((g, i) => {
    if (raw[i] == null) { out.set(g.ts, { value: null, bearing: null }); return; }
    const w = [raw[i - 1], raw[i], raw[i + 1]].filter(Boolean).map((r) => r.v).sort((a, b) => a - b);
    let ex = 0, ny = 0;
    for (const r of raw.slice(Math.max(0, i - 2), i + 3)) if (r) { ex += r.ex; ny += r.ny; }
    const value = +w[Math.floor(w.length / 2)].toFixed(2);
    const bearing = value >= 0.3 && Math.hypot(ex, ny) > 1e-6 ? Math.round((Math.atan2(ex, ny) * 180 / Math.PI + 360) % 360) : null;
    out.set(g.ts, { value, bearing });
  });
  return out;
}
