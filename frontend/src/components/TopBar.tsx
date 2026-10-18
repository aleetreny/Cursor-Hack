import { useRef, useState } from 'react';
import { IS_STATIC, API_BASE } from '../api/client';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type ModeTab } from '../state/store';
import { buildUrl } from '../state/url';
import { sceneRef } from '../scene/SceneView';
import { SIM_UNITS } from '../sim/ops';
import { fmtDate, fmtSpan } from '../lib/format';
import { useDismiss } from '../lib/ui';
import { Icon, Logo } from './Icon';
import { useLayout } from '../lib/layout';

const SIM_DRONES = SIM_UNITS.filter((u) => u.group === 'drones').length;
const SIM_RESOURCES = SIM_UNITS.length - SIM_DRONES;

export function TopBar() {
  const { incident, incidents, mode, set, sources, t0, t1, view, compare, layers, exaggeration, notify } = useStore(useShallow((s) => ({ incident: s.incident, incidents: s.incidents, mode: s.mode, set: s.set, sources: s.sources, t0: s.t0, t1: s.t1, view: s.view, compare: s.compare, layers: s.layers, exaggeration: s.exaggeration, notify: s.notify })));
  const [menu, setMenu] = useState<string | null>(null);
  const layout = useLayout();
  const drawer = useStore((s) => s.drawer);
  const [at, setAt] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const bar = useRef<HTMLElement>(null);
  const close = () => setMenu(null);
  useDismiss(menu != null, close, bar);
  // menus are fixed-positioned under their button: the top bar clips its overflow
  const toggle = (m: string, e: { currentTarget: Element }) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ left: Math.min(r.left, innerWidth - 330), top: r.bottom + 4 }); setMenu(menu === m ? null : m); };
  const tab = (id: ModeTab, label: string, icon: string, count?: number, hint?: string) => (
    <button className={mode === id ? 'on' : ''} title={hint} onClick={() => set({ mode: id, feedOpen: id === 'drones', follow: null, selectedUnitId: null })}>
      <Icon name={icon} size={13} /><span className="lbl">{label}</span>{count ? <span className="badge">{count}</span> : null}
    </button>
  );
  const share = async () => {
    const url = new URL(buildUrl(), location.href).href;
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); notify('Link copied — it opens this exact view'); }
    catch { notify('Copy failed — copy the address bar instead'); }
  };
  const multi = incidents.length > 0;
  const regional = incident?.scale === 'regional';
  return (
    <header className="topbar" ref={bar}>
      <div className="brand"><Logo /> FireScope 3D</div>
      <div className="brand-sub">Wildfire Video Intelligence</div>
      <div className="tb-sep" />
      <div style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
        <button className="tb-incident" disabled={!multi} onClick={(e) => toggle('inc', e)} aria-haspopup="menu" aria-expanded={menu === 'inc'} title="Incidents in this demo">
          {incident?.name ?? 'Loading…'} {multi && <Icon name="chev" size={12} />}
        </button>
        {menu === 'inc' && (
          <div className="menu-pop inc fixed" role="menu" style={at}>
            {incidents.map((i) => (
              <button key={i.id} role="menuitemradio" aria-checked={i.id === incident?.id}
                onClick={() => { close(); if (i.id !== incident?.id) location.search = `?incident=${encodeURIComponent(i.id)}`; }}>
                <span><b>{i.name}</b><br /><span className="muted">{i.location} · {fmtDate(Date.parse(i.start))} · {fmtSpan(Date.parse(i.end) - Date.parse(i.start))}</span></span>
                <span className="muted">{i.id === incident?.id ? '✓' : ''}</span>
              </button>
            ))}
            <div className="menu-note">{incidents.length === 1 ? 'One incident published so far.' : `${incidents.length} incidents published.`}</div>
          </div>
        )}
      </div>
      <div className="tb-meta loc">{incident?.location}</div>
      <div className="tb-meta date"><Icon name="calendar" size={13} />{t0 ? `${fmtDate(t0)} · ${fmtSpan(t1 - t0)}` : ''}</div>
      <div className="seg">
        {tab('incident', 'Incident', 'map')}
        {tab('drones', 'Drones', 'drone', sources.length + SIM_DRONES, sources.length ? `${sources.length} real · ${SIM_DRONES} simulated` : `${SIM_DRONES} simulated`)}
        {tab('resources', 'Resources', 'layers', SIM_RESOURCES, `${SIM_RESOURCES} simulated units`)}
      </div>
      <div className="tb-sep" />
      <div style={{ position: 'relative', display: 'flex' }}>
        <button className="tb-menu" onClick={(e) => toggle('view', e)} aria-haspopup="menu" aria-expanded={menu === 'view'}><Icon name="eye" size={13} /><span className="lbl">View</span><Icon name="chev" size={11} /></button>
        {menu === 'view' && (
          <div className="menu-pop fixed" role="menu" style={at}>
            <button role="menuitem" onClick={() => { set({ view: view === '3d' ? '2d' : '3d' }); close(); }}>{view === '3d' ? 'Top-down 2D map' : 'Oblique 3D view'}<span className="muted">{view === '3d' ? '2' : '3'}</span></button>
            <button role="menuitem" onClick={() => { sceneRef.current?.flyHome(); close(); }}>Reset camera<span className="muted">H</span></button>
            {!regional && <button role="menuitem" onClick={() => { sceneRef.current?.flyToDrone(); close(); }}>Go to the drone</button>}
            <button role="menuitemcheckbox" aria-checked={layers.realSun} onClick={() => { useStore.getState().setLayer('realSun', !layers.realSun); close(); }} title="Light from the real sun at the timeline time, night included">Real sun &amp; night<span className="muted">{layers.realSun ? 'on' : 'off'}</span></button>
            <button role="menuitemcheckbox" aria-checked={exaggeration !== 1} onClick={() => { set({ exaggeration: exaggeration === 1 ? 1.8 : 1 }); close(); }}>Vertical exaggeration<span className="muted">{exaggeration}×</span></button>
          </div>
        )}
        <button className="tb-menu" onClick={(e) => toggle('an', e)} aria-haspopup="menu" aria-expanded={menu === 'an'}><Icon name="chart" size={13} /><span className="lbl">Analysis</span><Icon name="chev" size={11} /></button>
        {menu === 'an' && (
          <div className="menu-pop fixed" role="menu" style={at}>
            <button role="menuitemcheckbox" aria-checked={compare.on} onClick={() => { set({ compare: compare.on ? { on: false, before: null } : { on: true, before: Math.max(t0, useStore.getState().time - (regional ? 86400000 : 180000)) } }); close(); }}>Compare before / current<span className="muted">{compare.on ? 'on' : 'off'}</span></button>
            {regional ? (
              <>
                <button role="menuitemcheckbox" aria-checked={layers.severity > 0} onClick={() => { useStore.getState().setLayer('severity', layers.severity > 0 ? 0 : 0.85); close(); }}>Burn severity (dNBR)<span className="muted">{layers.severity > 0 ? 'on' : 'off'}</span></button>
                <button role="menuitemcheckbox" aria-checked={layers.isochrones} onClick={() => { useStore.getState().setLayer('isochrones', !layers.isochrones); close(); }}>Daily isochrones<span className="muted">{layers.isochrones ? 'on' : 'off'}</span></button>
                <button role="menuitemcheckbox" aria-checked={layers.projection} onClick={() => { useStore.getState().setLayer('projection', !layers.projection); close(); }}>Spread scenario (hindcast)<span className="muted">{layers.projection ? 'on' : 'off'}</span></button>
              </>
            ) : (
              <>
                <button role="menuitemcheckbox" aria-checked={layers.groundTruth} onClick={() => { useStore.getState().setLayer('groundTruth', !layers.groundTruth); close(); }}>Ground-truth masks<span className="muted">{layers.groundTruth ? 'on' : 'off'}</span></button>
                <button role="menuitemcheckbox" aria-checked={layers.projection} onClick={() => { useStore.getState().setLayer('projection', !layers.projection); close(); }}>Large-fire scenario (sim)<span className="muted">{layers.projection ? 'on' : 'off'}</span></button>
              </>
            )}
            <button role="menuitem" onClick={() => { set({ panel: 'analysis', mode: 'incident', drawer: true }); close(); }}>Ask the incident analyst</button>
          </div>
        )}
        <button className="tb-menu" onClick={share} title="Copy a link to this exact view"><Icon name="share" size={13} /><span className="lbl">Share</span></button>
      </div>
      <div className="tb-right">
        {!regional && <button className="tb-tour" onClick={() => set({ presenting: true })} title="Guided tour — → / Space next · ← back · Esc exit">Tour</button>}
        {!IS_STATIC && <span className="mode-chip live" title={`Backend: ${API_BASE}`}>BACKEND</span>}
        <button className="tb-menu" onClick={() => set({ panel: 'notes', mode: 'incident', drawer: true })} title="About this demo" aria-label="About this demo"><Icon name="info" size={15} /></button>
        {layout === 'tablet' && <button className={'tb-menu tb-drawer' + (drawer ? ' on' : '')} onClick={() => set({ drawer: !drawer })} aria-pressed={drawer} title={drawer ? 'Hide the side panel' : 'Show the side panel'} aria-label="Side panel"><Icon name="sidebar" size={16} /></button>}
      </div>
    </header>
  );
}
