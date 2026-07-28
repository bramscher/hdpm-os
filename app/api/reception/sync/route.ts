import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { syncReceptionCalls } from '@/lib/reception';
import { isZoomConfigured } from '@/lib/zoom-phone';

export const maxDuration = 300;

// Vercel Cron sends GET; expose both verbs.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/reception/sync
 *
 * Pull main-line call classifications from Zoom Phone call history into
 * reception_call. Default window is the last 3 days (rolling, idempotent);
 * pass ?from=YYYY-MM-DD&to=YYYY-MM-DD for a backfill.
 * Auth: CRON_SECRET bearer OR @highdesertpm.com session.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      const session = await getServerSession();
      if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    if (!isZoomConfigured()) {
      return NextResponse.json({ error: 'Zoom credentials not configured' }, { status: 503 });
    }

    const params = new URL(request.url).searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const from = params.get('from') || threeDaysAgo;
    const to = params.get('to') || today;

    const supabase = getSupabaseAdmin();
    const result = await syncReceptionCalls(supabase, from, to);

    console.log(
      `[Reception Sync] ${result.daysCovered}: ${result.inboundCalls} main-line calls, ` +
        `${result.havenTransfers} Haven transfers, ${result.upserted} rows upserted`
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Reception Sync] error:', error);
    const message = error instanceof Error ? error.message : 'Reception sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
