// Generates DEVELOPMENT FIXTURES in public/fixtures/ that mirror docs/api-contract.md.
// Every value here is provenance:"fixture". The burn progression is SYNTHETIC: a geometric
// placeholder projected through the real BurnedAreaUAV camera pose so the UI has something
// spatially plausible to render until the backend serves model-derived polygons.
// Run: node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'public', 'fixtures');
mkdirSync(out, { recursive: true });
const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 1));

// ---------- real facts (BurnedAreaUAV v1.1, CC-BY-4.0) ----------
const POSE = { lat: 41.393844, lon: -7.614828, agl: 24.9, yaw: -46.7, pitch: -28.9, hfov: 55.3, vfov: 32.7 };
const KML_CELL = [[-7.613797,41.385399],[-7.611353,41.390271],[-7.611176,41.390912],[-7.611433,41.391484],[-7.611441,41.392316],[-7.611286,41.39401],[-7.611144,41.395791],[-7.610768,41.399315],[-7.61103,41.399174],[-7.611688,41.398818],[-7.612315,41.398395],[-7.612842,41.397807],[-7.613369,41.397286],[-7.613586,41.39671],[-7.613666,41.396207],[-7.613922,41.395528],[-7.614819,41.395261],[-7.615163,41.395272],[-7.616572,41.394613],[-7.617676,41.39347],[-7.617757,41.393313],[-7.617841,41.393208],[-7.617941,41.393125],[-7.618021,41.392993],[-7.618167,41.392822],[-7.618463,41.392483],[-7.618752,41.392225],[-7.618184,41.392432],[-7.617919,41.392477],[-7.617564,41.392313],[-7.617114,41.392106],[-7.616683,41.391884],[-7.616271,41.391639],[-7.616055,41.391388],[-7.615937,41.391107],[-7.615856,41.390812],[-7.615733,41.390534],[-7.615633,41.390379],[-7.615704,41.39019],[-7.615694,41.389647],[-7.615706,41.389395],[-7.615668,41.389144],[-7.615573,41.388708],[-7.615386,41.388661],[-7.615122,41.388469],[-7.61495,41.388246],[-7.614736,41.387954],[-7.614605,41.38755],[-7.614401,41.386829],[-7.614157,41.386004],[-7.614037,41.385545],[-7.613926,41.385351],[-7.613825,41.385351],[-7.613797,41.385399]];

const DURATION = 901.5, FPS = 25, STEP = 8;            // fixture cadence: one frame / 8 s
const START = Date.parse('2019-03-01T12:33:00Z');       // FIXTURE ASSUMPTION — backend supplies the real value
const iso = (s) => new Date(START + s * 1000).toISOString();

// ---------- local ENU <-> lon/lat ----------
const mLat = 111320, mLon = 111320 * Math.cos((POSE.lat * Math.PI) / 180);
const toLL = (e, n) => [+(POSE.lon + e / mLon).toFixed(7), +(POSE.lat + n / mLat).toFixed(7)];
const rad = (d) => (d * Math.PI) / 180;

// Ray from normalized image coords (u: -1 left..1 right, v: -1 top..1 bottom) to flat ground at -agl.
function imageToGround(u, v) {
  const psi = rad(POSE.yaw), th = rad(POSE.pitch);
  const f = [Math.sin(psi), Math.cos(psi)], r = [Math.cos(psi), -Math.sin(psi)];
  const F = [f[0] * Math.cos(th), f[1] * Math.cos(th), Math.sin(th)];
  const U = [-f[0] * Math.sin(th), -f[1] * Math.sin(th), Math.cos(th)];
  const tx = Math.tan(rad(POSE.hfov / 2)) * u, ty = Math.tan(rad(POSE.vfov / 2)) * v;
  const d = [F[0] + tx * r[0] - ty * U[0], F[1] + tx * r[1] - ty * U[1], F[2] - ty * U[2]];
  const t = -POSE.agl / d[2];
  return [t * d[0], t * d[1]];
}
const V_TOP = -0.72; // clip far rows (near horizon) to ~100 m
const footprintENU = [[-1, V_TOP], [1, V_TOP], [1, 1], [-1, 1]].map(([u, v]) => imageToGround(u, v));
const areaENU = (ring) => Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const poly = (ringENU) => ({ type: 'Polygon', coordinates: [[...ringENU, ringENU[0]].map(([e, n]) => toLL(e, n))] });

// Synthetic front: image row of the flame front as a function of time and column.
const front = (s, u) => V_TOP + 0.18 + 1.25 * Math.pow(s / DURATION, 0.85) + 0.10 * Math.sin(2.6 * u + s / 70) + 0.05 * Math.sin(7.1 * u - s / 33);
const N = 28, us = Array.from({ length: N + 1 }, (_, i) => -1 + (2 * i) / N);
const clampV = (v) => Math.min(1, Math.max(V_TOP, v));

