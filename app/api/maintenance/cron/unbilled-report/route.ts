import { NextRequest, NextResponse } from 'next/server';
import { loadTripwireSnapshot } from '@/lib/maintenance/tripwire-engine';
import { tripwire8 } from '@/lib/maintenance/tripwires';
import { buildDigest } from '@/lib/maintenance/digest';
import { sendDigestEmail } from '@/lib/maintenance/email';

export const maxDuration = 300;

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/maintenance/cron/unbilled-report
 *
 * Weekly (Monday) verified-but-unbilled report → Penny (tripwire #8).
 * Auth: CRON_SECRET bearer. ?dryRun=1 skips the email.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';

    const snapshot = await loadTripwireSnapshot();
    const unbilled = tripwire8(snapshot);
    console.log(`[Unbilled] ${unbilled.length} verified-but-unbilled work order(s)`);

    if (dryRun || unbilled.length === 0) {
      return NextResponse.json({ unbilled, sent: false, dryRun });
    }

    const baseUrl =
      process.env.NEXTAUTH_URL || `https://${process.env.VERCEL_URL || 'localhost:3000'}`;
    const dateStr = snapshot.now.toISOString().slice(0, 10);

    // The weekly report always goes to Penny regardless of per-item owner.
    const digest = buildDigest(
      'Penny',
      unbilled.map((ex) => ({ ...ex, owner: 'Penny' })),
      dateStr,
      baseUrl
    );
    const send = digest ? await sendDigestEmail('Penny', digest) : null;

    return NextResponse.json({ unbilled: unbilled.length, digest: send });
  } catch (error) {
    console.error('[Unbilled] Cron error:', error);
    const message = error instanceof Error ? error.message : 'Unbilled report failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
