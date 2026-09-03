import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { advanceTurn } from '@/lib/turn-estimator/turns';

/** POST /api/turn-estimator/turns/[id]/advance — move a turn to a new status. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole('maintenance', 'pm', 'manager', 'admin');
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  let body: { to?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.to) return NextResponse.json({ error: 'to (target status) required' }, { status: 400 });
  try {
    const result = await advanceTurn(id, body.to, guard.email, body.reason);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
