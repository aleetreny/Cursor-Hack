"""Server-side adapters for the workshop AI stack (credentials only from env / K8s Secrets).

* Cosmos Reason  (NVIDIA, :8001)  — OpenAI-compatible chat with video_url content → clip descriptions, agent answers
* Cosmos Embed1  (NVIDIA, :8003)  — 256-d embeddings for video clips and text queries (same space) → semantic search
* YOLO11         (:8002)          — object classes/counts per clip (people, vehicles near the fire)
* VSS retrieval  ($INGRESS_URL)   — JWT login, /api/v1/search, /api/v1/agent/search-and-answer (VAST-backed archive)
* LLM_BASE                       — optional W&B / CoreWeave OpenAI-compatible inference for the agent

Every call is recorded in STATUS (and data/processed/nvidia_calls.jsonl) so /api/integrations/health reports reality.
Nothing here fabricates output: unconfigured or failing services raise, and callers must say so.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
import time
from pathlib import Path

import httpx

from . import config as C

CALL_LOG = C.PROCESSED / "nvidia_calls.jsonl"
STATUS: dict[str, dict] = {}
_TOKEN: dict[str, str] = {}
_MODELS: dict[str, str] = {}


class NotConfigured(RuntimeError):
    pass


def _gpu_token() -> str:
    if C.GPU_BEARER_TOKEN:
        return C.GPU_BEARER_TOKEN
    if C.COSMOS_TOKEN_CMD and "cmd" not in _TOKEN:
        out = subprocess.run(C.COSMOS_TOKEN_CMD, shell=True, capture_output=True, text=True, timeout=40)
        _TOKEN["cmd"] = out.stdout.strip()
    return _TOKEN.get("cmd", "")


def _token_for(base: str) -> str:
    if "integrate.api.nvidia.com" in base:
        return C.NVIDIA_API_KEY
    if C.LLM_API_KEY and base == C.LLM_BASE and C.LLM_BASE != C.COSMOS_REASON_BASE:
        return C.LLM_API_KEY
    return _gpu_token()


def _headers(base: str) -> dict[str, str]:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    tok = _token_for(base)
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def _log(service: str, model: str, endpoint: str, ok: bool, latency_ms: int, detail: str = "") -> None:
    STATUS[service] = {"model": model, "endpoint": httpx.URL(endpoint).host, "ok": ok, "latency_ms": latency_ms,
                       "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "detail": detail[:200]}
    try:
        CALL_LOG.parent.mkdir(parents=True, exist_ok=True)
        with CALL_LOG.open("a") as f:
            f.write(json.dumps({"service": service, **STATUS[service]}) + "\n")
    except OSError:
        pass


def configured(service: str) -> bool:
    if service == "vss":
        return bool(C.VSS_URL and C.VSS_USERNAME and C.VSS_PASSWORD)
    if service == "llm" and C.LLM_API_KEY and C.LLM_BASE != C.COSMOS_REASON_BASE:
        return True
    return bool(_gpu_token() or C.NVIDIA_API_KEY)


def _post(service: str, url: str, base: str, body: dict, model: str, timeout: float = 120) -> dict:
    if not configured("llm" if service == "agent" else "gpu"):
        raise NotConfigured(f"{service}: no credentials (GPU_BEARER_TOKEN must come from the K8s Secret)")
    t = time.time()
    try:
        r = httpx.post(url, headers=_headers(base), json=body, timeout=timeout)
        r.raise_for_status()
        _log(service, model, url, True, int((time.time() - t) * 1000))
        return r.json()
    except Exception as e:  # noqa: BLE001 — surface the failure, never mask it
        body_txt = getattr(getattr(e, "response", None), "text", "")
        _log(service, model, url, False, int((time.time() - t) * 1000), f"{e} {body_txt}")
        raise


def model_id(base: str, preferred: str) -> str:
    """Use the configured id; if empty, discover it from /v1/models (as the workshop smoke tests do)."""
    if preferred:
        return preferred
    if base not in _MODELS:
        r = httpx.get(base.rstrip("/") + "/models", headers=_headers(base), timeout=20)
        r.raise_for_status()
        _MODELS[base] = r.json()["data"][0]["id"]
    return _MODELS[base]


# ------------------------------------------------------------------ Cosmos Reason

def chat(messages: list[dict], model: str | None = None, base: str | None = None, max_tokens: int = 900,
         temperature: float = 0.2, service: str = "cosmos_reason", timeout: float = 180) -> str:
    base = base or C.COSMOS_REASON_BASE
    model = model_id(base, model or C.COSMOS_REASON_MODEL)
    d = _post(service, base.rstrip("/") + "/chat/completions", base,
              {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}, model, timeout)
    msg = d["choices"][0]["message"]
    return msg.get("content") or msg.get("reasoning_content") or ""


def b64(path: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


EVENT_PROMPT = """You are analysing a {dur:.0f}-second clip of RGB drone footage of a prescribed vegetation fire (camera hovering, looking down at ~29°).
Describe ONLY what is visible. Do not guess temperatures or anything not in the frames.
Return a single JSON object, no prose, with keys:
"caption": one sentence describing the clip,
"flames_visible": true/false,
"smoke": "none"|"light"|"moderate"|"dense",
"burned_ground_visible": true/false,
"change": one sentence on what changed between the start and the end of the clip,
"new_activity_away_from_main_front": true/false,
"review_regions": short phrases naming parts of the view (e.g. "upper-left", "right edge") that should be reviewed for emerging fire,
"event_type": one of ["first_visible_flames","visible_fire_expansion","new_fire_activity","smoke_increase","smoke_decrease","burned_ground_visible","intensity_change","camera_motion","other"],
"visual_evidence": list of 1-3 short phrases."""


def cosmos_describe_clip(clip_path: Path, frames: list[Path], dur: float) -> dict:
    """Ask Cosmos Reason about one clip (MP4 as video_url). Falls back to keyframes if video input is rejected."""
    prompt = EVENT_PROMPT.format(dur=dur)
    attempts = []
    if clip_path.exists():
        attempts.append(("video", [{"type": "text", "text": prompt}, {"type": "video_url", "video_url": {"url": b64(clip_path, "video/mp4")}}]))
    if frames:
        attempts.append((f"{len(frames)} frames", [{"type": "text", "text": prompt + "\nThe images are consecutive frames in time order."},
                                                   *({"type": "image_url", "image_url": {"url": b64(f, "image/jpeg")}} for f in frames)]))
    last: Exception | None = None
    for kind, content in attempts:
        try:
            raw = chat([{"role": "user", "content": content}], max_tokens=2500)
            data = parse_json(raw)
            data["_input"] = kind
            data["_raw"] = raw[-1500:]
            return data
        except NotConfigured:
            raise
        except Exception as e:  # try the next input form
            last = e
    raise RuntimeError(f"Cosmos Reason failed: {last}")


def parse_json(text: str) -> dict:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"no JSON in model output: {text[:200]}")
    return json.loads(m.group(0))


# ------------------------------------------------------------------ Cosmos Embed1

def embed(inputs: list[str], request_type: str = "query") -> list[list[float]]:
    """Cosmos Embed1: `input` is text or a data:video/mp4;base64 URI → 256-d. One request per input."""
    base = C.COSMOS_EMBED_BASE
    model = model_id(base, C.COSMOS_EMBED_MODEL or "nvidia/cosmos-embed1")
    out = []
    for x in inputs:
        d = _post("cosmos_embed", base.rstrip("/") + "/embeddings", base,
                  {"input": x, "model": model, "request_type": request_type, "encoding_format": "float"}, model, 120)
        out.append(d["data"][0]["embedding"])
    return out


def embed_model() -> str:
    return C.COSMOS_EMBED_MODEL or "nvidia/cosmos-embed1"


# ------------------------------------------------------------------ YOLO11

def yolo_infer(clip_path: Path) -> dict:
    url = C.YOLO_URL.rstrip("/") + "/v1/infer"
    d = _post("yolo", url, C.YOLO_URL, {"video_base64": base64.b64encode(clip_path.read_bytes()).decode(), "filename": clip_path.name, "include_frames": False}, "yolo11s", 120)
    return {"ok": d.get("perception_ok", d.get("ok")), "object_classes": d.get("object_classes") or [], "object_counts": d.get("object_counts") or {}}


# ------------------------------------------------------------------ VSS retrieval (VAST)

_VSS: dict[str, object] = {}


def vss_token() -> str:
    if not configured("vss"):
        raise NotConfigured("VSS_URL / VSS_USERNAME / VSS_PASSWORD not set")
    if _VSS.get("token") and time.time() - float(_VSS.get("at", 0)) < 1800:
        return str(_VSS["token"])
    t = time.time()
    r = httpx.post(f"{C.VSS_URL}/api/v1/auth/login", json={"username": C.VSS_USERNAME, "password": C.VSS_PASSWORD}, timeout=20)
    ok = r.status_code == 200
    _log("vss", "vss2 retrieval", C.VSS_URL, ok, int((time.time() - t) * 1000), "" if ok else f"login {r.status_code}")
    r.raise_for_status()
    _VSS.update(token=r.json()["access_token"], at=time.time())
    return str(_VSS["token"])


def vss(path: str, body: dict, timeout: float = 90) -> dict:
    tok = vss_token()
    t = time.time()
    r = httpx.post(f"{C.VSS_URL}{path}", headers={"Authorization": f"Bearer {tok}"}, json=body, timeout=timeout)
    if r.status_code == 401:
        _VSS.clear()
        tok = vss_token()
        r = httpx.post(f"{C.VSS_URL}{path}", headers={"Authorization": f"Bearer {tok}"}, json=body, timeout=timeout)
    _log("vss", "vss2 retrieval", C.VSS_URL + path, r.status_code == 200, int((time.time() - t) * 1000), "" if r.status_code == 200 else f"{r.status_code} {r.text[:120]}")
    r.raise_for_status()
    return r.json()
