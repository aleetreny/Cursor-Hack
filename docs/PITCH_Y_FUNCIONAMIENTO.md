# FireScope 3D — Guía completa para el pitch

> **Una frase:** convertimos el vídeo de dron de un incendio en un mapa 3D georreferenciado y navegable en el tiempo, con un agente de vídeo (NVIDIA Cosmos) que detecta eventos, responde preguntas y lleva a la prueba exacta en el vídeo.

---

## 1. El problema

Durante un incendio, los drones graban horas de vídeo muy valioso: llamas, humo, terreno quemado. Pero ese vídeo es difícil de usar:

* **Está atado al punto de vista de la cámara.** El operador tiene que reconstruir mentalmente *dónde* en el terreno ocurre lo que ve.
* **Comparar momentos es lento.** ¿Cuánto ha crecido la zona quemada en los últimos 3 minutos? Hay que rebobinar y estimar a ojo.
* **Los eventos importantes quedan enterrados.** Una llama que salta por delante del frente puede durar 10 segundos en una grabación de 15 minutos.
* **No hay búsqueda.** Nadie puede preguntar "¿cuándo apareció humo denso?" a un MP4.

## 2. La solución

FireScope 3D procesa el vídeo y lo convierte en **tres cosas útiles a la vez**:

1. **Un gemelo digital 3D en el tiempo.** El área quemada y las llamas observadas se proyectan sobre el **terreno real** (modelo digital de elevación + ortofoto), en su posición geográfica. El timeline permite ver el antes y el después.
2. **Un agente de vídeo.** NVIDIA Cosmos Reason describe cada clip de 12 s (qué se ve, qué cambió y dónde revisar). Cosmos Embed1 indexa los clips para la búsqueda semántica. YOLO11 detecta personas y vehículos cerca de las llamas. El agente responde preguntas citando clips, y cada cita salta al vídeo y al mapa.
3. **Alertas revisables.** Crecimiento rápido, llamas por delante del frente o humo denso aparecen en una cola de revisión con la prueba en vídeo. Siempre con *review required*: es apoyo a la decisión, no un sistema que decida solo.

## 3. Qué es real y qué no (esto genera confianza en los jueces)

| Elemento | Origen | Estado |
|---|---|---|
| Vídeo del dron | Dataset **BurnedAreaUAV** (Zenodo, CC-BY-4.0): quema prescrita en Torre do Pinhão (Portugal) grabada con un DJI Phantom 4 Pro | **Real**, reproducido como *DRONE REPLAY* (nunca se dice "LIVE") |
| Posición y orientación de la cámara | Metadatos XMP de las fotos del dataset: GPS, 24,9 m de altura, guiñada −46,7°, cabeceo −28,9° y focal calibrada | **Real** |
| Terreno 3D | DEM de AWS Terrain Tiles con 3 anillos de nivel de detalle, hasta unos 70 km | **Real** (exageración vertical de 1,8×, indicada en pantalla) |
| Ortofoto | Esri World Imagery; colorea el terreno y coloca la vegetación | **Real** (estilo artístico encima) |
| Zona quemada y llamas | Segmentación de cada frame + proyección al terreno | **Medido**: **IoU 0,68** frente a las máscaras manuales del dataset (226 frames), **0,71** proyectado al suelo |
| Hotspots | Centros de las manchas de llama visibles | **Medido**; **sin temperatura** (RGB no mide calor) |
| Meteorología | Reanálisis **ERA5** (Open-Meteo) para ese día, hora y lugar | **Real**, pero de reanálisis, no un sensor in situ |
| Descripciones, búsqueda y respuestas | Cosmos Reason, Cosmos Embed1 y YOLO11 en el clúster del workshop | **Real en producción**. En el Mac, sin token, se muestra como "not configured" |
| Vista IR | LUT de falso color sobre el RGB | **Simulada**, rotulada en pantalla ("not thermal") |
| Drones FT-02…FT-06 | Trayectorias deterministas alrededor del incidente; su cámara es una **segunda cámara que renderiza el gemelo 3D** desde la pose del dron | **Simulado** (etiqueta SIM / "SIMULATED VIEW") |
| Modo Resources (13 unidades) | 6 aeronaves, 4 motobombas/cisternas, 2 cuadrillas y 1 bulldozer con circuitos deterministas, descargas (rojo = retardante, azul = agua) y línea de fuego cortada sobre el perímetro planificado | **Simulado** (ejercicio ilustrativo, etiqueta SIMULATED) |
| Capa "Exp. Scenario" | Extrapolación lineal del frente | **Experimental**, rotulada "NOT AN OPERATIONAL FORECAST" |
| Árboles y humo | Renderizado | **Estilizado**, para legibilidad |

