import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { recordEvent } from '@/lib/maintenance/events';

/**
 * POST /api/maintenance/recommendations
 *
 * Log a tech field recommendation (tripwire #10: it must become a WO or be
 * dismissed in writing within 3 days). Body: { tech, body, work_order_id? }
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.tech || !body.body) {
      return NextResponse.json({ error: 'tech and body are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('recommendation')
      .insert({
        tech: body.tech,
        body: body.body,
        work_order_id: body.work_order_id ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Recommendation insert failed');
    }

    if (body.work_order_id) {
      await recordEvent({
        work_order_id: body.work_order_id,
        event_type: 'recommendation',
        payload: { recommendation_id: data.id, tech: body.tech, body: body.body },
        actor: session.actor,
      });
    }

    return NextResponse.json({ recommendation: data });
  } catch (error) {
    console.error('[Maintenance] Recommendation create error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create recommendation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
