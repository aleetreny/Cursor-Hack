// Visual search index: MobileCLIP-S0 image embeddings of what each incident's cameras saw, computed once, offline.
//
//   node scripts/ai/embed.mjs            (after python -m pipeline.pinhao.frames and python -m pipeline.larouco.s2series)
//
// The browser only runs the text half of the same model (see src/agent/visual.ts), so a query and these vectors live in
// the same space. Same library (transformers.js) and the same pinned model revision on both sides.
//   Pinhão   one frame every 2 s of the drone video: the whole frame + left / middle / right squares (small things at
//            the edges are lost in a single centre crop)
//   Larouco  every Sentinel-2 pass during the fire, cut into 2.7 km squares and half-overlapping 5.4 km squares
// Output per incident, in data/processed/<source>/: visual_index.bin (int8, L2-normalised × 127) + visual_index.json.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL = 'Xenova/mobileclip_s0';
export const REVISION = '757d59c9c6870a76a4b0306f05f5061bca15c39f';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIM = 512;

const processor = await AutoProcessor.from_pretrained(MODEL, { revision: REVISION });
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { revision: REVISION, dtype: 'fp32' });

async function embed(images) {
  const out = [];
  for (let i = 0; i < images.length; i += 16) {
    const { image_embeds } = await vision(await processor(images.slice(i, i + 16)));
    out.push(...image_embeds.normalize().tolist());
  }
  return out;
}
function write(dir, meta, vecs) {
  const buf = new Int8Array(vecs.length * DIM);
  vecs.forEach((v, k) => v.forEach((x, j) => { buf[k * DIM + j] = Math.max(-127, Math.min(127, Math.round(x * 127))); }));
  fs.writeFileSync(path.join(dir, 'visual_index.bin'), Buffer.from(buf.buffer));
  fs.writeFileSync(path.join(dir, 'visual_index.json'), JSON.stringify({ model: MODEL, revision: REVISION, dim: DIM, scale: 127, count: vecs.length, ...meta }));
  console.log(`${dir}: ${vecs.length} vectors, ${(buf.length / 1e6).toFixed(2)} MB`);
}

// ---- Pinhão: drone video
{
  const cache = path.join(ROOT, 'data/cache/pinhao');
  const meta = JSON.parse(fs.readFileSync(path.join(cache, 'frames.json')));
  const vecs = [], items = [];
  for (let k = 0; k < meta.times.length; k++) {
    const im = await RawImage.read(path.join(cache, 'frames', `f_${String(k).padStart(4, '0')}.jpg`));   // 640×360
    const crops = [await im.resize(256, 256)];                                                          // whole frame, squashed
    for (const x of [0, 140, 280]) crops.push(await im.crop([x, 0, x + 359, 359]));                     // three squares
    vecs.push(...await embed(crops));
    for (let c = 0; c < 4; c++) items.push([k, c]);
  }
  write(path.join(ROOT, 'data/processed/drone_replay_01'), {
    kind: 'video', every_s: meta.every_s, times: meta.times, sprite: { url: 'visual_sprite.jpg', ...meta.sprite },
    // crop boxes as fractions of the frame: [x0, y0, x1, y1]
    crops: [[0, 0, 1, 1], [0, 0, 0.5625, 1], [0.21875, 0, 0.78125, 1], [0.4375, 0, 1, 1]], items,
  }, vecs);
}

// ---- Larouco: Sentinel-2 passes
{
  const s2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cache/larouco/s2series.json')));
  const dir = path.join(ROOT, 'data/processed/larouco');
  const vecs = [], items = [];
  for (let p = 0; p < s2.passes.length; p++) {
    const im = await RawImage.read(path.join(dir, s2.passes[p].image));
    const N = im.width;
    const boxes = [];
    for (const [size, step] of [[128, 128], [256, 128]]) for (let y = 0; y + size <= N; y += step) for (let x = 0; x + size <= N; x += step) boxes.push([x, y, size]);
    const crops = [];
    for (const [x, y, size] of boxes) crops.push(await im.crop([x, y, x + size - 1, y + size - 1]));
    vecs.push(...await embed(crops));
    for (const [x, y, size] of boxes) items.push([p, +(x / N).toFixed(4), +(y / N).toFixed(4), +((x + size) / N).toFixed(4), +((y + size) / N).toFixed(4)]);
  }
  write(dir, { kind: 'satellite', bbox: s2.bbox, passes: s2.passes.map(({ date, time, image }) => ({ date, time, image })), items }, vecs);
}
