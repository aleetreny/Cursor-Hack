/**
 * SIMULATED operations layer — deterministic, time-driven, clearly labelled in the UI.
 * Nothing here is an observation: drones FT-02…FT-06 and all 13 resources are an illustrative exercise placed
 * around the real incident so the Drones/Resources workflows can be demonstrated. UAV-01 (real footage) is not here.
 * Every state is a pure function of the global timeline time → scrubbing is reproducible.
 */
export type UnitKind = 'drone' | 'air_tanker' | 'helicopter' | 'air_attack' | 'engine' | 'tender' | 'crew' | 'dozer';
export type UnitGroup = 'drones' | 'aircraft' | 'engines' | 'crews';

export interface SimUnit {
  id: string; name: string; kind: UnitKind; group: UnitGroup; type: string;
  mission: string; task: string; agency: string; personnel: number; capacity: number; capUnit: 'gal' | 'chains' | '';
  color: string; sensor?: string;
}
export interface UnitState {
  lon: number; lat: number; agl: number; heading: number; speedKt: number; status: string;
  load: number; battery?: number; link?: number; lineChains?: number; flightS: number; visible: boolean;
}
export interface Drop { unitId: string; t: number; line: [number, number][]; gal: number; kind: 'retardant' | 'water' }
export interface SimCtx {
  t0: number; t1: number; center: [number, number]; cell: [number, number][];
  /** regional fires: where the front was each hour (from the reconstruction), the scar's centre and size */
  regional?: { fronts: { t: number; c: [number, number]; r: number; b: number | null }[]; scar: [number, number]; scarR: number };
}

