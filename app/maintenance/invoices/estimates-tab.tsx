'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, RefreshCw, Search, Trash2, Wrench } from 'lucide-react';
import type { EstimateQueueItem, EstimateStage } from '@/lib/turn-estimator/estimate-queue';

const stages: [EstimateStage | 'all', string][] = [['all', 'All'], ['draft', 'Drafts'], ['approval_pending', 'Awaiting approval'], ['approved', 'Approved'], ['billing', 'In billing'], ['closed', 'Closed']];
const labels = Object.fromEntries(stages);
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sand-200 px-4 py-2 text-sm font-medium';

export function EstimatesTab({ onChooseWorkOrder }: { onChooseWorkOrder: () => void }) {
  const [rows, setRows] = useState<EstimateQueueItem[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canCreate, setCanCreate] = useState(false);
  const [stage, setStage] = useState<EstimateStage | 'all'>('all');
  const [search, setSearch] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/turn-estimator/estimate-queue');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRows(data.estimates); setCanCreate(data.canCreate);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function deleteDraft(row: EstimateQueueItem) {
    if (deleting || !window.confirm(`Delete the draft estimate for ${row.property}${row.unit ? ` · ${row.unit}` : ''}? This cannot be undone. Any linked work order will be kept.`)) return;
    setDeleting(row.id); setDeleteError('');
    try {
      const response = await fetch(`/api/turn-estimator/estimate-queue?id=${encodeURIComponent(row.id)}&kind=${row.draftKind}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not delete draft estimate');
      setRows(current => current.filter(item => item.id !== row.id));
    } catch (e) { setDeleteError((e as Error).message); }
    finally { setDeleting(null); }
  }
  const shown = rows.filter(row => (stage === 'all' || row.stage === stage) && `${row.property} ${row.unit} ${row.workOrder}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="space-y-5" aria-label="Estimates">
    <div className="rounded-xl border border-sand-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold text-charcoal-900">Scope and price the work</h2><p className="mt-1 max-w-2xl text-sm text-charcoal-500">Start with an estimate for turns, multi-task jobs, or uncertain scope. Simple, already-authorized repairs can go straight to an invoice draft from Work Orders.</p></div>
        <button className={button} onClick={load} disabled={loading} aria-label="Refresh estimates"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <Link className={`${button} mt-3`} href="/company/issues#maintenance-followups">Maintenance follow-ups →</Link>
      {canCreate && <div className="mt-4 flex flex-wrap gap-3">
        <button className={`${button} bg-green-700 text-white`} onClick={onChooseWorkOrder}><Wrench className="h-4 w-4"/>Create from work order</button>
        <Link className={button} href="/turn-estimator/estimates/new?template=1"><FileText className="h-4 w-4"/>Start from template / price book</Link>
      </div>}
      <div className="mt-3 flex flex-wrap gap-4 text-sm"><Link className="text-green-800 underline" href="/turn-estimator/price-book">Open price book</Link><Link className="text-green-800 underline" href="/maintenance/workspace?view=schedule">Availability & planned revenue</Link></div>
      <p className="mt-2 text-xs text-charcoal-500">The price book supplies item prices; templates assemble those items into reusable scope. Issued estimates keep their saved prices.</p>
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Estimate status filters">
      {stages.map(([value, label]) => <button key={value} aria-pressed={stage === value} onClick={() => setStage(value)} className={`${button} ${stage === value ? 'bg-charcoal-900 text-white' : 'bg-white text-charcoal-600'}`}>{label}<span className="text-xs opacity-70">{rows.filter(r => value === 'all' || r.stage === value).length}</span></button>)}
    </div>
    <label className="flex items-center gap-2 rounded-lg border border-sand-200 bg-white px-3"><Search className="h-4 w-4 text-charcoal-400"/><input className="min-h-11 w-full bg-transparent text-sm outline-none" aria-label="Search estimates" placeholder="Search property, unit, or work order" value={search} onChange={e => setSearch(e.target.value)}/></label>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error} <button className="underline" onClick={load}>Retry</button></p>}
    {deleteError && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{deleteError}</p>}
    {loading ? <p role="status" className="p-6 text-sm text-charcoal-500">Loading estimates…</p> : !error && <div className="space-y-3">
      {!shown.length && <p className="rounded-xl border border-dashed border-sand-200 p-8 text-center text-sm text-charcoal-500">{rows.length ? 'No estimates match these filters.' : 'No estimates yet. Choose a work order or a template to prepare the first one.'}</p>}
      {shown.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sand-200 bg-white p-5">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-charcoal-900">{row.property}{row.unit && ` · ${row.unit}`}</h3><span className="rounded-full bg-sand-100 px-2.5 py-1 text-xs text-charcoal-600">{labels[row.stage]}</span></div>
          <p className="mt-1 text-sm text-charcoal-500">{row.workOrder ? `WO ${row.workOrder} · ` : ''}{new Date(row.updatedAt).toLocaleDateString()}{row.stage === 'closed' ? ` · ${row.status.replaceAll('_', ' ')}` : ''}</p>
          {row.taskCount > 0 && <p className="mt-1 text-xs text-charcoal-500">{row.undraftedTasks} of {row.taskCount} tasks not yet drafted</p>}
        </div>
        <div className="flex flex-wrap items-center gap-4"><span className="font-semibold text-charcoal-800">{row.total === null ? 'Draft pricing' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(row.total)}</span>{row.stage==='approved'&&row.workOrderId&&<Link className={`${button} bg-green-700 text-white`} href={`/maintenance/workspace?estimate=${row.id}&schedule=1`}>Schedule</Link>}<Link className={button} href={row.href}>{row.stage === 'draft' ? 'Continue estimate' : 'Review estimate'}</Link>{canCreate && row.stage === 'draft' && row.status === 'draft' && row.draftKind && <button className={`${button} text-red-700 hover:bg-red-50 disabled:opacity-50`} disabled={deleting !== null} onClick={() => void deleteDraft(row)}><Trash2 className="h-4 w-4"/>{deleting === row.id ? 'Deleting…' : 'Delete draft'}</button>}</div>
      </article>)}
    </div>}
  </section>;
}
