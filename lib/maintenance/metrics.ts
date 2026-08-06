/**
 * Agent-OS Phase 0 (Brief A) — daily metrics for metrics_snapshot.
 *
 * Every metric is a pure function over plain rows so it unit-tests without a
 * database (pattern: tripwires.ts); computeAllMetrics() does the loading and
 * returns one row per metric for the cron route to insert. The KPI targets
 * these feed live in docs/agent-os/00-DRAFT-master-plan.md Part 5.
 *
 * Data caveats encoded here rather than discovered later:
 * - Exceptions are computed live (no table) — the tripwire engine is the source.
 * - Status-clock metrics (estimate latency, days-to-schedule) only see
 *   transitions recorded since sync_update events began; early snapshots
 *   are thin and each value carries its sample size.
 * - Estimate dollar amounts do not exist in any reachable API (Session A),
 *   so all estimate metrics are counts/ages, never dollars.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import type { MaintWorkOrder, UnitTurn, VendorAssignment } from './types';
import type { TripwireRunResult } from './tripwire-engine';
import { fetchAllRows, loadTripwireSnapshot, runTripwires } from './tripwire-engine';
import { medianOf } from './vendors';
import { proposalCounts } from './triage-batch';
import { weeklyBillableHours, WEEKLY_HOURS_TARGET, TECHNICIANS } from '@/lib/invoices';

export interface MetricRow {
  metric: string;
  value: Record<string, unknown>;
}

/** Minimal wo_event row the metrics need. */
export interface MetricEventRow {
  work_order_id: string | null;
  event_type: string;
  actor: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const DAY_MS = 24 * 3600_000;

// ============================================
// Open exceptions (KPI: 205 → <60)
// ============================================

export function exceptionsMetric(result: TripwireRunResult): MetricRow {
  const byTripwire: Record<string, number> = {};
  for (const ex of result.exceptions) {
    const key = String(ex.tripwire);
    byTripwire[key] = (byTripwire[key] ?? 0) + 1;
  }
  return {
    metric: 'open_exceptions',
    value: {
      total: result.exceptions.length,
      byTripwire,
      needsDateCount: result.needsDateCount,
      ruleErrors: result.ruleErrors.length,
    },
  };
}

// ============================================
// Staff actions/week (KPI: ~0 → >50)
// ============================================

/**
 * A human action = a wo_event written by a person. System actors are
 * 'system:*' (sync, tripwires); 'sync_update'/'exception' rows are machine
 * observations even if an actor label ever slips.
 */
export function isHumanAction(e: Pick<MetricEventRow, 'actor' | 'event_type'>): boolean {
  if (e.actor.startsWith('system:')) return false;
  return e.event_type !== 'sync_update' && e.event_type !== 'exception';
}

export function staffActionsMetric(events: MetricEventRow[], now: Date): MetricRow {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const fourWeeksAgo = new Date(now.getTime() - 28 * DAY_MS).toISOString();
  const human = events.filter(isHumanAction);

  const last7 = human.filter((e) => e.created_at >= weekAgo);
  const byActor7: Record<string, number> = {};
  for (const e of last7) {
    byActor7[e.actor] = (byActor7[e.actor] ?? 0) + 1;
  }

  return {
    metric: 'staff_actions',
    value: {
      last7Days: last7.length,
      last28Days: human.filter((e) => e.created_at >= fourWeeksAgo).length,
      byActor7Days: byActor7,
    },
  };
}

/**
 * The Sep 4 write-path trigger: human actions in HDPM-OS that imply an
 * AppFolio-side change someone must re-type by hand (status changes and
 * owner/tech/vendor assignments — next-action dates and notes are HDPM-OS
 * concepts with no AppFolio field). Threshold per the master plan: ≥40/week
 * and the Write API pays for itself in retyping labor.
 */
export function retypeTouchesMetric(events: MetricEventRow[], now: Date): MetricRow {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const fourWeeksAgo = new Date(now.getTime() - 28 * DAY_MS).toISOString();
  const touches = events.filter(
    (e) =>
      (e.event_type === 'stage_change' || e.event_type === 'assign') &&
      !e.actor.startsWith('system:')
  );
  return {
    metric: 'appfolio_retype_touches',
    value: {
      last7Days: touches.filter((e) => e.created_at >= weekAgo).length,
      last28Days: touches.filter((e) => e.created_at >= fourWeeksAgo).length,
      weeklyTarget: 40,
    },
  };
}

// ============================================
// Status clocks (Session A pattern): estimate latency + days-to-schedule
// ============================================

export interface StatusTransition {
  work_order_id: string;
  from: string | null;
  to: string;
  at: string;
}

/** Extract appfolio_status transitions from sync_update events. */
export function transitionsFrom(events: MetricEventRow[]): StatusTransition[] {
  const out: StatusTransition[] = [];
  for (const e of events) {
    if (e.event_type !== 'sync_update' || !e.work_order_id) continue;
    const p = e.payload ?? {};
    if (p.field !== 'appfolio_status' || typeof p.to !== 'string') continue;
    out.push({
      work_order_id: e.work_order_id,
      from: typeof p.from === 'string' ? p.from : null,
      to: p.to,
      at: e.created_at,
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();

/**
 * Spells spent inside a status set, per WO: entering any status in the set
 * starts the clock, leaving to a status outside it stops it. Still inside at
 * `now` → an open spell (censored).
 */
export function statusSpells(
  transitions: StatusTransition[],
  statuses: string[],
  now: Date
): { completedDays: number[]; openAgeDays: number[] } {
  const set = new Set(statuses.map(norm));
  const completedDays: number[] = [];
  const enteredAt = new Map<string, string>();

  for (const t of transitions) {
    const inside = enteredAt.get(t.work_order_id);
    const toInside = set.has(norm(t.to));
    if (!inside && toInside) {
      enteredAt.set(t.work_order_id, t.at);
    } else if (inside && !toInside) {
      completedDays.push((new Date(t.at).getTime() - new Date(inside).getTime()) / DAY_MS);
      enteredAt.delete(t.work_order_id);
    }
  }

  const openAgeDays = Array.from(enteredAt.values()).map(
    (at) => (now.getTime() - new Date(at).getTime()) / DAY_MS
  );
  return { completedDays, openAgeDays };
}

const ESTIMATE_STATUSES = ['estimate requested', 'estimated'];

export function estimateLatencyMetric(transitions: StatusTransition[], now: Date): MetricRow {
  const { completedDays, openAgeDays } = statusSpells(transitions, ESTIMATE_STATUSES, now);
  return {
    metric: 'estimate_approval_latency',
    value: {
      medianDaysToDecision: medianOf(completedDays),
      decidedCount: completedDays.length,
      openCount: openAgeDays.length,
      medianOpenAgeDays: medianOf(openAgeDays),
    },
  };
}

/** Per-WO first entry into `fromStatus` → first later entry into `toStatus`. */
export function pairedDurationsDays(
  transitions: StatusTransition[],
  fromStatus: string,
  toStatus: string
): number[] {
  const firstFrom = new Map<string, string>();
  const durations: number[] = [];
  for (const t of transitions) {
    if (norm(t.to) === norm(fromStatus) && !firstFrom.has(t.work_order_id)) {
      firstFrom.set(t.work_order_id, t.at);
    } else if (norm(t.to) === norm(toStatus)) {
      const start = firstFrom.get(t.work_order_id);
      if (start && t.at >= start) {
        durations.push((new Date(t.at).getTime() - new Date(start).getTime()) / DAY_MS);
        firstFrom.delete(t.work_order_id);
      }
    }
  }
  return durations;
}

export function daysToScheduleMetric(transitions: StatusTransition[]): MetricRow {
  const durations = pairedDurationsDays(transitions, 'assigned', 'scheduled');
  return {
    metric: 'days_to_schedule',
    value: { medianDays: medianOf(durations), n: durations.length },
  };
}

// ============================================
// Time-to-first-action on new WOs (KPI: hours–days → <30 min)
// ============================================

export interface RecentWoRow {
  id: string;
  appfolio_created_at: string | null;
  created_at: string;
}

export function timeToFirstActionMetric(
  wos: RecentWoRow[],
  events: MetricEventRow[],
  now: Date,
  windowDays = 28
): MetricRow {
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS).toISOString();

  const firstHumanAt = new Map<string, string>();
  for (const e of events) {
    if (!e.work_order_id || !isHumanAction(e)) continue;
    const prev = firstHumanAt.get(e.work_order_id);
    if (!prev || e.created_at < prev) firstHumanAt.set(e.work_order_id, e.created_at);
  }

  const hours: number[] = [];
  let noAction = 0;
  let inWindow = 0;
  for (const wo of wos) {
    // AppFolio's CreatedAt, not our row timestamp (catch-up syncs insert old rows fresh)
    const createdAt = wo.appfolio_created_at ?? wo.created_at;
    if (createdAt < windowStart) continue;
    inWindow++;
    const acted = firstHumanAt.get(wo.id);
    if (!acted || acted < createdAt) {
      noAction++;
      continue;
    }
    hours.push((new Date(acted).getTime() - new Date(createdAt).getTime()) / 3600_000);
  }

  return {
    metric: 'time_to_first_action',
    value: {
      medianHours: medianOf(hours),
      actedCount: hours.length,
      noActionCount: noAction,
      newWoCount: inWindow,
      windowDays,
    },
  };
}

// ============================================
// Vendor stuck-pool counts (feeds the Vendor Chaser baseline)
// ============================================

export function vendorMetric(
  assignments: VendorAssignment[],
  openWorkOrders: MaintWorkOrder[],
  now: Date
): MetricRow {
  const openIds = new Set(openWorkOrders.map((wo) => wo.id));

  const acceptedUnworked = assignments.filter(
    (a) => a.accepted_at && !a.completed_at && openIds.has(a.work_order_id)
  );
  const acceptedAges = acceptedUnworked.map(
    (a) => (now.getTime() - new Date(a.accepted_at!).getTime()) / DAY_MS
  );

  const nowIso = now.toISOString();
  const scheduledDatePassed = openWorkOrders.filter(
    (wo) => wo.scheduled_start && wo.scheduled_start < nowIso
  );

  return {
    metric: 'vendor_stuck_pools',
    value: {
      acceptedUnworkedCount: acceptedUnworked.length,
      acceptedUnworkedMedianAgeDays: medianOf(acceptedAges),
      scheduledDatePassedCount: scheduledDatePassed.length,
    },
  };
}

// ============================================
// Turn time (available-data-only until Wave 2)
// ============================================

// 20260724: counts unit-level turns (unit_turn) — the snapshot already
// filters to status='active', so every row is an open vacancy.
export function turnMetric(turns: UnitTurn[], now: Date): MetricRow {
  const daysVacant = turns.map(
    (t) => (now.getTime() - new Date(t.vacated_at).getTime()) / DAY_MS
  );
  return {
    metric: 'turns',
    value: { openTurns: turns.length, medianDaysVacant: medianOf(daysVacant) },
  };
}

// ============================================
// Loader — one call per cron run
// ============================================

export async function computeAllMetrics(
  now = new Date()
): Promise<{ rows: MetricRow[]; errors: Record<string, string> }> {
  const rows: MetricRow[] = [];
  const errors: Record<string, string> = {};

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    errors.supabase = err instanceof Error ? err.message : String(err);
    return { rows, errors };
  }

  // Tripwire snapshot feeds exceptions, vendor pools, and turns.
  try {
    const snapshot = await loadTripwireSnapshot();
    rows.push(exceptionsMetric(runTripwires(snapshot)));
    rows.push(vendorMetric(snapshot.assignments, snapshot.openWorkOrders, now));
    rows.push(turnMetric(snapshot.unitTurns, now));
  } catch (err) {
    errors.snapshot = err instanceof Error ? err.message : String(err);
  }

  // One wo_event read (60d) feeds actions, latency clocks, and first-action.
  try {
    const since60 = new Date(now.getTime() - 60 * DAY_MS).toISOString();
    const events = (await fetchAllRows(
      () =>
        supabase
          .from('wo_event')
          .select('work_order_id, event_type, actor, payload, created_at')
          .gte('created_at', since60),
      'wo_event'
    )) as MetricEventRow[];

    rows.push(staffActionsMetric(events, now));
    rows.push(retypeTouchesMetric(events, now));
    const transitions = transitionsFrom(events);
    rows.push(estimateLatencyMetric(transitions, now));
    rows.push(daysToScheduleMetric(transitions));

    // Over-fetch by row timestamp; the pure function windows on AppFolio's CreatedAt.
    const since45 = new Date(now.getTime() - 45 * DAY_MS).toISOString();
    const recentWos = (await fetchAllRows(
      () =>
        supabase
          .from('work_orders')
          .select('id, appfolio_created_at, created_at')
          .gte('created_at', since45),
      'work_orders (recent)'
    )) as RecentWoRow[];
    rows.push(timeToFirstActionMetric(recentWos, events, now));
  } catch (err) {
    errors.events = err instanceof Error ? err.message : String(err);
  }

  // Triage proposal acceptance (the agent_proposal precursor).
  try {
    const counts = await proposalCounts();
    const decided = counts.applied + counts.skipped;
    rows.push({
      metric: 'triage_acceptance',
      value: { ...counts, rate: decided > 0 ? counts.applied / decided : null },
    });
  } catch (err) {
    errors.triage = err instanceof Error ? err.message : String(err);
  }

  // In-house billable hours from invoice labor lines (target 30–36/wk).
  // 30d created_at over-fetch; the pure function windows on completed_date.
  try {
    const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
    const invoices = (await fetchAllRows(
      () =>
        supabase
          .from('hdms_invoices')
          .select('status, line_items, completed_date, created_at')
          .gte('created_at', since30),
      'hdms_invoices'
    )) as Parameters<typeof weeklyBillableHours>[0];
    const weekly = weeklyBillableHours(invoices, now);
    rows.push({
      metric: 'billable_hours',
      value: {
        ...weekly,
        target: WEEKLY_HOURS_TARGET,
        // Flat per-tech fields — scorecard source_ref only reads one level deep.
        ...Object.fromEntries(
          TECHNICIANS.map((t) => [`${t.toLowerCase()}Hours`, weekly.byTech[t] ?? 0])
        ),
      },
    });
  } catch (err) {
    errors.billableHours = err instanceof Error ? err.message : String(err);
  }

  // Days-to-lease: frozen from the existing kpi_snapshots history (captured
  // daily since April by /api/kpi/cron) rather than recomputed here.
  try {
    const { data, error } = await supabase
      .from('kpi_snapshots')
      .select('value, captured_at')
      .eq('kpi_name', 'days_to_lease')
      .order('captured_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    if (data?.[0]) {
      rows.push({
        metric: 'days_to_lease',
        value: {
          ...(data[0].value as Record<string, unknown>),
          source: 'kpi_snapshots',
          sourceCapturedAt: data[0].captured_at,
        },
      });
    }
  } catch (err) {
    errors.days_to_lease = err instanceof Error ? err.message : String(err);
  }

  return { rows, errors };
}
