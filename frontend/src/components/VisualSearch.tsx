import { useEffect } from 'react';
import { useStore } from '../state/store';
import { seekCitation, showSatelliteHit } from '../scene/SceneView';
import { fmtDay, fmtVideo, fmtWhen } from '../lib/format';
import { CLIP_DOWNLOAD_MB } from '../ai/models';
import { disableVisual, enableVisual, useVisual, visualAvailable, type VisualSearch } from '../ai/visual';
import { Icon } from './Icon';

const MB = (b: number) => Math.round(b / 1e6);

/** The opt-in card (off / downloading / failed) or, once on, a one-line status. */
export function VisualSearchToggle() {
  const { status, loaded, total, error, available } = useVisual();
  const regional = useStore((s) => s.incident?.scale === 'regional');
  const incidentId = useStore((s) => s.incident?.id);
  useEffect(() => { void visualAvailable(); }, [incidentId]);
  if (!available) return null;
  if (status === 'ready') return (
    <div className="ai-on"><span className="tag">Visual search on</span><span>MobileCLIP-S0 · in your browser · {regional ? 'Sentinel-2 passes' : 'every 2 s of footage'}</span>
      <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={disableVisual} title="Turn visual search off on this device">Turn off</button></div>
  );
  return (
    <div className="ai-card">
      <div className="h"><Icon name="search" size={12} /> Search the pixels too</div>
      {regional
        ? 'Find what Sentinel-2 saw on each pass of the fire: “smoke plume”, “burn scar”, “clouds”, “reservoir” — in English or Spanish.'
        : 'Find moments by what the drone camera saw: “dense smoke”, “tall flames”, “burned ground” — in English or Spanish.'}
      {' '}An image–text model (MobileCLIP-S0) runs in your browser: nothing is sent anywhere.
      <div className="row">
        {status === 'loading'
          ? <><div className="ai-bar" role="progressbar" aria-label="Downloading the model" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((100 * loaded) / total)}><i style={{ width: `${Math.min(100, (100 * loaded) / total)}%` }} /></div><span className="muted mono">{MB(loaded)} / {MB(total) || CLIP_DOWNLOAD_MB} MB</span></>
          : <><button className="btn-sm primary" onClick={() => enableVisual()}>Turn on · {CLIP_DOWNLOAD_MB} MB once</button><span className="muted">then cached on this device</span></>}
      </div>
      {status === 'error' && <div className="err" style={{ marginTop: 6 }}>Could not load the model: {error}</div>}
    </div>
  );
}

const STRENGTH = {
  strong: 'Clear match',
  weak: 'Possible match: check the images',
  none: 'No clear match',
};

/** Visual results: drone frames (with the matching part of the frame outlined) or Sentinel-2 squares. */
export function VisualResults({ r }: { r: VisualSearch }) {
  const sources = useStore((s) => s.sources);
  const m = r.meta;
  const video = m.kind === 'video';
  const dim = r.strength === 'none';
  // width of the satellite box in km (for the square labels)
  const boxKm = m.bbox ? (m.bbox[2] - m.bbox[0]) * 111.32 * Math.cos((((m.bbox[1] + m.bbox[3]) / 2) * Math.PI) / 180) : 0;
  return (
    <div className="vres">
      <div className="vh">{video ? 'What the drone camera saw' : 'What Sentinel-2 saw'} <small>{STRENGTH[r.strength]} · {r.model} · {r.ms} ms</small></div>
      {r.translated && <div className="vmsg">Searched as “{r.english}”.</div>}
      {r.tooSmall
        ? <div className="vmsg none">People, vehicles and aircraft are far smaller than a Sentinel-2 pixel (10–20 m): they cannot be seen from orbit. Closest images anyway:</div>
        : dim ? <div className="vmsg none">Nothing in {video ? 'this footage' : 'these satellite images'} stands out as “{r.english}”{r.synonyms.length ? ` (it is everywhere, or nowhere)` : ''}. The closest images:</div> : null}
      <div className={'vgrid' + (dim ? ' dim' : '')}>
        {r.hits.map((h, i) => {
          if (video) {
            const sp = m.sprite!, col = h.frame! % sp.per_row, row = Math.floor(h.frame! / sp.per_row);
            const crop = m.crops![h.crop!];
            const go = () => seekCitation(sources[0]?.id ?? 'drone_replay_01', h.t!);
            return (
              <button key={i} className="vhit" onClick={go} title={`Jump to ${fmtVideo(h.t!)} in the footage`} aria-label={`Frame at ${fmtVideo(h.t!)}, match ${Math.round(h.rel * 100)}%`}>
                <div className="im" style={{ backgroundImage: `url(${r.base}${sp.url})`, backgroundSize: `${sp.per_row * 100}% auto`, backgroundPosition: `${(col / (sp.per_row - 1)) * 100}% ${(row / (Math.ceil(m.times!.length / sp.per_row) - 1)) * 100}%` }} />
                {h.crop! > 0 && <div className="crop" style={{ left: `${crop[0] * 100}%`, top: `${crop[1] * 100}%`, width: `${(crop[2] - crop[0]) * 100}%`, height: `${(crop[3] - crop[1]) * 100}%` }} />}
                <div className="meter" style={{ width: `${Math.max(6, h.rel * 100)}%` }} />
                <div className="lab"><span>{fmtVideo(h.t!)}</span></div>
              </button>
            );
          }
          const p = m.passes![h.pass!], [x0, y0, x1, y1] = h.box!, w = x1 - x0, hh = y1 - y0;
          const go = () => showSatelliteHit(p.time, h.box!);
          return (
            <button key={i} className="vhit sq" onClick={go} title={`Show this place on the ${fmtWhen(Date.parse(p.time))} UTC pass`} aria-label={`Sentinel-2, ${fmtWhen(Date.parse(p.time))}, match ${Math.round(h.rel * 100)}%`}>
              <div className="im" style={{ backgroundImage: `url(${r.base}${p.image})`, backgroundSize: `${100 / w}% ${100 / hh}%`, backgroundPosition: `${(x0 / (1 - w)) * 100}% ${(y0 / (1 - hh)) * 100}%` }} />
              <div className="meter" style={{ width: `${Math.max(6, h.rel * 100)}%` }} />
              <div className="lab"><span>{fmtDay(Date.parse(p.time))}</span><span>{(w * boxKm).toFixed(1)} km</span></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
