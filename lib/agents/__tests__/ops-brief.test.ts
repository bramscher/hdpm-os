import { describe, it, expect } from 'vitest';
import {
  deltaVs,
  perAgentStats,
  encodeObActionId,
  parseObActionId,
  buildOpsBriefBlocks,
  applyAckToBlocks,
  NEEDS_CRAIG_CAP,
  type OpsBriefData,
  type EscalationBriefItem,
} from '../ops-brief';

function esc(overrides: Partial<EscalationBriefItem> = {}): EscalationBriefItem {
  return {
    proposalId: 'esc-1',
    woRef: 'WO #41855-1 — 456 SW Century Dr, Unit 12',
    reason: 'chased_3x',
    chaseCount: 3,
    ageCalendarDays: 48,
    appfolioLink: 'https://hdpm.appfolio.com/wo/41855',
    ...overrides,
  };
}

function briefData(overrides: Partial<OpsBriefData> = {}): OpsBriefData {
  return {
    briefDate: '2026-07-20',
    deep: false,
    exceptions: {
      total: 187,
      needsDate: 34,
      vsYesterday: deltaVs(187, 201, 'yesterday'),
      vsBaseline: deltaVs(187, 205, 'baseline'),
    },
    gate: { last7Days: 31, byActorTop: [['Cheryl Waterman', 24], ['Craig', 7]] },
    estimates: {
      openCount: 39,
      medianOpenAgeDays: 27,
      medianDaysToDecision: 12,
      openDelta: deltaVs(39, 42, 'yesterday'),
    },
    agentStats: [
      { agent: 'estimate_chaser', made: 31, applied: 27, edited: 0, rejected: 2 },
      { agent: 'morning_card', made: 7, applied: 5, edited: 1, rejected: 0 },
    ],
    today: { drafts: 9, smsProposed: 6, escalationsRaised: 1 },
    needsCraig: [esc()],
    ...overrides,
  };
}

// ── deltas ──

describe('deltaVs', () => {
  it('renders direction and magnitude', () => {
    expect(deltaVs(187, 201, 'yesterday')).toEqual({ direction: 'down', label: '↓ 14 vs yesterday' });
    expect(deltaVs(45, 40, 'last week')).toEqual({ direction: 'up', label: '↑ 5 vs last week' });
    expect(deltaVs(10, 10, 'baseline')).toEqual({ direction: 'flat', label: 'flat vs baseline' });
  });

  it('is null-safe on missing sides', () => {
    expect(deltaVs(null, 10, 'x')).toBeNull();
    expect(deltaVs(10, null, 'x')).toBeNull();
    expect(deltaVs(undefined, undefined, 'x')).toBeNull();
  });
});

// ── per-agent stats ──

describe('perAgentStats', () => {
  it('groups and buckets statuses, sorted by volume', () => {
    const stats = perAgentStats([
      { agent: 'estimate_chaser', status: 'auto_applied' },
      { agent: 'estimate_chaser', status: 'approved' },
      { agent: 'estimate_chaser', status: 'rejected' },
      { agent: 'morning_card', status: 'edited' },
      { agent: 'estimate_chaser', status: 'proposed' },
    ]);
    expect(stats[0]).toEqual({ agent: 'estimate_chaser', made: 4, applied: 2, edited: 0, rejected: 1 });
    expect(stats[1]).toEqual({ agent: 'morning_card', made: 1, applied: 0, edited: 1, rejected: 0 });
  });
});

// ── action ids ──

describe('ob action ids', () => {
  it('round-trips and rejects foreign namespaces', () => {
    expect(parseObActionId(encodeObActionId('ack', 'p-1'))).toEqual({ kind: 'ack', proposalId: 'p-1' });
    expect(parseObActionId('ec:sendsms:p-1')).toBeNull();
    expect(parseObActionId('ob:destroy:p-1')).toBeNull();
    expect(parseObActionId('ob:ack:')).toBeNull();
  });
});

// ── brief rendering ──

