import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  autoPatchForTransition,
  evaluateClosureGate,
  validateTransition,
  type WorkflowState,
} from '../workflow';
import type { ClosureGateContext } from '../types';

// A healthy in-flight WO to base cases on
const base: WorkflowState = {
  stage: 'TRIAGED',
  waiting_reason: null,
  owner_name: 'Cheryl',
  next_action_date: '2026-07-03',
  priority_class: 'P3',
  assigned_tech: 'Alberto',
  vendor_id: null,
  vendor_name: null,
};

const passingGate: ClosureGateContext = {
  verifiedAt: '2026-07-01T00:00:00Z',
  verifiedBy: 'Alberto',
  hasInvoice: true,
  openRecommendations: 0,
  tenantPingSent: true,
  undocumentedIncidents: 0,
  preventiveScheduled: null,
};

const fullDocs = { photoCount: 2, hasTime: true, hasMaterials: true };

describe('transition matrix', () => {
  it('allows the happy path NEW→…→CLOSED', () => {
    expect(ALLOWED_TRANSITIONS.NEW).toContain('TRIAGED');
    expect(ALLOWED_TRANSITIONS.TRIAGED).toContain('SCHEDULED');
    expect(ALLOWED_TRANSITIONS.SCHEDULED).toContain('IN_PROGRESS');
    expect(ALLOWED_TRANSITIONS.IN_PROGRESS).toContain('VERIFY');
    expect(ALLOWED_TRANSITIONS.VERIFY).toContain('BILL');
    expect(ALLOWED_TRANSITIONS.BILL).toContain('CLOSED');
  });

  it('CLOSED is terminal', () => {
    expect(ALLOWED_TRANSITIONS.CLOSED).toHaveLength(0);
    const errors = validateTransition(
      { ...base, stage: 'CLOSED' },
      { stage: 'IN_PROGRESS' }
    );
    expect(errors.some((e) => e.includes('not allowed'))).toBe(true);
  });

  it('rejects skipping stages (NEW → BILL)', () => {
    const errors = validateTransition({ ...base, stage: 'NEW' }, { stage: 'BILL' }, { docs: fullDocs });
    expect(errors.some((e) => e.includes('not allowed'))).toBe(true);
  });

  it('failed access: IN_PROGRESS → SCHEDULED is allowed (tripwire #5)', () => {
    const errors = validateTransition(
      { ...base, stage: 'IN_PROGRESS' },
      { stage: 'SCHEDULED', next_action_date: '2026-07-05' }
    );
    expect(errors).toHaveLength(0);
  });

  it('systemOverride allows jump to VERIFY from any stage', () => {
    const errors = validateTransition(
      { ...base, stage: 'NEW' },
      { stage: 'VERIFY' },
      {},
      { systemOverride: true }
    );
    expect(errors).toHaveLength(0);
  });

  it('systemOverride allows CLOSED without gate (AppFolio cancel)', () => {
    const errors = validateTransition(
      { ...base, stage: 'NEW' },
      { stage: 'CLOSED' },
      {},
      { systemOverride: true }
    );
    expect(errors).toHaveLength(0);
  });
});

describe('WAITING_ON invariants', () => {
  it('requires waiting_reason', () => {
    const errors = validateTransition(base, { stage: 'WAITING_ON' });
    expect(errors.some((e) => e.includes('waiting_reason'))).toBe(true);
  });

  it('passes with a valid reason', () => {
    const errors = validateTransition(base, { stage: 'WAITING_ON', waiting_reason: 'PARTS' });
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid reasons', () => {
    const errors = validateTransition(base, {
      stage: 'WAITING_ON',
      // @ts-expect-error — invalid on purpose
      waiting_reason: 'LAZINESS',
    });
    expect(errors.some((e) => e.includes('Invalid waiting_reason'))).toBe(true);
  });

  it('auto-clears waiting_reason when leaving WAITING_ON', () => {
    const auto = autoPatchForTransition(
      { ...base, stage: 'WAITING_ON', waiting_reason: 'PARTS' },
      { stage: 'IN_PROGRESS' }
    );
    expect(auto.waiting_reason).toBeNull();
  });

  it('does not clear waiting_reason when explicitly re-set', () => {
    const auto = autoPatchForTransition(
      { ...base, stage: 'WAITING_ON', waiting_reason: 'PARTS' },
      { stage: 'WAITING_ON', waiting_reason: 'VENDOR' }
    );
    expect(auto.waiting_reason).toBeUndefined();
  });
});

describe('owner + next-action-date invariants', () => {
  it('open WO cannot drop its owner', () => {
    const errors = validateTransition(base, { owner_name: null });
    expect(errors.some((e) => e.includes('named HDPM owner'))).toBe(true);
  });

  it('open WO cannot drop its next_action_date', () => {
    const errors = validateTransition(base, { next_action_date: null });
    expect(errors.some((e) => e.includes('next_action_date'))).toBe(true);
  });
});

