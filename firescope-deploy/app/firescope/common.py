"""Lightweight helpers shared by the API and the pipeline (no OpenCV / numpy imports)."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from .config import POSE, PROCESSED, RECORDED_START, SOURCE_ID

OUT = PROCESSED / SOURCE_ID
M_LAT = 111_320.0
M_LON = 111_320.0 * math.cos(math.radians(POSE.lat))
T0 = datetime.fromisoformat(RECORDED_START.replace("Z", "+00:00"))


def iso(sec: float) -> str:
    return (T0 + timedelta(seconds=sec)).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def enu_to_lonlat(e: float, n: float) -> tuple[float, float]:
    return POSE.lon + e / M_LON, POSE.lat + n / M_LAT


def to_lonlat_geom(g) -> dict:
    def ring(r):
        return [[round(a, 7), round(b, 7)] for a, b in (enu_to_lonlat(x, y) for x, y in r.coords)]
    polys = list(g.geoms) if hasattr(g, "geoms") else [g]
    coords = [[ring(p.exterior)] + [ring(i) for i in p.interiors] for p in polys if not p.is_empty]
    if len(coords) == 1:
        return {"type": "Polygon", "coordinates": coords[0]}
    return {"type": "MultiPolygon", "coordinates": coords}
