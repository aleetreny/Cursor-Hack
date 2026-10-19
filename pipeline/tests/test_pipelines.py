"""Fast checks of the offline pipelines (no network, no dataset download): run with `python -m pytest pipeline/tests -q`."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
PINHAO = ROOT / "data" / "processed" / "drone_replay_01"
LAROUCO = ROOT / "data" / "processed" / "larouco"


def test_iou_metrics():
    from pipeline.pinhao.segment import iou_prf
    a = np.zeros((10, 10), np.uint8); a[:5] = 1
    b = np.zeros((10, 10), np.uint8); b[:, :5] = 1
    m = iou_prf(a, b)
    assert m["iou"] == pytest.approx(25 / 75)
    assert m["precision"] == pytest.approx(0.5) and m["recall"] == pytest.approx(0.5)


def test_colour_rules_find_flames_not_grass():
    from pipeline.pinhao.segment import raw_masks
    img = np.zeros((360, 640, 3), np.uint8)
    img[:] = (40, 120, 60)                         # green vegetation (BGR)
    img[200:260, 300:380] = (30, 140, 250)         # saturated orange flames
    m = raw_masks(img)
    assert m["flame"][210:250, 310:370].mean() > 0.9
    assert m["flame"][300:, :200].sum() == 0


def test_learned_segmenter_runs():
    from pipeline.pinhao.segment import LearnedBurned
    if not LearnedBurned.PATH.exists():
        pytest.skip("segmenter not trained (python -m pipeline.pinhao.segmenter train)")
    seg = LearnedBurned()
    p = seg.prob(np.zeros((720, 1280, 3), np.uint8))
    assert p.shape == (seg.h, seg.w) and 0 <= p.min() <= p.max() <= 1
    m = seg.mask(np.zeros((720, 1280, 3), np.uint8), (360, 640))
    assert m.shape == (360, 640) and m[: int(360 * 0.21)].sum() == 0   # far field excluded


def test_pinhao_package_is_consistent():
    tl = json.loads((PINHAO / "timeline.json").read_text())
    ev = json.loads((PINHAO / "eval.json").read_text())
    times = [f["video_seconds"] for f in tl["frames"]]
    assert times == sorted(times) and len(times) > 200
    assert ev["frames_evaluated"] > 0 and ev["mean"]["iou"] > 0.85          # held-out frames only
    assert ev["by_split"]["val"]["frames"] == ev["frames_evaluated"]


def test_larouco_package_is_consistent():
    inc = json.loads((LAROUCO / "incident.json").read_text())
    ev = json.loads((LAROUCO / "eval.json").read_text())
    assert inc["scale"] == "regional" and inc["summary"]["burned_ha"] > 30000
    assert all(0.7 < r["iou_leave_one_out"] <= 1 for r in ev["perimeters"])
    for p in inc["satellite"]["passes"]:
        assert (LAROUCO / p["image"]).exists()
    vi = json.loads((LAROUCO / "visual_index.json").read_text())
    assert (LAROUCO / "visual_index.bin").stat().st_size == vi["count"] * vi["dim"]


def test_larouco_grid():
    from pipeline.larouco.common import GRID
    w, s, e, n = GRID.bbox_ll
    assert w < -7.2 and e > -6.9 and s < 42.3 and n > 42.5
    assert GRID.res == 30.0 and GRID.W > 1000 and GRID.H > 1000
