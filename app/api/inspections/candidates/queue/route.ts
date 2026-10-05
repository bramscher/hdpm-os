import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadInspectionReview } from '@/lib/inspection-review-loader';
import { planQueueRows, type PendingInspectionRow } from '@/lib/inspection-queue-rows';

/**
 * POST /api/inspections/candidates/queue
 * Body: { candidate_ids: string[] }
 *
 * Puts chosen Ready units into the inspection queue (adopting an existing
 * unrouted inspection or creating one) without building routes, so staff can
 * route them by hand in Route Builder → Pick Properties.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { candidate_ids } = (await request.json()) as { candidate_ids?: string[] };
    if (!Array.isArray(candidate_ids) || candidate_ids.length === 0) {
      return NextResponse.json({ error: 'candidate_ids is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const review = await loadInspectionReview(supabase, { fresh: true });
    if (review.verification_error) return NextResponse.json({ error: review.verification_error }, { status: 503 });
    const candidates = review.candidates.filter((c) => candidate_ids.includes(c.id));
    if (candidates.length !== candidate_ids.length || candidates.some((c) => c.review_group !== 'ready')) {
      return NextResponse.json({ error: 'Some selected units are not ready to schedule. Refresh the review.' }, { status: 409 });
    }

    const { data: pendingRows, error: pendingError } = await supabase
      .from('inspections')
      .select('id, property_id, due_date, priority, status, route_plan_id')
      .in('property_id', candidates.map((c) => c.id))
      .not('status', 'in', '(completed,canceled)');
    if (pendingError) return NextResponse.json({ error: pendingError.message }, { status: 500 });

    const todayStr = new Date().toISOString().split('T')[0];
    const { toInsert, adopted, skippedInFlight } = planQueueRows(candidates, (pendingRows ?? []) as PendingInspectionRow[], todayStr);

    if (adopted.length > 0) {
      const { error } = await supabase
        .from('inspections')
        .update({ status: 'queued', updated_at: new Date().toISOString() })
        .in('id', adopted.map((a) => a.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (toInsert.length > 0) {
      const { error } = await supabase.from('inspections').insert(toInsert);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      queued: toInsert.length + adopted.length,
      created: toInsert.length,
      already_queued: adopted.length,
      on_route: skippedInFlight,
    });
  } catch (error) {
    console.error('[candidates/queue] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to add to queue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
