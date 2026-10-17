import { create } from 'zustand';
import type { AnalysisEvent, HealthResponse, Hotspot, FireFeature, Incident, TimelineResponse, VideoSource } from '../api/types';
import type { CameraInfo, HoverInfo, SceneLayers } from '../scene/FireScene';

export type ModeTab = 'incident' | 'drones' | 'alerts';
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
  health: HealthResponse | null;

  t0: number; t1: number; time: number; playing: boolean; speed: number;
  mode: ModeTab; panel: PanelTab; view: '3d' | '2d';
  layers: SceneLayers;
  exaggeration: number;
  selectedEventId: string | null;
  selectedSourceId: string | null;
  feedOpen: boolean;
  compare: { on: boolean; before: number | null };
  hover: HoverInfo | null;
  cam: CameraInfo;
  set: (p: Partial<State>) => void;
  setTime: (t: number) => void;
  setLayer: <K extends keyof SceneLayers>(k: K, v: SceneLayers[K]) => void;
}

export const useStore = create<State>((set, get) => ({
  loaded: false, loadError: null, loadMsg: 'Connecting',
  incident: null, sources: [], timeline: null, features: [], hotspots: [], events: [], health: null,
  t0: 0, t1: 1, time: 0, playing: false, speed: 8,
  mode: 'incident', panel: 'layers', view: '3d',
  layers: { terrain: true, imagery: 0.18, burned: 0.95, active: 1, change: 0.6, hotspots: true, groundTruth: false, perimeter: true, footprint: true, path: true, projection: false, trees: true, smoke: true },
  exaggeration: 1.8,
  selectedEventId: null, selectedSourceId: null, feedOpen: false,
  compare: { on: false, before: null },
  hover: null,
  cam: { azimuth: 0, zoom: 1, metersPerPx: 1, polar: 50 },
  set: (p) => set(p),
  setTime: (t) => { const { t0, t1 } = get(); set({ time: Math.min(t1, Math.max(t0, t)) }); },
  setLayer: (k, v) => set({ layers: { ...get().layers, [k]: v } }),
}));

/** Map wall-clock ms to a source's video seconds. */
export const videoSecondsAt = (src: VideoSource | undefined, t: number) => (src ? (t - Date.parse(src.recorded_start)) / 1000 : 0);
