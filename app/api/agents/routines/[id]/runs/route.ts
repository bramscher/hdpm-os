import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { routineById } from '@/lib/routines/registry';
import { loadRuns } from '@/lib/routines/status';

/** GET /api/agents/routines/:id/runs — the routine's last 20 runs (newest first). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!routineById(id)) return NextResponse.json({ error: 'Unknown routine' }, { status: 404 });
  return NextResponse.json({ runs: await loadRuns(id) });
}
