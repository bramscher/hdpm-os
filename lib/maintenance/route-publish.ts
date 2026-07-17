/**
 * Maintenance OS — pure logic for publishing a day route.
 *
 * Publishing a route is a scheduling decision: every routed WO gets the route
 * date as its next_action_date and the crew tech assigned. The stage advances
 * to SCHEDULED only when the workflow graph + soft rules permit it — the patch
 * is applied through updateWorkOrderWorkflow, so we precompute a patch that
 * will validate rather than fail the whole publish on one stuck WO.
 */

import { ALLOWED_TRANSITIONS, type WorkflowPatch, type WorkflowState } from './workflow';

export type RouteWorkflowState = Pick<
  WorkflowState,
  'stage' | 'owner_name' | 'priority_class' | 'assigned_tech' | 'vendor_id' | 'vendor_name'
>;

/**
 * Patch for one routed WO. Always: next_action_date = route date, tech
 * assigned, owner backfilled to the tech when missing (open WOs must carry an
 * owner). Stage → SCHEDULED only when the single-step transition is allowed
 * AND priority is set (required from TRIAGED onward) — otherwise the WO keeps
 * its stage and just gets the date (e.g. NEW stays in the triage pool).
 */
export function routeWorkflowPatch(wo: RouteWorkflowState, routeDate: string, tech: string): WorkflowPatch {
  const patch: WorkflowPatch = {
    next_action_date: routeDate,
    assigned_tech: tech,
  };
  if (!wo.owner_name) patch.owner_name = tech;

  const canSchedule =
    wo.stage !== 'SCHEDULED' &&
    (ALLOWED_TRANSITIONS[wo.stage] ?? []).includes('SCHEDULED') &&
    Boolean(wo.priority_class);
  if (canSchedule) patch.stage = 'SCHEDULED';

  return patch;
}
