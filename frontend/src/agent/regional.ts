import type { AnalysisEvent, AskRequest, AskResponse, Citation, SearchRequest, SearchResponse, SearchResult, TimelineFrame } from '../api/types';
import { unitsFor, opsTotals } from '../sim/ops';
import { simCtxFor } from '../sim/useSim';
import { formatLat, formatLon } from '../scene/geo';
import type { Corpus } from './corpus';
import { compass, detectLang, norm, num, t, type Lang } from './lang';

/**
 * The analyst and search for a regional wildfire (a days-long fire reconstructed from satellites). Same rules as the
 * drone analyst — intent from the question, answer computed from the package, citations — but the evidence is moments on
 * the timeline (events, satellite passes, perimeters), not video clips. No language model, nothing generated.
 */
export const REGIONAL_MODEL = 'FireScope incident analyst (rule-based, in the browser)';

interface ProgEval { mean: { iou: number; iou_firms_only: number }; perimeters: { perimeter: string; image_time: string; iou_leave_one_out: number; iou_firms_only: number; image_covers_share_of_scar: number; burned_share_of_final: number }[]; detections_in_scar: number; satellite_passes: number; severity: { classes: { id: number; label: string; ha: number; share: number }[]; mean_dnbr_in_scar: number } }
type Intent = 'help' | 'selected' | 'where' | 'first' | 'fastest' | 'spot' | 'smoke' | 'thermal' | 'weather' | 'now' | 'spread' | 'area' | 'danger' | 'accuracy' | 'review' | 'resources' | 'drone' | 'method' | 'summary';
interface Ctx { c: Corpus; ev: ProgEval; lang: Lang; ms: number; selected?: AnalysisEvent; cites: Citation[] }

