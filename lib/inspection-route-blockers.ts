import { findHouseholdSource } from './inspection-route-households';
import { inspectionExcluded } from './inspection-queue';
import type { loadInspectionReview } from './inspection-review-loader';

type InspectionReview = Awaited<ReturnType<typeof loadInspectionReview>>;

export interface RouteBlocker {
  id: string;
  address: string;
  reason: string;
}

const GROUP_REASON: Record<string, string> = {
  confirmation: 'Needs confirmation',
  handled: 'Already handled / not due',
};

/**
 * Queue inspections that cannot go on a route, with the reason staff see.
 * Routine inspections must be Ready on the Candidates page; excluded or
 * inactive units never route.
 */
export function routeBlockers(review: InspectionReview): RouteBlocker[] {
  const { rows, properties, candidates } = review;
  const blockers: RouteBlocker[] = [];
  for (const row of rows) {
    const address = row.inspection_properties?.address_1 || 'Unknown address';
    if (inspectionExcluded(row, properties)) {
      blockers.push({ id: row.id, address, reason: 'Excluded from routine inspections' });
      continue;
    }
    if (!['routine', 'biannual'].includes(row.inspection_type || '')) continue;
    const source = properties.find((property) => property.id === row.property_id)
      || (row.inspection_properties ? findHouseholdSource(row.inspection_properties, properties, row.resident_name) : null);
    const candidate = source?.id ? candidates.find((c) => c.id === source.id) : undefined;
    if (candidate?.review_group === 'ready') continue;
    blockers.push({
      id: row.id,
      address,
      reason: (candidate && GROUP_REASON[candidate.review_group]) || 'Not matched to an AppFolio unit',
    });
  }
  return blockers;
}
