import { NextRequest, NextResponse } from 'next/server';
import { loadTripwireSnapshot, runTripwires } from '@/lib/maintenance/tripwire-engine';
import { buildDigest, groupByOwner } from '@/lib/maintenance/digest';
import { sendDigestEmail } from '@/lib/maintenance/email';
import { recordEvents, type NewEvent } from '@/lib/maintenance/events';

export const maxDuration = 300;

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/maintenance/cron/tripwires
 *
 * Daily (weekday-morning) tripwire run:
 *  1. run all 12 rules
 *  2. record a wo_event('exception') per finding (history — the live view
 *     re-runs the rules on demand)
 *  3. send one Resend digest per owner with exceptions
 *
 * Auth: CRON_SECRET bearer. ?dryRun=1 skips events + emails.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';

    const snapshot = await loadTripwireSnapshot();
    const result = runTripwires(snapshot);
    console.log(
      `[Tripwires] ${result.exceptions.length} exception(s), ${result.ruleErrors.length} rule error(s)`
    );

    if (dryRun) {
      return NextResponse.json({ ...result, dryRun: true });
    }

    // 2. Exception events (only for exceptions tied to a WO)
    const events: NewEvent[] = result.exceptions
      .filter((ex) => ex.workOrderId)
      .map((ex) => ({
        work_order_id: ex.workOrderId!,
        event_type: 'exception',
        payload: {
          tripwire: ex.tripwire,
          label: ex.label,
          item: ex.item,
          fix_required: ex.fixRequired,
          owner: ex.owner,
        },
        actor: `system:tripwire-${ex.tripwire}`,
      }));
    await recordEvents(events);

    // 3. Per-owner digests
    const baseUrl =
      process.env.NEXTAUTH_URL || `https://${process.env.VERCEL_URL || 'localhost:3000'}`;
    const dateStr = snapshot.now.toISOString().slice(0, 10);
    const sends = [];
    for (const [owner, exceptions] of groupByOwner(result.exceptions)) {
      const digest = buildDigest(owner, exceptions, dateStr, baseUrl);
      if (!digest) continue;
      sends.push(await sendDigestEmail(owner, digest));
    }

    return NextResponse.json({
      exceptions: result.exceptions.length,
      ruleErrors: result.ruleErrors,
      eventsRecorded: events.length,
      digests: sends,
    });
  } catch (error) {
    console.error('[Tripwires] Cron error:', error);
    const message = error instanceof Error ? error.message : 'Tripwire run failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
