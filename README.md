# FireScope 3D

**We turn wildfire drone footage into a time-aware 3D operational picture.**

FireScope 3D ingests drone video of a fire, works out what the camera sees (NVIDIA Cosmos Reason plus a measurable CV pipeline), projects the observed fire onto real terrain, and lets a responder scrub through time, click an observation, see the exact video evidence, search the footage and ask questions about it.

The interface recreates the "FireTrace" wildfire forensic prototype (Dilum Sanjaya / Claude, shared by Anthropic). Its layout is a full-bleed 3D terrain with a right-hand layers and incident panel, a bottom timeline with linked charts and a key-events column, plus Incident / Drones / Alerts modes, a drone camera window, and 2D/3D map switching. Here it runs on **real data**.

> Exploratory decision-support prototype. **Not** a certified emergency-management or fire-spread prediction system.

---

## What runs in the demo

| | Source | Status |
|---|---|---|
| Drone footage | **BurnedAreaUAV v1.1** (Zenodo 7944963, CC-BY-4.0): 15 min of RGB video of a prescribed burn at Torre do Pinhão, Portugal, from a hovering DJI Phantom 4 Pro | Real, replayed as **DRONE REPLAY**, never labelled live |
| Camera pose | DJI XMP metadata of the dataset's photos (GPS, 24.9 m AGL, gimbal yaw −46.7°, pitch −28.9°, calibrated focal length) | Real |
| Terrain | AWS Terrain Tiles (Terrarium) DEM, z15 inner and z12 horizon; Esri World Imagery drives the stylized ground and vegetation | Real elevation, stylized rendering, **1.8× vertical exaggeration (labelled)** |
| Burned area / flames | `backend/firescope/segment.py`: RGB segmentation with temporal accumulation | Model output, **evaluated against the manual masks** (below) |
| Georeferencing | Pinhole camera, rays marched onto the DEM (`geo.py`) | **Approximate** (`camera_model_dem`) |
| Events | Measurement-derived (area growth, flames outside the scar, smoke surges, peak flame extent), then described by **NVIDIA Cosmos Reason** per 12 s clip | Model / derived, `confidence: null`, `review_required: true` |
| Search | NVIDIA embedding index over Cosmos clip captions, with a labelled lexical fallback | Real when the endpoint is configured |
| Ask | Retrieval over events and clips, answered by the Cosmos/NIM LLM with `[n]` citations that seek video and map | Real when configured; otherwise an *extractive* answer, labelled as such |
| Hotspots | Visible-flame blob centroids. **RGB cannot measure temperature**, so `temperature_c` is always `null` | Model |
| Projection | Linear centroid extrapolation, purple dashed layer, banner: **EXPERIMENTAL SCENARIO — NOT AN OPERATIONAL FORECAST** | Experimental |
| Trees, smoke particles | Rendered for readability | Stylized |

Every metric in the UI carries a provenance chip (`model`, `derived`, `ground_truth`, `external`, `fixture`).

## Evaluation (reproducible)

`python -m firescope.pipeline` → `data/processed/drone_replay_01/eval.json`

| Metric (226 annotated frames, every 100th frame) | Value |
|---|---|
| Mean IoU, cumulative burned mask vs manual mask (image space) | **0.68** |
| Precision / recall | 0.76 / 0.85 |
| Mean IoU after projecting both onto the DEM (ground space) | **0.71** |
| Pipeline runtime, full 15 min video on an M5 Pro CPU | ~12 s |

The ground-truth masks can be toggled on the map (Layers → Ground Truth), shown in blue against the model's scar.

## Architecture

```
 Drone video (MP4 / RTSP later)
        │  frames every 4 s · 12 s clips
        ▼
 ┌────────────────────────┐      ┌────────────────────────────────┐
 │ CV pipeline (CPU)      │      │ NVIDIA Cosmos Reason (NIM)     │
 │ burned / flame / smoke │      │ cosmos3-nano-reasoner (VM) or  │
 │ temporal accumulation  │      │ cosmos-reason2-8b (hosted)     │
 └──────────┬─────────────┘      │ clip → JSON caption, change,   │
            │ masks              │ evidence, event type           │
            ▼                    └──────────────┬─────────────────┘
 ┌────────────────────────┐                     │ captions
 │ Georeferencing         │                     ▼
 │ pinhole + DJI pose     │      ┌────────────────────────────────┐
 │ ray-march onto DEM     │      │ Embedding index (Cosmos Embed /│
 └──────────┬─────────────┘      │ NV-Embed) → /api/search        │
            │ GeoJSON (EPSG:4326)│ Agent (NIM LLM) → /api/ask     │
            ▼                    └──────────────┬─────────────────┘
 ┌──────────────────────────────────────────────┴───────────────┐
 │ FastAPI (docs/api-contract.md): timeline · observations ·     │
 │ events · sources · search · ask · projection · media (range)  │
 └──────────────────────────────┬────────────────────────────────┘
                                ▼
 ┌───────────────────────────────────────────────────────────────┐
 │ React + Three.js dashboard: DEM terrain · draped fire mask     │
 │ shader · bloom flames · smoke · drone + frustum · timeline ·   │
 │ charts · drone feed synced to the timeline · search · agent    │
 └───────────────────────────────────────────────────────────────┘
```

