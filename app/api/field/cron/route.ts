import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { withCronRun } from '@/lib/cron/run';
import { purgeOldPoints } from '@/lib/field-app/server';

// Daily: delete raw HDPM Field location points older than 30 days (field-location-app-plan.md, Privacy).
async function handleGET(request: Request) {
  const expected = process.env.CRON_SECRET ? Buffer.from(`Bearer ${process.env.CRON_SECRET}`) : null;
  const received = Buffer.from(request.headers.get('authorization') || '');
  if (!expected || received.length !== expected.length || !timingSafeEqual(received, expected))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, deleted: await purgeOldPoints() });
  } catch {
    return NextResponse.json({ error: 'Location point purge failed' }, { status: 500 });
  }
}

export const GET = withCronRun(handleGET);
