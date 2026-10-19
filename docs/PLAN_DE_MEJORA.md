# FireScope 3D — Auditoría completa y plan de mejora

> Auditado el 17 oct 2026 sobre la rama `firescope-claude` (commit `3077e37`), ya sin acceso a NVIDIA.
> Objetivo nuevo: un proyecto **autocontenido**, publicado en **GitHub Pages desde `main`**, que demuestre toda la funcionalidad sin servidores ni claves.
> Capturas de evidencia: [`docs/auditoria/`](auditoria/). Scripts para repetir la auditoría: [`frontend/scripts/audit/`](../frontend/scripts/audit/README.md).

---

## Estado

| Fase | Estado |
|---|---|
| 0 · Repositorio y publicación | ✅ 17 oct 2026: `main` publica en https://aleetreny.github.io/FireScope-3D/ |
| 1 · Autocontenido y honestidad | ✅ 17 oct 2026: paquetes de incidente con manifest, analista bilingüe en el navegador, búsqueda ES/EN, sin integraciones muertas en la interfaz, README y PITCH reescritos |
| 2 · Arreglos funcionales y visuales | ✅ 18 oct 2026: 0 solapes en 25 estados × 5 tamaños de escritorio (1280–2560), 0 controles sin efecto, estado en la URL y enlaces profundos, menús accesibles, ROS real en m/min y perfil del terreno útil |
| 4 · Rendimiento y carga | ✅ 18 oct 2026: 3D listo en 0,9 s (antes 3,1 s), 5,8 MB por carga completa (antes 13,4 MB), 4G lenta 13 s (antes 72 s); terreno exterior en segundo plano; 30 fps en reposo y resolución adaptativa; selectores y reloj cuantizado en React; lectura de GPU asíncrona; sombras solo cuando algo se mueve; tour y analista bajo demanda; funciona sin conexión tras la primera visita |
| 3 · Responsive, accesibilidad e idioma | ✅ 18 oct 2026: interfaz solo en inglés (el analista sigue entendiendo y respondiendo en español); tres diseños (escritorio, tablet con panel deslizante, móvil con hoja inferior y, en horizontal, panel lateral); la cámara 3D se recentra sobre la parte visible del mapa; HUD del dron, gráficas y créditos que se adaptan a su propio ancho; toque en el terreno; foco visible, timeline como slider con teclado, `prefers-reduced-motion` y resumen para lectores de pantalla. 0 solapes y 0 controles fuera de pantalla en 8 móviles y tablets (`devices.mjs`) y en 25 estados × 5 tamaños de escritorio |
| 5 · El incendio grande (Larouco) | ✅ 18 oct 2026, con lo que queda en la lista de abajo. **Larouco (Ourense, 13–27 ago 2025): 33.132 ha.** Pipeline abierto y reproducible en `pipeline/larouco/`, sin cuentas ni claves: NASA FIRMS VIIRS/MODIS, Copernicus EMS EMSR837 (12 delineaciones fechadas), Sentinel-2 y ERA5. Hora de llegada de cada celda de 30 m, validada apartando cada perímetro EMS (IoU 0,78 / 0,85 / 0,94). Severidad dNBR (70 % alta). Velocidad de expansión, potencia radiativa y 19 eventos calculados. La app es multi-incidente: escala regional en el motor 3D (frente, brasas, humo con viento ERA5, detecciones FIRMS, perímetros fechados, isocronas, severidad), timeline de 14 días, analista y búsqueda propios, y ejercicio SIM que sigue el frente (aviones solo de día). 0 solapes en 8 móviles y tablets y en escritorio |
| 5 · cierre | ✅ 18 oct 2026. **Terreno e imagen empaquetados** (MDT25 y PNOA del IGN/CNIG, horizonte con AWS Terrarium y Sentinel-2 cloudless): Larouco ya no pide nada a servidores de teselas. **Escenario retrospectivo** con combustibles (ESA WorldCover), pendiente (MDT25) y viento y sequedad horarios (ERA5), calibrado solo con el perímetro del 16 ago: IoU 0,25 / 0,24 / 0,24 frente a los perímetros posteriores. Se extiende casi igual en todas direcciones y no reproduce la carrera al norte, y se muestra como tal. **Larouco es el incidente por defecto.** **Meteosat (LSA SAF FRP-PIXEL)** integrado: 1.536 ficheros cada 15 min, potencia del fuego cada 15 min (pico de 14 GW el 16 ago a las 19:00 UTC) y horas de llegada reajustadas entre pasadas polares. El IoU no cambia, porque los perímetros diarios no miden la hora. GOFER se sustituyó por la validación con los perímetros EMS. Zoom temporal y día/noche pasan a la fase 6 |
| 6 · Motor 3D | ✅ 18 oct 2026, con lo hecho y con una decisión. **Hecho:**<br>· **Luz:** sol real por lugar y hora (y por tanto noche, crepúsculo y luna). De noche el borde del fuego brilla y el humo se ilumina desde abajo.<br>· **Tiempo:** zoom temporal en timeline y gráficas, con las noches sombreadas.<br>· **Terreno:** el horizonte se iguala en color con el PNOA y no se ven costuras; la niebla se aclara con la altura.<br>· **Vegetación:** WorldCover instanciada; se carboniza cuando llega el fuego.<br>· **Frente:** bordes orgánicos en lugar de celdas; las brasas son ahora sutiles.<br>· **Aeronaves:** modelos low-poly decentes.<br>· **Calidad:** adaptativa hasta 0,6× de resolución y sin bloom.<br>· **Rendimiento:** de 230 a 496 fps sin límite a 1080p en un M-series. Una integrada típica, 6–8× más lenta, quedaría en unos 30 fps, con la calidad adaptativa como red.<br>**Decisión:** no migramos a WebGPURenderer/TSL. Todo el motor son shaders GLSL inyectados (`onBeforeCompile`); reescribirlo sería mucho riesgo sin ganancia visible, porque ya va a 60 fps con margen. Queda como opción cuando WebGPU sea universal. Tampoco usamos glTF: no hay modelos con licencia, así que las aeronaves son procedurales |
| 7 · IA en el navegador | ✅ 18 oct 2026. Todo opcional y en el dispositivo; nada se sube.<br>· **Segmentación de Pinhão:** red LR-ASPP MobileNetV3 afinada con las máscaras del dataset (en vez de SegFormer o SAM 2.1, por ser 3,2 M parámetros y correr en tiempo real en el navegador). **IoU 0,94** en el *test split* que nunca vio; el pipeline grabado da **0,92 en imagen y 0,90 sobre el terreno** en fotogramas apartados (antes 0,68 / 0,71).<br>· **Búsqueda visual** con MobileCLIP-S0 (transformers.js), ES/EN: fotogramas del dron cada 2 s y, en Larouco, **las 6 pasadas de Sentinel-2 durante el incendio**, que además son una capa nueva del mapa («Sentinel-2 on the Day»). 52 MB servidos desde la propia web. «humo denso» → coincidencia clara; «helicóptero» → **«no clear match»**, porque no hay ninguno en el vídeo (el criterio original pedía clips para «helicóptero»: no se fuerza).<br>· **Análisis en directo** sobre el vídeo y sobre un vídeo local: 44 fps con WebGPU; **IoU 0,98 frente al pipeline grabado** (criterio ≥ 0,9).<br>· **LLM local: descartado** a petición tuya. El analista sigue siendo por reglas, sin modelo de lenguaje.<br>· **Georreferenciación:** el RMSE **no se pudo medir** (sin puntos de control; la ortofoto DGT 2018 no casa con la vista oblicua y con humo). Se documenta en lugar de inventar una cifra |
| 8 · Presentación y documentación | ✅ 19 oct 2026. Sin vídeo promocional nuevo (decisión tuya).<br>· **Tour para Larouco** (16 capítulos: problema, el fuego hora a hora, Sentinel-2 del día, perímetros, gráficas, la carrera nocturna, severidad, eventos, analista, búsqueda, escenario, ejercicio, límites) y Pinhão renovado (20: con Live AI y límites). Cada tour termina ofreciendo el del otro incidente (`?tour`).<br>· **Página de métodos y fuentes** (`methods.html`): procedencia, cada método con su validación, IA en el navegador, cómo reproducirlo y todas las fuentes con su licencia. Enlazada desde About y el README.<br>· **Repo:** README nuevo con capturas, licencia MIT, tests de los pipelines y CI de tests. Se eliminan el backend FastAPI con los adaptadores NVIDIA (el pipeline de Pinhão pasa a `pipeline/pinhao/replay.py`), el modo API del frontend, `config.js`, `run.sh` y los guiones del vídeo del hackathon. Lint sin avisos. Ramas `firescope-claude` y `frontend` (ya estaban en `main`) y `shift-file` borradas: solo queda `main` |

