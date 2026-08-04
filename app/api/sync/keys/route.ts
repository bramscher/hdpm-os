import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { syncKeyAssignments } from '@/lib/keys-sync';

// AppFolio v0 API is slow; give the sync the full Vercel Pro window.
export const maxDuration = 300;

/**
 * GET /api/sync/keys — Vercel Cron sends GET; delegates to POST (same auth).
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/sync/keys
 *
 * Refresh AppFolio-owned snapshot fields (property, address, owner, tenants,
 * occupancy) on active linked key assignments and recompute mismatch flags.
 * Auth: CRON_SECRET bearer (daily cron) OR staff session ("Sync now" button).
 * Never touches app-owned key state.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isCron) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    console.log(`[Sync] Starting key assignments sync (${isCron ? 'cron' : 'manual'})...`);
    const result = await syncKeyAssignments();
    console.log(
      `[Sync] Keys sync complete: ${result.updated}/${result.scanned} updated, ${result.flagged} flagged`
    );

    return NextResponse.json({ message: 'Key sync complete', ...result });
  } catch (error) {
    console.error('[Sync] Keys sync error:', error);
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
