# FireScope 3D — Guía completa para el pitch

> **Una frase:** convertimos el vídeo de dron de un incendio en un mapa 3D georreferenciado y navegable en el tiempo, que detecta eventos, responde preguntas en español o inglés y lleva a la prueba exacta en el vídeo.
>
> **Demo pública:** https://aleetreny.github.io/FireScope-3D/ — funciona entera en el navegador, sin servidor ni claves.

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
2. **Un analista al que preguntar.** Entiende preguntas en español o inglés ("¿cuándo creció más rápido?", "¿dónde estaba el dron?", "¿qué viento hacía?") y responde con las mediciones grabadas, citando los clips. Cada cita salta al vídeo y al mapa. También hay búsqueda en el vídeo ("humo denso", "llamas fuera del frente").
3. **Alertas revisables.** Crecimiento rápido, llamas por delante del frente o humo denso aparecen en una cola de revisión con la prueba en vídeo. Siempre con *review required*: es apoyo a la decisión, no un sistema que decida solo.

## 3. Qué es real y qué no (esto genera confianza)

| Elemento | Origen | Estado |
|---|---|---|
| Vídeo del dron | Dataset **BurnedAreaUAV** (Zenodo, CC-BY-4.0): quema prescrita en Torre do Pinhão (Portugal) grabada con un DJI Phantom 4 Pro | **Real**, reproducido como *DRONE REPLAY* (nunca se dice "LIVE") |
| Posición y orientación de la cámara | Metadatos XMP de las fotos del dataset: GPS, 24,9 m de altura, guiñada −46,7°, cabeceo −28,9° y focal calibrada | **Real** |
| Terreno 3D | DEM de AWS Terrain Tiles con 3 anillos de nivel de detalle, hasta unos 70 km | **Real** (exageración vertical de 1,8×, indicada en pantalla) |
| Ortofoto | Esri World Imagery; colorea el terreno y coloca la vegetación | **Real** (estilo artístico encima) |
| Zona quemada y llamas | Segmentación de cada fotograma + proyección al terreno | **Medido**: **IoU 0,68** frente a las máscaras manuales del dataset (226 fotogramas), **0,71** proyectado al suelo |
| Hotspots | Centros de las manchas de llama visibles | **Medido**; **sin temperatura** (RGB no mide calor) |
| Eventos | Cambios medidos: crecimiento, llamas fuera de la zona quemada, humo, máxima extensión de llama | **Derivado**, siempre *review required* |
| Preguntas y búsqueda | Analista y búsqueda que se ejecutan en el navegador sobre las mediciones y los eventos grabados | **Derivado**. Reglas fijas, **sin modelo de lenguaje y sin inventar nada** |
| Meteorología | Reanálisis **ERA5** (Open-Meteo) para ese día, hora y lugar | **Real**, pero de reanálisis, no un sensor in situ |
| Vista IR | LUT de falso color sobre el RGB | **Simulada**, rotulada en pantalla ("not thermal") |
| Drones FT-02…FT-06 | Trayectorias deterministas alrededor del incidente; su cámara es una **segunda cámara que renderiza el gemelo 3D** desde la pose del dron | **Simulado** (etiqueta SIM / "SIMULATED VIEW") |
| Modo Resources (13 unidades) | 6 aeronaves, 4 motobombas/cisternas, 2 cuadrillas y 1 bulldozer con circuitos deterministas, descargas (rojo = retardante, azul = agua) y línea de fuego cortada sobre el perímetro planificado | **Simulado** (ejercicio ilustrativo, etiqueta SIMULATED) |
| Escenario de incendio grande | Propagación ilustrativa por viento y pendiente sobre el DEM real | **Simulado**, rotulado "NOT A FORECAST" |
| Árboles y humo | Renderizado | **Estilizado**, para legibilidad |

La pestaña **About** de la app lista lo mismo, generado a partir de los datos del incidente.

## 4. Cómo funciona, paso a paso

