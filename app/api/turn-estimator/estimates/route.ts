import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { createEstimate } from '@/lib/turn-estimator/estimates';

/** POST /api/turn-estimator/estimates — create a draft estimate. maintenance/pm/admin. */
export async function POST(request: NextRequest) {
  const guard = await requireRole('maintenance', 'pm', 'admin');
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const estimate = await createEstimate(body as never, guard.email);
    return NextResponse.json({ estimate });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
