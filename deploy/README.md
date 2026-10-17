# Deploying FireScope 3D on the workshop cluster

This follows `vast-builders-challenge/.cursor/skills/deployment/deploy-app-no-registry`: a public `python:3.12-slim` image, code and assets from ConfigMaps, Ingress path `/app` (rewritten to `/`), and users open **https://workshop.thecosmoslabs.com → App**.

One container serves both the API and the built 3D dashboard. The dashboard uses only relative URLs (`base: './'`, runtime `config.js` with `apiBase: '.'`), so it works under `/app` unchanged. This was verified with an emulated prefix-stripping Ingress (`frontend/scripts/prefix-test.mjs`).

## 1. Build the bundle (on any machine with the repo + data)

```bash
./deploy/build.sh        # → deploy/out/{web.tgz 640K, data.tgz 444K, thumbs.tgz 448K, code/}
```

All artefacts are under the 1 MiB ConfigMap limit. **The video is not bundled.**

## 2. Video

Not in any ConfigMap. At boot, `start.sh` downloads `media/drone_replay_01_640.mp4` (25.6 MB, CC-BY-4.0, see `media/ATTRIBUTION.md`) from this branch's public raw URL into `/srv/data/media`. The API then serves it same-origin at `/app/media/drone_replay_01.mp4` with Range requests. You can override the source with `VIDEO_SOURCE_URL`, or serve it elsewhere with `MEDIA_URL`.

## 3. Apply (on the VM, team namespace)

```bash
NS=team-23; export KUBECONFIG=/config/${NS}-k8s.yaml
APP_HOST=video-lab-team-23.cosmos.vastdata.com
kubectl -n $NS create configmap firescope-code --from-file=deploy/out/code/firescope --from-file=deploy/out/code/requirements.txt --from-file=deploy/out/code/start.sh --dry-run=client -o yaml | kubectl apply -f -
kubectl -n $NS create configmap firescope-web    --from-file=deploy/out/web.tgz    --dry-run=client -o yaml | kubectl apply -f -
kubectl -n $NS create configmap firescope-data   --from-file=deploy/out/data.tgz   --dry-run=client -o yaml | kubectl apply -f -
kubectl -n $NS create configmap firescope-thumbs --from-file=deploy/out/thumbs.tgz --dry-run=client -o yaml | kubectl apply -f -
# server-side secrets (never in the browser bundle): GPU token for Cosmos Reason / Embed1 / YOLO11, VSS login
TEAM_CONFIG=/config/${NS}.config
kubectl -n $NS create secret generic firescope-env \
  --from-literal=GPU_BEARER_TOKEN="$(grep '^GPU_BEARER_TOKEN=' $TEAM_CONFIG | cut -d= -f2-)" \
  --from-literal=VSS_URL="$(grep '^INGRESS_URL=' $TEAM_CONFIG | cut -d= -f2-)" \
  --from-literal=VSS_USERNAME="$(grep '^USERNAME=' $TEAM_CONFIG | cut -d= -f2-)" \
  --from-literal=VSS_PASSWORD="$(grep '^PASSWORD=' $TEAM_CONFIG | cut -d= -f2-)" \
  --dry-run=client -o yaml | kubectl apply -f -
# optional W&B inference for the agent: add LLM_BASE / LLM_API_KEY / LLM_MODEL to the same Secret
NS=$NS APP_HOST=$APP_HOST envsubst '$APP_HOST' < deploy/k8s.yaml | kubectl -n $NS apply -f -
kubectl -n $NS rollout restart deploy/firescope && kubectl -n $NS rollout status deploy/firescope
curl -s http://$APP_HOST/app/health
```

After code changes, re-run `build.sh`, re-apply the ConfigMaps, and `rollout restart`.

## Runtime env

| Var | Default | Meaning |
|---|---|---|
| `DATA_DIR` | `/srv/data` | Processed observations (`drone_replay_01/*.json`) |
| `FRONTEND_DIST` | `/srv/web` | Built dashboard, served at `/` |
| `MEDIA_DIR` / `MEDIA_URL` | `/srv/data/media` / — | Local media (thumbnails) / external video prefix |
| `GPU_BEARER_TOKEN` | Secret | Bearer for the workshop GPU models |
| `COSMOS_REASON_BASE` / `COSMOS_REASON_MODEL` | `http://166.19.38.112:8001/v1` / `nvidia/cosmos3-nano-reasoner` | Clip analysis + agent |
| `COSMOS_EMBED_BASE` / `COSMOS_EMBED_MODEL` | `:8003/v1` / `nvidia/cosmos-embed1` | 256-d video + text embeddings → `/api/search` |
| `YOLO_URL` | `:8002` | YOLO11 objects per clip |
| `VSS_URL`, `VSS_USERNAME`, `VSS_PASSWORD` | Secret | VSS retrieval (VAST) login for archive search |
| `LLM_BASE`, `LLM_API_KEY`, `LLM_MODEL` | Cosmos Reason | Optional W&B / CoreWeave OpenAI-compatible agent LLM |
| `AUTO_ANALYZE` | `1` in k8s.yaml | Runs the real Cosmos Reason + Embed1 + YOLO11 pass at boot (progress in Drones → Video Intelligence, and `/api/integrations/health`) |

The analysis pass (`cosmos_job`) cuts 12 s clips from the downloaded video with the `imageio-ffmpeg` wheel. Results land in `/srv/data` and survive until the pod restarts; then it runs again.
Code paths were verified offline against `backend/tests/mock_gpu.py` (same routes and shapes as the workshop GPU README).
