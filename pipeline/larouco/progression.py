"""Reconstruct when each 30 m cell of the Larouco scar burned (an arrival-time field), and score the method.

    python -m pipeline.larouco.progression

Method (documented in the incident manifest):
 1. Scar: the burnt area of the latest Copernicus EMS delineation (EMSR837 AOI01, monitoring 9, 30 Aug 2025), the
    connected component the fire belongs to.
 2. Satellite detections: NASA FIRMS VIIRS S-NPP (375 m) and MODIS (1 km) inside the scar. Each detection marks a disc
    around its centre (radius from the pixel size; only the central 30 % for the coarse MODIS pixels) as burning at the
    pass time, and a cell's arrival is its first detection. (Shifting it back towards the previous pass scored worse.)
 3. Cells never detected (between pixels, or burned between passes and out by the next one) are interpolated from the
    nearest detected cells (inverse-distance weighting, 8 neighbours).
 4. Dated perimeters: inside an EMS perimeter (within that image's footprint and not "not analysed") a cell must have
    burned by the image time; inside the image but outside the perimeter, after it. An estimate outside its bounds moves
    to the middle of the window they leave (capped at 24 h), not to the edge.
 4b. When the EUMETSAT LSA SAF Meteosat FRP-PIXEL files are present (meteosat.py, every 15 min, ~3–4 km pixels), a
    cell first seen by a polar pass moves to Meteosat's first detection over it since the previous polar pass.
 5. Smoothing at the scale of a VIIRS pixel (σ = 150 m) inside the scar, then the bounds again.
Parameters (MODIS share, smoothing, shift) were picked among 18 combinations on the validation below, so its scores are
slightly optimistic.
Validation: the same reconstruction is run without one perimeter at a time, and that perimeter is compared with the
cells the reconstruction says had burned by its image time (IoU inside the image footprint). The "FIRMS only" variant
(no intermediate perimeters at all) is scored too. Results go to eval.json.
"""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from .common import CACHE, GRID, RAW, iso, read_features, utc, write_json

T0 = datetime(2025, 8, 12, 0, 0, tzinfo=timezone.utc)   # analysis clock origin (hours are counted from here)
NEVER = np.float32(np.inf)


def hours(t: datetime) -> float:
    return (t - T0).total_seconds() / 3600


# ------------------------------------------------------------------------------------------ inputs
@dataclass
class Perimeter:
    name: str            # e.g. DEL_MONIT02
    product: str         # FEP / DEL / GRA
    t: datetime          # image acquisition (latest image of the product)
    sensors: list[str]
    burned: np.ndarray   # bool, grid
    seen: np.ndarray     # bool, grid: inside the image footprint and analysed


def load_perimeters() -> list[Perimeter]:
    act = json.loads((RAW / "ems" / "activation.json").read_text())["results"][0]
    aoi = next(a for a in act["aois"] if a["number"] == 1)
    out = []
    for p in aoi["products"]:
        stem = p["downloadPath"].rsplit("/", 1)[1][:-4]
        d = RAW / "ems" / "x" / stem
        ev = next(iter(d.glob("*_observedEventA_*.json")), None)
        if ev is None:
            continue
        burned = GRID.rasterize(g for g, pr in read_features(ev) if pr.get("notation", "Burnt area") == "Burnt area") > 0
        fp = next(iter(d.glob("*_imageFootprintA_*.json")), None)
        na = next(iter(d.glob("*_notAnalysedA_*.json")), None)
        seen = (GRID.rasterize(g for g, _ in read_features(fp)) > 0) if fp else np.ones_like(burned)
        if na:
            seen &= ~(GRID.rasterize(g for g, _ in read_features(na)) > 0)
        times = [utc(i["acquisitionTime"] + "Z") for i in p["images"]]
        name = stem.split(f"AOI01_")[1].rsplit("_v", 1)[0]
        out.append(Perimeter(name, p["type"], max(times), sorted({i["sensorName"] for i in p["images"]}), burned, seen | burned))
    return sorted(out, key=lambda q: q.t)


@dataclass
class Detection:
    t: datetime
    x: float
    y: float
    r: float        # radius of the disc marked as burning, m
    frp: float      # fire radiative power, MW
    sensor: str     # VIIRS / MODIS
    sat: str
    conf: str


