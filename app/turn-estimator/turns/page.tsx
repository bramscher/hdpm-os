import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase';
import { turnStatusLabel, deriveLegacyStatus } from '@/lib/turn-estimator/turn-lifecycle';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Turns' };

interface TurnRow {
  id: string;
  property_name: string | null;
  unit_name: string | null;
  vacated_at: string | null;
  target_ready: string | null;
  lifecycle_status: string;
  current_blocker: string | null;
}

const legacyStyle: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-700',
  closed: 'bg-charcoal-100 text-charcoal-600',
};

// The most-advanced non-void estimate state on a turn wins the badge.
const ESTIMATE_RANK: Record<string, number> = {
  approved: 5,
  approval_pending: 4,
  ready: 3,
  draft: 2,
  declined: 1,
};
const ESTIMATE_BADGE: Record<string, { label: string; style: string }> = {
  approved: { label: 'Approved', style: 'bg-green-100 text-green-700' },
  approval_pending: { label: 'Pending approval', style: 'bg-amber-100 text-amber-700' },
  ready: { label: 'Drafted', style: 'bg-blue-100 text-blue-700' },
  draft: { label: 'Drafted', style: 'bg-blue-100 text-blue-700' },
  declined: { label: 'Declined', style: 'bg-charcoal-100 text-charcoal-600' },
};

export default async function TurnsPage() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('unit_turn')
    .select('id, property_name, unit_name, vacated_at, target_ready, lifecycle_status, current_blocker')
    .neq('lifecycle_status', 'CLOSED')
    .order('vacated_at', { ascending: false })
    .limit(200);
  const turns = (data ?? []) as TurnRow[];
  const turnIds = turns.map((t) => t.id);

  // Per-turn work-order counts (total + still-open) and the best estimate state.
  const woByTurn = new Map<string, { total: number; open: number }>();
  const estByTurn = new Map<string, string>();
  if (turnIds.length > 0) {
    const { data: wos } = await supabase
      .from('work_orders')
      .select('unit_turn_id, status')
      .in('unit_turn_id', turnIds);
    for (const w of (wos ?? []) as { unit_turn_id: string; status: string }[]) {
      const c = woByTurn.get(w.unit_turn_id) ?? { total: 0, open: 0 };
      c.total += 1;
      if (w.status === 'open') c.open += 1;
      woByTurn.set(w.unit_turn_id, c);
    }
    const { data: ests } = await supabase
      .from('estimate')
      .select('unit_turn_id, status')
      .in('unit_turn_id', turnIds)
      .neq('status', 'void');
    for (const e of (ests ?? []) as { unit_turn_id: string | null; status: string }[]) {
      if (!e.unit_turn_id) continue;
      const cur = estByTurn.get(e.unit_turn_id);
      if (!cur || (ESTIMATE_RANK[e.status] ?? 0) > (ESTIMATE_RANK[cur] ?? 0)) {
        estByTurn.set(e.unit_turn_id, e.status);
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-display text-charcoal-900">Turns</h1>
      <p className="mb-6 mt-1 text-sm text-charcoal-500">
        Unit turns and where each one sits in its lifecycle. Open a turn to advance its status.
      </p>

      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-charcoal-500">
            <tr>
              <th className="px-3 py-2">Property / Unit</th>
              <th className="px-3 py-2">Work orders</th>
              <th className="px-3 py-2">Estimate</th>
              <th className="px-3 py-2">Vacated</th>
              <th className="px-3 py-2">Target ready</th>
              <th className="px-3 py-2">Lifecycle</th>
              <th className="px-3 py-2">Blocker</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {turns.map((t) => {
              const wo = woByTurn.get(t.id);
              const est = estByTurn.get(t.id);
              const badge = est ? ESTIMATE_BADGE[est] : null;
              return (
                <tr key={t.id} className="hover:bg-sand-50">
                  <td className="px-3 py-2">
                    <Link href={`/turn-estimator/turns/${t.id}`} className="font-medium text-charcoal-900 hover:underline">
                      {t.property_name ?? 'Unknown'}
                      {t.unit_name ? <span className="text-charcoal-500"> · #{t.unit_name}</span> : null}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-charcoal-600 whitespace-nowrap">
                    {wo && wo.total > 0 ? (
                      <>
                        <span className="font-medium text-charcoal-800">{wo.total}</span>
                        {wo.open > 0 && <span className="text-amber-700"> · {wo.open} open</span>}
                      </>
                    ) : (
                      <span className="text-charcoal-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {badge ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.style}`}>
                        {badge.label}
                      </span>
                    ) : (
                      <span className="text-charcoal-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-charcoal-600">{t.vacated_at ?? '—'}</td>
                  <td className="px-3 py-2 text-charcoal-600">{t.target_ready ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${legacyStyle[deriveLegacyStatus(t.lifecycle_status)]}`}
                    >
                      {turnStatusLabel(t.lifecycle_status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-amber-700">{t.current_blocker ?? ''}</td>
                </tr>
              );
            })}
            {turns.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-charcoal-400">
                  No open turns.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
