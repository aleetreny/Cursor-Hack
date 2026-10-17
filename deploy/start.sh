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
# Video lives outside the ConfigMaps: fetch once at boot (served same-origin at /app/media with Range support)
VIDEO_SOURCE_URL=${VIDEO_SOURCE_URL:-https://raw.githubusercontent.com/aleetreny/cursor-hack/firescope-claude/media/drone_replay_01_640.mp4}
mkdir -p /srv/data/media
if [ ! -s /srv/data/media/drone_replay_01.mp4 ] && [ -n "$VIDEO_SOURCE_URL" ]; then
  python -c "import sys,urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$VIDEO_SOURCE_URL" /srv/data/media/drone_replay_01.mp4 || echo "WARN: video download failed"
fi
cd /app
export DATA_DIR=/srv/data FRONTEND_DIST=/srv/web MEDIA_DIR=/srv/data/media
exec python -m uvicorn firescope.app:app --host 0.0.0.0 --port "${PORT:-8080}"
