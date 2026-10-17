"""RGB segmentation baseline for the BurnedAreaUAV footage.

burned_area   : dark, low-saturation ground (char/ash) that is connected to the burned field, accumulated over time
active_fire   : saturated orange/yellow, very bright pixels (visible flames — NOT temperature)
smoke         : bright, low-saturation, low-texture haze

Classical colour/morphology rules — chosen because they are transparent, need no GPU and can be evaluated
against the dataset's manual masks (see evaluate()). A learned model can replace `raw_masks` later.
"""
from __future__ import annotations

import cv2
import numpy as np

from .config import HORIZON_FRAC

K5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
K9 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
K15 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))


def raw_masks(frame_bgr: np.ndarray, work_w: int = 640) -> dict[str, np.ndarray]:
    h, w = frame_bgr.shape[:2]
    small = cv2.resize(frame_bgr, (work_w, int(h * work_w / w)), interpolation=cv2.INTER_AREA)
    blur = cv2.GaussianBlur(small, (5, 5), 0)
    hsv = cv2.cvtColor(blur, cv2.COLOR_BGR2HSV)
    H, S, V = hsv[..., 0].astype(np.int16), hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
    b, g, r = [blur[..., i].astype(np.int16) for i in range(3)]
    sh = small.shape[0]
    valid = np.zeros(small.shape[:2], np.uint8)
    valid[int(sh * HORIZON_FRAC):, :] = 1

    flame = ((r > 190) & (r > g + 35) & (g > b) & (S > 90) & (V > 190)).astype(np.uint8) & valid
    flame = cv2.morphologyEx(flame, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))

    gray = cv2.cvtColor(blur, cv2.COLOR_BGR2GRAY)
    tex = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    tex = cv2.GaussianBlur(np.abs(tex), (9, 9), 0)
    smoke = ((S < 38) & (V > 120) & (V < 235) & (tex < 6)).astype(np.uint8) & valid

    # vegetation / dry grass are saturated (green/olive/tan). Char is dark and greyish.
    exg = 2 * g - r - b
    veg = (exg > 12) | ((S > 70) & (V > 110))
    dark = (V < 105) & (S < 85)
    greyish = (S < 40) & (V < 135)
    burned = ((dark | greyish | (flame > 0)) & ~veg).astype(np.uint8) & valid
    burned = cv2.morphologyEx(burned, cv2.MORPH_OPEN, K5)
    burned = cv2.morphologyEx(burned, cv2.MORPH_CLOSE, K15)
    return {"burned": burned, "flame": flame, "smoke": smoke, "shape": np.array(small.shape[:2])}


def largest_components(mask: np.ndarray, min_frac: float = 0.004, keep: int = 3) -> np.ndarray:
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return mask * 0
    area_min = min_frac * mask.size
    order = np.argsort(-stats[1:, cv2.CC_STAT_AREA])[:keep] + 1
    out = np.zeros_like(mask)
    for k in order:
        if stats[k, cv2.CC_STAT_AREA] >= area_min:
            out[lab == k] = 1
    return out


def fill_holes(mask: np.ndarray) -> np.ndarray:
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(mask)
    cv2.drawContours(out, cnts, -1, 1, thickness=-1)
    return out


class TemporalBurn:
    """Burned ground cannot un-burn: majority-vote 3 consecutive raw masks, then accumulate (logical OR) with decay
    guard so a single smoky frame cannot paint the whole view."""

    def __init__(self):
        self.hist: list[np.ndarray] = []
        self.cum: np.ndarray | None = None

    def update(self, raw: np.ndarray) -> np.ndarray:
        self.hist = (self.hist + [raw])[-3:]
        vote = (np.sum(self.hist, axis=0) >= (2 if len(self.hist) >= 2 else 1)).astype(np.uint8)
        vote = fill_holes(largest_components(vote))
        if self.cum is None:
            self.cum = vote
        else:
            grow = vote & (cv2.dilate(self.cum, K15, iterations=3))   # growth must touch the existing scar
            self.cum = np.maximum(self.cum, grow)
        self.cum = cv2.morphologyEx(self.cum, cv2.MORPH_CLOSE, K9)
        return self.cum.copy()


def iou_prf(pred: np.ndarray, gt: np.ndarray) -> dict[str, float]:
    p, g = pred > 0, gt > 0
    tp = float(np.sum(p & g)); fp = float(np.sum(p & ~g)); fn = float(np.sum(~p & g))
    return {"iou": tp / (tp + fp + fn + 1e-9), "precision": tp / (tp + fp + 1e-9), "recall": tp / (tp + fn + 1e-9)}
