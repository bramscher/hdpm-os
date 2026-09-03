import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { getTurnLifecycle } from '@/lib/turn-estimator/turns';

/** GET /api/turn-estimator/turns/[id] — turn header + status history. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const result = await getTurnLifecycle(id);
  if (!result) return NextResponse.json({ error: 'turn not found' }, { status: 404 });
  return NextResponse.json(result);
}
