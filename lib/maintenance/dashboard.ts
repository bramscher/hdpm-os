/**
 * Maintenance Dashboard — one payload answering "where are we on maintenance?"
 *
 * Axis = AppFolio status (what staff actually change in the system of record),
 * not the HDPM stage. Every open work order lands in exactly ONE bucket so the
 * tiles sum to the open total:
 *   estimate lane   → appfolio_status ∈ {Estimate Requested, Estimated}
 *   waiting pocket  → appfolio_status = Waiting, or a human parked it (stage WAITING_ON)
 *   pipeline        → New → Assigned → Scheduled → Work Completed (→ other)
 *
 * Clocks (see docs/maintenance-os/07 Session A for why these and not others):
 *   age in step      = statusSinceFor(): latest sync_update into the current
 *                      status → appfolio_last_updated_at → appfolio_created_at
 *   typical duration = completed spells over the last 90d of sync_update
 *                      transitions (statusSpells), median + p90, with n
 *   owner-gated      = ONLY an undecided approval row with kind='OWNER'.
 *                      "Estimated" does not mean waiting on the owner.
 *   turns            = unit_turn.lifecycle_status + turn_status_event (20260905)
 *
 * Deliberately NOT computed (no timestamp source exists): request→WO,
 * scheduled_start history, approved→scheduled on the AppFolio-only path,
 * estimate dollar amounts, VERIFY/BILL durations, completed→vendor bill.
 *
 * computeDashboard() is pure; loadDashboardInputs() does the I/O.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import {
  ESCALATE_ACTION,
  ESTIMATE_CHASER_AGENT,
  OWNER_APPROVAL_ACTION,
  VENDOR_CHASE_ACTION,
  VENDOR_CHASE_SMS_ACTION,
} from '@/lib/agents/estimate-chaser';
import { TURN_EXCEPTION_STATES, TURN_STATES } from '@/lib/turn-estimator/turn-lifecycle';
import type { Approval, MaintWorkOrder, TripwireException, TripwireSnapshot, UnitTurn } from './types';
import type { TripwireRunResult } from './tripwire-engine';
import { fetchAllRows, loadTripwireSnapshot, runTripwires } from './tripwire-engine';
import { statusSinceFor } from './tripwires';
import { statusSpells, transitionsFrom, type MetricEventRow, type StatusTransition } from './metrics';
import { medianOf, p90Of } from './vendors';
import { daysBetween } from './business-days';
import { DASHBOARD_THRESHOLDS, isOverThreshold, type ThresholdRule } from './dashboard-thresholds';

const DAY_MS = 24 * 3600_000;
export const DASHBOARD_WINDOW_DAYS = 90;

// ============================================
// Types
// ============================================

/** Where an open WO sits, by AppFolio status. */
export type PipelineStep =
  | 'new'
  | 'assigned'
  | 'scheduled'
  | 'work_completed'
  | 'estimate_requested'
  | 'estimated'
  | 'waiting'
  | 'other';

/** Typical duration of a step: completed spells in the window. */
export interface Hist {
  medianDays: number | null;
  p90Days: number | null;
  n: number;
}

/** What is in a step right now. */
export interface StepStats {
  count: number;
  /** Censored ages — how long the current occupants have been here. */
  medianAgeDays: number | null;
  p90AgeDays: number | null;
  overThresholdCount: number;
  overThresholdIds: string[];
  ids: string[];
}

export interface AttentionItem {
  tripwire: number;
  label: string;
  item: string;
  fixRequired: string;
  owner: string;
  workOrderId?: string;
  ageDays?: number;
}

export interface TurnStateStats {
  state: string;
  count: number;
  medianDaysInState: number | null;
  ids: string[];
  historical: Hist;
}

