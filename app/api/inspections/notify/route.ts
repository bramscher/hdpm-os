import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getDueNotices, markNoticesSent } from '@/lib/inspection-notify';

/**
 * Tenant inspection notices — AppFolio bulk-send bridge.
 *
 * AppFolio has no API to send messages, and notices must be logged inside
 * AppFolio, so we don't send email ourselves. Instead:
 *   GET  — returns the "due this period" list (recipients + ready-to-paste notice)
 *          that staff send via Realm-X Assistant "Send Bulk Email".
 *   POST { ids } — marks those inspections notified once they've been sent in AppFolio.
 *
 * Auth: @highdesertpm.com session (staff-driven; no cron).
 */
async function requireStaff() {
  const session = await getServerSession();
  return Boolean(session?.user?.email?.endsWith('@highdesertpm.com'));
}

export async function GET() {
  if (!(await requireStaff())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const result = await getDueNotices(supabase);
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
  if (!(await requireStaff())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    if (!ids.length) {
      return NextResponse.json({ error: 'ids[] required' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { updated } = await markNoticesSent(supabase, ids);
    return NextResponse.json({ marked_sent: updated });
  } catch (err) {
    console.error('[inspections/notify] POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to mark notices sent' },
      { status: 500 }
    );
  }
}
