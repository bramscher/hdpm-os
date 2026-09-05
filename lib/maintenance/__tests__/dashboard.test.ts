import { describe, it, expect } from 'vitest';
import type { Approval, MaintWorkOrder, TripwireSnapshot } from '../types';
import type { TripwireRunResult } from '../tripwire-engine';
import type { MetricEventRow } from '../metrics';
import { transitionsFrom } from '../metrics';
import {
  afStep,
  bucketFor,
  stepStats,
  historicalFor,
  cycleTimeHistorical,
  chaseStats,
  estimateLane,
  waitingPocket,
  turnsLane,
  turnState,
  turnNotReady,
  attention,
  computeDashboard,
  dashboardMetric,
  type ChaseRow,
  type DashboardInputs,
  type TurnRow,
} from '../dashboard';
import { DASHBOARD_THRESHOLDS, isOverThreshold, describeThreshold } from '../dashboard-thresholds';
import { applyWoDrill, applyTurnDrill } from '../dashboard-drill';

// Friday noon UTC — business-day edges matter for the "new" rule.
const NOW = new Date('2026-09-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function wo(overrides: Partial<MaintWorkOrder> & { id: string }): MaintWorkOrder {
  return {
    appfolio_id: overrides.id,
    property_id: 'p1',
    property_name: 'Reindeer Canyon',
    property_address: null,
    unit_id: 'u1',
    unit_name: 'RC 603 - #20',
    wo_number: '4471-1',
    description: 'Leaking faucet',
    category: null,
    priority: 'Normal',
    status: 'open',
    appfolio_status: 'Assigned',
    assigned_to: null,
    vendor_id: null,
    vendor_name: null,
    scheduled_start: null,
    scheduled_end: null,
    completed_date: null,
    canceled_date: null,
    permission_to_enter: false,
    appfolio_link: null,
    appfolio_recurring: false,
    appfolio_created_at: daysAgo(10),
    appfolio_last_updated_at: null,
    unit_turn_category: null,
    af_service_request_id: null,
    synced_at: NOW.toISOString(),
    created_at: daysAgo(10),
    updated_at: NOW.toISOString(),
    stage: 'TRIAGED',
    waiting_reason: null,
    owner_name: 'Cheryl',
    next_action_date: null,
    priority_class: null,
    assigned_tech: null,
    origin: 'appfolio',
    is_turn: false,
    unit_turn_id: null,
    verified_by: null,
    verified_at: null,
    tenant_ping_sent: false,
    tenant_ping_sent_at: null,
    preventive_scheduled: null,
    closed_at: null,
    aging_reason: null,
    ...overrides,
  } as MaintWorkOrder;
}

function snapshotOf(
  openWorkOrders: MaintWorkOrder[],
  extra: Partial<TripwireSnapshot> = {}
): TripwireSnapshot {
  return {
    now: NOW,
    openWorkOrders,
    assignments: [],
    vendors: [],
    approvals: [],
    recommendations: [],
    unitTurns: [],
    invoicedWorkOrderIds: new Set(),
    docsByWorkOrder: new Map(),
    recentFailedAccessWoIds: new Set(),
    statusSince: new Map(),
    ...extra,
  };
}

function statusEvent(woId: string, from: string | null, to: string, at: string): MetricEventRow {
  return {
    work_order_id: woId,
    event_type: 'sync_update',
    actor: 'system:sync',
    payload: { field: 'appfolio_status', from, to },
    created_at: at,
  };
}

function approval(overrides: Partial<Approval> & { work_order_id: string }): Approval {
  return {
    id: `ap-${overrides.work_order_id}`,
    kind: 'OWNER',
    requested_of: 'Owner',
    estimate: null,
    photos: null,
    requested_at: daysAgo(5),
    decided_at: null,
    decision: null,
    approved_amount: null,
    conditions: null,
    created_at: daysAgo(5),
    ...overrides,
  };
}

