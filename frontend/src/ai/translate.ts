import { detectLang, norm } from '../agent/lang';

/**
 * Spanish → English for visual queries. The image–text model (MobileCLIP) was trained on English captions, so a Spanish
 * query is translated word by word with a small wildfire vocabulary (nouns, adjectives, places), adjectives moved before
 * their noun ("humo denso" → "dense smoke"). Words it does not know are kept: many are cognates the model still reads.
 * The UI shows the English query that was searched, so nothing is hidden.
 */
const NOUN: Record<string, string> = {
  humo: 'smoke', humareda: 'smoke', columna: 'column', penacho: 'plume', nube: 'cloud', nubes: 'clouds', pirocumulo: 'pyrocumulus cloud',
  llama: 'flame', llamas: 'flames', fuego: 'fire', incendio: 'wildfire', frente: 'fire front', linea: 'line', brasas: 'embers', ceniza: 'ash', cenizas: 'ash',
  suelo: 'ground', terreno: 'ground', tierra: 'land', hierba: 'grass', pasto: 'grass', matorral: 'shrubs', arbustos: 'shrubs', monte: 'scrubland',
  bosque: 'forest', arboles: 'trees', arbol: 'tree', pinar: 'pine forest', campos: 'fields', campo: 'field', cultivos: 'farmland', prado: 'meadow',
  cicatriz: 'scar', zona: 'area', area: 'area', montana: 'mountain', montanas: 'mountains', sierra: 'mountains', colina: 'hill', colinas: 'hills', valle: 'valley', ladera: 'hillside',
  rio: 'river', embalse: 'reservoir', lago: 'lake', agua: 'water', pueblo: 'village', aldea: 'village', ciudad: 'town', casas: 'houses', casa: 'house',
  carretera: 'road', camino: 'track', pista: 'dirt track', roca: 'rock', rocas: 'rocks', cielo: 'sky', sol: 'sun',
  helicoptero: 'helicopter', avion: 'airplane', avioneta: 'small airplane', hidroavion: 'water bomber', bombero: 'firefighter', bomberos: 'firefighters',
  persona: 'person', personas: 'people', coche: 'car', camion: 'truck', vehiculo: 'vehicle', dron: 'drone', descarga: 'water drop', nieve: 'snow',
};
const ADJ: Record<string, string> = {
  denso: 'dense', densa: 'dense', espeso: 'thick', espesa: 'thick', negro: 'black', negra: 'black', blanco: 'white', blanca: 'white', gris: 'grey',
  alto: 'tall', alta: 'tall', altas: 'tall', altos: 'tall', grande: 'big', grandes: 'big', pequeno: 'small', pequena: 'small', pequenas: 'small',
  quemado: 'burned', quemada: 'burned', quemados: 'burned', quemadas: 'burned', calcinado: 'charred', verde: 'green', verdes: 'green', seco: 'dry', seca: 'dry', secos: 'dry',
  activo: 'active', activa: 'active', intenso: 'intense', intensa: 'intense', fuerte: 'strong', naranja: 'orange', rojo: 'red', roja: 'red', oscuro: 'dark', oscura: 'dark',
  claro: 'clear', despejado: 'clear', nublado: 'cloudy',
};
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'con', 'en', 'sobre', 'entre', 'por', 'que', 'muy', 'mucho', 'mucha', 'hay', 'donde', 'se', 've', 'ver', 'busca', 'buscar', 'muestra', 'mostrar']);
const PREP: Record<string, string> = { con: 'with', sobre: 'over', entre: 'among', junto: 'next to' };

export function toEnglish(query: string): { text: string; translated: boolean } {
  if (detectLang(query) !== 'es' && !/\b(humo|llamas?|fuego|quemad|helicoptero|avion|nubes?|rio|embalse|bosque)\b/.test(norm(query))) return { text: query.trim(), translated: false };
  const out: string[] = [];
  let pendingAdj: string[] = [];
  for (const w of norm(query).split(' ')) {
    if (!w) continue;
    if (ADJ[w]) {
      // an adjective after a noun belongs to it: "humo denso" → "dense smoke"
      const last = out[out.length - 1];
      if (last && !Object.values(PREP).includes(last)) out[out.length - 1] = `${ADJ[w]} ${last}`;
      else pendingAdj.push(ADJ[w]);
      continue;
    }
    if (PREP[w] && out.length) { out.push(PREP[w]); continue; }
    if (STOP.has(w)) continue;
    const en = NOUN[w] ?? w;
    out.push([...pendingAdj, en].join(' '));
    pendingAdj = [];
  }
  if (pendingAdj.length) out.push(pendingAdj.join(' '));
  // "columna de humo" → "column smoke" → "smoke column"
  const text = out.join(' ').replace(/\b(column|plume|line|cloud) (smoke|fire|flames)\b/g, '$2 $1').trim();
  return { text: text || query.trim(), translated: true };
}
