import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { withCronRun } from '@/lib/cron/run';
import { reportsApiConfigured } from '@/lib/appfolio-reports';
import { syncAfWoBilling } from '@/lib/maintenance/af-wo-billing';
import { syncAfBills } from '@/lib/af-bills';

export const maxDuration = 300;

/**
 * GET /api/maintenance/cron/af-billing
 * Mirrors which work orders have an invoice uploaded or a bill entered in
 * AppFolio into wo_af_billing (lib/maintenance/af-wo-billing.ts), and pulls
 * HDMS vendor bills into af_bills (lib/af-bills.ts) so the daily billing
 * review's AppFolio verification never goes stale. Before this, af_bills only
 * refreshed from the Reconcile tab's sync button. Runs a few times a day;
 * CRON_SECRET only.
 */
async function handleGET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Bills come from the v0 API, independent of the Reports API below.
  let bills: Awaited<ReturnType<typeof syncAfBills>> | { error: string };
  try {
    bills = await syncAfBills();
  } catch (err) {
    console.error('[af-billing] bill sync failed:', err);
    bills = { error: err instanceof Error ? err.message : 'Bill sync failed' };
  }
  if (!reportsApiConfigured()) return NextResponse.json({ bills, skipped: 'Reports API not configured' });
  try {
    return NextResponse.json({ bills, ...(await syncAfWoBilling(getSupabaseAdmin())) });
  } catch (err) {
    console.error('[af-billing] sync failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 503 });
  }
}

export const GET = withCronRun(handleGET);
