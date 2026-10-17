# FireScope 3D — Backend API Contract (v0.1)

> **Status (Oct 2026): optional.** The public demo is a static build that does not call this API. It reads a precomputed
> incident package (`frontend/scripts/export-static.mjs` → `incidents/<id>/*.json`, the same JSON shapes as below), and Search
> and Ask run in the browser (`frontend/src/agent/`). This contract still describes the FastAPI backend in `backend/`, which you
> can run locally and point the UI at with `VITE_API_BASE`. Sections that mention NVIDIA Cosmos, YOLO or VSS describe the
> hackathon deployment ([docs/historia-hackathon.md](historia-hackathon.md)) and are not used by the demo.

The TypeScript source of truth is [`frontend/src/api/types.ts`](../frontend/src/api/types.ts). If you change a shape, edit both files. Additive fields are always safe.

---

## 0. Global conventions

| Topic | Rule |
|---|---|
| Base URL | `${VITE_API_BASE}` e.g. `http://<vm-host>:8000`. All routes are under `/api`. |
| CORS | Allow origin `http://localhost:5173` (Vite dev) and `*` is fine for the hackathon. |
| Coordinates | GeoJSON RFC 7946, **WGS84 / EPSG:4326, `[lon, lat]`**. Elevation ordinate optional and ignored (UI drapes on DEM). |
| Timestamps | ISO-8601 **UTC with `Z`**: `2019-03-01T12:31:04.000Z`. |
| Video time | `video_seconds` / `start_seconds` / `end_seconds` = float seconds from start of that source's media file. |
| Units | m², m, degrees (0 = north, clockwise). Area is **m²**; the UI converts to ha / acres. |
| Unknowns | Send `null`. Never fabricate a number. The UI shows "—". |
| Provenance | Every metric is `{ value, unit, provenance, method? }`, where `provenance ∈ model · derived · ground_truth · external · demo_parameter · fixture`. |
| Confidence | `null` unless the model emits a calibrated probability. Search `similarity` is a ranking score, not a confidence. |
| Media | `media_url` / `thumbnail_url` may be relative (`/media/...`) and resolved against the API base. MP4 (H.264) or HLS. Must support HTTP Range requests so the UI can seek. |
| Errors | Non-2xx with `{ "error": string, "detail"?: string }`. |

## 1. Endpoints

| Method | Path | Response type | Used for |
|---|---|---|---|
| GET | `/api/integrations/health` | `HealthResponse` | Sponsor-integration status strip (evidence for judges) |
| GET | `/api/incident` | `Incident` | Header, incident overview, terrain bbox, reference perimeter, landmarks |
| GET | `/api/sources` | `VideoSource[]` | Drone list, video player, camera frustum on map |
| GET | `/api/fire/timeline` | `TimelineResponse` | Scrubber ticks, charts (burned area, change rate), key-event markers |
| GET | `/api/fire/observations` | `ObservationsResponse` | **Preferred.** All polygons + hotspots for all times; UI filters locally for 60 fps scrubbing |
| GET | `/api/fire/state?time=<ISO>` | `FireStateResponse` | Fallback per-instant state (nearest observation ≤ `time`) |
| GET | `/api/fire/projection?from=<ISO>&horizon_minutes=<n>` | `ProjectionResponse` | Experimental scenario layer (optional, last priority) |
| POST | `/api/video/upload` (multipart `file`) | `UploadResponse` | Upload new footage |
| POST | `/api/video/analyze` | `AnalyzeResponse` | Kick off Cosmos Reason / segmentation / embedding |
| GET | `/api/video/{source_id}/status` | `VideoStatusResponse` | Progress bar |
| GET | `/api/video/{source_id}/events` | `EventsResponse` | Event list / review queue / timeline markers |
| POST | `/api/search` | `SearchResponse` | Cosmos Embed semantic clip search |
| POST | `/api/ask` | `AskResponse` | Grounded Q&A agent with clickable citations |

## 2. Shapes with examples

> The values below show **shape only**. They are not observations.

### 2.1 `GET /api/integrations/health`
```json
{
  "ok": true,
  "version": "0.1.0",
  "integrations": [
    { "id": "nvidia_cosmos_reason", "name": "Cosmos Reason", "sponsor": "NVIDIA", "status": "ok",
      "model": "nvidia/cosmos-reason2-8b", "endpoint": "vss.workshop.internal", "last_success": "2026-10-17T14:02:11Z", "latency_ms": 2140 },
    { "id": "nvidia_cosmos_embed", "name": "Cosmos Embed", "sponsor": "NVIDIA", "status": "ok", "model": "…" },
    { "id": "vast", "name": "VAST Data Platform", "sponsor": "VAST Data", "status": "ok", "detail": "vector + object store" },
    { "id": "coreweave", "name": "CoreWeave GPU", "sponsor": "CoreWeave", "status": "ok" }
  ]
}
```
Report only integrations that really run. `status: "not_configured"` is fine and honest.

