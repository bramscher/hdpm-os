import { getSupabaseAdmin } from '@/lib/supabase';
import { weekStartPacific, weeksBefore } from '@/lib/eos/scorecard';
import ScorecardGrid from '@/components/eos/ScorecardGrid';
import type { ScorecardMetric, ScorecardEntry } from '@/lib/eos/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'HDPM-OS — Scorecard',
};

const WEEKS_SHOWN = 8;

/**
 * Company → Scorecard (Phase 2, Brief 2B). Weekly grid, red/green vs goal,
 * manual entry for manual metrics, [Drop to Issues]. Auto rows fill Friday
 * 3 PM via /api/eos/cron/scorecard.
 */
export default async function ScorecardPage() {
  const supabase = getSupabaseAdmin();
  const currentWeek = weekStartPacific(new Date());
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) =>
    weeksBefore(currentWeek, WEEKS_SHOWN - 1 - i)
  ); // oldest → newest

  const [metricsRes, entriesRes] = await Promise.all([
    supabase
      .from('scorecard_metric')
      .select('*')
      .eq('org_id', 'hdpm')
      .eq('active', true)
      .order('sort'),
    supabase
      .from('scorecard_entry')
      .select('*')
      .gte('week_start', weeks[0])
      .order('week_start'),
  ]);

  const metrics = (metricsRes.data ?? []) as ScorecardMetric[];
  const entries = (entriesRes.data ?? []) as ScorecardEntry[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-display text-charcoal-900">Scorecard</h1>
      <p className="mb-6 text-sm text-charcoal-500">
        Weekly numbers vs goal. Auto rows fill Friday afternoon from the agent metrics; manual
        metrics are entered here. Two weeks off-track files an issue automatically.
      </p>
      <ScorecardGrid metrics={metrics} entries={entries} weeks={weeks} currentWeek={currentWeek} />
      <p className="mt-6 text-xs text-charcoal-400">
        Goals are provisional until reviewed · Data: scorecard_metric, scorecard_entry ·
        Auto-fill: Friday 3 PM PT
      </p>
    </div>
  );
}
