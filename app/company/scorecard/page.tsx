import { getSupabaseAdmin } from '@/lib/supabase';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { isFreshScorecardSource, weekStartPacific, scorecardWeeks } from '@/lib/eos/scorecard';
import { invoiceWeekQuality } from '@/lib/eos/invoice-hour-quality';
import type { HdmsInvoice } from '@/lib/invoices';
import ScorecardGrid from '@/components/eos/ScorecardGrid';
import type { ScorecardMetric, ScorecardEntry } from '@/lib/eos/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'HDPM-OS — Scorecard',
};



/**
 * Company → Scorecard (Phase 2, Brief 2B). Weekly grid, red/green vs goal,
 * manual entry for manual metrics, [Drop to Issues]. Auto rows fill Friday
 * 3 PM via /api/eos/cron/scorecard.
 */
export default async function ScorecardPage() {
  const supabase = getSupabaseAdmin();
  const currentWeek = weekStartPacific(new Date());
  const weeks = scorecardWeeks(currentWeek);

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
      .order('week_start')
      .limit(10000),
  ]);

  const metrics = (metricsRes.data ?? []) as ScorecardMetric[];
  const storedEntries = (entriesRes.data ?? []) as ScorecardEntry[];
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles',weekday:'short'}).format(now);
  const entries = storedEntries.map(e => e.week_start === currentWeek && e.source === 'auto' && !['Sat','Sun'].includes(weekday) && !isFreshScorecardSource(e.source_captured_at, now) ? {...e,value:null,on_track:null} : e);

  const invoiceRows: HdmsInvoice[] = [];
  let hoursError = false;
  for (let offset=0;;offset+=1000) {
    const {data,error} = await supabase.from('hdms_invoices').select('status,doc_type,line_items,completed_date,created_at,labor_amount').order('id').range(offset,offset+999);
    if(error) { hoursError=true; break; }
    invoiceRows.push(...(data || []) as HdmsInvoice[]);
    if((data || []).length<1000)break;
  }
  const incompleteHours = Object.fromEntries(weeks.map(week => [week, hoursError ? ['Alberto','Brody'] : [...invoiceWeekQuality(invoiceRows,week).incomplete]]));

  const latestUpdate = entries.filter(e => e.week_start === currentWeek && e.source === 'auto' && e.updated_at).map(e => e.updated_at!).sort().at(-1);
  return (
    <PageContainer>
      <PageHeader
        title="Scorecard"
        description="Current-week numbers refresh each weekday morning and finalize Friday afternoon. Invoice hours reconcile with later billing; other historical weeks stay fixed. Two weeks off-track files an issue at the Friday review."
      />
      <p className="mb-4 text-sm text-charcoal-500">{latestUpdate ? `Updated ${new Date(latestUpdate).toLocaleString('en-US', {timeZone: 'America/Los_Angeles', timeZoneName: 'short'})}` : 'This week has not updated yet.'} Unavailable means the source is missing or more than 36 hours old. Scroll left for history back to June 2026. A dash means no recorded value is available.</p>
      {(metricsRes.error || entriesRes.error) && <p role="alert" className="mb-4 text-sm text-red-700">Scorecard data could not be loaded. Refresh to try again.</p>}
      <p className="mb-4 text-sm text-charcoal-500">Invoice hours use completed-date billing records, including drafts. An asterisk marks a partial total: some labor lacks technician names or hours. Older service quantities may also need review. Operational snapshot history begins July 19, 2026; door-growth tracking begins September 9, 2026. Earlier missing values are left blank.</p>
      <ScorecardGrid metrics={metrics} entries={entries} weeks={weeks} currentWeek={currentWeek} incompleteHours={incompleteHours} />
      <p className="mt-6 text-xs text-charcoal-400">
        Goals are provisional until reviewed · Data: scorecard_metric, scorecard_entry ·
        Auto-fill: weekday mornings · Final update: Friday 22:00 UTC (3 PM PDT / 2 PM PST)
      </p>
    </PageContainer>
  );
}
