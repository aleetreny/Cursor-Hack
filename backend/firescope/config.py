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
PROCESSED = ROOT / "data" / "processed"
CACHE = ROOT / "data" / "cache"
SOURCE_ID = "drone_replay_01"


def _load_dotenv() -> None:
    env = ROOT / "backend" / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


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

# NVIDIA / sponsor endpoints (OpenAI-compatible). Fill in backend/.env — never commit keys.
NVIDIA_API_BASE = os.environ.get("NVIDIA_API_BASE", "https://integrate.api.nvidia.com/v1")
NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "")
COSMOS_REASON_MODEL = os.environ.get("COSMOS_REASON_MODEL", "nvidia/cosmos-reason2-8b")
COSMOS_REASON_BASE = os.environ.get("COSMOS_REASON_BASE", NVIDIA_API_BASE)
COSMOS_EMBED_BASE = os.environ.get("COSMOS_EMBED_BASE", "")
COSMOS_EMBED_MODEL = os.environ.get("COSMOS_EMBED_MODEL", "nvidia/cosmos-embed1")
LLM_MODEL = os.environ.get("LLM_MODEL", COSMOS_REASON_MODEL)
VAST_ENDPOINT = os.environ.get("VAST_ENDPOINT", "")
WANDB_API_KEY = os.environ.get("WANDB_API_KEY", "")
EMBED_MODEL_FALLBACK = os.environ.get("EMBED_MODEL", "nvidia/llama-3.2-nv-embedqa-1b-v1")