```
Vídeo del dron (MP4)
  │ 1. Muestreo: 1 fotograma cada 4 s (226 fotogramas) y clips de 12 s (76 clips)
  ▼
Segmentación (OpenCV)        ─── por fotograma: máscara de zona quemada, llamas y humo
  │ 2. Acumulación temporal: lo quemado no vuelve a estar sin quemar (voto de 3 fotogramas + crecimiento conectado)
  ▼
Georreferenciación           ─── cámara estenopeica con la pose del DJI
  │ 3. Cada píxel del contorno lanza un rayo que se marcha sobre el DEM hasta tocar el suelo → lon/lat
  ▼
GeoJSON en el tiempo         ─── polígonos de zona quemada, llamas y cambio + hotspots, con timestamp ISO-UTC
  │ 4. Métricas en m², eventos y evaluación IoU contra la verdad de campo
  ▼
Paquete del incidente        ─── incidents/<id>/: JSON, vídeo, miniaturas y manifest (métodos y atribuciones)
  │ 5. Se publica como web estática en GitHub Pages
  ▼
Navegador                    ─── React + Three.js: terreno 3D, máscaras sobre el terreno, timeline y vídeo sincronizados,
                                 analista y búsqueda, operaciones simuladas, modo presentación
```

**Detalles clave para preguntas técnicas:**

* **¿Por qué no reconstruir el terreno con el vídeo?** Un vídeo monocular no da geometría fiable. Usamos un DEM real y solo proyectamos encima lo observado. Es más honesto y más preciso.
* **¿Cómo sabéis que la proyección es correcta?** Usamos la pose real del dron y la focal calibrada. Además, la máscara manual del dataset, proyectada con el mismo método, coincide con la nuestra en un 71 % (IoU). La precisión absoluta es *aproximada* y así lo indicamos.
* **¿Por qué el timeline es el "reloj maestro"?** Todo (mapa, gráficas, vídeo, eventos y paneles) lee el mismo instante, así que nunca hay datos desincronizados.
* **¿Cómo responde el analista sin un LLM?** Detecta la intención de la pregunta (dónde, cuándo, cuánto, crecimiento, focos, humo, viento, dron, precisión, riesgo, recursos) y calcula la respuesta con los datos: por ejemplo, el minuto de mayor crecimiento sale de la serie de área quemada. Si no reconoce la pregunta, lo dice y da el resumen.

## 5. El motor 3D (lo que se ve en pantalla)

* **Three.js (WebGL2)** con un shader propio sobre `MeshStandardMaterial`.
* **Terreno en 3 anillos de nivel de detalle (LOD)**, al estilo de un clipmap: 2,7 km de alta resolución (DEM z15 + ortofoto z17, ~0,9 m/px), 14 km intermedios y 70 km de horizonte. Así puedes acercarte a 10 m del frente o alejarte y ver las sierras reales (Alvão y Marão). Es el mismo principio que usan Cesium o MapLibre: más detalle cerca de la cámara.
* **Depth buffer logarítmico**: sin parpadeos (z-fighting) de metros a decenas de km.
* **El fuego va pegado al terreno** como textura dinámica: zona quemada (carbón), borde rojo, llamas emisivas con *bloom* y partículas de llama y humo. Por eso sigue el relieve perfectamente.
* **Cámara**: órbita, paneo, zoom al cursor, vuelos animados al seleccionar eventos, modo 2D cenital con estilo de mapa topográfico y brújula que se reorienta.
* **Gestor de colisiones de etiquetas**: prioridad evento seleccionado > dron > eventos > cumbres.

## 6. Recorrido de la interfaz (qué hace cada cosa)

