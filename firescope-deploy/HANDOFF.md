# FireScope 3D — deploy package (for Cursor)

Built from branch `firescope-claude` with `./deploy/make-firescope-deploy.sh`. **No secrets, no `.env`, no video inside.**

```
firescope-deploy/
├── www/   compiled dashboard (Vite dist, base /app/) — static files
└── app/   main.py + firescope/ (FastAPI) + requirements.txt + data.tgz + thumbs.tgz
```

## Start command
```bash
cd app && pip install -r requirements.txt && python main.py      # listens on 0.0.0.0:$PORT (default 8080)
```
One process serves `/health`, `/api/*`, `/media/*`, `/config.js` and the dashboard (`../www`) at `/`.
The Ingress strips `/app`; requests that still carry `/app` are also accepted.

## Environment (from a K8s Secret — never commit values)
| Var | Required | Notes |
|---|---|---|
| `GPU_BEARER_TOKEN` | yes (for AI) | bearer for Cosmos Reason :8001, Cosmos Embed1 :8003, YOLO11 :8002 |
| `VSS_URL` | yes (for archive search) | `http://video-backend-service.team-23.svc.cluster.local:8000` |
| `VSS_USERNAME`, `VSS_PASSWORD` | yes (for archive search) | team credentials |
| `AUTO_ANALYZE` | recommended `1` | runs the real Cosmos Reason + Embed1 + YOLO11 pass over the replay at boot |
| `COSMOS_REASON_BASE` / `COSMOS_REASON_MODEL` | optional | default `http://166.19.38.112:8001/v1` / `nvidia/cosmos3-nano-reasoner` |
| `COSMOS_EMBED_BASE` / `COSMOS_EMBED_MODEL` | optional | default `http://166.19.38.112:8003/v1` / `nvidia/cosmos-embed1` |
| `LLM_BASE`, `LLM_API_KEY`, `LLM_MODEL` | optional | W&B / CoreWeave OpenAI-compatible agent LLM |
| `VIDEO_SOURCE_URL` | optional | replay video downloaded once at boot (default: public CC-BY copy in this repo) |
| `DATA_DIR`, `WWW_DIR`, `PORT` | optional | `/tmp/firescope-data`, `../www`, `8080` |

Without credentials the app still works (CV-derived events, Cosmos shown as "not configured") — it never fakes model output.

## Verified locally
- `npm run build` (base `/app/`), dashboard + API under an emulated `/app` Ingress, video with Range requests.
- Backend tests 7/7 · UI E2E 76/76 (6 viewports) · presentation walk 18/18.
- Bundle sizes: three ≈ 536 KB, vendor ≈ 224 KB, app ≈ 140 KB, data.tgz ≈ 455 KB, thumbs.tgz ≈ 455 KB.

Rebuild after code changes: `./deploy/make-firescope-deploy.sh` (from the repo root).