export interface DashboardData {
  generatedAt: string;
  windowDays: number;
  openTotal: number;
  pipeline: Record<'new' | 'assigned' | 'scheduled' | 'work_completed' | 'other', StepStats & { historical: Hist }>;
  closed: {
    /** WOs closed (not canceled) in the last 7 days. */
    last7: number;
    /** created → completed cycle time over the window. */
    historical: Hist;
    /** Tripwire #8 hits: verified > 5 days with no invoice. */
    unbilledOver5: number;
  };
  estimates: {
    estimate_requested: StepStats & { historical: Hist };
    estimated: StepStats & { historical: Hist };
    /** Time from entering either estimate status to leaving both. */
    laneHistorical: Hist;
    /** Undecided in-app approvals with kind='OWNER' — the only proof of owner-gating. */
    ownerGated: StepStats & { historical: Hist };
    chase: {
      /** Distinct estimate WOs the chaser has chased at least once. */
      chasedCount: number;
      medianChases: number | null;
      escalatedCount: number;
      lastChaseAt: string | null;
    };
  };
  waiting: StepStats & {
    byReason: Record<string, number>;
    /** Of the pocket, how many were parked by a human (stage WAITING_ON) vs AppFolio "Waiting". */
    parkedByStaff: number;
  };
  turns: {
    open: number;
    medianDaysVacant: number | null;
    behindTarget: { count: number; ids: string[] };
    byState: TurnStateStats[];
    /** True when lifecycle_status is unavailable (migration 20260905 not applied) and legacy status is shown. */
    legacyStates: boolean;
  };
  attention: {
    total: number;
    byTripwire: Record<string, number>;
    needsDateCount: number;
    top: AttentionItem[];
  };
}

// ── Input rows ──

export interface ClosedWoRow {
  id: string;
  appfolio_created_at: string | null;
  created_at: string;
  completed_date: string | null;
  closed_at: string | null;
  canceled_date: string | null;
}

export interface ChaseRow {
  subject_id: string | null;
  action_type: string;
  status: string;
  created_at: string;
}

export interface TurnRow extends UnitTurn {
  lifecycle_status?: string | null;
}

export interface TurnStatusEventRow {
  unit_turn_id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
}

export interface DashboardInputs {
  snapshot: TripwireSnapshot;
  tripwires: TripwireRunResult;
  /** sync_update wo_events inside the window. */
  events: MetricEventRow[];
  closed: ClosedWoRow[];
  decidedApprovals: Pick<Approval, 'kind' | 'requested_at' | 'decided_at'>[];
  chaseRows: ChaseRow[];
  openTurns: TurnRow[];
  turnEvents: TurnStatusEventRow[];
  /** lifecycle_status column unavailable → legacy 3-state fallback. */
  legacyTurnStates?: boolean;
}

// ============================================
// Pure helpers
// ============================================

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();

const AF_STEP: Record<string, PipelineStep> = {
  new: 'new',
  assigned: 'assigned',
  scheduled: 'scheduled',
  'work completed': 'work_completed',
  'estimate requested': 'estimate_requested',
  estimated: 'estimated',
  waiting: 'waiting',
};

/** AppFolio status → pipeline step. Unknown/null → 'other'. */
export function afStep(wo: Pick<MaintWorkOrder, 'appfolio_status'>): PipelineStep {
  return AF_STEP[norm(wo.appfolio_status)] ?? 'other';
}

/**
 * The single bucket a WO belongs to. Estimate statuses win; then anything a
 * human parked (stage WAITING_ON) or AppFolio has as Waiting; else the step.
 */
export function bucketFor(wo: Pick<MaintWorkOrder, 'appfolio_status' | 'stage'>): PipelineStep {
  const step = afStep(wo);
  if (step === 'estimate_requested' || step === 'estimated') return step;
  if (step === 'waiting' || wo.stage === 'WAITING_ON') return 'waiting';
  return step;
}

/** AppFolio status strings that map to a step (for statusSpells). */
const STEP_STATUSES: Record<Exclude<PipelineStep, 'other'>, string[]> = {
  new: ['new'],
  assigned: ['assigned'],
  scheduled: ['scheduled'],
  work_completed: ['work completed'],
  estimate_requested: ['estimate requested'],
  estimated: ['estimated'],
  waiting: ['waiting'],
};

export function hist(values: number[]): Hist {
  return { medianDays: medianOf(values), p90Days: p90Of(values), n: values.length };
}

/** Typical time spent inside a status set, from completed spells in the window. */
export function historicalFor(transitions: StatusTransition[], statuses: string[], now: Date): Hist {
  return hist(statusSpells(transitions, statuses, now).completedDays);
}

/**
 * Current occupants of a step: count, censored age median/p90, and which ids
 * are over the rule. `since` says when each WO entered the step.
 */
