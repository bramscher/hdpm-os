import { getSupabaseAdmin } from '@/lib/supabase';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { isFreshScorecardSource, weekStartPacific, weeksBefore } from '@/lib/eos/scorecard';
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
  const storedEntries = (entriesRes.data ?? []) as ScorecardEntry[];
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles',weekday:'short'}).format(now);
  const entries = storedEntries.map(e => e.week_start === currentWeek && e.source === 'auto' && !['Sat','Sun'].includes(weekday) && !isFreshScorecardSource(e.source_captured_at, now) ? {...e,value:null,on_track:null} : e);

  const latestUpdate = entries.filter(e => e.week_start === currentWeek && e.source === 'auto' && e.updated_at).map(e => e.updated_at!).sort().at(-1);
  return (
    <PageContainer>
      <PageHeader
        title="Scorecard"
        description="Current-week numbers refresh each weekday morning and finalize Friday afternoon. Previous weeks stay fixed. Two weeks off-track files an issue at the Friday review."
      />
      <p className="mb-4 text-sm text-charcoal-500">{latestUpdate ? `Updated ${new Date(latestUpdate).toLocaleString('en-US', {timeZone: 'America/Los_Angeles', timeZoneName: 'short'})}` : 'This week has not updated yet.'} Unavailable means the source is missing or more than 36 hours old.</p>
      {(metricsRes.error || entriesRes.error) && <p role="alert" className="mb-4 text-sm text-red-700">Scorecard data could not be loaded. Refresh to try again.</p>}
      <ScorecardGrid metrics={metrics} entries={entries} weeks={weeks} currentWeek={currentWeek} />
      <p className="mt-6 text-xs text-charcoal-400">
        Goals are provisional until reviewed · Data: scorecard_metric, scorecard_entry ·
        Auto-fill: weekday mornings · Final update: Friday 22:00 UTC (3 PM PDT / 2 PM PST)
      </p>
    </PageContainer>
  );
}
