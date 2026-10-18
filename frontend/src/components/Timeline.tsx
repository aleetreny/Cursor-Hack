import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, qt } from '../state/store';
import { profileRef, selectEvent } from '../scene/SceneView';
import { fmtClock, fmtDay, fmtDayClock, fmtNow, fmtWhen, isMultiDay } from '../lib/format';
import { speedLabel, speedsFor, timeSteps } from '../lib/incident';
import { downloadCsv, useDismiss } from '../lib/ui';
import type { AnalysisEvent, EventType } from '../api/types';
import { Icon } from './Icon';
import { MiniChart, type Pt } from './MiniChart';
import { SIM_UNITS, opsTotals, unitState } from '../sim/ops';
import { useSimCtx } from '../sim/useSim';
import { useMemo } from 'react';

export function eventIcon(t: EventType, sev: AnalysisEvent['severity'], size = 12) {
  const c = sev === 'alert' ? '#d2402a' : sev === 'watch' ? '#ea7a2c' : '#8b8379';
  if (t === 'first_visible_flames' || t === 'new_fire_activity') return <span style={{ width: size - 2, height: size - 2, borderRadius: '50%', background: c, display: 'inline-block' }} />;
  if (t === 'visible_fire_expansion' || t === 'intensity_change') return <Icon name="flame" size={size} color={c} />;
  if (t === 'smoke_increase' || t === 'smoke_decrease') return <Icon name="smoke" size={size} color={c} />;
  if (t === 'burned_ground_visible') return <span style={{ width: size - 3, height: size - 3, borderRadius: 2, background: '#9aa7b4', display: 'inline-block' }} />;
  return <Icon name="tri" size={size} color={c} />;
}

/** Contiguous x ranges of a profile where `test` holds, as chart bands. */
function spans<T extends { d: number }>(p: T[], test: (q: T) => boolean, color: string) {
  const out: { x0: number; x1: number; color: string }[] = [];
  let start: number | null = null;
  p.forEach((q, i) => { if (test(q) && start == null) start = q.d; if ((!test(q) || i === p.length - 1) && start != null) { out.push({ x0: start, x1: q.d, color }); start = null; } });
  return out;
}
function profileTicks(len: number) {
  const step = [100, 200, 250, 500, 1000].find((s) => len / s <= 5) ?? 1000;
  return Array.from({ length: Math.floor(len / step) + 1 }, (_, i) => ({ x: i * step, label: i * step >= 1000 ? `${(i * step) / 1000} km` : `${i * step} m` }));
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
  const mode = useStore((s) => s.mode);
  return (
    <div className="bottom">
      <div className="tl">
        <TimelineBar />
        <ChartsRow />
      </div>
      {mode === 'resources' ? <AirOpsLog /> : <KeyEvents />}
    </div>
  );
}

