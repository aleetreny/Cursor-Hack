"""FireScope 3D production entrypoint — one process serves the API (/api/*, /media/*, /health) and the compiled
dashboard (../www) at "/". The workshop Ingress maps https://…/app/ → this app's "/".

    python main.py            # listens on 0.0.0.0:$PORT (default 8080)

Environment (credentials only via K8s Secrets — nothing secret is bundled):
  GPU_BEARER_TOKEN                     bearer for Cosmos Reason (:8001), Cosmos Embed1 (:8003), YOLO11 (:8002)
  COSMOS_REASON_BASE/MODEL             default http://166.19.38.112:8001/v1 · nvidia/cosmos3-nano-reasoner
  COSMOS_EMBED_BASE/MODEL              default http://166.19.38.112:8003/v1 · nvidia/cosmos-embed1
  VSS_URL, VSS_USERNAME, VSS_PASSWORD  VAST/VSS retrieval backend (e.g. http://video-backend-service.team-23.svc.cluster.local:8000)
  LLM_BASE, LLM_API_KEY, LLM_MODEL     optional W&B/CoreWeave OpenAI-compatible agent LLM (default: Cosmos Reason)
  AUTO_ANALYZE=1                       run the real Cosmos/Embed/YOLO pass over the replay at boot
  VIDEO_SOURCE_URL                     where to fetch the replay video at boot (default: public CC-BY copy on GitHub)
  DATA_DIR, WWW_DIR, PORT              writable data dir (default /tmp/firescope-data), dashboard dir (../www), port (8080)
"""
from __future__ import annotations

import os
import sys
import tarfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ.setdefault("DATA_DIR", "/tmp/firescope-data")
os.environ.setdefault("FRONTEND_DIST", os.environ.get("WWW_DIR", str((HERE.parent / "www").resolve())))
os.environ.setdefault("MEDIA_DIR", str(Path(os.environ["DATA_DIR"]) / "media"))
DATA = Path(os.environ["DATA_DIR"])
VIDEO_URL = os.environ.get("VIDEO_SOURCE_URL", "https://raw.githubusercontent.com/aleetreny/cursor-hack/firescope-claude/media/drone_replay_01_640.mp4")


def bootstrap_data() -> None:
    """Unpack the processed observations (+ thumbnails) into a writable DATA_DIR (ConfigMap mounts are read-only)."""
    DATA.mkdir(parents=True, exist_ok=True)
    for name in ("data.tgz", "thumbs.tgz"):
        src = HERE / name
        if src.exists() and not (DATA / f".unpacked-{name}").exists():
            with tarfile.open(src) as t:
                t.extractall(DATA, filter="data")
            (DATA / f".unpacked-{name}").touch()
    if not (DATA / "drone_replay_01" / "timeline.json").exists() and (HERE / "data" / "drone_replay_01").exists():
        import shutil
        shutil.copytree(HERE / "data", DATA, dirs_exist_ok=True)


def fetch_video() -> None:
    dst = DATA / "media" / "drone_replay_01.mp4"
    if dst.exists() and dst.stat().st_size > 0 or not VIDEO_URL:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        tmp = dst.with_suffix(".part")
        urllib.request.urlretrieve(VIDEO_URL, tmp)
        tmp.rename(dst)
        print(f"[firescope] video ready: {dst} ({dst.stat().st_size // 1_000_000} MB)", flush=True)
    except Exception as e:  # noqa: BLE001 — dashboard still works; only the camera window lacks video
        print(f"[firescope] WARN video download failed: {e}", flush=True)


if __name__ == "__main__":
    bootstrap_data()
    fetch_video()   # before the API starts, so AUTO_ANALYZE has its source video
    sys.path.insert(0, str(HERE))
    import uvicorn
    uvicorn.run("firescope.app:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), log_level="info")
