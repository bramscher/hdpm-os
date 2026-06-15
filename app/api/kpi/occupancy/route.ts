import { NextResponse } from 'next/server';
import { fetchOccupancyKpi } from '@/lib/appfolio-kpi';
import { getSupabaseAdmin } from '@/lib/supabase';

export const maxDuration = 120;

export async function GET() {
  try {
    const data = await fetchOccupancyKpi();
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('kpi_snapshots').insert({ kpi_name: 'occupancy', value: data });
    } catch (e) {
      console.warn('[KPI] Failed to save occupancy snapshot:', e);
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    console.error('[KPI] Occupancy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch occupancy data' },
      { status: 500 }
    );
  }
}
