import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type ModeTab, type PanelTab } from '../state/store';
import { buildUrl } from '../state/url';
import { sceneRef } from '../scene/SceneView';
import { SIM_UNITS } from '../sim/ops';
import { useDismiss } from '../lib/ui';
import { pickVideoFile } from '../ai/localVideo';
import { Icon, Logo } from './Icon';
import { TimelineBar, ChartsRow, KeyEvents, AirOpsLog } from './Timeline';
import { IncidentOverview, LayersSection, NotesSection, WeatherCard } from './RightPanel';
import { AgentPanel, EvidencePanel } from './AgentPanels';
import { DronePanel } from './DronePanel';
import { ResourcesPanel } from './ResourcesPanel';
import { SpreadWindCard } from './SpreadWindCard';
import { toggleFullscreen } from './MapOverlays';

/* -------------------------------------------------------------------------------------------- top bar */

const SIM_DRONES = SIM_UNITS.filter((u) => u.group === 'drones').length;

export function PhoneBar() {
  const { mode, set, sources } = useStore(useShallow((s) => ({ mode: s.mode, set: s.set, sources: s.sources })));
  const [open, setOpen] = useState(false);
  const tab = (id: ModeTab, icon: string, label: string, n?: number) => (
    <button className={mode === id ? 'on' : ''} aria-pressed={mode === id} aria-label={label} title={label}
      onClick={() => set({ mode: id, feedOpen: id === 'drones', follow: null, selectedUnitId: null })}>
      <Icon name={icon} size={15} /><span className="pl">{label}</span>{n ? <span className="badge">{n}</span> : null}
    </button>
  );
  return (
    <header className="topbar phone-bar">
      <div className="brand"><Logo /><span className="pl">FireScope 3D</span></div>
      <div className="seg">
        {tab('incident', 'map', 'Incident')}
        {tab('drones', 'drone', 'Drones', sources.length + SIM_DRONES)}
        {tab('resources', 'layers', 'Resources', SIM_UNITS.length - SIM_DRONES)}
      </div>
      <button className="pb-menu" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" size={18} /></button>
      {open && <PhoneMenu close={() => setOpen(false)} />}
    </header>
  );
}

function PhoneMenu({ close }: { close: () => void }) {
  const { view, layers, compare, exaggeration, set, notify, regional } = useStore(useShallow((s) => ({ view: s.view, layers: s.layers, compare: s.compare, exaggeration: s.exaggeration, set: s.set, notify: s.notify, regional: s.incident?.scale === 'regional' })));
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, close, ref);
  const item = (label: string, on: (() => void), state?: string) => (
    <button role="menuitem" onClick={() => { on(); close(); }}>{label}{state != null && <span className="muted">{state}</span>}</button>
  );
  const share = async () => {
    const url = new URL(buildUrl(), location.href).href;
    try { if (navigator.share) await navigator.share({ title: 'FireScope 3D', url }); else { await navigator.clipboard.writeText(url); notify('Link copied — it opens this exact view'); } }
    catch { /* cancelled */ }
  };
  return (
    <div className="phone-menu" role="menu" ref={ref}>
      <div className="pm-h">View</div>
      {item(view === '3d' ? 'Top-down 2D map' : 'Oblique 3D view', () => set({ view: view === '3d' ? '2d' : '3d' }))}
      {item('Reset camera', () => sceneRef.current?.flyHome())}
      {!regional && item('Go to the drone', () => sceneRef.current?.flyToDrone())}
      {item('Real sun & night', () => useStore.getState().setLayer('realSun', !layers.realSun), layers.realSun ? 'on' : 'off')}
      {item('Vertical exaggeration', () => set({ exaggeration: exaggeration === 1 ? 1.8 : 1 }), `${exaggeration}×`)}
      {item('Full-screen map', toggleFullscreen)}
      <div className="pm-h">Analysis</div>
      {item('Compare before / current', () => { const s = useStore.getState(); set({ compare: compare.on ? { on: false, before: null } : { on: true, before: Math.max(s.t0, s.time - (regional ? 86400000 : 180000)) } }); }, compare.on ? 'on' : 'off')}
      {regional ? (
        <>
          {item('Burn severity (dNBR)', () => useStore.getState().setLayer('severity', layers.severity > 0 ? 0 : 0.85), layers.severity > 0 ? 'on' : 'off')}
          {item('Daily isochrones', () => useStore.getState().setLayer('isochrones', !layers.isochrones), layers.isochrones ? 'on' : 'off')}
          {item('Spread scenario (hindcast)', () => useStore.getState().setLayer('projection', !layers.projection), layers.projection ? 'on' : 'off')}
        </>
      ) : (
        <>
          {item('Ground-truth masks', () => useStore.getState().setLayer('groundTruth', !layers.groundTruth), layers.groundTruth ? 'on' : 'off')}
          {item('Large-fire scenario (sim)', () => useStore.getState().setLayer('projection', !layers.projection), layers.projection ? 'on' : 'off')}
        </>
      )}
      {item('Analyse a video file…', pickVideoFile)}
      <div className="pm-h">FireScope</div>
      {item('Guided tour', () => set({ presenting: true }))}
      {item('Share this view', share)}
      {item('About this demo', () => set({ mode: 'incident', panel: 'notes' }))}
    </div>
  );
}

