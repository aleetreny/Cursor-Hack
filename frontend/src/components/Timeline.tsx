import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../state/store';
import { profileRef, selectEvent } from '../scene/SceneView';
import { fmtClock, fmtDay, fmtDayClock } from '../lib/format';
import type { AnalysisEvent, EventType } from '../api/types';
import { Icon } from './Icon';
import { MiniChart, type Pt } from './MiniChart';
import { SIM_UNITS, opsTotals, unitState } from '../sim/ops';
import { useSimCtx } from '../sim/useSim';
import { useMemo } from 'react';

const SPEEDS = [1, 4, 8, 16, 32];

export function eventIcon(t: EventType, sev: AnalysisEvent['severity'], size = 12) {
  const c = sev === 'alert' ? '#d2402a' : sev === 'watch' ? '#ea7a2c' : '#8b8379';
  if (t === 'first_visible_flames' || t === 'new_fire_activity') return <span style={{ width: size - 2, height: size - 2, borderRadius: '50%', background: c, display: 'inline-block' }} />;
  if (t === 'visible_fire_expansion' || t === 'intensity_change') return <Icon name="flame" size={size} color={c} />;
  if (t === 'smoke_increase' || t === 'smoke_decrease') return <Icon name="smoke" size={size} color={c} />;
  if (t === 'burned_ground_visible') return <span style={{ width: size - 3, height: size - 3, borderRadius: 2, background: '#9aa7b4', display: 'inline-block' }} />;
  return <Icon name="tri" size={size} color={c} />;
}

function smooth(pts: Pt[], n: number): Pt[] {
  return pts.map((p, i) => {
    const w = pts.slice(Math.max(0, i - n + 1), i + 1).filter((q) => q.y != null);
    return { x: p.x, y: w.length ? w.reduce((a, q) => a + (q.y as number), 0) / w.length : null };
  });
}

function useProfile() {
  return useSyncExternalStore((cb) => { profileRef.listeners.add(cb); return () => profileRef.listeners.delete(cb); }, () => profileRef.current);
}

