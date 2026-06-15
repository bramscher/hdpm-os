import { NextResponse } from 'next/server';
import { fetchBendGrowthKpi } from '@/lib/appfolio-kpi';
import { getSupabaseAdmin } from '@/lib/supabase';

export const maxDuration = 120;

export async function GET() {
  try {
    const data = await fetchBendGrowthKpi();
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('kpi_snapshots').insert({ kpi_name: 'bend_growth', value: data });
    } catch (e) {
      console.warn('[KPI] Failed to save bend growth snapshot:', e);
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    console.error('[KPI] Bend growth error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch bend growth data' },
      { status: 500 }
    );
  }
}
