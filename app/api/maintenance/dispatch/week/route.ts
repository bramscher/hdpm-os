import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { loadTechDays } from '@/lib/maintenance/dispatch-schedule';

/**
 * GET /api/maintenance/dispatch/week?start=YYYY-MM-DD&days=7
 *
 * Draft and published tech days for the dispatch week strip (and the Route
 * Builder's "load the draft" banner, with days=1).
 */
export async function GET(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = request.nextUrl.searchParams.get('start') ?? '';
  const days = Number(request.nextUrl.searchParams.get('days') ?? 7);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return NextResponse.json({ error: 'start must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    return NextResponse.json({ error: 'days must be 1–31' }, { status: 400 });
  }

  try {
    return NextResponse.json({ techDays: await loadTechDays(start, days) });
  } catch (error) {
    console.error('[Maintenance] Dispatch week load error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load the week';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
