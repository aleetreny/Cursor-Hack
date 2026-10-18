import { useEffect, useRef, useState, type RefObject } from 'react';
import { LiveAnalyzer, loadSegmenter, type LiveStats } from '../ai/live';

const pct = (v: number) => (v >= 0.1 ? `${Math.round(v * 100)}%` : `${(v * 100).toFixed(1)}%`);

/**
 * The live-analysis layer over a <video>: an overlay canvas (burned ground, flames, smoke) and a HUD line with what it
 * measures and how fast. Loads the segmenter (13 MB, from this site) the first time it is turned on.
 */
export function LiveOverlay({ video, on, zoom = 1 }: { video: RefObject<HTMLVideoElement | null>; on: boolean; zoom?: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const an = useRef<LiveAnalyzer | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [prog, setProg] = useState(0);
  const [err, setErr] = useState('');
  const [st, setSt] = useState<LiveStats | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // 1. the model, once, the first time live analysis is turned on
  useEffect(() => {
    if (!on && state === 'error') { setState('idle'); return; }   // turning it off and on again retries
    if (!on || state !== 'idle') return;
    setState('loading'); setErr('');
    loadSegmenter((l, t) => { if (mounted.current) setProg(t ? l / t : 0); })
      .then(() => { if (mounted.current) setState('ready'); })
      .catch((e) => { if (mounted.current) { setState('error'); setErr(e instanceof Error ? e.message : String(e)); } });
  }, [on, state]);
  // 2. the analysis loop while it is on
  useEffect(() => {
    if (!on || state !== 'ready' || !video.current || !cv.current) return;
    an.current ??= new LiveAnalyzer(video.current, cv.current, (s) => { if (mounted.current) setSt(s); });
    (window as unknown as { __live?: LiveAnalyzer }).__live = an.current;
    an.current.start();
    return () => an.current?.stop();
  }, [on, state, video]);
  useEffect(() => () => { an.current?.stop(); an.current = null; }, []);
  return (
    <>
      {/* kept mounted while off, so the analyser keeps its canvas */}
      <canvas ref={cv} className="live-cv" style={{ transform: `scale(${zoom})`, display: on ? undefined : 'none' }} aria-hidden />
      {on && <div className="live-hud" role="status">
        <b>LIVE AI</b>
        {state === 'loading' && <span>loading model {Math.round(prog * 13)} / 13 MB…</span>}
        {state === 'error' && <span className="e">failed: {err}</span>}
        {state === 'ready' && !st && <span>waiting for a frame…</span>}
        {state === 'ready' && st && <>
          <span><i className="k b" />burned {pct(st.burned)}</span>
          <span><i className="k f" />flames {pct(st.flames)}</span>
          <span><i className="k s" />smoke {pct(st.smoke)}</span>
          <span className="m">{st.fps ? `${st.fps.toFixed(0)} fps` : `${Math.round(st.ms)} ms`} · {st.ep === 'webgpu' ? 'WebGPU' : 'WASM'}</span>
        </>}
      </div>}
    </>
  );
}
