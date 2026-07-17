import { describe, it, expect } from 'vitest';
import { routeWorkflowPatch, type RouteWorkflowState } from '../route-publish';
import { validateTransition, type WorkflowState } from '../workflow';

const base: RouteWorkflowState = {
  stage: 'TRIAGED',
  owner_name: 'Cheryl',
  priority_class: 'P3',
  assigned_tech: null,
  vendor_id: null,
  vendor_name: null,
};

const asState = (wo: RouteWorkflowState): WorkflowState => ({
  ...wo,
  waiting_reason: wo.stage === 'WAITING_ON' ? 'PARTS' : null,
  next_action_date: null,
});

describe('routeWorkflowPatch', () => {
  it('advances TRIAGED to SCHEDULED with date + tech', () => {
    const patch = routeWorkflowPatch(base, '2026-07-17', 'Alberto');
    expect(patch).toEqual({
      next_action_date: '2026-07-17',
      assigned_tech: 'Alberto',
      stage: 'SCHEDULED',
    });
    expect(validateTransition(asState(base), patch)).toEqual([]);
  });

  it('advances WAITING_ON and IN_PROGRESS to SCHEDULED', () => {
    for (const stage of ['WAITING_ON', 'IN_PROGRESS'] as const) {
      const wo = { ...base, stage };
      const patch = routeWorkflowPatch(wo, '2026-07-17', 'Brody');
      expect(patch.stage).toBe('SCHEDULED');
      expect(validateTransition(asState(wo), patch)).toEqual([]);
    }
  });

  it('leaves NEW in place (graph forbids NEW → SCHEDULED) but still dates it', () => {
    const wo = { ...base, stage: 'NEW' as const, priority_class: null };
    const patch = routeWorkflowPatch(wo, '2026-07-17', 'Alberto');
    expect(patch.stage).toBeUndefined();
    expect(patch.next_action_date).toBe('2026-07-17');
    expect(validateTransition(asState(wo), patch)).toEqual([]);
  });

  it('skips the stage advance when priority is missing (required from TRIAGED on)', () => {
    const wo = { ...base, priority_class: null };
    const patch = routeWorkflowPatch(wo, '2026-07-17', 'Alberto');
    expect(patch.stage).toBeUndefined();
    expect(validateTransition(asState(wo), patch)).toEqual([]);
  });

  it('does not re-set stage on an already SCHEDULED work order', () => {
    const wo = { ...base, stage: 'SCHEDULED' as const };
    const patch = routeWorkflowPatch(wo, '2026-07-18', 'Alberto');
    expect(patch.stage).toBeUndefined();
    expect(patch.next_action_date).toBe('2026-07-18');
    expect(validateTransition(asState(wo), patch)).toEqual([]);
  });

  it('backfills a missing owner with the tech so the open-WO invariant holds', () => {
    const wo = { ...base, owner_name: null };
    const patch = routeWorkflowPatch(wo, '2026-07-17', 'Brody');
    expect(patch.owner_name).toBe('Brody');
    expect(validateTransition(asState(wo), patch)).toEqual([]);
  });

  it('never routes VERIFY/BILL/CLOSED stages forward', () => {
    for (const stage of ['VERIFY', 'BILL', 'CLOSED'] as const) {
      const patch = routeWorkflowPatch({ ...base, stage }, '2026-07-17', 'Alberto');
      expect(patch.stage).toBeUndefined();
    }
  });
});
