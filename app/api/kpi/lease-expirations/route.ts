import { NextResponse } from 'next/server';
import { fetchLeaseExpirationsKpi } from '@/lib/appfolio-kpi';
import { getSupabaseAdmin } from '@/lib/supabase';

export const maxDuration = 120;

export async function GET() {
  try {
    const data = await fetchLeaseExpirationsKpi();
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('kpi_snapshots').insert({ kpi_name: 'lease_expirations', value: data });
    } catch (e) {
      console.warn('[KPI] Failed to save lease expirations snapshot:', e);
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    console.error('[KPI] Lease expirations error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch lease expirations data' },
      { status: 500 }
    );
  }
}
