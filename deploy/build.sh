#!/usr/bin/env bash
# Build the portable FireScope 3D bundle for the workshop K8s "deploy-app-no-registry" flow.
# Output (deploy/out/): web.tgz (built dashboard), data.tgz (processed observations + thumbnails), code/ (backend package)
# Each artefact stays well under the ~1 MiB ConfigMap limit. Videos are NOT bundled (set MEDIA_URL).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v npm >/dev/null || export PATH="$HOME/.local/node/bin:$PATH"
OUT=deploy/out; rm -rf "$OUT"; mkdir -p "$OUT/code/firescope"
(cd frontend && npm run build >/dev/null)
tar -czf "$OUT/web.tgz" -C frontend/dist --exclude ./fixtures .
tar -czf "$OUT/data.tgz" -C data/processed drone_replay_01
tar -czf "$OUT/thumbs.tgz" -C data/processed media/drone_replay_01
cp backend/firescope/*.py "$OUT/code/firescope/"
cp backend/requirements-api.txt "$OUT/code/requirements.txt"
cp deploy/start.sh "$OUT/code/start.sh"
ls -la "$OUT" "$OUT/code"
du -sh "$OUT"/*.tgz
for f in "$OUT"/*.tgz; do [ $(wc -c < "$f") -lt 1000000 ] || echo "WARNING: $f exceeds ConfigMap limit"; done
