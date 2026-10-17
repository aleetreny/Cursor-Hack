#!/usr/bin/env bash
# Produce firescope-deploy/{www,app} for the workshop K8s deployment (Ingress /app → "/").
#   www/  = contents of frontend/dist built with base /app/
#   app/  = main.py + firescope/ backend package + requirements.txt + data.tgz + thumbs.tgz
# No secrets, no .env, no videos (fetched at boot), no dev files.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v npm >/dev/null || export PATH="$HOME/.local/node/bin:$PATH"
OUT=firescope-deploy
rm -rf "$OUT"; mkdir -p "$OUT/www" "$OUT/app/firescope"
(cd frontend && VITE_BASE=/app/ npm run build >/dev/null)
cp -R frontend/dist/. "$OUT/www/"
rm -rf "$OUT/www/fixtures" "$OUT/www/media"
echo "window.__FIRESCOPE__ = { apiBase: '/app' };" > "$OUT/www/config.js"   # backend also serves this route
cp deploy/HANDOFF.md "$OUT/HANDOFF.md"
cp backend/main.py "$OUT/app/main.py"
cp backend/firescope/{__init__,app,common,config,cosmos_job,nvidia,weather}.py "$OUT/app/firescope/"
cp backend/requirements-api.txt "$OUT/app/requirements.txt"
tar -czf "$OUT/app/data.tgz" -C data/processed drone_replay_01
tar -czf "$OUT/app/thumbs.tgz" -C data/processed media/drone_replay_01
# safety: nothing secret or local
if grep -rIl -E "nvapi-|GPU_BEARER_TOKEN=.+|PASSWORD=.+|localhost:8000" "$OUT" ; then echo "ERROR: suspicious content above"; exit 1; fi
find "$OUT" -name ".env*" -o -name "__pycache__" | xargs rm -rf
echo "== sizes"; find "$OUT" -type f -size +100k -exec ls -la {} \; | awk '{print $5, $9}' | sort -n
du -sh "$OUT/www" "$OUT/app"