const features = [], hotspots = [], frames = [];
let prevArea = null, prevRing = null;
for (let s = 0; s <= DURATION; s += STEP) {
  const frame = Math.round(s * FPS), ts = iso(s);
  const burnedImg = [...us.map((u) => [u, V_TOP]).reverse(), ...us.map((u) => [u, clampV(front(s, u))])];
  const burned = burnedImg.map(([u, v]) => imageToGround(u, v));
  const burnedArea = areaENU(burned);
  const base = { timestamp: ts, source_id: 'drone_replay_01', source_frame: frame, video_seconds: s, georeferencing_method: 'camera_model_dem', georeferencing_accuracy: 'approximate', provenance: 'fixture', model: 'FIXTURE — synthetic geometry' };
  features.push({ type: 'Feature', geometry: poly(burned), properties: { ...base, id: `burn_f${frame}`, classification: 'burned_area', area_m2: +burnedArea.toFixed(1) } });

  // active fire = thin band just ahead of the front, broken into segments
  const segs = []; let cur = [];
  us.forEach((u) => { const on = Math.sin(5.3 * u + s / 41) > -0.35 && front(s, u) < 1.02; if (on) cur.push(u); else if (cur.length) { segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  const activeCoords = []; let activeArea = 0;
  segs.filter((g) => g.length > 1).forEach((g, gi) => {
    const top = g.map((u) => imageToGround(u, clampV(front(s, u) - 0.035)));
    const bot = g.map((u) => imageToGround(u, clampV(front(s, u) + 0.025))).reverse();
    const ring = [...top, ...bot]; activeArea += areaENU(ring);
    activeCoords.push([[...ring, ring[0]].map(([e, n]) => toLL(e, n))]);
    const mid = g[Math.floor(g.length / 2)], p = imageToGround(mid, clampV(front(s, mid)));
    hotspots.push({ type: 'Feature', geometry: { type: 'Point', coordinates: toLL(p[0], p[1]) }, properties: { id: `hs_f${frame}_${gi}`, timestamp: ts, source_id: 'drone_replay_01', video_seconds: s, kind: 'rgb_flame', temperature_c: null, provenance: 'fixture', event_id: null } });
  });
  if (activeCoords.length) features.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: activeCoords }, properties: { ...base, id: `fire_f${frame}`, classification: 'visible_active_fire', area_m2: +activeArea.toFixed(1) } });

  if (prevRing) {
    const changeImg = [...us.map((u) => [u, clampV(front(s - STEP, u))]).reverse(), ...us.map((u) => [u, clampV(front(s, u))])];
    features.push({ type: 'Feature', geometry: poly(changeImg.map(([u, v]) => imageToGround(u, v))), properties: { ...base, id: `chg_f${frame}`, classification: 'area_change', area_m2: +(burnedArea - prevArea).toFixed(1) } });
  }
  const m = (value, unit) => ({ value: value == null ? null : +value.toFixed(1), unit, provenance: 'fixture', method: 'synthetic placeholder' });
  frames.push({ timestamp: ts, source_id: 'drone_replay_01', video_seconds: s, source_frame: frame, burned_area_m2: m(burnedArea, 'm2'), active_fire_area_m2: m(activeArea, 'm2'), area_change_m2: m(prevArea == null ? null : burnedArea - prevArea, 'm2'), hotspot_count: { value: segs.filter((g) => g.length > 1).length, unit: 'count', provenance: 'fixture' }, has_ground_truth: frame % 100 === 0 });
  prevArea = burnedArea; prevRing = burned;
}

const ev = (id, s0, s1, type, severity, title, description, evidence, u, v) => {
  const p = imageToGround(u, v);
  return { event_id: id, source_id: 'drone_replay_01', start_seconds: s0, end_seconds: s1, timestamp: iso(s0), event_type: type, title, description, visual_evidence: evidence, confidence: null, review_required: true, severity, processing_model: 'FIXTURE — replace with Cosmos Reason output', location: toLL(p[0], p[1]), image_region: [Math.max(0, (u + 1) / 2 - 0.15), Math.max(0, (v + 1) / 2 - 0.12), Math.min(1, (u + 1) / 2 + 0.15), Math.min(1, (v + 1) / 2 + 0.12)], thumbnail_url: null, provenance: 'fixture' };
};
const events = [
  ev('evt_001', 0, 12, 'first_visible_flames', 'watch', 'Flames visible at upper-left', 'FIXTURE TEXT. Active flames and a dense grey plume are visible in the upper-left of the frame; burned ground already covers much of the far field.', ['flame cluster upper-left', 'dense smoke column'], -0.6, -0.35),
  ev('evt_002', 120, 140, 'visible_fire_expansion', 'watch', 'Front widens across view', 'FIXTURE TEXT. The flame front extends laterally into a continuous line across the centre of the frame.', ['continuous flame line', 'smoke drifting right'], 0.0, -0.1),
  ev('evt_003', 290, 310, 'intensity_change', 'alert', 'Flare-up on right flank', 'FIXTURE TEXT. Taller flames appear on the right side of the front with increased smoke output.', ['taller flame lengths', 'thicker smoke'], 0.7, -0.2),
  ev('evt_004', 470, 490, 'smoke_increase', 'info', 'Smoke obscures centre', 'FIXTURE TEXT. Smoke partially obscures the centre of the scene; segmentation in this window should be reviewed.', ['grey plume over centre'], 0.1, 0.05),
  ev('evt_005', 610, 625, 'new_fire_activity', 'alert', 'Spot ignition ahead of front', 'FIXTURE TEXT. A separate flame appears in the lower-centre vegetation, ahead of the main front.', ['isolated flame near camera'], 0.0, 0.45),
  ev('evt_006', 760, 790, 'burned_ground_visible', 'info', 'Burned ground dominates view', 'FIXTURE TEXT. Most of the visible area is blackened; residual flames remain at the right edge.', ['blackened ground', 'residual flames right'], 0.6, 0.3),
];

