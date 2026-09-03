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

export default async function TurnsPage() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('unit_turn')
    .select('id, property_name, unit_name, vacated_at, target_ready, lifecycle_status, current_blocker')
    .neq('lifecycle_status', 'CLOSED')
    .order('vacated_at', { ascending: false })
    .limit(200);
  const turns = (data ?? []) as TurnRow[];

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
              <th className="px-3 py-2">Vacated</th>
              <th className="px-3 py-2">Target ready</th>
              <th className="px-3 py-2">Lifecycle</th>
              <th className="px-3 py-2">Blocker</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {turns.map((t) => (
              <tr key={t.id} className="hover:bg-sand-50">
                <td className="px-3 py-2">
                  <Link href={`/turn-estimator/turns/${t.id}`} className="font-medium text-charcoal-900 hover:underline">
                    {t.property_name ?? 'Unknown'}
                    {t.unit_name ? <span className="text-charcoal-500"> · #{t.unit_name}</span> : null}
                  </Link>
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
            ))}
            {turns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-charcoal-400">
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
