import { useRef, useState, type ReactNode } from 'react';
import { api, mediaUrl, IS_STATIC } from '../api/client';
import type { AskResponse, Citation, SearchResponse } from '../api/types';
import { useShallow } from 'zustand/react/shallow';
import { useStore, qt } from '../state/store';
import { seekCitation, selectEvent } from '../scene/SceneView';
import { fmtClock, fmtDay, fmtVideo, fmtWhen } from '../lib/format';
import { Icon } from './Icon';
import { eventIcon } from './Timeline';

const SUGGESTIONS = [
  'How did the fire change during the recording?',
  'When did it grow fastest?',
  'Where did flames appear outside the burned area?',
  'What was the weather?',
  'How accurate is the burned-area estimate?',
];
const REGIONAL_SUGGESTIONS = [
  'How did the fire grow?',
  'When did it grow fastest?',
  'How much burned, and how badly?',
  'What was the weather?',
  'How accurate is this reconstruction?',
];

type Msg = { role: 'user' | 'assistant'; content: string; res?: AskResponse; error?: string };

function renderAnswer(text: string, cites: Citation[]): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    const c = m ? cites[+m[1] - 1] : undefined;
    if (!c) return <span key={i}>{part}</span>;
    const moment = c.source_id === 'progression';
    const range = c.label ?? (moment ? `${fmtWhen(Date.parse(c.timestamp))} UTC` : `${fmtVideo(c.start_seconds)}–${fmtVideo(c.end_seconds)}`);
    const go = () => seekCitation(c.source_id, c.start_seconds, c.event_id, c.timestamp);
    const what = moment ? `Jump to ${range}` : `Jump to the footage, ${range}`;
    return <span key={i} className="cite" role="button" tabIndex={0} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} title={what} aria-label={what}><Icon name={moment ? 'calendar' : 'video'} size={9} /></span>;
  });
}

export function AgentPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const regional = useStore((st) => st.incident?.scale === 'regional');
  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    const s = useStore.getState();
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setQ(''); setBusy(true);
    try {
      const res = await api.ask({ question, context: { timestamp: new Date(s.time).toISOString(), source_id: s.selectedSourceId, selected_event_id: s.selectedEventId }, history });
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer, res }]);
      if (res.citations[0]) seekCitation(res.citations[0].source_id, res.citations[0].start_seconds, res.citations[0].event_id, res.citations[0].timestamp);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: '', error: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
      setTimeout(() => log.current?.scrollTo({ top: 1e6, behavior: 'smooth' }), 30);
    }
  };
  return (
    <div className="chat" style={{ minHeight: 0, flex: 1 }}>
      <div className="chat-log" ref={log}>
        <div className="msg bot">
          <b>Incident analyst</b>: ask about this incident in plain English. {regional
            ? 'Answers are computed from the satellite reconstruction and its events, with clickable evidence that moves the timeline and the map to that moment.'
            : 'Answers are computed from the recorded measurements and events, with clickable evidence that moves the video and the map to that moment.'}
          <div className="meta"><span className="tag">{IS_STATIC ? 'Rule-based · in your browser · no language model' : 'Backend agent'}</span></div>
        </div>
        {!msgs.length && <div className="suggest">{(regional ? REGIONAL_SUGGESTIONS : SUGGESTIONS).map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={i} className="msg user">{m.content}</div>
          : (
            <div key={i} className="msg bot">
              {m.error ? <span className="err">Agent error: {m.error}</span> : renderAnswer(m.content, m.res?.citations ?? [])}
              {m.res && <div className="meta"><span className="tag" style={m.res.grounded ? { background: '#e3ecdf', color: '#3c6431' } : { background: '#fbe7cf', color: '#8a4b00' }}>{m.res.grounded ? (m.res.citations.length ? `${m.res.citations.length} ${regional ? 'moment' : 'evidence clip'}${m.res.citations.length > 1 ? 's' : ''}` : 'from recorded data') : 'no match · summary'}</span><span title={m.res.model}>{m.res.latency_ms != null ? `${m.res.latency_ms} ms` : ''}</span></div>}
            </div>
          ))}
        {busy && <div className="msg bot muted">Working it out…</div>}
      </div>
      <form className="chat-in" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the incident…" />
        <button type="submit" disabled={busy || !q.trim()} aria-label="Ask" title="Ask"><Icon name="send" size={13} /></button>
      </form>
    </div>
  );
}