const emptyRun: TripwireRunResult = {
  exceptions: [],
  ruleErrors: [],
  ranAt: NOW.toISOString(),
  needsDate: [],
  needsDateCount: 0,
};

// ── afStep / bucketFor ──

describe('afStep', () => {
  it('normalises case and whitespace', () => {
    expect(afStep({ appfolio_status: '  Estimate Requested ' })).toBe('estimate_requested');
    expect(afStep({ appfolio_status: 'WORK COMPLETED' })).toBe('work_completed');
  });
  it('unknown or null → other', () => {
    expect(afStep({ appfolio_status: null })).toBe('other');
    expect(afStep({ appfolio_status: 'Weird' })).toBe('other');
  });
});

describe('bucketFor', () => {
  it('estimate statuses win over a WAITING_ON stage', () => {
    expect(bucketFor({ appfolio_status: 'Estimated', stage: 'WAITING_ON' })).toBe('estimated');
  });
  it('a human-parked WO (stage WAITING_ON) joins the waiting pocket', () => {
    expect(bucketFor({ appfolio_status: 'Assigned', stage: 'WAITING_ON' })).toBe('waiting');
  });
  it('otherwise the AppFolio step', () => {
    expect(bucketFor({ appfolio_status: 'Scheduled', stage: 'SCHEDULED' })).toBe('scheduled');
  });
});

// ── thresholds ──

describe('isOverThreshold', () => {
  it('business-day age: Fri→Mon is 1 business day, not over for "new"', () => {
    const monday = new Date('2026-09-07T12:00:00Z');
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.new, NOW, monday)).toBe(false);
    const tuesday = new Date('2026-09-08T12:00:00Z');
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.new, NOW, tuesday)).toBe(true);
  });
  it('calendar age', () => {
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.waiting, new Date(daysAgo(6)), NOW)).toBe(true);
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.waiting, new Date(daysAgo(5)), NOW)).toBe(false);
  });
  it('date_past: yesterday is past, today is not, blank never is', () => {
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.scheduled, NOW, NOW, { scheduled_start: '2026-09-03T09:00:00Z' })).toBe(true);
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.scheduled, NOW, NOW, { scheduled_start: '2026-09-04T09:00:00Z' })).toBe(false);
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.scheduled, NOW, NOW, {})).toBe(false);
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.turn, NOW, NOW, { target_ready: '2026-08-30' })).toBe(true);
  });
  it('tripwire-delegated rules never fire here', () => {
    expect(isOverThreshold(DASHBOARD_THRESHOLDS.completed, new Date(daysAgo(30)), NOW)).toBe(false);
  });
  it('describes itself', () => {
    expect(describeThreshold(DASHBOARD_THRESHOLDS.new)).toContain('1 business day');
    expect(describeThreshold(DASHBOARD_THRESHOLDS.scheduled)).toContain('visit date');
  });
});

// ── stepStats / historicalFor ──

describe('stepStats', () => {
  it('counts, censored median/p90, and over-threshold ids', () => {
    const rows = [
      { id: 'a', enteredDaysAgo: 1 },
      { id: 'b', enteredDaysAgo: 3 },
      { id: 'c', enteredDaysAgo: 12 },
    ];
    const s = stepStats(rows, (r) => new Date(daysAgo(r.enteredDaysAgo)), NOW, DASHBOARD_THRESHOLDS.assigned);
    expect(s.count).toBe(3);
    expect(s.medianAgeDays).toBe(3);
    expect(s.ids).toEqual(['a', 'b', 'c']);
    // 12 calendar days back = 8 business days > 5; 3 calendar days (Tue→Fri) = 3 business days.
    expect(s.overThresholdIds).toEqual(['c']);
    expect(s.overThresholdCount).toBe(1);
  });
  it('empty step', () => {
    const s = stepStats([], () => NOW, NOW, DASHBOARD_THRESHOLDS.new);
    expect(s).toMatchObject({ count: 0, medianAgeDays: null, p90AgeDays: null, overThresholdCount: 0 });
  });
});

