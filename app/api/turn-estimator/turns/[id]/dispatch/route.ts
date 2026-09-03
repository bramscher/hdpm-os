import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession, requireRole } from '@/lib/require-role';
import { getTurnDispatch, syncTurnStatusFromWorkOrders } from '@/lib/turn-estimator/dispatch';

/** GET /api/turn-estimator/turns/[id]/dispatch — the turn's WOs + estimate-vs-actual variance. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await getTurnDispatch(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/**
 * POST /api/turn-estimator/turns/[id]/dispatch — drive the turn lifecycle from
 * its work orders' AppFolio stages. maintenance/pm/manager/admin.
 */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole('maintenance', 'pm', 'manager', 'admin');
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  try {
    const result = await syncTurnStatusFromWorkOrders(id, guard.email);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
