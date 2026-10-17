import type {
  AskRequest, AskResponse, EventsResponse, Incident, IncidentIndex, IncidentManifest,
  ObservationsResponse, SearchRequest, WeatherResponse, SearchResponse, TimelineResponse, VideoSource,
} from './types';
import { analystAsk } from '../agent/analyst';
import { staticSearch } from '../agent/search';

/**
 * API client. Two modes:
 *  - STATIC (default): reads a precomputed incident package from <base>/incidents/<id>/ (scripts/export-static.mjs),
 *    chosen with ?incident=<id> or the index default. Search and Ask run in the browser. This is what GitHub Pages serves.
 *  - API: VITE_API_BASE (or runtime config.js apiBase) set → calls the FastAPI backend (docs/api-contract.md).
 * Failures surface as errors — they are never silently replaced with other data.
 */
// Runtime config (public/config.js, editable after build) wins over build-time env.
const RUNTIME = (window as unknown as { __FIRESCOPE__?: { apiBase?: string; dataMode?: string } }).__FIRESCOPE__ ?? {};
const BASE = (RUNTIME.apiBase ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
const MODE = RUNTIME.dataMode ?? (import.meta.env.VITE_DATA_MODE as string | undefined);
export const IS_STATIC = !BASE || MODE === 'static';
export const API_BASE = BASE === '.' ? 'same origin' : BASE;

export class ApiError extends Error {
  status: number;
  path: string;
  constructor(status: number, message: string, path: string) { super(message); this.status = status; this.path = path; }
}

let index: Promise<IncidentIndex> | null = null;
const loadIndex = () => {
  index ??= fetch(`${import.meta.env.BASE_URL}incidents/index.json`).then((r) => { if (!r.ok) throw new ApiError(r.status, 'Incident index missing', 'incidents/index.json'); return r.json() as Promise<IncidentIndex>; });
  index.catch(() => { index = null; });
  return index;
};
let pkg: Promise<string> | null = null;
/** URL of the incident package to load (static mode): ?incident=<id>, else the index default. */
export function incidentBase(): Promise<string> {
  pkg ??= loadIndex()
    .then((ix) => {
      const want = new URLSearchParams(location.search).get('incident');
      const e = ix.incidents.find((x) => x.id === want) ?? ix.incidents.find((x) => x.id === ix.default) ?? ix.incidents[0];
      if (!e) throw new ApiError(404, 'No incidents published', 'incidents/index.json');
      return `${import.meta.env.BASE_URL}${e.path}`;
    });
  pkg.catch(() => { pkg = null; });
  return pkg;
}

async function req<T>(path: string, file: string, init?: RequestInit): Promise<T> {
  const url = IS_STATIC ? `${await incidentBase()}${file}` : `${BASE}${path}`;
  const res = await fetch(url, IS_STATIC ? undefined : init);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error ?? j.detail ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg, path);
  }
  return res.json() as Promise<T>;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Resolve a media URL (may be relative) to something <video>/<img> can load. */
export function mediaUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  if (/^(https?:|blob:|data:)/.test(u)) return u;
  const rel = u.startsWith('/') ? u.slice(1) : u;
  return IS_STATIC ? `${import.meta.env.BASE_URL}${rel}` : `${BASE}/${rel}`;
}

export const api = {
  /** Static mode only: the incidents published in this build. */
  incidents: async (): Promise<IncidentIndex['incidents']> => (IS_STATIC ? (await loadIndex()).incidents : []),
  /** Static mode only: what the incident package contains and how each part was made. */
  manifest: (): Promise<IncidentManifest | null> => (IS_STATIC ? req<IncidentManifest>('', 'manifest.json') : Promise.resolve(null)),
  incident: () => req<Incident>('/api/incident', 'incident.json'),
  sources: () => req<VideoSource[]>('/api/sources', 'sources.json'),
  timeline: () => req<TimelineResponse>('/api/fire/timeline', 'timeline.json'),
  observations: () => req<ObservationsResponse>('/api/fire/observations', 'observations.json'),
  weather: () => req<WeatherResponse>('/api/weather', 'weather.json'),
  events: (sourceId: string) => req<EventsResponse>(`/api/video/${encodeURIComponent(sourceId)}/events`, 'events.json'),
  search: async (body: SearchRequest): Promise<SearchResponse> => (IS_STATIC ? staticSearch(body, await incidentBase()) : req<SearchResponse>('/api/search', '', post(body))),
  ask: async (body: AskRequest): Promise<AskResponse> => (IS_STATIC ? analystAsk(body, await incidentBase()) : req<AskResponse>('/api/ask', '', post(body))),
};