describe('historicalFor', () => {
  it('only completed spells count; a WO still inside is censored', () => {
    const transitions = transitionsFrom([
      statusEvent('w1', 'New', 'Assigned', daysAgo(20)),
      statusEvent('w1', 'Assigned', 'Scheduled', daysAgo(16)), // 4d spell
      statusEvent('w2', 'New', 'Assigned', daysAgo(10)),
      statusEvent('w2', 'Assigned', 'Scheduled', daysAgo(8)), // 2d spell
      statusEvent('w3', 'New', 'Assigned', daysAgo(3)), // open
    ]);
    const h = historicalFor(transitions, ['assigned'], NOW);
    expect(h.n).toBe(2);
    expect(h.medianDays).toBe(3);
  });
});

// ── cycleTimeHistorical ──

describe('cycleTimeHistorical', () => {
  it('real completions only: needs completed_date, skips canceled, hygiene closes, and negatives', () => {
    const h = cycleTimeHistorical([
      { id: '1', appfolio_created_at: daysAgo(10), created_at: daysAgo(1), completed_date: daysAgo(4), closed_at: daysAgo(2), canceled_date: null }, // 6
      { id: '2', appfolio_created_at: null, created_at: daysAgo(6), completed_date: daysAgo(2), closed_at: daysAgo(2), canceled_date: null }, // 4 (created_at fallback)
      { id: '3', appfolio_created_at: daysAgo(5), created_at: daysAgo(5), completed_date: daysAgo(1), closed_at: daysAgo(1), canceled_date: daysAgo(1) }, // canceled
      { id: '4', appfolio_created_at: daysAgo(1), created_at: daysAgo(1), completed_date: daysAgo(3), closed_at: null, canceled_date: null }, // negative
      { id: '5', appfolio_created_at: '2015-03-01T00:00:00Z', created_at: daysAgo(1), completed_date: null, closed_at: daysAgo(1), canceled_date: null }, // bulk close, no CompletedOn
    ]);
    expect(h.n).toBe(2);
    expect(h.medianDays).toBe(5);
  });
});

// ── chaseStats ──

describe('chaseStats', () => {
  const rows: ChaseRow[] = [
    { subject_id: 'w1', action_type: 'vendor_chase', status: 'approved', created_at: daysAgo(6) },
    { subject_id: 'w1', action_type: 'vendor_chase_sms', status: 'proposed', created_at: daysAgo(2) },
    { subject_id: 'w1', action_type: 'vendor_chase', status: 'expired', created_at: daysAgo(1) },
    { subject_id: 'w2', action_type: 'owner_approval', status: 'approved', created_at: daysAgo(4) },
    { subject_id: 'w2', action_type: 'escalate', status: 'auto_applied', created_at: daysAgo(1) },
    { subject_id: null, action_type: 'vendor_chase', status: 'approved', created_at: daysAgo(1) },
  ];
  it('counts distinct chased WOs, ignores expired, separates escalations', () => {
    const c = chaseStats(rows);
    expect(c.chasedCount).toBe(2);
    expect(c.medianChases).toBe(1.5);
    expect(c.escalatedCount).toBe(1);
    expect(c.lastChaseAt).toBe(daysAgo(2));
  });
});

// ── estimateLane ──

