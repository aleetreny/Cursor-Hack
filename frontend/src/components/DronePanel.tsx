import { useShallow } from 'zustand/react/shallow';
import { useStore, videoSecondsAt, qt } from '../state/store';
import { sceneRef } from '../scene/SceneView';
import { formatLat, formatLon } from '../scene/geo';
import { fmtNum, fmtVideo } from '../lib/format';
import { SIM_UNITS, unitState } from '../sim/ops';
import { useSimCtx } from '../sim/useSim';
import { Icon } from './Icon';


export function DronePanel() {
  const { sources, selectedSourceId, selectedUnitId, set, time, feedOpen, follow } = useStore(useShallow((s) => ({ sources: s.sources, selectedSourceId: s.selectedSourceId, selectedUnitId: s.selectedUnitId, set: s.set, time: qt(s.time, 1000), feedOpen: s.feedOpen, follow: s.follow })));
  const ctx = useSimCtx();
  const src = sources.find((s) => s.id === selectedSourceId) ?? sources[0];
  const simSel = selectedUnitId?.startsWith('FT-') ? SIM_UNITS.find((u) => u.id === selectedUnitId) : undefined;
  const p = src?.pose;
  const heading = p?.yaw_deg != null ? ((p.yaw_deg % 360) + 360) % 360 : null;
  const vs = videoSecondsAt(src, time);
  const drones = SIM_UNITS.filter((u) => u.group === 'drones');
  return (
    <div className="scroll">
      <div className="section" style={{ padding: '10px 0 6px' }}>
        <div className="section-h" style={{ padding: '0 12px' }}><span>Drone Fleet <small>{sources.length} real · {drones.length} simulated</small></span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#b8641c', letterSpacing: '.05em' }} title="UAV-01 is a recorded flight, replayed in sync with the timeline">● REPLAY</span></div>
        {sources.map((s) => (
          <div key={s.id} className={'fleet-row' + (!simSel && s.id === src?.id ? ' sel' : '')} onClick={() => { set({ selectedSourceId: s.id, selectedUnitId: null, feedOpen: true, follow: null }); sceneRef.current?.flyToDrone(); }}>
            <div className="fleet-ic"><Icon name="drone" size={15} /></div>
            <div style={{ minWidth: 0 }}><div className="fleet-name">{s.id.toUpperCase().replace('DRONE_REPLAY_', 'UAV-')} <span>{s.label}</span></div><div className="fleet-sub">Hover · fire-front watch</div></div>
            <div><div className="fleet-state"><span className="real-tag">REAL</span></div><div className="fleet-sub" style={{ textAlign: 'right' }}>{fmtNum(s.pose?.altitude_agl_m, 1)} m AGL</div></div>
          </div>
        ))}
        {ctx && drones.map((u) => {
          const st = unitState(u, time, ctx);
          return (
            <div key={u.id} className={'fleet-row' + (simSel?.id === u.id ? ' sel' : '')} onClick={() => set({ selectedUnitId: u.id, feedOpen: true, follow: null })}>
              <div className="fleet-ic"><Icon name="drone" size={15} /></div>
              <div style={{ minWidth: 0 }}><div className="fleet-name">{u.id} <span>{u.name}</span></div><div className="fleet-sub">{u.mission}</div></div>
              <div><div className="fleet-state"><span className="sim-tag">SIM</span> {Math.round(st.battery ?? 0)}%</div><div className="fleet-sub" style={{ textAlign: 'right' }}>{fmtNum(st.agl)} m AGL</div></div>
            </div>
          );
        })}
      </div>
      {simSel && ctx ? (() => {
        const st = unitState(simSel, time, ctx);
        return (
          <div className="section">
            <div className="section-h">{simSel.id} {simSel.name} <span className="sim-tag">SIMULATED</span></div>
            <div className="bigstats">
              <div><div className="l">Altitude</div><div className="v">{fmtNum(st.agl * 3.281)}</div><div className="u">ft AGL</div></div>
              <div><div className="l">Ground speed</div><div className="v">{fmtNum(st.speedKt)}</div><div className="u">kn</div></div>
              <div><div className="l">Heading</div><div className="v">{fmtNum(st.heading)}°</div><div className="u">{['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(st.heading / 45) % 8]}</div></div>
              <div><div className="l">Battery</div><div className="v">{fmtNum(st.battery)}%</div><div className="u">simulated</div></div>
              <div><div className="l">Link</div><div className="v">{st.link}</div><div className="u">dBm (sim)</div></div>
              <div><div className="l">Flight time</div><div className="v mono" style={{ fontSize: 17 }}>{fmtVideo(st.flightS)}</div><div className="u">since t₀</div></div>
            </div>
            <dl className="kv">
              <dt>Aircraft</dt><dd>{simSel.type}</dd><dt>Mission</dt><dd>{simSel.mission}</dd><dt>Task</dt><dd>{simSel.task}</dd><dt>Sensor</dt><dd>{simSel.sensor}</dd>
              <dt>Position</dt><dd className="mono" style={{ fontSize: 11 }}>{formatLat(st.lat)} {formatLon(st.lon)}</dd>
            </dl>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-red" onClick={() => set({ feedOpen: !feedOpen })}><Icon name="video" size={12} /> {feedOpen ? 'Hide camera view' : 'Show camera view'}</button>
              <button className={'btn-dark'} onClick={() => set({ follow: follow?.id === simSel.id ? null : { id: simSel.id, mode: 'chase' } })}>{follow?.id === simSel.id ? 'Stop follow' : 'Follow'}</button>
            </div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Simulated aircraft and camera: the view is rendered from the 3D twin, not recorded footage.</div>
          </div>
        );
      })() : src && (
        <div className="section">
          <div className="section-h">{src.label} <span className="real-tag">REAL FOOTAGE</span></div>
          <div className="bigstats">
            <div><div className="l">Altitude</div><div className="v">{fmtNum(p?.altitude_agl_m, 1)}</div><div className="u">m AGL</div></div>
            <div><div className="l">Gimbal pitch</div><div className="v">{fmtNum(p?.pitch_deg, 1)}°</div><div className="u">below horizon</div></div>
            <div><div className="l">Heading</div><div className="v">{fmtNum(heading)}°</div><div className="u">{heading != null ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8] : ''}</div></div>
            <div><div className="l">Field of view</div><div className="v">{fmtNum(p?.hfov_deg, 1)}°</div><div className="u">horizontal</div></div>
            <div><div className="l">Video time</div><div className="v mono" style={{ fontSize: 17 }}>{fmtVideo(vs)}</div><div className="u">of {fmtVideo(src.duration_seconds)}</div></div>
            <div><div className="l">12 s clips</div><div className="v">{src.processing.clips_done}</div><div className="u">CV pass · of {src.processing.clips_total}</div></div>
          </div>
          <dl className="kv">
            <dt>Aircraft</dt><dd>DJI Phantom 4 Pro (FC6310)</dd>
            <dt>Mission</dt><dd>Stationary hover over burn front</dd>
            <dt>Sensor</dt><dd>EO / RGB only, no thermal</dd>
            <dt>Position</dt><dd className="mono" style={{ fontSize: 11 }}>{p ? `${formatLat(p.position[1])} ${formatLon(p.position[0])}` : '—'}</dd>
            <dt>Georef.</dt><dd>{src.georeferencing.method.replace(/_/g, ' ')} · {src.georeferencing.accuracy}</dd>
          </dl>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-red" onClick={() => set({ feedOpen: !feedOpen })}><Icon name="video" size={12} /> {feedOpen ? 'Hide camera view' : 'Show camera view'}</button>
            <button className="btn-dark" onClick={() => sceneRef.current?.flyToDrone()}>Follow</button>
          </div>
        </div>
      )}
    </div>
  );
}
