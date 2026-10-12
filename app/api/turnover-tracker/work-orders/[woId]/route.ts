import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { setWoStatus } from '@/lib/turnover/server';

/**
 * POST /api/turnover-tracker/work-orders/[woId]  { status }
 * Hand-set a work order's tracker status. Kept in the tool only; it holds
 * until AppFolio's own status changes.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ woId: string }> }) {
  const guard = await requireSection('brody_turnover');
  if (!guard.ok) return guard.response;
  const { woId } = await ctx.params;
  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const turnId = await setWoStatus(getSupabaseAdmin(), woId, String(body.status ?? ''), guard.name || guard.email);
    return NextResponse.json({ ok: true, unit_turn_id: turnId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: message === 'Work order not found' ? 404 : 400 });
  }
}
