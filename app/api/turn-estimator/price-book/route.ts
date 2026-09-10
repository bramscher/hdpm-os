import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession, requireRole } from '@/lib/require-role';
import { listPriceBookItems, createPriceBookItem } from '@/lib/turn-estimator/price-book';

/** GET /api/turn-estimator/price-book — list current items (any company user). */
export async function GET(request: NextRequest) {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard.response;
  const category = new URL(request.url).searchParams.get('category') ?? undefined;
  try {
    const items = await listPriceBookItems({ category });
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** POST /api/turn-estimator/price-book — create a new item (Administrator). */
export async function POST(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.item_code || !body.category || !body.name || !body.pricing_method) {
    return NextResponse.json({ error: 'item_code, category, name, pricing_method required' }, { status: 400 });
  }
  try {
    const item = await createPriceBookItem(body as never, guard.email);
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
