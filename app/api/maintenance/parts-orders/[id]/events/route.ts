import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { logPartsContact, NotFoundError } from '@/lib/maintenance/parts-db';

/** POST /api/maintenance/parts-orders/:id/events — record a call, email, text, or note with minutes spent. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    return NextResponse.json(await logPartsContact(session.actor, id, await request.json()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof NotFoundError ? 404 : 400 });
  }
}
