import { NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getKeyStats } from '@/lib/keys';

/** GET /api/keys/stats — dashboard counts. */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await getKeyStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('[api/keys/stats] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
