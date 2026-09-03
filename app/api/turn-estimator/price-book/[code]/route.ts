import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { repricePriceBookItem, retirePriceBookItem } from '@/lib/turn-estimator/price-book';

/** PATCH /api/turn-estimator/price-book/[code] — reprice (new effective row). Administrator. */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const { code } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const effectiveFrom = typeof body.effective_from === 'string' ? body.effective_from : undefined;
  try {
    const item = await repricePriceBookItem(code, body as never, guard.email, effectiveFrom);
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

/** DELETE /api/turn-estimator/price-book/[code] — retire (deactivate). Administrator. */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const { code } = await ctx.params;
  const effectiveTo = new URL(request.url).searchParams.get('effective_to') ?? undefined;
  try {
    await retirePriceBookItem(code, guard.email, effectiveTo);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
