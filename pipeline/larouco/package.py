"""Write the Larouco incident package (data/processed/larouco/) from the reconstruction, severity and raw inputs.

    python -m pipeline.larouco.package

Files (the same contract as the drone incident, plus the arrival-time field):
  incident.json      name, place, box, final EMS perimeter, progression field description, credits
  arrival.png        RGBA on a lon/lat-aligned grid: R·256+G = minutes after progression.t0 when the cell burned
                     (65535 = did not burn), B = burn-severity class × 40 (0 = outside the scar), A = 255
  timeline.json      one frame per hour: burned area, growth, area reached in the previous 6 h, spread rate, the latest
                     satellite pass (detections, fire radiative power)
  events.json        events derived from the data (first detection, milestones, fastest growth, perimeters, weather)
  observations.json  dated Copernicus EMS perimeters (outlines) and FIRMS detections (points)
  weather.json       ERA5 hourly at the centre of the scar
  sources.json, clips.json   empty: no video of this fire is published here (see the manifest)
  eval.json          leave-one-out IoU of the progression against the EMS perimeters, severity classes
"""
from __future__ import annotations

import json
import math
from datetime import timedelta

import numpy as np
from PIL import Image
from rasterio.features import shapes
from shapely.geometry import MultiPolygon, mapping, shape
from shapely.ops import unary_union

from .common import CACHE, GRID, INCIDENT_ID, OUT, RAW, TO_LL, TO_UTM, iso, utc, write_json
from .progression import T0
from .severity import CLASSES

HA = GRID.res ** 2 / 1e4
NEVER_MIN = 65535
MODEL = "firescope-progression v1 (FIRMS VIIRS/MODIS first detection + Copernicus EMS perimeters, IDW, σ 150 m)"
SEV_LABELS = {k: lab for _, k, lab in CLASSES}


def lonlat_grid():
    """A lon/lat-aligned raster over the analysis box, ~30 m cells, sampled from the UTM grid (nearest)."""
    w, s, e, n = GRID.bbox_ll
    lat0 = (s + n) / 2
    W = int(math.ceil((e - w) * 111320 * math.cos(math.radians(lat0)) / GRID.res))
    H = int(math.ceil((n - s) * 111320 / GRID.res))
    lon = w + (np.arange(W) + 0.5) * (e - w) / W
    lat = n - (np.arange(H) + 0.5) * (n - s) / H
    LON, LAT = np.meshgrid(lon, lat)
    x, y = TO_UTM.transform(LON, LAT)
    r, c = GRID.rc(x, y)
    r, c = np.floor(r).astype(int), np.floor(c).astype(int)
    inside = (r >= 0) & (r < GRID.H) & (c >= 0) & (c < GRID.W)
    return (w, s, e, n), W, H, np.clip(r, 0, GRID.H - 1), np.clip(c, 0, GRID.W - 1), inside


def to_lonlat_geom(g, tol=30.0):
    g = g.simplify(tol, preserve_topology=True)
    from shapely import transform as stransform
    return stransform(g, lambda c: np.column_stack(TO_LL.transform(c[:, 0], c[:, 1])))


def vectorize(mask: np.ndarray, min_ha=2.0, fill_holes_ha=0.0):
    """Outline of a mask. For display, unburnt islands smaller than `fill_holes_ha` are filled (a 33,000 ha scar has
    thousands of them, which would draw as a litter of tiny rings)."""
    if fill_holes_ha > 0:
        from scipy import ndimage
        holes = ndimage.binary_fill_holes(mask) & ~mask
        lab, n = ndimage.label(holes)
        if n:
            sizes = ndimage.sum(holes, lab, range(1, n + 1)) * HA
            small = np.isin(lab, np.nonzero(sizes < fill_holes_ha)[0] + 1)
            mask = mask | small
    polys = [shape(geom) for geom, v in shapes(mask.astype("uint8"), mask=mask, transform=GRID.transform) if v == 1]
    polys = [p for p in polys if p.area / 1e4 >= min_ha]
    u = unary_union(polys) if polys else MultiPolygon()
    return u


def r6(g, nd=6):
    return json.loads(json.dumps(mapping(g)), parse_float=lambda v: round(float(v), nd))


