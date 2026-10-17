import { useState } from 'react';
import { USE_FIXTURES, API_BASE } from '../api/client';
import { useStore, type ModeTab } from '../state/store';
import { sceneRef } from '../scene/SceneView';
import { fmtDate } from '../lib/format';
import { Icon, Logo } from './Icon';
import { runTour } from '../lib/tour';

export function TopBar() {
  const { incident, mode, set, sources, t0, t1, view, compare, layers, time } = useStore();
  const [menu, setMenu] = useState<string | null>(null);
  const [tour, setTour] = useState('');
  const tab = (id: ModeTab, label: string, icon: string, count?: number) => (
    <button className={mode === id ? 'on' : ''} onClick={() => set({ mode: id, feedOpen: id === 'drones', follow: null, selectedUnitId: null, view: id === 'resources' && useStore.getState().mode !== 'resources' ? useStore.getState().view : useStore.getState().view })}>
      <Icon name={icon} size={13} />{label}{count ? <span className="badge">{count}</span> : null}
    </button>
  );
  const close = () => setMenu(null);
  return (
    <header className="topbar" onMouseLeave={close}>
      <div className="brand"><Logo /> FireScope 3D</div>
      <div className="brand-sub">Wildfire Video Intelligence</div>
      <div className="tb-sep" />
      <div className="tb-incident">{incident?.name ?? 'Loading…'} <Icon name="chev" size={12} /></div>
      <div className="tb-meta loc">{incident?.location}</div>
      <div className="tb-meta date"><Icon name="calendar" size={13} />{t0 ? `${fmtDate(t0)} · ${Math.round((t1 - t0) / 60000)} min` : ''}</div>
      <div className="seg">
        {tab('incident', 'Incident', 'map')}
        {tab('drones', 'Drones', 'drone', sources.length + 5)}
        {tab('resources', 'Resources', 'layers', 13)}
      </div>
      <div className="tb-sep" />
      <div style={{ position: 'relative', display: 'flex' }}>
        <button className="tb-menu" onClick={() => setMenu(menu === 'view' ? null : 'view')}><Icon name="eye" size={13} />View<Icon name="chev" size={11} /></button>
        {menu === 'view' && (
          <div className="menu-pop" style={{ left: 0 }}>
            <button onClick={() => { set({ view: view === '3d' ? '2d' : '3d' }); close(); }}>{view === '3d' ? 'Top-down 2D map' : 'Oblique 3D view'}<span className="muted">{view === '3d' ? '2D' : '3D'}</span></button>
            <button onClick={() => { sceneRef.current?.flyHome(); close(); }}>Reset camera<span className="muted">H</span></button>
            <button onClick={() => { sceneRef.current?.flyToDrone(); close(); }}>Follow drone view</button>
            <button onClick={() => { set({ exaggeration: useStore.getState().exaggeration === 1 ? 1.8 : 1 }); close(); }}>Vertical exaggeration<span className="muted">{useStore.getState().exaggeration}×</span></button>
          </div>
        )}
        <button className="tb-menu" onClick={() => setMenu(menu === 'an' ? null : 'an')}><Icon name="chart" size={13} />Analysis<Icon name="chev" size={11} /></button>
        {menu === 'an' && (
          <div className="menu-pop" style={{ left: 70 }}>
            <button onClick={() => { set({ compare: compare.on ? { on: false, before: null } : { on: true, before: Math.max(t0, time - 180000) } }); close(); }}>Compare before / current<span className="muted">{compare.on ? 'on' : 'off'}</span></button>
            <button onClick={() => { useStore.getState().setLayer('groundTruth', !layers.groundTruth); close(); }}>Ground-truth masks<span className="muted">{layers.groundTruth ? 'on' : 'off'}</span></button>
            <button onClick={() => { useStore.getState().setLayer('projection', !layers.projection); close(); }}>Experimental scenario<span className="muted">{layers.projection ? 'on' : 'off'}</span></button>
            <button onClick={() => { set({ panel: 'analysis', mode: 'incident' }); close(); }}>Ask the video agent</button>
          </div>
        )}
        <button className="tb-menu" onClick={() => { navigator.clipboard?.writeText(location.href); }}><Icon name="share" size={13} />Share<Icon name="chev" size={11} /></button>
      </div>
      <div className="tb-right">
        {tour && <span className="tour-pill">{tour}</span>}
        <button className="tb-menu" onClick={() => runTour(setTour)} title="Guided 2-minute walkthrough (click anywhere to stop)"><Icon name="play" size={11} />Tour</button>
        <span className={'mode-chip ' + (USE_FIXTURES ? 'fixture' : 'live')} title={USE_FIXTURES ? 'Rendering development fixtures from /public/fixtures' : `Backend: ${API_BASE}`}>
          {USE_FIXTURES ? 'DEV FIXTURES' : 'BACKEND CONNECTED'}
        </span>
        <button className="tb-menu" onClick={() => set({ panel: 'notes', mode: 'incident' })}><Icon name="gear" size={15} /></button>
      </div>
    </header>
  );
}
