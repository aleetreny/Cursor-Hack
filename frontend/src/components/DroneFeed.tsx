import { useEffect, useRef, useState } from 'react';
import { useStore, videoSecondsAt } from '../state/store';
import { mediaUrl } from '../api/client';
import { formatLat, formatLon } from '../scene/geo';
import { fmtClock, fmtVideo } from '../lib/format';
import { Icon } from './Icon';

/** Drone camera window. The <video> follows the global timeline (the timeline is the master clock). */
export function DroneFeed() {
  const { sources, selectedSourceId, time, playing, speed, events, set } = useStore();
  const src = sources.find((s) => s.id === selectedSourceId) ?? sources[0];
  const v = useRef<HTMLVideoElement>(null);
  const [full, setFull] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const vs = videoSecondsAt(src, time);

  useEffect(() => {
    const el = v.current;
    if (!el || !src) return;
    const target = Math.min(src.duration_seconds, Math.max(0, vs));
    const drift = Math.abs(el.currentTime - target);
    if (playing) {
      el.playbackRate = Math.min(16, speed);
      if (el.paused) el.play().catch(() => {});
      if (drift > Math.max(1.5, speed * 0.6)) el.currentTime = target;
    } else {
      if (!el.paused) el.pause();
      if (drift > 0.08) el.currentTime = target;
    }
  }, [vs, playing, speed, src]);

  if (!src) return null;
  const p = src.pose;
  const heading = p?.yaw_deg != null ? ((p.yaw_deg % 360) + 360) % 360 : 0;
  const activeEvents = events.filter((e) => e.source_id === src.id && vs >= e.start_seconds - 0.5 && vs <= e.end_seconds + 4 && e.image_region);
  const corner = (pos: React.CSSProperties, b: string) => <div className="br-corner" style={{ ...pos, borderWidth: b }} />;
  return (
    <div className={'feed' + (full ? ' full' : '')}>
      <div className="vid">
        <video ref={v} src={mediaUrl(src.media_url)} muted playsInline preload="auto" onError={() => setErr('Video unavailable: ' + src.media_url)} />
        {err && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#bbb', fontSize: 12 }}>{err}</div>}
        <div className="hud">
          {corner({ left: 8, top: 8 }, '1.5px 0 0 1.5px')}{corner({ right: 8, top: 8 }, '1.5px 1.5px 0 0')}{corner({ left: 8, bottom: 8 }, '0 0 1.5px 1.5px')}{corner({ right: 8, bottom: 8 }, '0 1.5px 1.5px 0')}
          <div className="tl"><div className="rec">REPLAY {fmtVideo(vs)}</div><div>{src.id.toUpperCase().replace('DRONE_REPLAY_', 'UAV-')} · {src.label}</div><div>EO · RGB</div></div>
          <div className="tr"><div>{fmtClock(time)} UTC</div><div style={{ color: '#ffb347' }}>DRONE REPLAY</div></div>
          <div className="cross" />
          {activeEvents.map((e) => {
            const [x0, y0, x1, y1] = e.image_region!;
            return <div key={e.event_id} className={'roi ' + (e.severity === 'alert' ? 'alert' : '')} style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}><span>{e.title}</span></div>;
          })}
          <div className="bl"><div>ALT {p?.altitude_agl_m?.toFixed(1) ?? '—'} M AGL</div><div>HDG {heading.toFixed(0).padStart(3, '0')}°</div><div>GMB {p?.pitch_deg?.toFixed(1) ?? '—'}°</div></div>
          <div className="bc">{p ? `${formatLat(p.position[1])}  ${formatLon(p.position[0])}` : ''}<br />{src.georeferencing.method.replace(/_/g, ' ').toUpperCase()} · {src.georeferencing.accuracy.toUpperCase()}</div>
          <div className="br"><div>{src.width}×{src.height} · {src.fps} FPS</div><div>FOV {p?.hfov_deg?.toFixed(0) ?? '—'}°</div></div>
        </div>
      </div>
      <div className="feed-bar">
        <b>{src.id.toUpperCase().replace('DRONE_REPLAY_', 'UAV-')}</b><span style={{ color: '#999' }}>{src.label}</span>
        <div className="seg2"><button className="on">EO</button><button disabled title="No thermal sensor on this aircraft">IR</button></div>
        <span className="replay">RECORDED</span>
        <span className="sp" />
        <span style={{ color: '#999' }}>{fmtVideo(vs)} / {fmtVideo(src.duration_seconds)}</span>
        <button onClick={() => setFull(!full)} title="Full camera view"><Icon name="full" size={13} /></button>
        <button onClick={() => set({ feedOpen: false })} title="Close"><Icon name="x" size={13} /></button>
      </div>
    </div>
  );
}