## 4. Cómo funciona, paso a paso

```
Vídeo del dron (MP4)
  │ 1. Muestreo: 1 frame cada 4 s (226 frames) y clips de 12 s (76 clips)
  ▼
Segmentación (OpenCV)        ─── por frame: máscara de zona quemada, llamas y humo
  │ 2. Acumulación temporal: lo quemado no vuelve a estar sin quemar (voto de 3 frames + crecimiento conectado)
  ▼
Georreferenciación           ─── cámara estenopeica con la pose del DJI
  │ 3. Cada píxel del contorno lanza un rayo que se marcha sobre el DEM hasta tocar el suelo → lon/lat
  ▼
GeoJSON en el tiempo         ─── polígonos de zona quemada, llamas y cambio + hotspots, con timestamp ISO-UTC
  │ 4. Métricas en m² y evaluación IoU contra la verdad de campo
  ▼
Agente de vídeo (producción)
  │ 5. Cosmos Reason → descripción JSON de cada clip
  │    Cosmos Embed1 → vector de vídeo (256-d) por clip
  │    YOLO11        → objetos por clip
  │    Eventos = medidas del CV + descripción de Cosmos
  ▼
API FastAPI (/app/api/...)   ─── timeline, observaciones, eventos, búsqueda, preguntas, meteo, proyección, vídeo
  ▼
Dashboard React + Three.js   ─── terreno 3D, máscaras sobre el terreno, timeline sincronizado, vídeo sincronizado
```

**Detalles clave para preguntas técnicas:**

* **¿Por qué no reconstruir el terreno con el vídeo?** Un vídeo monocular no da geometría fiable. Usamos un DEM real y solo proyectamos encima lo observado. Es más honesto y más preciso.
* **¿Cómo sabéis que la proyección es correcta?** Usamos la pose real del dron y la focal calibrada. Además, la máscara manual del dataset, proyectada con el mismo método, coincide con la nuestra en un 71 % (IoU). La precisión absoluta es *aproximada* y así lo indicamos.
* **¿Por qué el timeline es el "reloj maestro"?** Todo (mapa, gráficas, vídeo, eventos y paneles) lee el mismo instante, así que nunca hay datos desincronizados.

## 5. El motor 3D (lo que se ve en pantalla)

* **Three.js (WebGL2)** con un shader propio sobre `MeshStandardMaterial`.
* **Terreno en 3 anillos de nivel de detalle (LOD)**, al estilo de un clipmap: 2,7 km de alta resolución (DEM z15 + ortofoto z17, ~0,9 m/px), 14 km intermedios y 70 km de horizonte. Así puedes acercarte a 10 m del frente o alejarte y ver las sierras reales (Alvão y Marão). Es el mismo principio que usan Cesium o MapLibre: más detalle cerca de la cámara.
* **Depth buffer logarítmico**: sin parpadeos (z-fighting) de metros a decenas de km.
* **El fuego va pegado al terreno** como textura dinámica: zona quemada (carbón), borde rojo, llamas emisivas con *bloom* y partículas de llama y humo. Por eso sigue el relieve perfectamente.
* **Cámara**: órbita, paneo, zoom al cursor, vuelos animados al seleccionar eventos, modo 2D cenital con estilo de mapa topográfico y brújula que se reorienta.
* **Gestor de colisiones de etiquetas**: nunca se pisan. Prioridad: evento seleccionado > dron > eventos > cumbres.

## 6. Recorrido de la interfaz (qué hace cada cosa)