describe('soft rules', () => {
  it('priority_class required from TRIAGED onward', () => {
    const errors = validateTransition(
      { ...base, stage: 'NEW', priority_class: null },
      { stage: 'TRIAGED' }
    );
    expect(errors.some((e) => e.includes('priority_class'))).toBe(true);
  });

  it('vendor or tech required from SCHEDULED onward', () => {
    const errors = validateTransition(
      { ...base, assigned_tech: null, vendor_id: null, vendor_name: null },
      { stage: 'SCHEDULED' }
    );
    expect(errors.some((e) => e.includes('vendor or tech'))).toBe(true);
  });

  it('vendor_name alone satisfies the assignment rule', () => {
    const errors = validateTransition(
      { ...base, assigned_tech: null, vendor_name: 'Fine Line Maintenance' },
      { stage: 'SCHEDULED' }
    );
    expect(errors).toHaveLength(0);
  });
});

describe('rule 7 — VERIFY → BILL doc block', () => {
  const verify: WorkflowState = { ...base, stage: 'VERIFY' };

  it('blocks BILL with zero photos', () => {
    const errors = validateTransition(verify, { stage: 'BILL' }, { docs: { ...fullDocs, photoCount: 0 } });
    expect(errors.some((e) => e.includes('no photos'))).toBe(true);
  });

  it('blocks BILL without time or materials', () => {
    const errors = validateTransition(verify, { stage: 'BILL' }, {
      docs: { photoCount: 1, hasTime: false, hasMaterials: false },
    });
    expect(errors.some((e) => e.includes('no time'))).toBe(true);
    expect(errors.some((e) => e.includes('materials'))).toBe(true);
  });

  it('blocks BILL when docs context is missing entirely', () => {
    const errors = validateTransition(verify, { stage: 'BILL' });
    expect(errors.some((e) => e.includes('documentation status unknown'))).toBe(true);
  });

  it('rule 6: blocks BILL with unapproved scope changes', () => {
    const errors = validateTransition(verify, { stage: 'BILL' }, {
      docs: fullDocs,
      unapprovedScopeChanges: 1,
    });
    expect(errors.some((e) => e.includes('scope change'))).toBe(true);
  });

  it('allows BILL with full docs and no scope issues', () => {
    const errors = validateTransition(verify, { stage: 'BILL' }, { docs: fullDocs });
    expect(errors).toHaveLength(0);
  });
});

describe('closure gate', () => {
  it('passes with all six conditions met', () => {
    const result = evaluateClosureGate(passingGate);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('fails each condition independently', () => {
    const cases: [Partial<ClosureGateContext>, number][] = [
      [{ verifiedAt: null }, 1],
      [{ verifiedBy: null }, 1],
      [{ hasInvoice: false }, 2],
      [{ openRecommendations: 2 }, 3],
      [{ tenantPingSent: false }, 4],
      [{ undocumentedIncidents: 1 }, 5],
      [{ preventiveScheduled: false }, 6],
    ];
    for (const [override, condition] of cases) {
      const result = evaluateClosureGate({ ...passingGate, ...override });
      expect(result.passed).toBe(false);
      expect(result.failures.map((f) => f.condition)).toContain(condition);
    }
  });

  it('preventive tri-state: null = N/A passes, true passes, false blocks', () => {
    expect(evaluateClosureGate({ ...passingGate, preventiveScheduled: null }).passed).toBe(true);
    expect(evaluateClosureGate({ ...passingGate, preventiveScheduled: true }).passed).toBe(true);
    expect(evaluateClosureGate({ ...passingGate, preventiveScheduled: false }).passed).toBe(false);
  });

  it('BILL → CLOSED blocked without gate evaluation', () => {
    const errors = validateTransition({ ...base, stage: 'BILL' }, { stage: 'CLOSED' });
    expect(errors.some((e) => e.includes('closure gate not evaluated'))).toBe(true);
  });

  it('BILL → CLOSED lists every failed condition', () => {
    const gate = evaluateClosureGate({
      ...passingGate,
      hasInvoice: false,
      tenantPingSent: false,
    });
    const errors = validateTransition({ ...base, stage: 'BILL' }, { stage: 'CLOSED' }, { gate });
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.includes('condition 2'))).toBe(true);
    expect(errors.some((e) => e.includes('condition 4'))).toBe(true);
  });

  it('BILL → CLOSED passes with a passing gate', () => {
    const gate = evaluateClosureGate(passingGate);
    const errors = validateTransition({ ...base, stage: 'BILL' }, { stage: 'CLOSED' }, { gate });
    expect(errors).toHaveLength(0);
  });
});
