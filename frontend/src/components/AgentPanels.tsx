import { useRef, useState, type ReactNode } from 'react';
import { api, mediaUrl, USE_FIXTURES } from '../api/client';
import type { AskResponse, Citation, SearchResponse } from '../api/types';
import { useStore } from '../state/store';
import { seekCitation, selectEvent } from '../scene/SceneView';
import { fmtClock, fmtVideo } from '../lib/format';
import { Icon } from './Icon';
import { eventIcon } from './Timeline';

const SUGGESTIONS = [
  'How did the fire change during the recording?',
  'Where did new visible fire activity appear?',
  'When was smoke densest, and does it affect the burned-area estimate?',
  'Which parts of the view should be reviewed for emerging fire?',
];

type Msg = { role: 'user' | 'assistant'; content: string; res?: AskResponse; error?: string };

function renderAnswer(text: string, cites: Citation[]): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    const c = m ? cites[+m[1] - 1] : undefined;
    if (!c) return <span key={i}>{part}</span>;
    return <span key={i} className="cite" onClick={() => seekCitation(c.source_id, c.start_seconds, c.event_id)} title="Jump to footage"><Icon name="video" size={9} />{c.label ?? `${fmtVideo(c.start_seconds)}–${fmtVideo(c.end_seconds)}`}</span>;
  });
}

export function AgentPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    const s = useStore.getState();
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setQ(''); setBusy(true);
    try {
      const res = await api.ask({ question, context: { timestamp: new Date(s.time).toISOString(), source_id: s.selectedSourceId, selected_event_id: s.selectedEventId }, history });
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer, res }]);
      if (res.citations[0]) seekCitation(res.citations[0].source_id, res.citations[0].start_seconds, res.citations[0].event_id);
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
          <b>Video agent</b>: ask about the drone footage. Answers come with clickable evidence clips that move the video and the map to that moment.
          <div className="meta"><span className="tag">Cosmos Reason</span><span className="tag">Cosmos Embed retrieval</span>{USE_FIXTURES && <span className="prov fixture">fixture</span>}</div>
        </div>
        {!msgs.length && <div className="suggest">{SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={i} className="msg user">{m.content}</div>
          : (
            <div key={i} className="msg bot">
              {m.error ? <span className="err">Agent error: {m.error}</span> : renderAnswer(m.content, m.res?.citations ?? [])}
              {m.res && <div className="meta"><span>{m.res.model}</span>{m.res.latency_ms != null && <span>· {m.res.latency_ms} ms</span>}<span className="tag" style={m.res.grounded ? { background: '#e3ecdf', color: '#3c6431' } : { background: '#fbe7cf', color: '#8a4b00' }}>{m.res.grounded ? 'grounded' : 'not grounded'}</span></div>}
            </div>
          ))}
        {busy && <div className="msg bot muted">Analyzing footage…</div>}
      </div>
      <form className="chat-in" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the footage…" />
        <button type="submit" disabled={busy}><Icon name="send" size={13} /></button>
      </form>
    </div>
  );
}

export function EvidencePanel() {
  const { events, time, selectedEventId, sources } = useStore();
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
  return (
    <div className="scroll">
      <div className="section">
        <form className="chat-in" style={{ padding: 0, border: 0 }} onSubmit={(e) => { e.preventDefault(); run(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search footage, e.g. "first appearance of flames"' />
          <button type="submit"><Icon name="search" size={13} /></button>
        </form>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
          {['first appearance of flames', 'fire expanding', 'dense smoke', 'burned ground'].map((s) => <button key={s} className="btn-sm" onClick={() => { setQ(s); run(s); }}>{s}</button>)}
        </div>
        {busy && <div className="muted" style={{ marginTop: 8 }}>Searching embeddings…</div>}
        {err && <div className="err">Search failed: {err}</div>}
        {res && (
          <div style={{ marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 11 }}>{res.results.length} clips · {res.model}{res.latency_ms != null ? ` · ${res.latency_ms} ms` : ''} {USE_FIXTURES && <span className="prov fixture">fixture</span>}</div>
            {res.results.map((r) => (
              <div key={r.clip_id} className="result" onClick={() => seekCitation(r.source_id, r.start_seconds, r.event_id)}>
                <div className="thumb" style={{ backgroundImage: `url(${mediaUrl(r.thumbnail_url ?? thumb)})` }}><span>{fmtVideo(r.start_seconds)}</span></div>
                <div><div className="cap">{r.caption ?? 'Clip'}</div><div className="rm">{fmtVideo(r.start_seconds)}–{fmtVideo(r.end_seconds)} · similarity {r.similarity.toFixed(2)}</div></div>
              </div>
            ))}
          </div>
        )}
        {res?.archive_source && (
          <div style={{ marginTop: 10 }}>
            <div className="section-h" style={{ fontSize: 12 }}>Archive matches <small>{res.archive_source}</small></div>
            {res.archive_synthesis && <div className="msg bot" style={{ fontSize: 12, marginBottom: 6 }}>{res.archive_synthesis}</div>}
            {(res.archive_results ?? []).map((r, i) => r.error
              ? <div key={i} className="err">VSS: {r.error}</div>
              : <div key={i} className="integr"><span className="mono" style={{ fontSize: 11 }}>{(r.video ?? 'video').split('/').pop()}</span><span className="muted" style={{ fontSize: 11 }}>{r.start_seconds != null ? fmtVideo(r.start_seconds) : ''}{r.similarity != null ? ` · ${(+r.similarity).toFixed(2)}` : ''}</span>{r.caption && <span className="s">{r.caption}</span>}</div>)}
            {!res.archive_results?.length && <div className="muted" style={{ fontSize: 11.5 }}>No archive matches.</div>}
          </div>
        )}
      </div>
      <div className="section">
        <div className="section-h">Event Review Queue <small>{events.filter((e) => e.review_required).length} pending</small></div>
        {events.map((e) => (
          <div key={e.event_id} className={'alert-card ' + e.severity} style={{ opacity: Date.parse(e.timestamp) > time ? 0.55 : 1, outline: e.event_id === selectedEventId ? '1.5px solid var(--red)' : undefined }} onClick={() => selectEvent(e.event_id)}>
            <div className="h"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{eventIcon(e.event_type, e.severity)}{e.title}</span><span className="muted mono" style={{ fontSize: 11 }}>{fmtVideo(e.start_seconds)}</span></div>
            <div className="d">{e.description}</div>
            <div className="m">{e.visual_evidence.map((v) => <span key={v} className="tag">{v}</span>)}</div>
            <div className="m" style={{ marginTop: 5 }}>{e.review_required && <span className="tag review">review required</span>}<span>{e.processing_model}</span><span>· {fmtClock(Date.parse(e.timestamp))}</span><span className={'prov ' + e.provenance}>{e.provenance}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
