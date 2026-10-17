import type { AnalysisEvent, AskRequest, AskResponse, Citation } from '../api/types';
import { SIM_UNITS, opsTotals } from '../sim/ops';
import { formatLat, formatLon } from '../scene/geo';
import { clipCitation, eventCitation, frameAt, growthSeries, loadCorpus, type Corpus } from './corpus';
import { compass, detectLang, mmss, norm, num, t, utc, type Lang } from './lang';

/**
 * FireScope incident analyst — answers questions about the incident in English or Spanish, in the browser, from the recorded
 * measurements and events only. It detects the intent of the question, computes the answer from the data and cites the clips
 * it used (citations seek the video and the map). No language model: nothing is generated beyond these templates.
 */
export const ANALYST_MODEL = 'FireScope incident analyst (rule-based, in the browser)';

type Intent = 'help' | 'selected' | 'where' | 'first' | 'fastest' | 'spot' | 'smoke' | 'thermal' | 'weather' | 'now' | 'spread' | 'area'
  | 'danger' | 'accuracy' | 'review' | 'resources' | 'drone' | 'method' | 'summary';

// Patterns run over the normalised question (lower case, no accents). Weights break ties between overlapping intents.
const INTENTS: [Intent, RegExp, number][] = [
  ['help', /\b(help|ayuda|what can you|que puedes|que sabes|hola|hello|hi)\b/, 1],
  ['selected', /\b(this|that|selected) (event|alert|moment)\b|\b(este|esta|ese|esa) (evento|alerta|momento)\b|seleccionad/, 3],
  ['where', /\b(where|location|located|position|coordinates?|place|donde|ubicacion|ubicad\w*|situad\w*|coordenadas|lugar|sitio)\b/, 2],
  ['first', /\b(first|start|started|began|begin|appear\w*|onset|primer\w*|empez\w*|comenz\w*|aparec\w*|inicio)\b/, 2],
  ['fastest', /\b(fastest|faster|quickest|most growth|grew (the )?most|accelerat\w*|surge\w*|peak growth|mas rapid\w*|mas deprisa|aceler\w*|crecio mas|mayor crecimiento|pico)\b/, 3],
  ['spot', /\b(spot\w*|jump\w*|ahead|outside|beyond|emerging|new (visible )?fire|fire activity|focos?|salto|fuera|por delante|delante|nuevos? (fuegos?|focos?)|actividad)\b/, 2.5],
  ['smoke', /\b(smoke|smoky|haze|plume|humo|humareda|neblina|columna)\b/, 2],
  ['thermal', /\b(thermal|infrared|heat|hot|hottest|celsius|degrees|termic\w*|infrarroj\w*|calor|caliente|grados)\b|temperature of the (fire|flames?)|\b(fire|flame) temperature|temperatura del (fuego|incendio)|temperatura de las llamas/, 3],
  ['weather', /\b(wind|weather|temperature|humid\w*|rain|gusts?|meteo\w*|viento|temperatura|humedad|lluvia|rachas?|clima|era5)\b|\bel tiempo\b/, 2],
  ['now', /\b(now|currently|right now|at this (moment|time)|at the cursor|ahora|en este momento|actualmente|ahora mismo)\b/, 2],
  ['spread', /\b(spread\w*|speed|rate|how fast|velocidad|propag\w*|ritmo|rapidez|avanz\w*)\b/, 2],
  ['area', /\b(how much|area|size|hectares?|m2|m²|extent|cuanto|cuanta|superficie|hectareas?|tamano|extension|quem\w*)\b|\bburn(ed|t)\b/, 1.5],
  ['danger', /\b(danger\w*|risk\w*|safe\w*|people|person|anyone|anybody|evacuat\w*|threat\w*|houses?|peligr\w*|riesgo|segur\w*|personas?|alguien|gente|evacu\w*|amenaza|casas?|viviendas?)\b/, 2.5],
  ['accuracy', /\b(accura\w*|reliab\w*|trust\w*|iou|precision|error|valid\w*|ground truth|verified|fiab\w*|precis\w*|confian\w*|exact\w*|verdad|validad\w*)\b/, 2.5],
  ['review', /\b(review|alerts?|attention|check|important|warnings?|revis\w*|alertas?|atencion|importante|avisos?)\b/, 2],
  ['resources', /\b(resources?|aircraft|planes?|tankers?|helicopters?|engines?|crews?|retardant|dozer|recursos?|aviones?|avionetas?|helicopteros?|brigad\w*|retardante|medios|cisternas?|bomberos|camion\w*)\b/, 2.5],
  ['drone', /\b(drones?|uav|camera|altitude|footage|video|dron|camara|altura|grabacion|filmacion)\b/, 1.5],
  ['method', /\b(how (do|does|did) (you|it|this)|method\w*|algorithm|segment\w*|computed|calculated|metodo|algoritmo|calcul\w*)\b|\bcomo (funciona|se calcula|lo sabes|lo calculas)\b/, 2],
  ['summary', /\b(change\w*|happen\w*|evolv\w*|summar\w*|overview|progress\w*|cambi\w*|paso|ocurri\w*|evolu\w*|resumen|resume)\b/, 1],
];