### 2.2 `GET /api/incident`
```json
{
  "id": "pinhao-2019-03-01",
  "name": "Pinhão Cell Prescribed Burn",
  "kind": "prescribed_burn",
  "location": "Torre do Pinhão, Vila Real, Portugal",
  "center": [-7.6155, 41.3925],
  "bbox": [-7.632, 41.380, -7.600, 41.404],
  "start": "2019-03-01T12:3x:xxZ",
  "end": "2019-03-01T12:4x:xxZ",
  "status": "analyzed",
  "reference_perimeter": { "type": "Feature", "properties": { "name": "Planned burn cell (KML)" }, "geometry": { "type": "Polygon", "coordinates": [[[-7.6138, 41.3854], "…"]] } },
  "landmarks": [ { "name": "Torre do Pinhão", "position": [-7.62, 41.39], "kind": "place" } ],
  "attribution": ["BurnedAreaUAV dataset (CC-BY-4.0), Ribeiro et al. 2023"]
}
```
`bbox` controls which DEM / imagery tiles the UI loads. Keep it ≤ ~4 km across.

### 2.3 `GET /api/sources`
```json
[{
  "id": "drone_replay_01",
  "label": "UAV-01 · DJI Phantom 4 Pro",
  "mode": "drone_replay",
  "media_url": "/media/drone_replay_01.mp4",
  "thumbnail_url": "/media/drone_replay_01/thumb.jpg",
  "duration_seconds": 900.0, "fps": 25, "width": 1280, "height": 720,
  "recorded_start": "2019-03-01T12:3x:xxZ",
  "pose": { "position": [-7.614827, 41.393844], "altitude_agl_m": 24.9, "yaw_deg": -46.7, "pitch_deg": -28.9, "roll_deg": 0, "hfov_deg": 55.3 },
  "footprint": { "type": "Feature", "properties": {}, "geometry": { "type": "Polygon", "coordinates": [["…4 ground corners…"]] } },
  "georeferencing": { "method": "camera_model_dem", "accuracy": "approximate", "rmse_m": null, "crs": "EPSG:4326", "notes": "…" },
  "processing": { "state": "done", "progress": 1, "clips_total": 75, "clips_done": 75 }
}]
```
`mode: "drone_replay"` is displayed as **DRONE REPLAY**. The UI never labels it LIVE.

### 2.4 `GET /api/fire/timeline`
```json
{
  "incident_id": "pinhao-2019-03-01",
  "start": "…Z", "end": "…Z",
  "frames": [{
    "timestamp": "…Z", "source_id": "drone_replay_01", "video_seconds": 4.0, "source_frame": 100,
    "burned_area_m2":      { "value": 1234.5, "unit": "m2", "provenance": "derived", "method": "segmentation → camera_model_dem" },
    "active_fire_area_m2": { "value": 88.0,   "unit": "m2", "provenance": "derived" },
    "area_change_m2":      { "value": 12.1,   "unit": "m2", "provenance": "derived" },
    "hotspot_count":       { "value": 3,      "unit": "count", "provenance": "model" },
    "has_ground_truth": true
  }],
  "events": [ /* AnalysisEvent[] — same as /video/{id}/events, used as timeline markers */ ]
}
```
Recommended cadence: one frame every **4 s of video** (matches the BurnedAreaUAV annotation cadence of every 100 frames).

### 2.5 `GET /api/fire/observations` (preferred)
```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Polygon", "coordinates": [[[-7.61, 41.39], "…"]] },
    "properties": {
      "id": "burn_f0100", "classification": "burned_area", "timestamp": "…Z",
      "source_id": "drone_replay_01", "source_frame": 100, "video_seconds": 4.0,
      "georeferencing_method": "camera_model_dem", "georeferencing_accuracy": "approximate",
      "area_m2": 1234.5, "provenance": "model", "model": "segformer-burned-area | hsv-baseline | sam2"
    }
  }],
  "hotspots": [{
    "type": "Feature", "geometry": { "type": "Point", "coordinates": [-7.613, 41.391] },
    "properties": { "id": "hs_f0100_0", "timestamp": "…Z", "source_id": "drone_replay_01", "video_seconds": 4.0,
                    "kind": "rgb_flame", "temperature_c": null, "provenance": "model", "event_id": null }
  }]
}
```
`classification` values: `burned_area` (cumulative), `visible_active_fire`, `smoke`, `area_change` (new since previous frame), `ground_truth_burned` (annotation, comparison only), `projection` (experimental).
The UI shows the latest feature of each classification with `timestamp ≤ cursor`. Send **one feature per classification per frame**; MultiPolygon is fine.
**Hotspots from RGB are `kind: "rgb_flame"` with `temperature_c: null`.** Only real thermal sources may carry temperature.

