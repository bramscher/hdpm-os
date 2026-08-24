import { describe, it, expect } from 'vitest';
import type { Jacket, JacketStep, JacketTemplate } from '../types';
import { instantiateSteps } from '../engine';
import { buildCardModel, toSlackBlocks, parseStepActionId, stepActionId } from '../card';
import { applyJacketAction, matchExternalEvent } from '../interact';

const template: JacketTemplate = {
  id: 't1', org_id: 'o', key: 'move-out', title: 'Move-out', color: 'yellow', active: true,
  steps: [
    { label: 'Schedule turnover clean', seat_role: 'coord', requires: 'tap' },
    {
      label: 'Confirm clean scheduled',
      seat_role: 'coord',
      requires: 'external_event',
      external_match: { source: 'appfolio', event_type: 'wo_scheduled', subject_key: 'wo-123' },
    },
  ],
};

function makeJacket(overrides: Partial<Jacket> = {}): Jacket {
  return {
    id: 'j1', org_id: 'o', template_id: 't1', title: '8/14 · 123 Elm #4',
    color: 'yellow', attention: 'now', current_seat_id: 'seat-coord',
    subject_type: 'work_order', subject_id: 'wo-123', status: 'open',
    created_at: '2026-08-11T00:00:00Z', closed_at: null, ...overrides,
  };
}

function makeSteps(): JacketStep[] {
  return instantiateSteps(template, {
    jacketId: 'j1',
    anchors: { created: new Date('2026-08-11T00:00:00Z') },
    resolveSeat: (r) => (r ? `seat-${r}` : null),
    newId: (o) => `step-${o}`,
  });
}

const ctx = { at: '2026-08-11T10:00:00Z', today: '2026-08-11' };

describe('card model (§7 one line, one color, one button)', () => {
  it('shows the emoji, title, active step label, and exactly one action', () => {
    const card = buildCardModel(makeJacket(), makeSteps(), { today: '2026-08-11' });
    expect(card.collapsed).toBe(false);
    expect(card.emoji).toBe('🔴');
    expect(card.subtitle).toBe('Schedule turnover clean');
    expect(card.action?.action_id).toBe(stepActionId('j1', 'step-0'));
  });

  it('collapses a done jacket to a single ✅ line, no action', () => {
    const card = buildCardModel(makeJacket({ status: 'done' }), makeSteps(), { resolution: 'clean scheduled Thu' });
    expect(card.collapsed).toBe(true);
    expect(card.emoji).toBe('✅');
    expect(card.action).toBeNull();
  });

  it('slack blocks: one section open→ + one actions block; collapsed → section only', () => {
    const open = toSlackBlocks(buildCardModel(makeJacket(), makeSteps(), { today: '2026-08-11' }));
    expect(open.map((b) => b.type)).toEqual(['section', 'actions']);
    const done = toSlackBlocks(buildCardModel(makeJacket({ status: 'done' }), makeSteps()));
    expect(done.map((b) => b.type)).toEqual(['section']);
  });

  it('action id round-trips', () => {
    expect(parseStepActionId(stepActionId('j1', 'step-0'))).toEqual({ jacket_id: 'j1', step_id: 'step-0' });
    expect(parseStepActionId('garbage')).toBeNull();
  });
});

describe('the self-closing loop (§7)', () => {
  it('a tap advances the jacket and updates the card', () => {
    const r = applyJacketAction(makeJacket(), makeSteps(), { kind: 'tap', step_id: 'step-0', actor: 'alice' }, ctx);
    expect(r.transition).toMatchObject({ type: 'advanced', completed_step_id: 'step-0', activated_step_id: 'step-1', by: 'alice' });
    expect(r.steps.find((s) => s.id === 'step-0')!.state).toBe('done');
    expect(r.card.subtitle).toBe('Confirm clean scheduled');
  });

  it('an external event closes the matching active step with no human ack (§7 step 3)', () => {
    // advance past step-0 so step-1 (external) is active
    const afterTap = applyJacketAction(makeJacket(), makeSteps(), { kind: 'tap', step_id: 'step-0', actor: 'alice' }, ctx);
    const event = { source: 'appfolio', event_type: 'wo_scheduled', subject_key: 'wo-123' };
    expect(matchExternalEvent(afterTap.steps, event)?.id).toBe('step-1');

    const r = applyJacketAction(afterTap.jacket, afterTap.steps, { kind: 'external', event }, ctx);
    expect(r.transition.type).toBe('completed');
    expect(r.steps.find((s) => s.id === 'step-1')!.done_by).toBe('system:appfolio');
    expect(r.jacket.status).toBe('done');
    expect(r.card.collapsed).toBe(true); // card collapses in place
  });

  it('a tap on a not-yet-active (pending) step is a no-op — never skips ahead', () => {
    // step-1 is still 'pending' (step-0 hasn't been completed). Tapping it must
    // not complete it or activate anything.
    const r = applyJacketAction(makeJacket(), makeSteps(), { kind: 'tap', step_id: 'step-1', actor: 'mallory' }, ctx);
    expect(r.transition.type).toBe('noop');
    expect(r.steps.find((s) => s.id === 'step-1')!.state).toBe('pending'); // untouched — still not reached
    expect(r.steps.find((s) => s.id === 'step-0')!.state).toBe('active'); // step-0 still the live one
  });

  it('a replayed tap on an already-done step is a no-op (not a phantom advance)', () => {
    const afterTap = applyJacketAction(makeJacket(), makeSteps(), { kind: 'tap', step_id: 'step-0', actor: 'alice' }, ctx);
    const replay = applyJacketAction(afterTap.jacket, afterTap.steps, { kind: 'tap', step_id: 'step-0', actor: 'alice' }, ctx);
    expect(replay.transition.type).toBe('noop');
    expect(replay.steps.find((s) => s.id === 'step-1')!.state).toBe('active'); // unchanged by the replay
  });

  it('a non-matching external event is a no-op', () => {
    const afterTap = applyJacketAction(makeJacket(), makeSteps(), { kind: 'tap', step_id: 'step-0', actor: 'alice' }, ctx);
    const r = applyJacketAction(afterTap.jacket, afterTap.steps, {
      kind: 'external',
      event: { source: 'appfolio', event_type: 'wo_scheduled', subject_key: 'other-wo' },
    }, ctx);
    expect(r.transition.type).toBe('noop');
    expect(r.steps.find((s) => s.id === 'step-1')!.state).toBe('active'); // untouched
  });
});
