/**
 * Live analysis of a playing <video>, in the browser: each frame (as fast as the device allows) is segmented into
 * burned ground (the learned model, in seg.worker.ts) and visible flames and smoke (the colour rules of the offline
 * pipeline, backend/firescope/segment.py, ported here), and drawn over the video. Nothing is uploaded.
 */
export const W = 512, H = 288;               // the model's input size (16:9)
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const HORIZON = 0.21;                        // rows above are far field, excluded like the offline pipeline

export interface LiveStats { burned: number; flames: number; smoke: number; fps: number; ms: number; ep: string }
export interface LiveFrame { prob: Float32Array; flame: Uint8Array; smoke: Uint8Array }

let worker: Worker | null = null, seq = 0;
const pending = new Map<number, (m: { type: string; prob?: Float32Array; ms?: number; ep?: string; error?: string }) => void>();
let onProgress: ((loaded: number, total: number) => void) | null = null;
function call(msg: Record<string, unknown>, transfer: Transferable[] = []) {
  if (!worker) {
    worker = new Worker(new URL('./seg.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') { onProgress?.(e.data.loaded, e.data.total); return; }
      const f = pending.get(e.data.id); if (f) { pending.delete(e.data.id); f(e.data); }
    };
  }
  const id = ++seq;
  return new Promise<{ type: string; prob?: Float32Array; ms?: number; ep?: string; error?: string }>((res) => { pending.set(id, res); worker!.postMessage({ id, ...msg }, transfer); });
}
export async function loadSegmenter(progress?: (loaded: number, total: number) => void) {
  onProgress = progress ?? null;
  const r = await call({ type: 'load' });
  if (r.type === 'error') throw new Error(r.error);
  return r.ep!;
}

/** Colour rules for flames and smoke on an RGBA frame (W×H), as in raw_masks(): blur, then thresholds. */
function colourMasks(px: Uint8ClampedArray) {
  const n = W * H, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { r[i] = px[i * 4]; g[i] = px[i * 4 + 1]; b[i] = px[i * 4 + 2]; }
  const blur = (a: Float32Array) => {   // two 3×3 box passes ≈ the 5×5 Gaussian of the pipeline
    const t = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; t[i] = (a[i - (x > 0 ? 1 : 0)] + a[i] + a[i + (x < W - 1 ? 1 : 0)]) / 3; }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; a[i] = (t[i - (y > 0 ? W : 0)] + t[i] + t[i + (y < H - 1 ? W : 0)]) / 3; }
    }
  };
  blur(r); blur(g); blur(b);
  const flame0 = new Uint8Array(n), smoke = new Uint8Array(n), lum = new Float32Array(n);
  const y0 = Math.floor(H * HORIZON);
  for (let i = 0; i < n; i++) {
    const R = r[i], G = g[i], B = b[i], V = Math.max(R, G, B), mn = Math.min(R, G, B), S = V > 0 ? (255 * (V - mn)) / V : 0;
    lum[i] = 0.299 * R + 0.587 * G + 0.114 * B;
    if (i < y0 * W) continue;
    if (R > 190 && R > G + 35 && G > B && S > 90 && V > 190) flame0[i] = 1;
    if (S < 38 && V > 120 && V < 235) smoke[i] = 1;   // texture test below
  }
  // texture: |Laplacian| (3×3 aperture, as cv2.Laplacian ksize=3) averaged over 9×9 — smoke is smooth
  const lap = new Float32Array(n);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    lap[i] = Math.abs(2 * (lum[i - W - 1] + lum[i - W + 1] + lum[i + W - 1] + lum[i + W + 1]) - 8 * lum[i]);
  }
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += lap[y * W + x]; integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row; } }
  for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!smoke[i]) continue;
    const xa = Math.max(0, x - 4), xb = Math.min(W, x + 5), ya = Math.max(0, y - 4), yb = Math.min(H, y + 5);
    const s = integ[yb * (W + 1) + xb] - integ[ya * (W + 1) + xb] - integ[yb * (W + 1) + xa] + integ[ya * (W + 1) + xa];
    if (s / ((xb - xa) * (yb - ya)) >= 6) smoke[i] = 0;
  }
  // opening with a 3×3 cross removes single-pixel specks, as cv2.morphologyEx(MORPH_OPEN) in the pipeline
  const er = new Uint8Array(n), flame = new Uint8Array(n);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; er[i] = flame0[i] & flame0[i - 1] & flame0[i + 1] & flame0[i - W] & flame0[i + W]; }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; flame[i] = er[i] | er[i - 1] | er[i + 1] | er[i - W] | er[i + W]; }
  return { flame, smoke };
}

