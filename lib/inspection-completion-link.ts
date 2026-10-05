import type { SupabaseClient } from '@supabase/supabase-js';
import { completeInspectionCascade } from './inspection-complete';
import { inspectionToday } from './inspection-window';

const ROUTINE = ['routine', 'biannual'];
const OPEN_STATUSES = ['imported', 'validated', 'queued'];

export type LinkResult =
  | { linked: true; from_property_id: string | null; property_id: string; completed_on: string; follow_ups_moved: number }
  | { error: string; status: number };

/**
 * Credit an unmatched completed routine inspection to the unit staff chose.
 *
 * 1. Repoints the inspection at the chosen unit.
 * 2. Removes the follow-up the completion cascade pre-created for the old,
 *    unmatched property (same due date, never scheduled) so it doesn't linger.
 * 3. Re-runs the completion cascade for the chosen unit: last inspected date,
 *    next due +6 months, 'skip_recent', and a follow-up if none is pending.
 * 4. Moves the chosen unit's open routine inspections to the new due date so
 *    the queue doesn't offer a visit that just happened.
 */
export async function linkCompletionToUnit(
  supabase: SupabaseClient,
  inspectionId: string,
  propertyId: string,
  performedBy: string,
): Promise<LinkResult> {
  const { data: inspection } = await supabase
    .from('inspections')
    .select('id, property_id, status, inspection_type, completed_at')
    .eq('id', inspectionId)
    .maybeSingle();
  if (!inspection) return { error: 'Inspection not found', status: 404 };
  if (inspection.status !== 'completed' || !inspection.completed_at) {
    return { error: 'Only completed inspections can be linked to a unit', status: 400 };
  }
  if (!ROUTINE.includes(inspection.inspection_type || '')) {
    return { error: 'Only routine inspections can be linked to a unit', status: 400 };
  }

  const { data: unit } = await supabase
    .from('inspection_properties')
    .select('id, active, candidate_status')
    .eq('id', propertyId)
    .maybeSingle();
  if (!unit || !unit.candidate_status) return { error: 'Unit not found', status: 404 };
  if (unit.active === false) return { error: 'That unit is inactive', status: 400 };
  if (inspection.property_id === propertyId) return { error: 'The inspection is already on that unit', status: 400 };

  const completedOn = inspectionToday(new Date(inspection.completed_at));
  const fromPropertyId: string | null = inspection.property_id;

  const { error: moveError } = await supabase
    .from('inspections')
    .update({ property_id: propertyId, updated_at: new Date().toISOString() })
    .eq('id', inspectionId);
  if (moveError) return { error: moveError.message, status: 500 };

  if (fromPropertyId) {
    await supabase
      .from('inspections')
      .delete()
      .eq('property_id', fromPropertyId)
      .eq('status', 'imported')
      .in('inspection_type', ROUTINE)
      .eq('last_inspection_date', completedOn)
      .is('route_plan_id', null);
  }

  await completeInspectionCascade(supabase, [inspectionId], completedOn);

  const { data: moved } = await supabase
    .from('inspection_properties')
    .select('next_due_date')
    .eq('id', propertyId)
    .maybeSingle();
  let followUpsMoved = 0;
  if (moved?.next_due_date) {
    const { data: updated } = await supabase
      .from('inspections')
      .update({ due_date: moved.next_due_date, last_inspection_date: completedOn, updated_at: new Date().toISOString() })
      .eq('property_id', propertyId)
      .in('status', OPEN_STATUSES)
      .in('inspection_type', ROUTINE)
      .lt('due_date', moved.next_due_date)
      .select('id');
    followUpsMoved = updated?.length ?? 0;
  }

  await supabase.from('inspection_audit_log').insert({
    entity_type: 'inspection',
    entity_id: inspectionId,
    action: 'completion_linked_to_unit',
    old_value: { property_id: fromPropertyId },
    new_value: { property_id: propertyId, completed_on: completedOn },
    performed_by: performedBy,
  });

  return { linked: true, from_property_id: fromPropertyId, property_id: propertyId, completed_on: completedOn, follow_ups_moved: followUpsMoved };
}
