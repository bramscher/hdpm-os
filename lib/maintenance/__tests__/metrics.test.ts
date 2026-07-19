import { describe, it, expect } from 'vitest';
import type { MaintWorkOrder, Turn, VendorAssignment } from '../types';
import type { TripwireRunResult } from '../tripwire-engine';
import {
  exceptionsMetric,
  isHumanAction,
  staffActionsMetric,
  transitionsFrom,
  statusSpells,
  pairedDurationsDays,
  estimateLatencyMetric,
  daysToScheduleMetric,
  timeToFirstActionMetric,
  vendorMetric,
  turnMetric,
  type MetricEventRow,
} from '../metrics';

const NOW = new Date('2026-07-18T12:00:00Z');

function event(overrides: Partial<MetricEventRow> = {}): MetricEventRow {
  return {
    work_order_id: 'wo-1',
    event_type: 'note',
    actor: 'cheryl@highdesertpm.com',
    payload: null,
    created_at: '2026-07-17T12:00:00Z',
    ...overrides,
  };
}

function statusEvent(
  woId: string,
  from: string | null,
  to: string,
  at: string
): MetricEventRow {
  return event({
    work_order_id: woId,
    event_type: 'sync_update',
    actor: 'system:sync',
    payload: { field: 'appfolio_status', from, to },
    created_at: at,
  });
}

// ── exceptionsMetric ──

describe('exceptionsMetric', () => {
  it('totals and groups by tripwire, carries needsDateCount', () => {
    const result: TripwireRunResult = {
      exceptions: [
        { tripwire: 3, label: '#3', item: 'a', fixRequired: 'x', owner: 'Cheryl' },
        { tripwire: 3, label: '#3', item: 'b', fixRequired: 'x', owner: 'Cheryl' },
        { tripwire: 11, label: '#11', item: 'c', fixRequired: 'x', owner: 'Cheryl' },
      ],
      ruleErrors: [{ tripwire: 5, error: 'boom' }],
      ranAt: NOW.toISOString(),
      needsDate: [],
      needsDateCount: 42,
    };
    const { metric, value } = exceptionsMetric(result);
    expect(metric).toBe('open_exceptions');
    expect(value.total).toBe(3);
    expect(value.byTripwire).toEqual({ '3': 2, '11': 1 });
    expect(value.needsDateCount).toBe(42);
    expect(value.ruleErrors).toBe(1);
  });
});

// ── staff actions ──

describe('isHumanAction', () => {
  it('excludes system actors and machine event types', () => {
    expect(isHumanAction(event())).toBe(true);
    expect(isHumanAction(event({ actor: 'system:sync' }))).toBe(false);
    expect(isHumanAction(event({ actor: 'system:tripwire-3' }))).toBe(false);
    expect(isHumanAction(event({ event_type: 'sync_update' }))).toBe(false);
    expect(isHumanAction(event({ event_type: 'exception' }))).toBe(false);
  });
});

describe('staffActionsMetric', () => {
  it('counts 7d and 28d windows and groups by actor', () => {
    const events = [
      event({ created_at: '2026-07-17T12:00:00Z' }), // in 7d
      event({ created_at: '2026-07-16T12:00:00Z', actor: 'penny@highdesertpm.com' }), // in 7d
      event({ created_at: '2026-07-01T12:00:00Z' }), // in 28d only
      event({ created_at: '2026-05-01T12:00:00Z' }), // outside both
      event({ created_at: '2026-07-17T13:00:00Z', actor: 'system:sync' }), // machine
    ];
    const { value } = staffActionsMetric(events, NOW);
    expect(value.last7Days).toBe(2);
    expect(value.last28Days).toBe(3);
    expect(value.byActor7Days).toEqual({
      'cheryl@highdesertpm.com': 1,
      'penny@highdesertpm.com': 1,
    });
  });
});

// ── status clocks ──

