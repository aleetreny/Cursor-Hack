# Auditoría reproducible

Scripts usados para la auditoría de `docs/PLAN_DE_MEJORA.md`. Requieren la app servida (por ejemplo `localhost:8000`) y Chrome.

| Script | Qué mide |
|---|---|
| `perf.mjs <url> <out>` | Carga en frío, carga en 4G lenta, bytes por tipo, tareas largas, FPS por estado |
| `cpu.mjs` | Coste de hilo principal por segundo (reposo, reproducción, cámaras) |
| `states.mjs <url> <out> [WxH,...]` | 25 estados × 8 viewports: capturas + solapes de texto, recortes, controles fuera de pantalla (usa `geom.js`) |
| `clicks.mjs <url> <out>` | Pulsa cada control en 8 estados y registra qué cambia |
| `targeted.mjs <url> <out>` | Menús, Esc, compartir, enlaces profundos, teclado, agente, búsqueda, final de reproducción |

Ejemplo: `node scripts/audit/states.mjs 'http://localhost:8000/?nointro' audit-out 1920x1080,390x844`
