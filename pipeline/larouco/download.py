"""Download every input of the Larouco reconstruction. Idempotent: files already on disk are kept.

    python -m pipeline.larouco.download

Sources (all open, no account or key needed):
  · NASA FIRMS active-fire detections, Spain 2025: VIIRS S-NPP 375 m and MODIS Terra/Aqua 1 km (country CSV files)
  · Copernicus EMS Rapid Mapping EMSR837, AOI01 "Ourense Province": delineation products (dated burnt-area
    perimeters, image footprints) and the grading product
  · Sentinel-2 L2A (Copernicus, via the Element 84 Earth Search STAC on AWS): B8A, B12, SCL and true colour, before and
    after the fire, read as windows straight from the cloud-optimised GeoTIFFs and resampled onto the analysis grid
  · ERA5 hourly reanalysis via the Open-Meteo archive API, at the centre of the analysis box (the middle of the scar)
"""
from __future__ import annotations

import json
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

from .common import EMS_AOI, EMS_CODE, GRID, RAW

UA = {"User-Agent": "FireScope3D-pipeline/1.0 (+https://github.com/aleetreny/FireScope-3D)"}


def fetch(url: str, dest: Path, data: bytes | None = None, headers: dict | None = None, tries=3) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=600) as r:
                tmp = dest.with_suffix(dest.suffix + ".part")
                tmp.write_bytes(r.read())
                tmp.rename(dest)
            return dest
        except Exception as e:  # noqa: BLE001 — network: retry, then fail loudly
            if k == tries - 1:
                raise RuntimeError(f"download failed: {url}: {e}") from e
            time.sleep(3 * (k + 1))
    return dest


# ------------------------------------------------------------------------------------------- FIRMS
FIRMS = {
    "viirs-snpp": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2025/viirs-snpp_2025_Spain.csv",
    "modis": "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2025/modis_2025_Spain.csv",
}


def firms():
    for k, u in FIRMS.items():
        fetch(u, RAW / "firms" / f"{k}.csv")


# --------------------------------------------------------------------------------------------- EMS
def ems():
    act = fetch(f"https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code={EMS_CODE}", RAW / "ems" / "activation.json")
    r = json.loads(act.read_text())["results"][0]
    aoi = next(a for a in r["aois"] if a["number"] == EMS_AOI)
    for p in aoi["products"]:
        z = fetch(p["downloadPath"], RAW / "ems" / Path(p["downloadPath"]).name)
        out = RAW / "ems" / "x" / z.stem
        if not out.exists():
            with zipfile.ZipFile(z) as f:
                f.extractall(out)


# -------------------------------------------------------------------------------------- Sentinel-2
# Clear scenes either side of the fire, checked over the scar (scene classification and blue-band haze): 11 Aug, the
# last pass before the fire, has a smoke plume from other fires over the southern half, so the pre-fire scene is 1 Aug.
# The first satellite detection inside the scar is on 13 Aug; the last perimeter change is on 26 Aug.
S2_SCENES = {
    "pre": ["S2C_29TPG_20250801_0_L2A", "S2C_29TPH_20250801_0_L2A"],
    "post": ["S2B_29TPG_20250905_0_L2A", "S2B_29TPH_20250905_0_L2A"],
}
S2_BANDS = ["nir08", "swir22", "scl", "red", "green", "blue"]


def s2():
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    for when, ids in S2_SCENES.items():
        dest = RAW / "s2" / f"{when}.npz"
        if dest.exists():
            continue
        body = json.dumps({"collections": ["sentinel-2-l2a"], "ids": ids}).encode()
        items = json.loads(urllib.request.urlopen(urllib.request.Request("https://earth-search.aws.element84.com/v1/search", data=body, headers={**UA, "Content-Type": "application/json"}), timeout=120).read())["features"]
        bands = {}
        for b in S2_BANDS:
            acc = np.full((GRID.H, GRID.W), np.nan, "float32")
            for it in sorted(items, key=lambda f: f["id"]):
                with rasterio.open(it["assets"][b]["href"]) as src:
                    dst = np.full((GRID.H, GRID.W), np.nan, "float32")
                    reproject(rasterio.band(src, 1), dst, src_nodata=0, dst_nodata=np.nan, dst_transform=GRID.transform, dst_crs="EPSG:25829",
                              resampling=Resampling.nearest if b == "scl" else Resampling.bilinear)
                    acc = np.where(np.isnan(acc), dst, acc)
            bands[b] = acc
            print(f"  s2 {when} {b}: {np.isfinite(acc).mean() * 100:.0f}% of the grid")
        dest.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(dest, ids=np.array([it["id"] for it in items]), dates=np.array([it["properties"]["datetime"] for it in items]), **bands)


# ----------------------------------------------------------------------------------------- weather
ERA5_VARS = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
             "vapour_pressure_deficit", "soil_moisture_0_to_7cm", "precipitation"]


def weather(lon: float, lat: float, start="2025-08-10", end="2025-08-28"):
    url = (f"https://archive-api.open-meteo.com/v1/era5?latitude={lat:.4f}&longitude={lon:.4f}&start_date={start}&end_date={end}"
           f"&hourly={','.join(ERA5_VARS)}&wind_speed_unit=kmh&timezone=GMT")
    return fetch(url, RAW / "weather" / f"era5_{lat:.3f}_{lon:.3f}.json")


def main():
    print("FIRMS"); firms()
    print("Copernicus EMS"); ems()
    print("Sentinel-2"); s2()
    print("ERA5")
    from .common import TO_LL
    cx, cy = TO_LL.transform(GRID.x0 + GRID.W * GRID.res / 2, GRID.y0 - GRID.H * GRID.res / 2)
    weather(cx, cy)
    print("done")


if __name__ == "__main__":
    main()
