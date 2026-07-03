import { describe, it, expect } from 'vitest';
import type { AppFolioWorkOrder } from '@/lib/appfolio';
import {
  buildMirrorRow,
  initialWorkflowFor,
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
    const row = buildMirrorRow(afWo(), { name: 'P', address: 'A' }, NOW);
    for (const col of WORKFLOW_COLUMNS) {
      expect(row).not.toHaveProperty(col);
    }
  });

  it('maps all mirror fields', () => {
    const row = buildMirrorRow(afWo(), { name: 'Brosterhous', address: '61250 Brosterhous' }, NOW);
    expect(row.appfolio_id).toBe('wo-123');
    expect(row.property_name).toBe('Brosterhous');
    expect(row.status).toBe('open');
    expect(row.appfolio_status).toBe('Open');
    expect(row.synced_at).toBe(NOW.toISOString());
  });

  it('falls back to Unknown Property', () => {
    const row = buildMirrorRow(afWo(), null, NOW);
    expect(row.property_name).toBe('Unknown Property');
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

describe('initialWorkflowFor', () => {
  it('open → NEW with Cheryl + next business day', () => {
    const wf = initialWorkflowFor(afWo(), NOW);
    expect(wf.stage).toBe('NEW');
    expect(wf.owner_name).toBe('Cheryl');
    expect(wf.next_action_date).toBe('2026-07-03'); // Friday
    expect(wf.origin).toBe('appfolio');
    expect(wf.closed_at).toBeNull();
  });

  it('Friday rolls the next-action date to Monday', () => {
    const friday = new Date('2026-07-03T18:00:00Z');
    const wf = initialWorkflowFor(afWo(), friday);
    expect(wf.next_action_date).toBe('2026-07-06'); // Monday
  });

  it('open + scheduled_start → SCHEDULED', () => {
    const wf = initialWorkflowFor(afWo({ scheduledStart: '2026-07-05T09:00:00Z' }), NOW);
    expect(wf.stage).toBe('SCHEDULED');
  });

  it('done → VERIFY (completed in AppFolio still needs our gate)', () => {
    const wf = initialWorkflowFor(
      afWo({ status: 'done', appfolioStatus: 'Completed', completedDate: '2026-07-01T00:00:00Z' }),
      NOW
    );
    expect(wf.stage).toBe('VERIFY');
    expect(wf.closed_at).toBeNull();
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

  it('completed in AppFolio advances to VERIFY, not CLOSED', () => {
    const auto = stageAutomationFor(
      'IN_PROGRESS',
      afWo({ status: 'done', appfolioStatus: 'Completed' }),
      NOW
    );
    expect(auto?.stage).toBe('VERIFY');
  });

  it('closed-in-AppFolio (not canceled) also lands at VERIFY — the gate decides CLOSED', () => {
    const auto = stageAutomationFor(
      'IN_PROGRESS',
      afWo({ status: 'closed', appfolioStatus: 'Closed', canceledDate: null }),
      NOW
    );
    expect(auto?.stage).toBe('VERIFY');
  });

  it('does not demote a WO already at VERIFY or beyond', () => {
    expect(stageAutomationFor('VERIFY', afWo({ status: 'done' }), NOW)).toBeNull();
    expect(stageAutomationFor('BILL', afWo({ status: 'done' }), NOW)).toBeNull();
  });
});
