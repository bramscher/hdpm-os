import { NextRequest, NextResponse } from 'next/server';
import { runScorecardWeek } from '@/lib/eos/scorecard-run';
export const maxDuration = 120;
/** After the daily 13:30 UTC metrics capture. Friday communications stay on the weekly cron. */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({error: 'Unauthorized'}, {status:401});
  }
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles',weekday:'short'}).format(now);
  if (weekday === 'Sat' || weekday === 'Sun') return NextResponse.json({skipped:'Friday numbers remain fixed over the weekend'});
  try {
    return NextResponse.json(await runScorecardWeek({now, weeklyActions:false, dryRun:request.nextUrl.searchParams.get('dryRun') === '1'}));
  } catch (e) { return NextResponse.json({error:(e as Error).message}, {status:500}); }
}
