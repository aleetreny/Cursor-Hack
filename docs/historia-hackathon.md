# Historia: el despliegue del hackathon (archivado)

Durante el **VAST Builders Challenge (17 oct 2026)** FireScope 3D se desplegó en el clúster Kubernetes del taller (namespace `team-23`), detrás de la ruta `/app` del Ingress. El despliegue lo hizo Cursor a partir del paquete `firescope-deploy/` que generábamos aquí.

Ese clúster ya no existe y el dominio público no resuelve. **Este documento sustituye a `deploy/`, `firescope-deploy/`, `deploy/HANDOFF.md` y `backend/main.py`**, que se borraron al pasar a `main` y a GitHub Pages. El código completo está en el historial de git: el último commit con el despliegue es `3077e37`, en la rama `firescope-claude`.

## Cómo estaba montado

- **Una imagen pública** `python:3.12-slim`, sin registro propio. El código y los datos iban en **ConfigMaps** de menos de 1 MiB: código, `web.tgz`, `data.tgz` y `thumbs.tgz`.
- **Un solo proceso** (`backend/main.py`, FastAPI) servía `/health`, `/api/*`, `/media/*`, `/config.js` y el dashboard compilado con base `/app/`. Al arrancar descomprimía los datos en `/tmp/firescope-data` y descargaba el vídeo de 640×360 (CC-BY) desde el repo.
- **Credenciales solo en el servidor**, en el Secret `firescope-env`: `GPU_BEARER_TOKEN`, `VSS_URL`, `VSS_USERNAME`, `VSS_PASSWORD` y, de forma opcional, `LLM_*`. Nunca estuvieron en el bundle del navegador ni en git.
- Con `AUTO_ANALYZE=1`, al arrancar se ejecutaba la pasada real sobre el vídeo:
  - **NVIDIA Cosmos Reason** (`nvidia/cosmos3-nano-reasoner`, :8001): descripción JSON de cada clip de 12 s.
  - **Cosmos Embed1** (`nvidia/cosmos-embed1`, 256-d, :8003): vectores de vídeo y de texto para la búsqueda.
  - **YOLO11** (:8002): objetos por clip.
  - **VAST / VSS**: búsqueda en el archivo de vídeos del equipo.

## Qué se perdió y qué no

- Los **resultados de Cosmos** se generaban en el pod y no se guardaron fuera. No se pueden recuperar, y **no se van a inventar**.
- Todo lo medible es reproducible desde este repo: la segmentación, la georreferenciación, los eventos, la evaluación (IoU 0,68 / 0,71) y la meteorología. Ahora se publica como **demo estática** en GitHub Pages.
- En la fase 8 del [plan](PLAN_DE_MEJORA.md) se eliminó el backend FastAPI con sus adaptadores NVIDIA (`nvidia.py`, `cosmos_job.py`, `tests/mock_gpu.py`). El pipeline de Pinhão pasó a `pipeline/pinhao/` (`replay.py`). Siguen en el historial de git.
