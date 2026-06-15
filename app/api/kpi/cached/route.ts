import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/kpi/cached
 *
 * Returns the most recent snapshot value for each KPI from kpi_snapshots.
 * This is the fast path — no AppFolio API calls, just a Supabase query.
 * Used by the dashboard for instant page load; live refresh is separate.
 */
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const kpiNames = [
      'delinquency', 'vacancy', 'work_orders', 'notices', 'insurance',
      'owner_retention', 'maintenance_cost', 'days_to_lease', 'lease_renewal',
      'net_doors', 'guest_cards', 'leasing_funnel', 'management_fees',
      'occupancy', 'bend_growth', 'lease_expirations', 'work_orders_completed',
      'maintenance_economics',
    ];

    const cached: Record<string, { value: Record<string, unknown>; capturedAt: string }> = {};

    await Promise.all(
      kpiNames.map(async (name) => {
        const { data } = await supabase
          .from('kpi_snapshots')
          .select('value, captured_at')
          .eq('kpi_name', name)
          .order('captured_at', { ascending: false })
          .limit(1)
          .single();

        if (data) {
          cached[name] = {
            value: data.value as Record<string, unknown>,
            capturedAt: data.captured_at as string,
          };
        }
      })
    );

    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (err) {
    console.error('[KPI] Cached fetch error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch cached KPIs' },
      { status: 500 }
    );
  }
}
