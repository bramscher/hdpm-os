import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-admin';
import { listContactMap } from '@/lib/zoom-sync';
import { ALL_CONTACT_TYPES } from '@/lib/zoom-sync';
import type { ZoomContactType } from '@/lib/appfolio';

/**
 * GET /api/zoom-sync/contacts — the mapping table, for the admin UI.
 * Query: ?type=vendor&search=foo&activeOnly=1&limit=50&offset=0
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get('type');
  const type = ALL_CONTACT_TYPES.includes(typeParam as ZoomContactType)
    ? (typeParam as ZoomContactType)
    : undefined;
  const search = searchParams.get('search')?.trim() || undefined;
  const activeOnly = searchParams.get('activeOnly') === '1';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const result = await listContactMap({ type, search, activeOnly, limit, offset });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list contacts' },
      { status: 500 }
    );
  }
}
