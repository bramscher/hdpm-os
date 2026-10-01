import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { loadActivityFeed } from '@/lib/agents/activity-feed';

/**
 * GET /api/agents/activity?since=<ISO> — merged agent-layer timeline, newest
 * first. Defaults to the last 24 hours; `since` is clamped to 7 days back.
 */
export async function GET(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = Date.now();
  const raw = Date.parse(request.nextUrl.searchParams.get('since') ?? '');
  const since = new Date(Math.max(Number.isFinite(raw) ? raw : now - 86_400_000, now - 7 * 86_400_000));
  const items = await loadActivityFeed(since);
  return NextResponse.json({ items, since: since.toISOString(), now: new Date(now).toISOString() });
}
