import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  proposal: vi.fn(), enqueue: vi.fn(), dispatch: vi.fn(), notify: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({
  from: (table: string) => {
    let rows = mocks.rows[table] ?? [];
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return q; },
      in: (k: string, v: unknown[]) => { rows = rows.filter(r => v.includes(r[k])); return q; },
      gte: () => q, lt: () => q, update: () => q,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return q;
  },
}) }));
vi.mock('@/lib/maintenance/tripwire-engine', () => ({ loadTripwireSnapshot: async () => ({
  openWorkOrders: [{ id: 'wo1', wo_number: '412', property_name: 'House',
    property_address: '123 Main', vendor_id: null, vendor_name: null,
    description: 'Repair', appfolio_status: 'Estimate Requested', appfolio_link: 'https://example.com/wo/412',
  }], approvals: [],
}) }));
vi.mock('@/lib/maintenance/tripwires', () => ({
  tripwire11: () => [{ tripwire: 11, workOrderId: 'wo1', ageDays: 5 }],
  statusSinceFor: () => new Date('2026-09-01T12:00:00Z'),
}));
vi.mock('@/lib/dashboard-config', () => ({ getDashboardConfig: async () => ({ internalVendorIds: [] }) }));
vi.mock('@/lib/appfolio', () => ({ fetchAppFolioVendorContacts: vi.fn(), fetchAppFolioPropertyOwnerMap: vi.fn() }));
vi.mock('@/lib/zoom-sync', () => ({ normalizePhone: (s: string) => s }));
vi.mock('@/lib/zoom-phone', () => ({ smsSenderEmail: () => 'cheryl@highdesertpm.com' }));
vi.mock('../config', () => ({
  getAgentConfig: async (_agent: string, action: string) => ({ enabled: action !== 'team_review' || !!mocks.rows.team_review?.length, autonomy_level: 3, max_per_day: 10 }),
  effectiveLevel: () => 3, isGloballyKilled: async () => false, isWithinQuietHours: () => false,
  getNotifyRecipients: mocks.notify,
}));
vi.mock('../proposals', () => ({ createProposal: mocks.proposal }));
vi.mock('../outbox', () => ({ enqueueOutbox: mocks.enqueue, dispatchOutbox: mocks.dispatch }));
vi.mock('../staff', () => ({ resolveStaffByPersonOrEmail: async () => ({ person: 'Craig', email: 'craig@example.com', slack_user_id: 'craig-slack' }) }));
vi.mock('../pilot', () => ({ getPilotConfig: () => ({ recipients: [], shadow: false }), getEstimateChaserOwner: () => 'Craig' }));

import { runEstimateChaser } from '../estimate-chaser-run';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = {};
  mocks.notify.mockResolvedValue([{ person: 'Craig', slack_user_id: 'craig-slack' }]);
  mocks.enqueue.mockResolvedValue({ id: 'out1' });
});

describe('unassigned work-order chasers', () => {
  it('reports the assignment task without drafting or writing in dry run', async () => {
    const result = await runEstimateChaser({ dryRun: true, now: new Date('2026-09-16T15:00:00Z') });
    expect(result.contactIssues).toEqual([{ workOrderId: 'wo1', woNumber: '412', vendorName: null, reason: 'assign_vendor' }]);
    expect(result.vendorDrafts).toBe(0);
    expect(result.smsProposed).toBe(0);
    expect(mocks.proposal).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('routes an internal task to Craig without creating a chase proposal, even after 45 days', async () => {
    const result = await runEstimateChaser({ now: new Date('2026-11-16T15:00:00Z') });
    expect(result.escalations).toBe(0);
    expect(mocks.proposal).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ channel: 'slack', recipient_person: 'Craig', recipient_address: 'craig-slack' }));
    expect(JSON.stringify(mocks.enqueue.mock.calls)).toContain('Assign a vendor');
  });

  it('does not duplicate a contact card already queued for that reviewer today', async () => {
    mocks.rows.agent_outbox = [{ id: 'existing', channel: 'slack', subject: 'Chaser contact details — 2026-09-16 (1)', recipient_address: 'craig-slack' }];
    await runEstimateChaser({ now: new Date('2026-09-16T15:00:00Z') });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.proposal).not.toHaveBeenCalled();
  });
});

 it('retires legacy chases when the shared queue is enabled', async () => {
  mocks.rows.team_review = [{enabled:true}];
  const result = await runEstimateChaser();
  expect(result.halted).toBe('shared team review queue enabled');
  expect(mocks.enqueue).not.toHaveBeenCalled();
 });
