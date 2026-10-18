import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FireScene } from './FireScene';
import { useStore } from '../state/store';
import { IS_STATIC, incidentBase, mediaUrl } from '../api/client';
import type { WeatherResponse } from '../api/types';
import { simCtxFor } from '../sim/useSim';

/** Global handle so panels can drive the camera (fly-to, 2D/3D, etc.). */
export const sceneRef: { current: FireScene | null } = { current: null };
export type Profile = { d: number; elev: number; burned: boolean; inCell: boolean }[] & { fireD?: number; droneD?: number | null; bearing?: number };
export const profileRef: { current: Profile; listeners: Set<() => void> } = { current: [], listeners: new Set() };

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
    (IS_STATIC ? incidentBase() : Promise.resolve('')).then((base) => scene.load(s.incident!, src, base)).then(async () => {
      const st = useStore.getState(), inc = st.incident!;
      if (inc.progression) {
        // the reconstructed arrival-time field lives next to the incident files
        const url = IS_STATIC ? `${await incidentBase()}${inc.progression.image}` : mediaUrl(inc.progression.image)!;
        await scene.setProgression(inc.progression, url).catch((e) => console.warn(e));
      }
      const ctx = simCtxFor(inc, st.timeline, st.t0, st.t1);
      if (ctx) scene.setSim(ctx);
      scene.setOpsMode(st.mode);
      scene.setEvents(st.events);
      scene.setTime(useStore.getState().time);
      updateProfile();
    }).catch((e) => useStore.getState().set({ loadError: String(e) }));

    let lastFrameKey = '', lastWind = '';
    const wind = (w: WeatherResponse | null, t: number) => {
      const h = w?.hourly.find((x) => Math.abs(Date.parse(x.timestamp) - t) <= 1800000);
      const k = h?.timestamp ?? '';
      if (h && k !== lastWind) { lastWind = k; scene.setWind(h.wind_dir_deg, h.wind_kmh); }
    };
    wind(s.weather, s.time);
    const unsub = useStore.subscribe((st, prev) => {
      if (st.time !== prev.time || st.weather !== prev.weather) wind(st.weather, st.time);
      if (st.time !== prev.time) {
        scene.setTime(st.time);
        const k = String(Math.floor(st.time / 4000));
        if (k !== lastFrameKey) { lastFrameKey = k; updateProfile(); }
      }
      if (st.layers !== prev.layers) {
        scene.setLayers(st.layers);
        if (st.layers.projection !== prev.layers.projection) {
          scene.setScenario(st.layers.projection);
          if (!st.layers.projection) useStore.getState().set({ scenario: { on: false, hours: 0, ha: 0, lapse: 1 } });
          // the scenario box is ~8 km wide: frame it when it appears, come back to the fire when it goes (the presenter sets its own shots)
          if (!st.presenting && !scene.regional) { if (st.layers.projection) scene.frameScenario(); else scene.flyHome(); }
        }
      }
      if (st.view !== prev.view) scene.set2D(st.view === '2d');
      if (st.events !== prev.events) scene.setEvents(st.events);
      if (st.selectedEventId !== prev.selectedEventId) scene.setSelectedEvent(st.selectedEventId);
      if (st.mode !== prev.mode) scene.setOpsMode(st.mode);
      if (st.selectedUnitId !== prev.selectedUnitId) {
        scene.setSelectedUnit(st.selectedUnitId);
        if (st.selectedUnitId && !st.follow) { if (st.selectedUnitId.startsWith('FT-')) scene.flyToUnitAndFire(st.selectedUnitId, 220, st.feedOpen ? 0.5 : 1); else scene.flyToUnit(st.selectedUnitId, 320); }
      }
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
  profileRef.current = sc.profileAcrossCell();
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
export function seekCitation(sourceId: string, startSeconds: number, eventId?: string | null, timestamp?: string) {
  const s = useStore.getState();
  // a moment of a regional fire (event, satellite pass, day): seek the timeline and show the place, no footage
  if (sourceId === 'progression' || sourceId === 'firms') {
    const e = eventId ? s.events.find((x) => x.event_id === eventId) : undefined;
    s.set({ playing: false, selectedEventId: eventId ?? s.selectedEventId });
    s.setTime(Date.parse(e?.timestamp ?? timestamp ?? new Date(s.time).toISOString()));
    if (e?.location) sceneRef.current?.flyToLonLat(e.location[0], e.location[1], 95);
    return;
  }
  const src = s.sources.find((x) => x.id === sourceId) ?? s.sources[0];
  if (!src) return;
  s.set({ playing: false, selectedSourceId: src.id, feedOpen: true, selectedEventId: eventId ?? s.selectedEventId });
  s.setTime(Date.parse(src.recorded_start) + startSeconds * 1000);
  const e = eventId ? s.events.find((x) => x.event_id === eventId) : undefined;
  if (e?.location) sceneRef.current?.flyToLonLat(e.location[0], e.location[1], 95);
}

/** A visual-search hit on the satellite archive: go to that pass, drape it, outline the place and fly there. */
export function showSatelliteHit(passTime: string, box: [number, number, number, number]) {
  const s = useStore.getState();
  s.set({ playing: false });
  if (!s.layers.satellite) s.setLayer('satellite', true);
  s.setTime(Date.parse(passTime) + 60e3);
  sceneRef.current?.highlightBox(box);
  sceneRef.current?.flyToBox(box);
}
