"""NVIDIA video-understanding pass: cut 12 s clips, ask Cosmos Reason about each, build events + a search index.

Run:  python -m firescope.cosmos_job [--every N] [--max M]
Writes data/processed/drone_replay_01/{clips_cosmos.json, events_cosmos.json, index.json}.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import threading
import time
from pathlib import Path


from . import config as C
from . import nvidia
from .common import OUT, iso

CLIPDIR = C.PROCESSED / "clips" / C.SOURCE_ID

JOB: dict = {"state": "idle", "progress": 0.0, "clips_total": 0, "clips_done": 0, "message": None}
_lock = threading.Lock()


def cut_clip(i: int, start: float, dur: float) -> tuple[Path, list[Path]]:
    import imageio_ffmpeg
    FF = imageio_ffmpeg.get_ffmpeg_exe()
    CLIPDIR.mkdir(parents=True, exist_ok=True)
    mp4, frames = CLIPDIR / f"clip_{i:04d}.mp4", [CLIPDIR / f"clip_{i:04d}_{k}.jpg" for k in range(4)]
    if not mp4.exists():
        subprocess.run([FF, "-loglevel", "error", "-y", "-ss", f"{start}", "-t", f"{dur}", "-i", str(C.VIDEO), "-an", "-vf", "scale=640:-2,fps=8", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-movflags", "+faststart", str(mp4)], check=True)
    for k, f in enumerate(frames):
        if not f.exists():
            subprocess.run([FF, "-loglevel", "error", "-y", "-ss", f"{start + dur * (k + 0.5) / 4}", "-i", str(C.VIDEO), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", str(f)], check=True)
    return mp4, frames


SEV = {"new_fire_activity": "alert", "visible_fire_expansion": "watch", "first_visible_flames": "watch", "intensity_change": "watch", "smoke_increase": "info", "smoke_decrease": "info", "burned_ground_visible": "info"}


def run(every: int = 1, max_clips: int | None = None, only: list[int] | None = None) -> dict:
    clips = json.loads((OUT / "clips.json").read_text())
    cv_events = json.loads((OUT / "events_cv.json").read_text())["events"]
    sel = only if only is not None else list(range(0, len(clips), every))
    # always include clips that contain CV events, so every alert gets a Cosmos description
    for e in cv_events:
        k = int(e["start_seconds"] // C.CLIP_SECONDS)
        if k not in sel:
            sel.append(k)
    sel = sorted(set(sel))[: max_clips or None]
    out_path = OUT / "clips_cosmos.json"
    done: dict[str, dict] = json.loads(out_path.read_text()) if out_path.exists() else {}
    with _lock:
        JOB.update(state="processing", progress=0.0, clips_total=len(sel), clips_done=0, message=f"Cosmos Reason · {C.COSMOS_REASON_MODEL}")
    errors = 0
    for n, i in enumerate(sel):
        c = clips[i]
        if c["clip_id"] in done and "caption" in done[c["clip_id"]]:
            pass
        else:
            try:
                mp4, frames = cut_clip(i, c["start_seconds"], c["end_seconds"] - c["start_seconds"])
                t = time.time()
                d = nvidia.cosmos_describe_clip(mp4, frames, c["end_seconds"] - c["start_seconds"])
                d["latency_ms"] = int((time.time() - t) * 1000)
                d["model"] = C.COSMOS_REASON_MODEL
                done[c["clip_id"]] = {**c, **d}
                out_path.write_text(json.dumps(done, indent=1))
            except nvidia.NotConfigured as e:
                with _lock:
                    JOB.update(state="error", message=str(e))
                raise
            except Exception as e:  # noqa: BLE001
                errors += 1
                done.setdefault(c["clip_id"], {**c})["error"] = str(e)[:300]
        with _lock:
            JOB.update(clips_done=n + 1, progress=(n + 1) / len(sel), message=f"{n + 1}/{len(sel)} clips · {errors} errors")
    events = build_events(done, cv_events)
    (OUT / "events_cosmos.json").write_text(json.dumps({"source_id": C.SOURCE_ID, "events": events}, indent=1))
    build_index(done, events)
    with _lock:
        JOB.update(state="done", progress=1.0, message=f"{len(done)} clips described · {len(events)} events · {errors} errors")
    return JOB


def build_events(desc: dict[str, dict], cv_events: list[dict]) -> list[dict]:
    """Merge: every CV (measurement) event gets the Cosmos description of its clip; Cosmos-only events are added
    when the model flags new activity / onset of flames that the CV rules did not."""
    by_clip = {int(k.split("_")[1]): v for k, v in desc.items() if "caption" in v}
    events = []
    for e in cv_events:
        k = int(e["start_seconds"] // C.CLIP_SECONDS)
        d = by_clip.get(k)
        e = dict(e)
        if d:
            e["description"] = f"{d.get('caption', '')} {d.get('change', '')}".strip()
            e["visual_evidence"] = d.get("visual_evidence") or e["visual_evidence"]
            e["processing_model"] = f"{d['model']} + {e['processing_model'].split(' (')[0]}"
            e["provenance"] = "model"
            e["cv_measurement"] = cv_events and next((x["description"] for x in cv_events if x["event_id"] == e["event_id"]), None)
        events.append(e)
    have = {int(e["start_seconds"] // C.CLIP_SECONDS) for e in events}
    for k, d in sorted(by_clip.items()):
        if k in have:
            continue
        kind = d.get("event_type", "other")
        if d.get("new_activity_away_from_main_front") or kind in ("new_fire_activity",):
            kind, sev = "new_fire_activity", "alert"
        elif kind in SEV and kind not in ("burned_ground_visible",):
            sev = SEV[kind]
        else:
            continue
        events.append({"event_id": "", "source_id": C.SOURCE_ID, "start_seconds": d["start_seconds"], "end_seconds": d["end_seconds"], "timestamp": d["timestamp"],
                       "event_type": kind, "title": (d.get("change") or d.get("caption", ""))[:46].rstrip(" ,.") or kind.replace("_", " "),
                       "description": f"{d.get('caption', '')} {d.get('change', '')}".strip(), "visual_evidence": d.get("visual_evidence") or [],
                       "confidence": None, "review_required": True, "severity": sev, "processing_model": d["model"], "location": None, "image_region": None,
                       "thumbnail_url": d.get("thumbnail_url"), "provenance": "model"})
    events.sort(key=lambda e: e["start_seconds"])
    for i, e in enumerate(events):
        e["event_id"] = f"evt_{i + 1:03d}"
    return events


def build_index(desc: dict[str, dict], events: list[dict]) -> None:
    docs = [{"clip_id": k, **{f: v[f] for f in ("source_id", "start_seconds", "end_seconds", "timestamp", "thumbnail_url")}, "caption": f"{v.get('caption', '')} {v.get('change', '')} smoke: {v.get('smoke', '')}".strip()}
            for k, v in desc.items() if "caption" in v]
    if not docs:
        return
    try:
        vecs = nvidia.embed([d["caption"] for d in docs], "passage")
        for d, v in zip(docs, vecs):
            d["vector"] = v
        model = C.COSMOS_EMBED_MODEL if C.COSMOS_EMBED_BASE else C.EMBED_MODEL_FALLBACK
    except Exception as e:  # noqa: BLE001
        model = f"none ({str(e)[:80]})"
    (OUT / "index.json").write_text(json.dumps({"model": model, "docs": docs}))


def start_background(**kw) -> None:
    if JOB["state"] == "processing":
        return
    threading.Thread(target=lambda: _safe(kw), daemon=True).start()


def _safe(kw):
    try:
        run(**kw)
    except Exception as e:  # noqa: BLE001
        with _lock:
            JOB.update(state="error", message=str(e)[:300])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--every", type=int, default=3)
    ap.add_argument("--max", type=int, default=None)
    a = ap.parse_args()
    print(run(a.every, a.max))
