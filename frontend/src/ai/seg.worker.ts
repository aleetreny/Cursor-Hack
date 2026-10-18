/// <reference lib="webworker" />
/**
 * The burned-area segmenter (LR-ASPP MobileNetV3, fine-tuned on the BurnedAreaUAV masks: pipeline/pinhao/segmenter.py)
 * running on video frames in a worker: WebGPU when the browser has it, WebAssembly otherwise. Same ONNX file the
 * offline pipeline used to produce the recorded masks.
 */
import * as ort from 'onnxruntime-web/webgpu';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

ort.env.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href, mjs: new URL(ortMjs, self.location.href).href };
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

const MODEL = new URL('../models/burned-lraspp-mnv3.onnx', self.location.href).href;
let session: ort.InferenceSession | null = null, ep = 'wasm', loading: Promise<void> | null = null;
// one inference at a time: a session must not run twice concurrently (WebGPU would stall)
let queue: Promise<unknown> = Promise.resolve();

function load() {
  loading ??= (async () => {
    const r = await fetch(MODEL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`model HTTP ${r.status}`);
    const total = +(r.headers.get('content-length') ?? 0);
    const reader = r.body!.getReader(), parts: Uint8Array[] = [];
    let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; postMessage({ type: 'progress', loaded: got, total }); }
    const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    const gpu = 'gpu' in navigator && (await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    for (const want of gpu ? ['webgpu', 'wasm'] : ['wasm']) {
      try { session = await ort.InferenceSession.create(buf, { executionProviders: [want], graphOptimizationLevel: 'all' }); ep = want; break; } catch { session = null; }
    }
    if (!session) throw new Error('no execution provider could run the model');
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

self.onmessage = async (e: MessageEvent<{ id: number; type: 'load' | 'run'; data?: Float32Array; w?: number; h?: number }>) => {
  const { id, type } = e.data;
  try {
    await load();
    if (type === 'load') { postMessage({ id, type: 'ready', ep }); return; }
    const job = queue.then(async () => {
      const t0 = performance.now();
      const out = await session!.run({ image: new ort.Tensor('float32', e.data.data!, [1, 3, e.data.h!, e.data.w!]) });
      return { prob: (out.burned.data as Float32Array).slice(), ms: performance.now() - t0 };
    });
    queue = job.catch(() => {});
    const { prob, ms } = await job;
    postMessage({ id, type: 'mask', prob, ms, ep }, [prob.buffer]);
  } catch (err) {
    postMessage({ id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