### 2.6 `GET /api/video/{source_id}/events`
```json
{ "source_id": "drone_replay_01", "events": [{
  "event_id": "evt_001", "source_id": "drone_replay_01",
  "start_seconds": 42.0, "end_seconds": 54.0, "timestamp": "…Z",
  "event_type": "visible_fire_expansion",
  "title": "Fire front advances upslope",
  "description": "Visible active fire appears to extend toward the upper-left of the scene.",
  "visual_evidence": ["new visible flame region", "increased smoke near vegetation"],
  "confidence": null, "review_required": true, "severity": "watch",
  "processing_model": "nvidia/cosmos-reason2-8b",
  "location": [-7.6131, 41.3912], "image_region": [0.05, 0.10, 0.45, 0.50],
  "thumbnail_url": "/media/drone_replay_01/evt_001.jpg", "provenance": "model"
}]}
```
`event_type` enum: `first_visible_flames · visible_fire_expansion · new_fire_activity · smoke_increase · smoke_decrease · burned_ground_visible · fire_near_road_or_structure · intensity_change · camera_motion · scene_transition · other`.
`severity: "alert"` events show up in the red alert queue. Please emit at least one real alert.

### 2.7 `POST /api/search`
Request `{ "query": "first appearance of flames", "top_k": 8, "source_id": null }`
```json
{ "query": "first appearance of flames", "model": "nvidia/cosmos-embed1-…", "latency_ms": 180,
  "results": [{ "clip_id": "clip_0010", "source_id": "drone_replay_01", "start_seconds": 40, "end_seconds": 52,
                "timestamp": "…Z", "similarity": 0.31, "caption": "…", "thumbnail_url": "/media/…/clip_0010.jpg", "event_id": "evt_001" }] }
```

### 2.8 `POST /api/ask`
Request `{ "question": "How did the fire change during the recording?", "context": { "timestamp": "…Z", "source_id": "drone_replay_01", "selected_event_id": null }, "history": [] }`
```json
{ "answer": "Burned ground expands from the lower-right toward the upper-left [1], with a flare-up near … [2].",
  "citations": [ { "source_id": "drone_replay_01", "start_seconds": 42, "end_seconds": 54, "timestamp": "…Z", "event_id": "evt_001", "label": "00:42–00:54" } ],
  "model": "nvidia/cosmos-reason2-8b (+ retrieval: cosmos-embed)", "grounded": true, "latency_ms": 3200 }
```
`[n]` in `answer` refers to `citations[n-1]`. The UI turns these into buttons that seek the video and the map timeline.

### 2.9 `GET /api/fire/projection` (optional)
Must return `"experimental": true` and `"label": "EXPERIMENTAL SCENARIO — NOT AN OPERATIONAL FORECAST"`, a plain-language `method`, and `assumptions[]`. Features use `classification: "projection"`, `provenance: "derived"`.

### 2.10 Video jobs
- `POST /api/video/upload` multipart field `file` → `{ "source_id", "status_url" }`
- `POST /api/video/analyze` `{ "source_id", "clip_seconds"?: 12, "prompts"?: [] }` → `{ "job_id", "source_id", "processing" }`
- `GET /api/video/{id}/status` → `{ "source_id", "processing": { "state", "progress", "clips_total", "clips_done", "message" } }`

---

## 3. Dataset facts already extracted (for the backend's georeferencing)

Source: **BurnedAreaUAV v1.1**, Zenodo record 7944963, CC-BY-4.0.
Prescribed fire, Torre do Pinhão, northern Portugal, 2019-03-01, DJI Phantom 4 Pro (FC6310), ~15 min at 25 fps, 1280×720, nearly stationary.
Masks are annotated every 100 frames (4 s): 226 train + 23 test pairs (PNG / Labelme JSON / WKT).

Drone pose from the XMP of `uav_photo_1_metadata.JPG` (12:46:28) and `uav_photo_2_metadata.JPG` (12:48:57). The two are almost identical:

| Field | Value |
|---|---|
| GPS | 41°23'37.84" N, 7°36'53.38" W → **lat 41.393844, lon −7.614828** |
| RelativeAltitude | **+24.9 m** (above take-off point) |
| AbsoluteAltitude | 663.66 m (barometric; the KML gives ground ≈ 725–760 m, so prefer DEM + relative alt) |
| GimbalYaw / Pitch / Roll | **−46.7° / −28.9° / 0°** (looking NW, ~29° below horizon) |
| Calibrated focal | 3666.67 px @ 3840 px width → HFOV ≈ **55.3°**, VFOV ≈ 32.7° (16:9). Principal point at the centre. |

KML `pinhao_cell_precribed_area.kml` holds the burn-cell polygon (`AllArea`, ~55 vertices, lon −7.6188…−7.6108, lat 41.3853…41.3993) and an "Area under study" point at `[-7.615504, 41.394572]`.

Suggested georeferencing (priority 1): pinhole camera from the pose above, then cast rays from mask pixels onto a DEM (Copernicus GLO-30 or AWS Terrarium z15). Refine with 4+ GCPs against the KML boundary and imagery. Report `method: "camera_model_dem"` and `accuracy: "approximate"`.
The frontend uses **AWS Terrarium tiles** (`s3.amazonaws.com/elevation-tiles-prod/terrarium`) for the 3D terrain, so the same DEM keeps polygons sitting on the ground.

## 4. What the frontend does NOT do
No inference, segmentation, georeferencing or embedding happens in the browser. The frontend only renders, filters by time, plays media, and calls these endpoints.
