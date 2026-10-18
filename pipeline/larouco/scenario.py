"""Retrospective spread scenario: how far fuels, terrain and the real weather alone would have taken the fire, compared
with what actually burned.

    python -m pipeline.larouco.scenario

A hindcast, not a forecast:
  · fuels: ESA WorldCover 10 m 2021 (CC BY 4.0) mapped to a relative spread factor per land-cover class
  · terrain: IGN/CNIG MDT25 (slope from the packaged DEM tiles)
  · weather: ERA5 hourly at the scar's centre — wind speed and direction, and vapour-pressure deficit as a proxy for
    how dry the fuels are (day/night cycle included)
  · ignition: the earliest 6 h of the reconstruction (where and when satellites first saw the fire)
  · spread: time-dependent least travel time (Dijkstra, 16 neighbours, 90 m cells). Rate =
      R0 · fuel · wind(speed, angle) · slope · dryness(VPD), with an elliptical wind term and a backing-fire floor
  · ONE free parameter, R0, calibrated so the burned area matches the first EMS perimeter (16 Aug 11:21 UTC). From
    there it runs freely to 27 Aug and is scored against the later perimeters and the reconstruction.
  · the model was fixed before scoring (mean ERA5 wind). A variant with ERA5 gusts scored about the same and is not used.
No suppression, no spotting, uniform weather across the box. Results go to data/cache/larouco/scenario.npz/json.
"""
from __future__ import annotations

import heapq
import json
import math

import numpy as np
from scipy import ndimage

from .common import CACHE, GRID, RAW, TO_LL, utc, write_json
from .progression import T0, hours, iou

K = 3                     # 90 m cells
CAL = "DEL_PRODUCT"       # the perimeter R0 is calibrated on
# relative spread factor per WorldCover class (shrub and grass carry fire fastest; Galician heath is very flammable)
FUEL = {10: 0.75, 20: 1.0, 30: 1.15, 40: 0.45, 50: 0.03, 60: 0.08, 70: 0.0, 80: 0.0, 90: 0.3, 95: 0.2, 100: 0.15}


def worldcover():
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    url = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N42W009_Map.tif"
    dest = RAW / "worldcover.npy"
    if dest.exists():
        return np.load(dest)
    out = np.zeros((GRID.H, GRID.W), "uint8")
    with rasterio.open(url) as src:
        reproject(rasterio.band(src, 1), out, dst_transform=GRID.transform, dst_crs="EPSG:25829", resampling=Resampling.mode)
    np.save(dest, out)
    return out


def elevation():
    """MDT25 from the cached WCS tiles, on the analysis grid."""
    import rasterio
    from rasterio.warp import reproject, Resampling
    dest = RAW / "mdt_grid.npy"
    if dest.exists():
        return np.load(dest)
    out = np.full((GRID.H, GRID.W), np.nan, "float32")
    for f in sorted((RAW / "tiles" / "mdt25").glob("*.tif")):
        with rasterio.open(f) as src:
            tmp = np.full((GRID.H, GRID.W), np.nan, "float32")
            reproject(rasterio.band(src, 1), tmp, dst_transform=GRID.transform, dst_crs="EPSG:25829", dst_nodata=np.nan, resampling=Resampling.bilinear)
            np.copyto(out, tmp, where=np.isnan(out))
    out = np.where(np.isnan(out), np.nanmean(out), out)
    np.save(dest, out)
    return out


def coarse(a, how="mean"):
    H, W = a.shape[0] // K, a.shape[1] // K
    b = a[:H * K, :W * K].reshape(H, K, W, K)
    return b.mean((1, 3)) if how == "mean" else b.max((1, 3))


def weather():
    wx = json.loads(next((RAW / "weather").glob("era5_*.json")).read_text())["hourly"]
    t = np.array([hours(utc(x + ":00Z")) for x in wx["time"]])
    to = np.radians(np.array(wx["wind_direction_10m"]) + 180)            # the direction the wind pushes the fire
    U = np.array(wx["wind_speed_10m"], "float64")
    vpd = np.array(wx["vapour_pressure_deficit"], "float64")
    return t, np.sin(to), np.cos(to), U, np.clip((vpd / 1.5) ** 0.6, 0.15, 2.5)


NB = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1), (2, 1), (2, -1), (-2, 1), (-2, -1), (1, 2), (1, -2), (-1, 2), (-1, -2)]


def spread(R0, F, Z, seeds, wx, t_stop):
    """Time-dependent Dijkstra. F fuel factor, Z elevation (m), seeds [(row, col, t_h)]; returns arrival hours."""
    H, W = F.shape
    res = GRID.res * K
    tw, sx, sy, U, M = wx
    T = np.full((H, W), np.inf)
    heap = []
    for r, c, t in seeds:
        if t < T[r, c]:
            T[r, c] = t; heapq.heappush(heap, (t, r, c))
    geo = [(dr, dc, math.hypot(dr, dc) * res, dc / math.hypot(dr, dc), -dr / math.hypot(dr, dc)) for dr, dc in NB]   # unit vector (east, north)
    done = np.zeros((H, W), bool)
    while heap:
        t, r, c = heapq.heappop(heap)
        if done[r, c] or t > t_stop:
            if t > t_stop:
                break
            continue
        done[r, c] = True
        k = min(len(tw) - 1, max(0, int(t - tw[0])))
        ws, wcx, wcy, m = U[k], sx[k], sy[k], M[k]
        z0 = Z[r, c]
        for dr, dc, d, ue, un in geo:
            rr, cc = r + dr, c + dc
            if rr < 0 or cc < 0 or rr >= H or cc >= W or done[rr, cc]:
                continue
            f = 0.5 * (F[r, c] + F[rr, cc])
            if f <= 0.01:
                continue
            cosw = ue * wcx + un * wcy
            wind = 1 + 0.9 * (ws / 10) ** 1.2 * max(0.0, cosw) ** 1.4 - 0.4 * max(0.0, -cosw)
            tan = (Z[rr, cc] - z0) / d
            slope = math.exp(min(1.6, 3.5 * tan)) if tan > 0 else max(0.45, 1 + 1.2 * tan)
            R = R0 * f * max(0.25, wind) * slope * m          # m/h
            nt = t + d / R
            if nt < T[rr, cc]:
                T[rr, cc] = nt; heapq.heappush(heap, (nt, rr, cc))
    return T