## 0. Resumen ejecutivo

**Lo que ya funciona bien (hay que conservarlo):**
- El timeline es el único reloj. Mapa, vídeo, gráficas y paneles se mueven juntos y la sincronización del vídeo es exacta.
- Cada dato lleva su chip de procedencia. La segmentación está evaluada contra máscaras manuales (IoU 0,68 en imagen y 0,71 sobre el terreno en la auditoría; 0,92 y 0,90 tras la fase 7).
- El motor 3D propio: terreno por anillos de detalle, sombreador de máscaras, llamas con bloom, gestión de colisiones de etiquetas y cámaras simuladas de dron que renderizan el gemelo 3D.
- El modo presentación, con 18 capítulos que solo avanzan a mano.
- 0 excepciones de JavaScript en 362 clics y 25 estados distintos, y 60 fps en un M5 Pro incluso con un lienzo de 4384×2256.

**Lo que falla o deja de tener sentido sin NVIDIA:**
1. **Todo lo que dependía de NVIDIA está muerto o engaña.**
   - «Run Cosmos analysis» devuelve un 503.
   - El panel de integraciones muestra 5 servicios «not configured» junto a un chip «LIVE».
   - El agente lleva etiquetas «Cosmos Reason / Cosmos Embed» aunque la respuesta es extractiva.
   - El cierre de la presentación cita a NVIDIA, VAST, CoreWeave y W&B como si funcionaran.
2. **El agente responde lo mismo a cualquier pregunta.** «¿Dónde está el dron?», «What was the wind?» o «Is anyone in danger?» devuelven el mismo resumen del área quemada. La búsqueda es léxica: «helicopter» o «humo» dan 0 resultados.
3. **En móvil y tablet no se puede usar.** A 390 px el mapa mide 136 px de ancho, hay 413 controles fuera de pantalla y 443 solapes de texto. En GitHub Pages mucha gente lo abrirá en el móvil.
4. **La carga es pesada.**
   - Son 17,3 MB y 358 peticiones en frío.
   - En 4G lenta tarda 92 s hasta ver el 3D.
   - `observations.json` pesa 3,4 MB y se sirve sin comprimir.
   - El vídeo servido pesa 113 MB, por encima del límite de 100 MB por archivo de GitHub.
5. **La escala del incendio no da para la historia.** El dron ve 2.337 m² (0,23 ha). Contra eso hay un DC-10 de 9.400 galones, 25.000 galones lanzados, 70 personas y un escenario de 194 ha que, al activarse, oscurece toda la vista sin encuadrarse. Hace falta un incendio grande de verdad.
6. **Quedan solapes visuales en escritorio.**
   - El vídeo flotante tapa las etiquetas del mapa.
   - Las etiquetas se montan sobre la atribución y la escala.
   - El tooltip de terreno queda por debajo de las etiquetas.
   - Los ejes de las gráficas chocan entre sí.
   - Los títulos de eventos salen truncados a todas las anchuras.
   - El detalle de la unidad seleccionada en Recursos queda fuera de la vista.
7. **Hay botones que parecen botones y no hacen nada:** el selector de incidente (▾), «Edit», «⋮» en cada gráfica y el engranaje, que en realidad abre Notas. Compartir copia la URL sin avisar y sin guardar el estado, y no existen enlaces profundos.
8. **Rendimiento en equipos modestos.**
   - React re-renderiza toda la interfaz 60 veces por segundo mientras reproduce, y 10 veces por segundo en reposo.
   - El 3D se dibuja sin parar aunque nada cambie: el hilo principal está ocupado 121 ms por segundo sin hacer nada en un M5 Pro.
   - La cámara simulada lee la GPU de forma síncrona 10 veces por segundo.

**Las tres grandes decisiones del plan:**
- **A.** Publicación estática en GitHub Pages desde `main`, con los datos precalculados y la IA ejecutada en local una vez (resultados grabados y etiquetados) o en el propio navegador.
- **B.** Añadir un **incendio grande real**. Recomiendo el **incendio de Larouco (Ourense, agosto 2025, unas 37.800 ha)**, reconstruido con datos abiertos de satélite y cartografía oficial. Pinhão se queda como «caso de dron de cerca». Ver la sección 4.
- **C.** Una nueva generación del motor 3D y de la interfaz: responsive, bilingüe, accesible, rápida y con renderizado bajo demanda.

---

## 1. Cómo se ha hecho la auditoría

