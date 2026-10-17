import type {
  AnalyzeRequest, AnalyzeResponse, AskRequest, AskResponse, EventsResponse, FireStateResponse, HealthResponse, Incident,
  ObservationsResponse, ProjectionResponse, SearchRequest, SearchResponse, TimelineResponse, UploadResponse, VideoSource, VideoStatusResponse,
} from './types';

/**
 * API client. Two modes:
 *  - LIVE:     VITE_API_BASE set (e.g. http://vm-host:8000) → calls the backend described in docs/api-contract.md
 *  - FIXTURES: no VITE_API_BASE (or VITE_DATA_MODE=fixtures) → reads /fixtures/*.json, badged "DEV FIXTURE" in the UI
 * Live failures surface as errors — they are never silently replaced with fixtures.
 */
// Runtime config (public/config.js, editable after build) wins over build-time env.
// apiBase '.' = same origin, relative to the page (works under /app); '' = fixtures.
const RUNTIME = (window as unknown as { __FIRESCOPE__?: { apiBase?: string; dataMode?: string } }).__FIRESCOPE__ ?? {};
const BASE = (RUNTIME.apiBase ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
const MODE = RUNTIME.dataMode ?? (import.meta.env.VITE_DATA_MODE as string | undefined);
export const USE_FIXTURES = !BASE || MODE === 'fixtures';
export const API_BASE = BASE === '.' ? 'same origin' : BASE;
const FIXTURES = `${import.meta.env.BASE_URL}fixtures/`;

export class ApiError extends Error {
  status: number;
  path: string;
  constructor(status: number, message: string, path: string) { super(message); this.status = status; this.path = path; }
}

async function req<T>(path: string, fixture: string, init?: RequestInit): Promise<T> {
  const url = USE_FIXTURES ? `${FIXTURES}${fixture}` : `${BASE}${path}`;
  const res = await fetch(url, USE_FIXTURES ? undefined : init);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error ?? j.detail ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg, path);
  }
  return res.json() as Promise<T>;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Resolve a media URL from the backend (may be relative) to something <video>/<img> can load. */
export function mediaUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  if (/^(https?:|blob:|data:)/.test(u)) return u;
  const rel = u.startsWith('/') ? u.slice(1) : u;
  return USE_FIXTURES ? `${import.meta.env.BASE_URL}${rel}` : `${BASE}/${rel}`;
}

export const api = {
  health: () => req<HealthResponse>('/api/integrations/health', 'health.json'),
  incident: () => req<Incident>('/api/incident', 'incident.json'),
  sources: () => req<VideoSource[]>('/api/sources', 'sources.json'),
  timeline: () => req<TimelineResponse>('/api/fire/timeline', 'timeline.json'),
  observations: () => req<ObservationsResponse>('/api/fire/observations', 'observations.json'),
  fireState: (time: string) => req<FireStateResponse>(`/api/fire/state?time=${encodeURIComponent(time)}`, 'state.json'),
  projection: (from: string, horizonMinutes: number) => req<ProjectionResponse>(`/api/fire/projection?from=${encodeURIComponent(from)}&horizon_minutes=${horizonMinutes}`, 'projection.json'),
  events: (sourceId: string) => req<EventsResponse>(`/api/video/${encodeURIComponent(sourceId)}/events`, 'events.json'),
  status: (sourceId: string) => req<VideoStatusResponse>(`/api/video/${encodeURIComponent(sourceId)}/status`, 'status.json'),
  analyze: (body: AnalyzeRequest) => req<AnalyzeResponse>('/api/video/analyze', 'analyze.json', post(body)),
  search: (body: SearchRequest) => req<SearchResponse>('/api/search', 'search.json', post(body)),
  ask: (body: AskRequest) => req<AskResponse>('/api/ask', 'ask.json', post(body)),
  upload: async (file: File): Promise<UploadResponse> => {
    if (USE_FIXTURES) throw new ApiError(0, 'Upload needs the backend (set VITE_API_BASE)', '/api/video/upload');
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`${BASE}/api/video/upload`, { method: 'POST', body: fd });
    if (!res.ok) throw new ApiError(res.status, res.statusText, '/api/video/upload');
    return res.json();
  },
};