* **Barra superior:** incidente, fecha, modos **Incident / Drones / Resources**, menús View (2D/3D, reset, seguir dron, exageración), Analysis (comparar antes/después, verdad de campo, escenario, analista) y Share. **Tour** abre la visita guiada: 18 capítulos (portada, problema, respuesta, 14 capítulos por la app y cierre) con tarjetas explicativas y foco sobre la zona de la interfaz. Solo avanza cuando pulsas → (o Espacio); ← vuelve, H oculta la barra y Esc sale. A la derecha, el botón **ⓘ**, que abre About. Los menús se cierran con Esc o al pulsar fuera.
* **Mapa 3D:** pasa el ratón por el terreno para ver elevación, pendiente, orientación, si está dentro de la zona quemada y las coordenadas. Haz clic en un evento o en el dron.
* **Layers:** cada capa cambia el render de verdad (opacidad incluida). Ground Truth muestra la máscara manual en azul.
* **Incident Overview / Weather:** datos del incidente y meteo ERA5 a la hora del cursor, con su chip de procedencia. La pestaña Layers cabe entera sin desplazarse.
* **Timeline:** play (al final vuelve a empezar), pausa, evento anterior y siguiente (también con `[` y `]`), velocidad 1–32×, arrastrar y marcadores de evento agrupados. Gráficas: área quemada, **velocidad de propagación del frente visible (m/min)** y **perfil del terreno a lo largo de la parcela** (zona quemada y posición del dron marcadas); cada una se descarga en CSV.
* **Compartir:** copia un enlace con el instante, el modo, el panel y la cámara; quien lo abre ve exactamente lo mismo. Los botones atrás/adelante del navegador recorren los cambios de modo.
* **Key Events:** clic → el tiempo salta, la cámara vuela y se resalta.
* **Drones:** flota de 6. **UAV-01 es el real** (vídeo grabado). FT-02…FT-06 son simulados, con telemetría (altitud, velocidad, rumbo, batería, enlace) y una cámara que renderiza el gemelo 3D desde su posición, en EO o IR* (Ironbow / White-hot). Seleccionar un dron abre su cámara; Follow lo persigue. La ventana de cámara del dron real va al segundo con el timeline: HUD, caja de la región que piden revisar las mediciones, EO/IR* (simulado), zoom, arrastrar y pantalla de mapa completa.
* **Resources (simulado):** KPIs (aeronaves operativas, galones descargados, cadenas de línea, personal), lista por grupos como en FireTrace y ficha de la unidad seleccionada. **Chase** sigue al avión en vuelo, **Ride along** acompaña a vehículos y cuadrillas, y **Overview** da el plano general. Las descargas y la línea de fuego aparecen sobre el terreno según el timeline. El Air Ops Log permite saltar a cada descarga, y las gráficas muestran retardante, línea construida y personal.
* **Analysis (analista):** preguntas en español o inglés; las citas ▶ saltan al vídeo y al mapa.
* **Evidence:** búsqueda en el vídeo (por palabras, en español o inglés, sobre eventos y mediciones de cada clip) + cola de revisión de eventos.
* **About:** cómo se ha obtenido cada parte (real, modelo, derivado, externo, simulado), límites, historia del proyecto, notas del analista y atribuciones.

## 7. Historia: el hackathon

FireScope 3D se construyó en un día en el **VAST Builders Challenge (17 oct 2026)**. Allí se desplegó en el clúster Kubernetes del taller y usaba en directo:

| Herramienta | Para qué la usamos entonces |
|---|---|
| **NVIDIA Cosmos Reason** (`cosmos3-nano-reasoner`) | Describir cada clip de 12 s (qué se ve, qué cambió, dónde revisar) y redactar las respuestas del agente |
| **NVIDIA Cosmos Embed1** | Vectores de vídeo y de texto en el mismo espacio para la búsqueda semántica |
| **YOLO11** (stack VSS) | Personas o vehículos en clips con llamas |
| **VAST Data / VSS** | Búsqueda en el archivo de vídeo del equipo y despliegue en el clúster |
| **Cursor** | Verificación de endpoints y despliegue |

Ese clúster ya no existe y aquellos resultados no se guardaron, así que **la versión pública no los muestra ni los imita**. El analista y la búsqueda actuales son deterministas y se ejecutan en el navegador. Detalles: [historia-hackathon.md](historia-hackathon.md).

## 8. Puntos fuertes

* **Idea:** convertir vídeo en un mapa operativo consultable, con impacto social claro.
* **Implementación técnica:** pipeline reproducible (`python -m firescope.pipeline` en 12 s), **evaluación cuantitativa (IoU)**, tests de backend y 76 comprobaciones E2E en 6 resoluciones (incluidos los 3 modos y 60 fps medidos).
* **Diseño:** réplica del lenguaje visual de FireTrace, con la procedencia de cada dato visible.
* **Honestidad:** cada dato dice si es real, medido, derivado, externo o simulado, y nada se presenta como algo que no es.
* **Accesible:** es una web estática; cualquiera la abre con un enlace, sin instalar nada.
* **Presentación:** botón **Tour**, una visita guiada por capítulos que solo avanza a mano, para usarlo de fondo mientras se habla.

## 9. Guion del pitch (2 minutos, en inglés)

