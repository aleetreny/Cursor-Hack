import type { SearchRequest, SearchResponse, SearchResult } from '../api/types';
import { CLIP_SECONDS, growthSeries, loadCorpus, type Corpus } from './corpus';
import { norm } from './lang';

/**
 * Footage search for the static demo: keyword matching (English or Spanish) over the recorded events and a short
 * measurement summary of every 12 s clip (burned-area growth, visible flames, hotspots). It searches what was measured,
 * not the pixels — there is no image embedding in this build — and the response says so.
 */
export const SEARCH_MODEL = 'keyword search over recorded events and per-clip measurements (EN/ES)';

// Spanish → English vocabulary, plus English synonyms, both on normalised (accent-free) words
const ES: Record<string, string> = {
  humo: 'smoke', humareda: 'smoke', neblina: 'haze', llama: 'flame', llamas: 'flames', fuego: 'fire', incendio: 'fire', quemado: 'burned', quemada: 'burned',
  quemados: 'burned', quemadas: 'burned', ceniza: 'ash', negro: 'blackened', suelo: 'ground', terreno: 'ground', crece: 'grew', creciendo: 'growth', crecimiento: 'growth',
  expansion: 'expansion', propagacion: 'spread', avance: 'advance', avanza: 'advance', primeras: 'first', primera: 'first', primeros: 'first', primer: 'first',
  aparicion: 'appear', aparecen: 'appear', foco: 'spot', focos: 'spot', salto: 'jump', fuera: 'outside', delante: 'ahead', nuevo: 'new', nueva: 'new',
  denso: 'dense', densa: 'dense', rapido: 'rapid', rapida: 'rapid', pico: 'peak', maximo: 'peak', intensidad: 'intensity', frente: 'front', dron: 'drone',
};
const SYN: Record<string, string[]> = {
  flames: ['flame', 'fire', 'burning'], flame: ['flames', 'fire'], fire: ['flame', 'flames', 'burning'], smoke: ['smoky', 'plume', 'haze'],
  expand: ['expansion', 'grew', 'growth', 'advance', 'spread'], expanding: ['expansion', 'grew', 'growth', 'spread'], growth: ['grew', 'expansion'], spread: ['growth', 'grew', 'advance'],
  burned: ['burnt', 'blackened', 'char', 'ash'], first: ['onset', 'start', 'appear', 'visible'], new: ['spot', 'ahead', 'outside', 'isolated'],
  spot: ['ahead', 'outside', 'isolated', 'jump'], peak: ['largest', 'peak', 'maximum'], rapid: ['growth', 'fast', 'surge'],
};
const words = (s: string) => norm(s).match(/[a-z]+/g) ?? [];

function queryTerms(q: string) {
  const qs = new Set<string>();
  for (const w of words(q)) { const en = ES[w] ?? w; qs.add(en); for (const s of SYN[en] ?? []) qs.add(s); }
  return qs;
}
function score(qs: Set<string>, text: string) {
  const ts = words(text);
  if (!ts.length || !qs.size) return 0;
  const long = [...qs].filter((w) => w.length > 4);
  const hits = ts.filter((x) => qs.has(x) || long.some((w) => x.startsWith(w.slice(0, 5)))).length;
  return hits / Math.sqrt(ts.length);
}

/** One document per clip: the event logged in it (if any) plus what was measured during those 12 s. */
function docs(c: Corpus) {
  const g = growthSeries(c, CLIP_SECONDS);
  return c.clips.map((clip) => {
    const k = Math.floor(clip.start_seconds / CLIP_SECONDS);
    const ev = c.events.find((e) => Math.floor(e.start_seconds / CLIP_SECONDS) === k);
    const fr = g.filter((x) => x.f.video_seconds >= clip.start_seconds && x.f.video_seconds < clip.end_seconds);
    const grow = Math.max(0, ...fr.map((x) => x.d ?? 0)), flames = Math.max(0, ...fr.map((x) => x.f.active_fire_area_m2.value ?? 0)), hs = Math.max(0, ...fr.map((x) => x.f.hotspot_count.value ?? 0));
    const meas = [
      // positive facts only, so a query never matches a negation ("no flames")
      grow >= 40 ? `burned ground growth +${Math.round(grow)} m² in this clip, fire expanding` : grow > 0 ? `burned ground grew +${Math.round(grow)} m²` : '',
      flames > 0 ? `visible flames up to ${Math.round(flames)} m²` : '',
      hs > 0 ? `${hs} flame hotspots` : '',
    ].filter(Boolean).join(', ');
    const evText = ev ? `${ev.title}. ${ev.description} ${ev.visual_evidence.join(', ')} ${ev.event_type.replace(/_/g, ' ')}` : '';
    return { clip, ev, text: `${evText} ${meas}`, caption: ev ? `${ev.title} — ${ev.description}` : meas ? `Measured: ${meas}.` : 'No measured change in this clip.' };
  });
}

export async function staticSearch(body: SearchRequest, base: string): Promise<SearchResponse> {
  const t0 = performance.now();
  const c = await loadCorpus(base);
  const qs = queryTerms(body.query);
  const ranked = docs(c).map((d) => ({ d, s: score(qs, d.text) * (d.ev ? 1.4 : 1) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, body.top_k ?? 8);
  const results: SearchResult[] = ranked.map(({ d, s }) => ({
    clip_id: d.clip.clip_id, source_id: d.clip.source_id, start_seconds: d.clip.start_seconds, end_seconds: d.clip.end_seconds, timestamp: d.clip.timestamp,
    thumbnail_url: d.clip.thumbnail_url, caption: d.caption.slice(0, 240), similarity: +s.toFixed(3), event_id: d.ev?.event_id ?? null,
  }));
  return { query: body.query, model: SEARCH_MODEL, results, latency_ms: Math.round(performance.now() - t0) };
}
