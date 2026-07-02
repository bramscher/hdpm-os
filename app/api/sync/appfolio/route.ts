import { NextRequest, NextResponse } from 'next/server';
import { fetchAppFolioListings } from '@/lib/appfolio';
import { bulkUpsertComps } from '@/lib/comps';

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/sync/appfolio
 *
 * Cron-triggered nightly sync of AppFolio listings.
 * Protected by CRON_SECRET (not session auth).
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Sync] Starting AppFolio sync...');

    const comps = await fetchAppFolioListings('sync@highdesertpm.com');
    if (comps.length === 0) {
      return NextResponse.json({
        message: 'No listings to sync (API not configured or no listings in service area)',
        synced: 0,
      });
    }

    const count = await bulkUpsertComps(comps);

    console.log(`[Sync] AppFolio sync complete: ${count} comps upserted`);

    return NextResponse.json({
      message: `AppFolio sync complete`,
      synced: count,
    });
  } catch (error) {
    console.error('[Sync] AppFolio sync error:', error);
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
