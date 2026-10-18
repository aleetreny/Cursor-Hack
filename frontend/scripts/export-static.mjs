// Export each processed incident as a static "incident package" for the backend-free build.
// Runs before `vite` / `vite build` (see package.json). Output (gitignored):
//   public/incidents/index.json                 list of incidents + the default one
//   public/incidents/<id>/manifest.json         what is in the package, how it was made, attribution
//   public/incidents/<id>/*.json, media/        incident, sources, timeline, events, observations, weather, clips, eval, video, thumbnails
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontAdvance } from './lib/front-advance.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'frontend', 'public');
const OUT = join(PUBLIC, 'incidents');

/** Processed incidents in this repo:
 *  · drone (site scale): data/processed/<source>/ + media/<source>.mp4 + media/<source>/clip_*.jpg
 *  · regional: data/processed/<source>/, already in package form (pipeline/larouco/package.py) */
const INCIDENTS = [{ source: 'larouco', regional: true, default: true }, { source: 'drone_replay_01' }];
const REGIONAL_FILES = ['incident.json', 'sources.json', 'timeline.json', 'events.json', 'observations.json', 'weather.json', 'clips.json', 'eval.json', 'arrival.png', 'scenario.png'];

// Update files in place instead of wiping the folder: the repo may live in an iCloud-synced folder, where deleting and
// recreating a directory makes iCloud keep "name 2" conflict copies.
rmSync(join(PUBLIC, 'data'), { recursive: true, force: true });   // pre-package layout (phase 0)
mkdirSync(OUT, { recursive: true });
const writeIfChanged = (path, text) => { if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text); };
const copyIfChanged = (from, to) => { if (!existsSync(to) || statSync(to).size !== statSync(from).size || statSync(to).mtimeMs < statSync(from).mtimeMs) copyFileSync(from, to); };
const index = { format_version: 1, default: null, incidents: [] };

function exportRegional(source, isDefault) {
  const SRC = join(ROOT, 'data', 'processed', source);
  if (!existsSync(join(SRC, 'incident.json'))) { console.warn(`export-static: data/processed/${source}/ missing — run python -m pipeline.larouco.package`); return; }
  const read = (f) => JSON.parse(readFileSync(join(SRC, f), 'utf8'));
  const incident = read('incident.json');
  const dir = join(OUT, incident.id), rel = `incidents/${incident.id}/`;
  mkdirSync(dir, { recursive: true });
  for (const f of REGIONAL_FILES) if (existsSync(join(SRC, f))) copyIfChanged(join(SRC, f), join(dir, f));
  // packaged terrain + imagery (pipeline/larouco/basemap.py)
  if (existsSync(join(SRC, 'basemap'))) {
    mkdirSync(join(dir, 'basemap'), { recursive: true });
    for (const f of readdirSync(join(SRC, 'basemap'))) copyIfChanged(join(SRC, 'basemap', f), join(dir, 'basemap', f));
  }
  const tl = read('timeline.json'), ev = read('eval.json'), obs = read('observations.json'), w = read('weather.json'), p = incident.progression;
  const iou = ev.perimeters.map((r) => `${r.image_time.slice(5, 10)} ${r.iou_leave_one_out.toFixed(2)}`).join(', ');
  const sev = ev.severity.classes.find((c) => c.id === 5);
  const manifest = {
    format_version: 1, id: incident.id, name: incident.name, location: incident.location, kind: incident.kind,
    start: incident.start, end: incident.end, center: incident.center, packaged: new Date().toISOString(),
    files: Object.fromEntries(REGIONAL_FILES.map((f) => [f.replace(/\..*$/, ''), f])),
    counts: { frames: tl.frames.length, events: tl.events.length, clips: 0, features: obs.features.length, detections: obs.hotspots.length },
    methods: [
      { id: 'scar', name: 'Burnt area', provenance: 'external', detail: `Copernicus EMS EMSR837 delineations (Sentinel-2, SPOT 6/7, WorldView-2, Legion): ${incident.summary.burned_ha.toLocaleString('en-US')} ha by 30 Aug 2025` },
      { id: 'detections', name: 'Satellite fire detections', provenance: 'external', detail: `${obs.hotspots.length.toLocaleString('en-US')} NASA FIRMS detections inside the scar (VIIRS S-NPP 375 m, MODIS 1 km) on ${ev.satellite_passes} passes over the region` },
      { id: 'progression', name: 'When each place burned', provenance: 'derived', detail: `First satellite detection of each 30 m cell, gaps interpolated, bounded by the dated EMS perimeters. Each perimeter held out in turn: IoU ${iou}` },
      { id: 'expansion', name: 'Expansion rate', provenance: 'derived', detail: 'Growth of the equivalent radius √(area/π) over 6 h: the speed of the scar as a whole, lower than the head-fire speed. Satellite passes are hours apart, so no front line is drawn.' },
      { id: 'severity', name: 'Burn severity', provenance: 'derived', detail: `Sentinel-2 dNBR, 1 Aug vs 5 Sep 2025, Key & Benson classes: ${Math.round(sev.share * 100)}% high severity` },
      { id: 'events', name: 'Events', provenance: 'derived', detail: `${tl.events.length} events computed from the reconstruction, the perimeters, FIRMS and ERA5; all need human review` },
      { id: 'weather', name: 'Weather', provenance: 'external', detail: `${w.source} (${w.grid}); reanalysis, not an on-site sensor` },
      ...(incident.scenario ? [{ id: 'scenario', name: 'Spread scenario (hindcast)', provenance: 'model', detail: `Fuels (ESA WorldCover), terrain (MDT25) and the hourly ERA5 weather alone, calibrated only on the 16 Aug perimeter, then run freely: IoU ${incident.scenario.perimeters.map((r) => r.iou.toFixed(2)).join(' / ')} against the later perimeters. No suppression or spotting: it spreads too evenly and misses the run north` }] : []),
      ...(incident.basemap ? [{ id: 'basemap', name: 'Terrain and imagery', provenance: 'external', detail: 'Packaged with the incident (no tile server): IGN/CNIG MDT25 and PNOA orthophoto (CC BY 4.0), AWS Terrain Tiles and Sentinel-2 cloudless 2016 by EOX for the horizon' }] : []),
      { id: 'video', name: 'Video', provenance: 'real', detail: 'No footage of this fire is published here: real drone or aircraft video needs the owners\' permission.' },
      { id: 'analyst', name: 'Questions & search', provenance: 'derived', detail: 'Computed in the browser from the reconstruction and the events. No language model, nothing generated.' },
    ],
    attribution: incident.attribution,
    progression: { image: p.image, width: p.width, height: p.height },
  };
  writeIfChanged(join(dir, 'manifest.json'), JSON.stringify(manifest));
  index.incidents.push({ id: incident.id, name: incident.name, location: incident.location, kind: incident.kind, scale: 'regional', start: incident.start, end: incident.end, center: incident.center, path: rel });
  if (isDefault) index.default = incident.id;
  console.log(`export-static: ${incident.id} — ${tl.events.length} events, ${tl.frames.length} frames → public/${rel}`);
}

