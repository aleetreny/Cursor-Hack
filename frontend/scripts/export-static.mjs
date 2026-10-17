// Export each processed incident as a static "incident package" for the backend-free build.
// Runs before `vite` / `vite build` (see package.json). Output (gitignored):
//   public/incidents/index.json                 list of incidents + the default one
//   public/incidents/<id>/manifest.json         what is in the package, how it was made, attribution
//   public/incidents/<id>/*.json, media/        incident, sources, timeline, events, observations, weather, clips, eval, video, thumbnails
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'frontend', 'public');
const OUT = join(PUBLIC, 'incidents');

/** Processed incidents in this repo: data/processed/<source>/ + media/<source>.mp4 + media/<source>/clip_*.jpg */
const INCIDENTS = [{ source: 'drone_replay_01', default: true }];

// Update files in place instead of wiping the folder: the repo may live in an iCloud-synced folder, where deleting and
// recreating a directory makes iCloud keep "name 2" conflict copies.
rmSync(join(PUBLIC, 'data'), { recursive: true, force: true });   // pre-package layout (phase 0)
mkdirSync(OUT, { recursive: true });
const writeIfChanged = (path, text) => { if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text); };
const copyIfChanged = (from, to) => { if (!existsSync(to) || statSync(to).size !== statSync(from).size || statSync(to).mtimeMs < statSync(from).mtimeMs) copyFileSync(from, to); };
const index = { format_version: 1, default: null, incidents: [] };

for (const { source, default: isDefault } of INCIDENTS) {
  const SRC = join(ROOT, 'data', 'processed', source);
  const read = (f) => JSON.parse(readFileSync(join(SRC, f), 'utf8'));
  const incident = read('incident.json');
  const dir = join(OUT, incident.id), rel = `incidents/${incident.id}/`;
  mkdirSync(join(dir, 'media'), { recursive: true });
  const write = (f, v) => writeIfChanged(join(dir, f), JSON.stringify(v));
  // media URLs are relative to the page, so the build works under any base path (e.g. GitHub Pages /<repo>/)
  const media = (u) => (typeof u === 'string' && u.startsWith('/media/') ? `${rel}media/${u.slice('/media/'.length)}` : u);

  const events = read('events_cv.json');
  const timeline = { ...read('timeline.json'), events: events.events };
  const ev = read('eval.json');
  const sources = read('sources.json').map((s) => ({ ...s, media_url: media(s.media_url), thumbnail_url: media(s.thumbnail_url) }));
  write('incident.json', incident);
  write('sources.json', sources);
  write('timeline.json', timeline);
  write('events.json', events);
  write('observations.json', read('observations.json'));
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
    counts: { frames: timeline.frames.length, events: events.events.length, clips: read('clips.json').length, features: read('observations.json').features.length },
    // how each part of the picture was produced — rendered as "How this works" in the app
    methods: [
      { id: 'footage', name: 'Drone footage', provenance: 'real', detail: `${src.label}, ${Math.round(src.duration_seconds / 60)} min RGB replay (${src.width}×${src.height} source), shown as DRONE REPLAY` },
      { id: 'pose', name: 'Camera pose', provenance: 'real', detail: `DJI XMP metadata of the dataset photos: ${src.pose.altitude_agl_m} m AGL, gimbal ${src.pose.pitch_deg}°, HFOV ${src.pose.hfov_deg}°` },
      { id: 'segmentation', name: 'Burned area, flames, smoke', provenance: 'model', detail: `${ev.model} on one frame every 4 s; mean IoU ${ev.mean.iou.toFixed(2)} (image) / ${ev.mean.ground_iou.toFixed(2)} (ground) vs ${ev.frames_evaluated} hand-drawn masks` },
      { id: 'georef', name: 'Georeferencing', provenance: 'derived', detail: `${src.georeferencing.method.replace(/_/g, ' ')} (${src.georeferencing.accuracy}): pinhole camera, rays marched onto the DEM` },
      { id: 'events', name: 'Events', provenance: 'derived', detail: `${events.events.length} events from measured changes (growth, flames outside the scar, smoke, peak flame extent); all need human review` },
      { id: 'weather', name: 'Weather', provenance: 'external', detail: `${w.source} (${w.grid}); reanalysis, not an on-site sensor` },
      { id: 'analyst', name: 'Questions & search', provenance: 'derived', detail: 'Computed in the browser from the recorded measurements and events (English or Spanish). No language model, nothing generated.' },
      { id: 'sim', name: 'Drones FT-02…06, resources, large-fire scenario', provenance: 'simulated', detail: 'Deterministic exercise around the real incident, tagged SIM. Not observations, not a forecast.' },
    ],
    attribution: incident.attribution,
  };
  write('manifest.json', manifest);
  index.incidents.push({ id: incident.id, name: incident.name, location: incident.location, kind: incident.kind, start: incident.start, end: incident.end, center: incident.center, path: rel });
  if (isDefault) index.default = incident.id;
  console.log(`export-static: ${incident.id} — ${events.events.length} events, ${timeline.frames.length} frames → public/${rel}`);
}
writeIfChanged(join(OUT, 'index.json'), JSON.stringify(index));
// drop packages of incidents that are no longer exported
for (const d of readdirSync(OUT)) if (d !== 'index.json' && !index.incidents.some((i) => i.id === d)) rmSync(join(OUT, d), { recursive: true, force: true });
