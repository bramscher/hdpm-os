import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { decideApproval } from '@/lib/turn-estimator/estimates';

/** PATCH /api/turn-estimator/approvals/[id] — decide an approval. pm/manager/admin. */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole('pm', 'manager', 'admin');
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  let body: {
    decision?: 'APPROVED' | 'DECLINED' | 'CHANGES';
    approved_amount?: number;
    conditions?: string;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.decision) {
    return NextResponse.json({ error: 'decision required' }, { status: 400 });
  }
  try {
    await decideApproval(id, body.decision, guard.email, {
      approvedAmount: body.approved_amount,
      conditions: body.conditions,
      reason: body.reason,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
