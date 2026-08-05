import { getSupabaseAdmin } from '@/lib/supabase';
import { weekStartPacific, weeksBefore } from '@/lib/eos/scorecard';
import { todayPacific, parseSourceRef, rolledDueOn } from '@/lib/eos/escalation';
import IssuesBoard, { type EvidenceMap } from '@/components/eos/IssuesBoard';
import type { Issue, Todo, ScorecardMetric, ScorecardEntry } from '@/lib/eos/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'HDPM-OS — Issues & To-Dos',
};

/**
 * Company → Issues & To-Dos (Phase 2, Brief 2C). Priority-ordered IDS
 * queue with an evidence side-panel driven by source_ref, plus the 7-day
 * to-do list. Auto-filed rows arrive from the escalation cron
 * (/api/eos/cron/escalation) and the Friday scorecard pass.
 */
export default async function IssuesPage() {
  const supabase = getSupabaseAdmin();
  const today = todayPacific(new Date());
  const horizon = rolledDueOn(today); // today + 7
  const missedSince = weeksBefore(weekStartPacific(new Date()), 2);

  const [issuesRes, todosRes, missedRes, staffRes] = await Promise.all([
    supabase
      .from('issue')
      .select('*')
      .eq('org_id', 'hdpm')
      .in('status', ['open', 'discussed', 'parked'])
      .order('priority')
      .order('created_at'),
    supabase
      .from('todo')
      .select('*')
      .eq('org_id', 'hdpm')
      .eq('status', 'open')
      .lte('due_on', horizon)
      .order('due_on'),
    supabase
      .from('todo')
      .select('*')
      .eq('org_id', 'hdpm')
      .eq('status', 'missed')
      .gte('due_on', missedSince)
      .order('due_on', { ascending: false }),
    supabase.from('staff').select('person').eq('active', true).order('person'),
  ]);

  const issues = (issuesRes.data ?? []) as Issue[];
  const todos = (todosRes.data ?? []) as Todo[];
  const missedTodos = (missedRes.data ?? []) as Todo[];
  const staff = (staffRes.data ?? []).map((s) => s.person as string);

  // ── Evidence prefetch by source_ref kind ──────────────────────────────
  const refs = issues.map((i) => parseSourceRef(i.source_ref));
  const metricIds = [...new Set(refs.filter((r) => r.kind === 'scorecard_metric').map((r) => (r as { id: string }).id))];
  const woIds = [
    ...new Set(
      refs
        .filter((r) => r.kind === 'wo_tripwire' || r.kind === 'wo_escalation')
        .map((r) => (r as { id: string }).id)
    ),
  ];
  const todoRootIds = [...new Set(refs.filter((r) => r.kind === 'todo').map((r) => (r as { id: string }).id))];

  const currentWeek = weekStartPacific(new Date());
  const [metricsRes, entriesRes, wosRes, todoChainRes, todoCopiesRes] = await Promise.all([
    metricIds.length
      ? supabase.from('scorecard_metric').select('*').in('id', metricIds)
      : Promise.resolve({ data: [] }),
    metricIds.length
      ? supabase
          .from('scorecard_entry')
          .select('*')
          .in('metric_id', metricIds)
          .gte('week_start', weeksBefore(currentWeek, 3))
          .order('week_start', { ascending: false })
      : Promise.resolve({ data: [] }),
    woIds.length
      ? supabase
          .from('work_orders')
          .select('id, wo_number, property_name, unit_name, stage, vendor_name, appfolio_link')
          .in('id', woIds)
      : Promise.resolve({ data: [] }),
    todoRootIds.length
      ? supabase.from('todo').select('*').in('id', todoRootIds)
      : Promise.resolve({ data: [] }),
    todoRootIds.length
      ? supabase.from('todo').select('*').in('source_id', todoRootIds)
      : Promise.resolve({ data: [] }),
  ]);

  const evidence: EvidenceMap = { metrics: {}, workOrders: {}, todoChains: {} };
  for (const m of (metricsRes.data ?? []) as ScorecardMetric[]) {
    evidence.metrics[m.id] = { metric: m, entries: [] };
  }
  for (const e of (entriesRes.data ?? []) as ScorecardEntry[]) {
    evidence.metrics[e.metric_id]?.entries.push(e);
  }
  for (const w of wosRes.data ?? []) {
    evidence.workOrders[(w as { id: string }).id] = w as EvidenceMap['workOrders'][string];
  }
  for (const rootId of todoRootIds) {
    const chain = [
      ...((todoChainRes.data ?? []) as Todo[]).filter((t) => t.id === rootId),
      ...((todoCopiesRes.data ?? []) as Todo[]).filter((t) => t.source_id === rootId),
    ];
    if (chain.length) evidence.todoChains[rootId] = chain;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Issues & To-Dos</h1>
      <p className="mb-6 text-sm text-gray-500">
        The IDS queue, priority-ordered. Aged tripwires, agent escalations, off-track metrics and
        twice-missed to-dos file themselves; anything else goes in with + Issue. Solving happens
        with the humans in the room.
      </p>
      <IssuesBoard
        issues={issues}
        todos={todos}
        missedTodos={missedTodos}
        staff={staff}
        evidence={evidence}
        today={today}
      />
      <p className="mt-6 text-xs text-gray-400">
        Data: issue, todo · Escalation cron: weekdays ~7:15 AM PT · Missed to-dos roll once, then
        land here as issues
      </p>
    </div>
  );
}