export function stepStats<T extends { id: string; scheduled_start?: string | null }>(
  rows: T[],
  since: (row: T) => Date,
  now: Date,
  rule: ThresholdRule | null
): StepStats {
  const ages: number[] = [];
  const overThresholdIds: string[] = [];
  for (const row of rows) {
    const entered = since(row);
    ages.push(daysBetween(entered, now));
    if (rule && isOverThreshold(rule, entered, now, { scheduled_start: row.scheduled_start })) {
      overThresholdIds.push(row.id);
    }
  }
  return {
    count: rows.length,
    medianAgeDays: medianOf(ages),
    p90AgeDays: p90Of(ages),
    overThresholdCount: overThresholdIds.length,
    overThresholdIds,
    ids: rows.map((r) => r.id),
  };
}

const EMPTY_STATS: StepStats = {
  count: 0,
  medianAgeDays: null,
  p90AgeDays: null,
  overThresholdCount: 0,
  overThresholdIds: [],
  ids: [],
};

/**
 * A closed WO that counts as real completed work: AppFolio recorded a
 * CompletedOn and it was not canceled. Rows closed without a completion date
 * are hygiene closes (verified 2026-09-04: 828 of 2,213 closed-in-90d rows,
 * mostly 2014–2018 tickets bulk-closed) and would put a 10-year p90 on the tile.
 */
export function isRealCompletion(row: ClosedWoRow): boolean {
  return !row.canceled_date && !!row.completed_date;
}

/** created → completed cycle time, calendar days, real completions only. */
export function cycleTimeHistorical(closed: ClosedWoRow[]): Hist {
  const days: number[] = [];
  for (const row of closed) {
    if (!isRealCompletion(row)) continue;
    const end = row.completed_date!;
    const start = row.appfolio_created_at ?? row.created_at;
    const d = (new Date(end).getTime() - new Date(start).getTime()) / DAY_MS;
    if (Number.isFinite(d) && d >= 0) days.push(d);
  }
  return hist(days);
}

const CHASE_ACTIONS = new Set([VENDOR_CHASE_ACTION, VENDOR_CHASE_SMS_ACTION, OWNER_APPROVAL_ACTION]);

/** Chase history from agent_proposal rows (expired rows never counted). */
export function chaseStats(rows: ChaseRow[]): DashboardData['estimates']['chase'] {
  const chasesByWo = new Map<string, number>();
  const escalated = new Set<string>();
  let lastChaseAt: string | null = null;
  for (const r of rows) {
    if (!r.subject_id || r.status === 'expired') continue;
    if (CHASE_ACTIONS.has(r.action_type)) {
      chasesByWo.set(r.subject_id, (chasesByWo.get(r.subject_id) ?? 0) + 1);
      if (!lastChaseAt || r.created_at > lastChaseAt) lastChaseAt = r.created_at;
    } else if (r.action_type === ESCALATE_ACTION) {
      escalated.add(r.subject_id);
    }
  }
  return {
    chasedCount: chasesByWo.size,
    medianChases: medianOf([...chasesByWo.values()]),
    escalatedCount: escalated.size,
    lastChaseAt,
  };
}

export function estimateLane(
  openWos: MaintWorkOrder[],
  snapshot: TripwireSnapshot,
  decidedApprovals: DashboardInputs['decidedApprovals'],
  chaseRows: ChaseRow[],
  transitions: StatusTransition[],
  now: Date
): DashboardData['estimates'] {
  const since = (wo: MaintWorkOrder) => statusSinceFor(wo, snapshot);
  const requested = openWos.filter((wo) => bucketFor(wo) === 'estimate_requested');
  const estimated = openWos.filter((wo) => bucketFor(wo) === 'estimated');

  // Owner-gated = undecided OWNER approval on an open WO. Nothing else counts.
  const openIds = new Set(openWos.map((wo) => wo.id));
  const ownerApprovals = snapshot.approvals.filter(
    (a) => a.kind === 'OWNER' && !a.decided_at && openIds.has(a.work_order_id)
  );
  // One WO may carry several requests; the oldest undecided one is the clock.
  const oldestByWo = new Map<string, Approval>();
  for (const a of ownerApprovals) {
    const prev = oldestByWo.get(a.work_order_id);
    if (!prev || a.requested_at < prev.requested_at) oldestByWo.set(a.work_order_id, a);
  }
  const gatedRows = [...oldestByWo.values()].map((a) => ({ id: a.work_order_id, requested_at: a.requested_at }));
  const ownerGated = stepStats(gatedRows, (r) => new Date(r.requested_at), now, DASHBOARD_THRESHOLDS.owner_approval);
  const decidedDays = decidedApprovals
    .filter((a) => a.kind === 'OWNER' && a.decided_at)
    .map((a) => (new Date(a.decided_at!).getTime() - new Date(a.requested_at).getTime()) / DAY_MS)
    .filter((d) => Number.isFinite(d) && d >= 0);

  return {
    estimate_requested: {
      ...stepStats(requested, since, now, DASHBOARD_THRESHOLDS.estimate_requested),
      historical: historicalFor(transitions, STEP_STATUSES.estimate_requested, now),
    },
    estimated: {
      ...stepStats(estimated, since, now, DASHBOARD_THRESHOLDS.estimated),
      historical: historicalFor(transitions, STEP_STATUSES.estimated, now),
    },
    laneHistorical: historicalFor(
      transitions,
      [...STEP_STATUSES.estimate_requested, ...STEP_STATUSES.estimated],
      now
    ),
    ownerGated: { ...ownerGated, historical: hist(decidedDays) },
    chase: chaseStats(chaseRows),
  };
}