describe('transitionsFrom', () => {
  it('keeps only appfolio_status sync_updates, sorted by time', () => {
    const events = [
      statusEvent('wo-1', 'Assigned', 'Scheduled', '2026-07-02T00:00:00Z'),
      statusEvent('wo-1', 'New', 'Assigned', '2026-07-01T00:00:00Z'),
      event({ event_type: 'sync_update', payload: { field: 'other', to: 'x' } }),
      event({ event_type: 'note' }),
    ];
    const t = transitionsFrom(events);
    expect(t).toHaveLength(2);
    expect(t[0].to).toBe('Assigned');
    expect(t[1].to).toBe('Scheduled');
  });
});

describe('statusSpells', () => {
  const SET = ['estimate requested', 'estimated'];

  it('measures completed spells across statuses inside the set', () => {
    const t = transitionsFrom([
      statusEvent('wo-1', 'New', 'Estimate Requested', '2026-07-01T00:00:00Z'),
      statusEvent('wo-1', 'Estimate Requested', 'Estimated', '2026-07-03T00:00:00Z'), // stays inside
      statusEvent('wo-1', 'Estimated', 'Assigned', '2026-07-05T00:00:00Z'), // exits
    ]);
    const { completedDays, openAgeDays } = statusSpells(t, SET, NOW);
    expect(completedDays).toEqual([4]);
    expect(openAgeDays).toHaveLength(0);
  });

  it('reports still-inside spells as open (censored)', () => {
    const t = transitionsFrom([
      statusEvent('wo-2', 'New', 'Estimated', '2026-07-08T12:00:00Z'),
    ]);
    const { completedDays, openAgeDays } = statusSpells(t, SET, NOW);
    expect(completedDays).toHaveLength(0);
    expect(openAgeDays).toEqual([10]);
  });

  it('handles re-entry as a second spell', () => {
    const t = transitionsFrom([
      statusEvent('wo-3', 'New', 'Estimate Requested', '2026-07-01T00:00:00Z'),
      statusEvent('wo-3', 'Estimate Requested', 'Assigned', '2026-07-02T00:00:00Z'),
      statusEvent('wo-3', 'Assigned', 'Estimated', '2026-07-10T00:00:00Z'),
      statusEvent('wo-3', 'Estimated', 'Completed', '2026-07-13T00:00:00Z'),
    ]);
    const { completedDays } = statusSpells(t, SET, NOW);
    expect(completedDays).toEqual([1, 3]);
  });
});

describe('estimateLatencyMetric', () => {
  it('reports median decision latency and open-spell ages', () => {
    const t = transitionsFrom([
      statusEvent('wo-1', 'New', 'Estimate Requested', '2026-07-01T00:00:00Z'),
      statusEvent('wo-1', 'Estimate Requested', 'Assigned', '2026-07-05T00:00:00Z'),
      statusEvent('wo-2', 'New', 'Estimated', '2026-07-16T12:00:00Z'),
    ]);
    const { metric, value } = estimateLatencyMetric(t, NOW);
    expect(metric).toBe('estimate_approval_latency');
    expect(value.medianDaysToDecision).toBe(4);
    expect(value.decidedCount).toBe(1);
    expect(value.openCount).toBe(1);
    expect(value.medianOpenAgeDays).toBe(2);
  });
});

describe('pairedDurationsDays / daysToScheduleMetric', () => {
  it('pairs first assigned → first later scheduled per WO', () => {
    const t = transitionsFrom([
      statusEvent('wo-1', 'New', 'Assigned', '2026-07-01T00:00:00Z'),
      statusEvent('wo-1', 'Assigned', 'Scheduled', '2026-07-04T00:00:00Z'),
      statusEvent('wo-2', 'New', 'Assigned', '2026-07-02T00:00:00Z'), // never scheduled
      statusEvent('wo-3', 'New', 'Scheduled', '2026-07-02T00:00:00Z'), // scheduled w/o assigned
    ]);
    expect(pairedDurationsDays(t, 'assigned', 'scheduled')).toEqual([3]);
    const { value } = daysToScheduleMetric(t);
    expect(value.medianDays).toBe(3);
    expect(value.n).toBe(1);
  });
});