export function classify(question: string): Intent | null {
  const q = norm(question);
  let best: Intent | null = null, score = 0;
  for (const [id, re, w] of INTENTS) if (re.test(q) && w > score) { best = id; score = w; }
  return best;
}

// ------------------------------------------------------------------ helpers
const M_LAT = 111320;
function offsetM(a: [number, number], b: [number, number]) {
  const mLon = M_LAT * Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * mLon, dy = (b[1] - a[1]) * M_LAT;
  return { d: Math.hypot(dx, dy), bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
}
function ringAreaM2(ring: [number, number][]) {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][1], mLon = M_LAT * Math.cos((lat0 * Math.PI) / 180);
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length]; s += x0 * mLon * y1 * M_LAT - x1 * mLon * y0 * M_LAT; }
  return Math.abs(s) / 2;
}
const area = (m2: number | null | undefined, lang: Lang) => (m2 == null ? '—' : m2 >= 10000 ? `${num(m2 / 10000, lang, 1)} ha` : `${num(m2, lang)} m²`);
const listJoin = (xs: string[], lang: Lang) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${t(lang, 'and', 'y')} ${xs[xs.length - 1]}`);
const pct = (e: AnalysisEvent) => +(e.description.match(/(\d+)% of the analysed frame/)?.[1] ?? NaN);

/** Top growth peaks (newly burned m² in the previous minute), at least `gap` s apart. A peak snaps to the
 *  "visible fire expansion" event logged within one clip of it, so answers and Key Events show the same moment. */
interface Peak { vs: number; d: number; ev?: AnalysisEvent }
function peaks(c: Corpus, n = 2, gap = 90): Peak[] {
  const s = growthSeries(c).filter((x) => x.d != null).sort((a, b) => (b.d as number) - (a.d as number));
  const out: Peak[] = [];
  for (const x of s) {
    if (out.every((o) => Math.abs(o.vs - x.f.video_seconds) > gap)) {
      const ev = c.events.find((e) => e.event_type === 'visible_fire_expansion' && Math.abs(e.start_seconds - x.f.video_seconds) <= 12);
      out.push({ vs: ev?.start_seconds ?? x.f.video_seconds, d: x.d as number, ev });
    }
    if (out.length >= n) break;
  }
  return out;
}
const atPeak = (x: Ctx, p: Peak): string => (p.ev ? atEvent(x, p.ev) : atPeak(x, p));

interface Ctx { c: Corpus; lang: Lang; q: string; vs: number; ms: number; selected?: AnalysisEvent; cites: Citation[] }
/** Add a citation (deduplicated) and return its [n] marker. */
function cite(x: Ctx, ci: Citation) {
  let i = x.cites.findIndex((k) => Math.abs(k.start_seconds - ci.start_seconds) < 0.5 && (k.event_id ?? null) === (ci.event_id ?? null));
  if (i < 0) { x.cites.push(ci); i = x.cites.length - 1; }
  return `[${i + 1}]`;
}
const atClip = (x: Ctx, vs: number) => cite(x, clipCitation(x.c, vs));
const atEvent = (x: Ctx, e: AnalysisEvent) => cite(x, eventCitation(e));
const clock = (x: Ctx, vs: number) => `${mmss(vs)} (${utc(x.c.t0 + vs * 1000)} UTC)`;

// ------------------------------------------------------------------ answers
const A: Record<Intent, (x: Ctx) => string> = {
  summary(x) {
    const { c, lang } = x, f0 = c.frames[0], f1 = c.frames[c.frames.length - 1];
    const a0 = f0.burned_area_m2.value ?? 0, a1 = f1.burned_area_m2.value ?? 0;
    const [p] = peaks(c, 1);
    const spots = c.events.filter((e) => e.event_type === 'new_fire_activity');
    const smoke = c.events.filter((e) => e.event_type === 'smoke_increase');
    const parts = [t(lang,
      `Over the ${mmss(f1.video_seconds)} recording, burned ground in the drone's view grew from ${area(a0, lang)} to ${area(a1, lang)} (×${num(a1 / Math.max(a0, 1), lang, 1)}).`,
      `En los ${mmss(f1.video_seconds)} de grabación, el terreno quemado en la vista del dron pasó de ${area(a0, lang)} a ${area(a1, lang)} (×${num(a1 / Math.max(a0, 1), lang, 1)}).`)];
    if (p) parts.push(t(lang, `It grew fastest around ${mmss(p.vs)}, +${area(p.d, lang)} in one minute ${atPeak(x, p)}.`, `Creció más rápido hacia el ${mmss(p.vs)}, +${area(p.d, lang)} en un minuto ${atPeak(x, p)}.`));
    if (spots.length) parts.push(t(lang, `Flames appeared ahead of the burned front ${spots.length} times, at ${listJoin(spots.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}, each flagged for review.`,
      `Aparecieron llamas por delante del frente quemado ${spots.length} veces, en ${listJoin(spots.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}, todas marcadas para revisión.`));
    if (smoke.length) parts.push(t(lang, `Dense smoke covered part of the view at ${listJoin(smoke.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}.`, `Hubo humo denso en parte de la vista en ${listJoin(smoke.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}.`));
    return parts.join(' ');
  },
  where(x) {
    const { c, lang } = x, p = c.source.pose!, pos = p.position as [number, number];
    const aboutDrone = /\b(drones?|dron|uav|camera|camara)\b/.test(norm(x.q));
    const head = ((p.yaw_deg ?? 0) % 360 + 360) % 360;
    if (aboutDrone) return t(lang,
      `UAV-01 hovered at ${formatLat(pos[1])} ${formatLon(pos[0])}, ${num(p.altitude_agl_m, lang, 1)} m above the ground (${num(p.altitude_msl_m, lang)} m above sea level), looking ${compass(head, lang)} (${num(head, lang)}°) with the gimbal ${num(Math.abs(p.pitch_deg ?? 0), lang, 1)}° below the horizon ${atClip(x, 0)}. It did not move during the recording.`,
      `El UAV-01 estuvo en estacionario en ${formatLat(pos[1])} ${formatLon(pos[0])}, a ${num(p.altitude_agl_m, lang, 1)} m sobre el suelo (${num(p.altitude_msl_m, lang)} m sobre el nivel del mar), mirando al ${compass(head, lang)} (${num(head, lang)}°) con la cámara ${num(Math.abs(p.pitch_deg ?? 0), lang, 1)}° por debajo del horizonte ${atClip(x, 0)}. No se movió durante la grabación.`);
    const ring = (c.incident.reference_perimeter?.geometry.coordinates[0] ?? []) as [number, number][];
    const cell = ringAreaM2(ring);
    const evs = c.events.filter((e) => e.location);
    const near = evs.length ? evs.map((e) => offsetM(pos, e.location as [number, number])) : [];
    const dmin = Math.min(...near.map((o) => o.d)), dmax = Math.max(...near.map((o) => o.d));
    const brg = near.length ? compass(near.reduce((a, o) => a + o.bearing, 0) / near.length, lang) : null;
    return t(lang,
      `This is the ${c.incident.name}, a prescribed burn at ${c.incident.location}, around ${formatLat(c.incident.center[1])} ${formatLon(c.incident.center[0])}.` + (cell ? ` The planned burn cell covers about ${area(cell, lang)}.` : '') + (brg ? ` The part of the front the drone filmed is ${num(dmin, lang)}–${num(dmax, lang)} m ${brg} of the drone ${atEvent(x, evs[0])}.` : ''),
      `Es la ${c.incident.name}, una quema prescrita en ${c.incident.location}, hacia ${formatLat(c.incident.center[1])} ${formatLon(c.incident.center[0])}.` + (cell ? ` La parcela de quema planificada ocupa unas ${area(cell, lang)}.` : '') + (brg ? ` La parte del frente que grabó el dron está a ${num(dmin, lang)}–${num(dmax, lang)} m al ${brg} del dron ${atEvent(x, evs[0])}.` : ''));
  },
  first(x) {
    const { c, lang } = x;
    if (/\b(smoke|humo)\b/.test(norm(x.q))) return A.smoke(x);
    const f = c.events.find((e) => e.event_type === 'first_visible_flames'), s = c.events.find((e) => e.event_type === 'new_fire_activity');
    const parts: string[] = [];
    if (f) parts.push(t(lang, `Flames are already visible in the first analysed frame, at ${clock(x, f.start_seconds)} ${atEvent(x, f)}: the recording starts after ignition, with ${area(c.frames[0].burned_area_m2.value, lang)} already burned in view.`,
      `Las llamas ya se ven en el primer fotograma analizado, a las ${clock(x, f.start_seconds)} ${atEvent(x, f)}: la grabación empieza después de la ignición, con ${area(c.frames[0].burned_area_m2.value, lang)} ya quemados en la vista.`));
    if (s) parts.push(t(lang, `The first flames outside the burned area appear at ${clock(x, s.start_seconds)} ${atEvent(x, s)}.`, `Las primeras llamas fuera de la zona quemada aparecen a las ${clock(x, s.start_seconds)} ${atEvent(x, s)}.`));
    return parts.join(' ') || A.summary(x);
  },
  fastest(x) {
    const { c, lang } = x, [p1, p2] = peaks(c, 2);
    const f1 = c.frames[c.frames.length - 1], avg = ((f1.burned_area_m2.value ?? 0) - (c.frames[0].burned_area_m2.value ?? 0)) / (f1.video_seconds / 60);
    return t(lang,
      `The fastest growth was at ${clock(x, p1.vs)}: +${area(p1.d, lang)} of newly burned ground in the previous minute ${atPeak(x, p1)}.` + (p2 ? ` The next surge was at ${mmss(p2.vs)} (+${area(p2.d, lang)}) ${atPeak(x, p2)}.` : '') + ` The average over the recording was ${area(avg, lang)} per minute.`,
      `El crecimiento más rápido fue a las ${clock(x, p1.vs)}: +${area(p1.d, lang)} de terreno recién quemado en el minuto anterior ${atPeak(x, p1)}.` + (p2 ? ` El siguiente pico fue en el ${mmss(p2.vs)} (+${area(p2.d, lang)}) ${atPeak(x, p2)}.` : '') + ` La media de la grabación fue de ${area(avg, lang)} por minuto.`);
  },
  spot(x) {
    const { c, lang } = x, pos = c.source.pose!.position as [number, number];
    const spots = c.events.filter((e) => e.event_type === 'new_fire_activity');
    if (!spots.length) return t(lang, 'No flames were detected outside the burned area.', 'No se detectaron llamas fuera de la zona quemada.');
    const where = spots.filter((e) => e.location).map((e) => offsetM(pos, e.location as [number, number]));
    const d = where.length ? ` ${t(lang, `They were ${num(Math.min(...where.map((o) => o.d)), lang)}–${num(Math.max(...where.map((o) => o.d)), lang)} m from the drone, to the ${compass(where[0].bearing, lang)}.`, `Estaban a ${num(Math.min(...where.map((o) => o.d)), lang)}–${num(Math.max(...where.map((o) => o.d)), lang)} m del dron, hacia el ${compass(where[0].bearing, lang)}.`)}` : '';
    return t(lang,
      `New fire activity — flames outside the existing burned area, a possible spot fire or the front jumping — was detected ${spots.length} times: ${listJoin(spots.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}.${d} Each one is boxed on the video and needs a human to confirm it.`,
      `Se detectó actividad nueva —llamas fuera de la zona ya quemada, un posible foco secundario o un salto del frente— ${spots.length} veces: ${listJoin(spots.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}.${d} Cada una aparece recuadrada en el vídeo y necesita que una persona la confirme.`);
  },
  smoke(x) {
    const { c, lang } = x, sm = c.events.filter((e) => e.event_type === 'smoke_increase');
    if (!sm.length) return t(lang, 'No dense-smoke windows were logged.', 'No se registraron momentos de humo denso.');
    const p = Math.max(...sm.map(pct));
    return t(lang,
      `Smoke was densest at ${listJoin(sm.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}, when haze covered about ${num(p, lang)}% of the analysed frame. Smoke can hide burned ground or be mistaken for it, so the segmentation is less reliable in those moments; because burned ground is accumulated (it never "unburns"), a smoky frame can delay growth but not erase it.`,
      `El humo fue más denso en ${listJoin(sm.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}, cuando la neblina cubría cerca del ${num(p, lang)}% del fotograma analizado. El humo puede tapar el terreno quemado o confundirse con él, así que la segmentación es menos fiable en esos momentos; como el área quemada se acumula (nunca "se des-quema"), un fotograma con humo puede retrasar el crecimiento pero no borrarlo.`);
  },
  thermal(x) {
    const { c, lang } = x, pk = c.events.find((e) => e.event_type === 'intensity_change');
    return t(lang,
      `The drone carried a normal RGB camera (${c.source.label}) with no thermal sensor, so the footage cannot measure temperature. Hotspots mark visible flames, not heat readings, and the IR* view is a false-colour look on RGB brightness, labelled as simulated.` + (pk ? ` The largest visible flame extent was at ${mmss(pk.start_seconds)} ${atEvent(x, pk)}.` : ''),
      `El dron llevaba una cámara RGB normal (${c.source.label}) sin sensor térmico, así que el vídeo no puede medir temperaturas. Los hotspots marcan llamas visibles, no lecturas de calor, y la vista IR* es un falso color sobre el brillo RGB, rotulado como simulado.` + (pk ? ` La mayor extensión de llama visible fue en el ${mmss(pk.start_seconds)} ${atEvent(x, pk)}.` : ''));
  },
  weather(x) {
    const { c, lang } = x, h = c.weather.hourly;
    if (!h.length) return t(lang, 'No weather data is attached to this incident.', 'Este incidente no tiene datos meteorológicos.');
    const near = (ms: number) => h.reduce((a, b) => (Math.abs(Date.parse(b.timestamp) - ms) < Math.abs(Date.parse(a.timestamp) - ms) ? b : a));
    const hours = [...new Set([near(c.t0), near(c.t1)])];
    const fmtH = (r: typeof h[number]) => t(lang,
      `at ${utc(Date.parse(r.timestamp), false)} UTC, ${num(r.temp_c, lang, 1)} °C, ${num(r.rh_pct, lang)}% humidity, wind ${num(r.wind_kmh, lang, 1)} km/h from the ${r.wind_dir_deg != null ? compass(r.wind_dir_deg, lang) : '—'}, gusts ${num(r.gust_kmh, lang, 1)} km/h`,
      `a las ${utc(Date.parse(r.timestamp), false)} UTC, ${num(r.temp_c, lang, 1)} °C, ${num(r.rh_pct, lang)}% de humedad, viento de ${num(r.wind_kmh, lang, 1)} km/h del ${r.wind_dir_deg != null ? compass(r.wind_dir_deg, lang) : '—'}, rachas de ${num(r.gust_kmh, lang, 1)} km/h`);
    const last = hours[hours.length - 1];
    return t(lang,
      `ERA5 reanalysis for the site: ${hours.map(fmtH).join('; ')}. Soil moisture was ${num((last.soil_moisture_m3m3 ?? NaN) * 100, lang)}% and the vapour-pressure deficit ${num(last.vpd_kpa, lang, 2)} kPa — light wind and fairly humid air, typical of a controlled burn window. This is a ~25 km grid model, not a sensor on site.`,
      `Reanálisis ERA5 para el sitio: ${hours.map(fmtH).join('; ')}. La humedad del suelo era del ${num((last.soil_moisture_m3m3 ?? NaN) * 100, lang)}% y el déficit de presión de vapor de ${num(last.vpd_kpa, lang, 2)} kPa: viento flojo y aire bastante húmedo, propio de una ventana de quema controlada. Es un modelo de rejilla de unos 25 km, no un sensor en el lugar.`);
  },
  now(x) {
    const { c, lang, vs } = x, f = frameAt(c, vs);
    const g = growthSeries(c).find((s) => s.f === f)?.d;
    const prev = [...c.events].reverse().find((e) => e.start_seconds <= vs + 0.5), next = c.events.find((e) => e.start_seconds > vs + 0.5);
    return t(lang,
      `At ${clock(x, f.video_seconds)} ${atClip(x, f.video_seconds)}: ${area(f.burned_area_m2.value, lang)} burned in view, ${area(f.active_fire_area_m2.value, lang)} of visible flames and ${num(f.hotspot_count.value, lang)} flame hotspots` + (g != null ? `; +${area(g, lang)} in the last minute.` : '.') + (prev ? ` The last event was "${prev.title}" at ${mmss(prev.start_seconds)} ${atEvent(x, prev)}.` : '') + (next ? ` Next: "${next.title}" at ${mmss(next.start_seconds)}.` : ''),
      `A las ${clock(x, f.video_seconds)} ${atClip(x, f.video_seconds)}: ${area(f.burned_area_m2.value, lang)} quemados en la vista, ${area(f.active_fire_area_m2.value, lang)} de llama visible y ${num(f.hotspot_count.value, lang)} hotspots de llama` + (g != null ? `; +${area(g, lang)} en el último minuto.` : '.') + (prev ? ` El último evento fue «${prev.title}» en el ${mmss(prev.start_seconds)} ${atEvent(x, prev)}.` : '') + (next ? ` Siguiente: «${next.title}» en el ${mmss(next.start_seconds)}.` : ''));
  },
  spread(x) {
    const { c, lang } = x, [p] = peaks(c, 1), f1 = c.frames[c.frames.length - 1];
    const avg = ((f1.burned_area_m2.value ?? 0) - (c.frames[0].burned_area_m2.value ?? 0)) / (f1.video_seconds / 60);
    const ros = c.frames.map((f) => ({ f, v: f.front_advance_m_min?.value })).filter((r): r is { f: typeof f1; v: number } => r.v != null);
    const rosTxt = ros.length ? (() => {
      const mean = ros.reduce((a, r) => a + r.v, 0) / ros.length, top = ros.reduce((a, r) => (r.v > a.v ? r : a));
      return t(lang,
        `The visible front advanced ${num(mean, lang, 1)} m/min on average and up to ${num(top.v, lang, 1)} m/min around ${mmss(top.f.video_seconds)} ${atClip(x, top.f.video_seconds)} (leading edge of the burned outline compared with one minute earlier). `,
        `El frente visible avanzó de media ${num(mean, lang, 1)} m/min y hasta ${num(top.v, lang, 1)} m/min hacia el ${mmss(top.f.video_seconds)} ${atClip(x, top.f.video_seconds)} (borde delantero del contorno quemado comparado con un minuto antes). `);
    })() : '';
    return rosTxt + t(lang,
      `Burned area in view grew ${area(avg, lang)} per minute on average, with a peak of +${area(p.d, lang)} in one minute at ${mmss(p.vs)} ${atPeak(x, p)}. Both describe only the part of the front the drone could see.`,
      `El área quemada en la vista creció de media ${area(avg, lang)} por minuto, con un pico de +${area(p.d, lang)} en un minuto en el ${mmss(p.vs)} ${atPeak(x, p)}. Las dos cifras describen solo la parte del frente que veía el dron.`);
  },
  area(x) {
    const { c, lang, vs } = x, f0 = c.frames[0], f1 = c.frames[c.frames.length - 1], fn = frameAt(c, vs);
    const ring = (c.incident.reference_perimeter?.geometry.coordinates[0] ?? []) as [number, number][], cell = ringAreaM2(ring);
    return t(lang,
      `By the end of the recording (${utc(c.t1, false)} UTC), ${area(f1.burned_area_m2.value, lang)} of burned ground had been mapped in the drone's view ${atClip(x, f1.video_seconds)}, up from ${area(f0.burned_area_m2.value, lang)} at the start. At the cursor (${mmss(fn.video_seconds)}) it is ${area(fn.burned_area_m2.value, lang)}.` + (cell ? ` That is only what the camera saw: the planned burn cell covers about ${area(cell, lang)}.` : ''),
      `Al final de la grabación (${utc(c.t1, false)} UTC) se habían cartografiado ${area(f1.burned_area_m2.value, lang)} de terreno quemado en la vista del dron ${atClip(x, f1.video_seconds)}, frente a ${area(f0.burned_area_m2.value, lang)} al principio. En el cursor (${mmss(fn.video_seconds)}) son ${area(fn.burned_area_m2.value, lang)}.` + (cell ? ` Es solo lo que veía la cámara: la parcela de quema planificada ocupa unas ${area(cell, lang)}.` : ''));
  },
  danger(x) {
    const { c, lang } = x, spots = c.events.filter((e) => e.event_type === 'new_fire_activity'), [p] = peaks(c, 1);
    return t(lang,
      `Nothing in this recording measures risk to people or property. It is a planned prescribed burn filmed for research, and the analysis only looks at burned ground, flames and smoke: it does not detect people or vehicles. What it does flag for human review: flames outside the burned area at ${listJoin(spots.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}, and the fastest growth at ${mmss(p.vs)} ${atPeak(x, p)}. Treat this as decision support, not a safety assessment.`,
      `Nada en esta grabación mide el riesgo para personas o bienes. Es una quema prescrita planificada y grabada para investigación, y el análisis solo mira terreno quemado, llamas y humo: no detecta personas ni vehículos. Lo que sí marca para revisión humana: llamas fuera de la zona quemada en ${listJoin(spots.map((e) => `${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}, y el crecimiento más rápido en el ${mmss(p.vs)} ${atPeak(x, p)}. Es apoyo a la decisión, no una evaluación de seguridad.`);
  },
  accuracy(x) {
    const { c, lang } = x, m = c.evaluation.mean;
    return t(lang,
      `The burned-area segmentation was checked against ${num(c.evaluation.frames_evaluated, lang)} hand-drawn masks from the dataset: IoU ${num(m.iou, lang, 2)} in the image (precision ${num(m.precision, lang, 2)}, recall ${num(m.recall, lang, 2)}) and ${num(m.ground_iou, lang, 2)} once both are projected onto the ground. Georeferencing is approximate (a pinhole camera from the DJI pose plus the elevation model) and its error in metres has not been measured yet. Turn on Ground Truth in Layers to compare both on the map.`,
      `La segmentación del área quemada se comparó con ${num(c.evaluation.frames_evaluated, lang)} máscaras dibujadas a mano del dataset: IoU de ${num(m.iou, lang, 2)} en la imagen (precisión ${num(m.precision, lang, 2)}, recall ${num(m.recall, lang, 2)}) y de ${num(m.ground_iou, lang, 2)} al proyectar ambas sobre el terreno. La georreferenciación es aproximada (cámara estenopeica con la pose del DJI más el modelo de elevación) y su error en metros aún no se ha medido. Activa Ground Truth en Layers para comparar las dos en el mapa.`);
  },
  review(x) {
    const { c, lang } = x, al = c.events.filter((e) => e.severity === 'alert'), rv = c.events.filter((e) => e.review_required);
    return t(lang,
      `${rv.length} of ${c.events.length} events need human review, and ${al.length} are alerts: ${listJoin(al.map((e) => `${e.title.toLowerCase()} at ${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}. The review queue is in Evidence; each event seeks the video and the map.`,
      `${rv.length} de ${c.events.length} eventos necesitan revisión humana y ${al.length} son alertas: ${listJoin(al.map((e) => `«${e.title}» en el ${mmss(e.start_seconds)} ${atEvent(x, e)}`), lang)}. La cola de revisión está en Evidence; cada evento lleva el vídeo y el mapa a ese momento.`);
  },
  resources(x) {
    const { c, lang, ms } = x;
    const ring = (c.incident.reference_perimeter?.geometry.coordinates[0] ?? []) as [number, number][];
    const units = SIM_UNITS.filter((u) => u.group !== 'drones');
    const base = t(lang,
      `The ${units.length} aircraft, engines and crews in Resources are a simulated exercise placed around the real burn, not part of it (tagged SIM). Only UAV-01 and its footage are real.`,
      `Los ${units.length} aviones, vehículos y brigadas de Resources son un ejercicio simulado alrededor de la quema real, no forman parte de ella (etiqueta SIM). Solo el UAV-01 y su vídeo son reales.`);
    if (ring.length < 3) return base;
    const tot = opsTotals(ms, { t0: c.t0, t1: c.t1, center: c.incident.center as [number, number], cell: ring });
    return base + ' ' + t(lang,
      `In that exercise, by ${utc(ms, false)} UTC: ${tot.airUp}/${tot.airTotal} aircraft up, ${num(tot.gal, lang)} gal of retardant and water dropped, ${num(tot.chains, lang)} chains of fire line and ${tot.personnel} personnel.`,
      `En ese ejercicio, a las ${utc(ms, false)} UTC: ${tot.airUp}/${tot.airTotal} aeronaves operativas, ${num(tot.gal, lang)} galones de retardante y agua lanzados, ${num(tot.chains, lang)} cadenas de línea de fuego y ${tot.personnel} personas.`);
  },
  drone(x) {
    const { c, lang } = x, s = c.source, p = s.pose!;
    return t(lang,
      `UAV-01 is a ${s.label} hovering ${num(p.altitude_agl_m, lang, 1)} m above the ground, with a ${num(p.hfov_deg, lang)}° field of view and the gimbal ${num(Math.abs(p.pitch_deg ?? 0), lang, 1)}° below the horizon. It recorded ${mmss(s.duration_seconds)} of RGB video (no thermal) at ${num(s.fps, lang)} fps ${atClip(x, 0)}; FireScope analysed one frame every 4 s (${num(c.frames.length, lang)} frames). Drones FT-02 to FT-06 are simulated.`,
      `El UAV-01 es un ${s.label} en estacionario a ${num(p.altitude_agl_m, lang, 1)} m sobre el suelo, con ${num(p.hfov_deg, lang)}° de campo de visión y la cámara ${num(Math.abs(p.pitch_deg ?? 0), lang, 1)}° por debajo del horizonte. Grabó ${mmss(s.duration_seconds)} de vídeo RGB (sin térmico) a ${num(s.fps, lang)} fps ${atClip(x, 0)}; FireScope analizó un fotograma cada 4 s (${num(c.frames.length, lang)} fotogramas). Los drones FT-02 a FT-06 son simulados.`);
  },
  method(x) {
    const { lang } = x;
    return t(lang,
      `Every 4 s a frame is segmented into burned ground, flames and smoke (colour rules plus morphology), and burned ground is accumulated over time so it never "unburns". Each outline pixel is cast as a ray from the drone's real pose onto the elevation model, which turns the masks into map polygons in m². Events come from measured changes. This assistant answers from those numbers, in your browser, with fixed rules: no language model, nothing invented.`,
      `Cada 4 s se segmenta un fotograma en terreno quemado, llamas y humo (reglas de color y morfología), y lo quemado se acumula en el tiempo para que nunca "se des-queme". Cada píxel del contorno se lanza como un rayo desde la pose real del dron hasta el modelo de elevación, y así las máscaras pasan a ser polígonos en el mapa en m². Los eventos salen de cambios medidos. Este asistente responde con esas cifras, en tu navegador y con reglas fijas: sin modelo de lenguaje, sin inventar nada.`);
  },
  selected(x) {
    const { lang, selected: e } = x;
    if (!e) return t(lang, 'No event is selected. Click one in Key Events or on the map, then ask again.', 'No hay ningún evento seleccionado. Haz clic en uno de Key Events o del mapa y vuelve a preguntar.') + ' ' + A.summary(x);
    return t(lang,
      `"${e.title}" at ${clock(x, e.start_seconds)} ${atEvent(x, e)}: ${e.description} Severity ${e.severity}${e.review_required ? ', needs human review' : ''}.`,
      `«${e.title}» a las ${clock(x, e.start_seconds)} ${atEvent(x, e)}: ${e.description} Severidad ${e.severity}${e.review_required ? ', necesita revisión humana' : ''}.`);
  },
  help(x) {
    return t(x.lang,
      'I answer from the recorded measurements of this incident, in English or Spanish: how the fire changed, where it was, when it grew fastest, flames outside the burned area, smoke, weather, the drone, accuracy, alerts to review and the simulated resources. Every answer cites the clips it used.',
      'Respondo con las mediciones grabadas de este incidente, en español o inglés: cómo cambió el fuego, dónde estaba, cuándo creció más rápido, llamas fuera de la zona quemada, humo, meteorología, el dron, la precisión, las alertas a revisar y los recursos simulados. Cada respuesta cita los clips que ha usado.');
  },
};

export async function analystAsk(body: AskRequest, base: string): Promise<AskResponse> {
  const t0 = performance.now();
  const c = await loadCorpus(base);
  const lang = detectLang(body.question);
  const ms = body.context?.timestamp ? Date.parse(body.context.timestamp) : c.t1;
  const x: Ctx = { c, lang, q: body.question, ms, vs: Math.max(0, (ms - c.t0) / 1000), selected: c.events.find((e) => e.event_id === body.context?.selected_event_id), cites: [] };
  const intent = classify(body.question);
  let answer = intent ? A[intent](x) : `${t(lang, "I couldn't match that question to the recorded data, so here is the summary.", 'No he podido relacionar la pregunta con los datos grabados, así que aquí tienes el resumen.')} ${A.summary(x)}`;
  answer = answer.replace(/\s+/g, ' ').trim();
  // every intent answers from the recorded data; only the no-match fallback is not grounded in the question
  return { answer, citations: x.cites, model: ANALYST_MODEL, grounded: intent != null, latency_ms: Math.round(performance.now() - t0) };
}
