# FireScope 3D

> 🌐 **Demo:** https://aleetreny.github.io/FireScope-3D/ — runs entirely in your browser: no server, no keys.
>
> 📘 Pitch y explicación completa (ES): [docs/PITCH_Y_FUNCIONAMIENTO.md](docs/PITCH_Y_FUNCIONAMIENTO.md) · 🗺️ Plan de mejora: [docs/PLAN_DE_MEJORA.md](docs/PLAN_DE_MEJORA.md)

**We turn wildfire drone footage into a time-aware 3D operational picture.**

FireScope 3D takes drone video of a fire, measures what the camera sees (burned ground, flames, smoke), projects it onto real terrain, and lets you scrub through time, click an event to see the exact video evidence, search the footage and ask questions about the incident in English or Spanish.

It ships two incidents (switch with the incident menu in the top bar, or `?incident=`):

| Incident | Scale | What is real |
|---|---|---|
| **Pinhão Cell Burn**, Portugal, 1 Mar 2019 (`?incident=pinhao-2019-03-01`) | A drone's view: 15 min, ~0.2 ha burned in view | Drone video, camera pose, segmentation evaluated against hand-drawn masks |
| **Larouco Wildfire**, Ourense, Spain, 13–27 Aug 2025 (default) | 33,132 ha over 14 days, 42 × 41 km of terrain | When each 30 m cell burned, reconstructed from NASA FIRMS and Copernicus EMS perimeters and validated against them; Sentinel-2 burn severity; ERA5 weather |

The interface recreates the "FireTrace" wildfire forensic prototype (Dilum Sanjaya / Claude, shared by Anthropic). Its layout is a full-bleed 3D terrain with a right-hand layers and incident panel, a bottom timeline with linked charts and a key-events column, Incident / Drones / Resources modes, a drone camera window, and 2D/3D map switching. Here it runs on **real data**.

> Exploratory decision-support prototype. **Not** a certified emergency-management or fire-spread prediction system.

---

## Pinhão: what you are looking at

| | Source | Status |
|---|---|---|
| Drone footage | **BurnedAreaUAV v1.1** (Zenodo 7944963, CC-BY-4.0): 15 min of RGB video of a prescribed burn at Torre do Pinhão, Portugal, from a hovering DJI Phantom 4 Pro | Real, replayed as **DRONE REPLAY**, never labelled live |
| Camera pose | DJI XMP metadata of the dataset's photos (GPS, 24.9 m AGL, gimbal yaw −46.7°, pitch −28.9°, calibrated focal length) | Real |
| Terrain | AWS Terrain Tiles (Terrarium) DEM in three rings of detail out to ~70 km; Esri World Imagery drives the stylized ground and vegetation | Real elevation, stylized rendering, **1.8× vertical exaggeration (labelled)** |
| Burned area / flames | `backend/firescope/segment.py`: RGB segmentation with temporal accumulation | Model output, **evaluated against the manual masks** (below) |
| Georeferencing | Pinhole camera, rays marched onto the DEM (`geo.py`) | **Approximate** (`camera_model_dem`) |
| Events | Measured changes: area growth, flames outside the scar, smoke surges, peak flame extent | Derived, `confidence: null`, `review_required: true` |
| Rate of spread | Leading edge of the burned outline vs one minute earlier (90th percentile of the displacement, `frontend/scripts/lib/front-advance.mjs`): mean 2.8 m/min, peak 10.4 m/min | Derived, visible front only |
| Ask | Incident analyst in the browser (`frontend/src/agent/analyst.ts`): detects the intent of the question (where, when, how much, fastest growth, spot fires, smoke, weather, drone, accuracy, risk, resources…), answers from the recorded data in English or Spanish, and cites the clips it used | Derived. Rule-based, **no language model, nothing generated** |
| Search | Keyword search (EN/ES) over the recorded events and per-clip measurements (`frontend/src/agent/search.ts`) | Derived. Searches what was measured, not the pixels |
| Hotspots | Visible-flame blob centroids. **RGB cannot measure temperature**, so `temperature_c` is always `null` | Model |
| Weather card | ERA5 reanalysis via Open-Meteo for the site and hour | External (reanalysis, not on-site) |
| Drones FT-02…FT-06, Resources (13 units), drops, fire lines, large-fire scenario | Deterministic exercise around the real incident; sim drone cameras render the 3D twin | **Simulated**, tagged SIM in the UI, never a forecast |
| Trees, smoke particles | Rendered for readability | Stylized |

