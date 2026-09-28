import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAppFolioUnits } from './appfolio';
import { runReport } from './appfolio-reports';
import type { AppFolioInspectionDetail, AppFolioUnitInspection } from './inspection-history';
import { loadInspectionQueue } from './inspection-queue';
import { inspectionToday } from './inspection-window';
import { buildInspectionEvidence, inspectionReviewCounts, reviewInspectionCandidates } from './inspection-review';

export const INSPECTION_REVIEW_CACHE_TAG = 'inspection-review-evidence';
async function fetchEvidence() {
  const [units,history,unitReport] = await Promise.all([
    fetchAppFolioUnits({includeHidden:true}),
    runReport<AppFolioInspectionDetail>('inspection_detail'),
    runReport<AppFolioUnitInspection>('unit_inspection', {last_inspection_on_from:inspectionToday(),unit_visibility:'all'}),
  ]);
  if(!units.length) throw new Error('AppFolio returned no units for verification.');
  return buildInspectionEvidence(units,history,new Date().toISOString(),unitReport);
}
// Time bucket bounds freshness even when the framework serves stale cache entries.
const cachedEvidence = unstable_cache(async (_bucket: number) => fetchEvidence(), ['inspection-review-v2'], {revalidate:300,tags:[INSPECTION_REVIEW_CACHE_TAG]});
export async function loadInspectionReview(supabase: SupabaseClient, options: {fresh?: boolean} = {}) {
  const [queue,evidenceResult] = await Promise.all([
    loadInspectionQueue(supabase),
    (options.fresh ? fetchEvidence() : cachedEvidence(Math.floor(Date.now()/300_000)))
      .then(evidence=>({evidence,error:null as string|null})).catch(error=>{
        console.error('[inspection-review] evidence unavailable:',error instanceof Error ? error.message : error);
        return {evidence:null,error:'AppFolio verification is unavailable. Unverified candidates are held for confirmation.'};
      }),
  ]);
  const candidates=reviewInspectionCandidates(queue.rows,queue.properties,evidenceResult.evidence,inspectionToday());
  return {...queue,candidates,review_counts:inspectionReviewCounts(candidates),checked_at:evidenceResult.evidence?.checked_at || null,verification_error:evidenceResult.error};
}
