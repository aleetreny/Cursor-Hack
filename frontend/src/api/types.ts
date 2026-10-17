/**
 * FireScope 3D — frontend ⇄ backend API contract (source of truth for the UI).
 * Human-readable spec: docs/api-contract.md. Keep both in sync.
 *
 * Conventions
 *  - Coordinates: GeoJSON (RFC 7946), WGS84 / EPSG:4326, [lon, lat] order. A 3rd
 *    (elevation) ordinate is allowed but ignored — the UI drapes geometry on its DEM.
 *  - Timestamps: ISO-8601 UTC strings with a trailing "Z" (e.g. "2019-03-01T12:31:04.000Z").
 *  - Video time: `video_seconds` = float seconds from the start of that source's media file.
 *  - Areas in square metres, lengths in metres, angles in degrees (0 = north, clockwise).
 *  - Never invent numbers: if a value is unknown, send null and the UI renders "—".
 */

export type ISODate = string;
export type LonLat = [number, number] | [number, number, number];

/** Where a value came from. Rendered as a provenance chip next to every metric. */
export type Provenance =
  | 'model'          // produced by an AI model run (Cosmos Reason / Embed / YOLO / segmentation)
  | 'derived'        // computed from model outputs (e.g. polygon area after georeferencing)
  | 'ground_truth'   // dataset annotation (BurnedAreaUAV manual masks)
  | 'external'       // third-party observation (e.g. NASA FIRMS)
  | 'demo_parameter' // illustrative constant, NOT an observation
  | 'fixture';       // development fixture shipped with the frontend

export interface Metric {
  value: number | null;
  unit: string;            // "m2", "m", "%", "count", "s", ...
  provenance: Provenance;
  method?: string;         // short free text, e.g. "homography + DEM ray cast"
}

/* ------------------------------------------------------------------ health */

export interface IntegrationStatus {
  id: string;              // "nvidia_cosmos_reason", "nvidia_cosmos_embed", "vast", "yolo", "vss", "wandb", ...
  name: string;            // display name
  sponsor: string;         // "NVIDIA" | "VAST Data" | "CoreWeave" | "Weights & Biases" | ...
  status: 'ok' | 'degraded' | 'down' | 'not_configured';
  model?: string | null;   // exact model identifier actually called
  endpoint?: string | null;// host only, never credentials
  last_success?: ISODate | null;
  latency_ms?: number | null;
  detail?: string | null;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  integrations: IntegrationStatus[];
}

/* ---------------------------------------------------------------- incident */

export interface Incident {
  id: string;                         // "pinhao-2019-03-01"
  name: string;                       // "Pinhão Cell Prescribed Burn"
  kind: 'wildfire' | 'prescribed_burn';
  location: string;                   // "Torre do Pinhão, Vila Real, PT"
  center: LonLat;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat] — terrain extent to load
  start: ISODate;                     // first observation
  end: ISODate;                       // last observation
  status: 'processing' | 'analyzed' | 'live';
  /** Known reference boundary (e.g. the planned burn cell KML). Rendered as dashed perimeter. */
  reference_perimeter?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  landmarks?: Landmark[];
  attribution: string[];              // dataset / imagery credits shown in the UI footer
}

export interface Landmark {
  name: string;
  position: LonLat;
  elevation_m?: number | null;
  kind: 'peak' | 'place' | 'water' | 'road' | 'other';
}

/* ----------------------------------------------------------------- sources */

export type SourceMode = 'drone_replay' | 'fixed_camera' | 'simulated_live' | 'live';

export interface CameraPose {
  position: LonLat;               // camera position
  altitude_agl_m: number | null;  // above ground level
  altitude_msl_m?: number | null;
  yaw_deg: number | null;         // gimbal yaw, 0 = north, clockwise
  pitch_deg: number | null;       // gimbal pitch, negative = looking down
  roll_deg?: number | null;
  hfov_deg: number | null;        // horizontal field of view
}