Every metric in the UI carries a provenance chip (`model`, `derived`, `ground_truth`, `external`, `sim`), and the **About** tab lists how each part was produced.

## Larouco: a whole wildfire from open satellite data

The pipeline (`pipeline/larouco/`, see its [README](pipeline/larouco/README.md)) only uses open data that needs no account. It downloads the inputs, reconstructs when each 30 m cell burned, computes severity and writes a ~2 MB package.

| | Source | Status |
|---|---|---|
| Burnt area | Copernicus EMS EMSR837: 12 dated delineations, 13–30 Aug 2025 (Sentinel-2, SPOT 6/7, WorldView-2, Legion) | External: **33,132 ha** |
| When each place burned | First NASA FIRMS detection of each 30 m cell (VIIRS 375 m, MODIS 1 km); gaps interpolated; bounded by every dated EMS perimeter | Derived. Each perimeter held out in turn: **IoU 0.78 / 0.85 / 0.94** on 16 / 20 / 21 Aug |
| Expansion rate | Growth of the equivalent radius √(area/π) over 6 h, peaking at 4 m/min | Derived: the speed of the scar as a whole, lower than the head-fire speed. No front line is drawn, because passes are hours apart |
| Fire power | FIRMS fire radiative power per pass, up to 33 GW on 17 Aug | External |
| Burn severity | Sentinel-2 dNBR, 1 Aug vs 5 Sep 2025 | Derived: 70 % high severity |
| Events | 19 computed events: first detection, area milestones, the fastest 6 h runs, the most intense pass, perimeters, weather extremes | Derived, all need review |
| Weather | ERA5 hourly via Open-Meteo | External (reanalysis) |
| Drones, aircraft, ground units | The same exercise, re-tasked for the large fire: they follow the reconstructed front, and aircraft fly in daylight only | **Simulated**, tagged SIM |
| Spread scenario (hindcast) | Fuels (ESA WorldCover 10 m), slope (MDT25) and the hourly ERA5 wind and dryness, calibrated only on the 16 Aug perimeter, then run freely | Model, **not what happened**: IoU 0.25 / 0.24 / 0.24 against the 20 / 21 / 22 Aug perimeters. It spreads almost evenly in every direction and misses the run north, and burns 74,000 ha with no suppression |
| Terrain and imagery | IGN/CNIG MDT25 and PNOA orthophoto (CC BY 4.0) over the fire; AWS Terrain Tiles and Sentinel-2 cloudless 2016 (EOX) for the horizon | Packaged with the incident (~13 MB): no tile server at runtime |
| Video | None published: real footage of this fire needs its owners' permission | — |

In the app:
- **Fire on the terrain.** The reconstructed fire grows hour by hour over 42 × 41 km. A glowing front marks the last 3 h and embers the last half day, and fresh char turns to ash.
- **Map layers.** The dated EMS perimeter, FIRMS detections (shown for 12 h after each pass), daily isochrones and a severity tint.
- **Smoke.** Columns lean with the ERA5 wind of that hour.
- **Timeline.** It runs at 15 min to 4 h of fire time per second. The charts show burned area, expansion rate and fire power.
- **Ask and Search.** They answer from the reconstruction and cite moments on the timeline.

## Any device

The interface is in English. The analyst still replies in Spanish when asked in Spanish. The layout adapts to the screen (`frontend/src/lib/layout.ts`):

