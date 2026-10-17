#!/bin/sh
# Container entrypoint (python:3.12-slim). Unpacks the bundles and serves API + dashboard on :8080 at "/".
# The workshop Ingress maps /app → / ; the dashboard uses relative URLs so it works under /app unchanged.
set -e
mkdir -p /srv/web /srv/data
tar -xzf /bundle/web/web.tgz -C /srv/web
tar -xzf /bundle/data/data.tgz -C /srv/data
[ -f /bundle/thumbs/thumbs.tgz ] && tar -xzf /bundle/thumbs/thumbs.tgz -C /srv/data
# same-origin API, relative to the page
echo "window.__FIRESCOPE__ = { apiBase: '.' };" > /srv/web/config.js
pip install --no-cache-dir -q -r /app/requirements.txt
cd /app
export DATA_DIR=/srv/data FRONTEND_DIST=/srv/web MEDIA_DIR=/srv/data/media
exec python -m uvicorn firescope.app:app --host 0.0.0.0 --port "${PORT:-8080}"
