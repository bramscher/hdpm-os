import { NextResponse } from 'next/server';
import { fetchWorkOrdersCompletedKpi } from '@/lib/appfolio-kpi';
import { getSupabaseAdmin } from '@/lib/supabase';

export const maxDuration = 120;

export async function GET() {
  try {
    const data = await fetchWorkOrdersCompletedKpi();
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from('kpi_snapshots').insert({ kpi_name: 'work_orders_completed', value: data });
    } catch (e) {
      console.warn('[KPI] Failed to save work orders completed snapshot:', e);
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    console.error('[KPI] Work orders completed error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch work orders completed data' },
      { status: 500 }
    );
  }
}
