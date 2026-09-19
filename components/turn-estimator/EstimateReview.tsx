'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Detail {
  estimate: { id: string; property_name: string; unit_name: string | null; status: string; wo_number: string | null; work_order_id: string | null; source_saved_draft_id: string | null };
  version: { id: string; owner_total: number; version_number: number; notes: string | null } | null;
  lines: { id: string; description: string; qty: number; uom: string; owner_extended: number; tax_amount: number }[];
  job_id: string | null;
  invoice: { id: string; invoice_code: string; status: string } | null;
  canApprove: boolean;
  canSchedule: boolean;
  canConvert: boolean;
}
const money = (value: number) => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(Number(value));
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-sand-200 px-4 py-2 text-sm font-medium disabled:opacity-50';
export default function EstimateReview({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    const response = await fetch(`/api/turn-estimator/estimates/${estimateId}`);
    const detail = await response.json();
    if (!response.ok) throw new Error(detail.error);
    setData(detail);
  }, [estimateId]);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  async function request(url: string, body: unknown, method = 'POST') {
    const response = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to save');
    return result;
  }
  async function act(action: 'APPROVED' | 'DECLINED' | 'schedule' | 'invoice') {
    if (!data?.version || busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'schedule') {
        const job = await request(`/api/turn-estimator/estimates/${estimateId}/start-work`, {});
        router.push(`/maintenance/workspace?job=${job.job_id}`);
      } else if (action === 'invoice') {
        const invoice = await request('/api/turn-estimator/convert', {version_id: data.version.id});
        router.push(`/maintenance/invoices?invoice=${invoice.invoice_id}`);
      } else {
        if (!reason.trim()) throw new Error('Record the approval source or reason for declining.');
        const approval = await request('/api/turn-estimator/approvals', {version_id: data.version.id, kind: 'PM'});
        await request(`/api/turn-estimator/approvals/${approval.id}`, {decision: action, reason}, 'PATCH');
        await load();
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5">
    <Link href="/maintenance/invoices?tab=estimates" className="text-sm text-green-800 underline">← Estimates</Link>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {!data ? <p role="status">{error ? 'Estimate could not load.' : 'Loading estimate…'}</p> : <>
      <header className="rounded-xl border border-sand-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-charcoal-500">Estimate{data.version ? ` · version ${data.version.version_number}` : ' draft'}</p>
        <h1 className="mt-2 text-2xl font-semibold text-charcoal-900">{data.estimate.property_name}{data.estimate.unit_name && ` · ${data.estimate.unit_name}`}</h1>
        <p className="mt-2 text-sm text-charcoal-500">{data.estimate.wo_number && `WO ${data.estimate.wo_number} · `}{data.estimate.status.replaceAll('_', ' ')}</p>
        {data.version && <p className="mt-3 text-2xl font-semibold">{money(data.version.owner_total)}</p>}
      </header>
      {!data.version ? <div className="rounded-xl border border-sand-200 bg-white p-5"><p className="mb-4 text-sm text-charcoal-500">This estimate has no issued scope yet.</p><Link className={button} href={data.estimate.source_saved_draft_id ? `/turn-estimator/estimates/new?resume=${data.estimate.source_saved_draft_id}` : `/turn-estimator/estimates/new${data.estimate.work_order_id ? `?from_wo=${data.estimate.work_order_id}` : ''}`}>Prepare priced scope</Link></div> : <>
        <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-sand-50 text-charcoal-500"><tr><th className="p-4">Approved / proposed scope</th><th className="p-4">Quantity</th><th className="p-4 text-right">Charge</th></tr></thead><tbody>{data.lines.map(line => <tr key={line.id} className="border-t border-sand-100"><td className="p-4">{line.description}</td><td className="whitespace-nowrap p-4">{line.qty} {line.uom}</td><td className="p-4 text-right">{money(Number(line.owner_extended) + Number(line.tax_amount))}</td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap gap-3"><a className={button} href={`/api/turn-estimator/estimates/${estimateId}/pdf`} target="_blank" rel="noopener noreferrer">View estimate PDF</a>{data.estimate.work_order_id && <Link className={button} href={`/maintenance/board/wo/${data.estimate.work_order_id}`}>Work order</Link>}</div>
        {data.estimate.status === 'approval_pending' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold">Awaiting approval</h2><p className="mt-1 text-sm">Review the scope and record the authorization before starting work.</p>{data.canApprove && <><label className="mt-4 block text-sm">Approval source / decision note<textarea className="mt-1 block min-h-20 w-full rounded-lg border border-amber-200 bg-white p-3" value={reason} onChange={e => setReason(e.target.value)} placeholder="Who approved the work, when, and any conditions"/></label><div className="mt-3 flex gap-3"><button disabled={busy} className={`${button} bg-green-700 text-white`} onClick={() => act('APPROVED')}>Record approval</button><button disabled={busy} className={button} onClick={() => act('DECLINED')}>Decline</button></div></>}</div>}
        {data.invoice ? <div className="rounded-xl border border-sand-200 bg-white p-5"><h2 className="font-semibold">Invoice prepared</h2><p className="my-2 text-sm">{data.invoice.invoice_code} · {data.invoice.status}</p><Link className={button} href={`/maintenance/invoices?invoice=${data.invoice.id}`}>Open invoice</Link></div> : data.estimate.status === 'approved' && <div className="rounded-xl border border-green-200 bg-green-50 p-5"><h2 className="font-semibold">Next: schedule and complete the work</h2><p className="mt-1 text-sm text-green-900">Track actual work against these items, then review and bill completed tasks.</p><div className="mt-4 flex flex-wrap gap-3">{data.job_id ? <Link className={`${button} bg-green-700 text-white`} href={`/maintenance/workspace?job=${data.job_id}`}>Open job & schedule</Link> : data.canSchedule && data.estimate.work_order_id && <button disabled={busy} className={`${button} bg-green-700 text-white`} onClick={() => act('schedule')}>{busy ? 'Preparing…' : 'Set up job & schedule'}</button>}{!data.job_id && data.canConvert && <button disabled={busy} className={`${button} bg-white`} onClick={() => act('invoice')}>Create invoice draft for full scope</button>}</div>{!data.job_id && data.canConvert && <p className="mt-3 text-xs text-green-900">Use the full-scope invoice path for work that is ready to bill. Use task billing for work in progress.</p>}{!data.estimate.work_order_id && <p className="mt-3 text-sm">This estimate has no work-order link. Start future job estimates from Work Orders to keep scheduling and billing connected.</p>}</div>}
      </>}
    </>}
  </section>;
}
