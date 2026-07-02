import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { listEvents } from '@/lib/maintenance/events';
import {
  gatherClosureGateContext,
  updateWorkOrderWorkflow,
  WorkflowValidationError,
} from '@/lib/maintenance/workflow-db';
import { evaluateClosureGate } from '@/lib/maintenance/workflow';
import type { MaintWorkOrder } from '@/lib/maintenance/types';
import type { WorkflowPatch } from '@/lib/maintenance/workflow';

/**
 * GET /api/maintenance/work-orders/:id
 *
 * Work order detail: mirror + workflow fields, full event timeline,
 * sub-entities (assignments, approvals, recommendations, turn) and a live
 * closure-gate evaluation so the UI can render the six-condition checklist.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const supabase = getSupabaseAdmin();

    const { data: workOrder, error } = await supabase
      .from('work_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !workOrder) {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
    }
    const wo = workOrder as MaintWorkOrder;

    const [events, assignmentsRes, approvalsRes, recommendationsRes, turnRes, gate] =
      await Promise.all([
        listEvents(id),
        supabase.from('vendor_assignment').select('*, vendor(name)').eq('work_order_id', id),
        supabase.from('approval').select('*').eq('work_order_id', id),
        supabase.from('recommendation').select('*').eq('work_order_id', id),
        supabase.from('turn').select('*').eq('work_order_id', id).maybeSingle(),
        gatherClosureGateContext(wo),
      ]);

    return NextResponse.json({
      workOrder: wo,
      events,
      assignments: assignmentsRes.data ?? [],
      approvals: approvalsRes.data ?? [],
      recommendations: recommendationsRes.data ?? [],
      turn: turnRes.data ?? null,
      closureGate: evaluateClosureGate(gate.gateCtx),
      docs: gate.transitionCtx.docs,
    });
  } catch (error) {
    console.error('[Maintenance] WO detail error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load work order';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Whitelist of workflow fields a PATCH may set. */
const PATCHABLE_FIELDS = [
  'stage',
  'waiting_reason',
  'owner_name',
  'next_action_date',
  'priority_class',
  'assigned_tech',
  'tenant_ping_sent',
  'preventive_scheduled',
  'aging_reason',
  'is_turn',
  'origin',
  'verified_by',
  'verified_at',
] as const;

/**
 * PATCH /api/maintenance/work-orders/:id
 *
 * The single workflow write path. Validates the transition (state machine,
 * WAITING_ON reason, rule 6/7 blocks, six-condition closure gate) and records
 * wo_event rows. Blocked transitions return 422 with the full error list.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const patch: WorkflowPatch = {};
    for (const field of PATCHABLE_FIELDS) {
      if (field in body) {
        (patch as Record<string, unknown>)[field] = body[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No patchable fields in request' }, { status: 400 });
    }

    const { workOrder } = await updateWorkOrderWorkflow(id, patch, session.actor);
    return NextResponse.json({ workOrder });
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return NextResponse.json(
        { error: 'Transition blocked', errors: error.errors },
        { status: 422 }
      );
    }
    console.error('[Maintenance] WO patch error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update work order';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
