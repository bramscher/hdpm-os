import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

interface SnapshotRow {
  kpi_name: string;
  value: Record<string, number>;
  captured_at: string;
}

/**
 * GET /api/kpi/trends?range=4w|8w|12w|6m|1y|all
 *
 * Returns deduplicated daily snapshots for all KPIs within the date range.
 * One data point per KPI per day (latest snapshot that day).
 *
 * Supabase JS caps queries at 1000 rows by default. For longer ranges
 * (1y = ~624 rows, all = ~1872 rows) we paginate with .range().
 */
export async function GET(request: NextRequest) {
  try {
    const range = request.nextUrl.searchParams.get('range') || '8w';

    const now = new Date();
    const startDate = new Date(now);
    switch (range) {
      case '4w':
        startDate.setDate(startDate.getDate() - 28);
        break;
      case '12w':
        startDate.setDate(startDate.getDate() - 84);
        break;
      case '6m':
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case '2y':
        startDate.setFullYear(startDate.getFullYear() - 2);
        break;
      case 'all':
        startDate.setFullYear(2020);
        break;
      default: // 8w
        startDate.setDate(startDate.getDate() - 56);
        break;
    }

    const supabase = getSupabaseAdmin();

    // Paginate to get all rows — Supabase JS hard-caps at 1000 per query
    const PAGE_SIZE = 1000;
    const allRows: SnapshotRow[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('kpi_snapshots')
        .select('kpi_name, value, captured_at')
        // door_roster is a large per-property roster used only as a baseline for
        // door_movement — it's not a sparkline KPI, so keep it out of trends.
        .neq('kpi_name', 'door_roster')
        .gte('captured_at', startDate.toISOString())
        .order('captured_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(error.message);

      const rows = (data || []) as SnapshotRow[];
      allRows.push(...rows);

      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
      if (from > 10000) break; // safety cap
    }

    // Deduplicate: keep only the latest snapshot per KPI per day
    const byKpi: Record<string, Map<string, SnapshotRow>> = {};

    for (const row of allRows) {
      const dateKey = row.captured_at.substring(0, 10);
      if (!byKpi[row.kpi_name]) {
        byKpi[row.kpi_name] = new Map();
      }
      byKpi[row.kpi_name].set(dateKey, row);
    }

    // Transform to chart-ready arrays
    const trends: Record<string, Array<{ date: string; value: Record<string, number> }>> = {};

    for (const [kpiName, dateMap] of Object.entries(byKpi)) {
      trends[kpiName] = Array.from(dateMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, row]) => ({
          date,
          value: row.value,
        }));
    }

    return NextResponse.json(trends, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    console.error('[KPI] Trends error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch trends' },
      { status: 500 }
    );
  }
}
