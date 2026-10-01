import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { NotFoundError, updatePartsOrder } from '@/lib/maintenance/parts-db';

/** PATCH /api/maintenance/parts-orders/:id — status, expected date, tracking link, or notes. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    return NextResponse.json(await updatePartsOrder(session.actor, id, await request.json()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof NotFoundError ? 404 : 400 });
  }
}