/* --------------------------------------------------------------------------------------- bottom sheet */

type Snap = 'peek' | 'half' | 'full';
type SheetTab = { id: string; label: string; body: () => ReactNode; panel?: PanelTab };

const INCIDENT_TABS: SheetTab[] = [
  { id: 'events', label: 'Events', body: () => <KeyEvents /> },
  { id: 'charts', label: 'Charts', body: () => <ChartsRow /> },
  { id: 'layers', label: 'Layers', panel: 'layers', body: () => <div className="scroll sheet-cards"><LayersSection /><IncidentOverview /><WeatherCard /><SpreadWindCard height={210} /></div> },
  { id: 'ask', label: 'Ask', panel: 'analysis', body: () => <AgentPanel /> },
  { id: 'search', label: 'Search', panel: 'evidence', body: () => <EvidencePanel /> },
  { id: 'about', label: 'About', panel: 'notes', body: () => <div className="scroll sheet-cards"><NotesSection /></div> },
];
const DRONE_TABS: SheetTab[] = [
  { id: 'fleet', label: 'Fleet', body: () => <DronePanel /> },
  { id: 'detections', label: 'Detections', body: () => <KeyEvents /> },
  { id: 'charts', label: 'Charts', body: () => <ChartsRow /> },
];
const RESOURCE_TABS: SheetTab[] = [
  { id: 'units', label: 'Units', body: () => <ResourcesPanel /> },
  { id: 'airops', label: 'Air ops', body: () => <AirOpsLog /> },
  { id: 'charts', label: 'Charts', body: () => <ChartsRow /> },
];

