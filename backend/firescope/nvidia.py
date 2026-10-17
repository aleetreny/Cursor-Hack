"""NVIDIA adapters: Cosmos Reason (video understanding), embeddings (retrieval), LLM (agent answers).

All calls go to OpenAI-compatible endpoints: build.nvidia.com (integrate.api.nvidia.com) by default, or the
workshop VSS/NIM endpoints via env vars. Every call is logged to data/processed/nvidia_calls.jsonl as evidence.
Nothing here fabricates output: if a service is not configured the caller gets an exception and must say so.
"""
from __future__ import annotations

import base64
import json
import re
import time
from pathlib import Path

import httpx

from . import config as C

CALL_LOG = C.PROCESSED / "nvidia_calls.jsonl"
STATUS: dict[str, dict] = {}


class NotConfigured(RuntimeError):
    pass


_TOKEN: dict[str, str] = {}


def _workshop() -> bool:
    return bool(C.COSMOS_REASON_BASE) and "integrate.api.nvidia.com" not in C.COSMOS_REASON_BASE


def _token(base: str) -> str:
    """Workshop endpoints use COSMOS_API_KEY / COSMOS_TOKEN_CMD; build.nvidia.com uses NVIDIA_API_KEY."""
    if "integrate.api.nvidia.com" in base:
        return C.NVIDIA_API_KEY
    if C.COSMOS_API_KEY:
        return C.COSMOS_API_KEY
    if C.COSMOS_TOKEN_CMD and "cmd" not in _TOKEN:
        import subprocess
        out = subprocess.run(C.COSMOS_TOKEN_CMD, shell=True, capture_output=True, text=True, timeout=40)
        _TOKEN["cmd"] = out.stdout.strip()
    return _TOKEN.get("cmd", "")


def _headers(base: str = "") -> dict[str, str]:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    tok = _token(base or C.NVIDIA_API_BASE)
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def _log(service: str, model: str, endpoint: str, ok: bool, latency_ms: int, detail: str = "") -> None:
    STATUS[service] = {"model": model, "endpoint": httpx.URL(endpoint).host, "ok": ok, "latency_ms": latency_ms,
                       "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "detail": detail[:200]}
    CALL_LOG.parent.mkdir(parents=True, exist_ok=True)
    with CALL_LOG.open("a") as f:
        f.write(json.dumps({"service": service, **STATUS[service]}) + "\n")


def configured(service: str) -> bool:
    if service == "embed":
        return bool(C.COSMOS_EMBED_BASE or C.NVIDIA_API_KEY)
    if _workshop():
        return bool(C.COSMOS_API_KEY or C.COSMOS_TOKEN_CMD)
    return bool(C.NVIDIA_API_KEY)


def chat(messages: list[dict], model: str, base: str, max_tokens: int = 900, temperature: float = 0.2, service: str = "cosmos_reason", timeout: float = 120) -> str:
    if not configured("reason"):
        raise NotConfigured("Cosmos endpoint token missing: set COSMOS_API_KEY or COSMOS_TOKEN_CMD in backend/.env")
    url = base.rstrip("/") + "/chat/completions"
    t = time.time()
    try:
        r = httpx.post(url, headers=_headers(base), json={"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}, timeout=timeout)
        r.raise_for_status()
        out = r.json()["choices"][0]["message"]["content"] or ""
        _log(service, model, url, True, int((time.time() - t) * 1000))
        return out
    except Exception as e:  # noqa: BLE001 — surface the failure, never mask it
        body = getattr(getattr(e, "response", None), "text", "")
        _log(service, model, url, False, int((time.time() - t) * 1000), f"{e} {body}")
        raise


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
    """Ask Cosmos Reason about one clip. Sends the MP4; falls back to keyframes if the endpoint rejects video."""
    prompt = EVENT_PROMPT.format(dur=dur)
    attempts = []
    if clip_path.exists():
        attempts.append([{"type": "video_url", "video_url": {"url": b64(clip_path, "video/mp4")}}, {"type": "text", "text": prompt}])
    if frames:
        attempts.append([*({"type": "image_url", "image_url": {"url": b64(f, "image/jpeg")}} for f in frames), {"type": "text", "text": prompt + "\nThe images are consecutive frames in time order."}])
    last: Exception | None = None
    for content in attempts:
        try:
            raw = chat([{"role": "user", "content": content}], C.COSMOS_REASON_MODEL, C.COSMOS_REASON_BASE, max_tokens=2500)
            data = parse_json(raw)
            data["_input"] = "video" if content[0]["type"] == "video_url" else f"{len(frames)} frames"
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


def embed(texts: list[str], input_type: str = "passage") -> list[list[float]]:
    """Text embeddings for retrieval (Cosmos Embed endpoint if configured, else NVIDIA retrieval embedder)."""
    base = C.COSMOS_EMBED_BASE or C.NVIDIA_API_BASE
    model = C.COSMOS_EMBED_MODEL if C.COSMOS_EMBED_BASE else C.EMBED_MODEL_FALLBACK
    if not (C.COSMOS_EMBED_BASE or C.NVIDIA_API_KEY):
        raise NotConfigured("No embedding endpoint configured")
    url = base.rstrip("/") + "/embeddings"
    t = time.time()
    try:
        r = httpx.post(url, headers=_headers(base), json={"model": model, "input": texts, "input_type": input_type, "encoding_format": "float", "truncate": "END"}, timeout=60)
        r.raise_for_status()
        vecs = [d["embedding"] for d in r.json()["data"]]
        _log("embed", model, url, True, int((time.time() - t) * 1000))
        return vecs
    except Exception as e:  # noqa: BLE001
        _log("embed", model, url, False, int((time.time() - t) * 1000), f"{e} {getattr(getattr(e, 'response', None), 'text', '')}")
        raise
