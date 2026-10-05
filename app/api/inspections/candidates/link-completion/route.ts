import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { INSPECTION_REVIEW_CACHE_TAG } from '@/lib/inspection-review-loader';
import { linkCompletionToUnit } from '@/lib/inspection-completion-link';

/**
 * POST /api/inspections/candidates/link-completion
 * Body: { inspection_id, property_id }
 *
 * Moves a completed inspection that matched no AppFolio unit onto the unit
 * staff picked, and credits that unit with the visit.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (!email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { inspection_id, property_id } = await request.json();
    if (!inspection_id || !property_id) {
      return NextResponse.json({ error: 'inspection_id and property_id are required' }, { status: 400 });
    }
    const result = await linkCompletionToUnit(getSupabaseAdmin(), inspection_id, property_id, email);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    revalidateTag(INSPECTION_REVIEW_CACHE_TAG, { expire: 0 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[link-completion] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to link inspection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
