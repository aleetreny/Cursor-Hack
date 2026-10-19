"""DEM sampling (AWS Terrain Tiles, Terrarium encoding) and pinhole-camera ray casting onto the DEM."""
from __future__ import annotations

import math
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from .config import CACHE, POSE

TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
from .common import M_LAT, M_LON, enu_to_lonlat  # noqa: F401  (re-exported)


def lon_to_tx(lon: float, z: int) -> float:
    return (lon + 180) / 360 * 2**z


def lat_to_ty(lat: float, z: int) -> float:
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2**z


class DEM:
    """Bilinear DEM sampler over a mosaic of Terrarium tiles (metres above sea level)."""

    def __init__(self, bbox: tuple[float, float, float, float], z: int = 15):
        w, s, e, n = bbox
        self.z = z
        self.x0, x1 = int(lon_to_tx(w, z)), int(lon_to_tx(e, z))
        self.y0, y1 = int(lat_to_ty(n, z)), int(lat_to_ty(s, z))
        tiles_x, tiles_y = x1 - self.x0 + 1, y1 - self.y0 + 1
        self.h = np.zeros((tiles_y * 256, tiles_x * 256), dtype=np.float32)
        cache = CACHE / "terrarium" / str(z)
        cache.mkdir(parents=True, exist_ok=True)
        with httpx.Client(timeout=30) as client:
            for tx in range(self.x0, x1 + 1):
                for ty in range(self.y0, y1 + 1):
                    p = cache / f"{tx}_{ty}.png"
                    if not p.exists():
                        r = client.get(TERRARIUM.format(z=z, x=tx, y=ty))
                        r.raise_for_status()
                        p.write_bytes(r.content)
                    a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)
                    hh = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
                    oy, ox = (ty - self.y0) * 256, (tx - self.x0) * 256
                    self.h[oy:oy + 256, ox:ox + 256] = hh

    def at(self, lon: float, lat: float) -> float:
        px = (lon_to_tx(lon, self.z) - self.x0) * 256 - 0.5
        py = (lat_to_ty(lat, self.z) - self.y0) * 256 - 0.5
        H, W = self.h.shape
        px, py = min(max(px, 0), W - 1.001), min(max(py, 0), H - 1.001)
        i, j = int(px), int(py)
        fx, fy = px - i, py - j
        h = self.h
        return float((h[j, i] * (1 - fx) + h[j, i + 1] * fx) * (1 - fy) + (h[j + 1, i] * (1 - fx) + h[j + 1, i + 1] * fx) * fy)


class Camera:
    """Pinhole camera at the drone pose. Image coords: u,v in pixels of a (W,H) frame."""

    def __init__(self, dem: DEM, width: int = 1280, height: int = 720):
        self.dem = dem
        self.W, self.H = width, height
        self.f = POSE.focal_px_4k * width / POSE.width_4k     # same sensor crop, scaled
        self.ground0 = dem.at(POSE.lon, POSE.lat)
        self.alt = self.ground0 + POSE.agl_m                    # take-off assumed at the hover point
        psi, th = math.radians(POSE.yaw_deg), math.radians(POSE.pitch_deg)
        f = np.array([math.sin(psi), math.cos(psi), 0.0])
        self.right = np.array([math.cos(psi), -math.sin(psi), 0.0])
        self.fwd = f * math.cos(th) + np.array([0, 0, math.sin(th)])
        self.up = -f * math.sin(th) + np.array([0, 0, math.cos(th)])
        self.hfov = math.degrees(2 * math.atan(width / 2 / self.f))

    def ray(self, u: float, v: float) -> np.ndarray:
        x = (u - self.W / 2) / self.f
        y = (v - self.H / 2) / self.f
        d = self.fwd + x * self.right - y * self.up
        return d / np.linalg.norm(d)

    def to_ground(self, u: float, v: float, max_m: float = 600.0, step: float = 0.75):
        """March the ray until it hits the DEM. Returns (lon, lat, range_m) or None."""
        d = self.ray(u, v)
        if d[2] >= 0:
            return None
        prev_t, t = 0.0, step
        while t < max_m:
            e, n, z = d[0] * t, d[1] * t, self.alt + d[2] * t
            lon, lat = enu_to_lonlat(e, n)
            if z <= self.dem.at(lon, lat):
                lo, hi = prev_t, t                                # refine by bisection
                for _ in range(8):
                    mid = (lo + hi) / 2
                    lon_m, lat_m = enu_to_lonlat(d[0] * mid, d[1] * mid)
                    if self.alt + d[2] * mid <= self.dem.at(lon_m, lat_m):
                        hi = mid
                    else:
                        lo = mid
                lon, lat = enu_to_lonlat(d[0] * hi, d[1] * hi)
                return lon, lat, hi
            prev_t, t = t, t + step * (1 + t / 120)
        return None

    def to_enu(self, lon: float, lat: float) -> tuple[float, float]:
        return (lon - POSE.lon) * M_LON, (lat - POSE.lat) * M_LAT
