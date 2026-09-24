import { NextRequest, NextResponse } from 'next/server';
import { previewActivitiesDm, runActivitiesDm } from '@/lib/agents/activities-dm';
import type { DmKind } from '@/lib/activities';

export const maxDuration = 300;

/**
 * POST /api/agents/cron/activities
 *
 * Weekday Slack DMs of each person's AppFolio activities. Times are UTC ≈ PT
 * in summer (winter drift is the accepted repo-wide cron limitation):
 * - 14:00          — morning card (due today + overdue count)
 * - ?kind=new      — hourly 15:00–23:00: activities due today that appeared
 *                    since the person was last told (each announced once)
 * - ?kind=nudge    — 20:00 (1 PM): whatever is still due today
 *
 * Query flags:
 * - ?dryRun=1      — compute recipients + notification text, send nothing
 * - ?only=<person> — restrict to one staff member (person, name, or email)
 * - ?previewAs=<AppFolio assignee>&to=<staff>[&asOf=YYYY-MM-DD] — send that
 *   assignee's card ONLY to <staff> (a test sample; no outbox, no dedupe)
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const kindParam = params.get('kind') ?? (params.get('nudge') === '1' ? 'nudge' : 'morning');
  if (!['morning', 'nudge', 'new'].includes(kindParam)) {
    return NextResponse.json({ error: 'kind must be morning, nudge, or new' }, { status: 400 });
  }
  const kind = kindParam as DmKind;
  const dryRun = params.get('dryRun') === '1';
  const only = params.get('only');
  console.log(`[Agents] activities DM cron (${kind})${dryRun ? ' (dry run)' : ''}${only ? ` only=${only}` : ''}...`);

  try {
    const previewAs = params.get('previewAs');
    if (previewAs) {
      const to = params.get('to');
      if (!to) return NextResponse.json({ error: 'previewAs requires &to=<staff person>' }, { status: 400 });
      return NextResponse.json(await previewActivitiesDm({ assignee: previewAs, to, asOf: params.get('asOf'), kind }));
    }
    return NextResponse.json(await runActivitiesDm({ kind, dryRun, only }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] activities DM cron failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