def load_detections(t_from: datetime, t_to: datetime):
    """All FIRMS rows in the grid, plus the list of satellite pass times over the region (any detection in NW Iberia)."""
    dets, passes = [], set()
    for f, sensor in (("viirs-snpp.csv", "VIIRS"), ("modis.csv", "MODIS")):
        with open(RAW / "firms" / f) as fh:
            for row in csv.DictReader(fh):
                t = datetime.strptime(row["acq_date"] + row["acq_time"].zfill(4), "%Y-%m-%d%H%M").replace(tzinfo=timezone.utc)
                if not (t_from <= t <= t_to):
                    continue
                lat, lon = float(row["latitude"]), float(row["longitude"])
                if -10 < lon < -3 and 40 < lat < 44.5:
                    passes.add((sensor, t))
                x, y = GRID.xy(lon, lat)
                r_, c_ = GRID.rc(x, y)
                if not (0 <= r_ < GRID.H and 0 <= c_ < GRID.W):
                    continue
                scan, track = float(row["scan"]), float(row["track"])
                # VIIRS: the disc of the pixel's area; MODIS pixels are 1–5 km, so only their central part counts
                r = 1000 * np.sqrt(scan * track / np.pi) if sensor == "VIIRS" else 1000 * 0.3 * min(scan, track)
                conf = row["confidence"]
                if sensor == "VIIRS" and conf == "l":
                    continue   # low-confidence VIIRS pixels (sun glint, hot surfaces) are dropped
                if sensor == "MODIS" and int(conf) < 30:
                    continue
                dets.append(Detection(t, x, y, r, float(row["frp"]), sensor, row["satellite"], conf))
    # passes 5 minutes apart are the same overpass
    ts = sorted({t for _, t in passes})
    merged = []
    for t in ts:
        if not merged or (t - merged[-1]).total_seconds() > 600:
            merged.append(t)
    return dets, merged


def final_scar(perims: list[Perimeter]) -> np.ndarray:
    last = [p for p in perims if p.product == "DEL"][-1]
    lab, n = ndimage.label(ndimage.binary_closing(last.burned, iterations=2))
    sizes = ndimage.sum(last.burned, lab, range(1, n + 1))
    return ndimage.binary_fill_holes(lab == (np.argmax(sizes) + 1)) & last.burned


# ------------------------------------------------------------------------------------ reconstruction
def first_detection(dets: list[Detection], scar: np.ndarray):
    """Per cell: hours of the first detection covering it (also the arrival estimate, see the module notes)."""
    first = np.full(scar.shape, NEVER, "float32")
    yy, xx = np.mgrid[0:GRID.H, 0:GRID.W]
    for d in sorted(dets, key=lambda d: d.t):
        r0, c0 = GRID.rc(d.x, d.y)
        k = int(np.ceil(d.r / GRID.res)) + 1
        r1, r2 = max(0, int(r0) - k), min(GRID.H, int(r0) + k + 1)
        c1, c2 = max(0, int(c0) - k), min(GRID.W, int(c0) + k + 1)
        if r1 >= r2 or c1 >= c2:
            continue
        sub = (yy[r1:r2, c1:c2] + 0.5 - r0) ** 2 + (xx[r1:r2, c1:c2] + 0.5 - c0) ** 2 <= (d.r / GRID.res) ** 2
        win = first[r1:r2, c1:c2]
        win[sub] = np.minimum(win[sub], hours(d.t))
    first[~scar] = NEVER
    est = first.copy()
    return first, est


def meteosat_first(scar: np.ndarray, radius_m=2500.0):
    """Hours of the first EUMETSAT LSA SAF FRP-PIXEL detection (every 15 min, ~3–4 km pixels) covering each cell, or
    None when the Meteosat data has not been downloaded (pipeline/larouco/meteosat.py)."""
    f = CACHE / "meteosat.json"
    if not f.exists():
        return None
    px = json.loads(f.read_text())["pixels"]
    first = np.full(scar.shape, NEVER, "float32")
    yy, xx = np.mgrid[0:GRID.H, 0:GRID.W]
    k = int(radius_m / GRID.res) + 1
    for d in sorted(px, key=lambda d: d["t"]):
        x, y = GRID.xy(d["lon"], d["lat"]); r0, c0 = GRID.rc(x, y)
        r1, r2, c1, c2 = max(0, int(r0) - k), min(GRID.H, int(r0) + k + 1), max(0, int(c0) - k), min(GRID.W, int(c0) + k + 1)
        if r1 >= r2 or c1 >= c2:
            continue
        sub = (yy[r1:r2, c1:c2] + 0.5 - r0) ** 2 + (xx[r1:r2, c1:c2] + 0.5 - c0) ** 2 <= (radius_m / GRID.res) ** 2
        win = first[r1:r2, c1:c2]
        win[sub] = np.minimum(win[sub], hours(utc(d["t"])))
    first[~scar] = NEVER
    return first