| Prueba | Alcance | Resultado |
|---|---|---|
| Barrido de estados | 25 estados × 8 viewports (2560, 1920, 1440@2x, 1366, 1280, 1024, tablet 768, móvil 390@3x) = 200 capturas con detector automático de solapes, recortes y controles fuera de pantalla | Solapes en todos los tamaños. Roto en tablet y móvil |
| Clic en todo | 362 clics en 8 estados (Incident × 4 pestañas, Drones real/simulado, Resources aire/tierra) | 0 excepciones JS. 1 botón roto (503). El resto tiene efecto |
| Comprobaciones dirigidas | Menús, Esc, clic fuera, compartir, enlaces profundos, teclado, foco, agente (4 preguntas), búsqueda (4 consultas), comparar, final de reproducción, redimensionado, pérdida de contexto WebGL | 14 fallos de comportamiento (sección 3.A) |
| Rendimiento | Carga en frío, carga en 4G lenta, FPS en 7 estados, FPS a 2× DPR, móvil con CPU ×4, coste de hilo principal | Sección 3.D |
| Revisión de código | Todos los componentes, la escena, el estado y el backend | Deuda en la sección 3.F |

---

## 2. Qué pasa con cada función ahora que no hay NVIDIA

| Función | Durante el hackathon | Hoy, sin NVIDIA | Propuesta autocontenida |
|---|---|---|---|
| Descripciones de clips (Cosmos Reason) | VLM en directo sobre clips de 12 s | No hay ninguna grabada. La web pública ya no existe (el dominio no resuelve), así que no se pueden recuperar | Ejecutar **una vez, en el Mac**, un VLM abierto (Qwen2.5-VL 7B o similar con MLX) sobre los clips. Guardar el resultado con modelo, fecha y prompt, y mostrarlo como «salida grabada de *modelo X*» |
| Búsqueda semántica (Cosmos Embed) | Vectores de vídeo y texto en el servidor | Fallback léxico: «humo» o «helicopter» dan 0 resultados | Vectores de imagen **SigLIP 2 / MobileCLIP** precalculados por clip. La consulta se codifica **en el navegador** con transformers.js (WebGPU o WASM). Búsqueda semántica real sin servidor y en español |
| Agente (LLM NIM) | Respuestas con citas `[n]` | El mismo resumen para cualquier pregunta | (1) Por defecto, un **«analista del incidente» determinista** que detecta la intención (dónde, cuándo, cuánto, viento, riesgo, dron, recursos) y responde con datos y citas en ES/EN. (2) Opcional, un **LLM local en el navegador** (WebLLM, modelo de 1–3 B) con el botón «Activar IA local» y aviso del tamaño de descarga |
| Archivo VSS / VAST | Búsqueda en otros vídeos | Muerto | Quitarlo, o sustituirlo por búsqueda entre **nuestros propios incidentes** cuando haya varios |
| YOLO11 | Detector auxiliar | Muerto, y además no detecta fuego | Quitarlo |
| Botón «Run Cosmos analysis» | Lanza el trabajo en la GPU | Error 503 | Pasa a ser **«Analizar en directo en el navegador»**: la segmentación HSV ejecutada como sombreador WebGL sobre el vídeo mientras se reproduce, comparada en vivo con el pipeline grabado |
| Panel «Sponsor Integrations» | Estado de los servicios | 5 «not configured» bajo «LIVE» | Pasa a ser **«Cómo está hecho»**: métodos, modelos, versiones y fechas. Lo usado en el hackathon con NVIDIA queda como historia, contado con honestidad |
| Meteorología | Open-Meteo vía backend | Funciona porque está cacheada | JSON estático precalculado (ERA5 horario) |
| Terreno e imagen | AWS Terrarium y Esri en tiempo de ejecución | Funciona, pero depende de terceros | Teselas del incidente **empaquetadas en PMTiles**, con licencias que permiten redistribuir (sección 9) |

---

## 3. Hallazgos

Severidad: **P0** bloquea o engaña · **P1** se nota mucho · **P2** pulido · **P3** menor.

### 3.A Funcionales: botones y comportamiento

| ID | Sev. | Hallazgo | Evidencia |
|---|---|---|---|
| F-01 | P0 | «Run Cosmos analysis» (Drones → Video Intelligence) devuelve **503** | Barrido de clics |
| F-02 | P0 | El agente da **la misma respuesta extractiva a cualquier pregunta** y no entiende español | `targeted.mjs`, captura [02](auditoria/02_agente_extractivo_1920.jpg) |
| F-03 | P1 | Búsqueda solo léxica: «helicopter» y «humo» → 0 resultados. Los dos resultados de «dense smoke» tienen el mismo texto | `targeted.mjs` |
| F-04 | P1 | El selector de incidente (**«Pinhão Cell Burn ▾»**) tiene chevron y no hace nada | Código y cursor `auto` |
| F-05 | P1 | «**Edit**» en Incident Overview y «**⋮**» en cada gráfica son decorativos | Código |
| F-06 | P1 | **Compartir** copia `?nointro` sin avisar y sin modo, tiempo ni cámara. No hay enlaces profundos (`?t=600&mode=drones` se ignora) ni historial del navegador | `targeted.mjs` |
| F-07 | P1 | **Escenario de fuego** desde la pestaña Layers: no encuadra la cámara, el suelo visible se vuelve negro y el banner dice «194 ha» sin contexto. Las horas del escenario avanzan con un reloj de 15 min, lo que confunde | Captura [04](auditoria/04_escenario_sin_encuadre.jpg) |
| F-08 | P1 | En **Recursos**, el detalle de la unidad y los botones Chase / Ride along quedan **bajo el pliegue**, debajo de 13 filas. Al seleccionar no se hace scroll | Captura [07](auditoria/07_detalle_unidad_bajo_el_pliegue.jpg) |
| F-09 | P1 | Al seleccionar un dron simulado (FT-0x), la cámara vuela a él y **el fuego queda fuera de la vista principal** | Captura [05](auditoria/05_dron_sim_fuego_fuera_de_vista.jpg) |
| F-10 | P2 | Menús: View/Analysis **no se cierran con Esc**. El menú de velocidad **no se cierra al pulsar fuera** | `targeted.mjs` |
| F-11 | P2 | **Esc no sale** de la vista de cámara a pantalla completa | `targeted.mjs` |
| F-12 | P2 | **Play al final no hace nada**: debería reiniciar desde el principio | `targeted.mjs` |
| F-13 | P2 | La cámara simulada **no se puede arrastrar ni tiene zoom**, a diferencia de la real | `targeted.mjs` |
| F-14 | P2 | «Full camera view» en un dron simulado solo muestra u oculta el PiP: la etiqueta no coincide con lo que hace | Código |
| F-15 | P2 | Hay «Next event» pero no «Previous event». Faltan atajos para saltar entre eventos | Código |
| F-16 | P2 | El engranaje lleva a **Notas**, no a ajustes. No tiene título ni aria-label | `targeted.mjs` |
| F-17 | P2 | El tooltip de «Present» dice «Space pause», pero ahora Espacio avanza | Código |
| F-18 | P2 | «Drone Fleet 6 of 6 airborne · ● REPLAY» mezcla real y simulado en el mismo contador | Captura [05](auditoria/05_dron_sim_fuego_fuera_de_vista.jpg) |
| F-19 | P2 | La **barra de escala** se calcula a la distancia del objetivo. En vistas oblicuas o alejadas no coincide con la huella del dron (a 0,77× la huella de unos 80 m mide unos 60 px y la barra marca 10 m ≈ 45 px). Hay que verificarla | Captura del barrido |
| F-20 | P3 | El modo `alerts` y `AlertsPanel.tsx` existen pero no son accesibles desde la interfaz (código muerto) | Código |
| F-21 | P3 | Los contadores «Drones 6» y «Resources 13» están fijados a mano en el código | Código |
| F-22 | P3 | El script `present-shots.mjs` está desfasado: usa Espacio como pausa y se salta capítulos | Ejecución |
| F-23 | P3 | La API de subida de vídeo existe pero no tiene interfaz. En la versión estática se convertiría en «Abrir un vídeo local» y su análisis en el navegador | Código |

