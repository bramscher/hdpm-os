/**
 * Maintenance OS — the single write path for workflow columns.
 *
 * ALL mutations of work_orders workflow fields (stage, owner_name,
 * next_action_date, …) go through updateWorkOrderWorkflow(): it validates the
 * transition (lib/maintenance/workflow.ts), runs the closure gate when moving
 * to CLOSED, applies the patch, and records wo_event rows. The AppFolio mirror
 * sync never touches these columns (lib/maintenance/sync-rules.ts).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import type { ClosureGateContext, MaintWorkOrder } from './types';
import {
  autoPatchForTransition,
  evaluateClosureGate,
  validateTransition,
  type TransitionContext,
  type TransitionOptions,
  type WorkflowPatch,
  type WorkflowState,
} from './workflow';
import { recordEvent, recordEvents, type NewEvent } from './events';

export class WorkflowValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'WorkflowValidationError';
  }
}

// ============================================
// Closure-gate context gathering
// ============================================

/**
 * Load everything the closure gate + rule 6/7 checks need for one WO.
 * Docs (rule 7): photos = wo_event('photo') rows; time/materials = line items
 * on a linked non-void hdms_invoice (Wave 1 fidelity — thin by design).
 */
export async function gatherClosureGateContext(wo: MaintWorkOrder): Promise<{
  gateCtx: ClosureGateContext;
  transitionCtx: TransitionContext;
}> {
  const supabase = getSupabaseAdmin();

  const [invoicesRes, recsRes, eventsRes] = await Promise.all([
    supabase
      .from('hdms_invoices')
      .select('id, status, line_items')
      .eq('work_order_id', wo.id)
      .neq('status', 'void'),
    supabase
      .from('recommendation')
      .select('id')
      .eq('work_order_id', wo.id)
      .is('resolved_wo_id', null)
      .is('dismissed_reason', null),
    supabase
      .from('wo_event')
      .select('event_type, payload')
      .eq('work_order_id', wo.id)
      .in('event_type', ['photo', 'failed_access', 'scope_change', 'approval_decision']),
  ]);

  const invoices = invoicesRes.data ?? [];
  const openRecommendations = (recsRes.data ?? []).length;
  const events = eventsRes.data ?? [];

  const photoCount = events.filter((e) => e.event_type === 'photo').length;

  type LineItem = { type?: string };
  const lineItems: LineItem[] = invoices.flatMap((inv) =>
    Array.isArray(inv.line_items) ? (inv.line_items as LineItem[]) : []
  );
  const hasTime = lineItems.some((li) => li.type === 'labor');
  const hasMaterials = lineItems.some((li) => li.type === 'materials' || li.type === 'other');

  // Rule 5 documentation: a failed_access / scope_change event counts as
  // documented when its payload carries a note/description.
  const incidents = events.filter(
    (e) => e.event_type === 'failed_access' || e.event_type === 'scope_change'
  );
  const undocumentedIncidents = incidents.filter((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    return !p.note && !p.description && !p.reason;
  }).length;

  // Rule 6: scope changes need a matching APPROVED approval decision.
  const scopeChanges = events.filter((e) => e.event_type === 'scope_change').length;
  const approvedDecisions = events.filter((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    return e.event_type === 'approval_decision' && p.decision === 'APPROVED';
  }).length;
  const unapprovedScopeChanges = Math.max(0, scopeChanges - approvedDecisions);

  const gateCtx: ClosureGateContext = {
    verifiedAt: wo.verified_at,
    verifiedBy: wo.verified_by,
    hasInvoice: invoices.length > 0,
    openRecommendations,
    tenantPingSent: wo.tenant_ping_sent,
    undocumentedIncidents,
    preventiveScheduled: wo.preventive_scheduled,
  };

  return {
    gateCtx,
    transitionCtx: {
      docs: { photoCount, hasTime, hasMaterials },
      unapprovedScopeChanges,
      gate: evaluateClosureGate(gateCtx),
    },
  };
}

// ============================================
// The single write path
// ============================================

export interface UpdateWorkflowResult {
  workOrder: MaintWorkOrder;
}

/**
 * Validate + apply a workflow patch and record the audit events.
 * Throws WorkflowValidationError (with the full error list) when blocked —
 * API routes surface that as a 422.
 */
