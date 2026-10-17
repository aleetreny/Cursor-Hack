import { useState } from 'react';
import { useStore } from '../state/store';
import { selectEvent } from '../scene/SceneView';
import { fmtClock, fmtVideo } from '../lib/format';
import { eventIcon } from './Timeline';

export function AlertsPanel() {
  const { events, time, selectedEventId } = useStore();
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const list = events.filter((e) => e.severity !== 'info');
  const active = list.filter((e) => Date.parse(e.timestamp) <= time);
  return (
    <div className="scroll">
      <div className="section">
        <div className="section-h"><span>Alert Queue <small>{active.length} raised · {active.filter((e) => !ack[e.event_id]).length} open</small></span><span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--red)' }}>● REVIEW</span></div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 10, lineHeight: 1.4 }}>Raised by the video agent from visible changes in the footage. Decision support only: a human must confirm each alert before acting.</div>
        {list.map((e) => {
          const future = Date.parse(e.timestamp) > time;
          return (
            <div key={e.event_id} className={'alert-card ' + e.severity} style={{ opacity: future ? 0.45 : ack[e.event_id] ? 0.65 : 1, outline: e.event_id === selectedEventId ? '1.5px solid var(--red)' : undefined }} onClick={() => selectEvent(e.event_id)}>
              <div className="h"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{eventIcon(e.event_type, e.severity)}{e.title}</span><span className="tag" style={e.severity === 'alert' ? { background: 'var(--red)', color: '#fff' } : {}}>{e.severity.toUpperCase()}</span></div>
              <div className="d">{e.description}</div>
              <div className="m"><span className="mono">{fmtVideo(e.start_seconds)}–{fmtVideo(e.end_seconds)}</span><span>· {fmtClock(Date.parse(e.timestamp))} UTC</span><span className={'prov ' + e.provenance}>{e.provenance}</span></div>
              {!future && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn-sm" onClick={(ev) => { ev.stopPropagation(); setAck({ ...ack, [e.event_id]: !ack[e.event_id] }); }}>{ack[e.event_id] ? '✓ Acknowledged' : 'Acknowledge'}</button>
                  <button className="btn-sm" onClick={(ev) => { ev.stopPropagation(); selectEvent(e.event_id); useStore.getState().set({ feedOpen: true, mode: 'drones' }); }}>View footage</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