describe('buildOpsBriefBlocks', () => {
  it('never mentions dollars', () => {
    const deep = briefData({
      deep: true,
      deepSections: {
        vendorTop: [{ name: 'Cascade Plumbing', score: 0.82 }],
        offenders: [{ vendorName: 'Firkus Roofing', item: 'Roof leak — Brosterhous', ageDays: 46 }],
        vendorStuck: { acceptedUnworkedCount: 44, scheduledDatePassedCount: 38, vsLastWeek: deltaVs(44, 46, 'last week') },
        unbilled: { count: 12, oldestDays: 31 },
        turns: { openTurns: 4, medianDaysVacant: 18 },
        retype: { last7Days: 22, weeklyTarget: 40 },
        baseline: [{ label: 'Open exceptions', before: '205', now: '187' }],
      },
    });
    for (const variant of [buildOpsBriefBlocks(briefData(), { readOnly: false }), buildOpsBriefBlocks(deep, { readOnly: false })]) {
      expect(JSON.stringify(variant)).not.toMatch(/\$/);
    }
  });

  it('caps needs-Craig items and notes the overflow', () => {
    const items = Array.from({ length: 5 }, (_, i) => esc({ proposalId: `esc-${i}` }));
    const { blocks } = buildOpsBriefBlocks(briefData({ needsCraig: items }), { readOnly: false });
    const s = JSON.stringify(blocks);
    const buttonCount = (s.match(/ob:ack:/g) ?? []).length;
    expect(buttonCount).toBe(NEEDS_CRAIG_CAP);
    expect(s).toContain('+2 more');
  });

  it('read-only copy renders no buttons', () => {
    const { blocks } = buildOpsBriefBlocks(briefData(), { readOnly: true });
    expect(JSON.stringify(blocks)).not.toContain('ob:ack:');
  });

  it('acknowledged items render the ack line instead of a button (mixed list)', () => {
    const { blocks } = buildOpsBriefBlocks(
      briefData({
        needsCraig: [
          esc({ proposalId: 'esc-acked', acknowledgedBy: 'Craig' }),
          esc({ proposalId: 'esc-open' }),
        ],
      }),
      { readOnly: false }
    );
    const s = JSON.stringify(blocks);
    expect(s).toContain('Acknowledged by Craig');
    expect(s).not.toContain('ob:ack:esc-acked');
    expect(s).toContain('ob:ack:esc-open');
  });

  it('a fully acknowledged list collapses to the all-clear line', () => {
    const { blocks } = buildOpsBriefBlocks(
      briefData({ needsCraig: [esc({ acknowledgedBy: 'Craig' })] }),
      { readOnly: false }
    );
    expect(JSON.stringify(blocks)).toContain('nothing 🎉');
  });

  it('celebrates an empty needs-Craig list', () => {
    const { blocks } = buildOpsBriefBlocks(briefData({ needsCraig: [] }), { readOnly: false });
    expect(JSON.stringify(blocks)).toContain('nothing 🎉');
  });

  it('flags the adoption gate state', () => {
    const over = buildOpsBriefBlocks(briefData(), { readOnly: false });
    expect(JSON.stringify(over.blocks)).toContain('over target');
    const under = buildOpsBriefBlocks(
      briefData({ gate: { last7Days: 9, byActorTop: [] } }),
      { readOnly: false }
    );
    expect(JSON.stringify(under.blocks)).toContain('below target');
  });
});

// ── ack patching ──

describe('applyAckToBlocks', () => {
  it('patches exactly the tapped block and strips its button', () => {
    const { blocks } = buildOpsBriefBlocks(
      briefData({ needsCraig: [esc({ proposalId: 'esc-a' }), esc({ proposalId: 'esc-b' })] }),
      { readOnly: false }
    );
    const patched = applyAckToBlocks(blocks, 'esc-a', 'Craig', '5:12 PM')!;
    const s = JSON.stringify(patched);
    expect(s).toContain('Acknowledged by Craig 5:12 PM');
    expect(s).not.toContain('ob:ack:esc-a');
    expect(s).toContain('ob:ack:esc-b');
  });

  it('returns null when the block is absent', () => {
    const { blocks } = buildOpsBriefBlocks(briefData(), { readOnly: false });
    expect(applyAckToBlocks(blocks, 'nope', 'Craig', '5:12 PM')).toBeNull();
  });
});
