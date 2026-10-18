import { create } from 'zustand';
import type { AnalysisEvent, WeatherResponse, Hotspot, FireFeature, Incident, IncidentIndex, IncidentManifest, TimelineResponse, VideoSource } from '../api/types';
import type { CameraInfo, HoverInfo, SceneLayers } from '../scene/FireScene';

export type ModeTab = 'incident' | 'drones' | 'resources';
export type PanelTab = 'layers' | 'analysis' | 'evidence' | 'notes';

export interface LayerDef { id: keyof SceneLayers; label: string; swatch: string; opacity?: boolean; provenance?: string }

interface State {
  loaded: boolean;
  loadError: string | null;
  loadMsg: string;
  incident: Incident | null;
  sources: VideoSource[];
  timeline: TimelineResponse | null;
  features: FireFeature[];
  hotspots: Hotspot[];
  events: AnalysisEvent[];
  manifest: IncidentManifest | null;
  incidents: IncidentIndex['incidents'];
  /** transient status message (e.g. "Link copied") */
  toast: string | null;
  weather: WeatherResponse | null;

  t0: number; t1: number; time: number; playing: boolean; speed: number;
  /** visible time window of the timeline and charts; null = the whole incident (lib/timewin.ts) */
  win: [number, number] | null;
  mode: ModeTab; panel: PanelTab; view: '3d' | '2d';
  layers: SceneLayers;
  exaggeration: number;
  selectedEventId: string | null;
  selectedSourceId: string | null;
  selectedUnitId: string | null;
  follow: { id: string; mode: 'chase' | 'overview' | 'ride' } | null;
  feedOpen: boolean;
  /** a video file from this device, played in the camera window and analysed live (object URL, never uploaded) */
  localVideo: { url: string; name: string } | null;
  compare: { on: boolean; before: number | null };
  hover: HoverInfo | null;
  scenario: { on: boolean; hours: number; ha: number; lapse: number };
  presenting: boolean;
  /** tablet layout: side panel shown as a drawer over the map */
  drawer: boolean;
  cam: CameraInfo;
  set: (p: Partial<State>) => void;
  setTime: (t: number) => void;
  notify: (msg: string) => void;
  setLayer: <K extends keyof SceneLayers>(k: K, v: SceneLayers[K]) => void;
}

let toastTimer = 0;
export const useStore = create<State>((set, get) => ({
  loaded: false, loadError: null, loadMsg: 'Connecting',
  incident: null, sources: [], timeline: null, features: [], hotspots: [], events: [], manifest: null, incidents: [], toast: null, weather: null,
  t0: 0, t1: 1, time: 0, playing: false, speed: 8, win: null,
  mode: 'incident', panel: 'layers', view: '3d',
  layers: { terrain: true, imagery: 0.18, burned: 0.95, active: 1, change: 0.6, hotspots: true, groundTruth: false, perimeter: true, footprint: true, path: true, projection: false, trees: true, smoke: true, severity: 0, isochrones: false, ems: true, realSun: true, satellite: false },
  exaggeration: 1.8,
  selectedEventId: null, selectedSourceId: null, selectedUnitId: null, follow: null, feedOpen: false, localVideo: null,
  compare: { on: false, before: null },
  hover: null,
  scenario: { on: false, hours: 0, ha: 0, lapse: 1 },
  presenting: false,
  drawer: false,
  cam: { azimuth: 0, zoom: 1, metersPerPx: 1, polar: 50 },
  set: (p) => set(p),
  setTime: (t) => { const { t0, t1 } = get(); set({ time: Math.min(t1, Math.max(t0, t)) }); },
  notify: (msg) => { set({ toast: msg }); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => set({ toast: null }), 2400); },
  setLayer: (k, v) => set({ layers: { ...get().layers, [k]: v } }),
}));

/** Timeline time quantised to `ms`: panels that don't need every frame subscribe to this instead of the raw clock. */
export const qt = (t: number, ms: number) => Math.floor(t / ms) * ms;

/** Map wall-clock ms to a source's video seconds. */
export const videoSecondsAt = (src: VideoSource | undefined, t: number) => (src ? (t - Date.parse(src.recorded_start)) / 1000 : 0);