* **Frontend** (`frontend/`): React 19, TypeScript, Vite, Three.js (custom terrain shader, draped canvas masks for burned / active / change, UnrealBloom, GPU point-sprite flames and smoke, instanced vegetation), Zustand. The timeline is the single clock: map overlays, charts, events, the drone video and the panels all follow it.
* **Backend** (`backend/firescope/`): `pipeline.py` (video → masks → polygons → timeline/events/eval), `geo.py` (DEM + camera), `segment.py`, `cosmos_job.py` (Cosmos clip analysis + index), `nvidia.py` (OpenAI-compatible adapters, every call logged to `data/processed/nvidia_calls.jsonl`), `app.py` (API).
* **Contract**: `docs/api-contract.md` and `frontend/src/api/types.ts`. Coordinates are WGS84 `[lon, lat]`, times are ISO-8601 UTC, and unknown values are `null`.

## Sponsor integrations

| Sponsor | Use | Where |
|---|---|---|
| **NVIDIA** Cosmos Reason | Clip-level video understanding → event descriptions, evidence, review regions; agent answers | `nvidia.py`, `cosmos_job.py`, `/api/ask` |
| **NVIDIA** Cosmos Embed / NV-Embed | Semantic clip search | `cosmos_job.build_index`, `/api/search` |
| **VAST Data** workshop VM | Hosts the Cosmos NIM endpoint used by the backend (`166.19.38.112:8001`) | `.env` |
| **Cursor** | Infrastructure discovery and validation on the VM | — |

`GET /api/integrations/health` reports which services are actually configured and their last successful call. The Notes tab shows the same in the UI. Nothing is marked "ok" unless a call succeeded.

## Run it

```bash
# 1. data (≈1 GB, CC-BY-4.0): KML, photo metadata and the video/masks archive from Zenodo 7944963
mkdir -p data/raw/burnedareauav && cd data/raw/burnedareauav
for f in pinhao_cell_precribed_area.kml uav_photo_1_metadata.JPG BurnedAreaUAV_dataset_v1.rar; do curl -LO "https://zenodo.org/api/records/7944963/files/$f/content" -o $f; done
bsdtar -xf BurnedAreaUAV_dataset_v1.rar && cd ../../..

# 2. backend
cd backend && uv venv && uv pip install -r requirements.txt
cp .env.example .env            # add Cosmos endpoint + token (see below)
.venv/bin/python -m firescope.pipeline          # CV + georeferencing + eval (~15 s)
.venv/bin/python -m firescope.cosmos_job --every 3   # NVIDIA Cosmos Reason pass (optional, needs endpoint)
.venv/bin/uvicorn firescope.app:app --port 8000

# 3. frontend
cd ../frontend && npm install
VITE_API_BASE=http://localhost:8000 npm run dev     # → http://localhost:5173
npm run dev                                         # fixtures only (no backend), badged DEV FIXTURES
```

The browser video is a 960×540 H.264 copy at `data/processed/media/drone_replay_01.mp4`:
`ffmpeg -i <original> -an -vf scale=960:540 -c:v libx264 -crf 27 -movflags +faststart data/processed/media/drone_replay_01.mp4`

### Environment (`backend/.env`, gitignored)

| Var | Meaning |
|---|---|
| `COSMOS_REASON_BASE` | OpenAI-compatible base URL (workshop: `http://166.19.38.112:8001/v1`) |
| `COSMOS_REASON_MODEL` | `nvidia/cosmos3-nano-reasoner` (workshop) or `nvidia/cosmos-reason2-8b` (build.nvidia.com) |
| `COSMOS_API_KEY` or `COSMOS_TOKEN_CMD` | Bearer token, or a command that prints it (output kept in memory only) |
| `NVIDIA_API_KEY` | build.nvidia.com key (hosted Cosmos + embeddings) |
| `COSMOS_EMBED_BASE` / `COSMOS_EMBED_MODEL` | Cosmos Embed endpoint, if available |

## Two-minute demo

1. **0:00–0:20 Open.** The app opens on a wide shot of the real ridge and burn cell, then glides to the drone and the fire front. "Real terrain, real drone pose, real footage."
2. **0:20–0:45 Scrub.** Press play or drag the timeline: the burn scar grows, flames move, charts follow. Press **2D** for the map view and toggle **Ground Truth** to compare the model (IoU 0.71 on the ground) with the manual annotation.
3. **0:45–1:15 Evidence.** Click the red **"Burned area +… m² in 60 s"** event. The camera flies there and **Drones** shows the replay at that second, with the model's review region boxed on the video and Cosmos's description in **Alerts**.
4. **1:15–1:40 Ask.** **Analysis** → *"How did the fire change during the recording?"*. The answer cites clips, and each citation seeks the video and map. **Evidence** → search *"dense smoke"*.
5. **1:40–2:00 Wrap.** Open **Notes**: sponsor integrations with live status, what is real vs approximate, and the evaluation numbers. Public good: responders get a georeferenced, time-aware picture from footage they already capture.

## Limitations (honest)

* RGB only: no temperatures. Smoke can hide or mimic burned ground; the 3-frame vote and monotonic accumulation reduce but don't remove this.
* Georeferencing assumes the video pose equals the photo pose (same hover) and a flat-ish DEM near the drone. It is approximate, with an unknown RMSE. The far field (above 21% of the frame) is excluded.
* Only the drone's field of view (~100 m) is observed. The planned burn-cell outline comes from the KML and is not an observation.
* The video's wall-clock start (12:33:00Z) is an assumption anchored to the photo metadata.
* The projection layer is a naive extrapolation for illustration only.

## Credits

BurnedAreaUAV, Ribeiro et al. 2023 (CC-BY-4.0) · AWS Terrain Tiles · Esri World Imagery · UI inspired by FireTrace (Dilum Sanjaya). The FireScope implementation is independent.
