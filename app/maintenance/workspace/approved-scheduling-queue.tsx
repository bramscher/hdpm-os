'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { EstimateQueueItem } from '@/lib/turn-estimator/estimate-queue';
import { type Job, type Workspace } from '@/lib/maintenance-workspace/model';

import { schedulingQueue } from '@/lib/maintenance-workspace/scheduling';
import { remainingScope } from '@/lib/maintenance-workspace/planning';
export default function ApprovedSchedulingQueue({ data, filter, day, editVisit }: { data: Workspace; filter: string; day: string; editVisit: (job: Job, visit?: undefined, date?: string) => void }) {
  const [rows, setRows] = useState<EstimateQueueItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/turn-estimator/estimate-queue', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load approved estimates');
      setRows(result.estimates);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const queued = schedulingQueue(data, rows, filter);
  return <section id="scheduling-queue" aria-label="Ready to schedule" className="mw-scheduling-queue">
    <div className="mw-between"><div><h2>Ready to schedule</h2><p>Work orders and approved estimates, grouped by job. Choose a date and technician to reserve a visit.</p></div><button disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh queue'}</button></div>
    <p className="mw-footnote">This queue includes unassigned work across the team. The property filter applies; the technician filter applies to the calendar.</p>
    {error && <p role="alert" className="mw-error">{error} Work orders are still shown; estimate details may be incomplete.</p>}
    {!error && !loading && !queued.length && <p className="mw-empty">No matching jobs are waiting for a visit.</p>}
    <div className="mw-grid">{queued.map(({ key, job, estimates }) => {
      const first = estimates[0];
      const scope = job ? remainingScope(data, job.id) : [];
      const approved = scope.length > 0 || estimates.length > 0;
      return <article className="mw-card" key={key}>
        <span className={`mw-tag ${approved ? '' : 'amber'}`}>{approved ? 'Approved scope' : 'Scope / pricing needed'}</span>
        <h3>{job?.property_name || first?.property} {job?.unit_name || first?.unit}</h3>
        {job && <p>{job.title}</p>}
        {scope.length > 0 && <p>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(scope.reduce((sum,t)=>sum+Number(t.amount),0))} remaining approved scope</p>}
        {estimates.map(e=><p key={e.id}><Link href={e.href}>Review approved estimate · WO {e.workOrder || 'link needed'}{e.total !== null ? ` · ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(e.total)}` : ''} →</Link></p>)}
        {job && <div className="mw-actions"><button onClick={()=>editVisit(job,undefined,day)}>Schedule visit</button><Link href={`/maintenance/board/wo/${job.work_order_id}`}>Work order</Link></div>}
        {!job && first?.workOrderId && <p>Open the approved estimate to prepare its scope and schedule the job.</p>}
        {!job && !first?.workOrderId && <p className="mw-warning">Link this estimate to a work order before scheduling.</p>}
      </article>;
    })}</div>
  </section>;
}