describe('estimateLane', () => {
  it('owner-gated only on an undecided kind=OWNER approval', () => {
    const open = [
      wo({ id: 'e1', appfolio_status: 'Estimated', stage: 'WAITING_ON', waiting_reason: 'OWNER' }),
      wo({ id: 'e2', appfolio_status: 'Estimated', stage: 'WAITING_ON', waiting_reason: 'OWNER' }),
      wo({ id: 'e3', appfolio_status: 'Estimate Requested', stage: 'WAITING_ON', waiting_reason: 'VENDOR' }),
      wo({ id: 'e4', appfolio_status: 'Assigned' }),
    ];
    const snapshot = snapshotOf(open, {
      approvals: [
        approval({ work_order_id: 'e1', requested_at: daysAgo(8) }),
        approval({ work_order_id: 'e1', requested_at: daysAgo(2) }), // second request — oldest wins
        approval({ work_order_id: 'e4', kind: 'PM' }), // PM, not owner
        approval({ work_order_id: 'gone', requested_at: daysAgo(30) }), // closed WO — ignored
      ],
    });
    const lane = estimateLane(open, snapshot, [], [], [], NOW);
    expect(lane.estimated.count).toBe(2);
    expect(lane.estimate_requested.count).toBe(1);
    expect(lane.ownerGated.ids).toEqual(['e1']);
    expect(lane.ownerGated.medianAgeDays).toBe(8);
    expect(lane.ownerGated.overThresholdCount).toBe(1);
  });
  it('estimate age uses statusSince when present, else appfolio_created_at', () => {
    const open = [
      wo({ id: 'e1', appfolio_status: 'Estimate Requested', appfolio_created_at: daysAgo(10) }),
      wo({ id: 'e2', appfolio_status: 'Estimate Requested', appfolio_created_at: daysAgo(10) }),
    ];
    const snapshot = snapshotOf(open, { statusSince: new Map([['e1', daysAgo(1)]]) });
    const lane = estimateLane(open, snapshot, [], [], [], NOW);
    // e1: 1 day (not over), e2: 10 days (over)
    expect(lane.estimate_requested.overThresholdIds).toEqual(['e2']);
  });
  it('owner approval historical from decided OWNER approvals only', () => {
    const lane = estimateLane([], snapshotOf([]), [
      { kind: 'OWNER', requested_at: daysAgo(10), decided_at: daysAgo(4) },
      { kind: 'PM', requested_at: daysAgo(10), decided_at: daysAgo(9) },
    ], [], [], NOW);
    expect(lane.ownerGated.historical).toEqual({ medianDays: 6, p90Days: 6, n: 1 });
  });
});

// ── waitingPocket ──

describe('waitingPocket', () => {
  it('excludes estimate statuses, groups by reason, counts staff parking', () => {
    const open = [
      wo({ id: 'w1', appfolio_status: 'Waiting', stage: 'WAITING_ON', waiting_reason: 'INTERNAL' }),
      wo({ id: 'w2', appfolio_status: 'Assigned', stage: 'WAITING_ON', waiting_reason: 'TENANT' }),
      wo({ id: 'w3', appfolio_status: 'Estimate Requested', stage: 'WAITING_ON', waiting_reason: 'VENDOR' }),
      wo({ id: 'w4', appfolio_status: 'Waiting', stage: 'WAITING_ON', waiting_reason: null }),
    ];
    const p = waitingPocket(open, snapshotOf(open), NOW);
    expect(p.count).toBe(3);
    expect(p.byReason).toEqual({ INTERNAL: 1, TENANT: 1, UNSPECIFIED: 1 });
    expect(p.parkedByStaff).toBe(1);
  });
});

// ── turnsLane ──

function turn(overrides: Partial<TurnRow> & { id: string }): TurnRow {
  return {
    property_id: 'p1',
    property_name: 'Reindeer Canyon',
    unit_id: 'u1',
    unit_name: '#20',
    vacated_at: daysAgo(20).slice(0, 10),
    target_ready: null,
    movein_date: null,
    status: 'active',
    current_blocker: null,
    budget: null,
    actual: null,
    notes: null,
    af_service_request_id: null,
    af_unit_turn_id: null,
    af_unit_link: null,
    created_at: daysAgo(20),
    updated_at: daysAgo(1),
    lifecycle_status: 'SCHEDULED',
    ...overrides,
  };
}

