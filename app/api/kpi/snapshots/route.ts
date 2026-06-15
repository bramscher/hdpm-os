import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/kpi/snapshots
 *
 * Default: returns the most recent prior snapshot for each KPI (before today).
 * Used by the dashboard to compute week-over-week deltas.
 *
 * With ?history=N: returns the last N snapshots per KPI (deduplicated by day).
 * Used by sparklines on dashboard cards.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const historyParam = request.nextUrl.searchParams.get('history');

    const kpiNames = [
      'delinquency', 'vacancy', 'work_orders', 'notices', 'insurance',
      'owner_retention', 'maintenance_cost', 'days_to_lease', 'lease_renewal', 'net_doors',
      'guest_cards', 'leasing_funnel', 'management_fees',
      'occupancy', 'bend_growth', 'lease_expirations', 'work_orders_completed',
      'maintenance_economics',
    ];

    if (historyParam) {
      const limit = Math.min(Math.max(parseInt(historyParam, 10) || 8, 1), 90);

      const history: Record<string, Array<{ date: string; value: Record<string, unknown> }>> = {};

      await Promise.all(
        kpiNames.map(async (name) => {
          const { data } = await supabase
            .from('kpi_snapshots')
            .select('value, captured_at')
            .eq('kpi_name', name)
            .order('captured_at', { ascending: false })
            .limit(limit * 3); // Over-fetch to handle dedup

          if (!data || data.length === 0) {
            history[name] = [];
            return;
          }

          // Deduplicate to one per day (latest that day)
          const byDate = new Map<string, { date: string; value: Record<string, unknown> }>();
          for (const row of data) {
            const dateKey = row.captured_at.substring(0, 10);
            if (!byDate.has(dateKey)) {
              byDate.set(dateKey, {
                date: dateKey,
                value: row.value as Record<string, unknown>,
              });
            }
          }

          history[name] = Array.from(byDate.values())
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-limit);
        })
      );

      return NextResponse.json(history, {
        headers: { 'Cache-Control': 'public, max-age=300' },
      });
    }

    // Default: latest prior snapshot per KPI (for delta arrows)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshots: Record<string, Record<string, unknown>> = {};

    await Promise.all(
      kpiNames.map(async (name) => {
        const { data } = await supabase
          .from('kpi_snapshots')
          .select('value, captured_at')
          .eq('kpi_name', name)
          .lt('captured_at', today.toISOString())
          .order('captured_at', { ascending: false })
          .limit(1)
          .single();

        if (data) {
          snapshots[name] = data.value as Record<string, unknown>;
        }
      })
    );

    return NextResponse.json(snapshots, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    console.error('[KPI] Snapshots error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch snapshots' },
      { status: 500 }
    );
  }
}