export interface VideoSource {
  id: string;                       // "drone_replay_01"
  label: string;                    // "UAV-01 · DJI Phantom 4 Pro"
  mode: SourceMode;                 // UI shows "DRONE REPLAY" for drone_replay — never "LIVE"
  media_url: string;                // MP4 or HLS (.m3u8) playable by <video>; may be relative to API base
  thumbnail_url?: string | null;
  duration_seconds: number;
  fps: number;
  width: number;
  height: number;
  recorded_start: ISODate;          // wall-clock time of video_seconds = 0
  pose?: CameraPose | null;
  /** Ground footprint of the camera view (4 corners or polygon), for the map frustum. */
  footprint?: GeoJSON.Feature<GeoJSON.Polygon> | null;
  georeferencing: Georeferencing;
  processing: ProcessingState;
}

export interface Georeferencing {
  method: 'camera_model_dem' | 'homography' | 'gcp_manual' | 'none';
  accuracy: 'measured' | 'approximate' | 'unknown';
  rmse_m?: number | null;           // if control points were used
  crs: 'EPSG:4326';
  notes?: string | null;
}

export interface ProcessingState {
  state: 'queued' | 'processing' | 'done' | 'error';
  progress: number;                 // 0..1
  clips_total: number;
  clips_done: number;
  message?: string | null;
}

/* ---------------------------------------------------------------- timeline */

/** One entry per observation time (e.g. every 4 s of video). Drives the scrubber and charts. */
export interface TimelineFrame {
  timestamp: ISODate;
  source_id: string;
  video_seconds: number;
  source_frame: number;
  burned_area_m2: Metric;           // cumulative, from georeferenced segmentation
  active_fire_area_m2: Metric;      // currently visibly burning
  area_change_m2: Metric;           // vs previous frame
  hotspot_count: Metric;
  has_ground_truth: boolean;
}

export interface TimelineResponse {
  incident_id: string;
  start: ISODate;
  end: ISODate;
  frames: TimelineFrame[];          // sorted ascending by timestamp
  events: AnalysisEvent[];          // key events shown as markers on the timeline
}

/* --------------------------------------------------------------- fire state */

export type FireClass =
  | 'burned_area'          // cumulative burned ground (model)
  | 'visible_active_fire'  // flames visible in RGB (model)
  | 'smoke'                // smoke plume region (model)
  | 'area_change'          // newly burned since previous frame (derived)
  | 'ground_truth_burned'  // annotation mask, for comparison only
  | 'projection';          // EXPERIMENTAL scenario — never an observation

export interface FireFeatureProps {
  id: string;
  classification: FireClass;
  timestamp: ISODate;
  source_id: string;
  source_frame: number;
  video_seconds: number;
  georeferencing_method: Georeferencing['method'];
  georeferencing_accuracy: Georeferencing['accuracy'];
  area_m2?: number | null;
  provenance: Provenance;
  model?: string | null;
}

export type FireFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, FireFeatureProps>;

export interface HotspotProps {
  id: string;
  timestamp: ISODate;
  source_id: string;
  video_seconds: number;
  /** RGB footage cannot measure temperature: 'rgb_flame' means a visible flame centroid. */
  kind: 'rgb_flame' | 'thermal' | 'satellite_firms';
  temperature_c?: number | null;    // ONLY for real thermal/radiometric sources
  provenance: Provenance;
  event_id?: string | null;
}
export type Hotspot = GeoJSON.Feature<GeoJSON.Point, HotspotProps>;

/** GET /api/fire/state?time=… — everything the map needs for one instant. */
export interface FireStateResponse {
  timestamp: ISODate;               // the observation actually returned (nearest ≤ requested)
  requested: ISODate;
  features: FireFeature[];
  hotspots: Hotspot[];
  frame: TimelineFrame;
}