export const SIM_UNITS: SimUnit[] = [
  { id: 'FT-02', name: 'Harrier', kind: 'drone', group: 'drones', type: 'Heavy-lift quadcopter', mission: 'Orbit · active fire', task: 'Circling the most active part of the front', agency: 'Exercise', personnel: 0, capacity: 0, capUnit: '', color: '#d2402a', sensor: 'EO/IR · 20× zoom' },
  { id: 'FT-03', name: 'Swift', kind: 'drone', group: 'drones', type: 'Quadcopter', mission: 'Orbit · spot watch', task: 'Watching ahead of the front for spot ignitions', agency: 'Exercise', personnel: 0, capacity: 0, capUnit: '', color: '#d2402a', sensor: 'EO/IR' },
  { id: 'FT-04', name: 'Osprey', kind: 'drone', group: 'drones', type: 'Quadcopter', mission: 'Patrol', task: 'Patrolling the east edge of the burn cell', agency: 'Exercise', personnel: 0, capacity: 0, capUnit: '', color: '#d2402a', sensor: 'EO' },
  { id: 'FT-05', name: 'Condor', kind: 'drone', group: 'drones', type: 'Fixed-wing VTOL', mission: 'Survey', task: 'Lawn-mower mapping pass over the cell', agency: 'Exercise', personnel: 0, capacity: 0, capUnit: '', color: '#d2402a', sensor: 'EO mapping' },
  { id: 'FT-06', name: 'Wren', kind: 'drone', group: 'drones', type: 'Quadcopter', mission: 'Relay', task: 'Comms relay above the cell', agency: 'Exercise', personnel: 0, capacity: 0, capUnit: '', color: '#d2402a', sensor: 'EO · mesh radio' },
  { id: 'T-910', name: 'DC-10 VLAT', kind: 'air_tanker', group: 'aircraft', type: 'Very large air tanker', mission: 'Retardant drops', task: 'Line on the north flank', agency: 'Exercise · air ops', personnel: 3, capacity: 9400, capUnit: 'gal', color: '#c0392b' },
  { id: 'T-131', name: 'C-130Q', kind: 'air_tanker', group: 'aircraft', type: 'Air tanker', mission: 'Retardant drops', task: 'Line on the east flank', agency: 'Exercise · air ops', personnel: 4, capacity: 4000, capUnit: 'gal', color: '#c0392b' },
  { id: 'T-162', name: 'RJ85', kind: 'air_tanker', group: 'aircraft', type: 'Air tanker', mission: 'Retardant drops', task: 'Tie-in at the south anchor', agency: 'Exercise · air ops', personnel: 3, capacity: 3000, capUnit: 'gal', color: '#c0392b' },
  { id: 'H-743', name: 'S-64 Air-Crane', kind: 'helicopter', group: 'aircraft', type: 'Type 1 helitanker', mission: 'Water drops', task: 'Cooling the head of the fire', agency: 'Exercise · air ops', personnel: 3, capacity: 2650, capUnit: 'gal', color: '#2f6fb3' },
  { id: 'H-531', name: 'Bell 205', kind: 'helicopter', group: 'aircraft', type: 'Type 2 bucket', mission: 'Water drops', task: 'Spot-fire suppression', agency: 'Exercise · air ops', personnel: 2, capacity: 324, capUnit: 'gal', color: '#2f6fb3' },
  { id: 'AA-52', name: 'King Air 200', kind: 'air_attack', group: 'aircraft', type: 'Air attack', mission: 'Air attack · supervising', task: 'Coordinating tankers over the cell', agency: 'Exercise · air ops', personnel: 2, capacity: 0, capUnit: '', color: '#6b7280' },
  { id: 'E-31', name: 'Type 3 Engine', kind: 'engine', group: 'engines', type: 'Wildland engine', mission: 'Structure protection', task: 'Holding near the access road', agency: 'Exercise · ground', personnel: 4, capacity: 500, capUnit: 'gal', color: '#b91c1c' },
  { id: 'E-32', name: 'Type 3 Engine', kind: 'engine', group: 'engines', type: 'Wildland engine', mission: 'Structure protection', task: 'Holding the west boundary', agency: 'Exercise · ground', personnel: 5, capacity: 500, capUnit: 'gal', color: '#b91c1c' },
  { id: 'E-45', name: 'Type 1 Engine', kind: 'engine', group: 'engines', type: 'Structure engine', mission: 'Patrol', task: 'Patrolling the cell perimeter', agency: 'Exercise · ground', personnel: 4, capacity: 750, capUnit: 'gal', color: '#b91c1c' },
  { id: 'WT-12', name: 'Water Tender', kind: 'tender', group: 'engines', type: 'Water tender', mission: 'Supply', task: 'Shuttling water to E-31', agency: 'Exercise · ground', personnel: 2, capacity: 2500, capUnit: 'gal', color: '#1d4ed8' },
  { id: 'C-7', name: 'Crew 7 · Hotshots', kind: 'crew', group: 'crews', type: 'Type 1 hand crew', mission: 'Holding & mop-up', task: 'Cutting line along the north perimeter', agency: 'Exercise · ground', personnel: 20, capacity: 0, capUnit: 'chains', color: '#c2410c' },
  { id: 'C-14', name: 'Crew 14 · Hand crew', kind: 'crew', group: 'crews', type: 'Type 2 hand crew', mission: 'Holding & mop-up', task: 'Cutting line along the south perimeter', agency: 'Exercise · ground', personnel: 17, capacity: 0, capUnit: 'chains', color: '#c2410c' },
  { id: 'DZ-4', name: 'D6 Dozer', kind: 'dozer', group: 'crews', type: 'Dozer', mission: 'Holding & mop-up', task: 'Widening the west containment line', agency: 'Exercise · ground', personnel: 1, capacity: 0, capUnit: 'chains', color: '#ca8a04' },
];

const D2R = Math.PI / 180, M_LAT = 111320;
const mlon = (lat: number) => 111320 * Math.cos(lat * D2R);
const off = (c: [number, number], e: number, n: number): [number, number] => [c[0] + e / mlon(c[1]), c[1] + n / M_LAT];
const toEN = (c: [number, number], p: [number, number]) => [(p[0] - c[0]) * mlon(c[1]), (p[1] - c[1]) * M_LAT];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => k * k * (3 - 2 * k);
const hdg = (de: number, dn: number) => ((Math.atan2(de, dn) / D2R) + 360) % 360;
const KT = 1.94384;

/** Polyline helpers over the burn-cell ring (lon/lat). */
function ringLength(c: [number, number], ring: [number, number][]) { let L = 0; for (let i = 1; i < ring.length; i++) { const a = toEN(c, ring[i - 1]), b = toEN(c, ring[i]); L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }
function alongRing(c: [number, number], ring: [number, number][], d: number): { p: [number, number]; h: number } {
  const L = ringLength(c, ring); d = ((d % L) + L) % L;
  for (let i = 1; i < ring.length; i++) {
    const a = toEN(c, ring[i - 1]), b = toEN(c, ring[i]), s = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= s) { const k = d / (s || 1); return { p: off(c, lerp(a[0], b[0], k), lerp(a[1], b[1], k)), h: hdg(b[0] - a[0], b[1] - a[1]) }; }
    d -= s;
  }
  return { p: ring[0], h: 0 };
}
export function ringSegment(c: [number, number], ring: [number, number][], d0: number, d1: number, step = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let d = d0; d <= d1; d += step) out.push(alongRing(c, ring, d).p);
  out.push(alongRing(c, ring, d1).p);
  return out;
}

