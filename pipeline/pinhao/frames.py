"""Frames for the visual search index: one every 2 s of the published Pinhão video, plus a thumbnail sprite.

    python -m pipeline.pinhao.frames

Reads the same H.264 file the browser plays (media/drone_replay_01.mp4), so search results line up with playback.
Writes data/cache/pinhao/frames/f_NNNN.jpg (640×360, for the embedding script) and
data/processed/drone_replay_01/visual_sprite.jpg (160×90 thumbnails, 20 per row, shown next to each result).
"""
from __future__ import annotations

import json

import cv2
import numpy as np

from .segmenter import CACHE, OUT, ROOT

VIDEO = ROOT / "media" / "drone_replay_01.mp4"
EVERY_S = 2.0
TW, TH, PER_ROW = 160, 90, 20


def main():
    dest = CACHE / "frames"
    dest.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(VIDEO))
    fps = cap.get(cv2.CAP_PROP_FPS)
    step = int(round(fps * EVERY_S))
    thumbs, times, i = [], [], 0
    while True:
        if not cap.grab():
            break
        if i % step == 0:
            ok, f = cap.retrieve()
            if not ok:
                break
            k = len(times)
            cv2.imwrite(str(dest / f"f_{k:04d}.jpg"), cv2.resize(f, (640, 360), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 92])
            thumbs.append(cv2.resize(f, (TW, TH), interpolation=cv2.INTER_AREA))
            times.append(round(i / fps, 3))
        i += 1
    rows = (len(thumbs) + PER_ROW - 1) // PER_ROW
    sheet = np.zeros((rows * TH, PER_ROW * TW, 3), np.uint8)
    for k, t in enumerate(thumbs):
        r, c = divmod(k, PER_ROW)
        sheet[r * TH:(r + 1) * TH, c * TW:(c + 1) * TW] = t
    OUT.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT / "visual_sprite.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 70, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
    (CACHE / "frames.json").write_text(json.dumps({"every_s": EVERY_S, "times": times, "sprite": {"w": TW, "h": TH, "per_row": PER_ROW}}))
    print(f"{len(times)} frames → {dest}; sprite {(OUT / 'visual_sprite.jpg').stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
