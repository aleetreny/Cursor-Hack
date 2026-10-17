import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { sceneRef, selectEvent } from '../scene/SceneView';
import { mediaUrl } from '../api/client';
import { Logo } from './Icon';

/**
 * Presentation mode: a chaptered, pausable story that drives the REAL app (camera, timeline, panels) and explains each
 * step with large caption cards + a spotlight on the relevant UI. Space = pause/resume · ←/→ = prev/next · H = hide bar · Esc = exit.
 */
type Tag = 'REAL' | 'MEASURED' | 'GROUND TRUTH' | 'MODEL' | 'SIMULATED' | 'REVIEW REQUIRED' | 'EXTERNAL';
interface Step {
  id: string; title: string; dur: number;
  kind?: 'slide' | 'app';
  spot?: string;                         // CSS selector to spotlight
  at?: 'tl' | 'bl' | 'tr' | 'br';    // caption placement (relative to the map pane)
  kicker?: string; head?: string; body?: ReactNode; tags?: Tag[];
  enter: () => void | Promise<void>;
  slide?: () => ReactNode;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const st = () => useStore.getState();
const sc = () => sceneRef.current!;
const V3 = (x: number, y: number, z: number) => { const v = sc().focusPoint().clone(); v.set(x, y, z); return v; };

function shot(dx: number, dy: number, dz: number, ms = 3200, rotate = 0) {
  const s = sc(); const t = s.focusPoint();
  s.controls.autoRotate = false;
  s.flyTo(t, undefined, ms, V3(dx, dy, dz));
  if (rotate) setTimeout(() => { s.controls.autoRotate = true; s.controls.autoRotateSpeed = rotate; }, ms);
}
function base(extra: Record<string, unknown> = {}) {
  const s = st();
  s.set({ follow: null, compare: { on: false, before: null }, ...extra });
}
const click = async (sel: string, text?: string, wait = 450) => {
  await sleep(wait);
  const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => !text || e.textContent?.includes(text));
  el?.click();
};

function cosmosLine() {
  const i = st().health?.integrations.find((x) => x.id === 'nvidia_cosmos_reason');
  return i?.status === 'ok' ? 'running live on the event cluster' : 'deployed on the event cluster (not configured on this laptop)';
}

