import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { linkWorkOrdersToTurn } from '@/lib/maintenance/unit-turns';
import type { UnitTurn } from '@/lib/maintenance/types';

/**
 * GET /api/maintenance/unit-turns[?status=active|ready|closed|all]
 *
 * List unit turns (default: everything not closed) with their linked
 * work orders (id, wo_number, description, stage) so any view can render
 * a turn together with all of its WOs.
 */
export async function GET(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const status = request.nextUrl.searchParams.get('status');

    let query = supabase.from('unit_turn').select('*').order('vacated_at', { ascending: true });
    if (status && status !== 'all') {
      query = query.eq('status', status);
    } else if (!status) {
      query = query.neq('status', 'closed');
    }
    const { data: turns, error } = await query;
    if (error) throw new Error(error.message);

    const turnIds = (turns ?? []).map((t) => t.id);
    let workOrders: Record<string, unknown>[] = [];
    if (turnIds.length > 0) {
      const { data: wos, error: woError } = await supabase
        .from('work_orders')
        .select('id, wo_number, description, stage, owner_name, vendor_name, assigned_tech, unit_turn_id, closed_at')
        .in('unit_turn_id', turnIds);
      if (woError) throw new Error(woError.message);
      workOrders = wos ?? [];
    }

    const byTurn = new Map<string, Record<string, unknown>[]>();
    for (const wo of workOrders) {
      const key = wo.unit_turn_id as string;
      if (!byTurn.has(key)) byTurn.set(key, []);
      byTurn.get(key)!.push(wo);
    }

    return NextResponse.json({
      turns: (turns ?? []).map((t) => ({ ...t, work_orders: byTurn.get(t.id) ?? [] })),
    });
  } catch (error) {
    console.error('[Maintenance] Unit turns list error:', error);
    const message = error instanceof Error ? error.message : 'Failed to list unit turns';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/maintenance/unit-turns
 *
 * Create a unit turn. Body: { property_name, vacated_at, property_id?,
 * unit_id?, unit_name?, target_ready?, movein_date?, current_blocker?,
 * budget?, notes?, wo_ids? } — wo_ids are linked (audited) on create.
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.property_name || !body.vacated_at) {
      return NextResponse.json(
        { error: 'property_name and vacated_at are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: turn, error } = await supabase
      .from('unit_turn')
      .insert({
        property_id: body.property_id ?? null,
        property_name: body.property_name,
        unit_id: body.unit_id ?? null,
        unit_name: body.unit_name ?? null,
        vacated_at: body.vacated_at,
        target_ready: body.target_ready ?? null,
        movein_date: body.movein_date ?? null,
        current_blocker: body.current_blocker ?? null,
        budget: body.budget ?? null,
        notes: body.notes ?? null,
      })
      .select('*')
      .single();
    if (error || !turn) throw new Error(error?.message || 'unit_turn insert failed');

    if (Array.isArray(body.wo_ids) && body.wo_ids.length > 0) {
      await linkWorkOrdersToTurn(turn as UnitTurn, body.wo_ids, session.actor);
    }

    return NextResponse.json({ turn });
  } catch (error) {
    console.error('[Maintenance] Unit turn create error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create unit turn';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
