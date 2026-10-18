# Larouco 2025: reconstructing a large wildfire from open satellite data

This pipeline builds the `larouco-2025-08` incident package. It reconstructs when each 30 m cell of the August 2025 Larouco fire (Ourense, Galicia) burned, and how badly. It uses only open data that needs no account or key.

```bash
# Python 3.11+: pip install -r pipeline/requirements.txt
python -m pipeline.larouco.download      # ~1.5 GB into data/raw/larouco/ (gitignored, mostly EMS products); idempotent
python -m pipeline.larouco.progression   # arrival time + validation → data/cache/larouco/
python -m pipeline.larouco.severity      # Sentinel-2 dNBR → data/cache/larouco/
python -m pipeline.larouco.basemap       # MDT25 + PNOA + horizon → data/processed/larouco/basemap/ (≈13 MB)
python -m pipeline.larouco.scenario      # retrospective spread scenario → data/cache/larouco/
# optional, needs a free EUMETSAT LSA SAF account (credentials only from the environment):
#   LSASAF_USER=… LSASAF_PASSWORD=… python -m pipeline.larouco.meteosat download
#   python -m pipeline.larouco.meteosat process && python -m pipeline.larouco.progression
python -m pipeline.larouco.package       # → data/processed/larouco/ (≈16 MB with the basemap, committed)
node frontend/scripts/export-static.mjs  # → frontend/public/incidents/larouco-2025-08/
```

## Inputs

| Source | What it gives | Licence |
|---|---|---|
| NASA FIRMS, Spain 2025 country files: VIIRS S-NPP 375 m and MODIS 1 km | 1,914 active-fire detections inside the scar, with time and fire radiative power | Open (cite LANCE/FIRMS) |
| Copernicus EMS Rapid Mapping **EMSR837**, AOI01 "Ourense Province" | 12 dated delineations (13–30 Aug 2025), with image footprints and "not analysed" masks | © European Union, attribution |
| Sentinel-2 L2A via the Element 84 Earth Search STAC on AWS | B8A, B12, scene classification and true colour on 1 Aug and 5 Sep 2025 | Copernicus Sentinel data, free and open |
| ERA5 hourly reanalysis via the Open-Meteo archive API | Temperature, humidity, wind, gusts, VPD and soil moisture at the scar's centre | Copernicus C3S, attribution |

The analysis grid is 1,403 × 1,365 cells of 30 m in ETRS89 / UTM 29N (`common.py`).

## Method (`progression.py`)

1. **Scar.** The connected burnt area of the last EMS delineation (monitoring 9, 30 Aug) that contains Larouco: **33,132 ha**.
2. **First detection.** Each FIRMS detection marks a disc as burning at its pass time.
   - VIIRS discs have the pixel's area. MODIS discs cover only the central 30 % of the pixel.
   - A cell's arrival is its first detection: 70 % of the scar is detected at least once.
3. **Gaps.** Cells never detected are interpolated from the 8 nearest detected cells (inverse distance).
4. **Dated perimeters.** Inside an EMS perimeter, within that image's footprint, a cell must have burned by the image time. Inside the footprint but outside the perimeter, it burned after.
   - A scar does not un-burn. If a later product misses a cell an earlier one mapped, the later one is treated as an omission.
   - An estimate outside its bounds moves to the middle of the window they leave, capped at 24 h. Moving it to the edge would pile every such cell onto the image time and create a fake "run".
5. **Smoothing.** σ = 150 m (about a VIIRS pixel) inside the scar, then the bounds again.

## Validation

Each intermediate perimeter was held out in turn and compared with the reconstruction built from the others. The score is the IoU inside that image's footprint.

| Perimeter | Image | Burned by then | Image covers | IoU (held out) | IoU (FIRMS only) |
|---|---|---|---|---|---|
| DEL_PRODUCT | 16 Aug 11:21, Sentinel-2 | 16 % | 89 % of the scar | **0.78** | 0.76 |
| DEL_MONIT01 | 20 Aug 11:24, SPOT 6/7 | 44 % | 53 % | **0.85** | 0.84 |
| DEL_MONIT02 | 21 Aug 11:21, Sentinel-2 | 92 % | 98 % | **0.94** | 0.94 |

The mean is 0.86, or 0.85 with the satellite detections alone. The method's parameters were picked among 18 combinations on these same scores, so the numbers are slightly optimistic.

The plan proposed validating on a GOFER fire in California. This validation is on the same fire, against independent high-resolution imagery, which is a stronger test. GOFER remains a possible second check.

## Derived series (`package.py`)