describe('turnsLane', () => {
  it('orders by lifecycle, clocks from the latest matching event, falls back to vacated_at', () => {
    const turns = [
      turn({ id: 't1', lifecycle_status: 'IN_PROGRESS' }),
      turn({ id: 't2', lifecycle_status: 'SCOPE_DRAFT' }),
      turn({ id: 't3', lifecycle_status: 'ON_HOLD_PARTS' }),
    ];
    const events = [
      { unit_turn_id: 't1', from_status: 'SCHEDULED', to_status: 'IN_PROGRESS', created_at: daysAgo(9) },
      { unit_turn_id: 't1', from_status: 'IN_PROGRESS', to_status: 'ON_HOLD_PARTS', created_at: daysAgo(7) },
      { unit_turn_id: 't1', from_status: 'ON_HOLD_PARTS', to_status: 'IN_PROGRESS', created_at: daysAgo(3) },
    ];
    const lane = turnsLane(turns, events, NOW);
    expect(lane.byState.map((s) => s.state)).toEqual(['SCOPE_DRAFT', 'IN_PROGRESS', 'ON_HOLD_PARTS']);
    const inProg = lane.byState.find((s) => s.state === 'IN_PROGRESS')!;
    expect(inProg.medianDaysInState).toBe(3); // latest re-entry, not the first
    const draft = lane.byState.find((s) => s.state === 'SCOPE_DRAFT')!;
    expect(draft.medianDaysInState).toBe(20); // no event → vacated_at
    // t1's completed IN_PROGRESS spell (9d→7d = 2 days) is the only closed spell.
    expect(inProg.historical).toEqual({ medianDays: 2, p90Days: 2, n: 1 });
  });
  it('behindTarget excludes TURN_READY and later', () => {
    const turns = [
      turn({ id: 'a', lifecycle_status: 'SCHEDULED', target_ready: '2026-08-01' }),
      turn({ id: 'b', lifecycle_status: 'TURN_READY', target_ready: '2026-08-01' }),
      turn({ id: 'c', lifecycle_status: 'INVOICED', target_ready: '2026-08-01' }),
      turn({ id: 'd', lifecycle_status: 'ON_HOLD_OWNER', target_ready: '2026-08-01' }),
      turn({ id: 'e', lifecycle_status: 'SCHEDULED', target_ready: '2026-12-01' }),
    ];
    const lane = turnsLane(turns, [], NOW);
    expect(lane.behindTarget.ids).toEqual(['a', 'd']);
    expect(lane.open).toBe(5);
  });
  it('legacy fallback when lifecycle_status is absent', () => {
    const t = turn({ id: 'x', lifecycle_status: undefined, status: 'active' });
    expect(turnState(t)).toBe('ACTIVE');
    expect(turnNotReady('ACTIVE')).toBe(true);
    expect(turnNotReady('READY')).toBe(false);
    const lane = turnsLane([t], [], NOW, true);
    expect(lane.legacyStates).toBe(true);
    expect(lane.byState[0].state).toBe('ACTIVE');
  });
});

// ── attention ──

describe('attention', () => {
  it('totals, groups by label, top N by age desc', () => {
    const run: TripwireRunResult = {
      ...emptyRun,
      needsDateCount: 12,
      exceptions: [
        { tripwire: 3, label: '#3 Past-due', item: 'a', fixRequired: 'x', owner: 'Cheryl', ageDays: 2 },
        { tripwire: 3, label: '#3 Past-due', item: 'b', fixRequired: 'x', owner: 'Cheryl', ageDays: 9 },
        { tripwire: 11, label: '#11 Owner', item: 'c', fixRequired: 'x', owner: 'Cheryl' },
      ],
    };
    const a = attention(run, 2);
    expect(a.total).toBe(3);
    expect(a.byTripwire).toEqual({ '#3 Past-due': 2, '#11 Owner': 1 });
    expect(a.needsDateCount).toBe(12);
    expect(a.top.map((t) => t.item)).toEqual(['b', 'a']);
  });
});

// ── computeDashboard: partition + metric row ──

