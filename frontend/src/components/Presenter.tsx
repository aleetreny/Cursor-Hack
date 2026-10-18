import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { sceneRef } from '../scene/SceneView';
import { mediaUrl } from '../api/client';
import { Logo } from './Icon';

/**
 * Presentation mode: a chaptered story that drives the REAL app (camera, timeline, panels) and explains each step with
 * large caption cards + a spotlight on the relevant UI. It only advances when the presenter asks:
 * → / Space / Enter / PageDown = next · ← / PageUp = back · H = hide bar · Esc = exit.
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

let epoch = 0;
class Stale extends Error {}
/** Sleep that aborts (throws) if the presenter moved to another chapter meanwhile. */
const sleep = async (ms: number) => { const e = epoch; await new Promise((r) => setTimeout(r, ms)); if (e !== epoch) throw new Stale(); };
const later = (ms: number, fn: () => void) => { const e = epoch; setTimeout(() => { if (e === epoch) fn(); }, ms); };
const st = () => useStore.getState();
const sc = () => sceneRef.current!;
const V3 = (x: number, y: number, z: number) => { const v = sc().focusPoint().clone(); v.set(x, y, z); return v; };

function shot(dx: number, dy: number, dz: number, ms = 3200, rotate = 0) {
  const s = sc(); const t = s.focusPoint();
  s.controls.autoRotate = false;
  s.flyTo(t, undefined, ms, V3(dx, dy, dz));
  if (rotate) later(ms, () => { s.controls.autoRotate = true; s.controls.autoRotateSpeed = rotate; });
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

const STEPS: Step[] = [
  {
    id: 'title', title: 'FireScope 3D', dur: 9, kind: 'slide',
    enter: () => { const s = st(); base({ mode: 'incident', panel: 'layers', view: '3d', feedOpen: false, selectedUnitId: null, speed: 30, playing: true }); s.setLayer('projection', true); s.setTime(s.t0 + (s.t1 - s.t0) * 0.35); shot(-3400, 1700, 2900, 100, 0.35); },
    slide: () => (
      <div className="pz-title">
        <div className="pz-logo"><Logo /> FireScope 3D</div>
        <div className="pz-sub">Turning wildfire drone footage into a time-aware 3D picture of the fire.</div>
        <div className="pz-hint">→ or Space next · ← back · H hide bar · Esc exit</div>
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
            ['02', 'Understand it', 'Computer vision measures what changed; an analyst you can question explains it and links to the exact second.'],
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
      later(3000, () => st().setLayer('burned', 0));
      later(5200, () => st().setLayer('burned', 0.95));
      later(7200, () => st().setLayer('imagery', 0.75));
      later(9000, () => { st().setLayer('imagery', 0.18); st().setLayer('burned', 0.95); });
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
    kicker: 'Rate of spread', head: 'How fast the front moves', tags: ['MEASURED'],
    body: <>Metres per minute: the leading edge of the burned outline compared with one minute earlier. The surges line up with the “rapid growth” alerts in Key Events.</>,
    enter: () => {},
  },
  {
    id: 'elev', title: 'Terrain profile', dur: 10, spot: '.charts .chart:nth-child(3)', at: 'br',
    kicker: 'Terrain profile', head: 'Where the burn sits on the hillside', tags: ['REAL', 'MEASURED'],
    body: <>Real elevation along the planned burn cell, through the fire. Shaded is the cell, red is what has burned in the drone’s view, and the dot is the drone, so slope and fire position can be read together.</>,
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
    kicker: 'Key events', head: 'The recording, already indexed', tags: ['MEASURED', 'REVIEW REQUIRED'],
    body: <>Every event the measurements detect (first flames, rapid growth, flames ahead of the front, dense smoke) appears in time order and as a marker on the timeline. One click seeks the clock and flies the camera there. Each one waits for a human to confirm it.</>,
    enter: async () => {
      const s = st(); s.setLayer('groundTruth', false); s.set({ view: '3d', mode: 'incident', panel: 'layers', feedOpen: false });
      await sleep(1600); const ev = [...document.querySelectorAll<HTMLElement>('.events .ev')][3]; ev?.click(); sc().flyFrame(240, 28, 0.2, 2200);
    },
  },
  {
    id: 'live', title: 'Live drone video', spot: '.feed', at: 'bl', dur: 0,
    kicker: 'Drone video, in real time', head: 'The footage, playing in sync with the map', tags: ['REAL', 'MEASURED'],
    body: <>The recorded drone video plays at 1× while the burn scar and flames update on the terrain below. When the measurements flag a change, the region to review is boxed on the video at that second.</>,
    enter: async () => {
      const s = st(); s.setLayer('groundTruth', false);
      base({ view: '3d', panel: 'layers', mode: 'drones', feedOpen: true, selectedUnitId: null, playing: false, speed: 1 });
      s.setTime(s.t0 + 214000);
      sc().flyFrame(250, 28, 0.6, 2400);
      await sleep(900); st().set({ playing: true, speed: 1 });
    },
  },
  {
    id: 'agent', title: 'Ask the incident', dur: 13, spot: '.right', at: 'bl',
    kicker: 'Incident analyst', head: 'Ask in plain English or Spanish', tags: ['MEASURED'],
    body: <>Where was it, when did it grow fastest, what was the wind? Answers are computed from the recorded measurements, right in the browser, with nothing invented. Every citation jumps the video and the map.</>,
    enter: async () => { st().set({ mode: 'incident', panel: 'analysis', feedOpen: true }); await click('.suggest button', undefined, 700); await sleep(900); sc().flyFrame(260, 30, 0.55, 2200); },
  },
  {
    id: 'search', title: 'Semantic search', dur: 10, spot: '.right', at: 'bl',
    kicker: 'Search the footage', head: 'Find the moment, not the timestamp', tags: ['MEASURED'],
    body: <>Type “dense smoke” or “llamas fuera del frente” and get the clips where it was measured, with a thumbnail and a jump to that second.</>,
    enter: async () => { st().set({ panel: 'evidence', feedOpen: false }); sc().flyFrame(300, 34, 0.3, 2400); await click('.btn-sm', 'dense smoke', 700); },
  },
  {
    id: 'scenario', title: 'Large-fire scenario', dur: 13, spot: '.map', at: 'bl',
    kicker: 'What if it gets big?', head: 'Stress-test the response on real ridges', tags: ['SIMULATED'],
    body: <>A wind- and slope-driven spread over the real elevation model, run in a fraction of a second. Clearly labelled, and never a forecast.</>,
    enter: () => { const s = st(); base({ mode: 'incident', panel: 'layers', feedOpen: false, speed: 40, playing: true }); s.setLayer('projection', true); s.setTime(s.t0 + (s.t1 - s.t0) * 0.06); shot(-3600, 1650, 2600, 3000, 0.45); },
  },
  {
    id: 'resources', title: 'Response operations', dur: 13, at: 'tl',
    kicker: 'Coordinate the response', head: 'Chase the tankers, follow the line', tags: ['SIMULATED'],
    body: <>Air tankers, helicopters, engines and crews on the same timeline. Chase an aircraft, watch the retardant drops and the fire line being cut.</>,
    enter: async () => { const s = st(); s.setLayer('projection', false); s.set({ mode: 'resources', feedOpen: false, playing: false }); s.setTime(s.t0 + 7.2 * 60000); s.set({ selectedUnitId: 'T-910' }); await sleep(1100); st().set({ follow: { id: 'T-910', mode: 'chase' }, playing: true, speed: 3 }); },
  },
  {
    id: 'close', title: 'FireScope 3D', dur: 0, kind: 'slide',
    enter: () => { const s = st(); base({ mode: 'incident', panel: 'layers', feedOpen: false, selectedUnitId: null, speed: 30, playing: true }); s.setLayer('projection', true); s.setTime(s.t0 + (s.t1 - s.t0) * 0.5); shot(3000, 1500, 3000, 2500, -0.35); },
    slide: () => (
      <div className="pz-title">
        <div className="pz-kicker" style={{ textAlign: 'center' }}>From raw drone video to spatial intelligence</div>
        <div className="pz-logo"><Logo /> FireScope 3D</div>
        <div className="pz-sub">Map it · Understand it · Act on it</div>
        <div className="pz-sponsors">Born at the VAST Builders Challenge 2026 · runs entirely in your browser</div>
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
  const [hideBar, setHideBar] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; k: string } | null>(null);

  const go = useCallback((n: number) => { const k = Math.max(0, Math.min(STEPS.length - 1, n)); setI(k); }, []);
  const exit = useCallback(() => {
    const s = st(), scene = sceneRef.current;
    if (scene) scene.controls.autoRotate = false;
    s.set({ presenting: false, follow: null, playing: false, mode: 'incident', panel: 'layers', view: '3d', feedOpen: false, selectedUnitId: null });
    s.setLayer('projection', false); s.setLayer('groundTruth', false);
  }, []);

  useEffect(() => {
    epoch++;
    const sc0 = sceneRef.current; if (sc0) sc0.controls.autoRotate = false;
    if (step.id !== 'layers') { const s0 = st(); if (s0.layers.burned < 0.5) s0.setLayer('burned', 0.95); if (s0.layers.imagery > 0.3) s0.setLayer('imagery', 0.18); }
    Promise.resolve().then(step.enter).catch((e) => { if (!(e instanceof Stale)) console.warn(e); });
  }, [i]);   // eslint-disable-line react-hooks/exhaustive-deps

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
      const typing = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
      if (typing && e.key !== 'Escape') return;   // Esc always leaves the tour
      const map: Record<string, () => void> = { ' ': () => go(i + 1), Enter: () => go(i + 1), PageDown: () => go(i + 1), PageUp: () => go(i - 1), ArrowRight: () => go(i + 1), ArrowLeft: () => go(i - 1), Escape: exit, h: () => setHideBar((h) => !h), H: () => setHideBar((h) => !h) };
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
            <div className="pz-kicker"><span className="pz-no">{i + 1}</span>{step.kicker}</div>
            <div className="pz-head">{step.head}</div>
            <div className="pz-body">{step.body}</div>
            {step.tags && <div className="pz-tags">{step.tags.map((t) => <span key={t} className={'pz-tag t-' + t.split(' ')[0].toLowerCase()}>{t}</span>)}</div>}
          </div>
        </>
      )}
      <div className={'pz-bar' + (hideBar ? ' hidden' : '') + (rect && rect.top > innerHeight * 0.55 ? ' top' : '')}>
        <button onClick={() => go(i - 1)} title="Previous (←)">‹</button>
        <button className="pp" onClick={() => go(i + 1)} title="Next chapter (→ / Space)" disabled={i === STEPS.length - 1}>Next ›</button>
        <div className="pz-meta">
          <div className="pz-name"><span>{i + 1} / {STEPS.length}</span>{step.title}</div>
          <div className="pz-dots">{STEPS.map((s, k) => <i key={s.id} className={k < i ? 'done' : k === i ? 'cur' : ''} onClick={() => go(k)} title={s.title} />)}</div>
        </div>
        <button onClick={exit} title="Exit (Esc)">✕</button>
      </div>
    </div>
  );
}
