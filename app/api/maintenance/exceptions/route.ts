import { NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { loadTripwireSnapshot, runTripwires } from '@/lib/maintenance/tripwire-engine';

/**
 * GET /api/maintenance/exceptions
 *
 * The Exceptions view: a LIVE run of the 12 tripwire rules (query, not table).
 * Cheryl's daily sweep ends when this returns zero exceptions.
 */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await loadTripwireSnapshot();
    const result = runTripwires(snapshot);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Maintenance] Exceptions run error:', error);
    const message = error instanceof Error ? error.message : 'Failed to run tripwires';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