describe('computeDashboard', () => {
  const open = [
    wo({ id: 'n1', appfolio_status: 'New', stage: 'NEW', appfolio_created_at: daysAgo(4) }),
    wo({ id: 'a1', appfolio_status: 'Assigned' }),
    wo({ id: 's1', appfolio_status: 'Scheduled', stage: 'SCHEDULED', scheduled_start: daysAgo(2) }),
    wo({ id: 'c1', appfolio_status: 'Work Completed' }),
    wo({ id: 'e1', appfolio_status: 'Estimated', stage: 'WAITING_ON', waiting_reason: 'OWNER' }),
    wo({ id: 'w1', appfolio_status: 'Waiting', stage: 'WAITING_ON', waiting_reason: 'PARTS' }),
    wo({ id: 'o1', appfolio_status: null }),
  ];
  const inputs: DashboardInputs = {
    snapshot: snapshotOf(open),
    tripwires: {
      ...emptyRun,
      exceptions: [
        { tripwire: 8, label: '#8', item: 'unbilled', fixRequired: 'bill', owner: 'Penny', workOrderId: 'c1' },
      ],
    },
    events: [],
    closed: [
      { id: 'z1', appfolio_created_at: daysAgo(9), created_at: daysAgo(9), completed_date: daysAgo(3), closed_at: daysAgo(3), canceled_date: null },
      { id: 'z2', appfolio_created_at: daysAgo(30), created_at: daysAgo(30), completed_date: daysAgo(20), closed_at: daysAgo(20), canceled_date: null },
    ],
    decidedApprovals: [],
    chaseRows: [],
    openTurns: [],
    turnEvents: [],
  };
  const data = computeDashboard(inputs, NOW);

  it('every open WO lands in exactly one bucket', () => {
    const p = data.pipeline;
    const sum =
      p.new.count + p.assigned.count + p.scheduled.count + p.work_completed.count + p.other.count +
      data.estimates.estimate_requested.count + data.estimates.estimated.count + data.waiting.count;
    expect(sum).toBe(data.openTotal);
    expect(data.openTotal).toBe(7);
    expect(p.other.ids).toEqual(['o1']);
  });
  it('scheduled visit in the past is over threshold; new > 1 business day is over', () => {
    expect(data.pipeline.scheduled.overThresholdIds).toEqual(['s1']);
    expect(data.pipeline.new.overThresholdIds).toEqual(['n1']);
  });
  it('closed tile', () => {
    expect(data.closed.last7).toBe(1);
    expect(data.closed.historical.n).toBe(2);
    expect(data.closed.unbilledOver5).toBe(1);
  });
  it('metric row is counts only', () => {
    const m = dashboardMetric(data);
    expect(m.metric).toBe('dashboard_pipeline');
    expect(m.value).toMatchObject({
      openTotal: 7,
      windowDays: 90,
      pipeline: { new: { count: 1, over: 1 }, scheduled: { count: 1, over: 1 } },
      waiting: { count: 1, over: 1 }, // fixture is 10 days old > 5
      closedLast7: 1,
      attentionTotal: 1,
    });
    expect(JSON.stringify(m.value)).not.toContain('medianAgeDays');
  });
});

// ── drill ──

describe('drill helpers', () => {
  const wos = [wo({ id: 'a' }), wo({ id: 'b' }), wo({ id: 'c' })];
  it('null/undefined → identity; id set filters preserving order', () => {
    expect(applyWoDrill(wos, null)).toBe(wos);
    expect(applyWoDrill(wos, undefined)).toBe(wos);
    expect(applyWoDrill(wos, ['c', 'a']).map((w) => w.id)).toEqual(['a', 'c']);
    expect(applyWoDrill(wos, []).length).toBe(0);
  });
  it('turn drill', () => {
    const turns = [{ id: 't1' }, { id: 't2' }];
    expect(applyTurnDrill(turns, ['t2'])).toEqual([{ id: 't2' }]);
    expect(applyTurnDrill(turns, null)).toBe(turns);
  });
});
