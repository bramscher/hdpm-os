import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getTurnLifecycle } from '@/lib/turn-estimator/turns';
import { getTurnDispatch } from '@/lib/turn-estimator/dispatch';
import TurnLifecyclePanel from '@/components/turn-estimator/TurnLifecyclePanel';
import TurnDispatchSync from '@/components/turn-estimator/TurnDispatchSync';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Turn' };

const money = (n: number) => `$${n.toFixed(2)}`;

export default async function TurnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTurnLifecycle(id);
  if (!result) notFound();
  const { turn, events } = result;
  const { workOrders, variance } = await getTurnDispatch(id);

  // The turn's latest estimate (for the owner-facing PDF link).
  const { data: latestEstimate } = await getSupabaseAdmin()
    .from('estimate')
    .select('id, current_version_id')
    .eq('unit_turn_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <a href="/turn-estimator/turns" className="text-xs text-charcoal-400 hover:text-charcoal-700">
        ← Turns
      </a>
      <h1 className="mt-1 text-display text-charcoal-900">
        {turn.property_name ?? 'Turn'}
        {turn.unit_name ? <span className="text-charcoal-400"> · #{turn.unit_name}</span> : null}
      </h1>
      <div className="mb-6 mt-1 flex items-center justify-between gap-3">
        <p className="text-sm text-charcoal-500">
          Vacated {turn.vacated_at ?? '—'} · Target ready {turn.target_ready ?? '—'}
        </p>
        <a
          href={`/turn-estimator/estimates/new?turn=${turn.id}`}
          className="shrink-0 rounded-lg bg-charcoal-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-charcoal-800"
        >
          + New estimate
        </a>
      </div>

      <TurnLifecyclePanel
        turnId={turn.id}
        currentStatus={turn.lifecycle_status}
        events={(events as { id: number; from_status: string | null; to_status: string; actor: string; reason: string | null; created_at: string }[]).map((e) => ({
          id: e.id,
          from_status: e.from_status,
          to_status: e.to_status,
          actor: e.actor,
          reason: e.reason,
          created_at: e.created_at,
        }))}
      />

      {/* Dispatch & execution — AppFolio is the WO system of record; this is a
          read view of the turn's WOs + estimate-vs-actual variance. */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-charcoal-600">Work orders</h2>
        <TurnDispatchSync turnId={turn.id} />
      </div>

      {latestEstimate?.current_version_id && (
        <div className="mt-2">
          <a
            href={`/api/turn-estimator/estimates/${latestEstimate.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800"
          >
            📄 Download owner estimate (HDMS PDF)
          </a>
        </div>
      )}

      {/* Variance card */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Approved estimate" value={money(variance.approved)} />
        <Stat label="Actual (invoiced)" value={money(variance.actual)} sub={`${variance.invoice_count} invoice(s)`} />
        <Stat
          label="Variance"
          value={`${variance.variance >= 0 ? '+' : ''}${money(variance.variance)}`}
          sub={variance.pct != null ? `${variance.pct >= 0 ? '+' : ''}${variance.pct}%` : 'no approved estimate'}
          tone={variance.variance > 0 ? 'over' : variance.variance < 0 ? 'under' : 'flat'}
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-charcoal-500">
            <tr>
              <th className="px-3 py-2">WO #</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">AppFolio status</th>
              <th className="px-3 py-2">Assigned</th>
              <th className="px-3 py-2">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {workOrders.map((w) => (
              <tr key={w.id}>
                <td className="px-3 py-2 font-mono text-xs text-charcoal-700">{w.wo_number ?? '—'}</td>
                <td className="px-3 py-2 text-charcoal-800">{w.stage}</td>
                <td className="px-3 py-2 text-charcoal-500">{w.appfolio_status ?? '—'}</td>
                <td className="px-3 py-2 text-charcoal-600">{w.assigned_to ?? '—'}</td>
                <td className="max-w-[18rem] truncate px-3 py-2 text-charcoal-600">{w.description ?? ''}</td>
              </tr>
            ))}
            {workOrders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-charcoal-400">
                  No work orders linked to this turn yet (they sync from AppFolio).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'flat',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'over' | 'under' | 'flat';
}) {
  const toneClass =
    tone === 'over' ? 'text-red-600' : tone === 'under' ? 'text-green-600' : 'text-charcoal-900';
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4 shadow-card">
      <div className="text-xs uppercase tracking-wide text-charcoal-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-charcoal-500">{sub}</div> : null}
    </div>
  );
}
