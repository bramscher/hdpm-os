import { getSupabaseAdmin } from '@/lib/supabase';
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
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Accountability chart</h1>
      <p className="mb-6 text-sm text-gray-500">
        Who owns what: each seat&rsquo;s roles, metrics, {quarter} Rocks, and the agents working
        for it. Read-only — seats change in quarterly conversations, not here.
      </p>
      <OrgChart tree={tree} metricsByPerson={metricsByPerson} rocksByPerson={rocksByPerson} />
      <p className="mt-6 text-xs text-gray-400">
        Data: seat, scorecard_metric, rock · Seat occupancy and the agent attachments are
        provisional pending review · Agents appear under seats, never as seats
      </p>
    </div>
  );
}
