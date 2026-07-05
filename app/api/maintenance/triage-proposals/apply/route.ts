import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import {
  updateWorkOrderWorkflow,
  WorkflowValidationError,
} from '@/lib/maintenance/workflow-db';
import type { WorkflowPatch } from '@/lib/maintenance/workflow';
import type { TriageProposal } from '@/lib/maintenance/types';

export const maxDuration = 300;

interface Overrides {
  priority_class?: string;
  next_action_date?: string;
  owner_name?: string;
}

function patchFrom(proposal: TriageProposal, overrides: Overrides = {}): WorkflowPatch {
  const patch: WorkflowPatch = {};
  const priority = overrides.priority_class ?? proposal.proposed_priority_class;
  const date = overrides.next_action_date ?? proposal.proposed_next_action_date;
  const owner = overrides.owner_name ?? proposal.proposed_owner_name;
  if (priority) patch.priority_class = priority;
  if (date) patch.next_action_date = date;
  if (owner) patch.owner_name = owner;
  if (proposal.proposed_stage) patch.stage = proposal.proposed_stage;
  return patch;
}

/**
 * POST /api/maintenance/triage-proposals/apply
 *
 * Single: { workOrderId, action: 'apply'|'skip', overrides? }
 * Bulk:   { bulk: true }  — applies every pending proposal (no per-row edits)
 *
 * Applies go through updateWorkOrderWorkflow — the audit trail records normal
 * stage_change/assign/schedule events attributed to the session user.
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const resolve = (workOrderId: string, status: 'applied' | 'skipped') =>
      supabase
        .from('ai_triage_proposal')
        .update({ status, resolved_at: now, resolved_by: session.actor })
        .eq('work_order_id', workOrderId)
        .eq('status', 'pending');

    // ── Bulk apply ──
    if (body.bulk === true) {
      const { data: pending, error } = await supabase
        .from('ai_triage_proposal')
        .select('*')
        .eq('status', 'pending');
      if (error) throw new Error(error.message);

      let applied = 0;
      const failures: { workOrderId: string; errors: string[] }[] = [];
      for (const proposal of (pending ?? []) as TriageProposal[]) {
        try {
          await updateWorkOrderWorkflow(
            proposal.work_order_id,
            patchFrom(proposal),
            session.actor
          );
          await resolve(proposal.work_order_id, 'applied');
          applied++;
        } catch (err) {
          failures.push({
            workOrderId: proposal.work_order_id,
            errors:
              err instanceof WorkflowValidationError
                ? err.errors
                : [err instanceof Error ? err.message : String(err)],
          });
        }
      }
      return NextResponse.json({ applied, failures });
    }

    // ── Single apply / skip ──
    if (!body.workOrderId || !['apply', 'skip'].includes(body.action)) {
      return NextResponse.json(
        { error: 'workOrderId and action (apply|skip) required, or bulk: true' },
        { status: 400 }
      );
    }

    if (body.action === 'skip') {
      await resolve(body.workOrderId, 'skipped');
      return NextResponse.json({ skipped: true });
    }

    const { data: proposal, error } = await supabase
      .from('ai_triage_proposal')
      .select('*')
      .eq('work_order_id', body.workOrderId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proposal) {
      return NextResponse.json({ error: 'No pending proposal for this WO' }, { status: 404 });
    }

    const { workOrder } = await updateWorkOrderWorkflow(
      body.workOrderId,
      patchFrom(proposal as TriageProposal, body.overrides ?? {}),
      session.actor
    );
    await resolve(body.workOrderId, 'applied');

    return NextResponse.json({ workOrder });
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return NextResponse.json(
        { error: 'Apply blocked', errors: error.errors },
        { status: 422 }
      );
    }
    console.error('[Maintenance] Proposal apply error:', error);
    const message = error instanceof Error ? error.message : 'Apply failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
