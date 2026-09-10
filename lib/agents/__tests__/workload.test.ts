import { describe, it, expect } from 'vitest';
import { agentPool, proposalBacklog, buildWorkload, type LatestMetrics } from '../workload';
import type { AgentConfigRow, AgentProposal } from '../types';

function latestOf(entries: Record<string, unknown>): LatestMetrics {
  const m: LatestMetrics = new Map();
  for (const [metric, value] of Object.entries(entries)) {
    m.set(metric, { value: value as Record<string, unknown>, captured_at: '2026-08-26T00:00:00Z' });
  }
  return m;
}

function prop(overrides: Partial<AgentProposal>): AgentProposal {
  return {
    id: 'p1',
    agent: 'estimate_chaser',
    action_type: 'vendor_chase',
    status: 'proposed',
    subject_type: 'work_order',
    subject_id: 'wo-1',
    payload: {},
    created_at: '2026-08-20T00:00:00Z',
    ...overrides,
  } as AgentProposal;
}

const NOW = new Date('2026-08-26T00:00:00Z').getTime();

describe('agentPool', () => {
  it('maps the estimate chaser to open estimates + median age', () => {
    const latest = latestOf({ estimate_approval_latency: { openCount: 59, medianOpenAgeDays: 12.9 } });
    expect(agentPool('estimate_chaser', latest)).toEqual({
      count: 59,
      label: 'open estimates',
      aging: 'median 13d',
    });
  });

  it('maps morning card to open exceptions (no aging)', () => {
    const latest = latestOf({ open_exceptions: { total: 149, byTripwire: { 11: 54 } } });
    expect(agentPool('morning_card', latest)).toEqual({
      count: 149,
      label: 'open exceptions',
      aging: null,
    });
  });

  it('drops aging when the metric value is null/absent', () => {
    const latest = latestOf({ vendor_stuck_pools: { scheduledDatePassedCount: 60, acceptedUnworkedMedianAgeDays: null } });
    expect(agentPool('vendor_chaser', latest)).toEqual({
      count: 60,
      label: 'past scheduled date',
      aging: null,
    });
  });

  it('returns null for an unmapped agent or a missing metric', () => {
    expect(agentPool('ops_brief', latestOf({}))).toBeNull();
    expect(agentPool('estimate_chaser', latestOf({}))).toBeNull();
  });
});

describe('proposalBacklog', () => {
  it('counts only still-proposed rows and finds the oldest age', () => {
    const backlog = proposalBacklog(
      [
        prop({ id: 'a', created_at: '2026-08-24T00:00:00Z' }), // 2d
        prop({ id: 'b', created_at: '2026-08-20T00:00:00Z' }), // 6d (oldest)
        prop({ id: 'c', status: 'approved', created_at: '2026-08-01T00:00:00Z' }), // decided → ignored
        prop({ id: 'd', agent: 'morning_card', created_at: '2026-08-25T00:00:00Z' }),
      ],
      NOW
    );
    expect(backlog.get('estimate_chaser')).toEqual({ pending: 2, oldestDays: 6 });
    expect(backlog.get('morning_card')).toEqual({ pending: 1, oldestDays: 1 });
  });
});

describe('buildWorkload', () => {
  it('assembles pool + backlog per agent and skips the kill-switch row', () => {
    const config = [
      { agent: '*', action_type: '*' },
      { agent: 'estimate_chaser', action_type: 'vendor_chase' },
      { agent: 'ops_brief', action_type: 'send_brief' },
    ] as AgentConfigRow[];
    const latest = latestOf({ estimate_approval_latency: { openCount: 59, medianOpenAgeDays: 13 } });
    const proposals = [prop({ id: 'a', created_at: '2026-08-20T00:00:00Z' })];

    const w = buildWorkload(config, latest, proposals, NOW);
    expect(w['*']).toBeUndefined();
    expect(w.estimate_chaser).toEqual({
      poolCount: 59,
      poolLabel: 'open estimates',
      poolAging: 'median 13d',
      pending: 1,
      oldestDays: 6,
    });
    // Unmapped agent, no backlog → all null / zero, still present.
    expect(w.ops_brief).toEqual({
      poolCount: null,
      poolLabel: null,
      poolAging: null,
      pending: 0,
      oldestDays: null,
    });
  });
});
