import { describe, it, expect } from 'vitest';
import type { AppFolioWorkOrder } from '@/lib/appfolio';
import {
  buildMirrorRow,
  initialWorkflowFor,
  mappedStageFor,
  seedPriorityClass,
  stageAutomationFor,
} from '../sync-rules';

const NOW = new Date('2026-07-02T18:00:00Z'); // a Thursday

function afWo(overrides: Partial<AppFolioWorkOrder> = {}): AppFolioWorkOrder {
  return {
    appfolioId: 'wo-123',
    propertyId: 'prop-1',
    unitId: 'unit-1',
    woNumber: 'WO-1001',
    description: 'Fridge not cooling',
    status: 'open',
    appfolioStatus: 'Open',
    priority: 'Normal',
    assignedTo: null,
    vendorId: null,
    vendorName: null,
    scheduledStart: null,
    scheduledEnd: null,
    completedDate: null,
    canceledDate: null,
    permissionToEnter: false,
    createdAt: '2026-07-01T00:00:00Z',
    lastUpdatedAt: '2026-07-01T12:00:00Z',
    link: 'https://highdesertpm.appfolio.com/maintenance/service_requests/1/work_orders/1',
    recurring: false,
    ...overrides,
  };
}

// The workflow columns the sync must NEVER write on existing rows.
const WORKFLOW_COLUMNS = [
  'stage',
  'waiting_reason',
  'owner_name',
  'next_action_date',
  'priority_class',
  'assigned_tech',
  'origin',
  'is_turn',
  'verified_by',
  'verified_at',
  'tenant_ping_sent',
  'tenant_ping_sent_at',
  'preventive_scheduled',
  'closed_at',
  'aging_reason',
];

describe('buildMirrorRow', () => {
  it('never contains workflow columns (the load-bearing guarantee)', () => {
    const row = buildMirrorRow(afWo(), { name: 'P', address: 'A' }, { name: 'U' }, NOW);
    for (const col of WORKFLOW_COLUMNS) {
      expect(row).not.toHaveProperty(col);
    }
  });

  it('maps all mirror fields', () => {
    const row = buildMirrorRow(
      afWo(),
      { name: 'Brosterhous', address: '61250 Brosterhous' },
      { name: 'RC 603 - #20' },
      NOW
    );
    expect(row.appfolio_id).toBe('wo-123');
    expect(row.property_name).toBe('Brosterhous');
    expect(row.unit_name).toBe('RC 603 - #20');
    expect(row.status).toBe('open');
    expect(row.appfolio_status).toBe('Open');
    expect(row.synced_at).toBe(NOW.toISOString());
  });

  it('falls back to Unknown Property and null unit', () => {
    const row = buildMirrorRow(afWo(), null, null, NOW);
    expect(row.property_name).toBe('Unknown Property');
    expect(row.unit_name).toBeNull();
  });
});

describe('seedPriorityClass', () => {
  it('maps recognizable AppFolio priorities', () => {
    expect(seedPriorityClass('Urgent')).toBe('P1');
    expect(seedPriorityClass('emergency')).toBe('P1');
    expect(seedPriorityClass('High')).toBe('P2');
    expect(seedPriorityClass('Normal')).toBe('P3');
    expect(seedPriorityClass('medium')).toBe('P3');
    expect(seedPriorityClass('Low')).toBe('P4');
  });

  it('returns null for unknown / missing', () => {
    expect(seedPriorityClass('Whenever')).toBeNull();
    expect(seedPriorityClass(null)).toBeNull();
  });
});

describe('mappedStageFor — HDPM AppFolio status vocabulary', () => {
  it('maps every live status (verified against instance data 2026-07-03)', () => {
    const cases: [string, string, string | null][] = [
      ['New', 'NEW', null],
      ['Assigned', 'TRIAGED', null],
      ['Scheduled', 'SCHEDULED', null],
      ['Estimate Requested', 'WAITING_ON', 'VENDOR'],
      ['Estimated', 'WAITING_ON', 'OWNER'],
      ['Waiting', 'WAITING_ON', 'INTERNAL'],
    ];
    for (const [appfolioStatus, stage, reason] of cases) {
      const m = mappedStageFor(afWo({ appfolioStatus }));
      expect(m.stage, appfolioStatus).toBe(stage);
      expect(m.waiting_reason, appfolioStatus).toBe(reason);
    }
  });

  it('Assigned with a visit date → SCHEDULED (a concrete date beats the coarse status)', () => {
    const m = mappedStageFor(
      afWo({ appfolioStatus: 'Assigned', scheduledStart: '2026-07-05T09:00:00Z' })
    );
    expect(m.stage).toBe('SCHEDULED');
  });

  it('done/closed statuses win over the text status → both CLOSED', () => {
    expect(mappedStageFor(afWo({ status: 'done', appfolioStatus: 'Completed' })).stage).toBe('CLOSED');
    expect(mappedStageFor(afWo({ status: 'closed', appfolioStatus: 'Canceled' })).stage).toBe('CLOSED');
  });

  it('unknown status falls back to NEW', () => {
    expect(mappedStageFor(afWo({ appfolioStatus: 'Some Future Status' })).stage).toBe('NEW');
  });
});