**0:00 — Problem (15 s).** *"During a wildfire, drones record hours of video. But video is stuck in the camera's point of view: nobody can ask it where the fire grew, or when flames jumped the line."*

**0:15 — Solution (15 s).** Pulsa **Tour** (o hazlo a mano). *"FireScope 3D turns drone footage into a time-aware 3D map. This is real terrain, the real drone position, and real footage from a prescribed burn in Portugal."*

**0:30 — Progression (20 s).** Se reproduce el timeline. *"Every 4 seconds we segment the burned ground and the flames, then cast each pixel onto the elevation model, so you see the burn scar grow on the actual ground. Our segmentation scores an IoU of 0.71 against the dataset's manual annotations."*

**0:50 — Evidence (25 s).** Clic en una alerta → Drones. *"Every change is measured and logged. Here: flames ahead of the burned front. One click takes you to the exact second of footage, with the region to review boxed, and a human confirms it."*

**1:15 — Ask & search (25 s).** Analysis → pregunta. *"Ask in English or Spanish: when did it grow fastest? The answer is computed from the measurements, with citations that jump the video and the map. Nothing is invented. Search finds the moments: dense smoke, flames outside the front."*

**1:40 — Trust & impact (20 s).** 2D + Ground Truth, luego About. *"Everything carries its provenance: what is measured, what is modelled and what is simulated. It's a static web page anyone can open. Responders get a georeferenced, searchable picture from footage they already capture."*

## 10. Preguntas probables y respuestas

* **¿Por qué una quema prescrita y no un incendio real?** Es el único dataset público con vídeo de dron estable, máscaras manuales y pose de cámara. Eso nos permite **medir** la precisión, que es lo que da credibilidad. El siguiente paso es un incendio grande reconstruido con satélite ([plan](PLAN_DE_MEJORA.md)).
* **¿Funciona en directo?** La arquitectura sirve para vídeo en directo (los fotogramas entran por la misma vía); hoy se reproduce una grabación y se rotula como *replay*.
* **¿Usáis IA?** La segmentación es un modelo medido contra verdad de campo. El analista no es un LLM: son reglas que calculan la respuesta con los datos y citan la prueba, para que nunca invente. En el hackathon usamos NVIDIA Cosmos en directo; la versión pública solo muestra lo que se puede recalcular.
* **¿Predecís el fuego?** No. El escenario de incendio grande es ilustrativo y está rotulado como no operativo.
* **¿Y la temperatura?** Con RGB no se puede medir. Por eso el IR está rotulado como simulado y los hotspots no llevan °C.
* **¿Los aviones y brigadas son reales?** No. El modo Resources y los drones FT-02…06 son un **ejercicio simulado**, rotulado como tal, para demostrar el flujo de trabajo. Lo real es el vídeo del UAV-01, el terreno, la meteo y todo lo que se deriva del vídeo.

## 11. Decisiones técnicas y trabajo futuro

* **Motor 3D: nos quedamos con Three.js** en lugar de migrar a Cesium o MapLibre. Ya tiene LOD por anillos, depth logarítmico, sombras, bloom e instancing, y medimos **60 fps** reproduciendo a 1440×900. Migrar costaría el control sobre el shader del fuego pegado al terreno.
* **Funciona en cualquier pantalla:** escritorio, tablet (panel deslizante) y móvil (hoja inferior; en horizontal, panel lateral). Carga en menos de un segundo y sigue funcionando sin conexión tras la primera visita.
* **El incendio grande ya está:** Larouco (Ourense, agosto de 2025, 33.132 ha), reconstruido hora a hora con datos abiertos de satélite (NASA FIRMS, Copernicus EMS y Sentinel-2) y validado contra los perímetros de EMS. Se abre con el menú de incidentes o con `?incident=larouco-2025-08`.
* **Lo pendiente**, desde el motor 3D de nueva generación hasta la búsqueda semántica en el navegador, está en el [plan de mejora](PLAN_DE_MEJORA.md).

## 12. Cómo ejecutarlo

```bash
cd frontend && npm install && npm run dev            # demo estática → http://localhost:5173
npm run build                                        # web estática en dist/ (lo que publica GitHub Pages)
node scripts/e2e.mjs '<url>/?nointro'                # 76 comprobaciones E2E (3 modos, 6 resoluciones, FPS)
cd ../backend && python -m pytest -q                 # tests del pipeline y la API
```