/** Playback controls + scrub track (the master clock). `compact` drops the header line (phones). */
export function TimelineBar({ compact = false }: { compact?: boolean }) {
  const { t0, t1, time, playing, speed, set, setTime, events, selectedEventId, compare, incident } = useStore(useShallow((s) => ({ t0: s.t0, t1: s.t1, time: s.time, playing: s.playing, speed: s.speed, set: s.set, setTime: s.setTime, events: s.events, selectedEventId: s.selectedEventId, compare: s.compare, incident: s.incident })));
  const SPEEDS = speedsFor(incident), [stepS, stepL] = timeSteps(incident), regional = incident?.scale === 'regional';
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'time' | 'before' | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [speedAt, setSpeedAt] = useState({ left: 0, bottom: 0 });
  const speedRef = useRef<HTMLDivElement>(null);
  useDismiss(speedOpen, () => setSpeedOpen(false), speedRef);
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
  const mergeBubbles = compare.on && compare.before != null && Math.abs(bubbleX(time) - bubbleX(compare.before)) < BW + 8;
  const stepEvent = (dir: 1 | -1) => {
    const e = dir > 0 ? events.find((x) => Date.parse(x.timestamp) > time + 1000) : [...events].reverse().find((x) => Date.parse(x.timestamp) < time - 1000);
    if (e) selectEvent(e.event_id);
  };
  // cluster markers closer than 18 px; the most severe event leads the cluster
  const SEV = { alert: 0, watch: 1, info: 2 } as const;
  const clusters: { x: number; items: typeof events }[] = [];
  for (const e of events) {
    const x = (pct(Date.parse(e.timestamp)) / 100) * trackW, last = clusters[clusters.length - 1];
    if (last && x - last.x < 18) last.items.push(e); else clusters.push({ x, items: [e] });
  }
  for (const c of clusters) c.items.sort((a, b) => SEV[a.severity] - SEV[b.severity] || Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const H = 3600000, D = 24 * H;
  const stepMs = [30000, 60000, 120000, 300000, 600000, 1800000, H, 3 * H, 6 * H, 12 * H, D, 2 * D].find((st) => span / st <= maxTicks) ?? 2 * D;
  // ticks of a day or more are labelled with the date; finer ones with the clock (and the date at midnight)
  for (let t = Math.ceil(t0 / stepMs) * stepMs; t <= t1; t += stepMs) ticks.push({ t, label: stepMs >= D || (stepMs >= 3 * H && t % D === 0) ? fmtDay(t) : fmtClock(t, false) });
  if (ticks.length) ticks[0].day = fmtDay(t0);

  return (
        <div className={'tl-top' + (compact ? ' compact' : '')}>
          {!compact && <div className="tl-head"><span>Timeline <span className="muted" style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 6, transition: 'opacity .25s', opacity: hideSub ? 0 : 1 }}>{regional ? 'UTC · reconstructed from satellites' : 'UTC · drone replay'}</span></span><span className="range" style={{ transition: 'opacity .25s', opacity: hideRange ? 0 : 1 }}>{t0 ? (isMultiDay() ? `${fmtDay(t0)} – ${fmtDay(t1)}, ${new Date(t1).getUTCFullYear()}` : `${fmtDayClock(t0)} – ${fmtClock(t1)}`) : ''}</span></div>}
          <div className="tl-row">
            <div className="tl-ctrl">
              <button onClick={() => { if (time >= t1 - 500) setTime(t0); set({ playing: true }); }} className={playing ? 'on' : ''} title="Play (Space)" aria-label="Play"><Icon name="play" size={12} /></button>
              <button onClick={() => set({ playing: false })} className={!playing ? 'on' : ''} title="Pause (Space)" aria-label="Pause"><Icon name="pause" size={12} /></button>
              <button onClick={() => stepEvent(-1)} title="Previous event ([)" aria-label="Previous event" disabled={!events.some((e) => Date.parse(e.timestamp) < time - 1000)}><Icon name="prev" size={12} /></button>
              <button onClick={() => stepEvent(1)} title="Next event (])" aria-label="Next event" disabled={!events.some((e) => Date.parse(e.timestamp) > time + 1000)}><Icon name="step" size={12} /></button>
              <div style={{ position: 'relative' }} ref={speedRef}>
                <button className="speed" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSpeedAt({ left: r.left, bottom: innerHeight - r.top + 4 }); setSpeedOpen(!speedOpen); }} aria-haspopup="menu" aria-expanded={speedOpen} title="Playback speed">{speedLabel(speed)} <Icon name="chev" size={10} /></button>
                {speedOpen && <div className="menu-pop fixed" role="menu" style={{ ...speedAt, top: 'auto', minWidth: 70 }}>{SPEEDS.map((s) => <button key={s} role="menuitemradio" aria-checked={s === speed} onClick={() => { set({ speed: s }); setSpeedOpen(false); }}>{speedLabel(s)}</button>)}</div>}
              </div>
            </div>
            <div className="track" ref={track} role="slider" tabIndex={0} aria-label="Timeline position" aria-valuemin={0} aria-valuemax={Math.round(span / 1000)} aria-valuenow={Math.round((time - t0) / 1000)} aria-valuetext={`${fmtNow(time)} UTC`}
              onKeyDown={(e) => { const step = e.shiftKey ? stepL : stepS; if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setTime(time + step); } if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setTime(time - step); } }}
              onPointerDown={(e) => { const r = track.current!.getBoundingClientRect(); setTime(t0 + ((e.clientX - r.left) / r.width) * span); set({ playing: false }); setDrag('time'); }}>
              <div className="rail"><div className="fill" style={{ width: `${pct(time)}%` }} /></div>
              {clusters.map((c) => {
                const lead = c.items.find((e) => e.event_id === selectedEventId) ?? c.items[0];
                const sel = c.items.some((e) => e.event_id === selectedEventId);
                return (
                  <div key={lead.event_id} className={'mk' + (sel ? ' sel' : '')} style={{ left: c.x }}
                    title={c.items.map((e) => `${fmtWhen(Date.parse(e.timestamp))}  ${e.title}`).join('\n')}
                    onPointerDown={(ev) => { ev.stopPropagation(); selectEvent(lead.event_id); }}>
                    {eventIcon(lead.event_type, lead.severity, 11)}
                  </div>
                );
              })}
              {compare.on && compare.before != null && (
                <>
                  {!mergeBubbles && <div className="bubble before" style={{ left: bubbleX(compare.before) }}>Before {isMultiDay() ? fmtWhen(compare.before) : fmtClock(compare.before)}</div>}
                  <div className="handle before" style={{ left: `${pct(compare.before)}%` }} onPointerDown={(e) => { e.stopPropagation(); setDrag('before'); }} title="Drag to change the 'before' time" />
                </>
              )}
              <div className={'bubble' + (mergeBubbles ? ' wide' : '')} style={{ left: mergeBubbles ? Math.min(trackW - 95, Math.max(95, (bubbleX(time) + bubbleX(compare.before!)) / 2)) : bubbleX(time) }}>{mergeBubbles ? (isMultiDay() ? `${fmtWhen(compare.before!)} → ${fmtWhen(time)}` : `${fmtClock(compare.before!)} → ${fmtClock(time)}`) : fmtNow(time)}</div>
              <div className="handle" style={{ left: `${pct(time)}%` }} />
              <div className="ticks">
                {ticks.map((k) => <div key={k.t} className="tick" style={{ left: `${pct(k.t)}%` }}>{k.label}</div>)}
              </div>
            </div>
          </div>
        </div>
  );
}

