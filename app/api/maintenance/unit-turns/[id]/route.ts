import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { linkWorkOrdersToTurn, unlinkWorkOrdersFromTurn } from '@/lib/maintenance/unit-turns';
import type { UnitTurn } from '@/lib/maintenance/types';

const PATCHABLE = [
  'vacated_at',
  'target_ready',
  'movein_date',
  'status',
  'current_blocker',
  'budget',
  'actual',
  'notes',
] as const;

/**
 * PUT /api/maintenance/unit-turns/:id
 *
 * Update a unit turn's fields and/or link/unlink work orders.
 * Body: any of { vacated_at, target_ready, movein_date, status,
 * current_blocker, budget, actual, notes, link_wo_ids, unlink_wo_ids }.
 * Linking/unlinking is audited to wo_event per work order.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const supabase = getSupabaseAdmin();

    const patch: Record<string, unknown> = {};
    for (const key of PATCHABLE) {
      if (key in body) patch[key] = body[key];
    }
    if (patch.status && !['active', 'ready', 'closed'].includes(patch.status as string)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    let turn: UnitTurn | null = null;
    if (Object.keys(patch).length > 0) {
      const { data, error } = await supabase
        .from('unit_turn')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message || 'unit_turn update failed');
      turn = data as UnitTurn;
    } else {
      const { data, error } = await supabase.from('unit_turn').select('*').eq('id', id).single();
      if (error || !data) {
        return NextResponse.json({ error: 'Unit turn not found' }, { status: 404 });
      }
      turn = data as UnitTurn;
    }

    if (Array.isArray(body.link_wo_ids) && body.link_wo_ids.length > 0) {
      await linkWorkOrdersToTurn(turn, body.link_wo_ids, session.actor);
    }
    if (Array.isArray(body.unlink_wo_ids) && body.unlink_wo_ids.length > 0) {
      await unlinkWorkOrdersFromTurn(body.unlink_wo_ids, session.actor);
    }

    const { data: wos } = await supabase
      .from('work_orders')
      .select('id, wo_number, description, stage, unit_turn_id')
      .eq('unit_turn_id', turn.id);

    return NextResponse.json({ turn, work_orders: wos ?? [] });
  } catch (error) {
    console.error('[Maintenance] Unit turn update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update unit turn';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
