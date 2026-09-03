import { notFound } from 'next/navigation';
import { getTurnLifecycle } from '@/lib/turn-estimator/turns';
import TurnLifecyclePanel from '@/components/turn-estimator/TurnLifecyclePanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Turn' };

export default async function TurnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTurnLifecycle(id);
  if (!result) notFound();
  const { turn, events } = result;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <a href="/turn-estimator/turns" className="text-xs text-charcoal-400 hover:text-charcoal-700">
        ← Turns
      </a>
      <h1 className="mt-1 text-display text-charcoal-900">
        {turn.property_name ?? 'Turn'}
        {turn.unit_name ? <span className="text-charcoal-400"> · #{turn.unit_name}</span> : null}
      </h1>
      <p className="mb-6 mt-1 text-sm text-charcoal-500">
        Vacated {turn.vacated_at ?? '—'} · Target ready {turn.target_ready ?? '—'}
      </p>

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
    </div>
  );
}
