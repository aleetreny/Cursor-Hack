import type {
  AnalyzeRequest, AnalyzeResponse, AskRequest, AskResponse, EventsResponse, HealthResponse, Incident,
  ObservationsResponse, SearchRequest, WeatherResponse, SearchResponse, TimelineResponse, UploadResponse, VideoSource, VideoStatusResponse,
} from './types';
import { localAsk, localSearch } from './local';

/**
 * API client. Two modes:
 *  - STATIC (default): reads the precomputed incident from <base>/data/*.json (scripts/export-static.mjs).
 *    Search and Ask run in the browser over the logged events. This is what GitHub Pages serves.
 *  - API: VITE_API_BASE (or runtime config.js apiBase) set → calls the FastAPI backend (docs/api-contract.md).
 * Failures surface as errors — they are never silently replaced with other data.
 */
// Runtime config (public/config.js, editable after build) wins over build-time env.
const RUNTIME = (window as unknown as { __FIRESCOPE__?: { apiBase?: string; dataMode?: string } }).__FIRESCOPE__ ?? {};
const BASE = (RUNTIME.apiBase ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
const MODE = RUNTIME.dataMode ?? (import.meta.env.VITE_DATA_MODE as string | undefined);
export const IS_STATIC = !BASE || MODE === 'static';
export const API_BASE = BASE === '.' ? 'same origin' : BASE;
const DATA = `${import.meta.env.BASE_URL}data/`;

export class ApiError extends Error {
  status: number;
  path: string;
  constructor(status: number, message: string, path: string) { super(message); this.status = status; this.path = path; }
}

async function req<T>(path: string, file: string, init?: RequestInit): Promise<T> {
  const url = IS_STATIC ? `${DATA}${file}` : `${BASE}${path}`;
  const res = await fetch(url, IS_STATIC ? undefined : init);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error ?? j.detail ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg, path);
  }
  return res.json() as Promise<T>;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const unavailable = (path: string) => Promise.reject(new ApiError(0, 'Not available in the static demo', path));

/** Resolve a media URL (may be relative) to something <video>/<img> can load. */
export function mediaUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  if (/^(https?:|blob:|data:)/.test(u)) return u;
  const rel = u.startsWith('/') ? u.slice(1) : u;
  return IS_STATIC ? `${import.meta.env.BASE_URL}${rel}` : `${BASE}/${rel}`;
}

export const api = {
  health: () => req<HealthResponse>('/api/integrations/health', 'health.json'),
  incident: () => req<Incident>('/api/incident', 'incident.json'),
  sources: () => req<VideoSource[]>('/api/sources', 'sources.json'),
  timeline: () => req<TimelineResponse>('/api/fire/timeline', 'timeline.json'),
  observations: () => req<ObservationsResponse>('/api/fire/observations', 'observations.json'),
  weather: () => req<WeatherResponse>('/api/weather', 'weather.json'),
  events: (sourceId: string) => req<EventsResponse>(`/api/video/${encodeURIComponent(sourceId)}/events`, 'events.json'),
  status: (sourceId: string) => (IS_STATIC ? unavailable(`/api/video/${sourceId}/status`) : req<VideoStatusResponse>(`/api/video/${encodeURIComponent(sourceId)}/status`, '')),
  analyze: (body: AnalyzeRequest) => (IS_STATIC ? unavailable('/api/video/analyze') : req<AnalyzeResponse>('/api/video/analyze', '', post(body))),
  search: (body: SearchRequest): Promise<SearchResponse> => (IS_STATIC ? localSearch(body, DATA) : req<SearchResponse>('/api/search', '', post(body))),
  ask: (body: AskRequest): Promise<AskResponse> => (IS_STATIC ? localAsk(body, DATA) : req<AskResponse>('/api/ask', '', post(body))),
  upload: async (file: File): Promise<UploadResponse> => {
    if (IS_STATIC) return unavailable('/api/video/upload');
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`${BASE}/api/video/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new ApiError(res.status, res.statusText, '/api/video/upload');
    return res.json();
  },
};
