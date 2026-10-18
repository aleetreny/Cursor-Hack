/// <reference lib="webworker" />
/**
 * The text half of MobileCLIP-S0, in a worker so loading (~43 MB, parsed once) and encoding never block the 3D view.
 * Everything comes from this site: the model files (fetched at build time at a pinned revision and hash-checked, see
 * scripts/export-static.mjs) and the ONNX Runtime WebAssembly. The browser cache keeps them after the first time.
 */
import { AutoTokenizer, CLIPTextModelWithProjection, env, type PreTrainedTokenizer, type PreTrainedModel } from '@huggingface/transformers';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { CLIP_LOCAL } from './models';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('../models/', self.location.href).pathname;   // <site>/models/, next to assets/
// transformers.js keeps the files in its own Cache API store: skip the HTTP cache (no second 45 MB copy on disk)
env.fetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' });
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href, mjs: new URL(ortMjs, self.location.href).href };
wasm.numThreads = 1;   // GitHub Pages cannot send the COOP/COEP headers that threads need

let tok: PreTrainedTokenizer | null = null, model: PreTrainedModel | null = null;
let loading: Promise<void> | null = null;

function load() {
  loading ??= (async () => {
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let l = 0, t = 0; for (const f of files.values()) { l += f.loaded; t += f.total; }
      postMessage({ type: 'progress', loaded: l, total: t });
    };
    tok = await AutoTokenizer.from_pretrained(CLIP_LOCAL, { progress_callback });
    model = await CLIPTextModelWithProjection.from_pretrained(CLIP_LOCAL, { dtype: 'q8', device: 'wasm', progress_callback });
  })();
  return loading;
}

self.onmessage = async (e: MessageEvent<{ id: number; type: 'load' | 'encode'; texts?: string[] }>) => {
  const { id, type, texts } = e.data;
  try {
    await load();
    if (type === 'load') { postMessage({ id, type: 'ready' }); return; }
    const t0 = performance.now();
    const inputs = tok!(texts!, { padding: 'max_length', truncation: true });
    const { text_embeds } = await model!(inputs);
    const flat = text_embeds.normalize().data as Float32Array;
    const dim = text_embeds.dims[1];
    const vecs = texts!.map((_, k) => flat.slice(k * dim, (k + 1) * dim));
    postMessage({ id, type: 'vecs', vecs, ms: Math.round(performance.now() - t0) }, vecs.map((v) => v.buffer));
  } catch (err) {
    loading = null;
    postMessage({ id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