write('health.json', { ok: true, version: 'fixture', integrations: [
  { id: 'nvidia_cosmos_reason', name: 'Cosmos Reason', sponsor: 'NVIDIA', status: 'not_configured', model: null, endpoint: null, detail: 'Frontend running on development fixtures' },
  { id: 'nvidia_cosmos_embed', name: 'Cosmos Embed', sponsor: 'NVIDIA', status: 'not_configured', model: null, endpoint: null },
  { id: 'nvidia_vss', name: 'Video Search & Summarization', sponsor: 'NVIDIA', status: 'not_configured' },
  { id: 'vast', name: 'VAST Data Platform', sponsor: 'VAST Data', status: 'not_configured' },
  { id: 'coreweave', name: 'CoreWeave / W&B Inference', sponsor: 'CoreWeave', status: 'not_configured' },
] });

write('incident.json', {
  id: 'pinhao-2019-03-01', name: 'Pinhão Cell Burn', kind: 'prescribed_burn', location: 'Torre do Pinhão, Vila Real, PT',
  center: [POSE.lon, POSE.lat], bbox: [-7.6315, 41.3805, -7.5985, 41.4035],
  start: iso(0), end: iso(DURATION), status: 'analyzed',
  reference_perimeter: { type: 'Feature', properties: { name: 'Planned burn cell (KML)' }, geometry: { type: 'Polygon', coordinates: [KML_CELL] } },
  landmarks: [{ name: 'Area under study', position: [-7.615504, 41.394572], kind: 'place' }],
  attribution: ['BurnedAreaUAV v1.1 — Ribeiro et al. 2023, CC-BY-4.0', 'Elevation: AWS Terrain Tiles (Terrarium)', 'Imagery: Esri World Imagery'],
});

write('sources.json', [{
  id: 'drone_replay_01', label: 'UAV-01', mode: 'drone_replay',
  media_url: '/media/drone_replay_01.mp4', thumbnail_url: '/media/drone_replay_01_thumb.jpg',
  duration_seconds: DURATION, fps: FPS, width: 1280, height: 720, recorded_start: iso(0),
  pose: { position: [POSE.lon, POSE.lat], altitude_agl_m: POSE.agl, altitude_msl_m: null, yaw_deg: POSE.yaw, pitch_deg: POSE.pitch, roll_deg: 0, hfov_deg: POSE.hfov },
  footprint: { type: 'Feature', properties: {}, geometry: poly(footprintENU) },
  georeferencing: { method: 'camera_model_dem', accuracy: 'approximate', rmse_m: null, crs: 'EPSG:4326', notes: 'Fixture: flat-ground pinhole projection from XMP pose' },
  processing: { state: 'done', progress: 1, clips_total: 75, clips_done: 75, message: 'fixture' },
}]);

write('timeline.json', { incident_id: 'pinhao-2019-03-01', start: iso(0), end: iso(DURATION), frames, events });
write('observations.json', { type: 'FeatureCollection', features, hotspots });
write('events.json', { source_id: 'drone_replay_01', events });
write('search.json', { query: '(fixture)', model: 'FIXTURE', latency_ms: null, results: events.slice(0, 4).map((e, i) => ({ clip_id: `clip_${i}`, source_id: e.source_id, start_seconds: e.start_seconds, end_seconds: e.end_seconds, timestamp: e.timestamp, similarity: +(0.34 - i * 0.03).toFixed(2), caption: e.description, thumbnail_url: null, event_id: e.event_id })) });
write('ask.json', { answer: 'FIXTURE ANSWER — connect the backend for grounded Cosmos Reason answers. Flames first appear upper-left [1]; the front then widens across the view [2] and flares on the right flank [3].', citations: events.slice(0, 3).map((e) => ({ source_id: e.source_id, start_seconds: e.start_seconds, end_seconds: e.end_seconds, timestamp: e.timestamp, event_id: e.event_id, label: null })), model: 'FIXTURE', grounded: false, latency_ms: null });

console.log(`fixtures: ${frames.length} frames, ${features.length} features, ${hotspots.length} hotspots, ${events.length} events`);
console.log('footprint (m):', footprintENU.map((p) => p.map((x) => x.toFixed(0)).join(',')).join(' | '));