const MON = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] };
const when = (ms: number, lang: Lang) => { const d = new Date(ms); return lang === 'es' ? `${d.getUTCDate()} ${MON.es[d.getUTCMonth()]} a las ${d.toISOString().slice(11, 16)}` : `${MON.en[d.getUTCMonth()]} ${d.getUTCDate()} at ${d.toISOString().slice(11, 16)}`; };
const ha = (m2: number | null | undefined, lang: Lang) => (m2 == null ? '—' : `${num(m2 / 1e4, lang)} ha`);
const listJoin = (xs: string[], lang: Lang) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${t(lang, 'and', 'y')} ${xs[xs.length - 1]}`);

function cite(x: Ctx, ci: Citation) {
  let i = x.cites.findIndex((k) => k.timestamp === ci.timestamp && (k.event_id ?? null) === (ci.event_id ?? null));
  if (i < 0) { x.cites.push(ci); i = x.cites.length - 1; }
  return `[${i + 1}]`;
}
const atEvent = (x: Ctx, e: AnalysisEvent) => cite(x, { source_id: e.source_id, start_seconds: e.start_seconds, end_seconds: e.end_seconds, timestamp: e.timestamp, event_id: e.event_id, label: null });
const atTime = (x: Ctx, ms: number) => cite(x, { source_id: 'progression', start_seconds: 0, end_seconds: 0, timestamp: new Date(ms).toISOString(), event_id: null, label: null });
const frameAt = (c: Corpus, ms: number): TimelineFrame => { let b = c.frames[0]; for (const f of c.frames) if (Date.parse(f.timestamp) <= ms) b = f; else break; return b; };
const byTitle = (c: Corpus, re: RegExp) => c.events.filter((e) => re.test(e.title));

const A: Record<Intent, (x: Ctx) => string> = {
  summary(x) {
    const { c, lang } = x, s = c.incident.summary!, runs = byTitle(c, /^Fast run/).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const first = c.events.find((e) => e.title === 'First satellite detection');
    const hi = x.ev.severity.classes.find((k) => k.id === 5)!;
    return t(lang,
      `Satellites first saw fire inside what became the scar on ${when(Date.parse(s.first_detection), lang)} UTC${first ? ' ' + atEvent(x, first) : ''}. The fire grew in runs — ${listJoin(runs.map((e) => `${e.title.replace('Fast run: ', '')} to ${when(Date.parse(e.timestamp) + 6 * 3600000, lang)} ${atEvent(x, e)}`), lang)} — and from ${when(Date.parse(s.growth_below_50ha_day), lang)} it grew by less than 50 ha a day. Copernicus EMS mapped ${num(s.burned_ha, lang)} ha burnt; ${Math.round(hi.share * 100)}% of it at high severity (Sentinel-2 dNBR).`,
      `Los satélites vieron fuego por primera vez dentro de lo que acabó siendo la cicatriz el ${when(Date.parse(s.first_detection), lang)} UTC${first ? ' ' + atEvent(x, first) : ''}. El incendio creció a saltos — ${listJoin(runs.map((e) => `${e.title.replace('Fast run: ', '').replace('in 6 h', 'en 6 h')} hasta el ${when(Date.parse(e.timestamp) + 6 * 3600000, lang)} ${atEvent(x, e)}`), lang)} — y desde el ${when(Date.parse(s.growth_below_50ha_day), lang)} creció menos de 50 ha al día. Copernicus EMS cartografió ${num(s.burned_ha, lang)} ha quemadas; el ${Math.round(hi.share * 100)}% con severidad alta (dNBR de Sentinel-2).`);
  },
  where(x) {
    const { c, lang } = x, [lon, lat] = c.incident.center as [number, number], [w, s, e, n] = c.incident.bbox;
    const f = frameAt(c, x.ms), fr = f.front;
    const kmW = ((e - w) * 111.32 * Math.cos((lat * Math.PI) / 180)).toFixed(0), kmH = ((n - s) * 111.32).toFixed(0);
    const now = fr ? t(lang, ` At the cursor (${when(Date.parse(f.timestamp), lang)}) the active part was around ${formatLat(fr.center[1])} ${formatLon(fr.center[0])}, about ${num(fr.radius_m / 1000, lang, 1)} km across${f.front_bearing_deg?.value != null ? `, spreading ${compass(f.front_bearing_deg.value, lang)}` : ''} ${atTime(x, Date.parse(f.timestamp))}.`, ` En el cursor (${when(Date.parse(f.timestamp), lang)}) la parte activa estaba hacia ${formatLat(fr.center[1])} ${formatLon(fr.center[0])}, de unos ${num(fr.radius_m / 1000, lang, 1)} km${f.front_bearing_deg?.value != null ? `, avanzando hacia el ${compass(f.front_bearing_deg.value, lang)}` : ''} ${atTime(x, Date.parse(f.timestamp))}.`) : '';
    return t(lang,
      `${c.incident.name}, ${c.incident.location}. The scar is centred on ${formatLat(lat)} ${formatLon(lon)}; the analysis box is ${kmW} × ${kmH} km.${now}`,
      `${c.incident.name}, ${c.incident.location}. La cicatriz está centrada en ${formatLat(lat)} ${formatLon(lon)}; la zona de análisis mide ${kmW} × ${kmH} km.${now}`);
  },
  first(x) {
    const { c, lang } = x, e = c.events.find((k) => k.title === 'First satellite detection');
    if (!e) return A.summary(x);
    return t(lang, `${e.title} on ${when(Date.parse(e.timestamp), lang)} UTC ${atEvent(x, e)}: ${e.description} The ignition itself happened before that pass; satellites only see it once it is large and hot enough.`,
      `Primera detección por satélite el ${when(Date.parse(e.timestamp), lang)} UTC ${atEvent(x, e)}: ${e.description} La ignición fue antes de esa pasada; los satélites solo la ven cuando ya es lo bastante grande y caliente.`);
  },
  fastest(x) {
    const { c, lang } = x, runs = byTitle(c, /^Fast run/).sort((a, b) => +(b.title.match(/[\d,]+/)?.[0].replace(/,/g, '') ?? 0) - +(a.title.match(/[\d,]+/)?.[0].replace(/,/g, '') ?? 0));
    const top = runs[0];
    if (!top) return A.summary(x);
    return t(lang, `The fastest run: ${top.title.replace('Fast run: ', '')}, from ${when(Date.parse(top.timestamp), lang)} UTC ${atEvent(x, top)}. ${runs.length > 1 ? `Next: ${listJoin(runs.slice(1).map((e) => `${e.title.replace('Fast run: ', '')} from ${when(Date.parse(e.timestamp), lang)} ${atEvent(x, e)}`), lang)}.` : ''} Timing between satellite passes (about six a day) is interpolated.`,
      `El salto más rápido: ${top.title.replace('Fast run: ', '').replace('in 6 h', 'en 6 h')}, desde el ${when(Date.parse(top.timestamp), lang)} UTC ${atEvent(x, top)}. ${runs.length > 1 ? `Después: ${listJoin(runs.slice(1).map((e) => `${e.title.replace('Fast run: ', '').replace('in 6 h', 'en 6 h')} desde el ${when(Date.parse(e.timestamp), lang)} ${atEvent(x, e)}`), lang)}.` : ''} Entre pasadas de satélite (unas seis al día) el tiempo se interpola.`);
  },
  spread(x) {
    const { c, lang } = x, rates = c.frames.filter((f) => f.front_advance_m_min?.value != null);
    const peak = rates.reduce((a, f) => ((f.front_advance_m_min!.value ?? 0) > (a.front_advance_m_min!.value ?? 0) ? f : a), rates[0]);
    const now = frameAt(c, x.ms);
    return t(lang,
      `The scar expanded fastest around ${when(Date.parse(peak.timestamp), lang)} UTC, at ${num(peak.front_advance_m_min!.value, lang, 1)} m/min ${atTime(x, Date.parse(peak.timestamp))}${now.front_advance_m_min?.value != null ? `; at the cursor, ${num(now.front_advance_m_min.value, lang, 1)} m/min` : ''}. That is the growth of the equivalent radius √(area/π) over 6 h — the speed of the scar as a whole, slower than the head of the fire. Satellite passes are hours apart, so no front line is drawn.`,
      `La cicatriz se expandió más rápido hacia el ${when(Date.parse(peak.timestamp), lang)} UTC, a ${num(peak.front_advance_m_min!.value, lang, 1)} m/min ${atTime(x, Date.parse(peak.timestamp))}${now.front_advance_m_min?.value != null ? `; en el cursor, ${num(now.front_advance_m_min.value, lang, 1)} m/min` : ''}. Es el crecimiento del radio equivalente √(área/π) en 6 h: la velocidad de la cicatriz en conjunto, más lenta que la cabeza del incendio. Las pasadas de satélite están a horas de distancia, así que no se dibuja una línea de frente.`);
  },
  area(x) {
    const { c, lang } = x, f = frameAt(c, x.ms), cls = x.ev.severity.classes;
    return t(lang,
      `At the cursor (${when(Date.parse(f.timestamp), lang)}) ${ha(f.burned_area_m2.value, lang)} had burned ${atTime(x, Date.parse(f.timestamp))}; the final EMS scar is ${num(c.incident.summary!.burned_ha, lang)} ha. Burn severity (dNBR): ${cls.filter((k) => k.ha > 0).map((k) => `${k.label.toLowerCase()} ${num(k.ha, lang)} ha`).join(', ')}.`,
      `En el cursor (${when(Date.parse(f.timestamp), lang)}) habían ardido ${ha(f.burned_area_m2.value, lang)} ${atTime(x, Date.parse(f.timestamp))}; la cicatriz final de EMS mide ${num(c.incident.summary!.burned_ha, lang)} ha. Severidad (dNBR): ${cls.filter((k) => k.ha > 0).map((k) => `${k.label.toLowerCase()} ${num(k.ha, lang)} ha`).join(', ')}.`);
  },
  now(x) {
    const { c, lang } = x, f = frameAt(c, x.ms), w = c.weather.hourly.find((h) => Math.abs(Date.parse(h.timestamp) - x.ms) <= 1800000);
    return t(lang,
      `${when(Date.parse(f.timestamp), lang)} UTC ${atTime(x, Date.parse(f.timestamp))}: ${ha(f.burned_area_m2.value, lang)} burned, ${ha(f.active_fire_area_m2.value, lang)} of it in the previous 6 h${f.front_advance_m_min?.value != null ? `, expanding at ${num(f.front_advance_m_min.value, lang, 1)} m/min` : ''}. ${f.pass_time ? `Latest satellite pass ${when(Date.parse(f.pass_time), lang)}: ${num(f.hotspot_count.value, lang)} detections, ${num(f.frp_mw?.value, lang)} MW.` : 'No satellite pass in the previous 12 h.'}${w ? ` ERA5: ${num(w.temp_c, lang, 1)} °C, ${num(w.rh_pct, lang)}% humidity, wind ${num(w.wind_kmh, lang)} km/h from ${compass(w.wind_dir_deg ?? 0, lang)}.` : ''}`,
      `${when(Date.parse(f.timestamp), lang)} UTC ${atTime(x, Date.parse(f.timestamp))}: ${ha(f.burned_area_m2.value, lang)} quemadas, ${ha(f.active_fire_area_m2.value, lang)} en las 6 h anteriores${f.front_advance_m_min?.value != null ? `, expandiéndose a ${num(f.front_advance_m_min.value, lang, 1)} m/min` : ''}. ${f.pass_time ? `Última pasada de satélite el ${when(Date.parse(f.pass_time), lang)}: ${num(f.hotspot_count.value, lang)} detecciones, ${num(f.frp_mw?.value, lang)} MW.` : 'Sin pasada de satélite en las 12 h anteriores.'}${w ? ` ERA5: ${num(w.temp_c, lang, 1)} °C, ${num(w.rh_pct, lang)}% de humedad, viento de ${num(w.wind_kmh, lang)} km/h del ${compass(w.wind_dir_deg ?? 0, lang)}.` : ''}`);
  },
  weather(x) {
    const { c, lang } = x, ev = byTitle(c, /^(Strongest gusts|Driest hour)/);
    return A.now(x) + ' ' + t(lang, `During the main growth: ${listJoin(ev.map((e) => `${e.title.toLowerCase()} on ${when(Date.parse(e.timestamp), lang)} ${atEvent(x, e)}`), lang)}. ERA5 is a ~25 km reanalysis cell, not an on-site station.`,
      `Durante el crecimiento principal: ${listJoin(ev.map((e) => `${e.title.toLowerCase()} el ${when(Date.parse(e.timestamp), lang)} ${atEvent(x, e)}`), lang)}. ERA5 es una celda de reanálisis de ~25 km, no una estación en el sitio.`);
  },
  thermal(x) {
    const { c, lang } = x, e = byTitle(c, /^Most intense pass/)[0];
    return t(lang, `Satellites measure fire radiative power (MW), not the temperature of the flames. ${e ? `The most intense pass: ${e.description} ${atEvent(x, e)}` : ''} ${num(x.ev.detections_in_scar, lang)} FIRMS detections fall inside the scar.`,
      `Los satélites miden potencia radiativa del fuego (MW), no la temperatura de las llamas. ${e ? `La pasada más intensa: ${num(+(e.title.match(/[\d,]+/)?.[0].replace(/,/g, '') ?? 0), lang)} MW ${atEvent(x, e)}.` : ''} ${num(x.ev.detections_in_scar, lang)} detecciones FIRMS caen dentro de la cicatriz.`);
  },
  spot(x) {
    return t(x.lang, 'Spot fires cannot be told apart at this resolution: a VIIRS pixel is 375 m and a MODIS pixel 1 km. Detections outside the burned area at a given time are visible in the Satellite Detections layer, for 12 h after each pass.',
      'A esta resolución no se distinguen los focos secundarios: un píxel VIIRS mide 375 m y uno MODIS 1 km. Las detecciones fuera de la zona quemada en cada momento se ven en la capa Satellite Detections, durante 12 h tras cada pasada.');
  },
  smoke(x) {
    return t(x.lang, 'Smoke is not measured in this package: the satellite detections are thermal. The columns on the map are drawn where the front is and lean with the ERA5 wind of that hour — for readability, not an observation.',
      'El humo no se mide en este paquete: las detecciones de satélite son térmicas. Las columnas del mapa se dibujan donde está el frente y se inclinan con el viento ERA5 de esa hora: es una ayuda visual, no una observación.');
  },
  danger(x) {
    return t(x.lang, 'This reconstruction has no data on people, houses or evacuations, so it cannot say who was at risk. For that, see the official sources (Xunta de Galicia, Protección Civil). Here: where and when the ground burned, and how badly.',
      'Esta reconstrucción no tiene datos de personas, viviendas ni evacuaciones, así que no puede decir quién estuvo en riesgo. Para eso, las fuentes oficiales (Xunta de Galicia, Protección Civil). Aquí: dónde y cuándo ardió el terreno, y con qué severidad.');
  },
  accuracy(x) {
    const { lang, ev } = x, rows = ev.perimeters;
    return t(lang,
      `Each intermediate Copernicus EMS perimeter was held out and compared with the reconstruction built without it: IoU ${listJoin(rows.map((r) => `${num(r.iou_leave_one_out, lang, 2)} on ${when(Date.parse(r.image_time), lang).replace(/ at .*/, '')}${r.image_covers_share_of_scar < 0.9 ? ` (image covers ${Math.round(r.image_covers_share_of_scar * 100)}% of the scar)` : ''}`), lang)} — mean ${num(ev.mean.iou, lang, 2)} (${num(ev.mean.iou_firms_only, lang, 2)} with satellite detections alone). Parameters were picked on these scores, so they are slightly optimistic. The scar itself comes from EMS high-resolution imagery.`,
      `Cada perímetro intermedio de Copernicus EMS se apartó y se comparó con la reconstrucción hecha sin él: IoU ${listJoin(rows.map((r) => `${num(r.iou_leave_one_out, lang, 2)} el ${when(Date.parse(r.image_time), lang).replace(/ a las .*/, '')}${r.image_covers_share_of_scar < 0.9 ? ` (la imagen cubre el ${Math.round(r.image_covers_share_of_scar * 100)}% de la cicatriz)` : ''}`), lang)}; media ${num(ev.mean.iou, lang, 2)} (${num(ev.mean.iou_firms_only, lang, 2)} solo con detecciones de satélite). Los parámetros se eligieron con estas cifras, así que son algo optimistas. La cicatriz en sí viene de imágenes de alta resolución de EMS.`);
  },
  review(x) {
    const { c, lang } = x, al = c.events.filter((e) => e.severity === 'alert');
    return t(lang, `All ${c.events.length} events are computed and need human review; ${al.length} are alerts: ${listJoin(al.map((e) => `${e.title.toLowerCase()} (${when(Date.parse(e.timestamp), lang)}) ${atEvent(x, e)}`), lang)}.`,
      `Los ${c.events.length} eventos son calculados y necesitan revisión humana; ${al.length} son alertas: ${listJoin(al.map((e) => `${e.title.toLowerCase()} (${when(Date.parse(e.timestamp), lang)}) ${atEvent(x, e)}`), lang)}.`);
  },
  resources(x) {
    const { c, lang } = x, ctx = simCtxFor(c.incident, { incident_id: c.incident.id, start: new Date(c.t0).toISOString(), end: new Date(c.t1).toISOString(), frames: c.frames, events: c.events }, c.t0, c.t1);
    const units = unitsFor(ctx).filter((u) => u.group !== 'drones'), tot = ctx ? opsTotals(x.ms, ctx) : null;
    return t(lang,
      `The ${units.length} aircraft, engines and brigades in Resources are a simulated exercise that follows the reconstructed front — not the real operation (tagged SIM). Aircraft fly in daylight only.${tot ? ` By the cursor the exercise has dropped ${num(tot.gal, lang)} gal of water and retardant.` : ''}`,
      `Los ${units.length} aviones, vehículos y brigadas de Resources son un ejercicio simulado que sigue el frente reconstruido, no el operativo real (etiqueta SIM). Los aviones solo vuelan de día.${tot ? ` Hasta el cursor el ejercicio ha lanzado ${num(tot.gal, lang)} gal de agua y retardante.` : ''}`);
  },
  drone(x) {
    return t(x.lang, 'No drone or aircraft footage of this fire is published here: using it needs the owners\' permission. Drones FT-02 to FT-06 are simulated and their cameras render the 3D twin.',
      'Aquí no se publica vídeo de dron ni de avión de este incendio: usarlo requiere permiso de sus propietarios. Los drones FT-02 a FT-06 son simulados y sus cámaras renderizan el gemelo 3D.');
  },
  method(x) {
    return t(x.lang,
      'The scar is the latest Copernicus EMS delineation. Each 30 m cell takes the time of its first NASA FIRMS detection (VIIRS 375 m, MODIS 1 km); gaps are interpolated from the nearest detected cells, and every dated EMS perimeter bounds the result (inside it, burned by the image time; outside it, after). Severity is Sentinel-2 dNBR before and after the fire. This assistant answers from those numbers with fixed rules.',
      'La cicatriz es la última delineación de Copernicus EMS. Cada celda de 30 m toma la hora de su primera detección NASA FIRMS (VIIRS 375 m, MODIS 1 km); los huecos se interpolan desde las celdas detectadas más cercanas y cada perímetro fechado de EMS acota el resultado (dentro, quemada antes de la imagen; fuera, después). La severidad es el dNBR de Sentinel-2 antes y después del incendio. Este asistente responde con esas cifras y reglas fijas.');
  },
  selected(x) {
    const { lang, selected: e } = x;
    if (!e) return t(lang, 'No event is selected. Click one in Key Events or on the map, then ask again.', 'No hay ningún evento seleccionado. Haz clic en uno de Key Events o del mapa y vuelve a preguntar.') + ' ' + A.summary(x);
    return `"${e.title}" ${t(lang, 'on', 'el')} ${when(Date.parse(e.timestamp), lang)} UTC ${atEvent(x, e)}: ${e.description}`;
  },
  help(x) {
    return t(x.lang,
      'I answer from this reconstruction: how and when the fire grew, where it was, its fastest runs, burned area and severity, satellite fire power, weather, accuracy, alerts and the simulated resources. Answers cite moments on the timeline.',
      'Respondo con esta reconstrucción, en español o inglés: cómo y cuándo creció el incendio, dónde estaba, sus saltos más rápidos, la superficie y la severidad, la potencia del fuego vista por satélite, la meteorología, la precisión, las alertas y los recursos simulados. Las respuestas citan momentos del timeline.');
  },
};

export function regionalAsk(body: AskRequest, c: Corpus, intent: Intent | null, t0: number): AskResponse {
  const lang = detectLang(body.question);
  const ms = body.context?.timestamp ? Date.parse(body.context.timestamp) : c.t1;
  const x: Ctx = { c, ev: c.evaluation as unknown as ProgEval, lang, ms, selected: c.events.find((e) => e.event_id === body.context?.selected_event_id), cites: [] };
  let answer = intent ? A[intent](x) : `${t(lang, "I couldn't match that question to the data, so here is the summary.", 'No he podido relacionar la pregunta con los datos, así que aquí tienes el resumen.')} ${A.summary(x)}`;
  answer = answer.replace(/\s+/g, ' ').trim();
  return { answer, citations: x.cites, model: REGIONAL_MODEL, grounded: intent != null, latency_ms: Math.round(performance.now() - t0) };
}

/* ------------------------------------------------------------------------------------------------------ search */

const ES: Record<string, string> = { humo: 'smoke', fuego: 'fire', incendio: 'fire', llamas: 'flames', quemado: 'burned', quemada: 'burned', viento: 'wind', rachas: 'gusts', racha: 'gusts', seco: 'dry', humedad: 'humidity',
  rapido: 'fast', salto: 'run', saltos: 'run', crecimiento: 'growth', crece: 'growth', perimetro: 'perimeter', satelite: 'satellite', deteccion: 'detection', detecciones: 'detections', noche: 'night', primera: 'first', primer: 'first', intenso: 'intense', potencia: 'power', fin: 'end', apagado: 'end' };
const SYN: Record<string, string[]> = { fast: ['run', 'growth', 'expanding'], run: ['fast', 'growth'], growth: ['run', 'grew', 'expanding'], fire: ['detection', 'burning', 'run'], dry: ['humidity', 'driest'], humidity: ['driest', 'dry'], wind: ['gusts'], gusts: ['wind', 'strongest'],
  perimeter: ['ems', 'mapped'], satellite: ['detection', 'firms', 'pass'], intense: ['power', 'mw'], power: ['mw', 'intense'], night: ['night'], end: ['below', 'stops'], first: ['first'] };
const words = (s: string) => norm(s).match(/[a-z0-9]+/g) ?? [];

/** Documents: every event, and one summary per day (growth, satellite passes, fire power, wind). */
function docs(c: Corpus) {
  const out: { id: string; ms: number; ev?: AnalysisEvent; text: string; caption: string }[] = c.events.map((e) => ({ id: e.event_id, ms: Date.parse(e.timestamp), ev: e, text: `${e.title}. ${e.description} ${e.event_type.replace(/_/g, ' ')}`, caption: `${e.title} — ${e.description}` }));
  const D = 86400000;
  for (let d = Math.floor(c.t0 / D) * D; d < c.t1; d += D) {
    const fr = c.frames.filter((f) => { const t = Date.parse(f.timestamp); return t >= d && t < d + D; });
    if (!fr.length) continue;
    const grow = fr.reduce((a, f) => a + (f.area_change_m2.value ?? 0), 0) / 1e4;
    const frp = Math.max(0, ...fr.map((f) => f.frp_mw?.value ?? 0)), dets = Math.max(0, ...fr.map((f) => f.hotspot_count.value ?? 0));
    const w = c.weather.hourly.filter((h) => { const t = Date.parse(h.timestamp); return t >= d && t < d + D; });
    const gust = Math.max(0, ...w.map((h) => h.gust_kmh ?? 0)), rh = Math.min(100, ...w.map((h) => h.rh_pct ?? 100));
    const day = new Date(d).toISOString().slice(0, 10);
    const facts = [grow >= 1 ? `fire growth ${Math.round(grow)} ha burned this day${grow > 2000 ? ', fast run, rapid expanding' : ''}` : '', dets ? `${dets} satellite detections on one pass, fire power ${Math.round(frp)} MW${frp > 10000 ? ' intense' : ''}` : '', gust ? `wind gusts up to ${Math.round(gust)} km/h` : '', rh < 30 ? `dry air, humidity down to ${Math.round(rh)}%` : ''].filter(Boolean).join('; ');
    out.push({ id: `day_${day}`, ms: d + 12 * 3600000, text: `${day} ${facts}`, caption: `${day}: ${facts || 'no measured growth'}.` });
  }
  return out;
}

export function regionalSearch(body: SearchRequest, c: Corpus, t0: number): SearchResponse {
  const qs = new Set<string>();
  for (const w of words(body.query)) { const en = ES[w] ?? w; qs.add(en); for (const s of SYN[en] ?? []) qs.add(s); }
  const score = (text: string) => { const ts = words(text); if (!ts.length || !qs.size) return 0; const long = [...qs].filter((w) => w.length > 4); return ts.filter((x) => qs.has(x) || long.some((w) => x.startsWith(w.slice(0, 5)))).length / Math.sqrt(ts.length); };
  const ranked = docs(c).map((d) => ({ d, s: score(d.text) * (d.ev ? 1.4 : 1) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, body.top_k ?? 8);
  const results: SearchResult[] = ranked.map(({ d, s }) => ({
    clip_id: d.id, source_id: 'progression', start_seconds: 0, end_seconds: 0, timestamp: new Date(d.ms).toISOString(),
    caption: d.caption.slice(0, 240), similarity: +s.toFixed(3), event_id: d.ev?.event_id ?? null, thumbnail_url: null,
  }));
  return { query: body.query, model: 'keyword search over computed events and daily summaries', results, latency_ms: Math.round(performance.now() - t0) };
}
