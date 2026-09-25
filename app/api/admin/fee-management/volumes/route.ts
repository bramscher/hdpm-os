import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchFeeVolumes, type FeeVolumes } from '@/lib/fee-management/volumes';

export const maxDuration = 120;

const KEY = 'fee_schedule_volumes';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** GET [?refresh=1] — trailing-12-month fee volumes, cached daily in kpi_snapshots. */
export async function GET(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();

  if (request.nextUrl.searchParams.get('refresh') !== '1') {
    const { data } = await db
      .from('kpi_snapshots')
      .select('value, captured_at')
      .eq('kpi_name', KEY)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && Date.now() - new Date(data.captured_at).getTime() < MAX_AGE_MS) {
      return NextResponse.json({ volumes: data.value as FeeVolumes, capturedAt: data.captured_at });
    }
  }

  try {
    const volumes = await fetchFeeVolumes();
    const { data } = await db.from('kpi_snapshots').insert({ kpi_name: KEY, value: volumes }).select('captured_at').single();
    return NextResponse.json({ volumes, capturedAt: data?.captured_at ?? new Date().toISOString() });
  } catch (err) {
    console.error('[fee-management] volumes pull failed:', err);
    return NextResponse.json({ error: 'Could not load lease and renewal volumes from AppFolio. Try again in a minute.' }, { status: 502 });
  }
}
