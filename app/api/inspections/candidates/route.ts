import { loadInspectionQueue } from '@/lib/inspection-queue';
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
    const { properties } = await loadInspectionQueue(supabase);
    // Reconcile before filtering so stale stored statuses cannot hide appointments
    // or make completed legacy imports eligible for another route.
    const all = properties.filter(row => row.active !== false && row.candidate_status != null);
    const counts = { skip_recent: 0, defer: 0, eligible: 0, scheduled: 0, dismissed: 0 };
    for (const row of all.filter(row => row.routine_inspections_enabled !== false)) {
      const key = row.candidate_status as keyof typeof counts;
      if (key in counts) counts[key]++;
    }
    const needle = search?.toLowerCase();
    const candidates = all.filter(row => {
      if (status === 'routine_excluded') {
        if (row.routine_inspections_enabled !== false) return false;
      } else if (row.routine_inspections_enabled === false || (status && row.candidate_status !== status)) return false;
      if (region && row.region !== region) return false;
      return !needle || [row.address_1, row.address_2, row.city, row.name, row.owner_name]
        .some(value => value?.toLowerCase().includes(needle));
    }).sort((a,b) => (a.candidate_status || '').localeCompare(b.candidate_status || '')
      || (a.last_inspection_date || '').localeCompare(b.last_inspection_date || ''));
    return NextResponse.json({ candidates, total: candidates.length, counts });
  } catch (error) {
    console.error('[candidates GET] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch candidates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