describe('initialWorkflowFor', () => {
  it('open with no scheduled visit → NEW, Cheryl, blank next-action date (needs date)', () => {
    const wf = initialWorkflowFor(afWo(), NOW);
    expect(wf.stage).toBe('NEW');
    expect(wf.owner_name).toBe('Cheryl');
    expect(wf.next_action_date).toBeNull(); // no AppFolio date → blank, not a placeholder
    expect(wf.origin).toBe('appfolio');
    expect(wf.closed_at).toBeNull();
  });

  it('open + scheduled_start → SCHEDULED, next-action date = the scheduled visit', () => {
    const wf = initialWorkflowFor(afWo({ scheduledStart: '2026-07-05T09:00:00Z' }), NOW);
    expect(wf.stage).toBe('SCHEDULED');
    expect(wf.next_action_date).toBe('2026-07-05');
  });

  it('done → CLOSED (AppFolio-completed closes in our system, closed_at = CompletedOn)', () => {
    const wf = initialWorkflowFor(
      afWo({ status: 'done', appfolioStatus: 'Completed', completedDate: '2026-07-01T00:00:00Z' }),
      NOW
    );
    expect(wf.stage).toBe('CLOSED');
    expect(wf.closed_at).toBe('2026-07-01T00:00:00Z');
  });

  it('standing grandfather: completed BEFORE launch cutoff → CLOSED on insert', () => {
    const wf = initialWorkflowFor(
      afWo({ status: 'done', appfolioStatus: 'Completed', completedDate: '2026-05-14T00:00:00Z' }),
      NOW
    );
    expect(wf.stage).toBe('CLOSED');
    expect(wf.closed_at).toBe('2026-05-14T00:00:00Z');
    expect(wf.next_action_date).toBeNull();
  });

  it('grandfather falls back to LastUpdatedAt when CompletedOn is missing (2013 zombies)', () => {
    const wf = initialWorkflowFor(
      afWo({
        status: 'done',
        appfolioStatus: 'Completed',
        completedDate: null,
        lastUpdatedAt: '2025-11-15T00:00:00Z',
        createdAt: '2013-02-21T00:00:00Z',
      }),
      NOW
    );
    expect(wf.stage).toBe('CLOSED');
    expect(wf.closed_at).toBe('2025-11-15T00:00:00Z');
  });

  it('completed post-launch with no CompletedOn → CLOSED, closed_at falls back to LastUpdatedAt', () => {
    const wf = initialWorkflowFor(
      afWo({
        status: 'done',
        appfolioStatus: 'Completed',
        completedDate: null,
        lastUpdatedAt: '2026-07-02T00:00:00Z',
      }),
      NOW
    );
    expect(wf.stage).toBe('CLOSED');
    expect(wf.closed_at).toBe('2026-07-02T00:00:00Z');
  });

  it('closed → CLOSED, grandfathered with closed_at and no next action', () => {
    const wf = initialWorkflowFor(
      afWo({ status: 'closed', appfolioStatus: 'Canceled', canceledDate: '2026-06-30T00:00:00Z' }),
      NOW
    );
    expect(wf.stage).toBe('CLOSED');
    expect(wf.closed_at).toBe('2026-06-30T00:00:00Z');
    expect(wf.next_action_date).toBeNull();
  });

  it('seeds priority_class from free-text priority', () => {
    expect(initialWorkflowFor(afWo({ priority: 'Urgent' }), NOW).priority_class).toBe('P1');
  });
});

