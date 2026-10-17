import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { RightPanel } from './components/RightPanel';
import { Timeline } from './components/Timeline';
import { MapOverlays } from './components/MapOverlays';
import { DroneFeed } from './components/DroneFeed';
import { Presenter } from './components/Presenter';
import { SceneView, sceneRef } from './scene/SceneView';
import { useStore } from './state/store';
import { loadAll } from './state/load';

(window as unknown as { __store: typeof useStore }).__store = useStore;

export default function App() {
  const feedOpen = useStore((s) => s.feedOpen);
  const loaded = useStore((s) => s.loaded);
  const presenting = useStore((s) => s.presenting);

  useEffect(() => { loadAll(); }, []);

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
      {loaded && presenting && <Presenter />}
    </div>
  );
}
