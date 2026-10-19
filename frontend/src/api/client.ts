import type {
  AskRequest, AskResponse, EventsResponse, Incident, IncidentIndex, IncidentManifest,
  ObservationsResponse, SearchRequest, WeatherResponse, SearchResponse, TimelineResponse, VideoSource,
} from './types';

/**
 * Data client: reads a precomputed incident package from <base>/incidents/<id>/ (scripts/export-static.mjs), chosen
 * with ?incident=<id> or the index default. Search and Ask run in the browser. This is all GitHub Pages serves: no
 * server, no keys. Failures surface as errors — they are never silently replaced with other data.
 */
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

async function req<T>(file: string): Promise<T> {
  const res = await fetch(`${await incidentBase()}${file}`);
  if (!res.ok) throw new ApiError(res.status, res.statusText || 'Not found', file);
  return res.json() as Promise<T>;
}

/** Resolve a media URL (may be relative) to something <video>/<img> can load. */
export function mediaUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  if (/^(https?:|blob:|data:)/.test(u)) return u;
  const rel = u.startsWith('/') ? u.slice(1) : u;
  return `${import.meta.env.BASE_URL}${rel}`;
}

export const api = {
  /** The incidents published in this build. */
  incidents: async (): Promise<IncidentIndex['incidents']> => (await loadIndex()).incidents,
  /** What the incident package contains and how each part was made. */
  manifest: (): Promise<IncidentManifest | null> => req<IncidentManifest>('manifest.json'),
  incident: () => req<Incident>('incident.json'),
  sources: () => req<VideoSource[]>('sources.json'),
  timeline: () => req<TimelineResponse>('timeline.json'),
  observations: () => req<ObservationsResponse>('observations.json'),
  weather: () => req<WeatherResponse>('weather.json'),
  events: () => req<EventsResponse>('events.json'),
  // the analyst and search are loaded on first use (they are not needed to show the incident)
  search: async (body: SearchRequest): Promise<SearchResponse> => (await import('../agent/search')).staticSearch(body, await incidentBase()),
  ask: async (body: AskRequest): Promise<AskResponse> => (await import('../agent/analyst')).analystAsk(body, await incidentBase()),
};
