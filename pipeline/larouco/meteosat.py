"""EUMETSAT LSA SAF Meteosat FRP-PIXEL (LSA-502): fire detections every 15 min, for the timing between polar passes.

    # download (needs a free LSA SAF account; credentials come from the environment, never from a file in the repo)
    LSASAF_USER=… LSASAF_PASSWORD=… python -m pipeline.larouco.meteosat download
    # then (no credentials needed)
    python -m pipeline.larouco.meteosat process

Files: HDF5_LSASAF_MSG_FRP-PIXEL-ListProduct_MSG-Disk_YYYYMMDDhhmm (one per 15 min, ~185 kB: every fire pixel on
the Meteosat disk). Licence CC BY 4.0, attribution "EUMETSAT LSA SAF [FRP-PIXEL, LSA-502]".
"""
from __future__ import annotations

import base64
import bz2
import gzip
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np

from .common import CACHE, GRID, RAW, iso, write_json

BASE = "https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MSG/FRP-PIXEL/HDF5"
DIR = RAW / "meteosat"
DAYS = [datetime(2025, 8, 12, tzinfo=timezone.utc) + timedelta(days=k) for k in range(16)]   # 12–27 Aug 2025


def download():
    user, pw = os.environ.get("LSASAF_USER"), os.environ.get("LSASAF_PASSWORD")
    if (not user or not pw) and sys.stdin.isatty():
        # typed by the account owner at the prompt; kept in memory for this run only
        import getpass
        user = user or input("LSA SAF user: ").strip()
        pw = pw or getpass.getpass("LSA SAF password: ")
    if not user or not pw:
        sys.exit("Run this in a terminal (it asks for the LSA SAF user and password), or set LSASAF_USER / LSASAF_PASSWORD.")
    auth = "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()
    DIR.mkdir(parents=True, exist_ok=True)
    total = got = 0
    for d in DAYS:
        url = f"{BASE}/{d:%Y/%m/%d}/"
        html = urllib.request.urlopen(url, timeout=120).read().decode()   # listings are public
        names = sorted(set(re.findall(r"HDF5_LSASAF_MSG_FRP-PIXEL-ListProduct_MSG-Disk_\d{12}[^\"<]*", html)))
        for n in names:
            total += 1
            dest = DIR / n
            if dest.exists() and dest.stat().st_size > 0:
                continue
            for k in range(3):
                try:
                    req = urllib.request.Request(url + n, headers={"Authorization": auth, "User-Agent": "FireScope3D-pipeline/1.0"})
                    data = urllib.request.urlopen(req, timeout=300).read()
                    dest.write_bytes(data); got += 1
                    break
                except urllib.error.HTTPError as e:
                    if e.code in (401, 403):
                        sys.exit(f"LSA SAF refused the credentials (HTTP {e.code}). Check the account is active.")
                    time.sleep(3 * (k + 1))
                except Exception:   # noqa: BLE001 — network: retry
                    time.sleep(3 * (k + 1))
        print(f"  {d:%Y-%m-%d}: {len(names)} files", flush=True)
    print(f"done: {got} downloaded, {total} listed → {DIR}")


def read(path):
    """The fire pixels of one ListProduct file (confidence ≥ 0.5): lat, lon, FRP (MW), FRP uncertainty (MW), pixel size (km)."""
    import h5py
    raw = path.read_bytes()
    if raw[:3] == b"BZh":
        raw = bz2.decompress(raw)
    elif raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    import io
    with h5py.File(io.BytesIO(raw), "r") as f:
        def get(name):
            ds = f[name]
            v = ds[()].astype("float64").ravel()
            mv = ds.attrs.get("MISSING_VALUE")
            if mv is not None:
                v[v == float(np.asarray(mv).ravel()[0])] = np.nan
            sf = float(np.asarray(ds.attrs.get("SCALING_FACTOR", 1.0)).ravel()[0])
            return v / sf if sf not in (0, 1) else v
        keys = {k.upper(): k for k in f.keys()}
        lat, lon, frp = get(keys["LATITUDE"]), get(keys["LONGITUDE"]), get(keys["FRP"])
        unc = get(keys["FRP_UNCERTAINTY"]) if "FRP_UNCERTAINTY" in keys else np.full_like(frp, np.nan)
        size = get(keys["PIXEL_SIZE"]) if "PIXEL_SIZE" in keys else np.full_like(frp, np.nan)
        conf = get(keys["FIRE_CONFIDENCE"]) if "FIRE_CONFIDENCE" in keys else np.ones_like(frp)
    keep = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(frp) & ~(conf < 0.5)   # LSA SAF fire confidence ≥ 0.5
    return lat[keep], lon[keep], frp[keep], unc[keep], size[keep]


def process():
    """Fire pixels inside the analysis box, every 15 min → cache/meteosat.json (time, lon, lat, FRP, pixel size)."""
    files = sorted(DIR.glob("HDF5_LSASAF_MSG_FRP-PIXEL-ListProduct_MSG-Disk_*"))
    if not files:
        sys.exit(f"No files in {DIR}: run the download first.")
    w, s, e, n = GRID.bbox_ll
    out, slots = [], []
    for fp in files:
        t = datetime.strptime(re.search(r"_(\d{12})", fp.name).group(1), "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        slots.append(iso(t))
        try:
            lat, lon, frp, unc, size = read(fp)
        except Exception as ex:   # noqa: BLE001
            print(f"  skip {fp.name}: {ex}")
            continue
        m = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
        for i in np.nonzero(m)[0]:
            out.append({"t": iso(t), "lon": round(float(lon[i]), 5), "lat": round(float(lat[i]), 5), "frp": round(float(frp[i]), 1),
                        "frp_unc": None if np.isnan(unc[i]) else round(float(unc[i]), 1), "km2": None if np.isnan(size[i]) else round(float(size[i]), 2)})
    write_json(CACHE / "meteosat.json", {"slots": slots, "pixels": out})
    print(f"{len(files)} files, {len(slots)} slots, {len(out)} fire pixels in the box")


if __name__ == "__main__":
    {"download": download, "process": process}[sys.argv[1] if len(sys.argv) > 1 else "process"]()
