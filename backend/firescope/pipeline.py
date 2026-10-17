"""Offline/replay pipeline: drone video → masks → georeferenced polygons → timeline, events, clips.

Run:  python -m firescope.pipeline            (writes data/processed/drone_replay_01/*.json)
The output files are exactly the API responses described in docs/api-contract.md.
"""
from __future__ import annotations

import json
import math
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import unary_union

from .config import CLIP_SECONDS, DATASET, KML, POSE, PROCESSED, RECORDED_START, SAMPLE_EVERY_FRAMES, SOURCE_ID, VIDEO
from .geo import DEM, Camera, M_LAT, M_LON, enu_to_lonlat
from .segment import TemporalBurn, iou_prf, raw_masks

from .common import OUT, iso, to_lonlat_geom  # noqa: E402

MEDIA = PROCESSED / "media"
CV_MODEL = "firescope-cv v0.1 (HSV + morphology + temporal accumulation)"


def read_kml_ring() -> list[list[float]]:
    txt = KML.read_text()
    coords = re.search(r"<coordinates>\s*(.*?)\s*</coordinates>", txt, re.S).group(1).split()
    return [[round(float(c.split(",")[0]), 7), round(float(c.split(",")[1]), 7)] for c in coords]


class Projector:
    """Image contour → ground polygon (ENU metres, then lon/lat)."""

    def __init__(self, cam: Camera, work_shape: tuple[int, int]):
        self.cam = cam
        self.sy = cam.H / work_shape[0]
        self.sx = cam.W / work_shape[1]
        self.cache: dict[tuple[int, int], tuple[float, float] | None] = {}

    def enu(self, u: float, v: float):
        key = (int(round(u * self.sx)), int(round(v * self.sy)))
        if key not in self.cache:
            hit = self.cam.to_ground(key[0], key[1])
            self.cache[key] = None if hit is None else self.cam.to_enu(hit[0], hit[1])
        return self.cache[key]

    def mask_to_polygon(self, mask: np.ndarray, eps: float = 1.6, min_area_px: float = 40) -> MultiPolygon | None:
        cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        polys = []
        for c in cnts:
            if cv2.contourArea(c) < min_area_px:
                continue
            c = cv2.approxPolyDP(c, eps, True)[:, 0, :]
            pts = [p for p in (self.enu(float(x), float(y)) for x, y in c) if p is not None]
            if len(pts) >= 3:
                pg = Polygon(pts).buffer(0)
                if pg.area > 0.5:
                    polys.append(pg)
        if not polys:
            return None
        u = unary_union(polys)
        return u if isinstance(u, MultiPolygon) else MultiPolygon([u]) if isinstance(u, Polygon) else None


def gt_polygon_px(frame: int) -> np.ndarray | None:
    for split in ("train_valid_json", "test_json"):
        p = DATASET / "JSON" / split / f"frame_{frame:06d}.json"
        if p.exists():
            d = json.loads(p.read_text())
            pts = [s["points"] for s in d["shapes"]]
            return pts
    return None


def metric(v, unit, prov="derived", method=None):
    m = {"value": None if v is None else round(float(v), 1), "unit": unit, "provenance": prov}
    if method:
        m["method"] = method
    return m


