import { useRef, useState } from 'react';
import { IS_STATIC, API_BASE } from '../api/client';
import { useStore, type ModeTab } from '../state/store';
import { buildUrl } from '../state/url';
import { sceneRef } from '../scene/SceneView';
import { SIM_UNITS } from '../sim/ops';
import { fmtDate } from '../lib/format';
import { useDismiss } from '../lib/ui';
import { Icon, Logo } from './Icon';

const SIM_DRONES = SIM_UNITS.filter((u) => u.group === 'drones').length;
const SIM_RESOURCES = SIM_UNITS.length - SIM_DRONES;

export function TopBar() {
  const { incident, incidents, mode, set, sources, t0, t1, view, compare, layers, time, exaggeration, notify } = useStore();
  const [menu, setMenu] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const close = () => setMenu(null);
  useDismiss(menu != null, close, bar);
  const toggle = (m: string) => setMenu(menu === m ? null : m);
  const tab = (id: ModeTab, label: string, icon: string, count?: number, hint?: string) => (
    <button className={mode === id ? 'on' : ''} title={hint} onClick={() => set({ mode: id, feedOpen: id === 'drones', follow: null, selectedUnitId: null })}>
      <Icon name={icon} size={13} />{label}{count ? <span className="badge">{count}</span> : null}
    </button>
  );
  const share = async () => {
    const url = new URL(buildUrl(), location.href).href;
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); notify('Link copied — it opens this exact view'); }
    catch { notify('Copy failed — copy the address bar instead'); }
  };
  const multi = incidents.length > 0;
  return (
    <header className="topbar" ref={bar} onMouseLeave={close}>
      <div className="brand"><Logo /> FireScope 3D</div>
      <div className="brand-sub">Wildfire Video Intelligence</div>
      <div className="tb-sep" />
      <div style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
        <button className="tb-incident" disabled={!multi} onClick={() => toggle('inc')} aria-haspopup="menu" aria-expanded={menu === 'inc'} title="Incidents in this demo">
          {incident?.name ?? 'Loading…'} {multi && <Icon name="chev" size={12} />}
        </button>
        {menu === 'inc' && (
          <div className="menu-pop inc" role="menu" style={{ left: 0 }}>
            {incidents.map((i) => (
              <button key={i.id} role="menuitemradio" aria-checked={i.id === incident?.id}
                onClick={() => { close(); if (i.id !== incident?.id) location.search = `?incident=${encodeURIComponent(i.id)}`; }}>
                <span><b>{i.name}</b><br /><span className="muted">{i.location} · {fmtDate(Date.parse(i.start))} · {Math.round((Date.parse(i.end) - Date.parse(i.start)) / 60000)} min</span></span>
                <span className="muted">{i.id === incident?.id ? '✓' : ''}</span>
              </button>
            ))}
            <div className="menu-note">{incidents.length === 1 ? 'One incident published so far.' : `${incidents.length} incidents published.`}</div>
          </div>
        )}
      </div>
      <div className="tb-meta loc">{incident?.location}</div>
      <div className="tb-meta date"><Icon name="calendar" size={13} />{t0 ? `${fmtDate(t0)} · ${Math.round((t1 - t0) / 60000)} min` : ''}</div>
      <div className="seg">
        {tab('incident', 'Incident', 'map')}
        {tab('drones', 'Drones', 'drone', sources.length + SIM_DRONES, `${sources.length} real · ${SIM_DRONES} simulated`)}
        {tab('resources', 'Resources', 'layers', SIM_RESOURCES, `${SIM_RESOURCES} simulated units`)}
      </div>
      <div className="tb-sep" />
      <div style={{ position: 'relative', display: 'flex' }}>
        <button className="tb-menu" onClick={() => toggle('view')} aria-haspopup="menu" aria-expanded={menu === 'view'}><Icon name="eye" size={13} />View<Icon name="chev" size={11} /></button>
        {menu === 'view' && (
          <div className="menu-pop" role="menu" style={{ left: 0 }}>
            <button role="menuitem" onClick={() => { set({ view: view === '3d' ? '2d' : '3d' }); close(); }}>{view === '3d' ? 'Top-down 2D map' : 'Oblique 3D view'}<span className="muted">{view === '3d' ? '2' : '3'}</span></button>
            <button role="menuitem" onClick={() => { sceneRef.current?.flyHome(); close(); }}>Reset camera<span className="muted">H</span></button>
            <button role="menuitem" onClick={() => { sceneRef.current?.flyToDrone(); close(); }}>Go to the drone</button>
            <button role="menuitemcheckbox" aria-checked={exaggeration !== 1} onClick={() => { set({ exaggeration: exaggeration === 1 ? 1.8 : 1 }); close(); }}>Vertical exaggeration<span className="muted">{exaggeration}×</span></button>
          </div>
        )}
        <button className="tb-menu" onClick={() => toggle('an')} aria-haspopup="menu" aria-expanded={menu === 'an'}><Icon name="chart" size={13} />Analysis<Icon name="chev" size={11} /></button>
        {menu === 'an' && (
          <div className="menu-pop" role="menu" style={{ left: 70 }}>
            <button role="menuitemcheckbox" aria-checked={compare.on} onClick={() => { set({ compare: compare.on ? { on: false, before: null } : { on: true, before: Math.max(t0, time - 180000) } }); close(); }}>Compare before / current<span className="muted">{compare.on ? 'on' : 'off'}</span></button>
            <button role="menuitemcheckbox" aria-checked={layers.groundTruth} onClick={() => { useStore.getState().setLayer('groundTruth', !layers.groundTruth); close(); }}>Ground-truth masks<span className="muted">{layers.groundTruth ? 'on' : 'off'}</span></button>
            <button role="menuitemcheckbox" aria-checked={layers.projection} onClick={() => { useStore.getState().setLayer('projection', !layers.projection); close(); }}>Large-fire scenario (sim)<span className="muted">{layers.projection ? 'on' : 'off'}</span></button>
            <button role="menuitem" onClick={() => { set({ panel: 'analysis', mode: 'incident' }); close(); }}>Ask the incident analyst</button>
          </div>
        )}
        <button className="tb-menu" onClick={share} title="Copy a link to this exact view"><Icon name="share" size={13} />Share</button>
      </div>
      <div className="tb-right">
        <button className="tb-present" onClick={() => set({ presenting: true })} title="Presentation mode — → / Space next · ← back · Esc exit"><Icon name="play" size={11} />Present</button>
        <span className={'mode-chip ' + (IS_STATIC ? 'static' : 'live')} title={IS_STATIC ? 'Runs entirely in your browser from recorded data — no server, no keys' : `Backend: ${API_BASE}`}>
          {IS_STATIC ? 'STATIC DEMO' : 'BACKEND CONNECTED'}
        </span>
        <button className="tb-menu" onClick={() => set({ panel: 'notes', mode: 'incident' })} title="About this demo" aria-label="About this demo"><Icon name="info" size={15} /></button>
      </div>
    </header>
  );
}