for (const { source, default: isDefault, regional } of INCIDENTS) {
  if (regional) { exportRegional(source, isDefault); continue; }
  const SRC = join(ROOT, 'data', 'processed', source);
  const read = (f) => JSON.parse(readFileSync(join(SRC, f), 'utf8'));
  const incident = read('incident.json');
  const dir = join(OUT, incident.id), rel = `incidents/${incident.id}/`;
  mkdirSync(join(dir, 'media'), { recursive: true });
  const write = (f, v) => writeIfChanged(join(dir, f), JSON.stringify(v));
  // media URLs are relative to the page, so the build works under any base path (e.g. GitHub Pages /<repo>/)
  const media = (u) => (typeof u === 'string' && u.startsWith('/media/') ? `${rel}media/${u.slice('/media/'.length)}` : u);

  const events = read('events_cv.json');
  const observations = read('observations.json');
  // rate of spread of the visible front (m/min), derived from the georeferenced outlines
  const ros = frontAdvance(observations.features);
  const tl = read('timeline.json');
  const timeline = { ...tl, events: events.events, frames: tl.frames.map((f) => ({ ...f,
    front_advance_m_min: { value: ros.get(f.timestamp)?.value ?? null, unit: 'm/min', provenance: 'derived', method: 'P90 distance of the new burned outline from the outline 60 s earlier, median of 3 frames' },
    front_bearing_deg: { value: ros.get(f.timestamp)?.bearing ?? null, unit: 'deg', provenance: 'derived', method: 'direction the leading quarter of the burned outline moved over 60 s (true north, clockwise)' } })) };
  const ev = read('eval.json');
  const sources = read('sources.json').map((s) => ({ ...s, media_url: media(s.media_url), thumbnail_url: media(s.thumbnail_url) }));
  write('incident.json', incident);
  write('sources.json', sources);
  write('timeline.json', timeline);
  write('events.json', events);
  // coordinates to 6 decimals (~0.1 m, far below the georeferencing error) — a third less to download
  write('observations.json', JSON.parse(JSON.stringify(observations, (k, v) => (typeof v === 'number' && !Number.isInteger(v) && (k === '' || /^\d+$/.test(k)) ? Math.round(v * 1e6) / 1e6 : v))));
  write('weather.json', read('weather.json'));
  write('clips.json', read('clips.json').map((c) => ({ ...c, thumbnail_url: media(c.thumbnail_url) })));
  write('eval.json', { model: ev.model, frames_evaluated: ev.frames_evaluated, mean: ev.mean, notes: ev.notes });

  const video = join(ROOT, 'media', `${source}.mp4`);
  if (existsSync(video)) copyIfChanged(video, join(dir, 'media', `${source}.mp4`));
  else console.warn(`export-static: media/${source}.mp4 missing — the drone feed will show "Video unavailable"`);
  if (existsSync(join(ROOT, 'media', source))) {
    mkdirSync(join(dir, 'media', source), { recursive: true });
    for (const f of readdirSync(join(ROOT, 'media', source))) copyIfChanged(join(ROOT, 'media', source, f), join(dir, 'media', source, f));
  }

  const src = sources[0], w = read('weather.json');
  const manifest = {
    format_version: 1, id: incident.id, name: incident.name, location: incident.location, kind: incident.kind,
    start: incident.start, end: incident.end, center: incident.center,
    packaged: new Date().toISOString(),
    files: { incident: 'incident.json', sources: 'sources.json', timeline: 'timeline.json', events: 'events.json', observations: 'observations.json', weather: 'weather.json', clips: 'clips.json', eval: 'eval.json' },
    counts: { frames: timeline.frames.length, events: events.events.length, clips: read('clips.json').length, features: observations.features.length },
    // how each part of the picture was produced — rendered as "How this works" in the app
    methods: [
      { id: 'footage', name: 'Drone footage', provenance: 'real', detail: `${src.label}, ${Math.round(src.duration_seconds / 60)} min RGB replay (${src.width}×${src.height} source), shown as DRONE REPLAY` },
      { id: 'pose', name: 'Camera pose', provenance: 'real', detail: `DJI XMP metadata of the dataset photos: ${src.pose.altitude_agl_m} m AGL, gimbal ${src.pose.pitch_deg}°, HFOV ${src.pose.hfov_deg}°` },
      { id: 'segmentation', name: 'Burned area, flames, smoke', provenance: 'model', detail: `${ev.model} on one frame every 4 s; mean IoU ${ev.mean.iou.toFixed(2)} (image) / ${ev.mean.ground_iou.toFixed(2)} (ground) vs ${ev.frames_evaluated} hand-drawn masks` },
      { id: 'ros', name: 'Rate of spread', provenance: 'derived', detail: 'Leading edge of the burned outline vs one minute earlier (90th percentile of the displacement, m/min). Only the visible front.' },
      { id: 'georef', name: 'Georeferencing', provenance: 'derived', detail: `${src.georeferencing.method.replace(/_/g, ' ')} (${src.georeferencing.accuracy}): pinhole camera, rays marched onto the DEM` },
      { id: 'events', name: 'Events', provenance: 'derived', detail: `${events.events.length} events from measured changes (growth, flames outside the scar, smoke, peak flame extent); all need human review` },
      { id: 'weather', name: 'Weather', provenance: 'external', detail: `${w.source} (${w.grid}); reanalysis, not an on-site sensor` },
      { id: 'analyst', name: 'Questions & search', provenance: 'derived', detail: 'Computed in the browser from the recorded measurements and events. No language model, nothing generated.' },
      { id: 'sim', name: 'Drones FT-02…06, resources, large-fire scenario', provenance: 'simulated', detail: 'Deterministic exercise around the real incident, tagged SIM. Not observations, not a forecast.' },
    ],
    attribution: incident.attribution,
  };
  write('manifest.json', manifest);
  index.incidents.push({ id: incident.id, name: incident.name, location: incident.location, kind: incident.kind, scale: 'site', start: incident.start, end: incident.end, center: incident.center, path: rel });
  if (isDefault) index.default = incident.id;
  console.log(`export-static: ${incident.id} — ${events.events.length} events, ${timeline.frames.length} frames → public/${rel}`);
}
writeIfChanged(join(OUT, 'index.json'), JSON.stringify(index));
// drop packages of incidents that are no longer exported
for (const d of readdirSync(OUT)) if (d !== 'index.json' && !index.incidents.some((i) => i.id === d)) rmSync(join(OUT, d), { recursive: true, force: true });
