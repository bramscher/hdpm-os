import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { readSnapshot } from '@/lib/brain/viz-server';

/**
 * GET /api/brain/viz — the latest brain map snapshot. Staff session (or agents service token) only
 * (/api/brain is a public proxy prefix, so this route guards itself).
 */
export async function GET(request: NextRequest) {
  if (!(await requireStaffOrService(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const snapshot = await readSnapshot();
  if (!snapshot) return NextResponse.json({ error: 'No snapshot yet' }, { status: 404 });
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
