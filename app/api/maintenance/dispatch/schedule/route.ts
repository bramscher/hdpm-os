import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { MAX_STOPS_PER_DAY, parseScheduleRow, scheduleWorkOrders } from '@/lib/maintenance/dispatch-schedule';

/**
 * POST /api/maintenance/dispatch/schedule
 *
 * Week strip drop. Body: { work_order_ids: string[], row: { kind: 'tech', person } |
 * { kind: 'vendor' }, date: 'YYYY-MM-DD' | null }. A tech day is a draft route
 * (never sent to the tech until it is published in the Route Builder); date null
 * takes the work orders off the strip. One result per work order.
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const ids: unknown = body.work_order_ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
      return NextResponse.json({ error: 'work_order_ids is required' }, { status: 400 });
    }
    if (ids.length > MAX_STOPS_PER_DAY) {
      return NextResponse.json({ error: `Schedule at most ${MAX_STOPS_PER_DAY} work orders at a time` }, { status: 400 });
    }
    const row = parseScheduleRow(body.row);
    if (!row) {
      return NextResponse.json({ error: 'row must be a tech or the vendors row' }, { status: 400 });
    }
    const date = body.date === null ? null : String(body.date ?? '');
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD or null' }, { status: 400 });
    }

    const results = await scheduleWorkOrders([...new Set(ids as string[])], row, date, session.actor);
    const failed = results.filter((r) => !r.ok).length;
    return NextResponse.json({ results }, { status: failed === results.length ? 422 : 200 });
  } catch (error) {
    console.error('[Maintenance] Dispatch schedule error:', error);
    const message = error instanceof Error ? error.message : 'Failed to schedule';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