export function waitingPocket(
  openWos: MaintWorkOrder[],
  snapshot: TripwireSnapshot,
  now: Date
): DashboardData['waiting'] {
  const rows = openWos.filter((wo) => bucketFor(wo) === 'waiting');
  const byReason: Record<string, number> = {};
  let parkedByStaff = 0;
  for (const wo of rows) {
    const key = wo.waiting_reason ?? 'UNSPECIFIED';
    byReason[key] = (byReason[key] ?? 0) + 1;
    if (afStep(wo) !== 'waiting') parkedByStaff++;
  }
  return {
    ...stepStats(rows, (wo) => statusSinceFor(wo, snapshot), now, DASHBOARD_THRESHOLDS.waiting),
    byReason,
    parkedByStaff,
  };
}

const TURN_ORDER: readonly string[] = [...TURN_STATES, ...TURN_EXCEPTION_STATES];
const TURN_READY_INDEX = TURN_STATES.indexOf('TURN_READY');

/** State label for a turn: lifecycle_status when present, else the legacy status upper-cased. */
export function turnState(turn: TurnRow): string {
  return turn.lifecycle_status || turn.status.toUpperCase();
}

/** A turn is "not yet ready" if its state precedes TURN_READY (or is a hold / legacy active). */
export function turnNotReady(state: string): boolean {
  const i = TURN_STATES.indexOf(state as (typeof TURN_STATES)[number]);
  if (i >= 0) return i < TURN_READY_INDEX;
  if ((TURN_EXCEPTION_STATES as readonly string[]).includes(state)) return state !== 'CANCELLED';
  return state === 'ACTIVE';
}

export function turnsLane(
  turns: TurnRow[],
  turnEvents: TurnStatusEventRow[],
  now: Date,
  legacyStates = false
): DashboardData['turns'] {
  // Latest event entering each turn's CURRENT state = when it got there.
  const enteredAt = new Map<string, string>();
  const stateById = new Map(turns.map((t) => [t.id, turnState(t)]));
  for (const e of turnEvents) {
    if (e.to_status !== stateById.get(e.unit_turn_id)) continue;
    const prev = enteredAt.get(e.unit_turn_id);
    if (!prev || e.created_at > prev) enteredAt.set(e.unit_turn_id, e.created_at);
  }
  const since = (t: TurnRow) => new Date(enteredAt.get(t.id) ?? t.vacated_at);

  const transitions: StatusTransition[] = turnEvents
    .map((e) => ({ work_order_id: e.unit_turn_id, from: e.from_status, to: e.to_status, at: e.created_at }))
    .sort((a, b) => a.at.localeCompare(b.at));

  const byStateMap = new Map<string, TurnRow[]>();
  for (const t of turns) {
    const s = turnState(t);
    byStateMap.set(s, [...(byStateMap.get(s) ?? []), t]);
  }
  const byState: TurnStateStats[] = [...byStateMap.entries()]
    .sort(([a], [b]) => {
      const ia = TURN_ORDER.indexOf(a);
      const ib = TURN_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    })
    .map(([state, rows]) => ({
      state,
      count: rows.length,
      medianDaysInState: medianOf(rows.map((t) => daysBetween(since(t), now))),
      ids: rows.map((t) => t.id),
      historical: historicalFor(transitions, [state], now),
    }));

  const behind = turns.filter(
    (t) =>
      turnNotReady(turnState(t)) &&
      isOverThreshold(DASHBOARD_THRESHOLDS.turn, since(t), now, { target_ready: t.target_ready })
  );
  const notReady = turns.filter((t) => turnNotReady(turnState(t)));

  return {
    open: turns.length,
    medianDaysVacant: medianOf(notReady.map((t) => daysBetween(new Date(t.vacated_at), now))),
    behindTarget: { count: behind.length, ids: behind.map((t) => t.id) },
    byState,
    legacyStates,
  };
}

