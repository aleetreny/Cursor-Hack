import { useStore, type ModeTab, type PanelTab } from './store';
import { sceneRef } from '../scene/SceneView';

/**
 * The view lives in the URL, so a link reopens exactly what you were looking at:
 *   ?incident=<id>&t=<seconds since start>&mode=drones&panel=evidence&view=2d&ev=<event>&unit=<unit>&scn=1&gt=1&cam=x,y,z,tx,ty,tz
 * Mode/panel changes push a history entry (Back works); everything else replaces the current one.
 */
const MODES: ModeTab[] = ['incident', 'drones', 'resources'];
const PANEL_IN: Record<string, PanelTab> = { layers: 'layers', analysis: 'analysis', evidence: 'evidence', about: 'notes' };
const PANEL_OUT: Record<PanelTab, string> = { layers: 'layers', analysis: 'analysis', evidence: 'evidence', notes: 'about' };

interface UrlView { t?: number; mode?: ModeTab; panel?: PanelTab; view?: '2d' | '3d'; ev?: string; unit?: string; scn?: boolean; gt?: boolean; cam?: number[] }

export function readUrl(search = location.search): UrlView {
  const q = new URLSearchParams(search), out: UrlView = {};
  const t = parseFloat(q.get('t') ?? ''); if (isFinite(t)) out.t = t;
  const m = q.get('mode') as ModeTab | null; if (m && MODES.includes(m)) out.mode = m;
  const p = PANEL_IN[q.get('panel') ?? '']; if (p) out.panel = p;
  if (q.get('view') === '2d') out.view = '2d';
  if (q.get('ev')) out.ev = q.get('ev')!;
  if (q.get('unit')) out.unit = q.get('unit')!;
  if (q.get('scn') === '1') out.scn = true;
  if (q.get('gt') === '1') out.gt = true;
  const cam = (q.get('cam') ?? '').split(',').map(Number); if (cam.length === 6 && cam.every(isFinite)) out.cam = cam;
  return out;
}

let pendingCam: number[] | null = null;
function apply(v: UrlView, animate = false) {
  const s = useStore.getState();
  s.set({
    mode: v.mode ?? 'incident', panel: v.panel ?? 'layers', view: v.view ?? '3d',
    selectedEventId: v.ev && s.events.some((e) => e.event_id === v.ev) ? v.ev : s.selectedEventId,
    selectedUnitId: v.unit ?? null, feedOpen: (v.mode ?? 'incident') === 'drones', follow: null,
  });
  if (v.t != null) s.setTime(s.t0 + v.t * 1000);
  if (!!v.scn !== s.layers.projection) s.setLayer('projection', !!v.scn);
  if (!!v.gt !== s.layers.groundTruth) s.setLayer('groundTruth', !!v.gt);
  if (v.cam) { if (sceneRef.current && !s.loadMsg) sceneRef.current.setCameraState(v.cam, animate ? 900 : 0); else pendingCam = v.cam; }
}

export function buildUrl(): string {
  const s = useStore.getState(), cur = new URLSearchParams(location.search), q = new URLSearchParams();
  for (const k of ['incident', 'nointro']) if (cur.has(k)) q.set(k, cur.get(k)!);
  q.set('t', String(Math.round((s.time - s.t0) / 100) / 10));
  if (s.mode !== 'incident') q.set('mode', s.mode);
  if (s.panel !== 'layers' && s.mode === 'incident') q.set('panel', PANEL_OUT[s.panel]);
  if (s.view === '2d') q.set('view', '2d');
  if (s.selectedEventId) q.set('ev', s.selectedEventId);
  if (s.selectedUnitId) q.set('unit', s.selectedUnitId);
  if (s.layers.projection) q.set('scn', '1');
  if (s.layers.groundTruth) q.set('gt', '1');
  const cam = sceneRef.current && !s.loadMsg ? sceneRef.current.cameraState() : null;
  if (cam) q.set('cam', cam.map((v) => Math.round(v)).join(','));
  return `${location.pathname}?${q.toString().replace(/%2C/g, ',').replace(/(^|&)nointro=(?=&|$)/, '$1nointro')}`;
}

/** Apply the URL once the incident is loaded, then keep it in sync with the view. */
export function startUrlSync() {
  apply(readUrl());
  let timer = 0, lastNav = navKey();
  function navKey() { const s = useStore.getState(); return `${s.mode}|${s.panel}`; }
  const write = () => {
    const s = useStore.getState();
    if (s.presenting) return;
    const url = buildUrl(), nav = navKey();
    if (url === location.pathname + location.search) return;
    if (nav !== lastNav) history.pushState(null, '', url); else history.replaceState(null, '', url);
    lastNav = nav;
  };
  const unsub = useStore.subscribe((st, prev) => {
    if (pendingCam && !st.loadMsg && sceneRef.current) { sceneRef.current.setCameraState(pendingCam, 0); pendingCam = null; }
    if (st.time === prev.time && st.cam === prev.cam && st.mode === prev.mode && st.panel === prev.panel && st.view === prev.view
      && st.selectedEventId === prev.selectedEventId && st.selectedUnitId === prev.selectedUnitId && st.layers === prev.layers && st.presenting === prev.presenting) return;
    clearTimeout(timer);
    timer = window.setTimeout(write, st.mode !== prev.mode || st.panel !== prev.panel ? 0 : 400);
  });
  const pop = () => { apply(readUrl(), true); lastNav = navKey(); };
  window.addEventListener('popstate', pop);
  return () => { unsub(); window.removeEventListener('popstate', pop); clearTimeout(timer); };
}
