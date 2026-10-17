"""TEST-ONLY mock of the workshop GPU endpoints (same routes/shapes as vast-builders-challenge gpu/README).
Outputs are deterministic placeholders — used only to exercise FireScope's adapter code paths offline.
Run: uvicorn tests.mock_gpu:app --port 8099 ; then GPU_HOST-style bases at http://localhost:8099/v1
"""
import hashlib, json, math
from fastapi import FastAPI, Request

app = FastAPI()
CALLS = {"chat": 0, "embed": 0, "infer": 0}

@app.get("/v1/models")
def models():
    return {"data": [{"id": "mock-model"}]}

@app.post("/v1/chat/completions")
async def chat(req: Request):
    body = await req.json(); CALLS["chat"] += 1
    content = body["messages"][-1]["content"]
    has_video = isinstance(content, list) and any(c.get("type") == "video_url" for c in content)
    if isinstance(content, list):
        out = {"caption": "MOCK caption (test only).", "flames_visible": True, "smoke": "moderate", "burned_ground_visible": True,
               "change": "MOCK change.", "new_activity_away_from_main_front": False, "review_regions": ["right edge"],
               "event_type": "visible_fire_expansion", "visual_evidence": ["mock evidence"]}
        return {"choices": [{"message": {"content": "<think>mock</think>" + json.dumps(out)}}], "mock_video": has_video}
    return {"choices": [{"message": {"content": "MOCK answer citing [1] and [2]."}}]}

@app.post("/v1/embeddings")
async def emb(req: Request):
    body = await req.json(); CALLS["embed"] += 1
    h = hashlib.sha256(str(body["input"])[:2000].encode()).digest()
    v = [math.sin(h[i % 32] + i) for i in range(256)]
    return {"data": [{"embedding": v}]}

@app.post("/v1/infer")
async def infer(req: Request):
    await req.json(); CALLS["infer"] += 1
    return {"perception_ok": True, "object_classes": ["person"] if CALLS["infer"] % 5 == 0 else [], "object_counts": {}}

@app.get("/calls")
def calls():
    return CALLS
