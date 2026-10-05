import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadInspectionReview } from '@/lib/inspection-review-loader';
import { routeBlockers } from '@/lib/inspection-route-blockers';

/**
 * GET /api/inspections/routes/blocked
 *
 * Queue inspections the Route Builder picker must not offer, with reasons.
 * Uses the cached AppFolio evidence; route creation re-checks fresh.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const review = await loadInspectionReview(getSupabaseAdmin());
    return NextResponse.json({ blocked: routeBlockers(review), verification_error: review.verification_error });
  } catch (error) {
    console.error('[routes/blocked] review failed:', error);
    return NextResponse.json({ error: 'Could not load inspection review' }, { status: 500 });
  }
}