export function attention(result: TripwireRunResult, topN = 8): DashboardData['attention'] {
  const byTripwire: Record<string, number> = {};
  for (const ex of result.exceptions) {
    byTripwire[ex.label] = (byTripwire[ex.label] ?? 0) + 1;
  }
  const top = [...result.exceptions]
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1))
    .slice(0, topN)
    .map(toAttentionItem);
  return {
    total: result.exceptions.length,
    byTripwire,
    needsDateCount: result.needsDateCount,
    top,
  };
}

function toAttentionItem(ex: TripwireException): AttentionItem {
  return {
    tripwire: ex.tripwire,
    label: ex.label,
    item: ex.item,
    fixRequired: ex.fixRequired,
    owner: ex.owner,
    workOrderId: ex.workOrderId,
    ageDays: ex.ageDays,
  };
}

// ============================================
// The whole thing
// ============================================

export function computeDashboard(inputs: DashboardInputs, now = new Date()): DashboardData {
  const { snapshot, tripwires } = inputs;
  const open = snapshot.openWorkOrders;
  const transitions = transitionsFrom(inputs.events);
  const since = (wo: MaintWorkOrder) => statusSinceFor(wo, snapshot);

  const stepFor = (step: 'new' | 'assigned' | 'scheduled' | 'work_completed' | 'other') => {
    const rows = open.filter((wo) => bucketFor(wo) === step);
    const rule: ThresholdRule | null =
      step === 'new'
        ? DASHBOARD_THRESHOLDS.new
        : step === 'assigned'
          ? DASHBOARD_THRESHOLDS.assigned
          : step === 'scheduled'
            ? DASHBOARD_THRESHOLDS.scheduled
            : step === 'work_completed'
              ? DASHBOARD_THRESHOLDS.work_completed
              : null;
    return {
      ...stepStats(rows, since, now, rule),
      historical: step === 'other' ? hist([]) : historicalFor(transitions, STEP_STATUSES[step], now),
    };
  };

  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const closedLast7 = inputs.closed.filter(
    (r) => isRealCompletion(r) && (r.closed_at ?? r.completed_date!) >= weekAgo
  ).length;

  return {
    generatedAt: now.toISOString(),
    windowDays: DASHBOARD_WINDOW_DAYS,
    openTotal: open.length,
    pipeline: {
      new: stepFor('new'),
      assigned: stepFor('assigned'),
      scheduled: stepFor('scheduled'),
      work_completed: stepFor('work_completed'),
      other: stepFor('other'),
    },
    closed: {
      last7: closedLast7,
      historical: cycleTimeHistorical(inputs.closed),
      unbilledOver5: tripwires.exceptions.filter((e) => e.tripwire === 8).length,
    },
    estimates: estimateLane(open, snapshot, inputs.decidedApprovals, inputs.chaseRows, transitions, now),
    waiting: waitingPocket(open, snapshot, now),
    turns: turnsLane(inputs.openTurns, inputs.turnEvents, now, inputs.legacyTurnStates ?? false),
    attention: attention(tripwires),
  };
}

/** Compact daily row for metrics_snapshot — counts only (ages are point-in-time). */
export function dashboardMetric(data: DashboardData): { metric: string; value: Record<string, unknown> } {
  const counts = (s: StepStats) => ({ count: s.count, over: s.overThresholdCount });
  return {
    metric: 'dashboard_pipeline',
    value: {
      openTotal: data.openTotal,
      windowDays: data.windowDays,
      pipeline: Object.fromEntries(Object.entries(data.pipeline).map(([k, v]) => [k, counts(v)])),
      estimates: {
        estimate_requested: counts(data.estimates.estimate_requested),
        estimated: counts(data.estimates.estimated),
        ownerGated: counts(data.estimates.ownerGated),
      },
      waiting: counts(data.waiting),
      closedLast7: data.closed.last7,
      turns: {
        open: data.turns.open,
        behindTarget: data.turns.behindTarget.count,
        byState: Object.fromEntries(data.turns.byState.map((s) => [s.state, s.count])),
      },
      attentionTotal: data.attention.total,
      needsDateCount: data.attention.needsDateCount,
    },
  };
}