| Screen | Layout |
|---|---|
| Desktop (≥ 1100 px) | Map, right panel and the timeline with charts, side by side |
| Tablet (700–1100 px) | Same layout. The right panel becomes a drawer over the map, and the top bar shows icons only |
| Phone, portrait | Full-screen map. A bottom sheet keeps the playback bar always visible. Drag or tap it for Events, Charts, Layers, Ask, Search and About; the tabs change with the mode. The 3D view re-centres above the sheet |
| Phone, landscape | The open sheet becomes a full-height panel on the left half, leaving the map, the camera and its controls on the right |

On every screen:
- **Drone camera:** the HUD and its bar drop secondary readouts as the window narrows. Detection labels are placed clear of the HUD rows.
- **Charts:** time labels thin out when a chart is narrow.
- **Map credits:** they wrap beside the map controls, which are measured rather than assumed. On a phone they fit one line, and a tap shows them in full.
- **Touch:** tap the terrain for the same details you get by hovering on a desktop.
- **Accessibility:** visible keyboard focus, and the timeline is a slider (arrow keys, Shift for 60 s, `[` `]` Home End). Respects `prefers-reduced-motion`, and a text summary of the incident is available to screen readers.

`node frontend/scripts/audit/devices.mjs <url> <out>` checks 8 phones and tablets with touch emulation (16 phone states, 6 tablet states).

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
 OFFLINE (once per incident)                              STATIC SITE (GitHub Pages)
 ┌──────────────────────────────────────┐                ┌───────────────────────────────────────────┐
 │ backend/firescope/pipeline.py         │                │ incidents/index.json                      │
 │  video → frames every 4 s → masks     │  export-static │ incidents/<id>/manifest.json  (methods,   │
 │  (burned / flame / smoke, accumulated)│ ─────────────▶ │   attribution) · incident · sources ·     │
 │  → pinhole camera + DEM ray cast      │   (npm build)  │   timeline · events · observations ·      │
 │  → GeoJSON polygons, timeline, events │                │   weather · clips · eval · media/ (video, │
 │  → eval vs manual masks · ERA5        │                │   thumbnails)                             │
 └──────────────────────────────────────┘                └──────────────────────┬────────────────────┘
                                                                                ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ React + Three.js dashboard: DEM terrain in LOD rings · draped fire-mask shader · bloom flames ·     │
 │ smoke · drone + frustum · timeline (master clock) · charts · drone feed synced to the timeline ·    │
 │ incident analyst + search in the browser (src/agent) · simulated ops (src/sim) · presentation mode  │
 └────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

* **Frontend** (`frontend/`): React 19, TypeScript, Vite, Three.js (custom terrain shader, draped canvas masks for burned / active / change, UnrealBloom, GPU point-sprite flames and smoke, instanced vegetation), Zustand. The timeline is the single clock: map overlays, charts, events, the drone video and the panels all follow it.
* **Data client** (`frontend/src/api/client.ts`): static mode by default (reads `incidents/<id>/`, chosen with `?incident=<id>` or the index default); optional API mode against the FastAPI backend with `VITE_API_BASE`.
* **Pipeline / optional backend** (`backend/firescope/`): `pipeline.py` (video → masks → polygons → timeline/events/eval), `geo.py` (DEM + camera), `segment.py`, `weather.py`, `app.py` (FastAPI, `docs/api-contract.md`). The hackathon's NVIDIA adapters (`nvidia.py`, `cosmos_job.py`) are still in the tree but unused by the demo.

## Run it

```bash
cd frontend && npm install
npm run dev                  # static demo on the exported incident → http://localhost:5173
npm run build                # → dist/ (what GitHub Pages serves; relative paths, works under any sub-path)
```

`npm run dev` and `npm run build` first run `scripts/export-static.mjs`, which packages `data/processed/drone_replay_01/` and `media/` into `public/incidents/`.

To recompute the data from the original dataset:

