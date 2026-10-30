import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { withCronRun } from '@/lib/cron/run';
import { purgeOldPoints, rebuildYesterday } from '@/lib/field-app/server';

// Daily, early morning Pacific: build yesterday's field days from the phones' points (so techs can
// confirm them), then delete raw points older than 30 days (field-location-app-plan.md, Privacy).
async function handleGET(request: Request) {
  const expected = process.env.CRON_SECRET ? Buffer.from(`Bearer ${process.env.CRON_SECRET}`) : null;
  const received = Buffer.from(request.headers.get('authorization') || '');
  if (!expected || received.length !== expected.length || !timingSafeEqual(received, expected))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const collected = await rebuildYesterday();
    return NextResponse.json({ ok: true, collected, deleted: await purgeOldPoints() });
  } catch {
    return NextResponse.json({ error: 'Field day build or point purge failed' }, { status: 500 });
  }
}

export const GET = withCronRun(handleGET);