def main():
    a = np.load(CACHE / "arrival.npz")
    Trec, scar = a["T"], a["scar"]
    pm = np.load(CACHE / "perimeters.npz")
    perims = {p["name"]: p for p in json.loads((CACHE / "perimeters.json").read_text())}
    wc = worldcover()
    F = coarse(np.vectorize(lambda v: FUEL.get(int(v), 0.3))(wc).astype("float32"))
    Z = coarse(elevation())
    wx = weather()
    # ignition: the first 6 h of the reconstruction, on the coarse grid
    fin = np.isfinite(Trec)
    t_ig = Trec[fin].min()
    ig = fin & (Trec <= t_ig + 6)
    rr, cc = np.nonzero(ig)
    seeds = {}
    for r, c in zip(rr // K, cc // K):
        if r < F.shape[0] and c < F.shape[1]:
            t = float(Trec[r * K:(r + 1) * K, c * K:(c + 1) * K][np.isfinite(Trec[r * K:(r + 1) * K, c * K:(c + 1) * K])].min())
            seeds[(r, c)] = min(seeds.get((r, c), 1e9), t)
    seeds = [(r, c, t) for (r, c), t in seeds.items()]
    print(f"ignition: {len(seeds)} cells from {t_ig:.1f} h; fuel mean {F.mean():.2f}; ERA5 {len(wx[0])} h")
    ha90 = (GRID.res * K) ** 2 / 1e4
    t_cal = hours(utc(perims[CAL]["t"]))
    target = perims[CAL]["burned_ha"]
    lo, hi = 1.0, 3000.0       # R0 (m/h) bracket
    for it in range(16):
        R0 = math.sqrt(lo * hi)
        T = spread(R0, F, Z, seeds, wx, t_cal)
        area = (T <= t_cal).sum() * ha90
        print(f"  R0 {R0:8.1f} m/h → {area:8.0f} ha by the {CAL} image (target {target:,} ha)")
        if abs(area - target) / target < 0.03:
            break
        lo, hi = (R0, hi) if area < target else (lo, R0)
    t_end = Trec[fin].max() + 12
    T = spread(R0, F, Z, seeds, wx, t_end)
    # upsample to the 30 m grid for scoring and packaging
    Tf = np.full(scar.shape, np.inf, "float32")
    up = np.kron(T, np.ones((K, K)))
    Tf[:up.shape[0], :up.shape[1]] = up
    # scores against every EMS perimeter after the calibration, and the final scar
    rows = []
    for name in ["DEL_MONIT01", "DEL_MONIT02", "DEL_MONIT03", "DEL_MONIT07"]:
        p = perims[name]; h = hours(utc(p["t"]))
        ref = pm[name]; sim = Tf <= h
        rows.append({"perimeter": name, "image_time": p["t"], "iou": round(iou(sim, ref), 3),
                     "recall": round(float((sim & ref).sum() / max(1, ref.sum())), 3),        # share of what burned that the scenario reached
                     "precision": round(float((sim & ref).sum() / max(1, sim.sum())), 3),     # share of the scenario that really burned
                     "sim_ha": round(float(sim.sum() * GRID.res ** 2 / 1e4)), "real_ha": p["burned_ha"]})
        print(f"  {name} {p['t'][:16]}: IoU {rows[-1]['iou']:.3f}, recall {rows[-1]['recall']:.2f}, precision {rows[-1]['precision']:.2f}, scenario {rows[-1]['sim_ha']:,} ha vs mapped {p['burned_ha']:,} ha")
    both = fin & np.isfinite(Tf)
    timing = float(np.median(np.abs(Tf[both] - Trec[both]))) if both.any() else None
    final_iou = iou(Tf <= t_end, scar)
    print(f"  final: IoU {final_iou:.3f}; median timing error where both burned {timing:.1f} h; scenario {np.isfinite(Tf).sum() * GRID.res ** 2 / 1e4:,.0f} ha")
    np.savez_compressed(CACHE / "scenario.npz", T=Tf)
    lon, lat = TO_LL.transform(GRID.x0, GRID.y0)
    write_json(CACHE / "scenario.json", {
        "method": "time-dependent least travel time on 90 m cells: R0 · fuel (WorldCover) · wind (ERA5) · slope (MDT25) · dryness (ERA5 VPD); no suppression, no spotting",
        "calibrated_on": {"perimeter": CAL, "image_time": perims[CAL]["t"], "burned_ha": target}, "R0_m_h": round(R0, 1),
        "perimeters": rows, "final_iou": round(final_iou, 3), "median_timing_error_h": None if timing is None else round(timing, 1),
        "scenario_ha": round(float(np.isfinite(Tf).sum() * GRID.res ** 2 / 1e4)), "real_ha": round(float(scar.sum() * GRID.res ** 2 / 1e4)),
        "fuel_factors": {str(k): v for k, v in FUEL.items()}, "grid_origin_ll": [lon, lat],
    }, indent=1)


if __name__ == "__main__":
    main()
