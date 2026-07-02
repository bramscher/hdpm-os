import { NextRequest, NextResponse } from 'next/server';
import { fetchHudFmrBaselines } from '@/lib/hud';
import { bulkUpsertBaselines } from '@/lib/comps';

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/sync/hud
 *
 * Cron-triggered annual sync of HUD FMR data.
 * Protected by CRON_SECRET (not session auth).
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Sync] Starting HUD FMR sync...');

    const baselines = await fetchHudFmrBaselines();
    if (baselines.length === 0) {
      return NextResponse.json({
        message: 'No FMR data to sync (API not configured or no data available)',
        synced: 0,
      });
    }

    const count = await bulkUpsertBaselines(baselines);

    console.log(`[Sync] HUD FMR sync complete: ${count} baselines upserted`);

    return NextResponse.json({
      message: 'HUD FMR sync complete',
      synced: count,
    });
  } catch (error) {
    console.error('[Sync] HUD FMR sync error:', error);
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
