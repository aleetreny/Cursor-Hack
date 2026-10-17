import type { AnalysisEvent, AskRequest, AskResponse, Citation, SearchRequest, SearchResponse, SearchResult, TimelineResponse } from './types';

/**
 * Static-demo Search and Ask, run in the browser over the logged (precomputed) events.
 * Same behaviour as the backend's lexical fallback and extractive answer (backend/firescope/app.py) —
 * no generative model, no embeddings, and the response says so.
 */
const CLIP_SECONDS = 12;
interface Clip { clip_id: string; source_id: string; start_seconds: number; end_seconds: number; timestamp: string; thumbnail_url?: string | null }
interface Corpus { clips: Clip[]; events: AnalysisEvent[]; timeline: TimelineResponse }

let corpus: Promise<Corpus> | null = null;
function load(base: string): Promise<Corpus> {
  const get = <T,>(f: string) => fetch(`${base}${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json() as Promise<T>; });
  corpus ??= Promise.all([get<Clip[]>('clips.json'), get<{ events: AnalysisEvent[] }>('events.json'), get<TimelineResponse>('timeline.json')])
    .then(([clips, ev, timeline]) => ({ clips, events: ev.events, timeline }));
  corpus.catch(() => { corpus = null; });
  return corpus;
}

const SYN: Record<string, string[]> = {
  flames: ['flame', 'fire', 'burning'], flame: ['flames', 'fire'], fire: ['flame', 'flames', 'burning'], smoke: ['smoky', 'plume', 'haze'],
  expand: ['expansion', 'grew', 'growth', 'advance', 'spread', 'widens'], expanding: ['expansion', 'grew', 'growth', 'spread'], burned: ['burnt', 'blackened', 'char', 'ash'],
  first: ['onset', 'start', 'appear', 'visible'], new: ['spot', 'ahead', 'outside', 'isolated'],
};
const tokens = (s: string) => s.toLowerCase().match(/[a-z]+/g) ?? [];
function lexical(q: string, text: string) {
  const qs = new Set(tokens(q));
  for (const w of [...qs]) for (const s of SYN[w] ?? []) qs.add(s);
  const ts = tokens(text);
  if (!ts.length) return 0;
  const long = [...qs].filter((w) => w.length > 4);
  const hits = ts.filter((t) => qs.has(t) || long.some((w) => t.startsWith(w.slice(0, 5)))).length;
  return hits / Math.sqrt(ts.length);
}

const RETRIEVAL = 'lexical search over logged events (static demo, no embedding index)';
function retrieve(c: Corpus, query: string, k: number): SearchResult[] {
  const byClip = new Map<number, AnalysisEvent>();
  for (const e of c.events) byClip.set(Math.floor(e.start_seconds / CLIP_SECONDS), e);
  const pool: { s: number; clip: Clip; text: string; e: AnalysisEvent }[] = [];
  for (const clip of c.clips) {
    const e = byClip.get(Math.floor(clip.start_seconds / CLIP_SECONDS));
    if (!e) continue;
    const text = `${e.title}. ${e.description} ${e.event_type.replace(/_/g, ' ')}`;
    const s = lexical(query, text);
    if (s > 0) pool.push({ s, clip, text, e });
  }
  return pool.sort((a, b) => b.s - a.s).slice(0, k).map(({ s, clip, text, e }) => ({
    clip_id: clip.clip_id, source_id: clip.source_id, start_seconds: clip.start_seconds, end_seconds: clip.end_seconds, timestamp: clip.timestamp,
    thumbnail_url: clip.thumbnail_url, caption: text.slice(0, 240), similarity: +s.toFixed(4), event_id: e.event_id,
  }));
}

export async function localSearch(body: SearchRequest, base: string): Promise<SearchResponse> {
  const t = performance.now();
  const c = await load(base);
  return { query: body.query, model: RETRIEVAL, results: retrieve(c, body.query, body.top_k ?? 8), latency_ms: Math.round(performance.now() - t) };
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const n0 = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Extractive answer: a chronological, cited digest of the most relevant logged events. */
export async function localAsk(body: AskRequest, base: string): Promise<AskResponse> {
  const t = performance.now();
  const c = await load(base);
  const hits = retrieve(c, body.question, 6);
  const first = c.timeline.frames[0], last = c.timeline.frames[c.timeline.frames.length - 1];
  const sev = (e: AnalysisEvent) => ({ alert: 0, watch: 1 } as Record<string, number>)[e.severity] ?? 2;
  const pick: AnalysisEvent[] = c.events.filter((e) => hits.slice(0, 4).some((h) => Math.abs(e.start_seconds - h.start_seconds) < CLIP_SECONDS));
  for (const e of [...c.events].sort((a, b) => sev(a) - sev(b))) { if (pick.length >= 4) break; if (!pick.includes(e)) pick.push(e); }
  const chosen = pick.slice(0, 4).sort((a, b) => a.start_seconds - b.start_seconds);
  const lines = chosen.map((e, i) => `${fmt(e.start_seconds)} ${e.title.replace(/\.$/, '')} [${i + 1}]`);
  const answer = `Burned ground in the drone's view grew from ${n0(first.burned_area_m2.value)} m² to ${n0(last.burned_area_m2.value)} m² over ${fmt(last.video_seconds)}. `
    + `Key moments: ${lines.join('; ')}. (Extractive summary of the logged evidence — no language model in the static demo.)`;
  const citations: Citation[] = chosen.map((e) => ({ source_id: e.source_id, start_seconds: e.start_seconds, end_seconds: e.end_seconds, timestamp: e.timestamp, event_id: e.event_id, label: `${fmt(e.start_seconds)}–${fmt(e.end_seconds)}` }));
  return { answer, citations, model: `extractive · retrieval: ${RETRIEVAL}`, grounded: chosen.length > 0, latency_ms: Math.round(performance.now() - t) };
}
