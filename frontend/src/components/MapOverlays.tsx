import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../state/store';
import { sceneRef } from '../scene/SceneView';
import { aspectName, formatLat, formatLon } from '../scene/geo';
import { fmtClock, fmtArea } from '../lib/format';
import { Icon } from './Icon';

function niceScale(mpp: number) {
  const target = mpp * 90;
  const pow = 10 ** Math.floor(Math.log10(target));
  const n = [1, 2, 2.5, 5, 10].map((k) => k * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  return { m: n, px: n / mpp };
}
const fmtM = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/** Full-screen the map pane (its overlays and the drone camera come along); Safari needs the webkit prefix. */
function toggleFullscreen() {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const map = document.querySelector('.map') as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
  if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d); return; }
  if (!map) return;
  const req = map.requestFullscreen?.bind(map) ?? map.webkitRequestFullscreen?.bind(map);
  if (!req) { useStore.getState().notify('Full screen is not available in this browser'); return; }
  Promise.resolve(req()).catch(() => useStore.getState().notify('Full screen was blocked by the browser'));
}

export function MapOverlays() {
  const { cam, view, set, hover, loadMsg, loadError, loaded, compare, time, features, layers, incident, scenario, feedOpen } = useStore(useShallow((s) => ({ cam: s.cam, view: s.view, set: s.set, hover: s.hover, loadMsg: s.loadMsg, loadError: s.loadError, loaded: s.loaded, compare: s.compare, time: s.compare.on ? s.time : 0, features: s.features, layers: s.layers, incident: s.incident, scenario: s.scenario, feedOpen: s.feedOpen })));
  const sc = niceScale(cam.metersPerPx || 1);
  const burnedAt = (t: number) => {
    let best: number | null = null, bt = -Infinity;
    for (const f of features) if (f.properties.classification === 'burned_area') { const ft = Date.parse(f.properties.timestamp); if (ft <= t && ft > bt) { bt = ft; best = f.properties.area_m2 ?? null; } }
    return best;
  };
  const delta = compare.on && compare.before != null ? (burnedAt(time) ?? 0) - (burnedAt(compare.before) ?? 0) : null;
  const da = fmtArea(delta);

  return (
    <>
      <div className={'loading' + (loaded && !loadMsg ? ' done' : '')}>
        <div style={{ textAlign: 'center' }}>
          {loadError ? <div className="err">Failed to load: {loadError}</div> : <><div className="sp" /><div>{loadMsg || 'Loading'}…</div></>}
        </div>
      </div>

      <div className="compass" role="button" tabIndex={0} aria-label="Reset north" onClick={() => sceneRef.current?.resetNorth()} onKeyDown={(e) => { if (e.key === 'Enter') sceneRef.current?.resetNorth(); }} title="Reset north">
        <svg width="36" height="36" viewBox="0 0 36 36" style={{ transform: `rotate(${cam.azimuth}deg)` }}>
          <path d="M18 9l4.5 14L18 20l-4.5 3z" fill="#fff" />
          <path d="M18 9v11l-4.5 3z" fill="#d8d2c8" />
          <text x="18" y="7.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">N</text>
        </svg>
      </div>

      <div className={'banner' + (feedOpen ? ' left' : '')}>
        {compare.on && compare.before != null && (
          <span className="pill"><Icon name="compare" size={12} /> BEFORE {fmtClock(compare.before)} ┆ CURRENT {fmtClock(time)} · Δ burned <b>{delta != null && delta >= 0 ? '+' : ''}{da.v} {da.u}</b></span>
        )}
        {layers.projection && <span className="pill exp" title={`Illustrative wind- and slope-driven spread on the real terrain. The 15-minute timeline replays the scenario as a ×${Math.round(scenario.lapse)} time-lapse.`}>SIMULATED FIRE SCENARIO · T+{Math.floor(scenario.hours)}h{String(Math.floor((scenario.hours % 1) * 60)).padStart(2, '0')} · {Math.round(scenario.ha).toLocaleString('en-US')} ha · ×{Math.round(scenario.lapse).toLocaleString('en-US')} time-lapse · NOT A FORECAST</span>}
      </div>

      {hover && !useStore.getState().presenting && (
        <div className="hovertip" style={{ left: hover.x, top: hover.y, transform: `translate(${hover.x > (document.querySelector('.map')?.clientWidth ?? 9999) - 290 ? 'calc(-100% - 14px)' : '14px'}, ${hover.y > (document.querySelector('.map')?.clientHeight ?? 9999) - 110 ? 'calc(-100% - 14px)' : '14px'})` }}>
          <div><b>{Math.round(hover.elevation).toLocaleString()} m</b> · {Math.round(hover.slope)}° slope · {aspectName(hover.aspect)}-facing</div>
          <div><span className={'dot' + (hover.inBurned ? ' burn' : '')} />{hover.inBurned ? 'Inside observed burned area' : hover.inPerimeter ? 'Inside planned burn cell' : 'Outside burn cell'}</div>
          <div className="c">{formatLat(hover.lat)} {formatLon(hover.lon)}</div>
        </div>
      )}

      <div className="mapctl">
        <div className="scalebar">
          <div className="nums"><span>0</span><span>{fmtM(sc.m / 2)}</span><span>{fmtM(sc.m)}</span></div>
          <div className="bar" style={{ width: sc.px }} />
        </div>
        <div className="ctlgrp">
          <button className={view === '2d' ? 'on' : ''} onClick={() => set({ view: '2d' })}>2D</button>
          <button className={view === '3d' ? 'on' : ''} onClick={() => set({ view: '3d' })}>3D</button>
        </div>
        <div className="ctlgrp">
          <button onClick={() => sceneRef.current?.zoomBy(1.4)} title="Zoom out" aria-label="Zoom out">−</button>
          <button style={{ minWidth: 44, justifyContent: 'center' }} onClick={() => sceneRef.current?.flyHome()} title="Reset view (H)">{cam.zoom >= 1 ? cam.zoom.toFixed(1) : cam.zoom.toFixed(2)}×</button>
          <button onClick={() => sceneRef.current?.zoomBy(1 / 1.4)} title="Zoom in" aria-label="Zoom in">+</button>
        </div>
        <div className="ctlgrp">
          <button onClick={toggleFullscreen} title="Full-screen map (Esc to leave)" aria-label="Full-screen map"><Icon name="full" size={13} /></button>
        </div>
      </div>
      <div className="attribution">{incident?.attribution.join(' · ')} · DEM ×{useStore.getState().exaggeration} vertical</div>
    </>
  );
}