export function Timeline() {
  const { t0, t1, time, playing, speed, set, setTime, events, timeline, selectedEventId, mode, compare } = useStore();
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'time' | 'before' | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const span = t1 - t0 || 1;
  const pct = (t: number) => ((t - t0) / span) * 100;

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const r = track.current!.getBoundingClientRect();
      const t = t0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * span;
      if (drag === 'time') setTime(t); else set({ compare: { on: true, before: Math.min(t, useStore.getState().time) } });
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, t0, span, setTime, set]);

  // minute ticks
  const ticks: { t: number; label: string; day?: string }[] = [];
  const [trackW, setTrackW] = useState(700);
  useEffect(() => { const el = track.current; if (!el) return; const ro = new ResizeObserver(() => setTrackW(el.clientWidth)); ro.observe(el); return () => ro.disconnect(); }, []);
  const maxTicks = Math.max(3, Math.floor(trackW / 58));
  // keep the time bubble inside the track; fade the header labels it would cover
  const BW = 124;
  const bubbleX = (t: number) => Math.min(trackW - BW / 2, Math.max(BW / 2, (pct(t) / 100) * trackW));
  const curX = (pct(time) / 100) * trackW;
  const hideRange = curX > trackW - 300, hideSub = curX < 260;
  // cluster markers closer than 18 px; the most severe event leads the cluster
  const SEV = { alert: 0, watch: 1, info: 2 } as const;
  const clusters: { x: number; items: typeof events }[] = [];
  for (const e of events) {
    const x = (pct(Date.parse(e.timestamp)) / 100) * trackW, last = clusters[clusters.length - 1];
    if (last && x - last.x < 18) last.items.push(e); else clusters.push({ x, items: [e] });
  }
  for (const c of clusters) c.items.sort((a, b) => SEV[a.severity] - SEV[b.severity] || Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const stepMs = [30000, 60000, 120000, 300000, 600000, 1800000, 3600000].find((st) => span / st <= maxTicks) ?? 3600000;
  for (let t = Math.ceil(t0 / stepMs) * stepMs; t <= t1; t += stepMs) ticks.push({ t, label: fmtClock(t, false) });
  if (ticks.length) ticks[0].day = fmtDay(t0);

  const frames = timeline?.frames ?? [];
  const xLab = (n = 4) => Array.from({ length: n + 1 }, (_, i) => { const t = t0 + (span * i) / n; return { x: t, label: fmtClock(t, false) }; });
  const ser = (fn: (f: (typeof frames)[number]) => number | null | undefined): Pt[] => frames.map((f) => ({ x: Date.parse(f.timestamp), y: fn(f) ?? null }));
  const stepS = frames.length > 1 ? (Date.parse(frames[1].timestamp) - Date.parse(frames[0].timestamp)) / 1000 : 4;
  const profile = useProfile();
  const frontIdx = profile.findIndex((p) => p.burned);

  const simCtx = useSimCtx();
  const selUnit = useStore((st) => st.selectedUnitId);
  const opsSeries = useMemo(() => {
    if (!simCtx) return null;
    const xs = Array.from({ length: 91 }, (_, i) => t0 + (span * i) / 90);
    const tots = xs.map((x) => opsTotals(x, simCtx));
    return { gal: xs.map((x, i) => ({ x, y: tots[i].gal })), chains: xs.map((x, i) => ({ x, y: tots[i].chains })), pers: xs.map((x, i) => ({ x, y: tots[i].personnel })) };
  }, [simCtx, t0, span]);
  const droneSeries = useMemo(() => {
    const u = SIM_UNITS.find((x) => x.id === selUnit && x.group === 'drones');
    if (!simCtx || !u) return null;
    const xs = Array.from({ length: 121 }, (_, i) => t0 + (span * i) / 120);
    return { alt: xs.map((x) => ({ x, y: unitState(u, x, simCtx).agl * 3.281 })), bat: xs.map((x) => ({ x, y: unitState(u, x, simCtx).battery ?? null })) };
  }, [simCtx, selUnit, t0, span]);
  const charts = mode === 'resources' && opsSeries
    ? [
      { title: 'Retardant / Water Dropped', unit: 'gal', pts: opsSeries.gal, color: '#c0392b', kind: 'area' as const, prov: 'demo_parameter' },
      { title: 'Fire Line Built', unit: 'chains', pts: opsSeries.chains, color: '#7c5a3a', kind: 'area' as const, prov: 'demo_parameter' },
      { title: 'Personnel Assigned', unit: 'count', pts: opsSeries.pers, color: '#5f7a4c', kind: 'area' as const, prov: 'demo_parameter' },
    ]
    : mode === 'drones' && droneSeries
    ? [
      { title: `Altitude · ${selUnit}`, unit: 'ft AGL', pts: droneSeries.alt, color: '#d2402a', kind: 'line' as const, prov: 'demo_parameter' },
      { title: 'Active Fire Area', unit: 'm² · UAV-01', pts: ser((f) => f.active_fire_area_m2.value), color: '#e8742c', kind: 'area' as const, prov: frames[0]?.active_fire_area_m2.provenance },
      { title: `Battery · ${selUnit}`, unit: '%', pts: droneSeries.bat, color: '#5f7a4c', kind: 'line' as const, prov: 'demo_parameter' },
    ]
    : mode === 'drones'
    ? [
      { title: 'Burned Area in View', unit: 'm²', pts: ser((f) => f.burned_area_m2.value), color: '#c9503a', kind: 'area' as const, prov: frames[0]?.burned_area_m2.provenance },
      { title: 'Active Fire Area', unit: 'm²', pts: ser((f) => f.active_fire_area_m2.value), color: '#e8742c', kind: 'area' as const, prov: frames[0]?.active_fire_area_m2.provenance },
      { title: 'Flame Hotspots (RGB)', unit: 'count', pts: ser((f) => f.hotspot_count.value), color: '#b8641c', kind: 'line' as const, prov: frames[0]?.hotspot_count.provenance },
    ]
    : [
      { title: 'Burned Area', unit: 'm²', pts: ser((f) => f.burned_area_m2.value), color: '#c9503a', kind: 'area' as const, prov: frames[0]?.burned_area_m2.provenance },
      { title: 'Rate of Spread', unit: 'm²/min · 40 s avg', pts: smooth(ser((f) => (f.area_change_m2.value == null ? null : Math.max(0, (f.area_change_m2.value / stepS) * 60))), 10), color: '#cf3b2a', kind: 'line' as const, prov: frames[0]?.area_change_m2.provenance },
    ];

  return (
    <div className="bottom">
      <div className="tl">
        <div className="tl-top">
          <div className="tl-head"><span>Timeline <span className="muted" style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 6, transition: 'opacity .25s', opacity: hideSub ? 0 : 1 }}>UTC · drone replay</span></span><span className="range" style={{ transition: 'opacity .25s', opacity: hideRange ? 0 : 1 }}>{t0 ? `${fmtDayClock(t0)} – ${fmtClock(t1)}` : ''}</span></div>
          <div className="tl-row">
            <div className="tl-ctrl">
              <button onClick={() => set({ playing: true })} className={playing ? 'on' : ''} title="Play"><Icon name="play" size={12} /></button>
              <button onClick={() => set({ playing: false })} className={!playing ? 'on' : ''} title="Pause"><Icon name="pause" size={12} /></button>
              <button onClick={() => { const nx = events.find((e) => Date.parse(e.timestamp) > time + 1000); if (nx) selectEvent(nx.event_id); }} title="Next event"><Icon name="step" size={12} /></button>
              <div style={{ position: 'relative' }}>
                <button className="speed" onClick={() => setSpeedOpen(!speedOpen)}>{speed}× <Icon name="chev" size={10} /></button>
                {speedOpen && <div className="menu-pop" style={{ top: 'auto', bottom: 28, left: 0, minWidth: 70 }}>{SPEEDS.map((s) => <button key={s} onClick={() => { set({ speed: s }); setSpeedOpen(false); }}>{s}×</button>)}</div>}
              </div>
            </div>
            <div className="track" ref={track} onPointerDown={(e) => { const r = track.current!.getBoundingClientRect(); setTime(t0 + ((e.clientX - r.left) / r.width) * span); set({ playing: false }); setDrag('time'); }}>
              <div className="rail"><div className="fill" style={{ width: `${pct(time)}%` }} /></div>
              {clusters.map((c) => {
                const lead = c.items.find((e) => e.event_id === selectedEventId) ?? c.items[0];
                const sel = c.items.some((e) => e.event_id === selectedEventId);
                return (
                  <div key={lead.event_id} className={'mk' + (sel ? ' sel' : '')} style={{ left: c.x }}
                    title={c.items.map((e) => `${fmtClock(Date.parse(e.timestamp), false)}  ${e.title}`).join('\n')}
                    onPointerDown={(ev) => { ev.stopPropagation(); selectEvent(lead.event_id); }}>
                    {eventIcon(lead.event_type, lead.severity, 11)}{c.items.length > 1 && <span className="mk-n">{c.items.length}</span>}
                  </div>
                );
              })}
              {compare.on && compare.before != null && (
                <>
                  <div className="bubble before" style={{ left: bubbleX(compare.before) }}>Before {fmtClock(compare.before)}</div>
                  <div className="handle before" style={{ left: `${pct(compare.before)}%` }} onPointerDown={(e) => { e.stopPropagation(); setDrag('before'); }} />
                </>
              )}
              <div className="bubble" style={{ left: bubbleX(time) }}>{fmtDayClock(time)}</div>
              <div className="handle" style={{ left: `${pct(time)}%` }} />
              <div className="ticks">
                {ticks.map((k) => <div key={k.t} className="tick" style={{ left: `${pct(k.t)}%` }}>{k.label}</div>)}
              </div>
            </div>
          </div>
        </div>
        <div className="charts">
          {charts.map((c) => (
            <div className="chart" key={c.title}>
              <div className="chart-h"><span>{c.title} <small>({c.unit})</small>{c.prov && <span className={'prov ' + c.prov}>{c.prov === 'demo_parameter' ? 'sim' : c.prov}</span>}</span><span className="muted">⋮</span></div>
              <MiniChart pts={c.pts} cursor={time} color={c.color} kind={c.kind} xTicks={xLab()} />
            </div>
          ))}
          {mode !== 'drones' && mode !== 'resources' && (
            <div className="chart">
              <div className="chart-h"><span>Elevation Profile <small>(drone line of sight)</small><span className="prov external">DEM</span></span><span className="muted">⋮</span></div>
              <MiniChart pts={profile.map((p) => ({ x: p.d, y: p.elev }))} cursor={frontIdx >= 0 ? profile[frontIdx].d : null} color="#5f7a4c" fill="#7f9a68" kind="area" zero={false}
                xTicks={[0, 40, 80, 120, 160].map((d) => ({ x: d, label: `${d} m` }))} />
            </div>
          )}
        </div>
      </div>
      {mode === 'resources' ? <AirOpsLog /> : <KeyEvents />}
    </div>
  );
}

