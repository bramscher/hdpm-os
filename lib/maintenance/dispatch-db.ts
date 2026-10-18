/**
 * Dispatch board writes. A drop onto a tech sets the local assigned_tech through
 * the audited workflow; a drop onto a vendor records a board-planned
 * vendor_assignment (AppFolio stays the system of record; the card nudges staff
 * to make the same change there). Each work order succeeds or fails on its own.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { recordEvent } from './events';
import { DISPATCH_TECHS, type DispatchTarget } from './dispatch';
import { updateWorkOrderWorkflow, WorkflowValidationError } from './workflow-db';
import type { MaintWorkOrder, VendorAssignment } from './types';

export interface DispatchResult {
  id: string;
  ok: boolean;
  error?: string;
  workOrder?: MaintWorkOrder;
  /** The new live board plan, or null when the card no longer has one. */
  plan?: VendorAssignment | null;
}

export function parseTarget(raw: unknown): DispatchTarget | null {
  const t = raw as Record<string, unknown> | null;
  if (!t || typeof t !== 'object') return null;
  if (t.kind === 'unassigned') return { kind: 'unassigned' };
  if (t.kind === 'tech' && typeof t.person === 'string') {
    const person = DISPATCH_TECHS.find((p) => p.toLowerCase() === (t.person as string).toLowerCase());
    return person ? { kind: 'tech', person } : null;
  }
  if (t.kind === 'vendor' && typeof t.vendor_id === 'string' && t.vendor_id) {
    return { kind: 'vendor', vendor_id: t.vendor_id };
  }
  return null;
}

/** Withdraw every live board plan on a work order except `keepId`. */
async function withdrawPlans(workOrderId: string, actor: string, keepId?: string) {
  const db = getSupabaseAdmin();
  let q = db
    .from('vendor_assignment')
    .update({ withdrawn_at: new Date().toISOString() })
    .eq('work_order_id', workOrderId)
    .eq('source', 'board')
    .is('withdrawn_at', null)
    .is('completed_at', null)
    .is('declined_at', null);
  if (keepId) q = q.neq('id', keepId);
  const { data, error } = await q.select('id,vendor_id');
  if (error) throw new Error(`Could not withdraw the board plan: ${error.message}`);
  for (const a of data ?? []) {
    await recordEvent({
      work_order_id: workOrderId,
      event_type: 'assign',
      payload: { field: 'vendor_assignment', withdrawn: a.id, vendor_id: a.vendor_id, via: 'dispatch_board' },
      actor,
    });
  }
}

async function liveBoardPlan(workOrderId: string): Promise<VendorAssignment | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('vendor_assignment')
    .select('*')
    .eq('work_order_id', workOrderId)
    .eq('source', 'board')
    .is('withdrawn_at', null)
    .is('completed_at', null)
    .is('declined_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VendorAssignment | null) ?? null;
}

async function clearTech(wo: MaintWorkOrder, actor: string): Promise<MaintWorkOrder> {
  if (!wo.assigned_tech) return wo;
  return (await updateWorkOrderWorkflow(wo.id, { assigned_tech: null }, actor)).workOrder;
}

async function dispatchOne(id: string, target: DispatchTarget, actor: string): Promise<DispatchResult> {
  const db = getSupabaseAdmin();
  const { data: row, error } = await db.from('work_orders').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { id, ok: false, error: 'Work order not found' };
  let wo = row as MaintWorkOrder;

  if (target.kind === 'tech') {
    await withdrawPlans(id, actor);
    if (wo.assigned_tech !== target.person) {
      wo = (await updateWorkOrderWorkflow(id, { assigned_tech: target.person }, actor)).workOrder;
    }
    return { id, ok: true, workOrder: wo, plan: null };
  }

  if (target.kind === 'unassigned') {
    await withdrawPlans(id, actor);
    wo = await clearTech(wo, actor);
    return { id, ok: true, workOrder: wo, plan: null };
  }

  const { data: vendor, error: vErr } = await db
    .from('vendor')
    .select('id,name,appfolio_vendor_id')
    .eq('id', target.vendor_id)
    .maybeSingle();
  if (vErr) throw new Error(vErr.message);
  if (!vendor) return { id, ok: false, error: 'Vendor not found' };

  let plan = await liveBoardPlan(id);
  const alreadyInAppFolio = !!wo.vendor_id && wo.vendor_id === vendor.appfolio_vendor_id;
  if (plan?.vendor_id !== vendor.id && !alreadyInAppFolio) {
    const { data, error: insErr } = await db
      .from('vendor_assignment')
      .insert({
        work_order_id: id,
        vendor_id: vendor.id,
        sent_at: new Date().toISOString(),
        created_by: actor,
        source: 'board',
        af_vendor_at_plan: wo.vendor_id ?? null,
      })
      .select('*')
      .single();
    if (insErr || !data) throw new Error(insErr?.message || 'Could not save the board plan');
    plan = data as VendorAssignment;
    await recordEvent({
      work_order_id: id,
      event_type: 'assign',
      payload: { field: 'vendor_assignment', vendor_id: vendor.id, vendor: vendor.name, assignment_id: plan.id, via: 'dispatch_board' },
      actor,
    });
  }
  // Dropping on the vendor AppFolio already has just clears any other plan.
  await withdrawPlans(id, actor, alreadyInAppFolio ? undefined : plan?.id);
  wo = await clearTech(wo, actor);
  return { id, ok: true, workOrder: wo, plan: alreadyInAppFolio ? null : plan };
}

export async function dispatchWorkOrders(
  ids: string[],
  target: DispatchTarget,
  actor: string,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  for (const id of ids) {
    try {
      results.push(await dispatchOne(id, target, actor));
    } catch (e) {
      const error =
        e instanceof WorkflowValidationError ? e.errors.join('; ') : e instanceof Error ? e.message : 'Failed';
      results.push({ id, ok: false, error });
    }
  }
  return results;
}
