import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Inspections taken off a route (route deleted, day cleared, stop skipped)
 * go back to the queue; their units must lose the 'scheduled' candidate flag
 * too, or the review holds them as "marked scheduled but has no verifiable
 * current appointment" forever. 'eligible' lets the review regroup them.
 */
export async function releaseScheduledCandidates(supabase: SupabaseClient, inspectionIds: string[]): Promise<void> {
  if (inspectionIds.length === 0) return;
  const { data, error } = await supabase.from('inspections').select('property_id').in('id', inspectionIds);
  if (error) {
    console.error('[candidate-release] could not load inspections:', error.message);
    return;
  }
  const propertyIds = [...new Set((data || []).map((row) => row.property_id).filter(Boolean))] as string[];
  if (propertyIds.length === 0) return;
  const { error: updateError } = await supabase
    .from('inspection_properties')
    .update({ candidate_status: 'eligible' })
    .in('id', propertyIds)
    .eq('candidate_status', 'scheduled');
  if (updateError) console.error('[candidate-release] could not reset candidate status:', updateError.message);
}
