import { currentCandidateStatus, inspectionToday, inspectionHorizon } from '@/lib/inspection-window';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/inspections/candidates
 *
 * List inspection candidates (one row per unit) with their classification status.
 * Filters: ?status=skip_recent|defer|eligible|scheduled|dismissed, ?region=Bend, ?search=...
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const region = searchParams.get('region');
    const search = searchParams.get('search');
    const today = inspectionToday();
    const horizon = inspectionHorizon(today);

    let query = supabase
      .from('inspection_properties')
      .select('*', { count: 'exact' })
      // Candidate rows are the ones the sync has classified. Do NOT filter on
      // uses_custom_inspection_date: that flag is a web-app-only form field the
      // v0 API can't see, so the sync writes it false everywhere — filtering on
      // it starved this page to zero rows (fixed 2026-07-23; same rule as the
      // schedule route).
      .not('active', 'is', false)
      .not('candidate_status', 'is', null);

    if (status === 'routine_excluded') {
      query = query.eq('routine_inspections_enabled', false);
    } else {
      query = query.not('routine_inspections_enabled', 'is', false);
    }

    if (status === 'eligible') {
      query = query.eq('candidate_status', 'eligible').or(`next_due_date.is.null,next_due_date.lte.${horizon}`);
    } else if (status === 'defer') {
      query = query.or(`candidate_status.eq.defer,and(candidate_status.eq.eligible,next_due_date.gt.${horizon})`);
    } else if (status && status !== 'routine_excluded') {
      query = query.eq('candidate_status', status);
    }
    if (region) {
      query = query.eq('region', region);
    }
    if (search) {
      query = query.or(
        `address_1.ilike.%${search}%,address_2.ilike.%${search}%,city.ilike.%${search}%,name.ilike.%${search}%,owner_name.ilike.%${search}%`
      );
    }

    query = query.order('candidate_status', { ascending: true }).order('last_inspection_date', { ascending: true, nullsFirst: true });

    const { data, error, count } = await query;
    if (error) {
      console.error('[candidates GET] error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Summary counts (separate query so they aren't affected by current filters)
    const { data: summaryRows } = await supabase
      .from('inspection_properties')
      .select('candidate_status,next_due_date')
      .not('routine_inspections_enabled', 'is', false)
      .not('active', 'is', false)
      .not('candidate_status', 'is', null);

    const counts = { skip_recent: 0, defer: 0, eligible: 0, scheduled: 0, dismissed: 0 };
    for (const row of summaryRows || []) {
      const s = currentCandidateStatus(row.candidate_status, row.next_due_date, today) as keyof typeof counts | null;
      if (s && s in counts) counts[s]++;
    }

    const candidates = (data || []).map(row => ({ ...row,
      candidate_status: currentCandidateStatus(row.candidate_status, row.next_due_date, today),
    })).filter(row => !status || status === 'routine_excluded' || row.candidate_status === status);
    return NextResponse.json({ candidates, total: count ?? candidates.length, counts });
  } catch (error) {
    console.error('[candidates GET] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch candidates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
