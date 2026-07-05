import { describe, it, expect } from 'vitest';
import type { AiTriage } from '../ai-triage';
import { proposalFrom } from '../triage-batch';

// 2026-07-02 = Thursday
const THU = new Date('2026-07-02T15:00:00Z');
// 2026-07-03 = Friday (next business day Monday 7/6)
const FRI = new Date('2026-07-03T15:00:00Z');

function triage(overrides: Partial<AiTriage> = {}): AiTriage {
  return {
    summary: 'Test summary',
    priority: { recommended: 'P3', rationale: 'routine', escalate_if: [] },
    risk_flags: [],
    blocker: { classification: 'NONE', detail: '' },
    next_action: 'Do the thing',
    draft_message: { audience: 'tenant', subject: 's', body: 'b' },
    appfolio_checklist: [],
    ...overrides,
  };
}

const wo = (stage = 'TRIAGED', appfolio_status = 'Assigned') =>
  ({ stage, appfolio_status }) as Parameters<typeof proposalFrom>[1];

describe('proposalFrom — priority → next-action date (SLA runway)', () => {
  it('P1 = act today', () => {
    const p = proposalFrom(triage({ priority: { recommended: 'P1', rationale: '', escalate_if: [] } }), wo(), THU);
    expect(p.proposed_priority_class).toBe('P1');
    expect(p.proposed_next_action_date).toBe('2026-07-02');
  });

  it('P2 = +2 business days', () => {
    const p = proposalFrom(triage({ priority: { recommended: 'P2', rationale: '', escalate_if: [] } }), wo(), THU);
    expect(p.proposed_next_action_date).toBe('2026-07-06'); // Thu → Fri → Mon
  });

  it('P3 = +5 business days, skipping the weekend', () => {
    const p = proposalFrom(triage(), wo(), THU);
    expect(p.proposed_next_action_date).toBe('2026-07-09'); // Fri,Mon,Tue,Wed,Thu
  });

  it('P4 = +10 business days', () => {
    const p = proposalFrom(triage({ priority: { recommended: 'P4', rationale: '', escalate_if: [] } }), wo(), FRI);
    expect(p.proposed_next_action_date).toBe('2026-07-17');
  });
});

describe('proposalFrom — owner rules', () => {
  it('defaults to Cheryl', () => {
    expect(proposalFrom(triage(), wo(), THU).proposed_owner_name).toBe('Cheryl');
  });

  it('OWNER blocker → Jen', () => {
    const t = triage({ blocker: { classification: 'OWNER', detail: 'owner deciding' } });
    expect(proposalFrom(t, wo(), THU).proposed_owner_name).toBe('Jen');
  });

  it('estimate statuses → Jen regardless of blocker', () => {
    expect(proposalFrom(triage(), wo('WAITING_ON', 'Estimate Requested'), THU).proposed_owner_name).toBe('Jen');
    expect(proposalFrom(triage(), wo('WAITING_ON', 'Estimated'), THU).proposed_owner_name).toBe('Jen');
  });
});

describe('proposalFrom — stage rule', () => {
  it('NEW → proposes TRIAGED', () => {
    expect(proposalFrom(triage(), wo('NEW', 'New'), THU).proposed_stage).toBe('TRIAGED');
  });

  it('any other stage → unchanged (null)', () => {
    expect(proposalFrom(triage(), wo('TRIAGED'), THU).proposed_stage).toBeNull();
    expect(proposalFrom(triage(), wo('SCHEDULED', 'Scheduled'), THU).proposed_stage).toBeNull();
  });
});
