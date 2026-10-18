"""Package the terrain and imagery of the Larouco incident, so the 3D view needs no third-party tile server.

    python -m pipeline.larouco.basemap

Everything is redistributable and credited in the app:
  · inner terrain (the analysis box, ~42 km): IGN/CNIG MDT25 (LiDAR-derived, 25 m), CC BY 4.0, via the IDEE WCS
  · inner imagery + a sharper patch over the scar: IGN PNOA orthophoto (PNOA-MA), CC BY 4.0, via the IGN WMS
    (flown before the fire: the burned ground comes from the reconstruction drawn on top)
  · outer rings (~160 km and ~600 km): AWS Terrain Tiles (Terrarium, open, attribution) and Sentinel-2 cloudless 2016
    by EOX (CC BY 4.0, contains modified Copernicus Sentinel data)
Terrain is stored Terrarium-encoded (R·256 + G + B/256 − 32768 m) in PNG on lon/lat-aligned grids; imagery as JPEG.
"""
from __future__ import annotations

import json
import math

import numpy as np
from PIL import Image

from .common import CACHE, OUT, RAW, write_json
from .download import UA, fetch

BM = OUT / "basemap"
BM.mkdir(parents=True, exist_ok=True)
TILES = RAW / "tiles"


def lon2x(lon, z): return (lon + 180) / 360 * 2 ** z
def lat2y(lat, z): r = np.radians(lat); return (1 - np.log(np.tan(r) + 1 / np.cos(r)) / np.pi) / 2 * 2 ** z


def mosaic(bbox, z, url, kind):
    """Fetch the XYZ tiles covering bbox into one array, plus the lon/lat → pixel mapping."""
    w, s, e, n = bbox
    x0, x1, y0, y1 = int(lon2x(w, z)), int(lon2x(e, z)), int(float(lat2y(n, z))), int(float(lat2y(s, z)))
    rows = []
    for y in range(y0, y1 + 1):
        row = []
        for x in range(x0, x1 + 1):
            f = fetch(url.format(z=z, x=x, y=y), TILES / kind / f"{z}_{x}_{y}.{'png' if kind == 'terrarium' else 'jpg'}")
            row.append(np.asarray(Image.open(f).convert("RGB")))
        rows.append(np.concatenate(row, 1))
    img = np.concatenate(rows, 0)
    return img, (lambda lon, lat: ((lon2x(lon, z) - x0) * 256, (lat2y(lat, z) - y0) * 256))


def resample(img, px, bbox, W, H, decode=None):
    """Bilinear-sample a mosaic onto a lon/lat-aligned W×H grid over bbox."""
    w, s, e, n = bbox
    lon = w + (np.arange(W) + 0.5) * (e - w) / W
    lat = n - (np.arange(H) + 0.5) * (n - s) / H
    X, _ = px(lon, np.full_like(lon, (s + n) / 2))
    _, Y = px(np.full_like(lat, (w + e) / 2), lat)
    src = decode(img) if decode else img.astype("float32")
    xs, ys = np.clip(X - 0.5, 0, src.shape[1] - 1.001), np.clip(Y - 0.5, 0, src.shape[0] - 1.001)
    xi, yi = xs.astype(int), ys.astype(int)
    fx, fy = xs - xi, ys - yi
    a = src[yi][:, xi]; b = src[yi][:, xi + 1]; c = src[yi + 1][:, xi]; d = src[yi + 1][:, xi + 1]
    fx, fy = fx[None, :], fy[:, None]
    if src.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def terrarium_decode(img):
    i = img.astype("float32")
    return i[..., 0] * 256 + i[..., 1] + i[..., 2] / 256 - 32768


def terrarium_encode(h):
    v = np.clip(h + 32768, 0, 65535.99)
    r = np.floor(v / 256); g = np.floor(v - r * 256); b = np.floor((v - r * 256 - g) * 256)
    return np.dstack([r, g, b]).astype("uint8")


def wcs_mdt(bbox, step=0.1):
    """MDT25 over bbox, assembled from WCS requests of `step` degrees, on its native ~25 m lon/lat grid."""
    import rasterio
    w, s, e, n = bbox
    res = 0.000225225225  # MDT25 in ETRS89 geographic
    W, H = int(math.ceil((e - w) / res)), int(math.ceil((n - s) / res))
    out = np.full((H, W), np.nan, "float32")
    for la in np.arange(s, n, step):
        for lo in np.arange(w, e, step):
            la1, lo1 = min(n, la + step), min(e, lo + step)
            f = fetch(f"https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=Elevacion4258_25"
                      f"&SUBSET=Lat({la:.4f},{la1:.4f})&SUBSET=Long({lo:.4f},{lo1:.4f})&FORMAT=image/tiff", TILES / "mdt25" / f"{la:.2f}_{lo:.2f}.tif")
            with rasterio.open(f) as r:
                a = r.read(1).astype("float32")
                if r.nodata is not None:
                    a[a == r.nodata] = np.nan
                c0, r0 = int(round((r.bounds.left - w) / res)), int(round((n - r.bounds.top) / res))
                hh, ww = min(a.shape[0], H - r0), min(a.shape[1], W - c0)
                if hh > 0 and ww > 0:
                    blk = out[r0:r0 + hh, c0:c0 + ww]
                    np.copyto(blk, a[:hh, :ww], where=np.isnan(blk))
    return out