/** GET /api/fire/observations — all features for all times (preferred: lets the UI scrub offline). */
export interface ObservationsResponse {
  type: 'FeatureCollection';
  features: FireFeature[];
  hotspots: Hotspot[];
}

/* ------------------------------------------------------------------ events */

export type EventType =
  | 'first_visible_flames'
  | 'visible_fire_expansion'
  | 'new_fire_activity'
  | 'smoke_increase'
  | 'smoke_decrease'
  | 'burned_ground_visible'
  | 'fire_near_road_or_structure'
  | 'intensity_change'
  | 'camera_motion'
  | 'scene_transition'
  | 'other';

export interface AnalysisEvent {
  event_id: string;
  source_id: string;
  start_seconds: number;            // video time
  end_seconds: number;
  timestamp: ISODate;               // wall-clock of start_seconds
  event_type: EventType;
  title: string;                    // short label for lists, e.g. "Fire front expands NW"
  description: string;              // model's grounded description
  visual_evidence: string[];
  confidence: number | null;        // null unless the model emits a calibrated probability
  review_required: boolean;
  severity: 'info' | 'watch' | 'alert';
  processing_model: string;         // exact model id, e.g. "nvidia/cosmos-reason2-8b"
  location?: LonLat | null;         // georeferenced point if derivable
  image_region?: [number, number, number, number] | null; // [x0,y0,x1,y1] normalized 0..1 in frame
  thumbnail_url?: string | null;
  provenance: Provenance;
}

export interface EventsResponse {
  source_id: string;
  events: AnalysisEvent[];
}

/* -------------------------------------------------------------- video jobs */

export interface UploadResponse { source_id: string; status_url: string; }
export interface AnalyzeRequest { source_id: string; clip_seconds?: number; prompts?: string[]; }
export interface AnalyzeResponse { job_id: string; source_id: string; processing: ProcessingState; }
export interface VideoStatusResponse { source_id: string; processing: ProcessingState; }

/* ----------------------------------------------------------- search & ask */

export interface SearchRequest {
  query: string;
  top_k?: number;                   // default 8
  source_id?: string | null;
}

export interface SearchResult {
  clip_id: string;
  source_id: string;
  start_seconds: number;
  end_seconds: number;
  timestamp: ISODate;
  /** Raw cosine similarity from the embedding model — a ranking score, NOT a confidence. */
  similarity: number;
  caption?: string | null;          // Cosmos Reason caption of the clip, if available
  thumbnail_url?: string | null;
  event_id?: string | null;
}

export interface SearchResponse {
  query: string;
  model: string;                    // e.g. "nvidia/cosmos-embed1-448p"
  results: SearchResult[];
  latency_ms?: number | null;
}

export interface AskRequest {
  question: string;
  /** UI context so answers can be about "now". */
  context?: { timestamp?: ISODate | null; source_id?: string | null; selected_event_id?: string | null };
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export interface Citation {
  source_id: string;
  start_seconds: number;
  end_seconds: number;
  timestamp: ISODate;
  event_id?: string | null;
  clip_id?: string | null;
  label?: string | null;            // e.g. "00:42–00:54"
}

export interface AskResponse {
  answer: string;                   // markdown; may reference citations as [1], [2] …
  citations: Citation[];
  model: string;
  grounded: boolean;                // false if the agent could not find supporting clips
  latency_ms?: number | null;
}

/* -------------------------------------------------------------- projection */

/** GET /api/fire/projection?from=…&horizon_minutes=… — EXPERIMENTAL, never an operational forecast. */
export interface ProjectionResponse {
  experimental: true;
  label: 'EXPERIMENTAL SCENARIO — NOT AN OPERATIONAL FORECAST';
  from: ISODate;
  horizon_minutes: number;
  method: string;                   // e.g. "linear extrapolation of last 5 boundary displacements"
  assumptions: string[];
  steps: { timestamp: ISODate; feature: FireFeature }[];
}