def main():
    a = np.load(CACHE / "arrival.npz")
    T, scar = a["T"], a["scar"]
    sev = np.load(CACHE / "severity.npz")["cls"]
    pm = np.load(CACHE / "perimeters.npz")
    perims = json.loads((CACHE / "perimeters.json").read_text())
    dets = json.loads((CACHE / "detections.json").read_text())
    ev_prog = json.loads((CACHE / "progression_eval.json").read_text())
    sev_stats = json.loads((CACHE / "severity.json").read_text())
    fin = np.isfinite(T)
    # the perimeters that grow the mapped scar (EMS re-mapping of an unchanged scar wobbles by a few hundred ha)
    growing, top = [], 0
    for p in perims:
        if p["burned_ha"] > max(top * 1.01, 0):
            growing.append(p)
            top = p["burned_ha"]

    # ------------------------------------------------------------------ arrival.png (lon/lat aligned)
    bbox, W, H, rr, cc, inside = lonlat_grid()
    Tm = np.where(fin, np.clip(np.round(T * 60), 0, NEVER_MIN - 1), NEVER_MIN).astype("uint16")
    A = np.where(inside, Tm[rr, cc], NEVER_MIN).astype("uint16")
    S = np.where(inside, sev[rr, cc], 0).astype("uint8")
    rgba = np.dstack([(A >> 8).astype("uint8"), (A & 255).astype("uint8"), (S * 40).astype("uint8"), np.full(A.shape, 255, "uint8")])
    Image.fromarray(rgba, "RGBA").save(OUT / "arrival.png", optimize=True)
    # retrospective spread scenario (scenario.py), same grid and encoding
    scen = None
    if (CACHE / "scenario.npz").exists():
        Ts = np.load(CACHE / "scenario.npz")["T"]
        Sm = np.where(np.isfinite(Ts), np.clip(np.round(Ts * 60), 0, NEVER_MIN - 1), NEVER_MIN).astype("uint16")
        Sg = np.where(inside, Sm[rr, cc], NEVER_MIN).astype("uint16")
        Image.fromarray(np.dstack([(Sg >> 8).astype("uint8"), (Sg & 255).astype("uint8"), np.zeros(Sg.shape, "uint8"), np.full(Sg.shape, 255, "uint8")]), "RGBA").save(OUT / "scenario.png", optimize=True)
        scen = json.loads((CACHE / "scenario.json").read_text())
        Ts_sorted = np.sort(Ts[np.isfinite(Ts)])
    print(f"arrival.png {W}×{H}, {(OUT / 'arrival.png').stat().st_size / 1e6:.1f} MB")

    # ------------------------------------------------------------------ hourly series
    # Spread direction from the arrival field smoothed at 1 km (passes are hours apart, so finer gradients only show the
    # smoothing between them). Spread rate: see the expansion rate below.
    from scipy import ndimage
    s_ = 1000 / GRID.res
    num = ndimage.gaussian_filter(np.where(fin, T, 0).astype("float64"), s_)
    den = ndimage.gaussian_filter(fin.astype("float64"), s_)
    Tl = np.where(fin, num / np.maximum(den, 1e-6), np.nan)
    gy, gx = np.gradient(Tl, GRID.res)                           # h per m; rows go south, so north = −gy
    bearing = (np.degrees(np.arctan2(gx, -gy)) + 360) % 360       # direction of increasing arrival time = spread
    h_first = float(np.floor(T[fin].min())) - 3
    h_last = float(np.ceil(T[fin].max())) + 12
    hours = np.arange(h_first, h_last + 1)
    Tf = T[fin]
    order = np.sort(Tf)
    det_t = np.array([(utc(d["t"]) - T0).total_seconds() / 3600 for d in dets])
    det_frp = np.array([d["frp"] for d in dets])
    passes = sorted(set(np.round(det_t, 4)))
    # Meteosat FRP-PIXEL (every 15 min), when downloaded: fire power summed over the pixels within 3 km of the scar
    msg_slot = None
    if (CACHE / "meteosat.json").exists():
        from scipy import ndimage as _nd
        mj = json.loads((CACHE / "meteosat.json").read_text())
        near = _nd.binary_dilation(scar, iterations=100)   # 3 km
        msg_slot = {}
        for d in mj["pixels"]:
            x, y = TO_UTM.transform(d["lon"], d["lat"]); r_, c_ = GRID.rc(x, y)
            if 0 <= r_ < GRID.H and 0 <= c_ < GRID.W and near[int(r_), int(c_)]:
                msg_slot[d["t"]] = msg_slot.get(d["t"], 0.0) + d["frp"]
        for t_ in mj["slots"]:
            msg_slot.setdefault(t_, 0.0)
        msg_h = sorted(((utc(k) - T0).total_seconds() / 3600, v) for k, v in msg_slot.items())
    br_f = bearing[fin]
    frames = []
    for h in hours:
        burned = np.searchsorted(order, h, side="right") * HA * 1e4
        prev = np.searchsorted(order, h - 1, side="right") * HA * 1e4
        recent = burned - np.searchsorted(order, h - 6, side="right") * HA * 1e4
        sel = (Tf > h - 3) & (Tf <= h + 3)
        n_sel = int(sel.sum())
        # Expansion rate: growth of the equivalent radius √(A/π) over the 6 h around t. The reconstruction cannot place
        # a front line (passes are hours apart, detections are 375 m–1 km pixels), so this is the speed of the scar as
        # a whole: well defined, and lower than the head-fire speed.
        a_hi = np.searchsorted(order, h + 3, side="right") * HA * 1e4
        a_lo = np.searchsorted(order, h - 3, side="right") * HA * 1e4
        ros = bear = None
        if n_sel >= 25 and a_hi - a_lo > 20 * 1e4:
            ros = (math.sqrt(a_hi / math.pi) - math.sqrt(a_lo / math.pi)) / 360.0
            b_ = np.radians(br_f[sel]); bear = float((np.degrees(np.arctan2(np.nanmean(np.sin(b_)), np.nanmean(np.cos(b_)))) + 360) % 360)
        # where the front is: centroid and equivalent radius of the cells reached in the previous 6 h (drives the
        # simulated drones and aircraft, which work where the fire is)
        rec = fin & (T > h - 6) & (T <= h)
        if rec.sum() >= 30:
            rr_, cc_ = np.nonzero(rec)
            fx, fy = GRID.x0 + (cc_.mean() + 0.5) * GRID.res, GRID.y0 - (rr_.mean() + 0.5) * GRID.res
            flon, flat = TO_LL.transform(fx, fy)
            front = {"center": [round(flon, 5), round(flat, 5)], "radius_m": round(max(500.0, math.sqrt(rec.sum() * GRID.res ** 2 / math.pi)))}
        else:
            front = None
        # latest satellite pass within 12 h
        pk = [p for p in passes if h - 12 < p <= h]
        if pk:
            m = np.abs(det_t - pk[-1]) < 1e-3
            n_det, frp, pass_t = int(m.sum()), float(det_frp[m].sum()), iso(T0 + timedelta(hours=float(pk[-1])))
        else:
            n_det, frp, pass_t = 0, 0.0, None
        ts = iso(T0 + timedelta(hours=float(h)))
        frames.append({
            "timestamp": ts, "source_id": "progression", "video_seconds": float((h - h_first) * 3600), "source_frame": int(h - h_first),
            "burned_area_m2": {"value": round(burned), "unit": "m2", "provenance": "derived", "method": "reconstructed arrival time ≤ t (FIRMS + EMS perimeters)"},
            "active_fire_area_m2": {"value": round(recent), "unit": "m2", "provenance": "derived", "method": "area reached in the previous 6 h"},
            "area_change_m2": {"value": round(burned - prev), "unit": "m2", "provenance": "derived", "method": "growth in the hour"},
            "hotspot_count": {"value": n_det, "unit": "count", "provenance": "external", "method": "FIRMS detections in the scar, latest pass ≤ 12 h"},
            "front_advance_m_min": {"value": None if ros is None else round(ros, 2), "unit": "m/min", "provenance": "derived", "method": "expansion rate: growth of the equivalent radius √(A/π) over the 6 h around t (lower than the head-fire speed)"},
            "front_bearing_deg": {"value": None if bear is None else round(bear), "unit": "deg", "provenance": "derived", "method": "mean direction of spread (∇ of the arrival time smoothed at 1 km) of the cells reached in the 6 h around t"},
            "frp_mw": {"value": round(frp, 1), "unit": "MW", "provenance": "external", "method": "sum of FIRMS fire radiative power, latest pass ≤ 12 h"},
            "scenario_burned_m2": None if scen is None else {"value": round(float(np.searchsorted(Ts_sorted, h, side="right") * HA * 1e4)), "unit": "m2", "provenance": "model", "method": "retrospective scenario: fuels + terrain + ERA5 weather, no suppression"},
            "pass_time": pass_t,
            "msg_frp_mw": None if msg_slot is None else {"value": round(float(np.mean([v for hh, v in msg_h if h - 1 < hh <= h] or [0.0])), 1), "unit": "MW", "provenance": "external", "method": "EUMETSAT LSA SAF FRP-PIXEL (Meteosat, every 15 min), fire pixels within 3 km of the scar, mean over the hour"},
            "front": front,
            "has_ground_truth": False,
        })
    start, end = frames[0]["timestamp"], frames[-1]["timestamp"]
    t_of = lambda h: iso(T0 + timedelta(hours=float(h)))   # noqa: E731

    # ------------------------------------------------------------------ events (all derived from the data)
    def where(m):
        r, c = np.nonzero(m)
        if not len(r):
            return None
        x, y = GRID.x0 + (c.mean() + 0.5) * GRID.res, GRID.y0 - (r.mean() + 0.5) * GRID.res
        lon, lat = TO_LL.transform(x, y)
        return [round(lon, 5), round(lat, 5)]

    events = []

    def add(kind, h, title, desc, sev="info", loc=None, prov="derived", dur_h=1.0, evidence=None):
        events.append({"event_id": f"evt_{len(events) + 1:03d}", "source_id": "progression", "start_seconds": float((h - h_first) * 3600),
                       "end_seconds": float((h - h_first + dur_h) * 3600), "timestamp": t_of(h), "event_type": kind, "title": title, "description": desc,
                       "visual_evidence": evidence or [], "confidence": None, "review_required": True, "severity": sev, "processing_model": MODEL,
                       "location": loc, "image_region": None, "thumbnail_url": None, "provenance": prov})

    i0 = int(np.argmin(det_t))
    d0 = dets[i0]
    lon0, lat0 = TO_LL.transform(d0["x"], d0["y"])
    add("first_visible_flames", det_t[i0], "First satellite detection",
        f"FIRMS {d0['sensor']} ({'S-NPP' if d0['sat'] == 'N' else 'Terra' if d0['sat'] == 'T' else 'Aqua'}) detects fire inside what became the scar, {d0['frp']:.0f} MW. "
        "The first EMS image (13 Aug, 11:21 UTC, Sentinel-2) saw only part of the area and no burnt ground in it yet.", "watch", [round(lon0, 5), round(lat0, 5)], "external")
    for ha in (1000, 5000, 10000, 20000, 30000):
        k = np.searchsorted(order, 0)  # noqa: F841
        idx = int(math.ceil(ha / HA)) - 1
        if idx < len(order):
            h = float(order[idx])
            add("visible_fire_expansion", h, f"Passes {ha:,} ha", f"The reconstructed burned area reaches {ha:,} ha.", "watch" if ha < 10000 else "alert", None)   # a total, not a place: no map pin
    # fastest 6-hour growth (non-overlapping windows)
    g6 = np.array([np.searchsorted(order, h, side="right") - np.searchsorted(order, h - 6, side="right") for h in hours]) * HA
    taken = []
    for k in np.argsort(-g6):
        h = hours[k]
        if any(abs(h - t) < 18 for t in taken) or g6[k] < 300:
            continue
        taken.append(h)
        add("visible_fire_expansion", h - 6, f"Fast run: +{g6[k]:,.0f} ha in 6 h", f"{g6[k]:,.0f} ha reached between {t_of(h - 6)[11:16]} and {t_of(h)[11:16]} UTC — "
            f"{g6[k] / 6:,.0f} ha per hour. Timing is limited by the satellite passes (about six a day).", "alert", where(fin & (T > h - 6) & (T <= h)), dur_h=6)
        if len(taken) >= 4:
            break
    # strongest satellite pass
    pass_frp = {p: float(det_frp[np.abs(det_t - p) < 1e-3].sum()) for p in passes}
    pmax = max(pass_frp, key=pass_frp.get)
    m = np.abs(det_t - pmax) < 1e-3
    add("intensity_change", pmax, f"Most intense pass: {pass_frp[pmax]:,.0f} MW", f"{int(m.sum())} FIRMS detections in the scar on one pass, total fire radiative power {pass_frp[pmax]:,.0f} MW.", "alert", None, "external")
    # Copernicus EMS perimeters
    for p in growing:
        h = (utc(p["t"]) - T0).total_seconds() / 3600
        if h > h_last:
            continue
        add("burned_ground_visible", h, f"EMS perimeter: {p['burned_ha']:,} ha",
            f"Copernicus EMS {p['name'].replace('_', ' ').title()} ({', '.join(p['sensors'])}, {p['t'][:16].replace('T', ' ')} UTC) maps {p['burned_ha']:,} ha of the final scar burnt"
            + ("" if p["seen_share"] > 0.95 else f"; the image covers {p['seen_share'] * 100:.0f}% of the scar") + ".", "info", None, "external")
    # growth stops
    daily = [(h, np.searchsorted(order, h, side="right") - np.searchsorted(order, h - 24, side="right")) for h in hours]
    lastg = max(h for h, n in daily if n * HA >= 50)
    add("other", lastg, "Growth below 50 ha a day", "From here the reconstructed scar grows by less than 50 ha in 24 h.", "info", None)
    # weather extremes during the main growth
    wx = json.loads(next((RAW / "weather").glob("era5_*.json")).read_text())["hourly"]
    wt = [(utc(t + ":00Z") - T0).total_seconds() / 3600 for t in wx["time"]]
    span = [i for i, h in enumerate(wt) if h_first <= h <= lastg]
    ig = max(span, key=lambda i: wx["wind_gusts_10m"][i] or 0)
    add("other", wt[ig], f"Strongest gusts: {wx['wind_gusts_10m'][ig]:.0f} km/h", f"ERA5 reanalysis: gusts of {wx['wind_gusts_10m'][ig]:.0f} km/h from {wx['wind_direction_10m'][ig]:.0f}° at the scar's centre (25 km cell, not an on-site measurement).", "watch", None, "external")
    ir = min(span, key=lambda i: wx["relative_humidity_2m"][i] or 100)
    add("other", wt[ir], f"Driest hour: {wx['relative_humidity_2m'][ir]:.0f}% humidity", f"ERA5: {wx['temperature_2m'][ir]:.1f} °C and {wx['relative_humidity_2m'][ir]:.0f}% relative humidity (VPD {wx['vapour_pressure_deficit'][ir]:.1f} kPa).", "watch", None, "external")
    events.sort(key=lambda e: e["timestamp"])
    for k, e in enumerate(events):
        e["event_id"] = f"evt_{k + 1:03d}"

    # ------------------------------------------------------------------ observations
    feats = []
    for p in growing:
        g = to_lonlat_geom(vectorize(pm[p["name"]], min_ha=20, fill_holes_ha=40), tol=45.0)
        feats.append({"type": "Feature", "geometry": r6(g, 5), "properties": {
            "id": f"ems_{p['name'].lower()}", "classification": "external_perimeter", "timestamp": p["t"], "source_id": "copernicus_ems",
            "source_frame": 0, "video_seconds": 0, "georeferencing_method": "none", "georeferencing_accuracy": "measured",
            "area_m2": p["burned_ha"] * 1e4, "provenance": "external", "model": f"Copernicus EMS {p['name']} ({', '.join(p['sensors'])})"}})
    hot = []
    for k, d in enumerate(dets):
        lon, lat = TO_LL.transform(d["x"], d["y"])
        hot.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}, "properties": {
            "id": f"firms_{k}", "timestamp": d["t"], "source_id": "firms", "video_seconds": 0, "kind": "satellite_firms", "temperature_c": None,
            "provenance": "external", "frp_mw": d["frp"], "sensor": d["sensor"], "radius_m": d["r"]}})

    final = to_lonlat_geom(vectorize(scar, min_ha=20, fill_holes_ha=40), tol=45.0)
    w, s, e, n = final.bounds
    cx, cy = TO_LL.transform(*TO_UTM.transform((w + e) / 2, (s + n) / 2))

    # ------------------------------------------------------------------ weather
    hourly = []
    for i, t in enumerate(wx["time"]):
        hourly.append({"timestamp": t + ":00Z", "temp_c": wx["temperature_2m"][i], "rh_pct": wx["relative_humidity_2m"][i], "wind_kmh": wx["wind_speed_10m"][i],
                       "wind_dir_deg": wx["wind_direction_10m"][i], "gust_kmh": wx["wind_gusts_10m"][i], "soil_moisture_m3m3": wx["soil_moisture_0_to_7cm"][i], "vpd_kpa": wx["vapour_pressure_deficit"][i]})
    wfile = next((RAW / "weather").glob("era5_*.json"))
    wj = json.loads(wfile.read_text())
    weather = {"source": "ERA5 reanalysis via Open-Meteo archive API", "grid": "~25 km cell, hourly", "provenance": "external",
               "elevation_m": wj.get("elevation"), "location": [round(wj["longitude"], 5), round(wj["latitude"], 5)], "hourly": hourly}

    # ------------------------------------------------------------------ incident
    total_ha = round(float(scar.sum() * HA))
    incident = {
        "id": INCIDENT_ID, "name": "Larouco Wildfire", "kind": "wildfire", "scale": "regional",
        "location": "Ourense, Galicia, ES", "center": [round(cx, 5), round(cy, 5)],
        "bbox": [round(v, 5) for v in bbox], "start": start, "end": end, "status": "analyzed",
        "summary": {"burned_ha": total_ha, "first_detection": t_of(det_t[i0]), "growth_below_50ha_day": t_of(lastg),
                    "high_severity_share": next(c["share"] for c in sev_stats["classes"] if c["id"] == 5)},
        "reference_perimeter": {"type": "Feature", "properties": {"name": "Final burnt area (Copernicus EMS EMSR837, 30 Aug 2025)"}, "geometry": r6(final, 5)},
        "progression": {"image": "arrival.png", "bbox": [round(v, 6) for v in bbox], "width": W, "height": H, "t0": iso(T0), "unit": "min",
                        "never": NEVER_MIN, "encoding": "R*256+G = minutes after t0; B = severity class*40", "severity_classes": [{"id": k, "label": SEV_LABELS[k]} for k in range(1, 6)],
                        "method": MODEL, "resolution_m": GRID.res},
        "scenario": None if scen is None else {"image": "scenario.png", "method": scen["method"], "calibrated_on": scen["calibrated_on"], "R0_m_h": scen["R0_m_h"],
                                               "perimeters": scen["perimeters"], "final_iou": scen["final_iou"], "median_timing_error_h": scen["median_timing_error_h"],
                                               "scenario_ha": scen["scenario_ha"], "real_ha": scen["real_ha"]},
        "landmarks": [],
        "attribution": [
            "Copernicus Emergency Management Service (© 2025 European Union), EMSR837",
            "NASA FIRMS (VIIRS S-NPP 375 m, MODIS) — LANCE/FIRMS",
            "Contains modified Copernicus Sentinel data (2025)",
            "ERA5 (Copernicus Climate Change Service) via Open-Meteo",
            "Elevation: AWS Terrain Tiles (Terrarium)", "Imagery: Esri World Imagery",
        ],
    }

    rows = ev_prog["perimeters"]
    evaluation = {
        "model": MODEL, "kind": "progression",
        "mean": {"iou": round(float(np.mean([r["iou_leave_one_out"] for r in rows])), 4), "iou_firms_only": round(float(np.mean([r["iou_firms_only"] for r in rows])), 4)},
        "perimeters": rows, "detections_in_scar": ev_prog["detections_in_scar"], "satellite_passes": len(ev_prog["passes"]),
        "severity": sev_stats,
        "notes": ["Each intermediate EMS perimeter is held out in turn and compared with the reconstruction built from the others (IoU inside that image's footprint).",
                  "Method parameters were chosen among 18 combinations on these same scores: they are slightly optimistic.",
                  "Timing between satellite passes (about six a day: VIIRS S-NPP, Terra and Aqua MODIS) is interpolated."],
    }

    # packaged terrain and imagery (basemap.py), when it has been built
    if (CACHE / "basemap.json").exists():
        bm = json.loads((CACHE / "basemap.json").read_text())
        incident["basemap"] = bm
        incident["attribution"] = [a for a in incident["attribution"] if not a.startswith(("Elevation:", "Imagery:"))] + bm["credits"]
    write_json(OUT / "incident.json", incident)
    write_json(OUT / "timeline.json", {"incident_id": INCIDENT_ID, "start": start, "end": end, "frames": frames, "events": events})
    write_json(OUT / "events.json", {"source_id": "progression", "events": events})
    write_json(OUT / "observations.json", {"type": "FeatureCollection", "features": feats, "hotspots": hot})
    write_json(OUT / "weather.json", weather)
    write_json(OUT / "sources.json", [])
    write_json(OUT / "clips.json", [])
    write_json(OUT / "eval.json", evaluation, indent=1)
    print(f"{INCIDENT_ID}: {total_ha:,} ha, {len(frames)} hourly frames {start} → {end}, {len(events)} events, {len(feats)} perimeters, {len(hot)} detections")
    for e in events:
        print(f"  {e['timestamp']}  {e['severity']:5s} {e['title']}")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:20s} {f.stat().st_size / 1e3:9.0f} kB")


if __name__ == "__main__":
    main()