def pnoa(bbox, size, name):
    """PNOA orthophoto over bbox as one size×size JPEG (WMS 1.3.0, EPSG:4326 → lat/lon axis order)."""
    w, s, e, n = bbox
    dest = BM / name
    if not dest.exists():
        url = (f"https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES="
               f"&CRS=EPSG:4326&BBOX={s},{w},{n},{e}&WIDTH={size}&HEIGHT={size}&FORMAT=image/jpeg")
        raw = fetch(url, TILES / "pnoa" / (name + ".src"))
        Image.open(raw).convert("RGB").save(dest, quality=84, optimize=True, progressive=True)
    return dest


def main():
    inc = json.loads((OUT / "incident.json").read_text())
    inner = tuple(inc["bbox"])
    cx, cy = inc["center"]
    # 1. inner terrain: MDT25 → 1281 × 1281 lon/lat grid (≈ 33 × 32 m), Terrarium PNG
    mdt = wcs_mdt(inner)
    print(f"MDT25 {mdt.shape}, {np.isnan(mdt).mean() * 100:.2f}% empty, {np.nanmin(mdt):.0f}–{np.nanmax(mdt):.0f} m")
    if np.isnan(mdt).any():   # outside Spain / gaps: fill from Terrarium
        t, px = mosaic(inner, 11, "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", "terrarium")
        fill = resample(t, px, inner, mdt.shape[1], mdt.shape[0], terrarium_decode)
        mdt = np.where(np.isnan(mdt), fill, mdt)
    N = 1281
    src_px = lambda lon, lat: ((lon - inner[0]) / (inner[2] - inner[0]) * mdt.shape[1], (inner[3] - lat) / (inner[3] - inner[1]) * mdt.shape[0])  # noqa: E731
    dem = resample(mdt, src_px, inner, N, N)
    Image.fromarray(terrarium_encode(dem)).save(BM / "dem_inner.png", optimize=True)
    # 2. inner imagery (PNOA, 4096², ≈ 10 m) and a 4096² patch over the scar (≈ 7 m)
    pnoa(inner, 4096, "img_inner.jpg")
    xs, ys = [], []
    def walk(c):
        if isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else: [walk(q) for q in c]
    walk(inc["reference_perimeter"]["geometry"]["coordinates"])
    patch = (min(xs) - 0.02, min(ys) - 0.015, max(xs) + 0.02, max(ys) + 0.015)
    pnoa(patch, 4096, "img_scar.jpg")
    # 3. outer rings: Terrarium DEM + Sentinel-2 cloudless 2016 (EOX), same boxes as the app's LOD rings
    rings = []
    for k, (hx, hy, demZ, imgZ, n_dem, n_img) in enumerate([(0.95, 0.72, 9, 10, 640, 2048), (3.6, 2.7, 6, 7, 384, 1024)]):
        b = (cx - hx, cy - hy, cx + hx, cy + hy)
        t, px = mosaic(b, demZ, "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", "terrarium")
        Image.fromarray(terrarium_encode(resample(t, px, b, n_dem, n_dem, terrarium_decode))).save(BM / f"dem_ring{k}.png", optimize=True)
        im, px = mosaic(b, imgZ, "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg", "s2cloudless")
        Image.fromarray(np.clip(resample(im, px, b, n_img, n_img), 0, 255).astype("uint8")).save(BM / f"img_ring{k}.jpg", quality=82, optimize=True, progressive=True)
        rings.append({"bbox": [round(v, 6) for v in b], "dem": f"basemap/dem_ring{k}.png", "imagery": f"basemap/img_ring{k}.jpg"})
    basemap = {
        "inner": {"bbox": list(inner), "dem": "basemap/dem_inner.png", "imagery": "basemap/img_inner.jpg"},
        "patch": {"bbox": [round(v, 6) for v in patch], "imagery": "basemap/img_scar.jpg"},
        "rings": rings, "encoding": "terrarium",
        "credits": ["Elevation: IGN/CNIG MDT25 (CC BY 4.0), AWS Terrain Tiles", "Imagery: IGN PNOA (CC BY 4.0), Sentinel-2 cloudless 2016 by EOX (CC BY 4.0)"],
    }
    inc["basemap"] = basemap
    inc["attribution"] = [a for a in inc["attribution"] if not a.startswith(("Elevation:", "Imagery:"))] + basemap["credits"]
    write_json(OUT / "incident.json", inc)
    for f in sorted(BM.iterdir()):
        print(f"  {f.name:18s} {f.stat().st_size / 1e6:6.2f} MB")
    write_json(CACHE / "basemap.json", basemap, indent=1)


if __name__ == "__main__":
    main()
