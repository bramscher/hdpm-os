import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-admin';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/admin/appfolio-webhook-log — inspect recently captured AppFolio
 * webhook events (financial topics). Used while wiring the HDMS ACH auto-capture:
 * subscribe to Journal Entries / Bills in AppFolio, fire an event, then read the
 * real entity shape here. ?topic=journal filters by topic substring.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const topic = searchParams.get('topic');
    const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10) || 25, 200);

    let query = getSupabaseAdmin()
      .from('appfolio_webhook_log')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(limit);

    if (topic) query = query.ilike('topic', `%${topic}%`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ events: data });
  } catch (error) {
    console.error('Get webhook log error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch webhook log';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