// ============================================
// Loader
// ============================================

export async function loadDashboardInputs(now = new Date()): Promise<DashboardInputs> {
  const supabase = getSupabaseAdmin();
  const since = new Date(now.getTime() - DASHBOARD_WINDOW_DAYS * DAY_MS).toISOString();

  const snapshot = await loadTripwireSnapshot();
  const tripwires = runTripwires(snapshot);

  // Estimate WOs + owner-gated WOs are the chaser's subjects.
  const estimateWoIds = new Set<string>();
  for (const wo of snapshot.openWorkOrders) {
    const step = afStep(wo);
    if (step === 'estimate_requested' || step === 'estimated') estimateWoIds.add(wo.id);
  }
  for (const a of snapshot.approvals) if (a.kind === 'OWNER') estimateWoIds.add(a.work_order_id);

  const [events, closed, decidedApprovals, chaseRows, turnsResult, turnEvents] = await Promise.all([
    fetchAllRows(
      () =>
        supabase
          .from('wo_event')
          .select('work_order_id, event_type, actor, payload, created_at')
          .eq('event_type', 'sync_update')
          .gte('created_at', since),
      'wo_event (dashboard)'
    ) as Promise<MetricEventRow[]>,
    fetchAllRows(
      () =>
        supabase
          .from('work_orders')
          .select('id, appfolio_created_at, created_at, completed_date, closed_at, canceled_date')
          .eq('stage', 'CLOSED')
          .gte('closed_at', since),
      'work_orders (closed)'
    ) as Promise<ClosedWoRow[]>,
    fetchAllRows(
      () =>
        supabase
          .from('approval')
          .select('kind, requested_at, decided_at')
          .not('decided_at', 'is', null)
          .gte('decided_at', since),
      'approval (decided)'
    ) as Promise<DashboardInputs['decidedApprovals']>,
    loadChaseRows(supabase, [...estimateWoIds]),
    loadOpenTurns(supabase),
    loadTurnEvents(supabase, since),
  ]);

  return {
    snapshot,
    tripwires,
    events,
    closed,
    decidedApprovals,
    chaseRows,
    openTurns: turnsResult.turns,
    turnEvents,
    legacyTurnStates: turnsResult.legacy,
  };
}

type Admin = ReturnType<typeof getSupabaseAdmin>;

async function loadChaseRows(supabase: Admin, woIds: string[]): Promise<ChaseRow[]> {
  const rows: ChaseRow[] = [];
  for (let i = 0; i < woIds.length; i += 200) {
    const { data, error } = await supabase
      .from('agent_proposal')
      .select('subject_id, action_type, status, created_at')
      .eq('agent', ESTIMATE_CHASER_AGENT)
      .in('subject_id', woIds.slice(i, i + 200));
    if (error) throw new Error(`agent_proposal load failed: ${error.message}`);
    rows.push(...((data ?? []) as ChaseRow[]));
  }
  return rows;
}

/**
 * Open turns by lifecycle_status. If migration 20260905 has not been applied
 * the column does not exist — fall back to the legacy 3-state status so the
 * dashboard still renders (flagged via `legacy`).
 */
async function loadOpenTurns(supabase: Admin): Promise<{ turns: TurnRow[]; legacy: boolean }> {
  const lifecycle = await supabase
    .from('unit_turn')
    .select('*')
    .not('lifecycle_status', 'in', '("CLOSED","CANCELLED")');
  if (!lifecycle.error) return { turns: (lifecycle.data ?? []) as TurnRow[], legacy: false };

  const legacy = await supabase.from('unit_turn').select('*').neq('status', 'closed');
  if (legacy.error) throw new Error(`unit_turn load failed: ${legacy.error.message}`);
  return { turns: (legacy.data ?? []) as TurnRow[], legacy: true };
}

async function loadTurnEvents(supabase: Admin, since: string): Promise<TurnStatusEventRow[]> {
  const { data, error } = await supabase
    .from('turn_status_event')
    .select('unit_turn_id, from_status, to_status, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  // Table absent until 20260905 is applied → no per-state clocks, not a failure.
  if (error) return [];
  return (data ?? []) as TurnStatusEventRow[];
}