* **Barra superior:** incidente, fecha, modos **Incident / Drones / Alerts**, menús View (2D/3D, reset, seguir dron, exageración), Analysis (comparar antes/después, verdad de campo, escenario experimental, agente) y Share. **Present** abre el modo presentación: 14 capítulos (portada, problema, respuesta y 10 capítulos por la app) con tarjetas explicativas y foco sobre la zona de la interfaz. Espacio pausa, ←/→ cambia de capítulo, H oculta la barra y Esc sale. A la derecha, el estado de conexión al backend.
* **Mapa 3D:** pasa el ratón por el terreno para ver elevación, pendiente, orientación, si está dentro de la zona quemada y las coordenadas. Haz clic en un evento o en el dron.
* **Layers:** cada capa cambia el render de verdad (opacidad incluida). Ground Truth muestra la máscara manual en azul.
* **Incident Overview / Weather / Fire Observation:** datos del incidente, meteo ERA5 a la hora del cursor y métricas del instante (área quemada, llama activa, Δ y hotspots), cada una con su chip de procedencia.
* **Timeline:** play, pausa, siguiente evento, velocidad 1–32×, arrastrar y marcadores de evento. Gráficas: área quemada, ritmo de propagación y perfil de elevación en la línea de visión del dron.
* **Key Events:** clic → el tiempo salta, la cámara vuela y se resalta.
* **Drones:** flota de 6. **UAV-01 es el real** (vídeo grabado). FT-02…FT-06 son simulados, con telemetría (altitud, velocidad, rumbo, batería, enlace) y una cámara que renderiza el gemelo 3D desde su posición, en EO o IR* (Ironbow / White-hot). Seleccionar un dron abre su cámara; Follow lo persigue. La ventana de cámara del dron real va al segundo con el timeline: HUD, caja de la región que el modelo pide revisar, EO/IR* (simulado), zoom, arrastrar, pantalla de mapa completa, y "Run Cosmos analysis" con progreso.
* **Resources (simulado):** KPIs (aeronaves operativas, galones descargados, cadenas de línea, personal), lista por grupos como en FireTrace y ficha de la unidad seleccionada. **Chase** sigue al avión en vuelo, **Ride along** acompaña a vehículos y cuadrillas, y **Overview** da el plano general. Las descargas y la línea de fuego aparecen sobre el terreno según el timeline. El Air Ops Log permite saltar a cada descarga, y las gráficas muestran retardante, línea construida y personal.
* **Alertas:** las alertas del agente están en la columna Detections (modo Drones) y en Evidence → Event Review Queue.
* **Analysis (agente):** preguntas en lenguaje natural; las citas `[00:48–01:00]` saltan al vídeo y al mapa.
* **Evidence:** búsqueda semántica de clips (Cosmos Embed1) + coincidencias del archivo **VSS/VAST** + cola de revisión de eventos.
* **Notes:** estado real de cada integración, qué es real y qué no, notas del analista y atribuciones.

## 7. Herramientas del hackathon: uso y finalidad

| Herramienta | Para qué la usamos | Dónde se ve en la demo |
|---|---|---|
| **NVIDIA Cosmos Reason** (`cosmos3-nano-reasoner`) | Entender cada clip de vídeo: qué se ve, qué cambió, si hay actividad nueva y dónde revisar. También redacta las respuestas del agente. | Descripción de eventos y alertas; respuestas en Analysis; Drones → Video Intelligence |
| **NVIDIA Cosmos Embed1** | Vector de **vídeo** de cada clip y vector de texto de la pregunta en el mismo espacio → búsqueda semántica real ("dense smoke" encuentra los clips con humo). | Evidence → búsqueda |
| **YOLO11** (stack VSS) | Detectar personas o vehículos en los clips con llamas → alerta "near flames" | Alerts |
| **VAST Data / VSS** | Backend de búsqueda del archivo de vídeo del equipo (login JWT + `/api/v1/search`, sobre VAST DB). Despliegue en el clúster K8s del workshop. | Evidence → "Archive matches"; la app servida en `/app` |
| **W&B / CoreWeave Inference** | LLM alternativo del agente (configurable con `LLM_BASE`) | Notes → integraciones |
| **Cursor** | Agente de infraestructura: verificó los endpoints y hace el despliegue en Kubernetes | — |

**Mensaje para los jueces:** usamos el stack de búsqueda y resumen de vídeo exactamente para lo que está pensado (entender vídeo, buscarlo y actuar) y lo anclamos a un mapa geográfico real, que es lo que necesita un equipo de emergencias.

## 8. Encaje con los criterios del jurado

* **Idea:** convertir vídeo en un mapa operativo consultable es un uso directo del stack de búsqueda y resumen de vídeo, con impacto social claro.
* **Implementación técnica:** pipeline reproducible (`python -m firescope.pipeline` en 12 s), contrato de API documentado, **evaluación cuantitativa (IoU)**, 7 tests de backend y 76 comprobaciones E2E en 6 resoluciones (incluidos los 3 modos y 60 fps medidos).
* **Diseño:** réplica del lenguaje visual de FireTrace, sin solapes (verificado automáticamente) y con la procedencia de cada dato visible.
* **Impacto (sponsors):** Cosmos Reason + Cosmos Embed1 + YOLO11 + VAST/VSS + despliegue en el clúster, cada uno con una función clara.
* **Presentación:** botón **Present**, un modo presentación por capítulos, pausable, para usarlo de fondo mientras se habla.