### 3.B Visuales: solapes, recortes y responsive

| ID | Sev. | Hallazgo | Dónde |
|---|---|---|---|
| V-01 | P0 | **Móvil y tablet rotos**: panel derecho a todo el ancho, mapa de 136 px, top bar cortado, gráficas ilegibles, la portada de la presentación desborda | Capturas [10](auditoria/10_movil_390.jpg) y [11](auditoria/11_tablet_768.jpg) |
| V-02 | P1 | El **PiP del dron tapa etiquetas y el propio incendio**. La gestión de colisiones de etiquetas no tiene en cuenta el PiP | 1280–1920, captura [08](auditoria/08_pip_tapa_etiquetas_1280.jpg) |
| V-03 | P1 | Etiquetas del mapa (UAV-01, «Summit 854 m») **encima de la atribución y la barra de escala** | Drones y Recursos |
| V-04 | P1 | El **tooltip de terreno** queda **por debajo** de las etiquetas de eventos (z-index) | Captura 22 del barrido |
| V-05 | P1 | **Títulos de Key Events truncados** a todas las anchuras («Flames ahead of the burne…»). Lo mismo en Air Ops Log y en el nombre del dron del PiP en modo IR | Todas |
| V-06 | P1 | **Pines de eventos apilados** en el mismo punto (varios marcadores circulares superpuestos) y etiquetas de hora tapadas por llamas o por la estela | Captura [01](auditoria/01_vista_inicial_1920.jpg) |
| V-07 | P2 | Ejes de las gráficas: el «0» del eje Y choca con la primera hora del eje X, y «730» con «0 m» en el perfil | Todas |
| V-08 | P2 | Comparar: las burbujas «Before» y la actual se solapan cuando están cerca | Captura 11 del barrido |
| V-09 | P2 | La atribución pisa la barra de escala a 1280 px | Captura [08](auditoria/08_pip_tapa_etiquetas_1280.jpg) |
| V-10 | P2 | **Líneas del cono de visión** del dron, que está fuera de cuadro, cruzan la vista inicial en diagonal como cables sueltos | Captura [01](auditoria/01_vista_inicial_1920.jpg) |
| V-11 | P2 | **Árboles**: conos low-poly gigantes respecto a la escala de 10 m. Muy «de juguete» | Todas |
| V-12 | P2 | El suelo se ve **arena borrosa** con la imagen aérea al 18 %. A distancia media parece una duna | Todas |
| V-13 | P2 | El avión de Chase es un modelo de cajas | Captura [07](auditoria/07_detalle_unidad_bajo_el_pliegue.jpg) |
| V-14 | P2 | Botones minúsculos: «−/+» del PiP de 7×14 px, iconos de 13×16 px y controles del mapa de 23 px de alto | Detector |
| V-15 | P3 | «from SW (217°)» en Weather salta a dos líneas | 1920 |
| V-16 | P3 | La barra del presentador pisa las etiquetas del eje de la gráfica de abajo (aceptable, pero mejorable) | Presentación |
| V-17 | P3 | A 1366 px el top bar oculta ubicación y fecha (está diseñado así, pero se pierde contexto) | Captura [09](auditoria/09_portatil_1366.jpg) |

### 3.C Retórica, coherencia y honestidad

| ID | Sev. | Hallazgo | Propuesta |
|---|---|---|---|
| R-01 | P0 | La interfaz y los documentos siguen prometiendo NVIDIA, VAST, CoreWeave y W&B: Notas, agente, Drones, capítulos 12–14 y 18 de la presentación, README, PITCH y HANDOFF | Reescribir: «hecho en el VAST Builders Challenge con NVIDIA Cosmos; esta demo pública usa resultados grabados y modelos abiertos» |
| R-02 | P0 | El chip «BACKEND CONNECTED / DEV FIXTURES» no tiene sentido en estático. Los fixtures dicen «FIXTURE TEXT» | Chip único «Demo estática · datos grabados el *fecha*». Borrar los fixtures |
| R-03 | P1 | **«Rate of Spread» mide crecimiento de área (m²/min)**. En ciencia del fuego el ROS es velocidad lineal del frente (m/min) | Renombrar a «Crecimiento de área» y calcular el ROS de verdad: desplazamiento normal del frente entre isocronas |
| R-04 | P1 | **Recursos fuera de escala** para 0,23 ha (VLAT, 25.000 gal, 70 personas) | Recursos solo en el incendio grande y dimensionados con criterio (sección 4). En Pinhão: 1 dron real y, como mucho, la cuadrilla de quema prescrita |
| R-05 | P1 | «Elevation Profile (drone line of sight)» varía 8 m en 160 m: no aporta nada | Perfil **a través del frente** o **pendiente frente a velocidad de propagación** |
| R-06 | P1 | El escenario «NOT A FORECAST» usa un combustible con ruido ilustrativo | Modelo de propagación con combustibles y viento reales, **validado contra la progresión real** (retrospectiva con métrica) |
| R-07 | P2 | La jerga técnica sale tal cual en la interfaz («extractive fallback · retrieval: lexical fallback over Cosmos captions…», «camera model dem») | Lenguaje claro en la interfaz y el detalle técnico en un tooltip |
| R-08 | P2 | Solo en inglés. El pitch es en español | i18n ES/EN con un selector |
| R-09 | P2 | Pie de foto y descripción pegados sin separador en los resultados («Dense smoke over view Low-saturation…») | Separar título y descripción |
| R-10 | P2 | La vista inicial no explica nada: fuego pequeño, cables, árboles enormes | Arrancar con **portada y encuadre de contexto** (km) y bajar al detalle, como en la presentación |
| R-11 | P3 | «Hotspots: RGB flame, no temp.» es correcto pero críptico | Tooltip: «llama visible en RGB; sin temperatura» |

### 3.D Rendimiento y carga

Medido en un MacBook M5 Pro, Chrome, con el backend local.

