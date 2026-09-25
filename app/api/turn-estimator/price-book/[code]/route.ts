import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { repricePriceBookItem, retirePriceBookItem } from '@/lib/turn-estimator/price-book';
import { parsePriceBookInput } from '@/lib/turn-estimator/price-book-input';

/**
 * PATCH /api/turn-estimator/price-book/[code] — edit any field of an item
 * (name, description, method, prices, minutes, markup, GL, flags). Writes a
 * new effective row from today; issued estimates keep their original row.
 * Administrator.
 */
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
  const parsed = parsePriceBookInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    // Always effective today: the one-current-row index can't hold a future-dated version alongside today's.
    const item = await repricePriceBookItem(code, parsed.value, guard.email);
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
