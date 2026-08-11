import { describe, it, expect } from 'vitest';
import type { JacketStep, JacketTemplate } from '../types';
import {
  resolveDueRule,
  instantiateSteps,
  advanceStep,
  deriveAttention,
  currentSeatId,
  isJacketComplete,
  leadStep,
} from '../engine';

function step(overrides: Partial<JacketStep> = {}): JacketStep {
  return {
    id: 's',
    jacket_id: 'j1',
    ordinal: 0,
    track: null,
    label: 'step',
    seat_id: 'seat-a',
    requires: 'tap',
    external_match: null,
    due_rule: null,
    due_on: null,
    state: 'pending',
    done_at: null,
    done_by: null,
    ...overrides,
  };
}

describe('resolveDueRule', () => {
  // 2026-08-11 is a Tuesday.
  const anchors = { created: new Date('2026-08-11T15:00:00Z') };
  it('adds business days, skipping the weekend', () => {
    expect(resolveDueRule('created+3bd', anchors)).toBe('2026-08-14'); // Tue -> Fri
    expect(resolveDueRule('created+4bd', anchors)).toBe('2026-08-17'); // Tue -> next Mon
  });
  it('adds calendar days', () => {
    expect(resolveDueRule('created+14d', anchors)).toBe('2026-08-25');
  });
  it('resolves a bare anchor to its own date', () => {
    expect(resolveDueRule('created', anchors)).toBe('2026-08-11');
  });
  it('returns null for unset, unknown-anchor, or malformed rules', () => {
    expect(resolveDueRule(null, anchors)).toBeNull();
    expect(resolveDueRule('nope+1bd', anchors)).toBeNull();
    expect(resolveDueRule('garbage', anchors)).toBeNull();
  });
});

const linearTemplate: JacketTemplate = {
  id: 't1',
  org_id: 'org1',
  key: 'move-out',
  title: 'Move-out',
  color: 'yellow',
  active: true,
  steps: [
    { label: 'Save M/O date', seat_role: 'coordinator', due_rule: 'created+2bd' },
    { label: 'Schedule inspection', seat_role: 'inspector', requires: 'external_event' },
    { label: 'Close out', seat_role: 'finance' },
  ],
};

const seatFor = (role: string | null | undefined) =>
  role ? `seat-${role}` : null;

function instantiate(tpl = linearTemplate, created = new Date('2026-08-11T00:00:00Z')) {
  return instantiateSteps(tpl, {
    jacketId: 'j1',
    anchors: { created },
    resolveSeat: seatFor,
    newId: (o) => `step-${o}`,
  });
}

describe('instantiateSteps', () => {
  it('activates exactly the first step for a linear template (§4 rule 1)', () => {
    const steps = instantiate();
    expect(steps.map((s) => s.state)).toEqual(['active', 'pending', 'pending']);
    expect(currentSeatId(steps)).toBe('seat-coordinator');
    expect(steps[0].due_on).toBe('2026-08-13'); // Tue + 2bd = Thu
    expect(steps[0].seat_id).toBe('seat-coordinator');
  });

  it('activates the first step of EACH parallel track (App A.1)', () => {
    const tpl: JacketTemplate = {
      ...linearTemplate,
      steps: [
        { label: 'T-a1', track: 'TENANT', seat_role: 'coord' },
        { label: 'T-a2', track: 'TENANT', seat_role: 'coord' },
        { label: 'O-b1', track: 'OWNER', seat_role: 'pm' },
      ],
    };
    const steps = instantiate(tpl);
    expect(steps.map((s) => s.state)).toEqual(['active', 'pending', 'active']);
  });
});

