import { useEffect, useState } from 'react';
import { useStore, videoSecondsAt } from '../state/store';
import { api, USE_FIXTURES } from '../api/client';
import type { ProcessingState } from '../api/types';
import { loadAll } from '../state/load';
import { sceneRef } from '../scene/SceneView';
import { formatLat, formatLon } from '../scene/geo';
import { fmtNum, fmtVideo } from '../lib/format';
import { Icon } from './Icon';

const MODE_LABEL = { drone_replay: 'DRONE REPLAY', fixed_camera: 'FIXED CAMERA', simulated_live: 'SIMULATED LIVE', live: 'LIVE' } as const;

export function DronePanel() {
  const { sources, selectedSourceId, set, time, feedOpen } = useStore();
  const src = sources.find((s) => s.id === selectedSourceId) ?? sources[0];
  const p = src?.pose;
  const heading = p?.yaw_deg != null ? ((p.yaw_deg % 360) + 360) % 360 : null;
  const vs = videoSecondsAt(src, time);
  return (
    <div className="scroll">
      <div className="section" style={{ padding: '10px 0 6px' }}>
        <div className="section-h" style={{ padding: '0 12px' }}><span>Drone Fleet <small>{sources.length} source{sources.length === 1 ? '' : 's'}</small></span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#b8641c', letterSpacing: '.05em' }}>● REPLAY</span></div>
        {sources.map((s) => (
          <div key={s.id} className={'fleet-row' + (s.id === src?.id ? ' sel' : '')} onClick={() => { set({ selectedSourceId: s.id, feedOpen: true }); sceneRef.current?.flyToDrone(); }}>
            <div className="fleet-ic"><Icon name="drone" size={15} /></div>
            <div><div className="fleet-name">{s.id.toUpperCase().replace('DRONE_REPLAY_', 'UAV-')} <span>{s.label}</span></div><div className="fleet-sub">Hover · fire-front watch</div></div>
            <div><div className="fleet-state">{MODE_LABEL[s.mode]}</div><div className="fleet-sub" style={{ textAlign: 'right' }}>{fmtNum(s.pose?.altitude_agl_m, 1)} m AGL</div></div>
          </div>
        ))}
      </div>
      {src && (
        <div className="section">
          <div className="section-h">{src.label} <span className="tag" style={{ background: '#fbe7cf', color: '#8a4b00' }}>{MODE_LABEL[src.mode]}</span></div>
          <div className="bigstats">
            <div><div className="l">Altitude</div><div className="v">{fmtNum(p?.altitude_agl_m, 1)}</div><div className="u">m AGL</div></div>
            <div><div className="l">Gimbal pitch</div><div className="v">{fmtNum(p?.pitch_deg, 1)}°</div><div className="u">below horizon</div></div>
            <div><div className="l">Heading</div><div className="v">{fmtNum(heading)}°</div><div className="u">{heading != null ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8] : ''}</div></div>
            <div><div className="l">Field of view</div><div className="v">{fmtNum(p?.hfov_deg, 1)}°</div><div className="u">horizontal</div></div>
            <div><div className="l">Video time</div><div className="v mono" style={{ fontSize: 17 }}>{fmtVideo(vs)}</div><div className="u">of {fmtVideo(src.duration_seconds)}</div></div>
            <div><div className="l">Clips analyzed</div><div className="v">{src.processing.clips_done}</div><div className="u">of {src.processing.clips_total}</div></div>
          </div>
          <dl className="kv">
            <dt>Aircraft</dt><dd>DJI Phantom 4 Pro (FC6310)</dd>
            <dt>Mission</dt><dd>Stationary hover over burn front</dd>
            <dt>Sensor</dt><dd>EO / RGB only, no thermal</dd>
            <dt>Position</dt><dd className="mono" style={{ fontSize: 11 }}>{p ? `${formatLat(p.position[1])} ${formatLon(p.position[0])}` : '—'}</dd>
            <dt>Georef.</dt><dd>{src.georeferencing.method.replace(/_/g, ' ')} · {src.georeferencing.accuracy}</dd>
            <dt>Stream</dt><dd>{src.fps} fps · {src.width}×{src.height}</dd>
            <dt>Processing</dt><dd><span className={'status-dot ' + (src.processing.state === 'done' ? 'ok' : 'warn')} />{src.processing.state} · {Math.round(src.processing.progress * 100)}%</dd>
          </dl>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-red" onClick={() => set({ feedOpen: !feedOpen })}><Icon name="full" size={12} /> {feedOpen ? 'Hide camera view' : 'Show camera view'}</button>
            <button className="btn-dark" onClick={() => sceneRef.current?.flyToDrone()}>Follow</button>
          </div>
        </div>
      )}
      {src && <AnalyzeSection sourceId={src.id} />}
    </div>
  );
}

function AnalyzeSection({ sourceId }: { sourceId: string }) {
  const [st, setSt] = useState<ProcessingState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const health = useStore((s) => s.health);
  const cosmos = health?.integrations.find((i) => i.id === 'nvidia_cosmos_reason');
  useEffect(() => {
    if (st?.state !== 'processing') return;
    const t = setInterval(async () => {
      try {
        const r = await api.status(sourceId);
        setSt(r.processing);
        if (r.processing.state === 'done') { clearInterval(t); loadAll(); }
      } catch (e) { setErr(String(e)); }
    }, 1500);
    return () => clearInterval(t);
  }, [st?.state, sourceId]);
  const run = async () => {
    setErr(null);
    try { const r = await api.analyze({ source_id: sourceId }); setSt(r.processing.state === 'idle' ? { ...r.processing, state: 'processing' } : r.processing); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="section">
      <div className="section-h">Video Intelligence <small>NVIDIA Cosmos Reason</small></div>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4, marginBottom: 8 }}>Splits the replay into 12 s clips and asks Cosmos Reason what is visible and what changed. Events and the search index update when it finishes.</div>
      <dl className="kv" style={{ marginBottom: 8 }}>
        <dt>Model</dt><dd className="mono" style={{ fontSize: 11 }}>{cosmos?.model ?? '—'}</dd>
        <dt>Status</dt><dd><span className={'status-dot ' + (cosmos?.status === 'ok' ? 'ok' : cosmos?.status === 'not_configured' ? '' : 'warn')} />{cosmos?.status?.replace('_', ' ') ?? '—'}</dd>
        {cosmos?.detail && <><dt>Detail</dt><dd style={{ fontSize: 11.5 }}>{cosmos.detail}</dd></>}
      </dl>
      {st && st.state !== 'idle' && (
        <div style={{ margin: '6px 0 8px' }}>
          <div style={{ height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${Math.round(st.progress * 100)}%`, height: '100%', background: 'var(--red)', transition: 'width .4s' }} /></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{st.state} · {st.message}</div>
        </div>
      )}
      <button className="btn-ghost" disabled={USE_FIXTURES || st?.state === 'processing'} onClick={run}><Icon name="spark" size={12} /> {st?.state === 'processing' ? 'Analyzing…' : 'Run Cosmos analysis'}</button>
      {err && <div className="err">{err}</div>}
    </div>
  );
}
