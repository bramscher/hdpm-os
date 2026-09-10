'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FileText, Printer, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { FORM_DRAFTS, initialDraftValues, draftMarkdown, type DraftField, type DraftSection, type DraftValues } from '@/lib/habu-paper/form-drafts';

const families = ['Application & setup', 'Move-in', 'Vacancy'] as const;

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FormDraftLibrary() {
  const [selected, setSelected] = useState('co-tenant-setup');
  const [valuesByForm, setValuesByForm] = useState<Record<string, DraftValues>>(() => Object.fromEntries(FORM_DRAFTS.map(form => [form.id, initialDraftValues(form)])));
  const [query, setQuery] = useState('');
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState('Select a form to review its draft.');
  const form = FORM_DRAFTS.find(f => f.id === selected)!;
  const values = valuesByForm[form.id];
  const matches = FORM_DRAFTS.filter(f => `${f.title} ${f.family}`.toLowerCase().includes(query.toLowerCase().trim()));
  function change(id: string, value: string) {
    setValuesByForm(all => ({ ...all, [form.id]: { ...all[form.id], [id]: value } }));
  }
  function open(id: string) {
    setSelected(id); setMessage(`Opened ${FORM_DRAFTS.find(f => f.id === id)!.title}.`);
    requestAnimationFrame(() => {
      const heading = document.getElementById('fd-document-title');
      heading?.scrollIntoView({ block: 'start' }); heading?.focus({ preventScroll: true });
    });
  }
  function renderField(field: DraftField) {
    const id = `draft-${form.id}-${field.id}`;
    const value = values[field.id] || '';
    if (field.type === 'check') return <label className="fd-check" key={field.id} htmlFor={id}><input id={id} type="checkbox" checked={value === 'checked'} onChange={e => change(field.id, e.target.checked ? 'checked' : '')} /><span>{field.label}</span></label>;
    return <div className={`fd-field ${field.type === 'long' ? 'fd-long' : ''}`} key={field.id}>
      <label htmlFor={id}>{field.label}{field.type === 'money' ? ' ($)' : ''}</label>
      {field.type === 'long' ? <textarea id={id} value={value} rows={field.initial ? Math.min(32, field.initial.split('\n').length + 2) : 4} onChange={e => change(field.id, e.target.value)} placeholder="Draft text / notes" /> : field.type === 'choice' ? <select id={id} value={value} onChange={e => change(field.id, e.target.value)}><option value="">Choose…</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select> : <input id={id} type={field.type === 'money' || field.type === 'number' ? 'number' : field.type} step={field.type === 'money' ? '0.01' : field.type === 'number' ? '1' : undefined} value={value} onChange={e => change(field.id, e.target.value)} />}
      <span className="fd-print-value">{value || '________________'}</span>
    </div>;
  }
  function section(section: DraftSection, index: number) {
    return <section className="fd-section" key={`${index}-${section.title}`}><h3>{section.title}</h3>{section.note && <p className="fd-section-note">{section.note}</p>}<div className={section.fields.some(f => f.type === 'long') ? '' : 'fd-fields'}>{section.fields.map(renderField)}</div></section>;
  }
  return <div className="fd-app">
    <header className="fd-heading fd-no-print"><div><Link href="/admin/habu-paper"><ArrowLeft size={15} /> Workflow demo</Link><p className="fd-eyebrow">HABU · OWNER REVIEW</p><h1>Form drafts</h1><p>{FORM_DRAFTS.length} forms and letters from the office paper workflows.</p></div><Button variant="outline" onClick={() => { download('HABU-all-form-drafts.md', FORM_DRAFTS.map(f => draftMarkdown(f, valuesByForm[f.id])).join('\n\n---\n\n')); setMessage('Downloaded all 15 drafts with your current edits.'); }}><Download size={16} /> Download all drafts</Button></header>
    <p className="fd-notice fd-no-print">Blank drafts for review · Edits last until refresh or leaving this page · Download to keep your edits · Checkmarks do not complete staff assignments</p>
    <div className="fd-layout">
      <aside className="fd-library fd-no-print" aria-label="Form library"><label className="fd-search" htmlFor="fd-search"><Search size={16} /><input id="fd-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a form…" aria-label="Find a form" /></label>{families.map(family => <section key={family}><h2>{family}</h2>{matches.filter(f => f.family === family).map((draft) => <button type="button" key={draft.id} aria-pressed={draft.id === selected} onClick={() => open(draft.id)}><FileText size={15} /><span>{draft.title}</span></button>)}</section>)}{!matches.length && <p>No matching forms.</p>}<p className="fd-library-note">Additional agreements, CCRs and addenda in the company library are outside this first batch of 15 photographed documents.</p></aside>
      <main className="fd-document-area">
        <div className="fd-toolbar fd-no-print"><span>{FORM_DRAFTS.findIndex(f => f.id === selected) + 1} of {FORM_DRAFTS.length} · {form.family}</span><div><Button variant="ghost" size="sm" onClick={() => setResetting(true)}>Reset this draft</Button><Button variant="outline" size="sm" onClick={() => { download(`HABU-${form.id}-draft.md`, draftMarkdown(form, values)); setMessage(`Downloaded ${form.title} with your edits.`); }}><Download size={15} /> Download</Button><Button size="sm" onClick={() => window.print()}><Printer size={15} /> Print</Button></div></div>
        <article className={`fd-paper ${form.family === 'Vacancy' ? 'fd-gold' : ''}`} aria-label={form.title}>
          <header><p className="fd-brand">HIGH DESERT PROPERTY MANAGEMENT</p><h2 id="fd-document-title" tabIndex={-1}>{form.title}</h2><p className="fd-draft-stamp">DRAFT · INTERNAL REVIEW · NOT FOR SIGNATURE OR DELIVERY</p></header>
          <div className="fd-review"><strong>Source and review notes</strong><p>{form.source}</p><ul>{form.review.map(note => <li key={note}>{note}</li>)}</ul></div>
          {form.sections.filter(s => !s.column).map(section)}
          {form.sections.some(s => s.column) && <div className="fd-columns"><div>{form.sections.filter(s => s.column === 'left').map(section)}</div><div>{form.sections.filter(s => s.column === 'right').map(section)}</div></div>}
          <footer>HABU draft · September 2026 · Source gaps remain marked for review. No records are sent, signed, or saved to AppFolio.</footer>
        </article>
      </main>
    </div>
    <p className="fd-status fd-no-print" role="status" aria-live="polite">{message}</p>
    {resetting && <Modal title="Reset this draft?" onClose={() => setResetting(false)}><p>This clears edits to {form.title}. The other drafts keep their edits.</p><Button onClick={() => { setValuesByForm(all => ({ ...all, [form.id]: initialDraftValues(form) })); setResetting(false); setMessage(`Reset ${form.title}.`); }}>Reset this draft</Button></Modal>}
  </div>;
}
