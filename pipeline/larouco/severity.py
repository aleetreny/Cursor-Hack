"""Burn severity from Sentinel-2: dNBR between the clear scenes before (1 Aug 2025) and after (5 Sep 2025) the fire.

    python -m pipeline.larouco.severity

NBR = (B8A − B12) / (B8A + B12) on L2A surface reflectance; dNBR = NBR_pre − NBR_post. Classes follow Key & Benson
(2006, FIREMON), the thresholds used by USGS and EFFIS: < 0.10 unburned or regrowth, 0.10–0.27 low, 0.27–0.44
moderate-low, 0.44–0.66 moderate-high, ≥ 0.66 high. Clouds, cloud shadow, cirrus, water and snow in either scene (the
L2A scene classification, SCL) are left unclassified. Only cells inside the EMS scar are classed: outside it a dNBR
change is not this fire (harvests, other burns, phenology).
"""
from __future__ import annotations

import numpy as np

from .common import CACHE, GRID, RAW, write_json

CLASSES = [  # (upper bound, id, label)
    (0.10, 1, "Unburned / regrowth"),
    (0.27, 2, "Low"),
    (0.44, 3, "Moderate-low"),
    (0.66, 4, "Moderate-high"),
    (np.inf, 5, "High"),
]
BAD_SCL = {0, 1, 3, 6, 8, 9, 10, 11}   # no data, saturated, cloud shadow, water, cloud (medium, high), cirrus, snow


def nbr(s):
    n, w = s["nir08"].astype("float64"), s["swir22"].astype("float64")
    return (n - w) / np.maximum(n + w, 1e-6)


def main():
    pre, post = np.load(RAW / "s2" / "pre.npz"), np.load(RAW / "s2" / "post.npz")
    a = np.load(CACHE / "arrival.npz")
    scar = a["scar"]
    ok = np.isfinite(pre["nir08"]) & np.isfinite(post["nir08"])
    for s in (pre, post):
        scl = np.nan_to_num(s["scl"], nan=0).astype(int)
        ok &= ~np.isin(scl, list(BAD_SCL))
    dnbr = np.where(ok, nbr(pre) - nbr(post), np.nan).astype("float32")
    cls = np.zeros(dnbr.shape, "uint8")
    lo = -np.inf
    for hi, k, _ in CLASSES:
        cls[scar & ok & (dnbr >= lo) & (dnbr < hi)] = k
        lo = hi
    ha = GRID.res ** 2 / 1e4
    stats = {"scene_pre": [str(x) for x in pre["ids"]], "scene_post": [str(x) for x in post["ids"]],
             "valid_share_of_scar": round(float((ok & scar).sum() / scar.sum()), 3),
             "mean_dnbr_in_scar": round(float(np.nanmean(dnbr[scar])), 3),
             "classes": [{"id": k, "label": lab, "ha": round(float((cls == k).sum() * ha)), "share": round(float((cls == k).sum() / max(1, (cls > 0).sum())), 3)} for _, k, lab in CLASSES]}
    for c in stats["classes"]:
        print(f"  {c['label']:20s} {c['ha']:8,d} ha  {c['share'] * 100:4.1f}%")
    print(f"  valid {stats['valid_share_of_scar'] * 100:.0f}% of the scar, mean dNBR {stats['mean_dnbr_in_scar']}")
    np.savez_compressed(CACHE / "severity.npz", dnbr=dnbr, cls=cls)
    # true colour before / after (L2A reflectance ×10⁴ → display with a fixed stretch, same for both)
    for name, s in (("pre", pre), ("post", post)):
        rgb = np.dstack([s["red"], s["green"], s["blue"]]).astype("float32")
        rgb = np.clip(np.nan_to_num(rgb) / 2600.0, 0, 1) ** (1 / 1.6)
        np.save(CACHE / f"rgb_{name}.npy", (rgb * 255).astype("uint8"))
    write_json(CACHE / "severity.json", stats, indent=1)


if __name__ == "__main__":
    main()
