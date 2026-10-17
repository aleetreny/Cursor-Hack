import { api } from '../api/client';
import { useStore } from './store';
import { startUrlSync } from './url';

export async function loadAll() {
  const set = useStore.getState().set;
  try {
    set({ loadMsg: 'Fetching incident' });
    const [incident, sources, timeline, obs] = await Promise.all([api.incident(), api.sources(), api.timeline(), api.observations()]);
    const events = sources[0] ? (await api.events(sources[0].id).catch(() => ({ events: timeline.events }))).events : timeline.events;
    const t0 = Date.parse(timeline.start), t1 = Date.parse(timeline.end);
    // open on an instant where the front is clearly active
    const first = events.find((e) => e.event_type === 'visible_fire_expansion' && e.severity === 'alert') ?? events.find((e) => e.severity === 'alert') ?? events[0];
    set({
      incident, sources, timeline, features: obs.features, hotspots: obs.hotspots ?? [],
      events: [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
      t0, t1, time: first ? Math.min(t1, Date.parse(first.timestamp) + 20000) : t0 + (t1 - t0) * 0.35,
      selectedSourceId: sources[0]?.id ?? null, loaded: true, loadMsg: 'Loading terrain',
    });
    startUrlSync();   // ?t=&mode=&cam=… → view, and keep the address bar in sync from now on
  } catch (e) {
    set({ loadError: e instanceof Error ? e.message : String(e) });
  }
  api.weather().then((weather) => set({ weather })).catch(() => set({ weather: null }));
  api.manifest().then((manifest) => set({ manifest })).catch(() => set({ manifest: null }));
  api.incidents().then((incidents) => set({ incidents })).catch(() => set({ incidents: [] }));
}
