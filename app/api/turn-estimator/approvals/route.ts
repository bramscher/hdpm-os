import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { requestApproval } from '@/lib/turn-estimator/estimates';

/** POST /api/turn-estimator/approvals — request an approval on a version. maintenance/pm/admin. */
export async function POST(request: NextRequest) {
  const guard = await requireRole('maintenance', 'pm', 'admin');
  if (!guard.ok) return guard.response;
  let body: { version_id?: string; kind?: 'OWNER' | 'PM' | 'OPS' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.version_id || !body.kind) {
    return NextResponse.json({ error: 'version_id and kind required' }, { status: 400 });
  }
  try {
    const res = await requestApproval(body.version_id, body.kind, guard.email);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
