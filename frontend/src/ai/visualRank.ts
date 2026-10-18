/**
 * Ranking for the visual search: query vector against the precomputed image vectors of an incident (pure functions,
 * no browser APIs, so scripts/ai/ can run the exact same code in Node).
 *
 * Score = cosine similarity (MobileCLIP-S0). CLIP cosines are relative, and a fire scene pulls every fire-related word up
 * ("helicopter" scores higher on a smoky frame than "dog"), so a high rank alone does not mean the thing is there. The
 * match strength therefore also asks: in its best image, does the query beat the ordinary contents of this kind of scene
 * (a short vocabulary per kind: flames, smoke, grass… / forest, clouds, farmland…)? Calibrated on both incidents with
 * queries for things that are in the footage and things that are not (scripts/ai/calibrate.mjs).
 */
export interface VisualMeta {
  model: string; revision: string; dim: number; scale: number; count: number; kind: 'video' | 'satellite';
  items: number[][];
  // video: items are [frame, crop]
  every_s?: number; times?: number[]; sprite?: { url: string; w: number; h: number; per_row: number }; crops?: number[][];
  // satellite: items are [pass, x0, y0, x1, y1] (fractions of the pass image, y down)
  bbox?: [number, number, number, number]; passes?: { date: string; time: string; image: string }[];
}
export interface VisualHit {
  cos: number; p: number; rel: number;
  frame?: number; t?: number; crop?: number;
  pass?: number; box?: [number, number, number, number];
}
export type Strength = 'strong' | 'weak' | 'none';
export interface VisualResult { hits: VisualHit[]; strength: Strength; tooSmall: boolean; synonyms: string[] }

/** What a scene of each kind normally contains (encoded as "a photo of …"). */
export const VOCAB: Record<VisualMeta['kind'], string[]> = {
  video: ['flames', 'smoke', 'burned ground', 'grass', 'shrubs', 'trees', 'hills', 'rocks', 'sky', 'soil'],
  satellite: ['forest', 'farmland', 'clouds', 'smoke', 'burned land', 'a town', 'a river', 'a lake', 'mountains', 'bare soil', 'shrubland'],
};
/** Things far smaller than a 10–20 m Sentinel-2 pixel: they cannot be seen from orbit, whatever the score says. */
export const SMALL = ['a person', 'people', 'a car', 'a vehicle', 'a truck', 'a fire engine', 'an animal', 'a dog', 'an aircraft', 'a helicopter', 'an airplane', 'a firefighter', 'a drone'];
const SYN_SIM = 0.75, SMALL_SIM = 0.8, LOGIT = 100, CLIP_S = 12;

const THRESH: Record<VisualMeta['kind'], { strong: [number, number]; weak: [number, number] }> = {
  // [min contrast probability, min cosine]
  video: { strong: [0.3, 0], weak: [0.1, 0] },
  satellite: { strong: [0.5, 0.24], weak: [0.15, 0.205] },
};

const dotI8 = (v: Int8Array, off: number, q: ArrayLike<number>, dim: number) => { let s = 0; for (let j = 0; j < dim; j++) s += v[off + j] * q[j]; return s; };
const dotF = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let j = 0; j < a.length; j++) s += a[j] * b[j]; return s; };

/** Similarity of every image to every vocabulary word: computed once per index. */
const vocabCache = new WeakMap<Int8Array, Float32Array[]>();
function vocabScores(meta: VisualMeta, vecs: Int8Array, vocab: ArrayLike<number>[]) {
  let vs = vocabCache.get(vecs);
  if (!vs || vs.length !== vocab.length) {
    vs = vocab.map((v) => { const a = new Float32Array(meta.count); for (let i = 0; i < meta.count; i++) a[i] = dotI8(vecs, i * meta.dim, v, meta.dim) / meta.scale; return a; });
    vocabCache.set(vecs, vs);
  }
  return vs;
}