/** The linked charts for the current mode (series rebuilt only when the data or the mode change). */
export function ChartsRow() {
  const { t0, t1, time, mode, timeline } = useStore(useShallow((s) => ({ t0: s.t0, t1: s.t1, time: s.time, mode: s.mode, timeline: s.timeline })));
  const span = t1 - t0 || 1;
  const frames = useMemo(() => timeline?.frames ?? [], [timeline]);
  // x labels: evenly spaced clock times in a recording; whole days (every 1–3) in a days-long fire
  const xLab = (n = 4) => {
    if (!isMultiDay()) return Array.from({ length: n + 1 }, (_, i) => { const t = t0 + (span * i) / n; return { x: t, label: fmtClock(t, false) }; });
    const D = 86400000, every = Math.max(1, Math.ceil(span / D / n)), out: { x: number; label: string }[] = [];
    for (let t = Math.ceil(t0 / D) * D; t <= t1; t += every * D) out.push({ x: t, label: fmtDay(t) });
    return out;
  };
  const regional = useStore((st) => st.incident?.scale === 'regional');
  const ser = (fn: (f: (typeof frames)[number]) => number | null | undefined): Pt[] => frames.map((f) => ({ x: Date.parse(f.timestamp), y: fn(f) ?? null }));
  const stepS = frames.length > 1 ? (Date.parse(frames[1].timestamp) - Date.parse(frames[0].timestamp)) / 1000 : 4;
  const profile = useProfile();
  const profilePts = useMemo(() => profile.map((p) => ({ x: p.d, y: p.elev })), [profile]);

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
  // series are rebuilt only when the data or the mode change, not on every timeline tick
  const charts = useMemo(() => mode === 'resources' && opsSeries
    ? [
      { title: 'Water / Retardant', unit: 'gal', pts: opsSeries.gal, color: '#c0392b', kind: 'area' as const, prov: 'demo_parameter' },
      { title: 'Fire Line Built', unit: 'chains', pts: opsSeries.chains, color: '#7c5a3a', kind: 'area' as const, prov: 'demo_parameter' },
      { title: 'Personnel Assigned', unit: 'count', pts: opsSeries.pers, color: '#5f7a4c', kind: 'area' as const, prov: 'demo_parameter' },
    ]
    : mode === 'drones' && droneSeries
    ? [
      { title: `Altitude · ${selUnit}`, unit: 'ft AGL', pts: droneSeries.alt, color: '#d2402a', kind: 'line' as const, prov: 'demo_parameter' },
      regional
        ? { title: 'Area Reached in 6 h', unit: 'ha', pts: ser((f) => (f.active_fire_area_m2.value == null ? null : f.active_fire_area_m2.value / 1e4)), color: '#e8742c', kind: 'area' as const, prov: frames[0]?.active_fire_area_m2.provenance }
        : { title: 'Active Fire Area', unit: 'm² · UAV-01', pts: ser((f) => f.active_fire_area_m2.value), color: '#e8742c', kind: 'area' as const, prov: frames[0]?.active_fire_area_m2.provenance },
      { title: `Battery · ${selUnit}`, unit: '%', pts: droneSeries.bat, color: '#5f7a4c', kind: 'line' as const, prov: 'demo_parameter' },
    ]
    : regional
    ? [
      { title: 'Burned Area', unit: 'ha', pts: ser((f) => (f.burned_area_m2.value == null ? null : f.burned_area_m2.value / 1e4)), color: '#c9503a', kind: 'area' as const, prov: frames[0]?.burned_area_m2.provenance },
      { title: 'Expansion Rate', unit: 'm/min', hint: 'Growth of the equivalent radius √(area/π) over 6 h: the speed of the scar as a whole, lower than the head-fire speed', pts: ser((f) => f.front_advance_m_min?.value), color: '#cf3b2a', kind: 'line' as const, prov: frames[0]?.front_advance_m_min?.provenance },
      { title: 'Fire Power', unit: 'MW', hint: 'Fire radiative power of the latest satellite pass (≤ 12 h), sum of the FIRMS detections in the scar', pts: ser((f) => f.frp_mw?.value), color: '#b8641c', kind: 'area' as const, prov: frames[0]?.frp_mw?.provenance },
    ]
    : mode === 'drones'
    ? [
      { title: 'Burned in View', unit: 'm²', pts: ser((f) => f.burned_area_m2.value), color: '#c9503a', kind: 'area' as const, prov: frames[0]?.burned_area_m2.provenance },
      { title: 'Active Fire Area', unit: 'm²', pts: ser((f) => f.active_fire_area_m2.value), color: '#e8742c', kind: 'area' as const, prov: frames[0]?.active_fire_area_m2.provenance },
      { title: 'Flame Hotspots', unit: 'RGB count', pts: ser((f) => f.hotspot_count.value), color: '#b8641c', kind: 'line' as const, prov: frames[0]?.hotspot_count.provenance },
    ]
    : [
      { title: 'Burned Area', unit: 'm²', pts: ser((f) => f.burned_area_m2.value), color: '#c9503a', kind: 'area' as const, prov: frames[0]?.burned_area_m2.provenance },
      frames[0]?.front_advance_m_min
        ? { title: 'Rate of Spread', unit: 'm/min', pts: ser((f) => f.front_advance_m_min?.value), color: '#cf3b2a', kind: 'line' as const, prov: frames[0].front_advance_m_min.provenance }
        : { title: 'Area Growth', unit: 'm²/min · 40 s avg', pts: smooth(ser((f) => (f.area_change_m2.value == null ? null : Math.max(0, (f.area_change_m2.value / stepS) * 60))), 10), color: '#cf3b2a', kind: 'line' as const, prov: frames[0]?.area_change_m2.provenance },
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [mode, frames, opsSeries, droneSeries, selUnit, stepS, regional]);

  return (
        <div className="charts">
          {charts.map((c) => (
            <div className="chart" key={c.title}>
              <div className="chart-h" title={'hint' in c ? (c.hint as string) : undefined}><span>{c.title} <small>({c.unit})</small>{c.prov && <span className={'prov ' + c.prov}>{c.prov === 'demo_parameter' ? 'sim' : c.prov}</span>}</span>
                <button className="chart-dl" title="Download CSV" aria-label={`Download ${c.title} as CSV`} onClick={() => downloadCsv(`${c.title.toLowerCase().replace(/\W+/g, '-')}.csv`, ['time_utc', `${c.title} (${c.unit})`], c.pts.map((p) => [new Date(p.x).toISOString(), p.y]))}><Icon name="download" size={12} /></button></div>
              <MiniChart pts={c.pts} cursor={time} color={c.color} kind={c.kind} xTicks={xLab()} label={`${c.title} over the recording`} />
            </div>
          ))}
          {mode !== 'drones' && mode !== 'resources' && profile.length > 1 && (
            <div className="chart">
              <div className="chart-h" title="Elevation along the planned burn cell's long axis, through the observed fire. Shaded: inside the cell · red: burned in the drone's view · dot: drone.">
                <span>Terrain Profile <small>(along the burn cell)</small><span className="prov external">DEM</span></span>
                <button className="chart-dl" title="Download CSV" aria-label="Download the terrain profile as CSV" onClick={() => downloadCsv('terrain-profile.csv', ['distance_m', 'elevation_m', 'inside_cell', 'burned_in_view'], profile.map((p) => [Math.round(p.d), +p.elev.toFixed(1), p.inCell ? 1 : 0, p.burned ? 1 : 0]))}><Icon name="download" size={12} /></button></div>
              <MiniChart pts={profilePts} cursor={profile.fireD ?? null} color="#5f7a4c" fill="#7f9a68" kind="area" zero={false}
                bands={[...spans(profile, (p) => p.inCell, 'rgba(120,110,95,.13)'), ...spans(profile, (p) => p.burned, 'rgba(201,80,58,.45)')]}
                marks={profile.droneD != null ? [{ x: profile.droneD, label: 'UAV-01', color: '#d2402a' }] : []}
                xTicks={profileTicks(profile[profile.length - 1].d)} label="Terrain elevation along the burn cell, with the burned area and the drone marked" />
            </div>
          )}
        </div>
  );
}

export function AirOpsLog() {
  const { time, set, setTime } = useStore(useShallow((s) => ({ time: qt(s.time, 1000), set: s.set, setTime: s.setTime })));
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
            <span className="t">{fmtWhen(d.t)}</span>
          </div>
        ))}
        {!drops.length && <div className="muted" style={{ padding: 10, fontSize: 12 }}>No drops yet at this time.</div>}
      </div>
    </div>
  );
}

export function KeyEvents() {
  const { events, time, selectedEventId, mode, set } = useStore(useShallow((s) => ({ events: s.events, time: qt(s.time, 1000), selectedEventId: s.selectedEventId, mode: s.mode, set: s.set })));
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
            <span className="t">{fmtWhen(Date.parse(e.timestamp))}</span>
          </div>
        ))}
        {!list.length && <div className="muted" style={{ padding: 10, fontSize: 12 }}>No events yet.</div>}
      </div>
    </div>
  );
}