export class LiveAnalyzer {
  private cap = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private out: CanvasRenderingContext2D;
  private img: ImageData;
  private busy = false;
  private on = false;
  private done: number[] = [];
  private last: LiveFrame | null = null;
  ep = '';
  private video: HTMLVideoElement;
  private onStats: (s: LiveStats) => void;
  constructor(video: HTMLVideoElement, overlay: HTMLCanvasElement, onStats: (s: LiveStats) => void) {
    this.video = video; this.onStats = onStats;
    this.cap.width = W; this.cap.height = H;
    this.ctx = this.cap.getContext('2d', { willReadFrequently: true })!;
    overlay.width = W; overlay.height = H;
    this.out = overlay.getContext('2d')!;
    this.img = this.out.createImageData(W, H);
  }
  private gen = 0;
  private lastT = -1;
  start() { if (this.on) return; this.on = true; this.lastT = -1; const g = ++this.gen; this.loop(g); }
  stop() { this.on = false; this.gen++; this.out.clearRect(0, 0, W, H); }

  /** Segment the frame the video is showing now. */
  async analyze(): Promise<LiveFrame & { ms: number }> {
    this.ctx.drawImage(this.video, 0, 0, W, H);
    const px = this.ctx.getImageData(0, 0, W, H).data;
    const data = new Float32Array(3 * W * H);
    for (let i = 0, n = W * H; i < n; i++) for (let c = 0; c < 3; c++) data[c * n + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
    const { flame, smoke } = colourMasks(px);
    const r = await call({ type: 'run', data, w: W, h: H }, [data.buffer]);
    if (r.type === 'error') throw new Error(r.error);
    this.ep = r.ep!;
    return { prob: r.prob!, flame, smoke, ms: r.ms! };
  }

  /** One analysis per new video frame while it plays; when paused, only after a seek. */
  private loop = async (g: number) => {
    if (!this.on || g !== this.gen) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const next = () => {
      if (!this.on || g !== this.gen) return;
      if (v.requestVideoFrameCallback && !v.paused && !v.ended) v.requestVideoFrameCallback(() => this.loop(g));
      else setTimeout(() => this.loop(g), 100);
    };
    if (this.busy || v.readyState < 2 || (v.paused && v.currentTime === this.lastT)) { next(); return; }
    this.busy = true;
    this.lastT = v.currentTime;
    try {
      const f = await this.analyze();
      if (g !== this.gen) return;
      this.last = f;
      this.draw(f);
      const now = performance.now();
      this.done = [...this.done.filter((t) => now - t < 2000), now];
      const y0 = Math.floor(H * HORIZON) * W, nValid = W * H - y0;
      let b = 0, fl = 0, sm = 0;
      for (let i = y0; i < W * H; i++) { if (f.prob[i] > 0.5) b++; fl += f.flame[i]; sm += f.smoke[i]; }
      this.onStats({ burned: b / nValid, flames: fl / nValid, smoke: sm / nValid, fps: v.paused ? 0 : this.done.length / 2, ms: f.ms, ep: this.ep });
    } catch (e) {
      console.warn('live analysis', e);
    } finally {
      this.busy = false;
      next();
    }
  };

  /** Burned ground in red with its edge, flames in yellow, smoke in blue. */
  private draw(f: LiveFrame) {
    const d = this.img.data, y0 = Math.floor(H * HORIZON);
    d.fill(0);
    for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4;
      const burned = f.prob[i] > 0.5;
      const edge = burned && ((x > 0 && f.prob[i - 1] <= 0.5) || (x < W - 1 && f.prob[i + 1] <= 0.5) || (y > y0 && f.prob[i - W] <= 0.5) || (y < H - 1 && f.prob[i + W] <= 0.5));
      if (f.flame[i]) { d[o] = 255; d[o + 1] = 232; d[o + 2] = 70; d[o + 3] = 235; }
      else if (edge) { d[o] = 255; d[o + 1] = 96; d[o + 2] = 40; d[o + 3] = 255; }
      else if (burned) { d[o] = 214; d[o + 1] = 52; d[o + 2] = 24; d[o + 3] = 92; }
      else if (f.smoke[i]) { d[o] = 110; d[o + 1] = 180; d[o + 2] = 255; d[o + 3] = 70; }
    }
    this.out.putImageData(this.img, 0, 0);
  }
  lastFrame() { return this.last; }
}
