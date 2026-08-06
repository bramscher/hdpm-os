import { NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { collectCracks } from '@/lib/cracks';

/**
 * GET /api/maintenance/cracks
 *
 * The Cracks Radar: a ranked, cross-system list of work nobody is touching
 * (tripwire exceptions, no-next-date WOs, undecided agent proposals,
 * overdue/missed to-dos). Feeds the home-dashboard card.
 */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const report = await collectCracks();
    return NextResponse.json(report);
  } catch (error) {
    console.error('[Cracks] collect error:', error);
    const message = error instanceof Error ? error.message : 'Failed to collect cracks';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