| Métrica | Hoy | Objetivo |
|---|---|---|
| Transferencia en frío | **17,3 MB** en 358 peticiones (DEM 8,7 MB en 77 teselas · imagen 3,9 MB en 264 teselas · JSON 3,6 MB · JS 0,9 MB) | **≤ 4 MB** para el primer 3D interactivo y el resto en segundo plano |
| Datos listos (rápido / 4G lenta) | 0,37 s / **24 s** | 0,3 s / 3 s |
| 3D listo (rápido / 4G lenta) | 3,5 s / **92 s** | 1,5 s / ≤ 8 s con baja resolución primero |
| `observations.json` | 3,4 MB sin comprimir (gzip → 0,42 MB) | ≤ 150 KB (cuantizado y binario) |
| Vídeo | 113 MB a 1280×720 (no cabe en Pages) | ≤ 60 MB en H.264 con faststart, o HLS por segmentos y AV1 con alternativa |
| Hilo principal en reposo | **121 ms/s** (React se repinta 10 veces por segundo por `cam` y el 3D dibuja sin parar) | < 10 ms/s con render bajo demanda |
| Hilo principal reproduciendo / cámara simulada | 164 / 244 ms/s | < 60 / < 90 ms/s |
| FPS | 60 en todos los estados (M5 Pro, incluso 4384×2256) | ≥ 30 en GPU integrada a 1080p con calidad adaptativa |

**Causas encontradas:**
- Todos los componentes usan `useStore()` sin selector, así que cada `time` o `cam` re-renderiza la interfaz entera.
- `onCamera` se emite cada 100 ms aunque la cámara no se mueva.
- `readRenderTargetPixels` es síncrono cada 100 ms en la cámara simulada.
- `getImageData` sin `willReadFrequently` (avisa la consola).
- El anillo de horizonte z11 descarga 138 KB por tesela.
- La pantalla de carga espera a que terminen todos los anillos.
- Sombras PCFSoft, bloom y depth logarítmico sin calidad adaptativa.

### 3.E Accesibilidad

- No hay `aria-label` en los botones de icono (engranaje, enviar, compás, cerrar o zoom del PiP).
- Las casillas y los deslizadores de capas no tienen etiqueta.
- No hay `prefers-reduced-motion`: los vuelos de cámara y la intro siempre animan.
- El foco existe (contorno del navegador) pero no tiene diseño propio. El mapa no se puede usar con teclado más allá de los atajos.
- No hay un resumen textual del incidente para lectores de pantalla.
- Hay que revisar el contraste de los textos grises (`muted`) sobre el beige.

### 3.F Código y repositorio

- `main` solo tiene un README vacío y `firescope-claude` va 23 commits por delante, así que un **fast-forward es limpio**.
- Sobran: `firescope-deploy/` (paquete K8s de 2,3 MB comprometido), `deploy/`, HANDOFF, `backend/firescope/nvidia.py`, `cosmos_job.py`, `tests/mock_gpu.py`, `public/fixtures/` y las rutas VSS. La rama `frontend` está obsoleta.
- `FireScene.ts` tiene 1.399 líneas. Conviene dividirla en terreno, superposiciones, unidades, etiquetas, escenario y cámara.
- Hay una expresión sin efecto en `TopBar` (`view: … ? view : view`) y valores fijados a mano (contadores, «Pinhão»).
- Las pruebas son scripts `.mjs` sueltos. Faltan `@playwright/test` con capturas de referencia, CI, pruebas unitarias de `sim/` y `format`, y un control de tamaño de bundle.
- Se pueden actualizar dependencias: three r170 → la actual (WebGPURenderer y TSL), Vite 6 → 7, TypeScript 5.9.
- `README.md` describe una arquitectura de servidor que ya no aplica.

---

## 4. Un incendio grande de verdad

### 4.1 Lo que he encontrado (sin adornos)

**No existe, que yo haya encontrado, un dataset público con imágenes de varios drones sobre un incendio forestal grande, con telemetría y licencia que permita usarlas.**
- Los datasets reales de dron son de **quemas prescritas pequeñas**: BurnedAreaUAV (el nuestro), FLAME 1/2/3 (Arizona, Oregón y Florida; FLAME 3 trae térmico radiométrico georreferenciado cada 3–5 s), FireMan-UAV-RGBT y Boreal Forest Fire (Finlandia).
- Los vídeos de dron de incendios reales que circulan (UME, bomberos, medios, YouTube) tienen derechos y no traen telemetría.

Sí existe material abierto y riguroso para reconstruir **cómo se expandió un incendio grande entero**:

| Fuente | Qué da | Resolución | Licencia |
|---|---|---|---|
| NASA FIRMS (VIIRS 375 m, MODIS 1 km) | Detecciones de fuego activo con hora y FRP | 4–6 pasadas al día | Abierta |
| EUMETSAT LSA SAF FRP-PIXEL (Meteosat) | Detecciones **cada 15 min** con FRP | Unos 3–4 km en España | Abierta, con cita |
| Copernicus EMS Rapid Mapping (p. ej. **EMSR837**, «Wildfires in West Spain», agosto 2025, 17 áreas y 69 productos) | Perímetros de delimitación y grado de daño a partir de imagen de muy alta resolución | Métrica | Abierta, con atribución |
| Sentinel-2 L2A | Imagen antes y después, dNBR y severidad | 10–20 m, cada 5 días | Abierta |
| EFFIS | Perímetro final y área | — | Abierta |
| IGN/CNIG **PNOA** (ortofoto) y **MDT05** (LiDAR) | Imagen y terreno de España de alta calidad | 25 cm / 5 m | **CC BY 4.0 (redistribuible)** |
| ERA5 / ERA5-Land | Viento, temperatura, humedad y humedad del suelo horarios | 9–25 km | Abierta |
| Algoritmos ya publicados para progresión: **FEDS / fireatlas** (NASA, perímetros cada 12 h desde VIIRS, código abierto), **GOFER** (perímetros **horarios** desde GOES, 28 incendios de California 2019–21, en Zenodo) y **PT-FireSprd** (80 grandes incendios de Portugal 2015–21 con ROS) | Isocronas listas o un método reproducible | — | Abiertas |

### 4.2 Opciones

| Opción | Tamaño | Progresión real | Terreno 3D | Relevancia | Esfuerzo |
|---|---|---|---|---|---|
| **Larouco (Ourense), 13–~25 ago 2025** | **unas 37.800 ha** (cifra de prensa; hay que confirmarla con EFFIS) | Muy buena: más de 10 días × varias pasadas VIIRS, Meteosat cada 15 min, EMS EMSR837 y Sentinel-2 | Excelente: macizo central ourensano, con PNOA y MDT05 | Máxima: récord en España y cercano a nosotros | Alto: hay que ejecutar el pipeline nosotros |
| **Tres Cantos (Madrid), 11–12 ago 2025** | Unas 1.500 ha (provisional) | Pobre: arde una noche y solo hay 2–4 pasadas VIIRS y Meteosat de 3–4 km. Muy buena cicatriz final con Sentinel-2 | Suave (monte de El Pardo) | Alta para el público de Madrid. **Hubo un fallecido**: hay que tratarlo con cuidado | Medio |
| **Jarilla (Cáceres), ago 2025** | Unas 17.300 ha | Buena | Muy buena (Gredos / Jerte) | Alta | Alto |
| **Un incendio de GOFER** (p. ej. Caldor 2021 o Creek 2020, California) | 89.000–154.000 ha | **Excelente y ya hecha** (perímetros horarios, línea activa y velocidades) | Excelente (USGS 3DEP y NAIP, de dominio público) | Media para el pitch en español | **Bajo** |
| **RxCADRE 2012** (Eglin, Florida) | Bloques de cientos de ha | **IR aerotransportado real cada 3 s**, calibrado y ortorrectificado. Dominio público | Plano | Científica (validación) | Medio |

