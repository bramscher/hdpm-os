import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { appendKeyEvent } from '@/lib/keys';

/** POST /api/keys/:id/notes — append a note to the key's history feed. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as { note?: string };
    const note = body.note?.trim();
    if (!note) {
      return NextResponse.json({ error: 'note is required' }, { status: 422 });
    }

    await appendKeyEvent(id, 'note', { note }, session.actor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/keys/:id/notes] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to add note';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
