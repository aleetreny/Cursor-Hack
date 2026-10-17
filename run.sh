#!/usr/bin/env bash
# Start FireScope 3D locally: API on :8000, dashboard on :5173 (connected to the API).
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-backend/.venv/bin/python}
[ -x "$PY" ] || PY="$HOME/.local/firescope-venv/bin/python"
[ -f data/processed/drone_replay_01/timeline.json ] || (cd backend && "$OLDPWD/$PY" -m firescope.pipeline)
(cd backend && exec "$OLDPWD/$PY" -m uvicorn firescope.app:app --port 8000) &
API=$!
trap 'kill $API 2>/dev/null' EXIT
command -v npm >/dev/null || export PATH="$HOME/.local/node/bin:$PATH"
cd frontend && VITE_API_BASE=http://localhost:8000 npx vite --port 5173
