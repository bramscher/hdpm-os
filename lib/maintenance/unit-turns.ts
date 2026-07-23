import { getSupabaseAdmin } from '@/lib/supabase';
import { recordEvents } from './events';
import type { UnitTurn } from './types';

/**
 * Unit-level turnover helpers (Turnover board v2).
 *
 * A unit_turn groups MANY work orders (paint, flooring, clean, punch...)
 * under one turnover cycle. Linking/unlinking always writes a wo_event so
 * the audit trail shows when a WO joined or left a turn and who did it.
 */

function turnLabel(turn: Pick<UnitTurn, 'property_name' | 'unit_name'>): string {
  return turn.unit_name ? `${turn.property_name} · ${turn.unit_name}` : turn.property_name;
}

/** Link work orders to a turn (sets unit_turn_id + is_turn, audited). */
export async function linkWorkOrdersToTurn(
  turn: UnitTurn,
  woIds: string[],
  actor: string
): Promise<void> {
  if (woIds.length === 0) return;
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('work_orders')
    .update({ unit_turn_id: turn.id, is_turn: true })
    .in('id', woIds);
  if (error) throw new Error(`Turn link failed: ${error.message}`);

  await recordEvents(
    woIds.map((id) => ({
      work_order_id: id,
      event_type: 'note',
      payload: { kind: 'turn_link', unit_turn_id: turn.id, unit_turn: turnLabel(turn) },
      actor,
    }))
  );
}

/** Unlink work orders from whatever turn they belong to (audited). */
export async function unlinkWorkOrdersFromTurn(woIds: string[], actor: string): Promise<void> {
  if (woIds.length === 0) return;
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('work_orders')
    .update({ unit_turn_id: null })
    .in('id', woIds);
  if (error) throw new Error(`Turn unlink failed: ${error.message}`);

  await recordEvents(
    woIds.map((id) => ({
      work_order_id: id,
      event_type: 'note',
      payload: { kind: 'turn_unlink' },
      actor,
    }))
  );
}

/**
 * Bridge for the legacy per-WO turn endpoint: make sure a unit-level turn
 * exists for this work order's unit and that the WO is linked to it.
 *
 * Matching rule: an ACTIVE unit_turn on the same property_name + unit_name.
 * If none exists, one is created from the legacy turn fields.
 */
export async function ensureUnitTurnForWorkOrder(
  woId: string,
  fields: {
    vacated_at: string;
    target_ready?: string | null;
    current_blocker?: string | null;
    budget?: number | null;
    actual?: number | null;
  },
  actor: string
): Promise<UnitTurn | null> {
  const supabase = getSupabaseAdmin();

  const { data: wo, error: woError } = await supabase
    .from('work_orders')
    .select('id, property_id, property_name, unit_id, unit_name, unit_turn_id')
    .eq('id', woId)
    .single();
  if (woError || !wo) return null;

  // Already linked? Refresh the turn's fields from the legacy payload and stop.
  if (wo.unit_turn_id) {
    const { data: existing } = await supabase
      .from('unit_turn')
      .update({
        vacated_at: fields.vacated_at,
        target_ready: fields.target_ready ?? null,
        current_blocker: fields.current_blocker ?? null,
        budget: fields.budget ?? null,
        actual: fields.actual ?? null,
      })
      .eq('id', wo.unit_turn_id)
      .select('*')
      .single();
    return (existing as UnitTurn) ?? null;
  }

  // Find an active turn for the same unit.
  let query = supabase
    .from('unit_turn')
    .select('*')
    .eq('status', 'active')
    .eq('property_name', wo.property_name);
  query = wo.unit_name ? query.eq('unit_name', wo.unit_name) : query.is('unit_name', null);
  const { data: matches } = await query.limit(1);

  let turn = (matches?.[0] as UnitTurn) ?? null;

  if (!turn) {
    const { data: created, error: createError } = await supabase
      .from('unit_turn')
      .insert({
        property_id: wo.property_id,
        property_name: wo.property_name,
        unit_id: wo.unit_id,
        unit_name: wo.unit_name,
        vacated_at: fields.vacated_at,
        target_ready: fields.target_ready ?? null,
        current_blocker: fields.current_blocker ?? null,
        budget: fields.budget ?? null,
        actual: fields.actual ?? null,
      })
      .select('*')
      .single();
    if (createError || !created) {
      throw new Error(createError?.message || 'unit_turn create failed');
    }
    turn = created as UnitTurn;
  }

  await linkWorkOrdersToTurn(turn, [woId], actor);
  return turn;
}
