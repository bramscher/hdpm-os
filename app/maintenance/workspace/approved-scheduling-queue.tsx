'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { EstimateQueueItem } from '@/lib/turn-estimator/estimate-queue';
import { pacificDay, type Workspace } from '@/lib/maintenance-workspace/model';

export default function ApprovedSchedulingQueue({ data }: { data: Workspace }) {
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
  const queued = rows.filter(row => row.stage === 'approved' && !data.jobs.some(job =>
    job.work_order_id === row.workOrderId && data.visits.some(visit =>
      visit.job_id === job.id && visit.status === 'planned' && visit.work_date >= pacificDay())));
  return <section aria-label="Approved estimates ready to schedule">
    <div className="mw-between"><h2>Approved estimates ready to schedule</h2><button disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh queue'}</button></div>
    <p>Brody prepares the estimate; Alberto checks time and numbers before owner approval. After approval, the designated scheduler picks up the job here. Craig and the team will agree who owns the queue-to-calendar handoff.</p>
    {error && <p role="alert" className="mw-error">{error}</p>}
    {!error && !loading && !queued.length && <p className="mw-footnote">No approved estimates are waiting without an upcoming planned visit. Check “Work needing a visit” below for ongoing jobs.</p>}
    <div className="mw-grid">{!loading && !error && queued.map(row => <article className="mw-card" key={row.id}>
      <h3>{row.property} {row.unit}</h3><p>WO {row.workOrder || 'link needed'} · Approved</p>
      <p>{row.total === null ? 'Confirm approved price' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(row.total)}</p>
      <Link href={row.href}>Review approved estimate &amp; schedule →</Link>
      {!row.workOrderId && <p className="mw-warning">A work-order link is needed before job scheduling.</p>}
    </article>)}</div>
  </section>;
}