def run(limit_seconds: float | None = None) -> dict:
    t_start = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    (MEDIA / SOURCE_ID).mkdir(parents=True, exist_ok=True)
    kml = read_kml_ring()
    lons, lats = [c[0] for c in kml], [c[1] for c in kml]
    bbox = (min(lons) - 0.017, min(lats) - 0.0045, max(lons) + 0.017, max(lats) + 0.0042)
    dem = DEM(bbox, 15)
    cam = Camera(dem)

    cap = cv2.VideoCapture(str(VIDEO))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    nframes = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = nframes / fps
    if limit_seconds:
        nframes = min(nframes, int(limit_seconds * fps))

    tb = TemporalBurn()
    proj = None
    features, hotspots, frames, evals, samples = [], [], [], [], []
    prev_burn = None
    base = {"source_id": SOURCE_ID, "georeferencing_method": "camera_model_dem", "georeferencing_accuracy": "approximate"}
    clip_every = int(round(CLIP_SECONDS * fps))
    fi = 0
    while fi < nframes:
        ok = cap.grab()
        if not ok:
            break
        if fi % SAMPLE_EVERY_FRAMES == 0 or fi % clip_every == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            sec = fi / fps
            if fi % clip_every == 0:
                cv2.imwrite(str(MEDIA / SOURCE_ID / f"clip_{fi // clip_every:04d}.jpg"), cv2.resize(frame, (256, 144), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 62])
            if fi % SAMPLE_EVERY_FRAMES == 0:
                m = raw_masks(frame)
                shp = tuple(m["shape"])
                if proj is None:
                    proj = Projector(cam, shp)
                cum = tb.update(m["burned"])
                ts = iso(sec)
                common = {**base, "timestamp": ts, "source_frame": fi, "video_seconds": round(sec, 3)}
                burn = proj.mask_to_polygon(cum)
                flame = proj.mask_to_polygon(cv2.dilate(m["flame"], np.ones((3, 3), np.uint8)), eps=1.0, min_area_px=6)
                burn_a = burn.area if burn else 0.0
                fire_a = flame.area if flame else 0.0
                if burn:
                    features.append({"type": "Feature", "geometry": to_lonlat_geom(burn), "properties": {**common, "id": f"burn_f{fi}", "classification": "burned_area", "area_m2": round(burn_a, 1), "provenance": "model", "model": CV_MODEL}})
                if flame:
                    features.append({"type": "Feature", "geometry": to_lonlat_geom(flame), "properties": {**common, "id": f"fire_f{fi}", "classification": "visible_active_fire", "area_m2": round(fire_a, 1), "provenance": "model", "model": CV_MODEL}})
                change_a = None
                if prev_burn is not None and burn is not None:
                    diff = burn.difference(prev_burn).buffer(-0.15).buffer(0.15)
                    change_a = burn_a - prev_burn.area
                    if not diff.is_empty and diff.area > 1:
                        features.append({"type": "Feature", "geometry": to_lonlat_geom(diff), "properties": {**common, "id": f"chg_f{fi}", "classification": "area_change", "area_m2": round(diff.area, 1), "provenance": "derived", "model": CV_MODEL}})
                # hotspots = flame blob centroids (visible flame, NOT a temperature)
                n, lab, stats, cents = cv2.connectedComponentsWithStats(m["flame"], 8)
                blobs = sorted([(stats[k, cv2.CC_STAT_AREA], cents[k]) for k in range(1, n) if stats[k, cv2.CC_STAT_AREA] >= 12], key=lambda x: -x[0])[:8]
                hs_count = 0
                for bi, (area, (cx, cy)) in enumerate(blobs):
                    p = proj.enu(cx, cy)
                    if p is None:
                        continue
                    lon, lat = enu_to_lonlat(*p)
                    hotspots.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}, "properties": {"id": f"hs_f{fi}_{bi}", "timestamp": ts, "source_id": SOURCE_ID, "video_seconds": round(sec, 3), "kind": "rgb_flame", "temperature_c": None, "provenance": "model", "event_id": None, "px_area": int(area)}})
                    hs_count += 1
                # ground truth (comparison layer + evaluation)
                gt_pts = gt_polygon_px(fi)
                has_gt = gt_pts is not None
                if has_gt:
                    gmask = np.zeros(shp, np.uint8)
                    for poly in gt_pts:
                        arr = np.array([[x * shp[1] / 1280, y * shp[0] / 720] for x, y in poly], np.int32)
                        cv2.fillPoly(gmask, [arr], 1)
                    ev = iou_prf(cum, gmask)
                    gpoly = proj.mask_to_polygon(gmask)
                    if gpoly is not None:
                        features.append({"type": "Feature", "geometry": to_lonlat_geom(gpoly), "properties": {**common, "id": f"gt_f{fi}", "classification": "ground_truth_burned", "area_m2": round(gpoly.area, 1), "provenance": "ground_truth", "model": "BurnedAreaUAV manual annotation"}})
                        if burn is not None:
                            inter = burn.intersection(gpoly).area
                            ev["ground_iou"] = inter / (burn.union(gpoly).area + 1e-9)
                    evals.append({"frame": fi, "video_seconds": round(sec, 2), **{k: round(v, 4) for k, v in ev.items()}})
                valid_px = float(cum.shape[0] * cum.shape[1])
                samples.append({"sec": sec, "frame": fi, "burn_px": float(cum.sum()) / valid_px, "flame_px": int(m["flame"].sum()), "smoke": float(m["smoke"].sum()) / valid_px,
                                "flame_mask": m["flame"], "cum": cum, "burn_a": burn_a, "fire_a": fire_a, "hs": blobs})
                frames.append({"timestamp": ts, "source_id": SOURCE_ID, "video_seconds": round(sec, 3), "source_frame": fi,
                               "burned_area_m2": metric(burn_a, "m2", "derived", "segmentation → pinhole camera + DEM ray cast"),
                               "active_fire_area_m2": metric(fire_a, "m2", "derived", "flame pixels → ground"),
                               "area_change_m2": metric(change_a, "m2", "derived"),
                               "hotspot_count": {"value": hs_count, "unit": "count", "provenance": "model"},
                               "has_ground_truth": has_gt})
                prev_burn = burn if burn is not None else prev_burn
                if len(frames) % 25 == 0:
                    print(f"  {sec:6.0f}s  burned {burn_a:8.1f} m²  fire {fire_a:6.1f} m²  hotspots {hs_count}")
        fi += 1
    cap.release()
    events = derive_events(samples, proj, fps)
    footprint = [proj.enu(u, v) for u, v in [(0, samples[0]["cum"].shape[0] * 0.21), (samples[0]["cum"].shape[1] - 1, samples[0]["cum"].shape[0] * 0.21), (samples[0]["cum"].shape[1] - 1, samples[0]["cum"].shape[0] - 1), (0, samples[0]["cum"].shape[0] - 1)]]
    fp_ll = [list(map(lambda v: round(v, 7), enu_to_lonlat(*p))) for p in footprint if p is not None]
    end_sec = samples[-1]["sec"]

    eval_summary = {k: round(float(np.mean([e[k] for e in evals])), 4) for k in ("iou", "precision", "recall")} if evals else {}
    if evals and "ground_iou" in evals[0]:
        eval_summary["ground_iou"] = round(float(np.mean([e.get("ground_iou", 0) for e in evals])), 4)
    eval_out = {"model": CV_MODEL, "frames_evaluated": len(evals), "mean": eval_summary, "per_frame": evals,
                "notes": "Image-space IoU of the cumulative burned mask vs BurnedAreaUAV manual masks (train+test, every 100 frames). ground_iou = IoU after georeferencing both onto the DEM."}
    clips = [{"clip_id": f"clip_{i:04d}", "source_id": SOURCE_ID, "start_seconds": round(i * CLIP_SECONDS, 2), "end_seconds": round(min(duration, (i + 1) * CLIP_SECONDS), 2), "timestamp": iso(i * CLIP_SECONDS), "thumbnail_url": f"/media/{SOURCE_ID}/clip_{i:04d}.jpg"} for i in range(int(math.ceil(min(duration, nframes / fps) / CLIP_SECONDS)))]

    incident = {"id": "pinhao-2019-03-01", "name": "Pinhão Cell Burn", "kind": "prescribed_burn", "location": "Torre do Pinhão, Vila Real, PT",
                "center": [POSE.lon, POSE.lat], "bbox": [round(x, 5) for x in (POSE.lon - 0.0167, POSE.lat - 0.0133, POSE.lon + 0.0167, POSE.lat + 0.0097)],
                "start": iso(0), "end": iso(end_sec), "status": "analyzed",
                "reference_perimeter": {"type": "Feature", "properties": {"name": "Planned burn cell (KML)"}, "geometry": {"type": "Polygon", "coordinates": [kml]}},
                "landmarks": [{"name": "Area under study", "position": [-7.615504, 41.394572], "kind": "place"}],
                "attribution": ["BurnedAreaUAV v1.1 — Ribeiro et al. 2023, CC-BY-4.0", "Elevation: AWS Terrain Tiles (Terrarium)", "Imagery: Esri World Imagery"]}
    source = {"id": SOURCE_ID, "label": "DJI Phantom 4 Pro", "mode": "drone_replay", "media_url": f"/media/{SOURCE_ID}.mp4", "thumbnail_url": f"/media/{SOURCE_ID}/clip_0003.jpg",
              "duration_seconds": round(duration, 2), "fps": round(fps, 2), "width": 1280, "height": 720, "recorded_start": iso(0),
              "pose": {"position": [POSE.lon, POSE.lat], "altitude_agl_m": POSE.agl_m, "altitude_msl_m": round(cam.alt, 1), "yaw_deg": POSE.yaw_deg, "pitch_deg": POSE.pitch_deg, "roll_deg": 0.0, "hfov_deg": round(cam.hfov, 1)},
              "footprint": {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [fp_ll + [fp_ll[0]]]}} if len(fp_ll) == 4 else None,
              "georeferencing": {"method": "camera_model_dem", "accuracy": "approximate", "rmse_m": None, "crs": "EPSG:4326",
                                 "notes": "Pinhole model from DJI XMP pose (photo taken during the hover) + calibrated focal length, rays marched onto AWS Terrarium z15 DEM. Video pose assumed equal to photo pose; far-field rows above 21% of the frame excluded."},
              "processing": {"state": "done", "progress": 1.0, "clips_total": len(clips), "clips_done": len(clips), "message": f"{len(frames)} frames analysed in {time.time() - t_start:.0f}s"}}
    timeline = {"incident_id": incident["id"], "start": iso(0), "end": iso(end_sec), "frames": frames, "events": events}
    observations = {"type": "FeatureCollection", "features": features, "hotspots": hotspots}
    for name, obj in [("incident", incident), ("sources", [source]), ("timeline", timeline), ("observations", observations),
                      ("events_cv", {"source_id": SOURCE_ID, "events": events}), ("clips", clips), ("eval", eval_out)]:
        (OUT / f"{name}.json").write_text(json.dumps(obj, separators=(",", ":")))
    try:
        from .weather import fetch
        fetch()
    except Exception as e:  # noqa: BLE001 — weather is optional context
        print("weather fetch failed:", e)
    print(f"done: {len(frames)} frames, {len(features)} features, {len(hotspots)} hotspots, {len(events)} events, eval {eval_summary} in {time.time() - t_start:.0f}s")
    return eval_out


