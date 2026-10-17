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

import httpx


from . import config as C
from . import nvidia
from .common import OUT, iso

CLIPDIR = C.PROCESSED / "clips" / C.SOURCE_ID

JOB: dict = {"state": "idle", "progress": 0.0, "clips_total": 0, "clips_done": 0, "message": None}
_lock = threading.Lock()


def video_source() -> Path:
    """Original dataset video if present (dev), else download the replay copy from MEDIA_URL (K8s pod)."""
    if C.VIDEO.exists():
        return C.VIDEO
    dst = C.PROCESSED / "media" / f"{C.SOURCE_ID}.mp4"
    if not dst.exists():
        if not C.MEDIA_URL:
            raise RuntimeError("no source video: set MEDIA_URL (or provide the dataset)")
        dst.parent.mkdir(parents=True, exist_ok=True)
        with httpx.stream("GET", f"{C.MEDIA_URL}/{C.SOURCE_ID}.mp4", timeout=300, follow_redirects=True) as r:
            r.raise_for_status()
            with dst.open("wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
    return dst


def cut_clip(i: int, start: float, dur: float) -> tuple[Path, list[Path]]:
    import imageio_ffmpeg
    FF = imageio_ffmpeg.get_ffmpeg_exe()
    src = str(video_source())
    CLIPDIR.mkdir(parents=True, exist_ok=True)
    mp4, frames = CLIPDIR / f"clip_{i:04d}.mp4", [CLIPDIR / f"clip_{i:04d}_{k}.jpg" for k in range(4)]
    if not mp4.exists():
        subprocess.run([FF, "-loglevel", "error", "-y", "-ss", f"{start}", "-t", f"{dur}", "-i", src, "-an", "-vf", "scale=640:-2,fps=8", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-movflags", "+faststart", str(mp4)], check=True)
    for k, f in enumerate(frames):
        if not f.exists():
            subprocess.run([FF, "-loglevel", "error", "-y", "-ss", f"{start + dur * (k + 0.5) / 4}", "-i", src, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", str(f)], check=True)
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
                try:   # visual embedding of the clip itself (Cosmos Embed1, 256-d) — query text lands in the same space
                    d["vector"] = nvidia.embed([nvidia.b64(mp4, "video/mp4")], "query")[0]
                    d["vector_kind"] = "video"
                except Exception as e:  # noqa: BLE001
                    d["embed_error"] = str(e)[:160]
                try:   # YOLO11 objects (people / vehicles in view)
                    d["yolo"] = nvidia.yolo_infer(mp4)
                except Exception as e:  # noqa: BLE001
                    d["yolo_error"] = str(e)[:160]
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
    # YOLO11: people / vehicles in view while flames are visible → review alert (decision support)
    WATCH = {"person", "car", "truck", "bus", "motorcycle", "bicycle"}
    for k, d in sorted(by_clip.items()):
        objs = sorted(WATCH & {str(o).lower() for o in (d.get("yolo") or {}).get("object_classes", [])})
        if objs and d.get("flames_visible"):
            events.append({"event_id": "", "source_id": C.SOURCE_ID, "start_seconds": d["start_seconds"], "end_seconds": d["end_seconds"], "timestamp": d["timestamp"],
                           "event_type": "fire_near_road_or_structure", "title": f"{', '.join(objs).capitalize()} in view near flames",
                           "description": f"YOLO11 detected {', '.join(objs)} in a clip where Cosmos Reason reports visible flames. {d.get('caption', '')}".strip(),
                           "visual_evidence": [f"{o} detected" for o in objs] + (d.get("visual_evidence") or [])[:1], "confidence": None, "review_required": True,
                           "severity": "alert", "processing_model": f"yolo11s + {d['model']}", "location": None, "image_region": None, "thumbnail_url": d.get("thumbnail_url"), "provenance": "model"})
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
    """Search index = Cosmos Embed1 video vectors per clip (+ the Cosmos caption for display / lexical fallback)."""
    docs = []
    for k, v in desc.items():
        if "caption" not in v:
            continue
        doc = {"clip_id": k, **{f: v[f] for f in ("source_id", "start_seconds", "end_seconds", "timestamp", "thumbnail_url")},
               "caption": f"{v.get('caption', '')} {v.get('change', '')}".strip()}
        if v.get("vector"):
            doc["vector"] = v["vector"]
        docs.append(doc)
    model = nvidia.embed_model() + " (video)" if any("vector" in d for d in docs) else None
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


def maybe_auto_start() -> None:
    """K8s: AUTO_ANALYZE=1 runs the real Cosmos pass at boot (once per pod) if it has not been run yet."""
    if C.AUTO_ANALYZE and nvidia.configured("gpu") and not (OUT / "events_cosmos.json").exists():
        start_background(every=2)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--every", type=int, default=3)
    ap.add_argument("--max", type=int, default=None)
    a = ap.parse_args()
    print(run(a.every, a.max))
