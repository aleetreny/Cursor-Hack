import { create } from 'zustand';
import { incidentBase } from '../api/client';
import { CLIP_DOWNLOAD_MB, CLIP_MODEL } from './models';
import { toEnglish } from './translate';
import { rank, SMALL, VOCAB, type VisualMeta, type VisualResult } from './visualRank';

/**
 * Visual search, opt-in: the query is encoded in the browser with the text half of MobileCLIP-S0 and compared with image
 * vectors computed offline from what the incident's cameras saw (drone frames, Sentinel-2 passes). Nothing leaves the
 * browser. Turning it on is remembered on this device, and the model then loads from the browser cache.
 */
export type AIStatus = 'off' | 'loading' | 'ready' | 'error';
interface VisualState { status: AIStatus; loaded: number; total: number; error: string | null; available: boolean | null }
export const useVisual = create<VisualState>(() => ({ status: 'off', loaded: 0, total: CLIP_DOWNLOAD_MB * 1e6, error: null, available: null }));

const PREF = 'firescope.visual';
const pref = (v?: boolean) => { try { if (v === undefined) return localStorage.getItem(PREF) === '1'; if (v) localStorage.setItem(PREF, '1'); else localStorage.removeItem(PREF); } catch { /* private mode */ } return false; };

let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { ok: (v: Float32Array[]) => void; fail: (e: Error) => void }>();
function call(type: 'load' | 'encode', texts?: string[]): Promise<Float32Array[]> {
  if (!worker) {
    worker = new Worker(new URL('./clip.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') { if (useVisual.getState().status === 'loading') useVisual.setState({ loaded: m.loaded, total: Math.max(m.total, 1) }); return; }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      if (m.type === 'error') p.fail(new Error(m.error)); else p.ok(m.vecs ?? []);
    };
    worker.onerror = (e) => { for (const p of pending.values()) p.fail(new Error(e.message || 'worker failed')); pending.clear(); worker = null; };
  }
  const id = ++seq;
  return new Promise((ok, fail) => { pending.set(id, { ok, fail }); worker!.postMessage({ id, type, texts }); });
}

interface Index { base: string; meta: VisualMeta; vecs: Int8Array; vocab: Float32Array[]; small: Float32Array[] }
let index: Promise<Index | null> | null = null, indexBase = '';
async function loadIndex(): Promise<Index | null> {
  const base = await incidentBase();
  if (index && indexBase === base) return index;
  indexBase = base;
  index = (async () => {
    const r = await fetch(`${base}visual_index.json`);
    if (!r.ok) return null;
    const meta = (await r.json()) as VisualMeta;
    const b = await fetch(`${base}visual_index.bin`);
    if (!b.ok) return null;
    const vecs = new Int8Array(await b.arrayBuffer());
    if (vecs.length !== meta.count * meta.dim) throw new Error('visual index is corrupt');
    const words = VOCAB[meta.kind].map((w) => `a photo of ${w}`);
    const all = await call('encode', [...words, ...SMALL]);
    return { base, meta, vecs, vocab: all.slice(0, words.length), small: all.slice(words.length) };
  })();
  index.catch(() => { index = null; });
  return index;
}

/** Does this incident have a visual index? (cheap: a HEAD-like fetch of the small JSON) */
export async function visualAvailable(): Promise<boolean> {
  const base = await incidentBase();
  const ok = await fetch(`${base}visual_index.json`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  useVisual.setState({ available: ok });
  return ok;
}

export async function enableVisual() {
  const st = useVisual.getState();
  if (st.status === 'ready' || st.status === 'loading') return;
  useVisual.setState({ status: 'loading', error: null, loaded: 0 });
  try {
    await call('load');
    await loadIndex();
    pref(true);
    useVisual.setState({ status: 'ready' });
  } catch (e) {
    useVisual.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}
export function disableVisual() { pref(false); worker?.terminate(); worker = null; index = null; useVisual.setState({ status: 'off' }); }
/** Re-enable on load if this device turned it on before (the model then comes from the browser cache). */
export function restoreVisual() { if (pref()) void visualAvailable().then((ok) => { if (ok) void enableVisual(); }); }

export interface VisualSearch extends VisualResult { query: string; english: string; translated: boolean; meta: VisualMeta; base: string; ms: number; model: string }

export async function visualSearch(query: string, topK = 6): Promise<VisualSearch | null> {
  const t0 = performance.now();
  const ix = await loadIndex();
  if (!ix) return null;
  const { text, translated } = toEnglish(query);
  const [q] = await call('encode', [text]);
  const r = rank(ix.meta, ix.vecs, q, ix.vocab, ix.small, topK);
  return { ...r, query, english: text, translated, meta: ix.meta, base: ix.base, ms: Math.round(performance.now() - t0), model: `${CLIP_MODEL.split('/')[1]} (in your browser)` };
}
