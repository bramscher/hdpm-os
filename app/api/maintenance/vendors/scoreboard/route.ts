import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { computeVendorScores } from '@/lib/maintenance/vendors';
import type { MaintWorkOrder, Vendor, VendorAssignment } from '@/lib/maintenance/types';

/**
 * GET /api/maintenance/vendors/scoreboard
 *
 * Vendor Scoreboard view: profiles + rolling-90d performance + ranking, plus
 * open-WO counts (joined via vendor.appfolio_vendor_id = work_orders.vendor_id).
 */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const [vendorsRes, assignmentsRes, openRes] = await Promise.all([
      supabase.from('vendor').select('*').eq('active', true),
      supabase.from('vendor_assignment').select('*'),
      supabase
        .from('work_orders')
        .select('id, vendor_id, next_action_date, created_at')
        .neq('stage', 'CLOSED'),
    ]);
    for (const res of [vendorsRes, assignmentsRes, openRes]) {
      if (res.error) throw new Error(res.error.message);
    }

    const vendors = (vendorsRes.data ?? []) as Vendor[];
    const assignments = (assignmentsRes.data ?? []) as VendorAssignment[];
    const openWos = (openRes.data ?? []) as Pick<
      MaintWorkOrder,
      'id' | 'vendor_id' | 'next_action_date' | 'created_at'
    >[];

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const performance = computeVendorScores(vendors, assignments, now);

    // Open / overdue / avg-days-open per vendor via the AppFolio-id bridge.
    const openStats = new Map<
      string,
      { open: number; overdue: number; totalDaysOpen: number }
    >();
    const vendorByAppfolioId = new Map(
      vendors.filter((v) => v.appfolio_vendor_id).map((v) => [v.appfolio_vendor_id!, v.id])
    );
    for (const wo of openWos) {
      if (!wo.vendor_id) continue;
      const vendorId = vendorByAppfolioId.get(wo.vendor_id);
      if (!vendorId) continue;
      const stats = openStats.get(vendorId) ?? { open: 0, overdue: 0, totalDaysOpen: 0 };
      stats.open++;
      if (wo.next_action_date && wo.next_action_date < today) stats.overdue++;
      stats.totalDaysOpen += Math.max(
        0,
        (now.getTime() - new Date(wo.created_at).getTime()) / 86_400_000
      );
      openStats.set(vendorId, stats);
    }

    const scoreboard = performance.map((perf) => {
      const vendor = vendors.find((v) => v.id === perf.vendorId)!;
      const stats = openStats.get(perf.vendorId);
      return {
        ...perf,
        vendor,
        open: stats?.open ?? 0,
        overdue: stats?.overdue ?? 0,
        avgDaysOpen: stats && stats.open > 0 ? stats.totalDaysOpen / stats.open : null,
      };
    });

    return NextResponse.json({ scoreboard });
  } catch (error) {
    console.error('[Maintenance] Scoreboard error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load scoreboard';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
