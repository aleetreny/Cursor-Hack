// Export the processed incident (data/processed + media/) as static files for the backend-free build.
// Runs before `vite` / `vite build` (see package.json). Output: public/data/ (gitignored).
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'data', 'processed', 'drone_replay_01');
const MEDIA = join(ROOT, 'media');
const OUT = join(ROOT, 'frontend', 'public', 'data');
const read = (f) => JSON.parse(readFileSync(join(SRC, f), 'utf8'));
const write = (f, v) => writeFileSync(join(OUT, f), JSON.stringify(v));
// media URLs are relative to the page so the build works under any base path (e.g. GitHub Pages /<repo>/)
const media = (u) => (typeof u === 'string' && u.startsWith('/media/') ? `data${u}` : u);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'media'), { recursive: true });

const events = read('events_cv.json');
const timeline = { ...read('timeline.json'), events: events.events };
const evaluation = read('eval.json');
write('incident.json', read('incident.json'));
write('sources.json', read('sources.json').map((s) => ({ ...s, media_url: media(s.media_url), thumbnail_url: media(s.thumbnail_url) })));
write('timeline.json', timeline);
write('events.json', events);
write('observations.json', read('observations.json'));
write('weather.json', read('weather.json'));
write('clips.json', read('clips.json').map((c) => ({ ...c, thumbnail_url: media(c.thumbnail_url) })));
write('eval.json', { model: evaluation.model, frames_evaluated: evaluation.frames_evaluated, mean: evaluation.mean, notes: evaluation.notes });
write('health.json', {
  ok: true, version: 'static', integrations: [
    { id: 'cv_pipeline', name: 'FireScope CV + georeferencing', sponsor: 'FireScope', status: 'ok', model: 'HSV segmentation + DEM ray cast', endpoint: 'precomputed',
      detail: `mean IoU ${evaluation.mean.iou} vs BurnedAreaUAV masks (${evaluation.frames_evaluated} frames)` },
    ...[['nvidia_cosmos_reason', 'Cosmos Reason', 'NVIDIA'], ['nvidia_cosmos_embed', 'Cosmos Embed1 (video search)', 'NVIDIA'], ['vast_vss', 'VAST / VSS retrieval', 'VAST Data']]
      .map(([id, name, sponsor]) => ({ id, name, sponsor, status: 'not_configured', model: null, endpoint: null, detail: 'Used live during the hackathon; not part of the static demo' })),
  ],
});

// the replay video and the per-clip thumbnails
const video = join(MEDIA, 'drone_replay_01.mp4');
if (existsSync(video)) copyFileSync(video, join(OUT, 'media', 'drone_replay_01.mp4'));
else console.warn('export-static: media/drone_replay_01.mp4 missing — the drone feed will show "Video unavailable"');
if (existsSync(join(MEDIA, 'drone_replay_01'))) cpSync(join(MEDIA, 'drone_replay_01'), join(OUT, 'media', 'drone_replay_01'), { recursive: true });
console.log(`export-static: ${events.events.length} events, ${timeline.frames.length} frames → public/data/`);
