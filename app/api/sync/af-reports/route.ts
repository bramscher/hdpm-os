import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { commitKeysReconcile, fetchAfKeysDetailRows } from '@/lib/keys-reconcile';
import { trueUpUnitTurnsFromReport } from '@/lib/maintenance/unit-turns';
import { reportsApiConfigured } from '@/lib/appfolio-reports';

// Reports API + v0 units bridge — give it the full Vercel Pro window.
export const maxDuration = 300;

/**
 * GET /api/sync/af-reports — Vercel Cron sends GET; delegates to POST.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/sync/af-reports
 *
 * Daily pull from the AppFolio Reports API v2:
 *  1. keys_detail  → replaces the key_af_checkout snapshot (same commit path
 *     as the CSV upload, actor 'appfolio-reports-sync')
 *  2. unit_turn_detail → trues up unit_turn rows (AF turn id, move-out /
 *     expected-move-in dates, target, billed actuals; creates in-progress
 *     turns that have no WOs yet)
 *
 * Steps run independently — one failing doesn't block the other.
 * Auth: CRON_SECRET bearer (daily cron) OR staff session.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron) {
    const session = await getServerSession();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!reportsApiConfigured()) {
    return NextResponse.json(
      { error: 'AppFolio Reports API credentials not configured' },
      { status: 503 }
    );
  }

  const result: {
    keys: Record<string, unknown> | null;
    unit_turns: Record<string, unknown> | null;
    errors: Record<string, string>;
  } = { keys: null, unit_turns: null, errors: {} };

  try {
    const rows = await fetchAfKeysDetailRows();
    if (rows.length > 0) {
      result.keys = { ...(await commitKeysReconcile(rows, 'appfolio-reports-sync')) };
    } else {
      // An empty report would wipe the snapshot for nothing — refuse.
      result.errors.keys = 'Reports API returned zero checked-out keys; snapshot left untouched';
    }
  } catch (err) {
    console.error('[Sync] AF reports keys step failed:', err);
    result.errors.keys = err instanceof Error ? err.message : String(err);
  }

  try {
    result.unit_turns = { ...(await trueUpUnitTurnsFromReport()) };
  } catch (err) {
    console.error('[Sync] AF reports unit-turn step failed:', err);
    result.errors.unit_turns = err instanceof Error ? err.message : String(err);
  }

  const failed = Object.keys(result.errors).length;
  return NextResponse.json(
    { message: failed ? 'AF reports sync completed with errors' : 'AF reports sync complete', ...result },
    { status: failed === 2 ? 500 : 200 }
  );
}