export async function updateWorkOrderWorkflow(
  workOrderId: string,
  patch: WorkflowPatch,
  actor: string,
  opts: TransitionOptions = {}
): Promise<UpdateWorkflowResult> {
  const supabase = getSupabaseAdmin();

  const { data: current, error: loadError } = await supabase
    .from('work_orders')
    .select('*')
    .eq('id', workOrderId)
    .single();

  if (loadError || !current) {
    throw new Error(`Work order not found: ${workOrderId}`);
  }
  const wo = current as MaintWorkOrder;

  // Gather gate/docs context only when the transition needs it.
  let ctx: TransitionContext = {};
  const targetStage = patch.stage ?? wo.stage;
  if (
    patch.stage &&
    patch.stage !== wo.stage &&
    (targetStage === 'BILL' || targetStage === 'CLOSED') &&
    !opts.systemOverride
  ) {
    ctx = (await gatherClosureGateContext(wo)).transitionCtx;
  }

  const state: WorkflowState = {
    stage: wo.stage,
    waiting_reason: wo.waiting_reason,
    owner_name: wo.owner_name,
    next_action_date: wo.next_action_date,
    priority_class: wo.priority_class,
    assigned_tech: wo.assigned_tech,
    vendor_id: wo.vendor_id,
    vendor_name: wo.vendor_name,
  };

  const errors = validateTransition(state, patch, ctx, opts);
  if (errors.length > 0) {
    throw new WorkflowValidationError(errors);
  }

  const auto = autoPatchForTransition(state, patch);
  const fullPatch: Record<string, unknown> = { ...auto, ...patch };

  // Stage bookkeeping
  const stageChanging = patch.stage !== undefined && patch.stage !== wo.stage;
  if (stageChanging) {
    if (patch.stage === 'CLOSED' && fullPatch.closed_at === undefined) {
      fullPatch.closed_at = new Date().toISOString();
    }
    if (patch.stage === 'VERIFY' && patch.verified_at === undefined && !opts.systemOverride) {
      // Entering VERIFY records who put it there unless explicitly provided.
      fullPatch.verified_by = fullPatch.verified_by ?? actor;
      fullPatch.verified_at = new Date().toISOString();
    }
  }
  if (patch.tenant_ping_sent === true && wo.tenant_ping_sent !== true) {
    fullPatch.tenant_ping_sent_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabase
    .from('work_orders')
    .update(fullPatch)
    .eq('id', workOrderId)
    .select('*')
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to update work order: ${updateError?.message}`);
  }

  // ── Audit events ──
  const events: NewEvent[] = [];
  if (stageChanging) {
    events.push({
      work_order_id: workOrderId,
      event_type: 'stage_change',
      payload: {
        from: wo.stage,
        to: patch.stage,
        ...(patch.waiting_reason ? { waiting_reason: patch.waiting_reason } : {}),
        ...(opts.systemOverride ? { system_override: true } : {}),
      },
      actor,
    });
  }
  if (patch.owner_name !== undefined && patch.owner_name !== wo.owner_name) {
    events.push({
      work_order_id: workOrderId,
      event_type: 'assign',
      payload: { from: wo.owner_name, to: patch.owner_name, field: 'owner_name' },
      actor,
    });
  }
  if (patch.assigned_tech !== undefined && patch.assigned_tech !== wo.assigned_tech) {
    events.push({
      work_order_id: workOrderId,
      event_type: 'assign',
      payload: { from: wo.assigned_tech, to: patch.assigned_tech, field: 'assigned_tech' },
      actor,
    });
  }
  if (patch.next_action_date !== undefined && patch.next_action_date !== wo.next_action_date) {
    events.push({
      work_order_id: workOrderId,
      event_type: 'schedule',
      payload: { from: wo.next_action_date, to: patch.next_action_date, field: 'next_action_date' },
      actor,
    });
  }
  if (patch.tenant_ping_sent === true && wo.tenant_ping_sent !== true) {
    events.push({ work_order_id: workOrderId, event_type: 'tenant_ping', payload: {}, actor });
  }
  await recordEvents(events);

  return { workOrder: updated as MaintWorkOrder };
}

/**
 * Record a failed-access incident (tripwire #5): logs the event and
 * auto-returns the WO to SCHEDULED with a new required next-action date.
 */
export async function recordFailedAccess(
  workOrderId: string,
  note: string,
  newNextActionDate: string,
  actor: string
): Promise<UpdateWorkflowResult> {
  await recordEvent({
    work_order_id: workOrderId,
    event_type: 'failed_access',
    payload: { note },
    actor,
  });
  return updateWorkOrderWorkflow(
    workOrderId,
    { stage: 'SCHEDULED', next_action_date: newNextActionDate },
    actor,
    // The WO may be IN_PROGRESS (allowed) or elsewhere; failed access always
    // returns to SCHEDULED per spec, so allow it regardless of current stage.
    { systemOverride: false }
  );
}