### 4.3 Recomendación

1. **Caso principal: Larouco 2025.** Pipeline propio, abierto y reproducible:
   - FIRMS, LSA SAF y EMS EMSR837 → isocronas de llegada (método FEDS/fireatlas adaptado y suavizado con Meteosat).
   - Sentinel-2 → severidad (dNBR).
   - PNOA y MDT05 → gemelo 3D.
   - ERA5 → viento.
   - Velocidad de propagación real (m/min) a lo largo del frente.
2. **Validación del pipeline:** ejecutarlo también sobre **un incendio de GOFER** y medir el IoU frente a sus perímetros horarios. Así la reconstrucción de Larouco tiene una cifra de calidad, como el IoU 0,71 de Pinhão.
3. **Pinhão se queda** como «caso de dron de cerca»: el único con vídeo real, máscaras de verdad de terreno e IoU medido.
4. **Drones sobre el incendio grande:** flota **simulada, etiquetada SIM**, cuya cámara renderiza el gemelo 3D del incendio real reconstruido. Ahora sí es coherente en escala, con órbitas sobre el frente activo, relés y cartografía nocturna.
   - Si queremos vídeo real de dron de Larouco, el camino es **pedir permiso** a la Xunta, a la UME o a los medios. No se pueden usar sin licencia.
5. **Opcional:** un modo «IR real» con **FLAME 3** (térmico radiométrico de dron), para tener temperatura de verdad y dejar de ser solo una paleta sobre RGB.
6. **Tres Cantos**, si queréis el caso de Madrid: como tercer incidente centrado en la **cicatriz y la severidad** y en la cronología nocturna aproximada, dejando clara la incertidumbre.

La app pasa a ser **multi-incidente**: el selector «▾» del top bar deja de ser decorativo.

---

## 5. Tecnologías mejores, capa por capa

### 5.1 Datos y pipeline (Python, se ejecuta una vez y publica estáticos)
- **Formato «paquete de incidente»**: un `manifest.json` y archivos versionados:
  - Isocronas y perímetros en **FlatGeobuf o GeoJSON cuantizado**.
  - Rásteres (severidad, combustible, llegada) en **COG/PNG con cuantización**.
  - Teselas DEM e imagen en **PMTiles**.
  - Vídeo en MP4 con faststart o HLS.
  - Vectores de búsqueda en `Float16Array` binario.
- **Progresión**: fireatlas (FEDS) adaptado a España, más LSA SAF FRP-PIXEL para la cadencia de 15 min, más un tiempo de llegada interpolado (kriging o fast-marching) restringido por los perímetros de EMS y Sentinel-2.
- **Segmentación de vídeo** (Pinhão): pasar de HSV a **SAM 2.1 con propagación en vídeo** o una **SegFormer afinada** con las máscaras de entrenamiento del propio dataset. Se reporta el IoU en el *test split* (el objetivo es superar 0,80).
- **Georreferenciación**: afinar la pose con emparejamiento de rasgos frente a la ortofoto PNOA/Esri (LightGlue + homografía) y dar un **RMSE en metros**, porque hoy es «approximate» sin cifra.
- **Descripción de clips**: VLM abierto (familia Qwen2.5-VL / Qwen3-VL o similar) con **MLX en el Mac**. Se guardan prompt, modelo, hash y fecha.
- **Combustibles y viento para el escenario**: Mapa Forestal de España / modelos de combustible (o CORINE / ESA WorldCover como respaldo), viento ERA5 reducido con **WindNinja** sobre MDT.

### 5.2 IA sin servidor
- **transformers.js (WebGPU/WASM)** para la consulta de texto de SigLIP 2 o MobileCLIP. El modelo se descarga una sola vez y se cachea.
- **WebLLM** (opcional): LLM de 1–3 B en el navegador para preguntas libres, con RAG sobre los eventos del incidente y citas.
- **Análisis en directo**: sombreador WebGL o WebGPU que segmenta llama, humo y quemado sobre `<video>` en tiempo real.
- **Agente determinista bilingüe** como base, para que nunca dependa de la descarga de modelos.

### 5.3 Motor 3D
- **three.js actualizado con WebGPURenderer (TSL)** y WebGL2 como respaldo. Se mantiene nuestro motor propio, que es lo que nos diferencia.
- **Terreno**: quadtree CDLOD con mallas RTIN (Martini/Delatin) por tesela, o 3DTilesRendererJS con quantized-mesh. Así se pasa sin saltos de una escala de 30 m (Pinhão) a 40 km (Larouco).
- **Atmósfera y luz real**: posición solar por hora del incidente (suncalc), dispersión atmosférica (p. ej. `@takram/three-atmosphere`), **noche** con brillo del frente (Tres Cantos ardió de noche) y sombras de la columna de humo.
- **Fuego a gran escala**: cinta del frente activo con emisión por FRP, **columna de humo volumétrica** (raymarching de ruido) orientada con el viento ERA5, pavesas y focos secundarios. **Isocronas** animadas como «anillos de árbol».
- **Vegetación real**: altura de copa (Meta/WRI 1 m o ETH 10 m) y cobertura (ESA WorldCover 10 m), con instancias de árbol con impostores octaédricos en lugar de conos.
- **Post-proceso**: SMAA o TAA, AO (N8AO) y bloom selectivo. **Calidad adaptativa**: DPR y sombras según el tiempo de frame.
- **Render bajo demanda**: dibujar solo si cambia la cámara, el tiempo o una capa.
- **Cámara de dron simulada**: render a un segundo *viewport* o canvas (`setScissor` o un segundo renderer) **sin leer píxeles de la GPU**.
- **Etiquetas**: reserva de zonas de pantalla (PiP, controles, atribución) en el gestor de colisiones, agrupación de pines cercanos y prioridad por severidad.

### 5.4 Interfaz
- **Responsive real**:
  - Escritorio igual que ahora.
  - Tablet con panel lateral plegable.
  - Móvil con mapa a pantalla completa, **hoja inferior** deslizante (capas, eventos, gráficas), timeline compacto y PiP arrastrable o minimizable.