## 9. Guion del pitch (2 minutos, en inglés)

**0:00 — Problem (15 s).** *"During a wildfire, drones record hours of video. But video is stuck in the camera's point of view: nobody can ask it where the fire grew, or when flames jumped the line."*

**0:15 — Solution (15 s).** Pulsa **Tour** (o hazlo a mano). *"FireScope 3D turns drone footage into a time-aware 3D map. This is real terrain, the real drone position, and real footage from a prescribed burn in Portugal."*

**0:30 — Progression (20 s).** Se reproduce el timeline. *"Every 4 seconds we segment the burned ground and the flames, then cast each pixel onto the elevation model, so you see the burn scar grow on the actual ground. Our segmentation scores an IoU of 0.71 against the dataset's manual annotations."*

**0:50 — Video intelligence (25 s).** Aparece la alerta → Drones. *"NVIDIA Cosmos Reason watches every 12-second clip and explains what changed. Here it flagged rapid growth. One click takes you to the exact second of footage, with the region to review boxed. YOLO11 flags people or vehicles near the flames."*

**1:15 — Ask & search (25 s).** Analysis → pregunta. *"Ask in plain language: how did the fire change? The agent answers with citations, and each citation jumps the video and the map. Search is Cosmos Embed1: text and video in the same vector space, plus our VAST/VSS archive."*

**1:40 — Trust & impact (20 s).** 2D + Ground Truth, luego Notes. *"Everything carries its provenance: what is measured, what is modelled, and what is simulated. It runs on the workshop Kubernetes cluster behind the App button. Responders get a georeferenced, searchable picture from footage they already capture."*

## 10. Preguntas probables y respuestas

* **¿Por qué una quema prescrita y no un incendio real?** Es el único dataset público con vídeo de dron estable, máscaras manuales y pose de cámara. Eso nos permite **medir** la precisión, que es lo que da credibilidad.
* **¿Funciona en directo?** La arquitectura es la misma para vídeo en directo (los clips entran por la misma vía); hoy se reproduce una grabación y se rotula como *replay*.
* **¿Predecís el fuego?** No. La capa experimental es una extrapolación ingenua y está rotulada como no operativa.
* **¿Y la temperatura?** Con RGB no se puede medir. Por eso el IR está rotulado como simulado y los hotspots no llevan °C.
* **¿Los aviones y brigadas son reales?** No. El modo Resources y los drones FT-02…06 son un **ejercicio simulado**, rotulado como tal, para demostrar el flujo de trabajo. Lo real es el vídeo del UAV-01, el terreno, la meteo y todo lo que se deriva del vídeo.
* **¿Por qué YOLO si no detecta fuego?** Justo por eso no lo usamos para fuego. Detecta personas y vehículos (clases COCO) en clips donde Cosmos ve llamas, para alertar de exposición. El fuego lo segmenta nuestro pipeline y lo describe Cosmos.

## 11. Decisiones técnicas y trabajo futuro (P2)

* **Motor 3D: nos quedamos con Three.js** en lugar de migrar a Cesium o MapLibre. Ya tiene LOD por anillos, depth logarítmico, sombras, bloom e instancing, y medimos **60 fps** reproduciendo a 1440×900. Migrar costaría el control sobre el shader del fuego pegado al terreno.
* **Propagación tipo FARSITE (Huygens elíptico):** documentada como siguiente paso. Hoy la capa experimental es una extrapolación lineal, rotulada. Un modelo anisotrópico (viento ERA5 + pendiente del DEM + combustible) solo tendría sentido validado como *hindcast* contra las máscaras reales, y no daba tiempo a validarlo.
* **ESA WorldCover (10 m):** mejoraría la distribución de vegetación y el "combustible disponible". Hoy la vegetación sale de la ortofoto (índice de verdor). No son modelos de combustible calibrados.
* **NASA FIRMS:** útil para incendios grandes, pero con píxeles de 375 m no aporta nada en una parcela de 100 m. No lo añadimos solo por sumar integraciones.

## 12. Cómo ejecutarlo

```bash
./run.sh                                   # API :8000 + dashboard :5173, con datos reales
cd backend && python -m pytest -q tests    # tests de API + adaptadores de producción
cd frontend && node scripts/e2e.mjs        # 76 comprobaciones E2E (3 modos, 6 resoluciones, FPS)
./deploy/make-firescope-deploy.sh          # paquete para el clúster (www/ + app/)
```
