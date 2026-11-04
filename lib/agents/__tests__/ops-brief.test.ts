import { describe, it, expect } from 'vitest';
import {
  deltaVs,
  perAgentStats,
  encodeObActionId,
  parseObActionId,
  buildOpsBriefBlocks,
  applyAckToBlocks,
  mdToMrkdwn,
  NEEDS_CRAIG_CAP,
  type OpsBriefData,
  type EscalationBriefItem,
} from '../ops-brief';

function esc(overrides: Partial<EscalationBriefItem> = {}): EscalationBriefItem {
  return {
    workOrderId: 'wo-1',
    woRef: 'WO #41855-1 — 456 SW Century Dr, Unit 12',
    reason: 'chased_3x',
    waitingOn: 'vendor bid outstanding',
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
    for (const variant of [buildOpsBriefBlocks(briefData()), buildOpsBriefBlocks(deep)]) {
      expect(JSON.stringify(variant)).not.toMatch(/\$/);
    }
  });

  it('caps items, shows the full count, and links the rest to the live board list', () => {
    const items = Array.from({ length: 5 }, (_, i) => esc({ workOrderId: `wo-${i}` }));
    const s = JSON.stringify(buildOpsBriefBlocks(briefData({ needsCraig: items })).blocks);
    expect(s).toContain('Needs decision (5)');
    expect((s.match(/followup=wo-/g) ?? []).length).toBe(NEEDS_CRAIG_CAP);
    expect(s).toContain('filter=needs-decision|+2 more on the Chase board');
    expect(s).not.toContain('exceptions board');
  });

  it('shows live days, what it is waiting on, and no acknowledge button', () => {
    const s = JSON.stringify(buildOpsBriefBlocks(briefData()).blocks);
    expect(s).toContain('48 days stuck · vendor bid outstanding · chased 3×');
    expect(s).toContain('followup=wo-1|Open card');
    expect(s).not.toContain('ob:ack:');
  });

  it('links Exceptions and rounds day counts', () => {
    const base = briefData();
    const s = JSON.stringify(
      buildOpsBriefBlocks({
        ...base,
        estimates: { ...base.estimates, medianOpenAgeDays: 8.003500046296296 },
      }).blocks
    );
    expect(s).toContain('board?view=exceptions|Exceptions');
    expect(s).toContain('median 8d stuck');
  });

  it('celebrates an empty needs-Craig list', () => {
    const { blocks } = buildOpsBriefBlocks(briefData({ needsCraig: [] }));
    expect(JSON.stringify(blocks)).toContain('nothing 🎉');
  });

  it('flags the adoption gate state', () => {
    const over = buildOpsBriefBlocks(briefData());
    expect(JSON.stringify(over.blocks)).toContain('over target');
    const under = buildOpsBriefBlocks(
      briefData({ gate: { last7Days: 9, byActorTop: [] } })
    );
    expect(JSON.stringify(under.blocks)).toContain('below target');
  });
});

// ── ack patching ──

describe('applyAckToBlocks', () => {
  // Briefs sent before the live list still carry buttons in their stored blocks.
  const blocks = ['esc-a', 'esc-b'].map((id) => ({
    type: 'section',
    block_id: `ob-item:${id}`,
    text: { type: 'mrkdwn', text: `*${id}*` },
    accessory: { action_id: `ob:ack:${id}` },
  }));

  it('patches exactly the tapped block and strips its button', () => {
    const s = JSON.stringify(applyAckToBlocks(blocks, 'esc-a', 'Craig', '5:12 PM'));
    expect(s).toContain('Acknowledged by Craig 5:12 PM');
    expect(s).not.toContain('ob:ack:esc-a');
    expect(s).toContain('ob:ack:esc-b');
  });

  it('returns null when the block is absent', () => {
    expect(applyAckToBlocks(blocks, 'nope', 'Craig', '5:12 PM')).toBeNull();
  });
});

// ── memory ──

describe('mdToMrkdwn (Brief 1D)', () => {
  it('converts markdown bold/headings to Slack mrkdwn and strips citations', () => {
    const md = '## Policy\n\n**Escalations** go to Brody [1][2]. See ceilings [3, 4].';
    const out = mdToMrkdwn(md);
    expect(out).toContain('*Policy*');
    expect(out).toContain('*Escalations* go to Brody.');
    expect(out).not.toMatch(/\[\d/);
  });
});

describe('memory section (Brief 1D)', () => {
  const deepWithMemory = (memory: OpsBriefData['deepSections'] extends infer D
    ? D extends { memory?: infer M }
      ? M
      : never
    : never) =>
    briefData({
      deep: true,
      deepSections: {
        vendorTop: [],
        offenders: [],
        vendorStuck: { acceptedUnworkedCount: 1, scheduledDatePassedCount: 1, vsLastWeek: null },
        unbilled: { count: 0, oldestDays: null },
        turns: { openTurns: 0, medianDaysVacant: null },
        retype: { last7Days: 0, weeklyTarget: 40 },
        baseline: [],
        memory,
      },
    });

  it('renders the company-memory block with sanitized links', () => {
    const { blocks } = buildOpsBriefBlocks(
      deepWithMemory({
        answer: '**Escalations** route to Brody [1].',
        links: [{ title: 'Agent-OS Q&A <1>', url: 'https://github.com/x/y' }],
      })
    );
    const json = JSON.stringify(blocks);
    expect(json).toContain('From company memory');
    expect(json).toContain('*Escalations* route to Brody.');
    expect(json).toContain('<https://github.com/x/y|Agent-OS Q&A 1>');
  });

  it('omits the section when memory is null/absent', () => {
    const { blocks } = buildOpsBriefBlocks(deepWithMemory(null));
    expect(JSON.stringify(blocks)).not.toContain('From company memory');
  });
});
