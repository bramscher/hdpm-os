import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getKeySlots, type KeyListFilter } from '@/lib/keys';
import type { KeySlotStatus } from '@/types/keys';

/**
 * GET /api/keys
 *
 * Key registry list: every slot with its active assignment snapshot and
 * issued-copy counts. Query params: q (key #, address, property, owner,
 * tenant), status (open|assigned|vacant|retired|flagged|unlinked|af_vacant).
 */
export async function GET(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const filter: KeyListFilter = {};
    const q = url.searchParams.get('q');
    if (q) filter.q = q;
    const status = url.searchParams.get('status');
    if (status) filter.status = status as KeySlotStatus | 'flagged' | 'unlinked' | 'af_vacant';

    const rows = await getKeySlots(filter);
    return NextResponse.json({ keys: rows });
  } catch (error) {
    console.error('[api/keys] list error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load keys';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