/** Bottom sheet over the map: the playback bar is always visible; drag or tap the handle for the panels. */
export function PhoneSheet() {
  const { mode, panel, presenting, loaded } = useStore(useShallow((s) => ({ mode: s.mode, panel: s.panel, presenting: s.presenting, loaded: s.loaded })));
  const tabs = mode === 'drones' ? DRONE_TABS : mode === 'resources' ? RESOURCE_TABS : INCIDENT_TABS;
  const [tabId, setTabId] = useState(tabs[0].id);
  const [snap, setSnap] = useState<Snap>('peek');
  const [dragH, setDragH] = useState<number | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];

  // follow the app: a new mode opens its first tab, and asking for a panel (menu, tour, citations) shows it
  useEffect(() => { setTabId((mode === 'drones' ? DRONE_TABS : mode === 'resources' ? RESOURCE_TABS : INCIDENT_TABS)[0].id); }, [mode]);
  useEffect(() => {
    if (mode !== 'incident') return;
    const t = INCIDENT_TABS.find((x) => x.panel === panel);
    if (t && t.id !== 'layers') { setTabId(t.id); setSnap((s) => (s === 'peek' ? 'half' : s)); }
  }, [panel]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (presenting) setSnap('peek'); }, [presenting]);

  // landscape phones: an open sheet becomes a full-height panel on the left half, the map stays usable on the right
  const [landscape, setLandscape] = useState(() => matchMedia('(orientation: landscape)').matches);
  useEffect(() => {
    const mq = matchMedia('(orientation: landscape)'), on = () => setLandscape(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // the map keeps its controls and labels above the sheet
  const heights = () => {
    const m = sheet.current?.parentElement?.clientHeight ?? 600, peek = sheet.current?.querySelector<HTMLElement>('.sheet-peek')?.offsetHeight ?? 120;
    return landscape ? { peek, half: m, full: m, map: m } : { peek, half: Math.max(peek + 140, Math.round(m * 0.52)), full: m - 8, map: m };
  };
  const [h, setH] = useState(120);
  useEffect(() => {
    const upd = () => { const H = heights(); setH(dragH ?? H[snap]); };
    upd();
    const ro = new ResizeObserver(upd); if (sheet.current?.parentElement) ro.observe(sheet.current.parentElement);
    const peekEl = sheet.current?.querySelector('.sheet-peek'); if (peekEl) ro.observe(peekEl);
    return () => ro.disconnect();
  }, [snap, dragH, landscape]);   // eslint-disable-line react-hooks/exhaustive-deps
  const open = snap !== 'peek' || dragH != null;
  const side = landscape && open;
  useEffect(() => {
    const map = sheet.current?.parentElement;
    if (!map) return;
    const H = heights(), cap = side ? 0 : Math.round(Math.min(h, H.half));
    map.style.setProperty('--sheet-h', `${cap}px`);
    map.style.setProperty('--map-h', `${H.map}px`);
    map.classList.toggle('sheet-side', side);
    // the 3D focus stays in the visible part of the map (above the sheet, or right of the side panel)
    sceneRef.current?.setViewInset(cap, side ? sheet.current!.offsetWidth : 0);
  }, [h, loaded, side]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { sceneRef.current?.setViewInset(0, 0); sheet.current?.parentElement?.classList.remove('sheet-side'); }, []);

  const startDrag = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = h, H = heights(); let moved = false;
    const move = (ev: PointerEvent) => { const d = y0 - ev.clientY; if (Math.abs(d) > 6) moved = true; setDragH(Math.min(H.full, Math.max(H.peek, h0 + d))); };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      setDragH(null);
      if (!moved) { setSnap(snap === 'peek' ? 'half' : 'peek'); return; }
      const end = h0 + (y0 - ev.clientY), opts: Snap[] = ['peek', 'half', 'full'];
      setSnap(opts.reduce((a, b) => (Math.abs(H[b] - end) < Math.abs(H[a] - end) ? b : a)));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  return (
    <section className={'sheet' + (open ? ' open' : '') + (side ? ' side' : '') + (dragH != null ? ' dragging' : '')} ref={sheet} style={{ height: h }} aria-label="Incident panels">
      <div className="sheet-peek">
        <button className="sheet-handle" onPointerDown={startDrag} aria-label={open ? 'Collapse panels' : 'Expand panels'} aria-expanded={open}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSnap(open ? 'peek' : 'half'); } }}><span /></button>
        <TimelineBar compact />
        <div className="sheet-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === tab.id} className={t.id === tab.id && open ? 'on' : ''}
              onClick={() => { if (open && t.id === tab.id) { setSnap('peek'); return; } setTabId(t.id); if (t.panel) useStore.getState().set({ panel: t.panel }); if (!open) setSnap('half'); }}>{t.label}</button>
          ))}
        </div>
      </div>
      <div className={'sheet-body tab-' + tab.id} role="tabpanel" aria-label={tab.label}>{open && tab.body()}</div>
    </section>
  );
}
