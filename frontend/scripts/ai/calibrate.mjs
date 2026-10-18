// Calibration of the visual-search match strength (src/ai/visualRank.ts), on both incidents.
//   node --experimental-strip-types scripts/ai/calibrate.mjs
// Runs the exact ranking code of the browser on queries for things that are in the imagery and things that are not,
// and prints the best cosine, the best contrast probability and the strength each one gets. The thresholds in
// visualRank.ts were chosen so every "in" query is at least weak and every "out" query is none.
import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';
import fs from 'node:fs';
import { rank, SMALL, VOCAB } from '../../src/ai/visualRank.ts';

const M = 'Xenova/mobileclip_s0', R = '757d59c9c6870a76a4b0306f05f5061bca15c39f';
const tok = await AutoTokenizer.from_pretrained(M, { revision: R });
const text = await CLIPTextModelWithProjection.from_pretrained(M, { revision: R, dtype: 'q8' });
const enc = async (qs) => { const e = (await text(tok(qs, { padding: 'max_length', truncation: true }))).text_embeds.normalize(); const d = e.dims[1]; return qs.map((_, k) => e.data.slice(k * d, (k + 1) * d)); };
const D = {
  '../data/processed/drone_replay_01': {
    in: ['dense smoke', 'tall flames', 'burned black ground', 'a smoke plume', 'a line of fire', 'fire', 'smoke', 'black smoke', 'flames next to green grass'],
    out: ['a helicopter', 'an airplane', 'a firefighter', 'a car', 'a house', 'a river', 'a road', 'a water bomber dropping water', 'a person', 'a fire truck', 'snow', 'night', 'the sea', 'a dog', 'a city', 'a bridge', 'a boat', 'clouds', 'a lake'],
  },
  '../data/processed/larouco': {
    in: ['a smoke plume', 'dense smoke', 'a burn scar', 'burned forest', 'clouds', 'a lake', 'a reservoir', 'a town', 'a river', 'green forest', 'farmland', 'a pyrocumulus cloud', 'smoke', 'mountains', 'burned land'],
    out: ['a helicopter', 'an airplane', 'a firefighter', 'a car', 'a person', 'a fire truck', 'night', 'a dog', 'a beach', 'a desert', 'a stadium', 'an airport', 'a ship', 'tall flames'],
  },
};
let bad = 0;
for (const [dir, qs] of Object.entries(D)) {
  const meta = JSON.parse(fs.readFileSync(`${dir}/visual_index.json`));
  const vecs = new Int8Array(fs.readFileSync(`${dir}/visual_index.bin`).buffer.slice(0));
  const vocab = await enc(VOCAB[meta.kind].map((w) => `a photo of ${w}`)), small = await enc(SMALL);
  for (const [lab, list] of [['in', qs.in], ['out', qs.out]]) {
    const T = await enc(list);
    list.forEach((q, i) => {
      const r = rank(meta, vecs, T[i], vocab, small);
      const best = r.hits.reduce((a, h) => (h.p > a.p ? h : a), r.hits[0]);
      const ok = lab === 'in' ? r.strength !== 'none' : r.strength === 'none';
      if (!ok) bad++;
      console.log(`${meta.kind.padEnd(9)} ${lab.padEnd(3)} ${ok ? 'ok  ' : 'MISS'} ${q.padEnd(30)} ${r.strength.padEnd(6)} cos ${best.cos.toFixed(3)} p ${best.p.toFixed(3)}${r.tooSmall ? ' (too small to see)' : ''}`);
    });
  }
}
console.log(bad ? `${bad} queries on the wrong side of the thresholds` : 'all queries on the right side');
process.exit(0);
