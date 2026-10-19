# Auditoría reproducible

Scripts usados para la auditoría de `docs/PLAN_DE_MEJORA.md`. Requieren la web servida (`npm run build && npx vite preview --port 4173`) y Google Chrome (el Chromium de Playwright no decodifica H.264).

| Script | Qué mide |
|---|---|
| `perf.mjs <url> <out>` | Carga en frío, carga en 4G lenta, bytes por tipo, tareas largas, FPS por estado |
| `cpu.mjs` | Coste de hilo principal por segundo (reposo, reproducción, cámaras) |
| `states.mjs <url> <out> [WxH,...]` | 25 estados × 8 viewports: capturas + solapes de texto, recortes, controles fuera de pantalla (usa `geom.js`) |
| `devices.mjs <url> <out> [device,...]` | 8 móviles y tablets con táctil emulado (iPhone SE/14, Pixel 7, Android 360, iPhone horizontal, iPad mini/Air/horizontal): 16 estados de móvil y 6 de tablet, con capturas y `geom.js` |
| `views.mjs <out> [base] [--uncapped]` | Vistas «de catálogo» de los dos incidentes (día, noche, crepúsculo, horizonte, árboles de cerca, 2D, vista general) y fps reproduciendo; con `--uncapped`, sin vsync, para medir el margen |
| `clicks.mjs <url> <out>` | Pulsa cada control en 8 estados y registra qué cambia |
| `targeted.mjs <url> <out>` | Menús, Esc, compartir, enlaces profundos, teclado, agente, búsqueda, final de reproducción |
| `ai.mjs [base] [out]` | Búsqueda visual en los dos incidentes: 14 consultas (ES/EN) con la fuerza de coincidencia esperada, incluidas las que no deben coincidir («helicopter», «a person»), y el salto a una pasada de Sentinel-2 |
| `live.mjs [base] [out]` | Análisis en vivo: fps reproduciendo e IoU de la máscara del navegador frente a Python en el mismo fichero y frente al pipeline grabado (necesita `python -m pipeline.pinhao.live_ref`) |

Ejemplo: `node scripts/audit/states.mjs 'http://localhost:4173/?nointro' audit-out 1920x1080,390x844`
