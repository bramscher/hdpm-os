import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-admin';
import { runZoomSync, ALL_CONTACT_TYPES, type SyncResult } from '@/lib/zoom-sync';
import type { ZoomContactType } from '@/lib/appfolio';

export const maxDuration = 300;

/**
 * POST /api/zoom-sync/run — manual sync trigger (admin only).
 * Optional body: { types?: ("vendor"|"owner"|"tenant")[] }
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  let types: ZoomContactType[] = ALL_CONTACT_TYPES;
  try {
    const body = (await request.json().catch(() => ({}))) as { types?: ZoomContactType[] };
    if (Array.isArray(body.types) && body.types.length) {
      types = body.types.filter((t) => ALL_CONTACT_TYPES.includes(t));
    }
  } catch {
    // no body — use defaults
  }

  const result: SyncResult = await runZoomSync({ types, triggeredBy: guard.email || 'admin' });
  return NextResponse.json(result, { status: result.status === 'failed' ? 502 : 200 });
}
