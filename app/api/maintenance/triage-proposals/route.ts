import { NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { listPendingProposals } from '@/lib/maintenance/triage-batch';

/** GET /api/maintenance/triage-proposals — pending proposals + their WOs. */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const rows = await listPendingProposals();
    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[Maintenance] Proposal list error:', error);
    const message = error instanceof Error ? error.message : 'List failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
