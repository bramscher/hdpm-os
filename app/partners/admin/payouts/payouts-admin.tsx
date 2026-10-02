'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PayableRow, PaymentBatch } from '@/lib/referrals/payouts';

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' });

export default function PayoutsAdmin({ ready, batches }: { ready: PayableRow[]; batches: PaymentBatch[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(ready.map((r) => r.leadId)));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const chosen = useMemo(() => ready.filter((r) => selected.has(r.leadId)), [ready, selected]);
  const total = chosen.reduce((n, r) => n + r.amount, 0);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportUrl = `/api/partners/admin/payouts/export?ids=${encodeURIComponent(chosen.map((r) => r.leadId).join(','))}&ref=${encodeURIComponent(reference || 'Referral bounties')}`;

  async function pay() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/partners/admin/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: chosen.map((r) => r.leadId), reference }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed');
      const failed = body.failed?.length ? ` ${body.failed.length} could not be marked: ${body.failed.map((f: { error: string }) => f.error).join('; ')}` : '';
      setMsg({ tone: body.failed?.length ? 'err' : 'ok', text: `Recorded batch ${body.batchId}: ${body.paid.length} paid.${failed}` });
      setReference('');
      router.refresh();
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-sand-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-charcoal-800">Ready to pay · {ready.length}</h2>
          <span className="text-sm text-charcoal-500">
            Selected: <strong className="text-charcoal-900">{chosen.length}</strong> · {usd(total)}
          </span>
        </div>

        {ready.length === 0 ? (
          <p className="text-sm text-charcoal-500">
            No approved bounties waiting. Approve bounties on each lead&apos;s page (Pipeline → lead → Bounty).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-charcoal-400">
                <th className="py-2 pr-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={chosen.length === ready.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(ready.map((r) => r.leadId)) : new Set())}
                  />
                </th>
                <th className="py-2 pr-3">Payee</th>
                <th className="py-2 pr-3">Lead</th>
                <th className="py-2 pr-3">Approved</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2">1099 info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {ready.map((r) => (
                <tr key={r.leadId}>
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label={`Select ${r.prospectName}`} checked={selected.has(r.leadId)} onChange={() => toggle(r.leadId)} />
                  </td>
                  <td className="py-2 pr-3 font-medium text-charcoal-900">{r.payee}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/partners/admin/leads/${r.leadId}`} className="text-charcoal-700 hover:underline">
                      {r.prospectName}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-charcoal-500">{day(r.approvedAt)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usd(r.amount)}</td>
                  <td className="py-2">
                    {r.readiness.ready ? (
                      <Badge tone="success">Complete</Badge>
                    ) : (
                      <Badge tone="warning" title={`Missing: ${r.readiness.missing.join(', ')}`}>
                        Missing {r.readiness.missing.join(', ')}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {ready.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-sand-100 pt-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-charcoal-600">
              <li>Download the QuickBooks file and import it (Expenses or Bills), or enter the payments by hand.</li>
              <li>Pay them in QuickBooks.</li>
              <li>Record the batch here with the QuickBooks reference. Each referrer gets a &ldquo;bounty paid&rdquo; email.</li>
            </ol>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-charcoal-500">
                Payment reference
                <Input className="mt-1 w-56" placeholder="e.g. check run 1042" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
              <a
                href={chosen.length ? exportUrl : undefined}
                aria-disabled={!chosen.length}
                className={`inline-flex h-9 items-center rounded-lg border border-sand-200 px-4 text-sm font-medium ${chosen.length ? 'text-charcoal-800 hover:bg-sand-50' : 'pointer-events-none text-charcoal-300'}`}
              >
                Download QuickBooks file (CSV)
              </a>
              <Button size="sm" disabled={busy || chosen.length === 0 || !reference.trim()} onClick={() => void pay()}>
                {busy ? 'Recording…' : `Mark ${chosen.length} paid · ${usd(total)}`}
              </Button>
            </div>
            {msg && <p className={`text-sm ${msg.tone === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-sand-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-charcoal-800">Payment history</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-charcoal-500">Nothing paid yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-charcoal-400">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Batch</th>
                <th className="py-2 pr-3">Reference</th>
                <th className="py-2 pr-3 text-right">Bounties</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {batches.map((b) => (
                <tr key={`${b.batchId}-${b.paidAt}`}>
                  <td className="py-2 pr-3 text-charcoal-500">{day(b.paidAt)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{b.batchId}</td>
                  <td className="py-2 pr-3">{b.reference ?? '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{b.count}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usd(b.total)}</td>
                  <td className="py-2 text-xs text-charcoal-400">{b.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