export function EvidencePanel() {
  const { events, time, selectedEventId, sources } = useStore(useShallow((s) => ({ events: s.events, time: qt(s.time, 1000), selectedEventId: s.selectedEventId, sources: s.sources })));
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (query: string) => {
    if (!query.trim()) return;
    setBusy(true); setErr(null);
    try { setRes(await api.search({ query, top_k: 8 })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const thumb = sources[0]?.thumbnail_url;
  const regional = useStore((st) => st.incident?.scale === 'regional');
  const when = (ms: number, vs: number) => (regional ? fmtWhen(ms) : fmtVideo(vs));
  return (
    <div className="scroll">
      <div className="section">
        <form className="chat-in" style={{ padding: 0, border: 0 }} onSubmit={(e) => { e.preventDefault(); run(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={regional ? 'Search the fire, e.g. "fast run"' : 'Search footage, e.g. "flames ahead of the front"'} />
          <button type="submit" aria-label="Search" title="Search"><Icon name="search" size={13} /></button>
        </form>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
          {(regional ? ['fast run', 'strongest gusts', 'dry air', 'most intense pass'] : ['first appearance of flames', 'fire expanding', 'dense smoke', 'flames ahead of the front']).map((s) => <button key={s} className="btn-sm" onClick={() => { setQ(s); run(s); }}>{s}</button>)}
        </div>
        {busy && <div className="muted" style={{ marginTop: 8 }}>Searching…</div>}
        {err && <div className="err">Search failed: {err}</div>}
        {res && (
          <div style={{ marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 11 }}>{res.results.length} {regional ? 'moment' : 'clip'}{res.results.length === 1 ? '' : 's'} · {res.model}{res.latency_ms != null ? ` · ${res.latency_ms} ms` : ''}</div>
            {!res.results.length && <div className="muted" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.4 }}>{regional ? `Nothing matches “${res.query}”. Search covers the computed events and a summary of each day (growth, satellite passes, wind).` : `No clip matches “${res.query}”. Search covers the recorded events and what was measured in each clip, not the pixels themselves.`}</div>}
            {res.results.map((r) => (
              <div key={r.clip_id} className="result" onClick={() => seekCitation(r.source_id, r.start_seconds, r.event_id, r.timestamp)}>
                {regional
                  ? <div className="thumb date"><b>{fmtDay(Date.parse(r.timestamp))}</b><span>{fmtClock(Date.parse(r.timestamp), false)}</span></div>
                  : <div className="thumb" style={{ backgroundImage: `url(${mediaUrl(r.thumbnail_url ?? thumb)})` }}><span>{fmtVideo(r.start_seconds)}</span></div>}
                <div><div className="cap">{r.caption ?? 'Clip'}</div><div className="rm">{regional ? `${fmtWhen(Date.parse(r.timestamp))} UTC` : `${fmtVideo(r.start_seconds)}–${fmtVideo(r.end_seconds)}`}{IS_STATIC ? '' : ` · similarity ${r.similarity.toFixed(2)}`}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="section">
        <div className="section-h">Event Review Queue <small>{events.filter((e) => e.review_required).length} pending</small></div>
        {events.map((e) => (
          <div key={e.event_id} className={'alert-card ' + e.severity} style={{ opacity: Date.parse(e.timestamp) > time ? 0.55 : 1, outline: e.event_id === selectedEventId ? '1.5px solid var(--red)' : undefined }} onClick={() => selectEvent(e.event_id)}>
            <div className="h"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{eventIcon(e.event_type, e.severity)}{e.title}</span><span className="muted mono" style={{ fontSize: 11 }}>{when(Date.parse(e.timestamp), e.start_seconds)}</span></div>
            <div className="d">{e.description}</div>
            <div className="m">{e.visual_evidence.map((v) => <span key={v} className="tag">{v}</span>)}</div>
            <div className="m" style={{ marginTop: 5 }}>{e.review_required && <span className="tag review">review required</span>}<span>{e.processing_model}</span>{!regional && <span>· {fmtClock(Date.parse(e.timestamp))}</span>}<span className={'prov ' + e.provenance}>{e.provenance}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
