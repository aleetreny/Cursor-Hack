# Deploying FireScope 3D on the workshop cluster

This follows `vast-builders-challenge/.cursor/skills/deployment/deploy-app-no-registry`: a public `python:3.12-slim` image, code and assets from ConfigMaps, Ingress path `/app` (rewritten to `/`), and users open **https://workshop.thecosmoslabs.com → App**.

One container serves both the API and the built 3D dashboard. The dashboard uses only relative URLs (`base: './'`, runtime `config.js` with `apiBase: '.'`), so it works under `/app` unchanged. This was verified with an emulated prefix-stripping Ingress (`frontend/scripts/prefix-test.mjs`).

## 1. Build the bundle (on any machine with the repo + data)

```bash
./deploy/build.sh        # → deploy/out/{web.tgz 640K, data.tgz 444K, thumbs.tgz 448K, code/}
```

All artefacts are under the 1 MiB ConfigMap limit. **The video is not bundled.**

## 2. Video (113 MB at 960p; `deploy/media/drone_replay_01.mp4` is a 640×360 copy)

Host it anywhere reachable by browsers that supports HTTP Range requests, for example the team's VAST S3 bucket or any static host. Then set `MEDIA_URL` to the prefix that contains `drone_replay_01.mp4`. The API rewrites `media_url` to `${MEDIA_URL}/drone_replay_01.mp4`. Without `MEDIA_URL` the dashboard still works; only the drone camera window shows "Video unavailable".

## 3. Apply (on the VM, team namespace)

```bash
NS=team-23; export KUBECONFIG=/config/${NS}-k8s.yaml
APP_HOST=video-lab-team-23.cosmos.vastdata.com
kubectl -n $NS create configmap firescope-code --from-file=deploy/out/code/firescope --from-file=deploy/out/code/requirements.txt --from-file=deploy/out/code/start.sh --dry-run=client -o yaml | kubectl apply -f -
kubectl -n $NS create configmap firescope-web    --from-file=deploy/out/web.tgz    --dry-run=client -o yaml | kubectl apply -f -
kubectl -n $NS create configmap firescope-data   --from-file=deploy/out/data.tgz   --dry-run=client -o yaml | kubectl apply -f -
kubectl -n $NS create configmap firescope-thumbs --from-file=deploy/out/thumbs.tgz --dry-run=client -o yaml | kubectl apply -f -
# server-side secrets (never in the browser bundle): Cosmos endpoint + token, optional media URL
kubectl -n $NS create secret generic firescope-env \
  --from-literal=COSMOS_REASON_BASE=http://166.19.38.112:8001/v1 \
  --from-literal=COSMOS_API_KEY="$(grep '^GPU_BEARER_TOKEN=' /config/${NS}.config | cut -d= -f2-)" \
  --from-literal=MEDIA_URL="<https://…/prefix>" \
  --dry-run=client -o yaml | kubectl apply -f -
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
| `COSMOS_REASON_BASE`, `COSMOS_API_KEY`, `COSMOS_REASON_MODEL` | — / — / `nvidia/cosmos3-nano-reasoner` | NVIDIA Cosmos Reason NIM for `/api/ask` and analysis |

Note: the Cosmos *clip analysis job* (`python -m firescope.cosmos_job`) needs the original video plus ffmpeg, so run it where the data lives (Mac or VM) and redeploy `data.tgz`. In the pod, `/api/ask` calls Cosmos live.
