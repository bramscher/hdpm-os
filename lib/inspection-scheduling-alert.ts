import { withinInspectionHorizon } from './inspection-window';
import type { QueueProperty } from './inspection-queue';

/** Uses the same eligibility and exclusions as the AppFolio Candidates list. */
export function inspectionSchedulingAlert(properties: QueueProperty[], today: string) {
  const eligible = properties.filter(property => property.candidate_status === 'eligible'
    && withinInspectionHorizon(property.next_due_date, today)
    && property.active !== false && property.routine_inspections_enabled !== false);
  return {
    total: eligible.length,
    overdue: eligible.filter(property => property.next_due_date && property.next_due_date < today).length,
    upcoming: eligible.filter(property => property.next_due_date && property.next_due_date >= today).length,
    undated: eligible.filter(property => !property.next_due_date).length,
  };
}
