"""Sentinel-2 true colour on every clear-enough pass during the fire: what the satellite saw, as a dated map layer.

    python -m pipeline.larouco.s2series          # download + package (no account needed)

Each pass is the L2A true-colour product (TCI, "visual") of tiles 29TPG + 29TPH, read from its 20 m overview on the
Element 84 Earth Search STAC (AWS open data) and warped to the same lon/lat box as the packaged PNOA imagery, so the
3D map drapes it exactly like the basemap. Output: data/processed/larouco/s2/<yyyymmdd>.jpg + cache/s2series.json.
Copernicus Sentinel data 2025 (free, full and open; attribution required).
"""
from __future__ import annotations

import json
import urllib.request

import numpy as np
from PIL import Image

from .common import CACHE, OUT, write_json

STAC = "https://earth-search.aws.element84.com/v1/search"
UA = {"User-Agent": "FireScope3D-pipeline/1.0"}
# every pass over the scar from the day before ignition to the end of the timeline (cloud cover from the STAC metadata)
PASSES = ["20250811", "20250813", "20250816", "20250821", "20250823", "20250826"]
SIZE = 2048            # ≈ 21 m per pixel over the 43 × 42 km box
DEST = OUT / "s2"


def items_for(day: str):
    body = json.dumps({"collections": ["sentinel-2-l2a"], "bbox": [-7.30, 42.24, -6.80, 42.60],
                       "datetime": f"{day[:4]}-{day[4:6]}-{day[6:]}T00:00:00Z/{day[:4]}-{day[4:6]}-{day[6:]}T23:59:59Z", "limit": 20}).encode()
    req = urllib.request.Request(STAC, data=body, headers={**UA, "Content-Type": "application/json"})
    feats = json.loads(urllib.request.urlopen(req, timeout=120).read())["features"]
    # one product per tile (the latest processing baseline)
    by_tile = {}
    for f in sorted(feats, key=lambda f: f["id"]):
        by_tile[f["properties"].get("grid:code", f["id"][4:9])] = f
    return list(by_tile.values())


def warp(items, bbox):
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject

    w, s, e, n = bbox
    dst_t = from_bounds(w, s, e, n, SIZE, SIZE)
    out = np.zeros((3, SIZE, SIZE), "uint8")
    have = np.zeros((SIZE, SIZE), bool)
    for it in items:
        href = it["assets"]["visual"]["href"]
        with rasterio.open(href, overview_level=0) as src:          # the 20 m overview: 4× less to read than 10 m
            for b in range(3):
                dst = np.zeros((SIZE, SIZE), "uint8")
                reproject(rasterio.band(src, b + 1), dst, src_nodata=0, dst_nodata=0, dst_transform=dst_t, dst_crs="EPSG:4326",
                          resampling=Resampling.bilinear)
                fill = (~have) & (dst > 0)
                out[b][fill] = dst[fill]
            have |= out.max(0) > 0
    return out.transpose(1, 2, 0), have


def main():
    inc = json.loads((OUT / "incident.json").read_text())
    bbox = inc["basemap"]["inner"]["bbox"]
    DEST.mkdir(parents=True, exist_ok=True)
    passes = []
    for day in PASSES:
        items = items_for(day)
        dest = DEST / f"{day}.jpg"
        if not dest.exists():
            rgb, have = warp(items, bbox)
            Image.fromarray(rgb).save(dest, quality=82, optimize=True, progressive=True)
            print(f"  {day}: {len(items)} tiles, {have.mean() * 100:.0f}% covered → {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)", flush=True)
        t = max(it["properties"]["datetime"] for it in items)
        cloud = float(np.mean([it["properties"].get("eo:cloud_cover", np.nan) for it in items]))
        passes.append({"date": day, "time": t[:19] + "Z", "image": f"s2/{day}.jpg", "cloud_cover_pct": round(cloud, 1),
                       "products": [it["id"] for it in items]})
    write_json(CACHE / "s2series.json", {"bbox": bbox, "size": SIZE, "passes": passes,
                                         "credit": "Contains modified Copernicus Sentinel data 2025 (Sentinel-2 L2A true colour, via Earth Search on AWS)"}, indent=1)
    print(f"{len(passes)} passes → {DEST}")


if __name__ == "__main__":
    main()
