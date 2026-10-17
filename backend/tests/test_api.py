"""API contract tests over the real processed data (run: python -m pytest -q tests)."""
import os
import subprocess
import sys
import time

import pytest
from fastapi.testclient import TestClient

from firescope.app import app

c = TestClient(app)
ISO = lambda s: isinstance(s, str) and s.endswith("Z") and "T" in s  # noqa: E731


def test_health_and_config():
    assert c.get("/health").json() == {"ok": True}
    assert "apiBase" in c.get("/config.js").text
    ids = {i["id"] for i in c.get("/api/integrations/health").json()["integrations"]}
    assert {"nvidia_cosmos_reason", "nvidia_cosmos_embed", "yolo11", "vast_vss", "cv_pipeline"} <= ids


def test_prefix_is_accepted():
    assert c.get("/app/health").json() == {"ok": True}
    assert c.get("/app/api/incident").status_code == 200


def test_incident_sources_timeline_observations():
    inc = c.get("/api/incident").json()
    assert len(inc["bbox"]) == 4 and inc["reference_perimeter"]["geometry"]["type"] == "Polygon"
    src = c.get("/api/sources").json()[0]
    assert src["mode"] == "drone_replay" and src["pose"]["altitude_agl_m"] == pytest.approx(24.9)
    tl = c.get("/api/fire/timeline").json()
    assert len(tl["frames"]) > 200 and all(ISO(f["timestamp"]) for f in tl["frames"])
    assert tl["frames"][-1]["burned_area_m2"]["value"] > tl["frames"][0]["burned_area_m2"]["value"]
    obs = c.get("/api/fire/observations").json()
    classes = {f["properties"]["classification"] for f in obs["features"]}
    assert {"burned_area", "visible_active_fire", "ground_truth_burned"} <= classes
    assert all(h["properties"]["temperature_c"] is None for h in obs["hotspots"])  # RGB ≠ thermal


def test_state_projection_events():
    st = c.get("/api/fire/state", params={"time": "2019-03-01T12:40:00Z"}).json()
    assert st["timestamp"] <= "2019-03-01T12:40:00Z" and st["features"]
    pr = c.get("/api/fire/projection", params={"from": "2019-03-01T12:40:00Z", "horizon_minutes": 3}).json()
    assert pr["experimental"] is True and "NOT AN OPERATIONAL FORECAST" in pr["label"] and len(pr["steps"]) == 3
    ev = c.get("/api/video/drone_replay_01/events").json()["events"]
    assert ev and all(e["confidence"] is None and e["review_required"] for e in ev)


def test_search_ask_media():
    s = c.post("/api/search", json={"query": "dense smoke"}).json()
    assert "results" in s and "model" in s
    a = c.post("/api/ask", json={"question": "How did the fire change during the recording?"}).json()
    assert a["citations"] and all("start_seconds" in x for x in a["citations"])
    r = c.get("/media/drone_replay_01/clip_0003.jpg")
    assert r.status_code == 200


def test_analyze_requires_server_credentials():
    if os.environ.get("GPU_BEARER_TOKEN"):
        pytest.skip("credentials present")
    r = c.post("/api/video/analyze", json={"source_id": "drone_replay_01"})
    assert r.status_code == 503   # never fakes a run


def test_production_adapters_against_mock(tmp_path):
    """Exercise Cosmos Reason / Embed1 / YOLO11 / VSS code paths against tests/mock_gpu.py (TEST ONLY)."""
    port = "8097"
    srv = subprocess.Popen([sys.executable, "-m", "uvicorn", "tests.mock_gpu:app", "--port", port], cwd=os.path.dirname(os.path.dirname(__file__)),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(2)
        import shutil
        from firescope import config as C
        shutil.copytree(C.PROCESSED / "drone_replay_01", tmp_path / "drone_replay_01")
        env = {**os.environ, "DATA_DIR": str(tmp_path), "GPU_BEARER_TOKEN": "test", "COSMOS_REASON_BASE": f"http://localhost:{port}/v1",
               "COSMOS_EMBED_BASE": f"http://localhost:{port}/v1", "YOLO_URL": f"http://localhost:{port}", "VSS_URL": f"http://localhost:{port}", "VSS_USERNAME": "u", "VSS_PASSWORD": "p"}
        code = ("from firescope import cosmos_job; from fastapi.testclient import TestClient; from firescope.app import app;"
                "r = cosmos_job.run(every=25, max_clips=4); assert r['state']=='done', r; c = TestClient(app);"
                "s = c.post('/api/search', json={'query':'smoke'}).json(); assert 'cosmos-embed1' in s['model'], s['model'];"
                "assert s['archive_results'] and 'error' not in s['archive_results'][0];"
                "a = c.post('/api/ask', json={'question':'what happened?'}).json(); assert 'cosmos3' in a['model'];"
                "print('ADAPTERS_OK')")
        out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(__file__)), timeout=240)
        assert "ADAPTERS_OK" in out.stdout, out.stderr[-1500:]
    finally:
        srv.terminate()