def refine_with_meteosat(est: np.ndarray, msg: np.ndarray, passes: list[datetime]):
    """A cell first seen by a polar pass burned after the previous pass: if Meteosat saw fire over it inside that gap,
    its arrival moves to that 15-min slot. (Meteosat pixels are coarse, so it only refines timing, never location.)"""
    ph = np.array([hours(t) for t in passes])
    out = est.copy()
    det = np.isfinite(est)
    idx = np.searchsorted(ph, est[det] - 1e-3) - 1
    prev = np.where(idx >= 0, ph[np.clip(idx, 0, None)], -np.inf)
    m = msg[det]
    use = np.isfinite(m) & (m > prev) & (m < est[det])
    vals = est[det]
    vals[use] = m[use]
    out[det] = vals
    return out, int(use.sum())


def bounds(perims: list[Perimeter], scar: np.ndarray, use: list[Perimeter]):
    lo = np.full(scar.shape, -np.inf, "float32")
    hi = np.full(scar.shape, np.inf, "float32")
    for p in use:
        m = p.burned & p.seen & scar
        hi[m] = np.minimum(hi[m], hours(p.t))
    # a scar does not un-burn: "not burned" in a later image than one that shows the cell burned is an omission of that
    # later product, so a lower bound only counts where no earlier perimeter already contains the cell
    for p in use:
        h = hours(p.t)
        m = ~p.burned & p.seen & scar & (hi > h)
        lo[m] = np.maximum(lo[m], h)
    return lo, hi


def resolve(v, lo, hi, window_h=24.0):
    """An estimate outside its bounds only says the cell burned somewhere inside them: use the middle of that window
    (capped at a day) instead of the edge, which would pile every such cell onto the image time."""
    v = np.asarray(v, "float64").copy()
    early, late = v < lo, v > hi
    v[early] = ((lo + np.minimum(hi, lo + window_h)) / 2)[early]
    v[late] = ((np.maximum(lo, hi - window_h) + hi) / 2)[late]
    return v


def reconstruct(est: np.ndarray, scar: np.ndarray, lo: np.ndarray, hi: np.ndarray, sigma_m=150.0):
    det = np.isfinite(est) & scar
    rr, cc = np.nonzero(det)
    # resolve the detections first so a stale detection inside an earlier perimeter cannot drag the fill late
    vals = resolve(est[det].astype("float64"), lo[det], hi[det])
    tree = cKDTree(np.column_stack([rr, cc]))
    qr, qc = np.nonzero(scar & ~det)
    T = np.full(scar.shape, np.inf, "float32")
    T[det] = vals
    if len(qr):
        dist, ii = tree.query(np.column_stack([qr, qc]), k=8)
        w = 1.0 / np.maximum(dist, 0.5) ** 2
        T[qr, qc] = (w * vals[ii]).sum(1) / w.sum(1)
    T = resolve(T, lo, hi).astype("float32")
    conflict = scar & (lo > hi)   # cannot happen with bounds(); kept as a guard
    T[conflict] = hi[conflict]
    # normalised convolution: smooth inside the scar only
    s = sigma_m / GRID.res
    Tz = np.where(scar, T, 0).astype("float64")
    num = ndimage.gaussian_filter(Tz, s)
    den = ndimage.gaussian_filter(scar.astype("float64"), s)
    Ts = np.where(scar, num / np.maximum(den, 1e-6), np.inf).astype("float32")
    Ts = np.clip(resolve(Ts, lo, hi), lo, hi).astype("float32")
    Ts[~scar] = np.inf
    return Ts, int(conflict.sum())


def iou(a, b):
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 1.0


