import { NextResponse } from 'next/server';
import { fetchMaintenanceEconomicsKpi } from '@/lib/appfolio-kpi';
import { getSupabaseAdmin } from '@/lib/supabase';

// Heaviest KPI: a year of /bills + /work_orders + /units + /gl_accounts.
export const maxDuration = 300;

export async function GET() {
  try {
    const data = await fetchMaintenanceEconomicsKpi();
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('kpi_snapshots').insert({ kpi_name: 'maintenance_economics', value: data });
    } catch (e) {
      console.warn('[KPI] Failed to save maintenance economics snapshot:', e);
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    console.error('[KPI] Maintenance economics error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch maintenance economics data' },
      { status: 500 }
    );
  }
}
