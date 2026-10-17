import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FireScene } from './FireScene';
import { useStore } from '../state/store';

/** Global handle so panels can drive the camera (fly-to, 2D/3D, etc.). */
export const sceneRef: { current: FireScene | null } = { current: null };
export const profileRef: { current: { d: number; elev: number; burned: boolean }[]; listeners: Set<() => void> } = { current: [], listeners: new Set() };

export function SceneView() {
  const el = useRef<HTMLDivElement>(null);
  const loaded = useStore((s) => s.loaded);

  useEffect(() => {
    const scene = new FireScene(el.current!, {
      onHover: (h) => useStore.getState().set({ hover: h }),
      onCamera: (c) => useStore.getState().set({ cam: c }),
      onEventClick: (id) => selectEvent(id, true),
      onDroneClick: (id) => useStore.getState().set({ mode: 'drones', selectedSourceId: id, selectedUnitId: null, feedOpen: true }),
      onUnitClick: (id) => { const s = useStore.getState(); s.set(id.startsWith('FT-') ? { selectedUnitId: id, feedOpen: true } : { selectedUnitId: id }); },
      onFollowEnd: () => useStore.getState().set({ follow: null }),
      onScenario: (sc) => useStore.getState().set({ scenario: sc }),
      onProgress: (m) => useStore.getState().set({ loadMsg: m }),
      onReady: () => useStore.getState().set({ loadMsg: '' }),
    });
    sceneRef.current = scene;
    Object.assign(window as object, { __scene: scene, __THREE_V: THREE.Vector3, __selEv: (id: string) => selectEvent(id, true) });
    return () => { scene.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const s = useStore.getState(), scene = sceneRef.current!;
    const src = s.sources[0];
    scene.setObservations(s.features, s.hotspots);
    scene.setLayers(s.layers);
    scene.setTime(s.time);
    scene.load(s.incident!, src).then(() => {
      const st = useStore.getState();
      const ring = (st.incident!.reference_perimeter?.geometry.coordinates[0] ?? []) as [number, number][];
      scene.setSim({ t0: st.t0, t1: st.t1, center: st.incident!.center as [number, number], cell: ring });
      scene.setOpsMode(st.mode);
      scene.setEvents(st.events);
      scene.setTime(useStore.getState().time);
      updateProfile();
    }).catch((e) => useStore.getState().set({ loadError: String(e) }));

    let lastFrameKey = '';
    const unsub = useStore.subscribe((st, prev) => {
      if (st.time !== prev.time) {
        scene.setTime(st.time);
        const k = String(Math.floor(st.time / 4000));
        if (k !== lastFrameKey) { lastFrameKey = k; updateProfile(); }
      }
      if (st.layers !== prev.layers) { scene.setLayers(st.layers); if (st.layers.projection !== prev.layers.projection) { scene.setScenario(st.layers.projection); if (!st.layers.projection) useStore.getState().set({ scenario: { on: false, hours: 0, ha: 0 } }); } }
      if (st.view !== prev.view) scene.set2D(st.view === '2d');
      if (st.events !== prev.events) scene.setEvents(st.events);
      if (st.selectedEventId !== prev.selectedEventId) scene.setSelectedEvent(st.selectedEventId);
      if (st.mode !== prev.mode) scene.setOpsMode(st.mode);
      if (st.selectedUnitId !== prev.selectedUnitId) { scene.setSelectedUnit(st.selectedUnitId); if (st.selectedUnitId && !st.follow) scene.flyToUnit(st.selectedUnitId, st.selectedUnitId.startsWith('FT-') ? 160 : 320); }
      if (st.follow !== prev.follow) scene.setFollow(st.follow);
      if (st.exaggeration !== prev.exaggeration) scene.setExaggeration(st.exaggeration);
      if (st.compare !== prev.compare) scene.setCompare(st.compare.on ? st.compare.before : null);
    });
    return unsub;
  }, [loaded]);

  return <div ref={el} style={{ position: 'absolute', inset: 0 }} />;
}

function updateProfile() {
  const sc = sceneRef.current;
  if (!sc) return;
  profileRef.current = sc.profileAlongView();
  profileRef.listeners.forEach((f) => f());
}

/** Select an event: seek timeline, fly camera, open drone evidence. */
export function selectEvent(id: string, fly = true) {
  const s = useStore.getState();
  const e = s.events.find((x) => x.event_id === id);
  if (!e) return;
  s.set({ selectedEventId: id, playing: false, selectedSourceId: e.source_id });
  s.setTime(Date.parse(e.timestamp));
  if (fly && e.location) sceneRef.current?.flyToLonLat(e.location[0], e.location[1], 95);
}

/** Seek to a cited clip and show the footage. */
export function seekCitation(sourceId: string, startSeconds: number, eventId?: string | null) {
  const s = useStore.getState();
  const src = s.sources.find((x) => x.id === sourceId) ?? s.sources[0];
  if (!src) return;
  s.set({ playing: false, selectedSourceId: src.id, feedOpen: true, selectedEventId: eventId ?? s.selectedEventId });
  s.setTime(Date.parse(src.recorded_start) + startSeconds * 1000);
  const e = eventId ? s.events.find((x) => x.event_id === eventId) : undefined;
  if (e?.location) sceneRef.current?.flyToLonLat(e.location[0], e.location[1], 95);
}