- **Estado en la URL** (`?incident=larouco&t=…&mode=…&cam=…`): compartir con aviso «Enlace copiado», historial del navegador y enlaces profundos para el pitch.
- **i18n ES/EN** con un diccionario propio, sin dependencias pesadas.
- **Zustand con selectores** (`useStore(s => s.x)` y `useShallow`) y aislamiento de lo que cambia 60 veces por segundo (timeline, burbuja, HUD).
- **Code-splitting**: presentador, agente, gráficas y modelos de IA bajo demanda.
- **PWA** (vite-plugin-pwa): funciona sin conexión tras la primera visita, para presentar sin WiFi.
- Componentes: menús accesibles (Esc, clic fuera, foco atrapado) y tooltips de verdad.

### 5.5 Calidad, CI y publicación
- **GitHub Actions**: lint, `tsc`, pruebas unitarias (Vitest), **Playwright** con **capturas de referencia** en 6 viewports, **axe-core** para accesibilidad, **Lighthouse CI** con presupuesto de bytes y tiempos, build y **deploy a Pages** (`actions/deploy-pages`).
- Los scripts de esta auditoría (`frontend/scripts/audit/`) pasan a ser pruebas del CI: solapes = 0 en los viewports soportados.

---

## 6. Arquitectura objetivo

```
 OFFLINE (Mac, una vez por incidente)                 GITHUB PAGES (estático)
 ┌───────────────────────────────────────┐          ┌──────────────────────────────────────┐
 │ pipeline/ (Python)                     │          │ /index.html  /assets/*.js            │
 │  · Pinhão: vídeo → SAM2/SegFormer →    │  build   │ /incidents/<id>/manifest.json        │
 │    máscaras → georref → polígonos      │ ───────▶ │   ├─ timeline.json  events.json      │
 │  · VLM abierto → descripciones (grab.) │ artefac. │   ├─ observations.fgb (cuantizado)   │
 │  · SigLIP → vectores de clip           │          │   ├─ isochrones.fgb  severity.png    │
 │  · Larouco: FIRMS+MSG+EMS+S2 →         │          │   ├─ terrain.pmtiles imagery.pmtiles │
 │    isocronas, ROS, severidad           │          │   ├─ weather.json  embeddings.f16    │
 │  · ERA5, combustibles, WindNinja       │          │   └─ video/ (MP4 o HLS)              │
 │  · evaluación (IoU, RMSE) → eval.json  │          │ /models/ (ONNX texto, opcional)      │
 └───────────────────────────────────────┘          └──────────────────────────────────────┘
                                                        ▲ navegador: React + three (WebGPU)
                                                        │ transformers.js · WebLLM (opcional)
```

El backend FastAPI se queda solo como herramienta local de desarrollo y pipeline, o se elimina. La app nunca lo necesita en producción.

---

## 7. Plan por fases

Tamaños: S (≤ 1 día), M (2–4 días), L (1–2 semanas).

### Fase 0 · Repositorio y publicación — S
- Fast-forward de `main` a `firescope-claude` (main solo tiene un README vacío).
- Archivar en `docs/historia-hackathon.md` lo que era del despliegue K8s y borrar `firescope-deploy/`, `deploy/`, HANDOFF y los fixtures.
- Workflow de **GitHub Pages** con `VITE_BASE=/<repo>/` y un modo de datos estático.
- Vídeo re-codificado por debajo de 100 MB.
- **Criterio de aceptación:** la app actual funciona en `https://aleetreny.github.io/<repo>/` sin backend.

### Fase 1 · Autocontenido y honestidad — M
- `StaticProvider` que lee `incidents/<id>/…`. La API queda como proveedor opcional.
- Quitar el botón Cosmos, el panel de integraciones, las etiquetas Cosmos del agente, VSS y YOLO. Chip «Demo estática · datos grabados».
- Reescribir los textos de Notas («Cómo está hecho»), los capítulos 12–14 y 18 de la presentación, README y PITCH.
- Agente determinista bilingüe con detección de intención y citas (F-02).
- **Criterio de aceptación:** ningún texto afirma una integración que no está funcionando, y 4 preguntas distintas reciben 4 respuestas distintas y correctas.

### Fase 2 · Arreglos P0/P1 funcionales y visuales — M
- F-04 a F-19 y V-02 a V-10.
- Estado en la URL y compartir con aviso. Menús accesibles. Esc en todas partes.
- Encuadre automático del escenario. Scroll al detalle de la unidad seleccionada. El PiP y la atribución reservan espacio para las etiquetas. Ejes de las gráficas sin choques. Columna de eventos con dos líneas o tooltip. Pines agrupados.
- R-03 (ROS real) y R-05 (perfil útil).
- **Criterio de aceptación:** el detector de solapes da 0 en 1280–2560 en los 25 estados, y el barrido de clics da 0 controles sin efecto o rotos.

### Fase 3 · Responsive, accesibilidad e idioma — M
- Diseño para tablet y móvil (hoja inferior, timeline compacto, PiP minimizable).
- aria-labels, foco visible, `prefers-reduced-motion`, contraste AA y resumen textual.
- i18n ES/EN con selector y español por defecto para el pitch.
- **Criterio de aceptación:** 0 solapes y 0 controles fuera de pantalla a 390 y 768, y axe sin violaciones serias.

### Fase 4 · Rendimiento — M
- Selectores de Zustand. `onCamera` solo cuando cambie la cámara. Render bajo demanda.
- Cámara simulada sin lectura de GPU. Calidad adaptativa.
- Observaciones cuantizadas y binarias. PMTiles del incidente. Horizonte a menor zoom. Pantalla de carga progresiva (baja resolución primero).
- Code-splitting y PWA.
- **Criterio de aceptación:** cumplir la tabla de objetivos de 3.D, con Lighthouse rendimiento ≥ 90 en escritorio.

### Fase 5 · El incendio grande (Larouco) — L
- `pipeline/larouco/`: descarga reproducible (FIRMS, LSA SAF, EMS EMSR837, Sentinel-2, PNOA, MDT05, ERA5) → isocronas y ROS → severidad → paquete del incidente.
- Validación del método sobre un incendio de GOFER, con el IoU publicado en `eval.json`.
- Selector de incidentes en la interfaz. Timeline de varios días (zoom temporal, día/noche).
- Gráficas nuevas: área por hora, ROS, FRP y viento.
- Flota de drones simulada coherente en escala. Recursos dimensionados con criterio y etiquetados SIM.
- Escenario de propagación con combustibles y viento reales, **comparado con lo que pasó de verdad** (retrospectiva con métrica).
- **Criterio de aceptación:** se ve crecer el incendio entero hora a hora sobre el terreno real, con cada capa citada y con una cifra de calidad.

