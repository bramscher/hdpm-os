import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { isUuid } from '@/lib/maintenance/parts';
import { createPartsOrder, listPartsOrders, listSuppliers, NotFoundError } from '@/lib/maintenance/parts-db';

/** GET /api/maintenance/parts-orders?work_order_id= — orders on one work order plus the supplier list. */
export async function GET(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('work_order_id');
  if (!isUuid(id)) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
  try {
    const [orders, suppliers] = await Promise.all([listPartsOrders(id), listSuppliers()]);
    return NextResponse.json({ orders, suppliers });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

/** POST /api/maintenance/parts-orders — log an order; moves the work order to WAITING_ON / PARTS. */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const input = await request.json();
    return NextResponse.json(await createPartsOrder(session.actor, input.work_order_id, input));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof NotFoundError ? 404 : 400 });
  }
}
