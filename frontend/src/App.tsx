import { lazy, Suspense, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { RightPanel } from './components/RightPanel';
import { Timeline } from './components/Timeline';
import { MapOverlays } from './components/MapOverlays';
import { DroneFeed } from './components/DroneFeed';
import { SceneView, sceneRef, selectEvent } from './scene/SceneView';
import { useStore } from './state/store';
import { loadAll } from './state/load';

(window as unknown as { __store: typeof useStore }).__store = useStore;
const loadPresenter = () => import('./components/Presenter');
const Presenter = lazy(() => loadPresenter().then((m) => ({ default: m.Presenter })));   // not part of the first load

export default function App() {
  const feedOpen = useStore((s) => s.feedOpen);
  const loaded = useStore((s) => s.loaded);
  const presenting = useStore((s) => s.presenting);
  const toast = useStore((s) => s.toast);

  useEffect(() => { loadAll(); }, []);
  // fetch the tour in the background once the incident is up, so the Tour button opens instantly
  useEffect(() => { if (loaded) { const t = setTimeout(() => { loadPresenter().catch(() => {}); }, 2500); return () => clearTimeout(t); } }, [loaded]);

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
    <div className="app">
      <TopBar />
      <div className="main">
        <div className="left">
          <div className="map">
            <SceneView />
            <MapOverlays />
            {loaded && feedOpen && <DroneFeed />}
          </div>
          <Timeline />
        </div>
        <RightPanel />
      </div>
      {loaded && presenting && <Suspense fallback={null}><Presenter /></Suspense>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