### Fase 6 · Motor 3D de nueva generación — L
- WebGPURenderer y TSL. Terreno CDLOD sin costuras de 30 m a 40 km. Atmósfera y sol real, noche.
- Humo volumétrico y frente a escala de km. Vegetación real (altura de copa) con impostores. Modelos de aeronaves decentes (glTF con Draco).
- **Criterio de aceptación:** ≥ 30 fps en GPU integrada a 1080p, y capturas «de catálogo».

### Fase 7 · IA en el navegador — M
- Búsqueda semántica con SigLIP 2 o MobileCLIP (transformers.js) en español e inglés.
- Análisis en directo del vídeo con sombreador. «Abrir un vídeo local» y analizarlo (sin subirlo).
- ~~WebLLM opcional~~ (descartado).
- Pinhão: re-segmentación con SAM 2.1 o SegFormer (IoU > 0,80) y georreferenciación con RMSE medido.
- **Criterio de aceptación:** «humo denso» y «helicóptero» devuelven clips relevantes. El análisis en directo coincide con el grabado (IoU ≥ 0,9 entre ambos).

### Fase 8 · Presentación, vídeo y documentación — S/M
- Presentación con un hilo nuevo: problema → Pinhão (de cerca, con verdad de terreno) → Larouco (escala real) → herramientas → límites honestos.
- Nuevo vídeo promocional a 1440p60. README y PITCH reescritos. Página de métodos y fuentes.

**Orden recomendado:** 0 → 1 → 2 → 4 → 3 → 5 → 7 → 6 → 8. Las fases 0–2 dejan una demo pública honesta y limpia en pocos días. La fase 5 es la que más impresiona.

---

## 8. Decisiones (todas tomadas)

1. ~~**Nombre del repo / URL**~~ — resuelto: el repo es `FireScope-3D` → https://aleetreny.github.io/FireScope-3D/ (la web usa rutas relativas, así que un cambio de nombre ya no la rompe).
2. ~~**Incendio grande**~~ — resuelto: Larouco (fase 5).
3. ~~**IA en el navegador**~~ — resuelto (fase 7, decidido por mí a petición tuya): búsqueda visual de 52 MB opcional, que se activa a mano y se recuerda en el dispositivo. Sin LLM local (descartado).
4. ~~**Idioma por defecto**~~ — resuelto: interfaz solo en inglés; el analista entiende y responde en español (fase 3).
5. ~~**Backend FastAPI**~~ — resuelto (fase 8): eliminado; solo quedan `pipeline/` y la web estática.
6. ~~**Recursos simulados en Pinhão**~~ — se quedan, etiquetados SIM en todo momento.
7. ~~**Ramas**~~ — resuelto (fase 8): `firescope-claude`, `frontend` y `shift-file` borradas; solo queda `main`.
8. **Vídeo real de Larouco:** sin pedir por ahora; el incidente se apoya en los datos de satélite.

---

## 9. Riesgos y licencias

- **Esri World Imagery** no permite empaquetar ni cachear teselas y exige atribución. Para el modo autocontenido conviene usar PNOA (CC BY 4.0), Sentinel-2 cloudless 2016 (CC BY 4.0) o NAIP (dominio público), y dejar Esri solo como capa remota opcional.
- **AWS Terrain Tiles**: las fuentes son abiertas y piden atribución. Para España, MDT05 es mejor y es CC BY 4.0.
- **BurnedAreaUAV** es CC BY 4.0: se puede alojar con atribución.
- **Copernicus EMS, FIRMS y LSA SAF** son abiertos con cita obligatoria. Todo se citará en la interfaz y en `ATTRIBUTION.md`.
- **Límites de GitHub Pages**: sitio ≤ 1 GB, archivos ≤ 100 MB y unos 100 GB/mes de tráfico (límite blando). Los paquetes de incidente tienen que estar presupuestados (objetivo: < 150 MB por incidente).
- **Sensibilidad**: hubo víctimas en Tres Cantos y en otros incendios de 2025. El tono tiene que ser respetuoso y sin dramatizar, y conviene una nota de memoria.
- **Cifras de prensa** (37.765 ha en Larouco, 1.500 ha en Tres Cantos, 17.300 ha en Jarilla) son provisionales. Se sustituirán por EFFIS y EMS en la fase 5.
- **Rigor**: la reconstrucción por satélite tiene una incertidumbre de cientos de metros y de horas. Se mostrará siempre la incertidumbre (bandas en las isocronas) y la métrica de validación.

---

## Apéndice · Fuentes de la investigación

- FLAME 3 (térmico radiométrico de dron): [arXiv 2412.02831](https://arxiv.org/abs/2412.02831v1) · [IEEE DataPort](https://ieee-dataport.org/open-access/flame-3-radiometric-thermal-uav-imagery-wildfire-management)
- FLAME 2: [Clemson Open](https://open.clemson.edu/all_data/3250) · FireMan-UAV-RGBT: [Zenodo](https://zenodo.org/records/13732947) · Boreal Forest Fire: [Scientific Data](https://www.nature.com/articles/s41597-025-05634-0)
- RxCADRE 2012 LWIR: [RDS-2016-0007](https://www.fs.usda.gov/rds/archive/catalog/RDS-2016-0007)
- NASA FEDS: [servicio de perímetros](https://gis.earthdata.nasa.gov/image/rest/services/FireTracking/Fire_Events_Data_Suite_Fire_Perimeters_NRT/MapServer/0)
- GOFER (perímetros horarios GOES): [Zenodo](https://zenodo.org/records/14642378) · [ESSD 2024](https://essd.copernicus.org/articles/16/1395/2024/essd-16-1395-2024-assets.html)
- PT-FireSprd: [ESSD 2023](https://essd.copernicus.org/articles/15/3791/2023/)
- LSA SAF FRP-PIXEL: [productos de fuego](https://lsa-saf.eumetsat.int/data/products/fire-products/) · [Wooster et al. 2015](https://acp.copernicus.org/articles/15/13217/2015/)
- Copernicus EMS EMSR837 (incendios del oeste de España, ago 2025): [activación](https://mapping.emergency.copernicus.eu/activations/EMSR837) · [noticia Ourense](https://mapping.emergency.copernicus.eu/news/wildfire-in-ourense-province-spain/)
- Larouco, 37.765 ha (prensa): [El Debate](https://www.eldebate.com/sociedad/sociedad-medio-ambiente/20260722/superficie-quemada-espana-roza-120000-hectareas-triple-hace-ano-estas-alturas_442257.html) · Jarilla, 17.300 ha: [Vozpópuli](https://www.vozpopuli.com/espana/estabilizado-el-incendio-de-jarilla-tras-quemar-17300-hectareas.html)
- Tres Cantos, unas 1.500 ha y perimetrado al día siguiente: [El Salto](https://www.elsaltodiario.com/comunidad-madrid/perimetrado-incendio-tres-cantos-mantiene-situacion-2-tormentas-rachas-fuertes-viento) · [RTVC](https://rtvc.es/hombre-fallece-incendio-tres-cantos-12-agosto-2025/)
