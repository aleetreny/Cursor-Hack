"""FireScope 3D API — implements docs/api-contract.md.

Run:  uvicorn firescope.app:app --port 8000   (from backend/)
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import time
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from shapely.affinity import translate
from shapely.geometry import shape
from shapely.ops import unary_union

from . import config as C
from . import cosmos_job, nvidia
from .common import M_LAT, M_LON, OUT, to_lonlat_geom

app = FastAPI(title="FireScope 3D API", version="0.3.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
PREFIX = os.environ.get("PUBLIC_BASE_PATH", "/app").rstrip("/")


@app.middleware("http")
async def strip_public_prefix(request, call_next):
    """The workshop Ingress strips /app; if a request still carries it (local test, other proxy), strip it here."""
    p = request.scope.get("path", "")
    if PREFIX and (p == PREFIX or p.startswith(PREFIX + "/")):
        request.scope["path"] = p[len(PREFIX):] or "/"
    return await call_next(request)
MEDIA = C.MEDIA_DIR
UPLOADS = C.ROOT / "data" / "uploads"
_cache: dict[str, tuple[float, object]] = {}


def load(name: str, default=None):
    p = OUT / name
    if not p.exists():
        if default is not None:
            return default
        raise HTTPException(503, f"{name} missing — run `python -m firescope.pipeline` first")
    m = p.stat().st_mtime
    if name not in _cache or _cache[name][0] != m:
        _cache[name] = (m, json.loads(p.read_text()))
    return _cache[name][1]


def events() -> list[dict]:
    cos = load("events_cosmos.json", {"events": []})["events"]
    return cos or load("events_cv.json")["events"]


# ------------------------------------------------------------------ health

@app.get("/api/integrations/health")
def health():
    st = nvidia.STATUS
    clips = load("clips_cosmos.json", {})
    described = len([c for c in clips.values() if "caption" in c])
    vectors = len([c for c in clips.values() if c.get("vector")])
    yolo_n = len([c for c in clips.values() if c.get("yolo")])
    ev = load("eval.json", {"mean": {}})
    gpu = nvidia.configured("gpu")

    def item(id_, name, sponsor, svc, model, configured, detail=None):
        s = st.get(svc)
        if not configured:
            status = "not_configured"
        elif s is None:
            status = "ok" if (svc != "vss" and detail and not detail.startswith("0 ")) else "degraded"
            detail = detail if svc != "vss" else "configured · no call yet"
        else:
            status = "ok" if s["ok"] else "down"
        return {"id": id_, "name": name, "sponsor": sponsor, "status": status, "model": model if configured else None,
                "endpoint": (s or {}).get("endpoint"), "last_success": s["at"] if s and s["ok"] else None,
                "latency_ms": (s or {}).get("latency_ms"), "detail": (s["detail"] if s and not s["ok"] else detail)}

    return {"ok": True, "version": app.version, "integrations": [
        item("nvidia_cosmos_reason", "Cosmos Reason", "NVIDIA", "cosmos_reason", C.COSMOS_REASON_MODEL, gpu, f"{described} clips described"),
        item("nvidia_cosmos_embed", "Cosmos Embed1 (video search)", "NVIDIA", "cosmos_embed", nvidia.embed_model(), gpu, f"{vectors} clip vectors indexed"),
        item("yolo11", "YOLO11 detector", "NVIDIA VSS stack", "yolo", "yolo11s", gpu, f"{yolo_n} clips scanned"),
        item("vast_vss", "VAST / VSS retrieval", "VAST Data", "vss", "vss2 search + agent", nvidia.configured("vss"), "archive search via /api/v1/search"),
        item("llm", "Agent LLM", "W&B / CoreWeave" if C.LLM_BASE != C.COSMOS_REASON_BASE else "NVIDIA", "agent", C.LLM_MODEL, nvidia.configured("llm") or gpu),
        {"id": "cv_pipeline", "name": "FireScope CV + georeferencing", "sponsor": "FireScope", "status": "ok", "model": "HSV segmentation + DEM ray cast",
         "endpoint": "local", "detail": f"mean IoU {ev['mean'].get('iou', '—')} vs BurnedAreaUAV masks ({ev.get('frames_evaluated', 0)} frames)"},
    ]}


@app.on_event("startup")
def _auto():
    cosmos_job.maybe_auto_start()


# ------------------------------------------------------------- incident/data

@app.get("/api/incident")
def incident():
    return load("incident.json")


def _media(u):
    return f"{C.MEDIA_URL}{u[len('/media'):]}" if (C.MEDIA_URL and isinstance(u, str) and u.startswith("/media/")) else u


@app.get("/api/sources")
def sources():
    src = [{**s, "media_url": _media(s["media_url"]), "thumbnail_url": _media(s.get("thumbnail_url"))} for s in load("sources.json")]
    if cosmos_job.JOB["state"] == "processing":
        src = [{**s, "processing": {k: cosmos_job.JOB[k] for k in ("state", "progress", "clips_total", "clips_done", "message")}} for s in src]
    return src


@app.get("/api/fire/timeline")
def timeline():
    t = dict(load("timeline.json"))
    t["events"] = events()
    return t


@app.get("/api/fire/observations")
def observations():
    return load("observations.json")


def _iso(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


@app.get("/api/weather")
def weather(time_: str | None = Query(None, alias="time")):
    """ERA5 (Open-Meteo) hourly weather at the burn site; with ?time= returns the nearest hour as `at`."""
    w = load("weather.json", {"hourly": [], "source": None})
    if time_ and w["hourly"]:
        t = _iso(time_)
        w = {**w, "at": min(w["hourly"], key=lambda r: abs(_iso(r["timestamp"]) - t))}
    return w


@app.get("/api/fire/state")
def fire_state(time_: str = Query(..., alias="time")):
    t = _iso(time_)
    frames = [f for f in load("timeline.json")["frames"] if _iso(f["timestamp"]) <= t] or load("timeline.json")["frames"][:1]
    fr = frames[-1]
    obs = load("observations.json")
    feats = [f for f in obs["features"] if f["properties"]["timestamp"] == fr["timestamp"]]
    hs = [h for h in obs["hotspots"] if h["properties"]["timestamp"] == fr["timestamp"]]
    return {"timestamp": fr["timestamp"], "requested": time_, "features": feats, "hotspots": hs, "frame": fr}


@app.get("/api/fire/projection")
def projection(from_: str = Query(..., alias="from"), horizon_minutes: int = 5):
    """EXPERIMENTAL: translate the current burned polygon along the recent mean front displacement."""
    t = _iso(from_)
    burns = [f for f in load("observations.json")["features"] if f["properties"]["classification"] == "burned_area" and _iso(f["properties"]["timestamp"]) <= t]
    if len(burns) < 10:
        raise HTTPException(422, "not enough observed history before this time")
    def enu(f):
        g = shape(f["geometry"])
        from shapely.ops import transform
        return transform(lambda x, y, z=None: ((x - C.POSE.lon) * M_LON, (y - C.POSE.lat) * M_LAT), g)
    now, past = enu(burns[-1]), enu(burns[-16])   # ~60 s earlier at 4 s cadence
    dt_min = (_iso(burns[-1]["properties"]["timestamp"]) - _iso(burns[-16]["properties"]["timestamp"])) / 60
    dx, dy = (now.centroid.x - past.centroid.x) / dt_min, (now.centroid.y - past.centroid.y) / dt_min
    grow = math.sqrt(max(0, now.area - past.area) / math.pi) / max(dt_min, 1e-6)
    steps = []
    for k in range(1, horizon_minutes + 1):
        g = unary_union([now, translate(now, dx * k, dy * k).buffer(grow * k * 0.5)]).buffer(0)
        ts = datetime.utcfromtimestamp(t + 60 * k).isoformat(timespec="milliseconds") + "Z"
        steps.append({"timestamp": ts, "feature": {"type": "Feature", "geometry": to_lonlat_geom(g), "properties": {
            "id": f"proj_{k}", "classification": "projection", "timestamp": ts, "source_id": C.SOURCE_ID, "source_frame": burns[-1]["properties"]["source_frame"],
            "video_seconds": burns[-1]["properties"]["video_seconds"], "georeferencing_method": "camera_model_dem", "georeferencing_accuracy": "approximate",
            "area_m2": round(g.area, 1), "provenance": "derived", "model": "linear centroid extrapolation"}}})
    return {"experimental": True, "label": "EXPERIMENTAL SCENARIO — NOT AN OPERATIONAL FORECAST", "from": from_, "horizon_minutes": horizon_minutes,
            "method": f"Translate the latest observed burned polygon by the mean centroid displacement of the last minute ({math.hypot(dx, dy):.1f} m/min) and buffer by the equivalent-radius growth rate ({grow:.2f} m/min).",
            "assumptions": ["Constant spread direction and rate", "No wind, fuel or slope model", "Only the drone's field of view is observed", "Georeferencing is approximate"], "steps": steps}


# ------------------------------------------------------------------- video

@app.get("/api/video/{source_id}/events")
def video_events(source_id: str):
    return {"source_id": source_id, "events": [e for e in events() if e["source_id"] == source_id]}


@app.get("/api/video/{source_id}/status")
def video_status(source_id: str):
    if source_id == C.SOURCE_ID and cosmos_job.JOB["state"] != "idle":
        return {"source_id": source_id, "processing": {k: cosmos_job.JOB[k] for k in ("state", "progress", "clips_total", "clips_done", "message")}}
    meta = UPLOADS / f"{source_id}.json"
    if meta.exists():
        return {"source_id": source_id, "processing": json.loads(meta.read_text())["processing"]}
    s = next((s for s in load("sources.json") if s["id"] == source_id), None)
    if not s:
        raise HTTPException(404, "unknown source")
    return {"source_id": source_id, "processing": s["processing"]}


class AnalyzeReq(BaseModel):
    source_id: str
    clip_seconds: float | None = None
    prompts: list[str] | None = None
    every: int | None = 3


@app.post("/api/video/analyze")
def analyze(req: AnalyzeReq):
    if req.source_id != C.SOURCE_ID:
        raise HTTPException(422, "Only the georeferenced drone replay can be analysed end-to-end in this build")
    if not nvidia.configured("gpu"):
        raise HTTPException(503, "Cosmos Reason is not configured on this server (GPU_BEARER_TOKEN comes from the K8s Secret)")
    cosmos_job.start_background(every=req.every or 3)
    return {"job_id": f"cosmos-{int(time.time())}", "source_id": req.source_id, "processing": {k: cosmos_job.JOB[k] for k in ("state", "progress", "clips_total", "clips_done", "message")}}


@app.post("/api/video/upload")
async def upload(file: UploadFile = File(...)):
    UPLOADS.mkdir(parents=True, exist_ok=True)
    sid = f"upload_{uuid.uuid4().hex[:8]}"
    dst = UPLOADS / f"{sid}{Path(file.filename or 'v.mp4').suffix or '.mp4'}"
    with dst.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    (UPLOADS / f"{sid}.json").write_text(json.dumps({"path": str(dst), "processing": {"state": "queued", "progress": 0, "clips_total": 0, "clips_done": 0, "message": "Uploaded. Georeferencing needs a camera pose; use the replay source for the full pipeline."}}))
    return {"source_id": sid, "status_url": f"/api/video/{sid}/status"}


# ------------------------------------------------------------ search & ask

TOK = re.compile(r"[a-z]+")
SYN = {"flames": ["flame", "fire", "burning"], "flame": ["flames", "fire"], "fire": ["flame", "flames", "burning"], "smoke": ["smoky", "plume", "haze"],
       "expand": ["expansion", "grew", "growth", "advance", "spread", "widens"], "expanding": ["expansion", "grew", "growth", "spread"], "burned": ["burnt", "blackened", "char", "ash"],
       "first": ["onset", "start", "appear", "visible"], "new": ["spot", "ahead", "outside", "isolated"]}


def _lexical(q: str, text: str) -> float:
    qs = set(TOK.findall(q.lower()))
    qs |= {s for w in list(qs) for s in SYN.get(w, [])}
    ts = TOK.findall(text.lower())
    if not ts:
        return 0.0
    hits = sum(1 for t in ts if t in qs or any(t.startswith(w[:5]) for w in qs if len(w) > 4))
    return hits / math.sqrt(len(ts))


def _cos(a, b):
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / (na * nb + 1e-9)


def retrieve(query: str, k: int = 8, source_id: str | None = None) -> tuple[list[dict], str]:
    idx = load("index.json", {"docs": [], "model": None})
    docs = idx["docs"]
    evs = events()
    ev_by_clip = {int(e["start_seconds"] // C.CLIP_SECONDS): e for e in evs}
    vdocs = [d for d in docs if d.get("vector")]
    if vdocs:
        try:
            qv = nvidia.embed([query], "query")[0]
            scored = sorted(((_cos(qv, d["vector"]), d) for d in vdocs), key=lambda x: -x[0])[:k]
            return [{**{f: d[f] for f in ("clip_id", "source_id", "start_seconds", "end_seconds", "timestamp", "thumbnail_url", "caption")}, "similarity": round(s, 4),
                     "event_id": (ev_by_clip.get(int(d["start_seconds"] // C.CLIP_SECONDS)) or {}).get("event_id")} for s, d in scored], idx["model"]
        except Exception:  # noqa: BLE001 — fall through to lexical, and say so in the model label
            pass
    clips = load("clips.json")
    cap = {k: v for k, v in load("clips_cosmos.json", {}).items() if "caption" in v}
    pool = []
    for c in clips:
        e = ev_by_clip.get(int(c["start_seconds"] // C.CLIP_SECONDS))
        text = " ".join(filter(None, [cap.get(c["clip_id"], {}).get("caption"), cap.get(c["clip_id"], {}).get("change"), e and e["title"], e and e["description"], e and e["event_type"].replace("_", " ")]))
        if text:
            pool.append((_lexical(query, text), c, text, e))
    pool = sorted([p for p in pool if p[0] > 0], key=lambda x: -x[0])[:k]
    return [{**{f: c[f] for f in ("clip_id", "source_id", "start_seconds", "end_seconds", "timestamp", "thumbnail_url")}, "caption": text[:240], "similarity": round(s, 4),
             "event_id": e and e["event_id"]} for s, c, text, e in pool], "lexical fallback over Cosmos captions + events (no embedding index)"


class SearchReq(BaseModel):
    query: str
    top_k: int | None = 8
    source_id: str | None = None


def vss_archive(query: str, k: int = 6) -> tuple[list[dict], str | None]:
    """VSS hybrid search over the team's VAST-backed archive (other footage). Display-only: results are not georeferenced."""
    if not nvidia.configured("vss"):
        return [], None
    try:
        d = nvidia.vss("/api/v1/search", {"query": query, "top_k": k, "llm_top_n": 2, "min_similarity": 0.3, "include_public": True})
        out = []
        for c in (d.get("chunk_results") or [])[:k]:
            out.append({"video": c.get("original_video") or c.get("preview_source"), "start_seconds": c.get("best_match_start_sec"), "end_seconds": c.get("best_match_end_sec"),
                        "segments": c.get("matched_segment_count"), "similarity": c.get("similarity_score") or c.get("best_similarity")})
        if not out:
            for r in (d.get("results") or [])[:k]:
                out.append({"video": r.get("source"), "start_seconds": r.get("start_time") or r.get("start_sec"), "end_seconds": r.get("end_time") or r.get("end_sec"),
                            "similarity": r.get("similarity_score"), "caption": (r.get("reasoning_content") or "")[:200]})
        return out, ((d.get("llm_synthesis") or {}).get("response"))
    except Exception as e:  # noqa: BLE001
        return [{"error": str(e)[:160]}], None


