import type { AnalysisEvent, Citation, Incident, TimelineFrame, TimelineResponse, VideoSource, WeatherResponse } from '../api/types';

/** Everything the in-browser analyst and search know about one incident package (static demo). */
export interface Clip { clip_id: string; source_id: string; start_seconds: number; end_seconds: number; timestamp: string; thumbnail_url?: string | null }
export interface Evaluation { model: string; frames_evaluated: number; mean: { iou: number; precision: number; recall: number; ground_iou: number } }
export interface Corpus {
  incident: Incident; source: VideoSource; frames: TimelineFrame[]; events: AnalysisEvent[];
  clips: Clip[]; weather: WeatherResponse; evaluation: Evaluation;
  t0: number; t1: number;
}

export const CLIP_SECONDS = 12;
const cache = new Map<string, Promise<Corpus>>();

export function loadCorpus(base: string): Promise<Corpus> {
  let p = cache.get(base);
  if (!p) {
    const get = <T,>(f: string) => fetch(`${base}${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json() as Promise<T>; });
    p = Promise.all([
      get<Incident>('incident.json'), get<VideoSource[]>('sources.json'), get<TimelineResponse>('timeline.json'), get<{ events: AnalysisEvent[] }>('events.json'),
      get<Clip[]>('clips.json'), get<WeatherResponse>('weather.json'), get<Evaluation>('eval.json'),
    ]).then(([incident, sources, tl, ev, clips, weather, evaluation]) => ({
      incident, source: sources[0], frames: tl.frames, clips, weather, evaluation,
      events: [...ev.events].sort((a, b) => a.start_seconds - b.start_seconds),
      t0: Date.parse(tl.start), t1: Date.parse(tl.end),
    }));
    p.catch(() => cache.delete(base));
    cache.set(base, p);
  }
  return p;
}

/** The frame shown at a given video second (last frame at or before it). */
export function frameAt(c: Corpus, vs: number): TimelineFrame {
  let best = c.frames[0];
  for (const f of c.frames) if (f.video_seconds <= vs + 1e-6) best = f; else break;
  return best;
}

/** Evidence citation for the 12 s clip that contains a video second; links the event logged in that clip, if any. */
export function clipCitation(c: Corpus, vs: number): Citation {
  const k = Math.max(0, Math.floor(vs / CLIP_SECONDS)), s0 = k * CLIP_SECONDS, s1 = Math.min(c.source.duration_seconds, s0 + CLIP_SECONDS);
  const ev = c.events.find((e) => Math.floor(e.start_seconds / CLIP_SECONDS) === k);
  return { source_id: c.source.id, start_seconds: s0, end_seconds: s1, timestamp: new Date(c.t0 + s0 * 1000).toISOString(), event_id: ev?.event_id ?? null, clip_id: `clip_${String(k).padStart(4, '0')}`, label: null };
}
export function eventCitation(e: AnalysisEvent): Citation {
  return { source_id: e.source_id, start_seconds: e.start_seconds, end_seconds: e.end_seconds, timestamp: e.timestamp, event_id: e.event_id, label: null };
}

/** Burned-area growth over the previous `win` seconds, for every frame (null until enough history). */
export function growthSeries(c: Corpus, win = 60) {
  return c.frames.map((f, i) => {
    const back = c.frames.slice(0, i + 1).reverse().find((g) => f.video_seconds - g.video_seconds >= win - 0.5);
    const a = f.burned_area_m2.value, b = back?.burned_area_m2.value;
    return { f, d: back && a != null && b != null ? a - b : null };
  });
}
