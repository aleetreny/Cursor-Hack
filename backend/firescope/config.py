"""Paths, dataset facts and environment configuration for the FireScope backend."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "burnedareauav"
DATASET = RAW / "BurnedAreaUAV_dataset"
VIDEO = DATASET / "MP4_video" / "original_prescribed_burn_video.mp4"
KML = RAW / "pinhao_cell_precribed_area.kml"
SOURCE_ID = "drone_replay_01"


def _load_dotenv() -> None:
    env = Path(__file__).resolve().parents[1] / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()
PROCESSED = Path(os.environ.get("DATA_DIR", ROOT / "data" / "processed"))
CACHE = ROOT / "data" / "cache"


@dataclass(frozen=True)
class Pose:
    """Drone camera pose, from the XMP metadata of uav_photo_1_metadata.JPG (BurnedAreaUAV v1.1)."""
    lat: float = 41.393844
    lon: float = -7.614828
    agl_m: float = 24.9          # RelativeAltitude (above take-off point)
    yaw_deg: float = -46.7       # GimbalYawDegree, 0 = north, clockwise
    pitch_deg: float = -28.9     # GimbalPitchDegree, negative = down
    focal_px_4k: float = 3666.666504  # CalibratedFocalLength at 3840 px width
    width_4k: int = 3840


POSE = Pose()
# Wall-clock of video t=0. The dataset does not publish it; the photo metadata (12:46:28 / 12:48:57 local, UTC+0)
# is taken during the hover. We anchor the replay at 12:33:00Z and label the value an assumption in the API.
RECORDED_START = "2019-03-01T12:33:00Z"
SAMPLE_EVERY_FRAMES = 100        # 4 s at 25 fps, matches the annotation cadence
CLIP_SECONDS = 12.0
HORIZON_FRAC = 0.21              # rows above this fraction of the frame are far-field (beyond the access road): excluded

# ---- Workshop GPU models (vast-builders-challenge gpu/README) — token via env / K8s Secret, never in the bundle
GPU_HOST = os.environ.get("GPU_HOST", "166.19.38.112")
GPU_BEARER_TOKEN = os.environ.get("GPU_BEARER_TOKEN", "") or os.environ.get("COSMOS_API_KEY", "")
COSMOS_TOKEN_CMD = os.environ.get("COSMOS_TOKEN_CMD", "")
COSMOS_REASON_BASE = os.environ.get("COSMOS_REASON_BASE", f"http://{GPU_HOST}:8001/v1")
COSMOS_REASON_MODEL = os.environ.get("COSMOS_REASON_MODEL", "nvidia/cosmos3-nano-reasoner")
COSMOS_EMBED_BASE = os.environ.get("COSMOS_EMBED_BASE", f"http://{GPU_HOST}:8003/v1")
COSMOS_EMBED_MODEL = os.environ.get("COSMOS_EMBED_MODEL", "")          # discovered from /v1/models when empty
YOLO_URL = os.environ.get("YOLO_URL", f"http://{GPU_HOST}:8002")
# Agent LLM: defaults to Cosmos Reason; can point at W&B / CoreWeave inference (OpenAI-compatible)
LLM_BASE = os.environ.get("LLM_BASE", COSMOS_REASON_BASE)
LLM_MODEL = os.environ.get("LLM_MODEL", COSMOS_REASON_MODEL)
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
# build.nvidia.com (optional alternative)
NVIDIA_API_BASE = os.environ.get("NVIDIA_API_BASE", "https://integrate.api.nvidia.com/v1")
NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "")
# VSS retrieval backend ($INGRESS_URL) — login with team user/password (K8s Secret)
VSS_URL = os.environ.get("VSS_URL", "").rstrip("/")
VSS_USERNAME = os.environ.get("VSS_USERNAME", "")
VSS_PASSWORD = os.environ.get("VSS_PASSWORD", "")
VAST_ENDPOINT = os.environ.get("VAST_ENDPOINT", "")
WANDB_API_KEY = os.environ.get("WANDB_API_KEY", "")
AUTO_ANALYZE = os.environ.get("AUTO_ANALYZE", "") in ("1", "true", "yes")
MEDIA_DIR = Path(os.environ.get("MEDIA_DIR", PROCESSED / "media"))
# If set, media is served from this absolute URL prefix (e.g. an object store) instead of /media
MEDIA_URL = os.environ.get("MEDIA_URL", "").rstrip("/")
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", ROOT / "frontend" / "dist"))
WANDB_API_KEY = os.environ.get("WANDB_API_KEY", "")