// ── time to first action ──

describe('timeToFirstActionMetric', () => {
  const wos = [
    { id: 'wo-1', appfolio_created_at: '2026-07-15T00:00:00Z', created_at: '2026-07-16T00:00:00Z' },
    { id: 'wo-2', appfolio_created_at: '2026-07-15T00:00:00Z', created_at: '2026-07-15T00:00:00Z' },
    { id: 'wo-old', appfolio_created_at: '2026-05-01T00:00:00Z', created_at: '2026-07-15T00:00:00Z' },
  ];

  it('uses appfolio_created_at, medians acted WOs, counts censored ones', () => {
    const events = [
      event({ work_order_id: 'wo-1', created_at: '2026-07-15T06:00:00Z' }), // 6h
      event({ work_order_id: 'wo-1', created_at: '2026-07-16T00:00:00Z' }), // later, ignored
      event({ work_order_id: 'wo-old', created_at: '2026-07-16T00:00:00Z' }), // out of window
      event({ work_order_id: 'wo-2', actor: 'system:sync', event_type: 'sync_update' }),
    ];
    const { value } = timeToFirstActionMetric(wos, events, NOW);
    expect(value.newWoCount).toBe(2); // wo-old outside the 28d window
    expect(value.actedCount).toBe(1);
    expect(value.medianHours).toBe(6);
    expect(value.noActionCount).toBe(1); // wo-2 has only machine events
  });
});

// ── vendor + turn pools ──

function assignment(overrides: Partial<VendorAssignment> = {}): VendorAssignment {
  return {
    id: 'a-1',
    work_order_id: 'wo-1',
    vendor_id: 'v-1',
    sent_at: '2026-07-01T00:00:00Z',
    accepted_at: null,
    declined_at: null,
    scheduled_at: null,
    completed_at: null,
    callback: false,
    created_by: null,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const openWo = (id: string, scheduled_start: string | null = null) =>
  ({ id, scheduled_start } as MaintWorkOrder);

describe('vendorMetric', () => {
  it('counts accepted-but-unworked (open WOs only) and scheduled-date-passed', () => {
    const assignments = [
      assignment({ accepted_at: '2026-07-08T12:00:00Z' }), // open, unworked → 10d
      assignment({ id: 'a-2', work_order_id: 'wo-2', accepted_at: '2026-07-01T00:00:00Z', completed_at: '2026-07-02T00:00:00Z' }),
      assignment({ id: 'a-3', work_order_id: 'wo-closed', accepted_at: '2026-07-01T00:00:00Z' }),
      assignment({ id: 'a-4', work_order_id: 'wo-2' }), // never accepted
    ];
    const open = [
      openWo('wo-1'),
      openWo('wo-2', '2026-07-10T00:00:00Z'), // scheduled date passed
      openWo('wo-3', '2026-08-01T00:00:00Z'), // future
    ];
    const { value } = vendorMetric(assignments, open, NOW);
    expect(value.acceptedUnworkedCount).toBe(1);
    expect(value.acceptedUnworkedMedianAgeDays).toBe(10);
    expect(value.scheduledDatePassedCount).toBe(1);
  });
});

describe('turnMetric', () => {
  it('counts open turns and medians days vacant', () => {
    const turns = [
      { work_order_id: 'wo-1', vacated_at: '2026-07-08T12:00:00Z' } as Turn,
      { work_order_id: 'wo-closed', vacated_at: '2026-06-01T00:00:00Z' } as Turn,
    ];
    const { value } = turnMetric(turns, [openWo('wo-1')], NOW);
    expect(value.openTurns).toBe(1);
    expect(value.medianDaysVacant).toBe(10);
  });
});
