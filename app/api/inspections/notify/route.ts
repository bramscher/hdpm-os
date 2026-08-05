import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  getDueNotices,
  recordNoticeResults,
  type NoticeResult,
} from '@/lib/inspection-notify';

/**
 * Tenant inspection notices — dispatch queue + result recording.
 *
 * All notices must be LOGGED INSIDE AppFolio. The contract is sender-agnostic:
 *   - Manual bridge (today): staff copy-paste into Realm-X Assistant, then POST
 *     { ids } to mark them sent (channel 'manual').
 *   - A machine sender (none active — the Realm-X MCP route was dropped 07/2026)
 *     would GET ?dispatchable=1, send, then POST { results } per notice.
 *
 *   GET  ?dispatchable=1  — due notices with an email (machine-sendable).
 *   GET                   — all due notices incl. missing-email (staff view).
 *   POST { ids }          — mark sent, channel 'manual' (back-compat).
 *   POST { results }      — record per-notice outcomes (sent | failed | skipped).
 *
 * Auth: @highdesertpm.com session OR CRON_SECRET bearer (for the headless routine).
 */
async function authorize(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  const session = await auth();
  return Boolean(session?.user?.email?.endsWith('@highdesertpm.com'));
}

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const dispatchableOnly = new URL(request.url).searchParams.get('dispatchable') === '1';
    const supabase = getSupabaseAdmin();
    const result = await getDueNotices(supabase, { dispatchableOnly });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[inspections/notify] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load due notices' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const supabase = getSupabaseAdmin();

    // Rich form: per-notice results from a sender (Realm-X routine or email).
    if (Array.isArray(body?.results)) {
      const results = (body.results as NoticeResult[]).filter(
        (r) => r && typeof r.id === 'string' && ['sent', 'failed', 'skipped'].includes(r.status)
      );
      if (!results.length) {
        return NextResponse.json({ error: 'results[] had no valid entries' }, { status: 400 });
      }
      const summary = await recordNoticeResults(supabase, results);
      return NextResponse.json(summary);
    }

    // Back-compat: mark a set of ids sent via the manual bridge.
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (!ids.length) {
      return NextResponse.json({ error: 'ids[] or results[] required' }, { status: 400 });
    }
    const summary = await recordNoticeResults(
      supabase,
      ids.map((id) => ({ id, status: 'sent' as const, channel: 'manual' as const }))
    );
    return NextResponse.json({ marked_sent: summary.sent, ...summary });
  } catch (err) {
    console.error('[inspections/notify] POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to record notice results' },
      { status: 500 }
    );
  }
}
