import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { SIM_UNITS, opsTotals, unitState, type SimUnit } from '../sim/ops';
import { useSimCtx } from '../sim/useSim';
import { formatLat, formatLon } from '../scene/geo';
import { fmtNum } from '../lib/format';

const ICON: Record<string, string> = { air_tanker: '✈', helicopter: '🚁', air_attack: '✈', engine: '🚒', tender: '🚚', crew: '👷', dozer: '🚜', drone: '✣' };
const GROUPS: [SimUnit['group'], string][] = [['aircraft', 'Aircraft'], ['engines', 'Engines & Tenders'], ['crews', 'Crews & Dozers']];

export function ResourcesPanel() {
  const { time, selectedUnitId, set, follow } = useStore();
  const ctx = useSimCtx();
  const scroll = useRef<HTMLDivElement>(null);
  // the selected unit's card sits above the list: bring it into view when the selection changes
  useEffect(() => { if (selectedUnitId) scroll.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [selectedUnitId]);
  if (!ctx) return null;
  const tot = opsTotals(time, ctx);
  const units = SIM_UNITS.filter((u) => u.group !== 'drones');
  const sel = units.find((u) => u.id === selectedUnitId);
  const st = sel ? unitState(sel, time, ctx) : null;
  const air = sel?.group === 'aircraft';
  const mode = (m: 'chase' | 'overview' | 'ride') => set({ follow: follow?.id === sel!.id && follow.mode === m ? null : { id: sel!.id, mode: m } });
  return (
    <div className="scroll" ref={scroll}>
      <div className="section">
        <div className="section-h"><span>Resources <small>{units.length} units</small></span><span className="sim-tag">SIMULATED</span></div>
        <div className="kpis">
          <div><div className="v">{tot.airUp}/{tot.airTotal}</div><div className="l">aircraft up</div></div>
          <div><div className="v">{tot.gal >= 1000 ? `${Math.round(tot.gal / 1000)}k` : tot.gal}</div><div className="l">gal dropped</div></div>
          <div><div className="v">{fmtNum(tot.chains)}</div><div className="l">chains line</div></div>
          <div><div className="v">{tot.personnel}</div><div className="l">personnel</div></div>
        </div>
      </div>
      {sel && st ? (
        <div className="section">
          <div className="section-h"><span>{sel.id} <small>{sel.name}</small></span><span className="tag">{st.status}</span></div>
          <div className="bigstats">
            {air ? <>
              <div><div className="l">Airspeed</div><div className="v">{fmtNum(st.speedKt)}</div><div className="u">kt</div></div>
              <div><div className="l">Altitude</div><div className="v">{fmtNum(st.agl * 3.281)}</div><div className="u">ft AGL</div></div>
              <div><div className="l">Heading</div><div className="v">{fmtNum(st.heading)}°</div><div className="u">true</div></div>
            </> : <>
              <div><div className="l">Speed</div><div className="v">{fmtNum(st.speedKt * 1.852, 1)}</div><div className="u">km/h</div></div>
              <div><div className="l">Personnel</div><div className="v">{sel.personnel}</div><div className="u">assigned</div></div>
              <div><div className="l">{sel.capUnit === 'chains' ? 'Line built' : 'Water'}</div><div className="v">{sel.capUnit === 'chains' ? fmtNum(st.lineChains ?? 0) : fmtNum(st.load)}</div><div className="u">{sel.capUnit === 'chains' ? 'chains' : 'gal'}</div></div>
            </>}
          </div>
          <dl className="kv">
            <dt>Type</dt><dd>{sel.type}</dd>
            {sel.capUnit === 'gal' && air && <><dt>Load</dt><dd>{fmtNum(st.load)} / {fmtNum(sel.capacity)} gal</dd></>}
            <dt>Agency</dt><dd>{sel.agency}</dd>
            <dt>Assignment</dt><dd>{sel.task}</dd>
            <dt>Position</dt><dd className="mono" style={{ fontSize: 11 }}>{formatLat(st.lat)} {formatLon(st.lon)}</dd>
          </dl>
          <div className="btnrow">
            {air
              ? <><button className={'btn-seg' + (follow?.mode === 'chase' ? ' on' : '')} onClick={() => mode('chase')}>Chase</button></>
              : <button className={'btn-seg' + (follow?.mode === 'ride' ? ' on' : '')} onClick={() => mode('ride')}>Ride along</button>}
            <button className={'btn-seg' + (follow?.mode === 'overview' ? ' on' : '')} onClick={() => mode('overview')}>Overview</button>
          </div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>Simulated exercise unit — deterministic track driven by the timeline. Not live telemetry.</div>
        </div>
      ) : (
        <div className="section"><div className="section-h">Operations <span className="sim-tag">SIMULATED</span></div><div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>Select an aircraft to chase it, or an engine, crew or dozer to ride along. Drops leave retardant (red) and water (blue) lines; crews cut fire line (brown) along the planned cell boundary.</div></div>
      )}
      <div className="section" style={{ padding: '4px 0 8px' }}>
        {GROUPS.map(([g, label]) => (
          <div key={g}>
            <div className="grp-h">{label} ({units.filter((u) => u.group === g).length})</div>
            {units.filter((u) => u.group === g).map((u) => {
              const s = unitState(u, time, ctx);
              const q = u.capUnit === 'gal' ? `${fmtNum(s.load)} gal` : u.capUnit === 'chains' ? `${fmtNum(s.lineChains ?? 0)} ch` : `${u.personnel} pers`;
              return (
                <div key={u.id} className={'unit-row' + (u.id === selectedUnitId ? ' sel' : '')} onClick={() => set({ selectedUnitId: u.id, follow: null })}>
                  <div className="unit-ic">{ICON[u.kind]}</div>
                  <div style={{ minWidth: 0 }}><div className="nm">{u.id} <span>{u.name}</span></div><div className="st">● {s.status}</div></div>
                  <div className="q">{q}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
