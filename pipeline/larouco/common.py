"""Shared paths and the analysis grid for the Larouco 2025 reconstruction.

Everything is computed on one regular grid in ETRS89 / UTM 29N (EPSG:25829), the official projection for Galicia,
so distances and areas are in metres. Raw downloads live in data/raw/larouco/ (gitignored, re-downloadable with
download.py); intermediate arrays in data/cache/larouco/; the published incident package in data/processed/larouco/.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import shape
from shapely import transform as stransform

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "larouco"
CACHE = ROOT / "data" / "cache" / "larouco"
OUT = ROOT / "data" / "processed" / "larouco"
for p in (RAW, CACHE, OUT):
    p.mkdir(parents=True, exist_ok=True)

INCIDENT_ID = "larouco-2025-08"
EPSG = 25829
TO_UTM = Transformer.from_crs(4326, EPSG, always_xy=True)
TO_LL = Transformer.from_crs(EPSG, 4326, always_xy=True)

# Copernicus EMS rapid mapping activation covering the fire (open, attribution required)
EMS_CODE = "EMSR837"
EMS_AOI = 1   # "Ourense Province"


def utc(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc) if "T" in s else datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class Grid:
    """North-up grid: cell (row, col) covers x in [x0 + col*res, +res), y in (y0 - (row+1)*res, y0 - row*res]."""
    x0: float
    y0: float
    res: float
    W: int
    H: int

    @property
    def transform(self):
        return from_origin(self.x0, self.y0, self.res, self.res)

    @property
    def bbox_ll(self) -> tuple[float, float, float, float]:
        """Lon/lat box that contains the whole grid (w, s, e, n)."""
        xs = [self.x0, self.x0 + self.W * self.res]
        ys = [self.y0 - self.H * self.res, self.y0]
        pts = [TO_LL.transform(x, y) for x in xs for y in ys]
        return (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))

    def xy(self, lon, lat):
        return TO_UTM.transform(lon, lat)

    def rc(self, x, y):
        """Fractional row, col of UTM x, y."""
        return (self.y0 - np.asarray(y)) / self.res, (np.asarray(x) - self.x0) / self.res

    def centers(self):
        cols = self.x0 + (np.arange(self.W) + 0.5) * self.res
        rows = self.y0 - (np.arange(self.H) + 0.5) * self.res
        return np.meshgrid(cols, rows)

    def rasterize(self, geoms, value=1, dtype="uint8"):
        geoms = list(geoms)
        if not geoms:
            return np.zeros((self.H, self.W), dtype)
        return rasterize(((g, value) for g in geoms), out_shape=(self.H, self.W), transform=self.transform, dtype=dtype)

    def to_json(self):
        return {"crs": f"EPSG:{EPSG}", "x0": self.x0, "y0": self.y0, "res": self.res, "width": self.W, "height": self.H}


def grid_for(lon_w, lat_s, lon_e, lat_n, res=30.0) -> Grid:
    xa, ya = TO_UTM.transform(lon_w, lat_n)
    xb, yb = TO_UTM.transform(lon_e, lat_s)
    xc, yc = TO_UTM.transform(lon_w, lat_s)
    xd, yd = TO_UTM.transform(lon_e, lat_n)
    x0, x1 = min(xa, xc), max(xb, xd)
    y0, y1 = max(ya, yd), min(yb, yc)
    x0, y0 = np.floor(x0 / res) * res, np.ceil(y0 / res) * res
    return Grid(float(x0), float(y0), res, int(np.ceil((x1 - x0) / res)), int(np.ceil((y0 - y1) / res)))


# Analysis box: the whole Larouco scar (EMS final perimeter) with ~4 km of margin
GRID = grid_for(-7.30, 42.24, -6.80, 42.60, res=30.0)


def to_utm_geom(g):
    return stransform(g, lambda c: np.column_stack(TO_UTM.transform(c[:, 0], c[:, 1])))


def read_features(path: Path):
    """GeoJSON features with a geometry, as (shapely geometry in UTM, properties)."""
    d = json.loads(Path(path).read_text())
    return [(to_utm_geom(shape(f["geometry"])), f["properties"]) for f in d["features"] if f.get("geometry")]


def write_json(path: Path, obj, indent=None):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=indent, ensure_ascii=False, separators=None if indent else (",", ":")))