| Series | How it is computed |
|---|---|
| Hourly burned area | Cells with arrival ≤ t |
| Area reached in the previous 6 h | Cells with arrival in that window |
| Expansion rate | Growth of the equivalent radius √(A/π) over 6 h: the speed of the scar as a whole, lower than the head-fire speed |
| Spread direction | Gradient of the arrival field smoothed at 1 km |
| Fire radiative power | Sum over the latest pass within 12 h |
| Front centre and radius | The area reached in the previous 6 h; the simulated drones and aircraft work there |

The data cannot place a front line: passes are hours apart and pixels are 375 m to 1 km. A gradient-based rate of spread at 30 m only measures the smoothing between passes, so it is not published.

Events are computed and all need review:
- the first detection;
- area milestones and the four fastest 6 h runs;
- the most intense pass;
- every EMS perimeter that grows the scar;
- when growth fell below 50 ha a day;
- the strongest ERA5 gusts and the driest hour.

## Severity (`severity.py`)

dNBR is computed between 1 Aug and 5 Sep 2025, with Key & Benson classes.
- **Pre-fire scene.** 11 Aug, the last pass before the fire, has a smoke plume from other fires over the southern half, so 1 Aug is used.
- **Result.** 69.6 % of the scar is high severity, 22.4 % moderate-high and 6.2 % moderate-low. The mean dNBR is 0.76.

## Terrain and imagery (`basemap.py`)

The incident ships its own map, so the 3D view needs no tile server.

| Area | Terrain | Imagery |
|---|---|---|
| Fire area (42 × 41 km) | IGN/CNIG **MDT25**, 1281² Terrarium PNG | IGN **PNOA** orthophoto, 4096² JPEG, plus a 4096² patch over the scar (≈7 m) |
| Outer rings (~160 km and ~600 km) | AWS Terrain Tiles | Sentinel-2 cloudless 2016 by EOX |

Everything is CC BY 4.0 or open with attribution, and credited in the app. PNOA was flown before the fire; the burned ground is drawn on top from the reconstruction.

## Spread scenario, a hindcast (`scenario.py`)

Could fuels, terrain and weather alone have reproduced the fire? The model:
- **Spread:** time-dependent least travel time on 90 m cells. The rate is R0 · fuel (ESA WorldCover class) · wind (ERA5 hourly speed and direction, elliptical with a backing floor) · slope (MDT25) · dryness (ERA5 VPD).
- **Ignition:** the first 6 h of the reconstruction.
- **Calibration:** one free parameter, R0 = 34 m/h, set so the burned area matches the first EMS perimeter (16 Aug, 5,219 ha). From there it runs freely.
- **Not modelled:** suppression and spotting.

| Perimeter | IoU | Scenario reached (recall) | Scenario that really burned (precision) | Scenario vs mapped |
|---|---|---|---|---|
| 20 Aug | 0.25 | 0.49 | 0.33 | 21,979 vs 14,682 ha |
| 21 Aug | 0.24 | 0.36 | 0.43 | 25,646 vs 30,621 ha |
| 22 Aug | 0.24 | 0.38 | 0.41 | 30,778 vs 32,769 ha |
| 26 Aug | 0.27 | 0.61 | 0.32 | 63,094 vs 33,124 ha |

The answer is no, not well:
- **Direction.** The 25 km reanalysis wind is light and variable, so the model spreads almost evenly in every direction, too far south and west, and misses the fast run to the north-north-east.
- **Size.** With no suppression it ends at 74,000 ha against 33,132 ha.
- **Timing.** Where both burned, the timing differs by a median of 76 h.

A variant with ERA5 gusts instead of the mean wind scored about the same. The model was fixed before scoring, so that variant is not used. In the app, this is the "Spread Scenario (hindcast)" layer and the dashed line on the Burned Area chart.

## Meteosat (`meteosat.py`, optional)

EUMETSAT LSA SAF FRP-PIXEL (LSA-502, CC BY 4.0) detects fire every 15 min with ~3–4 km pixels.
- **Account.** It needs a free account. The downloader reads `LSASAF_USER` / `LSASAF_PASSWORD` from the environment and stores no credentials.
- **Timing.** With the files present, `progression.py` moves a cell first seen by a polar pass to Meteosat's first detection over it since the previous pass, and reports the hold-out IoU with and without it.
- **Fire power.** `package.py` adds a 15-min fire-power series.

## Limits

- **Timing.** Timing between satellite passes is interpolated. There are about six passes a day: VIIRS S-NPP, Terra and Aqua MODIS. NOAA-20/21 VIIRS are not in the open country files.
- **Ignition.** The first detection is not the ignition: satellites see a fire once it is large and hot enough.
- **Smoke and spot fires.** Neither is measured. Smoke columns in the app are drawn where the front is and lean with the ERA5 wind.
- **Weather.** ERA5 is a ~25 km cell, not an on-site station.
- **Drones and resources.** The fleet and resources around this fire are a simulated exercise (tagged SIM) that follows the reconstructed front. No video of this fire is published here.
