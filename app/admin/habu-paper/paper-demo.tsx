'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, FileText, Inbox, Printer, RotateCcw, Route, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/dialog';
import { ROLES, TEMPLATES, PAPERWORK, createExamples, assignmentStatus, releaseIssues, nextAssignments, visibleInbox, completeTask, undoTask, editField, releaseAssignment, setWaiting, resumeAssignment, reassign, addNote, addWorkOrder, completeWorkOrder, localDay, type Role, type Sheet, type Status, type Row, type Stamp } from '@/lib/habu-paper/model';

type ModalState = { kind: 'na'; row: Row } | { kind: 'waiting' } | { kind: 'roles' } | { kind: 'history' } | { kind: 'route' } | { kind: 'reset' } | null;
const roles = Object.keys(ROLES) as Role[];
const now = () => new Date().toISOString();
function stampText(stamp: Stamp) {
  const date = new Date(stamp.at);
  return `${ROLES[stamp.actor]} · ${Number.isNaN(date.getTime()) ? stamp.at : date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}
function dueLabel(value: string) {
  if (!value) return 'No date set';
  const today = localDay(new Date());
  if (value < today) return `Overdue · ${value}`;
  if (value === today) return 'Due today';
  return `Due ${new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export default function PaperDemo({ initialSheets }: { initialSheets: Sheet[] }) {
  const [sheets, setSheets] = useState<Sheet[]>(initialSheets);
  const [role, setRole] = useState<Role>('property-manager');
  const [selectedId, setSelectedId] = useState('VT-104');
  const [selectedAssignment, setSelectedAssignment] = useState('owner');
  const [view, setView] = useState('sheet');
  const [filter, setFilter] = useState<Status>('ready');
  const [side, setSide] = useState('front');
  const [modal, setModal] = useState<ModalState>(null);
  const [reason, setReason] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [workDrafts, setWorkDrafts] = useState<Record<string, string>>({});
  const note = noteDrafts[selectedId] || '';
  const work = workDrafts[selectedId] || '';
  const setNote = (value: string) => setNoteDrafts(d => ({ ...d, [selectedId]: value }));
  const setWork = (value: string) => setWorkDrafts(d => ({ ...d, [selectedId]: value }));
  const [announcement, setAnnouncement] = useState('Review the Owner section, then hand it off to Front Desk.');
  const [receipt, setReceipt] = useState<{ sheetId: string; assignmentId: string } | null>(null);
  const [jump, setJump] = useState(false);
  const sheet = sheets.find(s => s.id === selectedId)!;
  const template = TEMPLATES[sheet.kind];
  const assignment = template.assignments.find(a => a.id === selectedAssignment) || template.assignments[0];
  const state = sheet.assignments[assignment.id];
  const status = assignmentStatus(sheet, assignment.id);
  const mine = state.owner === role;
  const issues = releaseIssues(sheet, assignment.id);
  const next = nextAssignments(sheet, assignment.id);
  const nextRoles = [...new Set(next.map(a => ROLES[sheet.assignments[a.id].owner]))];
  const readyCount = visibleInbox(sheets, role, 'ready').length;
  const items = visibleInbox(sheets, role, filter);
  const selectedSection = template.sections.find(s => s.id === assignment.section)!;

  useEffect(() => {
    if (view !== 'sheet' || !jump) return;
    // Radix mounts the new tab panel after the tab change. Wait for its DOM
    // before scrolling, so an inbox link lands on the assignment's lines.
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById(`paper-section-${assignment.section}`);
      section?.scrollIntoView({ block: 'center', behavior: 'auto' });
      section?.focus({ preventScroll: true });
      setJump(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [view, assignment.section, side, jump]);

  function update(fn: (current: Sheet) => Sheet) { setSheets(current => current.map(s => s.id === selectedId ? fn(s) : s)); }
  function openAssignment(target: Sheet, id: string, focus = true) {
    const def = TEMPLATES[target.kind].assignments.find(a => a.id === id)!;
    setSelectedId(target.id); setSelectedAssignment(id); setSide(def.section === 'turn' ? 'back' : 'front'); setView('sheet'); setJump(focus);
    setAnnouncement(`${def.label} is highlighted on ${target.id}. The whole sheet remains available.`);
  }
  function previewRole(id: Role) { setRole(id); setView('inbox'); setFilter('ready'); setAnnouncement(`Previewing ${ROLES[id]}’s inbox. These are sample assignments.`); }
  function release() {
    const result = releaseAssignment(sheet, assignment.id, role, now());
    if (result === sheet) return;
    update(current => releaseAssignment(current, assignment.id, role, now()));
    setReceipt({ sheetId: sheet.id, assignmentId: assignment.id });
    setAnnouncement(nextRoles.length ? `Handed off to ${nextRoles.join(' and ')}. Their inboxes now reflect the release.` : 'Assignment finished. The sheet and its history remain available.');
  }
  function openModal(value: ModalState) { setReason(''); setFollowUp(''); setModal(value); }
  function fieldInput(row: Row, header = false) {
    const editable = row.assignment ? sheet.assignments[row.assignment].owner === role && !sheet.assignments[row.assignment].released : sheet.workflowOwner === role;
    const value = sheet.values[row.id] || '';
    const inputId = `paper-${sheet.id}-${row.id}`;
    const onChange = (value: string) => update(s => editField(s, row.id, value, role));
    return <div key={row.id} className={`hp-field ${row.assignment === assignment.id ? 'hp-my-line' : ''}`}>
      <label htmlFor={inputId}>{row.label}{row.type === 'money' && ' $'}{row.required && <span className="hp-required" aria-label="Required for handoff"> *</span>}</label>
      {row.type === 'choice' ? <select id={inputId} value={value} disabled={!editable} onChange={e => onChange(e.target.value)}><option value="">—</option>{row.options?.map(o => <option key={o}>{o}</option>)}</select> : <input id={inputId} type={row.type === 'date' ? 'date' : row.type === 'money' || row.type === 'number' ? 'number' : 'text'} step={row.type === 'money' ? '0.01' : row.type === 'number' ? '1' : undefined} min={row.type === 'number' ? 0 : undefined} value={value} readOnly={!editable} onChange={e => onChange(e.target.value)} aria-label={row.label} placeholder={header ? '—' : ''} />}
      <span className="hp-print-value">{value || '—'}</span>
    </div>;
  }
  function taskRow(row: Row) {
    const entry = sheet.tasks[row.id];
    const assigned = sheet.assignments[row.assignment!];
    const canAct = assigned.owner === role && assignmentStatus(sheet, row.assignment!) === 'ready';
    return <div className={`hp-task ${row.assignment === assignment.id ? 'hp-my-line' : ''} ${entry ? 'hp-task-done' : ''}`} key={row.id}>
      <label><input type="checkbox" checked={!!entry} disabled={!canAct || !!entry} onChange={() => { update(s => completeTask(s, row.id, role, now())); setAnnouncement(`Completed: ${row.label}. Recorded for ${ROLES[role]}.`); }} /><span>{row.label}</span></label>
      {entry ? <div className="hp-task-end"><details><summary className="hp-stamp">{entry.outcome === 'na' ? 'N/A' : '✓'} {ROLES[entry.actor]}</summary><span>{stampText(entry)}{entry.reason && ` · ${entry.reason}`}</span></details>{canAct && <button type="button" className="hp-text-button hp-no-print" onClick={() => { update(s => undoTask(s, row.id, role, now())); setAnnouncement('Completion corrected; previous action remains in history.'); }}>Undo</button>}</div> : canAct ? <button className="hp-text-button hp-no-print" type="button" onClick={() => openModal({ kind: 'na', row })} aria-label={`Mark ${row.label} not applicable`}>N/A</button> : <span className="hp-unfinished">—</span>}
    </div>;
  }
  function sectionPanel(section: typeof template.sections[number]) {
    const assignments = template.assignments.filter(a => a.section === section.id);
    return <section key={section.id} id={`paper-section-${section.id}`} tabIndex={-1} className={`hp-form-section ${section.id === assignment.section ? 'hp-section-focus' : ''}`}>
      <h3>{section.label}</h3>
      <div className="hp-section-owners hp-no-print">{assignments.map(a => <button key={a.id} type="button" aria-pressed={assignment.id === a.id} onClick={() => openAssignment(sheet, a.id, false)}><span>{ROLES[sheet.assignments[a.id].owner]}</span>{assignments.length > 1 && <> · {a.label}</>} <small>{assignmentStatus(sheet, a.id) === 'done' ? 'Sent / finished' : assignmentStatus(sheet, a.id)}</small></button>)}</div>
      {section.rows.map(row => row.type === 'task' ? taskRow(row) : fieldInput(row))}
      {assignments.map(a => sheet.assignments[a.id].released && <p className="hp-release-stamp" key={a.id}>{a.label} · {stampText(sheet.assignments[a.id].released!)} · {nextAssignments(sheet, a.id).length ? 'Handed off' : 'Finished'}</p>)}
    </section>;
  }
  const receiptDef = receipt?.sheetId === sheet.id ? template.assignments.find(a => a.id === receipt.assignmentId) : undefined;
  return <div className="hp-app">
    <header className="hp-header hp-no-print"><div><p className="hp-eyebrow">HABU · SECOND DEMO</p><h1>Paper workflows</h1><p className="hp-muted">One complete sheet. Your part, in your inbox.</p></div><div className="hp-demo-role"><label htmlFor="hp-role"><UserRound size={14} /> Preview as role</label><select id="hp-role" value={role} onChange={e => previewRole(e.target.value as Role)}>{roles.map(id => <option key={id} value={id}>{ROLES[id]}</option>)}</select></div></header>
    <div className="hp-demo-notice hp-no-print"><span>Sample data · Changes last until refresh · No real messages or AppFolio changes</span><button className="hp-text-button" type="button" onClick={() => openModal({ kind: 'reset' })}><RotateCcw size={13} /> Reset example</button></div>
    <Tabs value={view} onValueChange={setView}>
      <div className="hp-top-nav hp-no-print"><TabsList><TabsTrigger value="inbox"><Inbox size={16} /> My work <span className="hp-count">{readyCount}</span></TabsTrigger><TabsTrigger value="sheets"><FileText size={16} /> All sheets</TabsTrigger><TabsTrigger value="sheet">{sheet.id} · Sheet</TabsTrigger></TabsList><div className="hp-demo-links"><Link href="/admin/habu-paper/workflows" className="hp-text-link">New: My Work &amp; routing →</Link><Link href="/admin/habu-paper/forms" className="hp-text-link">Form drafts · 15</Link><Link href="/admin/habu-demo" className="hp-text-link">Original subway demo ↗</Link></div></div>
      <TabsContent value="inbox" className="hp-work-view">
        <div className="hp-work-heading"><h2>{ROLES[role]}’s work</h2><p className="hp-muted">Each assignment opens its place on the full workflow sheet.</p></div>
        <div className="hp-inbox-filters" role="group" aria-label="Assignment readiness">{(['ready', 'waiting', 'upcoming'] as const).map(s => <Button key={s} variant="outline" size="sm" aria-pressed={filter === s} onClick={() => setFilter(s)}>{s === 'ready' ? 'Ready' : s === 'waiting' ? 'Waiting' : 'Upcoming'} · {visibleInbox(sheets, role, s).length}</Button>)}</div>
        <div className="hp-inbox-list">{items.length ? items.map(({ sheet: item, assignment: a }) => {
          const assigned = item.assignments[a.id]; const missing = releaseIssues(item, a.id).length;
          const blockers = a.needs.filter(n => !item.assignments[n].released).map(n => `${ROLES[item.assignments[n].owner]} — ${TEMPLATES[item.kind].assignments.find(x => x.id === n)!.label}`);
          return <button className="hp-inbox-row" key={item.id + a.id} onClick={() => openAssignment(item, a.id)} type="button"><span className={`hp-sheet-mark ${TEMPLATES[item.kind].color}`} /><div><strong>{a.label}</strong><span>{item.values.address}</span><small>{TEMPLATES[item.kind].title} / {TEMPLATES[item.kind].sections.find(s => s.id === a.section)!.label} · {item.id}</small>{filter === 'waiting' ? <p>Waiting: {assigned.waiting?.reason} · Follow up {assigned.waiting?.followUp}</p> : filter === 'upcoming' ? <p>Waiting for {blockers.join('; ')}</p> : <p>{missing ? `${missing} checks or required fields remaining` : 'Review the details, then hand off'}</p>}</div><span className="hp-inbox-due">{dueLabel(assigned.due)}<span>Open sheet <ArrowRight size={14} /></span></span></button>;
        }) : <div className="hp-empty"><Check size={22} /><h3>{filter === 'ready' ? 'No work ready for you' : filter === 'waiting' ? 'Nothing on hold' : 'No upcoming assignments'}</h3><p>{filter === 'ready' ? 'Check Waiting or Upcoming to see what is still assigned to you.' : 'The full sheets remain available in All sheets.'}</p></div>}</div>
      </TabsContent>
      <TabsContent value="sheets" className="hp-work-view"><h2>Workflow sheets</h2><p className="hp-muted">Three sample cases. Open any sheet for its complete picture.</p><div className="hp-inbox-list">{sheets.map(s => <button className="hp-inbox-row" key={s.id} onClick={() => { const own = TEMPLATES[s.kind].assignments.find(a => s.assignments[a.id].owner === role && assignmentStatus(s, a.id) === 'ready') || TEMPLATES[s.kind].assignments[0]; openAssignment(s, own.id, false); }}><span className={`hp-sheet-mark ${TEMPLATES[s.kind].color}`} /><div><strong>{s.values.address}</strong><span>{TEMPLATES[s.kind].title} · {s.id}</span><small>Workflow owner: {ROLES[s.workflowOwner]} · {Object.values(s.assignments).filter(a => a.released).length}/{TEMPLATES[s.kind].assignments.length} assignments finished</small></div><ArrowRight size={18} /></button>)}</div></TabsContent>
      <TabsContent value="sheet" className="hp-sheet-view">
        <div className="hp-sheet-tools hp-no-print"><Button variant="ghost" size="sm" onClick={() => setView('inbox')}><ArrowLeft size={15} /> My work</Button><div><Button variant="ghost" size="sm" onClick={() => openModal({ kind: 'roles' })}><UserRound size={15} /> Roles</Button><Button variant="ghost" size="sm" onClick={() => openModal({ kind: 'route' })}><Route size={15} /> Route</Button><Button variant="ghost" size="sm" onClick={() => openModal({ kind: 'history' })}>History</Button><Button variant="ghost" size="sm" onClick={() => window.print()}><Printer size={15} /> Print sheet</Button></div></div>
        {receiptDef && <div className="hp-receipt hp-no-print"><Check size={18} /><div><strong>{receiptDef.label} handed off.</strong><p>{stampText(sheet.assignments[receiptDef.id].released!)}</p><div>{nextAssignments(sheet, receiptDef.id).map(a => <button className="hp-text-button" type="button" key={a.id} onClick={() => previewRole(sheet.assignments[a.id].owner)}>Preview {ROLES[sheet.assignments[a.id].owner]}’s inbox <ArrowRight size={14} /></button>)}</div></div><button type="button" aria-label="Dismiss handoff receipt" className="hp-text-button" onClick={() => setReceipt(null)}>×</button></div>}
        <div className="hp-assignment-bar hp-no-print"><div><p className="hp-eyebrow">{mine ? 'YOUR ASSIGNMENT' : `WITH ${ROLES[state.owner].toUpperCase()}`} · {sheet.id}</p><strong>{assignment.label}</strong><p>{selectedSection.label} · {dueLabel(state.due)}{status === 'done' ? ' · Finished' : ''}</p></div><div className="hp-assignment-action">{status === 'done' ? <span><Check size={16} /> Released · {ROLES[state.released!.actor]}</span> : !mine ? <Button variant="outline" size="sm" onClick={() => setRole(state.owner)}>Preview as {ROLES[state.owner]}</Button> : status === 'waiting' ? <><p>Waiting: {state.waiting?.reason}<br />Follow up {state.waiting?.followUp}</p><Button size="sm" onClick={() => { update(s => resumeAssignment(s, assignment.id, role, now())); setAnnouncement('Assignment is back in Ready.'); }}>Resume work</Button></> : status === 'upcoming' ? <p>Upcoming · waiting for {assignment.needs.filter(n => !sheet.assignments[n].released).map(n => ROLES[sheet.assignments[n].owner]).join(' and ')}.<br />You can review the sheet now.</p> : <><Button disabled={issues.length > 0} onClick={release}>{nextRoles.length ? `Hand off to ${nextRoles.join(' & ')}` : 'Finish assignment'} <ArrowRight size={15} /></Button><button className="hp-text-button" type="button" onClick={() => openModal({ kind: 'waiting' })}>Waiting on someone?</button></>}</div>{mine && status === 'ready' && <p className="hp-required-help">{issues.length ? `Before handoff: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? ` + ${issues.length - 3} more` : ''}.` : `Review your highlighted lines.${next.length ? ` Next: ${next.map(a => a.label).join(' and ')}.` : ' Then finish this assignment.'}`}</p>}</div>
        <div className="hp-paper-nav hp-no-print"><div className="hp-side-buttons" role="group" aria-label="Sheet side"><Button variant="outline" size="sm" aria-pressed={side === 'front'} onClick={() => setSide('front')}>Front · Full form</Button><Button variant="outline" size="sm" aria-pressed={side === 'back'} onClick={() => setSide('back')}>Back · Folder contents</Button></div><a href={`/admin/habu-demo/forms/${sheet.kind === 'vacancy' ? 'vacancy-tracking' : 'tenant-setup'}`} target="_blank" rel="noreferrer" className="hp-text-link">Original PDF ↗</a></div>
        <article className={`hp-paper ${template.color}`} aria-label={`${template.title} ${sheet.id}`}>
          <div className="hp-paper-header"><div><h2>{template.title}</h2><p>{sheet.id} · Workflow owner: {ROLES[sheet.workflowOwner]}</p></div><span className="hp-example-stamp">SAMPLE CASE</span></div>
          <div className={`hp-front ${side === 'front' ? '' : 'hp-screen-hidden'}`}><div className={`hp-form-header-fields ${sheet.kind}`}>{template.header.map(row => fieldInput(row, true))}</div><div className="hp-form-columns"><div>{template.sections.filter(s => s.column === 'left').map(sectionPanel)}</div><div>{template.sections.filter(s => s.column === 'right').map(sectionPanel)}</div></div></div>
          <div className={`hp-back ${side === 'back' ? '' : 'hp-screen-hidden'}`}>
            <h2>Back of the sheet</h2><p className="hp-muted">{sheet.values.address} · {sheet.id}</p>
            {template.sections.filter(s => s.column === 'back').map(sectionPanel)}
            {sheet.kind === 'vacancy' && <section className="hp-work-orders"><div className="hp-section-heading"><h3>TURN WORK ORDERS</h3><button className="hp-text-button hp-no-print" onClick={() => openAssignment(sheet, 'turn-work', false)}>With {ROLES[sheet.assignments['turn-work'].owner]} · {assignmentStatus(sheet, 'turn-work')}</button></div><p className="hp-muted">Example work orders, kept with this sheet. No AppFolio records are created.</p>{sheet.workOrders.length ? sheet.workOrders.map(w => <div key={w.id} className="hp-work-order"><div><strong>{w.description}</strong><small>{w.id}</small>{w.completed && <span className="hp-stamp">✓ {stampText(w.completed)}</span>}</div>{!w.completed && sheet.assignments['turn-work'].owner === role && assignmentStatus(sheet, 'turn-work') === 'ready' && <Button size="sm" onClick={() => update(s => completeWorkOrder(s, w.id, role, now()))}>Mark completed</Button>}</div>) : <p>No work orders yet. The inspection may add work.</p>}{(role === sheet.workflowOwner || role === sheet.assignments.inspection.owner) && !sheet.assignments['turn-work'].released && <form className="hp-add-form hp-no-print" onSubmit={e => { e.preventDefault(); update(s => addWorkOrder(s, work, role, now())); setWork(''); }}><label htmlFor="hp-new-work">Add work from the inspection</label><div><input id="hp-new-work" value={work} onChange={e => setWork(e.target.value)} placeholder="For example, replace bedroom blinds" required /><Button size="sm" disabled={!work.trim()} type="submit">Add work order</Button></div></form>}</section>}
            <section className="hp-packet"><h3>PAPERWORK THAT BELONGS WITH THIS SHEET</h3><p className="hp-muted">A reference list in approximate process order, based on the office paper workflows. These are document names, not attached files or completion records.</p><ol>{PAPERWORK[sheet.kind].map(doc => <li key={doc.title}><strong>{doc.title}</strong><span>{doc.stage}</span></li>)}</ol>{sheet.kind === 'setup' && <p className="hp-muted">Co-tenant setup and acquired-tenant setup have their own forms. Those separate workflows are planned for a later phase.</p>}</section>
            <section className="hp-notes"><h3>NOTES THAT TRAVEL WITH THE SHEET</h3>{sheet.notes.length ? sheet.notes.map(n => <div className="hp-note" key={n.id}><p>{n.text}</p><small>{ROLES[n.actor]} · {new Date(n.at).toLocaleString()}</small></div>) : <p className="hp-muted">No notes yet.</p>}<form className="hp-add-form hp-no-print" onSubmit={e => { e.preventDefault(); update(s => addNote(s, note, role, now())); setNote(''); setAnnouncement('Note added to the back of this sheet.'); }}><label htmlFor="hp-note">Add a note</label><textarea id="hp-note" value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="What should the next team know?" /><Button size="sm" type="submit" disabled={!note.trim()}>Add note</Button></form></section>
          </div>
          <footer className="hp-paper-footer">{template.revision} · * Required for this proposed handoff · Sample values, proposed assignment rules</footer>
        </article>
      </TabsContent>
    </Tabs>
    <p className="hp-live-status hp-no-print" role="status" aria-live="polite">{announcement}</p>
    <footer className="hp-footer hp-no-print">Owner-only prototype · Completion times use this device’s clock, displayed in Pacific time · All changes reset on refresh</footer>
    {modal && <Modal title={modal.kind === 'na' ? 'Mark a line not applicable' : modal.kind === 'waiting' ? 'Put this assignment in Waiting' : modal.kind === 'roles' ? 'Roles on this sheet' : modal.kind === 'history' ? 'Sheet history' : modal.kind === 'route' ? 'How this sheet moves' : 'Reset the example?'} onClose={() => setModal(null)} wide={modal.kind === 'route'}>
      <div className="hp-modal-content">
      {modal.kind === 'na' && <><p>{modal.row.label}</p><label htmlFor="hp-reason">Reason</label><textarea id="hp-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} /><Button disabled={!reason.trim()} onClick={() => { update(s => completeTask(s, modal.row.id, role, now(), 'na', reason)); setModal(null); setAnnouncement('Marked not applicable, with a reason in history.'); }}>Record N/A</Button></>}
      {modal.kind === 'waiting' && <><p>{assignment.label} remains assigned to {ROLES[role]}.</p><label htmlFor="hp-wait-reason">What are you waiting for?</label><textarea id="hp-wait-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2} /><label htmlFor="hp-follow-up">Follow-up date</label><input id="hp-follow-up" type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} /><Button disabled={!reason.trim() || !followUp} onClick={() => { update(s => setWaiting(s, assignment.id, role, reason, followUp, now())); setModal(null); setAnnouncement('Moved to Waiting with a follow-up date.'); }}>Move to Waiting</Button></>}
      {modal.kind === 'roles' && <><p>Workflow owner: <strong>{ROLES[sheet.workflowOwner]}</strong>. One role owns each assignment.</p><p className="hp-muted">{role === sheet.workflowOwner ? 'Changes below update this case’s inbox assignments.' : `Preview as ${ROLES[sheet.workflowOwner]}, the workflow owner, to change an assignment.`}</p>{template.assignments.map(a => <div className="hp-role-row" key={a.id}><label htmlFor={`owner-${a.id}`}>{a.label}<small>{assignmentStatus(sheet, a.id)}</small></label><select id={`owner-${a.id}`} value={sheet.assignments[a.id].owner} disabled={role !== sheet.workflowOwner || !!sheet.assignments[a.id].released} onChange={e => update(s => reassign(s, a.id, e.target.value as Role, role, now()))}>{roles.map(p => <option key={p} value={p}>{ROLES[p]}</option>)}</select></div>)}</>}
      {modal.kind === 'history' && <><p className="hp-muted">Completion, handoff, correction, reassignment, and notes in this open example. Initial sample stamps stay on the form. Field edits are temporary and are not a production audit log.</p>{sheet.history.length ? <ol className="hp-history">{[...sheet.history].reverse().map(e => <li key={e.id}><p>{e.text}</p><small>{ROLES[e.actor]} · {new Date(e.at).toLocaleString()}</small></li>)}</ol> : <p>No actions yet in this example.</p>}</>}
      {modal.kind === 'route' && <><p className="hp-muted">The same assignments drive the sheet and inbox. Parallel branches can move independently. Select an assignment to open its lines.</p><ol className="hp-route-list">{template.assignments.map(a => <li key={a.id}><span className={`hp-route-dot ${assignmentStatus(sheet, a.id)}`}>{assignmentStatus(sheet, a.id) === 'done' ? '✓' : ''}</span><button type="button" onClick={() => { openAssignment(sheet, a.id); setModal(null); }}><strong>{a.label}</strong><span>{ROLES[sheet.assignments[a.id].owner]} · {assignmentStatus(sheet, a.id)}</span><small>{a.needs.length ? `After: ${a.needs.map(n => template.assignments.find(x => x.id === n)!.label).join(' + ')}` : 'Starts with this sheet'}</small></button></li>)}</ol><p className="hp-muted">{sheet.kind === 'vacancy' ? 'Accounting runs separately from turn work in this example.' : 'After move-in, payment setup and filing can proceed separately.'} Staff will confirm the actual release rules before a live pilot.</p></>}
      {modal.kind === 'reset' && <><p>This clears the sample changes made in this open page and restores the three starting cases.</p><Button onClick={() => { setSheets(createExamples()); setRole('property-manager'); setSelectedId('VT-104'); setSelectedAssignment('owner'); setView('sheet'); setSide('front'); setReceipt(null); setModal(null); setNoteDrafts({}); setWorkDrafts({}); setAnnouncement('Example reset. Review Owner details, then hand off to Front Desk.'); }}>Reset sample cases</Button></>}
      </div>
    </Modal>}
  </div>;
}
