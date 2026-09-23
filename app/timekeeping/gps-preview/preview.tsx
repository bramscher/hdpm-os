'use client';
import { useState } from 'react';
import Link from 'next/link';
import { MapPin, Check, Navigation, ShoppingBag, Smartphone, RotateCcw } from 'lucide-react';
import './preview.css';

type Segment = { start: number; end: number; kind: string; job: boolean };
const events = [
  { at: 480, kind: 'On-site work', job: true, title: 'Arrived at Example Property A?', detail: 'Confirm the property, unit 101, and the time you started work.', action: 'Start demo workday' },
  { at: 560, kind: 'Travel for parts', job: true, title: 'Leaving for parts?', detail: 'Keep this trip attached to Property A. Your paid workday continues.', action: 'Parts run for this job' },
  { at: 575, kind: 'Parts pickup', job: true, title: 'Arrived at Lowe’s?', detail: 'Confirm that this stop is for Property A. General inventory would use a different activity.', action: 'Simulate arrival at Lowe’s' },
  { at: 595, kind: 'Return travel', job: true, title: 'Heading back to Property A?', detail: 'Travel stays connected to the same job. No payroll clock-out.', action: 'Simulate leaving Lowe’s' },
  { at: 610, kind: 'On-site work', job: true, title: 'Back at Property A?', detail: 'Resume on-site work as a new segment of the same job.', action: 'Simulate return to property' },
  { at: 660, kind: 'Shop / admin', job: false, title: 'Finish this job and switch to admin?', detail: 'The job closes at the confirmed time. Your paid workday continues.', action: 'Finish job · switch to admin' },
  { at: 690, kind: 'End workday', job: false, title: 'End your workday?', detail: 'Confirm your shift end, then review the timeline. In the planned app, this also stops location assistance.', action: 'End demo workday' },
];
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const duration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export default function GpsPreview() {
  const [tab, setTab] = useState('today');
  const [next, setNext] = useState(0);
  const [active, setActive] = useState<{ start: number; kind: string; job: boolean } | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [pending, setPending] = useState(false);
  const [proposedTime, setProposedTime] = useState('08:00');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [note, setNote] = useState('');
  const jobMinutes = segments.filter(s => s.job).reduce((n, s) => n + s.end - s.start, 0);
  const otherMinutes = segments.filter(s => !s.job).reduce((n, s) => n + s.end - s.start, 0);
  const ended = next === events.length;
  function suggest() { setProposedTime(clock(events[next].at)); setError(''); setPending(true); }
  function confirm() {
    const parts = proposedTime.split(':').map(Number);
    const at = parts[0] * 60 + parts[1];
    if (!/^\d{2}:\d{2}$/.test(proposedTime) || !Number.isFinite(at) || at < (active?.start ?? 0) || at > (events[next + 1]?.at ?? 1439)) {
      setError('Choose a time after the current activity starts and before the next demo event.'); return;
    }
    if (active) setSegments(s => [...s, { ...active, end: at }]);
    const event = events[next];
    setActive(next === events.length - 1 ? null : { start: at, kind: event.kind, job: event.job });
    setNext(n => n + 1); setPending(false); setError('');
    if (next === events.length - 1) setTab('review');
  }
  function reset() { setNext(0); setActive(null); setSegments([]); setPending(false); setSubmitted(false); setNote(''); setError(''); setTab('today'); }
  return <div className="gps-demo">
    <header className="gps-demo-heading"><div><p className="gps-eyebrow">FEATURE PREVIEW · SAMPLE DATA</p><h1>Your workday, connected.</h1><p>A phone-first walkthrough of a job, a parts run, and the time in between.</p></div><button className="gps-reset" onClick={reset}><RotateCcw size={15} aria-hidden="true"/>Reset demo</button></header>
    <p className="gps-disclaimer" role="note">Interactive mockup. No GPS is collected, no timers run in the background, and nothing is saved to payroll or invoices. Refreshing resets the demo.</p>
    <div className="gps-demo-layout">
      <section className="gps-phone" aria-label="iPhone workday preview">
        <div className="gps-phone-top"><span>HDPM FIELD</span><span><Smartphone size={14} aria-hidden="true"/>Company iPhone</span></div>
        <div className="gps-phone-title"><p className="gps-eyebrow">MY WORKDAY</p><h2>Hello, demo technician</h2><p>Sample day · times are simulated</p></div>
        <nav className="gps-tabs" aria-label="Phone preview views">{[['today','Today'],['timeline','Timeline'],['review','Review']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
        <div className="gps-phone-content">
          <div className="gps-current" role="status"><span className="gps-status-dot"/><div><small>{ended?'WORKDAY ENDED':active?'WORKDAY ACTIVE':'READY WHEN YOU ARE'}</small><strong>{active?.kind || (ended?'Ready for daily review':'Start with today’s plan')}</strong><p>{active?`Since ${clock(active.start)} · ${active.job?'Property A / WO DEMO-101':'Other work activity'}`:'Location assistance is simulated in this preview.'}</p></div></div>
          {tab==='today'&&<>
            <div className="gps-between"><h3>Today’s properties</h3><span>2 jobs</span></div>
            <article className="gps-job"><div className="gps-between"><b>Example Property A</b><span className="gps-chip">{ended||next>5?'Recorded':'First stop'}</span></div><p>Unit 101 · WO DEMO-101</p><p>Repair a leaking sink · approved scope</p><small>Sample allowance: 3 hours including job-related parts travel</small></article>
            <article className="gps-job gps-job-muted"><b>Example Property B</b><p>Door adjustment · WO DEMO-102</p><small>Next available job · not part of this walkthrough</small></article>
            <div className="gps-parts"><ShoppingBag size={19} aria-hidden="true"/><div><b>A parts run belongs to the job</b><p>Travel → pickup → return → resume. One connected history.</p></div></div>
          </>}
          {tab==='timeline'&&<>
            <h3>Confirmed activity</h3>
            {!segments.length&&<p className="gps-empty">Confirm the first arrival, then try the parts-run steps below. Completed segments will appear here.</p>}
            <ol className="gps-timeline">{segments.map((s,i)=><li key={i}><span>{clock(s.start)}–{clock(s.end)}</span><div><b>{s.kind}</b><p>{s.job?'Property A':'Other work'} · {duration(s.end-s.start)}</p></div><Check size={16} aria-label="Confirmed"/></li>)}</ol>
            {active&&<p className="gps-live">Current: {active.kind} since {clock(active.start)}. It ends when you confirm the next transition.</p>}
          </>}
          {tab==='review'&&<>
            <h3>Account for the whole day</h3><div className="gps-totals"><div><small>Job A effort</small><b>{duration(jobMinutes)}</b></div><div><small>Shop / admin</small><b>{duration(otherMinutes)}</b></div></div>
            <p className="gps-review-note">Completed segments only. Job effort includes on-site work and the linked parts trip. The office still reviews which time is billable.</p>
            <dl className="gps-breakdown">{['On-site work','Travel for parts','Parts pickup','Return travel','Shop / admin'].map(kind=><div key={kind}><dt>{kind}</dt><dd>{duration(segments.filter(s=>s.kind===kind).reduce((n,s)=>n+s.end-s.start,0))}</dd></div>)}</dl>
            <label className="gps-note-label">Work notes<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="What was completed? Any parts or follow-up?"/></label>
            <button className="gps-primary" disabled={!ended||submitted} onClick={()=>setSubmitted(true)}>{submitted?'Demo day reviewed':'Submit demo day for review'}</button>
            {!ended&&<p className="gps-hint">Finish the walkthrough and confirm End workday first.</p>}
            {submitted&&<p role="status" className="gps-success">Demo complete. In the planned app, these records would go to office review. Nothing was saved or sent.</p>}
          </>}
          {pending&&<section className="gps-suggestion" aria-label="Confirm suggested activity"><p className="gps-eyebrow">{next===0||[2,3,4].includes(next)?'SIMULATED LOCATION SUGGESTION':'CONFIRM ACTIVITY CHANGE'}</p><h3>{events[next].title}</h3><p>{events[next].detail}</p><label>Confirm or adjust time<input type="time" value={proposedTime} onChange={e=>setProposedTime(e.target.value)}/></label>{error&&<p role="alert" className="gps-error">{error}</p>}<div className="gps-confirm-actions"><button className="gps-primary" onClick={confirm}>Confirm</button><button onClick={()=>setPending(false)}>Dismiss suggestion</button></div></section>}
          {!ended&&!pending&&<div className="gps-next"><p>WALKTHROUGH · STEP {next+1} OF {events.length}</p><button className="gps-primary" onClick={suggest}>{events[next].action}<Navigation size={16} aria-hidden="true"/></button><small>{next===0?'Starts a fictional day at 08:00.':'Advances to the next sample event; no real location required.'}</small></div>}
        </div>
      </section>
      <aside className="gps-explainer"><p className="gps-eyebrow">TRY THE ROUND TRIP</p><h2>Leave the property.<br/>Keep the job connected.</h2><p>Start the demo and confirm each suggested transition. Visit the Timeline tab as you go, then review the day.</p><ol><li><b>Work at Property A</b><span>08:00–09:20 · on-site work</span></li><li><b>Go to Lowe’s and back</b><span>09:20–10:10 · travel, pickup, return</span></li><li><b>Resume the same job</b><span>10:10–11:00 · on-site work</span></li><li><b>Admin and daily review</b><span>11:00–11:30 · then confirm end day</span></li></ol><div className="gps-platform"><MapPin size={20} aria-hidden="true"/><h3>PWA first for the workflow</h3><p>The job list, manual activity changes, and review can live on the web. This preview demonstrates that experience.</p><h3>Native support for background location</h3><p>Locked-screen arrival/departure suggestions need an iPhone app with native location support. We can reuse the HDPM backend and build only the phone features we need.</p><p>Both versions keep payroll, job effort, and approved billing separate.</p></div><p className="gps-source-links"><a href="https://webkit.org/tracking-prevention/" target="_blank" rel="noopener noreferrer">WebKit location limits</a> · <a href="https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background" target="_blank" rel="noopener noreferrer">Apple background location</a></p><Link href="/timekeeping">Back to existing Timekeeping →</Link><p className="gps-hint">This is a web preview, not an installable PWA or native app yet.</p></aside>
    </div>
  </div>;
}
