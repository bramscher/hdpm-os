/**
 * Inspection completion cascade — shared by the route-stop completion endpoint
 * and the bulk status endpoint so both paths behave identically.
 *
 * On completion:
 *  1. Write back to inspection_properties: last_inspection_date = completion
 *     date, next_due_date = +6 months, and candidate_status leaves 'scheduled'
 *     (→ 'skip_recent') so the candidate pipeline resumes cadence tracking.
 *     Without this, completed units stayed 'scheduled' forever and dropped out
 *     of the 6-month cycle.
 *  2. Create the next routine inspection (+6 months), copying the tenant /
 *     notice fields from the property row — unless one is already pending.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { INSPECTION_INTERVAL_MONTHS } from './inspection-candidates';

/** Statuses that count as "already have a pending inspection". */
const TERMINAL_STATUSES = ['completed', 'canceled'];

function addMonthsISO(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export interface CompletionCascadeResult {
  properties_updated: number;
  next_created: number;
}

export async function completeInspectionCascade(
  supabase: SupabaseClient,
  inspectionIds: string[],
  /** Completion date, YYYY-MM-DD (usually today). */
  completedOn: string
): Promise<CompletionCascadeResult> {
  const result: CompletionCascadeResult = { properties_updated: 0, next_created: 0 };
  if (inspectionIds.length === 0) return result;

  const { data: completed, error } = await supabase
    .from('inspections')
    .select('id, property_id')
    .in('id', inspectionIds);
  if (error || !completed) {
    console.error('[inspection-complete] load completed inspections failed:', error?.message);
    return result;
  }

  const propertyIds = [...new Set(completed.map((i) => i.property_id).filter(Boolean))];
  if (propertyIds.length === 0) return result;

  const nextDue = addMonthsISO(completedOn, INSPECTION_INTERVAL_MONTHS);

  // 1. Property write-back — resume cadence tracking in the candidate pipeline.
  const { data: props, error: propErr } = await supabase
    .from('inspection_properties')
    .select('id, resident_name, tenant_email, move_in_date, address_2')
    .in('id', propertyIds);
  if (propErr) {
    console.error('[inspection-complete] load properties failed:', propErr.message);
    return result;
  }

  const { error: writeErr } = await supabase
    .from('inspection_properties')
    .update({
      last_inspection_date: completedOn,
      next_due_date: nextDue,
      candidate_status: 'skip_recent', // just inspected — sync keeps cadence from here
      local_skip_reason: `Inspected ${completedOn}`,
      local_skip_set_at: new Date().toISOString(),
    })
    .in('id', propertyIds);
  if (writeErr) {
    console.error('[inspection-complete] property write-back failed:', writeErr.message);
  } else {
    result.properties_updated = propertyIds.length;
  }

  // 2. Create the next inspection per property unless one is already pending.
  const propById = new Map((props ?? []).map((p) => [p.id, p]));
  for (const propertyId of propertyIds) {
    const { data: pending } = await supabase
      .from('inspections')
      .select('id')
      .eq('property_id', propertyId)
      .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
      .limit(1);
    if (pending && pending.length > 0) continue;

    const prop = propById.get(propertyId);
    const { error: insErr } = await supabase.from('inspections').insert({
      property_id: propertyId,
      inspection_type: 'routine',
      status: 'imported',
      priority: 'normal',
      priority_score: 50,
      estimated_duration_minutes: 30,
      occupancy_status: 'occupied',
      due_date: nextDue,
      last_inspection_date: completedOn,
      move_in_date: prop?.move_in_date ?? null,
      unit_name: prop?.address_2 ?? null,
      resident_name: prop?.resident_name ?? null,
      notice_email: prop?.tenant_email ?? null,
      notice_status: prop?.tenant_email ? 'pending' : 'skipped_no_email',
    });
    if (!insErr) result.next_created += 1;
    else console.error('[inspection-complete] next-inspection insert failed:', insErr.message);
  }

  return result;
}