describe('advanceStep (the workflow engine)', () => {
  it('routes the jacket to the next step on completion', () => {
    const steps = instantiate();
    const r = advanceStep(steps, 'step-0', { actor: 'agent:x', at: '2026-08-11T10:00:00Z' });
    expect(r.activatedStepId).toBe('step-1');
    expect(r.current_seat_id).toBe('seat-inspector');
    expect(r.jacket_done).toBe(false);
    // input not mutated
    expect(steps[0].state).toBe('active');
  });

  it('records actor + timestamp and marks done', () => {
    const steps = instantiate();
    const r = advanceStep(steps, 'step-0', { actor: 'alice', at: '2026-08-11T10:00:00Z' });
    const done = r.steps.find((s) => s.id === 'step-0')!;
    expect(done.state).toBe('done');
    expect(done.done_by).toBe('alice');
    expect(done.done_at).toBe('2026-08-11T10:00:00Z');
  });

  it('completes the jacket when the last step finishes', () => {
    let steps = instantiate();
    steps = advanceStep(steps, 'step-0', { actor: 'a', at: 'T' }).steps;
    steps = advanceStep(steps, 'step-1', { actor: 'a', at: 'T' }).steps;
    const r = advanceStep(steps, 'step-2', { actor: 'a', at: 'T' });
    expect(r.jacket_done).toBe(true);
    expect(r.current_seat_id).toBeNull();
    expect(isJacketComplete(r.steps)).toBe(true);
  });

  it('advances tracks independently', () => {
    const tpl: JacketTemplate = {
      ...linearTemplate,
      steps: [
        { label: 'A1', track: 'A', seat_role: 'a' },
        { label: 'A2', track: 'A', seat_role: 'a' },
        { label: 'B1', track: 'B', seat_role: 'b' },
      ],
    };
    const steps = instantiate(tpl);
    const r = advanceStep(steps, 'step-0', { actor: 'x', at: 'T' }); // finish A1
    expect(r.steps.find((s) => s.id === 'step-1')!.state).toBe('active'); // A2 activates
    expect(r.steps.find((s) => s.id === 'step-2')!.state).toBe('active'); // B1 untouched
    expect(r.jacket_done).toBe(false);
  });

  it('skip routes forward too, and is idempotent on terminal steps', () => {
    const steps = instantiate();
    const r = advanceStep(steps, 'step-0', { actor: 'x', at: 'T', outcome: 'skipped' });
    expect(r.steps[0].state).toBe('skipped');
    expect(r.activatedStepId).toBe('step-1');
    const again = advanceStep(r.steps, 'step-0', { actor: 'y', at: 'T2' });
    expect(again.steps[0].done_by).toBe('x'); // unchanged
    expect(again.activatedStepId).toBeNull();
  });
});

describe('deriveAttention', () => {
  const today = '2026-08-11';
  it('is none for a fresh on-track jacket', () => {
    expect(deriveAttention([step({ state: 'active' })], { today })).toBe('none');
  });
  it('is now when a step is overdue', () => {
    expect(deriveAttention([step({ state: 'active', due_on: '2026-08-10' })], { today })).toBe('now');
  });
  it('is now when a step is blocked', () => {
    expect(deriveAttention([step({ state: 'blocked' })], { today })).toBe('now');
  });
  it('is soon when waiting on an external event', () => {
    expect(deriveAttention([step({ state: 'active', requires: 'external_event' })], { today })).toBe('soon');
  });
  it('is soon when due within the window (not yet overdue)', () => {
    expect(deriveAttention([step({ state: 'active', due_on: '2026-08-12' })], { today })).toBe('soon');
  });
  it('ignores terminal steps', () => {
    expect(deriveAttention([step({ state: 'done', due_on: '2026-08-01' })], { today })).toBe('none');
  });
  it('honors watcher hits, now beats soon', () => {
    expect(deriveAttention([step({ state: 'active' })], { today, watcher: { soon: true } })).toBe('soon');
    expect(deriveAttention([step({ state: 'active' })], { today, watcher: { now: true } })).toBe('now');
  });
});

describe('leadStep', () => {
  it('is the lowest-ordinal active step', () => {
    const steps = [
      step({ id: 'x', ordinal: 2, state: 'active', seat_id: 'seat-x' }),
      step({ id: 'y', ordinal: 1, state: 'active', seat_id: 'seat-y' }),
      step({ id: 'z', ordinal: 0, state: 'done' }),
    ];
    expect(leadStep(steps)?.id).toBe('y');
  });
});
