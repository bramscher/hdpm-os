import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchWorkOrderDetails } from '@/lib/appfolio';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { listEvents, recordEvent } from '@/lib/maintenance/events';
import { generateTriage } from '@/lib/maintenance/ai-triage';
import type { MaintWorkOrder } from '@/lib/maintenance/types';

export const maxDuration = 120; // Claude call + live AppFolio fetch

/**
 * GET /api/maintenance/work-orders/:id/ai-triage
 *
 * Latest cached triage (a wo_event of type 'ai_triage'), or {triage: null}.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('wo_event')
    .select('payload, actor, created_at')
    .eq('work_order_id', id)
    .eq('event_type', 'ai_triage')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    triage: data?.payload ?? null,
    generatedAt: data?.created_at ?? null,
    generatedBy: data?.actor ?? null,
  });
}

/**
 * POST /api/maintenance/work-orders/:id/ai-triage
 *
 * Generate a fresh AI triage: pulls the live AppFolio detail (tenant remarks,
 * entry instructions, …), feeds it + our workflow state + the event timeline
 * to Claude, and caches the structured result as an 'ai_triage' event.
 * Advisory only — nothing is written to AppFolio.
 */
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
    const supabase = getSupabaseAdmin();

    const { data: workOrder, error } = await supabase
      .from('work_orders')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !workOrder) {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
    }
    const wo = workOrder as MaintWorkOrder;

    // Rich detail live from AppFolio (best effort — triage works without it)
    const [events, detail] = await Promise.all([
      listEvents(id),
      fetchWorkOrderDetails(wo.appfolio_id),
    ]);

    const triage = await generateTriage(wo, events, { appfolio: detail });

    await recordEvent({
      work_order_id: id,
      event_type: 'ai_triage',
      payload: triage as unknown as Record<string, unknown>,
      actor: session.actor,
    });

    return NextResponse.json({
      triage,
      generatedAt: new Date().toISOString(),
      generatedBy: session.actor,
    });
  } catch (error) {
    console.error('[Maintenance] AI triage error:', error);
    const message = error instanceof Error ? error.message : 'AI triage failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