// aircraft circuit parameters: base bearing/distance (m), period (s), phase (0..1), drop target offset (m), drop run length
const AIR: Record<string, { base: [number, number]; P: number; ph: number; tgt: [number, number]; run: number; cruise: number; spd: number }> = {
  'T-910': { base: [-9000, -7000], P: 400, ph: 0.15, tgt: [-60, 140], run: 420, cruise: 650, spd: 140 },
  'T-131': { base: [-8000, -8500], P: 330, ph: 0.55, tgt: [180, 20], run: 320, cruise: 550, spd: 120 },
  'T-162': { base: [-9500, -6000], P: 300, ph: 0.82, tgt: [40, -200], run: 280, cruise: 520, spd: 115 },
  'H-743': { base: [1800, -1500], P: 210, ph: 0.3, tgt: [-30, 40], run: 0, cruise: 160, spd: 45 },
  'H-531': { base: [1500, -1900], P: 170, ph: 0.7, tgt: [60, 90], run: 0, cruise: 120, spd: 40 },
};

export function unitState(u: SimUnit, t: number, ctx: SimCtx): UnitState {
  if (ctx.regional) return regionalState(u, t, ctx);
  const s = (t - ctx.t0) / 1000, c = ctx.center;
  const base: UnitState = { lon: c[0], lat: c[1], agl: 0, heading: 0, speedKt: 0, status: '', load: u.capacity, flightS: s, visible: true };
  if (u.kind === 'drone') {
    const cfg: Record<string, { r: number; agl: number; P: number; ph: number; cx: number; cy: number; b0: number; end: number }> = {
      'FT-02': { r: 70, agl: 70, P: 95, ph: 0, cx: -40, cy: 45, b0: 92, end: 2400 }, 'FT-03': { r: 45, agl: 55, P: 70, ph: 0.4, cx: -10, cy: 95, b0: 86, end: 2100 },
      'FT-04': { r: 0, agl: 90, P: 240, ph: 0.2, cx: 0, cy: 0, b0: 97, end: 2600 }, 'FT-05': { r: 0, agl: 120, P: 360, ph: 0, cx: 0, cy: 0, b0: 79, end: 3600 },
      'FT-06': { r: 25, agl: 150, P: 300, ph: 0.6, cx: 30, cy: 120, b0: 91, end: 3000 },
    };
    const k = cfg[u.id]; const a = 2 * Math.PI * (s / k.P + k.ph);
    let e = k.cx + k.r * Math.cos(a), n = k.cy + k.r * Math.sin(a), de = -Math.sin(a), dn = Math.cos(a), spd = (2 * Math.PI * k.r) / k.P;
    if (u.id === 'FT-04') { const r = alongRing(c, ctx.cell, (s / k.P) * ringLength(c, ctx.cell) * 0.5 + 900); const en = toEN(c, r.p); e = en[0]; n = en[1]; de = Math.sin(r.h * D2R); dn = Math.cos(r.h * D2R); spd = ringLength(c, ctx.cell) * 0.5 / k.P; }
    if (u.id === 'FT-05') { const lane = Math.floor(s / 45) % 8, kk = (s % 45) / 45, dir = lane % 2 ? -1 : 1; e = -350 + lane * 90; n = -600 + (dir > 0 ? kk : 1 - kk) * 1300; de = 0; dn = dir; spd = 1300 / 45; }
    const [lon, lat] = off(c, e, n);
    return { ...base, lon, lat, agl: k.agl, heading: hdg(de, dn), speedKt: spd * KT, status: u.mission.split(' · ')[0], battery: Math.max(8, k.b0 - (s / k.end) * 100), link: -58 - Math.round(Math.abs(Math.sin(s / 37)) * 14), load: 0 };
  }
  if (u.kind === 'air_attack') {
    const a = (s / 150) * 2 * Math.PI; const [lon, lat] = off(c, 1400 * Math.cos(a), 1400 * Math.sin(a));
    return { ...base, lon, lat, agl: 900, heading: hdg(-Math.sin(a), Math.cos(a)), speedKt: (2 * Math.PI * 1400 / 150) * KT, status: 'Supervising', load: 0 };
  }
  if (u.kind === 'air_tanker' || u.kind === 'helicopter') {
    const k = AIR[u.id]; const f = (((s / k.P) + k.ph) % 1 + 1) % 1;
    const tgt: [number, number] = [k.tgt[0], k.tgt[1]], B = k.base;
    const dir = Math.atan2(tgt[0] - B[0], tgt[1] - B[1]);                      // inbound bearing (rad, from north)
    const ue = Math.sin(dir), un = Math.cos(dir), half = k.run / 2;
    const A0: [number, number] = [tgt[0] - ue * (half + 600), tgt[1] - un * (half + 600)], A1: [number, number] = [tgt[0] - ue * half, tgt[1] - un * half], A2: [number, number] = [tgt[0] + ue * half, tgt[1] + un * half];
    let e = 0, n = 0, agl = k.cruise, status = '', de = ue, dn = un, load = u.capacity, visible = true;
    if (f < 0.4) { const q = ease(f / 0.4); e = lerp(B[0], A0[0], q); n = lerp(B[1], A0[1], q); agl = lerp(k.cruise, k.cruise * 0.7, q); status = 'Inbound'; }
    else if (f < 0.47) { const q = (f - 0.4) / 0.07; e = lerp(A0[0], A1[0], q); n = lerp(A0[1], A1[1], q); agl = lerp(k.cruise * 0.7, u.kind === 'helicopter' ? 35 : 70, q); status = 'On final'; }
    else if (f < 0.53) { const q = (f - 0.47) / 0.06; e = lerp(A1[0], A2[0], q); n = lerp(A1[1], A2[1], q); agl = u.kind === 'helicopter' ? 30 : 60; status = 'Dropping'; load = u.capacity * (1 - q); }
    else if (f < 0.88) { const q = ease((f - 0.53) / 0.35); const R: [number, number] = [A2[0] + ue * 800, A2[1] + un * 800]; e = q < 0.3 ? lerp(A2[0], R[0], q / 0.3) : lerp(R[0], B[0], (q - 0.3) / 0.7); n = q < 0.3 ? lerp(A2[1], R[1], q / 0.3) : lerp(R[1], B[1], (q - 0.3) / 0.7); agl = lerp(80, k.cruise, Math.min(1, q * 2)); status = 'Return to reload'; load = 0; de = q < 0.3 ? ue : B[0] - R[0]; dn = q < 0.3 ? un : B[1] - R[1]; }
    else { e = B[0]; n = B[1]; agl = 0; status = 'Reloading'; load = u.capacity * ((f - 0.88) / 0.12); visible = Math.hypot(B[0], B[1]) < 4000; }
    const [lon, lat] = off(c, e, n);
    const speed = status === 'Reloading' ? 0 : k.spd * (status === 'Dropping' ? 0.75 : 1);
    return { ...base, lon, lat, agl, heading: hdg(de, dn), speedKt: speed, status, load: Math.round(load), visible };
  }
  // ground units move along the burn-cell ring (crews/dozer cut line as they go)
  const g: Record<string, { d0: number; v: number; st: string }> = { 'E-31': { d0: 120, v: 0.4, st: 'Structure protection' }, 'E-32': { d0: 1700, v: 0.3, st: 'Structure protection' }, 'E-45': { d0: 600, v: 2.6, st: 'Patrol' }, 'WT-12': { d0: 300, v: 1.2, st: 'Shuttle' }, 'C-7': { d0: 1000, v: 0.55, st: 'Cutting line' }, 'C-14': { d0: 2600, v: 0.45, st: 'Cutting line' }, 'DZ-4': { d0: 2100, v: 0.9, st: 'Widening line' } };
  const k = g[u.id]; const d = k.d0 + k.v * s; const r = alongRing(c, ctx.cell, d);
  const chains = u.kind === 'crew' || u.kind === 'dozer' ? (k.v * s) / 20.1168 : undefined;
  return { ...base, lon: r.p[0], lat: r.p[1], agl: 0, heading: r.h, speedKt: k.v * KT, status: k.st, load: u.capacity, lineChains: chains };
}

