import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  fetchAppFolioWorkOrders,
  fetchAllPropertiesPublic,
  fetchAllUnitsPublic,
  fetchAllVendors,
} from '@/lib/appfolio';
import { bulkUpsertWorkOrders } from '@/lib/work-orders';
import { syncVendors } from '@/lib/maintenance/vendors';
import { syncUnitTurnsFromMirror } from '@/lib/maintenance/unit-turns';

// Allow up to 300 seconds for the sync function (Vercel Pro supports up to 300s).
// AppFolio v0 API is slow (~20s per page of 200 work orders), so we need headroom.
export const maxDuration = 300;

/**
 * GET /api/sync/work-orders
 *
 * Vercel Cron sends GET, so GET delegates to POST (same auth: CRON_SECRET
 * bearer or staff session). Pass ?test=1 for the old connectivity check.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get('test') === '1') {
    try {
      console.log('[Sync] GET — testing AppFolio work orders API...');
      const workOrders = await fetchAppFolioWorkOrders(7);
      return NextResponse.json({
        message: 'AppFolio work orders API test',
        count: workOrders.length,
        sample: workOrders.slice(0, 3),
      });
    } catch (error) {
      console.error('[Sync] GET work orders test error:', error);
      const message = error instanceof Error ? error.message : 'API test failed';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  return POST(request);
}

/**
 * POST /api/sync/work-orders
 *
 * Sync work orders from AppFolio.
 * Auth: CRON_SECRET (for daily cron) OR session auth (for manual "Sync Now" button).
 *
 * Now that webhooks handle real-time updates, this sync is a safety-net catchup:
 *   - Cron (daily at 8am): fetches last 7 days to fill any missed webhooks
 *   - Manual "Sync Now": fetches last 90 days for a broader refresh
 *   - Optional: ?days=365 query param to override the window
 */
export async function POST(request: NextRequest) {
  try {
    // Dual auth: cron secret OR session
    const authHeader = request.headers.get('authorization');
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isCron) {
      const session = await getServerSession();
      if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Determine sync window
    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days');
    const days = daysParam ? parseInt(daysParam, 10) : isCron ? 7 : 90;

    console.log(
      `[Sync] Starting work orders sync (${isCron ? 'cron' : 'manual'}, last ${days} days)...`
    );

    // Step 1: Fetch vendors for vendor name resolution + mirror into the
    // vendor table (Maintenance OS profiles; name/id only, manual fields survive)
    const vendorMap = await fetchAllVendors();
    const vendorsSynced = await syncVendors(vendorMap);

    // Step 2: Fetch work orders from AppFolio (with vendor names)
    const workOrders = await fetchAppFolioWorkOrders(days, vendorMap);
    if (workOrders.length === 0) {
      return NextResponse.json({
        message: `No work orders updated in the last ${days} days`,
        synced: 0,
        days,
      });
    }

    // Step 3: Fetch all properties to build a propertyId → {name, address} map
    const properties = await fetchAllPropertiesPublic();
    const propertyMap = new Map<string, { name: string; address: string }>();
    for (const p of properties) {
      const address = [p.Address1, p.Address2, p.City, p.State, p.Zip]
        .filter(Boolean)
        .join(', ');
      propertyMap.set(p.Id, {
        name: p.Name || p.Address1 || 'Unknown',
        address,
      });
    }

    // Step 3b: Fetch all units to build a unitId → { name } map (the v0 WO
    // payload carries only UnitId, so unit_name is otherwise never populated).
    const units = await fetchAllUnitsPublic();
    const unitMap = new Map<string, { name: string | null }>();
    for (const u of units) {
      unitMap.set(u.id, { name: u.name });
    }

    // Step 4: Bulk upsert into work_orders table
    const count = await bulkUpsertWorkOrders(workOrders, propertyMap, unitMap);

    // Step 5: Reconcile AppFolio Turn-Board WOs into unit_turn rows
    // (auto-create + auto-link, audited). Non-fatal — the mirror sync
    // above already succeeded.
    let unitTurns: { created: number; linked: number } | null = null;
    try {
      unitTurns = await syncUnitTurnsFromMirror();
    } catch (err) {
      console.error('[Sync] Unit turn reconcile failed:', err);
    }

    console.log(`[Sync] Work orders sync complete: ${count} work orders upserted`);

    return NextResponse.json({
      message: 'Work orders sync complete',
      synced: count,
      total_fetched: workOrders.length,
      properties_mapped: propertyMap.size,
      units_mapped: unitMap.size,
      vendors_synced: vendorsSynced,
      unit_turns: unitTurns,
      days,
    });
  } catch (error) {
    console.error('[Sync] Work orders sync error:', error);
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
