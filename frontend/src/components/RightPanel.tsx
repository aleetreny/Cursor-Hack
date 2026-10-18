import { useMemo, useState } from 'react';
import { useStore, type PanelTab } from '../state/store';
import type { SceneLayers } from '../scene/FireScene';
import { fmtArea, fmtClock, fmtDayClock, fmtNum } from '../lib/format';
import { Icon } from './Icon';
import { AgentPanel, EvidencePanel } from './AgentPanels';
import { DronePanel } from './DronePanel';
import { ResourcesPanel } from './ResourcesPanel';
import { IS_STATIC, API_BASE } from '../api/client';

type LayerRow = { id: keyof SceneLayers; label: string; sw: string; kind: 'toggle' | 'opacity'; prov?: string; def?: number };
const LAYERS: LayerRow[] = [
  { id: 'terrain', label: 'Terrain (3D DEM)', sw: 'linear-gradient(135deg,#7d8a5c,#c8a777 60%,#e6d2ad)', kind: 'toggle', prov: 'external' },
  { id: 'imagery', label: 'Aerial Imagery', sw: 'linear-gradient(135deg,#6f7a62,#a59c84 50%,#5b6650)', kind: 'opacity', prov: 'external', def: 0.18 },
  { id: 'burned', label: 'Burned Area', sw: 'linear-gradient(135deg,#2a1e1c,#5a3a34 60%,#a24a35)', kind: 'opacity', prov: 'model', def: 0.95 },
  { id: 'active', label: 'Active Fire', sw: 'radial-gradient(circle at 40% 40%,#ffe08a,#ff7a1a 45%,#c0290f)', kind: 'opacity', prov: 'model', def: 1 },
  { id: 'change', label: 'Recent Change', sw: 'linear-gradient(135deg,#f0a35a,#d9542a)', kind: 'opacity', prov: 'derived', def: 0.6 },
  { id: 'hotspots', label: 'Flame Hotspots', sw: 'radial-gradient(circle,#ffd27a 25%,#ff7a2a 45%,#f3ece2 50%)', kind: 'toggle', prov: 'model' },
  { id: 'smoke', label: 'Smoke', sw: 'linear-gradient(135deg,#b7b2ac,#7d7873)', kind: 'toggle' },
  { id: 'footprint', label: 'Drone Footprint', sw: 'linear-gradient(135deg,#efeae2,#c9c1b4)', kind: 'toggle', prov: 'derived' },
  { id: 'path', label: 'Event Track', sw: 'linear-gradient(90deg,#f2b33d 0 45%,#fff 45% 55%,#f2b33d 55%)', kind: 'toggle', prov: 'model' },
  { id: 'perimeter', label: 'Burn Cell (KML)', sw: 'repeating-linear-gradient(90deg,#fff 0 4px,#8b8379 4px 7px)', kind: 'toggle', prov: 'external' },
  { id: 'groundTruth', label: 'Ground Truth', sw: 'linear-gradient(135deg,#bfe6fb,#40c8ff)', kind: 'toggle', prov: 'ground_truth' },
  { id: 'trees', label: 'Vegetation', sw: 'radial-gradient(circle,#2f4a2a 35%,#e6d8bd 40%)', kind: 'toggle', prov: 'derived' },
  { id: 'projection', label: 'Fire Scenario (sim)', sw: 'repeating-linear-gradient(45deg,#c7a7f7 0 3px,#f3ecfd 3px 6px)', kind: 'toggle', prov: 'demo_parameter' },
];

export function RightPanel() {
  const { mode, panel, set } = useStore();
  if (mode === 'drones') return <aside className="right"><DronePanel /></aside>;
  if (mode === 'resources') return <aside className="right"><ResourcesPanel /></aside>;
  const tab = (id: PanelTab, label: string) => <button className={panel === id ? 'on' : ''} onClick={() => set({ panel: id })}>{label}</button>;
  return (
    <aside className="right">
      <div className="tabs">{tab('layers', 'Layers')}{tab('analysis', 'Analysis')}{tab('evidence', 'Evidence')}{tab('notes', 'About')}</div>
      {panel === 'layers' && <div className="scroll fit"><LayersSection /><IncidentOverview /><WeatherCard /></div>}
      {panel === 'analysis' && <AgentPanel />}
      {panel === 'evidence' && <EvidencePanel />}
      {panel === 'notes' && <div className="scroll"><NotesSection /></div>}
    </aside>
  );
}