def evaluate(perims, scar, est, use_all):
    """Leave-one-out over the intermediate perimeters, and the FIRMS-only variant."""
    rows = []
    final = scar.sum()
    lo0, hi0 = bounds(perims, scar, [])
    T_f, _ = reconstruct(est, scar, lo0, hi0)
    for p in perims:
        frac = (p.burned & scar).sum() / final
        cov = (p.seen & scar).sum() / final
        if frac < 0.02 or frac > 0.97 or cov < 0.5:
            continue   # nothing burned yet, already the final scar, or the image saw too little of it
        lo, hi = bounds(perims, scar, [q for q in use_all if q is not p])
        T_loo, _ = reconstruct(est, scar, lo, hi)
        m = p.seen & scar
        ref = p.burned & m
        a = iou((T_loo <= hours(p.t)) & m, ref)
        b = iou((T_f <= hours(p.t)) & m, ref)
        rows.append({"perimeter": p.name, "image_time": iso(p.t), "sensors": p.sensors, "burned_share_of_final": round(float(frac), 3),
                     "image_covers_share_of_scar": round(float(cov), 3), "iou_leave_one_out": round(a, 3), "iou_firms_only": round(b, 3)})
        print(f"  {p.name:12s} {iso(p.t)} {frac * 100:5.1f}% burned  cover {cov * 100:3.0f}%   IoU leave-one-out {a:.3f}   FIRMS only {b:.3f}")
    return rows


def main():
    perims = load_perimeters()
    scar = final_scar(perims)
    print(f"scar: {scar.sum() * GRID.res ** 2 / 1e4:,.0f} ha")
    for p in perims:
        print(f"  {p.name:12s} {iso(p.t)} {','.join(p.sensors):24s} burned∩scar {(p.burned & scar).sum() * GRID.res ** 2 / 1e4:8,.0f} ha  seen {(p.seen & scar).mean() / scar.mean() * 100:4.0f}%")
    dets, passes = load_detections(T0 - timedelta(days=2), T0 + timedelta(days=20))
    inside = [d for d in dets if scar[int(GRID.rc(d.x, d.y)[0]), int(GRID.rc(d.x, d.y)[1])]]
    print(f"detections in the grid {len(dets)}, inside the scar {len(inside)}; passes over the region {len(passes)}")
    first, est = first_detection(inside, scar)
    print(f"cells detected at least once: {np.isfinite(first[scar]).mean() * 100:.0f}% of the scar")
    msg = meteosat_first(scar)
    est_polar = est
    if msg is not None:
        est, n_ref = refine_with_meteosat(est, msg, passes)
        print(f"Meteosat FRP-PIXEL: {np.isfinite(msg[scar]).mean() * 100:.0f}% of the scar seen; {n_ref} cells retimed inside a gap between polar passes")
    use = [p for p in perims if p.product == "DEL" or p.product == "FEP"]
    lo, hi = bounds(perims, scar, use)
    T, conflicts = reconstruct(est, scar, lo, hi)
    print(f"bound conflicts: {conflicts} cells ({conflicts / scar.sum() * 100:.2f}%)")
    print("validation:")
    rows = evaluate(perims, scar, est, use)
    if msg is not None:
        print("  (without Meteosat:)")
        rows_polar = evaluate(perims, scar, est_polar, use)
        for r, q in zip(rows, rows_polar):
            r["iou_leave_one_out_polar_only"] = q["iou_leave_one_out"]
    np.savez_compressed(CACHE / "arrival.npz", T=T, scar=scar, first=first, t0=iso(T0))
    write_json(CACHE / "progression_eval.json", {"t0": iso(T0), "perimeters": rows, "conflict_cells": conflicts, "meteosat": msg is not None,
               "detections_in_scar": len(inside), "passes": [iso(t) for t in passes]}, indent=1)
    write_json(CACHE / "detections.json", [{"t": iso(d.t), "x": round(d.x, 1), "y": round(d.y, 1), "frp": d.frp, "sensor": d.sensor, "sat": d.sat, "r": round(d.r)} for d in inside])
    write_json(CACHE / "perimeters.json", [{"name": p.name, "product": p.product, "t": iso(p.t), "sensors": p.sensors,
               "burned_ha": round(float((p.burned & scar).sum() * GRID.res ** 2 / 1e4)), "seen_share": round(float((p.seen & scar).sum() / scar.sum()), 3)} for p in perims], indent=1)
    np.savez_compressed(CACHE / "perimeters.npz", **{p.name: (p.burned & scar) for p in perims})
    fin = np.isfinite(T)
    print(f"arrival: {T[fin].min():.1f} h .. {T[fin].max():.1f} h after {iso(T0)}")


if __name__ == "__main__":
    main()
