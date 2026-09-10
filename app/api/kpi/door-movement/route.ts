import { NextResponse } from 'next/server';
import { fetchDoorMovementKpi } from '@/lib/appfolio-kpi';
import { getSupabaseAdmin } from '@/lib/supabase';

export const maxDuration = 120;

export async function GET() {
  try {
    const data = await fetchDoorMovementKpi();

    try {
      const supabase = getSupabaseAdmin();
      // Lean scalars only (no roster) — trend-safe.
      await supabase.from('kpi_snapshots').insert({ kpi_name: 'door_movement', value: data });
    } catch (e) {
      console.warn('[KPI] Failed to save door movement snapshot:', e);
    }

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    console.error('[KPI] Door movement error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch door movement data' },
      { status: 500 }
    );
  }
}
