"""Reference masks for the live-analysis check (frontend/scripts/audit/live.mjs).

    python -m pipeline.pinhao.live_ref

The segmenter's burned mask (512×288, threshold 0.5) on 22 frames, one every 40 s, computed in Python with ONNX Runtime
from (a) the published H.264 file the browser plays and (b) the original recording the pipeline used. The browser runs
the same ONNX file on the same frames; the audit reports the IoU against both.
"""
from __future__ import annotations

import json

import cv2
import numpy as np

from .config import VIDEO
from .segment import LearnedBurned
from .segmenter import CACHE, ROOT

WEB = ROOT / "media" / "drone_replay_01.mp4"


def masks(path, frames, model):
    cap, out, i, want = cv2.VideoCapture(str(path)), [], 0, set(frames)
    while i <= max(frames):
        if not cap.grab():
            break
        if i in want:
            _, f = cap.retrieve()
            out.append((model.prob(f) > 0.5).astype(np.uint8))
        i += 1
    return np.stack(out)


def main():
    model = LearnedBurned()
    fps = cv2.VideoCapture(str(WEB)).get(cv2.CAP_PROP_FPS)
    frames = [int(round((10 + 40 * k) * fps)) for k in range(22)]
    web, orig = masks(WEB, frames, model), masks(VIDEO, frames, model)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(CACHE / "live_ref.npy", web)
    np.save(CACHE / "live_ref_original.npy", orig)
    # seek targets in the middle of each frame, so the browser lands on the same one
    (CACHE / "live_ref.json").write_text(json.dumps({"fps": fps, "frames": frames, "times": [round((f + 0.5) / fps, 4) for f in frames]}))
    iou = [(a & b).sum() / max(1, (a | b).sum()) for a, b in zip(web, orig)]
    print(f"{len(frames)} frames; Python, published file vs original recording: IoU {np.mean(iou):.4f} (min {np.min(iou):.4f})")


if __name__ == "__main__":
    main()
