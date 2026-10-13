import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadFeeVolumes } from '@/lib/fee-management/inputs';

export const maxDuration = 120;

/** GET [?refresh=1] — trailing-12-month fee volumes, cached daily in kpi_snapshots. */
export async function GET(request: NextRequest) {
  const guard = await requireSection('fee_management');
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await loadFeeVolumes(getSupabaseAdmin(), { refresh: request.nextUrl.searchParams.get('refresh') === '1' }));
  } catch (err) {
    console.error('[fee-management] volumes pull failed:', err);
    return NextResponse.json({ error: 'Could not load lease and renewal volumes from AppFolio. Try again in a minute.' }, { status: 502 });
  }
}
