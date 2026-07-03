import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  fetchDelinquencyKpi,
  fetchVacancyKpi,
  fetchWorkOrderKpi,
  fetchNoticeKpi,
  fetchInsuranceKpi,
  fetchOwnerRetentionKpi,
  fetchMaintenanceCostKpi,
  fetchDaysToLeaseKpi,
  fetchLeaseRenewalKpi,
  fetchNetDoorsKpi,
  fetchGuestCardKpi,
  fetchLeasingFunnelKpi,
  fetchManagementFeesKpi,
  fetchOccupancyKpi,
  fetchBendGrowthKpi,
  fetchLeaseExpirationsKpi,
  fetchWorkOrdersCompletedKpi,
  fetchMaintenanceEconomicsKpi,
} from '@/lib/appfolio-kpi';

/**
 * POST /api/kpi/cron
 *
 * Daily cron job (7 AM PT / 14:00 UTC) that snapshots all KPIs
 * into kpi_snapshots for historical trend tracking.
 *
 * Protected by CRON_SECRET (same pattern as /api/sync/appfolio).
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSnapshot();
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}

async function runSnapshot() {

  console.log('[KPI Cron] Starting daily snapshot...');
  const supabase = getSupabaseAdmin();
  const results: Record<string, { success: boolean; error?: string }> = {};

  const kpiFetchers = [
    { name: 'delinquency', fn: fetchDelinquencyKpi },
    { name: 'vacancy', fn: fetchVacancyKpi },
    { name: 'work_orders', fn: fetchWorkOrderKpi },
    { name: 'notices', fn: fetchNoticeKpi },
    { name: 'insurance', fn: fetchInsuranceKpi },
    { name: 'owner_retention', fn: fetchOwnerRetentionKpi },
    { name: 'maintenance_cost', fn: fetchMaintenanceCostKpi },
    { name: 'days_to_lease', fn: fetchDaysToLeaseKpi },
    { name: 'lease_renewal', fn: fetchLeaseRenewalKpi },
    { name: 'net_doors', fn: fetchNetDoorsKpi },
    { name: 'guest_cards', fn: fetchGuestCardKpi },
    { name: 'leasing_funnel', fn: fetchLeasingFunnelKpi },
    { name: 'management_fees', fn: fetchManagementFeesKpi },
    { name: 'occupancy', fn: fetchOccupancyKpi },
    { name: 'bend_growth', fn: fetchBendGrowthKpi },
    { name: 'lease_expirations', fn: fetchLeaseExpirationsKpi },
    { name: 'work_orders_completed', fn: fetchWorkOrdersCompletedKpi },
    { name: 'maintenance_economics', fn: fetchMaintenanceEconomicsKpi },
  ] as const;

  await Promise.allSettled(
    kpiFetchers.map(async ({ name, fn }) => {
      try {
        const value = await fn();
        const { error } = await supabase
          .from('kpi_snapshots')
          .insert({ kpi_name: name, value });

        if (error) throw new Error(error.message);
        results[name] = { success: true };
        console.log(`[KPI Cron] ${name}: OK`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[name] = { success: false, error: msg };
        console.error(`[KPI Cron] ${name}: FAILED -`, msg);
      }
    })
  );

  const total = kpiFetchers.length;
  const succeeded = Object.values(results).filter((r) => r.success).length;
  console.log(`[KPI Cron] Done: ${succeeded}/${total} snapshots saved`);

  return NextResponse.json({ results, succeeded, total });
}

export const maxDuration = 300;