/** All drops whose release time is ≤ t (deterministic from the circuits). */
export function dropsUntil(t: number, ctx: SimCtx): Drop[] {
  if (ctx.regional) return regionalDrops(t, ctx, t - 6 * 3600000);
  const out: Drop[] = [];
  for (const u of SIM_UNITS) {
    const k = AIR[u.id]; if (!k) continue;
    const S = (t - ctx.t0) / 1000;
    for (let cyc = -1; cyc < 10; cyc++) {
      const ts = (cyc + 0.5 - k.ph) * k.P;            // mid-drop time of this cycle
      if (ts < 0 || ts > S) continue;
      const dir = Math.atan2(k.tgt[0] - k.base[0], k.tgt[1] - k.base[1]), ue = Math.sin(dir), un = Math.cos(dir), half = Math.max(25, k.run / 2);
      const line: [number, number][] = [off(ctx.center, k.tgt[0] - ue * half, k.tgt[1] - un * half), off(ctx.center, k.tgt[0] + ue * half, k.tgt[1] + un * half)];
      out.push({ unitId: u.id, t: ctx.t0 + ts * 1000, line, gal: u.capacity, kind: u.kind === 'helicopter' ? 'water' : 'retardant' });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Fire line cut by crews/dozer up to t, as lon/lat polylines along the cell perimeter. */
export function firelinesUntil(t: number, ctx: SimCtx): [number, number][][] {
  if (ctx.regional) return [];
  const s = Math.max(0, (t - ctx.t0) / 1000);
  return SIM_UNITS.filter((u) => u.kind === 'crew' || u.kind === 'dozer').map((u) => {
    const g: Record<string, [number, number]> = { 'C-7': [1000, 0.55], 'C-14': [2600, 0.45], 'DZ-4': [2100, 0.9] };
    const [d0, v] = g[u.id]; return ringSegment(ctx.center, ctx.cell, d0, d0 + v * s);
  });
}

export function opsTotals(t: number, ctx: SimCtx) {
  const drops = dropsUntil(t, ctx);
  const gal = ctx.regional ? regionalDrops(t, ctx, ctx.t0, true).reduce((a, d) => a + d.gal, 0) : drops.reduce((a, d) => a + d.gal, 0);
  const chains = SIM_UNITS.reduce((a, u) => a + (unitState(u, t, ctx).lineChains ?? 0), 0);
  const res = SIM_UNITS.filter((u) => u.group !== 'drones');
  const s = (t - ctx.t0) / 1000;
  const personnel = res.reduce((a, u) => a + u.personnel * (s > (u.group === 'crews' ? 60 : 0) ? 1 : 0), 0);
  const airUp = res.filter((u) => u.group === 'aircraft' && unitState(u, t, ctx).status !== 'Reloading').length;
  return { gal, chains, personnel, airUp, airTotal: res.filter((u) => u.group === 'aircraft').length, drops };
}

/* ============================================================================ regional exercise (a days-long fire) */
/* The same roster, re-tasked for a wildfire tens of km across: drones work where the reconstructed front is each hour,
 * aircraft fly in daylight only (no night aerial firefighting) from a water source and a helibase, ground units hold the
 * flanks. Still an exercise: positions follow the real front, nothing else here is an observation. */

/** Regional names and capacities (water in gal, like the rest of the app). */
export const REGIONAL_ROSTER: Record<string, Partial<SimUnit>> = {
  'FT-02': { mission: 'Orbit · active front', task: 'Circling the most active part of the front' },
  'FT-03': { mission: 'Watch · ahead of the front', task: 'Watching the ground the fire is heading into' },
  'FT-04': { mission: 'Patrol · outer ring', task: 'Patrolling a ring outside the fire for new ignitions' },
  'FT-05': { type: 'Fixed-wing VTOL', mission: 'Survey · burned ground', task: 'Mapping passes over what has burned (IR at night)' },
  'FT-06': { mission: 'Relay', task: 'Comms relay above the incident' },
  'T-910': { name: 'CL-415', type: 'Amphibious water scooper', mission: 'Water drops', task: 'Scooping at the reservoir, dropping on the head', capacity: 1620 },
  'T-131': { name: 'CL-415', type: 'Amphibious water scooper', mission: 'Water drops', task: 'Scooping at the reservoir, dropping on the flank', capacity: 1620 },
  'T-162': { name: 'AT-802F', type: 'Single-engine air tanker', mission: 'Retardant drops', task: 'Line ahead of the head', capacity: 820 },
  'H-743': { name: 'Ka-32', type: 'Heavy helitanker', mission: 'Water drops', task: 'Cooling the head of the fire', capacity: 1190 },
  'H-531': { name: 'Bell 412', type: 'Helicopter · bucket', mission: 'Water drops', task: 'Spot fires near the flanks', capacity: 320 },
  'AA-52': { name: 'Coordination aircraft', type: 'Air coordination', mission: 'Air coordination', task: 'Coordinating the aircraft over the front' },
  'E-31': { name: 'Forest engine', type: 'Forest engine', mission: 'Structure protection', task: 'Protecting houses on the left flank', capacity: 900 },
  'E-32': { name: 'Forest engine', type: 'Forest engine', mission: 'Structure protection', task: 'Protecting houses on the right flank', capacity: 900 },
  'E-45': { name: 'Heavy engine', type: 'Heavy engine', mission: 'Patrol', task: 'Patrolling behind the front', capacity: 2600 },
  'WT-12': { name: 'Water tender', type: 'Water tender', mission: 'Supply', task: 'Shuttling water to the engines', capacity: 4000 },
  'C-7': { name: 'Brigade 7 · helitransported', type: 'Helitransported brigade', mission: 'Holding · left flank', task: 'Cutting line on the left flank', personnel: 7 },
  'C-14': { name: 'Brigade 14 · ground', type: 'Ground brigade', mission: 'Holding · right flank', task: 'Cutting line on the right flank', personnel: 12 },
  'DZ-4': { name: 'Bulldozer', type: 'Bulldozer', mission: 'Holding · line', task: 'Opening a break ahead of the right flank' },
};
export const regionalUnit = (u: SimUnit): SimUnit => ({ ...u, ...REGIONAL_ROSTER[u.id] });
/** The roster as tasked for this incident (names, missions and capacities differ for a regional fire). */
export const unitsFor = (ctx: SimCtx | null | undefined): SimUnit[] => (ctx?.regional ? SIM_UNITS.map(regionalUnit) : SIM_UNITS);

const H = 3600000;
/** Aircraft fly 06:00–19:30 UTC (sunrise to sunset in Galicia in August). */
const daylight = (t: number) => { const h = (t % 86400000) / H; return h >= 6 && h < 19.5; };

/** The front at time t: the latest hourly front ≤ t, or — once the fire stops growing — the scar itself (mop-up). */
export function frontAt(ctx: SimCtx, t: number): { c: [number, number]; r: number; b: number; active: boolean } {
  const R = ctx.regional!, F = R.fronts;
  let lo = 0, hi = F.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (F[m].t <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  const f = k >= 0 ? F[k] : null;
  if (!f || t - f.t > 6 * H) return { c: R.scar, r: R.scarR * 0.55, b: f?.b ?? 0, active: false };
  return { c: f.c, r: f.r, b: f.b ?? 0, active: true };
}

// water source / helibase as offsets from the scar centre (m east, m north) — exercise geometry, not real bases
const BASES: Record<string, [number, number]> = { scoop: [-15000, -9000], heli: [11000, -13000], tanker: [-26000, -21000] };
const RAIR: Record<string, { base: keyof typeof BASES; P: number; ph: number; side: number; cruise: number; spd: number }> = {
  'T-910': { base: 'scoop', P: 1080, ph: 0.1, side: 0, cruise: 600, spd: 170 },
  'T-131': { base: 'scoop', P: 1080, ph: 0.6, side: 1, cruise: 600, spd: 170 },
  'T-162': { base: 'tanker', P: 2400, ph: 0.3, side: -1, cruise: 700, spd: 160 },
  'H-743': { base: 'heli', P: 900, ph: 0.45, side: 0.4, cruise: 300, spd: 110 },
  'H-531': { base: 'heli', P: 720, ph: 0.8, side: -0.6, cruise: 250, spd: 100 },
};

function regionalState(u0: SimUnit, t: number, ctx: SimCtx): UnitState {
  const u = regionalUnit(u0), R = ctx.regional!, s = (t - ctx.t0) / 1000, f = frontAt(ctx, t);
  const sc = R.scar, fe = toEN(sc, f.c), bR = f.b * D2R, ub = [Math.sin(bR), Math.cos(bR)], up = [Math.cos(bR), -Math.sin(bR)];   // spread / right-flank unit vectors
  const at = (e: number, n: number, agl: number, de: number, dn: number, spd: number, status: string, extra: Partial<UnitState> = {}): UnitState => {
    const [lon, lat] = off(sc, e, n);
    return { lon, lat, agl, heading: hdg(de, dn), speedKt: spd * KT, status, load: u.capacity, flightS: s, visible: true, ...extra };
  };
  if (u.kind === 'drone') {
    const swapS = { 'FT-02': 2700, 'FT-03': 2400, 'FT-04': 3000, 'FT-05': 5400, 'FT-06': 4800 }[u.id] ?? 3000;
    const bat = { battery: 100 - ((s % swapS) / swapS) * 82, link: -60 - Math.round(Math.abs(Math.sin(s / 337)) * 18), load: 0, flightS: s % swapS };
    const orbit = (cx: number, cy: number, r: number, P: number, agl: number, st: string, ph = 0) => {
      const a = 2 * Math.PI * (s / P + ph);
      return at(cx + r * Math.cos(a), cy + r * Math.sin(a), agl, -Math.sin(a), Math.cos(a), (2 * Math.PI * r) / P, st, bat);
    };
    if (u.id === 'FT-02') return orbit(fe[0], fe[1], Math.max(600, f.r * 0.8), 900, 120, f.active ? 'Orbit' : 'Mop-up watch');
    if (u.id === 'FT-03') return orbit(fe[0] + ub[0] * (f.r + 1500), fe[1] + ub[1] * (f.r + 1500), 500, 600, 120, f.active ? 'Watching ahead' : 'Patrol', 0.3);
    if (u.id === 'FT-04') return orbit(fe[0], fe[1], f.r + 2500, 3600, 120, 'Patrol', 0.6);
    if (u.id === 'FT-06') return orbit(fe[0], fe[1], 250, 480, 400, 'Relay', 0.2);
    // FT-05: lawn-mower lanes 800 m apart over the burned ground around the scar centre
    const lane = Math.floor(s / 320) % 10, kk = (s % 320) / 320, dir = lane % 2 ? -1 : 1, half = R.scarR * 0.8;
    return at(-half + (lane / 9) * 2 * half, (dir > 0 ? -half + kk * 2 * half : half - kk * 2 * half), 400, 0, dir, (2 * half) / 320, daylight(t) ? 'Mapping (EO)' : 'Mapping (IR)', bat);
  }
  if (u.kind === 'air_attack') {
    if (!daylight(t) || !f.active) return at(BASES.tanker[0], BASES.tanker[1], 0, 0, 1, 0, daylight(t) ? 'Standby' : 'Grounded · night', { visible: false });
    const a = (s / 600) * 2 * Math.PI, r = f.r + 3000;
    return at(fe[0] + r * Math.cos(a), fe[1] + r * Math.sin(a), 1500, -Math.sin(a), Math.cos(a), (2 * Math.PI * r) / 600, 'Coordinating', { load: 0 });
  }
  if (u.kind === 'air_tanker' || u.kind === 'helicopter') {
    const k = RAIR[u.id], B = BASES[k.base];
    if (!daylight(t) || !f.active) return at(B[0], B[1], 0, 0, 1, 0, daylight(t) ? 'Standby' : 'Grounded · night', { visible: false, load: k.base === 'scoop' ? 0 : u.capacity });
    const tgt: [number, number] = [fe[0] + ub[0] * f.r * 0.7 + up[0] * k.side * f.r * 0.6, fe[1] + ub[1] * f.r * 0.7 + up[1] * k.side * f.r * 0.6];
    const ph = (((s / k.P) + k.ph) % 1 + 1) % 1, dir = Math.atan2(tgt[0] - B[0], tgt[1] - B[1]), ue = Math.sin(dir), un = Math.cos(dir);
    const A0: [number, number] = [tgt[0] - ue * 1500, tgt[1] - un * 1500], A2: [number, number] = [tgt[0] + ue * 300, tgt[1] + un * 300];
    let e: number, n: number, agl: number, status: string, de = ue, dn = un, load = u.capacity;
    if (ph < 0.38) { const q = ease(ph / 0.38); e = lerp(B[0], A0[0], q); n = lerp(B[1], A0[1], q); agl = k.cruise; status = 'Inbound'; }
    else if (ph < 0.46) { const q = (ph - 0.38) / 0.08; e = lerp(A0[0], tgt[0], q); n = lerp(A0[1], tgt[1], q); agl = lerp(k.cruise, 60, q); status = 'On final'; }
    else if (ph < 0.5) { const q = (ph - 0.46) / 0.04; e = lerp(tgt[0], A2[0], q); n = lerp(tgt[1], A2[1], q); agl = 50; status = 'Dropping'; load = u.capacity * (1 - q); }
    else { const q = ease((ph - 0.5) / 0.5); e = lerp(A2[0], B[0], q); n = lerp(A2[1], B[1], q); agl = q > 0.9 ? lerp(k.cruise, 15, (q - 0.9) / 0.1) : k.cruise; status = k.base === 'scoop' && q > 0.9 ? 'Scooping' : 'Return to reload'; load = k.base === 'scoop' && q > 0.9 ? u.capacity * ((q - 0.9) / 0.1) : 0; de = B[0] - A2[0]; dn = B[1] - A2[1]; }
    return at(e, n, agl, de, dn, status === 'Scooping' ? k.spd * 0.4 : k.spd, status, { load: Math.round(load) });
  }
  // ground: brigades and engines hold the flanks, the tender shuttles, the dozer opens a break ahead of the right flank
  const side = { 'E-31': -1, 'E-32': 1, 'E-45': 0, 'WT-12': 0, 'C-7': -1, 'C-14': 1, 'DZ-4': 1 }[u.id] ?? 0;
  const back = { 'E-31': 0.2, 'E-32': 0.2, 'E-45': 1.1, 'WT-12': 1.6, 'C-7': -0.1, 'C-14': -0.1, 'DZ-4': -0.6 }[u.id] ?? 0;
  const wob = Math.sin(s / ({ 'E-45': 700, 'WT-12': 500 }[u.id] ?? 1900)) * (u.id === 'WT-12' ? 1800 : 400);
  const dist = f.r + (u.group === 'crews' ? 250 : 700);
  const e = fe[0] + up[0] * side * dist - ub[0] * back * f.r + ub[0] * wob * (side ? 1 : 0.3) + up[0] * (side ? 0 : wob);
  const n = fe[1] + up[1] * side * dist - ub[1] * back * f.r + ub[1] * wob * (side ? 1 : 0.3) + up[1] * (side ? 0 : wob);
  const working = daylight(t) || u.group === 'engines';
  // line cut so far: 10 chains an hour in daylight (analytic, so scrubbing is free)
  const days = Math.floor((t - ctx.t0) / 86400000), today = Math.max(0, Math.min(13.5, ((t % 86400000) / H) - 6));
  const chains = u.kind === 'crew' || u.kind === 'dozer' ? (days * 13.5 + today) * (u.kind === 'dozer' ? 18 : 10) : undefined;
  return at(e, n, 0, ub[0], ub[1], working ? 1.5 : 0, f.active ? (working ? u.mission.split(' · ')[0] : 'Resting · night') : 'Mop-up', { lineChains: chains });
}

/** Regional drops from `from` to t (all of them with `all`, for totals; the drawing only needs the last hours). */
function regionalDrops(t: number, ctx: SimCtx, from: number, all = false): Drop[] {
  const out: Drop[] = [];
  const R = ctx.regional!, sc = R.scar;
  for (const u0 of SIM_UNITS) {
    const k = RAIR[u0.id]; if (!k) continue;
    const u = regionalUnit(u0), P = k.P * 1000;
    const c0 = Math.floor((Math.max(from, ctx.t0) - ctx.t0) / P) - 1, c1 = Math.floor((t - ctx.t0) / P) + 1;
    for (let cyc = c0; cyc <= c1; cyc++) {
      const td = ctx.t0 + (cyc + 0.48 - k.ph) * P;
      if (td < Math.max(from, ctx.t0) || td > t || !daylight(td)) continue;
      const f = frontAt(ctx, td);
      if (!f.active) continue;
      if (all) { out.push({ unitId: u.id, t: td, line: [], gal: u.capacity, kind: u.kind === 'helicopter' || k.base === 'scoop' ? 'water' : 'retardant' }); continue; }
      const fe = toEN(sc, f.c), bR = f.b * D2R, ub = [Math.sin(bR), Math.cos(bR)], up = [Math.cos(bR), -Math.sin(bR)];
      const tg = [fe[0] + ub[0] * f.r * 0.7 + up[0] * k.side * f.r * 0.6, fe[1] + ub[1] * f.r * 0.7 + up[1] * k.side * f.r * 0.6];
      const B = BASES[k.base], dir = Math.atan2(tg[0] - B[0], tg[1] - B[1]), ue = Math.sin(dir), un = Math.cos(dir), half = u.kind === 'helicopter' ? 60 : 220;
      out.push({ unitId: u.id, t: td, line: [off(sc, tg[0] - ue * half, tg[1] - un * half), off(sc, tg[0] + ue * half, tg[1] + un * half)], gal: u.capacity, kind: u.kind === 'helicopter' || k.base === 'scoop' ? 'water' : 'retardant' });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