def derive_events(samples: list[dict], proj: Projector, fps: float) -> list[dict]:
    """Measurement-driven events (provenance 'derived'). Cosmos Reason later adds grounded descriptions."""
    ev: list[dict] = []
    H, W = samples[0]["cum"].shape

    def region(mask):
        ys, xs = np.nonzero(mask)
        if len(xs) == 0:
            return None, None
        x0, x1, y0, y1 = np.percentile(xs, 3), np.percentile(xs, 97), np.percentile(ys, 3), np.percentile(ys, 97)
        p = proj.enu(float(np.median(xs)), float(np.median(ys)))
        loc = list(map(lambda v: round(v, 7), enu_to_lonlat(*p))) if p else None
        return [round(x0 / W, 3), round(y0 / H, 3), round(x1 / W, 3), round(y1 / H, 3)], loc

    def add(kind, s, sev, title, desc, evidence, mask):
        reg, loc = region(mask)
        ev.append({"event_id": "", "source_id": SOURCE_ID, "start_seconds": round(max(0, s["sec"] - 4), 2), "end_seconds": round(s["sec"] + 8, 2), "timestamp": iso(max(0, s["sec"] - 4)),
                   "event_type": kind, "title": title, "description": desc, "visual_evidence": evidence, "confidence": None, "review_required": True, "severity": sev,
                   "processing_model": CV_MODEL, "location": loc, "image_region": reg, "thumbnail_url": None, "provenance": "derived", "_sec": s["sec"]})

    first = next((s for s in samples if s["flame_px"] > 150), None)
    if first:
        add("first_visible_flames", first, "watch", "Flames visible in view", f"Flame-coloured pixels detected ({first['flame_px']} px at analysis resolution); burned ground already covers {first['burn_px'] * 100:.0f}% of the analysed frame.", ["saturated orange/yellow pixels", "adjacent dark burned ground"], first["flame_mask"])
    # expansion: largest burned-area growth over ~60 s, at least 120 s apart
    step = max(1, int(round(60 / (SAMPLE_EVERY_FRAMES / fps))))
    growth = [(samples[i]["burn_a"] - samples[i - step]["burn_a"], i) for i in range(step, len(samples))]
    used: list[float] = []
    for g, i in sorted(growth, reverse=True):
        s = samples[i]
        if g <= 0 or any(abs(s["sec"] - u) < 150 for u in used) or len(used) >= 3:
            continue
        used.append(s["sec"])
        newmask = (s["cum"] > 0) & ~(samples[i - step]["cum"] > 0)
        add("visible_fire_expansion", s, "alert" if len(used) == 1 else "watch", f"Burned area +{g:.0f} m² in 60 s", f"Observed burned ground grew by {g:.0f} m² over the previous minute (now {s['burn_a']:.0f} m² in view). Growth concentrated in the marked region.", ["new dark burned ground", "advancing flame front"], newmask.astype(np.uint8))
    # spot fires: flame blobs well outside the dilated burned scar
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    last_spot = -999.0
    for s in samples:
        near = cv2.dilate(s["cum"], k)
        n, lab, stats, cents = cv2.connectedComponentsWithStats(s["flame_mask"], 8)
        far = [kk for kk in range(1, n) if stats[kk, cv2.CC_STAT_AREA] >= 15 and near[int(cents[kk][1]), int(cents[kk][0])] == 0]
        if far and s["sec"] > 60 and s["sec"] - last_spot > 120 and len([e for e in ev if e["event_type"] == "new_fire_activity"]) < 3:
            last_spot = s["sec"]
            mask = np.isin(lab, far).astype(np.uint8)
            add("new_fire_activity", s, "alert", "Flames ahead of the burned front", f"{len(far)} flame region(s) detected outside the existing burned area — possible spot ignition or front jump. Requires human review.", ["isolated flame blob", "unburned vegetation around it"], mask)
    # smoke surges
    sm = np.array([s["smoke"] for s in samples])
    if len(sm) > 20:
        base_s = np.convolve(sm, np.ones(15) / 15, mode="same")
        cand = [(sm[i] - base_s[i], i) for i in range(len(sm)) if sm[i] > 0.06]
        used = []
        for d, i in sorted(cand, reverse=True):
            if d <= 0.02 or any(abs(i - u) < 30 for u in used) or len(used) >= 2:
                continue
            used.append(i)
            s = samples[i]
            add("smoke_increase", s, "info", "Dense smoke over view", f"Low-saturation haze covers {sm[i] * 100:.0f}% of the analysed frame (local mean {base_s[i] * 100:.0f}%). Segmentation may be less reliable in this window.", ["grey low-texture plume"], (s["cum"] * 0).astype(np.uint8) + 1)
    # peak flame intensity (visible extent, not temperature)
    peak = max(samples, key=lambda s: s["flame_px"])
    add("intensity_change", peak, "watch", "Peak visible flame extent", f"Largest visible flame extent of the recording ({peak['flame_px']} px, ≈{peak['fire_a']:.0f} m² on the ground). RGB cannot measure temperature.", ["longest continuous flame line"], peak["flame_mask"])
    half = next((s for s in samples if s["burn_px"] > 0.5), None)
    if half:
        add("burned_ground_visible", half, "info", "Over half of view burned", f"Burned ground now covers {half['burn_px'] * 100:.0f}% of the analysed frame ({half['burn_a']:.0f} m² on the ground).", ["blackened ground dominates"], half["cum"])
    ev.sort(key=lambda e: e["_sec"])
    for i, e in enumerate(ev):
        e["event_id"] = f"evt_{i + 1:03d}"
        e.pop("_sec")
    return ev


if __name__ == "__main__":
    import sys
    run(float(sys.argv[1]) if len(sys.argv) > 1 else None)
