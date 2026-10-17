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
  at?: 'tl' | 'bl' | 'tr' | 'center';    // caption placement (relative to the map pane)
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
    id: 'observed', title: 'Observed fire', dur: 13, spot: '.left', at: 'tl',
    kicker: 'From pixels to ground', head: 'The fire, exactly as the drone saw it', tags: ['REAL', 'MEASURED'],
    body: <>Every 4 seconds we segment burned ground and flames, then cast each pixel onto the terrain from the drone's real pose. One clock drives the map, charts and video.</>,
    enter: () => { const s = st(); sc().controls.autoRotate = false; sc().flyHome(); s.setTime(s.t0 + 40000); s.set({ speed: 24, playing: true }); },
  },
  {
    id: 'truth', title: 'Ground truth', dur: 11, spot: '.map', at: 'tl',
    kicker: 'Verified', head: 'Checked against human annotators', tags: ['GROUND TRUTH', 'MEASURED'],
    body: <><b style={{ color: '#7dd3fc' }}>Blue</b> is the dataset's hand-drawn burned area. Our segmentation agrees with it at <b>0.71 IoU</b> on the ground (0.68 in the image), across 226 annotated frames.</>,
    enter: () => { const s = st(); s.set({ playing: false, view: '2d' }); s.setTime(s.t0 + 9 * 60000); s.setLayer('groundTruth', true); },
  },
  {
    id: 'alert', title: 'Evidence-linked alerts', dur: 13, spot: '.feed', at: 'bl',
    kicker: 'Video understanding', head: 'Alerts with the proof attached', tags: ['MEASURED', 'REVIEW REQUIRED'],
    body: <>Rapid growth, flames ahead of the front, dense smoke… Each alert opens the footage at the exact second, with the region to review boxed on the video.</>,
    enter: async () => {
      const s = st(); s.setLayer('groundTruth', false); s.set({ view: '3d' });
      const e = s.events.find((x) => x.event_type === 'visible_fire_expansion' && x.severity === 'alert') ?? s.events[0];
      await sleep(900); if (e) selectEvent(e.event_id);
      await sleep(2200); st().set({ mode: 'drones', feedOpen: true, selectedUnitId: null });
    },
  },
  {
    id: 'agent', title: 'Ask the video', dur: 13, spot: '.right', at: 'bl',
    kicker: 'Video agent', head: 'Ask the footage in plain English', tags: ['MODEL'],
    body: <>Answers come with clickable citations that jump the video and the map. Clip analysis uses NVIDIA Cosmos Reason, {cosmosLine()}.</>,
    enter: async () => { st().set({ mode: 'incident', panel: 'analysis', feedOpen: true }); await click('.suggest button', undefined, 700); },
  },
  {
    id: 'search', title: 'Semantic search', dur: 10, spot: '.right', at: 'bl',
    kicker: 'Search by meaning', head: 'Find the moment, not the timestamp', tags: ['MODEL'],
    body: <>Cosmos Embed puts video clips and text queries in the same vector space, alongside the team's VAST / VSS video archive.</>,
    enter: async () => { st().set({ panel: 'evidence', feedOpen: false }); await click('.btn-sm', 'dense smoke', 700); },
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
    enter: async () => { const s = st(); sc().controls.autoRotate = false; s.set({ playing: false, mode: 'drones', feedOpen: true }); await sleep(300); st().set({ selectedUnitId: 'FT-02', feedOpen: true }); await click('.feed-bar button', 'IR*', 1400); },
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
    enter: () => { base({ mode: 'incident', panel: 'notes', playing: false }); sc().flyHome(); },
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
  const [mapR, setMapR] = useState<DOMRect | null>(null);
  const step = STEPS[i];

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
      setMapR(document.querySelector('.map')?.getBoundingClientRect() ?? null);
      setRect(step.spot ? document.querySelector(step.spot)?.getBoundingClientRect() ?? null : null);
    };
    upd(); const t = setInterval(upd, 250); return () => clearInterval(t);
  }, [step.spot]);

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
  const cardPos: React.CSSProperties = (() => {
    const m = mapR; if (!m) return { left: 40, bottom: 40 };
    switch (step.at) {
      case 'tl': return { left: m.left + 28, top: m.top + 72 };
      case 'tr': return { right: innerWidth - m.right + 28, top: m.top + 72 };
      case 'center': return { left: m.left + m.width / 2, top: m.top + m.height / 2, transform: 'translate(-50%,-50%)' };
      default: return { left: m.left + 28, bottom: innerHeight - m.bottom + 28 };
    }
  })();

  return (
    <div className="pz" data-step={step.id}>
      {step.kind === 'slide' ? (
        <div className={'pz-slide' + (step.id === 'problem' ? ' dark' : '')} key={step.id}>{step.slide?.()}</div>
      ) : (
        <>
          {rect && <div className="pz-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />}
          {!rect && <div className="pz-dim" />}
          <div className="pz-caption" key={step.id} style={cardPos}>
            <div className="pz-kicker">{String(i - 2).padStart(2, '0')} · {step.kicker}</div>
            <div className="pz-head">{step.head}</div>
            <div className="pz-body">{step.body}</div>
            {step.tags && <div className="pz-tags">{step.tags.map((t) => <span key={t} className={'pz-tag t-' + t.split(' ')[0].toLowerCase()}>{t}</span>)}</div>}
          </div>
        </>
      )}
      <div className={'pz-bar' + (hideBar ? ' hidden' : '')}>
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