function LayersSection() {
  const { layers, setLayer, features } = useStore();
  const hasGT = features.some((f) => f.properties.classification === 'ground_truth_burned');
  return (
    <div className="section" style={{ paddingTop: 8 }}>
      {LAYERS.map((l) => {
        const v = layers[l.id];
        const on = typeof v === 'boolean' ? v : (v as number) > 0.001;
        const unavailable = l.id === 'groundTruth' && !hasGT;
        return (
          <div key={l.id} className={'layer' + (l.kind === 'toggle' ? ' toggle' : '') + (on && !unavailable ? '' : ' off')} title={unavailable ? 'Not provided by the current data source' : undefined}>
            <input type="checkbox" className="cb" checked={on} onChange={(e) => setLayer(l.id, (l.kind === 'opacity' ? (e.target.checked ? (l.def ?? 1) : 0) : e.target.checked) as never)} />
            <div className="sw" style={{ background: l.sw }} />
            <span>{l.label}</span>
            {l.kind === 'opacity'
              ? <input type="range" className="rng" min={0} max={1} step={0.01} value={v as number} onChange={(e) => setLayer(l.id, +e.target.value as never)} />
              : null}
            <span className="pct">{l.kind === 'opacity' ? `${Math.round((v as number) * 100)}%` : unavailable ? 'n/a' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function IncidentOverview() {
  const { incident, sources, t0, t1, timeline, events } = useStore();
  const last = timeline?.frames[timeline.frames.length - 1];
  const total = fmtArea(last?.burned_area_m2.value);
  const src = sources[0];
  return (
    <div className="section">
      <div className="section-h">Incident Overview</div>
      <dl className="kv">
        <dt>Incident</dt><dd>{incident?.name}</dd>
        <dt className="opt">Incident ID</dt><dd className="mono opt" style={{ fontSize: 11.5 }}>{incident?.id}</dd>
        <dt>Location</dt><dd>{incident?.location}</dd>
        <dt>Type</dt><dd>{incident?.kind === 'prescribed_burn' ? 'Prescribed burn' : 'Wildfire'}</dd>
        <dt>First obs.</dt><dd>{t0 ? fmtDayClock(t0) : '—'} UTC</dd>
        <dt>Last obs.</dt><dd>{t1 ? fmtDayClock(t1) : '—'} UTC</dd>
        <dt>Burned (view)</dt><dd>{total.v} {total.u}{last && <span className={'prov ' + last.burned_area_m2.provenance}>{last.burned_area_m2.provenance}</span>}</dd>
        <dt>Events</dt><dd>{events.length} detected · {events.filter((e) => e.review_required).length} to review</dd>
        <dt className="opt">Georeferencing</dt><dd className="opt">{src?.georeferencing.method.replace(/_/g, ' ')} · {src?.georeferencing.accuracy}</dd>
      </dl>
    </div>
  );
}

const PROV_LABEL: Record<string, string> = { real: 'real', model: 'model', derived: 'derived', external: 'external', simulated: 'sim' };
function NotesSection() {
  const { manifest, incident } = useStore();
  const [note, setNote] = useState(() => { try { return localStorage.getItem('fs-notes') ?? ''; } catch { return ''; } });
  return (
    <>
      <div className="section">
        <div className="section-h">How this works</div>
        {IS_STATIC && !manifest && <div className="muted">Loading…</div>}
        {manifest?.methods.map((m) => (
          <div className="integr" key={m.id}>
            <span>{m.name}</span>
            <span className={'prov ' + (m.provenance === 'simulated' ? 'demo_parameter' : m.provenance)}>{PROV_LABEL[m.provenance]}</span>
            <span className="s">{m.detail}</span>
          </div>
        ))}
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{IS_STATIC ? `Everything runs in your browser from a precomputed data package${manifest ? ` (packaged ${manifest.packaged.slice(0, 10)})` : ''}. No server, no keys.` : `Backend ${API_BASE}`}</div>
      </div>
      <div className="section">
        <div className="section-h">Limits</div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)' }}>
          <p style={{ margin: '0 0 6px' }}><b>No temperatures:</b> the camera is RGB only, so hotspots are visible-flame locations and IR* is a false-colour look.</p>
          <p style={{ margin: '0 0 6px' }}><b>Approximate positions:</b> georeferencing uses a pinhole camera and the elevation model; its error in metres is not measured yet.</p>
          <p style={{ margin: '0 0 6px' }}><b>Only the camera's view:</b> burned area is what the drone saw, a small part of the planned burn cell.</p>
          <p style={{ margin: 0 }}><b>Stylized:</b> trees and smoke are drawn for readability, and the terrain uses {useStore.getState().exaggeration}× vertical exaggeration.</p>
        </div>
      </div>
      <div className="section">
        <div className="section-h">History</div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)' }}>Built in a day at the VAST Builders Challenge (17 Oct 2026), where clip descriptions and video search ran live on NVIDIA Cosmos on the event cluster. Those outputs were not kept and are not reproduced here: this public version shows only what can be recomputed from the open data.</div>
      </div>
      <div className="section">
        <div className="section-h">Analyst Notes</div>
        <textarea aria-label="Analyst notes" value={note} onChange={(e) => { setNote(e.target.value); try { localStorage.setItem('fs-notes', e.target.value); } catch { /* ignore */ } }} placeholder="Notes stay in this browser…" style={{ width: '100%', minHeight: 90, border: '1px solid var(--line)', borderRadius: 6, padding: 8, background: '#fff', resize: 'vertical', fontSize: 12.5 }} />
      </div>
      <div className="section"><div className="section-h">Attribution</div>{(manifest?.attribution ?? incident?.attribution)?.map((a) => <div key={a} className="muted" style={{ fontSize: 11.5 }}>{a}</div>)}</div>
    </>
  );
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function WeatherCard() {
  const { weather, time } = useStore();
  const at = useMemo(() => {
    const h = weather?.hourly ?? [];
    return h.length ? h.reduce((a, b) => (Math.abs(Date.parse(b.timestamp) - time) < Math.abs(Date.parse(a.timestamp) - time) ? b : a)) : null;
  }, [weather, time]);
  const dir = at?.wind_dir_deg != null ? COMPASS[Math.round(at.wind_dir_deg / 22.5) % 16] : null;
  return (
    <div className="section">
      <div className="section-h"><span>Weather <small>(ERA5 · {at ? fmtClock(Date.parse(at.timestamp), false) + ' UTC' : 'n/a'})</small></span><span className="prov external">external</span></div>
      <div className="metrics">
        <div className="metric"><span className="ic"><Icon name="smoke" /></span><span className="lab">Wind</span><span className="val">{fmtNum(at?.wind_kmh, 1)} <small>km/h</small></span><span className="sub" title="Direction the wind blows from">{dir ? `from ${dir} ${Math.round(at!.wind_dir_deg!)}°` : '—'}</span></div>
        <div className="metric"><span className="ic"><Icon name="flame" color="#d2402a" /></span><span className="lab">Temp</span><span className="val">{fmtNum(at?.temp_c, 1)} <small>°C</small></span></div>
        <div className="metric"><span className="ic"><Icon name="target" /></span><span className="lab">RH</span><span className="val">{fmtNum(at?.rh_pct)} <small>%</small></span></div>
        <div className="metric"><span className="ic"><Icon name="delta" /></span><span className="lab">Gusts</span><span className="val">{fmtNum(at?.gust_kmh, 1)} <small>km/h</small></span></div>
        <div className="metric"><span className="ic"><Icon name="db" /></span><span className="lab">Soil moist.</span><span className="val">{at?.soil_moisture_m3m3 != null ? fmtNum(at.soil_moisture_m3m3 * 100) : '—'} <small>%vol</small></span><span className="sub">0–7 cm</span></div>
        <div className="metric"><span className="ic"><Icon name="area" /></span><span className="lab">VPD</span><span className="val">{fmtNum(at?.vpd_kpa, 2)} <small>kPa</small></span></div>
      </div>
      <div className="muted wx-note" style={{ fontSize: 10.5, marginTop: 8 }}>{weather?.source ? `${weather.source} · ${weather.grid}. Reanalysis, not an on-site sensor.` : 'No weather source connected.'}</div>
    </div>
  );
}
