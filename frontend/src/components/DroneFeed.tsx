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
  const [sensor, setSensor] = useState<'EO' | 'IR'>('EO');
  const [palette, setPalette] = useState<'ironbow' | 'whitehot'>('ironbow');
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);   // top-left offset inside the map pane
  const box = useRef<HTMLDivElement>(null);
  const startDrag = (e: React.PointerEvent) => {
    if (full || (e.target as HTMLElement).closest('button')) return;
    const el = box.current!, map = el.parentElement!.getBoundingClientRect(), r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev: PointerEvent) => setPos({ x: Math.min(map.width - r.width - 10, Math.max(10, ev.clientX - map.left - dx)), y: Math.min(map.height - r.height - 10, Math.max(10, ev.clientY - map.top - dy)) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  useEffect(() => {   // keep inside the map pane when the window resizes
    const fix = () => setPos((p) => { const el = box.current; if (!p || !el) return p; const m = el.parentElement!.getBoundingClientRect(); return { x: Math.min(p.x, Math.max(10, m.width - el.offsetWidth - 10)), y: Math.min(p.y, Math.max(10, m.height - el.offsetHeight - 10)) }; });
    window.addEventListener('resize', fix); return () => window.removeEventListener('resize', fix);
  }, []);
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
    <div ref={box} className={'feed' + (full ? ' full' : '')} style={!full && pos ? { left: pos.x, top: pos.y, right: 'auto' } : undefined}>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <filter id="lut-ironbow"><feColorMatrix type="saturate" values="0" /><feComponentTransfer>
          <feFuncR type="table" tableValues="0.02 0.25 0.62 0.88 0.98 1" /><feFuncG type="table" tableValues="0 0.01 0.06 0.34 0.72 0.98" /><feFuncB type="table" tableValues="0.08 0.42 0.55 0.22 0.08 0.75" /></feComponentTransfer></filter>
        <filter id="lut-whitehot"><feColorMatrix type="saturate" values="0" /><feComponentTransfer><feFuncR type="gamma" exponent="1.3" /><feFuncG type="gamma" exponent="1.3" /><feFuncB type="gamma" exponent="1.3" /></feComponentTransfer></filter>
      </svg>
      <div className="vid">
        <video ref={v} src={mediaUrl(src.media_url)} muted playsInline preload="auto" onError={() => setErr('Video unavailable: ' + src.media_url)}
          style={{ transform: `scale(${zoom})`, filter: sensor === 'IR' ? `url(#lut-${palette})` : undefined }} />
        {err && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#bbb', fontSize: 12 }}>{err}</div>}
        <div className="hud">
          {corner({ left: 8, top: 8 }, '1.5px 0 0 1.5px')}{corner({ right: 8, top: 8 }, '1.5px 1.5px 0 0')}{corner({ left: 8, bottom: 8 }, '0 0 1.5px 1.5px')}{corner({ right: 8, bottom: 8 }, '0 1.5px 1.5px 0')}
          <div className="tl"><div className="rec">REPLAY {fmtVideo(vs)}</div><div>{src.id.toUpperCase().replace('DRONE_REPLAY_', 'UAV-')} · {src.label}</div><div>{sensor === 'EO' ? 'EO · RGB' : `IR* · ${palette === 'ironbow' ? 'IRONBOW' : 'WHITE-HOT'}`}</div></div>
          <div className="tr"><div>{fmtClock(time)} UTC</div><div style={{ color: '#ffb347' }}>DRONE REPLAY</div>{sensor === 'IR' && <div style={{ color: '#ff8a8a' }}>IR LOOK · SIMULATED LUT<br />RGB luminance, not thermal</div>}</div>
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
      <div className="feed-bar" onPointerDown={startDrag} style={{ cursor: full ? 'default' : 'move' }}>
        <b>{src.id.toUpperCase().replace('DRONE_REPLAY_', 'UAV-')}</b><span className="feed-name">{src.label}</span>
        <div className="seg2"><button className={sensor === 'EO' ? 'on' : ''} onClick={() => setSensor('EO')}>EO</button><button className={sensor === 'IR' ? 'on' : ''} onClick={() => setSensor('IR')} title="False-colour look on RGB luminance — the aircraft has no thermal sensor">IR*</button></div>
        {sensor === 'IR' && <button className="feed-pal" onClick={() => setPalette(palette === 'ironbow' ? 'whitehot' : 'ironbow')}>{palette === 'ironbow' ? 'Ironbow' : 'White-hot'}</button>}
        <span className="replay">RECORDED</span>
        <span className="sp" />
        <span style={{ color: '#999' }}>{fmtVideo(vs)} / {fmtVideo(src.duration_seconds)}</span>
        <button onClick={() => setZoom(Math.max(1, +(zoom - 0.5).toFixed(1)))} title="Zoom out">−</button>
        <span style={{ color: '#bbb', minWidth: 30, textAlign: 'center' }}>{zoom.toFixed(1)}×</span>
        <button onClick={() => setZoom(Math.min(4, +(zoom + 0.5).toFixed(1)))} title="Zoom in">+</button>
        <button onClick={() => setFull(!full)} title="Full camera view"><Icon name="full" size={13} /></button>
        <button onClick={() => set({ feedOpen: false })} title="Close"><Icon name="x" size={13} /></button>
      </div>
    </div>
  );
}
