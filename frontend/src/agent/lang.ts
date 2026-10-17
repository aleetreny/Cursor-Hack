export type Lang = 'en' | 'es';

/** Lower-case, strip accents and punctuation (keeps ¿/¡ out of the way), collapse spaces. */
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9²%°\s]/g, ' ').replace(/\s+/g, ' ').trim();

const ES = /\b(hola|gracias|buenas|ayuda|que|cuando|donde|cuanto|cuanta|cuantos|como|cual|el|la|los|las|del|un|una|hay|fue|esta|estaba|se|por|para|incendio|fuego|humo|viento|dron|quemad[oa]s?|llamas?|tiempo|ahora|riesgo|peligro|personas|recursos|superficie|velocidad|cambio|paso|ocurrio|alguien|precision|fiable)\b/g;
const EN = /\b(what|when|where|how|which|who|the|is|was|were|did|does|do|of|in|fire|smoke|wind|drone|burned|burnt|flames?|weather|now|risk|danger|people|resources|area|speed|change|happened|anyone|accurate|reliable)\b/g;

/** Spanish if the question has Spanish punctuation/letters or more Spanish than English marker words. */
export function detectLang(q: string): Lang {
  if (/[¿¡ñ]/i.test(q)) return 'es';
  const n = norm(q);
  return (n.match(ES)?.length ?? 0) > (n.match(EN)?.length ?? 0) ? 'es' : 'en';
}

export const num = (v: number | null | undefined, lang: Lang, d = 0) =>
  v == null || !isFinite(v) ? '—' : v.toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const mmss = (s: number) => { const t = Math.max(0, s); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
export const utc = (ms: number, sec = true) => new Date(ms).toISOString().slice(11, sec ? 19 : 16);
const DIRS = { en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'], es: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'] };
export const compass = (deg: number, lang: Lang) => DIRS[lang][Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
/** Pick the string for the language. */
export const t = (lang: Lang, en: string, es: string) => (lang === 'es' ? es : en);