export function rank(meta: VisualMeta, vecs: Int8Array, q: ArrayLike<number>, vocab: ArrayLike<number>[], small: ArrayLike<number>[], topK = 8): VisualResult {
  const words = VOCAB[meta.kind];
  const syn = vocab.map((v) => dotF(v, q) >= SYN_SIM);
  const VS = vocabScores(meta, vecs, vocab);
  const N = meta.count, S = new Float32Array(N), P = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = dotI8(vecs, i * meta.dim, q, meta.dim) / meta.scale;
    for (let k = 0; k < VS.length; k++) if (syn[k] && VS[k][i] > s) s = VS[k][i];   // "smoke plume" may use the "smoke" word
    let m = s;
    for (let k = 0; k < VS.length; k++) if (!syn[k] && VS[k][i] > m) m = VS[k][i];
    const own = Math.exp(LOGIT * (s - m));
    let tot = own;
    for (let k = 0; k < VS.length; k++) if (!syn[k]) tot += Math.exp(LOGIT * (VS[k][i] - m));
    S[i] = s; P[i] = own / tot;
  }
  // a relative bar: 0 = a typical image, 1 = the best one
  const sorted = Float32Array.from(S).sort();
  const med = sorted[Math.floor(N / 2)], top = sorted[N - 1];
  const rel = (s: number) => Math.max(0, Math.min(1, (s - med) / Math.max(1e-6, top - med)));

  const hits: VisualHit[] = [];
  if (meta.kind === 'video') {
    // best crop per frame, then the best frame of each 12 s clip
    const nF = meta.times!.length, fS = new Float32Array(nF).fill(-1), fP = new Float32Array(nF), fC = new Int8Array(nF);
    meta.items.forEach(([f, c], i) => { if (S[i] > fS[f]) { fS[f] = S[i]; fC[f] = c; } if (P[i] > fP[f]) fP[f] = P[i]; });
    const best = new Map<number, number>();
    for (let f = 0; f < nF; f++) { const clip = Math.floor(meta.times![f] / CLIP_S); const b = best.get(clip); if (b == null || fS[f] > fS[b]) best.set(clip, f); }
    for (const f of [...best.values()].sort((a, b) => fS[b] - fS[a]).slice(0, topK)) hits.push({ cos: fS[f], p: fP[f], rel: rel(fS[f]), frame: f, t: meta.times![f], crop: fC[f] });
  } else {
    // best squares, skipping near-duplicates (same pass, overlapping) and at most 3 per pass
    const order = [...S.keys()].sort((a, b) => S[b] - S[a]);
    const perPass = new Map<number, number>();
    for (const i of order) {
      const [p, x0, y0, x1, y1] = meta.items[i];
      if ((perPass.get(p) ?? 0) >= 3) continue;
      const dup = hits.some((h) => {
        if (h.pass !== p) return false;
        const [a0, b0, a1, b1] = h.box!;
        const ix = Math.max(0, Math.min(a1, x1) - Math.max(a0, x0)) * Math.max(0, Math.min(b1, y1) - Math.max(b0, y0));
        return ix > 0.25 * Math.min((a1 - a0) * (b1 - b0), (x1 - x0) * (y1 - y0));
      });
      if (dup) continue;
      hits.push({ cos: S[i], p: P[i], rel: rel(S[i]), pass: p, box: [x0, y0, x1, y1] });
      perPass.set(p, (perPass.get(p) ?? 0) + 1);
      if (hits.length >= topK) break;
    }
  }
  const tooSmall = meta.kind === 'satellite' && small.some((v) => dotF(v, q) >= SMALL_SIM);
  const th = THRESH[meta.kind];
  const pass = ([pm, cm]: [number, number]) => hits.some((h) => h.p >= pm && h.cos >= cm);
  const strength: Strength = tooSmall ? 'none' : pass(th.strong) ? 'strong' : pass(th.weak) ? 'weak' : 'none';
  return { hits, strength, tooSmall, synonyms: words.filter((_, k) => syn[k]) };
}