function AirOpsLog() {
  const { time, set, setTime } = useStore();
  const ctx = useSimCtx();
  if (!ctx) return null;
  const drops = opsTotals(time, ctx).drops.slice().reverse();
  return (
    <div className="events">
      <div className="events-h"><span>Air Ops Log <span className="badge" style={{ marginLeft: 4 }}>{drops.length}</span></span><span className="sim-tag">SIM</span></div>
      <div className="scroll">
        {drops.map((d, i) => (
          <div key={i} className="ev" onClick={() => { set({ selectedUnitId: d.unitId, follow: null, playing: false }); setTime(d.t); }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: d.kind === 'retardant' ? '#c0392b' : '#3b82f6', display: 'inline-block' }} />
            <span className="ev-title">{d.unitId} · {d.gal.toLocaleString()} gal {d.kind}</span>
            <span className="t">{fmtClock(d.t, false)}</span>
          </div>
        ))}
        {!drops.length && <div className="muted" style={{ padding: 10, fontSize: 12 }}>No drops yet at this time.</div>}
      </div>
    </div>
  );
}

function KeyEvents() {
  const { events, time, selectedEventId, mode, set } = useStore();
  const list = mode === 'drones' ? events.filter((e) => e.severity !== 'info') : events;
  return (
    <div className="events">
      <div className="events-h">{mode === 'drones' ? <span>Detections <span className="badge" style={{ marginLeft: 4 }}>{list.length}</span></span> : 'Key Events'}
        <button className="btn-sm" onClick={() => set({ panel: 'evidence', mode: 'incident' })}><Icon name="search" size={11} /> Find</button>
      </div>
      <div className="scroll">
        {list.map((e) => (
          <div key={e.event_id} className={'ev' + (e.event_id === selectedEventId ? ' sel' : '') + (Date.parse(e.timestamp) > time ? ' future' : '')} onClick={() => selectEvent(e.event_id)} title={e.description}>
            {eventIcon(e.event_type, e.severity)}
            <span className="ev-title">{e.title}</span>
            <span className="t">{fmtClock(Date.parse(e.timestamp), false)}</span>
          </div>
        ))}
        {!list.length && <div className="muted" style={{ padding: 10, fontSize: 12 }}>No events yet.</div>}
      </div>
    </div>
  );
}