@app.post("/api/search")
def search(req: SearchReq):
    t = time.time()
    res, model = retrieve(req.query, req.top_k or 8, req.source_id)
    archive, synthesis = vss_archive(req.query)
    return {"query": req.query, "model": model, "results": res, "latency_ms": int((time.time() - t) * 1000),
            "archive_results": archive, "archive_synthesis": synthesis, "archive_source": "VSS / VAST" if nvidia.configured("vss") else None}


class AskReq(BaseModel):
    question: str
    context: dict | None = None
    history: list[dict] | None = None


def _fmt(s: float) -> str:
    return f"{int(s // 60):02d}:{int(s % 60):02d}"


@app.post("/api/ask")
def ask(req: AskReq):
    t = time.time()
    hits, rmodel = retrieve(req.question, 6)
    evs = events()
    tl = load("timeline.json")["frames"]
    first, last = tl[0], tl[-1]
    # always give the agent the event log + area summary; retrieval adds the most relevant clips
    ctx_items = []
    for e in evs:
        ctx_items.append({"kind": "event", "source_id": e["source_id"], "start_seconds": e["start_seconds"], "end_seconds": e["end_seconds"], "timestamp": e["timestamp"], "event_id": e["event_id"],
                          "text": f"{e['title']} — {e['description']} (severity {e['severity']}, {e['processing_model']})"})
    for h in hits:
        if not any(abs(c["start_seconds"] - h["start_seconds"]) < 1 for c in ctx_items):
            ctx_items.append({"kind": "clip", "source_id": h["source_id"], "start_seconds": h["start_seconds"], "end_seconds": h["end_seconds"], "timestamp": h["timestamp"], "event_id": h.get("event_id"), "text": h.get("caption") or ""})
    ctx_items.sort(key=lambda c: c["start_seconds"])
    summary = (f"Observed burned area (georeferenced, approximate): {first['burned_area_m2']['value']} m² at {_fmt(first['video_seconds'])} → {last['burned_area_m2']['value']} m² at {_fmt(last['video_seconds'])}. "
               f"Segmentation mean IoU vs manual masks: {load('eval.json', {'mean': {}})['mean'].get('iou')}.")
    cites = [{"source_id": c["source_id"], "start_seconds": c["start_seconds"], "end_seconds": c["end_seconds"], "timestamp": c["timestamp"], "event_id": c.get("event_id"), "label": f"{_fmt(c['start_seconds'])}–{_fmt(c['end_seconds'])}"} for c in ctx_items]
    if nvidia.configured("gpu") or nvidia.configured("llm"):
        listing = "\n".join(f"[{i + 1}] {_fmt(c['start_seconds'])}–{_fmt(c['end_seconds'])} ({c['kind']}): {c['text']}" for i, c in enumerate(ctx_items))
        sys = ("You are FireScope, a wildfire video analysis assistant. Answer ONLY from the evidence list, which comes from NVIDIA Cosmos Reason clip analyses and "
               "computer-vision measurements of a recorded drone video (replay, not live). Cite evidence as [n]. Be concise (≤90 words). "
               "Never invent temperatures, wind, or anything not in the evidence. If the evidence is insufficient, say so.")
        msgs = [{"role": "system", "content": sys}, *[{"role": m["role"], "content": m["content"]} for m in (req.history or [])[-4:]],
                {"role": "user", "content": f"Evidence:\n{listing}\n\nSummary: {summary}\n\nQuestion: {req.question}"}]
        try:
            ans = nvidia.chat(msgs, C.LLM_MODEL, C.LLM_BASE, max_tokens=900, service="agent")
            ans = re.sub(r"<think>.*?</think>", "", ans, flags=re.S).strip()
            used = sorted({int(n) for n in re.findall(r"\[(\d+)\]", ans) if 0 < int(n) <= len(cites)})
            remap = {n: i + 1 for i, n in enumerate(used)}
            ans = re.sub(r"\[(\d+)\]", lambda m: f"[{remap[int(m.group(1))]}]" if int(m.group(1)) in remap else "", ans)
            return {"answer": ans, "citations": [cites[n - 1] for n in used], "model": f"{C.LLM_MODEL} · retrieval: {rmodel}", "grounded": bool(used), "latency_ms": int((time.time() - t) * 1000)}
        except Exception as e:  # noqa: BLE001
            err = str(e)[:160]
    else:
        err = "no LLM configured"
    # Extractive fallback — no generative model: a chronological, cited digest of the most relevant evidence
    hit_starts = [h["start_seconds"] for h in hits[:4]]
    pick = [c for c in ctx_items if c["kind"] == "event" and (any(abs(c["start_seconds"] - h) < C.CLIP_SECONDS for h in hit_starts))]
    sev = {e["event_id"]: e["severity"] for e in evs}
    for c in sorted([c for c in ctx_items if c["kind"] == "event"], key=lambda c: {"alert": 0, "watch": 1}.get(sev.get(c.get("event_id")), 2)):
        if len(pick) >= 4:
            break
        if c not in pick:
            pick.append(c)
    pick = sorted(pick[:4], key=lambda c: c["start_seconds"])
    lines = [f"{_fmt(c['start_seconds'])} {c['text'].split(' — ')[0].rstrip('.')} [{i + 1}]" for i, c in enumerate(pick)]
    answer = (f"Burned ground in the drone's view grew from {first['burned_area_m2']['value']:,.0f} m² to {last['burned_area_m2']['value']:,.0f} m² over {_fmt(last['video_seconds'])}. "
              f"Key moments: " + "; ".join(lines) + f". (Extractive summary of logged evidence: {err}.)")
    return {"answer": answer, "citations": [next(x for x in cites if x["start_seconds"] == c["start_seconds"] and x.get("event_id") == c.get("event_id")) for c in pick],
            "model": f"extractive fallback · retrieval: {rmodel}", "grounded": bool(pick), "latency_ms": int((time.time() - t) * 1000)}


# ------------------------------------------------------------------- media

@app.get("/media/{path:path}")
def media(path: str):
    p = (MEDIA / path).resolve()
    if not str(p).startswith(str(MEDIA.resolve())) or not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/api/eval")
def evaluation():
    return load("eval.json")


@app.get("/health")
def healthz():
    return {"ok": True}


@app.get("/config.js")
def runtime_config():
    """The dashboard served by this API always talks to it same-origin (relative to the page, so /app works)."""
    from fastapi.responses import Response
    base = os.environ.get("PUBLIC_API_BASE", ".")   # '.' = relative to the page (works under /app/ and at /)
    return Response(f"window.__FIRESCOPE__ = {{ apiBase: '{base}' }};\n", media_type="application/javascript", headers={"Cache-Control": "no-store"})


if C.FRONTEND_DIST.exists():
    # Same-origin dashboard: works at / locally and under an Ingress prefix (e.g. /app, stripped by nginx)
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=C.FRONTEND_DIST, html=True), name="dashboard")


@app.exception_handler(HTTPException)
def http_err(_, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)