const STEPS: Step[] = [
  {
    id: 'title', title: 'FireScope 3D', dur: 9, kind: 'slide',
    enter: () => { const s = st(); base({ mode: 'incident', panel: 'layers', view: '3d', feedOpen: false, selectedUnitId: null, speed: 30, playing: true }); s.setLayer('projection', true); s.setTime(s.t0 + (s.t1 - s.t0) * 0.35); shot(-3400, 1700, 2900, 100, 0.35); },
    slide: () => (
      <div className="pz-title">
        <div className="pz-logo"><Logo /> FireScope 3D</div>
        <div className="pz-sub">Turning wildfire drone footage into a time-aware 3D picture of the fire.</div>
        <div className="pz-hint">Space pause · → next · ← back · Esc exit</div>
      </div>
    ),
  },
  {
    id: 'problem', title: 'The problem', dur: 16, kind: 'slide',
    enter: () => { st().set({ playing: false }); },
    slide: () => <ProblemSlide />,
  },
  {
    id: 'answer', title: 'Our answer', dur: 11, kind: 'slide',
    enter: () => { const s = st(); s.set({ playing: true, speed: 30 }); shot(2600, 1300, 3200, 2500, -0.3); },
    slide: () => (
      <div className="pz-pillars">
        <div className="pz-kicker">Our answer</div>
        <div className="pz-h1">One timeline. One map. Every piece of evidence.</div>
        <div className="pz-cards">
          {[['01', 'Map it', 'Every observation from the drone placed on real terrain, in its real position and time.'],
            ['02', 'Understand it', 'A video agent detects what changed, explains it and links you to the exact second.'],
            ['03', 'Act on it', 'Alerts, search, scenarios and response operations on the same synchronized clock.']].map(([n, h, b], i) => (
            <div key={n} className="pz-card" style={{ animationDelay: `${0.25 + i * 0.35}s` }}><div className="n">{n}</div><div className="h">{h}</div><div className="b">{b}</div></div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'twin', title: 'Digital twin', dur: 11, spot: '.map', at: 'tl',
    kicker: 'Real terrain', head: 'A digital twin of the ground', tags: ['REAL'],
    body: <>Real elevation and aerial imagery, with three levels of detail out to 70 km. Orbit, pan and zoom at 60 fps, right in the browser.</>,
    enter: () => { const s = st(); s.setLayer('projection', false); base({ mode: 'incident', panel: 'layers', view: '3d', feedOpen: false, playing: false }); s.setTime(s.t0 + 4 * 60000); shot(-900, 420, 900, 3500, 0.5); },
  },
  {
    id: 'layers', title: 'Layers', dur: 12, spot: '.right .scroll > .section:nth-child(1)', at: 'bl',
    kicker: 'Live layers', head: 'Every layer changes the scene for real', tags: ['REAL', 'MEASURED'],
    body: <>Terrain, aerial imagery, burned area, active fire, change since the previous frame, hotspots, drone footprint, burn-cell boundary and ground truth. Each one has visibility and opacity controls.</>,
    enter: () => {
      const s = st(); base({ mode: 'incident', panel: 'layers', feedOpen: false }); s.setTime(s.t0 + 6 * 60000); sc().flyFrame(260, 30, 0.5, 2400);
      const live = () => document.querySelector('.pz')?.getAttribute('data-step') === 'layers';
      setTimeout(() => live() && st().setLayer('burned', 0), 3000);
      setTimeout(() => live() && st().setLayer('burned', 0.95), 5200);
      setTimeout(() => live() && st().setLayer('imagery', 0.75), 7200);
      setTimeout(() => { st().setLayer('imagery', 0.18); st().setLayer('burned', 0.95); }, 10200);
    },
  },
  {
    id: 'observed', title: 'Observed fire', dur: 13, spot: '.left', at: 'tl',
    kicker: 'From pixels to ground', head: 'The fire, exactly as the drone saw it', tags: ['REAL', 'MEASURED'],
    body: <>Every 4 seconds we segment burned ground and flames, then cast each pixel onto the terrain from the drone's real pose. One clock drives the map, charts and video.</>,
    enter: () => { const s = st(); sc().flyFrame(250, 26, 0.5, 2800); s.setTime(s.t0 + 40000); s.set({ speed: 24, playing: true }); },
  },
  {
    id: 'area', title: 'Burned Area chart', dur: 10, spot: '.charts .chart:nth-child(1)', at: 'bl',
    kicker: 'Burned area', head: 'How much has burned, minute by minute', tags: ['MEASURED'],
    body: <>Cumulative burned ground in square metres, from the georeferenced segmentation. The dot is the current instant: solid line behind it, faded line ahead.</>,
    enter: () => { const s = st(); s.set({ playing: true, speed: 24 }); },
  },
  {
    id: 'ros', title: 'Rate of Spread chart', dur: 10, spot: '.charts .chart:nth-child(2)', at: 'bl',
    kicker: 'Rate of spread', head: 'When the fire accelerates', tags: ['MEASURED'],
    body: <>New burned area per minute, averaged over 40 seconds. Peaks are surges; the biggest ones become “rapid growth” alerts in Key Events.</>,
    enter: () => {},
  },
  {
    id: 'elev', title: 'Elevation Profile', dur: 10, spot: '.charts .chart:nth-child(3)', at: 'br',
    kicker: 'Elevation profile', head: 'The ground under the drone’s line of sight', tags: ['REAL', 'MEASURED'],
    body: <>Real elevation along the drone’s view, from 0 to 160 m. The marker shows where the burned front sits on that line, so slope and fire position can be read together.</>,
    enter: () => { st().set({ playing: false }); },
  },
  {
    id: 'weather', title: 'Weather', dur: 10, spot: '.right .scroll > .section:nth-child(3)', at: 'bl',
    kicker: 'Context', head: 'Weather at that hour and place', tags: ['EXTERNAL'],
    body: <>Wind, temperature, humidity, gusts, soil moisture and vapour-pressure deficit from the ERA5 reanalysis for that exact hour. It follows the timeline, and it is reanalysis, not an on-site sensor.</>,
    enter: () => { base({ mode: 'incident', panel: 'layers' }); },
  },
  {
    id: 'truth', title: 'Ground truth', dur: 11, spot: '.map', at: 'tl',
    kicker: 'Verified', head: 'Checked against human annotators', tags: ['GROUND TRUTH', 'MEASURED'],
    body: <><b style={{ color: '#7dd3fc' }}>Blue</b> is the dataset's hand-drawn burned area. Our segmentation agrees with it at <b>0.71 IoU</b> on the ground (0.68 in the image), across 226 annotated frames.</>,
    enter: async () => { const s = st(); s.set({ playing: false, mode: 'incident', panel: 'layers', feedOpen: false }); s.setTime(s.t0 + 9 * 60000); sc().flyFrame(300, 45, 0.3, 1000); await sleep(1100); st().set({ view: '2d' }); st().setLayer('groundTruth', true); },
  },
  {
    id: 'events', title: 'Key Events', dur: 11, spot: '.events', at: 'bl',
    kicker: 'Key events', head: 'The recording, already indexed', tags: ['MEASURED', 'MODEL'],
    body: <>Every detected event (first flames, rapid growth, flames ahead of the front, dense smoke) appears in time order and as a marker on the timeline. One click seeks the clock and flies the camera there.</>,
    enter: async () => {
      const s = st(); s.setLayer('groundTruth', false); s.set({ view: '3d', mode: 'incident', panel: 'layers', feedOpen: false });
      await sleep(1600); const ev = [...document.querySelectorAll<HTMLElement>('.events .ev')][3]; ev?.click(); sc().flyFrame(240, 28, 0.2, 2200);
    },
  },
  {
    id: 'alert', title: 'Evidence-linked alerts', dur: 13, spot: '.feed', at: 'bl',
    kicker: 'Video understanding', head: 'Alerts with the proof attached', tags: ['MEASURED', 'REVIEW REQUIRED'],
    body: <>Rapid growth, flames ahead of the front, dense smoke… Each alert opens the footage at the exact second, with the region to review boxed on the video.</>,
    enter: async () => {
      const s = st(); s.setLayer('groundTruth', false); s.set({ view: '3d', panel: 'layers' });
      const e = s.events.find((x) => x.event_type === 'visible_fire_expansion' && x.severity === 'alert') ?? s.events[0];
      await sleep(700); if (e) selectEvent(e.event_id, false);
      sc().flyFrame(240, 30, 0.65, 2600);
      await sleep(2000); st().set({ mode: 'drones', feedOpen: true, selectedUnitId: null });
    },
  },
  {
    id: 'agent', title: 'Ask the video', dur: 13, spot: '.right', at: 'bl',
    kicker: 'Video agent', head: 'Ask the footage in plain English', tags: ['MODEL'],
    body: <>Answers come with clickable citations that jump the video and the map. Clip analysis uses NVIDIA Cosmos Reason, {cosmosLine()}.</>,
    enter: async () => { st().set({ mode: 'incident', panel: 'analysis', feedOpen: true }); await click('.suggest button', undefined, 700); await sleep(900); sc().flyFrame(260, 30, 0.55, 2200); },
  },
  {
    id: 'search', title: 'Semantic search', dur: 10, spot: '.right', at: 'bl',
    kicker: 'Search by meaning', head: 'Find the moment, not the timestamp', tags: ['MODEL'],
    body: <>Cosmos Embed puts video clips and text queries in the same vector space, alongside the team's VAST / VSS video archive.</>,
    enter: async () => { st().set({ panel: 'evidence', feedOpen: false }); sc().flyFrame(300, 34, 0.3, 2400); await click('.btn-sm', 'dense smoke', 700); },
  },
  {
    id: 'scenario', title: 'Large-fire scenario', dur: 13, spot: '.map', at: 'bl',
    kicker: 'What if it gets big?', head: 'Stress-test the response on real ridges', tags: ['SIMULATED'],
    body: <>A wind- and slope-driven spread over the real elevation model, run in a fraction of a second. Clearly labelled, and never a forecast.</>,
    enter: () => { const s = st(); base({ mode: 'incident', panel: 'layers', feedOpen: false, speed: 40, playing: true }); s.setLayer('projection', true); s.setTime(s.t0 + (s.t1 - s.t0) * 0.06); shot(-3600, 1650, 2600, 3000, 0.45); },
  },
  {
    id: 'fleet', title: 'Drone fleet', dur: 11, spot: '.feed', at: 'bl',
    kicker: 'A fleet, not a feed', head: 'Six drones, one shared picture', tags: ['REAL', 'SIMULATED'],
    body: <>UAV-01 is real recorded footage. FT-02 to FT-06 are simulated, with camera views rendered from the 3D twin (EO and IR* looks).</>,
    enter: async () => { const s = st(); sc().controls.autoRotate = false; s.setLayer('projection', false); s.set({ playing: false, mode: 'drones', feedOpen: true }); await sleep(300); st().set({ selectedUnitId: 'FT-02', feedOpen: true }); await sleep(1700); sc().flyFrame(420, 30, 0.9, 2200); await click('.feed-bar button', 'IR*', 400); },
  },
  {
    id: 'resources', title: 'Response operations', dur: 13, at: 'tl',
    kicker: 'Coordinate the response', head: 'Chase the tankers, follow the line', tags: ['SIMULATED'],
    body: <>Air tankers, helicopters, engines and crews on the same timeline. Chase an aircraft, watch the retardant drops and the fire line being cut.</>,
    enter: async () => { const s = st(); s.setLayer('projection', false); s.set({ mode: 'resources', feedOpen: false, playing: false }); s.setTime(s.t0 + 7.2 * 60000); s.set({ selectedUnitId: 'T-910' }); await sleep(1100); st().set({ follow: { id: 'T-910', mode: 'chase' }, playing: true, speed: 3 }); },
  },
  {
    id: 'trust', title: 'Trust', dur: 10, spot: '.right', at: 'bl',
    kicker: 'Built to be trusted', head: 'Every number shows where it came from', tags: ['MEASURED', 'MODEL', 'EXTERNAL', 'SIMULATED'],
    body: <>Provenance chips on every metric, live integration status, and honest limits: RGB measures no temperature, and georeferencing is approximate.</>,
    enter: () => { base({ mode: 'incident', panel: 'notes', playing: false, feedOpen: false }); sc().flyFrame(320, 32, 0.4); },
  },
  {
    id: 'close', title: 'FireScope 3D', dur: 0, kind: 'slide',
    enter: () => { const s = st(); s.set({ panel: 'layers', speed: 30, playing: true }); s.setLayer('projection', true); s.setTime(s.t0 + (s.t1 - s.t0) * 0.5); shot(3000, 1500, 3000, 2500, -0.35); },
    slide: () => (
      <div className="pz-title">
        <div className="pz-kicker" style={{ textAlign: 'center' }}>From raw drone video to spatial intelligence</div>
        <div className="pz-logo"><Logo /> FireScope 3D</div>
        <div className="pz-sub">Map it · Understand it · Act on it</div>
        <div className="pz-sponsors">NVIDIA Cosmos Reason &amp; Cosmos Embed · VAST Data / VSS · CoreWeave · Weights &amp; Biases · Cursor</div>
        <div className="pz-hint">Real footage: BurnedAreaUAV (CC-BY-4.0) · Large fire, fleet and resources shown are simulated</div>
      </div>
    ),
  },
];

function ProblemSlide() {
  const src = useStore((s) => s.sources[0]);
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => { const el = v.current; if (el) { el.currentTime = 215; el.play().catch(() => {}); } }, []);
  const items = [
    ['Locked to the camera', 'Operators must rebuild in their heads where on the ground each frame is.'],
    ['Hard to compare', 'How much has it grown in three minutes? You rewind and guess.'],
    ['Critical seconds get buried', 'A flare-up ahead of the front can last ten seconds in fifteen minutes of video.'],
    ['Impossible to search', 'Nobody can ask an MP4: “when did dense smoke start?”'],
  ];
  return (
    <div className="pz-problem">
      {src && <video ref={v} className="pz-bgvid" src={mediaUrl(src.media_url)} muted playsInline loop />}
      <div className="pz-problem-in">
        <div className="pz-kicker">The problem</div>
        <div className="pz-h1">Drones film every wildfire.<br />Nobody can use all that video in time.</div>
        <div className="pz-list">
          {items.map(([h, b], i) => <div key={h} className="pz-li" style={{ animationDelay: `${0.6 + i * 0.9}s` }}><span className="pz-num">{i + 1}</span><div><b>{h}</b><span>{b}</span></div></div>)}
        </div>
        <div className="pz-foot">Real footage · prescribed burn, Torre do Pinhão (PT) · BurnedAreaUAV dataset</div>
      </div>
    </div>
  );
}

export function Presenter() {
  const set = useStore((s) => s.set);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hideBar, setHideBar] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; k: string } | null>(null);

  const go = useCallback((n: number) => { const k = Math.max(0, Math.min(STEPS.length - 1, n)); setI(k); setElapsed(0); }, []);
  const exit = useCallback(() => {
    const s = st(), scene = sceneRef.current;
    if (scene) scene.controls.autoRotate = false;
    s.set({ presenting: false, follow: null, playing: false, mode: 'incident', panel: 'layers', view: '3d', feedOpen: false, selectedUnitId: null });
    s.setLayer('projection', false); s.setLayer('groundTruth', false);
  }, []);

  useEffect(() => { void step.enter(); }, [i]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {   // step timer (pausable)
    if (paused || !step.dur) return;
    const t = setInterval(() => setElapsed((e) => { const n = e + 0.1; if (n >= step.dur) { go(i + 1); return 0; } return n; }), 100);
    return () => clearInterval(t);
  }, [paused, i, step.dur, go]);

  useEffect(() => {   // follow spotlight target + map pane
    const upd = () => {
      setRect(step.spot ? document.querySelector(step.spot)?.getBoundingClientRect() ?? null : null);
    };
    upd(); const t = setInterval(upd, 250); return () => clearInterval(t);
  }, [step.spot]);

  // Place the caption in the map corner that covers the least of: the fire zone, the drone camera window and the spotlight.
  useEffect(() => {
    setPos(null);
    const place = () => {
      const m = document.querySelector('.map')?.getBoundingClientRect(), c = card.current;
      if (!m || !c) return;
      const cw = c.offsetWidth, ch = c.offsetHeight, M = 24;
      const C: Record<string, [number, number]> = { tl: [m.left + M, m.top + 64], tr: [m.right - cw - M, m.top + 64], bl: [m.left + M, m.bottom - ch - M], br: [m.right - cw - M, m.bottom - ch - 64] };
      const prot: { x0: number; y0: number; x1: number; y1: number; w: number }[] = [];
      const add = (r: DOMRect | null | undefined, w = 1) => { if (r && r.width > 0) prot.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, w }); };
      add(document.querySelector('.feed')?.getBoundingClientRect(), 3);
      if (step.spot && !['.map', '.left'].includes(step.spot)) add(document.querySelector(step.spot)?.getBoundingClientRect(), 2);
      const fb = sceneRef.current?.fireScreenBox();
      if (fb && st().mode !== 'resources') prot.push({ x0: m.left + fb.x0 - 60, y0: m.top + fb.y0 - 60, x1: m.left + fb.x1 + 60, y1: m.top + fb.y1 + 60, w: 2.5 });
      const ov = (x: number, y: number) => prot.reduce((a, p) => a + p.w * Math.max(0, Math.min(x + cw, p.x1) - Math.max(x, p.x0)) * Math.max(0, Math.min(y + ch, p.y1) - Math.max(y, p.y0)), 0);
      const pref = step.at ?? 'bl';
      let best: string = pref, bestS = ov(...C[pref]) * 0.92;
      for (const k of Object.keys(C)) { const sc2 = ov(...C[k]); if (sc2 < bestS) { best = k; bestS = sc2; } }
      setPos((p) => {
        if (p && p.k !== best) { const cur = ov(...C[p.k]); if (cur - bestS < cw * ch * 0.08) return { k: p.k, x: C[p.k][0], y: C[p.k][1] }; }
        return { k: best, x: C[best][0], y: C[best][1] };
      });
    };
    const t0 = setTimeout(place, 60); const t = setInterval(place, 400);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [i, step.spot, step.at]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const map: Record<string, () => void> = { ' ': () => setPaused((p) => !p), ArrowRight: () => go(i + 1), ArrowLeft: () => go(i - 1), Escape: exit, h: () => setHideBar((h) => !h), H: () => setHideBar((h) => !h) };
      if (map[e.key]) { e.preventDefault(); e.stopPropagation(); map[e.key](); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [i, go, exit]);
  void set;

  const pad = 8;
  const cardPos: React.CSSProperties = pos ? { left: pos.x, top: pos.y } : { left: -9999, top: 0 };

  return (
    <div className="pz" data-step={step.id}>
      {step.kind === 'slide' ? (
        <div className={'pz-slide' + (step.id === 'problem' ? ' dark' : '')} key={step.id}>{step.slide?.()}</div>
      ) : (
        <>
          {rect && <div className="pz-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />}
          {!rect && <div className="pz-dim" />}
          <div className="pz-caption" key={step.id} ref={card} style={cardPos}>
            <div className="pz-kicker">{String(i - 2).padStart(2, '0')} · {step.kicker}</div>
            <div className="pz-head">{step.head}</div>
            <div className="pz-body">{step.body}</div>
            {step.tags && <div className="pz-tags">{step.tags.map((t) => <span key={t} className={'pz-tag t-' + t.split(' ')[0].toLowerCase()}>{t}</span>)}</div>}
          </div>
        </>
      )}
      <div className={'pz-bar' + (hideBar ? ' hidden' : '') + (rect && rect.bottom > innerHeight - 140 ? ' top' : '')}>
        <button onClick={() => go(i - 1)} title="Previous (←)">‹</button>
        <button className="pp" onClick={() => setPaused(!paused)} title="Pause / resume (Space)">{paused ? '▶' : '❚❚'}</button>
        <button onClick={() => go(i + 1)} title="Next (→)">›</button>
        <div className="pz-meta">
          <div className="pz-name"><span>{i + 1} / {STEPS.length}</span>{step.title}{paused && <em>paused</em>}</div>
          <div className="pz-dots">{STEPS.map((s, k) => <i key={s.id} className={k < i ? 'done' : k === i ? 'cur' : ''} onClick={() => go(k)} title={s.title}>{k === i && step.dur ? <b style={{ width: `${(elapsed / step.dur) * 100}%` }} /> : null}</i>)}</div>
        </div>
        <button onClick={exit} title="Exit (Esc)">✕</button>
      </div>
    </div>
  );
}