describe('stageAutomationFor', () => {
  it('does nothing for an ordinary open WO', () => {
    expect(stageAutomationFor('TRIAGED', afWo(), NOW)).toBeNull();
  });

  it('early catch-up: NEW follows AppFolio Assigned → TRIAGED', () => {
    const auto = stageAutomationFor('NEW', afWo({ appfolioStatus: 'Assigned' }), NOW);
    expect(auto?.stage).toBe('TRIAGED');
  });

  it('early catch-up: NEW follows Estimate Requested → WAITING_ON/VENDOR', () => {
    const auto = stageAutomationFor('NEW', afWo({ appfolioStatus: 'Estimate Requested' }), NOW);
    expect(auto?.stage).toBe('WAITING_ON');
    expect(auto?.waiting_reason).toBe('VENDOR');
  });

  it('early catch-up: TRIAGED follows Scheduled → SCHEDULED', () => {
    const auto = stageAutomationFor(
      'TRIAGED',
      afWo({ appfolioStatus: 'Scheduled', scheduledStart: '2026-07-05T09:00:00Z' }),
      NOW
    );
    expect(auto?.stage).toBe('SCHEDULED');
  });

  it('without a status change, never moves backward (TRIAGED stays despite "New")', () => {
    expect(stageAutomationFor('TRIAGED', afWo({ appfolioStatus: 'New' }), NOW, 'New')).toBeNull();
  });

  it('without a status change, WAITING_ON is left alone (local reason not clobbered)', () => {
    expect(
      stageAutomationFor('WAITING_ON', afWo({ appfolioStatus: 'Scheduled' }), NOW, 'Scheduled')
    ).toBeNull();
  });

  it('an AppFolio status CHANGE moves any pre-completion stage, both directions', () => {
    // Waiting → Scheduled in AppFolio: our WAITING_ON follows to SCHEDULED
    const fwd = stageAutomationFor(
      'WAITING_ON',
      afWo({ appfolioStatus: 'Scheduled', scheduledStart: '2026-07-05T09:00:00Z' }),
      NOW,
      'Waiting'
    );
    expect(fwd?.stage).toBe('SCHEDULED');
    // Scheduled → Estimate Requested in AppFolio: SCHEDULED moves to WAITING/VENDOR
    const back = stageAutomationFor(
      'SCHEDULED',
      afWo({ appfolioStatus: 'Estimate Requested' }),
      NOW,
      'Scheduled'
    );
    expect(back?.stage).toBe('WAITING_ON');
    expect(back?.waiting_reason).toBe('VENDOR');
  });

  it('never touches app-owned stages (IN_PROGRESS and beyond)', () => {
    expect(
      stageAutomationFor('IN_PROGRESS', afWo({ appfolioStatus: 'Assigned' }), NOW, 'New')
    ).toBeNull();
    expect(
      stageAutomationFor('BILL', afWo({ appfolioStatus: 'Scheduled' }), NOW, 'Assigned')
    ).toBeNull();
  });

  it('never touches an already-CLOSED row', () => {
    expect(stageAutomationFor('CLOSED', afWo({ canceledDate: '2026-07-01' }), NOW)).toBeNull();
  });

  it('canceled in AppFolio → CLOSED with closed_at', () => {
    const auto = stageAutomationFor(
      'SCHEDULED',
      afWo({ status: 'closed', appfolioStatus: 'Canceled', canceledDate: '2026-07-01T00:00:00Z' }),
      NOW
    );
    expect(auto?.stage).toBe('CLOSED');
    expect(auto?.closed_at).toBe('2026-07-01T00:00:00Z');
  });

  it('completed in AppFolio → CLOSED (drops off the board, closed_at = CompletedOn)', () => {
    const auto = stageAutomationFor(
      'IN_PROGRESS',
      afWo({ status: 'done', appfolioStatus: 'Completed', completedDate: '2026-07-04T00:00:00Z' }),
      NOW
    );
    expect(auto?.stage).toBe('CLOSED');
    expect(auto?.closed_at).toBe('2026-07-04T00:00:00Z');
  });

  it('closed-in-AppFolio (not canceled) also → CLOSED', () => {
    const auto = stageAutomationFor(
      'IN_PROGRESS',
      afWo({ status: 'closed', appfolioStatus: 'Closed', canceledDate: null }),
      NOW
    );
    expect(auto?.stage).toBe('CLOSED');
  });

  it('completed work at VERIFY or BILL also closes (AppFolio finished = closed in ours)', () => {
    expect(stageAutomationFor('VERIFY', afWo({ status: 'done' }), NOW)?.stage).toBe('CLOSED');
    expect(stageAutomationFor('BILL', afWo({ status: 'done' }), NOW)?.stage).toBe('CLOSED');
  });
});
