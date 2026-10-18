import { lazy, Suspense, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { RightPanel } from './components/RightPanel';
import { Timeline } from './components/Timeline';
import { MapOverlays } from './components/MapOverlays';
import { DroneFeed } from './components/DroneFeed';
import { SceneView, sceneRef, selectEvent } from './scene/SceneView';
import { PhoneBar, PhoneSheet } from './components/PhoneShell';
import { useLayout } from './lib/layout';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from './state/store';
import { loadAll } from './state/load';

(window as unknown as { __store: typeof useStore }).__store = useStore;
const loadPresenter = () => import('./components/Presenter');
const Presenter = lazy(() => loadPresenter().then((m) => ({ default: m.Presenter })));   // not part of the first load

/** Text version of what the map shows, for screen readers. */
function IncidentSummary() {
  const { incident, timeline, events } = useStore(useShallow((s) => ({ incident: s.incident, timeline: s.timeline, events: s.events })));
  if (!incident || !timeline) return null;
  const f0 = timeline.frames[0], f1 = timeline.frames[timeline.frames.length - 1];
  return (
    <section className="sr-only" aria-label="Incident summary">
      <h1>FireScope 3D: {incident.name}, {incident.location}</h1>
      <p>Drone replay of a prescribed burn on {new Date(timeline.start).toUTCString()}. Burned ground in the drone's view grew from {Math.round(f0.burned_area_m2.value ?? 0)} to {Math.round(f1.burned_area_m2.value ?? 0)} square metres in {Math.round((Date.parse(timeline.end) - Date.parse(timeline.start)) / 60000)} minutes. {events.length} events were detected:</p>
      <ul>{events.map((e) => <li key={e.event_id}>{new Date(e.timestamp).toISOString().slice(11, 19)} UTC — {e.title}. {e.description}</li>)}</ul>
      <p>Use the Analysis panel to ask questions about the incident; answers are text with links to the video.</p>
    </section>
  );
}

export default function App() {
  const feedOpen = useStore((s) => s.feedOpen);
  const loaded = useStore((s) => s.loaded);
  const presenting = useStore((s) => s.presenting);
  const regional = useStore((s) => s.incident?.scale === 'regional');
  const toast = useStore((s) => s.toast);
  const drawer = useStore((s) => s.drawer);
  const layout = useLayout();

  useEffect(() => { loadAll(); }, []);
  // tablet: the side panel is a drawer — open it when the user switches to a mode or panel that lives there
  useEffect(() => useStore.subscribe((st, prev) => {
    if (layout !== 'tablet' || st.presenting) return;
    if ((st.mode !== prev.mode && st.mode !== 'incident') || (st.panel !== prev.panel)) st.set({ drawer: true });
  }), [layout]);
  // fetch the tour in the background once the incident is up, so the Tour button opens instantly
  useEffect(() => { if (loaded) { const t = setTimeout(() => { loadPresenter().catch(() => {}); }, 2500); return () => clearTimeout(t); } }, [loaded]);
  // in-browser AI the visitor turned on before (model from the browser cache), once the incident is up
  useEffect(() => { if (loaded) { const t = setTimeout(() => { import('./ai/visual').then((m) => m.restoreVisual()).catch(() => {}); }, 3000); return () => clearTimeout(t); } }, [loaded]);

  // playback clock: the timeline is the single source of truth for map + video + panels
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const s = useStore.getState();
      if (s.playing) {
        const nt = s.time + (now - last) * s.speed;
        if (nt >= s.t1) s.set({ time: s.t1, playing: false }); else s.set({ time: nt });
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || useStore.getState().presenting) return;
      const s = useStore.getState();
      if (e.code === 'Space') { e.preventDefault(); s.set({ playing: !s.playing }); }
      if (e.key === 'ArrowRight') s.setTime(s.time + 8000);
      if (e.key === 'ArrowLeft') s.setTime(s.time - 8000);
      if (e.key === 'h') sceneRef.current?.flyHome();
      if (e.key === 'Home') s.setTime(s.t0);
      if (e.key === 'End') s.setTime(s.t1);
      if (e.key === '[' || e.key === ']') {
        const ev = e.key === ']' ? s.events.find((x) => Date.parse(x.timestamp) > s.time + 1000) : [...s.events].reverse().find((x) => Date.parse(x.timestamp) < s.time - 1000);
        if (ev) selectEvent(ev.event_id);
      }
      if (e.key === '2') s.set({ view: '2d' });
      if (e.key === '3') s.set({ view: '3d' });
    };
    window.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key); };
  }, []);

  return (
    <div className={'app ' + layout}>
      {/* the map subtree keeps its place in every layout, so rotating a device never rebuilds the 3D scene */}
      {layout === 'phone' ? <PhoneBar /> : <TopBar />}
      <div className="main">
        <div className="left">
          <div className={'map' + (layout === 'tablet' && drawer ? ' drawer-open' : '')}>
            <SceneView />
            <MapOverlays />
            {loaded && feedOpen && <DroneFeed />}
            {layout === 'phone' && loaded && <PhoneSheet />}
            {layout === 'tablet' && <div className={'drawer' + (drawer ? ' open' : '')} aria-hidden={!drawer}><RightPanel /></div>}
          </div>
          {layout !== 'phone' && <Timeline />}
        </div>
        {layout === 'desktop' && <RightPanel />}
      </div>
      {loaded && presenting && !regional && <Suspense fallback={null}><Presenter /></Suspense>}
      {toast && <div className="toast" role="status">{toast}</div>}
      <IncidentSummary />
    </div>
  );
}
