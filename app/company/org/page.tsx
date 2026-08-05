import { getSupabaseAdmin } from '@/lib/supabase';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { buildSeatTree } from '@/lib/eos/org';
import { currentQuarter } from '@/lib/eos/rock';
import OrgChart from '@/components/eos/OrgChart';
import type { Rock, ScorecardMetric, Seat } from '@/lib/eos/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'HDPM-OS — Org',
};

/**
 * Company → Org (Phase 2, Brief 2E): the read-only accountability chart.
 * Each seat: roles, the metrics its person owns, its active-quarter
 * Rocks, and the agents attached to the seat (doc 06 §3 — agents under
 * seats, never as seats).
 */
export default async function OrgPage() {
  const supabase = getSupabaseAdmin();
  const quarter = currentQuarter(new Date());

  const [seatsRes, metricsRes, rocksRes] = await Promise.all([
    supabase.from('seat').select('*').eq('org_id', 'hdpm').eq('active', true).order('sort'),
    supabase.from('scorecard_metric').select('*').eq('org_id', 'hdpm').eq('active', true).order('sort'),
    supabase
      .from('rock')
      .select('*')
      .eq('org_id', 'hdpm')
      .eq('quarter', quarter)
      .in('status', ['on', 'off']),
  ]);

  const seats = (seatsRes.data ?? []) as Seat[];
  const tree = buildSeatTree(seats);

  const metricsByPerson = new Map<string, ScorecardMetric[]>();
  for (const m of (metricsRes.data ?? []) as ScorecardMetric[]) {
    if (!m.owner_person) continue;
    if (!metricsByPerson.has(m.owner_person)) metricsByPerson.set(m.owner_person, []);
    metricsByPerson.get(m.owner_person)!.push(m);
  }
  const rocksByPerson = new Map<string, Rock[]>();
  for (const r of (rocksRes.data ?? []) as Rock[]) {
    if (!r.owner_person) continue;
    if (!rocksByPerson.has(r.owner_person)) rocksByPerson.set(r.owner_person, []);
    rocksByPerson.get(r.owner_person)!.push(r);
  }

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Accountability chart"
        description={`Who owns what: each seat's roles, metrics, ${quarter} Rocks, and the agents working for it. Read-only — seats change in quarterly conversations, not here.`}
      />
      <OrgChart tree={tree} metricsByPerson={metricsByPerson} rocksByPerson={rocksByPerson} />
      <p className="mt-6 text-xs text-charcoal-400">
        Data: seat, scorecard_metric, rock · Seat occupancy and the agent attachments are
        provisional pending review · Agents appear under seats, never as seats
      </p>
    </PageContainer>
  );
}