```bash
# data (≈1 GB, CC-BY-4.0): KML, photo metadata and the video/masks archive from Zenodo 7944963
mkdir -p data/raw/burnedareauav && cd data/raw/burnedareauav
for f in pinhao_cell_precribed_area.kml uav_photo_1_metadata.JPG BurnedAreaUAV_dataset_v1.rar; do curl -LO "https://zenodo.org/api/records/7944963/files/$f/content" -o $f; done
bsdtar -xf BurnedAreaUAV_dataset_v1.rar && cd ../../..
cd backend && uv venv && uv pip install -r requirements.txt
.venv/bin/python -m firescope.pipeline        # CV + georeferencing + eval (~15 s) → data/processed/
.venv/bin/uvicorn firescope.app:app --port 8000   # optional: the same UI against the API → VITE_API_BASE=http://localhost:8000 npm run dev
```

The browser video is a 960×540 H.264 copy at `media/drone_replay_01.mp4` (two-pass ~520 kb/s so it fits GitHub's 100 MB file limit):
`ffmpeg -i <original> -an -vf "scale=960:540:flags=lanczos,hqdn3d=1.5:1.5:4:4" -c:v libx264 -preset slow -b:v 520k -maxrate 900k -bufsize 1800k -g 100 -pass 1|2 -movflags +faststart media/drone_replay_01.mp4`

## Tests

```bash
cd frontend
node scripts/e2e.mjs 'http://localhost:4173/<base>/?nointro'                 # 76 checks: layout at 6 viewports + functional walk + FPS
URL='http://localhost:4173/<base>/?nointro' node scripts/present-test.mjs out   # presentation mode, all 18 chapters
node scripts/audit/states.mjs '<url>' out                                       # overlap / clipping sweep (see scripts/audit/README.md)
cd ../backend && python -m pytest -q                                            # pipeline + API tests
```

## Publish (GitHub Pages)

Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml): it exports the incident package, builds the dashboard with relative paths (so it works under any repository name) and deploys it to GitHub Pages. The Larouco incident ships its own terrain and imagery; the Pinhão drone incident still streams its tiles from public servers in the browser.

## Limitations (honest)

* RGB only: no temperatures. Smoke can hide or mimic burned ground; the 3-frame vote and monotonic accumulation reduce but don't remove this.
* Georeferencing assumes the video pose equals the photo pose (same hover) and a flat-ish DEM near the drone. It is approximate, with an unknown RMSE. The far field (above 21% of the frame) is excluded.
* Only the drone's field of view (~100 m) is observed. The planned burn-cell outline comes from the KML and is not an observation.
* The video's wall-clock start (12:33:00Z) is an assumption anchored to the photo metadata.
* The analyst and search work on the recorded measurements and events only; they cannot answer about things that were not measured.
* The large-fire scenario, fleet and resources are an illustrative simulation.
* **Larouco:**
  * Timing between satellite passes (about six a day) is interpolated, and the first detection is not the ignition.
  * The scar's own EMS perimeters were used to pick the method's parameters, so the IoU is slightly optimistic.
  * Smoke and spot fires are not measured.
  * The spread scenario has no suppression and no spotting, and uses one reanalysis wind for the whole box.
  * The fleet and resources around it are an exercise, not the real operation, and the app has no data on people or houses.

## History

FireScope 3D was built in a day at the **VAST Builders Challenge (17 Oct 2026)**. There, clip descriptions and video search ran live on NVIDIA Cosmos Reason / Cosmos Embed1 on the event's Kubernetes cluster. That cluster is gone and those outputs were not kept, so they are not reproduced here: [docs/historia-hackathon.md](docs/historia-hackathon.md).

## Credits

BurnedAreaUAV, Ribeiro et al. 2023 (CC-BY-4.0) · Copernicus Emergency Management Service (© 2025 European Union), EMSR837 · NASA FIRMS (LANCE) · contains modified Copernicus Sentinel data (2025) · ERA5 (Copernicus C3S) via Open-Meteo · AWS Terrain Tiles · Esri World Imagery · UI inspired by FireTrace (Dilum Sanjaya). The FireScope implementation is independent.
