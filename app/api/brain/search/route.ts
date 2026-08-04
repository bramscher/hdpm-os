import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { searchBrain } from '@/lib/brain/retrieve';

/**
 * POST /api/brain/search — raw brain retrieval for agents (Brief 1D).
 * Auth: service token (scope 'agents') + X-Agent-Actor, or staff session.
 * Sensitivity is clamped to 'internal' — 'restricted' chunks never leave
 * the brain over this surface regardless of what the caller asks for.
 *
 * Body: { query: string, limit?: number }
 */
export async function POST(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { query?: unknown; limit?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return NextResponse.json({ error: 'query (string) is required' }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(body.limit) || 12, 1), 30);

  try {
    const matches = await searchBrain(query, { limit, maxSensitivity: 'internal' });
    return NextResponse.json({ matches, caller: caller.actor });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[brain] search API failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
